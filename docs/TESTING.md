# TESTING

`npm test` (vitest) — **95 tests, 5 files**, all passing.

## Suites (`src/game/__tests__/`)

- **combat.test.ts** (21): falloff curve, armor formula/cap, zone multipliers,
  range/armor cases, NaN/negative guards, zone classification, DMR-vs-SMG
  ordering, grenade falloff monotonicity, `rayVsCharacter` (torso/head/miss/
  over-head/range/crouch).
- **weapons.test.ts** (12): def sanity (5 weapons), weapon differentiation,
  RPM gating, ammo consumption/negatives, reload transfer/partial/blocked
  cases, no-fire-while-reloading, spread move/bloom/aim behavior + cap.
- **systems.test.ts** (33): A\* direct/wall/sealed/no-through-wall, smoothing,
  grid LOS, snap-to-open, flood fill; cover scoring (protection, occupancy,
  reachability, band, **re-use cooldown penalty**), **cover flank detection**,
  **cover re-use cooldown bookkeeping**; spawn validation accept/reject; scoring
  (bonuses, multikill reset, round growth, accuracy/no-damage, full advancement);
  settings validation (accept/garbage/null/clamp); **Shift sprint** (config band,
  faster than walking, only while moving, cancelled by aiming, raises noise);
  **round resupply** (health/mags/reserves/grenades/armor) and `heal()` guards;
  **field medkits** (open-floor placement rules, 30% heal, never wasted at full
  health, expiry) and **radar projection** (ahead = up, right = right, rotation,
  scale).
- **runtime.test.ts** (10): boots the REAL `Game` with only WebGLRenderer + DOM
  stubbed, fake clock, `console.error` spy (must stay silent):
  1. menu boot + black-screen QA (renderer/canvas/camera/size/loop/meshes/
     lights/player/map/fps),
  2. move/fire/reload/crouch/5 weapon swaps/grenade throw + detonation,
  3. enemy spawn/navigation/perception/combat states,
  4. full 5-round playthrough → VICTORY with score,
  5. death → DEFEAT, restart, pause time-freeze, resume, menu,
  6. HUD snapshot completeness/finiteness,
  7. danger telegraph: level 0 / `threatDistance` −1 when the area is clear,
     then > 0.3 with a finite bearing once a hostile closes to 4 m, **with radar
     blips mirroring the channel (dark before, live after, weights in 0..1)**,
  8. restart restores the standing pose (death → DEFEAT → restart) and Q/E
     orbit the camera while WASD stays camera-relative,
  9. **round change resupplies**: emptied health/armor/grenades/mags refill to
     full and the HUD resupply notice fades,
  10. **medkits drop** during a round (radar kit list becomes non-empty).
- **presentation.test.ts** (19): the player-visible guarantees —
  - camera framing: elevation ≤ 41° (the 40° rig), camera height ≈ 12.9 m and a
    larger horizontal stand-off than the 46° rig it replaced;
  - weapon identity: all five silhouettes have distinct part counts, barrel
    length ordering pistol < SMG < rifle < DMR, and five unique sound profiles
    with per-class checks (shotgun boom, SMG snap, DMR echo);
  - two-handed grip: support hand within 9 cm of each weapon's own `grip.support`
    (12 cm for the trigger hand), still on the weapon while running/firing, and
    dropping then returning during a reload;
  - enemy fallibility: miss chance inside (0.05, 0.35], growing with target
    movement / range / suppression, deliberate misses ≤ `AI.missLateral` and
    inside `AI.nearMissRadius`, deterministic `planEnemyShot` via injected RNG,
    and `rayPointDistance` near-miss geometry (including behind-shooter and
    wall-short cases);
  - danger telegraph: dark when clear, one streak per nearby hostile (corpses and
    distant hostiles ignored), bearing 0° ahead / +90° right, hotter as threats
    close;
  - graphics fallbacks: `createTextures()` returns null headless while materials
    still build, and shared geometry is tessellated finely;
  - animation states: the sprint carry drops and angles the weapon while both
    hands stay on it, running drives a moving stride with bounded knee bend,
    death collapses the body past horizontal and then stops moving, and cover
    lean eases the torso out and back while crouching lowers the body.

## Manual runtime QA (42-step procedure)

With a browser (could not run headless in this sandbox — browser CDNs
blocked; covered instead by `runtime.test.ts` above):

1. `npm run dev`, open page → main menu over live 3D arena, no console errors.
2. DEPLOY → briefing banner → round 1, player visible, camera follows.
3. WASD moves (incl. diagonals), collision stops at walls.
4. Mouse aims: soldier/weapon rotate, crosshair tracks cursor.
5. Fire: muzzle flash from barrel tip, tracer, recoil, ammo decrements.
5b. Hold Shift: soldier sprints, weapon drops to a carry, footsteps heavier;
    release and the weapon comes back up.
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
