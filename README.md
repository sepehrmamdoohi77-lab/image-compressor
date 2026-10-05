# Image Compressor MVP

## Run locally
```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
uvicorn main:app --reload
```

Open http://127.0.0.1:8000

در صفحه می‌توانید تصاویر JPG، PNG، WEBP، GIF، BMP، TIFF، HEIC و AVIF را فشرده یا به فرمت دیگری تبدیل کنید. سقف تصویر ۱۰۰ مگابایت و سقف ویدیو ۱ گیگابایت است. نام فایل اصلی حفظ می‌شود و پسوند `_compressed` به آن اضافه خواهد شد.

بخش ویدیو فرمت‌های رایج ورودی را با FFmpeg می‌خواند و خروجی MP4، WEBM، MOV، MKV و AVI تولید می‌کند. برای پردازش آن وابستگی `imageio-ffmpeg` نصب می‌شود. حجم مجاز ویدیو ۱ گیگابایت است.

## Deploy
Push this folder to GitHub and connect the repository to a hosting provider that supports Python web services.

---

## Tactical Arena 0.2 — real browser tactical shooter

The compressor remains at `/` by default. The new game is at `/arena/` after
building, or in the **Tactical Arena** Vite live preview on port **5173**.

This checkout has no Rork SDK/runtime or native build. It contains a real
FastAPI/WebSocket-authoritative browser game: Team Deathmatch, five weapon
classes, ADS/recoil/spread, timed reload, armor/hit zones, grenades, cover
collision/destruction, kills/deaths/respawns, scores/results/rematch, human-only
Quick Play, explicit private BOT practice, real guest XP/stat/profile/loadout
persistence, combat effects/audio and keyboard/touch/gamepad intent. Ten selectable
physical maps share the same authoritative rules, with room-specific collision,
spawns and AI navigation. Characters use planted-foot IK and team-colored navy /
rust uniforms; five human-scale firearm meshes have actual hand-grip anchors.

It is a tested web playtest — **not** a claim of zero bugs, Rork/native support,
store readiness, a published deployment or measured physical-device 60FPS.

### Run

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements-dev.txt
npm --prefix tactical-arena ci
npm --prefix tactical-arena run build
# Terminal A: one authoritative worker
.venv/bin/uvicorn main:app --host 0.0.0.0 --port 8000 --workers 1 --ws-max-size 4096
# Terminal B: live browser game (same-origin API/WebSocket proxy)
npm --prefix tactical-arena run dev
```

Create/join a private room using separate browsers or private windows, or use
actual human-only Quick Play. For solo practice choose TDM, enough team slots,
and explicitly labelled bots. Practice never invents human opponents or XP.
Choose the actual field in the **SELECT COMBAT MAP** dropdown in Create Room
or Quick Play; public matching only joins the selected map.

WASD move; mouse aim; LMB fire; RMB ADS; Shift sprint; C crouch; R reload;
1/2 primary/pistol; G/3 frag at the mouse ground target (32m maximum; cover can
block/bounce the physical throw); Q/E rotate; scroll zoom; Tab scoreboard; Esc local
menu. Touch has actual fire/ADS/reload/frag/movement/aim controls. Gamepad uses
standard RT/LT fire/ADS, RB sprint, X reload, Y switch, LB frag.

### Verification

```bash
.venv/bin/python -m pytest -q
.venv/bin/python scripts/verify_arena_network.py
.venv/bin/python scripts/verify_arena_combat.py
.venv/bin/python scripts/verify_arena_maps.py
npm --prefix tactical-arena run check
npm --prefix tactical-arena run test:unit
npm --prefix tactical-arena run test:e2e
npm --prefix tactical-arena run build
```

Browser E2E requires both servers. Linux headless Chromium is a **dev-only** npm
dependency, not shipped with the game; set `ARENA_CHROMIUM_PATH` to an installed
browser on other platforms.

Live matches are memory-owned: **ONE worker/replica**, no live-match persistence
across restarts. Guest/result durability requires a real persistent SQLite volume.
The compiled `/arena/` bundle must be built before starting the backend.
`ARENA_AS_HOME=1`, `Dockerfile.arena` and separate `render-arena.yaml` provide a
web release shape; Docker/cloud/native release has not been verified or published.

See [current architecture, QA evidence, bug fixes and honest limitations](docs/TACTICAL_ARENA_PLAYTEST.md).
The [Stage 1 report](docs/TACTICAL_ARENA_STAGE_1.md) is retained as historical scope.

### Embedded-preview authentication fix

Guest entry no longer depends on third-party cookies. Browser signup requests
an opaque, expiring **guest transport grant** from the actual server. HTTP
profile/loadout operations prove it with `Authorization`; the WebSocket proves
it in its first data frame before receiving a welcome or room membership. It
is not an admin/backend key, never enters a URL, and is hashed in SQLite.
The HttpOnly cookie path remains compatible with existing clients. The tab
grant is kept in memory/sessionStorage (not localStorage); blocked tab storage
means reload recovery cannot be promised. An allowed HTTPS browser Origin also
sets Secure/partitioned cookie attributes when TLS ends at the preview proxy.

Regression checks reproduce the original failed Quick Play screen in a real
cross-site iframe, then verify cookie-restricted Quick Play, private BOT-room
entry/countdown/vitals, reload recovery of the same guest and bearer-authenticated
loadout saving. Cookies/Set-Cookie are also removed in an isolated real-request
proxy test; no successful server state is mocked.

### Movement / readability / map / targeting revision — 2026-10-05

- Instant intent changes no longer advance an extra movement tick. Destroyed
  cover updates local collision prediction; remote transforms are not smoothed
  twice. Foot stance anchors and two-bone legs follow actual travelled distance.
- Full blue/navy and red/rust clothing, distinct readable teammate/hostile tags
  and team radar with confirmed sightings plus fading 5-second last-known marks.
  Active-TDM solid-wall enemy relevance is still enforced; no hidden live tracking.
- Outpost, Dockyard, Refinery, Rail Depot, Checkpoint, Courtyard, Scrapyard,
  Barracks, Bunker and Market are different 44m levels, not renamed UI cards.
- A mouse frag trajectory / ground marker previews the authoritative fixed-tick
  flight. Clear paths land within 3cm in tests; obstacles can physically block
  or bounce it. Touch/gamepad retain their directional facing throw fallback.
- Latest local verification: **135 Python tests, 35 TS unit tests, 14 browser
  scenarios**, real 2/4/8 sockets, two-client TDM/results, and two-client entry /
  motion on all ten maps. See the playtest report for unverified device/art limits.
