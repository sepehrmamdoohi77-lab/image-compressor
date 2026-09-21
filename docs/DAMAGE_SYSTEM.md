# DAMAGE SYSTEM

Pipeline (`game/combat/DamageSystem.ts`, pure + unit-tested):

```
Weapon → HitDetection → HitZone → Falloff → Armor → Health → Reaction → Death
```

## Hit detection

`CombatSystem` fires from the muzzle; `Level.raycastObstacles` finds the
nearest wall/ground hit; `rayVsCharacter` (ray vs vertical capsule + head
sphere) finds the nearest character inside that distance. Zone comes from
impact height + lateral offset (`zoneFromHeight`); crouched targets use a
1.15 m profile so low cover genuinely protects them.

## Zones & multipliers

- HEAD: per-weapon `headshotMult` (1.7–2.5×).
- TORSO: 1.0×. ARMS: 0.75×. LEGS: 0.65×.
- Central table `DAMAGE.zoneMult`; headshots get distinct crosshair/sound/
  killfeed feedback.

## Falloff

`falloffMultiplier(d, start, end, min)`: 1.0 until start, linear to min at
end, min beyond. Per-weapon curves (e.g. shotgun 6→18 m to 0.25×, DMR
26→55 m to 0.7×) define each gun's effective envelope.

## Armor

```
reduction = clamp(armor / (armor + 60), 0, 0.75)
healthDamage = max(1, round(raw × (1 − reduction)))
armorDamage  = round(mitigated × 0.65 × armorDamageMult + raw × 0.12 × armorDamageMult)
```

Armor meaningfully extends life without bullet-sponging (75% cap, minimum 1
damage). Armor pool depletes as it protects. Grenades use a simplified
`armor/(armor+60)` capped at 50%.

## Grenades

110 damage, 5.5 m radius, `grenadeFalloff` (1 → 0.25 at edge, 0 beyond),
LOS-gated per target (blocked ⇒ ×0.15), full vs enemies, 0.6× self-damage.
Never passes through unlimited walls (segment test per victim).

## Reactions & death

- Hit: blood puff at impact, victim hit-flash + AI damage notify (approximate
  reveal), attacker hitmarker + sound.
- Enemy death: AI removed, cover released, death fall animation, 6 s corpse,
  score/killfeed/audio, objective count decremented.
- Player death: input stopped, 2.2 s death cam, DEFEAT screen with stats.

## Balance notes

Player rifle TTK vs rifleman ≈ 3 torso shots; DMR drops most enemies in 1–2
headshots; heavies demand focus fire, headshots, or grenades. Enemy DPS is
gated by reaction time, bursts, pauses, and miss rates — dangerous in the
open, manageable in cover.
