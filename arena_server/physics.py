"""Ground-plane capsule approximation with deterministic wall sliding.

The TypeScript prediction kernel mirrors this math. Only this server kernel
changes authoritative transforms. No client delta-time or position is accepted.
"""

import math

from .config import MAP, PLAYER_RADIUS


def overlaps(x: float, z: float, obstacle: dict, radius: float = PLAYER_RADIUS) -> bool:
    return (
        abs(x - obstacle["x"]) < obstacle["w"] / 2 + radius - 1e-9
        and abs(z - obstacle["z"]) < obstacle["d"] / 2 + radius - 1e-9
    )


def valid_position(x: float, z: float, obstacles: list[dict] | None = None) -> bool:
    limit = MAP["size"] / 2 - PLAYER_RADIUS
    return (
        math.isfinite(x)
        and math.isfinite(z)
        and abs(x) <= limit
        and abs(z) <= limit
        and not any(
            overlaps(x, z, o) for o in (MAP["obstacles"] if obstacles is None else obstacles)
        )
    )


def move(
    x: float, z: float, dx: float, dz: float, obstacles: list[dict] | None = None
) -> tuple[float, float]:
    limit = MAP["size"] / 2 - PLAYER_RADIUS
    # The maximum per-tick move is 0.194m, smaller than every wall + capsule.
    next_x = max(-limit, min(limit, x + dx))
    for o in MAP["obstacles"] if obstacles is None else obstacles:
        if overlaps(next_x, z, o):
            next_x = (
                o["x"] - o["w"] / 2 - PLAYER_RADIUS
                if dx > 0
                else o["x"] + o["w"] / 2 + PLAYER_RADIUS
            )
    next_z = max(-limit, min(limit, z + dz))
    for o in MAP["obstacles"] if obstacles is None else obstacles:
        if overlaps(next_x, next_z, o):
            next_z = (
                o["z"] - o["d"] / 2 - PLAYER_RADIUS
                if dz > 0
                else o["z"] + o["d"] / 2 + PLAYER_RADIUS
            )
    return next_x, next_z


def spawn(team: str, index: int, map_data=None) -> tuple[float, float]:
    arena = MAP if map_data is None else map_data
    points = arena["spawns"][team]
    point = points[index % len(points)]
    if not valid_position(point["x"], point["z"], arena["obstacles"]):
        raise RuntimeError("Invalid spawn geometry in map data")
    return point["x"], point["z"]


for _team in ("blue", "red"):
    for _index in range(4):
        spawn(_team, _index)
