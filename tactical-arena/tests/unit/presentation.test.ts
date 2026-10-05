import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { FootPlanner, solveTwoBone } from '../../src/game/Locomotion';
import { WeaponModel } from '../../src/game/WeaponModel';
import { Soldier } from '../../src/game/Soldier';
import { grenadePreview } from '../../src/game/GrenadeAim';
import { LocalPrediction } from '../../src/game/physics';
import {
  configSchema,
  mapSchema,
  playerSchema,
  transformSchema,
  type Transform,
  type WeaponId,
} from '../../src/multiplayer/protocol';
import fs from 'node:fs';
import path from 'node:path';
const data = path.resolve('../arena_server/data/maps');
const maps = fs
  .readdirSync(data)
  .filter((f) => f.endsWith('.json'))
  .map((f) => mapSchema.parse(JSON.parse(fs.readFileSync(path.join(data, f), 'utf8'))));
const config = configSchema.parse({
  protocolVersion: 3,
  stage: 4,
  mode: 'TEAM_DEATHMATCH',
  combatEnabled: true,
  tickHz: 30,
  snapshotHz: 15,
  maxPlayers: 8,
  reconnectGraceSeconds: 20,
  movement: { radius: 0.34, walkSpeed: 3.8, sprintSpeed: 5.8, inputTimeoutSeconds: 0.3 },
  defaultSettings: { teamSize: 4, timeLimitSeconds: 600 },
  map: maps.find((m) => m.id === 'courtyard'),
  maps,
  grenade: {
    fuseSeconds: 2.8,
    radius: 6.5,
    damage: 155,
    gravity: 9.8,
    throwSpeed: 12,
    quantity: 2,
    maxRange: 32,
    landingHeight: 0.09,
  },
});
const id = '00000000-0000-4000-8000-000000000001';
const info = playerSchema.parse({
  id,
  name: 'Operator',
  team: 'blue',
  connected: true,
  ready: true,
  status: 'ALIVE',
  latencyMs: 24,
});
const pose = (weapon: WeaponId = 'rifle'): Transform =>
  transformSchema.parse({
    id,
    x: 0,
    z: 18,
    yaw: 0,
    pitch: 0,
    vx: 0,
    vz: 0,
    movement: 'idle',
    ackSeq: -1,
    combat: {
      health: 100,
      armor: 65,
      slot: weapon === 'pistol' ? 2 : 1,
      weaponId: weapon,
      weaponState: 'EQUIPPED',
      magazine: 30,
      reserve: 90,
      reloadStartedAtMs: null,
      reloadEndsAtMs: null,
      readyAtMs: 0,
      deathAtMs: null,
      recoil: 0,
      bloom: 0,
      ads: false,
      crouch: false,
      grenades: 2,
      throwUntilMs: 0,
      protectedUntilMs: 0,
      respawnAtMs: null,
    },
  });

class Element {
  dataset: Record<string, string> = {};
  style: Record<string, string> = {};
  className = '';
  textContent = '';
  hidden = false;
  children: Element[] = [];
  classList = { toggle: vi.fn() };
  append(...elements: Element[]) {
    this.children.push(...elements);
  }
  remove() {}
}
beforeEach(() => vi.stubGlobal('document', { createElement: () => new Element() }));
afterEach(() => vi.unstubAllGlobals());

describe('physical map catalog and client prediction', () => {
  it('validates ten different complete server level definitions, not ten names', () => {
    expect(maps).toHaveLength(10);
    expect(
      new Set(
        maps.map((m) => JSON.stringify(m.obstacles.map((o) => [o.kind, o.x, o.z, o.w, o.d, o.h]))),
      ).size,
    ).toBe(10);
    for (const m of maps) {
      expect(m.spawns.blue).toHaveLength(4);
      expect(m.spawns.red).toHaveLength(4);
      expect(m.theme).toBeDefined();
    }
  });
  it('predicts destroyed cover using the selected room map and restores it next round', () => {
    const selected = maps.find((m) => m.id === 'outpost')!,
      crate = selected.obstacles.find((o) => o.kind === 'crate')!;
    const c = { ...config, map: selected },
      prediction = new LocalPrediction(c),
      p = { ...pose(), x: crate.x, z: crate.z + crate.d / 2 + c.movement.radius };
    prediction.world([], [], id);
    prediction.accept(p);
    prediction.step(1, { moveX: 0, moveZ: -1, aim: Math.PI, sprint: false }, 1 / 30);
    expect(prediction.pose!.z).toBeCloseTo(p.z);
    prediction.world([crate.id], [], id);
    prediction.accept({ ...p, ackSeq: 1 });
    prediction.step(2, { moveX: 0, moveZ: -1, aim: Math.PI, sprint: false }, 1 / 30);
    expect(prediction.pose!.z).toBeLessThan(p.z - 0.1);
    prediction.world([], [], id);
    prediction.accept({ ...p, ackSeq: 2 });
    prediction.step(3, { moveX: 0, moveZ: -1, aim: Math.PI, sprint: false }, 1 / 30);
    expect(prediction.pose!.z).toBeCloseTo(p.z);
  });
  it('does not move a dead actor or advance prediction for zero elapsed time', () => {
    const prediction = new LocalPrediction(config),
      p = pose();
    prediction.accept(p);
    prediction.step(1, { moveX: 1, moveZ: 0, aim: 0, sprint: false }, 0);
    expect(prediction.pose!.x).toBe(0);
    prediction.accept({ ...p, ackSeq: 1, combat: { ...p.combat!, health: 0 } });
    prediction.step(2, { moveX: 1, moveZ: 0, aim: 0, sprint: false }, 1 / 30);
    expect(prediction.pose!.x).toBe(0);
  });
});

describe('world-space gait and articulated limbs', () => {
  it('keeps feet stationary on the ground during consecutive stance frames', () => {
    const planner = new FootPlanner(),
      position = new THREE.Vector3();
    planner.reset(position, 0);
    let previous = planner.feet.map((f) => ({ position: f.position.clone(), planted: f.planted }));
    let checked = 0;
    for (let n = 0; n < 180; n++) {
      position.z += 3.8 / 60;
      const feet = planner.update(position, 0, 1 / 60, 0, false);
      feet.forEach((f, i) => {
        if (f.planted && previous[i]!.planted) {
          expect(f.position.distanceTo(previous[i]!.position)).toBeLessThan(1e-9);
          checked++;
        }
        if (f.planted) {
          const leg = solveTwoBone(
            new THREE.Vector3(i === 0 ? -0.145 : 0.145, 0.97, position.z),
            f.position,
            new THREE.Vector3(0, 0, 1),
            0.48,
            0.47,
          );
          expect(leg.end.distanceTo(f.position)).toBeLessThan(0.012);
          expect(f.position.y).toBeCloseTo(0.105);
        }
      });
      previous = feet.map((f) => ({ position: f.position.clone(), planted: f.planted }));
    }
    expect(checked).toBeGreaterThan(100);
  });
  it('advances by travelled distance, not render frame count or held movement state', () => {
    const run = (fps: number) => {
      const p = new FootPlanner(),
        x = new THREE.Vector3();
      p.reset(x, 0);
      for (let n = 0; n < fps; n++) {
        x.z += 3.8 / fps;
        p.update(x, 0, 1 / fps, 0, false);
      }
      return p;
    };
    expect(run(30).phase).toBeCloseTo(run(60).phase, 7);
    const p = run(60),
      phase = p.phase;
    for (let n = 0; n < 120; n++) p.update(new THREE.Vector3(0, 0, 3.8), 0, 1 / 60, 0, false);
    expect(p.phase).toBe(phase);
    expect(p.feet.every((f) => f.planted && f.position.y === 0.105)).toBe(true);
  });
  it('resets world-space plants on a genuine spawn discontinuity', () => {
    const p = new FootPlanner();
    p.reset(new THREE.Vector3(0, 0, 18), 0);
    p.update(new THREE.Vector3(4, 0, -18), Math.PI, 1 / 60, 0, false);
    for (const f of p.feet)
      expect(Math.hypot(f.position.x - 4, f.position.z + 18)).toBeLessThan(0.2);
  });
  it('solves normal, unreachable and zero-distance limbs without NaN or stretching', () => {
    const origin = new THREE.Vector3(0.3, 1.4, 0),
      pole = new THREE.Vector3(0, -1, 1);
    for (const goal of [
      new THREE.Vector3(0.1, 1.3, 0.36),
      new THREE.Vector3(10, 1, 8),
      origin.clone(),
    ]) {
      const r = solveTwoBone(origin, goal, pole, 0.3, 0.28);
      expect(r.joint.distanceTo(origin)).toBeCloseTo(0.3, 8);
      expect(r.end.distanceTo(r.joint)).toBeCloseTo(0.28, 8);
      expect([...r.end, ...r.joint].every(Number.isFinite)).toBe(true);
    }
  });
  it.each(['rifle', 'smg', 'shotgun', 'dmr', 'pistol'] as const)(
    'keeps both hands on the actual %s grips while aiming, crouching and strafing',
    (weapon) => {
      const soldier = new Soldier(info, false, new Element() as unknown as HTMLElement, 'blue');
      soldier.setCombatEnabled(true);
      for (let n = 0; n < 150; n++) {
        const p = pose(weapon);
        p.x = n * 0.02;
        p.yaw = 0.4;
        p.pitch = Math.sin(n * 0.08) * 0.55;
        p.movement = 'walk';
        p.combat!.ads = n > 30;
        p.combat!.crouch = n > 80;
        soldier.update(p, 1 / 60, 1000 + (n * 1000) / 60);
        expect(Number(soldier.label.dataset.handError)).toBeLessThan(0.035);
      }
      soldier.dispose();
    },
  );
  it('picking a real helmet targets its authoritative head zone rather than overshooting an accessory', () => {
    const soldier = new Soldier(info, false, new Element() as unknown as HTMLElement);
    soldier.update(pose(), 1 / 60, 1000);
    soldier.group.updateMatrixWorld(true);
    const ray = new THREE.Raycaster(new THREE.Vector3(0, 3, 18), new THREE.Vector3(0, -1, 0)),
      hits = ray.intersectObject(soldier.group, true);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]!.point.y).toBeLessThan(1.84);
    expect(soldier.aimTarget(hits[0]!)).toEqual({ x: 0, y: 1.65, z: 18 });
    soldier.dispose();
  });
  it('blends reload, throw, death and safe respawn without non-finite joints', () => {
    const soldier = new Soldier(info, false, new Element() as unknown as HTMLElement);
    soldier.setCombatEnabled(true);
    for (let n = 0; n < 240; n++) {
      const p = pose(),
        now = 1000 + (n * 1000) / 60;
      if (n < 90) {
        p.combat!.weaponState = 'RELOADING';
        p.combat!.reloadStartedAtMs = 1000;
        p.combat!.reloadEndsAtMs = 2500;
      } else if (n < 120) p.combat!.throwUntilMs = 3000;
      else if (n < 180) {
        p.combat!.health = 0;
        p.combat!.weaponState = 'DISABLED';
      } else {
        p.x = 8;
        p.z = -18;
      }
      soldier.update(p, 1 / 60, now);
      soldier.group.updateMatrixWorld(true);
      soldier.group.traverse((o) =>
        expect(o.matrixWorld.elements.every(Number.isFinite)).toBe(true),
      );
    }
    expect(soldier.position.x).toBe(8);
    expect(soldier.label.dataset.currentHealth).toBe('100');
    soldier.dispose();
  });
  it('does not smooth already-interpolated remote positions for a second time', () => {
    const s = new Soldier(info, false, new Element() as unknown as HTMLElement);
    s.update(pose(), 1 / 60);
    s.update({ ...pose(), x: 0.3 }, 1 / 60);
    expect(s.position.x).toBe(0.3);
    s.dispose();
  });
  it('keeps full blue/red uniforms distinct under every cosmetic', () => {
    const uniform = (team: 'blue' | 'red', cosmetic: 'olive' | 'slate' | 'sand') => {
      const s = new Soldier(
        { ...info, team, cosmetic },
        false,
        new Element() as unknown as HTMLElement,
        'blue',
      );
      let c = new THREE.Color();
      s.group.traverse((o) => {
        if (
          o instanceof THREE.Mesh &&
          !Array.isArray(o.material) &&
          o.material instanceof THREE.MeshStandardMaterial &&
          o.material.roughness === 0.96
        )
          c = o.material.color.clone();
      });
      s.dispose();
      return c.getHSL({ h: 0, s: 0, l: 0 });
    };
    for (const cosmetic of ['olive', 'slate', 'sand'] as const) {
      const blue = uniform('blue', cosmetic),
        red = uniform('red', cosmetic);
      expect(Math.abs(blue.h - red.h)).toBeGreaterThan(0.35);
      expect(blue.s).toBeGreaterThan(0.1);
      expect(red.s).toBeGreaterThan(0.1);
    }
  });
});

describe('firearm meshes and advisory targeting', () => {
  it('uses five different human-scale silhouettes with grip/muzzle anchors', () => {
    const sizes: string[] = [];
    for (const id of ['rifle', 'smg', 'shotgun', 'dmr', 'pistol'] as const) {
      const weapon = new WeaponModel(id);
      weapon.group.updateMatrixWorld(true);
      const bounds = new THREE.Box3().setFromObject(weapon.group),
        size = bounds.getSize(new THREE.Vector3());
      expect(size.z).toBeGreaterThan(0.2);
      expect(size.z).toBeLessThan(1.3);
      expect(weapon.rightGrip.z).toBeLessThan(weapon.muzzle.z);
      expect(weapon.leftGrip.z).toBeLessThan(weapon.muzzle.z);
      sizes.push(
        size
          .toArray()
          .map((v) => v.toFixed(3))
          .join(','),
      );
      weapon.dispose();
    }
    expect(new Set(sizes).size).toBe(5);
  });
  it('previews the same fixed-tick ground landing as the server on a clear path', () => {
    const p = { ...pose(), x: -13, z: 18 },
      target = { x: -13, z: 5 },
      preview = grenadePreview(config, p, target);
    expect(preview.reason).toBe('clear');
    const last = preview.points.at(-1)!;
    expect(last.x).toBeCloseTo(target.x, 7);
    expect(last.z).toBeCloseTo(target.z, 7);
    expect(last.y).toBeCloseTo(0.09, 7);
  });
  it('does not promise a landing inside the perimeter collision margin', () => {
    expect(grenadePreview(config, { ...pose(), x: 19, z: 18 }, { x: 21.91, z: 18 }).reason).toBe(
      'outside',
    );
  });
  it('warns about blocked cover, illegal range and targets outside the selected map', () => {
    const p = { ...pose(), x: -13, z: 18 };
    expect(grenadePreview(config, p, { x: -18.4, z: 9 }).reason).toBe('blocked');
    expect(grenadePreview(config, p, { x: 20, z: -18 }).reason).toBe('range');
    expect(grenadePreview(config, p, { x: 100, z: 0 }).reason).toBe('outside');
  });
});
