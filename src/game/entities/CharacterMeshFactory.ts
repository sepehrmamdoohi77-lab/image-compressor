// Procedural tactical soldier rig (~1.8m). Modular: helmet, vest, pouches,
// backpack, two-bone arms, legs, weapon mount socket. Code-driven animation:
// idle / walk / run / aim / fire / reload / hit / death.
//
// Two-handed grip: when a weapon is mounted, a small numerical solver poses both
// arms (shoulder yaw/pitch/roll + elbow bend) so the trigger hand sits on the
// grip and the support hand lands on the weapon's own support point. That is why
// every weapon exports a `grip.support` point — rifles reach out on the
// handguard, the shotgun grabs the pump, the pistol wraps both hands.
import * as THREE from 'three';
import { type MaterialLib, type GeometryLib } from '../world/Materials';
import { clamp } from '../utils/math';

export interface RigAnimState {
  speed: number; // m/s
  aiming: boolean;
  firing: boolean;
  reloading: boolean;
  dead: boolean;
  crouch: boolean;
}

interface ArmPose {
  rx: number; ry: number; rz: number; ex: number;
}

const SHOULDER_Y = 0.5; // shoulder pivot height in torso space
const SHOULDER_X = 0.26;
const UPPER_LEN = 0.38;
const FORE_LEN = 0.42;
/** Weapon mount socket in torso space (right shoulder line, chest height). */
const MOUNT_POS = new THREE.Vector3(0.19, 0.26, 0.24);

// --- two-bone arm solver ---------------------------------------------------------
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _e = new THREE.Euler();
const _dir = new THREE.Vector3();
const _elbow = new THREE.Vector3();
const _hand = new THREE.Vector3();
const DOWN = new THREE.Vector3(0, -1, 0);

/**
 * Graded search for shoulder/elbow angles that put the hand on `target`, while
 * preferring a natural pose (elbow low, tucked, arm not locked straight).
 * Coarse sweep then two refinement passes — runs only when a weapon is mounted.
 */
function solveArm(side: -1 | 1, target: THREE.Vector3): ArmPose {
  const sx = SHOULDER_X * side;
  let best: ArmPose = { rx: -1.2, ry: 0, rz: 0, ex: -0.9 };
  let bestCost = Infinity;

  const evaluate = (rx: number, ry: number, rz: number, ex: number): number => {
    _e.set(rx, ry, rz, 'XYZ');
    _q.setFromEuler(_e);
    _elbow.copy(DOWN).applyQuaternion(_q).multiplyScalar(UPPER_LEN).add(_dir.set(sx, SHOULDER_Y, 0));
    _q2.setFromEuler(_e.set(ex, 0, 0, 'XYZ'));
    _q.multiply(_q2);
    _hand.copy(DOWN).applyQuaternion(_q).multiplyScalar(FORE_LEN).add(_elbow);
    let cost = _hand.distanceTo(target);
    // Elbow should hang below the shoulder, not float up beside the head.
    const shoulderY = SHOULDER_Y;
    if (_elbow.y > shoulderY - 0.08) cost += 0.5 * (_elbow.y - (shoulderY - 0.08));
    // Elbow should not swing behind the torso.
    if (_elbow.z < -0.1) cost += 0.4 * (-0.1 - _elbow.z);
    // Elbow should not flare far outside the shoulder line.
    const flare = Math.abs(_elbow.x) - (SHOULDER_X + 0.14);
    if (flare > 0) cost += 0.5 * flare;
    // Mild preference for a bend (locked-straight arms read as stiff).
    if (ex > -0.15) cost += 0.03 * (ex + 0.15);
    return cost;
  };

  const consider = (rx: number, ry: number, rz: number, ex: number): void => {
    const c = evaluate(rx, ry, rz, ex);
    if (c < bestCost) {
      bestCost = c;
      best = { rx, ry, rz, ex };
    }
  };

  for (let rx = -2.6; rx <= 0.4; rx += 0.3) {
    for (let ry = -1.5; ry <= 1.5; ry += 0.3) {
      for (let rz = -0.9; rz <= 0.9; rz += 0.3) {
        for (let ex = -2.4; ex <= 0; ex += 0.3) {
          consider(rx, ry, rz, ex);
        }
      }
    }
  }
  // Refine around the winner (two passes halve the error each time).
  for (let pass = 0; pass < 2; pass++) {
    const step = pass === 0 ? 0.15 : 0.06;
    const seed = best;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dz = -1; dz <= 1; dz++) {
          for (let de = -1; de <= 1; de++) {
            consider(
              seed.rx + dx * step, seed.ry + dy * step,
              seed.rz + dz * step, seed.ex + de * step,
            );
          }
        }
      }
    }
  }
  return best;
}

export class CharacterRig {
  root = new THREE.Group();
  body = new THREE.Group();
  torso = new THREE.Group();
  head = new THREE.Group();
  armL = new THREE.Group();
  armR = new THREE.Group();
  /** Elbow joints (children of the shoulders). */
  foreL = new THREE.Group();
  foreR = new THREE.Group();
  /** Hand markers — used for weapon grip verification and VFX sockets. */
  handL = new THREE.Object3D();
  handR = new THREE.Object3D();
  legL = new THREE.Group();
  legR = new THREE.Group();
  weaponMount = new THREE.Group();

  private poseL: ArmPose = { rx: -1.0, ry: 0.35, rz: 0, ex: -0.9 };
  private poseR: ArmPose = { rx: -1.15, ry: -0.25, rz: 0, ex: -0.9 };
  private walkPhase = 0;
  private fireKick = 0;
  private hitTimer = 0;
  private deathTimer = 0;
  private reloadDip = 0;
  private flashMats: THREE.MeshStandardMaterial[] = [];
  private baseEmissive: THREE.Color[] = [];
  private rngPhase = Math.random() * 10;

  constructor(
    _mats: MaterialLib,
    private geos: GeometryLib,
    opts: { uniform: number; vest: number; helmet: number; skin: number; accent: number },
  ) {
    this.build(opts);
    this.root.add(this.body);
    this.applyArmPose(0);
  }

  private mat(color: number, rough = 0.9): THREE.MeshStandardMaterial {
    const m = new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: 0.05 });
    this.flashMats.push(m);
    this.baseEmissive.push(m.emissive.clone());
    return m;
  }

  private box(
    parent: THREE.Object3D, material: THREE.Material,
    x: number, y: number, z: number, w: number, h: number, d: number,
  ): THREE.Mesh {
    const m = new THREE.Mesh(this.geos.box, material);
    m.position.set(x, y, z);
    m.scale.set(w, h, d);
    m.castShadow = true;
    parent.add(m);
    return m;
  }

  private build(o: { uniform: number; vest: number; helmet: number; skin: number; accent: number }): void {
    const uniform = this.mat(o.uniform);
    const vest = this.mat(o.vest, 0.85);
    const helmet = this.mat(o.helmet, 0.6);
    const skin = this.mat(o.skin, 0.7);
    const dark = this.mat(0x1e2023, 0.9);
    const accent = new THREE.MeshStandardMaterial({ color: o.accent, roughness: 0.7 });

    // Legs (hip pivots at y=0.92).
    for (const [leg, sx] of [[this.legL, -1], [this.legR, 1]] as const) {
      leg.position.set(0.13 * sx, 0.92, 0);
      this.body.add(leg);
      this.box(leg, uniform, 0, -0.45, 0, 0.17, 0.86, 0.2); // leg
      this.box(leg, dark, 0, -0.84, 0.05, 0.18, 0.12, 0.3); // boot
    }

    // Hips.
    this.box(this.body, uniform, 0, 0.98, 0, 0.36, 0.18, 0.24);
    this.box(this.body, dark, 0, 1.02, 0, 0.38, 0.08, 0.26); // belt

    // Torso group (pivot at waist for lean).
    this.torso.position.set(0, 1.06, 0);
    this.body.add(this.torso);
    this.box(this.torso, uniform, 0, 0.28, 0, 0.4, 0.56, 0.25); // chest
    this.box(this.torso, vest, 0, 0.28, 0.03, 0.44, 0.48, 0.28); // vest
    // Pouches.
    this.box(this.torso, vest, -0.11, 0.22, 0.19, 0.12, 0.14, 0.06);
    this.box(this.torso, vest, 0.11, 0.22, 0.19, 0.12, 0.14, 0.06);
    this.box(this.torso, vest, 0, 0.36, 0.19, 0.16, 0.1, 0.05);
    // Backpack.
    this.box(this.torso, vest, 0, 0.3, -0.2, 0.32, 0.42, 0.16);
    this.box(this.torso, dark, 0, 0.48, -0.2, 0.2, 0.1, 0.17); // bedroll
    // Shoulder accent (team identification readable from iso view).
    this.box(this.torso, accent, -0.24, 0.5, 0, 0.06, 0.1, 0.2);

    // Head group (pivot at neck).
    this.head.position.set(0, 0.62, 0);
    this.torso.add(this.head);
    const skull = new THREE.Mesh(this.geos.sphere, skin);
    skull.position.set(0, 0.12, 0.01);
    skull.scale.set(0.24, 0.26, 0.25);
    skull.castShadow = true;
    this.head.add(skull);
    // Helmet.
    const helm = new THREE.Mesh(this.geos.sphere, helmet);
    helm.position.set(0, 0.19, -0.01);
    helm.scale.set(0.3, 0.24, 0.31);
    helm.castShadow = true;
    this.head.add(helm);
    this.box(this.head, helmet, 0, 0.16, 0.12, 0.26, 0.06, 0.06); // brim
    this.box(this.head, dark, 0, 0.1, 0.14, 0.2, 0.07, 0.03); // goggles

    // Arms: shoulder -> upper arm -> elbow -> forearm -> glove.
    for (const [arm, fore, hand, sx] of [
      [this.armL, this.foreL, this.handL, -1],
      [this.armR, this.foreR, this.handR, 1],
    ] as const) {
      arm.position.set(SHOULDER_X * sx, SHOULDER_Y, 0);
      this.torso.add(arm);
      this.box(arm, uniform, 0, -UPPER_LEN / 2, 0, 0.135, UPPER_LEN, 0.15); // upper arm
      this.box(arm, uniform, 0, -UPPER_LEN + 0.03, 0, 0.14, 0.12, 0.16); // elbow pad
      fore.position.set(0, -UPPER_LEN, 0);
      arm.add(fore);
      this.box(fore, uniform, 0, -FORE_LEN / 2, 0, 0.12, FORE_LEN, 0.13); // forearm
      this.box(fore, skin, 0, -FORE_LEN, 0, 0.115, 0.13, 0.125); // glove
      hand.position.set(0, -FORE_LEN, 0);
      fore.add(hand);
    }

    // Weapon mount socket (grip point).
    this.weaponMount.position.copy(MOUNT_POS);
    this.torso.add(this.weaponMount);
  }

  /**
   * Attach a weapon and pose both hands on it. `support` is the weapon-local
   * point the support hand should hold (see WeaponMesh.buildWeaponMesh).
   */
  mountWeapon(weapon: THREE.Object3D, support: readonly [number, number, number] = [0, -0.02, 0.3]): void {
    this.weaponMount.add(weapon);
    // Trigger hand: just under the weapon's grip, at the mount point.
    const rightTarget = MOUNT_POS.clone().add(new THREE.Vector3(0, -0.03, 0.02));
    // Support hand: the weapon's own support point, expressed in torso space.
    const leftTarget = MOUNT_POS.clone().add(new THREE.Vector3(support[0], support[1], support[2]));
    this.poseR = solveArm(1, rightTarget);
    this.poseL = solveArm(-1, leftTarget);
    this.applyArmPose(0);
  }

  clearWeapon(): void {
    this.weaponMount.clear();
    // Ready stance with empty hands (weapon lowered, both elbows bent).
    this.poseR = { rx: -1.05, ry: -0.3, rz: 0, ex: -0.85 };
    this.poseL = { rx: -0.75, ry: 0.42, rz: 0, ex: -1.1 };
    this.applyArmPose(0);
  }

  /** Write the solved arm pose (plus procedural offsets) onto the arm bones. */
  private applyArmPose(reloadDip: number): void {
    const sway = Math.sin(performance.now() / 1000 * 1.7 + this.rngPhase) * 0.012;
    this.armR.rotation.set(this.poseR.rx + this.fireKick * 0.1, this.poseR.ry, this.poseR.rz);
    this.foreR.rotation.x = this.poseR.ex + this.fireKick * 0.14;
    // Reload: the support hand drops to the magazine well and comes back up.
    this.armL.rotation.set(
      this.poseL.rx + reloadDip * 0.55 + sway,
      this.poseL.ry - reloadDip * 0.35,
      this.poseL.rz,
    );
    this.foreL.rotation.x = this.poseL.ex + reloadDip * 1.15 + sway;
  }

  playFire(): void {
    this.fireKick = 1;
  }

  playHit(): void {
    this.hitTimer = 1;
  }

  /** Full pose reset (restart / return-to-menu): standing, no flash, no death. */
  reset(): void {
    this.walkPhase = 0;
    this.fireKick = 0;
    this.hitTimer = 0;
    this.deathTimer = 0;
    this.reloadDip = 0;
    this.body.rotation.set(0, 0, 0);
    this.body.position.set(0, 0, 0);
    this.applyFlash(0);
    this.applyArmPose(0);
  }

  update(dt: number, s: RigAnimState): void {
    const t = performance.now() / 1000 + this.rngPhase;
    this.fireKick = Math.max(0, this.fireKick - dt * 9);
    this.hitTimer = Math.max(0, this.hitTimer - dt * 5);

    if (s.dead) {
      this.deathTimer = Math.min(1, this.deathTimer + dt * 2.2);
      const e = 1 - Math.pow(1 - this.deathTimer, 3);
      this.body.rotation.x = -Math.PI / 2 * e;
      this.body.position.y = 0.25 * e;
      this.root.position.y = 0;
      this.applyFlash(0);
      return;
    }

    // Locomotion.
    const speedN = clamp(s.speed / 4.6, 0, 1.4);
    this.walkPhase += dt * (4 + speedN * 7) * (speedN > 0.05 ? 1 : 0);
    const swing = Math.sin(this.walkPhase) * 0.55 * Math.min(1, speedN);
    const crouchK = s.crouch ? 1 : 0;
    if (crouchK > 0) {
      // Bent-leg crouch pose with reduced stride.
      this.legL.rotation.x = -0.85 + swing * 0.4;
      this.legR.rotation.x = -0.55 - swing * 0.4;
    } else {
      this.legL.rotation.x = swing;
      this.legR.rotation.x = -swing;
    }
    const bob = Math.abs(Math.sin(this.walkPhase)) * 0.06 * Math.min(1, speedN);
    const breathe = Math.sin(t * 2.2) * 0.008;
    this.body.position.y = bob + breathe - crouchK * 0.42;

    // Torso: lean into run, crouch slightly when aiming.
    const leanTarget = speedN * 0.12 - (s.aiming ? 0.04 : 0);
    this.torso.rotation.x += (leanTarget - this.torso.rotation.x) * Math.min(1, dt * 8);
    this.torso.position.y = 1.06 - (s.aiming ? 0.05 : 0);

    // Arms: solved base pose + reload dip + fire kick.
    const dipTarget = s.reloading ? 1 : 0;
    this.reloadDip += (dipTarget - this.reloadDip) * Math.min(1, dt * 6);
    this.applyArmPose(this.reloadDip);

    // Fire kick on weapon mount (mostly recoil travel, minimal rotation so the
    // support hand stays on the weapon).
    this.weaponMount.position.z = MOUNT_POS.z - this.fireKick * 0.06;
    this.weaponMount.rotation.x = this.fireKick * 0.035;

    // Hit flash.
    this.applyFlash(this.hitTimer);
  }

  private applyFlash(amount: number): void {
    for (let i = 0; i < this.flashMats.length; i++) {
      const m = this.flashMats[i];
      const base = this.baseEmissive[i];
      m.emissive.setRGB(base.r + amount * 0.55, base.g + amount * 0.12, base.b + amount * 0.1);
    }
  }

  dispose(): void {
    this.flashMats.forEach((m) => m.dispose());
  }
}
