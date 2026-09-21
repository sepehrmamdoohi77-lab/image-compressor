// Field resupply: health kits drop at random spots around the compound.
// Walk over one to heal (30% of max health). Never wasted — a kit is only
// consumed when the player actually needs it, and it despawns if ignored.
//
// Spawn placement is a pure, unit-tested function so the rules stay honest:
// open floor only, never inside geometry, never in the player's lap, never
// stacked on another kit.
import * as THREE from 'three';
import { PICKUPS, WORLD } from '../data/config';
import { cellToWorld, type Level } from '../world/Level';
import type { MaterialLib, GeometryLib } from '../world/Materials';
import type { Player } from '../entities/Player';

export interface PickupSpot {
  x: number;
  z: number;
}

export interface Pickup {
  id: number;
  spot: PickupSpot;
  group: THREE.Group;
  expiresAt: number;
  phase: number;
}

export interface PickupResult {
  amount: number;
  total: number;
}

/** A kit needs breathing room: the cell plus all four neighbours open. */
export function isOpenSpot(level: Level, cx: number, cz: number): boolean {
  if (!level.isWalkableCell(cx, cz)) return false;
  return (
    level.isWalkableCell(cx + 1, cz) &&
    level.isWalkableCell(cx - 1, cz) &&
    level.isWalkableCell(cx, cz + 1) &&
    level.isWalkableCell(cx, cz - 1)
  );
}

/**
 * Pick a random open spot: inside the arena, out of the player's immediate
 * area, and clear of existing kits. Returns null if nothing suitable is found.
 */
export function pickSpawnSpot(
  level: Level,
  rng: () => number,
  playerX: number,
  playerZ: number,
  taken: PickupSpot[],
  attempts = 48,
): PickupSpot | null {
  const size = WORLD.SIZE_CELLS;
  const minFromPlayer = PICKUPS.minDistanceFromPlayer;
  const minFromKit = 5;
  for (let i = 0; i < attempts; i++) {
    const cx = 2 + Math.floor(rng() * (size - 4));
    const cz = 2 + Math.floor(rng() * (size - 4));
    if (!isOpenSpot(level, cx, cz)) continue;
    const x = cellToWorld(cx);
    const z = cellToWorld(cz);
    if (Math.hypot(x - playerX, z - playerZ) < minFromPlayer) continue;
    let tooClose = false;
    for (const t of taken) {
      if (Math.hypot(t.x - x, t.z - z) < minFromKit) {
        tooClose = true;
        break;
      }
    }
    if (tooClose) continue;
    return { x, z };
  }
  return null;
}

export class PickupSystem {
  readonly items: Pickup[] = [];
  private nextId = 1;
  private nextSpawnAt = 0;
  private bodyMat: THREE.MeshStandardMaterial;
  private crossMat: THREE.MeshStandardMaterial;
  private ringMat: THREE.MeshBasicMaterial;
  private ringGeo: THREE.RingGeometry;

  constructor(
    private scene: THREE.Scene,
    private level: Level,
    mats: MaterialLib,
    private geos: GeometryLib,
  ) {
    void mats;
    this.bodyMat = new THREE.MeshStandardMaterial({ color: 0xe9ecea, roughness: 0.6, metalness: 0.1 });
    this.crossMat = new THREE.MeshStandardMaterial({ color: 0xd6402f, roughness: 0.55, emissive: 0x4a0f08, emissiveIntensity: 0.8 });
    this.ringMat = new THREE.MeshBasicMaterial({
      color: 0x63d67a, transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.ringGeo = new THREE.RingGeometry(0.55, 0.78, 24);
  }

  get activeCount(): number {
    return this.items.length;
  }

  /** Kits on the map (used by the radar). */
  get spots(): PickupSpot[] {
    return this.items.map((i) => i.spot);
  }

  /** First spawn of a run: give the player a moment before kits start dropping. */
  beginRun(now: number, rng: () => number = Math.random): void {
    this.nextSpawnAt = now + 6 + rng() * 5;
  }

  /**
   * Spawn/expire kits and resolve pickups. Returns the heal result when the
   * player walks over a kit they actually need.
   */
  update(dt: number, now: number, player: Player, rng: () => number = Math.random): PickupResult | null {
    // Expire ignored kits.
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      if (now >= it.expiresAt) {
        this.removeAt(i);
      }
    }

    // Spawn.
    if (now >= this.nextSpawnAt && this.items.length < PICKUPS.maxActive) {
      const taken = this.items.map((i) => i.spot);
      const spot = pickSpawnSpot(this.level, rng, player.pos.x, player.pos.z, taken);
      if (spot) this.spawn(spot, now);
      this.nextSpawnAt = now + (spot
        ? PICKUPS.spawnEveryMin + rng() * (PICKUPS.spawnEveryMax - PICKUPS.spawnEveryMin)
        : 2.5); // retry soon if the map had no room
    }

    // Animate + test pickup.
    let result: PickupResult | null = null;
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      const bob = Math.sin(it.phase + now * 2.2) * PICKUPS.bobAmplitude;
      it.group.position.set(it.spot.x, 0.34 + bob, it.spot.z);
      it.group.rotation.y = it.phase + now * PICKUPS.spinRate;
      const ring = it.group.children[0];
      if (ring) {
        const pulse = 1 + 0.09 * Math.sin(now * 3.1 + it.phase);
        ring.scale.set(pulse, pulse, 1);
      }
      if (!player.alive) continue;
      const d = Math.hypot(player.pos.x - it.spot.x, player.pos.z - it.spot.z);
      if (d > PICKUPS.radius) continue;
      if (player.health >= player.maxHealth) continue; // don't waste a kit
      const amount = Math.round(player.maxHealth * PICKUPS.healthFraction);
      const gained = player.heal(amount);
      if (gained > 0) result = { amount: gained, total: player.health };
      this.removeAt(i);
    }
    void dt;
    return result;
  }

  private spawn(spot: PickupSpot, now: number): void {
    const group = new THREE.Group();
    // Beacon ring on the ground (children[0] is animated).
    const ring = new THREE.Mesh(this.ringGeo, this.ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.02;
    group.add(ring);
    // Case.
    const caseMesh = new THREE.Mesh(this.geos.box, this.bodyMat);
    caseMesh.scale.set(0.42, 0.28, 0.3);
    caseMesh.castShadow = true;
    group.add(caseMesh);
    const lid = new THREE.Mesh(this.geos.box, this.crossMat);
    lid.scale.set(0.44, 0.06, 0.32);
    lid.position.y = 0.16;
    lid.castShadow = true;
    group.add(lid);
    // Red cross (two plates) — readable from the iso camera.
    const crossA = new THREE.Mesh(this.geos.box, this.crossMat);
    crossA.scale.set(0.22, 0.02, 0.07);
    crossA.position.set(0, 0.2, 0);
    group.add(crossA);
    const crossB = new THREE.Mesh(this.geos.box, this.crossMat);
    crossB.scale.set(0.07, 0.02, 0.22);
    crossB.position.set(0, 0.2, 0);
    group.add(crossB);
    group.position.set(spot.x, 0.34, spot.z);
    this.scene.add(group);
    this.items.push({
      id: this.nextId++,
      spot,
      group,
      expiresAt: now + PICKUPS.lifetime,
      phase: Math.random() * Math.PI * 2,
    });
  }

  private removeAt(index: number): void {
    const it = this.items[index];
    if (!it) return;
    this.scene.remove(it.group);
    this.items.splice(index, 1);
  }

  clear(): void {
    for (const it of this.items) this.scene.remove(it.group);
    this.items.length = 0;
    this.nextSpawnAt = 0;
  }

  dispose(): void {
    this.clear();
    this.bodyMat.dispose();
    this.crossMat.dispose();
    this.ringMat.dispose();
    this.ringGeo.dispose();
  }
}
