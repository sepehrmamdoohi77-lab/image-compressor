"""Deterministic authority, persistence, validation and mounted-transport coverage."""

import json
import math
import random
import sqlite3
from contextlib import asynccontextmanager
from dataclasses import dataclass, field

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from pydantic import ValidationError

from arena_server import config, physics
from arena_server.app import create_arena_app, origin_allowed
from arena_server.models import MESSAGE_ADAPTER, ArenaError, Phase, PlayerStatus, Team
from arena_server.rooms import RoomService
from arena_server.storage import COOKIE_NAME, ProfileRepository, validate_name


class Clock:
    def __init__(self):
        self.now = 100.0

    def __call__(self):
        return self.now


@dataclass
class TestPeer:
    __test__ = False
    id: str
    name: str
    room_code: str | None = None
    ping_nonce: str | None = None
    ping_sent_at: float = 100.0
    last_pong_at: float = 100.0
    messages: list = field(default_factory=list)

    def send(self, payload, snapshot=False, transient=False):
        self.messages.append(payload)


class Authority:
    def __init__(self, count=2, team_size=4):
        self.clock = Clock()
        self.service = RoomService(self.clock)
        self.peers = [TestPeer(f"player-{i}", f"Operator {i}") for i in range(count)]
        for peer in self.peers:
            self.service.attach(peer)
        self.command(
            self.peers[0], "create_room", settings={"teamSize": team_size, "timeLimitSeconds": 120}
        )
        self.room = self.service.rooms[self.peers[0].room_code]
        for peer in self.peers[1:]:
            self.command(peer, "join_room", code=self.room.code)

    def command(self, peer, kind, **data):
        value = {"type": kind, **data}
        if kind not in ("input", "pong"):
            value["requestId"] = "test"
        self.service.handle(peer, MESSAGE_ADAPTER.validate_python(value))

    def tick(self, seconds=1 / config.TICK_HZ):
        self.clock.now += seconds
        for peer in self.service.peers.values():
            peer.last_pong_at = self.clock.now
        self.service.tick(1 / config.TICK_HZ)

    def active(self):
        for peer in self.peers:
            self.command(peer, "ready", ready=True)
        self.command(self.peers[0], "start")
        self.tick(config.COUNTDOWN_SECONDS + 0.01)
        assert self.room.phase == Phase.ACTIVE


@pytest.mark.parametrize(
    "extra", [{"x": 999}, {"health": 999}, {"team": "red"}, {"score": 50}, {"damage": 100}]
)
def test_client_cannot_write_authority_fields(extra):
    with pytest.raises(ValidationError):
        MESSAGE_ADAPTER.validate_python(
            {
                "type": "input",
                "seq": 1,
                "moveX": 0.0,
                "moveZ": 0.0,
                "aim": 0.0,
                "sprint": False,
                **extra,
            }
        )


@pytest.mark.parametrize("value", [float("nan"), float("inf"), -2.0, 2.0, "1", True])
def test_input_rejects_invalid_axes(value):
    with pytest.raises(ValidationError):
        MESSAGE_ADAPTER.validate_python(
            {"type": "input", "seq": 1, "moveX": value, "moveZ": 0.0, "aim": 0.0, "sprint": False}
        )


def test_balanced_configurable_capacity_and_code_generation():
    a = Authority(count=8)
    assert len(a.room.players) == 8
    assert sum(p.team == Team.BLUE for p in a.room.players.values()) == 4
    assert sum(p.team == Team.RED for p in a.room.players.values()) == 4
    assert len(a.room.code) == 6 and set(a.room.code) <= set(config.CODE_ALPHABET)
    extra = TestPeer("extra", "Extra operator")
    a.service.attach(extra)
    with pytest.raises(ArenaError, match="Room is full"):
        a.command(extra, "join_room", code=a.room.code)
    assert extra.id not in a.service.memberships
    b = Authority(count=2, team_size=1)
    assert b.room.capacity == 2


def test_only_owner_starts_with_all_connected_players_ready():
    a = Authority()
    with pytest.raises(ArenaError, match="Only the room owner"):
        a.command(a.peers[1], "start")
    with pytest.raises(ArenaError, match="must be ready"):
        a.command(a.peers[0], "start")
    a.command(a.peers[0], "ready", ready=True)
    with pytest.raises(ArenaError, match="must be ready"):
        a.command(a.peers[0], "start")
    a.command(a.peers[1], "ready", ready=True)
    a.command(a.peers[0], "start")
    assert a.room.phase == Phase.COUNTDOWN
    original = a.room.players[a.peers[0].id].z
    a.command(a.peers[0], "input", seq=1, moveX=0.0, moveZ=-1.0, aim=0.0, sprint=True)
    a.tick()
    assert a.room.players[a.peers[0].id].z == original


def test_single_operator_cannot_start():
    a = Authority(count=1)
    a.command(a.peers[0], "ready", ready=True)
    with pytest.raises(ArenaError, match="each team"):
        a.command(a.peers[0], "start")


def test_server_speed_diagonal_normalization_and_stale_input():
    a = Authority()
    a.active()
    p = a.room.players[a.peers[0].id]
    p.x, p.z = 0, 18
    start = p.x, p.z
    for i in range(config.TICK_HZ):
        a.command(a.peers[0], "input", seq=i, moveX=1.0, moveZ=1.0, aim=0.5, sprint=False)
        a.tick()
    assert math.hypot(p.x - start[0], p.z - start[1]) <= config.WALK_SPEED + 0.001
    a.command(a.peers[0], "input", seq=0, moveX=-1.0, moveZ=-1.0, aim=-1.0, sprint=True)
    assert p.yaw == pytest.approx(0.5) and p.sprint is False
    old = p.x, p.z
    a.tick(config.INPUT_TIMEOUT + 0.01)
    assert (p.x, p.z) == old
    assert p.movement == "idle"


def test_fixed_tick_motion_cannot_be_accelerated_by_input_flood():
    a = Authority()
    a.active()
    p = a.room.players[a.peers[0].id]
    x = p.x
    for seq in range(2000):
        a.command(a.peers[0], "input", seq=seq, moveX=1.0, moveZ=0.0, aim=0.0, sprint=True)
    assert p.x == x
    a.tick()
    assert p.x - x == pytest.approx(config.SPRINT_SPEED / config.TICK_HZ)


def test_collision_and_boundary_safety_random_walks():
    rng = random.Random(52)
    for team in Team:
        x, z = physics.spawn(team, 0)
        for _ in range(8000):
            theta = rng.uniform(-math.pi, math.pi)
            dx = math.sin(theta) * config.SPRINT_SPEED / config.TICK_HZ
            dz = math.cos(theta) * config.SPRINT_SPEED / config.TICK_HZ
            x, z = physics.move(x, z, dx, dz)
            assert physics.valid_position(x, z), (x, z)
    x, z = -4, 18
    for _ in range(100):
        x, z = physics.move(x, z, 0, -config.SPRINT_SPEED / config.TICK_HZ)
    assert z == pytest.approx(15.14)  # Full wall, no tunnelling.


def test_disconnect_stops_movement_migrates_owner_and_reconnect_restores_slot():
    a = Authority()
    a.active()
    original = a.room.players[a.peers[0].id]
    team, x, z = original.team, original.x, original.z
    a.service.detach(a.peers[0])
    assert original.status == PlayerStatus.DISCONNECTED
    assert not original.ready and original.move_x == 0
    assert a.room.owner_id == a.peers[1].id
    returning = TestPeer(a.peers[0].id, a.peers[0].name)
    a.service.attach(returning)
    assert a.room.players[returning.id] is original
    assert original.connected and (original.team, original.x, original.z) == (team, x, z)
    assert any(m["type"] == "snapshot" for m in returning.messages)
    assert a.room.owner_id == a.peers[1].id  # Reconnect cannot steal ownership.


def test_disconnect_during_countdown_returns_to_lobby():
    a = Authority()
    for peer in a.peers:
        a.command(peer, "ready", ready=True)
    a.command(a.peers[0], "start")
    a.service.detach(a.peers[1])
    assert a.room.phase == Phase.LOBBY and a.room.phase_ends_at is None
    assert not any(p.ready for p in a.room.players.values())


def test_expired_reconnect_and_last_player_leave_clean_room():
    a = Authority()
    a.service.detach(a.peers[0])
    a.tick(config.RECONNECT_GRACE + 0.01)
    assert a.peers[0].id not in a.room.players
    assert a.peers[0].id not in a.service.memberships
    a.command(a.peers[1], "leave")
    assert not a.service.rooms and not a.service.memberships


def test_duplicate_identity_is_rejected_without_replacing_connection():
    a = Authority()
    with pytest.raises(ArenaError, match="already connected"):
        a.service.attach(TestPeer(a.peers[0].id, "Duplicate"))
    assert a.service.peers[a.peers[0].id] is a.peers[0]


def test_timer_is_authoritative_and_results_do_not_invent_rewards():
    a = Authority()
    a.active()
    a.tick(a.room.settings.timeLimitSeconds + 0.01)
    assert a.room.phase == Phase.ENDING
    a.tick(0.61)
    assert a.room.phase == Phase.RESULTS
    data = a.room.public()
    assert "xp" not in json.dumps(data).lower()
    assert data["combatEnabled"] is False
    a.command(a.peers[0], "return_lobby")
    assert a.room.phase == Phase.LOBBY
    assert all(not p.ready for p in a.room.players.values())


def test_late_join_receives_current_match_and_transforms():
    a = Authority()
    a.active()
    late = TestPeer("late-player", "Late operator")
    a.service.attach(late)
    a.command(late, "join_room", code=a.room.code)
    states = [m for m in late.messages if m["type"] == "room_state"]
    assert states[-1]["room"]["phase"] == Phase.ACTIVE
    assert states[-1]["room"]["matchId"] == a.room.match_id
    assert states[-1]["room"]["phaseEndsAtMs"] == round(a.room.phase_ends_at * 1000)
    snapshots = [m for m in late.messages if m["type"] == "snapshot"]
    assert len(snapshots[-1]["players"]) == 3


def test_unknown_room_and_idle_room_expiration():
    a = Authority(count=1)
    extra = TestPeer("other", "Other operator")
    a.service.attach(extra)
    with pytest.raises(ArenaError, match="Room not found"):
        a.command(extra, "join_room", code="ABC234")
    a.tick(config.ROOM_IDLE_SECONDS + 0.01)
    assert not a.service.rooms and not a.service.memberships
    assert any(m["type"] == "room_closed" for m in a.peers[0].messages)


@pytest.mark.parametrize("name", ["", "a", "  ", "<script>alert(1)</script>", "x" * 21, "☢☢☢"])
def test_invalid_names_are_rejected(name):
    with pytest.raises(ValueError):
        validate_name(name)


def test_profile_cookie_hash_persistence_and_safe_rename(tmp_path):
    path = tmp_path / "profiles.db"
    repository = ProfileRepository(path)
    repository.initialize()
    first, token = repository.save("Operator One")
    assert repository.get(token) == first
    assert repository.get("wrong-token") is None
    reloaded = ProfileRepository(path)
    reloaded.initialize()
    saved, same_token = reloaded.save("Operator Renamed", token)
    assert saved["id"] == first["id"] and saved["createdAt"] == first["createdAt"]
    assert same_token == token
    with sqlite3.connect(path) as db:
        rows = db.execute("SELECT token_hash FROM guest_sessions").fetchall()
        assert token not in repr(rows) and len(rows[0][0]) == 64


def test_same_origin_validation():
    assert origin_allowed("https://5173-example.e2b.app", "5173-example.e2b.app")
    assert not origin_allowed("https://evil.test", "5173-example.e2b.app")
    assert not origin_allowed("null", "example.test")
    assert not origin_allowed("https://user:pass@example.test", "example.test")


@pytest.fixture
def mounted_app(tmp_path):
    arena = create_arena_app(tmp_path / "arena.sqlite3")

    @asynccontextmanager
    async def lifespan(_):
        await arena.state.startup()
        try:
            yield
        finally:
            await arena.state.shutdown()

    parent = FastAPI(lifespan=lifespan)
    parent.mount("/arena", arena)
    return parent, arena


def receive_until(ws, predicate):
    for _ in range(100):
        data = ws.receive_json()
        if data["type"] == "ping":
            ws.send_json({"type": "pong", "nonce": data["nonce"]})
        if predicate(data):
            return data
    pytest.fail("Expected server event was not received")


def test_real_mounted_websocket_identity_room_join_and_validation(mounted_app):
    app, arena = mounted_app
    with TestClient(app) as first:
        second = TestClient(app)
        a = first.post("/arena/api/session", json={"name": "Alpha"})
        b = second.post("/arena/api/session", json={"name": "Bravo"})
        assert a.status_code == b.status_code == 200
        assert "httponly" in a.headers["set-cookie"].lower()
        assert COOKIE_NAME in first.cookies
        assert a.json()["profile"]["id"] != b.json()["profile"]["id"]
        with (
            first.websocket_connect("/arena/ws") as wa,
            second.websocket_connect("/arena/ws") as wb,
        ):
            receive_until(wa, lambda m: m["type"] == "welcome")
            receive_until(wb, lambda m: m["type"] == "welcome")
            wa.send_json(
                {
                    "type": "create_room",
                    "requestId": "create",
                    "settings": {"teamSize": 4, "timeLimitSeconds": 120},
                }
            )
            room = receive_until(wa, lambda m: m["type"] == "room_state" and m["room"] is not None)[
                "room"
            ]
            wb.send_json({"type": "join_room", "requestId": "join", "code": room["code"]})
            both_a = receive_until(
                wa,
                lambda m: (
                    m["type"] == "room_state"
                    and m["room"] is not None
                    and len(m["room"]["players"]) == 2
                ),
            )
            both_b = receive_until(
                wb,
                lambda m: (
                    m["type"] == "room_state"
                    and m["room"] is not None
                    and len(m["room"]["players"]) == 2
                ),
            )
            assert both_a["room"]["players"] == both_b["room"]["players"]
            wb.send_json(
                {
                    "type": "input",
                    "seq": 1,
                    "moveX": 0.0,
                    "moveZ": 0.0,
                    "aim": 0.0,
                    "sprint": False,
                    "health": 999,
                }
            )
            invalid = receive_until(wb, lambda m: m["type"] == "error")
            assert invalid["code"] == "INVALID_MESSAGE"
            wb.send_json({"type": "start", "requestId": "unauthorized"})
            assert receive_until(wb, lambda m: m["type"] == "error")["code"] == "OWNER_ONLY"
            assert (
                first.post("/arena/api/session", json={"name": "Rename In Room"}).status_code == 409
            )
            wa.send_json({"type": "leave", "requestId": "leave"})
            state = receive_until(
                wb,
                lambda m: (
                    m["type"] == "room_state"
                    and m["room"] is not None
                    and len(m["room"]["players"]) == 1
                ),
            )
            assert state["room"]["ownerId"] == b.json()["profile"]["id"]
            wb.send_json({"type": "leave", "requestId": "leave-b"})
            receive_until(wb, lambda m: m["type"] == "ack" and m["requestId"] == "leave-b")
            assert not arena.state.rooms.rooms


def test_http_and_websocket_authentication_errors(mounted_app):
    app, _ = mounted_app
    with TestClient(app) as client:
        assert client.get("/arena/api/session").json() == {"profile": None, "roomCode": None}
        assert client.post("/arena/api/session", json={"name": "<img>"}).status_code == 422
        assert (
            client.post(
                "/arena/api/session",
                json={"name": "Alpha"},
                headers={"Origin": "https://evil.test"},
            ).status_code
            == 403
        )
        with client.websocket_connect("/arena/ws") as ws:
            assert ws.receive_json()["code"] == "AUTH_REQUIRED"
        assert client.get("/arena/api/config").json()["combatEnabled"] is True
        assert "NETWORK_DRILL" in client.get("/arena/api/config").json()["supportedModes"]
        assert client.get("/arena/api/health").json()["status"] == "available"


def test_callsign_is_unique_inside_room():
    a = Authority()
    duplicate = TestPeer("duplicate-name", a.peers[0].name.upper())
    a.service.attach(duplicate)
    with pytest.raises(ArenaError, match="already uses that callsign"):
        a.command(duplicate, "join_room", code=a.room.code)
    assert duplicate.id not in a.service.memberships


def test_malformed_origin_is_rejected_without_exception():
    assert not origin_allowed("http://[", "example.test")


def test_snapshot_backpressure_is_bounded():
    from arena_server.peers import Peer

    peer = Peer(None, {"id": "test", "name": "Queue Test"}, 100)
    for seq in range(1000):
        peer.send({"type": "snapshot", "seq": seq}, snapshot=True)
    assert len(peer.events) == 0
    assert json.loads(peer.latest_snapshot)["seq"] == 999
    for seq in range(33):
        peer.send({"type": "ack", "requestId": str(seq)})
    assert len(peer.events) == 32 and peer.overflowed


def test_binary_socket_frame_closes_cleanly(mounted_app):
    from starlette.websockets import WebSocketDisconnect

    app, _ = mounted_app
    with TestClient(app) as client:
        client.post("/arena/api/session", json={"name": "Binary Test"})
        with client.websocket_connect("/arena/ws") as ws:
            receive_until(ws, lambda m: m["type"] == "welcome")
            ws.send_bytes(b"not-a-text-command")
            with pytest.raises(WebSocketDisconnect) as error:
                while True:
                    ws.receive_json()
            assert error.value.code == 1003


@pytest.mark.parametrize("value", [True, 1.0, "4"])
def test_room_settings_do_not_coerce_client_types(value):
    from arena_server.models import RoomSettings

    with pytest.raises(ValidationError):
        RoomSettings(teamSize=value)


@pytest.mark.asyncio
async def test_authority_exception_closes_rooms_instead_of_claiming_success(caplog):
    import time

    a = Authority()
    a.service.clock = time.monotonic

    def broken_tick(_):
        raise RuntimeError("Forced authority failure for regression coverage")

    a.service.tick = broken_tick
    await a.service.start()
    import asyncio

    await asyncio.wait_for(a.service.task, timeout=1)
    assert not a.service.running and not a.service.rooms and not a.service.memberships
    assert "closing every match" in caplog.text
    assert any(m["type"] == "room_closed" for m in a.peers[0].messages)
    with pytest.raises(ArenaError, match="unavailable"):
        a.service.attach(TestPeer("new", "New operator"))
    await a.service.stop()


def test_https_guest_cookie_is_secure_http_only_and_preview_partitioned(mounted_app):
    app, _ = mounted_app
    with TestClient(app, base_url="https://testserver") as client:
        response = client.post("/arena/api/session", json={"name": "HTTPS Guest"})
        assert response.status_code == 200
        cookie = response.headers["set-cookie"].lower()
        assert "httponly" in cookie and "secure" in cookie
        assert "samesite=none" in cookie and "partitioned" in cookie
        assert client.get("/arena/api/session").json()["profile"]["name"] == "HTTPS Guest"


def test_dedicated_game_landing_is_opt_in_and_preserves_legacy_root(monkeypatch):
    from main import home

    monkeypatch.delenv("ARENA_AS_HOME", raising=False)
    assert isinstance(home(), str)
    monkeypatch.setenv("ARENA_AS_HOME", "1")
    from pathlib import Path

    from fastapi import HTTPException

    bundle = Path("tactical-arena/dist/index.html")
    if bundle.exists():
        assert str(home().path).endswith("tactical-arena/dist/index.html")
    else:
        with pytest.raises(HTTPException):
            home()
