"""Fair cosmetic-only progression. No level changes combat statistics."""

XP = {"kill": 75, "assist": 25, "headshot": 25, "completion": 100, "win": 100}
MAX_LEVEL = 50
THRESHOLDS = [0]
for level in range(1, MAX_LEVEL):
    THRESHOLDS.append(THRESHOLDS[-1] + 250 + 75 * (level - 1))
STAT_KEYS = (
    "kills",
    "deaths",
    "assists",
    "shots",
    "hits",
    "headshots",
    "damage",
    "matches",
    "wins",
    "losses",
    "draws",
)


def empty_stats():
    return {**dict.fromkeys(STAT_KEYS, 0), "weaponShots": {}}


def level_data(xp):
    level = max(i + 1 for i, threshold in enumerate(THRESHOLDS) if xp >= threshold)
    current = THRESHOLDS[level - 1]
    next_threshold = THRESHOLDS[level] if level < MAX_LEVEL else None
    return {"level": level, "xp": xp, "levelStartXp": current, "nextLevelXp": next_threshold}


def reward(stats, won, eligible, practice):
    if practice or not eligible:
        return 0
    return (
        stats["kills"] * XP["kill"]
        + stats["assists"] * XP["assist"]
        + stats["headshots"] * XP["headshot"]
        + XP["completion"]
        + (XP["win"] if won else 0)
    )
