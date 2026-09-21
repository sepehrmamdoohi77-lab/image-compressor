// Reusable material library — grounded military/urban palette.
// Shared geometries + materials keep draw calls and memory bounded.
//
// Graphics quality: surface detail is generated procedurally on 2D canvases
// (concrete aggregate, asphalt grit, panel lines, sandbag weave, crate grain and
// wall stains). No external assets, no network, and one shared texture per
// surface family, so the extra detail costs almost nothing at runtime.
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

export interface TextureLib {
  concrete: THREE.Texture;
  asphalt: THREE.Texture;
  dirt: THREE.Texture;
  metal: THREE.Texture;
  sandbag: THREE.Texture;
  wood: THREE.Texture;
  /** Equirectangular dusk sky (background + image-based lighting source). */
  sky: THREE.Texture;
}

function std(color: number, roughness: number, metalness: number, extra?: Partial<THREE.MeshStandardMaterialParameters>): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness, ...extra });
}

// --- procedural texture baking ----------------------------------------------------
function canvas2d(size: number): { c: HTMLCanvasElement; g: CanvasRenderingContext2D } | null {
  if (typeof document === 'undefined') return null;
  try {
    const c = document.createElement('canvas');
    c.width = size;
    c.height = size;
    const g = c.getContext('2d');
    if (!g) return null;
    return { c, g };
  } catch {
    return null;
  }
}

/** Cheap value noise: deterministic per pixel, no Math.random in the bake. */
function hash2(x: number, y: number, seed: number): number {
  const n = Math.sin(x * 127.1 + y * 311.7 + seed * 74.7) * 43758.5453;
  return n - Math.floor(n);
}

function grainy(g: CanvasRenderingContext2D, size: number, base: number, contrast: number, seed: number, blobs = 0): void {
  const img = g.createImageData(size, size);
  const d = img.data;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let v = hash2(x, y, seed) * contrast + hash2(x >> 2, y >> 2, seed + 3) * contrast * 0.6;
      v += hash2(x >> 5, y >> 5, seed + 11) * contrast * 0.9;
      const lum = Math.max(0, Math.min(255, base + (v - contrast) * 90));
      const i = (y * size + x) * 4;
      d[i] = lum; d[i + 1] = lum; d[i + 2] = lum; d[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  // Aggregate/blotches.
  for (let i = 0; i < blobs; i++) {
    const r = 2 + hash2(i, 7, seed + 5) * Math.max(2, size * 0.05);
    const x = hash2(i, 1, seed + 9) * size;
    const y = hash2(i, 2, seed + 13) * size;
    const a = 0.05 + hash2(i, 3, seed + 17) * 0.12;
    g.fillStyle = hash2(i, 4, seed + 19) > 0.5 ? `rgba(255,255,255,${a})` : `rgba(0,0,0,${a})`;
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
  }
}

function toTexture(c: HTMLCanvasElement, repeat: number, srgb = true): THREE.Texture {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.anisotropy = 4;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

/**
 * Bake all surface textures. Returns null when there is no 2D canvas (headless
 * tests) — every consumer treats textures as optional.
 */
export function createTextures(): TextureLib | null {
  const concrete = canvas2d(256);
  if (!concrete) return null;
  try {
    // Concrete: fine aggregate + panel seams.
    grainy(concrete.g, 256, 168, 1, 1, 26);
    concrete.g.strokeStyle = 'rgba(0,0,0,0.20)';
    concrete.g.lineWidth = 2;
    for (let i = 0; i <= 2; i++) {
      const p = (i * 256) / 2;
      concrete.g.beginPath(); concrete.g.moveTo(p, 0); concrete.g.lineTo(p, 256); concrete.g.stroke();
      concrete.g.beginPath(); concrete.g.moveTo(0, p); concrete.g.lineTo(256, p); concrete.g.stroke();
    }
    // Old stains.
    for (let i = 0; i < 10; i++) {
      concrete.g.fillStyle = `rgba(40,36,30,${0.05 + hash2(i, 5, 3) * 0.08})`;
      concrete.g.beginPath();
      concrete.g.arc(hash2(i, 6, 2) * 256, hash2(i, 8, 4) * 256, 8 + hash2(i, 9, 6) * 40, 0, Math.PI * 2);
      concrete.g.fill();
    }

    // Asphalt: coarser grit with tar seams and patched repairs.
    const asph = canvas2d(256);
    if (!asph) return null;
    grainy(asph.g, 256, 92, 1.5, 21, 40);
    asph.g.fillStyle = 'rgba(0,0,0,0.35)';
    for (let i = 0; i < 12; i++) {
      asph.g.save();
      asph.g.translate(hash2(i, 1, 31) * 256, hash2(i, 2, 33) * 256);
      asph.g.rotate(hash2(i, 3, 35) * Math.PI);
      asph.g.fillRect(-30, -1.5, 60, 3);
      asph.g.restore();
    }
    for (let i = 0; i < 6; i++) {
      asph.g.fillStyle = `rgba(190,188,182,${0.05 + hash2(i, 4, 37) * 0.07})`;
      asph.g.fillRect(hash2(i, 5, 39) * 220, hash2(i, 6, 41) * 220, 20 + hash2(i, 7, 43) * 40, 14 + hash2(i, 8, 45) * 30);
    }

    // Dirt / gravel: warm, chunky.
    const dirt = canvas2d(256);
    if (!dirt) return null;
    grainy(dirt.g, 256, 120, 1.8, 61, 60);
    for (let i = 0; i < 90; i++) {
      dirt.g.fillStyle = `rgba(60,48,36,${0.1 + hash2(i, 1, 63) * 0.2})`;
      dirt.g.beginPath();
      dirt.g.arc(hash2(i, 2, 65) * 256, hash2(i, 3, 67) * 256, 1 + hash2(i, 4, 69) * 3.5, 0, Math.PI * 2);
      dirt.g.fill();
    }

    // Scuffed painted metal: brushed streaks + edge wear.
    const metal = canvas2d(256);
    if (!metal) return null;
    metal.g.fillStyle = 'rgb(190,196,204)';
    metal.g.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 700; i++) {
      const y = hash2(i, 1, 71) * 256;
      const a = 0.02 + hash2(i, 2, 73) * 0.08;
      metal.g.strokeStyle = hash2(i, 3, 75) > 0.5 ? `rgba(255,255,255,${a})` : `rgba(0,0,0,${a})`;
      metal.g.lineWidth = 1;
      metal.g.beginPath();
      metal.g.moveTo(0, y);
      metal.g.lineTo(256, y + (hash2(i, 4, 77) - 0.5) * 4);
      metal.g.stroke();
    }
    for (let i = 0; i < 14; i++) {
      metal.g.fillStyle = `rgba(120,90,60,${0.05 + hash2(i, 5, 79) * 0.1})`; // rust bloom
      metal.g.beginPath();
      metal.g.arc(hash2(i, 6, 81) * 256, hash2(i, 7, 83) * 256, 4 + hash2(i, 8, 85) * 18, 0, Math.PI * 2);
      metal.g.fill();
    }

    // Sandbag / hessian weave.
    const sand = canvas2d(128);
    if (!sand) return null;
    sand.g.fillStyle = 'rgb(206,192,158)';
    sand.g.fillRect(0, 0, 128, 128);
    for (let x = 0; x < 128; x += 4) {
      sand.g.fillStyle = x % 8 === 0 ? 'rgba(0,0,0,0.12)' : 'rgba(255,255,255,0.10)';
      sand.g.fillRect(x, 0, 2, 128);
    }
    for (let y = 0; y < 128; y += 4) {
      sand.g.fillStyle = y % 8 === 0 ? 'rgba(0,0,0,0.10)' : 'rgba(255,255,255,0.08)';
      sand.g.fillRect(0, y, 128, 2);
    }

    // Crate / plank wood grain.
    const wood = canvas2d(128);
    if (!wood) return null;
    wood.g.fillStyle = 'rgb(160,124,78)';
    wood.g.fillRect(0, 0, 128, 128);
    for (let i = 0; i < 60; i++) {
      const y = hash2(i, 1, 91) * 128;
      wood.g.strokeStyle = `rgba(90,62,34,${0.1 + hash2(i, 2, 93) * 0.25})`;
      wood.g.lineWidth = 0.6 + hash2(i, 3, 95) * 2;
      wood.g.beginPath();
      wood.g.moveTo(0, y);
      wood.g.bezierCurveTo(42, y + 3, 86, y - 3, 128, y + (hash2(i, 4, 97) - 0.5) * 6);
      wood.g.stroke();
    }
    for (let i = 0; i < 5; i++) {
      wood.g.fillStyle = 'rgba(70,48,26,0.35)'; // knots
      wood.g.beginPath();
      wood.g.arc(hash2(i, 5, 99) * 128, hash2(i, 6, 101) * 128, 2 + hash2(i, 7, 103) * 4, 0, Math.PI * 2);
      wood.g.fill();
    }

    // Dusk sky: equirect gradient + sun glow + horizon haze band.
    const skyCanvas = typeof document !== 'undefined' ? document.createElement('canvas') : null;
    if (!skyCanvas) return null;
    skyCanvas.width = 512;
    skyCanvas.height = 256;
    const sg = skyCanvas.getContext('2d');
    if (!sg) return null;
    const grad = sg.createLinearGradient(0, 0, 0, 256);
    grad.addColorStop(0, '#0d1a2c');
    grad.addColorStop(0.42, '#27415f');
    grad.addColorStop(0.62, '#7d6a58');
    grad.addColorStop(0.72, '#c98f52');
    grad.addColorStop(0.82, '#3b3a3c');
    grad.addColorStop(1, '#14171a');
    sg.fillStyle = grad;
    sg.fillRect(0, 0, 512, 256);
    const sun = sg.createRadialGradient(150, 178, 4, 150, 178, 120);
    sun.addColorStop(0, 'rgba(255,226,178,0.95)');
    sun.addColorStop(0.35, 'rgba(255,178,110,0.35)');
    sun.addColorStop(1, 'rgba(255,150,80,0)');
    sg.fillStyle = sun;
    sg.fillRect(0, 0, 512, 256);

    return {
      concrete: toTexture(concrete.c, 6),
      asphalt: toTexture(asph.c, 24),
      dirt: toTexture(dirt.c, 8),
      metal: toTexture(metal.c, 4),
      sandbag: toTexture(sand.c, 3),
      wood: toTexture(wood.c, 2),
      sky: (() => {
        const t = new THREE.CanvasTexture(skyCanvas);
        t.mapping = THREE.EquirectangularReflectionMapping;
        t.colorSpace = THREE.SRGBColorSpace;
        t.needsUpdate = true;
        return t;
      })(),
    };
  } catch {
    // Any canvas API gap (headless / restricted) degrades to untextured flat
    // materials instead of breaking the boot.
    return null;
  }
}

export function createMaterials(textures: TextureLib | null = createTextures()): MaterialLib {
  const t = textures;
  /** Detail map helper: albedo + matching roughness relief. */
  const mapped = (
    color: number, roughness: number, metalness: number, map: THREE.Texture | undefined, bump = 0,
  ): THREE.MeshStandardMaterial => {
    if (!map) return std(color, roughness, metalness);
    return std(color, roughness, metalness, {
      map,
      roughnessMap: bump > 0 ? map : null,
      bumpMap: bump > 0 ? map : null,
      bumpScale: bump,
    });
  };
  // Base colours are tints: the procedural albedo carries the detail and hue.
  return {
    ground: mapped(0xb9bcc0, 0.9, 0.02, t?.concrete, 0.012),
    asphalt: mapped(0x8f9296, 0.94, 0.01, t?.asphalt, 0.014),
    concrete: mapped(0xf0efe8, 0.88, 0.02, t?.concrete, 0.01),
    concreteDark: mapped(0xb8bac0, 0.9, 0.03, t?.concrete, 0.008),
    concretePainted: mapped(0xd8dcc0, 0.85, 0.02, t?.concrete, 0.008),
    concretePainted2: mapped(0xc8cce0, 0.85, 0.02, t?.concrete, 0.008),
    metal: mapped(0xe8ecf0, 0.42, 0.72, t?.metal, 0.004),
    metalDark: mapped(0x9aa0a8, 0.5, 0.7, t?.metal, 0.004),
    paintedMetal: mapped(0xa8b3a4, 0.6, 0.35, t?.metal, 0.004),
    paintedMetalGreen: mapped(0x93a08a, 0.62, 0.3, t?.metal, 0.004),
    wood: mapped(0xe8dcc0, 0.78, 0.05, t?.wood, 0.008),
    glass: std(0x9fb6c4, 0.15, 0.1, { transparent: true, opacity: 0.55 }),
    rubber: std(0x1d1e20, 0.9, 0.0),
    fabricTan: mapped(0xd8cfae, 0.95, 0.0, t?.sandbag, 0.006),
    fabricGreen: mapped(0x8f9c80, 0.95, 0.0, t?.sandbag, 0.006),
    fabricDark: mapped(0x5a5f66, 0.95, 0.0, t?.sandbag, 0.006),
    weaponPolymer: std(0x232527, 0.7, 0.2),
    weaponMetal: std(0x3d4147, 0.4, 0.8),
    dirt: mapped(0xdcc9a8, 1.0, 0.0, t?.dirt, 0.016),
    sandbag: mapped(0xd8cba4, 0.95, 0.0, t?.sandbag, 0.01),
    crate: mapped(0xd8c8a0, 0.85, 0.05, t?.wood, 0.008),
    barrelRust: mapped(0xc07a52, 0.72, 0.4, t?.metal, 0.006),
    barrelBlue: mapped(0x7aa0c0, 0.58, 0.45, t?.metal, 0.005),
    accent: std(0xc9a227, 0.6, 0.3),
    lampEmissive: std(0xffd9a0, 0.4, 0.0, { emissive: 0xffc37a, emissiveIntensity: 1.9 }),
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
    // Higher radial counts: barrels, poles and rings read as round up close.
    cylinder: new THREE.CylinderGeometry(0.5, 0.5, 1, 16),
    sphere: new THREE.SphereGeometry(0.5, 20, 14),
    plane: new THREE.PlaneGeometry(1, 1),
  };
}

export function disposeMaterials(m: MaterialLib): void {
  Object.values(m).forEach((mat) => mat.dispose());
}

export function disposeGeometries(g: GeometryLib): void {
  Object.values(g).forEach((geo) => geo.dispose());
}
