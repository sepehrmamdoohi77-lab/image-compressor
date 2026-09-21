# GAMEPLAY

## Core loop

```
MAIN MENU → DEPLOY → ROUND BRIEFING → TACTICAL COMBAT → AREA CLEAR →
(next round …) → VICTORY / DEFEAT → stats → RETRY / MENU
```

Objective every round: **eliminate all hostiles**. Remaining count is always
visible top-center. Nothing else is required to progress.

## Controls

Camera: 46° elevation (deliberately low so hostiles read against the skyline),
45° azimuth, Q/E to orbit, wheel to zoom.

WASD move (camera-relative, diagonals normalized), mouse aim in world space,
LMB fire, RMB precision aim (0.55× move, spread × weapon aim mult, steadier),
R reload, G grenade, C/Ctrl crouch, 1–5/Tab weapons, wheel zoom, Q/E camera
rotation, ESC pause.

## Movement & aiming

- Acceleration 26 / deceleration 30, walk 4.6 m/s, penalties per weapon while
  firing/aiming, 0.5× crouched, collision via circle-vs-AABB + bounds clamp.
- Mouse raycasts to the ground plane; soldier yaw, weapon, muzzle, and bullet
  trajectories all derive from that single aim point (crosshair → aim →
  muzzle → projectile, verified in code and integration tests).

## Weapons (see WEAPON_SYSTEM.md)

Rifle (balanced auto), SMG (close-range hose), Shotgun (8-pellet burst),
DMR (semi, precise, hard-hitting), Pistol (fast backup). Switching cancels
reload. Ammo: mag + reserve, auto-reload on empty trigger, +reserve and +1
grenade and +25 armor each round.

## Damage & survival (see DAMAGE_SYSTEM.md)

Head 2.0–2.5× (per weapon), torso 1×, arms 0.75×, legs 0.65×, distance falloff
per weapon, armor mitigation `armor/(armor+60)` capped at 75%. HP 100, armor
starts 50 (max 100). Damage vignette + low-HP pulse communicate state.

## Grenades

Press G: throws toward cursor (3–17 m), bounces off walls/ground, 2.1 s fuse,
5.5 m radius, LOS-gated (walls reduce damage to 15%), damages enemies fully
and the player at 0.6×. Start with 3, +1 per round (max 4).

## Enemies (see AI_ARCHITECTURE.md)

| Archetype | HP | Armor | Weapon | Style |
|---|---|---|---|---|
| Rifleman | 70 | 10 | Rifle | Balanced, mid-range, uses cover |
| Assault | 55 | 0 | SMG | Fast pusher, flanks, close range |
| Heavy | 160 | 45 | Shotgun | Slow tank, short-mid range |
| Support | 60 | 15 | DMR | Long-range marksman, hangs back |

They perceive (vision cone + LOS, hearing), remember (decaying), share
approximate intel, and execute cover/flank/retreat/search/reload tactics.
Difficulty scales via composition, accuracy, aggression, and health — never
into bullet-sponge territory.

## Rounds

1. **CONTACT** — 4 basics. 2. **PRESSURE** — 6, runners + marksman.
3. **MIXED FORCE** — 7 incl. heavy. 4. **HEAVY RESISTANCE** — 8, 2 heavies.
5. **FINAL STAND** — 10, max concurrency 7.

Spawns are validated: ≥10 m from player (≥16 m if visible), walkable,
unoccupied, with a real path to the player; staggered over time.

## Scoring

Elimination value per archetype + headshot 50 + grenade 75 + multikill chain
(3 s window: 100/200/350/500) + round-clear bonus (250→1000) + accuracy bonus
300 (≥50% over 10+ shots) + no-damage bonus 500. Score never affects gameplay.

## Threat telegraphing (danger line)

Hostiles are not invisible, but a 46° iso camera hides the ones hugging your
flank. `game/vfx/ThreatIndicator.ts` draws an additive **red streak on the
ground from the soldier toward every hostile inside `THREATS.radius` (21 m)**,
topped with a **pulsing ring at the hostile's feet**. Intensity scales with
proximity, and aware hostiles (`ai.confidence > 0.35`) read hotter
(`THREATS.awareBoost`). Up to `THREATS.maxIndicators` streaks are pooled.

The same pass feeds the HUD: `threatLevel` (0..1) drives the red screen edge,
`threatAngleDeg` rotates the chevron toward the bearing (0° = ahead, +90° =
right, in screen space), and `threatDistance` shows as `⚠ CONTACT — 7m ×2`.

It is honest information, not omniscience: the streak is anchored on you and
points at a real, alive, un-occluded-by-nothing hostile — no marker appears for
dead bodies or hostiles outside the radius.

## Enemy fallibility

Enemies aim with a cone error that grows with range, your movement, their own
movement and a fresh reaction; on top of that `planEnemyShot` rolls an
occasional **deliberate near miss** (`AI.missChance*`, capped at 0.35). Those
rounds are thrown 0.55–1.0 m wide so they snap past you: you get the crack of a
bullet passing (`AudioManager.playNearMiss`) plus a small camera kick, and the
impact sparks off the wall behind you. Getting shot means someone actually had
you — which makes cover and movement feel earned.
