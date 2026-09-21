// Hand-designed tactical combat arena (~44x44m). Single source of truth for:
// collision grid, 3D obstacle boxes, cover points, spawn points, and meshes.
import * as THREE from 'three';
import { WORLD } from '../data/config';
import { type MaterialLib, type GeometryLib } from './Materials';
import { nearestOpenCell } from './Navigation';

export interface AABB {
  minX: number; maxX: number; minZ: number; maxZ: number; h: number;
}

export interface CoverPoint {
  x: number; z: number; nx: number; nz: number;
  kind: 'low' | 'high';
}

interface Rect {
  x0: number; z0: number; x1: number; z1: number;
  h: number;
  kind: 'wall' | 'low' | 'mid' | 'building';
}

const SIZE = WORLD.SIZE_CELLS;

export function cellToWorld(cx: number): number {
  return (cx - SIZE / 2 + 0.5) * WORLD.CELL;
}

export function worldToCell(w: number): number {
  return Math.floor(w / WORLD.CELL + SIZE / 2);
}

export class Level {
  group = new THREE.Group();
  grid = new Uint8Array(SIZE * SIZE); // 0 open, 1 blocked-high, 2 blocked-low
  obstacles: AABB[] = [];
  coverPoints: CoverPoint[] = [];
  playerSpawn = { x: 0, z: 0 };
  enemySpawns: { x: number; z: number }[] = [];
  boundsHalf = SIZE / 2 - 1.2;

  private mats: MaterialLib;
  private geos: GeometryLib;
  private meshes: THREE.Mesh[] = [];

  constructor(mats: MaterialLib, geos: GeometryLib) {
    this.mats = mats;
    this.geos = geos;
  }

  build(): void {
    this.buildGround();
    this.buildLayout();
    this.buildProps();
    this.buildDetails();
    this.generateCoverPoints();
    this.setupSpawns();
  }

  // ---- layout ---------------------------------------------------------------
  private rects: Rect[] = [];

  private addRect(x0: number, z0: number, x1: number, z1: number, h: number, kind: Rect['kind']): void {
    const ax = Math.min(x0, x1); const bx = Math.max(x0, x1);
    const az = Math.min(z0, z1); const bz = Math.max(z0, z1);
    this.rects.push({ x0: ax, z0: az, x1: bx, z1: bz, h, kind });
  }

  private buildLayout(): void {
    const W = 3.0; // wall height
    const B = 3.6; // building height
    const L = WORLD.LOW_COVER_HEIGHT;
    const M = WORLD.MID_COVER_HEIGHT;

    // Border walls (thickness 1 cell).
    this.addRect(0, 0, 43, 0, W + 0.4, 'wall');
    this.addRect(0, 43, 43, 43, W + 0.4, 'wall');
    this.addRect(0, 1, 0, 42, W + 0.4, 'wall');
    this.addRect(43, 1, 43, 42, W + 0.4, 'wall');

    // NW building "Barracks" (hollow, doors south x6-7 and east z7).
    this.addRect(4, 4, 10, 4, B, 'building');
    this.addRect(4, 5, 4, 10, B, 'building');
    this.addRect(10, 5, 10, 6, B, 'building');
    this.addRect(10, 8, 10, 10, B, 'building');
    this.addRect(4, 10, 5, 10, B, 'building');
    this.addRect(8, 10, 10, 10, B, 'building');

    // NE building "Armory" (hollow, doors south x36-37 and west z7).
    this.addRect(33, 4, 39, 4, B, 'building');
    this.addRect(39, 5, 39, 10, B, 'building');
    this.addRect(33, 5, 33, 6, B, 'building');
    this.addRect(33, 8, 33, 10, B, 'building');
    this.addRect(33, 10, 35, 10, B, 'building');
    this.addRect(38, 10, 39, 10, B, 'building');

    // SW warehouse "Depot" (hollow).
    this.addRect(4, 30, 6, 30, B, 'building');
    this.addRect(9, 30, 11, 30, B, 'building');
    this.addRect(4, 37, 6, 37, B, 'building');
    this.addRect(9, 37, 11, 37, B, 'building');
    this.addRect(4, 31, 4, 36, B, 'building');
    this.addRect(11, 31, 11, 33, B, 'building');
    this.addRect(11, 35, 11, 36, B, 'building');
    // interior crates
    this.addRect(6, 32, 7, 32, L, 'low');
    this.addRect(8, 35, 9, 35, L, 'low');

    // SE compound "Garage" (hollow).
    this.addRect(32, 30, 34, 30, B, 'building');
    this.addRect(37, 30, 39, 30, B, 'building');
    this.addRect(32, 37, 34, 37, B, 'building');
    this.addRect(37, 37, 39, 37, B, 'building');
    this.addRect(39, 31, 39, 36, B, 'building');
    this.addRect(32, 31, 32, 32, B, 'building');
    this.addRect(32, 34, 32, 36, B, 'building');
    // interior crates
    this.addRect(36, 32, 37, 32, L, 'low');
    this.addRect(34, 35, 35, 35, L, 'low');

    // West mid solid block + east mid solid block (flank routing around them).
    this.addRect(5, 17, 8, 19, B, 'building');
    this.addRect(35, 17, 38, 19, B, 'building');

    // Mid lane divider walls with gaps (chokepoints).
    this.addRect(13, 14, 13, 16, W, 'wall');
    this.addRect(13, 18, 13, 20, W, 'wall');
    this.addRect(30, 14, 30, 16, W, 'wall');
    this.addRect(30, 18, 30, 20, W, 'wall');
    this.addRect(13, 25, 13, 27, W, 'wall');
    this.addRect(30, 25, 30, 27, W, 'wall');

    // North checkpoint gate (avenue passes through x20-23).
    this.addRect(16, 12, 19, 12, W, 'wall');
    this.addRect(24, 12, 27, 12, W, 'wall');
    this.addRect(18, 14, 19, 14, M, 'mid');
    this.addRect(24, 14, 25, 14, M, 'mid');

    // Central plaza: diamond of mid covers + side crates, center stays open.
    this.addRect(19, 21, 20, 21, M, 'mid');
    this.addRect(23, 21, 24, 21, M, 'mid');
    this.addRect(21, 19, 22, 19, M, 'mid');
    this.addRect(21, 24, 22, 24, M, 'mid');
    this.addRect(18, 18, 18, 19, L, 'low');
    this.addRect(25, 18, 25, 19, L, 'low');
    this.addRect(18, 24, 18, 25, L, 'low');
    this.addRect(25, 24, 25, 25, L, 'low');

    // Mid-map side covers.
    this.addRect(15, 18, 16, 18, M, 'mid');
    this.addRect(27, 18, 28, 18, M, 'mid');
    this.addRect(15, 25, 16, 25, M, 'mid');
    this.addRect(27, 25, 28, 25, M, 'mid');

    // Cover chains on lanes.
    this.addRect(14, 24, 15, 24, L, 'low');
    this.addRect(14, 29, 15, 29, L, 'low');
    this.addRect(9, 24, 10, 24, L, 'low');
    this.addRect(28, 24, 29, 24, L, 'low');
    this.addRect(28, 29, 29, 29, L, 'low');
    this.addRect(33, 24, 34, 24, L, 'low');
    this.addRect(18, 7, 19, 7, L, 'low');
    this.addRect(24, 7, 25, 7, L, 'low');

    // South defensive line (player side).
    this.addRect(18, 33, 19, 33, M, 'mid');
    this.addRect(24, 25 - 0 + 8, 25, 33, M, 'mid'); // x24-25, z33
    this.addRect(21, 35, 22, 35, L, 'low');

    // Barrel / crate singles.
    this.addRect(12, 12, 12, 12, L, 'low');
    this.addRect(31, 12, 31, 12, L, 'low');
    this.addRect(12, 31, 12, 31, L, 'low');
    this.addRect(31, 31, 31, 31, L, 'low');
    this.addRect(2, 15, 2, 15, L, 'low');
    this.addRect(41, 28, 41, 28, L, 'low');

    this.realizeRects();
  }

  private realizeRects(): void {
    const pickMat = (r: Rect, cx: number, cz: number): THREE.MeshStandardMaterial => {
      const v = (cx * 7 + cz * 13) % 5;
      switch (r.kind) {
        case 'wall': return v < 3 ? this.mats.concrete : this.mats.concreteDark;
        case 'building': return v % 2 === 0 ? this.mats.concretePainted : this.mats.concretePainted2;
        case 'low': return v % 2 === 0 ? this.mats.crate : this.mats.wood;
        case 'mid': return v % 2 === 0 ? this.mats.sandbag : this.mats.paintedMetalGreen;
      }
    };

    for (const r of this.rects) {
      const x0w = cellToWorld(r.x0) - 0.5;
      const x1w = cellToWorld(r.x1) + 0.5;
      const z0w = cellToWorld(r.z0) - 0.5;
      const z1w = cellToWorld(r.z1) + 0.5;
      const w = x1w - x0w;
      const d = z1w - z0w;
      const mesh = new THREE.Mesh(this.geos.box, pickMat(r, r.x0, r.z0));
      mesh.position.set((x0w + x1w) / 2, r.h / 2, (z0w + z1w) / 2);
      mesh.scale.set(w, r.h, d);
      mesh.castShadow = r.kind === 'wall' || r.kind === 'building';
      mesh.receiveShadow = true;
      this.group.add(mesh);
      this.meshes.push(mesh);

      // Wall cap trim for readability.
      if (r.kind === 'wall' || r.kind === 'building') {
        const cap = new THREE.Mesh(this.geos.box, this.mats.concreteDark);
        cap.position.set(mesh.position.x, r.h + 0.06, mesh.position.z);
        cap.scale.set(w + 0.12, 0.12, d + 0.12);
        cap.receiveShadow = true;
        this.group.add(cap);
        this.meshes.push(cap);
      }
      // Crate edge detail.
      if (r.kind === 'low') {
        const lid = new THREE.Mesh(this.geos.box, this.mats.wood);
        lid.position.set(mesh.position.x, r.h + 0.03, mesh.position.z);
        lid.scale.set(Math.max(0.2, w - 0.15), 0.06, Math.max(0.2, d - 0.15));
        this.group.add(lid);
        this.meshes.push(lid);
      }

      // Grid + collider.
      const val = r.kind === 'wall' || r.kind === 'building' ? 1 : 2;
      for (let cz = r.z0; cz <= r.z1; cz++) {
        for (let cx = r.x0; cx <= r.x1; cx++) {
          this.grid[cz * SIZE + cx] = val;
        }
      }
      this.obstacles.push({ minX: x0w, maxX: x1w, minZ: z0w, maxZ: z1w, h: r.h });
    }
  }

  // ---- ground -----------------------------------------------------------------
  private buildGround(): void {
    // Base slab.
    const slab = new THREE.Mesh(this.geos.box, this.mats.asphalt);
    slab.position.set(0, -0.25, 0);
    slab.scale.set(SIZE + 0.4, 0.5, SIZE + 0.4);
    slab.receiveShadow = true;
    this.group.add(slab);
    this.meshes.push(slab);

    // Concrete inlay (main floor).
    const floor = new THREE.Mesh(this.geos.box, this.mats.ground);
    floor.position.set(0, -0.02, 0);
    floor.scale.set(SIZE - 1.6, 0.06, SIZE - 1.6);
    floor.receiveShadow = true;
    this.group.add(floor);
    this.meshes.push(floor);

    // Avenues (slightly lighter strips): vertical x20-23, horizontal z20-23.
    const aveMat = this.mats.concreteDark;
    const mkStrip = (x: number, z: number, w: number, d: number): void => {
      const s = new THREE.Mesh(this.geos.box, aveMat);
      s.position.set(x, 0.015, z);
      s.scale.set(w, 0.03, d);
      s.receiveShadow = true;
      this.group.add(s);
      this.meshes.push(s);
    };
    const vX = (cellToWorld(20) + cellToWorld(23)) / 2;
    mkStrip(vX, 0, 4, SIZE - 2);
    mkStrip(0, vX, SIZE - 2, 4);
    // Plaza pad.
    mkStrip(0, 0, 10, 10);

    // Outer void catcher.
    const outer = new THREE.Mesh(this.geos.plane, new THREE.MeshBasicMaterial({ color: 0x0a0c0e }));
    outer.rotation.x = -Math.PI / 2;
    outer.position.y = -0.55;
    outer.scale.set(400, 400, 1);
    this.group.add(outer);
  }

  // ---- props (non-colliding or pre-collided) -----------------------------------
  private buildProps(): void {
    // Lamp posts at plaza corners + gates (emissive head, no real light except plaza).
    const lampAt = (cx: number, cz: number): void => {
      const x = cellToWorld(cx);
      const z = cellToWorld(cz);
      const pole = new THREE.Mesh(this.geos.cylinder, this.mats.metalDark);
      pole.position.set(x, 2.2, z);
      pole.scale.set(0.18, 4.4, 0.18);
      pole.castShadow = true;
      this.group.add(pole);
      this.meshes.push(pole);
      const head = new THREE.Mesh(this.geos.box, this.mats.lampEmissive);
      head.position.set(x, 4.45, z);
      head.scale.set(0.55, 0.22, 0.55);
      this.group.add(head);
      this.meshes.push(head);
    };
    lampAt(19, 19); lampAt(24, 19); lampAt(19, 24); lampAt(24, 24);
    lampAt(21, 13); lampAt(21, 32);

    // Barrels (visual, colliders already exist as low rects at these spots — add mesh dressing).
    const barrelAt = (cx: number, cz: number, rust: boolean): void => {
      const x = cellToWorld(cx);
      const z = cellToWorld(cz);
      const b = new THREE.Mesh(this.geos.cylinder, rust ? this.mats.barrelRust : this.mats.barrelBlue);
      b.position.set(x, 1.42, z);
      b.scale.set(0.62, 0.9, 0.62);
      b.castShadow = true;
      this.group.add(b);
      this.meshes.push(b);
    };
    barrelAt(12, 12, true); barrelAt(31, 12, false);
    barrelAt(12, 31, false); barrelAt(31, 31, true);
    barrelAt(2, 15, true); barrelAt(41, 28, false);

    // Pipes along north wall.
    for (let i = 0; i < 6; i++) {
      const p = new THREE.Mesh(this.geos.cylinder, this.mats.metal);
      p.rotation.z = Math.PI / 2;
      p.position.set(cellToWorld(14 + i * 3), 2.6, cellToWorld(1) + 0.2);
      p.scale.set(0.3, 2.4, 0.3);
      this.group.add(p);
      this.meshes.push(p);
    }

    // Debris scatter (small, non-colliding).
    const debrisCells: [number, number][] = [
      [15, 10], [28, 9], [9, 14], [34, 13], [16, 30], [27, 32],
      [7, 26], [36, 26], [21, 16], [22, 27], [3, 20], [40, 18],
    ];
    debrisCells.forEach(([cx, cz], i) => {
      const d = new THREE.Mesh(this.geos.box, i % 2 ? this.mats.dirt : this.mats.concreteDark);
      d.position.set(cellToWorld(cx) + 0.2, 0.08, cellToWorld(cz) - 0.15);
      d.scale.set(0.5, 0.16, 0.35);
      d.rotation.y = i * 0.7;
      d.receiveShadow = true;
      this.group.add(d);
      this.meshes.push(d);
    });

    // Window frames on hollow buildings (dark glass insets on exterior faces).
    const winAt = (x: number, y: number, z: number, w: number, ry: number): void => {
      const win = new THREE.Mesh(this.geos.plane, this.mats.glass);
      win.position.set(x, y, z);
      win.scale.set(w, 0.9, 1);
      win.rotation.y = ry;
      this.group.add(win);
      this.meshes.push(win);
    };
    // Barracks north face.
    winAt(cellToWorld(6), 2.3, cellToWorld(4) - 0.51, 1.2, Math.PI);
    winAt(cellToWorld(8), 2.3, cellToWorld(4) - 0.51, 1.2, Math.PI);
    winAt(cellToWorld(35), 2.3, cellToWorld(4) - 0.51, 1.2, Math.PI);
    winAt(cellToWorld(37), 2.3, cellToWorld(4) - 0.51, 1.2, Math.PI);
    // Depot south face.
    winAt(cellToWorld(6), 2.3, cellToWorld(37) + 0.51, 1.2, 0);
    winAt(cellToWorld(9), 2.3, cellToWorld(37) + 0.51, 1.2, 0);

    // Door lintels over main gaps (visual only, above head height).
    const lintel = (cx0: number, cx1: number, cz: number): void => {
      const x = (cellToWorld(cx0) + cellToWorld(cx1)) / 2;
      const m = new THREE.Mesh(this.geos.box, this.mats.metalDark);
      m.position.set(x, 2.75, cellToWorld(cz));
      m.scale.set((cx1 - cx0 + 1), 0.7, 1.1);
      m.castShadow = true;
      this.group.add(m);
      this.meshes.push(m);
    };
    lintel(6, 7, 10); lintel(36, 37, 10);
    lintel(7, 8, 30); lintel(35, 36, 30);
    lintel(7, 8, 37); lintel(35, 36, 37);
  }

  // ---- visual detail pass (no collision, extra silhouette + surface break-up) ----
  private buildDetails(): void {
    const box = (
      mat: THREE.Material, x: number, y: number, z: number,
      w: number, h: number, d: number, ry = 0, rx = 0,
    ): THREE.Mesh => {
      const m = new THREE.Mesh(this.geos.box, mat);
      m.position.set(x, y, z);
      m.scale.set(w, h, d);
      if (ry !== 0) m.rotation.y = ry;
      if (rx !== 0) m.rotation.x = rx;
      m.castShadow = true;
      m.receiveShadow = true;
      this.group.add(m);
      this.meshes.push(m);
      return m;
    };

    // Roof parapets on the solid structures (tops read as built-up, not slabs).
    const parapetCells: [number, number][] = [
      [5, 18], [19, 18], [6, 30], [35, 30], [5, 17], [36, 18],
    ];
    for (const [cx, cz] of parapetCells) {
      box(this.mats.concreteDark, cellToWorld(cx), 3.72, cellToWorld(cz), 3.2, 0.34, 2.2);
    }

    // Sandbag stacks: three courses high with a stepped top (classic cover look).
    const sandbagAt = (cx: number, cz: number, ry: number): void => {
      const x = cellToWorld(cx);
      const z = cellToWorld(cz);
      for (let row = 0; row < 3; row++) {
        const w = row === 2 ? 1.1 : 1.5;
        box(this.mats.sandbag, x, 0.14 + row * 0.26, z, w, 0.22, 1.0, ry + (row % 2 ? 0.06 : -0.06));
      }
    };
    sandbagAt(14, 16, 0.1); sandbagAt(29, 16, -0.15);
    sandbagAt(16, 27, 0.25); sandbagAt(27, 27, -0.05);

    // Gravel / rubble piles (cone-ish cylinders) around the plaza edges.
    const pile = (cx: number, cz: number, s: number): void => {
      const m = new THREE.Mesh(this.geos.cylinder, this.mats.dirt);
      m.position.set(cellToWorld(cx), s * 0.12, cellToWorld(cz));
      m.scale.set(s, s * 0.26, s * 1.2);
      m.castShadow = true;
      m.receiveShadow = true;
      this.group.add(m);
      this.meshes.push(m);
    };
    pile(17, 21, 1.5); pile(26, 23, 1.2); pile(11, 20, 1.0); pile(33, 22, 1.3);

    // Puddles: thin dark planes that pick up the sky reflection.
    const puddle = (cx: number, cz: number, s: number): void => {
      const m = new THREE.Mesh(this.geos.plane, this.mats.glass);
      m.rotation.x = -Math.PI / 2;
      m.position.set(cellToWorld(cx), 0.035, cellToWorld(cz));
      m.scale.set(s, s * 1.4, 1);
      this.group.add(m);
      this.meshes.push(m);
    };
    puddle(21, 26, 2.2); puddle(22, 17, 1.7); puddle(20, 36, 1.4); puddle(23, 9, 1.9);

    // Painted hazard chevrons at the two northern gaps (readable objective cue).
    for (let i = 0; i < 5; i++) {
      box(this.mats.accent, cellToWorld(6) + 0.1, 0.045, cellToWorld(12) - i * 1.05, 1.6, 0.05, 0.22, 0.5);
      box(this.mats.accent, cellToWorld(37) - 0.1, 0.045, cellToWorld(12) - i * 1.05, 1.6, 0.05, 0.22, -0.5);
    }

    // Road markings down both avenues.
    for (let i = 0; i < 9; i++) {
      box(this.mats.white, cellToWorld(21), 0.04, cellToWorld(3 + i * 4.5), 0.22, 0.04, 2.0);
      box(this.mats.white, cellToWorld(3 + i * 4.5), 0.04, cellToWorld(21), 2.0, 0.04, 0.22);
    }

    // Tire stacks next to the depot (soft cover dressing).
    for (const [cx, cz] of [[9, 34], [10, 34], [34, 9]] as [number, number][]) {
      for (let i = 0; i < 3; i++) {
        const t = new THREE.Mesh(this.geos.cylinder, this.mats.rubber);
        t.position.set(cellToWorld(cx), 0.18 + i * 0.32, cellToWorld(cz));
        t.scale.set(0.95, 0.3, 0.95);
        t.rotation.y = i * 0.6;
        t.castShadow = true;
        this.group.add(t);
        this.meshes.push(t);
      }
    }

    // Cable runs + conduit boxes along the east wall (breaks up big surfaces).
    for (let i = 0; i < 8; i++) {
      box(this.mats.metalDark, cellToWorld(42) + 0.15, 1.4 + (i % 2) * 0.5, cellToWorld(6 + i * 4), 0.12, 0.12, 3.4);
    }
    for (const [cx, cz] of [[42, 8], [42, 24], [1, 12]] as [number, number][]) {
      box(this.mats.paintedMetal, cellToWorld(cx), 0.55, cellToWorld(cz), 0.5, 1.1, 0.4);
    }

    // ---- street furniture + urban dressing ------------------------------------
    // Avenues get kerb strips so the roads read as built infrastructure.
    for (const z of [-21.5, 21.5]) {
      box(this.mats.concreteDark, 0, 0.06, z, 44, 0.12, 0.3);
    }
    for (const x of [-21.5, 21.5]) {
      box(this.mats.concreteDark, x, 0.06, 0, 0.3, 0.12, 44);
    }

    // Lamp posts: pole + bracket + emissive head (anchors the two point lights).
    const lamp = (cx: number, cz: number, ry: number): void => {
      const x = cellToWorld(cx);
      const z = cellToWorld(cz);
      const pole = new THREE.Mesh(this.geos.cylinder, this.mats.metalDark);
      pole.position.set(x, 2.3, z);
      pole.scale.set(0.14, 4.6, 0.14);
      pole.castShadow = true;
      this.group.add(pole);
      this.meshes.push(pole);
      box(this.mats.metalDark, x + Math.sin(ry) * 0.5, 4.55, z + Math.cos(ry) * 0.5, 0.1, 0.1, 1.1, ry);
      box(this.mats.lampEmissive, x + Math.sin(ry) * 1.0, 4.42, z + Math.cos(ry) * 1.0, 0.5, 0.16, 0.34, ry);
    };
    lamp(15, 13, 0.0); lamp(28, 13, 0.0);
    lamp(15, 29, 0.0); lamp(28, 29, 0.0);
    lamp(2, 21, Math.PI / 2); lamp(41, 21, Math.PI / 2);

    // Roof kit: AC units + vents so the buildings don't read as blank slabs.
    const roofKit = (cx: number, cz: number, y: number): void => {
      const x = cellToWorld(cx);
      const z = cellToWorld(cz);
      box(this.mats.metal, x, y + 0.35, z, 1.5, 0.7, 1.1);
      box(this.mats.metalDark, x + 0.5, y + 0.78, z - 0.4, 0.5, 0.26, 0.5);
      const vent = new THREE.Mesh(this.geos.cylinder, this.mats.metal);
      vent.position.set(x - 0.9, y + 0.5, z + 0.6);
      vent.scale.set(0.32, 0.5, 0.32);
      vent.castShadow = true;
      this.group.add(vent);
      this.meshes.push(vent);
    };
    roofKit(6, 18, 3.6); roofKit(37, 18, 3.6);
    roofKit(7, 7, 3.6); roofKit(36, 7, 3.6);
    roofKit(7, 33, 3.6); roofKit(36, 33, 3.6);

    // Antenna masts with cross arms (silhouette interest against the sky).
    const mast = (cx: number, cz: number, h: number): void => {
      const x = cellToWorld(cx);
      const z = cellToWorld(cz);
      const pole = new THREE.Mesh(this.geos.cylinder, this.mats.metalDark);
      pole.position.set(x, 3.6 + h / 2, z);
      pole.scale.set(0.09, h, 0.09);
      pole.castShadow = true;
      this.group.add(pole);
      this.meshes.push(pole);
      for (let i = 0; i < 3; i++) {
        box(this.mats.metalDark, x, 3.9 + h * 0.55 + i * 0.4, z, 1.1 - i * 0.25, 0.06, 0.06);
      }
      box(this.mats.accent, x, 3.9 + h * 0.85, z, 0.16, 0.16, 0.16); // beacon
    };
    mast(6, 18, 3.4); mast(37, 33, 2.8);

    // Tarped supply piles (fabric over crates) — reads as a working compound.
    const tarp = (cx: number, cz: number, ry: number): void => {
      const x = cellToWorld(cx);
      const z = cellToWorld(cz);
      box(this.mats.crate, x, 0.3, z, 1.6, 0.6, 1.2, ry);
      box(this.mats.fabricGreen, x, 0.66, z, 1.75, 0.18, 1.35, ry + 0.06);
      box(this.mats.fabricGreen, x, 0.78, z, 1.1, 0.12, 0.9, ry - 0.1);
    };
    tarp(9, 31, 0.2); tarp(34, 36, -0.3); tarp(20, 5, 0.45);

    // Concrete barriers with hazard stripes guarding the two chokepoints.
    const barrier = (cx: number, cz: number, ry: number): void => {
      const x = cellToWorld(cx);
      const z = cellToWorld(cz);
      box(this.mats.concrete, x, 0.42, z, 1.8, 0.84, 0.5, ry);
      box(this.mats.accent, x, 0.78, z, 1.5, 0.16, 0.52, ry);
    };
    barrier(13, 12, 0); barrier(30, 12, 0);
    barrier(13, 30, 0); barrier(30, 30, 0);

    // Rubble scatter along the wall bases (breaks the perfectly straight edges).
    for (let i = 0; i < 26; i++) {
      const side = i % 4;
      const t = (i * 7.13) % 40 - 20;
      const x = side === 0 ? t : side === 1 ? 20.6 : side === 2 ? t : -20.6;
      const z = side === 0 ? -20.6 : side === 1 ? t : side === 2 ? 20.6 : t;
      const s = 0.18 + ((i * 13) % 7) * 0.05;
      const m = new THREE.Mesh(this.geos.box, this.mats.dirt);
      m.position.set(x, s * 0.5, z);
      m.scale.set(s * 1.7, s, s * 1.4);
      m.rotation.y = i * 0.7;
      m.castShadow = true;
      this.group.add(m);
      this.meshes.push(m);
    }

    // Window sills + lintel shadow bands on the exterior facades.
    const sill = (x: number, y: number, z: number, w: number, d: number): void =>
      void box(this.mats.concreteDark, x, y, z, w, 0.14, d);
    sill(cellToWorld(6), 1.82, cellToWorld(4) - 0.6, 1.5, 0.28);
    sill(cellToWorld(8), 1.82, cellToWorld(4) - 0.6, 1.5, 0.28);
    sill(cellToWorld(35), 1.82, cellToWorld(4) - 0.6, 1.5, 0.28);
    sill(cellToWorld(37), 1.82, cellToWorld(4) - 0.6, 1.5, 0.28);
    sill(cellToWorld(6), 1.82, cellToWorld(37) + 0.6, 1.5, 0.28);
    sill(cellToWorld(9), 1.82, cellToWorld(37) + 0.6, 1.5, 0.28);
  }

  // ---- cover + spawns ------------------------------------------------------------
  private generateCoverPoints(): void {
    const seen = new Set<number>();
    const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    for (let cz = 1; cz < SIZE - 1; cz++) {
      for (let cx = 1; cx < SIZE - 1; cx++) {
        const v = this.grid[cz * SIZE + cx];
        if (v === 0) continue;
        for (const [dx, dz] of DIRS) {
          const nx = cx + dx;
          const nz = cz + dz;
          if (this.grid[nz * SIZE + nx] !== 0) continue;
          const key = nz * SIZE + nx;
          if (seen.has(key)) continue;
          seen.add(key);
          this.coverPoints.push({
            x: cellToWorld(nx),
            z: cellToWorld(nz),
            nx: dx,
            nz: dz,
            kind: v === 2 ? 'low' : 'high',
          });
        }
      }
    }
  }

  private setupSpawns(): void {
    const snap = (cx: number, cz: number): { x: number; z: number } => {
      const open = nearestOpenCell(this.grid, SIZE, cx, cz, 6);
      const c = open ?? { cx: 21, cz: 38 };
      return { x: cellToWorld(c.cx), z: cellToWorld(c.cz) };
    };
    this.playerSpawn = snap(21, 39);
    const cells: [number, number][] = [
      [8, 2], [21, 2], [35, 2], [2, 13], [41, 13],
      [2, 29], [41, 29], [13, 2], [30, 2], [21, 6],
      [6, 24], [37, 24], [15, 41], [28, 41],
    ];
    this.enemySpawns = cells.map(([cx, cz]) => snap(cx, cz));
  }

  // ---- queries ---------------------------------------------------------------------
  isWalkableCell(cx: number, cz: number): boolean {
    if (cx < 0 || cz < 0 || cx >= SIZE || cz >= SIZE) return false;
    return this.grid[cz * SIZE + cx] === 0;
  }

  isWalkableWorld(x: number, z: number): boolean {
    return this.isWalkableCell(worldToCell(x), worldToCell(z));
  }

  /** Push a circle (x,z + radius) out of obstacle AABBs and level bounds. Mutates out. */
  collideCircle(pos: THREE.Vector3, radius: number): void {
    for (const o of this.obstacles) {
      // Broadphase.
      if (pos.x < o.minX - radius || pos.x > o.maxX + radius) continue;
      if (pos.z < o.minZ - radius || pos.z > o.maxZ + radius) continue;
      const cx = Math.max(o.minX, Math.min(pos.x, o.maxX));
      const cz = Math.max(o.minZ, Math.min(pos.z, o.maxZ));
      let dx = pos.x - cx;
      let dz = pos.z - cz;
      const d2 = dx * dx + dz * dz;
      if (d2 >= radius * radius) continue;
      if (d2 > 1e-8) {
        const d = Math.sqrt(d2);
        const push = radius - d;
        dx /= d; dz /= d;
        pos.x += dx * push;
        pos.z += dz * push;
      } else {
        // Center inside box: push along smallest penetration axis.
        const pxMin = pos.x - o.minX;
        const pxMax = o.maxX - pos.x;
        const pzMin = pos.z - o.minZ;
        const pzMax = o.maxZ - pos.z;
        const m = Math.min(pxMin, pxMax, pzMin, pzMax);
        if (m === pxMin) pos.x = o.minX - radius;
        else if (m === pxMax) pos.x = o.maxX + radius;
        else if (m === pzMin) pos.z = o.minZ - radius;
        else pos.z = o.maxZ + radius;
      }
    }
    pos.x = Math.max(-this.boundsHalf, Math.min(this.boundsHalf, pos.x));
    pos.z = Math.max(-this.boundsHalf, Math.min(this.boundsHalf, pos.z));
  }

  /** 3D segment vs all obstacle boxes. Returns true if any box blocks the segment. */
  segmentBlocked(
    ax: number, ay: number, az: number,
    bx: number, by: number, bz: number,
  ): boolean {
    const dx = bx - ax;
    const dy = by - ay;
    const dz = bz - az;
    for (const o of this.obstacles) {
      if (o.h < 0.05) continue;
      let tmin = 0;
      let tmax = 1;
      // X slab.
      if (Math.abs(dx) < 1e-9) {
        if (ax < o.minX || ax > o.maxX) continue;
      } else {
        let t1 = (o.minX - ax) / dx;
        let t2 = (o.maxX - ax) / dx;
        if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
        tmin = Math.max(tmin, t1);
        tmax = Math.min(tmax, t2);
        if (tmin > tmax) continue;
      }
      // Y slab (0..h).
      if (Math.abs(dy) < 1e-9) {
        if (ay < 0 || ay > o.h) continue;
      } else {
        let t1 = (0 - ay) / dy;
        let t2 = (o.h - ay) / dy;
        if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
        tmin = Math.max(tmin, t1);
        tmax = Math.min(tmax, t2);
        if (tmin > tmax) continue;
      }
      // Z slab.
      if (Math.abs(dz) < 1e-9) {
        if (az < o.minZ || az > o.maxZ) continue;
      } else {
        let t1 = (o.minZ - az) / dz;
        let t2 = (o.maxZ - az) / dz;
        if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
        tmin = Math.max(tmin, t1);
        tmax = Math.min(tmax, t2);
        if (tmin > tmax) continue;
      }
      return true;
    }
    return false;
  }

  losClear(ax: number, az: number, bx: number, bz: number, height = WORLD.EYE_HEIGHT): boolean {
    return !this.segmentBlocked(ax, height, az, bx, height, bz);
  }

  /** Nearest obstacle intersection along a ray. Returns distance or Infinity. */
  raycastObstacles(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxDist: number): number {
    let best = maxDist;
    for (const o of this.obstacles) {
      let tmin = 0;
      let tmax = best;
      // X
      if (Math.abs(dx) < 1e-9) {
        if (ox < o.minX || ox > o.maxX) continue;
      } else {
        let t1 = (o.minX - ox) / dx;
        let t2 = (o.maxX - ox) / dx;
        if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
        tmin = Math.max(tmin, t1);
        tmax = Math.min(tmax, t2);
        if (tmin > tmax) continue;
      }
      // Y
      if (Math.abs(dy) < 1e-9) {
        if (oy < 0 || oy > o.h) continue;
      } else {
        let t1 = (0 - oy) / dy;
        let t2 = (o.h - oy) / dy;
        if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
        tmin = Math.max(tmin, t1);
        tmax = Math.min(tmax, t2);
        if (tmin > tmax) continue;
      }
      // Z
      if (Math.abs(dz) < 1e-9) {
        if (oz < o.minZ || oz > o.maxZ) continue;
      } else {
        let t1 = (o.minZ - oz) / dz;
        let t2 = (o.maxZ - oz) / dz;
        if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
        tmin = Math.max(tmin, t1);
        tmax = Math.min(tmax, t2);
        if (tmin > tmax) continue;
      }
      if (tmin > 0.01 && tmin < best) best = tmin;
    }
    // Ground plane y=0.
    if (dy < -1e-6) {
      const t = -oy / dy;
      if (t > 0.01 && t < best) best = t;
    }
    return best;
  }

  dispose(): void {
    this.group.clear();
    this.meshes.length = 0;
    this.obstacles.length = 0;
    this.coverPoints.length = 0;
  }
}
