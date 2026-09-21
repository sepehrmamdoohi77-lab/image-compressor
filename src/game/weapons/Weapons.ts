// Data-driven weapon framework: definitions in config, state + rules here.
// WeaponInstance is deterministic and injectable-time friendly for tests.
import { WEAPONS, type WeaponDef, type WeaponId } from '../data/config';
import { clamp } from '../utils/math';

export function getWeaponDef(id: WeaponId): WeaponDef {
  const def = WEAPONS[id];
  if (!def) throw new Error(`[Weapons] unknown weapon id: ${String(id)}`);
  return def;
}

export function fireInterval(def: WeaponDef): number {
  return 60 / Math.max(1, def.rpm);
}

/** Current spread in radians for a shot. Pure for testability. */
export function computeSpread(
  def: WeaponDef,
  opts: { moving: boolean; aiming: boolean; bloom: number },
): number {
  let s = def.spreadBase + opts.bloom;
  if (opts.moving) s += def.spreadMove;
  if (opts.aiming) s *= def.spreadAimMult;
  return Math.min(s, def.spreadMax);
}

export class WeaponInstance {
  readonly def: WeaponDef;
  magAmmo: number;
  reserveAmmo: number;
  bloom = 0; // accumulated sustained-fire spread
  reloading = false;
  reloadEndsAt = 0;
  private lastShotAt = -Infinity;

  constructor(id: WeaponId) {
    this.def = getWeaponDef(id);
    this.magAmmo = this.def.magSize;
    this.reserveAmmo = this.def.startReserve;
  }

  get interval(): number {
    return fireInterval(this.def);
  }

  /** True if the trigger pull produces a shot right now. */
  canFire(now: number): boolean {
    if (this.reloading) return false;
    if (this.magAmmo <= 0) return false;
    return now - this.lastShotAt >= this.interval - 1e-6;
  }

  get isEmpty(): boolean {
    return this.magAmmo <= 0;
  }

  get timeToNextShot(): number {
    return 0;
  }

  /** Consume one shot. Returns false if not allowed (caller plays dry-fire). */
  tryFire(now: number): boolean {
    if (!this.canFire(now)) return false;
    this.lastShotAt = now;
    this.magAmmo = Math.max(0, this.magAmmo - 1);
    this.bloom = Math.min(this.def.spreadMax, this.bloom + this.def.spreadShot);
    return true;
  }

  canReload(): boolean {
    if (this.reloading) return false;
    if (this.magAmmo >= this.def.magSize) return false;
    if (this.reserveAmmo <= 0) return false;
    return true;
  }

  startReload(now: number): boolean {
    if (!this.canReload()) return false;
    this.reloading = true;
    this.reloadEndsAt = now + this.def.reloadTime;
    return true;
  }

  cancelReload(): void {
    this.reloading = false;
  }

  /** Returns true on the frame the reload completes. */
  update(now: number, dt: number): boolean {
    // Bloom decay.
    this.bloom = Math.max(0, this.bloom - this.def.spreadShot * 2.4 * dt * 60 * 0.016 * 60 / 60);
    this.bloom = Math.max(0, this.bloom - dt * (this.def.spreadMax * 0.9 + 0.01));
    if (this.reloading && now >= this.reloadEndsAt) {
      const need = this.def.magSize - this.magAmmo;
      const take = Math.min(need, this.reserveAmmo);
      this.magAmmo += take;
      this.reserveAmmo -= take;
      this.reloading = false;
      return true;
    }
    return false;
  }

  refill(amount: number): void {
    this.reserveAmmo = clamp(this.reserveAmmo + amount, 0, this.def.maxReserve);
  }

  reset(): void {
    this.magAmmo = this.def.magSize;
    this.reserveAmmo = this.def.startReserve;
    this.bloom = 0;
    this.reloading = false;
    this.lastShotAt = -Infinity;
  }

  /** Test helper: force last-shot timestamp. */
  setLastShotAt(t: number): void {
    this.lastShotAt = t;
  }

  timeSinceShot(now: number): number {
    return now - this.lastShotAt;
  }
}
