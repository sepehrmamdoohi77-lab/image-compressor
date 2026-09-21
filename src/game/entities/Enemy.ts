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
    exposeUntil: 0,
    hideUntil: 0,
    homeX: 0,
    homeZ: 0,
    lastHeardAt: 0,
    stuckCheckAt: 0,
    stuckX: 0,
    stuckZ: 0,
  };
  deathAt = 0;
  firing = false;
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
      uniform: 0x5a5148,
      vest: 0x3a3630,
      helmet: 0x33302b,
      skin: 0x9a7a5e,
      accent: base.tint,
    });
    this.rig.root.scale.setScalar(base.scale);
    this.weaponMesh = buildWeaponMesh(base.weaponId, mats, geos);
    this.rig.mountWeapon(this.weaponMesh.group);
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
    this.rig.update(dt, {
      speed: this.speed,
      aiming: this.aiming,
      firing: this.firing,
      reloading: this.weapon.reloading,
      dead: !this.alive,
      crouch: this.ai.crouched,
    });
  }

  dispose(): void {
    this.rig.dispose();
  }
}
