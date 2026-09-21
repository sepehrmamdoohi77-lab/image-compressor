import { describe, it, expect } from 'vitest';
import {
  falloffMultiplier, armorReduction, computeDamage, zoneFromHeight,
  weaponDamage, grenadeFalloff,
} from '../combat/DamageSystem';
import { rayVsCharacter } from '../systems/CombatSystem';
import { WEAPONS } from '../data/config';

describe('distance falloff', () => {
  it('is 1.0 inside falloff start', () => {
    expect(falloffMultiplier(5, 10, 30, 0.5)).toBe(1);
    expect(falloffMultiplier(10, 10, 30, 0.5)).toBe(1);
  });
  it('is min multiplier at/past falloff end', () => {
    expect(falloffMultiplier(30, 10, 30, 0.5)).toBe(0.5);
    expect(falloffMultiplier(99, 10, 30, 0.5)).toBe(0.5);
  });
  it('interpolates linearly between', () => {
    expect(falloffMultiplier(20, 10, 30, 0.5)).toBeCloseTo(0.75, 5);
  });
});

describe('armor', () => {
  it('gives no reduction at zero armor', () => {
    expect(armorReduction(0)).toBe(0);
    expect(armorReduction(-5)).toBe(0);
  });
  it('scales up with armor but caps below 1', () => {
    const low = armorReduction(20);
    const high = armorReduction(200);
    expect(high).toBeGreaterThan(low);
    expect(high).toBeLessThanOrEqual(0.75);
    expect(armorReduction(1e6)).toBeLessThanOrEqual(0.75);
  });
});

describe('computeDamage', () => {
  const base = {
    baseDamage: 24, headshotMult: 2.0, zone: 'TORSO' as const,
    distance: 5, falloffStart: 16, falloffEnd: 38, minDamageMult: 0.55,
    armor: 0, armorDamageMult: 1,
  };
  it('deals full base damage to unarmored torso in range', () => {
    const r = computeDamage(base);
    expect(r.healthDamage).toBe(24);
  });
  it('applies headshot multiplier', () => {
    const r = computeDamage({ ...base, zone: 'HEAD' });
    expect(r.healthDamage).toBe(48);
  });
  it('applies limb multipliers', () => {
    expect(computeDamage({ ...base, zone: 'ARMS' }).healthDamage).toBe(18);
    expect(computeDamage({ ...base, zone: 'LEGS' }).healthDamage).toBe(16);
  });
  it('reduces damage at range', () => {
    const r = computeDamage({ ...base, distance: 100 });
    expect(r.healthDamage).toBe(Math.round(24 * 0.55));
  });
  it('armor mitigates health damage and damages armor pool', () => {
    const r = computeDamage({ ...base, armor: 60 });
    expect(r.healthDamage).toBeLessThan(24);
    expect(r.healthDamage).toBeGreaterThanOrEqual(1);
    expect(r.armorDamage).toBeGreaterThan(0);
  });
  it('never returns negative or NaN values', () => {
    const r = computeDamage({ ...base, armor: 1e6, distance: 1e6 });
    expect(Number.isFinite(r.healthDamage)).toBe(true);
    expect(Number.isFinite(r.armorDamage)).toBe(true);
    expect(r.healthDamage).toBeGreaterThanOrEqual(0);
    expect(r.armorDamage).toBeGreaterThanOrEqual(0);
  });
});

describe('zoneFromHeight', () => {
  it('classifies head / torso / arms / legs', () => {
    expect(zoneFromHeight(1.7, 0, 1.8, 0)).toBe('HEAD');
    expect(zoneFromHeight(1.3, 0, 1.8, 0)).toBe('TORSO');
    expect(zoneFromHeight(1.3, 0, 1.8, 0.5)).toBe('ARMS');
    expect(zoneFromHeight(0.4, 0, 1.8, 0)).toBe('LEGS');
  });
});

describe('weaponDamage integration', () => {
  it('DMR out-damages SMG at long range', () => {
    const dmr = weaponDamage(WEAPONS.dmr, 'TORSO', 30, 0);
    const smg = weaponDamage(WEAPONS.smg, 'TORSO', 30, 0);
    expect(dmr.healthDamage).toBeGreaterThan(smg.healthDamage);
  });
});

describe('grenadeFalloff', () => {
  it('is ~1 at center and 0 beyond radius', () => {
    expect(grenadeFalloff(0, 5.5)).toBeCloseTo(1, 2);
    expect(grenadeFalloff(5.5, 5.5)).toBe(0);
    expect(grenadeFalloff(99, 5.5)).toBe(0);
  });
  it('decreases monotonically', () => {
    const a = grenadeFalloff(1, 5.5);
    const b = grenadeFalloff(3, 5.5);
    const c = grenadeFalloff(5, 5.5);
    expect(a).toBeGreaterThan(b);
    expect(b).toBeGreaterThan(c);
  });
});

describe('rayVsCharacter', () => {
  const target = { x: 0, z: 10, feetY: 0, height: 1.8, radius: 0.36, armor: 0 };
  it('hits torso on a level chest shot', () => {
    const hit = rayVsCharacter(0, 1.3, 0, 0, 0, 1, 50, target);
    expect(hit).not.toBeNull();
    expect(hit?.zone).toBe('TORSO');
    expect(hit?.t).toBeCloseTo(10 - 0.36, 1);
  });
  it('hits head when aimed at head', () => {
    const hit = rayVsCharacter(0, 1.64, 0, 0, 0, 1, 50, target);
    expect(hit).not.toBeNull();
    expect(hit?.headshot).toBe(true);
  });
  it('misses when aimed beside the target', () => {
    const hit = rayVsCharacter(3, 1.3, 0, 0, 0, 1, 50, target);
    expect(hit).toBeNull();
  });
  it('misses over the head', () => {
    const hit = rayVsCharacter(0, 2.5, 0, 0, 0, 1, 50, target);
    expect(hit).toBeNull();
  });
  it('respects max range', () => {
    const hit = rayVsCharacter(0, 1.3, 0, 0, 0, 1, 5, target);
    expect(hit).toBeNull();
  });
  it('hits a crouched (short) target lower profile', () => {
    const crouch = { ...target, height: 1.15 };
    expect(rayVsCharacter(0, 1.0, 0, 0, 0, 1, 50, crouch)).not.toBeNull();
    expect(rayVsCharacter(0, 1.6, 0, 0, 0, 1, 50, crouch)).toBeNull();
  });
});
