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
quality (`setMultiplier` 0.45/0.8/1.15) and ambient dust is gated by
`setDetail(q !== 'low')`.

## Ambient dust (atmosphere)

340 additive motes (`size 0.075`, opacity 0.32) drift with a slow sine sway and
wrap inside a 26 m × 8 m box centred on `setFocus(player)` — density stays
constant wherever the player walks, at the cost of one buffer upload per frame.

## Threat indicator (`vfx/ThreatIndicator.ts`)

Pooled (≤ `THREATS.maxIndicators`) additive geometry that answers "where is the
danger?":

- **Ground streak** — a 5-vertex strip (tapered line + arrow flare + tip) laid at
  y = 0.06 from the soldier toward each nearby hostile, built with per-vertex RGBA
  (bright core, fading tail, soft edges). Width and alpha pulse at
  `THREATS.pulseHz`; alpha scales with proximity, boosted by `awareBoost` when the
  hostile knows where you are.
- **Threat ring** — a pooled `RingGeometry` pulsing at the hostile's feet, sized
  by proximity.
- **Read-out** — `update()` returns `{ level, screenAngleDeg, nearest, count }`:
  the HUD edge glow, the bearing chevron and the `⚠ CONTACT` distance tag.

Streaks are hidden (not faded) when nothing is inside `THREATS.radius`, and
`clear()` resets everything on restart/menu.

## Scene lighting (see Game.init)

Hemisphere + shadowed directional key (2048, 64 m ortho box) + 2 practical
point lights (plaza warm, gate cool). Muzzle/explosion lights are the only
dynamic additions. ACES tone mapping, subtle fog (55→150 m).

## Action → feedback map

Fire: flash + smoke + shell + tracer + kick + sound. Hit: blood + victim
flash + hitmarker + sound. Wall hit: sparks + dust + tick. Reload: rig dip +
sound + HUD tag. Grenade: trail + blink + explosion + shake + sound. Death:
**two-stage collapse** (impact recoil → fold → topple to one side, limbs slack,
weapon swinging loose, ends with a settling twitch) + stinger + killfeed + score.
Kill: +marker/killfeed/score. Medkit: green beacon ring + red cross + pickup
audio + HUD pop. Round change: resupply toast.

## Death animation (`CharacterMeshFactory.updateFall`)

Driven by `RigAnimState.dead`; the game keeps ticking corpses for their 6 s
lifetime (`Game` step 13), so the fall completes after the AI controller is
gone. Timeline: 0–0.22 s impact recoil (shoulders snap back, head whips),
0.14–1.04 s eased fold and topple (body rotates past horizontal, roll/yaw are
randomised **once** per death so a corpse never jitters), 1.0–1.4 s settling
twitch. Arms blend to slack splayed poses and the weapon mount droops with them.
