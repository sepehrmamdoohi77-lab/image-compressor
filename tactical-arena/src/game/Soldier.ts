import * as THREE from 'three';
import type { PlayerInfo, Team, Transform } from '../multiplayer/protocol';
import { lerpYaw } from '../multiplayer/Interpolation';
import { batchSoldierPart } from './batching';
import { WeaponModel } from './WeaponModel';
import { FootPlanner, solveTwoBone } from './Locomotion';

interface Limb {
  upper: THREE.Group;
  lower: THREE.Group;
  tip: THREE.Group;
  origin: THREE.Vector3;
  joint: THREE.Vector3;
  end: THREE.Vector3;
  length1: number;
  length2: number;
}
const down = new THREE.Vector3(0, -1, 0);

/** Articulated presentation rig: planted feet, two-bone limbs, model-anchored firearm grips. */
export class Soldier {
  readonly group = new THREE.Group();
  readonly label: HTMLDivElement;
  readonly local: boolean;
  private name: HTMLSpanElement;
  private tag: HTMLSpanElement;
  private health: HTMLElement;
  private info: PlayerInfo;
  private viewerTeam: Team;
  private appearanceKey = '';
  private boxGeometry = new THREE.BoxGeometry(1, 1, 1);
  private capsuleGeometry = new THREE.CapsuleGeometry(1, 1, 3, 8);
  private sphereGeometry = new THREE.SphereGeometry(1, 12, 9);
  private helmetGeometry = new THREE.SphereGeometry(1, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.65);
  private ringGeometry = new THREE.RingGeometry(0.46, 0.505, 32);
  private materials = {
    uniform: new THREE.MeshStandardMaterial({ roughness: 0.96 }),
    vest: new THREE.MeshStandardMaterial({ roughness: 0.93 }),
    boots: new THREE.MeshStandardMaterial({ color: '#252a29', roughness: 0.84 }),
    skin: new THREE.MeshStandardMaterial({ color: '#b2977e', roughness: 0.98 }),
    visor: new THREE.MeshStandardMaterial({ color: '#1c2b31', roughness: 0.22, metalness: 0.2 }),
    patch: new THREE.MeshStandardMaterial({ roughness: 0.75, emissiveIntensity: 0.22 }),
    accent: new THREE.MeshStandardMaterial({ roughness: 0.95 }),
  };
  private ringMaterial = new THREE.MeshBasicMaterial({
    transparent: true,
    opacity: 0.8,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  private pelvis = new THREE.Group();
  private torso = new THREE.Group();
  private head = new THREE.Group();
  private gunRoot = new THREE.Group();
  private legs: Limb[] = [];
  private arms: Limb[] = [];
  private batchedGeometry: THREE.BufferGeometry[] = [];
  private planner = new FootPlanner();
  private initialized = false;
  private pose: Transform | null = null;
  private gun: WeaponModel | null = null;
  private combatEnabled = false;
  private crouch = 0;
  private ads = 0;
  private sprint = 0;
  private reloadBlend = 0;
  private throwBlend = 0;
  private wasDead = false;
  private time = 0;
  private oldPosition = new THREE.Vector3();
  private velocity = new THREE.Vector3();
  private target = new THREE.Vector3();
  private vector = new THREE.Vector3();
  private pole = new THREE.Vector3();

  constructor(info: PlayerInfo, local: boolean, labels: HTMLElement, viewerTeam: Team = info.team) {
    this.local = local;
    this.info = info;
    this.viewerTeam = viewerTeam;
    this.group.visible = false;
    this.group.userData.playerId = info.id;
    this.group.name = `operator-${info.id}`;
    const { uniform, vest, boots, skin, visor, patch, accent } = this.materials;
    this.group.add(this.pelvis);
    this.pelvis.add(this.torso);
    this.torso.add(this.gunRoot, this.head);
    this.head.userData.hitZone = 'head';
    // Rounded fatigues under an angular plate carrier; human proportions rather than rigid blocks.
    this.capsule(0.41, 0.24, 0.25, 0, 0, 0, uniform, this.pelvis);
    this.capsule(0.47, 0.5, 0.26, 0, 0.3, 0, uniform, this.torso);
    this.box(0.42, 0.38, 0.3, 0, 0.3, 0.016, vest, this.torso);
    this.box(0.35, 0.29, 0.055, 0, 0.32, 0.185, vest, this.torso);
    for (const x of [-0.125, 0, 0.125]) {
      this.box(0.101, 0.15, 0.082, x, 0.23, 0.215, accent, this.torso);
      this.box(0.104, 0.018, 0.084, x, 0.291, 0.216, vest, this.torso);
    }
    this.box(0.105, 0.067, 0.014, 0.09, 0.447, 0.178, patch, this.torso);
    this.capsule(0.27, 0.31, 0.16, 0, 0.29, -0.21, vest, this.torso);
    this.box(0.055, 0.015, 0.064, 0.18, 0.47, -0.025, boots, this.torso);
    this.capsule(0.015, 0.19, 0.015, 0.185, 0.575, -0.03, boots, this.torso);
    this.capsule(0.11, 0.12, 0.11, 0, 0.545, 0, skin, this.torso);
    this.sphere(0.14, 0.155, 0.14, 0, 0.685, 0.009, skin, this.head);
    this.sphere(0.175, 0.115, 0.175, 0, 0.726, -0.01, uniform, this.head, this.helmetGeometry);
    this.box(0.224, 0.056, 0.037, 0, 0.722, 0.147, visor, this.head);
    this.box(0.248, 0.019, 0.045, 0, 0.752, 0.142, boots, this.head);
    this.box(0.052, 0.017, 0.23, 0, 0.841, -0.005, patch, this.head);
    for (const side of [-1, 1])
      this.capsule(0.053, 0.091, 0.079, side * 0.158, 0.681, 0, boots, this.head);
    this.box(0.421, 0.069, 0.274, 0, 0.026, 0, boots, this.pelvis);
    this.box(0.056, 0.053, 0.015, 0, 0.027, 0.145, vest, this.pelvis);
    for (const side of [-1, 1]) {
      const leg = this.limb(0.48, 0.47, this.group);
      this.capsule(0.2, 0.44, 0.22, 0, -0.225, 0, uniform, leg.upper);
      this.capsule(0.168, 0.405, 0.19, 0, -0.21, -0.014, uniform, leg.lower);
      this.capsule(0.182, 0.13, 0.041, 0, -0.005, 0.104, vest, leg.lower);
      this.box(0.16, 0.04, 0.022, 0, -0.004, 0.13, boots, leg.lower);
      this.capsule(0.184, 0.13, 0.294, 0, -0.035, 0.068, boots, leg.tip);
      this.box(0.191, 0.037, 0.285, 0, -0.085, 0.074, boots, leg.tip);
      this.box(0.092, 0.009, 0.102, 0, 0.025, 0.09, vest, leg.tip);
      this.legs.push(leg);
      const arm = this.limb(0.3, 0.28, this.torso);
      arm.origin.set(side * 0.275, 0.49, 0);
      this.capsule(0.167, 0.285, 0.178, 0, -0.135, 0, uniform, arm.upper);
      this.box(0.023, 0.095, 0.099, side * 0.093, -0.095, 0, patch, arm.upper);
      this.capsule(0.137, 0.257, 0.147, 0, -0.123, 0, uniform, arm.lower);
      this.capsule(0.089, 0.1, 0.098, 0, -0.03, 0, boots, arm.tip);
      this.box(0.095, 0.065, 0.073, 0, 0, 0.029, boots, arm.tip);
      for (let finger = 0; finger < 4; finger++)
        this.box(0.019, 0.055, 0.073, (finger - 1.5) * 0.021, -0.034, 0.041, boots, arm.tip);
      this.box(0.024, 0.037, 0.061, side * 0.057, -0.001, 0.017, boots, arm.tip);
      this.arms.push(arm);
    }
    const ring = new THREE.Mesh(this.ringGeometry, this.ringMaterial);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.037;
    this.group.add(ring);
    this.label = document.createElement('div');
    this.label.dataset.playerId = info.id;
    this.label.hidden = true;
    this.tag = document.createElement('span');
    this.tag.className = 'operator-team';
    this.name = document.createElement('span');
    this.name.className = 'operator-name';
    this.health = document.createElement('i');
    this.health.className = 'operator-health';
    this.label.append(this.tag, this.name, this.health);
    labels.append(this.label);
    this.setInfo(info, viewerTeam);
    for (const part of [
      this.group,
      this.pelvis,
      this.torso,
      this.head,
      ...this.legs.flatMap((l) => [l.upper, l.lower, l.tip]),
      ...this.arms.flatMap((l) => [l.upper, l.lower, l.tip]),
    ])
      this.batchedGeometry.push(...batchSoldierPart(part));
  }
  setInfo(info: PlayerInfo, viewerTeam: Team): void {
    const key = [info.team, info.cosmetic, info.name, info.isBot, viewerTeam].join('|');
    if (this.appearanceKey === key) return;
    this.appearanceKey = key;
    this.info = info;
    this.viewerTeam = viewerTeam;
    const blue = info.team === 'blue',
      cosmetic = info.cosmetic;
    this.materials.uniform.color.set(
      blue
        ? cosmetic === 'sand'
          ? '#43617c'
          : cosmetic === 'slate'
            ? '#42546d'
            : '#32597c'
        : cosmetic === 'sand'
          ? '#935443'
          : cosmetic === 'slate'
            ? '#7c4845'
            : '#894737',
    );
    this.materials.vest.color.set(blue ? '#253d53' : '#51352b');
    this.materials.patch.color.set(blue ? '#83d5ff' : '#ff9f7b');
    this.materials.patch.emissive.copy(this.materials.patch.color);
    this.materials.accent.color.set(
      cosmetic === 'sand'
        ? '#9d9071'
        : cosmetic === 'slate'
          ? '#69767b'
          : blue
            ? '#4a6981'
            : '#826454',
    );
    this.label.className = `operator-label ${info.team} ${this.local ? 'is-local' : info.team !== viewerTeam ? 'is-enemy' : 'is-ally'}`;
    this.tag.textContent = this.local ? 'YOU' : info.team !== viewerTeam ? 'ENEMY' : 'ALLY';
    this.name.textContent = `${info.name}${this.local ? ' · YOU' : info.isBot ? ' · BOT' : ''}`;
    this.label.dataset.team = info.team;
  }
  private limb(length1: number, length2: number, parent: THREE.Group): Limb {
    const upper = new THREE.Group(),
      lower = new THREE.Group(),
      tip = new THREE.Group();
    parent.add(upper, lower, tip);
    return {
      upper,
      lower,
      tip,
      origin: new THREE.Vector3(),
      joint: new THREE.Vector3(),
      end: new THREE.Vector3(),
      length1,
      length2,
    };
  }
  private bone(limb: Limb, target: THREE.Vector3, pole: THREE.Vector3): number {
    solveTwoBone(limb.origin, target, pole, limb.length1, limb.length2, limb.joint, limb.end);
    limb.upper.position.copy(limb.origin);
    limb.lower.position.copy(limb.joint);
    limb.tip.position.copy(limb.end);
    limb.upper.quaternion.setFromUnitVectors(
      down,
      this.vector.copy(limb.joint).sub(limb.origin).normalize(),
    );
    limb.lower.quaternion.setFromUnitVectors(
      down,
      this.vector.copy(limb.end).sub(limb.joint).normalize(),
    );
    return limb.end.distanceTo(target);
  }
  private box(
    w: number,
    h: number,
    d: number,
    x: number,
    y: number,
    z: number,
    material: THREE.Material,
    parent: THREE.Group,
  ): void {
    const mesh = new THREE.Mesh(this.boxGeometry, material);
    mesh.scale.set(w, h, d);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    parent.add(mesh);
  }
  private capsule(
    w: number,
    h: number,
    d: number,
    x: number,
    y: number,
    z: number,
    material: THREE.Material,
    parent: THREE.Group,
  ): void {
    const mesh = new THREE.Mesh(this.capsuleGeometry, material);
    mesh.scale.set(w / 2, h / 3, d / 2);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    parent.add(mesh);
  }
  private sphere(
    w: number,
    h: number,
    d: number,
    x: number,
    y: number,
    z: number,
    material: THREE.Material,
    parent: THREE.Group,
    geometry = this.sphereGeometry,
  ): void {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.scale.set(w, h, d);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    parent.add(mesh);
  }
  setCombatEnabled(enabled: boolean): void {
    this.combatEnabled = enabled;
    this.gunRoot.visible = enabled;
  }
  update(pose: Transform, dt: number, serverNow = 0): void {
    this.pose = pose;
    this.group.visible = true;
    this.time += dt;
    const c = pose.combat,
      dead = c !== undefined && c.health <= 0;
    const position = this.group.position,
      distance = Math.hypot(position.x - pose.x, position.z - pose.z);
    const discontinuity = !this.initialized || distance > 2.5 || (this.wasDead && !dead);
    this.oldPosition.copy(position);
    // Remote transforms already have a 100ms interpolation buffer. Do not interpolate them twice.
    const alpha = discontinuity || !this.local ? 1 : 1 - Math.exp(-dt * 28);
    position.x += (pose.x - position.x) * alpha;
    position.z += (pose.z - position.z) * alpha;
    this.group.rotation.y = lerpYaw(
      this.group.rotation.y,
      pose.yaw,
      discontinuity ? 1 : 1 - Math.exp(-dt * 22),
    );
    const yaw = this.group.rotation.y;
    if (discontinuity) this.planner.reset(position, yaw);
    this.velocity.copy(position).sub(this.oldPosition);
    this.velocity.y = 0;
    const speed = discontinuity ? 0 : this.velocity.length() / Math.max(0.001, dt);
    const moving = !dead && speed > 0.12;
    const blend = 1 - Math.exp(-dt * 12);
    this.crouch += ((c?.crouch && !dead ? 1 : 0) - this.crouch) * blend;
    this.ads += ((c?.ads && !dead ? 1 : 0) - this.ads) * blend;
    this.sprint += ((pose.movement === 'sprint' && moving ? 1 : 0) - this.sprint) * blend;
    const feet = dead
      ? this.planner.feet
      : this.planner.update(position, yaw, dt, this.crouch, this.sprint > 0.5);
    const cycle = this.planner.phase * Math.PI * 2;
    this.pelvis.position.y =
      0.97 -
      this.crouch * 0.43 -
      this.sprint * 0.065 +
      (moving ? Math.cos(cycle * 2) * 0.013 : Math.sin(this.time * 1.8) * 0.002);
    this.torso.rotation.x = this.crouch * 0.12 + this.sprint * 0.11;
    this.torso.rotation.z = moving ? Math.sin(cycle) * 0.028 : 0;
    const cos = Math.cos(yaw),
      sin = Math.sin(yaw);
    const vx = cos * this.velocity.x - sin * this.velocity.z,
      vz = sin * this.velocity.x + cos * this.velocity.z;
    const legYaw = moving
      ? THREE.MathUtils.clamp(Math.atan2(vx, Math.abs(vz) + 0.0001), -0.65, 0.65)
      : 0;
    for (let i = 0; i < 2; i++) {
      const leg = this.legs[i]!,
        foot = feet[i]!;
      leg.origin.set(i === 0 ? -0.145 : 0.145, this.pelvis.position.y, 0);
      const dx = foot.position.x - position.x,
        dz = foot.position.z - position.z;
      this.target.set(cos * dx - sin * dz, foot.position.y, sin * dx + cos * dz);
      this.pole.set(Math.sin(legYaw), 0.015, Math.cos(legYaw));
      this.bone(leg, this.target, this.pole);
      leg.tip.rotation.set(0, foot.yaw - yaw + legYaw * 0.25, 0);
    }
    const reload =
      c?.weaponState === 'RELOADING' && c.reloadStartedAtMs !== null && c.reloadEndsAtMs !== null;
    const fraction = reload
      ? THREE.MathUtils.clamp(
          (serverNow - c!.reloadStartedAtMs!) /
            Math.max(1, c!.reloadEndsAtMs! - c!.reloadStartedAtMs!),
          0,
          1,
        )
      : 0;
    this.reloadBlend += ((reload ? 1 : 0) - this.reloadBlend) * blend;
    const throwing = !!c && c.throwUntilMs > serverNow && !dead;
    this.throwBlend += ((throwing ? 1 : 0) - this.throwBlend) * (1 - Math.exp(-dt * 22));
    let handError = 0;
    if (this.combatEnabled && c) {
      if (!this.gun || this.gun.id !== c.weaponId) {
        this.gun?.dispose();
        this.gun = new WeaponModel(c.weaponId);
        this.gunRoot.clear();
        this.gunRoot.add(this.gun.group);
      }
      const pistol = c.weaponId === 'pistol';
      this.gunRoot.visible = this.throwBlend < 0.25;
      this.gunRoot.position.set(
        pistol ? 0.04 : 0.085,
        0.39 + this.ads * 0.15 - this.sprint * 0.075,
        pistol ? 0.22 : 0.065,
      );
      this.gunRoot.rotation.set(
        -pose.pitch -
          c.recoil +
          (1 - this.ads) * 0.06 +
          this.sprint * 0.2 +
          this.reloadBlend * 0.22,
        0,
        -Math.sin(fraction * Math.PI) * 0.2 * this.reloadBlend,
      );
      if (c.weaponState === 'SWITCHING') this.gunRoot.rotation.x += 0.48;
      this.gunRoot.updateMatrix();
      this.gun!.animate(fraction, c.recoil);
      for (let i = 0; i < 2; i++) {
        const arm = this.arms[i]!,
          left = i === 0;
        this.target
          .copy(left ? this.gun!.leftGrip : this.gun!.rightGrip)
          .applyMatrix4(this.gunRoot.matrix);
        if (left && this.reloadBlend > 0.005) {
          const mag = this.gun!.magazineGrip.clone().applyMatrix4(this.gunRoot.matrix);
          if (fraction > 0.25 && fraction < 0.6) mag.set(-0.21, 0.06, 0.075);
          this.target.lerp(mag, Math.sin(fraction * Math.PI) * this.reloadBlend);
        }
        if (this.throwBlend > 0.001) {
          const throwPhase = THREE.MathUtils.clamp(1 - (c.throwUntilMs - serverNow) / 450, 0, 1);
          const throwTarget = left
            ? new THREE.Vector3(-0.19, 0.17, 0.12)
            : new THREE.Vector3(
                0.22,
                0.6 + Math.sin(throwPhase * Math.PI) * 0.15,
                -0.15 + throwPhase * 0.68,
              );
          this.target.lerp(throwTarget, this.throwBlend);
        }
        this.pole.set(left ? -0.7 : 0.8, -0.48, -0.35);
        handError = Math.max(handError, this.bone(arm, this.target, this.pole));
        arm.tip.quaternion.copy(this.gunRoot.quaternion);
      }
    } else {
      this.gunRoot.visible = false;
      for (let i = 0; i < 2; i++) {
        const side = i === 0 ? -1 : 1;
        this.target.set(
          side * 0.3,
          -0.045,
          moving ? Math.sin(cycle + (i === 0 ? 0 : Math.PI)) * 0.17 : 0.04,
        );
        this.pole.set(side * 0.6, -0.2, 0.6);
        this.bone(this.arms[i]!, this.target, this.pole);
        this.arms[i]!.tip.rotation.set(0.1, 0, 0);
      }
    }
    const deathAlpha = 1 - Math.exp(-dt * 9);
    this.group.rotation.z += ((dead ? -1.49 : 0) - this.group.rotation.z) * deathAlpha;
    position.y += ((dead ? 0.105 : 0) - position.y) * deathAlpha;
    this.ringMaterial.color.set(
      c && c.protectedUntilMs > serverNow
        ? '#e8d8a3'
        : this.local
          ? '#e6c386'
          : this.info.team === this.viewerTeam
            ? '#79bded'
            : '#ee866b',
    );
    this.ringMaterial.opacity = dead ? 0.2 : this.local ? 0.9 : 0.75;
    this.label.classList.toggle('is-dead', dead);
    this.health.style.width = `${c ? Math.max(0, c.health) : 100}%`;
    this.label.dataset.currentHealth = c ? String(c.health) : '';
    this.label.dataset.weapon = c?.weaponId ?? '';
    this.label.dataset.x = pose.x.toFixed(3);
    this.label.dataset.z = pose.z.toFixed(3);
    this.label.dataset.yaw = pose.yaw.toFixed(3);
    this.label.dataset.gaitPhase = this.planner.phase.toFixed(3);
    this.label.dataset.handError = handError.toFixed(4);
    this.label.dataset.plantedFeet = feet.map((f) => (f.planted ? '1' : '0')).join('');
    this.wasDead = dead;
    this.initialized = true;
  }
  aimTarget(hit: THREE.Intersection): { x: number; y: number; z: number } {
    let object: THREE.Object3D | null = hit.object;
    while (object && object !== this.group) {
      if (object.userData.hitZone === 'head')
        return {
          x: this.position.x,
          y: 1.65 - (this.pose?.combat?.crouch ? 0.43 : 0),
          z: this.position.z,
        };
      object = object.parent;
    }
    return { x: hit.point.x, y: hit.point.y, z: hit.point.z };
  }
  get position(): THREE.Vector3 {
    return this.group.position;
  }
  get labelHeight(): number {
    return this.pose?.combat?.health === 0 ? 0.7 : this.pose?.combat?.crouch ? 1.66 : 2.14;
  }
  get hasPose(): boolean {
    return this.pose !== null;
  }
  dispose(): void {
    this.gun?.dispose();
    this.label.remove();
    this.group.removeFromParent();
    this.boxGeometry.dispose();
    this.capsuleGeometry.dispose();
    this.sphereGeometry.dispose();
    this.helmetGeometry.dispose();
    this.ringGeometry.dispose();
    Object.values(this.materials).forEach((m) => m.dispose());
    this.ringMaterial.dispose();
    this.batchedGeometry.forEach((g) => g.dispose());
  }
}
