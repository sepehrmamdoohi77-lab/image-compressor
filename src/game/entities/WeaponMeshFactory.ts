// Standardized weapon meshes: correct orientation (+Z forward), grip at origin,
// muzzle Object3D at the barrel tip. Sockets: grip/muzzle/mag/optic/foregrip.
import * as THREE from 'three';
import type { WeaponId } from '../data/config';
import { type MaterialLib, type GeometryLib } from '../world/Materials';

export interface WeaponMesh {
  group: THREE.Group;
  muzzle: THREE.Object3D;
  mag: THREE.Object3D;
}

export function buildWeaponMesh(
  id: WeaponId, mats: MaterialLib, geos: GeometryLib,
): WeaponMesh {
  const group = new THREE.Group();
  const poly = mats.weaponPolymer;
  const metal = mats.weaponMetal;

  const box = (m: THREE.Material, x: number, y: number, z: number, w: number, h: number, d: number): THREE.Mesh => {
    const mesh = new THREE.Mesh(geos.box, m);
    mesh.position.set(x, y, z);
    mesh.scale.set(w, h, d);
    mesh.castShadow = true;
    group.add(mesh);
    return mesh;
  };

  // Shared layout (lengths in meters, forward = +Z, grip at origin).
  let barrelLen = 0.5;
  switch (id) {
    case 'rifle':
      box(poly, 0, 0, 0.1, 0.07, 0.11, 0.5); // receiver
      box(metal, 0, 0.015, 0.5, 0.045, 0.05, 0.42); // barrel+handguard
      box(metal, 0, 0.015, 0.75, 0.03, 0.035, 0.1); // muzzle device
      box(poly, 0, -0.05, -0.22, 0.06, 0.14, 0.2); // stock
      box(poly, 0, -0.12, 0.02, 0.055, 0.14, 0.07); // grip
      box(metal, 0, 0.085, 0.12, 0.04, 0.05, 0.16); // optic rail
      barrelLen = 0.8;
      break;
    case 'smg':
      box(poly, 0, 0, 0.08, 0.065, 0.1, 0.4);
      box(metal, 0, 0.01, 0.38, 0.04, 0.045, 0.24);
      box(poly, 0, -0.1, -0.12, 0.05, 0.12, 0.12);
      box(poly, 0, -0.11, 0.0, 0.05, 0.13, 0.06);
      box(poly, 0, -0.09, 0.3, 0.05, 0.1, 0.06); // foregrip
      barrelLen = 0.52;
      break;
    case 'shotgun':
      box(metal, 0, 0, 0.1, 0.07, 0.1, 0.45);
      box(metal, 0, 0.02, 0.5, 0.05, 0.05, 0.4); // barrel
      box(poly, 0, -0.04, 0.35, 0.06, 0.06, 0.3); // pump
      box(poly, 0, -0.06, -0.25, 0.065, 0.13, 0.22); // stock
      box(poly, 0, -0.11, 0.0, 0.055, 0.12, 0.07);
      barrelLen = 0.72;
      break;
    case 'dmr':
      box(poly, 0, 0, 0.08, 0.07, 0.11, 0.55);
      box(metal, 0, 0.02, 0.55, 0.04, 0.045, 0.5); // long barrel
      box(metal, 0, 0.02, 0.85, 0.045, 0.05, 0.12); // suppressor
      box(poly, 0, -0.05, -0.28, 0.06, 0.13, 0.24);
      box(poly, 0, -0.12, 0.0, 0.055, 0.13, 0.07);
      box(metal, 0, 0.1, 0.05, 0.05, 0.07, 0.2); // scope
      barrelLen = 0.94;
      break;
    case 'pistol':
      box(metal, 0, 0.02, 0.08, 0.05, 0.07, 0.22);
      box(poly, 0, -0.07, -0.03, 0.05, 0.13, 0.06);
      barrelLen = 0.2;
      break;
  }

  // Magazine socket (visual reference).
  const mag = new THREE.Object3D();
  mag.position.set(0, -0.14, 0.16);
  group.add(mag);
  box(poly, 0, -0.14, 0.16, 0.05, 0.14, 0.08);

  // Muzzle socket at barrel tip.
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, id === 'pistol' ? 0.02 : 0.015, barrelLen);
  group.add(muzzle);

  return { group, muzzle, mag };
}
