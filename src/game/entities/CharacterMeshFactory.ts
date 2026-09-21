// Procedural tactical soldier rig (~1.8m). Modular: helmet, vest, pouches,
// backpack, two-bone arms, three-segment legs (thigh/shin/foot), weapon mount.
//
// Animation is fully code-driven and state-blended:
//   idle breathing + weight shift · walk/run gait with knee bend and arm swing ·
//   sprint carry (weapon lowered, long stride, forward lean) · aim settle ·
//   reload · hit flinch · cover lean · multi-stage collapse on death.
//
// Two-handed grip: when a weapon is mounted, a small numerical solver poses both
// arms (shoulder yaw/pitch/roll + elbow bend) so the trigger hand sits on the
// grip and the support hand lands on the weapon's own support point.
import * as THREE from 'three';
import { type MaterialLib, type GeometryLib } from '../world/Materials';
import { clamp } from '../utils/math';

export interface RigOptions {
  uniform: number; vest: number; helmet: number; skin: number; accent: number;
  /** Optional fabric detail map (multiplied by the uniform/vest tint). */
  camo?: THREE.Texture | null;
}

export interface RigAnimState {
  speed: number; // m/s
  /** 0..1: how much the soldier is hurrying (drives stride + carry pose). */
  sprint: number;
  aiming: boolean;
  firing: boolean;
  reloading: boolean;
  dead: boolean;
  crouch: boolean;
  /** -1..1 body lean sideways (peeking from cover). */
  lean: number;
  /** Yaw rate (rad/s) so the body banks into turns. */
  turnRate: number;
}

/** Hit reaction impulse (0..1), separate so callers can trigger it directly. */
interface FallState {
  active: boolean;
  timer: number;
  /** Fall direction: 0 = straight back, ±1 = rolled to a side. */
  roll: number;
  /** Impact direction in local space (radians offset). */
  yaw: number;
}

interface ArmPose {
  rx: number; ry: number; rz: number; ex: number;
}

const SHOULDER_Y = 0.5; // shoulder pivot height in torso space
const SHOULDER_X = 0.26;
const UPPER_LEN = 0.38;
const FORE_LEN = 0.42;
const THIGH_LEN = 0.5;
const SHIN_LEN = 0.42;
/** Weapon mount socket in torso space (right shoulder line, chest height). */
const MOUNT_POS = new THREE.Vector3(0.19, 0.26, 0.24);

// --- two-bone arm solver ---------------------------------------------------------
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _e = new THREE.Euler();
const _chain = new THREE.Vector3();
const _elbow = new THREE.Vector3();
const _hand = new THREE.Vector3();
const _target = new THREE.Vector3();
const _carryPos = new THREE.Vector3();
const _support = new THREE.Vector3();
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
    _elbow.copy(DOWN).applyQuaternion(_q).multiplyScalar(UPPER_LEN).add(_chain.set(sx, SHOULDER_Y, 0));
    _q2.setFromEuler(_e.set(ex, 0, 0, 'XYZ'));
    _q.multiply(_q2);
    _hand.copy(DOWN).applyQuaternion(_q).multiplyScalar(FORE_LEN).add(_elbow);
    let cost = _hand.distanceTo(target);
    // Elbow should hang below the shoulder, not float up beside the head.
    if (_elbow.y > SHOULDER_Y - 0.08) cost += 0.5 * (_elbow.y - (SHOULDER_Y - 0.08));
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
  for (let pass = 0; pass < 2; pass++) {
    const step = pass === 0 ? 0.15 : 0.06;
    const seed = best;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dz = -1; dz <= 1; dz++) {
          for (let de = -1; de <= 1; de++) {
            consider(seed.rx + dx * step, seed.ry + dy * step, seed.rz + dz * step, seed.ex + de * step);
          }
        }
      }
    }
  }
  return best;
}

/** Blend a solved arm pose toward an override pose (low-ready, reload, death). */
function blendPose(a: ArmPose, b: ArmPose, t: number): ArmPose {
  const k = clamp(t, 0, 1);
  return {
    rx: a.rx + (b.rx - a.rx) * k,
    ry: a.ry + (b.ry - a.ry) * k,
    rz: a.rz + (b.rz - a.rz) * k,
    ex: a.ex + (b.ex - a.ex) * k,
  };
}

/** Sprint carry: the whole weapon dips and angles down across the body. */
const CARRY_DIP = new THREE.Vector3(0, -0.07, -0.03);
const CARRY_ROT = new THREE.Euler(0.3, 0, 0.18);
const RELOAD_L: ArmPose = { rx: -0.15, ry: 0.15, rz: 0.05, ex: -1.9 };
const RELOAD_R: ArmPose = { rx: -0.95, ry: -0.42, rz: -0.05, ex: -1.05 };
const DEATH_R: ArmPose = { rx: 0.55, ry: -0.5, rz: -0.35, ex: -0.5 };
const DEATH_L: ArmPose = { rx: 0.7, ry: 0.55, rz: 0.3, ex: -0.35 };

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
  /** Knee joints (children of the hips). */
  shinL = new THREE.Group();
  shinR = new THREE.Group();
  weaponMount = new THREE.Group();

  private poseL: ArmPose = { rx: -1.0, ry: 0.35, rz: 0, ex: -0.9 };
  private poseR: ArmPose = { rx: -1.15, ry: -0.25, rz: 0, ex: -0.9 };
  /** Same grip, solved against the lowered sprint-carry weapon transform. */
  private poseLCarry: ArmPose = { rx: -0.9, ry: 0.3, rz: 0, ex: -1.0 };
  private poseRCarry: ArmPose = { rx: -1.0, ry: -0.2, rz: 0, ex: -1.0 };
  private gait = 0; // 0..2π stride phase
  private fireKick = 0;
  private hitTimer = 0;
  private reloadDip = 0;
  private leanSmooth = 0;
  private sprintBlend = 0;
  private crouchBlend = 0;
  private aimBlend = 0;
  private flashMats: THREE.MeshStandardMaterial[] = [];
  private baseEmissive: THREE.Color[] = [];
  private fall: FallState = { active: false, timer: 0, roll: 0, yaw: 0 };
  private rngPhase = Math.random() * 10;

  constructor(
    _mats: MaterialLib,
    private geos: GeometryLib,
    opts: RigOptions,
  ) {
    this.build(opts);
    this.root.add(this.body);
    this.applyArmPose(0);
  }

  private mat(color: number, rough = 0.9, map: THREE.Texture | null = null): THREE.MeshStandardMaterial {
    const m = new THREE.MeshStandardMaterial({
      color, roughness: rough, metalness: 0.05,
      map,
      bumpMap: map,
      bumpScale: map ? 0.005 : 0,
    });
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

  private build(o: RigOptions): void {
    // Camo weave on fabric only — skin, rubber and metal stay smooth.
    const fabric = o.camo ?? null;
    const uniform = this.mat(o.uniform, 0.9, fabric);
    const vest = this.mat(o.vest, 0.85, fabric);
    const helmet = this.mat(o.helmet, 0.6, fabric);
    const skin = this.mat(o.skin, 0.7);
    const dark = this.mat(0x1e2023, 0.9);
    const accent = new THREE.MeshStandardMaterial({ color: o.accent, roughness: 0.7 });

    // Legs: hip -> thigh -> knee -> shin -> boot (real knee bend).
    for (const [leg, shin, sx] of [
      [this.legL, this.shinL, -1],
      [this.legR, this.shinR, 1],
    ] as const) {
      leg.position.set(0.13 * sx, 0.92, 0);
      this.body.add(leg);
      this.box(leg, uniform, 0, -THIGH_LEN / 2, 0, 0.17, THIGH_LEN, 0.2); // thigh
      shin.position.set(0, -THIGH_LEN, 0);
      leg.add(shin);
      this.box(shin, uniform, 0, -SHIN_LEN / 2, 0, 0.15, SHIN_LEN, 0.18); // shin
      this.box(shin, dark, 0, -SHIN_LEN - 0.04, 0.05, 0.17, 0.11, 0.3); // boot
    }

    // Hips.
    this.box(this.body, uniform, 0, 0.98, 0, 0.36, 0.18, 0.24);
    this.box(this.body, dark, 0, 1.02, 0, 0.38, 0.08, 0.26); // belt
    this.box(this.body, vest, 0.16, 0.96, 0.13, 0.12, 0.14, 0.08); // hip pouch

    // Torso group (pivot at waist for lean).
    this.torso.position.set(0, 1.06, 0);
    this.body.add(this.torso);
    this.box(this.torso, uniform, 0, 0.28, 0, 0.4, 0.56, 0.25); // chest
    this.box(this.torso, vest, 0, 0.28, 0.03, 0.44, 0.48, 0.28); // vest
    // Pouches.
    this.box(this.torso, vest, -0.11, 0.22, 0.19, 0.12, 0.14, 0.06);
    this.box(this.torso, vest, 0.11, 0.22, 0.19, 0.12, 0.14, 0.06);
    this.box(this.torso, vest, 0, 0.36, 0.19, 0.16, 0.1, 0.05);
    // Shoulder pads.
    this.box(this.torso, vest, -0.24, 0.5, 0, 0.1, 0.12, 0.24);
    this.box(this.torso, vest, 0.24, 0.5, 0, 0.1, 0.12, 0.24);
    // Backpack.
    this.box(this.torso, vest, 0, 0.3, -0.2, 0.32, 0.42, 0.16);
    this.box(this.torso, dark, 0, 0.48, -0.2, 0.2, 0.1, 0.17); // bedroll
    // Shoulder accent (team identification readable from iso view).
    this.box(this.torso, accent, -0.24, 0.58, 0, 0.06, 0.1, 0.2);

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

  /** Solve both arms for one mount transform (grip point + user's support point). */
  private solveGrips(
    mountPos: THREE.Vector3, mountRot: THREE.Euler | null,
    support: readonly [number, number, number],
  ): { r: ArmPose; l: ArmPose } {
    const rotate = (v: THREE.Vector3): THREE.Vector3 => (mountRot ? v.applyEuler(mountRot) : v);
    _target.copy(mountPos).add(rotate(_chain.set(0, -0.03, 0.02)));
    const r = solveArm(1, _target);
    _support.copy(mountPos).add(rotate(_chain.set(support[0], support[1], support[2])));
    const l = solveArm(-1, _support);
    return { r, l };
  }

  /**
   * Attach a weapon and pose both hands on it. `support` is the weapon-local
   * point the support hand should hold (see WeaponMeshFactory.buildWeaponMesh).
   * Both the aiming pose and the lowered sprint-carry pose are solved up front,
   * so blending between them keeps the hands glued to the weapon.
   */
  mountWeapon(weapon: THREE.Object3D, support: readonly [number, number, number] = [0, -0.02, 0.3]): void {
    this.weaponMount.add(weapon);
    const aim = this.solveGrips(MOUNT_POS, null, support);
    this.poseR = aim.r;
    this.poseL = aim.l;
    _carryPos.copy(MOUNT_POS).add(CARRY_DIP);
    const carry = this.solveGrips(_carryPos, CARRY_ROT, support);
    this.poseRCarry = carry.r;
    this.poseLCarry = carry.l;
    this.applyArmPose(0);
  }

  clearWeapon(): void {
    this.weaponMount.clear();
    this.poseR = { rx: -1.05, ry: -0.3, rz: 0, ex: -0.85 };
    this.poseL = { rx: -0.75, ry: 0.42, rz: 0, ex: -1.1 };
    this.applyArmPose(0);
  }

  /** World position of the support hand (weapon grip verification / VFX). */
  supportHandWorld(out: THREE.Vector3): THREE.Vector3 {
    this.root.updateMatrixWorld(true);
    return this.handL.getWorldPosition(out);
  }

  /**
   * Write arm bones: solved aim pose blended toward the low-ready carry when
   * running, plus reload dip, fire kick and body sway.
   */
  private applyArmPose(reloadDip: number): void {
    const bob = Math.sin(this.gait) * 0.055 * this.sprintBlend;
    // Running drops the weapon to a low carry; aiming raises it back up.
    const carry = clamp(this.sprintBlend - this.aimBlend, 0, 1);
    const rPose = blendPose(this.poseR, this.poseRCarry, carry);
    const lPose = blendPose(this.poseL, this.poseLCarry, carry);
    const rl = blendPose(rPose, RELOAD_R, reloadDip);
    const ll = blendPose(lPose, RELOAD_L, reloadDip);

    // Idle micro-sway keeps the silhouette alive.
    const t = performance.now() / 1000 + this.rngPhase;
    const sway = Math.sin(t * 1.7) * 0.014 * (1 - this.sprintBlend);
    const breath = Math.sin(t * 2.1) * 0.01 * (1 - this.sprintBlend);

    const kick = this.fireKick * (1 - carry * 0.8);
    this.armR.rotation.set(
      rl.rx + kick * 0.12 + bob * 0.7 + breath,
      rl.ry,
      rl.rz,
    );
    this.foreR.rotation.x = rl.ex + kick * 0.15;
    this.armL.rotation.set(
      ll.rx - bob * 0.8 + sway,
      ll.ry - reloadDip * 0.15,
      ll.rz,
    );
    this.foreL.rotation.x = ll.ex + reloadDip * 0.55 - bob * 0.5;
  }

  playFire(): void {
    this.fireKick = 1;
  }

  playHit(): void {
    this.hitTimer = 1;
  }

  /** Full pose reset (restart / return-to-menu): standing, no flash, no death. */
  reset(): void {
    this.gait = 0;
    this.fireKick = 0;
    this.hitTimer = 0;
    this.reloadDip = 0;
    this.leanSmooth = 0;
    this.sprintBlend = 0;
    this.crouchBlend = 0;
    this.aimBlend = 0;
    this.fall = { active: false, timer: 0, roll: 0, yaw: 0 };
    this.body.rotation.set(0, 0, 0);
    this.body.position.set(0, 0, 0);
    this.torso.rotation.set(0, 0, 0);
    this.weaponMount.position.copy(MOUNT_POS);
    this.weaponMount.rotation.set(0, 0, 0);
    this.sprintBlend = 0;
    this.legL.rotation.set(0, 0, 0);
    this.legR.rotation.set(0, 0, 0);
    this.shinL.rotation.set(0, 0, 0);
    this.shinR.rotation.set(0, 0, 0);
    this.applyFlash(0);
    this.applyArmPose(0);
  }

  update(dt: number, s: RigAnimState): void {
    const t = performance.now() / 1000 + this.rngPhase;
    this.fireKick = Math.max(0, this.fireKick - dt * 9);
    this.hitTimer = Math.max(0, this.hitTimer - dt * 5);
    this.leanSmooth += (clamp(s.lean, -1, 1) - this.leanSmooth) * Math.min(1, dt * 7);

    if (s.dead) {
      this.updateFall(dt, t);
      this.applyFlash(0);
      return;
    }

    // --- blend weights -----------------------------------------------------
    const speedN = clamp(s.speed / 4.6, 0, 1.6);
    const moving = speedN > 0.06;
    const sprintTarget = clamp(s.sprint, 0, 1);
    const crouchTarget = s.crouch ? 1 : 0;
    const aimTarget = s.aiming ? 1 : 0;
    this.sprintBlend += (sprintTarget - this.sprintBlend) * Math.min(1, dt * 5);
    this.crouchBlend += (crouchTarget - this.crouchBlend) * Math.min(1, dt * 8);
    this.aimBlend += (aimTarget - this.aimBlend) * Math.min(1, dt * 9);

    // --- gait ---------------------------------------------------------------
    // Stride frequency scales with speed (sprint = shorter cycle, longer steps).
    const strideRate = 3.6 + speedN * 5.4 + this.sprintBlend * 1.6;
    this.gait += dt * strideRate * (moving ? 1 : 0);
    if (!moving) this.gait += dt * 0.6; // settle to a stand
    const phase = this.gait;
    const swing = Math.sin(phase);
    const lift = Math.max(0, Math.cos(phase));
    const strideAmp = (0.42 + 0.28 * this.sprintBlend) * Math.min(1, speedN + 0.15) * (1 - this.crouchBlend * 0.45);

    // Hips swing, knees bend on the lift half, feet stay roughly level.
    this.legL.rotation.x = swing * strideAmp;
    this.legR.rotation.x = -swing * strideAmp;
    this.shinL.rotation.x = -clamp(lift * 0.9 + 0.12, 0, 1.35) * (moving ? 1 : 0.2);
    this.shinR.rotation.x = -clamp(Math.max(0, -Math.cos(phase)) * 0.9 + 0.12, 0, 1.35) * (moving ? 1 : 0.2);
    if (this.crouchBlend > 0.01) {
      // Bent-leg crouch: both knees fold, hips drop.
      this.legL.rotation.x += -0.85 * this.crouchBlend;
      this.legR.rotation.x += -0.55 * this.crouchBlend;
      this.shinL.rotation.x -= 1.15 * this.crouchBlend;
      this.shinR.rotation.x -= 0.95 * this.crouchBlend;
    }

    // Vertical bob: twice per stride, plus a small sprint kick.
    const bob = Math.abs(Math.sin(phase)) * 0.055 * Math.min(1, speedN) * (1 + this.sprintBlend * 0.35);
    const breathe = Math.sin(t * 2.2) * 0.009 * (1 - this.aimBlend * 0.5);
    const crouchDrop = this.crouchBlend * 0.42;
    this.body.position.y = bob + breathe - crouchDrop;

    // --- torso: lean, counter-rotation, turns, hit flinch --------------------
    const leanForward = speedN * 0.14 + this.sprintBlend * 0.16 - this.aimBlend * 0.05 - this.crouchBlend * 0.06;
    const flinch = this.hitTimer * 0.35;
    this.torso.rotation.x += (leanForward - flinch - this.torso.rotation.x) * Math.min(1, dt * 8);
    // Counter-rotation with the stride + banking into turns.
    const turnBank = clamp(s.turnRate * 0.12, -0.22, 0.22);
    this.torso.rotation.y += (swing * 0.12 * Math.min(1, speedN) - turnBank - this.torso.rotation.y) * Math.min(1, dt * 9);
    this.torso.rotation.z = this.leanSmooth * 0.42 + this.hitTimer * -0.12;
    this.torso.position.y = 1.06 - this.aimBlend * 0.05 - this.crouchBlend * 0.02;
    // Head steadies against the body roll (soldiers keep their eyes level).
    this.head.rotation.z = -this.torso.rotation.z * 0.55;
    this.head.rotation.x = this.aimBlend * -0.06 + this.hitTimer * 0.25;
    this.head.rotation.y = this.leanSmooth * 0.3;

    // --- arms ---------------------------------------------------------------
    const dipTarget = s.reloading ? 1 : 0;
    this.reloadDip += (dipTarget - this.reloadDip) * Math.min(1, dt * 6);
    this.applyArmPose(this.reloadDip);

    // Weapon mount: recoil travel + sprint carry (same transform the carry
    // arm poses were solved against, so the grip never slips).
    const carry01 = this.sprintBlend;
    this.weaponMount.position.set(
      MOUNT_POS.x,
      MOUNT_POS.y + CARRY_DIP.y * carry01,
      MOUNT_POS.z + CARRY_DIP.z * carry01 - this.fireKick * 0.055 * (1 - carry01),
    );
    this.weaponMount.rotation.set(
      CARRY_ROT.x * carry01 + this.fireKick * 0.035 * (1 - carry01) - this.aimBlend * 0.03,
      0,
      CARRY_ROT.z * carry01 + this.leanSmooth * 0.1,
    );

    this.applyFlash(this.hitTimer);
  }

  /**
   * Death: a two-stage collapse. First a sharp impact recoil, then the body
   * folds and topples to a side (direction is stable per death, so a corpse
   * never jitters), with the weapon swinging loose as the arms give way.
   */
  private updateFall(dt: number, t: number): void {
    if (!this.fall.active) {
      this.fall = {
        active: true,
        timer: 0,
        roll: (Math.random() < 0.5 ? -1 : 1) * (0.35 + Math.random() * 0.45),
        yaw: (Math.random() - 0.5) * 0.5,
      };
    }
    this.fall.timer = Math.min(1.4, this.fall.timer + dt);
    const T = this.fall.timer;
    // Stage 1 (0..0.22s): impact recoil — shoulders snap back, head whips.
    const impact = clamp(1 - T / 0.22, 0, 1);
    // Stage 2: fold and topple, eased so it accelerates like gravity.
    const k = clamp((T - 0.14) / 0.9, 0, 1);
    const e = k * k * (3 - 2 * k); // smoothstep
    const drop = 1 - Math.pow(1 - k, 2.2);

    this.body.rotation.x = -Math.PI / 2 * drop * 0.94;
    this.body.rotation.z = this.fall.roll * e;
    this.body.rotation.y = this.fall.yaw * e;
    this.body.position.y = 0.3 * drop + 0.04 * impact;
    // Limbs go slack: thighs fold, shins follow, torso curls.
    this.legL.rotation.x = 0.55 * e;
    this.legR.rotation.x = 0.2 * e;
    this.shinL.rotation.x = -1.25 * e;
    this.shinR.rotation.x = -0.7 * e;
    this.torso.rotation.x = -0.28 * e + 0.35 * impact;
    this.torso.rotation.z = this.fall.roll * 0.18 * e;
    this.head.rotation.x = 0.3 * impact + 0.25 * e;
    // Arms drop and splay; the weapon hangs from the loose hand.
    const rPose = blendPose(this.poseR, DEATH_R, e);
    const lPose = blendPose(this.poseL, DEATH_L, e);
    this.armR.rotation.set(rPose.rx, rPose.ry, rPose.rz);
    this.foreR.rotation.x = rPose.ex;
    this.armL.rotation.set(lPose.rx, lPose.ry, lPose.rz);
    this.foreL.rotation.x = lPose.ex;
    this.weaponMount.position.set(
      MOUNT_POS.x + 0.05 * e,
      MOUNT_POS.y - 0.16 * e,
      MOUNT_POS.z - 0.06 * e,
    );
    this.weaponMount.rotation.set(0.5 * e, 0.2 * e, -0.35 * e);
    // Settle: a dying twitch before going still.
    const twitch = T > 1.0 && T < 1.4 ? Math.sin((T - 1) * 60) * 0.02 * (1 - (T - 1) / 0.4) : 0;
    this.body.position.y += twitch;
    void t;
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

