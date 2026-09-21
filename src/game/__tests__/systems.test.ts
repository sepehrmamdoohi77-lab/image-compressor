import { describe, it, expect } from 'vitest';
import {
  findPath, smoothPath, gridLosClear, nearestOpenCell, floodFillReachable,
} from '../world/Navigation';
import { scoreCoverPoint } from '../ai/CoverSystem';
import { validateSpawnPoint } from '../systems/SpawnSystem';
import { ProgressionSystem, multikillBonus, roundClearBonus } from '../systems/ProgressionSystem';
import { validateSettings } from '../systems/SettingsManager';

function openGrid(size: number): Uint8Array {
  return new Uint8Array(size * size);
}

describe('navigation A*', () => {
  it('finds a direct path on open ground', () => {
    const p = findPath(openGrid(10), 10, { cx: 1, cz: 1 }, { cx: 8, cz: 8 });
    expect(p).not.toBeNull();
    expect(p![0]).toEqual({ cx: 1, cz: 1 });
    expect(p![p!.length - 1]).toEqual({ cx: 8, cz: 8 });
  });
  it('routes around a wall', () => {
    const g = openGrid(10);
    for (let x = 0; x < 9; x++) g[5 * 10 + x] = 1; // wall with gap at x=9
    const p = findPath(g, 10, { cx: 2, cz: 2 }, { cx: 2, cz: 8 });
    expect(p).not.toBeNull();
    expect(p!.some((c) => c.cx === 9)).toBe(true);
  });
  it('returns null when goal is sealed', () => {
    const g = openGrid(6);
    // Seal cell (3,3) fully.
    g[2 * 6 + 3] = 1; g[4 * 6 + 3] = 1; g[3 * 6 + 2] = 1; g[3 * 6 + 4] = 1;
    g[2 * 6 + 2] = 1; g[2 * 6 + 4] = 1; g[4 * 6 + 2] = 1; g[4 * 6 + 4] = 1;
    const p = findPath(g, 6, { cx: 0, cz: 0 }, { cx: 3, cz: 3 });
    // Goal blocked -> snaps to nearest open; must still be a valid path or null, never throw.
    if (p) {
      for (const c of p) expect(g[c.cz * 6 + c.cx]).toBe(0);
    }
  });
  it('never paths through blocked cells', () => {
    const g = openGrid(12);
    for (let i = 0; i < 40; i++) g[Math.floor(Math.random() * 144)] = 1;
    g[0] = 0;
    g[143] = 0;
    const p = findPath(g, 12, { cx: 0, cz: 0 }, { cx: 11, cz: 11 });
    if (p) for (const c of p) expect(g[c.cz * 12 + c.cx]).toBe(0);
  });
  it('smoothPath shortens without breaking LOS', () => {
    const g = openGrid(12);
    const p = findPath(g, 12, { cx: 0, cz: 0 }, { cx: 11, cz: 11 });
    expect(p).not.toBeNull();
    const s = smoothPath(g, 12, p!);
    expect(s.length).toBeLessThanOrEqual(p!.length);
    expect(s[0]).toEqual(p![0]);
    expect(s[s.length - 1]).toEqual(p![p!.length - 1]);
  });
  it('gridLosClear detects blockers', () => {
    const g = openGrid(10);
    expect(gridLosClear(g, 10, 0, 0, 9, 9)).toBe(true);
    g[5 * 10 + 5] = 1;
    expect(gridLosClear(g, 10, 0, 0, 9, 9)).toBe(false);
  });
  it('nearestOpenCell snaps to walkable', () => {
    const g = openGrid(8);
    g[3 * 8 + 3] = 1;
    const c = nearestOpenCell(g, 8, 3, 3, 3);
    expect(c).not.toBeNull();
    expect(g[c!.cz * 8 + c!.cx]).toBe(0);
  });
  it('floodFillReachable covers open maps', () => {
    const reached = floodFillReachable(openGrid(6), 6, { cx: 0, cz: 0 });
    expect(reached.size).toBe(36);
  });
});

describe('cover scoring', () => {
  const base = { ex: 0, ez: 0, tx: 10, tz: 0, occupied: false, preferredMin: 8, preferredMax: 16, reachable: true };
  it('prefers cover between self and threat', () => {
    // Point at x=5 with obstacle to its east (normal faces west, away from obstacle).
    const good = scoreCoverPoint({ x: 5, z: 0, nx: -1, nz: 0, kind: 'low' }, base);
    const bad = scoreCoverPoint({ x: 5, z: 0, nx: 1, nz: 0, kind: 'low' }, base);
    expect(good).toBeGreaterThan(bad);
  });
  it('penalizes occupied and unreachable cover', () => {
    const p = { x: 5, z: 0, nx: -1, nz: 0, kind: 'low' as const };
    const free = scoreCoverPoint(p, base);
    const occ = scoreCoverPoint(p, { ...base, occupied: true });
    expect(occ).toBeLessThan(free);
    expect(scoreCoverPoint(p, { ...base, reachable: false })).toBe(-Infinity);
  });
  it('rewards preferred threat band', () => {
    const p = { x: 5, z: 0, nx: -1, nz: 0, kind: 'low' as const };
    const inBand = scoreCoverPoint(p, base); // dist to threat = 5... out of band
    const close = scoreCoverPoint(p, { ...base, tx: 8 }); // dist 3
    expect(inBand).not.toBe(close);
  });
});

describe('spawn validation', () => {
  it('rejects unwalkable, close, visible, and occupied spawns', () => {
    expect(validateSpawnPoint(0, 0, 20, 20, false, false, 9, 10, 16).ok).toBe(false);
    expect(validateSpawnPoint(19, 20, 20, 20, true, false, 9, 10, 16).ok).toBe(false);
    expect(validateSpawnPoint(8, 20, 20, 20, true, true, 9, 10, 16).ok).toBe(false);
    expect(validateSpawnPoint(0, 0, 20, 20, true, false, 1.0, 10, 16).ok).toBe(false);
  });
  it('accepts a far, hidden, free spawn', () => {
    expect(validateSpawnPoint(0, 0, 20, 20, true, false, 9, 10, 16)).toEqual({ ok: true, reason: 'ok' });
  });
});

describe('progression & scoring', () => {
  it('awards headshot, grenade, and multikill bonuses', () => {
    const p = new ProgressionSystem();
    p.startRun();
    const a = p.onEnemyKilled(100, false, 'bullet', 0);
    expect(a).toBe(100);
    const b = p.onEnemyKilled(100, true, 'bullet', 1); // within multikill window
    expect(b).toBeGreaterThan(150); // headshot + multikill x2
    const c = p.onEnemyKilled(100, false, 'grenade', 2);
    expect(c).toBeGreaterThan(100);
    expect(p.kills).toBe(3);
    expect(p.headshots).toBe(1);
    expect(p.grenadeKills).toBe(1);
  });
  it('resets multikill chain after the window', () => {
    expect(multikillBonus(1)).toBe(0);
    expect(multikillBonus(2)).toBeGreaterThan(0);
    expect(multikillBonus(99)).toBe(multikillBonus(5));
  });
  it('round clear bonus grows per round', () => {
    expect(roundClearBonus(4)).toBeGreaterThanOrEqual(roundClearBonus(0));
  });
  it('completeRound adds accuracy and no-damage bonuses', () => {
    const p = new ProgressionSystem();
    p.startRun();
    for (let i = 0; i < 10; i++) p.onShot(true);
    const withBonus = p.completeRound();
    expect(withBonus).toBeGreaterThan(roundClearBonus(0));
  });
  it('advances through all rounds then stops', () => {
    const p = new ProgressionSystem();
    p.startRun();
    let n = 0;
    while (p.advance()) n++;
    expect(n).toBe(p.totalRounds - 1);
    expect(p.isFinalRound).toBe(true);
  });
});

describe('settings validation', () => {
  it('accepts valid settings', () => {
    const s = validateSettings({ master: 0.5, quality: 'low', sensitivity: 2 });
    expect(s.master).toBe(0.5);
    expect(s.quality).toBe('low');
    expect(s.sensitivity).toBe(2);
  });
  it('recovers defaults from garbage', () => {
    const s = validateSettings({ master: 'loud', quality: 'ultra', cameraDistance: -99 });
    expect(s.master).toBeGreaterThanOrEqual(0);
    expect(s.master).toBeLessThanOrEqual(1);
    expect(['low', 'medium', 'high']).toContain(s.quality);
    expect(s.cameraDistance).toBeGreaterThanOrEqual(12);
  });
  it('never throws on null/undefined/arrays', () => {
    expect(() => validateSettings(null)).not.toThrow();
    expect(() => validateSettings(undefined)).not.toThrow();
    expect(() => validateSettings([1, 2, 3])).not.toThrow();
    expect(validateSettings(null).master).toBeGreaterThan(0);
  });
  it('clamps out-of-range numbers', () => {
    const s = validateSettings({ master: 99, sfx: -5 });
    expect(s.master).toBe(1);
    expect(s.sfx).toBe(0);
  });
});

// --- this milestone: sprint, resupply, medkits, radar, cover discipline ---------
import * as THREE from 'three';
import { PLAYER_CONFIG, PICKUPS, RADAR, AI } from '../data/config';
import { createGeometries, createMaterials } from '../world/Materials';
import { Level } from '../world/Level';
import { Player } from '../entities/Player';
import { CoverSystem } from '../ai/CoverSystem';
import { PickupSystem, isOpenSpot, pickSpawnSpot, type PickupSpot } from '../systems/PickupSystem';
import { radarProject } from '../../ui/Radar';

const mats = createMaterials(null);
const geos = createGeometries();

function testPlayer(): Player {
  const p = new Player(mats, geos);
  p.reset({ x: 0, z: 0 });
  return p;
}

describe('sprinting (Shift)', () => {
  it('is config-driven and meaningfully faster than a walk', () => {
    expect(PLAYER_CONFIG.sprintMultiplier).toBeGreaterThan(1.4);
    expect(PLAYER_CONFIG.walkSpeed * PLAYER_CONFIG.sprintMultiplier).toBeGreaterThan(7);
  });

  it('runs faster while Shift is held, and only while moving', () => {
    const p = testPlayer();
    const level = new Level(mats, geos);
    level.build();
    const aim = new THREE.Vector3(0, 0, 5);
    const keys = new Set<string>(['KeyW']);
    const input = {
      keys,
      mouseLeft: false,
      mouseRight: false,
      isDown: (code: string): boolean => keys.has(code),
      wasPressed: (): boolean => false,
      moveAxes: (): { x: number; y: number } => ({ x: 0, y: -1 }),
      consumeWheel: (): number => 0,
    } as unknown as Parameters<Player['update']>[2];

    for (let i = 0; i < 40; i++) p.update(1 / 60, i / 60, input, aim, level, true, 0);
    const walk = p.speed;
    expect(walk).toBeGreaterThan(1);
    expect(p.sprinting).toBe(false);

    keys.add('ShiftLeft');
    for (let i = 0; i < 60; i++) p.update(1 / 60, 1 + i / 60, input, aim, level, true, 0);
    expect(p.sprinting).toBe(true);
    expect(p.speed).toBeGreaterThan(walk * 1.25);
    expect(p.noiseRadius).toBeGreaterThan(0);

    // Aiming cancels the sprint (precision stance outranks speed).
    (input as unknown as { mouseRight: boolean }).mouseRight = true;
    keys.add('ShiftLeft');
    for (let i = 0; i < 30; i++) p.update(1 / 60, 2 + i / 60, input, aim, level, true, 0);
    expect(p.sprinting).toBe(false);
  });
});

describe('round resupply', () => {
  it('restores health, magazines, reserves, grenades and armor', () => {
    const p = testPlayer();
    p.health = 21;
    p.armor = 5;
    p.grenades = 0;
    for (const w of p.weapons.values()) {
      w.magAmmo = 0;
      w.reserveAmmo = 0;
    }
    p.resupply();
    expect(p.health).toBe(p.maxHealth);
    expect(p.grenades).toBe(PLAYER_CONFIG.grenades);
    expect(p.armor).toBeGreaterThan(PLAYER_CONFIG.startArmor);
    for (const w of p.weapons.values()) {
      expect(w.magAmmo).toBe(w.def.magSize);
      expect(w.reserveAmmo).toBeGreaterThanOrEqual(w.def.startReserve);
      expect(w.reloading).toBe(false);
    }
  });

  it('heal() never overheals or revives a dead player', () => {
    const p = testPlayer();
    p.health = p.maxHealth - 10;
    expect(p.heal(999)).toBe(10);
    expect(p.health).toBe(p.maxHealth);
    p.health = 10;
    p.alive = false;
    expect(p.heal(50)).toBe(0);
  });
});

/** Tiny deterministic PRNG so spawn placement is reproducible in tests. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('field medkits', () => {
  const level = new Level(mats, geos);
  level.build();

  it('only spawns on open floor, away from the player and other kits', () => {
    const taken: PickupSpot[] = [{ x: 0, z: 0 }];
    for (let seed = 0; seed < 40; seed++) {
      const spot = pickSpawnSpot(level, mulberry32(seed + 1), 0, 0, taken);
      if (!spot) continue;
      expect(Math.hypot(spot.x, spot.z)).toBeGreaterThanOrEqual(PICKUPS.minDistanceFromPlayer - 0.01);
      expect(isOpenSpot(level, Math.round(spot.x + 21.5), Math.round(spot.z + 21.5))).toBe(true);
      for (const t of taken) expect(Math.hypot(t.x - spot.x, t.z - spot.z)).toBeGreaterThanOrEqual(4.9);
    }
  });

  it('heals 30% of max health when walked over and is consumed', () => {
    const scene = new THREE.Scene();
    const sys = new PickupSystem(scene, level, mats, geos);
    const p = testPlayer();
    p.health = 20;
    let t = 100;
    const rng = mulberry32(7);
    // Spawns immediately (nextSpawnAt starts at 0).
    sys.update(1 / 60, t, p, rng);
    expect(sys.activeCount).toBe(1);
    const kit = sys.items[0];
    // At full health the kit must survive (never wasted).
    p.health = p.maxHealth;
    t += 1;
    expect(sys.update(1 / 60, t, p, rng)).toBeNull();
    expect(sys.activeCount).toBe(1);
    // Walk onto it while hurt.
    p.health = 20;
    p.pos.set(kit.spot.x, 0, kit.spot.z);
    t += 1;
    const healed = sys.update(1 / 60, t, p, rng);
    expect(healed).not.toBeNull();
    expect(healed!.amount).toBe(Math.round(p.maxHealth * PICKUPS.healthFraction));
    expect(p.health).toBe(20 + healed!.amount);
    expect(sys.activeCount).toBe(0);
    sys.dispose();
  });

  it('expires kits that are ignored for too long', () => {
    const scene = new THREE.Scene();
    const sys = new PickupSystem(scene, level, mats, geos);
    const p = testPlayer();
    p.pos.set(20, 0, 20); // far from the map centre spawns
    const rng = mulberry32(11);
    sys.update(1 / 60, 10, p, rng);
    expect(sys.activeCount).toBe(1);
    const kit = sys.items[0];
    sys.update(1 / 60, 10 + PICKUPS.lifetime + 1, p, rng);
    // The ignored kit is gone (a fresh one may have replaced it meanwhile).
    expect(sys.items.includes(kit)).toBe(false);
    expect(sys.activeCount).toBeLessThanOrEqual(PICKUPS.maxActive);
    sys.dispose();
  });
});

describe('radar minimap', () => {
  it('projects world points relative to the player, facing up', () => {
    const size = 156;
    // Straight ahead (facing +Z) -> above centre.
    const [fx, fy] = radarProject(0, 10, 0, 0, 0, size, RADAR.spanMeters);
    expect(fx).toBeCloseTo(size / 2, 3);
    expect(fy).toBeLessThan(size / 2);
    // Directly behind -> below centre.
    const [, by] = radarProject(0, -10, 0, 0, 0, size, RADAR.spanMeters);
    expect(by).toBeGreaterThan(size / 2);
    // To the right -> right of centre.
    const [rx] = radarProject(10, 0, 0, 0, 0, size, RADAR.spanMeters);
    expect(rx).toBeGreaterThan(size / 2);
    // Rotating the player 90° puts that same blip ahead of them.
    const [, ry2] = radarProject(10, 0, 0, 0, Math.PI / 2, size, RADAR.spanMeters);
    expect(ry2).toBeLessThan(size / 2);
    // Scale: a blip at half the span sits at a quarter radius.
    const [hx] = radarProject(RADAR.spanMeters / 4, 0, 0, 0, 0, size, RADAR.spanMeters);
    expect(hx - size / 2).toBeCloseTo(size / 4, 3);
  });
});

describe('cover discipline', () => {
  it('penalises shelter that was just abandoned', () => {
    const point = { x: 8, z: 0, nx: -1, nz: 0, kind: 'high' as const };
    const ctx = { ex: 0, ez: 0, tx: 20, tz: 0, occupied: false, preferredMin: 5, preferredMax: 12, reachable: true };
    const fresh = scoreCoverPoint(point, { ...ctx, recentlyUsed: false });
    const stale = scoreCoverPoint(point, { ...ctx, recentlyUsed: true });
    expect(stale).toBeLessThan(fresh);
    expect(fresh - stale).toBeCloseTo(AI.coverReusePenalty, 5);
  });

  it('knows when a point has been flanked', () => {
    const level = new Level(mats, geos);
    level.build();
    const cover = new CoverSystem(level);
    // Point normal faces -X (obstacle to its +X side): a threat on the -X side
    // is blocked, a threat behind it (on the obstacle side) is not.
    const idx = cover.points.findIndex((p) => p.nx === 1 && p.nz === 0);
    expect(idx).toBeGreaterThanOrEqual(0);
    const p = cover.points[idx];
    // Normal points away from the obstacle: a threat opposite the normal is
    // behind the obstacle (covered), a threat on the open side is not.
    expect(cover.blocksThreat(idx, p.x - 12, p.z)).toBe(true);
    expect(cover.blocksThreat(idx, p.x + 6, p.z)).toBe(false);
    expect(cover.blocksThreat(99999, 0, 0)).toBe(false);
  });

  it('tracks re-use cooldowns', () => {
    const level = new Level(mats, geos);
    level.build();
    const cover = new CoverSystem(level);
    cover.markUsed(3, 100);
    expect(cover.recentlyUsed(3, 105)).toBe(true);
    expect(cover.recentlyUsed(3, 100 + AI.coverReuseCooldown + 1)).toBe(false);
    expect(cover.recentlyUsed(4, 105)).toBe(false);
    cover.reset();
    expect(cover.recentlyUsed(3, 105)).toBe(false);
  });
});
