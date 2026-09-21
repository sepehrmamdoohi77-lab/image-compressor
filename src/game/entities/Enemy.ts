// Enemy soldier entity: stats, weapon, damage, visual state.
// Behavior lives in AIController (wired by Game) to keep entity/AI decoupled.
import * as THREE from 'three';
import { ENEMIES, type EnemyArchetype, type EnemyDef } from '../data/config';
import { WeaponInstance } from '../weapons/Weapons';
import { CharacterRig } from './CharacterMeshFactory';
import { buildWeaponMesh, type WeaponMesh } from './WeaponMeshFactory';
import type { MaterialLib, GeometryLib } from '../world/Materials';

export type EnemyStateName =
  | 'Idle' | 'Patrol' | 'Suspicious' | 'Investigating' | 'Searching'
  | 'Engaging' | 'TakingCover' | 'InCover' | 'Flanking' | 'Retreating'
  | 'Reloading' | 'HitReaction' | 'Dead';

export interface ScaledEnemyDef extends EnemyDef {
  maxHealth: number;
}

let nextId = 1;

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

export class Enemy {
  readonly id = nextId++;
  archetype: EnemyArchetype;
  def: ScaledEnemyDef;
  pos = new THREE.Vector3();
  vel = new THREE.Vector3();
  yaw = 0;
  health: number;
  armor: number;
  alive = true;
  weapon: WeaponInstance;
  rig: CharacterRig;
  weaponMesh: WeaponMesh;
  radius = 0.35;
  speed = 0;
  state: EnemyStateName = 'Idle';
  // AI scratch (owned by AIController, stored here for locality).
  ai = {
    lastSeenPos: new THREE.Vector3(),
    lastSeenAt: -Infinity,
    confidence: 0,
    suspicion: 0,
    suspicionPos: new THREE.Vector3(),
    stateTime: 0,
    decisionAt: 0,
    perceptionAt: Math.random() * 0.2,
    repathAt: 0,
    burstLeft: 0,
    nextBurstAt: 0,
    reactionAt: 0,
    lastDamageAt: -Infinity,
    path: [] as { x: number; z: number }[],
    pathIndex: 0,
    coverId: -1,
    patrolTarget: { x: 0, z: 0 },
    hasPatrolTarget: false,
    strafeDir: 1,
    strafeAt: 0,
    searchIndex: 0,
    crouched: false,
    /** -1..0..1 cover lean (which way the soldier peeks out). */
    lean: 0,
    /** Cover point the soldier is currently using (-1 = none). */
    peekSide: 1,
    exposeUntil: 0,
    hideUntil: 0,
    /** Lean target while peeking (-1/0/1 scaled by AI.coverLean). */
    leanTarget: 0,
    /** Time of the last "am I still covered?" re-check. */
    flankCheckAt: 0,
    /** Damage absorbed since arriving at this cover point. */
    damagedInCover: 0,
    homeX: 0,
    homeZ: 0,
    lastHeardAt: 0,
    stuckCheckAt: 0,
    stuckX: 0,
    stuckZ: 0,
  };
  deathAt = 0;
  firing = false;
  /** Last frame's yaw (banking into turns). */
  private lastYaw = 0;
  aiming = false;
  /** Per-enemy accuracy/reaction scaling from difficulty. */
  accuracyMult = 1;
  aggressionMult = 1;

  constructor(archetype: EnemyArchetype, mats: MaterialLib, geos: GeometryLib) {
    this.archetype = archetype;
    const base: EnemyDef = ENEMIES[archetype];
    this.def = { ...base, maxHealth: base.health };
    this.health = base.health;
    this.armor = base.armor;
    this.weapon = new WeaponInstance(base.weaponId);
    // Enemies carry generous reserves; reloads still happen (fair + readable).
    this.weapon.reserveAmmo = this.weapon.def.maxReserve;
    this.rig = new CharacterRig(mats, geos, {
      uniform: 0x7b6f5e,
      vest: 0x46403a,
      helmet: 0x3b3730,
      skin: 0x9a7a5e,
      accent: base.tint,
      camo: mats.camo,
    });
    this.rig.root.scale.setScalar(base.scale);
    this.weaponMesh = buildWeaponMesh(base.weaponId, mats, geos);
    // Two-handed hold: support hand on this weapon's own grip point.
    this.rig.mountWeapon(this.weaponMesh.group, this.weaponMesh.grip.support);
  }

  applyDifficulty(healthMult: number, accuracyMult: number, aggressionMult: number): void {
    this.def.maxHealth = Math.round(this.def.health * healthMult);
    this.health = this.def.maxHealth;
    this.accuracyMult = accuracyMult;
    this.aggressionMult = aggressionMult;
  }

  spawnAt(x: number, z: number, yaw: number): void {
    this.pos.set(x, 0, z);
    this.yaw = yaw;
    this.syncRig(0);
  }

  get maxHealth(): number {
    return this.def.maxHealth;
  }

  takeDamage(healthDamage: number, armorDamage: number, now: number): boolean {
    if (!this.alive) return false;
    this.armor = Math.max(0, this.armor - armorDamage);
    this.health = Math.max(0, this.health - healthDamage);
    this.ai.lastDamageAt = now;
    this.rig.playHit();
    if (this.health <= 0) {
      this.alive = false;
      this.state = 'Dead';
      this.deathAt = now;
      this.firing = false;
      return true;
    }
    return false;
  }

  muzzleWorld(out: THREE.Vector3): THREE.Vector3 {
    this.rig.root.updateMatrixWorld(true);
    return this.weaponMesh.muzzle.getWorldPosition(out);
  }

  updateVisual(dt: number): void {
    this.syncRig(dt);
  }

  private syncRig(dt: number): void {
    this.rig.root.position.copy(this.pos);
    this.rig.root.rotation.y = this.yaw;
    // Shortest-arc yaw delta so the body banks into turns like the player's.
    let dy = this.yaw - this.lastYaw;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    const turnRate = dt > 1e-4 ? dy / dt : 0;
    this.lastYaw = this.yaw;
    this.rig.update(dt, {
      speed: this.speed,
      sprint: clamp01(this.speed / 5.2),
      aiming: this.aiming,
      firing: this.firing,
      reloading: this.weapon.reloading,
      dead: !this.alive,
      crouch: this.ai.crouched,
      lean: this.ai.lean,
      turnRate,
    });
  }

  dispose(): void {
    this.rig.dispose();
  }
}
