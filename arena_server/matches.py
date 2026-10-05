"""Authoritative TDM victory and frozen, idempotently persisted results."""

import asyncio
import logging

from . import config
from .models import ArenaError, Phase
from .progression import reward

logger = logging.getLogger("tactical_arena.results")


class MatchSystem:
    def __init__(self, clock, emit, dirty, repository=None, profile_update=None):
        self.clock, self.emit, self.dirty = clock, emit, dirty
        self.repository = repository
        self.profile_update = profile_update or (lambda profile: None)
        self.pending_tasks = set()

    def victory(self, room):
        now = self.clock()
        scores = room.scores
        if max(scores.values()) >= room.settings.scoreLimit:
            return self.winner(scores), "score_limit"
        if room.phase_ends_at is not None and now >= room.phase_ends_at:
            return self.winner(scores), "time_limit"
        connected_teams = {p.team for p in room.players.values() if p.connected}
        humans = [p for p in room.players.values() if p.connected and not p.is_bot]
        if not humans:
            return None
        if len(connected_teams) == 1:
            missing = "red" if "blue" in connected_teams else "blue"
            if room.forfeit_at is None or room.forfeit_team != missing:
                room.forfeit_at = now + config.RECONNECT_GRACE
                room.forfeit_team = missing
            elif now >= room.forfeit_at:
                return "blue" if missing == "red" else "red", "forfeit"
        else:
            room.forfeit_at = room.forfeit_team = None
        return None

    @staticmethod
    def winner(scores):
        return (
            "draw"
            if scores["blue"] == scores["red"]
            else "blue"
            if scores["blue"] > scores["red"]
            else "red"
        )

    def finish(self, room, winner, reason):
        if room.phase != Phase.ACTIVE:
            return
        now = self.clock()
        room.phase = Phase.ENDING
        room.phase_ends_at = now + 0.8
        room.grenades.clear()
        rows = []
        for p in room.participants.values():
            p.stop()
            outcome = "draw" if winner == "draw" else "win" if winner == p.team else "loss"
            eligible = not p.is_bot and p.connected and not p.disqualified
            participated = (
                p.active_seconds >= 15
                or p.stats.kills > 0
                or p.stats.assists > 0
                or p.stats.deaths > 0
                or p.stats.shots > 0
            )
            xp = reward(
                p.stats.public(), outcome == "win", eligible and participated, room.practice
            )
            rows.append(
                {
                    "id": p.id,
                    "name": p.name,
                    "team": p.team,
                    "isBot": p.is_bot,
                    "eligible": eligible and not room.practice,
                    "stats": p.stats.public(),
                    "weaponShots": dict(p.stats.weapon_shots),
                    "outcome": outcome,
                    "xpPlanned": xp,
                    "xpEarned": 0 if room.practice or not eligible else None,
                    "levelBefore": p.level,
                    "levelAfter": p.level,
                }
            )
        room.results = {
            "winner": winner,
            "reason": reason,
            "scores": dict(room.scores),
            "practice": room.practice,
            "endedAtMs": round(now * 1000),
            "persistence": "not_required",
            "error": None,
            "players": rows,
        }
        self.emit(room, {"kind": "round_end", "winner": winner, "reason": reason})
        self.dirty(room)
        self.save(room)

    def save(self, room):
        results = room.results
        if results is None:
            raise ArenaError("NO_RESULTS", "There are no completed results to save.")
        if room.award_task is not None and not room.award_task.done():
            raise ArenaError("SAVING_RESULTS", "Result persistence is already in progress.")
        eligible = [row for row in results["players"] if row["eligible"]]
        if not eligible or self.repository is None:
            results["persistence"] = "not_required"
            for row in results["players"]:
                row["xpEarned"] = 0
            return
        results["persistence"] = "saving"
        results["error"] = None

        async def persist():
            try:
                for row in eligible:
                    payload = {
                        "outcome": row["outcome"],
                        "stats": row["stats"],
                        "weaponShots": row["weaponShots"],
                        "scores": results["scores"],
                        "xpEarned": row["xpPlanned"],
                    }
                    stored = await asyncio.to_thread(
                        self.repository.award, room.match_id, row["id"], payload
                    )
                    row["xpEarned"] = stored["receipt"]["xpEarned"]
                    row["levelAfter"] = stored["profile"]["level"]
                    self.profile_update(stored["profile"])
                results["persistence"] = "saved"
            except Exception:
                logger.exception("Match result save failed; receipt can be retried safely")
                results["persistence"] = "error"
                results["error"] = (
                    "Progress could not be saved. Retry results before returning to lobby."
                )
            self.dirty(room)

        room.award_task = asyncio.create_task(persist(), name=f"arena-award-{room.match_id}")
        self.pending_tasks.add(room.award_task)
        room.award_task.add_done_callback(self.pending_tasks.discard)

    async def drain(self):
        if self.pending_tasks:
            await asyncio.gather(*self.pending_tasks, return_exceptions=True)
