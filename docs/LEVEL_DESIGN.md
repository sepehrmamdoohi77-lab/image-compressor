# LEVEL DESIGN

Hand-built 44×44 m arena (`game/world/Level.ts`), 1 unit = 1 m. Cell (0,0) is
north-west; player spawns south (21,39); enemies spawn north/east/west.

## Layout (cell coords)

- **Perimeter**: 3.4 m border walls, outer flank lanes at x1–3 and x40–42.
- **NW Barracks** (4–10, 4–10) & **NE Armory** (33–39, 4–10): hollow, 2 doors
  each — breachable interiors, window insets, door lintels.
- **SW Depot** (4–11, 30–37) & **SE Garage** (32–39, 30–37): hollow warehouses
  with wide doors + interior crates.
- **Mid solids** (5–8 / 35–38, 17–19): route-splitting blocks forcing
  commit-or-flank decisions.
- **Divider walls** (x13/x30, z14–20 & z25–27) with gaps: chokepoints.
- **North checkpoint** (z12, gap x20–23): gated avenue entry + sandbags.
- **Central plaza**: diamond of mid covers + corner crates, center open —
  the primary mid-range duel space.
- **Avenues**: 4 m vertical + horizontal strips (sightlines preserved over
  low/mid cover since eye 1.6 m > 1.35 m).
- **South defense line** (z33–35): sandbags + crates for the player's fallback.
- **Cover chains** on all lanes + barrel singles: no long sprint without cover.

## Combat geometry

- Long lanes (avenues, perimeter), mid duels (plaza, checkpoint), CQB
  (building interiors, divider gaps). Every major space has ≥2 approaches.
- Cover heights: low 1.0 m (crates — crouch to hide), mid 1.35 m (sandbags),
  walls 3.0 m, buildings 3.6 m. Doors 2.0 m clear.
- 14 validated enemy spawn cells; connectivity guaranteed (spawn path-check).
- Props: lamp posts (plaza/gates), emissive heads, barrels, pipes, debris,
  glass windows — ~130 meshes, shared geometries/materials.

## Collision & data

Realized into: walkability grid (nav), AABB obstacles with heights (bullets,
LOS, body collision), ~150 generated cover points with obstacle normals.
See ARCHITECTURE.md.
