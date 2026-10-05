import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/** Merge static render meshes, retaining exact invisible volumes for occlusion queries. */
export function batchEnvironment(
  root: THREE.Group,
  colliders: THREE.Mesh[],
): THREE.BufferGeometry[] {
  root.updateMatrixWorld(true);
  const batches = new Map<
    string,
    {
      material: THREE.Material;
      cast: boolean;
      receive: boolean;
      geometries: THREE.BufferGeometry[];
      sources: THREE.Mesh[];
    }
  >();
  root.traverse((object) => {
    if (
      !(object instanceof THREE.Mesh) ||
      !object.visible ||
      object.userData.mutable ||
      Array.isArray(object.material)
    )
      return;
    const key = `${object.material.uuid}-${Number(object.castShadow)}-${Number(object.receiveShadow)}`;
    let batch = batches.get(key);
    if (!batch) {
      batch = {
        material: object.material,
        cast: object.castShadow,
        receive: object.receiveShadow,
        geometries: [],
        sources: [],
      };
      batches.set(key, batch);
    }
    batch.geometries.push(object.geometry.clone().applyMatrix4(object.matrixWorld));
    batch.sources.push(object);
  });
  const kept = new Set(colliders),
    merged: THREE.BufferGeometry[] = [];
  for (const batch of batches.values()) {
    const geometry = mergeGeometries(batch.geometries, false);
    batch.geometries.forEach((g) => g.dispose());
    if (!geometry) continue;
    const mesh = new THREE.Mesh(geometry, batch.material);
    mesh.castShadow = batch.cast;
    mesh.receiveShadow = batch.receive;
    for (const source of batch.sources) {
      if (kept.has(source)) source.visible = false;
      else source.removeFromParent();
    }
    root.add(mesh);
    merged.push(geometry);
  }
  return merged;
}

/** Batch only direct children, preserving independently animated limbs. */
export function batchSoldierPart(parent: THREE.Group): THREE.BufferGeometry[] {
  const batches = new Map<THREE.Material, THREE.Mesh[]>();
  for (const child of parent.children)
    if (child instanceof THREE.Mesh && !Array.isArray(child.material)) {
      const list = batches.get(child.material) ?? [];
      list.push(child);
      batches.set(child.material, list);
    }
  const result: THREE.BufferGeometry[] = [];
  for (const [material, meshes] of batches) {
    if (meshes.length < 2) continue;
    // Extruded firearm profiles are non-indexed, while capsules/boxes are
    // indexed. Normalize a mixed batch instead of failing and leaving every
    // small detail as an individual draw call.
    const indexed = meshes.every((m) => m.geometry.index !== null);
    const parts = meshes.map((m) => {
      m.updateMatrix();
      let geometry = m.geometry.clone().applyMatrix4(m.matrix);
      if (!indexed && geometry.index) {
        const converted = geometry.toNonIndexed();
        geometry.dispose();
        geometry = converted;
      }
      return geometry;
    });
    const geometry = mergeGeometries(parts, false);
    parts.forEach((p) => p.dispose());
    if (!geometry) continue;
    meshes.forEach((m) => m.removeFromParent());
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true;
    parent.add(mesh);
    result.push(geometry);
  }
  return result;
}
