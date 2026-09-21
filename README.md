# BREACHLINE — Isometric Tactical Shooter

A complete, polished, single-player tactical isometric shooter for desktop browsers.
Five rounds, five weapons, four enemy archetypes with squad-level tactical AI,
grenades, cover mechanics, and a full menu/HUD/results flow.

Built with **TypeScript + Three.js + React + Vite**. No backend, no database, no accounts.

## Quick start

```bash
npm install
npm run dev      # play at http://localhost:5173
```

Production build:

```bash
npm run build    # typecheck + bundle into dist/
npm run preview  # serve the production build
```

Quality gates:

```bash
npx tsc --noEmit # typecheck
npm test         # unit + headless full-game integration tests
```

## Controls

| Input | Action |
|---|---|
| WASD | Move (camera-relative) |
| Mouse | Aim (world-space) |
| Left click | Fire (auto / semi per weapon) |
| Right click (hold) | Precision aim: tighter spread, steadier recoil, slower move |
| R | Reload (auto-reloads on empty trigger) |
| G | Throw grenade at cursor |
| C / Ctrl (hold) | Crouch: break line of sight behind low cover, steadier shots |
| 1–5 / TAB | Weapons: Rifle · SMG · Shotgun · DMR · Pistol |
| Wheel | Camera zoom |
| Q / E | Rotate camera |
| ESC | Pause |

## What is implemented

- **Tactical camera** — 55°/45° isometric rig, smooth follow, aim lookahead, zoom, trauma shake, firing kicks.
- **Hand-designed 44×44m arena** — 4 enterable structures, plaza, checkpoint gate, chokepoints, flank routes, cover chains, defensive lines.
- **5 data-driven weapons** — distinct damage, RPM, mag, reload, recoil, spread, falloff, pellets, sounds, tracers.
- **Central damage pipeline** — hit zones (head/torso/arms/legs), distance falloff, armor mitigation, grenade LOS-gated radials.
- **4 enemy archetypes** — Rifleman, Assault, Heavy, Support: distinct HP/armor/weapon/accuracy/speed/aggression/preferred range.
- **Squad AI** — vision cones + LOS, hearing, decaying memory, shared approximate intel, FSM tactics: patrol, investigate, search, engage, cover (crouch + pop-up rhythm), flank, retreat, reload, hit reactions.
- **A\* navigation** on the tactical grid with path smoothing, separation, stuck recovery.
- **Grenades** — ballistic throw, bounce, fuse, LOS-gated explosion, self-damage.
- **VFX + audio** — pooled particles/tracers/flash-lights, fully synthesized positional Web Audio, 4-bus mixer.
- **Complete flow** — menu → briefing → 5 rounds → victory/defeat → stats → restart; pause, settings (all functional), localStorage with corruption recovery.
- **61 automated tests** — damage, weapons, navigation, cover, spawning, progression, settings, plus headless full-game integration (menu → victory / defeat / pause / restart with zero console errors).

## Documentation

| Doc | Contents |
|---|---|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Module layout, ownership, update loop, state machine |
| [docs/GAMEPLAY.md](docs/GAMEPLAY.md) | Loop, controls, rounds, scoring |
| [docs/AI_ARCHITECTURE.md](docs/AI_ARCHITECTURE.md) | Perception, memory, FSM, cover, squad sharing |
| [docs/WEAPON_SYSTEM.md](docs/WEAPON_SYSTEM.md) | Weapon data, firing, recoil, spread, ammo |
| [docs/DAMAGE_SYSTEM.md](docs/DAMAGE_SYSTEM.md) | Zones, falloff, armor, grenades |
| [docs/LEVEL_DESIGN.md](docs/LEVEL_DESIGN.md) | Map layout, routes, cover, spawns |
| [docs/UI_GUIDE.md](docs/UI_GUIDE.md) | HUD, menus, responsive rules |
| [docs/AUDIO_GUIDE.md](docs/AUDIO_GUIDE.md) | Synth design, buses, positional model |
| [docs/VFX_GUIDE.md](docs/VFX_GUIDE.md) | Particle pools, tracers, lights |
| [docs/TESTING.md](docs/TESTING.md) | Test plan, coverage, runtime QA procedure |
| [docs/PERFORMANCE.md](docs/PERFORMANCE.md) | Budgets, pooling, quality scaling |
| [docs/UE5_MIGRATION_GUIDE.md](docs/UE5_MIGRATION_GUIDE.md) | Mapping gameplay modules to Unreal Engine 5 |

## Project structure

```
src/
  main.tsx            # React boot
  index.css           # tactical UI theme
  ui/                 # React: App shell, HUD, menus (no gameplay logic)
  game/
    data/config.ts    # ALL balance data (weapons, enemies, AI, rounds, camera…)
    core/             # Game orchestrator, states, events, input
    world/            # materials, hand-built level, A* navigation
    camera/           # isometric tactical camera rig
    entities/         # player, enemy, procedural soldier/weapon meshes
    weapons/          # weapon instances (ammo/reload/fire-rate/spread)
    combat/           # damage pipeline (pure, tested)
    ai/               # perception/memory/FSM controller, cover, squad intel
    systems/          # shooting resolution, grenades, spawning, progression, settings
    vfx/              # pooled particles/tracers/lights
    audio/            # synthesized Web Audio engine
    __tests__/        # vitest suites (unit + headless integration)
```

## Balance tuning

Everything tunable lives in `src/game/data/config.ts` — weapons, enemies,
damage zones, armor, AI, rounds, scoring, camera, audio defaults. Gameplay code
reads from there; nothing is scattered.

## Note on co-located files

This repository also contains the original Python image-compressor service
(`main.py`, `auth.py`, `requirements.txt`, `render.yaml`, `static/`, `tests/`).
It is untouched and independent — the game is the Node/Vite application
described above (`package.json`, `index.html`, `src/`, `dist/`).

## Known limitations

- No gamepad support (keyboard + mouse only).
- Enemy voice lines are abstract (synthesized alert stingers, no speech).
- Character animation is procedural (no skeletal meshes) — clean and readable by design.
- Headless-browser E2E was not possible in the build sandbox (browser CDNs blocked);
  runtime QA was performed via a headless integration suite that boots the real game.
