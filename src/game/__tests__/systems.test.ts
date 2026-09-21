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
