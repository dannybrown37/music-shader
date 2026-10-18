# Music Shader

A music visualizer that listens closely. It hears **kicks, snares/claps and hi-hats**
separately, follows **timbre** (which instrument or synth patch is sounding), the
**musical key**, the **beat and bar**, and **section changes**, and drives GLSL
scenes with all of it. Built for making videos you'd upload: every scene is tuned for
dark, contrasty, bloom-lit frames, and export renders frame-exact MP4s.

![scenes](docs/scenes.png)

## Quick start

```bash
just install        # or: npm ci
just dev            # http://localhost:5173
just open           # (WSL) opens it in Windows Chrome, which has your real GPU
```

Pick a song under **Music → Library** (served from `MUSIC_DIR`, default
`../deluge-quest/web/public/audio`), drop any audio file on the page, or press <kbd>O</kbd>.
Analysis takes a few seconds per song, then press <kbd>Space</kbd>.

```bash
MUSIC_DIR=~/Music just dev    # use a different folder
```

## Keys

| Key | Action |
| --- | --- |
| <kbd>Space</kbd> | play / pause |
| <kbd>←</kbd> <kbd>→</kbd> | seek 5 s (<kbd>Shift</kbd>: 30 s) |
| <kbd>1</kbd>–<kbd>7</kbd> | switch scene (loads its built-in preset) |
| <kbd>B</kbd> | browse presets: each rendered at this moment of the song |
| <kbd>T</kbd> | tempo as detected → ×2 → ÷2 (remembered per song) |
| <kbd>C</kbd> | record live: start / stop |
| <kbd>P</kbd> | next palette |
| <kbd>R</kbd> | surprise me: random variation of the current scene (save it if you like it) |
| <kbd>D</kbd> | debug meters: what the analyser hears |
| <kbd>H</kbd> | hide all UI |
| <kbd>F</kbd> | fullscreen |
| <kbd>O</kbd> | open an audio file |

## Scenes

| # | Scene | What drives what |
| --- | --- | --- |
| 1 | **Nebula** | bass → warp depth · timbre → flow field · kick → zoom punch + core · snare → shockwave rings · hats → sparkles |
| 2 | **Terrain** | the land *is* the last 2 s of spectrum (bass by the road, highs on far peaks) · kick → sun · snare → grid pulse · hats → stars |
| 3 | **Orb** | spectrum wrapped by latitude · timbre → lobes + roughness · snare → spikes · kick → shockwave shells · hats → glints |
| 4 | **Tunnel** | spectrum lights equalizer tiles round the walls · kick → rings rushing in · snare → twist · hats → light streaks · noisy timbre cracks the tiles |
| 5 | **Kaleido** | timbre reshapes the fractal crystal · bass → zoom · snare → mirror rotation · hats → seam sparks · notes → jewels |
| 6 | **Ensemble** | one visual voice per part: kick → rings · snare → shards · hats → sparks · harmony → 12-note wheel on the circle of fifths · spectrum → ring · bass → core |
| 7 | **Particles** | kick → ember bursts · snare → motion-blurred spark fans · hats → glitter · each note → an orb launched from its pitch on the circle of fifths, joined to the previous note (melodies draw constellations) |

Every scene also gets trails, bloom, chromatic aberration, auto-exposure, grain and
vignette from the shared post-processing (*Look* folder).

**Auto VJ** (checkbox under *Scene*): moves to the next scene at detected section
changes, at most every *N* seconds. The crossfade starts just before the change so the
new scene lands on the drop, and it works in exports too. In loud parts it hard-cuts
on downbeats instead, every 4 bars on the song's phrase grid (*cut on the beat when loud*).
*Look → New look each section* also nudges the scene's parameters at every section.

If a scene stutters, the live view lowers its render resolution automatically and
climbs back when there's headroom (*Look → Render scale* sets the ceiling; the debug
meters show the current %). Exports always render at full resolution.

## Making a YouTube video

1. Load the song, pick a scene/preset, tweak.
2. Optional: *Overlay → Title card* (title and subtitle come from the file name).
3. *Export video*: choose resolution (720p → 4K, vertical, square), 24/30/60 fps, and a
   time range, then **Render video…**. Chrome asks where to save and streams the file to
   disk, so long 4K renders don't need to fit in memory.

Export is **offline**: frame *i* is rendered at exactly *t = i / fps*, so the video is
perfectly smooth even if your GPU can't do that resolution live. Click the button again
to cancel.

**Record live** (<kbd>C</kbd>, or *Export video → Record live*) is the other way: it
captures the canvas and audio in real time, so scene keys you press, Auto VJ and live
mic/tab input all end up in the video. It records at the window's size and the GPU's
frame rate, so go fullscreen (<kbd>F</kbd>) first and don't resize while recording.
Saves MP4 where Chrome supports it, otherwise WebM; both upload to YouTube.

## Live input

*Music → Live: microphone / line-in* or *Live: tab or system audio*. For tab audio,
Chrome's share dialog needs "Also share tab audio" ticked. Live mode uses a causal
analyser (about 25 ms look-ahead, adaptive normalisation), and the tempo locks after
about 4 s.

## More

- [ARCHITECTURE.md](ARCHITECTURE.md): how audio becomes pixels, with diagrams
- [TWEAKING.md](TWEAKING.md): change the look, the reactivity, the detectors; write a scene
- [JOURNAL.md](JOURNAL.md): build log, decisions, and what is still rough
