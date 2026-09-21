// Reusable material library — grounded military/urban palette.
// Shared geometries + materials keep draw calls and memory bounded.
import * as THREE from 'three';

export interface MaterialLib {
  ground: THREE.MeshStandardMaterial;
  asphalt: THREE.MeshStandardMaterial;
  concrete: THREE.MeshStandardMaterial;
  concreteDark: THREE.MeshStandardMaterial;
  concretePainted: THREE.MeshStandardMaterial;
  concretePainted2: THREE.MeshStandardMaterial;
  metal: THREE.MeshStandardMaterial;
  metalDark: THREE.MeshStandardMaterial;
  paintedMetal: THREE.MeshStandardMaterial;
  paintedMetalGreen: THREE.MeshStandardMaterial;
  wood: THREE.MeshStandardMaterial;
  glass: THREE.MeshStandardMaterial;
  rubber: THREE.MeshStandardMaterial;
  fabricTan: THREE.MeshStandardMaterial;
  fabricGreen: THREE.MeshStandardMaterial;
  fabricDark: THREE.MeshStandardMaterial;
  weaponPolymer: THREE.MeshStandardMaterial;
  weaponMetal: THREE.MeshStandardMaterial;
  dirt: THREE.MeshStandardMaterial;
  sandbag: THREE.MeshStandardMaterial;
  crate: THREE.MeshStandardMaterial;
  barrelRust: THREE.MeshStandardMaterial;
  barrelBlue: THREE.MeshStandardMaterial;
  accent: THREE.MeshStandardMaterial;
  lampEmissive: THREE.MeshStandardMaterial;
  white: THREE.MeshStandardMaterial;
}

function std(color: number, roughness: number, metalness: number, extra?: Partial<THREE.MeshStandardMaterialParameters>): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness, ...extra });
}

export function createMaterials(): MaterialLib {
  return {
    ground: std(0x3a3d40, 0.96, 0.0),
    asphalt: std(0x2c2e31, 0.97, 0.0),
    concrete: std(0x8d8d89, 0.9, 0.02),
    concreteDark: std(0x5c5e60, 0.92, 0.03),
    concretePainted: std(0x7a7f6a, 0.85, 0.02),
    concretePainted2: std(0x6b6f7d, 0.85, 0.02),
    metal: std(0x777d85, 0.45, 0.75),
    metalDark: std(0x3a3e44, 0.55, 0.7),
    paintedMetal: std(0x4e5a52, 0.6, 0.35),
    paintedMetalGreen: std(0x44523e, 0.62, 0.3),
    wood: std(0x7a5c3a, 0.8, 0.05),
    glass: std(0x9fb6c4, 0.15, 0.1, { transparent: true, opacity: 0.55 }),
    rubber: std(0x1d1e20, 0.9, 0.0),
    fabricTan: std(0x8a7d5f, 0.95, 0.0),
    fabricGreen: std(0x4c5744, 0.95, 0.0),
    fabricDark: std(0x2b2e33, 0.95, 0.0),
    weaponPolymer: std(0x232527, 0.7, 0.2),
    weaponMetal: std(0x3d4147, 0.4, 0.8),
    dirt: std(0x4a4136, 1.0, 0.0),
    sandbag: std(0x9a8b64, 0.95, 0.0),
    crate: std(0x6e5b36, 0.85, 0.05),
    barrelRust: std(0x7a4526, 0.7, 0.4),
    barrelBlue: std(0x2e4a5a, 0.6, 0.45),
    accent: std(0xc9a227, 0.6, 0.3),
    lampEmissive: std(0xffd9a0, 0.4, 0.0, { emissive: 0xffc37a, emissiveIntensity: 1.6 }),
    white: std(0xd8d8d4, 0.8, 0.02),
  };
}

// Shared unit geometries — scaled per-mesh via mesh.scale.
export interface GeometryLib {
  box: THREE.BoxGeometry;
  cylinder: THREE.CylinderGeometry;
  sphere: THREE.SphereGeometry;
  plane: THREE.PlaneGeometry;
}

export function createGeometries(): GeometryLib {
  return {
    box: new THREE.BoxGeometry(1, 1, 1),
    cylinder: new THREE.CylinderGeometry(0.5, 0.5, 1, 10),
    sphere: new THREE.SphereGeometry(0.5, 12, 10),
    plane: new THREE.PlaneGeometry(1, 1),
  };
}

export function disposeMaterials(m: MaterialLib): void {
  Object.values(m).forEach((mat) => mat.dispose());
}

export function disposeGeometries(g: GeometryLib): void {
  Object.values(g).forEach((geo) => geo.dispose());
}
