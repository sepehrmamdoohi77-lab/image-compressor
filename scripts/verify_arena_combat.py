"""Real independent sockets: navigate real cover, shoot, win and persist results.
No exposed teleport/damage operation and no room-service mocks are used.
"""

import argparse
import asyncio
import math
import secrets
import time

from verify_arena_network import Client, expected_error, pose, until


async def intent(client, mx, mz, yaw=0.0, pitch=0.0, trigger=False, ads=False):
    client.input_seq += 1
    await client.ws.send(
        __import__("json").dumps(
            {
                "type": "input",
                "seq": client.input_seq,
                "moveX": mx,
                "moveZ": mz,
                "aim": yaw,
                "pitch": pitch,
                "sprint": False,
                "trigger": trigger,
                "ads": ads,
                "crouch": False,
            }
        )
    )


async def navigate(client, x, z, timeout=15):
    end = time.monotonic() + timeout
    while time.monotonic() < end:
        p = pose(client, client.id)
        dx, dz = x - p["x"], z - p["z"]
        distance = math.hypot(dx, dz)
        if distance < 0.14:
            await intent(client, 0.0, 0.0)
            return
        speed_scale = min(1, distance / 0.5)
        await intent(client, dx / distance * speed_scale, dz / distance * speed_scale)
        await asyncio.sleep(1 / 30)
    raise AssertionError(
        f"Could not navigate {client.name} to legal waypoint {x},{z}; current={pose(client, client.id)}"
    )


async def scenario(url):
    tag = secrets.token_hex(2)
    a = Client(url, f"Combat-A-{tag}")
    b = Client(url, f"Combat-B-{tag}")
    try:
        await a.initialize()
        await b.initialize()
        # Actual authenticated preference endpoint, not a client-owned weapon stat.
        await a.http.post("/arena/api/loadout", json={"primary": "dmr", "cosmetic": "slate"})
        await a.action(
            "create_room",
            settings={
                "mode": "TEAM_DEATHMATCH",
                "teamSize": 1,
                "scoreLimit": 1,
                "timeLimitSeconds": 120,
            },
        )
        await b.action("join_room", code=a.room["code"])
        await a.action("ready", ready=True)
        await b.action("ready", ready=True)
        await a.action("start")
        await until(
            lambda: a.room["phase"] == "ACTIVE" and b.room["phase"] == "ACTIVE",
            "Real synchronized active combat",
        )
        await until(
            lambda: a.snapshot and pose(a, a.id).get("combat") is not None,
            "Combat inventory snapshot",
        )
        assert pose(a, a.id)["combat"]["weaponId"] == "dmr"
        assert pose(a, a.id)["combat"]["health"] == 100
        # Both walk down a real navigable left lane. No state is relocated by tests.
        await asyncio.gather(navigate(a, -10.6, 18), navigate(b, -10.6, -18))
        await asyncio.gather(navigate(a, -10.6, 0), navigate(b, -10.6, -4))
        await until(
            lambda: (
                any(p["id"] == b.id for p in a.snapshot["players"])
                and any(p["id"] == a.id for p in b.snapshot["players"])
            ),
            "Enemy visibility really opens on unobstructed lane",
        )
        await expected_error(a, "reload", "MAGAZINE_FULL")
        await a.action("switch_weapon", slot=2)
        await until(
            lambda: pose(a, a.id)["combat"]["weaponId"] == "pistol", "Real secondary switch"
        )
        await a.action("switch_weapon", slot=1)
        await asyncio.sleep(0.75)
        shooter = pose(a, a.id)
        target = pose(a, b.id)
        yaw = math.atan2(target["x"] - shooter["x"], target["z"] - shooter["z"])
        pitch = math.atan2(
            1.65 - 1.21, math.hypot(target["x"] - shooter["x"], target["z"] - shooter["z"])
        )
        # ADS reaches its server-controlled settling time before the trigger edge.
        for _ in range(12):
            await intent(a, 0.0, 0.0, yaw, pitch, False, True)
            await asyncio.sleep(1 / 30)
        await intent(a, 0.0, 0.0, yaw, pitch, True, True)
        await asyncio.sleep(0.08)
        await intent(a, 0.0, 0.0, yaw, pitch, False, True)
        await until(
            lambda: (
                a.room["phase"] in ("ENDING", "RESULTS")
                and b.room["phase"] in ("ENDING", "RESULTS")
            ),
            "Authoritative lethal shot ends both clients round",
            timeout=8,
        )
        await until(
            lambda: (
                a.room["results"]["persistence"] == "saved"
                and b.room["results"]["persistence"] == "saved"
            ),
            "Committed results replicated to both clients",
        )
        assert a.room["scores"] == b.room["scores"] == {"blue": 1, "red": 0}
        result = a.room["results"]
        assert result["winner"] == "blue" and result["reason"] == "score_limit"
        assert pose(b, b.id)["combat"]["health"] == 0
        assert a.room["killfeed"][-1]["headshot"] is True
        record = (await a.http.get("/arena/api/session")).json()["profile"]
        assert (
            record["stats"]["kills"] == record["stats"]["wins"] == record["stats"]["matches"] == 1
        )
        assert record["stats"]["headshots"] == 1 and record["favoriteWeapon"] == "dmr"
        assert record["xp"] == 300 and record["history"][0]["matchId"] == a.room["matchId"]
        await a.action("retry_results")
        await asyncio.sleep(0.2)
        assert (await a.http.get("/arena/api/session")).json()["profile"]["xp"] == 300
        await until(lambda: a.room["phase"] == "RESULTS", "Both clients receive frozen results")
        await a.action("return_lobby")
        await until(lambda: b.room["phase"] == "LOBBY", "Real rematch lobby")
        await b.action("leave")
        await a.action("leave")
        print(
            "PASS: two real sockets, legal cover navigation, mutual enemy visibility, owned weapons/switch, ADS + authoritative headshot, ammo/armor/health/death, score/victory/results, idempotent persistent XP/profile/history and rematch cleanup"
        )
    finally:
        await asyncio.gather(a.close(), b.close())


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", default="http://127.0.0.1:8000")
    asyncio.run(scenario(parser.parse_args().url))
