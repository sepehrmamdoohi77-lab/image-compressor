// Standardized weapon meshes: correct orientation (+Z forward), grip at origin,
// muzzle Object3D at the barrel tip. Sockets: grip/muzzle/mag.
//
// Every weapon has its OWN silhouette — receiver length, barrel profile, sights,
// magazine shape, stock and furniture material are all archetype-specific, so a
// glance at the model tells you which gun is in the soldier's hands.
import * as THREE from 'three';
import type { WeaponId } from '../data/config';
import { type MaterialLib, type GeometryLib } from '../world/Materials';

export interface WeaponGrip {
  /** Local-space point the support (left) hand holds — drives the two-hand pose. */
  support: [number, number, number];
  /** Barrel length (m) from grip to muzzle, for readability checks. */
  barrelLen: number;
}

export interface WeaponMesh {
  group: THREE.Group;
  muzzle: THREE.Object3D;
  mag: THREE.Object3D;
  grip: WeaponGrip;
}

interface WeaponMats {
  body: THREE.MeshStandardMaterial;
  metal: THREE.MeshStandardMaterial;
  accent: THREE.MeshStandardMaterial;
}

/**
 * Per-weapon furniture colours, cached module-wide so every actor (player and
 * all hostiles) shares one material set per gun — no per-entity material churn.
 */
const materialCache = new Map<WeaponId, WeaponMats>();

function weaponMats(id: WeaponId): WeaponMats {
  const hit = materialCache.get(id);
  if (hit) return hit;
  const mk = (color: number, roughness: number, metalness: number): THREE.MeshStandardMaterial =>
    new THREE.MeshStandardMaterial({ color, roughness, metalness });
  const table: Record<WeaponId, WeaponMats> = {
    // Black polymer + parkerised steel.
    rifle: { body: mk(0x212326, 0.68, 0.22), metal: mk(0x3a3e44, 0.4, 0.8), accent: mk(0x2c3034, 0.5, 0.6) },
    // Grey-green polymer with a red-dot accent.
    smg: { body: mk(0x2d312c, 0.7, 0.18), metal: mk(0x4a5058, 0.42, 0.72), accent: mk(0x8f3a2a, 0.55, 0.3) },
    // Wood furniture + blued steel.
    shotgun: { body: mk(0x5c4226, 0.82, 0.05), metal: mk(0x4c5158, 0.38, 0.78), accent: mk(0x27292d, 0.6, 0.5) },
    // Olive drab chassis + matte long-range optics.
    dmr: { body: mk(0x323d2e, 0.75, 0.12), metal: mk(0x3f444a, 0.36, 0.82), accent: mk(0x23272b, 0.5, 0.55) },
    // Dark frame + bright stainless slide.
    pistol: { body: mk(0x282b2e, 0.7, 0.2), metal: mk(0x6d747c, 0.32, 0.9), accent: mk(0x1f2225, 0.55, 0.4) },
  };
  const m = table[id];
  materialCache.set(id, m);
  return m;
}

export function buildWeaponMesh(
  id: WeaponId, mats: MaterialLib, geos: GeometryLib,
): WeaponMesh {
  void mats; // furniture materials are weapon-specific (see weaponMats)
  const { body, metal, accent } = weaponMats(id);
  const group = new THREE.Group();

  const box = (m: THREE.Material, x: number, y: number, z: number, w: number, h: number, d: number, rx = 0): THREE.Mesh => {
    const mesh = new THREE.Mesh(geos.box, m);
    mesh.position.set(x, y, z);
    mesh.scale.set(w, h, d);
    if (rx !== 0) mesh.rotation.x = rx;
    mesh.castShadow = true;
    group.add(mesh);
    return mesh;
  };
  /** Cylinder laid along +Z (barrels, tubes, scopes). */
  const tube = (m: THREE.Material, x: number, y: number, z: number, d: number, len: number): THREE.Mesh => {
    const mesh = new THREE.Mesh(geos.cylinder, m);
    mesh.position.set(x, y, z);
    mesh.rotation.x = Math.PI / 2;
    mesh.scale.set(d, len, d);
    mesh.castShadow = true;
    group.add(mesh);
    return mesh;
  };

  let barrelLen = 0.5;
  let barrelY = 0.015;
  let support: [number, number, number] = [0, -0.02, 0.42];

  switch (id) {
    // --- AR-7 "Jackal": long handguard, vented rail, curved mag, telescoping stock.
    case 'rifle': {
      box(body, 0, 0, 0.08, 0.072, 0.105, 0.44); // receiver
      box(accent, 0, 0.062, 0.1, 0.036, 0.022, 0.4); // top rail
      box(accent, 0, 0.105, 0.1, 0.048, 0.055, 0.17); // optic body
      box(metal, 0, 0.105, 0.2, 0.038, 0.042, 0.03); // optic lens
      box(metal, 0, 0.005, 0.42, 0.06, 0.08, 0.34); // handguard
      box(accent, 0, 0.05, 0.42, 0.05, 0.014, 0.3); // handguard rail
      box(metal, 0, -0.03, 0.44, 0.045, 0.02, 0.22); // lower vent
      tube(metal, 0, 0.012, 0.62, 0.036, 0.32); // barrel
      tube(metal, 0, 0.012, 0.795, 0.052, 0.09); // muzzle brake
      box(metal, 0, 0.055, 0.62, 0.022, 0.055, 0.03); // front sight post
      box(body, 0, -0.075, 0.45, 0.038, 0.1, 0.05, -0.28); // angled foregrip
      // Curved magazine (three tilted segments read as a banana mag).
      box(accent, 0, -0.125, 0.03, 0.05, 0.1, 0.08, 0.16);
      box(accent, 0, -0.2, 0.045, 0.05, 0.09, 0.075, 0.42);
      box(accent, 0, -0.255, 0.075, 0.05, 0.07, 0.07, 0.66);
      box(body, 0, -0.105, -0.03, 0.05, 0.13, 0.062); // pistol grip
      box(metal, 0, -0.09, -0.115, 0.03, 0.02, 0.05); // trigger guard front
      box(body, 0, -0.028, -0.16, 0.055, 0.055, 0.09); // buffer tube ring
      box(body, 0, -0.018, -0.28, 0.056, 0.085, 0.2); // stock
      box(accent, 0, 0.026, -0.3, 0.05, 0.03, 0.14); // cheek riser
      box(metal, 0, -0.02, -0.39, 0.06, 0.1, 0.03); // butt pad
      barrelLen = 0.84;
      barrelY = 0.012;
      support = [0, -0.02, 0.30]; // handguard (in torso reach)
      break;
    }
    // --- VK-9 "Hornet": stubby shroud, vertical foregrip, straight mag, wire stock.
    case 'smg': {
      box(body, 0, 0, 0.06, 0.062, 0.095, 0.34); // receiver
      box(accent, 0, 0.055, 0.07, 0.03, 0.016, 0.3); // rail
      box(accent, 0, 0.095, 0.05, 0.036, 0.05, 0.07); // red dot
      tube(metal, 0, 0.008, 0.27, 0.05, 0.22); // barrel shroud
      tube(metal, 0, 0.008, 0.43, 0.03, 0.12); // exposed barrel
      tube(metal, 0, 0.008, 0.505, 0.058, 0.07); // compensator
      box(body, 0, -0.085, 0.25, 0.04, 0.115, 0.05); // vertical foregrip
      box(body, 0, -0.1, -0.05, 0.048, 0.125, 0.06); // pistol grip
      box(accent, 0, -0.155, 0.02, 0.045, 0.2, 0.07); // straight magazine
      box(metal, 0, -0.06, -0.15, 0.02, 0.02, 0.16); // wire stock upper
      box(metal, 0, -0.115, -0.15, 0.02, 0.02, 0.16); // wire stock lower
      box(metal, 0, -0.09, -0.23, 0.02, 0.09, 0.02); // wire stock butt
      barrelLen = 0.58;
      barrelY = 0.008;
      support = [0, -0.075, 0.20]; // vertical foregrip
      break;
    }
    // --- M500 "Breacher": fat barrel, tube magazine, ribbed pump, wood stock.
    case 'shotgun': {
      box(accent, 0, 0, 0.08, 0.078, 0.115, 0.42); // steel receiver
      box(metal, 0, 0.02, 0.36, 0.05, 0.03, 0.1); // ejection port shadow
      tube(metal, 0, 0.032, 0.5, 0.058, 0.56); // barrel
      tube(metal, 0, -0.03, 0.45, 0.048, 0.5); // tube magazine
      box(metal, 0, 0.062, 0.5, 0.062, 0.02, 0.36); // rib / heat shield
      box(body, 0, -0.03, 0.35, 0.08, 0.075, 0.2); // wood pump
      box(accent, 0, -0.03, 0.27, 0.084, 0.02, 0.02); // pump rib
      box(accent, 0, -0.03, 0.43, 0.084, 0.02, 0.02); // pump rib
      box(metal, 0, 0.082, 0.74, 0.016, 0.028, 0.02); // bead sight
      box(body, 0, -0.099, -0.02, 0.055, 0.12, 0.062); // grip
      box(body, 0, -0.035, -0.22, 0.06, 0.11, 0.2); // wood stock
      box(body, 0, 0.02, -0.24, 0.052, 0.04, 0.14); // comb
      box(metal, 0, -0.035, -0.33, 0.062, 0.12, 0.03); // butt pad
      barrelLen = 0.78;
      barrelY = 0.032;
      support = [0, -0.03, 0.30]; // pump handle
      break;
    }
    // --- LR-12 "Longeye": fluted barrel, suppressor, big optic, bipod, skeleton stock.
    case 'dmr': {
      box(body, 0, 0, 0.06, 0.066, 0.1, 0.5); // chassis receiver
      box(accent, 0, 0.056, 0.05, 0.034, 0.018, 0.44); // full-length rail
      tube(accent, 0, 0.128, 0.1, 0.062, 0.36); // scope tube
      tube(metal, 0, 0.128, 0.29, 0.075, 0.05); // objective bell
      box(metal, 0, 0.08, 0.04, 0.03, 0.05, 0.03); // front ring
      box(metal, 0, 0.08, 0.17, 0.03, 0.05, 0.03); // rear ring
      box(accent, 0, 0.152, 0.1, 0.03, 0.02, 0.1); // elevation turret
      tube(metal, 0, 0.012, 0.66, 0.038, 0.6); // long barrel
      tube(metal, 0, 0.012, 0.61, 0.05, 0.1); // barrel nut
      tube(accent, 0, 0.014, 1.0, 0.058, 0.22); // suppressor
      box(metal, 0, -0.075, 0.6, 0.024, 0.02, 0.24); // bipod hinge
      box(metal, 0.055, -0.15, 0.62, 0.02, 0.17, 0.02, 0.42); // bipod leg R
      box(metal, -0.055, -0.15, 0.62, 0.02, 0.17, 0.02, 0.42); // bipod leg L
      box(accent, 0, -0.13, 0.02, 0.045, 0.12, 0.07); // straight magazine
      box(body, 0, -0.105, -0.06, 0.05, 0.13, 0.062); // grip
      box(body, 0, -0.06, -0.24, 0.05, 0.09, 0.24); // skeleton stock
      box(body, 0, 0.005, -0.26, 0.048, 0.035, 0.16); // cheek riser
      box(metal, 0, -0.06, -0.37, 0.056, 0.11, 0.025); // butt pad
      barrelLen = 1.12;
      barrelY = 0.014;
      support = [0, -0.015, 0.34]; // handguard, support arm extended
      break;
    }
    // --- P9 "Sidearm": slide with serrations, compensated barrel, small grip.
    case 'pistol': {
      box(metal, 0, 0.04, 0.07, 0.045, 0.062, 0.21); // slide
      box(accent, 0, 0.04, -0.022, 0.046, 0.062, 0.014); // rear serration
      box(accent, 0, 0.04, -0.004, 0.046, 0.062, 0.012); // serration
      box(body, 0, 0.006, 0.03, 0.04, 0.05, 0.17); // frame
      tube(metal, 0, 0.04, 0.18, 0.03, 0.04); // barrel tip
      box(accent, 0, 0.042, 0.2, 0.05, 0.048, 0.05); // compensator
      box(body, 0, -0.062, -0.03, 0.045, 0.13, 0.062, 0.18); // grip
      box(body, 0, -0.03, 0.005, 0.03, 0.016, 0.07); // trigger guard
      box(metal, 0, 0.075, 0.15, 0.012, 0.022, 0.02); // front sight
      box(metal, 0, 0.075, -0.01, 0.03, 0.022, 0.02); // rear sight
      barrelLen = 0.24;
      barrelY = 0.04;
      support = [-0.03, -0.055, -0.02];
      break;
    }
  }

  // Magazine socket (visual reference for reload dips).
  const mag = new THREE.Object3D();
  mag.position.set(0, -0.14, 0.16);
  group.add(mag);

  // Muzzle socket at the barrel tip (VFX + ballistics origin).
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, barrelY, barrelLen);
  group.add(muzzle);

  return { group, muzzle, mag, grip: { support, barrelLen } };
}

/** Test/debug hook: how many parts each weapon mesh is built from. */
export function weaponPartCounts(mats: MaterialLib, geos: GeometryLib): Record<WeaponId, number> {
  const ids: WeaponId[] = ['rifle', 'smg', 'shotgun', 'dmr', 'pistol'];
  const out = {} as Record<WeaponId, number>;
  for (const id of ids) out[id] = buildWeaponMesh(id, mats, geos).group.children.length;
  return out;
}
