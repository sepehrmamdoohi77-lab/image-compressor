"""Central weapon data and inventory state. Only the authority changes ammunition."""

import json
from dataclasses import dataclass
from enum import StrEnum
from pathlib import Path


class WeaponId(StrEnum):
    RIFLE = "rifle"
    SMG = "smg"
    SHOTGUN = "shotgun"
    DMR = "dmr"
    PISTOL = "pistol"


class WeaponStatus(StrEnum):
    HOLSTERED = "HOLSTERED"
    EQUIPPED = "EQUIPPED"
    AIMING = "AIMING"
    FIRING = "FIRING"
    RELOADING = "RELOADING"
    SWITCHING = "SWITCHING"
    DISABLED = "DISABLED"


WEAPON_DATA = json.loads((Path(__file__).parent / "data/weapons.json").read_text())
WEAPONS = {weapon["id"]: weapon for weapon in WEAPON_DATA}
PRIMARY_WEAPONS = ("rifle", "smg", "shotgun", "dmr")
COSMETICS = ("olive", "slate", "sand")


@dataclass
class WeaponInstance:
    id: str
    magazine: int
    reserve: int
    next_fire_at: float = 0.0
    ready_at: float = 0.0
    reload_at: float | None = None
    reload_started_at: float | None = None
    last_fired_at: float = -1e9

    @classmethod
    def grant(cls, weapon_id: str):
        data = WEAPONS[weapon_id]
        return cls(weapon_id, data["magazineSize"], data["reserveAmmo"])

    def interrupt_reload(self):
        self.reload_at = self.reload_started_at = None


def inventory(primary: str) -> dict[int, WeaponInstance]:
    if primary not in PRIMARY_WEAPONS:
        raise ValueError("Invalid primary weapon")
    return {1: WeaponInstance.grant(primary), 2: WeaponInstance.grant("pistol")}
