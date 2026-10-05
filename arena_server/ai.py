"""Explicit server bots with perception, A* navigation, cover and flank decisions.

Bots are never sockets, are always labelled, and use the SAME combat/collision
validation as humans. Difficulty changes reaction/aim/tactics, never damage.
"""

import heapq
import json
import math
import uuid
from contextlib import suppress
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path

from . import physics, raycast
from .models import ArenaError, Player, PlayerStatus, Team
from .weapons import WEAPONS

DIFFICULTY = json.loads((Path(__file__).parent / "data/ai.json").read_text())


class Navigation:
    step = 0.8
    origin = -21.6
    width = 55

    def __init__(self, volumes):
        self.walkable = {
            (i, j)
            for i in range(self.width)
            for j in range(self.width)
            if physics.valid_position(
                self.origin + i * self.step, self.origin + j * self.step, volumes
            )
        }

    def point(self, cell):
        return self.origin + cell[0] * self.step, self.origin + cell[1] * self.step

    def cell(self, x, z):
        desired = (
            max(0, min(self.width - 1, round((x - self.origin) / self.step))),
            max(0, min(self.width - 1, round((z - self.origin) / self.step))),
        )
        if desired in self.walkable:
            return desired
        return min(self.walkable, key=lambda c: (c[0] - desired[0]) ** 2 + (c[1] - desired[1]) ** 2)

    def path(self, x, z, tx, tz):
        start, goal = self.cell(x, z), self.cell(tx, tz)
        if start == goal:
            return [self.point(goal)]
        queue = [(0.0, start)]
        cost = {start: 0.0}
        parent = {}
        visits = 0
        while queue and visits < 2500:
            _, node = heapq.heappop(queue)
            visits += 1
            if node == goal:
                chain = [goal]
                while chain[-1] != start:
                    chain.append(parent[chain[-1]])
                return [self.point(c) for c in reversed(chain[:-1])]
            for dx, dz in ((1, 0), (-1, 0), (0, 1), (0, -1), (1, 1), (1, -1), (-1, 1), (-1, -1)):
                next_node = (node[0] + dx, node[1] + dz)
                if next_node not in self.walkable:
                    continue
                if (
                    dx
                    and dz
                    and (
                        (node[0] + dx, node[1]) not in self.walkable
                        or (node[0], node[1] + dz) not in self.walkable
                    )
                ):
                    continue
                new_cost = cost[node] + (1.4142 if dx and dz else 1)
                if new_cost >= cost.get(next_node, 1e9):
                    continue
                parent[next_node] = node
                cost[next_node] = new_cost
                heuristic = math.hypot(goal[0] - next_node[0], goal[1] - next_node[1])
                heapq.heappush(queue, (new_cost + heuristic, next_node))
        return []


@lru_cache(maxsize=10)
def base_navigation(map_id="outpost"):
    from .maps import get_map

    return Navigation(get_map(map_id)["obstacles"])


@dataclass
class Brain:
    state: str = "patrol"
    target: str | None = None
    last_known: tuple | None = None
    seen_at: float = -1e9
    react_at: float = 0
    think_at: float = 0
    path_at: float = 0
    grenade_at: float = 0
    reposition_at: float = 0
    goal: tuple | None = None
    path: list = field(default_factory=list)
    life_id: int = -1
    aim_error: float = 0.0
    patrol_index: int = 0


class BotSystem:
    def __init__(self, clock, combat):
        self.clock, self.combat = clock, combat
        self.nav_cache = {}
        self.base_navigation = base_navigation()

    def populate(self, room):
        names = ("Viper", "Rook", "Hawk", "Falcon", "Echo", "Nomad", "Kestrel")
        for i in range(room.settings.bots):
            counts = {team: sum(p.team == team for p in room.players.values()) for team in Team}
            team = Team.BLUE if counts[Team.BLUE] <= counts[Team.RED] else Team.RED
            x, z = physics.spawn(team, counts[team], room.map_data)
            bot = Player(
                str(uuid.uuid4()),
                f"BOT {names[i]}",
                team,
                self.clock(),
                x,
                z,
                math.pi if team == Team.BLUE else 0,
                ready=True,
                status=PlayerStatus.READY,
                is_bot=True,
                primary=("rifle", "smg", "shotgun", "dmr")[i % 4],
            )
            room.players[bot.id] = bot
            room.bot_brains[bot.id] = Brain(think_at=self.clock() + i * 0.035, patrol_index=i % 3)

    def navigation(self, room):
        if not room.destroyed:
            return base_navigation(room.settings.mapId)
        fingerprint = tuple(sorted(room.destroyed))
        cached = self.nav_cache.get(room.id)
        if cached and cached[0] == fingerprint:
            return cached[1]
        nav = Navigation(self.combat.obstacles(room))
        self.nav_cache[room.id] = (fingerprint, nav)
        return nav

    def cleanup(self, room):
        self.nav_cache.pop(room.id, None)

    def take_cover(self, room, bot, target):
        candidates = []
        for o in self.combat.obstacles(room):
            if math.hypot(o["x"] - bot.x, o["z"] - bot.z) > 10:
                continue
            for x, z in (
                (o["x"] - o["w"] / 2 - 0.65, o["z"]),
                (o["x"] + o["w"] / 2 + 0.65, o["z"]),
                (o["x"], o["z"] - o["d"] / 2 - 0.65),
                (o["x"], o["z"] + o["d"] / 2 + 0.65),
            ):
                if not physics.valid_position(x, z, self.combat.obstacles(room)):
                    continue
                blocked = not raycast.clear_segment((x, 1.2, z), (target.x, 1.2, target.z), room)
                score = (
                    (8 if blocked else 0)
                    + min(16, math.hypot(x - target.x, z - target.z)) * 0.25
                    - math.hypot(x - bot.x, z - bot.z) * 0.7
                )
                candidates.append((score, x, z))
        if candidates:
            _, x, z = max(candidates)
            return x, z
        return bot.x, bot.z

    def think(self, room, bot, brain, diff):
        now = self.clock()
        enemies = [p for p in room.players.values() if p.team != bot.team and p.alive]
        visible = [
            p
            for p in enemies
            if math.hypot(p.x - bot.x, p.z - bot.z) <= diff["awareness"]
            and raycast.visible(bot, p, room)
        ]
        target = min(visible, key=lambda p: math.hypot(p.x - bot.x, p.z - bot.z), default=None)
        if target:
            if brain.target != target.id:
                brain.react_at = now + diff["reaction"]
                brain.target = target.id
            brain.last_known = (target.x, target.z)
            brain.seen_at = now
            brain.aim_error = room.rng.gauss(0, diff["aimError"])
            distance = math.hypot(target.x - bot.x, target.z - bot.z)
            weapon = bot.weapons.get(bot.active_slot)
            preferred = (
                7
                if weapon and weapon.id == "shotgun"
                else 23
                if weapon and weapon.id == "dmr"
                else 12
            )
            chest = (bot.x, 1.21, bot.z)
            muzzle_clear = raycast.clear_segment(chest, (target.x, 1.25, target.z), room)
            if bot.health < 28 + (1 - diff["aggression"]) * 20 and now >= brain.reposition_at:
                brain.state = "retreat"
                brain.goal = self.take_cover(room, bot, target)
                brain.reposition_at = now + 2.0
            elif not muzzle_clear:
                brain.state = "flank"
                side = -1 if int(bot.id[-1], 16) % 2 else 1
                dx, dz = target.x - bot.x, target.z - bot.z
                length = max(0.01, math.hypot(dx, dz))
                brain.goal = (bot.x + side * dz / length * 4, bot.z - side * dx / length * 4)
            elif distance > preferred:
                brain.state = "chase"
                brain.goal = (target.x, target.z)
            elif distance < 3:
                brain.state = "reposition"
                brain.goal = (
                    bot.x + (bot.x - target.x) / max(0.1, distance) * 4,
                    bot.z + (bot.z - target.z) / max(0.1, distance) * 4,
                )
            elif now >= brain.reposition_at and room.rng.random() > diff["aggression"]:
                brain.state = "cover"
                brain.goal = self.take_cover(room, bot, target)
                brain.reposition_at = now + 3.0
            else:
                brain.state = "attack"
                brain.goal = (bot.x, bot.z)
            if (
                diff["grenades"]
                and now >= brain.grenade_at
                and 4 < distance < 11
                and bot.grenades
                and now >= brain.react_at
            ):
                brain.grenade_at = now + 12
                if room.rng.random() < 0.22:
                    bot.yaw = math.atan2(target.x - bot.x, target.z - bot.z)
                    with suppress(ArenaError):
                        self.combat.throw(room, bot, min(1, max(0.3, distance / 13)))
        else:
            if now - brain.seen_at < 3 and brain.last_known:
                brain.state = "investigate"
                brain.goal = brain.last_known
            else:
                brain.target = None
                brain.state = "patrol"
                routes = ((-10.6, 0), (10.6, 0), (0, 11 if bot.team == "blue" else -11))
                if (
                    brain.goal is None
                    or math.hypot(bot.x - brain.goal[0], bot.z - brain.goal[1]) < 1
                ):
                    brain.patrol_index = (brain.patrol_index + 1) % 3
                    brain.goal = routes[brain.patrol_index]
        if brain.goal and (now >= brain.path_at or not brain.path):
            nav = self.navigation(room)
            brain.path = nav.path(bot.x, bot.z, *brain.goal)
            brain.path_at = now + 0.85
        return target

    def tick(self, room, dt):
        now = self.clock()
        diff = DIFFICULTY[room.settings.difficulty]
        for bot in room.players.values():
            if not bot.is_bot or not bot.alive:
                continue
            brain = room.bot_brains[bot.id]
            if brain.life_id != bot.life_id:
                brain.life_id = bot.life_id
                brain.path = []
                brain.goal = None
                brain.target = None
                brain.think_at = now
            if now >= brain.think_at:
                self.think(room, bot, brain, diff)
                brain.think_at = now + 0.22
            target = room.players.get(brain.target or "")
            seen = (
                target is not None
                and target.alive
                and now - brain.seen_at < 0.5
                and raycast.visible(bot, target, room)
            )
            bot.move_x = bot.move_z = 0
            bot.crouch = False
            bot.sprint = False
            if brain.path:
                while (
                    brain.path
                    and math.hypot(brain.path[0][0] - bot.x, brain.path[0][1] - bot.z) < 0.25
                ):
                    brain.path.pop(0)
                if brain.path:
                    dx, dz = brain.path[0][0] - bot.x, brain.path[0][1] - bot.z
                    length = max(0.01, math.hypot(dx, dz))
                    bot.move_x, bot.move_z = dx / length, dz / length
                    bot.sprint = not seen and brain.state == "patrol" and length > 4
            bot.trigger = False
            bot.ads = bool(seen and math.hypot(target.x - bot.x, target.z - bot.z) > 8)
            if seen:
                yaw = (
                    math.atan2(
                        target.x + target.vx * diff["lead"] - bot.x,
                        target.z + target.vz * diff["lead"] - bot.z,
                    )
                    + brain.aim_error
                )
                delta = math.atan2(math.sin(yaw - bot.yaw), math.cos(yaw - bot.yaw))
                bot.yaw = math.atan2(
                    math.sin(bot.yaw + max(-dt * 5, min(dt * 5, delta))),
                    math.cos(bot.yaw + max(-dt * 5, min(dt * 5, delta))),
                )
                target_y = 1.60 if room.settings.difficulty == "hard" and now % 4 < 1 else 1.2
                target_y -= 0.43 if target.crouch else 0
                bot.pitch = max(
                    -0.5,
                    min(
                        0.5,
                        math.atan2(
                            target_y - 1.21,
                            max(0.1, math.hypot(target.x - bot.x, target.z - bot.z)),
                        )
                        - bot.recoil_pitch * 0.7,
                    ),
                )
                if (
                    now >= brain.react_at
                    and abs(delta) < 0.25
                    and brain.state not in ("retreat", "flank")
                ):
                    bot.trigger = True
                    weapon = bot.weapons.get(bot.active_slot)
                    if (
                        weapon
                        and WEAPONS[weapon.id]["fireMode"] == "semi"
                        and now >= weapon.next_fire_at
                    ):
                        bot.fire_latch = True
            elif bot.move_x or bot.move_z:
                bot.yaw = math.atan2(bot.move_x, bot.move_z)
            bot.ads_at = now - 1  # Settled aiming after its independently enforced reaction delay.
            bot.input_at = now
            bot.input_seq += 1
