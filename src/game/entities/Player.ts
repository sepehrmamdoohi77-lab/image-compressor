// Player soldier: movement, aiming, weapons, reload, damage, animation state.
import * as THREE from 'three';
import { PLAYER_CONFIG, WEAPON_ORDER, type WeaponId } from '../data/config';
import { WeaponInstance } from '../weapons/Weapons';
import { CharacterRig } from './CharacterMeshFactory';
import { buildWeaponMesh, type WeaponMesh } from './WeaponMeshFactory';
import type { MaterialLib, GeometryLib } from '../world/Materials';
import type { Level } from '../world/Level';
import type { InputManager } from '../core/InputManager';
import { angleLerp, clamp } from '../utils/math';

export class Player {
  pos = new THREE.Vector3();
  vel = new THREE.Vector3();
  yaw = Math.PI; // face north (toward enemies) at spawn
  health: number = PLAYER_CONFIG.maxHealth;
  armor: number = PLAYER_CONFIG.startArmor;
  alive = true;
  weapons = new Map<WeaponId, WeaponInstance>();
  currentId: WeaponId = 'rifle';
  grenades: number = PLAYER_CONFIG.grenades;
  aiming = false;
  crouched = false;
  moving = false;
  speed = 0;
  recoil = 0;
  wishFire = false; // set each frame: trigger wants a shot
  lastDamageAt = -Infinity;
  aimPoint = new THREE.Vector3();

  rig: CharacterRig;
  weaponMeshes = new Map<WeaponId, WeaponMesh>();
  radius = 0.35;
  /** Fired when a reload completes (weapon-specific foley lives in AudioManager). */
  onReloadComplete: ((id: WeaponId) => void) | null = null;

  private tmp = new THREE.Vector3();

  constructor(mats: MaterialLib, geos: GeometryLib) {
    this.rig = new CharacterRig(mats, geos, {
      uniform: 0x4c5744, vest: 0x2e332a, helmet: 0x3a4034, skin: 0xb08a68, accent: 0x3fa7ff,
    });
    for (const id of WEAPON_ORDER) {
      this.weapons.set(id, new WeaponInstance(id));
      this.weaponMeshes.set(id, buildWeaponMesh(id, mats, geos));
    }
    this.equip(this.currentId);
  }

  get weapon(): WeaponInstance {
    const w = this.weapons.get(this.currentId);
    if (!w) throw new Error('[Player] current weapon missing');
    return w;
  }

  get maxHealth(): number {
    return PLAYER_CONFIG.maxHealth;
  }

  get maxArmor(): number {
    return PLAYER_CONFIG.maxArmor;
  }

  equip(id: WeaponId): void {
    if (!this.weapons.has(id) || !this.alive) return;
    if (this.currentId !== id) {
      this.weapon.cancelReload();
      this.currentId = id;
      this.refreshWeaponMesh();
    }
  }

  cycleWeapon(dir: 1 | -1): void {
    const i = WEAPON_ORDER.indexOf(this.currentId);
    const n = WEAPON_ORDER[(i + dir + WEAPON_ORDER.length) % WEAPON_ORDER.length];
    this.equip(n);
  }

  private refreshWeaponMesh(): void {
    this.rig.clearWeapon();
    const mesh = this.weaponMeshes.get(this.currentId);
    // Support hand goes to THIS weapon's grip point -> two-handed hold.
    if (mesh) this.rig.mountWeapon(mesh.group, mesh.grip.support);
  }

  reset(spawn: { x: number; z: number }): void {
    this.pos.set(spawn.x, 0, spawn.z);
    this.vel.set(0, 0, 0);
    this.yaw = Math.PI;
    this.health = this.maxHealth;
    this.armor = PLAYER_CONFIG.startArmor;
    this.alive = true;
    this.grenades = PLAYER_CONFIG.grenades;
    this.recoil = 0;
    this.aiming = false;
    this.crouched = false;
    this.rig.reset();
    for (const w of this.weapons.values()) w.reset();
    this.currentId = 'rifle';
    this.refreshWeaponMesh();
    this.syncRig(0);
  }

  refillForRound(): void {
    for (const w of this.weapons.values()) w.refill(w.def.autoRefillReservePerRound);
    this.grenades = Math.min(PLAYER_CONFIG.maxGrenades, this.grenades + 1);
    this.armor = Math.min(this.maxArmor, this.armor + 25);
  }

  takeDamage(healthDamage: number, armorDamage: number, now: number): boolean {
    if (!this.alive) return false;
    this.armor = Math.max(0, this.armor - armorDamage);
    this.health = Math.max(0, this.health - healthDamage);
    this.lastDamageAt = now;
    this.rig.playHit();
    if (this.health <= 0) {
      this.alive = false;
      return true;
    }
    return false;
  }

  muzzleWorld(out: THREE.Vector3): THREE.Vector3 {
    const mesh = this.weaponMeshes.get(this.currentId);
    this.rig.root.updateMatrixWorld(true);
    if (!mesh) return out.copy(this.pos).setY(1.35);
    return mesh.muzzle.getWorldPosition(out);
  }

  /** Support-hand world position (two-hand grip verification / muzzle smoke). */
  supportHandWorld(out: THREE.Vector3): THREE.Vector3 {
    this.rig.root.updateMatrixWorld(true);
    return this.rig.handL.getWorldPosition(out);
  }

  update(
    dt: number,
    now: number,
    input: InputManager,
    aimPoint: THREE.Vector3,
    level: Level,
    canAct: boolean,
    azimuthDeg: number,
  ): void {
    this.aimPoint.copy(aimPoint);
    const w = this.weapon;
    const reloadDone = w.update(now, dt);
    if (reloadDone) this.onReloadComplete?.(this.currentId);

    // Recoil recovery.
    this.recoil = Math.max(0, this.recoil - w.def.recoilRecovery * dt * 0.02);

    this.wishFire = false;
    this.aiming = false;

    if (canAct && this.alive) {
      // --- movement (camera-relative) ---
      const { x: ix, y: iy } = input.moveAxes();
      const az = THREE.MathUtils.degToRad(azimuthDeg);
      // Screen-up on ground = away from camera; screen-right = camera right.
      const upX = -Math.sin(az);
      const upZ = -Math.cos(az);
      const rightX = Math.cos(az);
      const rightZ = -Math.sin(az);
      let mx = upX * -iy + rightX * ix;
      let mz = upZ * -iy + rightZ * ix;
      const mLen = Math.hypot(mx, mz);
      if (mLen > 1) {
        mx /= mLen;
        mz /= mLen;
      }
    this.aiming = input.mouseRight;
      this.crouched = input.isDown('KeyC') || input.isDown('ControlLeft');
      const penalty = 1 - w.def.movePenalty - (this.aiming ? 1 - PLAYER_CONFIG.aimMoveMultiplier : 0) - (this.crouched ? 0.5 : 0);
      const targetSpeed = PLAYER_CONFIG.walkSpeed * clamp(penalty, 0.3, 1);
      const accel = mLen > 0.05 ? PLAYER_CONFIG.accel : PLAYER_CONFIG.decel;
      this.tmp.set(mx * targetSpeed, 0, mz * targetSpeed);
      this.vel.lerp(this.tmp, Math.min(1, accel * dt / Math.max(0.001, targetSpeed)));
      if (mLen <= 0.05 && this.vel.length() < 0.08) this.vel.set(0, 0, 0);
      this.pos.addScaledVector(this.vel, dt);
      level.collideCircle(this.pos, this.radius);
      this.speed = this.vel.length();
      this.moving = this.speed > 0.6;

      // --- aim ---
      const dx = aimPoint.x - this.pos.x;
      const dz = aimPoint.z - this.pos.z;
      if (dx * dx + dz * dz > 0.04) {
        const targetYaw = Math.atan2(dx, dz);
        this.yaw = angleLerp(this.yaw, targetYaw, Math.min(1, dt * 14));
      }

      // --- weapon switching ---
      const codes = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5'];
      for (let i = 0; i < codes.length; i++) {
        if (input.wasPressed(codes[i])) this.equip(WEAPON_ORDER[i]);
      }
      if (input.wasPressed('Tab')) this.cycleWeapon(1);

      // --- reload ---
      if (input.wasPressed('KeyR')) w.startReload(now);

      // --- trigger ---
      const triggerHeld = input.mouseLeft;
      const triggerEdge = input.mouseLeftPressed;
      const wantShot = w.def.fireMode === 'auto' ? triggerHeld : triggerEdge;
      if (wantShot) {
        if (w.isEmpty && !w.reloading && w.reserveAmmo > 0) {
          w.startReload(now); // auto-reload on empty
        } else if (!w.reloading) {
          this.wishFire = true;
        }
      }
    } else {
      this.vel.multiplyScalar(Math.exp(-8 * dt));
      this.speed = this.vel.length();
      this.moving = false;
    }

    this.syncRig(dt);
  }

  /** Menu backdrop: gentle idle animation, no input. */
  menuIdle(dt: number): void {
    this.speed = 0;
    this.syncRig(dt);
  }

  private syncRig(dt: number): void {
    this.rig.root.position.copy(this.pos);
    this.rig.root.rotation.y = this.yaw;
    this.rig.update(dt, {
      speed: this.speed,
      aiming: this.aiming,
      firing: this.wishFire,
      reloading: this.weapon.reloading,
      dead: !this.alive,
      crouch: this.crouched,
    });
  }
}
