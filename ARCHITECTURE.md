# Architecture

## Big picture

```
            ┌──────────────────── file mode ─────────────────────┐
 audio file │ decodeAudioData ─► Web Worker: analyzeTrack()       │
            │                    (whole song, ~3 s)               │
            │                         │ TrackAnalysis             │
            │                         ▼                           │
            │ Player.time ────► FeatureSampler.sample(t) ──┐      │
            └──────────────────────────────────────────────┼──────┘
                                                           │ Features
            ┌──────────────────── live mode ────────────────┼──────┐
 mic / tab  │ AudioWorklet ─► LiveAnalyzer.push() (causal)  │      │
            │ LiveInput.time ─► LiveAnalyzer.sample(t) ─────┤      │
            └───────────────────────────────────────────────┼──────┘
                                                            ▼
                         Settings ─► Reactor.build() ─► uniforms
                                                            │
                                                            ▼
   Renderer:  scene shader ─► trails ─┬─► bloom ───────────────┬─► composite ─► canvas
                 ▲              │     └─► luminance ─► adapt ──┘     │
                 └── uPrev ◄────┘                                   ▼
                                                     Export: CanvasSource ─► MP4
```

`App` (`src/app.ts`) owns the loop: every animation frame it asks the current
*feature source* for `Features` at time *t*, turns them into uniforms, and renders.
Export calls the same `renderAt(t, dt)` with exact timestamps.

## Source map

```
src/
  analysis/            pure TypeScript DSP, no DOM; runs in Node tests and the worker
    fft.ts             radix-2 FFT
    frame.ts           one window → mel, MFCC, chroma, centroid, flatness, rolloff, crackTonal
    bands.ts           detector definitions shared by offline + live (tune drums here)
    track.ts           offline analysis of a whole song → TrackAnalysis
    beats.ts           tempo (autocorrelation + prior) and Ellis DP beat tracking
    dsp.ts             percentile, median, smoothing, peak picking
    sampler.ts         TrackAnalysis + time → Features (envelopes, beat phase, history)
    live.ts            causal LiveAnalyzer with the same Features output
    types.ts           feature and event names
    test-signals.ts    synthetic kick/snare/hat/pad generators for tests
  audio/               Web Audio: player, analysis worker, capture worklet, library
  render/
    gl.ts              WebGL2 helpers (programs with auto-typed uniforms, targets)
    renderer.ts        the pass pipeline above
    reactivity.ts      Features + Settings → uniforms (the "mapping layer")
    palettes.ts        4-stop gradients, section cycling
    shaders/           common.glsl (shared header), feedback, bloom, luminance, composite
    scenes/            one .glsl per scene + index.ts registry (params, look, palette)
  ui/                  lil-gui panel, debug HUD, title card, preset browser
  export/video.ts      offline WebCodecs export via mediabunny
  export/recorder.ts   real-time recording (canvas + audio) via MediaRecorder
  tempo-memory.ts      per-song tempo ×2/÷2 corrections in localStorage
  settings.ts          every tweakable value with its range (single source of truth)
  presets.ts           built-in presets per scene, localStorage, scene params
tools/                 Node CLIs: analyze.ts (plots), shot.ts (headless stills/export), palettes.ts
```

## Audio analysis (offline)

All of it is in `track.ts`, hop 512 samples (~86 frames/s at 44.1 kHz), window 2048.

```
samples ─► FrameAnalyzer (per frame) ─► mel power [frames × 64]
                                         │
                       HPSS (median filters in time and frequency)
                        ┌────────────────┴────────────────┐
                 percussive mel                     harmonic mel
                        │                                 │
          log(1 + 100·x/ref) per band            log compression
                        │                                 │
        SuperFlux band flux in:                   flux 150 Hz–5 kHz
          35–150 Hz  ─► kick ODF                        ─► note ODF
          1–5 kHz    ─► snare ODF
          7–20 kHz   ─► hat ODF × hat gate (rise must be mostly >7 kHz)
                        │
        peak picking (local max + adaptive mean + floor + min gap)
                        │
        snare gate: crackTonal 3 frames later (does the 1–5 kHz fine
        structure persist? harmonics yes, noise no) drops piano/pluck "snares"
                        ▼
                kick / snare / hat / onset / note events (time, strength)

pulse = kick + snare + hat + onset ODFs (each normalised)
   ─► estimateTempo (autocorrelation × log-normal prior around 120 BPM)
   ─► trackBeats (dynamic programming) ─► beats; downbeat = slot with most kick
MFCC 1–12 ─► z-score ─► PCA (3 comps) ─► timbreX/Y/Z (signs pinned to brightness/noise/loudness)
chroma ─► circle-of-fifths vector ─► hueX/Y (key colour)
[timbre, chroma, intensity] ─► novelty (3 s before vs after) ─► section events
```

Every continuous feature is normalised **per song** (percentiles), so a quiet
acoustic track moves the visuals as much as a brickwalled EDM track.

### Why HPSS matters

Without it a sustained bass line or pad "flickers" in the kick band and fires false
kicks. Median filtering across time keeps sustained energy (harmonic), median filtering
across frequency keeps broadband clicks (percussive). Drum detectors only look at
the percussive part.

## Features → uniforms

`Features` (`sampler.ts`) is what any visual can know at time *t*:

- `scalars`: 20 continuous values (bands, loudness, brightness, timbre…)
- `env[kind]`: decaying impulse per event kind (decay set in *Envelope decay*)
- `recent[kind]`: the last 8 hits as (age, strength), for shockwaves that keep travelling
- `notePitch`: pitch class of each of those 8 notes (read from chroma 30 ms after the onset)
- `count`, `since`: event counters (alternate colours per hit, etc.)
- `beatPhase`, `barPhase`, `tempo`, `energyTime` (a clock that runs faster when busy)
- `mel` (64 bands), `chroma` (12)

`Reactor.build` (`reactivity.ts`) applies the reactivity gains and produces the uniforms
listed in `src/render/shaders/common.glsl`. That file is the contract between the
music side and the shader side. Before that, `sectionParams` nudges the scene's
params per section (*Look → New look each section*).

A song's tempo can be corrected ×2 / ÷2 (<kbd>T</kbd>): `App` keeps the cached analysis
untouched and runs `scaleBeats` (`beats.ts`) over its beat and downbeat tracks, then
builds a new `FeatureSampler`. The choice is stored per song (`src/tempo-memory.ts`).

## Auto VJ

```
sections ─┐                    quiet part: crossfade that lands on the section
downbeats ├─► buildSchedule ─► loud part:  hard cut on the nearest downbeat,
intensity ┘   (schedule.ts)                plus a cut every N bars on the phrase
                    │                      grid of the nearest section change
                    ▼
             sceneAt(t, events) ─► scene now, scene fading out, mix
```

Both are pure functions recomputed every frame, so seeking and exporting always agree.
Live input can't look ahead (a late-detected section would rewrite the past), so it
keeps its full section/downbeat history and aligns cuts to the previous section only.

## Rendering

- Scenes render linear HDR into an RGBA16F target at *render scale* × canvas size.
- **Trails**: `feedback.glsl` lays a zoomed/rotated/hue-shifted copy of the last frame
  under the new one, weighted so it can't accumulate to white.
- **Bloom**: 13-tap downsample / tent upsample chain (6 levels), soft threshold.
- **Auto-exposure**: mipmapped log luminance → 1×1 average → eased over ~1.2 s → each
  scene's `exposureKey`. Clamped to 0.5–2× so it evens out loud vs quiet passages
  without flattening a scene's look.
- **Composite**: chromatic aberration (kicks/snares widen it), flash, ACES tonemap,
  vignette, grain, title card, dither.
- All trail parameters are scaled by `dt`, so 30, 60 and 144 fps look the same.

## Live mode differences

`live.ts` reuses `FrameAnalyzer`, the detector definitions in `bands.ts`, and
`estimateTempo`, but:

| Offline | Live |
| --- | --- |
| HPSS with centred median | median over the *past* 17 frames |
| peak picking sees ±3 frames | decides 2 frames (~23 ms) late |
| per-song percentile normalisation | `AdaptiveRange`: min/max that relax a few dB per second |
| global DP beat tracking | tempo re-estimated every second; a phase-locked loop nudges the beat grid toward onsets |
| PCA timbre | running z-scores of MFCC 1–3 |
| novelty compares before/after | short vs long running averages |
