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

## 2026-10-18: session 3

**Feedback:** Tunnel is the favourite ("directly visualizes everything that happens");
Nebula and Terrain are good but not interesting over time; the rest are cool, not awesome.

### Why Tunnel works (the recipe applied to the other scenes)

1. **Every part owns a place**: frequency = angle around the wall, so you can point at the bass.
2. **History stays visible**: kick rings travel in, so you see the rhythm pattern, not just the current hit.
3. **All-or-nothing contrast**: tiles are lit or dark, not a little brighter.

### Terrain

- Kick waves (`p_waves`): each kick swells the land and draws a bright front that rolls toward
  you with the spectrogram, so kicks are laid out on the ground like Tunnel's rings.
- The sun is a 20-column equalizer (bass on the left).
- Bass hills and treble peaks get different palette colours; snares flash the whole grid.
- Hats run lights down the road dashes (on tracks that have hats).
- Each section picks a new camera height, offset and roll (`p_camera`; 0 = the old fixed camera).
  It is a hard cut on the section change.

### Nebula

- Quiet passages raise the density threshold, so the smoke thins to wisps and fills in when it gets loud.
- The spectrum runs outward from the core (bass centre, highs at the rim).
- Kick shockwaves (`p_shock`) expand from the core and push the smoke. They light the smoke they
  pass through and are only faint in empty space; the first try glowed everywhere and stacked into a target.
- Note flares (`p_notes`) on a clock face by pitch class (C at twelve o'clock).
- Each section picks a new drift direction and spin (`p_layout`), also a hard cut.

Before/after stills: `out/review/terrain-ab.png`, `out/review/nebula-ab.png` (top row old).

### Orb, Kaleido, Ensemble, Particles (same recipe)

- **Orb** is a spectrogram globe: latitude = frequency, longitude = age measured from the camera
  (the right-hand limb is now, the face is 1 s ago). LED tiles (`p_tiles`) light per band on a darker
  body; each section moves the camera and can reverse the orbit (`p_camera`).
- **Kaleido** is cut into 14 frequency rings (`p_bands`), lit or dimmed by their band; unlit rings dim
  further when quiet. Kick shockwaves (`p_shock`) push and light the crystal. Each section changes the
  fold count by -4..+2 and nudges the kaliset constant (`p_layout`).
- **Ensemble** is scaled up 25% and gains a history field outside the note wheel (`p_history`):
  the mirrored spectrum layout, age growing with radius, as lit cells.
- **Particles** gains a spectrum fountain (`p_fountain`): 40 emitter columns, one mote per column every
  1/24 s, kept only if its band was loud at emission (from the spectrogram), so it stays frame-exact.
  Each pixel checks the 3×3 nearest motes. Each section can flip it to rain down (`p_layout`).
  First render used half the frame width (aspect bug) and looked like a grid; fixed with y jitter
  and a cubic level threshold.

Before/after: `out/review/{orb,kaleido,ensemble,particles}-ab.png`.

### Not checked

- Real-time frame rate. Orb, Terrain and Particles now do more per pixel (spectrogram lookups in the
  raymarch, kick loops in the terrain height, 9 motes per pixel).

## 2026-10-20: session 4 (roadmap items 1–4)

You confirmed real-hardware performance (step 0), then asked for the rest of the roadmap end to end.

### 1. Melody and voice (`src/analysis/pitch.ts`)

- Harmonic summation over FFT peaks → 5 pitch candidates per frame → Viterbi line offline,
  greedy causal pick live. New scalars `melody`, `pitch`, `voice`; uniforms `uMelody uPitch uVoice`
  and a 2 s `melodyLine(age)` texture. `ANALYSIS_VERSION` → 3. Analysis is ~20% slower (+1 s per 3-min song).
- What real music taught me:
  - Absolute clarity thresholds left EDM at ~0 melody; lowered them, and gated on the HPSS
    sustained share, because a kick's pitch sweep read as a tune.
  - The first "voice" readings (flute 0.36, Blue Mars 0.49) were **beating**: two near-unison
    partials make the pitch jitter at ~21 Hz. Vibrato is 4–8 Hz, so the wobble is now
    low-passed first. This instrumental library now reads voice ≈ 0–0.09, which is honest.
    I couldn't test a real vocal track (none on this machine); a synthetic vibrato line over
    drums passes.
  - The pitch line flipped between two close candidates every frame; jumps now carry a fixed cost.
- Scenes: Tunnel gets mirrored melody ribbons on the wall (`p_melody`); Gauntlet writes the
  line across the sky, with held notes bright and jumps faint. Stills: `out/review/melody-scenes.png`.

### 2. Show (`src/render/show.ts`, `src/ui/timeline.ts`)

Per-song cues (scene, palette, cut/fade) that replace Auto VJ. Pure `showAt(t)`, so exports and
seeks agree. Timeline strip: sections, bars, cue blocks; K adds a cue on the nearest downbeat,
drag to move, Del to delete; *Start from Auto VJ's choices* seeds it. Screenshots:
`out/review/timeline-{desktop,mobile}.png`.

### 3. Cover art, lyrics, thumbnail

Composited in `composite.glsl`, so exports include them. Art is session-only (images are too big
for localStorage); lyrics (.lrc) are saved per song. Thumbnail = 1280×720 at the most intense
moment between 15% and 85% of the song. Stills: `out/review/art-sheet.png`, `out/review/thumbnail.png`.

### 4. Shipping

- `.github/workflows/ci.yml`: typecheck, lint, test, build, then `tools/smoke.ts` compiles and
  draws every scene in headless Chrome. A deliberately broken Tunnel shader made it fail, as it should.
- `.github/workflows/pages.yml`: GitHub Pages deploy (`BASE_PATH` from configure-pages). Checked
  locally: built with base `/music-shader/` and served with `vite preview`; the smoke test passes.
- Share links: Presets → *Copy share link* (settings in the URL hash, title left out, merged
  through `mergeSettings` on load).

### 5. Tessellate (scene 10, key 0)

- Tiles = Voronoi cells of a lattice with two point pairs per cell (horizontal pair at the cell
  corner, vertical pair at its centre). One family covers diamonds → triangles → Cairo pentagons →
  long hexagons as the pairs separate; turning the pairs against each other gives further tilings.
  A lattice-periodic bend keeps every tile congruent while the edges curve (Escher-like).
- Driven by: slow timbre (shape, bend, lattice lean), snare count (pairs turn π/8 per snare, eased
  over 0.18 s), kick (pairs pump apart), band per tile (nested outlines), kick history (tile waves),
  note pitch classes (tile pitch = hash mod 12), section seed (lattice).
- First pass used `uTimbre` directly and the tiling changed on every drum hit (timbre is only
  ~23 ms smoothed). Added `Features.timbreSlow` → `uTimbreSlow` (1 s average; live EMA τ = 0.5 s).
  No analysis change, so no `ANALYSIS_VERSION` bump.
- Also too bright at first (0.24 adapted luminance on the Haus drop): outlines covered the tiles at
  preview resolution. Bigger tiles, fewer and dimmer outlines → 0.06 there, 0.004–0.01 on ambient.

### Not checked

- Tessellate's frame rate on a real GPU (72 site lookups per pixel, cheaper than Kaleido's fractal).
- Real vocals (no vocal recordings here). Drag-drop of images/.lrc and the clipboard share link in
  Windows Chrome (headless covered loading via URL params, not the drop events).
- CI and Pages have never run on GitHub (no remote yet).
