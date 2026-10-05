"""Actual FastAPI/WebSocket adapter for this repository, not a Rork SDK shim."""

import asyncio
import json
import logging
import os
import time
from collections import OrderedDict
from contextlib import asynccontextmanager, suppress
from pathlib import Path
from urllib.parse import urlsplit

from fastapi import (
    FastAPI,
    HTTPException,
    Request,
    Response,
    WebSocket,
    WebSocketDisconnect,
)
from fastapi.responses import FileResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from pydantic import Field, ValidationError

from .config import MAX_CONNECTIONS, public_config
from .models import MESSAGE_ADAPTER, ArenaError, Cosmetic, Input, Pong, Primary, StrictModel
from .peers import Peer
from .rooms import RoomService
from .session_auth import AUTH_SUBPROTOCOL, SocketAuthentication, bearer_token
from .storage import COOKIE_NAME, SESSION_SECONDS, ProfileRepository

logger = logging.getLogger("tactical_arena.transport")
ROOT = Path(__file__).resolve().parent.parent


class GuestBody(StrictModel):
    name: str = Field(min_length=3, max_length=20)
    transport: bool = False


class LoadoutBody(StrictModel):
    primary: Primary
    cosmetic: Cosmetic


class TokenBucket:
    def __init__(self, rate: float, capacity: float):
        self.rate, self.capacity = rate, capacity
        self.tokens = capacity
        self.at = time.monotonic()

    def take(self) -> bool:
        now = time.monotonic()
        self.tokens = min(self.capacity, self.tokens + (now - self.at) * self.rate)
        self.at = now
        if self.tokens < 1:
            return False
        self.tokens -= 1
        return True


def origin_allowed(origin: str | None, host: str) -> bool:
    if origin is None:
        # Non-browser integration clients are permitted; they still need a cookie.
        return True
    try:
        parsed = urlsplit(origin)
    except ValueError:
        return False
    if parsed.scheme not in ("http", "https") or parsed.username or parsed.password:
        return False
    if parsed.netloc == host and parsed.path in ("", "/"):
        return True
    allowed = {o.strip() for o in os.getenv("ARENA_ALLOWED_ORIGINS", "").split(",") if o.strip()}
    return origin in allowed


def create_arena_app(db_path: Path | None = None) -> FastAPI:
    repository = ProfileRepository(
        db_path or Path(os.getenv("ARENA_DB_PATH", str(ROOT / "arena-data" / "arena.sqlite3")))
    )
    rooms = RoomService(repository=repository)
    http_buckets: OrderedDict[str, TokenBucket] = OrderedDict()
    connection_counts: dict[str, int] = {}

    async def startup() -> None:
        await asyncio.to_thread(repository.initialize)
        await rooms.start()

    async def shutdown() -> None:
        await rooms.stop()

    @asynccontextmanager
    async def lifespan(_: FastAPI):
        await startup()
        try:
            yield
        finally:
            await shutdown()

    arena = FastAPI(title="Tactical Arena — Multiplayer Combat", lifespan=lifespan)
    arena.state.rooms = rooms
    arena.state.repository = repository
    # Mounted applications don't receive lifespan automatically. main.py invokes these.
    arena.state.startup = startup
    arena.state.shutdown = shutdown

    @arena.middleware("http")
    async def safe_headers(request: Request, call_next):
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        if request.url.path.startswith("/arena/api") or "/api/" in request.url.path:
            response.headers["Cache-Control"] = "no-store"
        return response

    @arena.get("/api/health")
    async def health():
        status = (
            "available"
            if rooms.running and rooms.task and not rooms.task.done()
            else "starting"
            if rooms.task is None
            else "unavailable"
        )
        return {
            "status": status,
            "transport": "WebSocket",
            "authority": "dedicated-server",
            "stage": 4,
            "combatEnabled": True,
            "rooms": len(rooms.rooms),
            "connections": len(rooms.peers),
            "maxConnections": MAX_CONNECTIONS,
        }

    @arena.get("/api/ready")
    async def readiness():
        available = rooms.running and rooms.task is not None and not rooms.task.done()
        return Response(
            "ready" if available else "unavailable",
            status_code=200 if available else 503,
            media_type="text/plain",
        )

    @arena.get("/api/config")
    async def config():
        return public_config()

    async def current_identity(request: Request):
        try:
            credential = bearer_token(request.headers.get("authorization"))
        except ValueError as error:
            raise HTTPException(
                401, "Invalid guest authorization. Re-enter your callsign."
            ) from error
        if credential:
            profile = await asyncio.to_thread(repository.get_transport, credential)
            if profile is None:
                raise HTTPException(401, "Guest authorization expired. Re-enter your callsign.")
            return profile, credential
        return await asyncio.to_thread(repository.get, request.cookies.get(COOKIE_NAME)), None

    @arena.get("/api/session")
    async def get_session(request: Request):
        profile, _ = await current_identity(request)
        return {
            "profile": profile,
            "roomCode": rooms.memberships.get(profile["id"]) if profile else None,
        }

    @arena.post("/api/session")
    async def save_session(body: GuestBody, request: Request, response: Response):
        if not origin_allowed(request.headers.get("origin"), request.headers.get("host", "")):
            raise HTTPException(403, "This origin is not permitted.")
        host = request.client.host if request.client else "unknown"
        bucket = http_buckets.get(host)
        if bucket is None:
            bucket = http_buckets[host] = TokenBucket(0.5, 20)
        http_buckets.move_to_end(host)
        while len(http_buckets) > 1024:
            http_buckets.popitem(last=False)
        if not bucket.take():
            raise HTTPException(429, "Too many identity updates. Try again shortly.")
        token = request.cookies.get(COOKIE_NAME)
        existing, credential = await current_identity(request)
        if (
            existing
            and existing["id"] in rooms.memberships
            and body.name.strip() != existing["name"]
        ):
            raise HTTPException(409, "Leave your room before changing callsign.")
        changing = existing is not None and existing["name"] != body.name.strip()
        if existing and existing["id"] in rooms.profile_writes:
            raise HTTPException(409, "A profile save is already in progress.")
        if changing:
            rooms.profile_writes.add(existing["id"])
        try:
            profile, token = await asyncio.to_thread(
                repository.save, body.name, token, transport_token=credential
            )
        except ValueError as exc:
            raise HTTPException(422, str(exc)) from exc
        finally:
            if changing:
                rooms.profile_writes.discard(existing["id"])
        if profile["id"] in rooms.peers and profile["id"] not in rooms.memberships:
            rooms.peers[profile["id"]].name = profile["name"]
            rooms.peers[profile["id"]].profile = profile
        # TLS may terminate at the preview proxy. A browser's already-validated
        # HTTPS Origin describes the external scheme; do not blindly trust XFP.
        origin = request.headers.get("origin")
        secure = request.url.scheme == "https" or bool(
            origin and urlsplit(origin).scheme == "https"
        )
        response.set_cookie(
            COOKIE_NAME,
            token,
            max_age=SESSION_SECONDS,
            httponly=True,
            secure=secure,
            samesite="none" if secure else "lax",
            path="/arena",
        )
        # HTTPS previews may be cross-site iframes. CHIPS allows an opaque guest
        # cookie partitioned to the embedding site without granting JS access.
        # set_cookie(partitioned=True) needs Python 3.14, so append its standard
        # attribute on 3.11+. Older browsers safely ignore this attribute.
        if secure:
            response.headers["set-cookie"] += "; Partitioned"
        result = {"profile": profile}
        if body.transport:
            result.update(
                await asyncio.to_thread(repository.issue_transport, profile["id"], credential)
            )
        return result

    @arena.post("/api/session/transport")
    async def issue_guest_transport(request: Request):
        if not origin_allowed(request.headers.get("origin"), request.headers.get("host", "")):
            raise HTTPException(403, "This origin is not permitted.")
        profile, credential = await current_identity(request)
        if profile is None:
            raise HTTPException(
                401, "Choose your callsign to establish a real guest session first."
            )
        grant = await asyncio.to_thread(repository.issue_transport, profile["id"], credential)
        return {"profile": profile, **grant}

    @arena.post("/api/loadout")
    async def save_loadout(body: LoadoutBody, request: Request):
        if not origin_allowed(request.headers.get("origin"), request.headers.get("host", "")):
            raise HTTPException(403, "This origin is not permitted.")
        profile, _ = await current_identity(request)
        if profile is None:
            raise HTTPException(401, "Choose a guest callsign first.")
        if profile["id"] in rooms.memberships:
            raise HTTPException(409, "Leave your room before changing the stored loadout.")
        if profile["id"] in rooms.profile_writes:
            raise HTTPException(409, "A profile save is already in progress.")
        rooms.profile_writes.add(profile["id"])
        try:
            profile = await asyncio.to_thread(
                repository.loadout, profile["id"], body.primary, body.cosmetic
            )
        finally:
            rooms.profile_writes.discard(profile["id"])
        rooms.profile_update(profile)
        return {"profile": profile}

    @arena.websocket("/ws")
    async def websocket_endpoint(ws: WebSocket):
        if not origin_allowed(ws.headers.get("origin"), ws.headers.get("host", "")):
            await ws.close(code=4403, reason="Origin not permitted")
            return
        host = ws.client.host if ws.client else "unknown"
        if connection_counts.get(host, 0) >= 32:
            await ws.close(code=4429, reason="Too many connections")
            return
        connection_counts[host] = connection_counts.get(host, 0) + 1
        try:
            protocols = {p.strip() for p in ws.headers.get("sec-websocket-protocol", "").split(",")}
            auth_first = AUTH_SUBPROTOCOL in protocols
            await ws.accept(subprotocol=AUTH_SUBPROTOCOL if auth_first else None)
            if auth_first:
                try:
                    raw = await asyncio.wait_for(ws.receive_text(), timeout=5)
                    if len(raw) > 512:
                        raise ValueError("Authentication frame too large")
                    proof = SocketAuthentication.model_validate_json(raw)
                    profile = await asyncio.to_thread(repository.get_transport, proof.token)
                except (ValidationError, ValueError, KeyError, TimeoutError, WebSocketDisconnect):
                    profile = None
            else:
                profile = await asyncio.to_thread(repository.get, ws.cookies.get(COOKIE_NAME))
            if profile is None:
                await ws.send_json(
                    {
                        "type": "error",
                        "code": "AUTH_REQUIRED",
                        "message": "Guest authorization is missing or expired. Re-enter your callsign and retry.",
                    }
                )
                await ws.close(code=4401, reason="Guest authorization required")
                return
            peer = Peer(ws, profile, rooms.clock())
            try:
                rooms.attach(peer)
            except ArenaError as error:
                await ws.send_json({"type": "error", "code": error.code, "message": error.message})
                await ws.close(
                    code=4409 if error.code == "SESSION_IN_USE" else 4429, reason=error.code
                )
                return
            input_bucket, action_bucket = TokenBucket(45, 30), TokenBucket(5, 15)

            async def receive():
                invalid = 0
                while True:
                    frame = await ws.receive()
                    if frame["type"] == "websocket.disconnect":
                        raise WebSocketDisconnect(frame.get("code", 1000))
                    raw = frame.get("text")
                    if raw is None:
                        await ws.close(code=1003, reason="Text JSON messages required")
                        return
                    if len(raw.encode()) > 2048:
                        await ws.close(code=1009, reason="Message too large")
                        return
                    request_id = None
                    try:
                        value = json.loads(raw)
                        if isinstance(value, dict):
                            candidate = value.get("requestId")
                            if isinstance(candidate, str) and len(candidate) <= 40:
                                request_id = candidate
                        message = MESSAGE_ADAPTER.validate_python(value)
                        bucket = (
                            input_bucket if isinstance(message, (Input, Pong)) else action_bucket
                        )
                        if not bucket.take():
                            if isinstance(message, Input):
                                continue  # Rate-limited intent cannot increase simulation speed.
                            raise ArenaError(
                                "RATE_LIMITED", "Too many requests. Please wait a moment."
                            )
                        rooms.handle(peer, message)
                    except (json.JSONDecodeError, ValidationError, TypeError, RecursionError):
                        invalid += 1
                        peer.send(
                            {
                                "type": "error",
                                "code": "INVALID_MESSAGE",
                                "message": "Action did not match the supported network protocol.",
                                "requestId": request_id,
                            }
                        )
                        if invalid >= 10:
                            await ws.close(code=4400, reason="Invalid protocol messages")
                            return
                    except ArenaError as error:
                        peer.send(
                            {
                                "type": "error",
                                "code": error.code,
                                "message": error.message,
                                "requestId": request_id,
                            }
                        )

            sender = asyncio.create_task(peer.pump(), name=f"arena-send-{peer.id[:8]}")
            receiver = asyncio.create_task(receive(), name=f"arena-receive-{peer.id[:8]}")
            try:
                done, _ = await asyncio.wait(
                    [sender, receiver], return_when=asyncio.FIRST_COMPLETED
                )
                for task in done:
                    task.result()
            except (WebSocketDisconnect, TimeoutError, RuntimeError, OSError):
                logger.debug("Socket closed for %s", peer.id)
            finally:
                sender.cancel()
                receiver.cancel()
                for task in (sender, receiver):
                    with suppress(
                        asyncio.CancelledError,
                        WebSocketDisconnect,
                        TimeoutError,
                        RuntimeError,
                        OSError,
                    ):
                        await task
                rooms.detach(peer)
                with suppress(RuntimeError, OSError, WebSocketDisconnect):
                    await ws.close()

        finally:
            connection_counts[host] -= 1
            if connection_counts[host] == 0:
                del connection_counts[host]

    built = ROOT / "tactical-arena" / "dist"
    # Build artifacts are intentionally ignored. Run npm run build before production.
    if (built / "assets").exists():
        arena.mount("/assets", StaticFiles(directory=built / "assets"), name="arena-assets")

    @arena.get("/", include_in_schema=False)
    async def index():
        if (built / "index.html").exists():
            return FileResponse(built / "index.html", headers={"Cache-Control": "no-cache"})
        raise HTTPException(
            503,
            "Browser bundle not built. Run npm ci && npm run build in tactical-arena, or use the Vite development server.",
        )

    @arena.get("", include_in_schema=False)
    async def redirect():
        return RedirectResponse("/arena/")

    return arena
