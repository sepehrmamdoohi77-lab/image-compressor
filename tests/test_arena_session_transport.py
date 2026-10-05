"""Cookie-independent guest proof must still authenticate the real server identity."""

import hashlib
import sqlite3
import time
from contextlib import asynccontextmanager

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from arena_server.app import create_arena_app
from arena_server.session_auth import AUTH_SUBPROTOCOL, TRANSPORT_SECONDS
from arena_server.storage import ProfileRepository


@pytest.fixture
def server(tmp_path):
    arena = create_arena_app(tmp_path / "identity.sqlite3")

    @asynccontextmanager
    async def lifespan(_):
        await arena.state.startup()
        try:
            yield
        finally:
            await arena.state.shutdown()

    parent = FastAPI(lifespan=lifespan)
    parent.mount("/arena", arena)
    return parent, arena


def next_event(ws, kind):
    for _ in range(40):
        message = ws.receive_json()
        if message["type"] == "ping":
            ws.send_json({"type": "pong", "nonce": message["nonce"]})
        if message["type"] == kind:
            return message
    raise AssertionError(f"Real server did not return {kind}")


def test_cookie_blocked_http_and_first_frame_socket_auth_share_real_identity(server):
    app, arena = server
    with TestClient(app) as client:
        saved = client.post("/arena/api/session", json={"name": "Iframe Guest", "transport": True})
        assert saved.status_code == 200
        payload = saved.json()
        token = payload["transportToken"]
        profile = payload["profile"]
        assert (
            len(token) == 43
            and 0 < payload["transportExpiresAt"] - time.time() <= TRANSPORT_SECONDS
        )
        client.cookies.clear()  # The exact boundary omitted by an embedded browser's cookie policy.
        assert client.get("/arena/api/session").json()["profile"] is None
        headers = {"Authorization": f"Bearer {token}"}
        assert (
            client.get("/arena/api/session", headers=headers).json()["profile"]["id"]
            == profile["id"]
        )
        changed = client.post(
            "/arena/api/loadout", headers=headers, json={"primary": "dmr", "cosmetic": "slate"}
        )
        assert changed.status_code == 200 and changed.json()["profile"]["id"] == profile["id"]
        with client.websocket_connect("/arena/ws", subprotocols=[AUTH_SUBPROTOCOL]) as ws:
            assert ws.accepted_subprotocol == AUTH_SUBPROTOCOL
            ws.send_json({"type": "authenticate", "token": token})
            assert next_event(ws, "welcome")["playerId"] == profile["id"]
            ws.send_json(
                {
                    "type": "create_room",
                    "requestId": "create",
                    "settings": {"mode": "TEAM_DEATHMATCH", "teamSize": 1, "bots": 1},
                }
            )
            room = next_event(ws, "room_state")
            while room["room"] is None:
                room = next_event(ws, "room_state")
            assert room["room"]["ownerId"] == profile["id"]
            human = next(p for p in room["room"]["players"] if not p["isBot"])
            assert human["primary"] == "dmr"
            ws.send_json({"type": "leave", "requestId": "leave"})
            assert next_event(ws, "ack")["requestId"] in ("create", "leave")
        assert not arena.state.rooms.rooms


def test_repeated_bootstrap_uses_same_identity_grant_and_does_not_reset_stats(server):
    app, _ = server
    with TestClient(app) as client:
        first = client.post(
            "/arena/api/session", json={"name": "Same Guest", "transport": True}
        ).json()
        client.cookies.clear()
        headers = {"Authorization": "Bearer " + first["transportToken"]}
        client.post(
            "/arena/api/loadout", json={"primary": "smg", "cosmetic": "sand"}, headers=headers
        )
        second = client.post(
            "/arena/api/session", json={"name": "Same Guest", "transport": True}, headers=headers
        )
        assert second.status_code == 200
        assert second.json()["profile"]["id"] == first["profile"]["id"]
        assert second.json()["transportToken"] == first["transportToken"]
        assert second.json()["profile"]["loadout"]["primary"] == "smg"
        client.cookies.clear()
        issued = client.post("/arena/api/session/transport", headers=headers, json={})
        assert (
            issued.status_code == 200 and issued.json()["transportToken"] == first["transportToken"]
        )


def test_transport_cannot_forge_a_profile_by_public_id_or_change_socket_identity(server):
    app, _ = server
    with TestClient(app) as client:
        profile = client.post(
            "/arena/api/session", json={"name": "Owned Guest", "transport": True}
        ).json()
        client.cookies.clear()
        for proof in [
            {"type": "authenticate", "profileId": profile["profile"]["id"]},
            {"type": "authenticate", "token": "A" * 43},
            {"type": "authenticate", "token": profile["transportToken"], "health": 999},
        ]:
            with client.websocket_connect("/arena/ws", subprotocols=[AUTH_SUBPROTOCOL]) as ws:
                ws.send_json(proof)
                assert next_event(ws, "error")["code"] == "AUTH_REQUIRED"
        with client.websocket_connect("/arena/ws", subprotocols=[AUTH_SUBPROTOCOL]) as ws:
            ws.send_json({"type": "authenticate", "token": profile["transportToken"]})
            next_event(ws, "welcome")
            ws.send_json({"type": "authenticate", "token": "B" * 43})
            assert next_event(ws, "error")["code"] == "INVALID_MESSAGE"


def test_expired_and_malformed_authorization_is_rejected(server):
    app, arena = server
    with TestClient(app) as client:
        payload = client.post(
            "/arena/api/session", json={"name": "Expired Guest", "transport": True}
        ).json()
        client.cookies.clear()
        token = payload["transportToken"]
        with arena.state.repository.connection() as db:
            db.execute("UPDATE transport_sessions SET expires_at = ?", (int(time.time()) - 1,))
        assert (
            client.get(
                "/arena/api/session", headers={"Authorization": "Bearer " + token}
            ).status_code
            == 401
        )
        assert client.post("/arena/api/session/transport", json={}).status_code == 401
        assert (
            client.get(
                "/arena/api/session",
                headers={"Authorization": "Bearer " + payload["profile"]["id"]},
            ).status_code
            == 401
        )
        with client.websocket_connect("/arena/ws", subprotocols=[AUTH_SUBPROTOCOL]) as ws:
            ws.send_json({"type": "authenticate", "token": token})
            assert next_event(ws, "error")["code"] == "AUTH_REQUIRED"


def test_auth_first_grant_wins_over_a_different_cookie_identity(server):
    app, _ = server
    with TestClient(app) as a:
        alpha = a.post("/arena/api/session", json={"name": "Cookie Alpha"}).json()["profile"]
        other = TestClient(app)
        bravo = other.post(
            "/arena/api/session", json={"name": "Transport Bravo", "transport": True}
        ).json()
        assert alpha["id"] != bravo["profile"]["id"]
        with a.websocket_connect("/arena/ws", subprotocols=[AUTH_SUBPROTOCOL]) as ws:
            ws.send_json({"type": "authenticate", "token": bravo["transportToken"]})
            assert next_event(ws, "welcome")["playerId"] == bravo["profile"]["id"]


def test_wrong_origin_does_not_mint_a_transport_grant(server):
    app, _ = server
    with TestClient(app) as client:
        client.post("/arena/api/session", json={"name": "Origin Guest"})
        response = client.post(
            "/arena/api/session/transport", headers={"Origin": "https://evil.test"}, json={}
        )
        assert response.status_code == 403
        assert (
            client.post(
                "/arena/api/session",
                json={"name": "Origin Guest", "transport": True},
                headers={"Origin": "https://evil.test"},
            ).status_code
            == 403
        )


def test_https_external_origin_sets_secure_cookie_behind_http_preview_proxy(server):
    app, _ = server
    with TestClient(app, base_url="http://testserver") as client:
        response = client.post(
            "/arena/api/session",
            headers={"Origin": "https://testserver"},
            json={"name": "Proxied HTTPS"},
        )
        assert response.status_code == 200
        value = response.headers["set-cookie"].lower()
        assert (
            "secure" in value
            and "httponly" in value
            and "samesite=none" in value
            and "partitioned" in value
        )


def test_grants_hash_at_rest_migrate_and_survive_repository_restart(tmp_path):
    path = tmp_path / "persistent.sqlite3"
    repo = ProfileRepository(path)
    repo.initialize()
    profile, cookie = repo.save("Persistent Guest")
    grant = repo.issue_transport(profile["id"])
    with sqlite3.connect(path) as db:
        stored = db.execute("SELECT token_hash FROM transport_sessions").fetchone()[0]
    assert (
        stored == hashlib.sha256(grant["transportToken"].encode()).hexdigest()
        and stored != grant["transportToken"]
    )
    reloaded = ProfileRepository(path)
    reloaded.initialize()
    assert reloaded.get_transport(grant["transportToken"])["id"] == profile["id"]
    assert reloaded.get(cookie)["id"] == profile["id"]
    updated, new_cookie = reloaded.save("Persistent Guest", transport_token=grant["transportToken"])
    assert updated["id"] == profile["id"] and reloaded.get(new_cookie)["id"] == profile["id"]
    assert reloaded.get_transport(grant["transportToken"])["id"] == profile["id"]
