# VFX GUIDE

`game/vfx/ParticleSystem.ts` — fixed pools, ring reuse, zero per-frame
allocation, everything self-cleans (fades/parks automatically).

## Pools

- **Additive points** (1500): sparks, muzzle jets, tracer glow, explosion
  fire, shells. Size 0.16, radial-gradient sprite map.
- **Alpha points** (800): smoke, dust, blood puffs, debris, grenade trails.
  Size 0.42, normal blending.
- **Tracers** (28 pooled `THREE.Line`): 70 ms additive fade, per-weapon color
  (player) / red (enemies).
- **Flash sprites** (10): muzzle + explosion billboards, grow-and-fade.
- **Dynamic lights** (3 pooled `PointLight`): muzzle (80 ms) + explosions;
  never more than 3 — no forward-rendering blowup.

## Emitters

`muzzleFlash(pos, dir, big)` — jets + smoke wisp + sprite + light.
`impact(pos, kind)` — concrete/metal/dirt sparks + dust; flesh/blood path.
`shell(pos, right)` — ejecta with gravity + ground bounce.
`explosion(pos)` — 46 fire + 16 smoke + 10 debris + flash + light.
`bloodPuff`, `grenadeTrail`, `tracer(from, to, color)`.

CPU integrates position/velocity/gravity/drag per frame into buffer
attributes (`needsUpdate`); dead particles park at y=−100. Counts scale with
quality (`setMultiplier` 0.45/0.75/1.0).

## Scene lighting (see Game.init)

Hemisphere + shadowed directional key (2048, 64 m ortho box) + 2 practical
point lights (plaza warm, gate cool). Muzzle/explosion lights are the only
dynamic additions. ACES tone mapping, subtle fog (55→150 m).

## Action → feedback map

Fire: flash + smoke + shell + tracer + kick + sound. Hit: blood + victim
flash + hitmarker + sound. Wall hit: sparks + dust + tick. Reload: rig dip +
sound + HUD tag. Grenade: trail + blink + explosion + shake + sound. Death:
fall + stinger + killfeed + score. Kill: +marker/killfeed/score.
