import { describe, it, expect } from 'vitest';
import { WeaponInstance, computeSpread, fireInterval, getWeaponDef } from '../weapons/Weapons';
import { WEAPONS } from '../data/config';

describe('weapon definitions', () => {
  it('has all five required weapons with sane values', () => {
    for (const id of ['rifle', 'smg', 'shotgun', 'dmr', 'pistol'] as const) {
      const d = getWeaponDef(id);
      expect(d.magSize).toBeGreaterThan(0);
      expect(d.rpm).toBeGreaterThan(0);
      expect(d.reloadTime).toBeGreaterThan(0);
      expect(d.damage).toBeGreaterThan(0);
      expect(d.pellets).toBeGreaterThanOrEqual(1);
    }
  });
  it('weapons feel different (not just damage)', () => {
    expect(WEAPONS.shotgun.pellets).toBeGreaterThan(1);
    expect(WEAPONS.smg.rpm).toBeGreaterThan(WEAPONS.rifle.rpm);
    expect(WEAPONS.dmr.spreadBase).toBeLessThan(WEAPONS.smg.spreadBase);
    expect(WEAPONS.dmr.fireMode).toBe('semi');
    expect(WEAPONS.rifle.fireMode).toBe('auto');
  });
  it('throws on unknown weapon id', () => {
    expect(() => getWeaponDef('nope' as never)).toThrow();
  });
});

describe('WeaponInstance fire rate', () => {
  it('enforces rpm interval', () => {
    const w = new WeaponInstance('rifle');
    const dt = fireInterval(w.def);
    expect(w.tryFire(0)).toBe(true);
    expect(w.tryFire(0)).toBe(false);
    expect(w.tryFire(dt * 0.5)).toBe(false);
    expect(w.tryFire(dt)).toBe(true);
  });
  it('consumes exactly one round per shot, never negative', () => {
    const w = new WeaponInstance('pistol');
    const start = w.magAmmo;
    w.tryFire(0);
    expect(w.magAmmo).toBe(start - 1);
    w.magAmmo = 1;
    expect(w.tryFire(10)).toBe(true);
    expect(w.magAmmo).toBe(0);
    expect(w.tryFire(20)).toBe(false);
    expect(w.magAmmo).toBe(0);
  });
});

describe('WeaponInstance reload', () => {
  it('reloads after reloadTime and transfers ammo correctly', () => {
    const w = new WeaponInstance('rifle');
    w.magAmmo = 10;
    w.reserveAmmo = 50;
    expect(w.startReload(0)).toBe(true);
    expect(w.reloading).toBe(true);
    expect(w.update(1.0, 1.0)).toBe(false); // not done yet
    expect(w.update(1.9, 0.9)).toBe(true); // completes
    expect(w.magAmmo).toBe(30);
    expect(w.reserveAmmo).toBe(30);
  });
  it('partial reload takes only what reserve has', () => {
    const w = new WeaponInstance('rifle');
    w.magAmmo = 25;
    w.reserveAmmo = 3;
    w.startReload(0);
    w.update(5, 5);
    expect(w.magAmmo).toBe(28);
    expect(w.reserveAmmo).toBe(0);
  });
  it('cannot reload when full, empty reserve, or already reloading', () => {
    const w = new WeaponInstance('rifle');
    expect(w.canReload()).toBe(false); // full
    w.magAmmo = 10;
    w.reserveAmmo = 0;
    expect(w.canReload()).toBe(false); // no reserve
    w.reserveAmmo = 30;
    expect(w.startReload(0)).toBe(true);
    expect(w.startReload(0)).toBe(false); // already reloading
  });
  it('cannot fire while reloading', () => {
    const w = new WeaponInstance('rifle');
    w.magAmmo = 10;
    w.startReload(0);
    expect(w.tryFire(0.5)).toBe(false);
  });
});

describe('computeSpread', () => {
  it('grows with movement and bloom, shrinks when aiming', () => {
    const d = WEAPONS.rifle;
    const still = computeSpread(d, { moving: false, aiming: false, bloom: 0 });
    const moving = computeSpread(d, { moving: true, aiming: false, bloom: 0 });
    const aiming = computeSpread(d, { moving: false, aiming: true, bloom: 0 });
    const hot = computeSpread(d, { moving: false, aiming: false, bloom: 0.05 });
    expect(moving).toBeGreaterThan(still);
    expect(aiming).toBeLessThan(still);
    expect(hot).toBeGreaterThan(still);
  });
  it('never exceeds spreadMax', () => {
    const d = WEAPONS.smg;
    expect(computeSpread(d, { moving: true, aiming: false, bloom: 99 })).toBeLessThanOrEqual(d.spreadMax);
  });
  it('DMR is more precise than SMG when still, worse on the move', () => {
    const dmrStill = computeSpread(WEAPONS.dmr, { moving: false, aiming: false, bloom: 0 });
    const smgStill = computeSpread(WEAPONS.smg, { moving: false, aiming: false, bloom: 0 });
    expect(dmrStill).toBeLessThan(smgStill);
  });
});
