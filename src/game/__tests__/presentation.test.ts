// Presentation + feel regression suite: camera angle, danger telegraphing,
// enemy fallibility, per-weapon identity (shape + sound) and the two-handed
// weapon grip. These are the player-visible guarantees for this milestone.
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { AI, CAMERA_CONFIG, THREATS, WEAPONS, WEAPON_ORDER } from '../data/config';
import { createGeometries, createMaterials, createTextures } from '../world/Materials';
import { buildWeaponMesh } from '../entities/WeaponMeshFactory';
import { CharacterRig } from '../entities/CharacterMeshFactory';
import { TacticalCamera } from '../camera/TacticalCamera';
import { ThreatIndicator } from '../vfx/ThreatIndicator';
import { enemyMissChance, planEnemyShot, rayPointDistance, type EnemyShotInput } from '../combat/EnemyFire';

const mats = createMaterials(null);
const geos = createGeometries();

function rig(): CharacterRig {
  return new CharacterRig(mats, geos, {
    uniform: 0x4c5744, vest: 0x2e332a, helmet: 0x3a4034, skin: 0xb08a68, accent: 0x3fa7ff,
  });
}

describe('camera framing', () => {
  it('sits lower than the old 55° so hostiles read against the skyline', () => {
    expect(CAMERA_CONFIG.elevationDeg).toBeLessThan(55);
    expect(CAMERA_CONFIG.elevationDeg).toBeGreaterThanOrEqual(38);

    const cam = new TacticalCamera(16 / 9);
    cam.setTarget(0, 0, 0, true);
    cam.update(1 / 60);
    // sin(46°) * 21m ≈ 15.1m high (was ~17.2m at 55°).
    expect(cam.camera.position.y).toBeGreaterThan(11);
    expect(cam.camera.position.y).toBeLessThan(16.5);
    // Horizontal stand-off grew, which is what opens up the forward view.
    const flat = Math.hypot(cam.camera.position.x, cam.camera.position.z);
    expect(flat).toBeGreaterThan(Math.cos((55 * Math.PI) / 180) * CAMERA_CONFIG.distance);
  });
});

describe('weapon identity', () => {
  it('builds a distinct silhouette per weapon (no copy-paste guns)', () => {
    const counts = WEAPON_ORDER.map((id) => buildWeaponMesh(id, mats, geos).group.children.length);
    expect(new Set(counts).size).toBe(WEAPON_ORDER.length); // every gun differs
    for (const c of counts) expect(c).toBeGreaterThanOrEqual(10);
  });

  it('scales barrel length with the weapon class (pistol < SMG < rifle < DMR)', () => {
    const len = (id: (typeof WEAPON_ORDER)[number]): number =>
      buildWeaponMesh(id, mats, geos).grip.barrelLen;
    expect(len('pistol')).toBeLessThan(len('smg'));
    expect(len('smg')).toBeLessThan(len('rifle'));
    expect(len('rifle')).toBeLessThan(len('dmr'));
    // Shotguns are long but not marksman-long.
    expect(len('shotgun')).toBeGreaterThan(len('smg'));
  });

  it('gives every weapon its own acoustic profile', () => {
    const sigs = WEAPON_ORDER.map((id) => JSON.stringify(WEAPONS[id].sound));
    expect(new Set(sigs).size).toBe(WEAPON_ORDER.length);
    // Signature checks: the 12-gauge booms, the DMR echoes, the SMG snaps.
    expect(WEAPONS.shotgun.sound.big).toBe(true);
    expect(WEAPONS.shotgun.sound.crackFreq).toBeLessThan(WEAPONS.rifle.sound.crackFreq);
    expect(WEAPONS.smg.sound.crackFreq).toBeGreaterThan(WEAPONS.rifle.sound.crackFreq);
    expect(WEAPONS.smg.sound.duration).toBeLessThan(WEAPONS.rifle.sound.duration);
    expect(WEAPONS.dmr.sound.tail).toBeGreaterThan(WEAPONS.pistol.sound.tail);
    expect(WEAPONS.pistol.sound.duration).toBeLessThan(WEAPONS.rifle.sound.duration);
  });
});

describe('two-handed weapon grip', () => {
  it('places the support hand on each weapon\'s own grip point', () => {
    const handWorld = new THREE.Vector3();
    const supportWorld = new THREE.Vector3();
    for (const id of WEAPON_ORDER) {
      const r = rig();
      const mesh = buildWeaponMesh(id, mats, geos);
      r.mountWeapon(mesh.group, mesh.grip.support);
      r.update(1 / 60, { speed: 0, aiming: false, firing: false, reloading: false, dead: false, crouch: false });
      r.root.updateMatrixWorld(true);
      r.handL.getWorldPosition(handWorld);
      supportWorld.set(mesh.grip.support[0], mesh.grip.support[1], mesh.grip.support[2]);
      mesh.group.localToWorld(supportWorld);
      expect(handWorld.distanceTo(supportWorld)).toBeLessThan(0.09);
      // Trigger hand sits at the weapon grip (mount origin) too.
      r.handR.getWorldPosition(handWorld);
      supportWorld.set(0, 0, 0);
      mesh.group.localToWorld(supportWorld);
      expect(handWorld.distanceTo(supportWorld)).toBeLessThan(0.12);
    }
  });

  it('keeps both hands on the weapon while the soldier moves and fires', () => {
    const r = rig();
    const mesh = buildWeaponMesh('rifle', mats, geos);
    r.mountWeapon(mesh.group, mesh.grip.support);
    r.playFire();
    for (let i = 0; i < 30; i++) {
      r.update(1 / 60, { speed: 4.6, aiming: true, firing: true, reloading: false, dead: false, crouch: false });
      r.root.updateMatrixWorld(true);
    }
    const handWorld = new THREE.Vector3();
    const supportWorld = new THREE.Vector3(mesh.grip.support[0], mesh.grip.support[1], mesh.grip.support[2]);
    r.handL.getWorldPosition(handWorld);
    mesh.group.localToWorld(supportWorld);
    // Recoil travel is allowed, but the hand must stay on the weapon.
    expect(handWorld.distanceTo(supportWorld)).toBeLessThan(0.16);
  });

  it('drops the support hand during a reload and returns it afterwards', () => {
    const r = rig();
    const mesh = buildWeaponMesh('rifle', mats, geos);
    r.mountWeapon(mesh.group, mesh.grip.support);
    const supportWorld = new THREE.Vector3(...mesh.grip.support);
    const hand = new THREE.Vector3();
    const offset = (reloading: boolean): number => {
      for (let i = 0; i < 60; i++) {
        r.update(1 / 60, { speed: 0, aiming: false, firing: false, reloading, dead: false, crouch: false });
      }
      r.root.updateMatrixWorld(true);
      r.handL.getWorldPosition(hand);
      supportWorld.set(mesh.grip.support[0], mesh.grip.support[1], mesh.grip.support[2]);
      mesh.group.localToWorld(supportWorld);
      return hand.distanceTo(supportWorld);
    };
    const held = offset(false);
    const during = offset(true);
    expect(during).toBeGreaterThan(held + 0.05);
    expect(offset(false)).toBeLessThan(0.09);
  });
});

describe('enemy fallibility (they miss on purpose)', () => {
  const base: EnemyShotInput = {
    accuracy: 0.5, accuracyMult: 1, distance: 10, range: 40,
    playerMoving: false, playerSpeed: 0, playerCrouched: false,
    shooterMoving: false, reactionRecent: false, suppressed: false,
  };

  it('keeps misses in a fair band — never a coin flip, never perfect', () => {
    expect(enemyMissChance(base)).toBeGreaterThan(0.05);
    expect(enemyMissChance(base)).toBeLessThanOrEqual(0.35);
    expect(enemyMissChance({ ...base, playerMoving: true, playerSpeed: 4.6 }))
      .toBeGreaterThan(enemyMissChance(base));
    expect(enemyMissChance({ ...base, distance: 39 })).toBeGreaterThan(enemyMissChance(base));
    expect(enemyMissChance({ ...base, suppressed: true })).toBeGreaterThan(enemyMissChance(base));
    expect(enemyMissChance({ ...base, accuracy: 0.95 })).toBeLessThanOrEqual(0.35);
  });

  it('throws wide shots close to the player (visible near misses, not random noise)', () => {
    const miss = planEnemyShot(base, (() => { const s = [0, 0.75, 0.5, 0.9]; let i = 0; return () => s[Math.min(i++, 3)]; })());
    expect(miss.miss).toBe(true);
    expect(miss.lateral).toBeGreaterThan(0);
    expect(Math.abs(miss.lateral)).toBeLessThanOrEqual(AI.missLateral);
    expect(Math.abs(miss.vertical)).toBeLessThanOrEqual(AI.missVertical);
    // Wide shots must pass close enough to register as a near miss.
    expect(Math.abs(miss.lateral)).toBeLessThan(AI.nearMissRadius);

    const hit = planEnemyShot(base, () => 0.999);
    expect(hit.miss).toBe(false);
    expect(hit.lateral).toBe(0);
    expect(hit.vertical).toBe(0);
    expect(hit.aimError).toBeGreaterThan(0);
  });

  it('detects near misses along a shot line', () => {
    // Ray down +Z from the shooter: 0.9m to the side of a player at z=6 (plus
    // the 0.15m muzzle/chest height difference) -> ~0.91m, a near miss.
    const gap = rayPointDistance(0, 1.35, 0, 0, 0, 1, 0.9, 1.2, 6, 40);
    expect(gap).toBeGreaterThan(0.85);
    expect(gap).toBeLessThan(0.95);
    expect(gap).toBeLessThan(AI.nearMissRadius);
    // Behind the shooter, or stopped by a wall short of the player: not a near miss.
    expect(rayPointDistance(0, 1.35, 0, 0, 0, 1, 0.9, 1.2, -6, 40)).toBe(Infinity);
    expect(rayPointDistance(0, 1.35, 0, 0, 0, 1, 0.9, 1.2, 6, 3)).toBe(Infinity);
  });
});

describe('danger telegraphing (red line toward the threat)', () => {
  const camRight = new THREE.Vector3(1, 0, 0);
  const camFwd = new THREE.Vector3(0, 0, -1);

  it('stays dark when the area is clear', () => {
    const ti = new ThreatIndicator(new THREE.Scene());
    const r = ti.update(0.1, 0, 0, [], camRight, camFwd);
    expect(r.level).toBe(0);
    expect(r.count).toBe(0);
    expect(r.nearest).toBe(Infinity);
    expect(ti.visibleStreaks).toBe(0);
    ti.dispose();
  });

  it('lights up, draws one streak per threat and reports the bearing', () => {
    const ti = new ThreatIndicator(new THREE.Scene());
    const r = ti.update(0.1, 0, 0, [
      { id: 1, x: 0, z: -5, alive: true, confidence: 0.9 }, // straight ahead
      { id: 2, x: 6, z: 0, alive: true, confidence: 0.1 }, // to the right
      { id: 3, x: 0, z: 2, alive: false, confidence: 1 }, // corpse: ignored
      { id: 4, x: 0, z: 90, alive: true, confidence: 1 }, // far away: ignored
    ], camRight, camFwd);
    expect(r.count).toBe(2);
    expect(r.nearest).toBeCloseTo(5, 5);
    expect(r.level).toBeGreaterThan(0.5);
    expect(r.screenAngleDeg).toBeCloseTo(0, 4); // nearest is straight ahead
    expect(ti.visibleStreaks).toBe(2);

    // A threat on the right reports +90° on screen.
    const r2 = ti.update(0.1, 0, 0, [{ id: 5, x: 6, z: 0, alive: true, confidence: 1 }], camRight, camFwd);
    expect(r2.screenAngleDeg).toBeCloseTo(90, 4);

    // Fully dark again once nothing is close, and indicators are hidden.
    const r3 = ti.update(0.1, 0, 0, [], camRight, camFwd);
    expect(r3.level).toBe(0);
    expect(ti.visibleStreaks).toBe(0);
    ti.dispose();
  });

  it('threatens harder as hostiles close in', () => {
    const ti = new ThreatIndicator(new THREE.Scene());
    const far = ti.update(0.1, 0, 0, [{ id: 1, x: 0, z: 18, alive: true, confidence: 1 }], camRight, camFwd);
    const near = ti.update(0.1, 0, 0, [{ id: 1, x: 0, z: 5, alive: true, confidence: 1 }], camRight, camFwd);
    expect(near.level).toBeGreaterThan(far.level);
    expect(THREATS.radius).toBeGreaterThan(THREATS.hudCloseRadius);
    ti.dispose();
  });
});

describe('procedural graphics assets', () => {
  it('degrades gracefully without a 2D canvas (headless)', () => {
    expect(createTextures()).toBeNull();
    // Materials still build — flat, but never undefined.
    expect(mats.concrete.map).toBeNull();
    expect(mats.ground.roughness).toBeGreaterThan(0);
  });

  it('tessellates shared geometry finely enough for close-up props', () => {
    expect(geos.sphere.parameters.widthSegments).toBeGreaterThanOrEqual(16);
    expect(geos.cylinder.parameters.radialSegments).toBeGreaterThanOrEqual(12);
  });
});
