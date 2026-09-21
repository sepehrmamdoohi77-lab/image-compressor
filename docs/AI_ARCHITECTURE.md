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
  (breaking LOS behind low/mid cover), pop-up rhythm (hide 1.2–2.8 s, expose
  1.4–2.8 s to fire), re-evaluates when flanked or after ~9–13 s.
- **Flanking**: ±55° arc point at mid preferred range, engages on the move.
- **Retreating**: far cover when HP < 28% and aggression low, then re-engage.
- **Reloading**: tactical (≤25% mag when safe) + empty reloads, sidestep/crouch.
- **HitReaction**: 0.35 s stagger on ≥22 damage hits; damage always reveals
  approximate attacker position (never exact).

## Firing model (`tryShoot`)

Gates: player alive, confidence > 0.35, reacted, in range, facing (±0.5 rad),
muzzle→chest line-of-fire clear, burst discipline (`burstSize`/`burstPause`).
Aim error (radians) = archetype accuracy term + distance term + target-
movement + self-movement + crouch-target + post-acquisition bloom. Enemies miss
realistically; tracers + impacts make misses readable.

## Cover (`ai/CoverSystem`)

Points generated from blocked/open adjacency. Pure score:
proximity + obstacle-between-self-and-threat (normal vs threat dot) +
preferred-range band + kind bonus − occupancy − too-close penalty.
Claims prevent stacking; released on state exit/death.

## Navigation

A\* over the collision grid (`world/Navigation`, 8-way, no corner cutting,
wall-buffer cost), waypoint smoothing via grid LOS, repath ≤0.7 Hz,
stuck detection (repath, then replan), per-enemy separation + player/enemy
body separation in `Game`.

## Performance

Perception/decisions staggered with jitter; A\* capped (2500 iterations,
1200 for spawn checks); dead enemies keep only their visual (controller
removed). 7 concurrent enemies run comfortably at 60 FPS.
