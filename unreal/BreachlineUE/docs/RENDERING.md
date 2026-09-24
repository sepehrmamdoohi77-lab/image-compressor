# Rendering — how the "high graphics" build is actually configured

Everything here lives in `Config/DefaultEngine.ini` (project-wide defaults) and
`UBreachlineGameInstance::ApplyQualityTier()` (runtime CVar sets), so the look is
reproducible from a clean checkout and never depends on someone's editor state.

Art direction: **dusk urban compound** — a low warm sun, cool blue sky bounce,
heavy atmospheric haze, wet-looking asphalt, muzzle flashes and street lamps that
cast real shadows. Every setting below serves that look *and* a stable frame time.

---

## 1. Feature map

| Feature | Setting | What it buys in this game |
| --- | --- | --- |
| **Lumen (HW RT)** | `r.DynamicGlobalIlluminationMethod=1`, `r.ReflectionMethod=1`, `r.Lumen.HardwareRayTracing=True`, `r.Lumen.HardwareRayTracing.LightingMode=1`, `r.Lumen.TraceMeshSDFs=1` | No lightmaps anywhere. Concrete interiors bounce warm light from doorways, and the DMR's tracer lights the wall it passes. `TraceMeshSDFs` keeps Lumen robust against the runtime-generated blockout geometry, which has no distance fields baked. |
| **MegaLights** | `r.MegaLights.EnableForProject=True`, `r.MegaLights.ShadowMethod=1` | Six street lamps + a muzzle flash per shot + explosion lights all cast **real shadows**, simultaneously, without a light-count budget fight. This is the single biggest visual jump over the web build, whose muzzle flashes were unshadowed point lights. |
| **Substrate** | Substrate enabled for the project; materials authored with layered BSDFs | Wet asphalt over aggregate, painted metal over rusted steel, damp sandbags. Fallback materials use the simple path so the game still renders if a designer ships a non-Substrate material. |
| **Virtual Shadow Maps** | `r.Shadow.Virtual.Enable=1`, block resolution 4096, SMRT on | A 176 m compound at 40° elevation needs shadows that hold up at long range; VSMs give per-pixel shadow resolution where it matters (near the operator) and stay cheap far away. |
| **Nanite** | project-enabled | The compound is blockout now, but the moment real art is dropped in, dense meshes cost nothing extra. Nothing in the project depends on Nanite being active. |
| **TSR** | `r.DefaultFeature.AntiAliasing=4`, `r.ScreenPercentage=100`, `r.SuperResolution.Enable=True` | 100 % native on high-end. TSR is fed by the isometric camera and the many *small, fast* highlights (tracers, muzzle flash, sparks) that would shimmer badly under TAA alone. |
| **Volumetric fog + FSSS** | `r.VolumetricFog=1`, fog screen-space scattering | Light shafts through the gates; muzzle flashes bloom into the haze. In a top-down game, fog is what separates "a box with a person in it" from "a place". |
| **Fixed exposure** | `r.DefaultFeature.AutoExposure=False`, manual + bias 11.5 in the post-process volume | Auto-exposure pumping is unreadable when a grenade goes off in frame. The tactical picture must stay stable. |
| **No motion blur, vignette 0.45, grain 0.12, no chromatic aberration** | post-process volume (`ACompoundBuilder::SpawnLighting`) | Clarity first. The only moving-camera artefact left is the deliberate trauma shake, which the player causes. |

## 2. What the game does with it

* **Muzzle flash** — a pooled point light (`FX::MuzzleFlashLightIntensity` 12 000)
  plus a Niagara-or-blockout flash quad. With MegaLights on, each shot throws a
  real shadow of the shooter onto the wall behind them, which is how the player
  reads "someone just fired at me from the left" without a UI element.
* **Tracers** — pooled instanced meshes, `LifeTime = clamp(range / 900, 0.04, 0.12)`
  and thickness 2.2 (3.4 for hostiles), enemy colour `(1.0, 0.416, 0.361)`. Traced
  along the actual bullet path, not from muzzle to impact.
* **Explosions** — two expanding burst ISMs (0.55 s and 0.9 s) plus a short-lived
  light, which MegaLights shadows across the whole compound. Combined with
  volumetric fog this is the loudest thing the renderer has to do, and it is still
  one light.
* **Ambient dust** — a Niagara system (or a static dust field) that follows the
  player's focus, so the near field never looks sterile.
* **Sky** — a dusk gradient: sun intensity 9 lx-class, colour `(1.0, 0.72, 0.48)`;
  sky light intensity 1.1, colour `(0.45, 0.58, 0.85)`, real-time capture.

## 3. Quality tiers (runtime)

`UBreachlineGameInstance::ApplyQualityTier()` maps the profile setting to CVars —
this is what a player toggles in settings, and it is also how the game survives an
integrated GPU:

| Tier | Global Illumination | MegaLights | Shadows | FX density | Voice budget |
| --- | --- | --- | --- | --- | --- |
| **High** | Lumen HW RT + reflections | On | VSM | 1.0 | 48 |
| **Medium** | Lumen (software tracing / Irradiance Fields) | Off | VSM | 0.7 | 32 |
| **Low** | Irradiance Fields only, reflections off | Off | Shadow maps, no VSM | 0.4 | 16 |

The tier is persisted in the `BreachlineProfile` save game (slot `BreachlineProfile`)
and applied at boot, before the first frame.

## 4. Performance notes for the compound

* The compound is **instanced blockout**: four `UInstancedStaticMeshComponent`s
  (walls, floors, crates, barrels) plus one for cover. A few hundred pieces cost a
  handful of draw calls, which leaves the frame budget for Lumen and shadows where
  it belongs.
* The AI is **tick-throttled** (0.05 s controller tick, 0.16 s perception, 0.55 s
  decisions). 20 hostiles with LOS traces cost about as much as one character's
  animation.
* The **HUD is canvas-only** (a few hundred line/tile primitives). No UMG widget
  tree is created or ticked.
* Audio is a **48-voice procedural synthesiser** (see `BreachlineSfxSynth.cpp`), so
  there are no streaming assets to load and no voice-count cliff.

## 5. Tuning the look in an afternoon

1. `Config/DefaultEngine.ini` — start here. Every renderer decision is commented
   with its reason; change the comment when you change the number.
2. `ACompoundBuilder::SpawnLighting()` — sun angle/colour, sky, fog, post-process.
   This is the file a lighting artist should open first (it is 120 lines and
   everything is a named literal).
3. `Private/UI/BreachlineHUD.cpp`, the anonymous-namespace palette at the top —
   every HUD colour in one block, so the UI can be rethemed without hunting.
4. Materials: point **Project Settings → Game → Breachline → Presentation** at your
   own wall/building/crate/sandbag/barrel meshes; the runtime builder prefers them
   when they are set, and falls back to `/Engine/BasicShapes` when they are not.
