"""Single-writer authoritative rooms; combat, rules and persistence are separate."""

import asyncio
import logging
import math
import secrets
import time
import uuid
from collections.abc import Callable
from contextlib import suppress

from . import config, physics, raycast
from .ai import BotSystem
from .combat import CombatSystem
from .matches import MatchSystem
from .models import (
    ArenaError,
    CreateRoom,
    Input,
    JoinRoom,
    Leave,
    Phase,
    Player,
    PlayerStatus,
    Pong,
    QuickPlay,
    Ready,
    Reload,
    RetryResults,
    ReturnLobby,
    Room,
    RoomSettings,
    Start,
    SwitchWeapon,
    Team,
    ThrowGrenade,
)
from .peers import PeerProtocol
from .rules import RULES
from .weapons import COSMETICS, PRIMARY_WEAPONS

logger = logging.getLogger("tactical_arena.rooms")


class RoomService:
    def __init__(self, clock: Callable[[], float] = time.monotonic, repository=None):
        self.clock = clock
        self.rooms: dict[str, Room] = {}
        self.peers: dict[str, PeerProtocol] = {}
        self.memberships: dict[str, str] = {}
        self.profile_writes: set[str] = set()
        self.task: asyncio.Task | None = None
        self.running = False
        self.combat = CombatSystem(clock, self.emit, self.publish)
        self.matches = MatchSystem(clock, self.emit, self.publish, repository, self.profile_update)
        self.bots = BotSystem(clock, self.combat)

    async def start(self):
        if not self.running:
            self.running = True
            self.task = asyncio.create_task(self._run(), name="arena-authority")
            logger.info(
                "Room authority started (%sHz, %sHz snapshots)", config.TICK_HZ, config.SNAPSHOT_HZ
            )

    async def stop(self):
        self.running = False
        if self.task:
            self.task.cancel()
            with suppress(asyncio.CancelledError):
                await self.task
        await self.matches.drain()
        for peer in list(self.peers.values()):
            peer.send(
                {
                    "type": "error",
                    "code": "SERVER_STOPPING",
                    "message": "Server is restarting. Live matches do not survive a restart.",
                }
            )
        self.peers.clear()
        self.rooms.clear()
        self.memberships.clear()

    def attach(self, peer: PeerProtocol):
        if self.task is not None and not self.running:
            raise ArenaError(
                "SERVER_UNAVAILABLE", "Room authority is unavailable. Please retry after a restart."
            )
        if peer.id in self.peers:
            raise ArenaError(
                "SESSION_IN_USE",
                "This guest is already connected. Use another browser or private window for a second operator.",
            )
        if len(self.peers) >= config.MAX_CONNECTIONS:
            raise ArenaError("SERVER_FULL", "Room service is at capacity.")
        self.peers[peer.id] = peer
        peer.send(
            {
                "type": "welcome",
                "playerId": peer.id,
                "protocolVersion": config.PROTOCOL_VERSION,
                "serverTimeMs": round(self.clock() * 1000),
            }
        )
        code = self.memberships.get(peer.id)
        room = self.rooms.get(code or "")
        if room and peer.id in room.players:
            player = room.players[peer.id]
            if (
                player.disconnected_at is not None
                and self.clock() - player.disconnected_at >= config.RECONNECT_GRACE
            ):
                self._remove(room, peer.id)
                peer.send(
                    {"type": "room_state", "room": None, "serverTimeMs": round(self.clock() * 1000)}
                )
                return
            player.connected = True
            player.disconnected_at = None
            player.name = peer.name
            if room.phase == Phase.ACTIVE:
                player.status = (
                    PlayerStatus.ALIVE
                    if not room.combat_enabled or player.health > 0
                    else PlayerStatus.DEAD
                )
            else:
                player.status = PlayerStatus.LOBBY
            player.stop()
            peer.room_code = code
            self._elect_owner(room)
            self.publish(room)
            self.snapshot(room)
        else:
            peer.send(
                {"type": "room_state", "room": None, "serverTimeMs": round(self.clock() * 1000)}
            )

    def detach(self, peer: PeerProtocol):
        if self.peers.get(peer.id) is not peer:
            return
        del self.peers[peer.id]
        room = self.rooms.get(peer.room_code or "")
        if room and peer.id in room.players:
            player = room.players[peer.id]
            player.connected = player.ready = False
            player.status = PlayerStatus.DISCONNECTED
            player.disconnected_at = self.clock()
            player.latency_ms = None
            self.combat.interrupt(player)
            if room.phase == Phase.COUNTDOWN:
                self._to_lobby(room)
            self._elect_owner(room)
            self.publish(room)
            self.snapshot(room)

    def handle(self, peer: PeerProtocol, message):
        if self.task is not None and not self.running:
            raise ArenaError("SERVER_UNAVAILABLE", "Room authority is unavailable.")
        if self.peers.get(peer.id) is not peer:
            raise ArenaError("SESSION_EXPIRED", "Reconnect before sending actions.")
        if isinstance(message, Pong):
            if message.nonce == peer.ping_nonce:
                peer.last_pong_at = self.clock()
                latency = min(9999, round((self.clock() - peer.ping_sent_at) * 1000))
                peer.ping_nonce = None
                room = self.rooms.get(peer.room_code or "")
                if room:
                    room.players[peer.id].latency_ms = latency
                    self.publish(room)
            return
        if isinstance(message, CreateRoom):
            self._create(peer, message.settings)
        elif isinstance(message, QuickPlay):
            self._not_member(peer)
            room = next(
                (
                    r
                    for r in self.rooms.values()
                    if r.public_room
                    and r.settings.mapId == message.mapId
                    and r.phase in (Phase.LOBBY, Phase.ACTIVE)
                    and len(r.players) < r.capacity
                    and not any(
                        p.name.casefold() == peer.name.casefold() for p in r.players.values()
                    )
                ),
                None,
            )
            if room is None:
                room = self._create(
                    peer, RoomSettings(mode="TEAM_DEATHMATCH", mapId=message.mapId), public=True
                )
            else:
                self._add(room, peer)
            room.players[peer.id].ready = True
            room.players[peer.id].status = (
                PlayerStatus.READY if room.phase == Phase.LOBBY else PlayerStatus.ALIVE
            )
            self.publish(room)
            self._auto_start(room)
        elif isinstance(message, JoinRoom):
            self._join(peer, message)
        else:
            room = self.rooms.get(peer.room_code or "")
            if room is None or peer.id not in room.players:
                raise ArenaError("NOT_IN_ROOM", "Join a room first.")
            player = room.players[peer.id]
            if isinstance(message, Input):
                if (
                    room.phase != Phase.ACTIVE
                    or not player.connected
                    or (room.combat_enabled and not player.alive)
                ):
                    return
                if message.seq <= player.input_seq:
                    return
                length = max(1.0, math.hypot(message.moveX, message.moveZ))
                player.move_x, player.move_z = message.moveX / length, message.moveZ / length
                player.crouch = message.crouch if room.combat_enabled else False
                player.sprint = message.sprint and not player.crouch
                player.yaw = math.atan2(math.sin(message.aim), math.cos(message.aim))
                player.pitch = message.pitch
                if message.trigger and not player.trigger:
                    player.fire_latch = True
                player.trigger = message.trigger
                ads = message.ads and not player.sprint
                if ads and not player.ads:
                    player.ads_at = self.clock()
                player.ads = ads
                player.input_seq, player.input_at = message.seq, self.clock()
                return
            if isinstance(message, Ready):
                if room.phase != Phase.LOBBY:
                    raise ArenaError("MATCH_IN_PROGRESS", "Ready state only changes in the lobby.")
                player.ready = message.ready
                player.status = PlayerStatus.READY if message.ready else PlayerStatus.LOBBY
            elif isinstance(message, Start):
                self._owner(room, peer)
                self._begin(room)
            elif isinstance(message, ReturnLobby):
                self._owner(room, peer)
                if room.phase not in (Phase.ACTIVE, Phase.ENDING, Phase.RESULTS, Phase.COUNTDOWN):
                    raise ArenaError("INVALID_PHASE", "This room is already in its lobby.")
                if room.results and room.results["persistence"] == "saving":
                    raise ArenaError("SAVING_RESULTS", "Wait until match results have been saved.")
                if room.results and room.results["persistence"] == "error":
                    raise ArenaError(
                        "RESULT_SAVE_FAILED",
                        "Retry result persistence first, or explicitly leave the room.",
                    )
                self._to_lobby(room)
                self.snapshot(room)
            elif isinstance(message, Reload):
                self.combat.reload(room, player)
            elif isinstance(message, SwitchWeapon):
                self.combat.switch(room, player, message.slot)
            elif isinstance(message, ThrowGrenade):
                target = (message.targetX, message.targetZ) if message.targetX is not None else None
                self.combat.throw(room, player, message.power, target)
            elif isinstance(message, RetryResults):
                if room.phase not in (Phase.ENDING, Phase.RESULTS) or room.results is None:
                    raise ArenaError("NO_RESULTS", "There are no completed results to retry.")
                self.matches.save(room)
            elif isinstance(message, Leave):
                peer.room_code = None
                self._remove(room, peer.id)
                peer.send(
                    {"type": "room_state", "room": None, "serverTimeMs": round(self.clock() * 1000)}
                )
                self._ack(peer, message)
                return
            room.activity_at = self.clock()
            self.publish(room)
            self._auto_start(room)
        self._ack(peer, message)

    def _create(self, peer, settings, public=False):
        self._not_member(peer)
        if settings.bots and self.bots is None:
            raise ArenaError(
                "BOTS_UNAVAILABLE", "AI practice is not available on this server build."
            )
        if len(self.rooms) >= config.MAX_ROOMS:
            raise ArenaError("SERVER_FULL", "All room slots are occupied.")
        code = "".join(secrets.choice(config.CODE_ALPHABET) for _ in range(6))
        while code in self.rooms:
            code = "".join(secrets.choice(config.CODE_ALPHABET) for _ in range(6))
        now = self.clock()
        room = Room(str(uuid.uuid4()), code, peer.id, settings, now, now, public_room=public)
        room.rng.seed(secrets.randbits(64))
        self.rooms[code] = room
        self._add(room, peer)
        if settings.bots and self.bots:
            self.bots.populate(room)
            self.publish(room)
            self.snapshot(room)
        logger.info("Room created: %s (%s, %s slots)", code, settings.mode, room.capacity)
        return room

    def _join(self, peer, message):
        self._not_member(peer)
        room = self.rooms.get(message.code)
        if not room:
            raise ArenaError("ROOM_NOT_FOUND", "Room not found. Check the six-character code.")
        if room.phase not in (Phase.LOBBY, Phase.ACTIVE):
            raise ArenaError(
                "MATCH_UNAVAILABLE",
                "This room is starting or ending. Wait for its owner to return to lobby.",
            )
        if len(room.players) >= room.capacity:
            raise ArenaError("ROOM_FULL", "Room is full, including reserved reconnect slots.")
        if any(p.name.casefold() == peer.name.casefold() for p in room.players.values()):
            raise ArenaError(
                "NAME_TAKEN",
                "An operator in this room already uses that callsign. Choose another callsign.",
            )
        self._add(room, peer)
        if room.public_room:
            room.players[peer.id].ready = True
            self.publish(room)
            self._auto_start(room)

    def _add(self, room, peer):
        counts = {t: sum(p.team == t for p in room.players.values()) for t in Team}
        team = Team.BLUE if counts[Team.BLUE] <= counts[Team.RED] else Team.RED
        if counts[team] >= room.settings.teamSize:
            raise ArenaError("ROOM_FULL", "No team slots are available.")
        used = {(p.x, p.z) for p in room.players.values() if p.team == team}
        points = [physics.spawn(team, i, room.map_data) for i in range(room.settings.teamSize)]
        x, z = next((point for point in points if point not in used), points[0])
        profile = getattr(peer, "profile", {})
        loadout = profile.get("loadout", {})
        primary = loadout.get("primary", "rifle")
        cosmetic = loadout.get("cosmetic", "olive")
        player = Player(
            peer.id,
            peer.name,
            team,
            self.clock(),
            x,
            z,
            math.pi if team == Team.BLUE else 0,
            primary=primary if primary in PRIMARY_WEAPONS else "rifle",
            cosmetic=cosmetic if cosmetic in COSMETICS else "olive",
            level=profile.get("level", 1),
        )
        if (
            room.phase == Phase.ACTIVE
            and len(room.participants) >= 32
            and peer.id not in room.participants
        ):
            raise ArenaError(
                "MATCH_PARTICIPANT_LIMIT",
                "This match has reached its safe participant history limit; join after rematch.",
            )
        previous = room.participants.get(peer.id)
        if room.phase == Phase.ACTIVE:
            if previous:
                player.stats = previous.stats
                player.disqualified = True  # Leaving/rejoining never farms completion XP.
            room.participants[player.id] = player
            if room.combat_enabled:
                self.combat.spawn(room, player)
            else:
                player.status = PlayerStatus.ALIVE
        room.players[peer.id] = player
        peer.room_code = room.code
        self.memberships[peer.id] = room.code
        room.activity_at = self.clock()
        self.publish(room)
        self.snapshot(room)

    def _begin(self, room):
        if room.phase != Phase.LOBBY:
            raise ArenaError("MATCH_IN_PROGRESS", "The match has already started.")
        error = RULES[room.settings.mode].validate_start(room)
        if error:
            raise ArenaError("NOT_READY", error)
        room.match_id = str(uuid.uuid4())
        room.phase = Phase.COUNTDOWN
        room.phase_ends_at = self.clock() + config.COUNTDOWN_SECONDS
        counts = {Team.BLUE: 0, Team.RED: 0}
        for p in room.players.values():
            p.x, p.z = physics.spawn(p.team, counts[p.team], room.map_data)
            counts[p.team] += 1
            p.stop()
            p.status = PlayerStatus.SPAWNING if p.connected else PlayerStatus.DISCONNECTED
        if room.combat_enabled:
            self.combat.prepare(room)
        self.publish(room)
        self.snapshot(room)
        logger.info("Match %s countdown started", room.match_id)

    def _auto_start(self, room):
        if (
            room.public_room
            and room.phase == Phase.LOBBY
            and RULES[room.settings.mode].validate_start(room) is None
        ):
            self._begin(room)

    @staticmethod
    def _owner(room, peer):
        if room.owner_id != peer.id:
            raise ArenaError("OWNER_ONLY", "Only the room owner can perform this action.")

    def _not_member(self, peer):
        if peer.id in self.profile_writes:
            raise ArenaError(
                "PROFILE_SAVE_PENDING", "Wait for your profile/loadout save before joining a room."
            )
        if peer.id in self.memberships:
            raise ArenaError("ALREADY_IN_ROOM", "Leave your current room before joining another.")

    def _remove(self, room, player_id):
        player = room.players.pop(player_id, None)
        if player and room.phase in (Phase.ACTIVE, Phase.COUNTDOWN):
            player.disqualified = True
            player.connected = False
            self.combat.interrupt(player)
        self.memberships.pop(player_id, None)
        if not any(not p.is_bot for p in room.players.values()):
            self._close(room, "The last human operator left.")
            return
        self._elect_owner(room)
        if room.phase == Phase.COUNTDOWN:
            self._to_lobby(room)
        self.publish(room)
        self.snapshot(room)

    @staticmethod
    def _elect_owner(room):
        current = room.players.get(room.owner_id)
        if current and current.connected and not current.is_bot:
            return
        connected = [p for p in room.players.values() if p.connected and not p.is_bot]
        if connected:
            room.owner_id = min(connected, key=lambda p: p.joined_at).id
        elif room.owner_id not in room.players and room.players:
            room.owner_id = next(iter(room.players))

    def _to_lobby(self, room):
        room.phase = Phase.LOBBY
        room.phase_ends_at = None
        room.grenades.clear()
        room.history.clear()
        room.team_contacts = {"blue": {}, "red": {}}
        room.results = None
        room.killfeed.clear()
        room.scores = {"blue": 0, "red": 0}
        for p in room.players.values():
            p.ready = p.is_bot
            self.combat.interrupt(p)
            p.status = (
                PlayerStatus.READY
                if p.is_bot
                else PlayerStatus.LOBBY
                if p.connected
                else PlayerStatus.DISCONNECTED
            )
        room.activity_at = self.clock()

    def _close(self, room, reason):
        room.phase = Phase.CLOSED
        for player_id in list(room.players):
            self.memberships.pop(player_id, None)
            peer = self.peers.get(player_id)
            if peer:
                peer.room_code = None
                peer.send({"type": "room_closed", "message": reason})
                peer.send(
                    {"type": "room_state", "room": None, "serverTimeMs": round(self.clock() * 1000)}
                )
        self.rooms.pop(room.code, None)
        if self.bots:
            self.bots.cleanup(room)
        logger.info("Room closed: %s", room.code)

    @staticmethod
    def _ack(peer, message):
        peer.send({"type": "ack", "requestId": message.requestId, "action": message.type})

    def profile_update(self, profile):
        peer = self.peers.get(profile["id"])
        if peer:
            peer.profile = profile
            room = self.rooms.get(peer.room_code or "")
            if room and profile["id"] in room.players:
                room.players[profile["id"]].level = profile["level"]
                self.publish(room)
            peer.send({"type": "profile_update", "profile": profile})

    def emit(self, room, event, transient=False):
        if self.rooms.get(room.code) is not room:
            return
        room.event_seq += 1
        now = self.clock()
        kind = event["kind"]
        for player in room.players.values():
            peer = self.peers.get(player.id)
            if not player.connected or peer is None:
                continue
            data = event
            if kind == "damage" and player.id not in (event["attackerId"], event["victimId"]):
                continue
            source = room.players.get(event.get("playerId"))
            if (
                kind in ("shot", "reload", "switch", "grenade_throw")
                and source
                and not raycast.visible(player, source, room)
            ):
                distance = math.hypot(player.x - source.x, player.z - source.z)
                if kind == "shot" and distance <= 22:
                    data = {
                        "kind": "sound",
                        "weaponId": event["weaponId"],
                        "position": {
                            "x": round(source.x / 4) * 4,
                            "y": 1.2,
                            "z": round(source.z / 4) * 4,
                        },
                    }
                else:
                    continue
            if kind == "explosion":
                point = event["position"]
                if math.hypot(player.x - point["x"], player.z - point["z"]) > 28:
                    continue
            payload = {
                "type": "combat_event",
                "roomId": room.id,
                "seq": room.event_seq,
                "serverTimeMs": round(now * 1000),
                "event": data,
            }
            peer.send(payload, transient=transient)

    def publish(self, room):
        if self.rooms.get(room.code) is not room:
            return
        room.revision += 1
        payload = {
            "type": "room_state",
            "room": room.public(),
            "serverTimeMs": round(self.clock() * 1000),
        }
        for p in room.players.values():
            peer = self.peers.get(p.id)
            if p.connected and peer:
                peer.send(payload)

    def snapshot(self, room):
        if self.rooms.get(room.code) is not room:
            return
        room.snapshot_seq += 1
        now = self.clock()
        room.last_snapshot_at = now
        common = {
            "type": "snapshot",
            "roomId": room.id,
            "seq": room.snapshot_seq,
            "eventSeq": room.event_seq,
            "serverTimeMs": round(now * 1000),
            "phase": room.phase,
            "phaseEndsAtMs": round(room.phase_ends_at * 1000)
            if room.phase_ends_at is not None
            else None,
            "scores": dict(room.scores),
            "destroyed": sorted(room.destroyed),
        }
        # Team-shared confirmed sightings, then bounded last-known contacts.
        # Fresh enemy coordinates are never sent through solid occluding walls.
        living = (
            [p for p in room.players.values() if p.alive]
            if room.combat_enabled and room.phase == Phase.ACTIVE
            else []
        )
        for scout in living:
            for target in living:
                if target.team != scout.team and raycast.visible(scout, target, room):
                    room.team_contacts[scout.team][target.id] = {
                        "id": target.id,
                        "team": target.team,
                        "x": round(target.x, 3),
                        "z": round(target.z, 3),
                        "yaw": round(target.yaw, 3),
                        "seenAtMs": round(now * 1000),
                    }
        for team in Team:
            for identifier, contact in list(room.team_contacts[team].items()):
                target = room.players.get(identifier)
                if (
                    now * 1000 - contact["seenAtMs"] > config.CONTACT_TTL * 1000
                    or target is None
                    or not target.alive
                ):
                    del room.team_contacts[team][identifier]
        for viewer in room.players.values():
            peer = self.peers.get(viewer.id)
            if not viewer.connected or peer is None:
                continue
            players = [
                p.transform(now, room.combat_enabled)
                for p in room.players.values()
                if p.connected and raycast.visible(viewer, p, room)
            ]
            grenades = [
                g.public()
                for g in room.grenades.values()
                if g.owner_id == viewer.id
                or (
                    math.hypot(viewer.x - g.x, viewer.z - g.z) < config.VISION_RANGE
                    and raycast.clear_segment((viewer.x, 1.65, viewer.z), (g.x, g.y, g.z), room)
                )
            ]
            visible_ids = {p["id"] for p in players}
            contacts = (
                [
                    {
                        **c,
                        "state": "visible"
                        if c["id"] in visible_ids
                        else "team"
                        if c["seenAtMs"] == round(now * 1000)
                        else "last",
                    }
                    for c in room.team_contacts[viewer.team].values()
                ]
                if room.combat_enabled
                else []
            )
            peer.send(
                {**common, "players": players, "grenades": grenades, "contacts": contacts},
                snapshot=True,
            )

    def tick(self, dt):
        now = self.clock()
        for room in list(self.rooms.values()):
            for p in list(room.players.values()):
                if (
                    p.disconnected_at is not None
                    and now - p.disconnected_at >= config.RECONNECT_GRACE
                ):
                    self._remove(room, p.id)
            if room.code not in self.rooms:
                continue
            if (
                room.phase in (Phase.LOBBY, Phase.RESULTS)
                and now - room.activity_at >= config.ROOM_IDLE_SECONDS
            ):
                self._close(room, "Inactive room expired. Create or join a new room.")
                continue
            if room.phase_ends_at is not None and now >= room.phase_ends_at:
                if room.phase == Phase.COUNTDOWN:
                    room.phase = Phase.ACTIVE
                    room.started_at = now
                    room.phase_ends_at = now + room.settings.timeLimitSeconds
                    for p in room.players.values():
                        p.status = PlayerStatus.ALIVE if p.connected else PlayerStatus.DISCONNECTED
                elif room.phase == Phase.ACTIVE and not room.combat_enabled:
                    room.phase = Phase.ENDING
                    room.phase_ends_at = now + 0.6
                    for p in room.players.values():
                        p.stop()
                elif room.phase == Phase.ENDING:
                    room.phase = Phase.RESULTS
                    room.phase_ends_at = None
                    room.activity_at = now
                self.publish(room)
                self.snapshot(room)
            if room.phase == Phase.ACTIVE:
                if (
                    room.combat_enabled
                    and self.bots
                    and any(p.connected and not p.is_bot for p in room.players.values())
                ):
                    self.bots.tick(room, dt)
                volumes = (
                    self.combat.obstacles(room)
                    if room.combat_enabled
                    else room.map_data["obstacles"]
                )
                for p in room.players.values():
                    if (
                        not p.connected
                        or (room.combat_enabled and not p.alive)
                        or now - p.input_at > config.INPUT_TIMEOUT
                    ):
                        p.stop()
                        continue
                    speed = config.SPRINT_SPEED if p.sprint else config.WALK_SPEED
                    if room.combat_enabled:
                        speed *= (
                            config.CROUCH_SPEED_FACTOR
                            if p.crouch
                            else config.ADS_SPEED_FACTOR
                            if p.ads
                            else 1
                        )
                    before_x, before_z = p.x, p.z
                    p.x, p.z = physics.move(
                        p.x, p.z, p.move_x * speed * dt, p.move_z * speed * dt, volumes
                    )
                    p.vx, p.vz = (p.x - before_x) / dt, (p.z - before_z) / dt
                    p.ack_seq = p.input_seq
                    p.movement = (
                        ("crouch" if p.crouch else "sprint" if p.sprint else "walk")
                        if math.hypot(p.vx, p.vz) > 0.05
                        else "idle"
                    )
                if room.combat_enabled:
                    # Resolve living capsule contacts symmetrically; corpses and
                    # disconnected reservations must never become invisible walls.
                    alive = [p for p in room.players.values() if p.alive]
                    for _ in range(2):
                        for i, a in enumerate(alive):
                            for b in alive[i + 1 :]:
                                dx, dz = b.x - a.x, b.z - a.z
                                distance = math.hypot(dx, dz)
                                minimum = config.PLAYER_RADIUS * 2
                                if distance >= minimum - 1e-6:
                                    continue
                                if distance < 1e-6:
                                    dx, dz, distance = 1.0, 0.0, 1.0
                                    correction = minimum / 2
                                else:
                                    correction = (minimum - distance) / 2
                                nx, nz = dx / distance, dz / distance
                                a.x, a.z = physics.move(
                                    a.x, a.z, -nx * correction, -nz * correction, volumes
                                )
                                b.x, b.z = physics.move(
                                    b.x, b.z, nx * correction, nz * correction, volumes
                                )
                    self.combat.tick(room, dt)
                    victory = self.matches.victory(room)
                    if victory:
                        self.matches.finish(room, *victory)
                        self.snapshot(room)
                if now - room.last_snapshot_at >= 1 / config.SNAPSHOT_HZ - 0.001:
                    self.snapshot(room)
            elif room.phase == Phase.COUNTDOWN and now - room.last_snapshot_at >= 0.2:
                self.snapshot(room)
        for peer in list(self.peers.values()):
            if now - peer.ping_sent_at >= config.PING_INTERVAL and peer.ping_nonce is None:
                peer.ping_nonce = secrets.token_hex(8)
                peer.ping_sent_at = now
                peer.send({"type": "ping", "nonce": peer.ping_nonce})
            if now - peer.last_pong_at > config.HEARTBEAT_TIMEOUT:
                peer.send(
                    {
                        "type": "error",
                        "code": "HEARTBEAT_TIMEOUT",
                        "message": "Connection timed out; reconnect to restore your slot.",
                    }
                )
                self.detach(peer)
                ws = getattr(peer, "ws", None)
                if ws:
                    asyncio.create_task(ws.close(code=4408, reason="Heartbeat timeout"))

    async def _run(self):
        step, last, accumulator = 1 / config.TICK_HZ, self.clock(), 0.0
        try:
            while self.running:
                await asyncio.sleep(max(0.001, step - accumulator))
                now = self.clock()
                accumulator = min(accumulator + max(0, now - last), 5 * step)
                last = now
                while accumulator >= step:
                    self.tick(step)
                    accumulator -= step
        except Exception:
            logger.exception(
                "Room authority failed; closing every match rather than simulating success"
            )
            self.running = False
            for room in list(self.rooms.values()):
                self._close(
                    room,
                    "Server authority stopped. The room was closed; retry after the server restarts.",
                )
