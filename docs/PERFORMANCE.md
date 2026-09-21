# PERFORMANCE

Target: stable 60 FPS on desktop with max concurrency (7 enemies + player).

## Budgets (measured reasoning, not hopes)

- **Draw calls**: ~130 level + ~8×16 character parts + weapons + 2 point
  clouds + ≤28 tracers + ≤10 sprites ≈ 300. Fine for desktop GL.
- **Shadow**: single 2048 directional, tight 64 m ortho box; disabled on Low.
- **Lights**: 1 dir + 1 hemi + 2 static points + ≤3 pooled flash lights.
- **AI**: perception ~5 Hz staggered, decisions ~2 Hz, A\* ≤2500 iterations
  and ≤0.7 Hz per enemy, LOS via math (no `Raycaster` in hot paths).
- **Particles**: fixed 2300-point pools, one buffer upload each per frame.
- **React**: HUD snapshot at 10 Hz; crosshair via direct DOM (0 re-renders);
  killfeed/banners event-driven.

## Anti-patterns avoided

- No per-frame allocation in combat/AI/camera math (preallocated temps).
- No `new THREE.Vector*` in `applySpread`/`screenToGround` (static temps).
- No React state on mousemove.
- No duplicated loops/listeners: single rAF with guard, idempotent
  `init()`/`attach()`, full `dispose()`, restart clears everything.
- No particle/light/tracer leaks: fixed pools, self-expiring, `clear()` on
  restart.
- No unbounded growth: corpses capped (10), noises capped (24, pruned),
  killfeed capped (5).

## Quality scaling (`applyQuality`)

| | Low | Medium | High |
|---|---|---|---|
| Pixel ratio | 0.75 | ≤1.25 | ≤2 (device) |
| Shadows | off | 2048 | 2048 |
| Particles | ×0.45 | ×0.75 | ×1.0 |

Audio is unaffected (negligible cost). Changing quality applies live.

## Profiling hooks

- HUD FPS readout (EMA), `window.__BREACHLINE__.status()` (renderer, scene,
  camera, counts, fps), `game.enemyStates` (per-enemy FSM state for AI load
  inspection).
