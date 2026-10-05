"""Central, data-driven authority and client configuration."""

from .maps import MAPS, get_map
from .weapons import WEAPON_DATA

PROTOCOL_VERSION = 3
TICK_HZ = 30
SNAPSHOT_HZ = 15
PLAYER_RADIUS = 0.34
WALK_SPEED = 3.8  # meters per second
SPRINT_SPEED = 5.8
INPUT_TIMEOUT = 0.3
RECONNECT_GRACE = 20.0
COUNTDOWN_SECONDS = 3.0
MAX_PLAYERS = 8
MAX_ROOMS = 64
MAX_CONNECTIONS = 256
ROOM_IDLE_SECONDS = 30 * 60
PING_INTERVAL = 5.0
HEARTBEAT_TIMEOUT = 20.0
CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
RESPAWN_SECONDS = 3.0
SPAWN_PROTECTION_SECONDS = 2.5
BASE_HEALTH = 100.0
BASE_ARMOR = 65.0
ARMOR_ABSORPTION = 0.35
CROUCH_SPEED_FACTOR = 0.45
ADS_SPEED_FACTOR = 0.65
VISION_RANGE = 70.0
CONTACT_TTL = 5.0
REWIND_LIMIT = 0.2
DESTRUCTIBLE_HEALTH = {"crate": 110.0, "sandbags": 160.0}
GRENADE = {
    "fuseSeconds": 2.8,
    "radius": 6.5,
    "damage": 155.0,
    "gravity": 9.8,
    "throwSpeed": 12.0,
    "quantity": 2,
    "maxRange": 32.0,
    "landingHeight": 0.09,
    "boundaryMargin": 0.2,
}
MAP = get_map("outpost")


def public_config() -> dict:
    return {
        "protocolVersion": PROTOCOL_VERSION,
        "stage": 4,
        "mode": "TEAM_DEATHMATCH",
        "combatEnabled": True,
        "supportedModes": ["TEAM_DEATHMATCH", "NETWORK_DRILL"],
        "botsSupported": True,
        "tickHz": TICK_HZ,
        "snapshotHz": SNAPSHOT_HZ,
        "maxPlayers": MAX_PLAYERS,
        "reconnectGraceSeconds": RECONNECT_GRACE,
        "movement": {
            "radius": PLAYER_RADIUS,
            "walkSpeed": WALK_SPEED,
            "sprintSpeed": SPRINT_SPEED,
            "inputTimeoutSeconds": INPUT_TIMEOUT,
            "crouchFactor": CROUCH_SPEED_FACTOR,
            "adsFactor": ADS_SPEED_FACTOR,
        },
        "defaultSettings": {
            "mapId": "outpost",
            "teamSize": 4,
            "timeLimitSeconds": 600,
            "mode": "TEAM_DEATHMATCH",
            "scoreLimit": 50,
            "bots": 0,
            "difficulty": "normal",
            "friendlyFire": False,
        },
        "weapons": WEAPON_DATA,
        "grenade": GRENADE,
        "combat": {
            "health": BASE_HEALTH,
            "armor": BASE_ARMOR,
            "respawnSeconds": RESPAWN_SECONDS,
            "protectionSeconds": SPAWN_PROTECTION_SECONDS,
            "visionRange": VISION_RANGE,
        },
        "map": MAP,
        "maps": list(MAPS.values()),
    }
