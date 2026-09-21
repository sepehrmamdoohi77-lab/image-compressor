# ARCHITECTURE

## Principles

1. **One owner per system.** `Game` owns the loop, renderer, scene, and all
   subsystem instances. React owns pixels outside the canvas only.
2. **Data-driven.** All balance constants live in `game/data/config.ts`.
3. **Pure logic is tested.** Damage, weapons, navigation, cover scoring, spawn
   validation, progression, settings validation are pure/dependency-free and
   covered by vitest.
4. **No per-frame garbage in hot paths.** Preallocated temps, pooled particles,
   pooled lights/tracers, staggered AI updates.
5. **Explicit states.** `GameState` (MENU/LOADING/PLAYING/PAUSED/ROUND_COMPLETE/
   VICTORY/DEFEAT) gates every update; illegal transitions cannot happen.

## Module map

```
Game (core/Game.ts)
├── InputManager      — keyboard/mouse, edge detection, attach/detach
├── EventBus          — game -> UI events (state, kills, hitmarkers…)
├── SettingsManager   — validated localStorage settings
├── AudioManager      — synth SFX engine, 4 buses
├── Level             — meshes, collision grid, AABB obstacles, cover pts, spawns
├── TacticalCamera    — iso rig, follow, zoom, trauma
├── Player            — movement/aim/weapons/rig sync
├── Enemies + AIController[] — entity + per-enemy brain
├── CoverSystem       — scoring + claims
├── SquadAwareness    — shared intel + noise events
├── CombatSystem      — hitscan resolution, explosions
├── GrenadeSystem     — throw/bounce/fuse
├── SpawnSystem       — fair validated spawning
├── ProgressionSystem — rounds/score/objectives
├── ParticleSystem    — pooled VFX
└── React (ui/)       — App/HUD/Menus via getSnapshot() + events
```

## Frame update order (PLAYING)

1. `gameTime += dt` (dt clamped to 0.05)
2. ESC → pause check
3. Mouse → ground-plane aim point
4. Grenade key
5. `player.update` (movement, aim, reload timers, weapon switch, trigger)
6. `combat.playerFire` → scoring, hitmarkers, kill events, AI damage notify
7. Footsteps
8. `spawns.update` (validated, staggered)
9. Each `AIController.update` (perceive → decide → act)
10. `grenades.update` (physics, fuse, explode → kills)
11. Corpse cleanup (6 s lifetime, max 10)
12. Defeat / round-complete checks
13. Camera (follow + aim lookahead + zoom + shake)
14. Particles, noise pruning
15. `input.endFrame()`, render

PAUSED runs zero updates (loop still renders the frozen frame behind the menu).
ROUND_COMPLETE simulates particles/camera only. VICTORY/DEFEAT settle AI briefly.

## Entity model

- `Player` / `Enemy`: plain classes with `pos/vel/yaw/health/armor`, a
  `CharacterRig` (procedural meshes), and `WeaponInstance`(s). No inheritance
  hierarchy; behavior is composed (AI controllers are separate objects).
- Enemies are created per spawn and disposed on corpse expiry (geometry is
  shared; only per-rig materials are disposed).

## Collision model (single source of truth: `Level`)

- `grid: Uint8Array` — 0 open / 1 blocked-high / 2 blocked-low (navigation,
  walkability, A\*).
- `obstacles: AABB[]` with heights — circle push-out, 3D segment blocking,
  bullet raycasts. Low cover blocks movement and low trajectories but not
  standing eye-lines; crouching (eye 0.9 m) breaks LOS behind it.
- `coverPoints[]` — generated from blocked/open adjacency with obstacle normals.

## Restart safety

`clearRunEntities()` removes every enemy mesh, controller, grenade, particle,
claim, and noise; resets progression/spawns/player; exactly one rAF loop ever
runs (`loopRunning` guard; `init()` is idempotent).

## UE5 portability

Pure modules (`combat/DamageSystem`, `world/Navigation`, `weapons/Weapons`
rules, `ai/CoverSystem` scoring, `systems/*` validation, `data/config`) have no
Three.js dependency and map 1:1 to UE5 C++/Blueprint logic. See
UE5_MIGRATION_GUIDE.md.
