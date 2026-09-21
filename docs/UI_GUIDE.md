# UI GUIDE

React owns menus/HUD only (`src/ui/`); zero gameplay logic. Game → UI via
`EventBus` (transient: kills, banners, state) + `getSnapshot()` polled at
10 Hz (numbers/bars). Designed at 1920×1080, responsive to 720p/1440p/21:9.

## HUD (`ui/HUD.tsx`)

- **Crosshair**: cursor-following (direct DOM transform, no re-renders),
  16–24 px, dynamic gap from live spread, dot + 4 lines, hitmarker X flash
  (red on headshot). OS cursor hidden while playing.
- **Top-center**: round label + `ELIMINATE ALL HOSTILES — N LEFT` + reload tag.
- **Top-right**: **radar minimap** (`ui/Radar.ts`), score, K/HS/ACC, killfeed
  (5 s lifetime, max 5).
- **Bottom-left**: HP + armor bars with numbers, grenade pips, AIM pill, medkit
  counter (`✚ ×N`), low-HP threshold styling.
- **Bottom-right**: weapon name, big mag/reserve (red ≤25%), 5 slots with ammo.
- **Overlays**: damage vignette (opacity = recent damage), low-HP pulse,
  round banner (3.4 s), **round resupply notice** (`.resupply-tag`, driven by
  `resupplyFade`), **medkit pop** (`.medkit-tag`, keyed by `medkitsUsed` so each
  pickup replays its animation), contextual hints (reload/dry), tiny FPS readout.

## Screens (`ui/Menus.tsx`, routed by `ui/App.tsx`)

- **Main menu**: title, tagline, DEPLOY/SETTINGS/HOW TO PLAY, controls strip,
  operation order card; live orbiting 3D arena behind.
- **Pause (ESC)**: RESUME/RESTART/SETTINGS/MAIN MENU; gameplay fully frozen
  (verified: game-time halts), audio suspended.
- **Settings**: master/SFX/ambient/UI volumes, zoom sensitivity, camera
  distance, quality — all apply live; reset defaults; corruption-safe storage.
- **How to play**: full control table + cover/enemy/weapon/danger primers.
- **Round clear**: AREA CLEAR + bonus, auto-continues (3.2 s).
- **Victory/Defeat**: result, score, 6-stat grid (K/HS/nades/accuracy/rounds/
  fired), RETRY + MENU.

## Responsive rules

`clamp()` typography, `vw/vh` spacing with minimums, breakpoints at 1100 px
(hide brief card) and 760 px/500 px height (compact HUD, hide strips).
No clipped/overlapping UI at 1280×720, 1920×1080, 2560×1440, 21:9.

## Danger telegraph (in-HUD)

`HudSnapshot` carries `threatLevel`, `threatAngleDeg`, `threatCount` and
`threatDistance`, produced by `Game.updateThreats()` each frame:

- `.danger-edge` — inset red glow, opacity `threatLevel × 0.85`, hidden below
  0.04 so a clear map stays clean.
- `.danger-arrow` — rotated by `threatAngleDeg` (0° = ahead, +90° = right); the
  `.da-tip` chevron sits 40 vh above centre so it reads at the screen edge.
- `.danger-tag` — `⚠ CONTACT — 7m ×2` under the objective, shown above 0.3 and
  only when `threatDistance >= 0` (the −1 sentinel means "nobody nearby").

All three are pointer-transparent and driven by the 10 Hz snapshot poll, so they
cost no extra React renders beyond the existing HUD tick.

## Radar minimap

`ui/Radar.ts` is a plain 2D canvas (158×158 CSS px) that redraws from
`snap.radarLayer` / `radarYaw` / `radarPlayerX` / `radarPlayerZ` /
`radarContacts` / `radarPickups` on every snapshot tick:

- the level plan is **baked once** into an offscreen canvas by
  `world/MapPlan.bakeLevelLayer()` (one 7 px cell per world metre, plan-style
  block fill + outline) and reused for the whole session;
- the radar is **player-relative and facing-up**: the baked plan is drawn with
  `translate(centre) → scale → rotate(yaw) → translate(-player)`, so north spins
  as you turn; the player arrow always sits at the centre;
- **hostile blips render only when `threatLevel > 0`** — the radar is a threat
  read-out, not a wallhack. Blips fade in from 26 m (`RADAR.blipRange`), scale
  with closeness and ping with a halo; a gradient **bearing wedge** matches
  `threatAngleDeg`;
- **health kits** are green crosses; the panel border/label switch to
  `CONTACT` (red, pulsing) while the danger line is up;
- pure projection math lives in `radarProject()` and is unit-tested (ahead = up,
  right = right, rotation and scale).

## Style

Dark military neutrals, desaturated greens/grey concrete, single gold accent
(`--accent`), restrained warm lighting. No neon, no bloom-heavy UI, no
cartoon styling. All text in `src/index.css` theme variables.
