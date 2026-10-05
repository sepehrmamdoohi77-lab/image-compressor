# TACTICAL ARENA — Stage 1

## Scope and runtime inspection

The starting repository was a Python/FastAPI image/video compressor with no
Node project, Expo/Rork configuration, Rork Games SDK, multiplayer adapter or
native game build. There is no supported Rork API to inspect or invoke in this
checkout. No Rork APIs have been invented.

The production-safe fallback implemented here is an isolated **browser game +
dedicated authoritative FastAPI/WebSocket service**. The compressor's existing
routes and UI are preserved. This is Stage 1 only; it is not a completed tactical
shooter or a Rork/native release.

Current real mode: **NETWORK_DRILL**. Weapon fire, health/damage, kills, armor,
grenades, combat scores, bots, XP, account authentication, public matchmaking and
voice chat are not implemented, and there are no buttons or fabricated values
claiming otherwise. HUD numbers labelled OPS count connected operators, not
kills. Results say explicitly that no combat statistics or rewards were recorded.

## IMPLEMENTED

- Server-generated guest UUIDs, validated callsigns, room-scoped name uniqueness,
  hashed opaque session tokens, HttpOnly/SameSite cookies and SQLite persistence.
  HTTPS responses use Secure, SameSite=None and partitioned cookies for embedded
  previews; HTTP local testing uses SameSite=Lax. Origin checks remain enforced.
- Real six-character codes; create/join/leave, copy code/invite link, native share
  only when the browser exposes it, capacity errors, ready state and ownership.
- Configurable 1v1 / 2v2 / 3v3 / 4v4 capacity; default 4v4. Balanced server-assigned
  teams; no fake occupants and no bots.
- Explicit room/match/player states. Both teams must contain a connected, ready
  operator before starting. Owner permissions and phase transitions are checked
  on the server. Countdown, drill timer, ending/results and return to lobby.
- Fixed 30Hz authoritative movement, 15Hz transform snapshots, facing and sprint;
  diagonal normalization, world bounds, static cover collision and input expiry.
- Local prediction/reconciliation, 100ms remote interpolation, shortest-path
  rotation smoothing and no endless remote extrapolation.
- Input transport scheduled independently of render FPS. Keyboard/mouse, touch
  movement/facing sticks, sprint, camera rotation/zoom and standard gamepad API.
- Real 3D 44m × 44m flat Outpost field with three lanes, solid buildings, walls,
  containers, crates, barriers, vehicles, sandbags, separated validated spawns;
  approximately 1.83m procedural soldiers with replicated movement presentation.
- Opaque environment geometry and label occlusion tests; camera stays above the
  tallest map geometry. Fully replicated drill minimap and roster.
- Disconnect marks/removes rendered actors immediately; stops input; retains a
  reconnect slot for 20 seconds; migrates ownership; cancels countdown if needed.
  Reconnect and page refresh restore the current room/identity/team/position.
- Active-drill late join receives the current match, deadline and transforms.
  Explicit leave releases membership; last leave, idle expiry and grace expiry
  clean up rooms. Restarted servers do not pretend live matches persisted.
- Strict server and client runtime data validation, command/input rate limiting,
  heartbeat-measured RTT, origin checks, connection limits, bounded reliable
  event queues and latest-only outgoing snapshots. Authority exceptions fail
  closed and close rooms instead of displaying simulated success.
- Responsive operations menu, lobby, real roster, live field HUD/minimap,
  countdown, local menu, results, error/reconnecting states and applied graphics,
  camera, touch and gamepad-deadzone preferences. No unsupported audio options.
- Static mesh/material batching, self-hosted fonts/art and deferred 3D loading.
  Scene/input subscriptions, textures/geometries, timers and contexts are disposed
  on leave; database connections are explicitly closed.

## Architecture / replaceable seams

| Layer | Files | Responsibility |
| --- | --- | --- |
| Composition | `main.py`, `arena_server/app.py` | Mount `/arena`, lifespans, real HTTP/WS adapter |
| Authority | `arena_server/rooms.py` | Single writer for membership, teams, ready/start, phases, time, transforms |
| Contract | `arena_server/models.py`, `src/multiplayer/protocol.ts` | Strict versioned intent/state DTOs and explicit enums |
| Mode seam | `arena_server/rules.py` | MatchRules interface; only NetworkDrillRules registered |
| Map/config | `arena_server/config.py`, `arena_server/data/outpost.json` | Central physics/match settings and canonical geometry |
| Collision | `arena_server/physics.py`, `src/game/physics.ts` | Authoritative kernel and matching prediction kernel |
| Persistence | `arena_server/storage.py`, `src/services/Api.ts` | Real guest repository and session service, independent of simulation |
| Transport | `arena_server/peers.py`, `src/multiplayer/WebSocketService.ts` | Real sockets, bounded queues, RPC acknowledgements and reconnect |
| Presentation | `src/game/*`, `src/ui/*`, `src/GameApp.ts` | Camera, soldier animations, map meshes, menus and state display |
| Input | `src/input/InputController.ts` | Platform-independent intent; no authority, damage or client positions |
| Preferences | `src/services/Settings.ts` | Validated browser-local settings, graceful storage failure |

Client requests contain only movement/facing/sprint intent and lobby commands.
The client **cannot submit position, delta-time, team, damage, health, kills,
score, winner, ammo or a room-owner identity**. The server owns elapsed time,
speed/collision, teams, permissions, phases and deadlines. Rendering, camera,
local settings and animation are not authoritative or synchronized every frame.

A future Rork adapter can replace the transport/session/persistence seams when
an actual SDK/project and supported authority model are supplied. A future
Team Deathmatch rules/combat layer must be implemented and tested; it is not a
stub advertised as functional today.

## VERIFIED

Verification date: **2026-10-04**. Exact commands are in the repository README.

- **48 Python tests:** authority/validation, 2/8-player capacities, team balance,
  permissions/readiness, pre-start input rejection, diagonal/sprint limits,
  stale/flooded inputs, 16,000 random collision steps, bounds, disconnect/expiry,
  owner migration, late join, timer/results, cleanup, persistence/safe rename,
  malformed origin and binary-frame handling, HTTPS preview-cookie attributes, bounded queues and fail-closed
  authority. Includes all **5 existing compressor regression tests**.
- **11 TypeScript unit tests:** canonical map/collision contact, bounds, blocked
  movement presentation, normalized/sprint prediction, acknowledged-input replay,
  buffered/short-path interpolation, stale-frame rejection, no mutation/endless
  extrapolation, invalid state and unavailable preference storage.
- **Real HTTP + WebSocket acceptance matrix:** 2, 4 and 8 distinct authenticated
  sockets using `scripts/verify_arena_network.py`; no room-service mocks. Each
  case verifies identical player identities/state, balanced teams, ready/start,
  movement/facing in both directions, common match/deadline, actual RTT, reconnect,
  owner migration, safe owner return, persistent identity and last-player cleanup.
  Four-client case uses real scheduled 120–220ms delayed/reordered input packets
  and active late join. Eight-client case rejects a ninth join as room full.
- **4 passing browser E2E tests:** two independent Chromium browser processes create/join a room,
  see each other in the 3D field, move both directions, synchronize facing/time,
  open a local menu while the other client continues, apply field camera settings,
  recover from an actual socket close, refresh/rejoin with the same identity,
  return to lobby and leave. Separate touch-emulated browser versus desktop checks
  real pointer movement/facing, sprint toggle, portrait/landscape layout. Separate
  case checks actual room-not-found errors, server identity and saved preferences.
  An API/network-failure case verifies an honest unavailable state with no fake lobby.
- **Compiled production-path browser smoke:** `/arena/` serves its local assets,
  creates a real WebSocket room using a guest cookie, renders a WebGL actor and
  cleans up on leave with no browser runtime/console errors. The compressor root
  still returns HTTP 200. This is a local production-build check, not a deployment.
- Strict TypeScript compilation, Ruff checks and production Vite browser build
  pass. The 3D module is deferred (~126KB gzip); initial JS is ~44KB gzip, with
  fonts and the AI-generated operations artwork hosted locally.

The browser tests exercise the actual running app/server. They are not fake
multiplayer demonstrations. Test clients and test-only transport interruption
hooks live only in verification code; no opponents are seeded into the product.

## NOT VERIFIED

- Physical iOS/Android devices, Safari/WebKit, controller hardware and native
  haptics/fullscreen/share permission behavior across browsers/embedded previews.
- A 60FPS hardware performance target, battery use, GPU/CPU/memory benchmarks,
  long mobile sessions or eight simultaneously rendered browser clients. Headless
  QA uses a software GPU; its timing is not a device-performance benchmark.
- Rork integration, native binaries, app-store signing/submission or store release.
- Public production deployment, cross-region networks, sustained load, distributed
  replicas, disaster recovery or a persistent hosting volume.
- Combat, weapons/ADS, hit zones, armor, death/respawn, grenades, combat score/wins,
  AI, audio/VFX polish, authenticated accounts, XP/statistics and matchmaking.

## KNOWN LIMITATIONS

1. **Browser fallback, not Rork:** this checkout supplies no Rork runtime/SDK.
   Mobile browser touch input is implemented; no iOS/Android app build exists.
2. **Exactly one backend worker/replica:** rooms and transforms are memory-owned.
   Do not run `--workers 2+` or load-balance multiple instances without a room
   directory plus dedicated match workers/shared transport. Restart closes rooms.
3. **Persistent guest identity is not an account:** cookie loss means loss of
   access; identities are not portable between browsers. Native/account auth and
   guest-to-account linking require a later implementation. SQLite requires an
   actual persistent volume in a deployment; no cloud persistence is claimed.
4. **Movement drill, not competitive combat:** all transforms/minimap positions
   are replicated for network testing. Anti-wallhack relevancy/fog filtering,
   combat line-of-sight, latency-compensated hit validation and anti-cheat beyond
   validated movement/intent do not exist yet.
5. **Ground-plane collision:** static footprint proxy collision; no vertical
   traversal, jumping, crouch, interiors, player-player collision, destructible
   cover or combat-safe enemy-aware spawning. Basic geometry/spawns are validated.
6. **Stage 1 assets:** procedural characters/environment and basic locomotion;
   not a finished commercial character/weapon/animation pipeline. The menu art
   is AI-generated key art, not the in-game soldier mesh or a real photo.
7. **Deployment not prepared as a release:** build the frontend before starting
   the backend. Existing `render.yaml` remains compressor-only and does not yet
   build the game bundle. Use TLS, a persistent DB volume and one worker when
   preparing a real hosted playtest. Native share can fail inside an iframe;
   copy code/link is the explicit fallback.

## ERRORS / warnings

No remaining runtime errors in the passing, tested Stage 1 paths. No claim is
made about untested platforms or future gameplay stages.

Non-blocking dependency warnings remain: Starlette's test-client compatibility
warning for the existing `httpx` test dependency, and two Zod/Rollup PURE-comment
annotation warnings. Tests/build succeed; no dependency warnings are disguised
as verified release readiness.

## NEXT STAGE

**Stage 2 — multiplayer hardening, before any weapons:**

- Extend multi-browser QA to 4 and 8 simultaneously rendered clients and physical
  mobile browsers; test slow/backgrounded clients and sustained network jitter.
- Prepare and verify a single-worker HTTPS hosted playtest with durable guest
  storage, deployment health/restart behavior and explicit operational limits.
- Strengthen room lifecycle/adverse-network regression and telemetry under load.
- Inspect a real Rork Games SDK/project if supplied; bind the existing service
  seams only to APIs and authority capabilities actually present there.

Then proceed to Stage 3 movement/camera refinement, and only after the networking
and input gates pass, Stage 4 authoritative weapons/aiming/shooting. Do not label
this foundation as a completed Team Deathmatch shooter.
