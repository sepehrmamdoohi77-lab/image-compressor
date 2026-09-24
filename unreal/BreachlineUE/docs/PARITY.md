# Parity — the web build and the UE 5.8 port, side by side

This port is not a re-imagining. Where a number exists in
`../src/game/data/config.ts`, it exists in
`Source/BreachlineUE/Public/Core/BreachlineBalance.h` with the same value, and the
automation test `Breachline.Balance.*` fails if the two drift.

## Units

| Web build | Unreal | Note |
| --- | --- | --- |
| world units = 1 m × 4 (44 × 44 cells) | 4 m cells, `CellUU = 400` | the arena is 176 m across in both |
| `WORLD.CELL = 4` | `World::CellMeters = 4` | — |
| radians | radians for spread/aim error, degrees for camera/facing | conversion only where the engine demands it |
| Y-up, left-handed | Z-up, UE handedness | `ToRadarLocal`/`ToRadarPixels` handle the flip for the HUD |

## Weapons

`DefaultWeapons()` reproduces the five entries exactly: rifle 24 dmg / 540 rpm /
30 mag / 1.9 s reload, SMG 15 / 800 / 40 / 1.6 s, shotgun 11 × 8 pellets / 70 / 6 /
2.6 s pump, DMR 62 / 170 / 10 / 2.2 s bolt (22° zoom), pistol 20 / 320 / 12 / 1.3 s.
Reserve refills per round (90/120/18/30/36) and armour multipliers (1.0/0.7/0.8/1.6/0.9)
also match. The only additions are engine-side fields the web build had no use for:
`BodyMesh`, `MuzzleFX` (soft, optional) and per-weapon sound synthesis parameters.

## Archetypes

| | rifleman | assault | heavy | support |
| --- | --- | --- | --- | --- |
| health | 70 | 55 | 160 | 60 |
| armour | 10 | 0 | 45 | 15 |
| weapon | rifle | smg | shotgun | dmr |
| speed (m/s) | 3.4 | 4.6 | 2.5 | 3.0 |
| accuracy | 0.50 | 0.42 | 0.55 | 0.68 |
| aggression | 0.45 | 0.85 | 0.60 | 0.30 |
| preferred range (m) | 9–20 | 4–11 | 5–13 | 15–27 |
| burst / pause (s) | 4 / 0.9 | 7 / 0.7 | 2 / 1.3 | 1 / 1.6 |
| score | 100 | 120 | 200 | 150 |

Round weights are identical, including `Round 5 = {3, 3, 2, 2}`.

## Damage

Same pipeline, same constants: zone multipliers 2.2/1.0/0.75/0.65 (weapon head
multiplier overrides), armour reduction `armor / (armor + 60)` capped at 0.75,
minimum 1 HP per connecting shot, armour damage
`mitigated × 0.65 × mult + raw × 0.12 × mult`, grenade 110 damage over 6 m with a
1.35 falloff power and a 0.55 self-multiplier.

Hit-zone classification prefers the **hit bone name** (UE has skeletons; the web
build only had heights), then falls back to the same height thresholds
(0.86 / 0.52 / 0.42 / 0.3) with the same lateral offset rules.

## Enemy gunnery

Identical formulas: `EnemyAccuracy` clamped 0.05–0.95; aim error
`0.055 × (1.35 − acc) + 0.035 × distance/range + moving-target + 0.035 moving-shooter
+ 0.012 crouch`, ×1.6 while re-acquiring; miss chance
`0.08 + 0.3 × (1 − acc)` plus movement/distance/suppression/crouch, capped at 0.35;
deliberate misses at 0.55–1.0 × 1.0 m lateral and ±0.45 m vertical.

## Progression

Multikill table `{0, 0, 100, 200, 350, 500}`, round-clear table
`{0, 250, 350, 500, 700, 1000}`, headshot +50, grenade kill +75, accuracy bonus 300
(requires ≥ 10 shots and ≥ 50 % hits), no-damage bonus 500, kill chain window 3 s.

## Camera and radar

Elevation 40° (lowered from 55° in the web build, twice), azimuth 45°, distance
20 m clamped 12–30, FOV 38°, follow smoothing 7.5, trauma decay 2.6 with a
`trauma²` Perlin offset, fire kick 0.05 m, explosion kick 0.6 m, bounds
`halfExtent − 8 m`. Radar span 52 m, blip range 26 m, danger line with
`AwareBoost`-style weighting, pulse 2.4 Hz — all unchanged.

## Intentional differences

| Area | Web build | UE 5.8 port | Why |
| --- | --- | --- | --- |
| Aim input | mouse position → world ray, always | mouse **or** gamepad, cursor-relative ground point | a console-style title needs stick aiming; keyboard/mouse behaviour is unchanged |
| AI perception | angle + distance check with an occlusion approximation | vision cone + `Visibility` trace + squad intel with positional fuzz | the engine can afford a real trace; fuzz replaces the web build's crude occlusion so results feel the same |
| Cover | pre-computed cover list per map | `ACoverPoint` actors scored at runtime (distance, blocking normal, range band, occupancy, re-use cooldown) | reusable in an authored level, and easier for a designer to nudge |
| Death | scripted collapse animation | ragdoll when a physics asset exists, procedural collapse otherwise | the UE build ships skeletons the web build never had |
| Audio | Web Audio synth at runtime | identical synthesis ported to `USynthComponent` (48 voices, same envelopes) | keeps the "no assets required" property |
| Radar contact visibility | enemies appear when the danger line activates | aware contacts appear bright red; unaware contacts only within 12 m and faint | a 158 px scope has room for a little more information than a canvas strip did |
| Round transition | restore ammo | restore ammo **and** full health + armour + grenades | an explicit user requirement for this build |
| Medkits | health kit pickup | same 30 % of max health, bob/spin/glow, radar cross, 2 max, 11–18 s cadence | unchanged in effect, richer in presentation |
| Kill award | the enemy is removed from the enemy array on the frame it dies, so it is scored once by construction | scored through `UHealthComponent::TryClaimKillAward()`, claimed inside the combat library | there is no array to remove an actor from, so the exactly-once guarantee is enforced explicitly (eight shotgun pellets can land on the same corpse in one frame) |
| Arena geometry | the renderer draws the layout from world-unit constants | both generators scale grid cells by `World::CellMeters`: a "1 cell" wall piece is 4 m, not 1 m | one unit rule shared by `ACompoundBuilder` and `breachline_level.py`, so the authored and runtime arenas are the same arena |

## Behavioural test coverage

The web build's vitest suite (95 tests) and this port's 17 automation tests are not
one-to-one: the UE suite targets every *pure* system plus the balance contract.
Anything that requires a live world (traversal, animation, FX) is verified by
playing the five-round loop, because a NullRHI automation run cannot meaningfully
assert on it.

If you change a balance number, change it in `BreachlineBalance.{h,cpp}`,
`Content/Data/*.json` and `../src/game/data/config.ts` together, then run both
suites — that is what the parity tests are for.
