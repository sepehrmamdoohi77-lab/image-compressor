"""Bounded reliable events + latest-only transform snapshots per connection."""

import asyncio
import json
from collections import deque
from typing import Protocol

from fastapi import WebSocket


class PeerProtocol(Protocol):
    id: str
    name: str
    room_code: str | None
    ping_nonce: str | None
    ping_sent_at: float
    last_pong_at: float

    def send(self, payload: dict, snapshot: bool = False, transient: bool = False) -> None: ...


class Peer:
    def __init__(self, websocket: WebSocket, profile: dict, now: float):
        self.ws = websocket
        self.id = profile["id"]
        self.name = profile["name"]
        self.profile = profile
        self.room_code: str | None = None
        self.ping_nonce: str | None = None
        self.ping_sent_at = now
        self.last_pong_at = now
        self.events: deque[str] = deque()
        self.latest_snapshot: str | None = None
        self.transients: deque[str] = deque(maxlen=24)
        self.wake = asyncio.Event()
        self.overflowed = False

    def send(self, payload: dict, snapshot: bool = False, transient: bool = False) -> None:
        encoded = json.dumps(payload, separators=(",", ":"), allow_nan=False)
        if snapshot:
            self.latest_snapshot = encoded
        elif transient:
            self.transients.append(encoded)
        elif len(self.events) < 32:
            self.events.append(encoded)
        else:
            self.overflowed = True
        self.wake.set()

    async def pump(self) -> None:
        while True:
            await self.wake.wait()
            self.wake.clear()
            if self.overflowed:
                await self.ws.close(
                    code=1013, reason="Slow connection; reconnect to resynchronize."
                )
                return
            while self.events:
                await asyncio.wait_for(self.ws.send_text(self.events.popleft()), timeout=2)
            if self.latest_snapshot is not None:
                encoded, self.latest_snapshot = self.latest_snapshot, None
                await asyncio.wait_for(self.ws.send_text(encoded), timeout=2)
            while self.transients:
                await asyncio.wait_for(self.ws.send_text(self.transients.popleft()), timeout=2)
