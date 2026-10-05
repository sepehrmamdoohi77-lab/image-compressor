"""Registered real modes. Future modes supply their own authoritative rules."""

from typing import Protocol

from .models import Room


class MatchRules(Protocol):
    mode: str

    def validate_start(self, room: Room) -> str | None: ...


class NetworkDrillRules:
    mode = "NETWORK_DRILL"

    def validate_start(self, room: Room):
        connected = [p for p in room.players.values() if p.connected]
        if len(connected) < 2 or len({p.team for p in connected}) < 2:
            return "Invite at least one operator on each team to start the field test."
        if any(not p.ready for p in connected):
            return "Every connected operator must be ready."
        return None


class TeamDeathmatchRules(NetworkDrillRules):
    mode = "TEAM_DEATHMATCH"

    def validate_start(self, room):
        if not any(p.connected and not p.is_bot for p in room.players.values()):
            return "A real human operator is required to start a match."
        return super().validate_start(room)


RULES = {"NETWORK_DRILL": NetworkDrillRules(), "TEAM_DEATHMATCH": TeamDeathmatchRules()}
