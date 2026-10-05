"""Versioned intent protocol. No client position, damage, score or ammo reports."""

import random
from collections import deque
from dataclasses import dataclass, field
from enum import StrEnum
from typing import Annotated, Literal

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    StringConstraints,
    TypeAdapter,
    field_validator,
    model_validator,
)

from .maps import MapId, get_map
from .weapons import WeaponInstance, WeaponStatus


class Phase(StrEnum):
    LOBBY = "LOBBY"
    COUNTDOWN = "COUNTDOWN"
    ACTIVE = "ACTIVE"
    ENDING = "ENDING"
    RESULTS = "RESULTS"
    CLOSED = "CLOSED"


class Mode(StrEnum):
    NETWORK_DRILL = "NETWORK_DRILL"
    TEAM_DEATHMATCH = "TEAM_DEATHMATCH"


class PlayerStatus(StrEnum):
    CONNECTED = "CONNECTED"
    LOBBY = "LOBBY"
    READY = "READY"
    SPAWNING = "SPAWNING"
    ALIVE = "ALIVE"
    DEAD = "DEAD"
    RESPAWNING = "RESPAWNING"
    DISCONNECTED = "DISCONNECTED"
    SPECTATING = "SPECTATING"


class Team(StrEnum):
    BLUE = "blue"
    RED = "red"


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)


class RoomSettings(StrictModel):
    mapId: MapId = "outpost"
    teamSize: Literal[1, 2, 3, 4] = 4
    timeLimitSeconds: Literal[120, 300, 600] = 600
    mode: Literal["NETWORK_DRILL", "TEAM_DEATHMATCH"] = "NETWORK_DRILL"
    scoreLimit: int = Field(default=50, ge=1, le=100)
    bots: int = Field(default=0, ge=0, le=7)
    difficulty: Literal["easy", "normal", "hard"] = "normal"
    friendlyFire: bool = False

    @field_validator("teamSize", "timeLimitSeconds", mode="before")
    @classmethod
    def integers_only(cls, value):
        if type(value) is not int:
            raise ValueError("Room settings must be integer values.")
        return value

    @model_validator(mode="after")
    def bots_are_explicit_practice(self):
        if self.bots >= self.teamSize * 2:
            raise ValueError("Reserve at least one team slot for a human operator.")
        if self.mode == Mode.NETWORK_DRILL and self.bots:
            raise ValueError("Bots are available only in private Team Deathmatch practice.")
        return self


RequestId = Annotated[str, StringConstraints(min_length=1, max_length=40, pattern=r"^[\w-]+$")]
RoomCode = Annotated[str, StringConstraints(pattern=r"^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$")]
Primary = Literal["rifle", "smg", "shotgun", "dmr"]
Cosmetic = Literal["olive", "slate", "sand"]


class Command(StrictModel):
    requestId: RequestId


class CreateRoom(Command):
    type: Literal["create_room"]
    settings: RoomSettings = Field(default_factory=RoomSettings)


class QuickPlay(Command):
    type: Literal["quick_play"]
    mapId: MapId = "outpost"


class JoinRoom(Command):
    type: Literal["join_room"]
    code: RoomCode


class Ready(Command):
    type: Literal["ready"]
    ready: bool


class Start(Command):
    type: Literal["start"]


class ReturnLobby(Command):
    type: Literal["return_lobby"]


class Leave(Command):
    type: Literal["leave"]


class Reload(Command):
    type: Literal["reload"]


class SwitchWeapon(Command):
    type: Literal["switch_weapon"]
    slot: Literal[1, 2]

    @field_validator("slot", mode="before")
    @classmethod
    def integer_slot(cls, value):
        if type(value) is not int:
            raise ValueError("Weapon slot must be an integer.")
        return value


class ThrowGrenade(Command):
    type: Literal["grenade"]
    power: float = Field(default=0.85, ge=0.3, le=1.0, allow_inf_nan=False)
    targetX: float | None = Field(default=None, ge=-22, le=22, allow_inf_nan=False)
    targetZ: float | None = Field(default=None, ge=-22, le=22, allow_inf_nan=False)

    @model_validator(mode="after")
    def paired_target(self):
        if (self.targetX is None) != (self.targetZ is None):
            raise ValueError("Grenade target requires both ground coordinates.")
        return self


class RetryResults(Command):
    type: Literal["retry_results"]


class Input(StrictModel):
    type: Literal["input"]
    seq: int = Field(ge=0, le=2_147_483_647)
    moveX: float = Field(ge=-1, le=1, allow_inf_nan=False)
    moveZ: float = Field(ge=-1, le=1, allow_inf_nan=False)
    aim: float = Field(ge=-3.142, le=3.142, allow_inf_nan=False)
    pitch: float = Field(default=0.0, ge=-0.5, le=0.5, allow_inf_nan=False)
    sprint: bool
    trigger: bool = False
    ads: bool = False
    crouch: bool = False


class Pong(StrictModel):
    type: Literal["pong"]
    nonce: Annotated[str, StringConstraints(min_length=1, max_length=40)]


ClientMessage = Annotated[
    CreateRoom
    | QuickPlay
    | JoinRoom
    | Ready
    | Start
    | ReturnLobby
    | Leave
    | Reload
    | SwitchWeapon
    | ThrowGrenade
    | RetryResults
    | Input
    | Pong,
    Field(discriminator="type"),
]
MESSAGE_ADAPTER = TypeAdapter(ClientMessage)


@dataclass
class MatchStats:
    kills: int = 0
    deaths: int = 0
    assists: int = 0
    score: int = 0
    shots: int = 0
    hits: int = 0
    headshots: int = 0
    damage: float = 0.0
    weapon_shots: dict[str, int] = field(default_factory=dict)

    def public(self):
        return {
            "kills": self.kills,
            "deaths": self.deaths,
            "assists": self.assists,
            "score": self.score,
            "shots": self.shots,
            "hits": self.hits,
            "headshots": self.headshots,
            "damage": round(self.damage, 1),
        }


@dataclass
class Player:
    id: str
    name: str
    team: Team
    joined_at: float
    x: float
    z: float
    yaw: float
    connected: bool = True
    ready: bool = False
    status: PlayerStatus = PlayerStatus.LOBBY
    disconnected_at: float | None = None
    latency_ms: int | None = None
    move_x: float = 0.0
    move_z: float = 0.0
    sprint: bool = False
    input_at: float = -1e9
    input_seq: int = -1
    ack_seq: int = -1
    vx: float = 0.0
    vz: float = 0.0
    movement: str = "idle"
    primary: str = "rifle"
    cosmetic: str = "olive"
    level: int = 1
    is_bot: bool = False
    pitch: float = 0.0
    health: float = 100.0
    armor: float = 65.0
    weapons: dict[int, WeaponInstance] = field(default_factory=dict)
    active_slot: int = 1
    trigger: bool = False
    fire_latch: bool = False
    ads: bool = False
    ads_at: float = 0.0
    crouch: bool = False
    recoil_pitch: float = 0.0
    recoil_yaw: float = 0.0
    bloom: float = 0.0
    grenades: int = 2
    grenade_ready_at: float = 0.0
    throw_until: float = 0.0
    protected_until: float = 0.0
    respawn_at: float | None = None
    death_at: float | None = None
    life_id: int = 0
    active_seconds: float = 0.0
    disqualified: bool = False
    stats: MatchStats = field(default_factory=MatchStats)
    damage_by: dict[str, tuple[float, float]] = field(default_factory=dict)

    @property
    def alive(self):
        return self.connected and self.health > 0 and self.status == PlayerStatus.ALIVE

    def stop(self) -> None:
        self.move_x = self.move_z = self.vx = self.vz = 0.0
        self.sprint = self.trigger = self.fire_latch = self.ads = False
        self.movement = "idle"
        self.input_at = -1e9

    def public(self, combat=False) -> dict:
        data = {
            "id": self.id,
            "name": self.name,
            "team": self.team,
            "connected": self.connected,
            "ready": self.ready,
            "status": self.status,
            "latencyMs": self.latency_ms,
            "isBot": self.is_bot,
            "primary": self.primary,
            "cosmetic": self.cosmetic,
            "level": self.level,
            "stats": self.stats.public(),
        }
        return data

    def transform(self, now=0.0, combat=False) -> dict:
        data = {
            "id": self.id,
            "x": round(self.x, 3),
            "z": round(self.z, 3),
            "yaw": round(self.yaw, 3),
            "pitch": round(self.pitch, 3),
            "vx": round(self.vx, 3),
            "vz": round(self.vz, 3),
            "movement": self.movement,
            "ackSeq": self.ack_seq,
        }
        if combat:
            weapon = self.weapons.get(self.active_slot)
            state = WeaponStatus.DISABLED if not self.alive else WeaponStatus.EQUIPPED
            if weapon and self.alive:
                if weapon.reload_at is not None:
                    state = WeaponStatus.RELOADING
                elif now < weapon.ready_at:
                    state = WeaponStatus.SWITCHING
                elif now - weapon.last_fired_at < 0.095:
                    state = WeaponStatus.FIRING
                elif self.ads:
                    state = WeaponStatus.AIMING
            data["combat"] = {
                "health": round(self.health, 1),
                "armor": round(self.armor, 1),
                "slot": self.active_slot,
                "weaponId": weapon.id if weapon else self.primary,
                "weaponState": state,
                "magazine": weapon.magazine if weapon else 0,
                "reserve": weapon.reserve if weapon else 0,
                "reloadEndsAtMs": round(weapon.reload_at * 1000)
                if weapon and weapon.reload_at is not None
                else None,
                "reloadStartedAtMs": round(weapon.reload_started_at * 1000)
                if weapon and weapon.reload_started_at is not None
                else None,
                "readyAtMs": round(weapon.ready_at * 1000) if weapon else 0,
                "ads": self.ads,
                "crouch": self.crouch,
                "recoil": round(self.recoil_pitch, 4),
                "bloom": round(self.bloom, 4),
                "grenades": self.grenades,
                "protectedUntilMs": round(self.protected_until * 1000),
                "respawnAtMs": round(self.respawn_at * 1000)
                if self.respawn_at is not None
                else None,
                "throwUntilMs": round(self.throw_until * 1000),
                "deathAtMs": round(self.death_at * 1000) if self.death_at is not None else None,
            }
        return data


@dataclass
class Grenade:
    id: str
    owner_id: str
    x: float
    y: float
    z: float
    vx: float
    vy: float
    vz: float
    fuse_at: float
    target_x: float | None = None
    target_z: float | None = None
    landed: bool = False
    blocked: bool = False

    def public(self):
        return {
            "id": self.id,
            "ownerId": self.owner_id,
            "x": round(self.x, 3),
            "y": round(self.y, 3),
            "z": round(self.z, 3),
            "fuseAtMs": round(self.fuse_at * 1000),
            "target": {"x": self.target_x, "y": 0.09, "z": self.target_z}
            if self.target_x is not None
            else None,
            "landed": self.landed,
            "blocked": self.blocked,
        }


@dataclass
class Room:
    id: str
    code: str
    owner_id: str
    settings: RoomSettings
    created_at: float
    activity_at: float
    players: dict[str, Player] = field(default_factory=dict)
    phase: Phase = Phase.LOBBY
    phase_ends_at: float | None = None
    match_id: str | None = None
    revision: int = 0
    snapshot_seq: int = 0
    last_snapshot_at: float = -1e9
    public_room: bool = False
    event_seq: int = 0
    scores: dict[str, int] = field(default_factory=lambda: {"blue": 0, "red": 0})
    cover_health: dict[str, float] = field(default_factory=dict)
    destroyed: set[str] = field(default_factory=set)
    grenades: dict[str, Grenade] = field(default_factory=dict)
    killfeed: deque = field(default_factory=lambda: deque(maxlen=6))
    participants: dict[str, Player] = field(default_factory=dict)
    history: deque = field(default_factory=lambda: deque(maxlen=16))
    rng: random.Random = field(default_factory=random.Random)
    started_at: float | None = None
    results: dict | None = None
    forfeit_at: float | None = None
    forfeit_team: str | None = None
    award_task: object | None = None
    bot_brains: dict = field(default_factory=dict)
    team_contacts: dict = field(default_factory=lambda: {"blue": {}, "red": {}})

    @property
    def map_data(self):
        return get_map(self.settings.mapId)

    @property
    def capacity(self) -> int:
        return self.settings.teamSize * 2

    @property
    def combat_enabled(self):
        return self.settings.mode == Mode.TEAM_DEATHMATCH

    @property
    def practice(self):
        return self.settings.bots > 0

    def public(self) -> dict:
        return {
            "id": self.id,
            "code": self.code,
            "ownerId": self.owner_id,
            "settings": self.settings.model_dump(),
            "mapId": self.settings.mapId,
            "mode": self.settings.mode,
            "combatEnabled": self.combat_enabled,
            "publicRoom": self.public_room,
            "phase": self.phase,
            "phaseEndsAtMs": round(self.phase_ends_at * 1000)
            if self.phase_ends_at is not None
            else None,
            "matchId": self.match_id,
            "revision": self.revision,
            "players": [p.public(self.combat_enabled) for p in self.players.values()],
            "scores": dict(self.scores),
            "killfeed": list(self.killfeed),
            "results": self.results,
        }


class ArenaError(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message
