import math
from dataclasses import dataclass, field

from arena_server import config, physics
from arena_server.ai import DIFFICULTY, Navigation
from arena_server.models import MESSAGE_ADAPTER, Phase
from arena_server.rooms import RoomService


@dataclass
class Peer:
    id: str = "00000000-0000-4000-8000-000000000001"
    name: str = "Human Operator"
    room_code: str | None = None
    ping_nonce: str | None = None
    ping_sent_at: float = 100
    last_pong_at: float = 100
    messages: list = field(default_factory=list)

    def send(self, payload, **kwargs):
        self.messages.append(payload)


class Clock:
    now = 100.0

    def __call__(self):
        return self.now


def practice(bots=1, difficulty="easy", size=1):
    clock = Clock()
    service = RoomService(clock)
    peer = Peer()
    service.attach(peer)
    service.handle(
        peer,
        MESSAGE_ADAPTER.validate_python(
            {
                "type": "create_room",
                "requestId": "create",
                "settings": {
                    "mode": "TEAM_DEATHMATCH",
                    "teamSize": size,
                    "bots": bots,
                    "difficulty": difficulty,
                    "scoreLimit": 10,
                    "timeLimitSeconds": 120,
                },
            }
        ),
    )
    room = service.rooms[peer.room_code]
    return clock, service, peer, room


def active(clock, service, peer):
    service.handle(
        peer, MESSAGE_ADAPTER.validate_python({"type": "ready", "requestId": "r", "ready": True})
    )
    service.handle(peer, MESSAGE_ADAPTER.validate_python({"type": "start", "requestId": "s"}))
    clock.now += 3.01
    peer.last_pong_at = clock.now
    service.tick(1 / 30)


def test_bots_are_explicit_server_entities_not_fake_online_sessions():
    _, service, peer, room = practice()
    assert len(service.peers) == 1 and len(room.players) == 2
    bot = next(p for p in room.players.values() if p.is_bot)
    assert bot.name.startswith("BOT ") and bot.latency_ms is None
    assert bot.id not in service.peers and bot.id not in service.memberships
    assert room.practice and room.settings.bots == 1
    metadata = room.public()["players"]
    assert sum(p["isBot"] for p in metadata) == 1
    assert room.owner_id == peer.id


def test_private_practice_can_start_with_one_human_and_ready_bot():
    clock, service, peer, room = practice()
    active(clock, service, peer)
    assert room.phase == Phase.ACTIVE
    assert len(room.participants) == 2


def test_seven_bots_fit_4v4_and_cleanup_when_last_human_leaves():
    _, service, peer, room = practice(7, "normal", 4)
    assert len(room.players) == 8
    assert sum(p.team == "blue" for p in room.players.values()) == 4
    assert sum(p.team == "red" for p in room.players.values()) == 4
    service.handle(peer, MESSAGE_ADAPTER.validate_python({"type": "leave", "requestId": "leave"}))
    assert not service.rooms and not service.memberships


def test_difficulty_changes_reaction_accuracy_awareness_not_weapon_damage():
    assert (
        DIFFICULTY["easy"]["reaction"]
        > DIFFICULTY["normal"]["reaction"]
        > DIFFICULTY["hard"]["reaction"]
    )
    assert DIFFICULTY["easy"]["aimError"] > DIFFICULTY["hard"]["aimError"]
    assert DIFFICULTY["hard"]["awareness"] > DIFFICULTY["easy"]["awareness"]
    assert all("damage" not in settings for settings in DIFFICULTY.values())


def test_astar_has_valid_floor_and_no_corner_cutting():
    nav = Navigation(config.MAP["obstacles"])
    path = nav.path(-4, 18, -10.4, -10)
    assert path and len(path) > 10
    previous = nav.cell(-4, 18)
    for x, z in path:
        assert physics.valid_position(x, z)
        cell = nav.cell(x, z)
        dx, dz = cell[0] - previous[0], cell[1] - previous[1]
        if dx and dz:
            assert (previous[0] + dx, previous[1]) in nav.walkable
            assert (previous[0], previous[1] + dz) in nav.walkable
        previous = cell


def test_bot_moves_with_server_collision_and_attacks_through_same_combat_validation():
    clock, service, peer, room = practice()
    active(clock, service, peer)
    human = room.players[peer.id]
    bot = next(p for p in room.players.values() if p.is_bot)
    human.x = bot.x = -10.6
    human.z = 0
    bot.z = -6
    human.protected_until = bot.protected_until = 0
    room.history.clear()
    room.rng.seed(8)
    initial = (bot.x, bot.z)
    for _ in range(150):
        clock.now += 1 / 30
        peer.last_pong_at = clock.now
        service.tick(1 / 30)
        assert physics.valid_position(bot.x, bot.z, service.combat.obstacles(room))
    assert bot.stats.shots > 0
    assert any(
        m.get("type") == "combat_event"
        and m["event"]["kind"] == "damage"
        and m["event"]["victimId"] == human.id
        for m in peer.messages
    )
    assert math.isfinite(bot.x) and bot.health <= 100
    assert initial != (-4, 18)


def test_bot_reaction_delay_is_real_not_instant_omniscient_fire():
    clock, service, peer, room = practice()
    active(clock, service, peer)
    human = room.players[peer.id]
    bot = next(p for p in room.players.values() if p.is_bot)
    human.x = bot.x = -10.6
    human.z = 0
    bot.z = -5
    bot.yaw = 0
    human.protected_until = bot.protected_until = 0
    room.history.clear()
    for _ in range(6):
        clock.now += 1 / 30
        peer.last_pong_at = clock.now
        service.tick(1 / 30)
    assert bot.stats.shots == 0
    for _ in range(30):
        clock.now += 1 / 30
        peer.last_pong_at = clock.now
        service.tick(1 / 30)
    assert bot.stats.shots > 0


def test_practice_results_never_invent_account_xp():
    clock, service, peer, room = practice()
    active(clock, service, peer)
    human = room.players[peer.id]
    human.stats.kills = 2
    human.active_seconds = 100
    service.matches.finish(room, "blue", "score_limit")
    assert room.results["practice"] and room.results["persistence"] == "not_required"
    assert all(p["xpEarned"] == 0 and not p["eligible"] for p in room.results["players"])
