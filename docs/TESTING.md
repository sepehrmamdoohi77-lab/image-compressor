# TESTING

`npm test` (vitest) — **61 tests, 4 files**, all passing.

## Suites (`src/game/__tests__/`)

- **combat.test.ts** (21): falloff curve, armor formula/cap, zone multipliers,
  range/armor cases, NaN/negative guards, zone classification, DMR-vs-SMG
  ordering, grenade falloff monotonicity, `rayVsCharacter` (torso/head/miss/
  over-head/range/crouch).
- **weapons.test.ts** (12): def sanity (5 weapons), weapon differentiation,
  RPM gating, ammo consumption/negatives, reload transfer/partial/blocked
  cases, no-fire-while-reloading, spread move/bloom/aim behavior + cap.
- **systems.test.ts** (22): A\* direct/wall/sealed/no-through-wall, smoothing,
  grid LOS, snap-to-open, flood fill; cover scoring (protection, occupancy,
  reachability, band); spawn validation accept/reject; scoring (bonuses,
  multikill reset, round growth, accuracy/no-damage, full advancement);
  settings validation (accept/garbage/null/clamp).
- **runtime.test.ts** (6): boots the REAL `Game` with only WebGLRenderer + DOM
  stubbed, fake clock, `console.error` spy (must stay silent):
  1. menu boot + black-screen QA (renderer/canvas/camera/size/loop/meshes/
     lights/player/map/fps),
  2. move/fire/reload/crouch/5 weapon swaps/grenade throw + detonation,
  3. enemy spawn/navigation/perception/combat states,
  4. full 5-round playthrough → VICTORY with score,
  5. death → DEFEAT, restart, pause time-freeze, resume, menu,
  6. HUD snapshot completeness/finiteness.

## Manual runtime QA (42-step procedure)

With a browser (could not run headless in this sandbox — browser CDNs
blocked; covered instead by `runtime.test.ts` above):

1. `npm run dev`, open page → main menu over live 3D arena, no console errors.
2. DEPLOY → briefing banner → round 1, player visible, camera follows.
3. WASD moves (incl. diagonals), collision stops at walls.
4. Mouse aims: soldier/weapon rotate, crosshair tracks cursor.
5. Fire: muzzle flash from barrel tip, tracer, recoil, ammo decrements.
6. Reload (R), dry-fire click on empty, weapon slots 1–5.
7. G throws grenade: arc, bounce, blink, explosion, radial kills.
8. Enemies spawn away from sight, navigate, take cover, flank, miss and hit.
9. Kill all → AREA CLEAR → next round ×5 → VICTORY + stats.
10. Die → DEFEAT + stats; RETRY works; ESC pauses/resumes; settings all apply;
    MENU returns cleanly; restart never duplicates loops (FPS stable).

## Black-screen checklist (automated in runtime.test.ts#1)

renderer ✓ canvas ✓ scene ✓ camera ✓ valid position/target ✓ valid size ✓
loop running ✓ objects present ✓ lights ✓ player ✓ map ✓.

## Console quality

Zero uncaught exceptions, warnings loops, or WebGL errors is enforced by the
`console.error` spy in every runtime test.
