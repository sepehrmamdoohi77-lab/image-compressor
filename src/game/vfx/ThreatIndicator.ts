// Proximity threat telegraphing: when hostiles close in, a red danger streak is
// drawn on the ground from the soldier toward each threat, with a pulsing ring
// at the hostile's feet. Purely additive, pooled, zero allocation per frame.
//
// The same pass also yields the HUD "danger" read-out (level + bearing) so the
// screen edge can pulse in the direction of the incoming threat.
import * as THREE from 'three';
import { THREATS } from '../data/config';
import { clamp } from '../utils/math';

export interface ThreatContact {
  id: number;
  x: number;
  z: number;
  alive: boolean;
  /** 0..1 — how sure the hostile is about the player (aware = hotter line). */
  confidence: number;
}

export interface ThreatReadout {
  /** 0..1 HUD danger intensity (1 = hostile on top of the player). */
  level: number;
  /** Bearing of the nearest threat on screen: 0° = up, +90° = right. */
  screenAngleDeg: number;
  /** Distance to the nearest threat (m); Infinity when nothing is close. */
  nearest: number;
  /** Number of hostiles currently close enough to matter. */
  count: number;
}

const VERTEX_COUNT = 7; // start edge (2), neck (2), arrow flare (2), tip (1)
const TRIANGLES = [0, 1, 2, 2, 1, 3, 4, 6, 5];

interface Streak {
  mesh: THREE.Mesh;
  geo: THREE.BufferGeometry;
  pos: Float32Array;
  col: Float32Array;
  material: THREE.MeshBasicMaterial;
}

interface Pulse {
  mesh: THREE.Mesh;
  material: THREE.MeshBasicMaterial;
  life: number;
}

function makeStreak(): Streak {
  const pos = new Float32Array(VERTEX_COUNT * 3);
  const col = new Float32Array(VERTEX_COUNT * 4);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 4));
  geo.setIndex(TRIANGLES);
  const material = new THREE.MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geo, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = 6;
  mesh.visible = false;
  return { mesh, geo, pos, col, material };
}

export class ThreatIndicator {
  private streaks: Streak[] = [];
  private pulses: Pulse[] = [];
  private ringGeo: THREE.RingGeometry;
  private time = 0;
  private readout: ThreatReadout = { level: 0, screenAngleDeg: 0, nearest: Infinity, count: 0 };

  constructor(private scene: THREE.Scene) {
    for (let i = 0; i < THREATS.maxIndicators; i++) {
      const s = makeStreak();
      scene.add(s.mesh);
      this.streaks.push(s);
    }
    const ring = new THREE.RingGeometry(0.72, 1, 22);
    this.ringGeo = ring;
    for (let i = 0; i < THREATS.maxIndicators; i++) {
      const material = new THREE.MeshBasicMaterial({
        color: 0xff2a1e,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(ring, material);
      mesh.rotation.x = -Math.PI / 2;
      mesh.visible = false;
      mesh.renderOrder = 7;
      scene.add(mesh);
      this.pulses.push({ mesh, material, life: 0 });
    }
  }

  get current(): ThreatReadout {
    return this.readout;
  }

  /** Number of ground streaks currently drawn (test/debug visibility). */
  get visibleStreaks(): number {
    return this.streaks.reduce((n, s) => n + (s.mesh.visible ? 1 : 0), 0);
  }

  /**
   * `camRight`/`camForward` are the camera's ground-plane basis vectors: the
   * bearing is projected into screen space with them (no matrix work needed).
   */
  update(
    dt: number,
    px: number,
    pz: number,
    contacts: ThreatContact[],
    camRight: THREE.Vector3,
    camForward: THREE.Vector3,
  ): ThreatReadout {
    this.time += dt;
    const pulse = 0.55 + 0.45 * Math.sin(this.time * Math.PI * 2 * THREATS.pulseHz);

    // Rank hostiles by distance (nearest first), ignoring the dead.
    const near: { c: ThreatContact; d: number }[] = [];
    for (const c of contacts) {
      if (!c.alive) continue;
      const d = Math.hypot(c.x - px, c.z - pz);
      if (d <= THREATS.radius) near.push({ c, d });
    }
    near.sort((a, b) => a.d - b.d);
    const shown = near.slice(0, this.streaks.length);

    for (let i = 0; i < this.streaks.length; i++) {
      const s = this.streaks[i];
      const entry = shown[i];
      if (!entry) {
        s.mesh.visible = false;
        this.pulses[i].mesh.visible = false;
        continue;
      }
      const { c, d } = entry;
      const dx = c.x - px;
      const dz = c.z - pz;
      const len = Math.max(0.001, Math.hypot(dx, dz));
      const ux = dx / len;
      const uz = dz / len;
      // Perpendicular for the quad width.
      const nx = -uz;
      const nz = ux;

      // Closeness 0..1 (1 = right on top of the player).
      const close = clamp(1 - d / THREATS.radius, 0, 1);
      const noise = 1 - close * 0.88; // further = thinner line
      const aware = c.confidence > 0.35 ? THREATS.awareBoost : 1;
      const heat = clamp(close * aware, 0, 1);

      // Line starts just in front of the soldier and ends at the hostile.
      const startD = 0.9;
      const endD = Math.max(startD + 0.6, len - 0.55);
      const sx = px + ux * startD;
      const sz = pz + uz * startD;
      const ex = px + ux * endD;
      const ez = pz + uz * endD;

      const w0 = 0.07 + 0.05 * (1 - noise);
      const w1 = 0.16 + 0.1 * (1 - noise);
      const flare = 0.42 + 0.16 * (1 - noise);
      const y = 0.06;

      const P = s.pos;
      // 0/1: start edge, 2/3: neck, 4/5: arrow flare, 6: tip.
      P[0] = sx + nx * w0; P[1] = y; P[2] = sz + nz * w0;
      P[3] = sx - nx * w0; P[4] = y; P[5] = sz - nz * w0;
      P[6] = ex + nx * w1; P[7] = y; P[8] = ez + nz * w1;
      P[9] = ex - nx * w1; P[10] = y; P[11] = ez - nz * w1;
      P[12] = ex + nx * flare; P[13] = y; P[14] = ez + nz * flare;
      P[15] = ex - nx * flare; P[16] = y; P[17] = ez - nz * flare;
      P[18] = px + ux * len; P[19] = y; P[20] = pz + uz * len;

      // Per-vertex RGBA: bright red core, fading toward the soldier and edges.
      const C = s.col;
      const aHead = 0.35 + 0.55 * heat * pulse;
      const aBody = 0.22 + 0.5 * heat * pulse;
      const aTip = 0.5 + 0.5 * heat * pulse;
      const put = (i: number, r: number, g: number, b: number, a: number): void => {
        C[i * 4] = r; C[i * 4 + 1] = g; C[i * 4 + 2] = b; C[i * 4 + 3] = a;
      };
      put(0, 1, 0.16, 0.1, aHead * 0.35);
      put(1, 1, 0.16, 0.1, aHead * 0.35);
      put(2, 1, 0.14, 0.08, aBody);
      put(3, 1, 0.14, 0.08, aBody);
      put(4, 1, 0.22, 0.12, aBody * 0.9);
      put(5, 1, 0.22, 0.12, aBody * 0.9);
      put(6, 1, 0.3, 0.18, aTip);

      (s.geo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
      (s.geo.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true;
      s.mesh.visible = true;

      // Pulse ring at the hostile's feet (threat marker).
      const ringR = THREATS.ringMin + (THREATS.ringMax - THREATS.ringMin) * (1 - clamp(d / THREATS.radius, 0, 1));
      const p = this.pulses[i];
      p.mesh.position.set(c.x, 0.05, c.z);
      p.mesh.scale.setScalar(ringR * (1 + 0.12 * pulse));
      p.mesh.visible = true;
      p.material.opacity = (0.3 + 0.45 * heat) * (0.55 + 0.45 * pulse);
    }

    // HUD read-out.
    const nearest = near.length > 0 ? near[0].d : Infinity;
    const level = nearest === Infinity ? 0 : clamp(1 - (nearest - THREATS.hudCloseRadius) / (THREATS.hudFarRadius - THREATS.hudCloseRadius), 0, 1);
    let screenAngleDeg = 0;
    if (near.length > 0) {
      const dx = near[0].c.x - px;
      const dz = near[0].c.z - pz;
      const right = dx * camRight.x + dz * camRight.z;
      const fwd = dx * camForward.x + dz * camForward.z;
      screenAngleDeg = THREE.MathUtils.radToDeg(Math.atan2(right, fwd));
    }
    this.readout = {
      level: level * (0.7 + 0.3 * pulse),
      screenAngleDeg,
      nearest,
      count: near.filter((n) => n.c.confidence > 0.2 || n.d < THREATS.hudCloseRadius).length,
    };
    return this.readout;
  }

  clear(): void {
    for (const s of this.streaks) s.mesh.visible = false;
    for (const p of this.pulses) {
      p.mesh.visible = false;
      p.material.opacity = 0;
    }
    this.readout = { level: 0, screenAngleDeg: 0, nearest: Infinity, count: 0 };
  }

  dispose(): void {
    for (const s of this.streaks) {
      this.scene.remove(s.mesh);
      s.geo.dispose();
      s.material.dispose();
    }
    for (const p of this.pulses) {
      this.scene.remove(p.mesh);
      p.material.dispose();
    }
    this.ringGeo.dispose();
    this.streaks = [];
    this.pulses = [];
  }
}
