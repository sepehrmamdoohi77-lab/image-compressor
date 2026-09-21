// Fair enemy spawning: validated points, staggered timing, concurrency caps.
import type { EnemyArchetype, RoundDef } from '../data/config';
import type { Level } from '../world/Level';
import type { Enemy } from '../entities/Enemy';
import { findPath } from '../world/Navigation';
import { worldToCell } from '../world/Level';

export interface SpawnValidation {
  ok: boolean;
  reason: string;
}

/** Pure spawn-point validation (unit-tested). */
export function validateSpawnPoint(
  x: number, z: number,
  playerX: number, playerZ: number,
  walkable: boolean,
  playerLosClear: boolean,
  nearestEnemyDist: number,
  minDist: number,
  minDistIfVisible: number,
): SpawnValidation {
  if (!walkable) return { ok: false, reason: 'unreachable' };
  const d = Math.hypot(x - playerX, z - playerZ);
  if (d < minDist) return { ok: false, reason: 'too-close' };
  if (playerLosClear && d < minDistIfVisible) return { ok: false, reason: 'visible' };
  if (nearestEnemyDist < 1.6) return { ok: false, reason: 'occupied' };
  return { ok: true, reason: 'ok' };
}

export class SpawnSystem {
  private queue: EnemyArchetype[] = [];
  private timer = 0;
  private round: RoundDef | null = null;

  constructor(private level: Level) {}

  get pending(): number {
    return this.queue.length;
  }

  startRound(round: RoundDef): void {
    this.round = round;
    // Shuffle but keep heavies for later in the round.
    const lights = round.enemies.filter((a) => a !== 'heavy');
    const heavies = round.enemies.filter((a) => a === 'heavy');
    for (let i = lights.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [lights[i], lights[j]] = [lights[j], lights[i]];
    }
    this.queue = [...lights, ...heavies];
    this.timer = 0.5;
  }

  clear(): void {
    this.queue = [];
    this.round = null;
  }

  /**
   * Returns archetypes to spawn this frame (usually 0-1). Game performs the
   * actual spawn via the callback so entity ownership stays in one place.
   */
  update(
    dt: number,
    playerX: number, playerZ: number,
    activeCount: number,
    enemies: Enemy[],
    spawn: (archetype: EnemyArchetype, x: number, z: number) => void,
  ): void {
    if (!this.round || this.queue.length === 0) return;
    if (activeCount >= this.round.maxConcurrent) return;
    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = this.round.spawnInterval;

    const point = this.pickSpawnPoint(playerX, playerZ, enemies);
    if (!point) {
      this.timer = 0.4; // retry soon; never spawn unfairly
      return;
    }
    const archetype = this.queue.shift();
    if (archetype) spawn(archetype, point.x, point.z);
  }

  private pickSpawnPoint(
    playerX: number, playerZ: number, enemies: Enemy[],
  ): { x: number; z: number } | null {
    const candidates = [...this.level.enemySpawns];
    // Shuffle for variety.
    for (let i = candidates.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
    }
    for (const c of candidates) {
      let nearest = Infinity;
      for (const e of enemies) {
        if (!e.alive) continue;
        nearest = Math.min(nearest, Math.hypot(c.x - e.pos.x, c.z - e.pos.z));
      }
      const walkable = this.level.isWalkableWorld(c.x, c.z);
      const los = this.level.losClear(c.x, c.z, playerX, playerZ);
      const v = validateSpawnPoint(c.x, c.z, playerX, playerZ, walkable, los, nearest, 10, 16);
      if (!v.ok) continue;
      // Must be able to path toward the player (fair + unstuck).
      const path = findPath(
        this.level.grid, 44,
        { cx: worldToCell(c.x), cz: worldToCell(c.z) },
        { cx: worldToCell(playerX), cz: worldToCell(playerZ) },
        { maxIterations: 1200 },
      );
      if (!path) continue;
      return c;
    }
    return null;
  }
}
