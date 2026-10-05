"""Server-owned frag trajectory, fuse, collision, blast falloff and cover occlusion."""

import math
import uuid

from . import config, raycast
from .models import ArenaError, Grenade


class GrenadeSystem:
    def __init__(self, clock, emit, damage, cover_damage):
        self.clock, self.emit, self.damage, self.cover_damage = clock, emit, damage, cover_damage

    def throw(self, room, player, power, target=None):
        now = self.clock()
        if player.grenades <= 0:
            raise ArenaError("NO_GRENADES", "No grenades remaining until respawn.")
        if now < player.grenade_ready_at:
            raise ArenaError("COOLDOWN", "The grenade is not ready yet.")
        if target is not None:
            x, z = target
            limit = room.map_data["size"] / 2 - config.GRENADE["boundaryMargin"]
            if not all(math.isfinite(v) for v in target) or abs(x) > limit or abs(z) > limit:
                raise ArenaError(
                    "TARGET_OUTSIDE_MAP", "Aim at a ground point inside the current map."
                )
            if math.hypot(x - player.x, z - player.z) > config.GRENADE["maxRange"]:
                raise ArenaError(
                    "GRENADE_OUT_OF_RANGE",
                    f"Grenade target is beyond the {int(config.GRENADE['maxRange'])}m throw range.",
                )
            yaw = math.atan2(x - player.x, z - player.z)
        else:
            yaw = player.yaw
        ray = raycast.direction(yaw, 0)
        chest = (player.x, 0.85 if player.crouch else 1.2, player.z)
        obstruction = raycast.world_hit(chest, ray, 0.55, room)
        origin = raycast.add(chest, ray, max(0.05, obstruction[0] - 0.08) if obstruction else 0.5)
        speed = config.GRENADE["throwSpeed"] * power
        grenade = Grenade(
            str(uuid.uuid4()),
            player.id,
            *origin,
            ray[0] * speed,
            5.0 + power * 3,
            ray[2] * speed,
            now + config.GRENADE["fuseSeconds"],
        )
        if target is not None:
            distance = math.hypot(target[0] - origin[0], target[1] - origin[2])
            ticks = max(24, math.ceil(min(2.2, 0.95 + distance / 25) * config.TICK_HZ))
            dt = 1 / config.TICK_HZ
            duration = ticks * dt
            grenade.vx = (target[0] - origin[0]) / duration
            grenade.vz = (target[1] - origin[2]) / duration
            # Match the actual semi-implicit fixed-tick integrator, not an
            # idealized parabola that overshoots/rolls away from the cursor.
            grenade.vy = (
                config.GRENADE["landingHeight"]
                - origin[1]
                + config.GRENADE["gravity"] * dt * dt * ticks * (ticks + 1) / 2
            ) / duration
            grenade.target_x, grenade.target_z = target
        room.grenades[grenade.id] = grenade
        player.grenades -= 1
        player.grenade_ready_at = now + 0.8
        player.throw_until = now + 0.45
        player.protected_until = 0
        for weapon in player.weapons.values():
            weapon.interrupt_reload()
            weapon.ready_at = max(weapon.ready_at, now + 0.4)
        self.emit(
            room, {"kind": "grenade_throw", "playerId": player.id, "grenade": grenade.public()}
        )
        return grenade

    def tick(self, room, dt):
        now = self.clock()
        for grenade in list(room.grenades.values()):
            if now >= grenade.fuse_at:
                self.explode(room, grenade)
                room.grenades.pop(grenade.id, None)
                continue
            origin = (grenade.x, grenade.y, grenade.z)
            grenade.vy -= config.GRENADE["gravity"] * dt
            delta = (grenade.vx * dt, grenade.vy * dt, grenade.vz * dt)
            length = math.sqrt(sum(v * v for v in delta))
            direction = tuple(v / length for v in delta) if length > 1e-8 else (0, 0, 1)
            hit = raycast.world_hit(origin, direction, length, room, radius=0.08)
            if hit:
                grenade.blocked = True
                point = raycast.add(origin, direction, max(0, hit[0] - 0.025))
                grenade.x, grenade.y, grenade.z = point
                normal = hit[2]
                velocity = [grenade.vx, grenade.vy, grenade.vz]
                for axis in range(3):
                    if normal[axis]:
                        velocity[axis] *= -0.36
                grenade.vx, grenade.vy, grenade.vz = velocity
            else:
                grenade.x, grenade.y, grenade.z = raycast.add(origin, delta)
            if grenade.y <= config.GRENADE["landingHeight"] + 1e-7 and grenade.vy < 0:
                grenade.y = config.GRENADE["landingHeight"]
                grenade.landed = True
                if grenade.target_x is not None:
                    grenade.vx = grenade.vy = grenade.vz = 0.0
                else:
                    grenade.vy = abs(grenade.vy) * 0.32 if abs(grenade.vy) > 0.8 else 0
                    grenade.vx *= 0.78
                    grenade.vz *= 0.78
            for axis in ("x", "z"):
                value = getattr(grenade, axis)
                limit = room.map_data["size"] / 2 - config.GRENADE["boundaryMargin"]
                if abs(value) > limit + 1e-7:
                    grenade.blocked = True
                    setattr(grenade, axis, math.copysign(limit, value))
                    velocity = "v" + axis
                    setattr(grenade, velocity, -getattr(grenade, velocity) * 0.35)

    def explode(self, room, grenade):
        # A cover object that absorbs this blast still protects a player from this
        # explosion, even if the same explosion destroys that cover.
        volumes = raycast.obstacles(room)
        origin = (grenade.x, max(0.25, grenade.y), grenade.z)
        radius = config.GRENADE["radius"]
        attacker = room.participants.get(grenade.owner_id) or room.players.get(grenade.owner_id)
        for victim in list(room.players.values()):
            if not victim.alive:
                continue
            target = (victim.x, 0.75 if victim.crouch else 1.1, victim.z)
            distance = math.sqrt(sum((origin[i] - target[i]) ** 2 for i in range(3)))
            if distance >= radius:
                continue
            falloff = max(0, 1 - max(0, distance - 0.8) / (radius - 0.8))
            amount = config.GRENADE["damage"] * falloff
            if not raycast.clear_segment(origin, target, room, volumes):
                amount *= 0.15
            self.damage(room, attacker, victim, amount, "grenade", "body")
        for o in volumes:
            if o["id"] in room.cover_health:
                distance = math.hypot(o["x"] - grenade.x, o["z"] - grenade.z)
                if distance < radius:
                    self.cover_damage(room, o["id"], 220 * (1 - distance / radius))
        self.emit(
            room,
            {
                "kind": "explosion",
                "playerId": grenade.owner_id,
                "position": {
                    "x": round(grenade.x, 3),
                    "y": round(grenade.y, 3),
                    "z": round(grenade.z, 3),
                },
                "radius": radius,
            },
        )
