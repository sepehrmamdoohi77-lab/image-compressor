"""Canonical validated level catalog; rooms choose real geometry, never UI-only maps."""

import json
import math
from pathlib import Path
from typing import Literal

MapId = Literal[
    "outpost",
    "dockyard",
    "refinery",
    "rail-depot",
    "checkpoint",
    "courtyard",
    "scrapyard",
    "barracks",
    "bunker",
    "market",
]
MAP_IDS = (
    "outpost",
    "dockyard",
    "refinery",
    "rail-depot",
    "checkpoint",
    "courtyard",
    "scrapyard",
    "barracks",
    "bunker",
    "market",
)
MAPS = {
    identifier: json.loads((Path(__file__).parent / "data/maps" / f"{identifier}.json").read_text())
    for identifier in MAP_IDS
}


def get_map(identifier: str):
    if identifier not in MAPS:
        raise ValueError("Unknown map")
    return MAPS[identifier]


def _validate():
    allowed = {"building", "container", "wall", "vehicle", "crate", "barrier", "sandbags"}
    for identifier, m in MAPS.items():
        if m["id"] != identifier or m["size"] != 44:
            raise ValueError("Invalid map identity/scale")
        seen = set()
        for o in m["obstacles"]:
            if (
                o["id"] in seen
                or o["kind"] not in allowed
                or not all(math.isfinite(o[k]) for k in ("x", "z", "w", "d", "h"))
            ):
                raise ValueError("Invalid map obstacle")
            if not (
                0 < o["w"] <= 20
                and 0 < o["d"] <= 20
                and 0 < o["h"] <= 10
                and abs(o["x"]) + o["w"] / 2 <= 22
                and abs(o["z"]) + o["d"] / 2 <= 22
            ):
                raise ValueError("Map obstacle outside world")
            seen.add(o["id"])
        for team in ("blue", "red"):
            if len(m["spawns"][team]) != 4:
                raise ValueError("Map requires four configurable team slots")
            for p in m["spawns"][team]:
                if (
                    abs(p["x"]) > 21.66
                    or abs(p["z"]) > 21.66
                    or any(
                        abs(p["x"] - o["x"]) < o["w"] / 2 + 0.34
                        and abs(p["z"] - o["z"]) < o["d"] / 2 + 0.34
                        for o in m["obstacles"]
                    )
                ):
                    raise ValueError("Invalid map spawn")


_validate()
