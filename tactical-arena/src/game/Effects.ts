import * as THREE from 'three';
import type { CombatEvent, GameConfig, GrenadeState } from '../multiplayer/protocol';
interface Particle {
  mesh: THREE.Mesh;
  velocity: THREE.Vector3;
  life: number;
  max: number;
  size: number;
}
interface Trace {
  line: THREE.Line;
  life: number;
}

/** Bounded presentation pools. All combat effects originate from validated server events. */
export class CombatEffects {
  readonly group = new THREE.Group();
  private particles: Particle[] = [];
  private traces: Trace[] = [];
  private sphere = new THREE.SphereGeometry(1, 7, 5);
  private ring = new THREE.RingGeometry(0.75, 1, 24);
  private grenadeGeometry = new THREE.SphereGeometry(0.105, 8, 6);
  private grenadeMaterial = new THREE.MeshStandardMaterial({ color: '#545a39', roughness: 0.8 });
  private grenades = new Map<string, THREE.Mesh>();
  private rings: { mesh: THREE.Mesh; life: number }[] = [];
  private counter = 0;
  quality = 'balanced';
  constructor(private config: GameConfig) {
    for (let i = 0; i < 64; i++) {
      const material = new THREE.MeshBasicMaterial({
        color: '#e6cfa8',
        transparent: true,
        depthWrite: false,
      });
      const mesh = new THREE.Mesh(this.sphere, material);
      mesh.visible = false;
      this.group.add(mesh);
      this.particles.push({ mesh, velocity: new THREE.Vector3(), life: 0, max: 1, size: 0.1 });
    }
    for (let i = 0; i < 32; i++) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
      const mat = new THREE.LineBasicMaterial({
        color: '#e8c18b',
        transparent: true,
        depthWrite: false,
        opacity: 0.8,
      });
      const line = new THREE.Line(geo, mat);
      line.frustumCulled = false;
      line.visible = false;
      this.group.add(line);
      this.traces.push({ line, life: 0 });
    }
    for (let i = 0; i < 4; i++) {
      const mesh = new THREE.Mesh(
        this.ring,
        new THREE.MeshBasicMaterial({
          color: '#c9a66c',
          transparent: true,
          depthWrite: false,
          side: THREE.DoubleSide,
        }),
      );
      mesh.rotation.x = -Math.PI / 2;
      mesh.visible = false;
      this.group.add(mesh);
      this.rings.push({ mesh, life: 0 });
    }
  }
  private burst(
    x: number,
    y: number,
    z: number,
    color: string,
    count: number,
    size: number,
    life: number,
    speed: number,
  ) {
    for (let i = 0; i < count; i++) {
      const p = this.particles[this.counter++ % this.particles.length]!;
      p.mesh.position.set(x, y, z);
      p.life = p.max = life;
      p.size = size;
      p.mesh.scale.setScalar(size);
      p.mesh.visible = true;
      (p.mesh.material as THREE.MeshBasicMaterial).color.set(color);
      p.velocity.set(
        (Math.random() - 0.5) * speed,
        Math.random() * speed * 0.7,
        (Math.random() - 0.5) * speed,
      );
    }
  }
  event(message: CombatEvent) {
    const e = message.event;
    if (e.kind === 'shot') {
      this.burst(e.origin.x, e.origin.y, e.origin.z, '#ffe8a4', 1, 0.1, 0.055, 0);
      this.burst(e.origin.x, e.origin.y, e.origin.z, '#b6b1a0', 1, 0.05, 0.3, 0.7);
      for (let i = 0; i < e.ends.length; i++) {
        const end = e.ends[i]!;
        const trace =
          this.traces.find((t) => t.life <= 0) ?? this.traces[this.counter % this.traces.length]!;
        const positions = trace.line.geometry.attributes.position as THREE.BufferAttribute;
        positions.setXYZ(0, e.origin.x, e.origin.y, e.origin.z);
        positions.setXYZ(1, end.x, end.y, end.z);
        positions.needsUpdate = true;
        trace.life = 0.075;
        trace.line.visible = true;
        if (e.impacts[i] !== 'air' && e.impacts[i] !== 'protected')
          this.burst(
            end.x,
            end.y,
            end.z,
            e.impacts[i] === 'blood' ? '#8c4d42' : '#b3ae94',
            this.quality === 'low' ? 2 : 4,
            0.035,
            0.28,
            1.2,
          );
      }
    } else if (e.kind === 'explosion') {
      const p = e.position;
      this.burst(p.x, p.y, p.z, '#edb362', this.quality === 'low' ? 6 : 14, 0.28, 0.42, 5.5);
      this.burst(p.x, p.y + 0.4, p.z, '#7b796b', this.quality === 'low' ? 6 : 12, 0.52, 1.15, 3.1);
      const ring = this.rings.find((r) => r.life <= 0) ?? this.rings[0]!;
      ring.mesh.position.set(p.x, 0.06, p.z);
      ring.life = 0.45;
      ring.mesh.visible = true;
    } else if (e.kind === 'cover_destroyed') {
      const o = this.config.map.obstacles.find((o) => o.id === e.coverId);
      if (o) this.burst(o.x, o.h * 0.4, o.z, '#9e977a', 8, 0.15, 0.65, 2);
    }
  }
  updateGrenades(states: GrenadeState[]) {
    const ids = new Set(states.map((g) => g.id));
    for (const [id, m] of this.grenades)
      if (!ids.has(id)) {
        m.removeFromParent();
        this.grenades.delete(id);
      }
    for (const state of states) {
      let mesh = this.grenades.get(state.id);
      if (!mesh) {
        mesh = new THREE.Mesh(this.grenadeGeometry, this.grenadeMaterial);
        mesh.castShadow = true;
        this.group.add(mesh);
        this.grenades.set(state.id, mesh);
      }
      mesh.position.set(state.x, state.y, state.z);
      mesh.rotation.x += 0.2;
    }
  }
  tick(dt: number) {
    for (const p of this.particles) {
      if (p.life <= 0) continue;
      p.life -= dt;
      p.mesh.visible = p.life > 0;
      if (!p.mesh.visible) continue;
      p.mesh.position.addScaledVector(p.velocity, dt);
      p.velocity.y -= dt * 2;
      (p.mesh.material as THREE.MeshBasicMaterial).opacity = Math.min(0.85, p.life / p.max);
      p.mesh.scale.setScalar(p.size * (1 + (1 - p.life / p.max) * 1.5));
    }
    for (const t of this.traces) {
      t.life -= dt;
      t.line.visible = t.life > 0;
      (t.line.material as THREE.LineBasicMaterial).opacity = Math.max(0, t.life / 0.075) * 0.75;
    }
    for (const r of this.rings) {
      r.life -= dt;
      r.mesh.visible = r.life > 0;
      r.mesh.scale.setScalar((0.45 - r.life) * 10);
      (r.mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(0, r.life / 0.45) * 0.5;
    }
  }
  dispose() {
    this.group.removeFromParent();
    this.sphere.dispose();
    this.ring.dispose();
    this.grenadeGeometry.dispose();
    this.grenadeMaterial.dispose();
    this.particles.forEach((p) => (p.mesh.material as THREE.Material).dispose());
    this.traces.forEach((t) => {
      t.line.geometry.dispose();
      (t.line.material as THREE.Material).dispose();
    });
    this.rings.forEach((r) => (r.mesh.material as THREE.Material).dispose());
    this.group.clear();
  }
}
