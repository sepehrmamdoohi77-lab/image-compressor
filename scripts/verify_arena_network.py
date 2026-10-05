"""Run real 2/4/8-client WebSocket acceptance tests against a running server.

No room-service mocks: every session uses HTTP + its own authenticated socket.
Scheduled input delays/reordering exercise the actual server protocol. Tokens
remain in memory and are never written to logs or test artifacts.

Usage: .venv/bin/python scripts/verify_arena_network.py --url http://127.0.0.1:8000
"""

import argparse
import asyncio
import json
import math
import random
import secrets
import time
from urllib.parse import urlsplit

import httpx
from websockets.asyncio.client import connect


class ActionError(Exception):
    def __init__(self, code, message):
        super().__init__(message)
        self.code = code


class Client:
    def __init__(self, base_url, name):
        self.base = base_url.rstrip("/")
        self.name = name
        self.http = httpx.AsyncClient(base_url=self.base, timeout=8)
        self.ws = None
        self.reader = None
        self.id = None
        self.token = None
        self.room = None
        self.snapshot = None
        self.pending = {}
        self.welcome = asyncio.Event()
        self.request_seq = self.input_seq = 0
        self.delayed = set()

    async def initialize(self):
        response = await self.http.post("/arena/api/session", json={"name": self.name})
        response.raise_for_status()
        self.id = response.json()["profile"]["id"]
        self.token = self.http.cookies.get("ta_guest")
        await self.attach()

    async def attach(self):
        parsed = urlsplit(self.base)
        scheme = "wss" if parsed.scheme == "https" else "ws"
        self.welcome.clear()
        self.room = self.snapshot = None
        self.ws = await connect(
            f"{scheme}://{parsed.netloc}/arena/ws",
            additional_headers={
                "Cookie": f"ta_guest={self.token}",
                "Origin": f"{parsed.scheme}://{parsed.netloc}",
            },
            open_timeout=8,
            max_size=32000,
            ping_interval=None,
        )
        self.reader = asyncio.create_task(self._read())
        await asyncio.wait_for(self.welcome.wait(), 8)

    async def _read(self):
        async for raw in self.ws:
            data = json.loads(raw)
            kind = data["type"]
            if kind == "ping":
                await self.ws.send(json.dumps({"type": "pong", "nonce": data["nonce"]}))
            elif kind == "welcome":
                assert data["playerId"] == self.id
                self.welcome.set()
            elif kind == "room_state":
                self.room = data["room"]
                if self.room is None:
                    self.snapshot = None
            elif kind == "snapshot" and self.room and data["roomId"] == self.room["id"]:
                self.snapshot = data
                own = next((p for p in data["players"] if p["id"] == self.id), None)
                if own:
                    self.input_seq = max(self.input_seq, own["ackSeq"] + 1)
            elif kind in ("ack", "error"):
                future = self.pending.get(data.get("requestId"))
                if future and not future.done():
                    if kind == "ack":
                        future.set_result(data)
                    else:
                        future.set_exception(ActionError(data["code"], data["message"]))

    async def action(self, kind, **kwargs):
        self.request_seq += 1
        request_id = f"qa-{self.request_seq}"
        future = asyncio.get_running_loop().create_future()
        self.pending[request_id] = future
        await self.ws.send(json.dumps({"type": kind, "requestId": request_id, **kwargs}))
        try:
            return await asyncio.wait_for(future, 8)
        finally:
            self.pending.pop(request_id, None)

    async def intent(self, move_x, aim=0.0, delay=0.0):
        self.input_seq += 1
        packet = json.dumps(
            {
                "type": "input",
                "seq": self.input_seq,
                "moveX": move_x,
                "moveZ": 0.0,
                "aim": aim,
                "sprint": False,
            }
        )
        if delay:

            async def send_later():
                await asyncio.sleep(delay)
                await self.ws.send(packet)

            task = asyncio.create_task(send_later())
            self.delayed.add(task)
            task.add_done_callback(self.delayed.discard)
        else:
            await self.ws.send(packet)

    async def detach(self):
        await self.ws.close()
        await self.reader

    async def close(self):
        for task in self.delayed:
            task.cancel()
        if self.ws:
            await self.ws.close()
        if self.reader:
            await self.reader
        await self.http.aclose()


async def until(predicate, message, timeout=8):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if predicate():
            return
        await asyncio.sleep(0.025)
    raise AssertionError(message)


async def expected_error(client, kind, expected_code, **data):
    try:
        await client.action(kind, **data)
    except ActionError as error:
        assert error.code == expected_code, (error.code, expected_code)
    else:
        raise AssertionError(f"Expected authoritative rejection: {expected_code}")


def pose(client, player_id):
    return next(p for p in client.snapshot["players"] if p["id"] == player_id)


async def scenario(url, count):
    tag = secrets.token_hex(2)
    clients = [Client(url, f"QA{count}-{i}-{tag}") for i in range(count)]
    extras = []
    try:
        for client in clients:
            await client.initialize()
        assert len({c.id for c in clients}) == count
        team_size = 4 if count == 4 else count // 2
        await clients[0].action(
            "create_room", settings={"teamSize": team_size, "timeLimitSeconds": 120}
        )
        code = clients[0].room["code"]
        for client in clients[1:]:
            await client.action("join_room", code=code)
        await until(
            lambda: all(
                c.room
                and len(c.room["players"]) == count
                and c.snapshot
                and len(c.snapshot["players"]) == count
                for c in clients
            ),
            "All clients must see the same roster and transforms",
        )
        player_ids = {c.id for c in clients}
        for client in clients:
            assert {p["id"] for p in client.room["players"]} == player_ids
            assert sum(p["team"] == "blue" for p in client.room["players"]) == count // 2
            assert client.room["combatEnabled"] is False
        await expected_error(clients[1], "start", "OWNER_ONLY")
        await expected_error(clients[0], "start", "NOT_READY")
        await expected_error(clients[0], "ready", "INVALID_MESSAGE", ready=True, health=999)
        for client in clients:
            await client.action("ready", ready=True)
        await clients[0].action("start")
        await until(
            lambda: all(c.room["phase"] == "COUNTDOWN" for c in clients), "Countdown synchronized"
        )
        await until(
            lambda: all(c.room["phase"] == "ACTIVE" for c in clients), "Active phase synchronized"
        )
        starting = {c.id: dict(pose(clients[0], c.id)) for c in clients}
        start = time.monotonic()
        rng = random.Random(count)
        # In the 4-client test, packets really arrive 0/120/220ms late and out of order.
        while time.monotonic() - start < 1.2:
            for i, client in enumerate(clients):
                delay = rng.choice([0.0, 0.12, 0.22]) if count == 4 else 0.0
                await client.intent(1.0, aim=0.1 + i * 0.1, delay=delay)
            await asyncio.sleep(1 / 30)
        for client in clients:
            await client.intent(0.0, aim=0.1)
        delayed = [task for c in clients for task in c.delayed]
        if delayed:
            await asyncio.gather(*delayed)
        await asyncio.sleep(0.35)
        elapsed = time.monotonic() - start
        for client in clients:
            for player_id in player_ids:
                p, initial = pose(client, player_id), starting[player_id]
                moved = math.hypot(p["x"] - initial["x"], p["z"] - initial["z"])
                assert 2 < moved <= elapsed * 3.8 + 0.25, moved
                assert p["movement"] == "idle"
                assert -22 < p["x"] < 22 and -22 < p["z"] < 22
                assert p["yaw"] == 0.1
        current = {c.id: dict(pose(clients[0], c.id)) for c in clients}
        await asyncio.sleep(0.25)
        assert all(pose(clients[0], c.id)["x"] == current[c.id]["x"] for c in clients), (
            "Old reordered input cannot restart movement"
        )
        ends = {c.room["phaseEndsAtMs"] for c in clients}
        matches = {c.room["matchId"] for c in clients}
        assert len(ends) == len(matches) == 1
        if count == 4:
            late = Client(url, f"QA-Late-{tag}")
            extras.append(late)
            await late.initialize()
            await late.action("join_room", code=code)
            await until(lambda: late.snapshot is not None, "Late join receives current transforms")
            assert late.room["phase"] == "ACTIVE"
            assert late.room["phaseEndsAtMs"] in ends and late.room["matchId"] in matches
            assert len(late.snapshot["players"]) == 5
            await late.action("leave")
        if count == 8:
            ninth = Client(url, f"QA-Ninth-{tag}")
            extras.append(ninth)
            await ninth.initialize()
            await expected_error(ninth, "join_room", "ROOM_FULL", code=code)
            assert ninth.room is None
        returning = clients[1]
        saved = next(p for p in clients[0].room["players"] if p["id"] == returning.id)
        saved_position = dict(pose(clients[0], returning.id))
        await returning.detach()
        await until(
            lambda: (
                not next(p for p in clients[0].room["players"] if p["id"] == returning.id)[
                    "connected"
                ]
            ),
            "Disconnected player marked immediately",
        )
        await returning.attach()
        await until(
            lambda: returning.snapshot is not None and returning.room["phase"] == "ACTIVE",
            "Reconnection restores current session",
        )
        assert (
            next(p for p in returning.room["players"] if p["id"] == returning.id)["team"]
            == saved["team"]
        )
        assert pose(returning, returning.id)["x"] == saved_position["x"]
        await clients[0].detach()
        await until(
            lambda: clients[1].room["ownerId"] == clients[1].id,
            "Room ownership migrates on owner disconnect",
        )
        await clients[0].attach()
        await until(
            lambda: clients[0].room is not None and clients[0].room["ownerId"] == clients[1].id,
            "Returning owner cannot seize the room",
        )
        await until(
            lambda: all(
                next(p for p in c.room["players"] if p["id"] == c.id)["latencyMs"] is not None
                for c in clients
            ),
            "Real heartbeat RTT measurement",
            timeout=8,
        )
        await clients[1].action("return_lobby")
        await until(
            lambda: all(c.room["phase"] == "LOBBY" for c in clients), "Return-to-lobby synchronized"
        )
        for client in clients:
            await client.action("leave")
        await until(
            lambda: all(c.room is None for c in clients), "Last-player leave cleans room state"
        )
        persisted = await clients[0].http.get("/arena/api/session")
        assert persisted.json()["profile"]["id"] == clients[0].id
        assert persisted.json()["roomCode"] is None
        print(
            f"PASS: {count} independent sockets — rooms, balanced teams, ready/start, bidirectional movement/facing, timer, reconnect, owner migration, persistence and cleanup"
            + ("; 120–220ms delayed/reordered inputs and late join" if count == 4 else "")
        )
    finally:
        await asyncio.gather(*(c.close() for c in clients + extras))


async def main(url):
    for count in (2, 4, 8):
        await scenario(url, count)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", default="http://127.0.0.1:8000")
    asyncio.run(main(parser.parse_args().url))
