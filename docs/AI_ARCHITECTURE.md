# AI ARCHITECTURE

One `AIController` per enemy (`game/ai/`). Cycle per frame:
**perceive (staggered ~5 Hz) → decide (~2 Hz) → act (every frame)**.

## Perception (`AIController.perceive`)

- **Vision**: distance < `visionRange` (22–32 m by archetype), angle within
  half-FOV (95–120°) or <3.5 m proximity, and 3D LOS at true eye heights
  (`segmentBlocked`, so crouching behind low cover genuinely hides).
- **Hearing**: `SquadAwareness` noise events (shots r19, explosions r34) within
  `hearingRadius` (13–18 m) create suspicion / weak memory.
- **Squad sharing**: an enemy with fresh vision `report()`s an approximate
  position (±3.5 m noise, ×0.6 confidence); others become Suspicious toward it.
- First acquisition sets `reactionAt = now + reactionTime` (0.45–0.9 s) and
  may play an alert stinger. No enemy ever has perfect knowledge.

## Memory

`lastSeenPos/lastSeenAt/confidence`, confidence decaying over 7 s.
`confidence > 0.55` + reacted ⇒ combat; 0.2–0.55 ⇒ investigate/search;
below ⇒ patrol. Suspicion (hearing/squad) decays over 4 s.

## FSM states

`Idle → Patrol ⇄ Suspicious → Investigating → Searching ⇄ Engaging ⇄
TakingCover → InCover, Flanking, Retreating, Reloading, HitReaction → Dead`.

- **Patrol**: random reachable points near spawn, idle pauses.
- **Suspicious**: face stimulus 1.1 s, then investigate or stand down.
- **Investigating/Searching**: path to stimulus, then 4-point spiral search.
- **Engaging**: range management vs preferred band (advance / hold+strafe /
  back off), posture rolls (cover when recently hurt, flank by aggression),
  burst fire with line-of-fire checks.
- **TakingCover/InCover**: claims scored cover, paths there, crouches
  (breaking LOS behind low/mid cover), then fights from it: config-driven
  peek/hide rhythm (1.2–2.4 s exposed, 1.0–2.0 s tucked) with alternating
  shoulders and a damped lean, 75% chance to stay pinned when hit, a flank
  re-check every 1.1 s and relocation after 7.5 s or 35% max-HP absorbed
  (see the Cover section below).
- **Flanking**: ±55° arc point at mid preferred range, engages on the move.
- **Retreating**: far cover when HP < 28% and aggression low, then re-engage.
- **Reloading**: tactical (≤25% mag when safe) + empty reloads, sidestep/crouch.
- **HitReaction**: 0.35 s stagger on ≥22 damage hits; damage always reveals
  approximate attacker position (never exact).

## Firing model (`tryShoot`)

Gates: player alive, confidence > 0.35, reacted, in range, facing (±0.5 rad),
muzzle→chest line-of-fire clear, burst discipline (`burstSize`/`burstPause`).
Aim error and fallibility live in `combat/EnemyFire.ts` (pure + unit-tested):

- `enemyAccuracy(accuracy, accuracyMult)` → 0.05..0.95 as difficulty scales.
- `enemyAimError(input)` → archetype accuracy term + distance term + target
  movement + self movement + crouch-target + post-acquisition bloom.
- `enemyMissChance(input)` → deliberate-miss probability from accuracy, target
  speed, range and suppression, **capped at 0.35** so hostiles stay dangerous.
- `planEnemyShot(input, rng)` → `{ aimError, miss, lateral, vertical }`; a
  planned miss offsets the shot 0.55–1.0 m to one side (plus ±0.45 m vertically)
  so the round cracks past the player instead of connecting.
- `rayPointDistance(...)` → closest approach of the round to the player, used by
  `CombatSystem.enemyFire` to fire the whiz-by SFX + camera kick on near misses
  (`AI.nearMissRadius`, 1.8 m).

Misses stay readable: tracers, wall impacts, near-miss audio. `EnemyFireResult`
reports `miss` / `nearMiss` for stats and HUD.

## Cover (`ai/CoverSystem`)

Points generated from blocked/open adjacency. Pure score:
proximity + obstacle-between-self-and-threat (normal vs threat dot) +
preferred-range band + kind bonus − occupancy − too-close penalty −
**re-use penalty** (`recentlyUsed`, 16 s cooldown, 45 points) so a squad does
not recycle the same sandbag. Claims prevent stacking; released on state
exit/death, and every claim stamps `markUsed()`.

**In-cover behaviour (`AI.cover*` in `data/config.ts`)** — soldiers fight from
cover instead of standing behind it:

| Beat | Rule |
|---|---|
| Peek | `coverPeekMin/Max` 1.2–2.4 s exposed, `leanTarget = peekSide × 0.42` rad |
| Hide | `coverHideMin/Max` 1.0–2.0 s tucked, lean eases back to 0 |
| Shoulders | new random `peekSide` each peek (silhouette keeps changing) |
| Advance | `coverAdvanceChance` 0.3 — break cover to the *next* firing position |
| Pinned | hit while in cover: 75% chance to stay tucked and extend `hideUntil` |
| Flank check | every `coverFlankRecheck` 1.1 s via `cover.blocksThreat()` — a
threat that has moved around the obstacle invalidates the position |
| Relocate | after `coverRelocateAfter` 7.5 s (×0.8–1.3 jitter) **or** once this
position has absorbed `coverRelocateDamage` 35% of max HP |

Lean is damped (`coverLeanDamp` 6.5/s) and the head counter-rotates, so peeking
reads as motion rather than a snap. Relocation re-runs `findCover`, which
prefers fresh points and rejects occupied/flanked ones.

## Navigation

A\* over the collision grid (`world/Navigation`, 8-way, no corner cutting,
wall-buffer cost), waypoint smoothing via grid LOS, repath ≤0.7 Hz,
stuck detection (repath, then replan), per-enemy separation + player/enemy
body separation in `Game`.

## Performance

Perception/decisions staggered with jitter; A\* capped (2500 iterations,
1200 for spawn checks); dead enemies keep only their visual (controller
removed). 7 concurrent enemies run comfortably at 60 FPS.
