// Grenade gameplay: throw -> ballistic flight -> bounce -> fuse -> explosion.
// Radial damage is LOS-gated (walls matter).
import * as THREE from 'three';
import { DAMAGE } from '../data/config';
import type { Level } from '../world/Level';
import type { ParticleSystem } from '../vfx/ParticleSystem';
import type { AudioManager } from '../audio/AudioManager';
import type { CombatSystem } from './CombatSystem';
import type { Player } from '../entities/Player';
import type { Enemy } from '../entities/Enemy';
import { clamp } from '../utils/math';

interface Grenade {
  active: boolean;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  fuse: number;
  mesh: THREE.Mesh;
  mat: THREE.MeshStandardMaterial;
}

const GRAVITY = 16;
const MAX_GRENADES = 6;

export class GrenadeSystem {
  private grenades: Grenade[] = [];

  constructor(
    private scene: THREE.Scene,
    private level: Level,
    private particles: ParticleSystem,
    private audio: AudioManager,
    private combat: CombatSystem,
    private playerPos: THREE.Vector3,
  ) {
    const geo = new THREE.SphereGeometry(0.1, 10, 8);
    for (let i = 0; i < MAX_GRENADES; i++) {
      const mat = new THREE.MeshStandardMaterial({ color: 0x2e3a2a, roughness: 0.6, metalness: 0.3 });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.visible = false;
      mesh.castShadow = true;
      scene.add(mesh);
      this.grenades.push({
        active: false, pos: new THREE.Vector3(), vel: new THREE.Vector3(),
        fuse: 0, mesh, mat,
      });
    }
  }

  get activeCount(): number {
    return this.grenades.filter((g) => g.active).length;
  }

  /** Throw toward a target point. Returns false if none available. */
  throwAt(from: THREE.Vector3, target: THREE.Vector3): boolean {
    const g = this.grenades.find((x) => !x.active);
    if (!g) return false;
    g.active = true;
    g.mesh.visible = true;
    g.pos.set(from.x, 1.4, from.z);
    const dx = target.x - from.x;
    const dz = target.z - from.z;
    const dist = clamp(Math.hypot(dx, dz), 3, 17);
    const nx = dx / Math.max(0.001, Math.hypot(dx, dz));
    const nz = dz / Math.max(0.001, Math.hypot(dx, dz));
    // Flat-ish throw scaled by distance + upward lob.
    const speed = clamp(dist * 1.15, 4, 13);
    g.vel.set(nx * speed, 4.2 + dist * 0.22, nz * speed);
    g.fuse = DAMAGE.grenadeFuse;
    this.audio.playPin();
    return true;
  }

  update(dt: number, now: number, player: Player, enemies: Enemy[], onKill: (e: Enemy) => void): void {
    for (const g of this.grenades) {
      if (!g.active) continue;
      g.fuse -= dt;
      // Physics.
      g.vel.y -= GRAVITY * dt;
      const nx = g.pos.x + g.vel.x * dt;
      const nz = g.pos.z + g.vel.z * dt;
      // Wall bounce (axis separated).
      if (!this.level.isWalkableWorld(nx, g.pos.z) && this.level.segmentBlocked(g.pos.x, Math.max(0.3, g.pos.y), g.pos.z, nx, Math.max(0.3, g.pos.y), g.pos.z)) {
        g.vel.x *= -0.4;
      } else {
        g.pos.x = nx;
      }
      if (!this.level.isWalkableWorld(g.pos.x, nz) && this.level.segmentBlocked(g.pos.x, Math.max(0.3, g.pos.y), g.pos.z, g.pos.x, Math.max(0.3, g.pos.y), nz)) {
        g.vel.z *= -0.4;
      } else {
        g.pos.z = nz;
      }
      g.pos.y += g.vel.y * dt;
      if (g.pos.y < 0.1) {
        g.pos.y = 0.1;
        if (Math.abs(g.vel.y) > 2) {
          const d = g.pos.distanceTo(this.playerPos);
          this.audio.playGrenadeBounce(clamp(d / 40, 0, 1));
        }
        g.vel.y *= -0.35;
        g.vel.x *= 0.6;
        g.vel.z *= 0.6;
      }
      g.mesh.position.copy(g.pos);
      // Blink faster as fuse burns.
      const urgency = 1 - clamp(g.fuse / DAMAGE.grenadeFuse, 0, 1);
      g.mat.emissive.setRGB(urgency * (0.5 + 0.5 * Math.sin(now * (6 + urgency * 20))), 0.05, 0);
      if (Math.random() < dt * 20) this.particles.grenadeTrail(g.pos);

      if (g.fuse <= 0) {
        g.active = false;
        g.mesh.visible = false;
        const { killedEnemies } = this.combat.explode(
          g.pos, DAMAGE.grenadeRadius, DAMAGE.grenadeDamage,
          player, enemies, now, 0.6,
        );
        for (const e of killedEnemies) onKill(e);
      }
    }
  }

  clear(): void {
    for (const g of this.grenades) {
      g.active = false;
      g.mesh.visible = false;
    }
  }
}
