import * as THREE from 'three';
import type { WeaponId } from '../multiplayer/protocol';
import { batchSoldierPart } from './batching';

/** Human-scale firearm construction and real grip anchors; models have no combat authority. */
export class WeaponModel {
  readonly group = new THREE.Group();
  readonly rightGrip = new THREE.Vector3(0, -0.105, 0.055);
  readonly leftGrip = new THREE.Vector3(-0.04, -0.055, 0.33);
  readonly magazineGrip = new THREE.Vector3(0, -0.19, 0.14);
  readonly muzzle = new THREE.Vector3();
  private magazine = new THREE.Group();
  private action = new THREE.Group();
  private box = new THREE.BoxGeometry(1, 1, 1);
  private barrel = new THREE.CylinderGeometry(1, 1, 1, 12);
  private materials = {
    steel: new THREE.MeshStandardMaterial({ color: '#343b3f', roughness: 0.43, metalness: 0.8 }),
    dark: new THREE.MeshStandardMaterial({ color: '#192026', roughness: 0.56, metalness: 0.5 }),
    polymer: new THREE.MeshStandardMaterial({ color: '#3f443b', roughness: 0.88 }),
    wood: new THREE.MeshStandardMaterial({ color: '#71503b', roughness: 0.83 }),
    rubber: new THREE.MeshStandardMaterial({ color: '#171c1d', roughness: 0.96 }),
    lens: new THREE.MeshStandardMaterial({
      color: '#327b86',
      roughness: 0.15,
      metalness: 0.25,
      emissive: '#0b252a',
      emissiveIntensity: 0.25,
    }),
  };
  private geometry: THREE.BufferGeometry[] = [];
  constructor(readonly id: WeaponId) {
    this.group.name = `weapon-${id}`;
    this.group.userData.weaponId = id;
    this.group.add(this.magazine, this.action);
    if (id === 'pistol') this.pistol();
    else if (id === 'shotgun') this.shotgun();
    else if (id === 'smg') this.smg();
    else this.carbine(id === 'dmr');
    for (const part of [this.group, this.magazine, this.action])
      this.geometry.push(...batchSoldierPart(part));
  }
  private body(
    w: number,
    h: number,
    d: number,
    x: number,
    y: number,
    z: number,
    mat: THREE.Material = this.materials.steel,
    parent = this.group,
    tilt = 0,
  ): void {
    const m = new THREE.Mesh(this.box, mat);
    m.scale.set(w, h, d);
    m.position.set(x, y, z);
    m.rotation.x = tilt;
    m.castShadow = true;
    parent.add(m);
  }
  private tube(
    radius: number,
    length: number,
    x: number,
    y: number,
    z: number,
    mat: THREE.Material = this.materials.steel,
    parent = this.group,
  ): void {
    const m = new THREE.Mesh(this.barrel, mat);
    m.scale.set(radius, length, radius);
    m.rotation.x = Math.PI / 2;
    m.position.set(x, y, z);
    m.castShadow = true;
    parent.add(m);
  }
  private profile(
    points: [number, number][],
    width: number,
    mat: THREE.Material,
    parent = this.group,
  ): void {
    const shape = new THREE.Shape();
    points.forEach(([z, y], i) => (i ? shape.lineTo(z, y) : shape.moveTo(z, y)));
    shape.closePath();
    const geo = new THREE.ExtrudeGeometry(shape, {
      depth: width,
      steps: 1,
      bevelEnabled: true,
      bevelThickness: 0.003,
      bevelSize: 0.005,
      bevelSegments: 1,
    });
    // Side-profile coordinates (longitudinal z, height y) extruded across x.
    geo.applyMatrix4(
      new THREE.Matrix4().set(0, 0, 1, -width / 2, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1),
    );
    this.geometry.push(geo);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
    parent.add(mesh);
  }
  private guard(z: number): void {
    const geo = new THREE.TorusGeometry(0.043, 0.007, 5, 12);
    geo.rotateY(Math.PI / 2);
    geo.scale(1, 0.85, 1.3);
    this.geometry.push(geo);
    const mesh = new THREE.Mesh(geo, this.materials.dark);
    mesh.position.set(0, -0.085, z);
    this.group.add(mesh);
    this.body(0.015, 0.055, 0.012, 0, -0.065, z + 0.007);
  }
  private rail(start: number, count: number): void {
    this.body(
      0.053,
      0.012,
      count * 0.027,
      0,
      0.076,
      start + (count - 1) * 0.0135,
      this.materials.dark,
    );
    for (let i = 0; i < count; i++)
      this.body(0.077, 0.016, 0.013, 0, 0.086, start + i * 0.027, this.materials.steel);
  }
  private stock(length: number, mat: THREE.Material = this.materials.polymer): void {
    this.tube(0.025, length * 0.65, 0, -0.009, -length * 0.3);
    this.profile(
      [
        [-length, -0.08],
        [-length, 0.035],
        [-length * 0.36, 0.018],
        [-length * 0.36, -0.032],
        [-length * 0.67, -0.081],
      ],
      0.073,
      mat,
    );
    this.body(0.085, 0.15, 0.018, 0, -0.031, -length, this.materials.rubber);
    this.body(0.091, 0.035, 0.1, 0, 0.04, -length * 0.7, mat);
  }
  private carbine(dmr: boolean): void {
    this.profile(
      [
        [-0.048, -0.047],
        [-0.035, 0.054],
        [0.28, 0.054],
        [0.285, -0.035],
        [0.192, -0.06],
        [0.06, -0.06],
      ],
      dmr ? 0.096 : 0.088,
      this.materials.dark,
    );
    this.profile(
      [
        [0.028, -0.036],
        [0.095, -0.05],
        [0.065, -0.205],
        [-0.001, -0.184],
      ],
      0.067,
      this.materials.polymer,
    );
    this.guard(0.125);
    this.stock(dmr ? 0.28 : 0.235);
    const guardEnd = dmr ? 0.59 : 0.49;
    this.profile(
      [
        [0.278, -0.046],
        [0.278, 0.042],
        [guardEnd, 0.042],
        [guardEnd, -0.032],
      ],
      0.088,
      this.materials.polymer,
    );
    for (let i = 0; i < (dmr ? 9 : 7); i++) {
      const z = 0.295 + i * 0.033;
      this.body(0.094, 0.022, 0.022, 0, -0.015, z, this.materials.dark);
      this.body(0.098, 0.016, 0.02, 0, 0.026, z, this.materials.steel);
    }
    this.rail(0.12, dmr ? 17 : 13);
    const muzzle = dmr ? 0.85 : 0.69;
    this.tube(0.018, muzzle - guardEnd, 0, 0, (muzzle + guardEnd) / 2);
    this.tube(0.026, 0.055, 0, 0, muzzle, this.materials.dark);
    this.tube(0.011, 0.015, 0, 0, muzzle + 0.03, this.materials.rubber);
    this.muzzle.set(0, 0, muzzle + 0.04);
    this.profile(
      [
        [0.143, -0.047],
        [0.205, -0.047],
        [0.222, -0.204],
        [0.193, -0.24],
        [0.139, -0.23],
        [0.126, -0.15],
      ],
      0.061,
      this.materials.steel,
      this.magazine,
    );
    for (let i = 0; i < 3; i++)
      this.body(0.064, 0.13, 0.005, 0, -0.13, 0.15 + i * 0.018, this.materials.dark, this.magazine);
    // Ejection port, bolt release, forward assist and charging latch.
    this.body(0.006, 0.033, 0.066, 0.049, 0.015, 0.191, this.materials.steel);
    this.body(0.01, 0.016, 0.04, -0.05, -0.02, 0.115);
    this.body(0.012, 0.019, 0.019, 0.052, 0.008, 0.056);
    this.body(0.096, 0.012, 0.023, 0, 0.054, -0.025);
    this.leftGrip.set(-0.041, -0.047, dmr ? 0.365 : 0.327);
    if (dmr) {
      this.body(0.038, 0.045, 0.043, 0, 0.117, 0.105);
      this.body(0.038, 0.045, 0.043, 0, 0.117, 0.285);
      this.tube(0.032, 0.245, 0, 0.164, 0.195, this.materials.dark);
      this.tube(0.047, 0.055, 0, 0.164, 0.313, this.materials.dark);
      this.tube(0.044, 0.008, 0, 0.164, 0.345, this.materials.lens);
      this.tube(0.037, 0.035, 0, 0.164, 0.063, this.materials.rubber);
      this.body(0.066, 0.045, 0.043, 0, 0.197, 0.198, this.materials.steel);
    } else {
      this.body(0.057, 0.054, 0.071, 0, 0.121, 0.176, this.materials.dark);
      this.body(0.047, 0.042, 0.005, 0, 0.127, 0.216, this.materials.lens);
      this.body(0.024, 0.051, 0.029, 0, 0.075, 0.468, this.materials.dark);
    }
  }
  private smg(): void {
    this.profile(
      [
        [-0.035, -0.054],
        [-0.034, 0.04],
        [0.232, 0.04],
        [0.255, 0.008],
        [0.244, -0.048],
      ],
      0.079,
      this.materials.dark,
    );
    this.profile(
      [
        [0.006, -0.036],
        [0.066, -0.052],
        [0.037, -0.197],
        [-0.015, -0.18],
      ],
      0.066,
      this.materials.polymer,
    );
    this.stock(0.2, this.materials.rubber);
    this.guard(0.095);
    this.profile(
      [
        [0.24, -0.045],
        [0.245, 0.034],
        [0.365, 0.017],
        [0.356, -0.053],
      ],
      0.077,
      this.materials.polymer,
    );
    this.tube(0.018, 0.11, 0, 0, 0.395);
    this.tube(0.026, 0.033, 0, 0, 0.446, this.materials.dark);
    this.muzzle.set(0, 0, 0.47);
    this.profile(
      [
        [0.119, -0.044],
        [0.161, -0.044],
        [0.157, -0.215],
        [0.124, -0.285],
        [0.084, -0.267],
        [0.108, -0.206],
      ],
      0.043,
      this.materials.steel,
      this.magazine,
    );
    this.rail(0.099, 5);
    this.body(0.039, 0.044, 0.06, 0, 0.115, 0.174, this.materials.dark);
    this.body(0.031, 0.03, 0.006, 0, 0.12, 0.207, this.materials.lens);
    for (let i = 0; i < 4; i++)
      this.body(0.083, 0.013, 0.011, 0, -0.025, 0.26 + i * 0.025, this.materials.dark);
    this.body(0.008, 0.024, 0.057, 0.044, 0.006, 0.163);
    this.body(0.045, 0.012, 0.025, -0.033, 0.047, 0.275);
    this.leftGrip.set(-0.039, -0.045, 0.286);
    this.magazineGrip.set(0, -0.2, 0.123);
  }
  private shotgun(): void {
    this.profile(
      [
        [-0.067, -0.044],
        [-0.06, 0.052],
        [0.248, 0.052],
        [0.259, -0.039],
      ],
      0.09,
      this.materials.steel,
    );
    this.profile(
      [
        [-0.32, -0.098],
        [-0.31, 0.022],
        [-0.055, 0.005],
        [0.005, -0.059],
        [-0.039, -0.184],
        [-0.1, -0.153],
        [-0.12, -0.068],
      ],
      0.077,
      this.materials.wood,
    );
    this.body(0.086, 0.147, 0.019, 0, -0.034, -0.324, this.materials.rubber);
    this.guard(0.064);
    this.tube(0.026, 0.64, 0, 0.017, 0.542);
    this.tube(0.024, 0.55, 0, -0.047, 0.506);
    this.tube(0.03, 0.027, 0, 0.017, 0.866, this.materials.dark);
    this.tube(0.018, 0.008, 0, 0.017, 0.883, this.materials.rubber);
    this.muzzle.set(0, 0.017, 0.89);
    this.profile(
      [
        [0.268, -0.086],
        [0.263, -0.011],
        [0.451, -0.011],
        [0.469, -0.059],
        [0.444, -0.091],
      ],
      0.11,
      this.materials.wood,
      this.action,
    );
    for (let i = 0; i < 7; i++)
      this.body(
        0.116,
        0.072,
        0.008,
        0,
        -0.052,
        0.283 + i * 0.023,
        this.materials.dark,
        this.action,
      );
    this.body(0.035, 0.024, 0.034, 0, 0.065, 0.804);
    this.body(0.021, 0.019, 0.065, 0, 0.067, 0.085, this.materials.dark);
    this.body(0.009, 0.038, 0.066, 0.051, 0.007, 0.16, this.materials.dark);
    for (let i = 0; i < 4; i++)
      this.tube(0.012, 0.043, -0.055, 0.005, -0.02 + i * 0.04, this.materials.polymer);
    this.rightGrip.set(0, -0.101, -0.045);
    this.leftGrip.set(-0.048, -0.064, 0.35);
    this.magazineGrip.set(0, -0.056, 0.166);
  }
  private pistol(): void {
    this.profile(
      [
        [-0.06, 0.058],
        [0.155, 0.058],
        [0.169, 0.023],
        [0.163, -0.02],
        [-0.069, -0.02],
      ],
      0.073,
      this.materials.steel,
      this.action,
    );
    this.profile(
      [
        [-0.063, -0.017],
        [0.154, -0.017],
        [0.139, -0.064],
        [0.022, -0.075],
        [-0.007, -0.188],
        [-0.068, -0.164],
      ],
      0.067,
      this.materials.polymer,
    );
    this.tube(0.014, 0.053, 0, 0.023, 0.164, this.materials.dark);
    this.tube(0.009, 0.01, 0, 0.023, 0.194, this.materials.rubber);
    this.muzzle.set(0, 0.023, 0.2);
    this.guard(0.058);
    this.body(0.07, 0.014, 0.06, 0, -0.186, -0.033, this.materials.dark, this.magazine);
    this.body(0.018, 0.024, 0.026, 0, 0.078, 0.137, this.materials.dark);
    this.body(0.047, 0.026, 0.019, 0, 0.078, -0.047, this.materials.dark);
    for (let i = 0; i < 5; i++)
      this.body(0.078, 0.064, 0.004, 0, 0.019, -0.05 + i * 0.013, this.materials.dark, this.action);
    this.body(0.007, 0.018, 0.025, -0.039, -0.014, -0.028);
    this.body(0.009, 0.02, 0.011, 0.038, -0.044, 0.022);
    this.rightGrip.set(0, -0.1, -0.028);
    this.leftGrip.set(-0.047, -0.077, 0.008);
    this.magazineGrip.set(0, -0.185, -0.035);
  }
  animate(reload: number, recoil: number): void {
    // Detachable magazines remain separate batches; pump / slide have their own action groups.
    this.magazine.position.y = reload > 0 ? -Math.sin(Math.PI * reload) * 0.12 : 0;
    this.magazine.visible = !(reload > 0.32 && reload < 0.62);
    this.action.position.z =
      this.id === 'pistol'
        ? -Math.min(0.045, recoil * 0.25)
        : this.id === 'shotgun'
          ? -Math.sin(Math.PI * reload) * 0.065
          : 0;
  }
  dispose(): void {
    this.group.removeFromParent();
    this.box.dispose();
    this.barrel.dispose();
    this.geometry.forEach((g) => g.dispose());
    Object.values(this.materials).forEach((m) => m.dispose());
    this.group.clear();
  }
}
