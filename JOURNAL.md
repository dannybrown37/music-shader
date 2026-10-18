# Build journal

Running log of the autonomous build, newest last. Read this first to see what was
done, why, and what is still rough.

## 2026-10-18: session 1

**Goal (from you):** a music visualizer that is very sensitive to timbre and rhythm,
configurable, unique, YouTube-worthy. Drum hits and different instruments should be
obviously visible.

### Decisions

- **Offline analysis first, live second.** For a file we can analyse the whole song
  before playing it. That allows look-ahead peak picking, global beat tracking, and
  per-song normalisation (a quiet song moves the visuals as much as a loud one).
  Live mic/tab input is a separate, causal path, still to do.
- **Hand-written DSP in TypeScript, no audio libraries.** It runs in a Web Worker
  (about 3 s for a 3-minute song) and is unit-tested with synthetic drums
  (`src/analysis/test-signals.ts`).
- **Raw WebGL2, no three.js.** Every scene is one fragment shader sharing a uniform
  header (`src/render/shaders/common.glsl`). Post-processing (trails, bloom, ACES,
  chromatic aberration, grain) is shared.
- **Frame-exact video export** with WebCodecs via `mediabunny`: each frame is rendered
  at t = i / fps, so a 4K export is smooth even if your GPU can't do 4K in real time.

### Validation against your MP3s

- `node tools/analyze.ts <mp3> --png out/x.png` plots the spectrogram, every detector
  and every feature over time.
- Tempo agrees with librosa 0.11 on about 37 of 48 tracks. Most disagreements are
  half/double or 3:2 confusions, where librosa's coarse tempo bins also differ.
- The hat detector says some EDM tracks have **no hats**. I checked: on those tracks
  every high-band transient is broadband (a snare or clap), not HF-dominant. On tracks
  with real hats (Octanique, Forest) the split is cleanly bimodal.
- The "snare" detector really means *any sharp transient in 1–5 kHz* (snares,
  claps, plucks, stabs). That's useful visually, but don't expect it to be a pure snare.

### Status

- [x] Analysis: FFT, mel, MFCC, chroma, HPSS, kick/snare/hat/onset/note detectors,
      tempo + beats + downbeats, timbre PCA, key colour, novelty / section changes
- [x] Feature sampler (envelopes with adjustable decay, beat/bar phase, hit history)
- [x] Renderer: scene → trails → bloom → composite
- [x] Scenes: Nebula, Terrain, Orb
- [x] Control panel (lil-gui), presets (save/load/import/export JSON), keyboard shortcuts
- [x] Title card overlay, debug meters (D)
- [x] Scenes: Tunnel, Kaleido
- [x] Export tested headless in Linux Chrome: 3 s, 320×180, H.264 + Opus MP4, 90 frames
      (`node tools/shot.ts --export 3 ...`). Linux Chrome has no AAC encoder so it picked
      Opus; Windows Chrome should pick AAC. Both are fine for YouTube.
- [x] Live input (mic / tab audio): `LiveAnalyzer` (causal) + AudioWorklet capture.
      Tested headless with Chrome's fake mic fed from Haus of You: tempo locked at 128.0,
      same as offline. Synthetic tests: kick/snare/hat 100% precision and recall, beats
      within ~2 ms.
- [x] Auto-exposure (eye adaptation) with a per-scene `exposureKey`
- [x] Scene 6: Ensemble (one visual voice per musical part)
- [x] Docs: README, ARCHITECTURE, TWEAKING, CLAUDE.md, justfile
- [x] Auto VJ: scene changes on section boundaries with a crossfade that lands on the change
      (`src/render/schedule.ts`, a pure function of section times, so exports and seeks agree)
- [x] Dynamic resolution (`src/render/quality.ts`): drops render scale on sustained slow
      frames and recovers. It doesn't retry a too-slow level for 30 s, to avoid see-sawing.
- [x] Shader hot reload: saving a scene's .glsl swaps it in without reloading or re-analysing.
      A compile error shows at the top with .glsl line numbers and the old shader keeps running
      (both cases tested headlessly).
- [x] Analysis cache in IndexedDB (bump `ANALYSIS_VERSION` in `src/analysis/types.ts` when analysis changes)
- [x] *Surprise me* (R): random variation of the current scene for exploring
- [x] Demo render: `docs/demo-haus-of-you.mp4`, 20 s at 640×360, rendered headless on CPU,
      with the title card and an Auto-VJ crossfade from Nebula to Terrain
- [ ] Export tested in Windows Chrome with a real GPU at 1080p/4K
- [ ] Real-time frame rate of the raymarched scenes on your GPU (unknown; lower render scale if needed)

### How to pick this up

1. `just dev`, then `just open` (or browse to http://localhost:5173 in Windows Chrome).
2. Pick *Haus of You* in the Library, press <kbd>Space</kbd>, press <kbd>D</kbd> for
   the meters, then <kbd>1</kbd>–<kbd>7</kbd> to flip scenes.
3. Open `src/render/scenes/nebula.glsl` in your editor, change a number, save, and
   watch it hot-reload.
4. Read TWEAKING.md in order; it goes from panel sliders to writing shaders.

### Ideas not done yet (roughly by value)

- A noise-vs-tone gate on the snare detector, so piano/pluck attacks stop counting as snares.
- Per-section *looks*, not just palettes: re-roll scene params a little at each section.
- Particles: a GPU particle scene where each instrument class emits its own particle type.
- Beat-synced camera cuts (hard cuts on downbeats in high-intensity sections).
- An "ideas lab" preset browser: thumbnails of each preset, rendered with `tools/shot.ts`.
- Tempo octave choice: librosa and this analyser disagree on ~1/5 of tracks
  (half/double or 3:2). A per-song "×2 / ÷2 tempo" button would be the pragmatic fix.

### Detector changes after testing on real music

- **Notes** used to be harmonic-only flux. It fired about 6 times a minute on the Brahms
  sonata because HPSS files note attacks under "percussive" for ~100 ms, and the snare's
  tonal body fired it falsely. Now a note is *any onset with no drum hit within 40 ms*
  (`NOTE_DRUM_GUARD` in `bands.ts`). That gives ~60/min on Brahms and 100–200/min elsewhere.
- **Chroma** is now magnitude-weighted (it was power-weighted), so chords light several
  pitch classes instead of only the loudest partial. The Ensemble note wheel depends on it.
- **Sections** need ≥ 8 s between them (it was 4 s); Brahms went from 28 to 17.
- Known limitation: in classical/piano music the "snare" detector fires on hammer
  attacks (sharp 1–5 kHz transients). A noise-vs-tone gate could fix it; not done yet.

### Look-dev notes

- Every scene was tuned from headless SwiftShader stills (`tools/shot.ts`), so they're
  checked for composition and exposure but not for real-time frame rate. Raymarched
  scenes (Orb, Terrain) are the heaviest; lower *Look → Render scale* if they stutter.
- The first renders were blown out. Causes: the bloom chain summed 6 levels without
  normalising, and the cosine palettes were pastel. Palettes are now 4-stop
  dark→vivid→highlight gradients (`src/render/palettes.ts`, preview with
  `node tools/palettes.ts`). *Mono* and *Ice* are excluded from per-section cycling
  because their white highlights wash out.

## 2026-10-18: session 2

Worked through the **[auto]** items in TODO.md.

### Snare gate (piano no longer fires snares)

- First idea, flatness of the 1–5 kHz *rise*, failed: real noise has half its bins
  falling, so synthetic snares scored lower than piano.
- What works: **temporal stability of the fine spectral structure**. Detrend the log
  spectrum in 1–5 kHz and correlate frame f+3 with f+1 (`FrameAnalyzer.crackTonal`).
  Harmonics keep their peaks (≈0.7–0.9); noise decorrelates (< 0.5). Linear magnitude
  was worse (EDM snares spread upward); f vs f+2 was worse (the onset frame mixes old and new notes).
- `snareGate` keeps a snare below 0.6, drops it at 0.75+. Live waits one extra frame (~12 ms) for snares only.
- Result: Brahms 62 → 25 snares, Icy Flight 10 → 0, Square Spelunking 69 → 37, Forest (lofi keys) 220 → 156,
  Haus of You 230 → 224, Neon Street unchanged. `ANALYSIS_VERSION` bumped to 2.
- Found on the way: a synthetic piano with no bass makes the kick band fire on chord changes
  (window sidelobe leakage into an empty band, amplified by `REF_FLOOR`). Raising `REF_FLOOR`
  didn't fix it and moved Corners' tempo, so I reverted; real recordings don't show it (Brahms: 12 kicks).

### Tempo ×2 / ÷2

`scaleBeats` rewrites beats and downbeats (bars stay 4 beats; ÷2 keeps the beats in phase
with the downbeat). Applied on top of the cached analysis, stored per song by cache key.

### Auto VJ beat cuts

`buildSchedule` turns sections + downbeats + intensity into events. A section in a loud
part becomes a hard cut snapped to the nearest downbeat; loud stretches get extra cuts
every N bars **on the phrase grid of the nearest section change** (the first version
counted from the last cut and put a cut one bar before a drop). Live input doesn't look
ahead, and now keeps its full section/downbeat history (the 256-event cap would have
shifted cut positions after ~8 minutes).

Intensity is per-song normalised, so a steady lofi track counts as "loud" most of the
time and cuts every 4 bars throughout. Raise *Auto VJ: loud above* if that's too busy.

### Particles scene, per-section looks, preset browser, live recording

- Particles is procedural: every particle's position is a closed-form function of its
  hit's age (ballistic motion with drag), seeded by the hit counter. That keeps exports
  frame-exact with no particle state. Notes needed new uniforms: `uNoteHist`, `uNotePitch`
  (pitch class read from chroma 30 ms after the onset, offline and live), `uNoteCount`.
- First renders clustered in the centre and Brahms showed only a blurry blob; widened the
  bursts, tightened the core, added the faint pitch wheel and the melody lines.
- The preset browser renders thumbnails with the real renderer at the current song time
  (one per animation frame), not a build step, so saved presets get thumbnails too.
- Recording uses MediaRecorder (MP4 if Chrome supports it, else WebM), streamed to a
  file via the save dialog. Not testable headless; needs a check in Windows Chrome.
