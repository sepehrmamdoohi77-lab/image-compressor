"""Durable guest profiles and idempotent server-only match awards.

Only identities/loadout preferences come from HTTP requests. Combat counters,
XP and history are written from frozen authoritative match results.
"""

import hashlib
import json
import re
import secrets
import sqlite3
import time
import uuid
from contextlib import contextmanager
from pathlib import Path

from .progression import empty_stats, level_data
from .session_auth import TOKEN_RE, TRANSPORT_SECONDS
from .weapons import COSMETICS, PRIMARY_WEAPONS

NAME_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9 _.-]{2,19}$")
COOKIE_NAME = "ta_guest"
SESSION_SECONDS = 30 * 24 * 60 * 60


def validate_name(name):
    name = name.strip()
    if not NAME_RE.fullmatch(name):
        raise ValueError("Use 3–20 letters, numbers, spaces, underscores, dots or hyphens.")
    return name


class ProfileRepository:
    def __init__(self, path: Path):
        self.path = path

    @contextmanager
    def connection(self):
        conn = sqlite3.connect(self.path, timeout=5)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON")
        try:
            with conn:
                yield conn
        finally:
            conn.close()

    def initialize(self):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self.connection() as db:
            db.execute("PRAGMA journal_mode = WAL")
            db.executescript("""
                CREATE TABLE IF NOT EXISTS profiles (id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at INTEGER NOT NULL);
                CREATE TABLE IF NOT EXISTS guest_sessions (token_hash TEXT PRIMARY KEY, profile_id TEXT NOT NULL REFERENCES profiles(id), expires_at INTEGER NOT NULL);
                CREATE INDEX IF NOT EXISTS sessions_expiry ON guest_sessions(expires_at);
                CREATE TABLE IF NOT EXISTS transport_sessions (
                    token_hash TEXT PRIMARY KEY,
                    profile_id TEXT NOT NULL REFERENCES profiles(id),
                    expires_at INTEGER NOT NULL
                );
                CREATE INDEX IF NOT EXISTS transport_expiry ON transport_sessions(expires_at);
            """)
            columns = {r["name"] for r in db.execute("PRAGMA table_info(profiles)")}
            for column, ddl in [
                ("xp", "INTEGER NOT NULL DEFAULT 0"),
                ("stats_json", "TEXT NOT NULL DEFAULT '{}'"),
                ("primary_weapon", "TEXT NOT NULL DEFAULT 'rifle'"),
                ("cosmetic", "TEXT NOT NULL DEFAULT 'olive'"),
            ]:
                if column not in columns:
                    db.execute(f"ALTER TABLE profiles ADD COLUMN {column} {ddl}")
            db.executescript("""
                CREATE TABLE IF NOT EXISTS match_awards (
                    match_id TEXT NOT NULL,
                    profile_id TEXT NOT NULL REFERENCES profiles(id),
                    payload_hash TEXT NOT NULL,
                    receipt_json TEXT NOT NULL,
                    created_at INTEGER NOT NULL,
                    PRIMARY KEY (match_id, profile_id)
                );
                CREATE INDEX IF NOT EXISTS awards_profile ON match_awards(profile_id, created_at DESC);
            """)
            db.execute("DELETE FROM guest_sessions WHERE expires_at < ?", (int(time.time()),))

    def _public(self, row, history=None):
        stats = {**empty_stats(), **json.loads(row["stats_json"])}
        shots = stats.get("weaponShots", {})
        favourite = max(shots, key=shots.get) if shots and max(shots.values()) > 0 else None
        return {
            "id": row["id"],
            "name": row["name"],
            "createdAt": row["created_at"],
            "kind": "guest",
            **level_data(row["xp"]),
            "stats": stats,
            "favoriteWeapon": favourite,
            "loadout": {
                "primary": row["primary_weapon"],
                "secondary": "pistol",
                "grenade": "frag",
                "cosmetic": row["cosmetic"],
            },
            "history": history or [],
        }

    def get_by_id(self, profile_id):
        with self.connection() as db:
            row = db.execute("SELECT * FROM profiles WHERE id = ?", (profile_id,)).fetchone()
            if row is None:
                return None
            history = [
                json.loads(r["receipt_json"])
                for r in db.execute(
                    "SELECT receipt_json FROM match_awards WHERE profile_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 5",
                    (profile_id,),
                )
            ]
        return self._public(row, history)

    def get(self, token):
        if not token or len(token) > 128:
            return None
        with self.connection() as db:
            row = db.execute(
                "SELECT profile_id FROM guest_sessions WHERE token_hash = ? AND expires_at > ?",
                (hashlib.sha256(token.encode()).hexdigest(), int(time.time())),
            ).fetchone()
        return self.get_by_id(row["profile_id"]) if row else None

    def get_transport(self, token):
        if not isinstance(token, str) or not TOKEN_RE.fullmatch(token):
            return None
        with self.connection() as db:
            row = db.execute(
                "SELECT profile_id FROM transport_sessions WHERE token_hash = ? AND expires_at > ?",
                (hashlib.sha256(token.encode()).hexdigest(), int(time.time())),
            ).fetchone()
        return self.get_by_id(row["profile_id"]) if row else None

    def issue_transport(self, profile_id, existing_token=None):
        now = int(time.time())
        expires = now + TRANSPORT_SECONDS
        with self.connection() as db:
            db.execute("BEGIN IMMEDIATE")
            if db.execute("SELECT id FROM profiles WHERE id = ?", (profile_id,)).fetchone() is None:
                raise ValueError("Guest identity is unavailable.")
            row = None
            if isinstance(existing_token, str) and TOKEN_RE.fullmatch(existing_token):
                row = db.execute(
                    "SELECT profile_id FROM transport_sessions WHERE token_hash = ? AND expires_at > ?",
                    (hashlib.sha256(existing_token.encode()).hexdigest(), now),
                ).fetchone()
            token = (
                existing_token
                if row and row["profile_id"] == profile_id
                else secrets.token_urlsafe(32)
            )
            digest = hashlib.sha256(token.encode()).hexdigest()
            db.execute(
                "INSERT INTO transport_sessions VALUES (?, ?, ?) ON CONFLICT(token_hash) DO UPDATE SET expires_at = excluded.expires_at",
                (digest, profile_id, expires),
            )
            db.execute("DELETE FROM transport_sessions WHERE expires_at <= ?", (now,))
            # Keep a bounded number of tab grants; the current grant has the latest expiry.
            db.execute(
                "DELETE FROM transport_sessions WHERE profile_id = ? AND token_hash NOT IN "
                "(SELECT token_hash FROM transport_sessions WHERE profile_id = ? ORDER BY expires_at DESC, rowid DESC LIMIT 32)",
                (profile_id, profile_id),
            )
        return {"transportToken": token, "transportExpiresAt": expires}

    def save(self, name, token=None, *, transport_token=None):
        name = validate_name(name)
        cookie_profile = self.get(token)
        existing = self.get_transport(transport_token) if transport_token else cookie_profile
        if transport_token and existing is None:
            raise ValueError("Guest transport authorization expired.")
        now = int(time.time())
        with self.connection() as db:
            if existing:
                profile_id = existing["id"]
                db.execute("UPDATE profiles SET name = ? WHERE id = ?", (name, profile_id))
                if cookie_profile and cookie_profile["id"] == profile_id:
                    db.execute(
                        "UPDATE guest_sessions SET expires_at = ? WHERE token_hash = ?",
                        (now + SESSION_SECONDS, hashlib.sha256(token.encode()).hexdigest()),
                    )
                else:
                    token = secrets.token_urlsafe(32)
                    db.execute(
                        "INSERT INTO guest_sessions VALUES (?, ?, ?)",
                        (
                            hashlib.sha256(token.encode()).hexdigest(),
                            profile_id,
                            now + SESSION_SECONDS,
                        ),
                    )
            else:
                token = secrets.token_urlsafe(32)
                profile_id = str(uuid.uuid4())
                db.execute(
                    "INSERT INTO profiles (id, name, created_at, stats_json) VALUES (?, ?, ?, ?)",
                    (profile_id, name, now, json.dumps(empty_stats())),
                )
                db.execute(
                    "INSERT INTO guest_sessions VALUES (?, ?, ?)",
                    (hashlib.sha256(token.encode()).hexdigest(), profile_id, now + SESSION_SECONDS),
                )
        return self.get_by_id(profile_id), token

    def loadout(self, profile_id, primary, cosmetic):
        if primary not in PRIMARY_WEAPONS or cosmetic not in COSMETICS:
            raise ValueError("Choose a supported weapon and operator finish.")
        with self.connection() as db:
            db.execute(
                "UPDATE profiles SET primary_weapon = ?, cosmetic = ? WHERE id = ?",
                (primary, cosmetic, profile_id),
            )
        return self.get_by_id(profile_id)

    def award(self, match_id, profile_id, result):
        """Atomic and replay-safe. Input is captured from server MatchSystem only."""
        encoded = json.dumps(result, sort_keys=True, separators=(",", ":"), allow_nan=False)
        fingerprint = hashlib.sha256(encoded.encode()).hexdigest()
        with self.connection() as db:
            db.execute("BEGIN IMMEDIATE")
            old = db.execute(
                "SELECT * FROM match_awards WHERE match_id = ? AND profile_id = ?",
                (match_id, profile_id),
            ).fetchone()
            if old:
                if old["payload_hash"] != fingerprint:
                    raise ValueError(
                        "Result receipt mismatch; refusing to overwrite persistent stats."
                    )
                receipt = json.loads(old["receipt_json"])
            else:
                row = db.execute("SELECT * FROM profiles WHERE id = ?", (profile_id,)).fetchone()
                if row is None:
                    raise ValueError("Persistent player identity is unavailable.")
                stats = {**empty_stats(), **json.loads(row["stats_json"])}
                match_stats = result["stats"]
                for key in ("kills", "deaths", "assists", "shots", "hits", "headshots", "damage"):
                    stats[key] += match_stats[key]
                stats["matches"] += 1
                stats[
                    "wins"
                    if result["outcome"] == "win"
                    else "losses"
                    if result["outcome"] == "loss"
                    else "draws"
                ] += 1
                for weapon, amount in result["weaponShots"].items():
                    stats["weaponShots"][weapon] = stats["weaponShots"].get(weapon, 0) + amount
                new_xp = row["xp"] + result["xpEarned"]
                receipt = {
                    "matchId": match_id,
                    "at": int(time.time()),
                    "outcome": result["outcome"],
                    "scores": result["scores"],
                    "stats": match_stats,
                    "xpEarned": result["xpEarned"],
                    "levelAfter": level_data(new_xp)["level"],
                }
                db.execute(
                    "UPDATE profiles SET xp = ?, stats_json = ? WHERE id = ?",
                    (new_xp, json.dumps(stats), profile_id),
                )
                db.execute(
                    "INSERT INTO match_awards VALUES (?, ?, ?, ?, ?)",
                    (match_id, profile_id, fingerprint, json.dumps(receipt), int(time.time())),
                )
        return {"profile": self.get_by_id(profile_id), "receipt": receipt}
