// Shooting resolution: muzzle -> direction -> spread -> walls -> characters.
// Honest hitscan: bullets never pass through solid geometry.
import * as THREE from 'three';
import type { Level } from '../world/Level';
import type { ParticleSystem } from '../vfx/ParticleSystem';
import type { AudioManager } from '../audio/AudioManager';
import type { TacticalCamera } from '../camera/TacticalCamera';
import type { SquadAwareness } from '../ai/SquadAwareness';
import type { Player } from '../entities/Player';
import type { Enemy } from '../entities/Enemy';
import { weaponDamage, zoneFromHeight, type DamageResult } from '../combat/DamageSystem';
import { rayPointDistance, type EnemyShotPlan } from '../combat/EnemyFire';
import { computeSpread } from '../weapons/Weapons';
import type { WeaponDef, HitZone } from '../data/config';
import { AI, DAMAGE } from '../data/config';
import { clamp } from '../utils/math';

export interface CharacterTarget {
  x: number; z: number; feetY: number; height: number; radius: number; armor: number;
}

export interface RayHit {
  t: number;
  zone: HitZone;
  pointY: float;
  lateral: number;
  headshot: boolean;
}
type float = number;

/**
 * Ray vs vertical character capsule (cylinder + head sphere). Pure math.
 * Returns nearest hit within maxT or null.
 */
export function rayVsCharacter(
  ox: number, oy: number, oz: number,
  dx: number, dy: number, dz: number,
  maxT: number,
  c: CharacterTarget,
): RayHit | null {
  // 2D ray-circle in XZ.
  const rx = ox - c.x;
  const rz = oz - c.z;
  const a = dx * dx + dz * dz;
  if (a < 1e-9) {
    // Vertical shot: only hits if origin inside radius.
    if (rx * rx + rz * rz > c.radius * c.radius) return null;
  }
  const b = 2 * (rx * dx + rz * dz);
  const cc = rx * rx + rz * rz - c.radius * c.radius;
  const disc = b * b - 4 * a * cc;
  if (disc < 0) return null;
  const sq = Math.sqrt(disc);
  let t0 = (-b - sq) / (2 * a);
  const t1 = (-b + sq) / (2 * a);
  if (t1 < 0) return null;
  if (t0 < 0) t0 = 0;
  if (t0 > maxT) return null;
  // Y at entry.
  const y0 = oy + dy * t0;
  const topY = c.feetY + c.height;
  let tHit = t0;
  let yHit = y0;
  if (yHit > topY) {
    // Ray descends into the capsule: solve y(t) = topY.
    if (dy >= -1e-6) return null;
    tHit = (topY - oy) / dy;
    if (tHit < t0 || tHit > Math.min(t1, maxT)) return null;
    yHit = topY;
  } else if (yHit < c.feetY) {
    if (dy <= 1e-6) return null;
    tHit = (c.feetY - oy) / dy;
    if (tHit < t0 || tHit > Math.min(t1, maxT)) return null;
    yHit = c.feetY;
  }
  // Head sphere check (may override with earlier t).
  const hx = c.x;
  const hy = c.feetY + c.height - 0.16;
  const hz = c.z;
  const hr = Math.min(0.24, c.radius * 0.75);
  const sox = ox - hx;
  const soy = oy - hy;
  const soz = oz - hz;
  const sb = sox * dx + soy * dy + soz * dz;
  const sc = sox * sox + soy * soy + soz * soz - hr * hr;
  const sdisc = sb * sb - sc;
  if (sdisc >= 0) {
    const st = -sb - Math.sqrt(sdisc);
    if (st > 0 && st < tHit && st <= maxT) {
      return { t: st, zone: 'HEAD', pointY: oy + dy * st, lateral: 0, headshot: true };
    }
  }
  // Lateral offset: perpendicular distance from ray to body axis at hit.
  const px = ox + dx * tHit - c.x;
  const pz = oz + dz * tHit - c.z;
  const lateral = Math.hypot(px, pz);
  const zone = zoneFromHeight(yHit, c.feetY, c.height, lateral);
  return { t: tHit, zone, pointY: yHit, lateral, headshot: zone === 'HEAD' };
}

export interface PlayerFireResult {
  fired: boolean;
  shots: number;
  hits: number;
  headshots: number;
  killed: Enemy[];
  dryFire: boolean;
}

export interface EnemyFireResult {
  fired: boolean;
  hit: boolean;
  headshot: boolean;
  /** The round was a planned wide shot (did not connect). */
  miss: boolean;
  /** The round cracked past the player without hitting (whiz-by). */
  nearMiss: boolean;
  damage: DamageResult | null;
}

/** Hostile tracer colour (never player-weapon specific). */
const ENEMY_TRACER_COLOR = 0xff6a5c;

const _muzzle = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _target = new THREE.Vector3();
const _hitPoint = new THREE.Vector3();
const _right = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);

export function eyeHeight(crouched: boolean): number {
  return crouched ? 0.9 : 1.6;
}

export function targetHeight(crouched: boolean, scale: number): number {
  return (crouched ? 1.15 : 1.8) * scale;
}

export class CombatSystem {
  constructor(
    private level: Level,
    private particles: ParticleSystem,
    private audio: AudioManager,
    private camera: TacticalCamera,
    private squad: SquadAwareness,
    private playerPos: THREE.Vector3, // for positional audio
  ) {}

  // --- player ---------------------------------------------------------------
  playerFire(player: Player, enemies: Enemy[], now: number): PlayerFireResult {
    const res: PlayerFireResult = { fired: false, shots: 0, hits: 0, headshots: 0, killed: [], dryFire: false };
    const w = player.weapon;
    const def = w.def;
    if (!w.tryFire(now)) {
      if (w.isEmpty && !w.reloading) {
        res.dryFire = true;
        this.audio.playDryFire();
      }
      return res;
    }
    res.fired = true;
    player.rig.playFire();

    player.muzzleWorld(_muzzle);
    // Aim at cursor, raised to torso height for honest trajectories.
    _target.set(player.aimPoint.x, 1.15, player.aimPoint.z);
    _dir.copy(_target).sub(_muzzle);
    const aimDist = Math.max(0.5, _dir.length());
    _dir.normalize();

    const spread = computeSpread(def, { moving: player.moving, aiming: player.aiming, bloom: w.bloom });
    // Recoil: predictable upward bias + alternating yaw.
    const recoilBlast = player.recoil;

    this.cameraRight(_right);
    for (let p = 0; p < def.pellets; p++) {
      res.shots++;
      const dir = this.applySpread(_dir, spread, recoilBlast, p);
      const wallT = this.level.raycastObstacles(_muzzle.x, _muzzle.y, _muzzle.z, dir.x, dir.y, dir.z, def.range);
      // Nearest enemy along the ray.
      let bestEnemy: Enemy | null = null;
      let bestHit: RayHit | null = null;
      for (const e of enemies) {
        if (!e.alive) continue;
        const crouched = e.ai.crouched;
        const hit = rayVsCharacter(
          _muzzle.x, _muzzle.y, _muzzle.z, dir.x, dir.y, dir.z, Math.min(wallT, def.range),
          {
            x: e.pos.x, z: e.pos.z, feetY: 0,
            height: targetHeight(!!crouched, e.def.scale),
            radius: 0.36 * e.def.scale, armor: e.armor,
          },
        );
        if (hit && (!bestHit || hit.t < bestHit.t)) {
          bestHit = hit;
          bestEnemy = e;
        }
      }
      _hitPoint.copy(_muzzle).addScaledVector(dir, Math.min(wallT, def.range));
      if (bestEnemy && bestHit) {
        const hh: RayHit = bestHit;
        const en: Enemy = bestEnemy;
        res.hits++;
        _hitPoint.copy(_muzzle).addScaledVector(dir, hh.t);
        const dmg = weaponDamage(def, hh.zone, hh.t, en.armor);
        const died = en.takeDamage(dmg.healthDamage, dmg.armorDamage, now);
        this.particles.bloodPuff(_hitPoint);
        if (hh.headshot) res.headshots++;
        if (died) res.killed.push(en);
      } else if (wallT < def.range) {
        this.particles.impact(_hitPoint, 'concrete');
        this.audio.playImpact(clamp(wallT / 45, 0, 1));
      }
      this.particles.tracer(_muzzle, _hitPoint, def.tracerColor);
    }

    // Muzzle + shell + sound + feedback.
    if (def.pellets > 0) {
      this.particles.muzzleFlash(_muzzle, _dir, def.id === 'shotgun' || def.id === 'dmr');
      this.particles.shell(_muzzle, _right);
      this.audio.playShot(def.sound, 0, 0);
      this.camera.kick(def.kickback, player.yaw);
      if (def.id === 'shotgun') this.camera.addTrauma(0.22);
      else if (def.id === 'dmr') this.camera.addTrauma(0.1);
      player.recoil = Math.min(0.09, player.recoil + def.recoilPitch);
      void aimDist;
      // Gunshots alert the AI.
      this.squad.addNoise({ x: player.pos.x, z: player.pos.z, radius: 19, at: now, kind: 'shot' });
    }
    return res;
  }

  // --- enemy ------------------------------------------------------------------
  enemyFire(enemy: Enemy, player: Player, plan: EnemyShotPlan, now: number): EnemyFireResult {
    const res: EnemyFireResult = { fired: false, hit: false, headshot: false, miss: false, nearMiss: false, damage: null };
    const w = enemy.weapon;
    const def = w.def;
    if (!w.tryFire(now)) return res;
    res.fired = true;
    enemy.rig.playFire();
    enemy.muzzleWorld(_muzzle);

    const pCrouched = player.crouched;
    const chestY = pCrouched ? 0.8 : 1.2;
    // Base direction: muzzle -> centre of mass.
    _target.set(player.pos.x, chestY, player.pos.z);
    _dir.copy(_target).sub(_muzzle);
    const distToTarget = Math.max(0.5, _dir.length());
    _dir.normalize();
    // Aim cone: error is angular, so it scales with distance (not world units).
    const cone = plan.aimError * distToTarget * (plan.miss ? 0.4 : 1);
    const hLen = Math.hypot(_dir.x, _dir.z);
    const rx = hLen > 1e-4 ? _dir.z / hLen : 1;
    const rz = hLen > 1e-4 ? -_dir.x / hLen : 0;
    const offX = (Math.random() - 0.5) * 2 * cone + rx * plan.lateral;
    const offY = (Math.random() - 0.5) * 2 * cone * 0.6 + plan.vertical;
    const offZ = (Math.random() - 0.5) * 2 * cone + rz * plan.lateral;
    _target.set(_target.x + offX, _target.y + offY, _target.z + offZ);
    _dir.copy(_target).sub(_muzzle);
    _dir.normalize();
    const dir = this.applySpread(_dir, w.bloom * 0.5 + def.spreadBase, 0, 0);
    const wallT = this.level.raycastObstacles(_muzzle.x, _muzzle.y, _muzzle.z, dir.x, dir.y, dir.z, def.range);
    const maxT = Math.min(wallT, def.range);
    _hitPoint.copy(_muzzle).addScaledVector(dir, maxT);
    res.miss = plan.miss;

    if (player.alive) {
      const hit = rayVsCharacter(
        _muzzle.x, _muzzle.y, _muzzle.z, dir.x, dir.y, dir.z, maxT,
        {
          x: player.pos.x, z: player.pos.z, feetY: 0,
          height: targetHeight(pCrouched, 1), radius: 0.34, armor: player.armor,
        },
      );
      if (hit) {
        res.hit = true;
        res.headshot = hit.headshot;
        _hitPoint.copy(_muzzle).addScaledVector(dir, hit.t);
        const dmg = weaponDamage(def, hit.zone, hit.t, player.armor);
        res.damage = dmg;
        player.takeDamage(dmg.healthDamage, dmg.armorDamage, now);
        this.particles.bloodPuff(_hitPoint);
      } else if (wallT < def.range) {
        this.particles.impact(_hitPoint, 'concrete');
      }
      // Near miss: the round came close but did not connect — crack + shake, so
      // the player feels the shot instead of only reading the tracer.
      if (!res.hit) {
        const gap = rayPointDistance(
          _muzzle.x, _muzzle.y, _muzzle.z, dir.x, dir.y, dir.z,
          player.pos.x, chestY, player.pos.z, maxT,
        );
        if (gap < AI.nearMissRadius) {
          res.nearMiss = true;
          const closeness = 1 - gap / AI.nearMissRadius;
          this.camera.addTrauma(0.09 * closeness);
        }
      }
    }
    // Incoming fire stays red-orange regardless of the hostile's weapon — the
    // player must be able to tell "that one is shooting at ME" at a glance.
    this.particles.tracer(_muzzle, _hitPoint, ENEMY_TRACER_COLOR);
    this.particles.muzzleFlash(_muzzle, dir, def.sound.big);
    const distToPlayer = _muzzle.distanceTo(this.playerPos);
    const pan = this.panFor(_muzzle);
    this.audio.playShot(def.sound, clamp(distToPlayer / 45, 0, 1), pan);
    if (res.nearMiss) {
      this.audio.playNearMiss(pan, clamp(1 - distToPlayer / 30, 0.15, 1), clamp(distToPlayer / 45, 0, 1));
    }
    return res;
  }

  // --- helpers ------------------------------------------------------------------
  private spreadDir = new THREE.Vector3();
  private spreadU = new THREE.Vector3();
  private spreadV = new THREE.Vector3();

  private applySpread(base: THREE.Vector3, spread: number, recoil: number, pelletIndex: number): THREE.Vector3 {
    const total = spread + recoil;
    // Deterministic-ish cone: stratified for pellets, random for single shots.
    let ox: number;
    let oy: number;
    if (pelletIndex > 0 || total <= 0) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * total * 3;
      ox = Math.cos(a) * r;
      oy = Math.sin(a) * r;
    } else {
      ox = (Math.random() + Math.random() - 1) * total * 2;
      oy = (Math.random() + Math.random() - 1) * total * 2 + recoil * 0.6;
    }
    // Build orthonormal basis around base (preallocated temps, no GC churn).
    _up.set(0, 1, 0);
    const u = this.spreadU.crossVectors(base, _up);
    if (u.lengthSq() < 1e-6) u.set(1, 0, 0);
    u.normalize();
    const v = this.spreadV.crossVectors(u, base).normalize();
    this.spreadDir.copy(base).addScaledVector(u, ox).addScaledVector(v, oy).normalize();
    return this.spreadDir;
  }

  private cameraRight(out: THREE.Vector3): THREE.Vector3 {
    const e = this.camera.camera.matrixWorld.elements;
    out.set(e[0], e[1], e[2]).normalize();
    return out;
  }

  panFor(worldPos: THREE.Vector3): number {
    this.cameraRight(_right);
    _target.copy(worldPos).sub(this.playerPos);
    const d = _target.length();
    if (d < 1e-4) return 0;
    _target.divideScalar(d);
    return clamp(_target.dot(_right), -1, 1) * 0.7;
  }

  /** Radial explosion damage with LOS gating. Returns killed enemies. */
  explode(
    pos: THREE.Vector3, radius: number, damage: number,
    player: Player, enemies: Enemy[], now: number, selfMult: number,
  ): { killedEnemies: Enemy[]; playerDamage: number } {
    const killedEnemies: Enemy[] = [];
    let playerDamage = 0;
    // Enemies.
    for (const e of enemies) {
      if (!e.alive) continue;
      const dx = e.pos.x - pos.x;
      const dz = e.pos.z - pos.z;
      const dist = Math.hypot(dx, dz);
      if (dist >= radius) continue;
      const blocked = this.level.segmentBlocked(pos.x, 0.6, pos.z, e.pos.x, 1.2, e.pos.z);
      let fall = 1 - (dist / radius);
      fall = 0.25 + 0.75 * fall;
      if (blocked) fall *= 0.15;
      const raw = Math.max(1, Math.round(damage * fall));
      const reduction = e.armor > 0 ? Math.min(0.5, e.armor / (e.armor + 60)) : 0;
      const died = e.takeDamage(Math.round(raw * (1 - reduction)), Math.round(raw * 0.3), now);
      if (died) killedEnemies.push(e);
    }
    // Player (self damage possible — grenades are dangerous).
    if (player.alive) {
      const dist = Math.hypot(player.pos.x - pos.x, player.pos.z - pos.z);
      if (dist < radius) {
        const blocked = this.level.segmentBlocked(pos.x, 0.6, pos.z, player.pos.x, 1.2, player.pos.z);
        let fall = 0.25 + 0.75 * (1 - dist / radius);
        if (blocked) fall *= 0.15;
        const raw = Math.max(1, Math.round(damage * fall * selfMult));
        player.takeDamage(raw, Math.round(raw * 0.3), now);
        playerDamage = raw;
      }
    }
    // Shared presentation.
    this.particles.explosion(pos);
    const distP = pos.distanceTo(this.playerPos);
    this.audio.playExplosion(clamp(distP / 50, 0, 1));
    this.camera.addTrauma(clamp(1.2 - distP / 22, 0.1, 0.75) * DAMAGE.grenadeDamage / 110);
    this.squad.addNoise({ x: pos.x, z: pos.z, radius: 34, at: now, kind: 'explosion' });
    return { killedEnemies, playerDamage };
  }
}
