# WEAPON SYSTEM

Data in `game/data/config.ts` (`WEAPONS`), rules in `game/weapons/Weapons.ts`,
meshes in `game/entities/WeaponMeshFactory.ts`, resolution in
`game/systems/CombatSystem.ts`.

## WeaponDef fields

ID, name, category, damage, armor-damage mult, mag/reserve, RPM, reload time,
recoil (pitch/yaw/recovery), spread (base/move/shot/max/aim-mult), range,
falloff start/end + min mult, move penalty, fire mode, pellets, headshot mult,
camera kickback, tracer color, synth sound params, per-round refill.

## Arsenal

| Weapon | Mode | RPM | Mag | Dmg | Pellets | Spread | Range | Role |
|---|---|---|---|---|---|---|---|---|
| AR-7 Rifle | auto | 540 | 30 | 24 | 1 | .012 | 46 | balanced mid |
| VK-9 SMG | auto | 800 | 40 | 15 | 1 | .022 | 34 | close shredder |
| M500 Shotgun | semi | 70 | 6 | 11 | 8 | .055 | 22 | burst delete |
| LR-12 DMR | semi | 170 | 10 | 62 | 1 | .004 | 60 | precise power |
| P9 Pistol | semi | 320 | 12 | 20 | 1 | .011 | 30 | fast backup |

Differences are structural (pellets, falloff curves, recoil, spread behavior),
not just damage numbers.

## Firing (`WeaponInstance` + `CombatSystem.playerFire/enemyFire`)

- RPM enforced via `lastShotAt` interval; semi requires trigger edge, auto
  requires held trigger. Dry-fire clicks when empty.
- Origin is always the weapon **muzzle socket** (world transform), direction
  from muzzle toward the aim point (cursor raised to torso height for honest
  trajectories), spread cone + predictable recoil bias applied.
- Walls stop bullets first (`Level.raycastObstacles`, nearest AABB or ground),
  then the nearest character capsule along the ray (`rayVsCharacter`).
  Bullets never pass through solid geometry.

## Recoil

Per-shot `recoilPitch` accumulates (capped 0.09 rad) and decays via
`recoilRecovery`; applied as upward bias + alternating yaw on shot direction,
plus weapon-kick animation and camera kick. Predictable enough to compensate.

## Spread (`computeSpread`)

`min(base + bloom + (moving ? move : 0), max) × (aiming ? aimMult : 1)`.
Bloom grows per shot and decays ~1/s. Aiming never removes spread entirely.

## Ammunition

Mag + reserve, no negatives, no fire-while-reloading, reload transfers
`min(need, reserve)`, auto-reload on empty trigger, switch cancels reload,
HUD warns at ≤25% mag and when fully dry.

## Meshes & sockets

Each weapon: receiver/barrel/stock/grip/mag/optic from shared box geometry,
forward = +Z, grip at mount origin, `muzzle` Object3D at barrel tip, `mag`
Object3D for reload reference. Lengths 0.2–0.94 m per class.

## Enemy use

Enemies hold `WeaponInstance`s of the same defs (rifle/smg/shotgun/dmr) with
full reserves; AI adds burst discipline and aim error on top (see
AI_ARCHITECTURE.md). Enemy tracers are red for readability.
