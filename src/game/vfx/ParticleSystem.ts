// Pooled GPU-friendly particle + tracer + flash-light VFX.
// Zero allocation per frame: fixed pools, ring-buffer reuse, self-cleaning.
import * as THREE from 'three';

const MAX_ADDITIVE = 1500;
const MAX_ALPHA = 800;
const MAX_TRACERS = 28;
const MAX_FLASHES = 10;
const MAX_LIGHTS = 3;

function makeDotTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const g = c.getContext('2d');
  if (!g) throw new Error('[VFX] canvas 2d unavailable');
  const grad = g.createRadialGradient(32, 32, 2, 32, 32, 30);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.35, 'rgba(255,255,255,0.85)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.needsUpdate = true;
  return tex;
}

class PointPool {
  points: THREE.Points;
  private pos: Float32Array;
  private col: Float32Array;
  private vel: Float32Array;
  private life: Float32Array;
  private maxLife: Float32Array;
  private grav: Float32Array;
  private drag: Float32Array;
  private head = 0;
  private geo: THREE.BufferGeometry;
  private baseSize: number;

  constructor(scene: THREE.Scene, max: number, size: number, additive: boolean, tex: THREE.Texture) {
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max).fill(1);
    this.grav = new Float32Array(max);
    this.drag = new Float32Array(max);
    this.baseSize = size;
    // Park dead particles far below ground.
    for (let i = 0; i < max; i++) this.pos[i * 3 + 1] = -100;
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    const mat = new THREE.PointsMaterial({
      size,
      map: tex,
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      sizeAttenuation: true,
    });
    this.points = new THREE.Points(this.geo, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = additive ? 5 : 4;
    scene.add(this.points);
  }

  get capacity(): number {
    return this.life.length;
  }

  spawn(
    x: number, y: number, z: number,
    vx: number, vy: number, vz: number,
    life: number, r: number, g: number, b: number,
    gravity: number, drag: number,
  ): void {
    const i = this.head;
    this.head = (this.head + 1) % this.life.length;
    this.pos[i * 3] = x;
    this.pos[i * 3 + 1] = y;
    this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx;
    this.vel[i * 3 + 1] = vy;
    this.vel[i * 3 + 2] = vz;
    this.col[i * 3] = r;
    this.col[i * 3 + 1] = g;
    this.col[i * 3 + 2] = b;
    this.life[i] = life;
    this.maxLife[i] = Math.max(0.001, life);
    this.grav[i] = gravity;
    this.drag[i] = drag;
  }

  update(dt: number): void {
    const { pos, vel, life, grav, drag } = this;
    for (let i = 0; i < life.length; i++) {
      if (life[i] <= 0) continue;
      life[i] -= dt;
      if (life[i] <= 0) {
        pos[i * 3 + 1] = -100;
        continue;
      }
      const d = 1 - Math.min(0.95, drag[i] * dt);
      vel[i * 3] *= d;
      vel[i * 3 + 1] = vel[i * 3 + 1] * d - grav[i] * dt;
      vel[i * 3 + 2] *= d;
      pos[i * 3] += vel[i * 3] * dt;
      pos[i * 3 + 1] += vel[i * 3 + 1] * dt;
      pos[i * 3 + 2] += vel[i * 3 + 2] * dt;
      if (pos[i * 3 + 1] < 0.02 && grav[i] > 0) {
        pos[i * 3 + 1] = 0.02;
        vel[i * 3 + 1] *= -0.3;
      }
    }
    (this.geo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true;
  }

  clear(): void {
    this.life.fill(0);
    for (let i = 0; i < this.life.length; i++) this.pos[i * 3 + 1] = -100;
  }

  setSizeMult(m: number): void {
    (this.points.material as THREE.PointsMaterial).size = this.baseSize * m;
  }
}

interface Tracer {
  line: THREE.Line;
  life: number;
  maxLife: number;
}

interface Flash {
  sprite: THREE.Sprite;
  life: number;
  maxLife: number;
  grow: number;
}

const DUST_COUNT = 340;
const DUST_RADIUS = 26;
const DUST_HEIGHT = 8;

export class ParticleSystem {
  private additive: PointPool;
  private alpha: PointPool;
  private tracers: Tracer[] = [];
  private flashes: Flash[] = [];
  private lights: THREE.PointLight[] = [];
  private lightLife: number[] = [];
  private mult = 1;
  private tmpColor = new THREE.Color();
  // Ambient dust motes: slow-drifting specks that catch the warm light and give
  // the iso view depth. Wrapped in a box that follows the camera focus.
  private dust: THREE.Points | null = null;
  private dustPos = new Float32Array(DUST_COUNT * 3);
  private dustVel = new Float32Array(DUST_COUNT * 3);
  private focus = new THREE.Vector3();
  private detail = true;

  constructor(private scene: THREE.Scene) {
    const tex = makeDotTexture();
    this.additive = new PointPool(scene, MAX_ADDITIVE, 0.16, true, tex);
    this.alpha = new PointPool(scene, MAX_ALPHA, 0.42, false, tex);

    for (let i = 0; i < MAX_TRACERS; i++) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
      const mat = new THREE.LineBasicMaterial({
        color: 0xffd27a, transparent: true, opacity: 0,
        blending: THREE.AdditiveBlending, depthWrite: false,
      });
      const line = new THREE.Line(geo, mat);
      line.frustumCulled = false;
      line.visible = false;
      scene.add(line);
      this.tracers.push({ line, life: 0, maxLife: 0.07 });
    }
    for (let i = 0; i < MAX_FLASHES; i++) {
      const mat = new THREE.SpriteMaterial({
        map: tex, color: 0xffc37a, transparent: true, opacity: 0,
        blending: THREE.AdditiveBlending, depthWrite: false,
      });
      const sprite = new THREE.Sprite(mat);
      sprite.visible = false;
      scene.add(sprite);
      this.flashes.push({ sprite, life: 0, maxLife: 0.06, grow: 1 });
    }
    for (let i = 0; i < MAX_LIGHTS; i++) {
      const l = new THREE.PointLight(0xffc37a, 0, 14, 1.8);
      scene.add(l);
      this.lights.push(l);
      this.lightLife.push(0);
    }
    this.buildDust(scene, tex);
  }

  private buildDust(scene: THREE.Scene, tex: THREE.Texture): void {
    for (let i = 0; i < DUST_COUNT; i++) {
      this.dustPos[i * 3] = (Math.random() * 2 - 1) * DUST_RADIUS;
      this.dustPos[i * 3 + 1] = Math.random() * DUST_HEIGHT;
      this.dustPos[i * 3 + 2] = (Math.random() * 2 - 1) * DUST_RADIUS;
      this.dustVel[i * 3] = 0.16 + Math.random() * 0.2;
      this.dustVel[i * 3 + 1] = (Math.random() - 0.5) * 0.12;
      this.dustVel[i * 3 + 2] = (Math.random() - 0.5) * 0.16;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.dustPos, 3));
    const mat = new THREE.PointsMaterial({
      size: 0.075,
      map: tex,
      color: 0xffe0bb,
      transparent: true,
      opacity: 0.32,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true,
    });
    const pts = new THREE.Points(geo, mat);
    pts.frustumCulled = false;
    pts.renderOrder = 3;
    scene.add(pts);
    this.dust = pts;
  }

  setMultiplier(m: number): void {
    this.mult = m;
  }

  /** High quality enables ambient dust; low quality drops it for headroom. */
  setDetail(on: boolean): void {
    this.detail = on;
    if (this.dust) this.dust.visible = on;
  }

  /** Camera focus point; the dust box is wrapped around it. */
  setFocus(x: number, z: number): void {
    this.focus.set(x, 0, z);
  }

  private updateDust(dt: number): void {
    const pts = this.dust;
    if (!pts || !this.detail) return;
    const p = this.dustPos;
    const v = this.dustVel;
    const t = performance.now() / 1000;
    for (let i = 0; i < DUST_COUNT; i++) {
      const i3 = i * 3;
      const sway = Math.sin(t * 0.35 + i) * 0.16;
      p[i3] += (v[i3] + sway) * dt;
      p[i3 + 1] += (v[i3 + 1] + Math.sin(t * 0.6 + i * 0.7) * 0.05) * dt;
      p[i3 + 2] += (v[i3 + 2] + sway * 0.4) * dt;
      // Wrap into the moving box so density stays constant wherever we walk.
      const dx = p[i3] - this.focus.x;
      const dz = p[i3 + 2] - this.focus.z;
      if (dx > DUST_RADIUS) p[i3] -= DUST_RADIUS * 2;
      else if (dx < -DUST_RADIUS) p[i3] += DUST_RADIUS * 2;
      if (dz > DUST_RADIUS) p[i3 + 2] -= DUST_RADIUS * 2;
      else if (dz < -DUST_RADIUS) p[i3 + 2] += DUST_RADIUS * 2;
      if (p[i3 + 1] > DUST_HEIGHT) p[i3 + 1] = 0.05;
      else if (p[i3 + 1] < 0.02) p[i3 + 1] = DUST_HEIGHT;
    }
    (pts.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
  }

  private count(n: number): number {
    return Math.max(1, Math.round(n * this.mult));
  }

  // --- emitters ---------------------------------------------------------------
  muzzleFlash(p: THREE.Vector3, dir: THREE.Vector3, big = false): void {
    const n = this.count(big ? 10 : 5);
    for (let i = 0; i < n; i++) {
      const s = 3 + Math.random() * (big ? 9 : 5);
      this.additive.spawn(
        p.x, p.y, p.z,
        dir.x * s + (Math.random() - 0.5) * 2,
        dir.y * s + Math.random() * 1.5,
        dir.z * s + (Math.random() - 0.5) * 2,
        0.08 + Math.random() * 0.08,
        1, 0.75 + Math.random() * 0.2, 0.4,
        0, 2,
      );
    }
    // Smoke wisp.
    this.alpha.spawn(p.x, p.y + 0.05, p.z, dir.x * 0.6, 0.7, dir.z * 0.6,
      0.7 + Math.random() * 0.5, 0.45, 0.45, 0.45, -0.4, 1.5);
    // Flash sprite + light.
    const f = this.flashes.find((x) => x.life <= 0) ?? this.flashes[0];
    f.sprite.visible = true;
    f.sprite.position.copy(p);
    const s = big ? 1.5 : 0.9;
    f.sprite.scale.set(s, s, 1);
    (f.sprite.material as THREE.SpriteMaterial).opacity = 0.95;
    f.life = f.maxLife = big ? 0.09 : 0.06;
    f.grow = big ? 2.2 : 1.4;
    this.flashLight(p, 0xffb35c, big ? 26 : 12, 9);
  }

  impact(p: THREE.Vector3, kind: 'concrete' | 'metal' | 'dirt' | 'flesh' | 'blood'): void {
    if (kind === 'flesh' || kind === 'blood') {
      const n = this.count(8);
      for (let i = 0; i < n; i++) {
        this.alpha.spawn(p.x, p.y, p.z,
          (Math.random() - 0.5) * 3, Math.random() * 2.5, (Math.random() - 0.5) * 3,
          0.4 + Math.random() * 0.3, 0.45, 0.06, 0.05, 6, 1);
      }
      return;
    }
    let r = 0.75; let g = 0.72; let b = 0.68;
    if (kind === 'metal') { r = 1; g = 0.8; b = 0.45; }
    if (kind === 'dirt') { r = 0.5; g = 0.42; b = 0.3; }
    const n = this.count(kind === 'metal' ? 10 : 7);
    for (let i = 0; i < n; i++) {
      this.additive.spawn(p.x, p.y + 0.05, p.z,
        (Math.random() - 0.5) * 5, Math.random() * 4, (Math.random() - 0.5) * 5,
        0.2 + Math.random() * 0.25, r, g, b, 9, 0.5);
    }
    const d = this.count(3);
    for (let i = 0; i < d; i++) {
      this.alpha.spawn(p.x, p.y + 0.1, p.z,
        (Math.random() - 0.5) * 1.2, 0.8 + Math.random(), (Math.random() - 0.5) * 1.2,
        0.6 + Math.random() * 0.4, 0.5, 0.5, 0.5, -0.5, 1.5);
    }
  }

  shell(p: THREE.Vector3, right: THREE.Vector3): void {
    this.additive.spawn(p.x, p.y, p.z,
      right.x * 2 + (Math.random() - 0.5), 2 + Math.random(), right.z * 2 + (Math.random() - 0.5),
      0.5, 0.9, 0.7, 0.3, 9, 0.2);
  }

  explosion(p: THREE.Vector3): void {
    const n = this.count(46);
    for (let i = 0; i < n; i++) {
      const th = Math.random() * Math.PI * 2;
      const ph = Math.acos(2 * Math.random() - 1);
      const s = 3 + Math.random() * 11;
      const hot = Math.random();
      this.additive.spawn(p.x, p.y + 0.3, p.z,
        Math.sin(ph) * Math.cos(th) * s, Math.abs(Math.cos(ph)) * s * 0.9 + 2, Math.sin(ph) * Math.sin(th) * s,
        0.4 + Math.random() * 0.5, 1, 0.45 + hot * 0.4, 0.15 + hot * 0.2, 7, 1.2);
    }
    const d = this.count(16);
    for (let i = 0; i < d; i++) {
      const th = Math.random() * Math.PI * 2;
      const s = 1 + Math.random() * 3;
      this.alpha.spawn(p.x, p.y + 0.4, p.z,
        Math.cos(th) * s, 1.5 + Math.random() * 2.5, Math.sin(th) * s,
        1.2 + Math.random() * 1.2, 0.25, 0.24, 0.23, -1.1, 1.6);
    }
    // Debris chunks.
    const c = this.count(10);
    for (let i = 0; i < c; i++) {
      this.alpha.spawn(p.x, p.y + 0.3, p.z,
        (Math.random() - 0.5) * 9, 3 + Math.random() * 6, (Math.random() - 0.5) * 9,
        0.8 + Math.random() * 0.6, 0.15, 0.14, 0.13, 12, 0.3);
    }
    const f = this.flashes.find((x) => x.life <= 0) ?? this.flashes[0];
    f.sprite.visible = true;
    f.sprite.position.set(p.x, p.y + 0.6, p.z);
    f.sprite.scale.set(3.2, 3.2, 1);
    (f.sprite.material as THREE.SpriteMaterial).opacity = 1;
    (f.sprite.material as THREE.SpriteMaterial).color.setHex(0xffd9a0);
    f.life = f.maxLife = 0.22;
    f.grow = 3.2;
    this.flashLight(p, 0xff9a4c, 60, 22);
  }

  tracer(from: THREE.Vector3, to: THREE.Vector3, color: number): void {
    const t = this.tracers.find((x) => x.life <= 0) ?? this.tracers[0];
    const attr = t.line.geometry.getAttribute('position') as THREE.BufferAttribute;
    attr.setXYZ(0, from.x, from.y, from.z);
    attr.setXYZ(1, to.x, to.y, to.z);
    attr.needsUpdate = true;
    (t.line.material as THREE.LineBasicMaterial).color.setHex(color);
    (t.line.material as THREE.LineBasicMaterial).opacity = 0.9;
    t.line.visible = true;
    t.life = t.maxLife;
  }

  grenadeTrail(p: THREE.Vector3): void {
    this.alpha.spawn(p.x, p.y, p.z, 0, 0.5, 0, 0.5, 0.6, 0.6, 0.6, -0.3, 1);
  }

  bloodPuff(p: THREE.Vector3): void {
    this.impact(p, 'blood');
  }

  private flashLight(p: THREE.Vector3, color: number, intensity: number, dist: number): void {
    let best = 0;
    for (let i = 0; i < this.lights.length; i++) {
      if (this.lightLife[i] <= 0) {
        best = i;
        break;
      }
      if (this.lightLife[i] < this.lightLife[best]) best = i;
    }
    const l = this.lights[best];
    l.position.set(p.x, p.y + 0.5, p.z);
    l.color.setHex(color);
    l.intensity = intensity;
    l.distance = dist;
    this.lightLife[best] = 0.08;
  }

  update(dt: number): void {
    this.additive.update(dt);
    this.alpha.update(dt);
    this.updateDust(dt);
    for (const t of this.tracers) {
      if (t.life <= 0) continue;
      t.life -= dt;
      const k = Math.max(0, t.life / t.maxLife);
      (t.line.material as THREE.LineBasicMaterial).opacity = k * 0.9;
      if (t.life <= 0) t.line.visible = false;
    }
    for (const f of this.flashes) {
      if (f.life <= 0) continue;
      f.life -= dt;
      const k = Math.max(0, f.life / f.maxLife);
      const m = f.sprite.material as THREE.SpriteMaterial;
      m.opacity = k;
      const s = f.sprite.scale.x + f.grow * dt;
      f.sprite.scale.set(s, s, 1);
      if (f.life <= 0) {
        f.sprite.visible = false;
        m.color.setHex(0xffc37a);
      }
    }
    for (let i = 0; i < this.lights.length; i++) {
      if (this.lightLife[i] <= 0) continue;
      this.lightLife[i] -= dt;
      if (this.lightLife[i] <= 0) this.lights[i].intensity = 0;
      else this.lights[i].intensity *= Math.exp(-30 * dt);
    }
  }

  clear(): void {
    this.additive.clear();
    this.alpha.clear();
    for (const t of this.tracers) {
      t.life = 0;
      t.line.visible = false;
    }
    for (const f of this.flashes) {
      f.life = 0;
      f.sprite.visible = false;
    }
    for (const l of this.lights) l.intensity = 0;
  }

  get debugAlive(): number {
    return 0; // pools are fixed-size; nothing leaks by construction
  }
}
