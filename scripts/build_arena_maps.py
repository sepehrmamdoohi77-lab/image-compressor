"""Reproducible authored level definitions, not runtime fake maps/opponents."""

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "arena_server/data"
PALETTES = {
    "urban": {
        "sky": "#949e99",
        "ground": "#adae9f",
        "road": "#545f5c",
        "metal": "#607467",
        "trim": "#c3b9a0",
    },
    "harbor": {
        "sky": "#9caeb7",
        "ground": "#b5bdba",
        "road": "#5b6e76",
        "metal": "#406b7c",
        "trim": "#d1bb82",
    },
    "industrial": {
        "sky": "#acaba0",
        "ground": "#a7aaa2",
        "road": "#5d6260",
        "metal": "#a0754f",
        "trim": "#cbb780",
    },
    "desert": {
        "sky": "#c8bca4",
        "ground": "#c6b58e",
        "road": "#77715d",
        "metal": "#82704c",
        "trim": "#dad0ac",
    },
    "cold": {
        "sky": "#a9b6bc",
        "ground": "#b0b6b6",
        "road": "#596873",
        "metal": "#547082",
        "trim": "#c7cabd",
    },
    "market": {
        "sky": "#b8b3a0",
        "ground": "#b6ad92",
        "road": "#73755f",
        "metal": "#896e5d",
        "trim": "#d6bd90",
    },
}


def level(identifier, name, sector, theme, description, layout):
    obstacles = []
    for i, (kind, x, z, w, d, h, *tone) in enumerate(layout):
        obstacles.append(
            {
                "id": f"{identifier[:3]}-{i:02d}",
                "kind": kind,
                "x": x,
                "z": z,
                "w": w,
                "d": d,
                "h": h,
                "tone": tone[0] if tone else "gray",
            }
        )
    return {
        "id": identifier,
        "name": name,
        "sector": sector,
        "size": 44,
        "theme": PALETTES[theme],
        "description": description,
        "spawns": {
            "blue": [{"x": x, "z": 18} for x in (-4, -1.4, 1.4, 4)],
            "red": [{"x": x, "z": -18} for x in (4, 1.4, -1.4, -4)],
        },
        "obstacles": obstacles,
    }


# These protected staging walls and edge structures leave clear exits on both sides.
def staging():
    return [("wall", -4.8, 14.5, 6, 0.6, 1.8, "sand"), ("wall", 4.8, -14.5, 6, 0.6, 1.8, "sand")]


def edges(height=4.2):
    return [
        ("building", -18.4, -9, 5, 8, height, "gray"),
        ("building", 18.4, 9, 5, 8, height, "gray"),
        ("building", -18.4, 9.5, 5, 6, 3.6, "sand"),
        ("building", 18.4, -9.5, 5, 6, 3.6, "sand"),
    ]


def main():
    outpost = json.loads((DATA / "outpost.json").read_text())
    outpost["theme"] = PALETTES["urban"]
    levels = [outpost]
    levels.append(
        level(
            "dockyard",
            "DOCKYARD",
            "02",
            "harbor",
            "Parallel cargo rows and a central loading apron. Wide outer flanks connect separated dock staging areas.",
            staging()
            + [
                ("container", -8, -9, 3, 8, 2.5, "gray"),
                ("container", 8, 9, 3, 8, 2.5, "gray"),
                ("container", -8, 8, 3, 6, 2.5, "olive"),
                ("container", 8, -8, 3, 6, 2.5, "olive"),
                ("container", -18, -10, 5, 7, 2.5, "gray"),
                ("container", 18, 10, 5, 7, 2.5, "gray"),
                ("container", -18, 10, 5, 5, 2.5, "olive"),
                ("container", 18, -10, 5, 5, 2.5, "olive"),
                ("crate", -2, -1, 1.6, 1.6, 1.2, "sand"),
                ("crate", 2, 1, 1.6, 1.6, 1.2, "sand"),
                ("barrier", 0, -6, 3.4, 0.8, 1, "gray"),
                ("barrier", 0, 6, 3.4, 0.8, 1, "gray"),
                ("vehicle", -13, 0, 2.2, 4.2, 1.6, "olive"),
                ("sandbags", 13, 0, 3, 0.9, 0.85, "sand"),
                ("crate", -13, 12, 1.6, 1.6, 1.1, "sand"),
                ("crate", 13, -12, 1.6, 1.6, 1.1, "sand"),
            ],
        )
    )
    levels.append(
        level(
            "refinery",
            "REFINERY",
            "03",
            "industrial",
            "A processing yard divided by utility partitions. Offset openings reward deliberate cross-lane repositioning.",
            staging()
            + edges(5)
            + [
                ("wall", -8, 0, 0.7, 10, 2.2, "gray"),
                ("wall", 8, 0, 0.7, 10, 2.2, "gray"),
                ("container", -4, -9, 3, 5, 2.5, "olive"),
                ("container", 4, 9, 3, 5, 2.5, "olive"),
                ("barrier", 0, 0, 3.2, 0.9, 1, "gray"),
                ("crate", -13, -7, 1.8, 1.8, 1.3, "olive"),
                ("crate", 13, 7, 1.8, 1.8, 1.3, "olive"),
                ("vehicle", 13, -8, 2.2, 4.2, 1.6, "olive"),
                ("vehicle", -13, 8, 2.2, 4.2, 1.6, "olive"),
                ("sandbags", -3, 5, 2.6, 0.9, 0.85, "sand"),
                ("sandbags", 3, -5, 2.6, 0.9, 0.85, "sand"),
                ("wall", -12, -13, 4, 0.6, 1.7, "gray"),
                ("wall", 12, 13, 4, 0.6, 1.7, "gray"),
            ],
        )
    )
    levels.append(
        level(
            "rail-depot",
            "RAIL DEPOT",
            "04",
            "cold",
            "Long offset freight cars create rail-side firing lines. Mid-yard barriers break the quickest central route.",
            staging()
            + [
                ("container", -7, 0, 3, 14, 2.7, "gray"),
                ("container", 7, 0, 3, 14, 2.7, "olive"),
                ("building", -18, -9, 5, 7, 4.2, "gray"),
                ("building", 18, 9, 5, 7, 4.2, "gray"),
                ("barrier", 0, -8, 3, 0.8, 1, "gray"),
                ("barrier", 0, 8, 3, 0.8, 1, "gray"),
                ("sandbags", 0, 0, 2.8, 1, 0.85, "sand"),
                ("crate", -13, 7, 1.6, 1.6, 1.2, "olive"),
                ("crate", 13, -7, 1.6, 1.6, 1.2, "olive"),
                ("wall", -13, -6, 0.6, 5, 1.8, "gray"),
                ("wall", 13, 6, 0.6, 5, 1.8, "gray"),
                ("vehicle", -18, 10, 2.2, 4.3, 1.6, "olive"),
                ("vehicle", 18, -10, 2.2, 4.3, 1.6, "olive"),
            ],
        )
    )
    levels.append(
        level(
            "checkpoint",
            "CHECKPOINT",
            "05",
            "desert",
            "A fortified crossing with staggered concrete gates and parked patrol vehicles. The side routes offer safer approaches.",
            staging()
            + edges(3.8)
            + [
                ("wall", -6, 6, 8, 0.7, 1.8, "sand"),
                ("wall", 6, -6, 8, 0.7, 1.8, "sand"),
                ("barrier", 2, 6, 3, 0.8, 1, "gray"),
                ("barrier", -2, -6, 3, 0.8, 1, "gray"),
                ("vehicle", -12, -6, 2.3, 4.4, 1.6, "sand"),
                ("vehicle", 12, 6, 2.3, 4.4, 1.6, "olive"),
                ("sandbags", 0, 0, 3, 1, 0.85, "sand"),
                ("crate", -6, -11, 1.8, 1.8, 1.2, "sand"),
                ("crate", 6, 11, 1.8, 1.8, 1.2, "sand"),
                ("wall", -13, 4, 0.6, 4, 1.7, "sand"),
                ("wall", 13, -4, 0.6, 4, 1.7, "sand"),
            ],
        )
    )
    levels.append(
        level(
            "courtyard",
            "COURTYARD",
            "06",
            "urban",
            "An open plaza with low cover and four corner buildings. Clear central visibility contrasts with protected perimeter lanes.",
            staging()
            + edges(4.8)
            + [
                ("barrier", 0, 0, 4, 1, 1, "gray"),
                ("sandbags", -6, -5, 2.8, 1, 0.85, "sand"),
                ("sandbags", 6, 5, 2.8, 1, 0.85, "sand"),
                ("crate", 6, -6, 1.8, 1.8, 1.2, "olive"),
                ("crate", -6, 6, 1.8, 1.8, 1.2, "olive"),
                ("wall", -12, -3, 0.6, 6, 1.7, "gray"),
                ("wall", 12, 3, 0.6, 6, 1.7, "gray"),
                ("barrier", 0, -10, 3, 0.8, 1, "gray"),
                ("barrier", 0, 10, 3, 0.8, 1, "gray"),
            ],
        )
    )
    levels.append(
        level(
            "scrapyard",
            "SCRAPYARD",
            "08",
            "industrial",
            "Wreck rows and salvage crates form irregular cover pockets. Several narrow gaps link the flanks to the center.",
            staging()
            + [
                ("vehicle", -13, -7, 2.2, 4.4, 1.6, "sand"),
                ("vehicle", 13, 7, 2.2, 4.4, 1.6, "olive"),
                ("vehicle", -7, 7, 2.2, 4.4, 1.6, "olive"),
                ("vehicle", 7, -7, 2.2, 4.4, 1.6, "sand"),
                ("container", -18, 0, 5, 8, 2.5, "gray"),
                ("container", 18, 0, 5, 8, 2.5, "olive"),
                ("wall", 0, 0, 4, 0.7, 1.7, "gray"),
                ("crate", -3, 4, 1.6, 1.6, 1.2, "sand"),
                ("crate", 3, -4, 1.6, 1.6, 1.2, "sand"),
                ("crate", -12, 10, 1.7, 1.7, 1.3, "olive"),
                ("crate", 12, -10, 1.7, 1.7, 1.3, "olive"),
                ("sandbags", -3, -9, 3, 0.9, 0.85, "sand"),
                ("sandbags", 3, 9, 3, 0.9, 0.85, "sand"),
                ("building", -18, -12, 5, 5, 3.7, "gray"),
                ("building", 18, 12, 5, 5, 3.7, "gray"),
            ],
        )
    )
    levels.append(
        level(
            "barracks",
            "BARRACKS",
            "09",
            "cold",
            "Low military blocks and a central muster road. Offset barrack ends create close-range approaches without sealing the yard.",
            staging()
            + edges(3.5)
            + [
                ("building", -8, -6, 4, 7, 3.3, "gray"),
                ("building", 8, 6, 4, 7, 3.3, "gray"),
                ("wall", -8, 7, 0.6, 4, 1.8, "gray"),
                ("wall", 8, -7, 0.6, 4, 1.8, "gray"),
                ("sandbags", 0, -4, 3, 0.9, 0.85, "sand"),
                ("sandbags", 0, 4, 3, 0.9, 0.85, "sand"),
                ("crate", -12, 10, 1.7, 1.7, 1.3, "olive"),
                ("crate", 12, -10, 1.7, 1.7, 1.3, "olive"),
                ("vehicle", 0, 11, 2.2, 3.8, 1.6, "olive"),
            ],
        )
    )
    levels.append(
        level(
            "bunker",
            "BUNKER",
            "10",
            "industrial",
            "Reinforced outdoor partitions with offset passageways. High cover favors flanks while the central gaps remain contestable.",
            staging()
            + edges(4)
            + [
                ("wall", -6, -8, 9, 0.8, 2.5, "gray"),
                ("wall", 6, 8, 9, 0.8, 2.5, "gray"),
                ("wall", -8, 3, 0.8, 6, 2.5, "gray"),
                ("wall", 8, -3, 0.8, 6, 2.5, "gray"),
                ("wall", 0, 0, 3, 0.8, 2.0, "gray"),
                ("barrier", -3, 9, 2.8, 0.9, 1, "gray"),
                ("barrier", 3, -9, 2.8, 0.9, 1, "gray"),
                ("crate", -13, 2, 1.6, 1.6, 1.2, "olive"),
                ("crate", 13, -2, 1.6, 1.6, 1.2, "olive"),
                ("sandbags", -3, -3, 2.6, 0.8, 0.85, "sand"),
                ("sandbags", 3, 3, 2.6, 0.8, 0.85, "sand"),
            ],
        )
    )
    levels.append(
        level(
            "market",
            "MARKET",
            "11",
            "market",
            "Stall-sized crate clusters line the outer routes. A broad boulevard and staggered low partitions keep the center readable.",
            staging()
            + [
                ("building", -18, -9, 5, 8, 4.3, "sand"),
                ("building", 18, 9, 5, 8, 4.3, "sand"),
                ("building", -18, 10, 5, 6, 3.5, "sand"),
                ("building", 18, -10, 5, 6, 3.5, "sand"),
                ("crate", -9, -8, 2, 2, 1.3, "sand"),
                ("crate", -9, -4, 2, 2, 1.3, "olive"),
                ("crate", -9, 4, 2, 2, 1.3, "sand"),
                ("crate", -9, 8, 2, 2, 1.3, "olive"),
                ("crate", 9, -8, 2, 2, 1.3, "sand"),
                ("crate", 9, -4, 2, 2, 1.3, "olive"),
                ("crate", 9, 4, 2, 2, 1.3, "sand"),
                ("crate", 9, 8, 2, 2, 1.3, "olive"),
                ("barrier", -2, -5, 3, 0.8, 0.95, "gray"),
                ("barrier", 2, 5, 3, 0.8, 0.95, "gray"),
                ("sandbags", 0, 0, 2.6, 0.9, 0.85, "sand"),
                ("vehicle", 13, 0, 2.2, 4.2, 1.6, "sand"),
            ],
        )
    )
    target = DATA / "maps"
    target.mkdir(exist_ok=True)
    for value in levels:
        (target / f"{value['id']}.json").write_text(json.dumps(value, indent=2) + "\n")
    print(f"Authored {len(levels)} distinct physical map layouts")


if __name__ == "__main__":
    main()
