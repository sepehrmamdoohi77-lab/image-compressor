"""Combat gates: real authority math, no client-reported hits or health."""

import math
from dataclasses import dataclass

import pytest
from pydantic import ValidationError

from arena_server import config, physics, raycast
from arena_server.combat import CombatSystem
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
from arena_server.weapons import PRIMARY_WEAPONS, WEAPONS


@dataclass
class Clock:
    now: float = 100.0

    def __call__(self):
        return self.now


class Arena:
    def __init__(self, primary="rifle"):
        self.clock = Clock()
        self.events = []
        self.room = Room(
            "test-match",
            "ABC234",
            "a",
            RoomSettings(mode="TEAM_DEATHMATCH", teamSize=1, timeLimitSeconds=120),
            100,
            100,
        )
        self.room.phase = Phase.ACTIVE
        self.a = Player("a", "Alpha", Team.BLUE, 100, 0, 10, 0, primary=primary)
        self.b = Player("b", "Bravo", Team.RED, 100, 0, 14, math.pi)
        self.room.players = {"a": self.a, "b": self.b}
        self.room.participants = dict(self.room.players)
        self.room.rng.seed(5)
        self.combat = CombatSystem(
            self.clock, lambda room, event, **kwargs: self.events.append(event), lambda room: None
        )
        self.combat.prepare(self.room)
        self.room.phase = Phase.ACTIVE
        for p in self.room.players.values():
            p.status = PlayerStatus.ALIVE
            p.protected_until = 0
            p.input_at = self.clock.now
        self.a.yaw, self.b.yaw = 0, math.pi

    def fire(self, player=None, advance=0.3):
        p = player or self.a
        self.clock.now += advance
        p.input_at = self.clock.now
        p.trigger = p.fire_latch = True
        p.pitch = -p.recoil_pitch
        shot = self.combat.make_shot(self.room, p)
        if shot:
            self.combat.resolve_shot(self.room, shot)
        return shot


def test_authority_hits_body_reduces_real_armor_health_and_ammo():
    a = Arena()
    assert a.fire()
    assert a.a.weapons[1].magazine == 29
    assert 0 < a.b.health < 100 and 0 < a.b.armor < 65
    assert a.a.stats.shots == 1 and a.a.stats.hits == 1
    assert any(e["kind"] == "damage" and e["victimId"] == "b" for e in a.events)


@pytest.mark.parametrize("weapon", list(PRIMARY_WEAPONS) + ["pistol"])
def test_five_distinct_classes_use_authoritative_weapon_data(weapon):
    a = Arena(weapon if weapon != "pistol" else "rifle")
    if weapon == "pistol":
        a.combat.switch(a.room, a.a, 2)
        a.clock.now += 1
    a.b.z = 12
    assert a.fire()
    assert a.a.weapons[a.a.active_slot].magazine == WEAPONS[weapon]["magazineSize"] - 1
    assert a.b.health < 100


def test_fire_rate_cannot_be_bypassed_by_repeated_trigger_requests():
    a = Arena()
    assert a.fire(advance=0)
    for _ in range(100):
        assert a.fire(advance=0) is None
    assert a.a.weapons[1].magazine == 29 and a.a.stats.shots == 1


def test_empty_magazine_starts_timed_reload_never_instant_refill():
    a = Arena()
    a.a.weapons[1].magazine = 0
    assert a.fire() is None
    assert a.a.weapons[1].reload_at is not None
    assert a.a.weapons[1].magazine == 0
    a.a.trigger = False
    a.clock.now += WEAPONS["rifle"]["reloadSeconds"] - 0.01
    a.combat.tick(a.room, 1 / 30)
    assert a.a.weapons[1].magazine == 0
    a.clock.now += 0.02
    a.combat.tick(a.room, 1 / 30)
    assert a.a.weapons[1].magazine == 30 and a.a.weapons[1].reserve == 90


def test_switch_interrupts_reload_and_enforces_draw_time():
    a = Arena()
    a.a.weapons[1].magazine = 10
    a.combat.reload(a.room, a.a)
    a.combat.switch(a.room, a.a, 2)
    assert a.a.weapons[1].reload_at is None and a.a.weapons[1].magazine == 10
    assert a.fire(advance=0) is None
    assert a.fire(advance=0.25)
    assert a.a.weapons[2].magazine == 14


def test_fire_requires_alive_active_ammo_and_fresh_intent():
    a = Arena()
    a.a.status = PlayerStatus.DEAD
    assert a.fire() is None
    with pytest.raises(ArenaError, match="respawn"):
        a.combat.reload(a.room, a.a)
    a.a.status = PlayerStatus.ALIVE
    a.a.input_at = 0
    a.a.trigger = True
    assert a.combat.make_shot(a.room, a.a) is None
    a.room.phase = Phase.COUNTDOWN
    with pytest.raises(ArenaError, match="countdown"):
        a.combat.throw(a.room, a.a, 0.8)


def test_solid_walls_and_muzzle_obstruction_stop_damage():
    a = Arena()
    a.a.x, a.a.z = -4, 16
    a.b.x, a.b.z = -4, 13
    a.a.yaw = math.pi
    assert a.fire()
    assert a.b.health == 100
    assert a.a.stats.hits == 0
    # Move the muzzle right up to the wall: origin clipping still cannot shoot through it.
    a.a.z = 15.15
    assert a.fire()
    assert a.b.health == 100


def test_head_hit_derived_from_3d_geometry_not_client_report():
    a = Arena("dmr")
    a.a.pitch = math.atan2(1.65 - 1.21, 4)
    a.a.trigger = a.a.fire_latch = True
    a.a.input_at = a.clock.now
    shot = a.combat.make_shot(a.room, a.a)
    assert shot
    a.combat.resolve_shot(a.room, shot)
    assert a.b.health == 0 and a.b.status == PlayerStatus.DEAD
    assert a.a.stats.kills == a.a.stats.headshots == 1
    assert a.room.scores["blue"] == 1


def test_death_counted_once_respawn_safe_and_protection_ends_on_attack():
    a = Arena()
    a.combat.damage(a.room, a.a, a.b, 1000, "rifle", "body")
    a.combat.damage(a.room, a.a, a.b, 1000, "rifle", "body")
    assert a.b.stats.deaths == 1 and a.a.stats.kills == 1
    a.clock.now += config.RESPAWN_SECONDS + 0.01
    a.combat.tick(a.room, 1 / 30)
    assert a.b.health == 100 and a.b.armor == 65 and a.b.alive
    assert physics.valid_position(a.b.x, a.b.z)
    assert a.b.protected_until > a.clock.now
    old_health = a.b.health
    a.combat.damage(a.room, a.a, a.b, 100, "rifle", "body")
    assert a.b.health == old_health
    a.b.trigger = True
    a.b.input_at = a.clock.now
    assert a.combat.make_shot(a.room, a.b)
    assert a.b.protected_until == 0


def test_friendly_fire_is_authority_setting_not_client_damage():
    a = Arena()
    a.b.team = Team.BLUE
    assert a.combat.damage(a.room, a.a, a.b, 50, "rifle", "body") == 0
    a.room.settings.friendlyFire = True
    assert a.combat.damage(a.room, a.a, a.b, 50, "rifle", "body") > 0


def test_simultaneous_lethal_shots_award_both_without_order_advantage():
    a = Arena("dmr")
    a.b.primary = "dmr"
    a.combat.spawn(a.room, a.b, reposition=False)
    a.b.protected_until = 0
    a.b.yaw = math.pi
    a.a.health = a.b.health = 10
    for p in (a.a, a.b):
        p.trigger = p.fire_latch = True
        p.input_at = a.clock.now
    a.combat.tick(a.room, 1 / 30)
    assert a.a.health == a.b.health == 0
    assert a.a.stats.kills == a.b.stats.kills == 1
    assert a.room.scores == {"blue": 1, "red": 1}


def test_real_destructible_cover_changes_collision_and_line_of_sight():
    a = Arena()
    a.combat.cover_damage(a.room, "q01", 1000)
    assert "q01" in a.room.destroyed
    assert all(o["id"] != "q01" for o in a.combat.obstacles(a.room))
    assert any(e["kind"] == "cover_destroyed" for e in a.events)


def test_grenade_quantity_fuse_trajectory_damage_and_score_are_authoritative():
    a = Arena()
    grenade = a.combat.throw(a.room, a.a, 0.8)
    assert a.a.grenades == 1
    before = grenade.z
    a.clock.now += 0.1
    a.combat.grenade_system.tick(a.room, 0.1)
    assert grenade.z > before and grenade.y > 1.2
    # Set a trusted server-side regression fixture, never an exposed client operation.
    grenade.x, grenade.y, grenade.z = a.b.x, 0.3, a.b.z
    a.clock.now = grenade.fuse_at + 0.01
    a.combat.grenade_system.tick(a.room, 1 / 30)
    assert not a.room.grenades
    assert a.b.health == 0 and a.a.stats.kills == 1
    assert any(e["kind"] == "explosion" for e in a.events)


def test_visibility_filters_enemies_but_not_allies_and_drill_participants():
    a = Arena()
    a.a.x, a.a.z, a.b.x, a.b.z = -18.4, -15, -18.4, -2
    assert not raycast.visible(a.a, a.b, a.room)
    a.b.team = a.a.team
    assert raycast.visible(a.a, a.b, a.room)
    a.b.team = Team.RED
    a.room.settings.mode = "NETWORK_DRILL"
    assert raycast.visible(a.a, a.b, a.room)


@pytest.mark.parametrize(
    "extra",
    [
        {"damage": 999},
        {"health": 999},
        {"magazine": 999},
        {"hitPlayerId": "b"},
        {"score": 100},
        {"deltaTime": 999},
        {"weaponId": "dmr"},
    ],
)
def test_combat_intent_rejects_client_authority_values(extra):
    with pytest.raises(ValidationError):
        MESSAGE_ADAPTER.validate_python(
            {
                "type": "input",
                "seq": 1,
                "moveX": 0.0,
                "moveZ": 0.0,
                "aim": 0.0,
                "pitch": 0.0,
                "trigger": True,
                "sprint": False,
                **extra,
            }
        )


def test_head_body_arms_legs_are_distinct_server_hit_zones():
    a = Arena()
    target = a.b
    head = raycast.hit_zones((0, 1.65, 10), (0, 0, 1), target, 10)
    body = raycast.hit_zones((0, 1.2, 10), (0, 0, 1), target, 10)
    arm = raycast.hit_zones((0.36, 1.2, 10), (0, 0, 1), target, 10)
    leg = raycast.hit_zones((0.13, 0.45, 10), (0, 0, 1), target, 10)
    assert head[1] == "head" and body[1] == "body" and arm[1] == "arms" and leg[1] == "legs"


def test_rewind_never_targets_an_old_life_after_respawn():
    a = Arena()
    a.room.history.append(
        (99.9, {a.b.id: {"x": 99, "z": 99, "yaw": 0, "crouch": False, "lifeId": a.b.life_id - 1}})
    )
    assert raycast.rewind_pose(a.room, a.b, 99.8) is None


def test_grenade_full_cover_reduces_blast_instead_of_ignoring_walls():
    a = Arena()
    a.a.x, a.a.z = -4, 17
    a.b.x, a.b.z = -4, 13
    g = a.combat.throw(a.room, a.a, 0.8)
    g.x, g.y, g.z = -4, 0.3, 16
    a.clock.now = g.fuse_at + 0.01
    a.combat.grenade_system.tick(a.room, 1 / 30)
    assert 60 < a.b.health < 100  # Tall wall absorbs most blast; no wall-through instakill.
