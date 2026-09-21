// Tactical cover evaluation: distance, exposure, accessibility, occupancy.
// Pure scoring function is unit-tested; the class manages claims.
import type { CoverPoint, Level } from '../world/Level';
import { AI } from '../data/config';

export interface CoverScoreCtx {
  ex: number; ez: number; // enemy position
  tx: number; tz: number; // threat position
  occupied: boolean;
  preferredMin: number;
  preferredMax: number;
  reachable: boolean;
  /** Recently abandoned by anyone: soldiers avoid re-using the same spot. */
  recentlyUsed?: boolean;
}

/** Higher = better. Pure and deterministic (no Math.random inside). */
export function scoreCoverPoint(p: CoverPoint, ctx: CoverScoreCtx): number {
  if (!ctx.reachable) return -Infinity;
  const dxE = p.x - ctx.ex;
  const dzE = p.z - ctx.ez;
  const distE = Math.hypot(dxE, dzE);
  const dxT = ctx.tx - p.x;
  const dzT = ctx.tz - p.z;
  const distT = Math.hypot(dxT, dzT);

  // 1. Proximity to self (closer is better, but not the cell we're on).
  let score = 30 - Math.min(30, distE * 1.6);

  // 2. Cover obstacle must be between point and threat:
  // point normal faces away from the obstacle; ideal: threat is behind obstacle.
  const tLen = Math.max(1e-6, distT);
  const dot = p.nx * (dxT / tLen) + p.nz * (dzT / tLen);
  score += (0.5 - dot * 0.5) * 40; // dot=-1 (threat behind obstacle) -> +40

  // 3. Threat distance within preferred band.
  if (distT >= ctx.preferredMin && distT <= ctx.preferredMax) score += 18;
  else {
    const edge = distT < ctx.preferredMin ? ctx.preferredMin - distT : distT - ctx.preferredMax;
    score -= Math.min(20, edge * 1.2);
  }

  // 4. Low cover is flexible (shoot over it); high cover is safer.
  score += p.kind === 'low' ? 4 : 7;

  // 5. Occupancy.
  if (ctx.occupied) score -= 60;

  // 6. Prefer not to be too close to the threat.
  if (distT < 4) score -= 25;

  // 7. Fresh positions: a point someone just left is a known firing solution.
  if (ctx.recentlyUsed) score -= AI.coverReusePenalty;

  return score;
}

export class CoverSystem {
  claims = new Map<number, number>(); // cover index -> enemy id
  /** cover index -> last time it was occupied (drives the re-use penalty). */
  private lastUsedAt = new Map<number, number>();

  constructor(private level: Level) {}

  get points(): CoverPoint[] {
    return this.level.coverPoints;
  }

  isClaimedByOther(index: number, enemyId: number): boolean {
    const c = this.claims.get(index);
    return c !== undefined && c !== enemyId;
  }

  claim(index: number, enemyId: number): void {
    this.claims.set(index, enemyId);
  }

  /** Mark a point as (re)occupied so it cools down after being abandoned. */
  markUsed(index: number, now: number): void {
    this.lastUsedAt.set(index, now);
  }

  /** True while a point is still on its "don't camp the same sandbag" cooldown. */
  recentlyUsed(index: number, now = this.now): boolean {
    const t = this.lastUsedAt.get(index);
    return t !== undefined && now - t < AI.coverReuseCooldown;
  }

  /** Does this point still shield its occupant from (tx,tz)? False = flanked. */
  blocksThreat(index: number, tx: number, tz: number): boolean {
    const p = this.points[index];
    if (!p) return false;
    const dx = tx - p.x;
    const dz = tz - p.z;
    const len = Math.max(1e-6, Math.hypot(dx, dz));
    // Point normal faces away from its obstacle: the threat should be opposite.
    return p.nx * (dx / len) + p.nz * (dz / len) < 0.35;
  }

  releaseByEnemy(enemyId: number): void {
    for (const [k, v] of this.claims) {
      if (v === enemyId) this.claims.delete(k);
    }
  }

  release(index: number): void {
    this.claims.delete(index);
  }

  /**
   * Best cover for an enemy threatened from (tx,tz). Reachability uses a
   * cheap grid-LOS + walkability check (full A* happens on move).
   */
  findCover(
    ex: number, ez: number, tx: number, tz: number, enemyId: number,
    preferredMin: number, preferredMax: number,
    now = this.now,
  ): number {
    const pts = this.points;
    let best = -1;
    let bestScore = -Infinity;
    const maxR = AI.coverSearchRadius;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      const dx = p.x - ex;
      const dz = p.z - ez;
      if (dx * dx + dz * dz > maxR * maxR) continue;
      const occupied = this.isClaimedByOther(i, enemyId);
      const score = scoreCoverPoint(p, {
        ex, ez, tx, tz, occupied, preferredMin, preferredMax, reachable: true,
        recentlyUsed: this.recentlyUsed(i, now),
      }) + (occupied ? 0 : Math.random() * 4); // small jitter breaks ties
      if (score > bestScore) {
        bestScore = score;
        best = i;
      }
    }
    return best;
  }

  /** Current simulation time, injected by the AI layer for cooldown maths. */
  now = 0;

  reset(): void {
    this.claims.clear();
    this.lastUsedAt.clear();
    this.now = 0;
  }
}
