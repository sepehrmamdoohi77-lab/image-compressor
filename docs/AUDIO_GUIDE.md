# AUDIO GUIDE

`game/audio/AudioManager.ts` — 100% synthesized Web Audio, zero assets.

## Architecture

- Lazily created on first user gesture (`unlock()`); all `play*` calls no-op
  safely before that. `suspend()` on pause, `resume()` on resume.
- 4 buses → master: **SFX / Music(ambient) / UI**, volumes from settings,
  live-applied with `setTargetAtTime` smoothing.
- One shared 2 s noise buffer; all sounds = filtered noise + oscillators.

## Sound set

| Sound | Synthesis |
|---|---|
| Weapon fire (×5) | noise burst (lowpass @ weapon freq) + square thump (+ sub sine for shotgun); per-weapon freq/duration |
| Enemy fire | same engine, distance-attenuated + stereo-panned |
| Reload / dry-fire | bandpass clicks + square tick, **per weapon class**: shotgun pump-back/forward + shell seat, DMR bolt up/home, mag-fed release/seat + charging handle |
| Footsteps | short lowpass ticks, cadence by speed |
| Impacts | bandpass/highpass noise (concrete/metal) |
| Grenade bounce / pin | triangle/metallic tick |
| Explosion | 1.1 s lowpass noise + 110→28 Hz sine + crack |
| Hitmarker / kill | square blips (headshot: higher + double) |
| Hurt / enemy death / alert | lowpass thump / noise fall / sawtooth chirp |
| Medkit pickup | two-note triangle rise (660→990→1320 Hz) + bandpass strap rustle |
| UI / win / lose | sine/triangle blips and 4-note stingers |
| Ambient | looped lowpass wind + 55 Hz drone + slow LFO swell |

## Positional model

`volume × (1 − d/maxAudible)`, stereo pan from target direction vs camera
right (×0.7). Player sounds full-volume centered; enemies attenuate over
~45 m; explosions carry ~50 m.

## Settings

Master/SFX/Music/UI sliders (0–1) apply live and persist. Corrupted storage
recovers to defaults without blocking launch.
