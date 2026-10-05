"""Two independent real sockets enter/start/synchronize on each of ten selected levels.

Only legal player intent is sent. Also verifies simultaneous different-map public
rooms and that a mouse-style ground target is the actual authoritative frag landing.
"""

import argparse
import asyncio
import math
import secrets

from verify_arena_combat import intent
from verify_arena_network import Client, expected_error, pose, until


async def verify(url):
    tag = secrets.token_hex(2)
    first, second = Client(url, f"Map-A-{tag}"), Client(url, f"Map-B-{tag}")
    try:
        await first.initialize()
        await second.initialize()
        response = await first.http.get("/arena/api/config")
        response.raise_for_status()
        config = response.json()
        assert config["protocolVersion"] == 3 and len(config["maps"]) == 10
        for field in config["maps"]:
            identifier = field["id"]
            await first.action(
                "create_room",
                settings={
                    "mapId": identifier,
                    "teamSize": 1,
                    "mode": "NETWORK_DRILL",
                    "timeLimitSeconds": 120,
                },
            )
            await second.action("join_room", code=first.room["code"])
            await until(
                lambda: all(
                    c.snapshot and c.room and len(c.room["players"]) == 2 for c in (first, second)
                ),
                "Selected-map roster and snapshots",
            )
            assert first.room["mapId"] == second.room["mapId"] == identifier
            await first.action("ready", ready=True)
            await second.action("ready", ready=True)
            await first.action("start")
            await until(
                lambda: all(c.room["phase"] == "ACTIVE" for c in (first, second)),
                "Shared selected-map active match",
            )
            assert first.room["matchId"] == second.room["matchId"]
            initial = pose(first, first.id)
            for _ in range(8):
                await intent(first, 1, 0, 0.8)
                await asyncio.sleep(1 / 30)
            await intent(first, 0, 0, 0.8)
            await until(
                lambda: any(
                    p["id"] == first.id and p["x"] > initial["x"] + 0.3
                    for p in second.snapshot["players"]
                ),
                "Peer observes authority motion on chosen geometry",
            )
            await first.action("return_lobby")
            await second.action("leave")
            await first.action("leave")
            print(
                f"PASS: {identifier}: real two-client map selection, spawn, active timer and movement replication"
            )
        # Public matching is separated by map, without undisclosed bots.
        await first.action("quick_play", mapId="bunker")
        await second.action("quick_play", mapId="dockyard")
        assert first.room["id"] != second.room["id"]
        assert first.room["mapId"] == "bunker" and second.room["mapId"] == "dockyard"
        assert not any(p["isBot"] for c in (first, second) for p in c.room["players"])
        await second.action("leave")
        await second.action("quick_play", mapId="bunker")
        await until(lambda: first.room["id"] == second.room["id"], "Same-map public matching")
        await second.action("leave")
        await first.action("leave")
        # A targeted grenade uses server launch/fuse/physics; no test teleport API.
        await first.action(
            "create_room",
            settings={
                "mapId": "courtyard",
                "teamSize": 1,
                "mode": "TEAM_DEATHMATCH",
                "scoreLimit": 50,
            },
        )
        await second.action("join_room", code=first.room["code"])
        await first.action("ready", ready=True)
        await second.action("ready", ready=True)
        await first.action("start")
        await until(
            lambda: first.room["phase"] == "ACTIVE" and second.room["phase"] == "ACTIVE",
            "Live grenade match",
        )
        await until(
            lambda: first.snapshot and pose(first, first.id).get("combat"), "Server-owned inventory"
        )
        await expected_error(first, "grenade", "GRENADE_OUT_OF_RANGE", targetX=20, targetZ=-18)
        assert pose(first, first.id)["combat"]["grenades"] == 2
        await first.action("grenade", targetX=6, targetZ=18)
        await until(
            lambda: any(g["landed"] for g in first.snapshot["grenades"]),
            "Physics-derived targeted landing",
            timeout=3,
        )
        grenade = next(g for g in first.snapshot["grenades"] if g["landed"])
        assert not grenade["blocked"] and math.hypot(grenade["x"] - 6, grenade["z"] - 18) < 0.03
        assert grenade["target"] == {"x": 6.0, "y": 0.09, "z": 18.0}
        print(
            "PASS: same-map-only public matching, human-only rooms, real targeted grenade range rejection and <3cm ground landing"
        )
        await first.action("return_lobby")
        await second.action("leave")
        await first.action("leave")
    finally:
        await asyncio.gather(first.close(), second.close())


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", default="http://127.0.0.1:8000")
    asyncio.run(verify(parser.parse_args().url))
