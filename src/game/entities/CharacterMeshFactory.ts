// Procedural tactical soldier rig (~1.8m). Modular: helmet, vest, pouches,
// backpack, arms, legs, weapon mount socket. Code-driven animation:
// idle / walk / run / aim / fire / reload / hit / death.
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

export class CharacterRig {
  root = new THREE.Group();
  body = new THREE.Group();
  torso = new THREE.Group();
  head = new THREE.Group();
  armL = new THREE.Group();
  armR = new THREE.Group();
  legL = new THREE.Group();
  legR = new THREE.Group();
  weaponMount = new THREE.Group();

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

    // Arms (shoulder pivots). Default pose: holding weapon forward.
    for (const [arm, sx] of [[this.armL, -1], [this.armR, 1]] as const) {
      arm.position.set(0.26 * sx, 0.5, 0);
      this.torso.add(arm);
      this.box(arm, uniform, 0, -0.2, 0, 0.13, 0.42, 0.15); // upper
      this.box(arm, skin, 0, -0.44, 0, 0.12, 0.12, 0.13); // glove
    }
    // Aim pose: arms rotated forward.
    this.armR.rotation.x = -1.15;
    this.armR.rotation.y = -0.25;
    this.armL.rotation.x = -1.0;
    this.armL.rotation.y = 0.35;

    // Weapon mount socket (grip point).
    this.weaponMount.position.set(0.16, 0.32, 0.42);
    this.torso.add(this.weaponMount);
  }

  /** Attach a weapon group; returns nothing. Weapon faces +Z. */
  mountWeapon(weapon: THREE.Object3D): void {
    this.weaponMount.add(weapon);
  }

  clearWeapon(): void {
    this.weaponMount.clear();
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

    // Reload dip: arms lower briefly.
    const dipTarget = s.reloading ? 1 : 0;
    this.reloadDip += (dipTarget - this.reloadDip) * Math.min(1, dt * 6);
    this.armR.rotation.x = -1.15 + this.reloadDip * 0.7 + this.fireKick * 0.12;
    this.armL.rotation.x = -1.0 + this.reloadDip * 0.55 + Math.sin(t * 1.7) * 0.02;
    // Fire kick on weapon mount.
    this.weaponMount.position.z = 0.42 - this.fireKick * 0.07;
    this.weaponMount.rotation.x = this.fireKick * 0.09;

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
