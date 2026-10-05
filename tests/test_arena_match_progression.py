"""TDM rules, reconnect safety and real durable result receipts."""

import math
from dataclasses import dataclass, field

import pytest

from arena_server.models import MESSAGE_ADAPTER, ArenaError, Phase
from arena_server.rooms import RoomService
from arena_server.storage import ProfileRepository


@dataclass
class Peer:
    id: str
    name: str
    profile: dict
    room_code: str | None = None
    ping_nonce: str | None = None
    ping_sent_at: float = 100.0
    last_pong_at: float = 100.0
    messages: list = field(default_factory=list)

    def send(self, payload, **kwargs):
        self.messages.append(payload)


class Clock:
    now = 100.0

    def __call__(self):
        return self.now


class Fixture:
    def __init__(self, path):
        self.repo = ProfileRepository(path)
        self.repo.initialize()
        self.clock = Clock()
        profiles = [self.repo.save(name)[0] for name in ["Alpha", "Bravo"]]
        profiles[0] = self.repo.loadout(profiles[0]["id"], "dmr", "slate")
        self.service = RoomService(self.clock, self.repo)
        self.peers = [Peer(p["id"], p["name"], p) for p in profiles]
        for p in self.peers:
            self.service.attach(p)
        self.action(
            0,
            "create_room",
            settings={
                "mode": "TEAM_DEATHMATCH",
                "teamSize": 1,
                "scoreLimit": 1,
                "timeLimitSeconds": 120,
            },
        )
        self.room = self.service.rooms[self.peers[0].room_code]
        self.action(1, "join_room", code=self.room.code)
        self.action(0, "ready", ready=True)
        self.action(1, "ready", ready=True)
        self.action(0, "start")
        self.tick(3.01)
        self.tick(2.6)
        self.a, self.b = [self.room.players[p.id] for p in self.peers]
        self.a.x = self.b.x = -10.5
        self.a.z = 0
        self.b.z = -4
        self.room.history.clear()  # This trusted fixture relocation is not a client operation.
        self.room.rng.seed(5)

    def action(self, index, kind, **data):
        value = {"type": kind, **data}
        if kind not in ("input", "pong"):
            value["requestId"] = "test"
        self.service.handle(self.peers[index], MESSAGE_ADAPTER.validate_python(value))

    def tick(self, seconds=1 / 30):
        self.clock.now += seconds
        for p in self.service.peers.values():
            p.last_pong_at = self.clock.now
        self.service.tick(1 / 30)

    def win(self):
        self.action(
            0,
            "input",
            seq=1,
            moveX=0.0,
            moveZ=0.0,
            aim=math.pi,
            pitch=math.atan2(0.44, 4),
            sprint=False,
            trigger=True,
            ads=True,
        )
        self.tick()
        assert self.room.phase == Phase.ENDING


@pytest.mark.asyncio
async def test_completed_real_stats_xp_and_history_are_persisted_once(tmp_path):
    f = Fixture(tmp_path / "stats.db")
    f.win()
    assert f.room.scores == {"blue": 1, "red": 0}
    assert f.room.results["persistence"] == "saving"
    with pytest.raises(ArenaError, match="saved"):
        f.action(0, "return_lobby")
    await f.service.matches.drain()
    assert f.room.results["persistence"] == "saved"
    profile = f.repo.get_by_id(f.a.id)
    assert profile["stats"]["kills"] == 1 and profile["stats"]["headshots"] == 1
    assert profile["stats"]["shots"] == profile["stats"]["hits"] == 1
    assert profile["stats"]["wins"] == profile["stats"]["matches"] == 1
    assert profile["xp"] == 300 and profile["level"] == 2
    assert profile["favoriteWeapon"] == "dmr"
    assert profile["history"][0]["matchId"] == f.room.match_id
    loser = f.repo.get_by_id(f.b.id)
    assert loser["stats"]["losses"] == loser["stats"]["deaths"] == 1
    f.service.matches.save(f.room)
    await f.service.matches.drain()
    assert f.repo.get_by_id(f.a.id)["xp"] == 300
    assert f.repo.get_by_id(f.a.id)["stats"]["matches"] == 1
    f.tick(0.9)
    assert f.room.phase == Phase.RESULTS
    f.action(0, "return_lobby")
    assert f.room.phase == Phase.LOBBY


@pytest.mark.asyncio
async def test_save_failure_retry_never_double_awards(tmp_path, monkeypatch):
    f = Fixture(tmp_path / "retry.db")
    original = f.repo.award
    calls = 0

    def fail_second(*args):
        nonlocal calls
        calls += 1
        if calls == 2:
            raise OSError("Storage interrupted after first player receipt")
        return original(*args)

    monkeypatch.setattr(f.repo, "award", fail_second)
    f.win()
    await f.service.matches.drain()
    assert f.room.results["persistence"] == "error"
    assert f.repo.get_by_id(f.a.id)["xp"] == 300
    with pytest.raises(ArenaError, match="Retry"):
        f.action(0, "return_lobby")
    monkeypatch.setattr(f.repo, "award", original)
    f.action(0, "retry_results")
    await f.service.matches.drain()
    assert f.room.results["persistence"] == "saved"
    assert f.repo.get_by_id(f.a.id)["xp"] == 300
    assert f.repo.get_by_id(f.a.id)["stats"]["matches"] == 1
    assert f.repo.get_by_id(f.b.id)["stats"]["matches"] == 1


def test_reconnect_preserves_wounds_ammunition_and_death_state(tmp_path):
    f = Fixture(tmp_path / "reconnect.db")
    f.a.health = 27
    f.a.armor = 9
    f.a.weapons[1].magazine = 3
    f.a.weapons[1].reserve = 12
    f.service.detach(f.peers[0])
    replacement = Peer(f.a.id, f.a.name, f.peers[0].profile)
    f.service.attach(replacement)
    assert f.a.health == 27 and f.a.armor == 9
    assert f.a.weapons[1].magazine == 3 and f.a.weapons[1].reserve == 12
    f.service.combat.damage(f.room, f.b, f.a, 1000, "rifle", "body")
    f.service.detach(replacement)
    newer = Peer(f.a.id, f.a.name, f.peers[0].profile)
    f.service.attach(newer)
    assert f.a.health == 0 and f.a.status == "DEAD"


def test_private_owner_cannot_award_score_or_instant_ammo(tmp_path):
    f = Fixture(tmp_path / "cheats.db")
    for value in [
        {"type": "ready", "requestId": "x", "ready": True, "score": 100},
        {"type": "reload", "requestId": "x", "magazine": 999},
        {"type": "switch_weapon", "requestId": "x", "slot": True},
    ]:
        from pydantic import ValidationError

        with pytest.raises(ValidationError):
            MESSAGE_ADAPTER.validate_python(value)
    assert f.room.scores == {"blue": 0, "red": 0}


def test_ledger_survives_reinitialization_and_safe_identity_rename(tmp_path):
    repo = ProfileRepository(tmp_path / "migrate.db")
    repo.initialize()
    p, token = repo.save("Old Callsign")
    repo.loadout(p["id"], "smg", "sand")
    repo.initialize()
    renamed, same = repo.save("New Callsign", token)
    assert same == token and renamed["id"] == p["id"]
    assert renamed["loadout"]["primary"] == "smg" and renamed["loadout"]["cosmetic"] == "sand"
    assert renamed["stats"]["matches"] == 0


def test_quick_play_uses_real_public_rooms_balanced_humans_no_bots(tmp_path):
    repo = ProfileRepository(tmp_path / "quick.db")
    repo.initialize()
    clock = Clock()
    service = RoomService(clock, repo)
    peers = [
        Peer(p["id"], p["name"], p)
        for p in [repo.save("Quick Alpha")[0], repo.save("Quick Bravo")[0]]
    ]
    for peer in peers:
        service.attach(peer)
    service.handle(
        peers[0], MESSAGE_ADAPTER.validate_python({"type": "quick_play", "requestId": "a"})
    )
    room = service.rooms[peers[0].room_code]
    assert room.public_room and room.settings.bots == 0 and room.phase == Phase.LOBBY
    service.handle(
        peers[1], MESSAGE_ADAPTER.validate_python({"type": "quick_play", "requestId": "b"})
    )
    assert peers[0].room_code == peers[1].room_code
    assert room.phase == Phase.COUNTDOWN
    assert {p.team for p in room.players.values()} == {"blue", "red"}
    assert all(not p.is_bot for p in room.players.values())


@pytest.mark.asyncio
async def test_closed_room_result_save_does_not_resurrect_stale_membership(tmp_path):
    f = Fixture(tmp_path / "closed.db")
    f.win()
    f.action(0, "leave")
    f.action(1, "leave")
    assert not f.service.rooms
    await f.service.matches.drain()
    assert not f.service.rooms and not f.service.memberships
    assert f.repo.get_by_id(f.a.id)["stats"]["kills"] == 1
    assert f.peers[0].room_code is None


def test_living_players_collide_but_dead_bodies_do_not_block_movement(tmp_path):
    f = Fixture(tmp_path / "collisions.db")
    f.a.x = f.b.x = -10.6
    f.a.z = f.b.z = 0
    f.tick()
    assert math.hypot(f.a.x - f.b.x, f.a.z - f.b.z) >= 0.67
    f.b.health = 0
    f.b.status = "DEAD"
    f.b.respawn_at = f.clock.now + 10
    f.a.x = f.b.x
    f.a.z = f.b.z
    before = (f.a.x, f.a.z)
    f.tick()
    assert (f.a.x, f.a.z) == before


def test_room_join_waits_for_atomic_profile_preference_write(tmp_path):
    repo = ProfileRepository(tmp_path / "pending.db")
    repo.initialize()
    profile = repo.save("Pending Guest")[0]
    service = RoomService(Clock(), repo)
    peer = Peer(profile["id"], profile["name"], profile)
    service.attach(peer)
    service.profile_writes.add(peer.id)
    with pytest.raises(ArenaError, match="profile/loadout"):
        service.handle(
            peer, MESSAGE_ADAPTER.validate_python({"type": "create_room", "requestId": "new"})
        )
    assert not service.rooms
    service.profile_writes.clear()
    service.handle(
        peer, MESSAGE_ADAPTER.validate_python({"type": "create_room", "requestId": "okay"})
    )
    assert peer.room_code is not None
