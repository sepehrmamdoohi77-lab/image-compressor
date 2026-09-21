# UE5 MIGRATION GUIDE

The codebase is organized for a later Unreal Engine 5 migration: pure logic
has no engine dependency; engine-touching code is isolated per module.

## Direct ports (no Three.js imports — copy logic, swap math types)

| TS module | UE5 home | Notes |
|---|---|---|
| `data/config.ts` | DataTables / `UDataAsset` | Weapons, enemies, rounds, AI tuning → rows |
| `combat/DamageSystem.ts` | `UBlueprintFunctionLibrary` / C++ | Same pipeline, same tests |
| `weapons/Weapons.ts` (rules) | `UWeaponComponent` | Mag/reload/RPM/bloom verbatim |
| `world/Navigation.ts` | Replace with NavMesh, or port A\* | Grid layout matches tile math |
| `ai/CoverSystem.ts` scoring | EQS test / C++ | Same weights |
| `systems/SpawnSystem.ts` validation | Spawn director | Same rules |
| `systems/ProgressionSystem.ts` | GameState scoring | Same tables |
| `systems/SettingsManager.ts` | `UGameUserSettings` | Same validation |
| `utils/math.ts`, `utils/Pool.ts` | Core helpers / `TObjectPool` | Trivial |

## Engine-side rewrites (same interfaces, native features)

| TS module | UE5 approach |
|---|---|
| `world/Level.ts` | Greybox/ kustera level + NavMesh; collision grid → EQS/nav queries; AABBs → collision channels |
| `world/Materials.ts` | Master materials + instances (same palette/roughness values) |
| `camera/TacticalCamera.ts` | SpringArm + fixed-pitch camera, trauma → CameraShake |
| `entities/*MeshFactory` | Skeletal meshes + AnimBP (states already defined: idle/walk/aim/fire/reload/hit/death); sockets = grip/muzzle/mag/optic |
| `entities/Player` | `ACharacter` + Enhanced Input (same action set) |
| `entities/Enemy` + `ai/AIController` | `AAIController` + Behavior Tree (one task per FSM state) + Perception (sight/hearing) with identical ranges; blackboard = `Enemy.ai` fields |
| `ai/SquadAwareness` | Team knowledge component / shared blackboard |
| `systems/CombatSystem` | LineTrace by channel; `rayVsCharacter` → capsule trace + physical(hit) zones |
| `systems/GrenadeSystem` | Projectile + radial damage with `bIgnore` LOS checks |
| `vfx/ParticleSystem` | Niagara (same emitter list/counts) |
| `audio/AudioManager` | MetaSounds/attenuation (same buses/distances) |
| `ui/` | UMG (same layout spec in UI_GUIDE.md) |
| `core/Game` states | `AGameMode` states + UMG stack |

## Scale & data compatibility

1 unit = 1 m already; eye 1.6, radius 0.35, wall 3.0, cover 1.0/1.35 —
transfer numbers unchanged. Round/wave tables and scoring copy verbatim.

## Suggested order

1. DataTables + damage/weapons unit tests (ported vitest → UE automation).
2. Character + camera + level blockout.
3. Combat + grenades vs target dummies.
4. AI perception → BT tasks → cover/EQS.
5. UMG + audio + Niagara, then rounds/progression.
