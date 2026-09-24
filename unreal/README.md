# BREACHLINE UE — Unreal Engine 5.8 port

A **professional, high-graphics rebuild** of the browser game in this repository
(`../src`, the isometric tactical shooter) as a native **Unreal Engine 5.8** C++
project.

It is the same game — five rounds, four hostile archetypes, five weapons,
cover-based squad AI, grenades, medkits, a radar, a threat line — re-authored for a
real engine: Lumen global illumination, MegaLights, Substrate materials, Nanite,
virtual shadow maps and TSR, with an AI that fights using a perception/decision
FSM instead of a browser game loop.

> UE 5.8 is the final release of the UE5 line. Everything this project relies on
> (MegaLights production-ready, Lumen, Substrate, Nanite, VSM, TSR, PCG, Enhanced
> Input, StateTree, Gameplay Cameras) is stable in 5.8; nothing here is waiting on
> a future engine version.

---

## 1. What is in the box

| Layer | Where | Notes |
| --- | --- | --- |
| Project + config | `BreachlineUE/BreachlineUE.uproject`, `BreachlineUE/Config/` | SM6/Lumen/MegaLights/Substrate renderer setup, custom trace channels, dynamic navmesh, Enhanced Input |
| Gameplay | `BreachlineUE/Source/BreachlineUE/{Public,Private}/{Core,Combat,Character,Weapons,AI,World,Game,UI,VFX,Audio,Camera}` | 62 files, ~11.3 kloc of C++ |
| Balance table | `BreachlineUE/Source/.../Core/BreachlineBalance.{h,cpp}` | every tuning number, mirroring `src/game/data/config.ts` |
| Automation tests | `BreachlineUE/Source/.../Private/Tests/BreachlineTests.cpp` | 17 tests over damage, gunnery, scoring, tables, world scale, radar maths |
| Content generator | `BreachlineUE/Content/Python/breachline_level.py`, `breachline_assets.py` | builds the map, DataTables and weapon assets |
| Designer data | `BreachlineUE/Content/Data/weapons.json`, `enemies.json` | source of truth for the generated assets |
| Docs | `BreachlineUE/docs/RENDERING.md`, `ARCHITECTURE.md`, `PARITY.md` | how the graphics work, how the code is laid out, and how it maps to the web build |
| Review tool | `tools/check_uht.py` | static UnrealHeaderTool checks (shadowing, Blueprint structs, `AddDynamic` targets, includes) — no engine required |
| Troubleshooting | `BreachlineUE/docs/TROUBLESHOOTING.md` | what the "could not be compiled" dialog means, how to get the real error, toolchain checklist |
| One-file download | `BreachlineUE-UE5.8.zip` (built by `package.sh`) | the whole port in a single archive: README, START-HERE, project — extract, open the `.uproject`, press Play |

**It runs with zero assets.** Blockout geometry comes from `/Engine/BasicShapes`,
tracers/impacts/explosions from a pooled `UInstancedStaticMeshComponent` system,
gunshots and footsteps from a procedural 48-voice synthesiser, and the entire HUD
is drawn with canvas primitives. Authored art, Niagara effects, MetaSounds and
MetaHumans can be dropped in later: every reference to them is a *soft, optional*
pointer in **Project Settings → Game → Breachline**.

---

## 2. Requirements

- **Unreal Engine 5.8** (Epic Games Launcher or a source build).
- A GPU with hardware ray tracing for the full look (Lumen HW RT + MegaLights).
  Without it, set **Breachline → Quality = Medium/Low** in the game instance
  profile: Lumen falls back to software tracing, MegaLights turns off, and
  irradiance-field Lumen Lite takes over.
- Windows 10/11 (primary), Linux, macOS. The project compiles as SM6 / `T SR`.

## 3. Quick start

```text
1. Open BreachlineUE.uproject with UE 5.8.
      - If prompted to rebuild modules, say yes (it compiles in a minute or two).
2. Optional, once, to get authored data + a level:
      Tools > Execute Python Script... > Content/Python/breachline_assets.py
      Tools > Execute Python Script... > Content/Python/breachline_level.py
   (Headless: see the docstring at the top of each script.)
3. Press Play.

`EditorStartupMap` deliberately points at an engine template level, so step 1 always
opens something. `GameDefaultMap` points at `/Game/Breachline/Maps/L_Breachline`,
which step 2 creates — run it before packaging, or point that setting at any level
you like: the game mode fills an empty world either way.
```

Step 2 is genuinely optional: with an empty level the game mode generates the
compound, the navmesh bound and the lighting at runtime
(`ACompoundBuilder::Build()`), so a fresh clone is playable the moment it
compiles. The Python path exists so a level artist can keep the layout, and so the
DataTables can be retuned without a recompile.

### Controls

| Action | Key |
| --- | --- |
| Move | `W A S D` |
| Aim | Mouse (cursor drives the aim point) |
| Fire | Left mouse |
| Precision aim (tighter spread, slower) | Right mouse (hold) |
| Sprint | `Shift` (hold) — no firing while sprinting |
| Crouch | `C` / `Left Ctrl` (toggle) |
| Reload | `R` |
| Grenade | `G` (ballistic throw, 2.2 s fuse) |
| Weapons | `1`–`5`, `Tab` to cycle |
| Rotate camera | `Q` / `E` (90°/s orbit) |
| Zoom | Mouse wheel |
| Release cursor / pause | `Esc` |

Gamepad: left stick moves, right stick aims, RT fires, LT aims, LB sprints,
A reloads, Y throws, D-pad cycles, right stick X orbits.

## 4. The game loop

`ABreachlineGameMode` owns the run:

```text
StartRun -> Round 1
   BeginRound:  full heal + full ammo + grenades topped up   (a round is a
                self-contained fight, never a war of attrition)
   Telegraph:   "reinforcements inbound" banner (2.2 s), audio cue
   Wave:        ASpawnDirector draws archetypes by weight from the round table,
                places them on the navmesh >= 34 m from the player, and staggers
                entry so MaxAlive caps simultaneous pressure
   Combat:      ATacticalAIController per hostile (perception -> decision -> act)
   Clear:       score + round bonus (multikill / accuracy / no-damage)
   Next round  ... Round 5 cleared -> MISSION COMPLETE
   Player dies -> defeat, run restarts (or restarts automatically after 5 s)
```

Medkits spawn on a randomised 11–18 s cadence, at most two on the map, never
within 9 m of the operator; collecting one restores 30 % of max health and shows
up on the radar as a green cross.

## 5. Hostile AI (the "professional" part of the port)

`ATacticalAIController` is a hand-written FSM, not a Behaviour Tree, and that is a
deliberate engineering choice: the behaviour is identical to the web build's
(both were authored from the same design), it is trivially debuggable, and it runs
at a 0.55 s decision tick with a 0.16 s perception tick — 20 hostiles cost almost
nothing.

```text
Idle -> Patrol -> Suspicious -> Investigating -> Searching
                       |             |
                       +--------> Engaging <--------+
                                     |  ^            |
                          TakeCover  |  |  Flanking  |
                                     v  |            |
                                  InCover (lean-out rhythm, alternating shoulders)
                                     |
                             Reloading / Retreating / HitReaction -> Dead
```

* **Perception** — a cone (`VisionRange` 22–32 m, half-angle 45–60° by archetype)
  plus a line-of-sight trace on the `Visibility` channel. Memory decays over 4.5 s.
* **Squad intel** — a sighting is shared with squadmates within 34 m, but only as
  an *approximate* position (3.5 m of fuzz, 70 % confidence), so squads converge
  on an area rather than on the player's exact coordinate.
* **Hearing** — footsteps and gunfire raise suspicion inside the noise radius, with
  position jitter: hearing points a squad at a place, it does not grant a solution.
* **Gunnery** — `FEnemyShotPlan` combines a continuous aim error (accuracy, range,
  target movement, shooter movement, fresh reaction) with an occasional
  *deliberate* near miss (0.55–1.0 m lateral, ±0.45 m vertical) so rounds crack past
  the player's ear instead of silently missing. Accuracy drops 22 % while moving
  and 38 % while suppressed.
* **Cover** — 24 `ACoverPoint` actors score themselves against the threat: distance,
  "is the wall actually between us" (the point's normal faces the open ground),
  preferred range band, cover height, occupancy, and a 16 s re-use cooldown so the
  squad does not keep re-occupying the position the player is already aiming at.
  In cover they peek on a 1.1–2.4 s rhythm, alternate shoulders, duck for 0.8–1.8 s,
  relocate after 7.5 s or once they have taken 35 % of their health there.
* **Burst discipline** — `BurstShots`/`BurstPause` per archetype (marksman: 1 shot,
  1.6 s; runner: 7 shots, 0.7 s). This single detail is why the hostiles read as
  trained rather than as turrets.

## 6. Testing

```text
Editor:  Session Frontend > Automation > filter "Breachline"
CI:      UnrealEditor-Cmd.exe BreachlineUE.uproject \
             -ExecCmds="Automation RunTests Breachline; Quit" -unattended -nopause -nullrhi
```

17 tests, mirroring the web build's vitest suite:

| Test | Covers |
| --- | --- |
| `Breachline.Combat.Damage.Falloff` | full/min/interpolated damage bands, degenerate window |
| `Breachline.Combat.Damage.Armor` | mitigation curve, 75 % cap |
| `Breachline.Combat.Damage.Pipeline` | rifle torso/head/armored/far, 1 HP floor |
| `Breachline.Combat.Damage.HitZones` | head/chest/arm/leg classification by height and lateral offset |
| `Breachline.Combat.Damage.Grenade` | radial falloff, lethal vs the Heavy |
| `Breachline.Combat.EnemyFire.Accuracy` | clamped 0.05–0.95 band |
| `Breachline.Combat.EnemyFire.AimError` | range / moving target / moving shooter / reaction |
| `Breachline.Combat.EnemyFire.MissChance` | stacking penalties, 35 % cap |
| `Breachline.Combat.EnemyFire.Plan` | seeded determinism, deliberate-miss geometry |
| `Breachline.Combat.EnemyFire.NearMiss` | ray-to-point distance in metres, behind-muzzle and out-of-range cases |
| `Breachline.Progression.Scoring` | multikill/round bonus tables, empty-table safety |
| `Breachline.Balance.Weapons` | the five weapons: ids, damage, rate of fire, magazines, DMR headshot + armour |
| `Breachline.Balance.Archetypes` | the four hostiles, their loadouts, id lookup, fastest/toughest invariants |
| `Breachline.Balance.Rounds` | five rounds, spawn weights, health/accuracy/aggression multipliers |
| `Breachline.Balance.World` | 44 x 4 m grid, cell size, cover heights, character capsule |
| `Breachline.HUD.Radar` | radar projection incl. camera rotation, rim clamping, azimuth maths |
| `Breachline.HUD.Threat` | danger-line thresholds, telegraph timing, corpse blip weighting |

## 7. Packaging

```
Platforms > Windows > Package Project
```

IoStore + Zen loader are already configured in `Config/DefaultGame.ini`, and the
`Breachline/Data` directory is staged explicitly so the JSON balance tables travel
with a build (they are useful for support and for live tuning). Shader compilation
for the first package is the slow step; after that, incremental cooks are quick
because the compound is blockout geometry rather than Nanite-dense art.

## 8. Where to go next

* `docs/RENDERING.md` — every renderer setting, what it buys, and how to trade
  quality for frame time.
* `docs/ARCHITECTURE.md` — module layout, class responsibilities, data flow, and
  the reasoning behind the "pure core / engine shell" split.
* `docs/PARITY.md` — side-by-side mapping of the web build's systems to their UE
  counterparts, including the numbers and the intentional differences.
* `../README.md` — the original browser game (this port's design reference).
