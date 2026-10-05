# Tactical Arena 0.2 — real browser shooter playtest

## What this build is (and is not)

This repository contains a **real playable browser Team Deathmatch game**, not
just the original movement drill. It uses the repository's actual FastAPI
runtime, server-owned simulation, WebSockets and Three.js. No Rork SDK/runtime,
Unity or Unreal project exists in this checkout. No Rork API or native/store
release is invented or claimed. The earlier Stage 1 document is historical.

This is a tested web playtest, **not a promise of zero bugs or commercial-release
readiness**. Physical-device performance, native packages, Safari, distributed
hosting and a published production deployment remain unverified.

## IMPLEMENTED — actual functionality

### Multiplayer and match flow

- Real HTTP-issued, opaque-cookie guest identities; SQLite-backed callsigns,
  loadouts, cosmetics, combat totals, XP/level and five recent completed matches.
- Private create/join by genuine six-character codes, copy/share invitations,
  configurable 1v1–4v4 capacity, balanced authoritative teams, ready/start,
  synchronized countdown and match timer, end/results, rematch and leave.
- **Quick Play is actual public-room matching.** The server joins an available
  same-selected-map compatible human-only room or creates one; starts only when both teams are
  occupied by ready real guests. It never fills public matches with bots.
- Explicit modes: Team Deathmatch and a preserved development network drill.
  Default TDM: 4v4 capacity, 10 minutes, 50 kills. Private kill limits are tunable.
- Score-limit, time-limit/draw and disconnect-grace forfeits are server decisions.
  Multiple shots valid at a tick are collected before damage; reciprocal lethal
  shots can produce simultaneous kills/draws rather than iteration-order wins.
- Disconnect stops input and interrupts reload; actor is hidden, identity/team/
  wounds/ammo/death state reserved for 20s; owner migration and reconnect restore
  the current valid state. Reconnect cannot refill health/ammo or revive a corpse.
- Late join gets current round, scores, deadline, relevant actors and inventory.
  Idle/last-human/grace cleanup removes room state, AI navigation and listeners.

### Real combat

- Five distinct, data-driven classes: assault rifle, SMG, shotgun, DMR and pistol.
  Four selectable primaries; secondary P-9; two frag grenades per spawn. All
  weapons are available from level one with no paid/level combat advantage.
- Server-controlled inventory, fire mode/rate, magazine/reserve, reload timing,
  interruption, draw delay, recoil/bloom, movement penalties, ADS settling,
  range/falloff and deterministic-valid shot generation. Shotgun has real pellets.
- Authoritative 3D muzzle/obstacle ray tests and rotated soldier head/body/arms/
  legs hit zones. Server derives each hit; no client damage, kill or hit reports.
  Muzzle obstruction also blocks damage when a visible weapon clips into cover.
- 100 health, 65 armor; armor absorbs 35% until depleted. Damage clamps, death
  once, real kill/assist/headshot/score feed, three-second safe team respawns,
  short spawn protection ending on an actual attack.
- Standing/crouching change movement, accuracy, hit-zone height and muzzle height.
  Half-height cover can be shot over; taller volumes stop bullets and visibility.
- Server frag launch, gravity, bounce/collision, fuse, blast radius/falloff and
  cover attenuation. Paired finite mouse ground coordinates are checked against
  the selected map and 32m range. A fixed-30Hz ballistics solver lands within 3cm
  on clear paths and stops at ground contact, not a cursor teleport. Obstacles
  can block / bounce it; invalid targets consume no grenades. Touch/gamepad and
  server AI retain directional facing/power fallback throws. Crates and sandbags take actual damage and can be destroyed;
  removal updates bullets, movement, visibility, navigation and client meshes.
- Enemy transform relevance is server LOS/range filtered in active TDM. Hidden
  shot sounds use coarse positions, not complete hidden actor transforms. Allies
  and self remain replicated. Clear-LOS vision now covers the entire 44m field
  (70m range). Team-confirmed radar sightings are shared; hidden enemies retain
  only a frozen last-observed position for 5 seconds, then expire. Dead/removed/
  disconnected targets are removed. No hidden live enemy transforms are invented.
- Server RTT plus interpolation-aware bounded rewind (max 200ms) for target hit
  poses, with life-generation checks so old pre-respawn poses cannot be hit.

### Playable presentation

- **Ten selectable physical 44m levels**: Outpost, Dockyard, Refinery, Rail
  Depot, Checkpoint, Courtyard, Scrapyard, Barracks, Bunker and Market. Each has
  different canonical collision/cover and visual themes. Room spawns, movement,
  damage/raycast/destruction, AI navigation, prediction, 3D field, previews and
  minimap use that room's map, not a global switch or a relabelled card.
- Human-scale articulated military silhouettes: movement-distance gait,
  world-space stance anchors, two-bone knee/elbow IK, walk/run/strafe/crouch,
  braced ADS/weapon holds and blended reload/throw/death/respawn. Full blue/navy
  and red/rust clothing remain distinct under all cosmetics, with readable
  ally/enemy tags and rings. This is procedural playtest art, not mocap/AAA assets.
- Five different firearm meshes with shaped receivers/stocks/grips, barrels,
  trigger guards, magazines, rails, ejection ports and class-specific sights /
  scopes / pump / slide. Hands solve to actual weapon grip anchors, not arbitrary
  arm angles. A picked head accessory aims at the actual authoritative head
  zone rather than an accessory surface above the hit box; the server still
  decides every hit using real obstruction, spread and rewind.
- Tactical camera follows, zooms and rotates without rotating the world. A label
  may remain readable through **camera** obstruction only if the server already
  streams that actor; solid-wall-hidden enemies are not rendered. Buffered
  remote interpolation is not smoothed a second time. Local collision prediction
  also updates when cover is destroyed or restored.
- Intent transport is independent of render FPS. Keyboard/mouse, thumb-sized
  touch movement/aim/fire/ADS/reload/grenade/sprint/crouch/weapon controls and a
  standard gamepad API mapping. Input resets on blur, death, menu and disconnect.
- Real health/armor/ammo/reload/spawn/death HUD, dynamic crosshair, confirmed hit
  markers, directional damage, scoreboard, kill feed, win/loss/draw results and
  confirmed XP. HUD never awards its own ammo, damage, score or progression.
- Bounded tracer/flash/impact/dust/explosion/grenade pools driven by server events.
  Procedural Web Audio weapon-specific SFX, spatial pan/distance attenuation,
  reload/switch/steps/hit/kill/countdown feedback and low menu ambience; actual
  master/SFX/music buses. No fake voice-chat or microphone controls.
- Graphics/shadows/pixel ratio/frame limit, camera, stick response/deadzone,
  touch scale/autofire, crosshair/feedback and supported-browser haptics settings.
- Profiles/armory use real repository values and preferences; no seeded statistics,
  fake account login, fabricated leaderboard or nonfunctional future-mode buttons.

### Explicit bot practice

- Private rooms may contain 1–7 **BOT-labelled** server entities within the real
  8-slot capacity. Bots are not sockets and never displayed as human online peers.
- A* valid-floor navigation/no diagonal corner cutting, LOS perception,
  patrol/investigate/chase/attack/flank/reposition/retreat/cover and grenade logic.
- Easy/Normal/Hard change reaction, accuracy, awareness, lead and aggression;
  damage/health/ammo rules are identical to human rules, not difficulty multipliers.
- Practice disables competitive profile stats/XP. Last-human leave closes the
  practice room; bots do not keep ghost lobbies alive.

## Bug fixes and safety changes

- **Fixed input-change movement overprediction:** immediate intent callbacks
  send input without pretending another 1/30s elapsed. Moving limbs now follow
  actual displacement; a blocked body does not keep a time-driven skating gait.
- Mixed indexed/non-indexed firearm geometry is normalized before batching;
  shaped details do not silently fail to merge into bounded draw batches.
- **Fixed simultaneous RMB ADS + LMB fire/release:** mouse button combinations do
  not produce a second `pointerdown`/`pointerup`. Real mouse down/up are used, so
  ADS no longer blocks shooting or leaves automatic fire stuck on release.
- Fixed duplicate `data-health` selectors, initial actors appearing at zero before
  their first authoritative pose and raycaster range left over from label tests.
- Fixed native-dialog callbacks being cleared by an older queued close event when
  switching from field menu into settings; field settings really apply.
- Fixed stale room/profile-initialization paths and actor/input/context disposal;
  pose frames are cloned, not mutated by local prediction; replay queues bounded.
- Fixed floating wall-contact parity and blocked local animation state; living
  player contacts are resolved while corpses/disconnected ghosts do not block.
- Result receipts are atomic and idempotent. A failed second-player save can be
  retried without awarding the first player's XP twice. Stored data cannot be
  overwritten by a different payload for the same match/player receipt.
- Frozen completed results survive leaving the results screen. Their background
  persistence callback cannot resurrect a closed room or old membership.
- Guest rename/loadout writes gate room joins; immutable match weapon ownership
  cannot change during a profile-write race. Level updates reflect committed XP.
- IP connection budget is reserved **before** asynchronous auth/accept, avoiding
  simultaneous connections bypassing a pre-await count check.
- Strict intent and state schemas, finite/range checks, origin checks, action/input
  token buckets, heartbeat RTT/expiry, global caps, bounded reliable/transient
  queues and latest-only snapshots. Authority exceptions fail closed.
- HTTPS guest cookies are Secure/HttpOnly/SameSite=None/Partitioned for embedded
  previews; localhost HTTP uses SameSite=Lax. Browser cookie-policy restrictions
  use the server-issued per-tab proof path rather than pretending the room
  connected or requiring third-party cookies.
- Renderer core is a deferred separate chunk, static map geometry is batched,
  effects pooled, fonts/art local and all game objects/resources/timers disposed.

## Persistence semantics

Only the server freezes combat stats and commits receipts. Connected human
participants who did not abandon a completed human match can record its totals.
XP uses configured kill/assist/headshot/completion/win rewards for actual
participation. Leaving before completion disqualifies completion rewards;
aborting a round records no fabricated win/XP. Practice awards none.

`match_awards(match_id, profile_id)` has a unique key and payload fingerprint.
SQLite uses transactions/WAL and explicitly closed connections. Clearing all guest
credentials (cookie plus owned tab grant) loses access to a guest; this is not a portable authenticated account. Real cloud
persistence still requires a durable deployment volume.

## VERIFIED

Run the commands below for exact latest counts; assertions are real tests, not
statements that future/native features work.

- Python authority/transport/storage/regression suite: **135 passing tests** at
  this report revision, including all five original compressor regressions.
- TypeScript prediction/interpolation/preferences: **35 passing unit tests**.
- Real network acceptance: **2 / 4 / 8 independent authenticated sockets**, room/
  teams/ready/countdown/movement/facing/time/reconnect/owner/late-join/cleanup;
  scheduled 120–220ms delayed/reordered packets and a rejected ninth join.
- Real two-client TDM acceptance uses only legal intent navigation through cover,
  authenticated loadout, switch, ADS and server-derived headshot. Both sockets
  observe health/armor/death/kill/score/victory/results, actual durable XP/profile/
  history and replay-safe receipt/rematch. No exposed teleport/damage helper.
- **14 passing browser E2E scenarios** include two independent Chromium processes: real keyboard movement,
  simultaneous ADS/fire, visible enemy meshes, health/death/respawn/score/feed,
  timed reload/slot switch and explicitly confirmed abort with no fake reward.
- A complete private duel verifies visible victory/defeat, committed XP, level,
  history and profile after leave. Explicit solo BOT practice is checked without
  pretending the bot is online or awarding competitive XP.
- Touch-emulated real pointer events verify actual server ammo decrement, timed
  reload, ADS toggle, grenade quantity and portrait/landscape controls. Baseline
  room, disconnect/refresh, invalid-room, preference and API-failure tests remain.
- Ten-map matrix: two real independent authenticated sockets create/join/start
  and observe shared movement/timers on **each** selected map; public matching
  rejects other-map reuse. Real selected-map AI ticks/collision are tested on
  all ten layouts. Browser tests select all ten different previews and compare
  actual room map IDs/rendered selected-map fields across two clients.
- Real mouse/G browser input captures the requested target and proves that the
  received authoritative grenade state lands there within 3.5cm. Server clear-
  path tests use 2.5cm; obstacle bounces and invalid range/boundary are checked.
- Strict TypeScript build, Ruff/format checks and Vite production browser build.
  Final compiled `/arena/` startup/real room/WebGL cleanup smoke is also checked locally; it is not a deployed hosting claim.
  Software GPU test timing is not a 60FPS device-performance claim.

## NOT VERIFIED / known limits

- Rork SDK/runtime integration, iOS/Android native binaries, Safari/WebKit,
  controller hardware, store signing/submission, voice chat or microphone use.
- A measured 60FPS target, battery use, low-end physical phones, sustained
  distributed-load tests or eight simultaneously rendered browser clients.
- Published production deployment, cross-region internet conditions or durable
  hosting volumes. Docker/Render/CI definitions are provided but have not been
  deployed; Docker build itself is unverified in this sandbox (no Docker daemon).
- Map vertical traversal/interiors/stairs, destructible concrete/buildings,
  cinematic killcam, production glTF/skeletal AAA asset pipeline, audio surface
  types and universal input remapping. The map is flat; soldier/weapon assets are
  procedural stylized playtest assets, not a claim of completed commercial art.
- Single backend worker/replica only. Live rooms are memory-owned and disappear
  on restart; identities/results remain only where SQLite storage is durable.
- Guest-cookie identity is not email/account authentication. No portability,
  player identity verification, moderation service, ranked ladder or public
  skill-based matchmaking backend is claimed.
- Client/server checks are meaningful anti-cheat boundaries, not a guarantee of
  a complete commercial anti-cheat. Bounds/lag compensation/visibility are tested
  implementations, not a claim to defeat every exploit.

## ERRORS

No known runtime errors in the passing tested paths at this revision; that is
**not proof that every possible bug is eliminated**. Non-blocking Starlette test
compatibility, Zod/Rollup comment annotations and the deferred renderer chunk's
512.97KB minified-size warning (~131KB gzip) remain documented. An old socket
QA observer raced its room-state frame after welcome under parallel software-
GPU load; reconnect assertions now wait for an actual non-null room. This was
an observation-boundary correction, not a simulated room or a gameplay bypass.
New defects require a reproducible test and regression fix, not a zero-bug promise.

## Run / verification / web release shape

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements-dev.txt
npm --prefix tactical-arena ci
npm --prefix tactical-arena run build
# Server — exactly ONE writer
.venv/bin/uvicorn main:app --host 0.0.0.0 --port 8000 --workers 1 --ws-max-size 4096
# Development browser preview — proxies relative /arena/api and /arena/ws
npm --prefix tactical-arena run dev
```

Frontend: port 5173. Compiled browser game: `/arena/` on port 8000. The compressor
root is preserved by default. `ARENA_AS_HOME=1` optionally makes a dedicated web
service land on the built game without deleting the compressor routes.

```bash
.venv/bin/python -m pytest -q
.venv/bin/ruff check arena_server tests/test_arena_*.py scripts/verify_arena_*.py
.venv/bin/python scripts/verify_arena_network.py
.venv/bin/python scripts/verify_arena_combat.py
.venv/bin/python scripts/verify_arena_maps.py
npm --prefix tactical-arena run check
npm --prefix tactical-arena run test:unit
npm --prefix tactical-arena run test:e2e
npm --prefix tactical-arena run build
```

`Dockerfile.arena` builds the web client before serving it with one Python worker.
`render-arena.yaml` is separate from the existing compressor configuration and
requires a durable disk. Use TLS, trusted reverse-proxy configuration, an actual
persistent `ARENA_DB_PATH`, and configure the legacy auth secret if exposing that
legacy API. `/arena/api/ready` is a real 200/503 authority readiness endpoint.
A CI workflow runs builds/tests and actual socket/browser checks, but no GitHub
CI run or successful published deployment is claimed here.

## NEXT — release gate, not more fake features

Physical Android/iOS browser and controller QA; sustained adverse-network/load
and performance measurements; actual HTTPS durable-storage hosting verification;
then an official Rork/native adapter only when the real SDK/project is supplied.
Art/skeletal/vertical-map production work remains a separate, explicit scope.
Do not describe this tested browser playtest as an already-certified native,
store-ready, zero-bug commercial product.

## Embedded guest entry regression — 2026-10-04

The user-reported AUTH_REQUIRED error was reproduced exactly in a real
cross-site iframe: guest POST succeeded but the browser did not send its Lax
cookie to the WebSocket. Existing top-level-browser tests did not cover that
boundary. The fix is not a fake login or permission bypass:

- Allowed external HTTPS Origin is used for secure cookie attributes behind
  an HTTP preview proxy, without blindly trusting forwarded headers.
- A separate random 256-bit, 24-hour transport grant maps only to the owned
  guest identity; grants are hashed in SQLite, bounded and renewed on owned
  bootstrap. Cookies remain HttpOnly and cookie-only integration stays valid.
- HTTP uses a bearer header; browser WebSockets select a public auth-first
  subprotocol and prove the grant in their first data frame. No query token,
  raw credential logging, claimed player ID or backend secret is used.
- Wrong/expired/forged proof or origin is rejected before room membership.
  Combat authority, cooldown/ammo/score checks and one-connection-per-identity
  are unchanged. A mismatched cookie cannot override the proved tab identity.
- Grants stay in memory/sessionStorage, never localStorage. If the browser
  forbids all tab storage, authorization still works in the current page but
  cannot promise identity access after reload. Cookie/portable-account limits
  remain explicit.
- Added regression checks for real cross-site Quick Play, private practice,
  same-identity page refresh, authenticated loadout saving, zero-cookie real
  requests, HTTPS proxy cookie policy, expiry, hashed persistence and forgery.

The historical text below/above about cookie-loss alone should now be read as
loss of all available guest credentials (cookie plus owned tab grant).


## Current correction revision — 2026-10-05

The requested sliding/readability/team-uniform/weapon-hold/ten-map/mouse-frag
changes are implemented in the playable browser game and validated with the
checks above. Protocol **v3** adds real map selection/catalog, bounded radar
contacts and targeted-grenade flight/landing state; client and server contracts
are updated together. The original compressor and embedded guest fix remain.

The 135 / 35 / 14 counts are the latest local completed regression results;
real socket matrix and ten-map/TDM scripts passed separately. Passing automated
and visual checks does not guarantee all physical devices or all bugs. Playtest
assets remain procedural and stylized; there is no native/store/AAA claim.
