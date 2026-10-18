# TODO

Legend: **[you]** needs you (a real GPU, Windows, or a decision) · **[auto]** I can do it from WSL.

## Verify on real hardware

- [ ] **[you]** Real-time frame rate in Windows Chrome, especially Orb, Terrain and Particles (D shows render scale)
- [ ] **[you]** 1080p and 4K export from Windows Chrome
- [ ] **[you]** Live tab audio with Spotify or YouTube in another tab
- [ ] **[you]** Record live (C) in Windows Chrome: check the saved file plays and has audio. Untested: headless can't run it
- [ ] **[you]** Click a thumbnail in the preset browser (B) (rendering was checked headless; clicking wasn't)

## Done 2026-10-18, session 2 (details in JOURNAL.md)

- [x] Snare gate: `FrameAnalyzer.crackTonal` + `snareGate` in `bands.ts`. Brahms snares 62→25, Icy Flight 10→0, EDM about unchanged
- [x] Tempo ×2/÷2: T key / Music → Tempo, remembered per song (`src/tempo-memory.ts`, `scaleBeats` in `beats.ts`)
- [x] Beat-synced cuts: Auto VJ hard-cuts on downbeats in loud parts, on the 4-bar phrase grid (`buildSchedule` in `schedule.ts`)
- [x] Per-section looks: Look → "New look each section" (`sectionParams` in `reactivity.ts`)
- [x] Particles scene (7): kick embers, snare sparks, hat glitter, note orbs placed by pitch; new `uNoteHist`/`uNotePitch` uniforms
- [x] Preset browser (B): every preset rendered live at the current moment of the song (`src/ui/browser.ts`)
- [x] Record live (C, or Export video → Record live): canvas + song audio + live input via MediaRecorder (`src/export/recorder.ts`)
- [x] Docs updated; `docs/scenes.png` regenerated with Particles
- [x] `tools/shot.ts --keys TD`: press keys before a UI screenshot

## Still open

- [ ] **[auto]** Kick detector fires on note changes when the bass band is otherwise silent (synthetic signals only; real music fine)
- [ ] More palettes (low value)
- [ ] **[you]** `git init` and a first commit (enables prek hooks)
- [ ] **[you]** Write your own scene: copy `nebula.glsl` and follow TWEAKING.md
