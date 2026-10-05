"""Authoritative weapons/damage/life cycle; intent never reports hits or deaths."""

import math

from . import config, physics, raycast
from .grenades import GrenadeSystem
from .models import ArenaError, MatchStats, Phase, PlayerStatus
from .weapons import WEAPONS, inventory


class CombatSystem:
    def __init__(self, clock, emit, dirty):
        self.clock, self.emit, self.dirty = clock, emit, dirty
        self.grenade_system = GrenadeSystem(clock, emit, self.damage, self.cover_damage)

    def obstacles(self, room):
        return [o for o in room.map_data["obstacles"] if o["id"] not in room.destroyed]

    def prepare(self, room):
        now = self.clock()
        room.scores = {"blue": 0, "red": 0}
        room.results = None
        room.started_at = None
        room.killfeed.clear()
        room.history.clear()
        room.team_contacts = {"blue": {}, "red": {}}
        room.grenades.clear()
        room.destroyed.clear()
        room.cover_health = {
            o["id"]: config.DESTRUCTIBLE_HEALTH[o["kind"]]
            for o in room.map_data["obstacles"]
            if o["kind"] in config.DESTRUCTIBLE_HEALTH
        }
        room.participants = dict(room.players)
        room.forfeit_at = room.forfeit_team = None
        for player in room.players.values():
            player.stats = MatchStats()
            player.active_seconds = 0
            player.disqualified = False
            self.spawn(room, player, reposition=False)
            player.status = PlayerStatus.SPAWNING if player.connected else PlayerStatus.DISCONNECTED
            player.protected_until = (
                now + config.COUNTDOWN_SECONDS + config.SPAWN_PROTECTION_SECONDS
            )

    def require_alive(self, room, player):
        if not room.combat_enabled:
            raise ArenaError("COMBAT_DISABLED", "Combat is not enabled in a network drill.")
        if room.phase != Phase.ACTIVE:
            raise ArenaError("MATCH_NOT_ACTIVE", "Combat starts after the server countdown.")
        if not player.alive:
            raise ArenaError("PLAYER_DEAD", "Wait for your authoritative respawn.")

    def spawn(self, room, player, reposition=True):
        now = self.clock()
        if reposition:
            player.x, player.z = self.safe_spawn(room, player)
        player.health, player.armor = config.BASE_HEALTH, config.BASE_ARMOR
        player.weapons = inventory(player.primary)
        player.active_slot = 1
        player.grenades = config.GRENADE["quantity"]
        player.recoil_pitch = player.recoil_yaw = player.bloom = 0.0
        player.respawn_at = player.death_at = None
        player.damage_by.clear()
        player.stop()
        player.crouch = False
        player.yaw = math.pi if player.team == "blue" else 0
        player.pitch = 0
        player.status = PlayerStatus.ALIVE if player.connected else PlayerStatus.DISCONNECTED
        player.life_id += 1
        player.protected_until = now + config.SPAWN_PROTECTION_SECONDS
        player.grenade_ready_at = player.throw_until = 0.0
        if reposition:
            self.emit(room, {"kind": "respawn", "playerId": player.id})
            self.dirty(room)

    def safe_spawn(self, room, player):
        points = [dict(p) for p in room.map_data["spawns"][player.team]]
        z = 19 if player.team == "blue" else -19
        points.extend({"x": x, "z": z} for x in (-7, -3, 0, 3, 7))
        enemies = [p for p in room.players.values() if p.team != player.team and p.alive]
        allies = [p for p in room.players.values() if p.id != player.id and p.alive]
        volumes = self.obstacles(room)
        scored = []
        for point in points:
            x, z = point["x"], point["z"]
            if not physics.valid_position(x, z, volumes):
                continue
            enemy_distance = min((math.hypot(e.x - x, e.z - z) for e in enemies), default=44)
            visible_count = sum(
                raycast.clear_segment((x, 1.65, z), (e.x, 1.65, e.z), room) for e in enemies
            )
            ally_distance = min((math.hypot(a.x - x, a.z - z) for a in allies), default=8)
            score = enemy_distance - visible_count * 8 + min(ally_distance, 3)
            scored.append((score, x, z))
        if not scored:
            raise RuntimeError("No valid team spawn in canonical map")
        _, x, z = max(scored)
        return x, z

    def reload(self, room, player):
        self.require_alive(room, player)
        now = self.clock()
        weapon = player.weapons[player.active_slot]
        data = WEAPONS[weapon.id]
        if weapon.reload_at is not None:
            raise ArenaError("ALREADY_RELOADING", "Reload is already in progress.")
        if now < weapon.ready_at or now < player.throw_until:
            raise ArenaError("WEAPON_NOT_READY", "Finish the weapon draw first.")
        if weapon.magazine >= data["magazineSize"]:
            raise ArenaError("MAGAZINE_FULL", "The magazine is full.")
        if weapon.reserve <= 0:
            raise ArenaError("NO_RESERVE", "No reserve ammunition remaining.")
        weapon.reload_started_at = now
        weapon.reload_at = now + data["reloadSeconds"]
        player.fire_latch = False
        self.emit(
            room,
            {
                "kind": "reload",
                "playerId": player.id,
                "weaponId": weapon.id,
                "endsAtMs": round(weapon.reload_at * 1000),
            },
        )

    def switch(self, room, player, slot):
        self.require_alive(room, player)
        if slot not in player.weapons:
            raise ArenaError("WEAPON_NOT_OWNED", "This loadout does not own that weapon.")
        if player.active_slot == slot:
            return
        now = self.clock()
        for weapon in player.weapons.values():
            weapon.interrupt_reload()
        player.active_slot = slot
        weapon = player.weapons[slot]
        weapon.ready_at = now + WEAPONS[weapon.id]["switchSeconds"]
        player.ads = player.fire_latch = False
        self.emit(
            room,
            {
                "kind": "switch",
                "playerId": player.id,
                "weaponId": weapon.id,
                "readyAtMs": round(weapon.ready_at * 1000),
            },
        )

    def throw(self, room, player, power, target=None):
        self.require_alive(room, player)
        return self.grenade_system.throw(room, player, power, target)

    def interrupt(self, player):
        player.stop()
        for weapon in player.weapons.values():
            weapon.interrupt_reload()

    def tick(self, room, dt):
        now = self.clock()
        for player in room.players.values():
            if (
                player.connected
                and player.health <= 0
                and player.respawn_at is not None
                and now >= player.respawn_at
            ):
                self.spawn(room, player)
            if not player.alive:
                continue
            player.active_seconds += dt
            weapon = player.weapons.get(player.active_slot)
            if weapon is None:
                continue
            data = WEAPONS[weapon.id]
            factor = math.exp(-dt * data["recoilReturn"])
            player.recoil_pitch *= factor
            player.recoil_yaw *= factor
            player.bloom *= math.exp(-dt * 5)
            if weapon.reload_at is not None and now >= weapon.reload_at:
                loaded = min(data["magazineSize"] - weapon.magazine, weapon.reserve)
                weapon.magazine += loaded
                weapon.reserve -= loaded
                weapon.interrupt_reload()
        # Build every shot from the alive-at-tick set before resolving damage.
        # Reciprocal lethal shots in one tick therefore both count.
        shots = []
        for player in list(room.players.values()):
            shot = self.make_shot(room, player)
            if shot is not None:
                shots.append(shot)
        for shot in shots:
            self.resolve_shot(room, shot)
        self.grenade_system.tick(room, dt)
        room.history.append(
            (
                now,
                {
                    p.id: {
                        "x": p.x,
                        "z": p.z,
                        "yaw": p.yaw,
                        "crouch": p.crouch,
                        "lifeId": p.life_id,
                    }
                    for p in room.players.values()
                    if p.alive
                },
            )
        )

    def make_shot(self, room, player):
        now = self.clock()
        pending = player.fire_latch
        player.fire_latch = False
        if room.phase != Phase.ACTIVE or not room.combat_enabled:
            return None
        if not player.alive or now - player.input_at > config.INPUT_TIMEOUT:
            return None
        weapon = player.weapons.get(player.active_slot)
        if weapon is None:
            return None
        data = WEAPONS[weapon.id]
        requested = player.trigger if data["fireMode"] == "auto" else pending
        if not requested or player.sprint or now < player.throw_until:
            return None
        if weapon.reload_at is not None or now < weapon.ready_at or now < weapon.next_fire_at:
            return None
        if weapon.magazine <= 0:
            if weapon.reserve:
                self.reload(room, player)
            return None
        weapon.magazine -= 1
        weapon.next_fire_at = now + 1 / data["roundsPerSecond"]
        weapon.last_fired_at = now
        player.protected_until = 0.0
        player.stats.shots += 1
        player.stats.weapon_shots[weapon.id] = player.stats.weapon_shots.get(weapon.id, 0) + 1
        ads = player.ads and now - player.ads_at >= data["adsSeconds"]
        spread = data["adsSpread"] if ads else data["hipSpread"]
        if math.hypot(player.vx, player.vz) > 0.1:
            spread *= data["movementPenalty"]
        if player.crouch:
            spread *= 0.65
        spread += player.bloom
        yaw, pitch = player.yaw + player.recoil_yaw, player.pitch + player.recoil_pitch
        direction = raycast.direction(yaw, pitch)
        chest = (player.x, 0.79 if player.crouch else 1.21, player.z)
        muzzle_wall = raycast.world_hit(chest, direction, 0.65, room)
        origin = raycast.add(
            chest, direction, max(0.0, muzzle_wall[0] - 0.01) if muzzle_wall else 0.58
        )
        traces = []
        rewind_at = now - min(config.REWIND_LIMIT, 0.1 + (player.latency_ms or 0) / 2000)
        for _ in range(data["pellets"]):
            radius = math.sqrt(room.rng.random()) * spread
            angle = room.rng.random() * math.tau
            ray = raycast.direction(
                yaw + math.cos(angle) * radius, pitch + math.sin(angle) * radius
            )
            world = raycast.world_hit(origin, ray, data["range"], room)
            limit = world[0] if world else data["range"]
            victim, zone = None, "body"
            # Trace the original alive-at-tick participants. Their health is
            # rechecked on damage, so several pellets never award duplicate kills.
            for target in room.players.values():
                if target.id == player.id or not target.alive:
                    continue
                hit = raycast.hit_zones(
                    origin, ray, target, limit, raycast.rewind_pose(room, target, rewind_at)
                )
                if hit and hit[0] < limit:
                    limit, zone, victim = hit[0], hit[1], target
            endpoint = raycast.add(origin, ray, limit)
            cover = world[1]["id"] if world and victim is None else None
            distance = limit + 0.58
            falloff = 1 - (1 - data["falloffMinimum"]) * max(
                0,
                min(
                    1,
                    (distance - data["falloffStart"])
                    / max(0.1, data["range"] - data["falloffStart"]),
                ),
            )
            multiplier = (
                data["headMultiplier"]
                if zone == "head"
                else data["limbMultiplier"]
                if zone in ("legs", "arms")
                else 1
            )
            traces.append((victim, zone, data["damage"] * multiplier * falloff, endpoint, cover))
        player.recoil_pitch = min(0.12, player.recoil_pitch + data["recoilPitch"])
        player.recoil_yaw = max(
            -0.08, min(0.08, player.recoil_yaw + room.rng.uniform(-1, 1) * data["recoilYaw"])
        )
        player.bloom = min(0.018, player.bloom + data["hipSpread"] * 0.13)
        return player, weapon.id, origin, traces

    def resolve_shot(self, room, shot):
        player, weapon_id, origin, traces = shot
        hit_any = False
        endpoints, impacts = [], []
        for victim, zone, amount, endpoint, cover in traces:
            endpoints.append(
                {"x": round(endpoint[0], 3), "y": round(endpoint[1], 3), "z": round(endpoint[2], 3)}
            )
            if victim is not None:
                dealt = self.damage(room, player, victim, amount, weapon_id, zone)
                hit_any |= dealt > 0 and victim.team != player.team
                impacts.append("blood" if dealt else "protected")
            elif cover:
                self.cover_damage(room, cover, amount)
                impacts.append("concrete")
            else:
                impacts.append("air")
        if hit_any:
            player.stats.hits += 1
        self.emit(
            room,
            {
                "kind": "shot",
                "playerId": player.id,
                "weaponId": weapon_id,
                "origin": {
                    "x": round(origin[0], 3),
                    "y": round(origin[1], 3),
                    "z": round(origin[2], 3),
                },
                "ends": endpoints,
                "impacts": impacts,
            },
            transient=True,
        )

    def damage(self, room, attacker, victim, amount, weapon_id, zone):
        now = self.clock()
        if room.phase != Phase.ACTIVE or not victim.alive or amount <= 0:
            return 0.0
        self_hit = attacker is not None and attacker.id == victim.id
        friendly = attacker is not None and attacker.team == victim.team and not self_hit
        if friendly and not room.settings.friendlyFire:
            return 0.0
        if not self_hit and now < victim.protected_until:
            return 0.0
        absorbed = min(victim.armor, amount * config.ARMOR_ABSORPTION)
        victim.armor = max(0.0, victim.armor - absorbed)
        health_damage = min(victim.health, max(0.0, amount - absorbed))
        victim.health = max(0.0, victim.health - health_damage)
        if attacker and not friendly and not self_hit:
            attacker.stats.damage += health_damage
            previous = victim.damage_by.get(attacker.id, (0.0, now))
            victim.damage_by[attacker.id] = (previous[0] + health_damage, now)
        bearing = math.atan2(attacker.x - victim.x, attacker.z - victim.z) if attacker else 0
        self.emit(
            room,
            {
                "kind": "damage",
                "attackerId": attacker.id if attacker else None,
                "victimId": victim.id,
                "damage": round(health_damage, 1),
                "health": round(victim.health, 1),
                "armor": round(victim.armor, 1),
                "headshot": zone == "head",
                "bearing": round(bearing / (math.pi / 4)) * math.pi / 4,
            },
        )
        if victim.health <= 0:
            self.die(room, attacker, victim, weapon_id, zone)
        return health_damage

    def die(self, room, attacker, victim, weapon_id, zone):
        now = self.clock()
        victim.health = 0
        victim.stats.deaths += 1
        victim.status = PlayerStatus.DEAD
        victim.death_at = now
        victim.respawn_at = now + config.RESPAWN_SECONDS
        self.interrupt(victim)
        enemy_kill = (
            attacker is not None and attacker.id != victim.id and attacker.team != victim.team
        )
        if enemy_kill:
            attacker.stats.kills += 1
            attacker.stats.score += 100
            if zone == "head":
                attacker.stats.headshots += 1
                attacker.stats.score += 25
            room.scores[attacker.team] += 1
            for helper_id, (damage, at) in victim.damage_by.items():
                helper = room.participants.get(helper_id)
                if (
                    helper
                    and helper_id != attacker.id
                    and helper.team != victim.team
                    and now - at < 10
                    and damage >= 20
                ):
                    helper.stats.assists += 1
                    helper.stats.score += 40
        entry = {
            "id": room.event_seq + 1,
            "atMs": round(now * 1000),
            "attackerId": attacker.id if attacker else None,
            "attacker": attacker.name if attacker else "ENVIRONMENT",
            "victimId": victim.id,
            "victim": victim.name,
            "weaponId": weapon_id,
            "headshot": zone == "head",
            "teamkill": bool(attacker and attacker.team == victim.team),
        }
        room.killfeed.append(entry)
        self.emit(room, {"kind": "kill", **entry})
        self.dirty(room)

    def cover_damage(self, room, cover_id, amount):
        if cover_id not in room.cover_health or cover_id in room.destroyed:
            return
        room.cover_health[cover_id] = max(0, room.cover_health[cover_id] - amount)
        if room.cover_health[cover_id] <= 0:
            room.destroyed.add(cover_id)
            self.emit(room, {"kind": "cover_destroyed", "coverId": cover_id})
