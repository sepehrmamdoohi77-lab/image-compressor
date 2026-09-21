// Enemy gunnery model: how well hostiles shoot, and why they sometimes miss.
//
// Design intent: hostiles must *feel* human. Two layers feed every shot:
//   1. Continuous aim error  — the sight picture is off, and it gets worse with
//      range, target movement, shooter movement and a fresh reaction.
//   2. Deliberate near misses — an occasional round is thrown wide on purpose so
//      it cracks past the player (whiz + shake) instead of punching through.
// All of it is pure math with an injectable RNG so it can be unit-tested.
import { AI, PLAYER_CONFIG } from '../data/config';
import { clamp } from '../utils/math';

export interface EnemyShotInput {
  /** Archetype accuracy 0..1 before difficulty scaling. */
  accuracy: number;
  /** Round-based accuracy multiplier (0.8 .. 1.12). */
  accuracyMult: number;
  /** Shooter -> player distance (m). */
  distance: number;
  /** Shooter weapon effective range (m). */
  range: number;
  playerMoving: boolean;
  playerSpeed: number;
  playerCrouched: boolean;
  shooterMoving: boolean;
  /** True while the shooter is still re-acquiring (recent reaction timer). */
  reactionRecent: boolean;
  /** True right after taking damage or being forced out of cover. */
  suppressed: boolean;
}

export interface EnemyShotPlan {
  /** Aim cone error in radians (fed to the shot solver). */
  aimError: number;
  /** True when this shot is a planned near miss. */
  miss: boolean;
  /** Signed lateral offset in metres (perpendicular to the shot line). */
  lateral: number;
  /** Vertical offset in metres. */
  vertical: number;
}

/** Difficulty-scaled accuracy, clamped to a readable band. */
export function enemyAccuracy(accuracy: number, accuracyMult: number): number {
  return clamp(accuracy * accuracyMult, 0.05, 0.95);
}

/** Continuous aim error (radians) for one shot. */
export function enemyAimError(input: EnemyShotInput): number {
  const acc = enemyAccuracy(input.accuracy, input.accuracyMult);
  let err = AI.aimErrorBase * (1.35 - acc);
  err += (input.distance / Math.max(1, input.range)) * 0.035;
  if (input.playerMoving) {
    err += AI.aimErrorMoveTarget * clamp(input.playerSpeed / PLAYER_CONFIG.walkSpeed, 0, 1);
  }
  if (input.shooterMoving) err += AI.aimErrorMoveSelf;
  if (input.playerCrouched) err += 0.012;
  if (input.reactionRecent) err *= 1.6;
  return err;
}

/** Probability (0..maxMissChance) that this shot is thrown wide on purpose. */
export function enemyMissChance(input: EnemyShotInput): number {
  const acc = enemyAccuracy(input.accuracy, input.accuracyMult);
  let c = AI.missChanceBase + AI.missChanceAccuracyScale * (1 - acc);
  if (input.playerMoving) {
    c += AI.missChanceMoving * clamp(input.playerSpeed / PLAYER_CONFIG.walkSpeed, 0, 1.2);
  }
  c += AI.missChanceDistance * clamp(input.distance / Math.max(1, input.range), 0, 1);
  if (input.suppressed) c += AI.missChanceSuppressed;
  if (input.playerCrouched) c += 0.04;
  // A fresh reaction should not be a guaranteed miss — cap the stack.
  return clamp(c, 0, 0.35);
}

/**
 * Decide the shot: cone error plus an optional planned near miss.
 * `rng` returns [0,1) (injectable for deterministic tests).
 */
export function planEnemyShot(input: EnemyShotInput, rng: () => number = Math.random): EnemyShotPlan {
  const aimError = enemyAimError(input);
  const miss = rng() < enemyMissChance(input);
  if (!miss) return { aimError, miss: false, lateral: 0, vertical: 0 };
  const side = rng() < 0.5 ? -1 : 1;
  // 0.55..1.0 of the tuned lateral magnitude: the round snaps past the player.
  const lateral = side * AI.missLateral * (0.55 + rng() * 0.45);
  const vertical = (rng() - 0.5) * 2 * AI.missVertical;
  return { aimError, miss: true, lateral, vertical };
}

/**
 * Closest approach (m) of a ray to a point, or Infinity when the point is
 * behind the muzzle or beyond `maxT` (i.e. the round never got near them).
 */
export function rayPointDistance(
  ox: number, oy: number, oz: number,
  dx: number, dy: number, dz: number,
  px: number, py: number, pz: number,
  maxT: number,
): number {
  const t = (px - ox) * dx + (py - oy) * dy + (pz - oz) * dz;
  if (t <= 0 || t > maxT) return Infinity;
  const cx = ox + dx * t;
  const cy = oy + dy * t;
  const cz = oz + dz * t;
  return Math.hypot(px - cx, py - cy, pz - cz);
}
