import * as THREE from 'three';
import type { GameConfig, Obstacle } from '../multiplayer/protocol';
import { batchEnvironment } from './batching';

function surface(kind: 'concrete' | 'asphalt' | 'metal' | 'wood'): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  const image = ctx.createImageData(256, 256);
  let seed = 71239;
  const rand = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 0xffffffff;
  };
  for (let i = 0; i < image.data.length; i += 4) {
    const base = kind === 'asphalt' ? 130 : 205;
    const noise = (rand() - 0.5) * (kind === 'asphalt' ? 55 : 30);
    image.data[i] = image.data[i + 1] = image.data[i + 2] = base + noise;
    image.data[i + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
  if (kind === 'metal') {
    for (let x = 0; x < 256; x += 18) {
      ctx.fillStyle = '#939790';
      ctx.fillRect(x, 0, 3, 256);
      ctx.fillStyle = '#e7e8e3';
      ctx.fillRect(x + 3, 0, 2, 256);
    }
  } else if (kind === 'wood') {
    ctx.strokeStyle = '#888977';
    ctx.lineWidth = 2;
    for (let y = 0; y < 256; y += 32) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(256, y + 2);
      ctx.stroke();
    }
  } else if (kind === 'concrete') {
    ctx.strokeStyle = '#b5b4a8';
    ctx.lineWidth = 1;
    for (let i = 0; i < 8; i++) {
      ctx.beginPath();
      ctx.moveTo(rand() * 256, rand() * 256);
      ctx.lineTo(rand() * 256, rand() * 256);
      ctx.stroke();
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = 4;
  return texture;
}

export class Environment {
  readonly group = new THREE.Group();
  readonly colliders: THREE.Mesh[] = [];
  private mutable = new Map<string, THREE.Object3D[]>();
  private destroyed = new Set<string>();
  private boxGeometry = new THREE.BoxGeometry(1, 1, 1);
  private textures = {
    concrete: surface('concrete'),
    asphalt: surface('asphalt'),
    metal: surface('metal'),
    wood: surface('wood'),
  };
  private materials = {
    concrete: new THREE.MeshStandardMaterial({
      color: '#aaa999',
      map: this.textures.concrete,
      roughness: 0.95,
    }),
    darkConcrete: new THREE.MeshStandardMaterial({
      color: '#888e86',
      map: this.textures.concrete,
      roughness: 0.95,
    }),
    asphalt: new THREE.MeshStandardMaterial({
      color: '#757d75',
      map: this.textures.asphalt,
      roughness: 1,
    }),
    metal: new THREE.MeshStandardMaterial({
      color: '#596553',
      map: this.textures.metal,
      roughness: 0.7,
      metalness: 0.25,
    }),
    grayMetal: new THREE.MeshStandardMaterial({
      color: '#657476',
      map: this.textures.metal,
      roughness: 0.75,
      metalness: 0.25,
    }),
    wood: new THREE.MeshStandardMaterial({
      color: '#988b65',
      map: this.textures.wood,
      roughness: 0.9,
    }),
    olive: new THREE.MeshStandardMaterial({ color: '#62694d', roughness: 0.9 }),
    dark: new THREE.MeshStandardMaterial({ color: '#282e2b', roughness: 0.75 }),
    window: new THREE.MeshStandardMaterial({ color: '#283834', roughness: 0.3, metalness: 0.3 }),
    paint: new THREE.MeshStandardMaterial({ color: '#c0baa5', roughness: 0.95 }),
    sand: new THREE.MeshStandardMaterial({
      color: '#9a9275',
      map: this.textures.concrete,
      roughness: 1,
    }),
  };
  private extraGeometry: THREE.BufferGeometry[] = [];
  private extraMaterials: THREE.Material[] = [];
  private extraTextures: THREE.Texture[] = [];

  constructor(config: GameConfig) {
    const theme = config.map.theme;
    if (theme) {
      this.materials.concrete.color.set(theme.ground);
      this.materials.asphalt.color.set(theme.road);
      this.materials.metal.color.set(theme.metal);
      this.materials.paint.color.set(theme.trim);
      this.materials.darkConcrete.color.set(theme.ground).multiplyScalar(0.78);
      this.materials.olive.color.set(theme.ground).multiplyScalar(0.65);
    }
    const surround = this.box(120, 0.15, 120, 0, -0.2, 0, this.materials.olive);
    surround.receiveShadow = true;
    const floor = this.box(44, 0.12, 44, 0, -0.065, 0, this.materials.concrete);
    floor.receiveShadow = true;
    for (const x of [0, -13.7, 13.7]) {
      this.box(x === 0 ? 9.5 : 4.5, 0.015, 43.4, x, 0.01, 0, this.materials.asphalt).receiveShadow =
        true;
    }
    for (let z = -15; z <= 15; z += 4) {
      this.box(0.09, 0.012, 1.4, 4.15, 0.025, z, this.materials.paint);
      this.box(0.09, 0.012, 1.4, -4.15, 0.025, z, this.materials.paint);
    }
    for (const o of config.map.obstacles) {
      const before = new Set(this.group.children);
      this.obstacle(o);
      if (o.kind === 'crate' || o.kind === 'sandbags') {
        const meshes = this.group.children.filter((child) => !before.has(child));
        meshes.forEach((mesh) => {
          mesh.userData.mutable = true;
          mesh.userData.coverId = o.id;
          mesh.userData.initialVisible = mesh.visible;
        });
        this.mutable.set(o.id, meshes);
      }
    }
    for (const x of [-22.05, 22.05])
      this.colliders.push(this.box(0.3, 1.9, 44.4, x, 0.95, 0, this.materials.darkConcrete));
    for (const z of [-22.05, 22.05])
      this.colliders.push(this.box(44.4, 1.9, 0.3, 0, 0.95, z, this.materials.darkConcrete));
    for (const [team, z, text, color] of [
      ['blue', 19.5, 'B // STAGING', '#6d91ad'],
      ['red', -19.5, 'R // STAGING', '#b0776c'],
    ] as const) {
      const material = new THREE.MeshStandardMaterial({ color, roughness: 1 });
      this.extraMaterials.push(material);
      this.box(11, 0.015, 0.09, 0, 0.02, z - (team === 'blue' ? 2.2 : -2.2), material);
      this.groundText(text, 0, z, color, 6, 1.2, team === 'red' ? Math.PI : 0);
    }
    this.groundText(config.map.sector, 0, -11, '#b9b6a5', 2.5, 2.5, 0);
    this.groundText(config.map.name, 0, 12, '#b9b6a5', 4.5, 1, 0);
    // Utilities sit outside the playable boundary, never mistaken for cover.
    for (const x of [-24.5, 24.5])
      for (const z of [-17, 1, 17]) {
        this.box(0.2, 7, 0.2, x, 3.5, z, this.materials.dark);
        this.box(3, 0.15, 0.15, x, 6.4, z, this.materials.dark);
      }
    this.extraGeometry.push(...batchEnvironment(this.group, this.colliders));
  }
  private box(
    w: number,
    h: number,
    d: number,
    x: number,
    y: number,
    z: number,
    mat: THREE.Material,
    parent: THREE.Group = this.group,
  ): THREE.Mesh {
    const mesh = new THREE.Mesh(this.boxGeometry, mat);
    mesh.scale.set(w, h, d);
    mesh.position.set(x, y, z);
    mesh.castShadow = h > 0.2;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }
  private obstacle(o: Obstacle): void {
    const mat = o.tone === 'sand' ? this.materials.concrete : this.materials.darkConcrete;
    if (o.kind === 'building') {
      this.colliders.push(this.box(o.w, o.h, o.d, o.x, o.h / 2, o.z, mat));
      this.box(o.w + 0.15, 0.2, o.d + 0.15, o.x, o.h, o.z, this.materials.concrete);
      this.box(1.3, 0.65, 1.4, o.x + 0.5, o.h + 0.4, o.z, this.materials.grayMetal);
      for (const sign of [-1, 1])
        for (let z = -o.d / 2 + 1.5; z < o.d / 2; z += 2.2) {
          this.box(
            0.04,
            1.0,
            0.85,
            o.x + sign * (o.w / 2 + 0.03),
            2.1,
            o.z + z,
            this.materials.window,
          );
          this.box(
            0.12,
            0.08,
            1.05,
            o.x + sign * (o.w / 2 + 0.03),
            1.58,
            o.z + z,
            this.materials.concrete,
          );
        }
      this.box(1.1, 2.1, 0.03, o.x, 1.05, o.z + o.d / 2 + 0.02, this.materials.dark);
    } else if (o.kind === 'container') {
      const metal = o.tone === 'olive' ? this.materials.metal : this.materials.grayMetal;
      this.colliders.push(this.box(o.w, o.h, o.d, o.x, o.h / 2, o.z, metal));
      this.box(o.w + 0.1, 0.12, o.d + 0.1, o.x, o.h, o.z, metal);
      for (const x of [-o.w / 2 + 0.12, 0, o.w / 2 - 0.12]) {
        this.box(
          0.08,
          o.h - 0.16,
          0.08,
          o.x + x,
          o.h / 2,
          o.z + o.d / 2 + 0.05,
          this.materials.dark,
        );
      }
      this.box(o.w - 0.15, 0.08, 0.08, o.x, 0.25, o.z + o.d / 2 + 0.04, this.materials.dark);
    } else if (o.kind === 'crate') {
      const material = o.tone === 'olive' ? this.materials.olive : this.materials.wood;
      this.colliders.push(this.box(o.w, o.h, o.d, o.x, o.h / 2, o.z, material));
      for (const x of [-o.w / 3, o.w / 3])
        this.box(0.09, o.h + 0.03, o.d + 0.04, o.x + x, o.h / 2, o.z, this.materials.dark);
      this.box(o.w + 0.04, 0.09, o.d + 0.04, o.x, 0.13, o.z, this.materials.dark);
    } else if (o.kind === 'vehicle') {
      const parent = new THREE.Group();
      parent.position.set(o.x, 0, o.z);
      this.group.add(parent);
      const paint = o.tone === 'olive' ? this.materials.olive : this.materials.sand;
      // Invisible raycast volume exactly matches authoritative footprint.
      const volume = this.box(o.w, o.h, o.d, 0, o.h / 2, 0, paint, parent);
      volume.visible = false;
      this.colliders.push(volume);
      this.box(o.w * 0.9, 0.45, o.d * 0.95, 0, 0.65, 0, paint, parent);
      this.box(o.w * 0.83, 0.65, o.d * 0.42, 0, 1.18, 0.25, paint, parent);
      this.box(o.w * 0.8, 0.4, 0.02, 0, 1.2, -o.d * 0.14, this.materials.window, parent);
      for (const side of [-1, 1])
        this.box(
          0.03,
          0.4,
          o.d * 0.28,
          side * o.w * 0.425,
          1.2,
          0.25,
          this.materials.window,
          parent,
        );
      this.box(o.w * 0.84, 0.12, o.d * 0.44, 0, 1.54, 0.25, paint, parent);
      this.box(o.w * 0.95, 0.18, 0.15, 0, 0.5, -o.d / 2, this.materials.dark, parent);
      const geometry = new THREE.CylinderGeometry(0.39, 0.39, 0.26, 10);
      this.extraGeometry.push(geometry);
      for (const x of [-o.w / 2 + 0.08, o.w / 2 - 0.08])
        for (const z of [-o.d / 3, o.d / 3]) {
          const wheel = new THREE.Mesh(geometry, this.materials.dark);
          wheel.rotation.z = Math.PI / 2;
          wheel.position.set(x, 0.4, z);
          wheel.castShadow = true;
          parent.add(wheel);
        }
    } else if (o.kind === 'sandbags') {
      const geometry = new THREE.SphereGeometry(1, 8, 5);
      this.extraGeometry.push(geometry);
      const collider = this.box(o.w, o.h, o.d, o.x, o.h / 2, o.z, this.materials.sand);
      collider.visible = false;
      this.colliders.push(collider);
      for (let row = 0; row < 3; row++)
        for (let col = 0; col < 4; col++) {
          const bag = new THREE.Mesh(geometry, this.materials.sand);
          bag.scale.set(o.w / 7.8, 0.16, o.d / 2);
          bag.position.set(
            o.x - o.w / 2 + o.w / 8 + (col * o.w) / 4,
            0.16 + row * 0.26,
            o.z + (row % 2 ? 0.04 : -0.04),
          );
          bag.castShadow = true;
          bag.receiveShadow = true;
          this.group.add(bag);
        }
    } else {
      this.colliders.push(this.box(o.w, o.h, o.d, o.x, o.h / 2, o.z, mat));
      this.box(o.w + 0.08, 0.13, o.d + 0.08, o.x, o.h + 0.015, o.z, this.materials.concrete);
      if (o.kind === 'barrier')
        this.box(o.w + 0.18, 0.18, o.d + 0.3, o.x, 0.09, o.z, this.materials.darkConcrete);
    }
  }
  private groundText(
    text: string,
    x: number,
    z: number,
    color: string,
    w: number,
    d: number,
    rotation: number,
  ): void {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 128;
    const ctx = canvas.getContext('2d')!;
    ctx.font = 'bold 70px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = color;
    ctx.fillText(text, 256, 64);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    this.extraTextures.push(texture);
    const mat = new THREE.MeshStandardMaterial({
      map: texture,
      transparent: true,
      depthWrite: false,
      roughness: 1,
    });
    this.extraMaterials.push(mat);
    const geom = new THREE.PlaneGeometry(w, d);
    this.extraGeometry.push(geom);
    const mesh = new THREE.Mesh(geom, mat);
    mesh.rotation.set(-Math.PI / 2, 0, rotation);
    mesh.position.set(x, 0.035, z);
    this.group.add(mesh);
  }
  setDestroyed(ids: string[]): void {
    this.destroyed = new Set(ids);
    for (const [id, meshes] of this.mutable)
      for (const mesh of meshes)
        mesh.visible = Boolean(mesh.userData.initialVisible) && !this.destroyed.has(id);
  }
  get activeColliders(): THREE.Mesh[] {
    return this.colliders.filter((m) => !this.destroyed.has(m.userData.coverId as string));
  }
  dispose(): void {
    this.boxGeometry.dispose();
    Object.values(this.materials).forEach((m) => m.dispose());
    Object.values(this.textures).forEach((t) => t.dispose());
    this.extraGeometry.forEach((g) => g.dispose());
    this.extraMaterials.forEach((m) => m.dispose());
    this.extraTextures.forEach((t) => t.dispose());
  }
}
