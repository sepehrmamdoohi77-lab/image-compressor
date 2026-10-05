"""Ten physical arenas, range-safe targeting and authoritative map selection."""

import math
from dataclasses import dataclass, field

import pytest
from pydantic import ValidationError

from arena_server import config, physics
from arena_server.ai import Navigation
from arena_server.combat import CombatSystem
from arena_server.maps import MAP_IDS, MAPS
from arena_server.models import (
    MESSAGE_ADAPTER,
    ArenaError,
    Phase,
    Player,
    PlayerStatus,
    Room,
    RoomSettings,
    Team,
)
from arena_server.rooms import RoomService


@dataclass
class Clock:
    now: float = 100

    def __call__(self):
        return self.now


@dataclass
class Peer:
    id: str
    name: str
    room_code: str | None = None
    ping_nonce: str | None = None
    ping_sent_at: float = 100
    last_pong_at: float = 100
    messages: list = field(default_factory=list)

    def send(self, data, **kwargs):
        self.messages.append(data)


@pytest.mark.parametrize("identifier", MAP_IDS)
def test_each_map_has_distinct_physical_cover_safe_spawns_and_connected_routes(identifier):
    m = MAPS[identifier]
    assert m["id"] == identifier and len(m["obstacles"]) >= 9
    nav = Navigation(m["obstacles"])
    for team in Team:
        for i in range(4):
            x, z = physics.spawn(team, i, m)
            assert physics.valid_position(x, z, m["obstacles"])
    start = m["spawns"]["blue"][0]
    end = m["spawns"]["red"][0]
    assert nav.path(start["x"], start["z"], end["x"], end["z"]), identifier
    assert len({tuple(o[k] for k in ("x", "z", "w", "d", "h")) for o in m["obstacles"]}) == len(
        m["obstacles"]
    )


def test_ten_maps_are_not_relabelled_copies():
    signatures = {
        tuple(sorted((o["kind"], o["x"], o["z"], o["w"], o["d"], o["h"]) for o in m["obstacles"]))
        for m in MAPS.values()
    }
    assert len(MAPS) == len(signatures) == 10


def test_private_room_and_snapshot_use_chosen_map_without_global_geometry_switch():
    clock = Clock()
    s = RoomService(clock)
    a = Peer("a", "Alpha")
    b = Peer("b", "Bravo")
    s.attach(a)
    s.attach(b)
    s.handle(
        a,
        MESSAGE_ADAPTER.validate_python(
            {
                "type": "create_room",
                "requestId": "a",
                "settings": {"mapId": "dockyard", "mode": "TEAM_DEATHMATCH"},
            }
        ),
    )
    s.handle(
        b,
        MESSAGE_ADAPTER.validate_python(
            {
                "type": "create_room",
                "requestId": "b",
                "settings": {"mapId": "bunker", "mode": "TEAM_DEATHMATCH"},
            }
        ),
    )
    first, second = s.rooms[a.room_code], s.rooms[b.room_code]
    assert first.public()["mapId"] == "dockyard" and second.public()["mapId"] == "bunker"
    assert first.map_data is MAPS["dockyard"] and second.map_data is MAPS["bunker"]
    assert s.combat.obstacles(first) != s.combat.obstacles(second)
    assert config.MAP["id"] == "outpost"
    with pytest.raises(ValidationError):
        RoomSettings(mapId="fake-map")


def test_quick_play_never_matches_players_into_a_different_selected_map():
    s = RoomService(Clock())
    peers = [Peer(str(i), f"Operator {i}") for i in range(3)]
    for p in peers:
        s.attach(p)
    for p, m in zip(peers, ["courtyard", "market", "courtyard"], strict=True):
        s.handle(
            p,
            MESSAGE_ADAPTER.validate_python({"type": "quick_play", "requestId": p.id, "mapId": m}),
        )
    assert peers[0].room_code == peers[2].room_code
    assert peers[0].room_code != peers[1].room_code
    assert s.rooms[peers[0].room_code].settings.mapId == "courtyard"


def grenade_fixture():
    clock = Clock()
    room = Room(
        "r", "ABC234", "a", RoomSettings(mode="TEAM_DEATHMATCH", mapId="courtyard"), 100, 100
    )
    room.phase = Phase.ACTIVE
    p = Player("a", "Alpha", Team.BLUE, 100, -13, 18, math.pi, status=PlayerStatus.ALIVE)
    room.players = {"a": p}
    room.participants = {"a": p}
    combat = CombatSystem(clock, lambda *a, **k: None, lambda *a: None)
    combat.spawn(room, p, reposition=False)
    p.protected_until = 0
    return clock, room, p, combat


@pytest.mark.parametrize("target", [(-13, 16), (-13, 11), (-10, 12), (-13, 5)])
def test_cursor_target_is_actual_landing_point_on_clear_ballistic_path(target):
    clock, room, p, c = grenade_fixture()
    g = c.throw(room, p, 0.85, target)
    for _ in range(80):
        clock.now += 1 / 30
        c.grenade_system.tick(room, 1 / 30)
        if g.landed:
            break
    assert g.landed and not g.blocked
    assert math.hypot(g.x - target[0], g.z - target[1]) < 0.025
    assert g.y == pytest.approx(0.09)
    before = (g.x, g.z)
    for _ in range(3):
        clock.now += 1 / 30
        c.grenade_system.tick(room, 1 / 30)
    assert (g.x, g.z) == before


def test_unreachable_target_rejected_without_consuming_grenade_or_teleporting():
    _, room, p, c = grenade_fixture()
    with pytest.raises(ArenaError, match="32m"):
        c.throw(room, p, 0.85, (20, -18))
    assert p.grenades == 2 and not room.grenades
    with pytest.raises(ValidationError):
        MESSAGE_ADAPTER.validate_python({"type": "grenade", "requestId": "x", "targetX": 2.0})
    with pytest.raises(ValidationError):
        MESSAGE_ADAPTER.validate_python(
            {"type": "grenade", "requestId": "x", "targetX": float("nan"), "targetZ": 2.0}
        )


def sighting_fixture():
    clock = Clock()
    service = RoomService(clock)
    viewer, scout, enemy = [
        Peer(i, n) for i, n in [("viewer", "Viewer"), ("scout", "Scout"), ("enemy", "Enemy")]
    ]
    room = Room("r", "ABC234", viewer.id, RoomSettings(mode="TEAM_DEATHMATCH"), 100, 100)
    room.phase = Phase.ACTIVE
    room.players = {
        viewer.id: Player(
            viewer.id, viewer.name, Team.BLUE, 100, 21, 20, 0, status=PlayerStatus.ALIVE
        ),
        scout.id: Player(
            scout.id, scout.name, Team.BLUE, 100, -21, 20, 0, status=PlayerStatus.ALIVE
        ),
        enemy.id: Player(
            enemy.id, enemy.name, Team.RED, 100, -21, -20, 0, status=PlayerStatus.ALIVE
        ),
    }
    service.rooms[room.code] = room
    service.peers = {p.id: p for p in (viewer, scout, enemy)}
    return clock, service, room, viewer, scout, enemy


def test_full_map_clear_los_no_longer_hides_far_enemies_and_team_contact_is_explicit():
    _, service, room, viewer, scout, enemy = sighting_fixture()
    service.snapshot(room)
    assert enemy.id in {
        p["id"] for p in scout.messages[-1]["players"]
    }  # 40m, previously culled at 36m.
    assert enemy.id not in {
        p["id"] for p in viewer.messages[-1]["players"]
    }  # Solid-wall relevance still enforced.
    contact = viewer.messages[-1]["contacts"][0]
    assert contact["state"] == "team" and contact["id"] == enemy.id
    assert scout.messages[-1]["contacts"][0]["state"] == "visible"


def test_last_known_radar_never_tracks_a_hidden_moving_enemy_and_expires():
    clock, service, room, viewer, scout, enemy = sighting_fixture()
    service.snapshot(room)
    observed = dict(viewer.messages[-1]["contacts"][0])
    room.players[scout.id].connected = False
    room.players[enemy.id].z = -15  # Hidden from the remaining Blue viewer.
    clock.now += 1
    service.snapshot(room)
    remembered = viewer.messages[-1]["contacts"][0]
    assert remembered["state"] == "last"
    assert (remembered["x"], remembered["z"], remembered["seenAtMs"]) == (
        observed["x"],
        observed["z"],
        observed["seenAtMs"],
    )
    assert enemy.id not in {p["id"] for p in viewer.messages[-1]["players"]}
    clock.now += config.CONTACT_TTL
    service.snapshot(room)
    assert viewer.messages[-1]["contacts"] == []


def test_radar_drops_dead_disconnected_and_removed_targets():
    _, service, room, viewer, _, enemy = sighting_fixture()
    service.snapshot(room)
    room.players[enemy.id].health = 0
    service.snapshot(room)
    assert not viewer.messages[-1]["contacts"]
    room.players[enemy.id].health = 100
    service.snapshot(room)
    assert viewer.messages[-1]["contacts"]
    room.players[enemy.id].connected = False
    service.snapshot(room)
    assert not viewer.messages[-1]["contacts"]


def test_targeted_grenade_hits_and_bounces_from_cover_instead_of_teleporting_to_cursor():
    clock, room, player, combat = grenade_fixture()
    target = (-18.4, 9)
    grenade = combat.throw(room, player, 0.85, target)
    for _ in range(75):
        clock.now += 1 / 30
        combat.grenade_system.tick(room, 1 / 30)
    assert grenade.blocked
    assert math.hypot(grenade.x - target[0], grenade.z - target[1]) > 2
    assert grenade.public()["target"]["x"] == target[0]


@pytest.mark.parametrize("identifier", MAP_IDS)
def test_real_room_ticks_and_labelled_bot_navigation_run_against_each_selected_map(identifier):
    clock = Clock()
    service, peer = RoomService(clock), Peer("a", "Operator")
    service.attach(peer)
    service.handle(
        peer,
        MESSAGE_ADAPTER.validate_python(
            {
                "type": "create_room",
                "requestId": "c",
                "settings": {
                    "mapId": identifier,
                    "mode": "TEAM_DEATHMATCH",
                    "teamSize": 1,
                    "bots": 1,
                    "difficulty": "easy",
                },
            }
        ),
    )
    room = service.rooms[peer.room_code]
    service.handle(
        peer, MESSAGE_ADAPTER.validate_python({"type": "ready", "requestId": "r", "ready": True})
    )
    service.handle(peer, MESSAGE_ADAPTER.validate_python({"type": "start", "requestId": "s"}))
    clock.now += 3.01
    service.tick(1 / 30)
    assert room.phase == Phase.ACTIVE
    bot = next(p for p in room.players.values() if p.is_bot)
    initial = (bot.x, bot.z)
    for _ in range(180):
        clock.now += 1 / 30
        peer.last_pong_at = clock.now
        service.tick(1 / 30)
        for player in room.players.values():
            assert physics.valid_position(player.x, player.z, service.combat.obstacles(room))
    assert math.hypot(bot.x - initial[0], bot.z - initial[1]) > 0.5
    assert room.public()["mapId"] == identifier


def test_grenade_target_cannot_be_accepted_in_a_boundary_strip_that_physics_would_clip():
    _, room, player, combat = grenade_fixture()
    player.x, player.z = 19, 18
    with pytest.raises(ArenaError, match="inside"):
        combat.throw(room, player, 0.85, (21.91, 18))
    assert player.grenades == 2 and not room.grenades
