# Architecture

## The one rule

**Simulation code is pure and engine-light; presentation code is an engine shell
around it.**

A hit is resolved by `Breachline::ComputeDamage()` — a function that takes a struct
and returns a struct, has no world, no actor and no randomness. `UHealthComponent`
then applies the result. The radar projection is `Breachline::ToRadarLocal()`, not
a method on a HUD. The gunnery model is `Breachline::PlanEnemyShot()` with an
*injectable* RNG, which is why a test can pin a shot to hit or miss on demand.

That is what makes the whole thing testable in a headless commandlet, and it is why
"the balance table" and "the code that reads the balance table" are different files
with different reviewers.

```
                     +---------------------- Core/BreachlineBalance.h ----------------------+
                     |  every tuning number (weapons, archetypes, rounds, AI, HUD, world)   |
                     +---------+----------------------+----------------------+---------------+
                               |                      |                      |
                     Core/BreachlineTypes.h   Combat/DamageModel.*   Combat/EnemyFireModel.*
                       (shared structs)        (pure pipeline)        (pure gunnery)
                               |                      |                      |
                               +----------+-----------+----------+-----------+
                                          |                      |
                              Combat/BreachlineCombatLibrary  AI/TacticalAIController
                              (the single funnel: bullets,     (FSM: perceive -> decide
                               explosions, hit zones, FX,       -> act; cover, flank,
                               audio, stat notifications)       squad intel, hearing)
                                          |                      |
                     +--------------------+----------------------+---------------------+
                     |                    |                      |                     |
          Character/HealthComponent  Weapons/WeaponComponent  AI/SpawnDirector   World/CoverPoint
          (health, armour, death)    (one gun: ammo, bloom,   (waves, placement,  (one fighting
                                      reload, fire)            stagger, scaling)   position)
                     |                    |                      |
                     +--------------------+----------------------+
                                          |
                              Character/Breachline{Player,Enemy}Character
                                          |
                              UI/BreachlinePlayerController (view + threat picture)
                                          |
                                    UI/BreachlineHUD (canvas)
```

## Directory map

| Path | Responsibility |
| --- | --- |
| `Core/BreachlineTypes.h` | Every shared `USTRUCT`/`UENUM`: weapon defs, archetypes, rounds, bullet results, threat contacts, radar blips, the HUD snapshot. No logic. |
| `Core/BreachlineBalance.*` | The balance table. Namespaces mirror the web build's `config.ts` blocks: `World`, `Camera`, `Player`, `AI`, `Threats`, `Pickups`, `Radar`, `Damage`, `Hud`, `Spawn`, `FX`, plus `DefaultWeapons()`, `DefaultEnemyArchetypes()`, `DefaultRounds()`. |
| `Core/BreachlineMath.h` | Pure geometry: radar projection, scope clamping, bearing. Tested. |
| `Core/BreachlineSettings.*` | `UDeveloperSettings` ("Project Settings → Game → Breachline"). Soft asset refs for tables, meshes and Niagara systems, plus tuning multipliers. |
| `Core/BreachlineGameInstance.*`, `BreachlineSaveGame.h` | Profile (volume, sensitivity, camera distance, quality tier), `SanitizeProfile()`, `ApplyQualityTier()` → CVars. |
| `Core/ProgressionSubsystem.*` | Round lifecycle and scoring. Static pure helpers so the tables are testable without a world. |
| `Combat/DamageModel.*` | Zone → falloff → armour → health. Pure. |
| `Combat/EnemyFireModel.*` | Accuracy, aim error, deliberate near misses, ray-point distance. Pure, injectable RNG. |
| `Combat/BreachlineCombatLibrary.*` | The only place a bullet becomes damage. Handles pellets, spread, tracers, impacts, audio, damage, hit markers, kill scoring — for player fire, hostile fire and grenades alike. |
| `Camera/TacticalCameraRig.*` | The isometric rig: 40° elevation, 20 m distance (12–30 clamp), 38° FOV, damped follow, Perlin trauma shake, fire/explosion kick, Q/E orbit, screen→ground projection. |
| `Character/HealthComponent.*` | Health, armour, `ApplyBullet`, `Heal`, `Resupply`, delegates, damage multiplier, corpse lifetime. |
| `Character/BreachlineCharacterBase.*` | Capsule sized from the balance table, muzzle/chest queries, aim direction, death (ragdoll when a physics asset exists, procedural collapse otherwise). |
| `Character/BreachlinePlayerCharacter.*` | Loadout, runtime Enhanced Input mapping, movement modes (sprint/precision/crouch), firing, grenades, medkits, footsteps and noise radius. |
| `Character/BreachlineEnemyCharacter.*` | The hostile body: archetype, difficulty scaling, carried weapon, archetype tint/scale, death. Combat *decisions* live in the controller. |
| `AI/TacticalAIController.*` | The FSM, perception, squad intel, hearing, cover selection, burst discipline, near-miss reporting. |
| `AI/SpawnDirector.*` | Wave composition (weighted draw), navmesh placement rules, staggered entry, `MaxAlive` cap, remaining-count for the HUD. |
| `Weapons/WeaponComponent.*` | One gun: `TryFire` (player cone), `TryFireEnemy` (gunnery model), bloom, spread, reload cadence (magazine/pump/bolt), dry fire. |
| `Weapons/WeaponManagerComponent.*` | Five slots; `BuildLoadout()` resolves DataTable → `DA_Weapon_<id>` → compiled defaults. |
| `Weapons/GrenadeActor.*` | Ballistic throw, bounce, accelerating blink, LOS-gated radial damage. |
| `World/CompoundBuilder.*` | Runtime arena generator (ground, walls, buildings, cover + cover points, lighting, navmesh bound, player start). Used when the level is empty. |
| `World/CoverPoint.*` | One fighting position; the normal faces the open ground, which is how "is the wall between us?" is answered without raycasts. |
| `World/HealthKitPickup.*` | Field medkit: bob/spin/glow, proximity collection, 30 % heal, despawn warning blink. |
| `Game/BreachlineGameMode.*` | The run: `InitGame` (generate the arena), round start with full resupply, wave → clear → score → next round, defeat/victory, medkit spawn cadence. |
| `UI/BreachlinePlayerController.*` | View target and camera rig ownership, cursor aim, the threat picture (awareness, bearing, distance), the HUD snapshot, all feedback notifications. |
| `UI/BreachlineHUD.*` | The entire interface, drawn with canvas primitives. |
| `VFX/BreachlineFXPool.*`, `VFX/BreachlineFXSubsystem.*` | Pooled tracers/impacts/bursts/muzzle lights with a Niagara-first path and a zero-asset fallback. |
| `Audio/BreachlineSfxSynth.*`, `Audio/BreachlineAudioSubsystem.*` | 48-voice procedural synthesiser (noise/sine/triangle/square/saw, per-voice biquad, ADSR, delay-by-negative-position) plus distance/pan/mix management. |
| `Tests/BreachlineTests.cpp` | 13 automation tests over every pure system. |

## Data flow of one shot (player)

```
ABreachlinePlayerCharacter::FireOnce
   -> UWeaponComponent::TryFire(muzzle, aim)          ammo, cooldown, bloom
      -> UBreachlineCombatLibrary::ResolveShot(ctx)
         for each pellet:
           PerturbDirection (spread cone, deterministic RNG)
           TraceBullet (Weapon trace channel: soft cover ignored)
           ClassifyHitZone (bone name, else height + lateral offset)
           Breachline::ComputeDamage (zone, falloff, armour)
           UHealthComponent::ApplyBullet    -> health/armour, death, scoring
           UBreachlineFXSubsystem (tracer, impact, muzzle flash)
           UBreachlineAudioSubsystem (shot, impact, near-miss whiz)
           ABreachlinePlayerController::NotifyHitConfirmed / NotifyWeaponFired
```

Hostile fire takes the same route through `ResolveEnemyShot`, which builds the
gunnery model's input from live world state (shooter moving, player moving, player
crouched, distance), plans the shot, resolves it, and reports the round's closest
approach to the player's chest so the controller can shake the camera and play the
whiz. One code path for damage, two models for aim: that is the whole design.

## Why these choices

* **FSM instead of Behaviour Tree** — the AI is a port, and the design (decision
  tick, confidence memory, cover scoring, burst discipline) is easier to keep
  identical to the reference implementation in one readable 700-line file than
  spread across a graph. StateTree is enabled in the project so a designer can
  migrate individual behaviours later without touching the C++ interfaces.
* **Canvas HUD instead of UMG** — it cannot break on an asset rename, needs no
  font import, is trivially themeable from one palette block, and costs no widget
  tick. A UMG rebuild can consume `FHudSnapshot` unchanged.
* **Procedural audio instead of SoundCues** — same reason the web build had a Web
  Audio synth: the project is complete and demonstrable with no asset pipeline. The
  `Play*` functions on `UBreachlineAudioSubsystem` are the single place to swap in
  MetaSounds.
* **Runtime compound generator** — the difference between "a repo you must
  configure" and "a repo you press Play in". The authored level and the runtime
  layout share the same grid, the same cover plan and the same lighting values, so
  neither is a second-class citizen.
* **Everything optional** — no `nullptr` dereference is possible from a missing
  asset: every authored reference is soft, resolved through
  `UBreachlineSettings::Get()`, with a compiled-in fallback.
