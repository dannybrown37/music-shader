# Tweaking guide

Ordered from "no code" to "write a shader".

## 1. In the panel (no code)

- **Reactivity → Master sensitivity** scales everything audio-driven. Then per-element
  gains: *Kick*, *Snare / clap*, *Hi-hat*, *Bass energy*, *Timbre*, *Key → hue*,
  *Motion speed*.
- **Envelope decay**: how long each hit glows. Short (0.05 s) is staccato and punchy;
  long (0.4 s) is smooth and dreamy.
- **Look**: trails, bloom, exposure, auto-exposure, chromatic aberration, grain,
  vignette, hit flash, camera shake, *render scale* (drop it if a scene stutters).
- **Palette** plus **New palette each section**: cycles colours at detected section
  changes.
- **Scene parameters**: per-scene knobs (each scene's own `p_*` uniforms).
- **Presets → Save current as preset** keeps it in the browser; *Download preset JSON*
  gives you a file you can edit, diff or share; *Import* reads one back. Unknown or
  malformed keys are ignored (`mergeSettings` in `src/settings.ts`).
- Press <kbd>D</kbd> for the debug meters while tweaking: they show exactly which
  events and features are firing.

URL overrides work too, handy for quick A/B tests:
`/?still&track=NAME&t=60&scene=orb&set=look.bloom=0,reactivity.kick=2,palette=Gold`

## 2. Change what drives what (TypeScript)

`src/render/reactivity.ts` (`Reactor.build`) is the global mapping layer. Examples:

```ts
// make the hats drive the "air" band harder
u.uAir = level(sc.air, r.hat * 1.5);
// make the camera shake on snares instead of kicks
const amp = 0.025 * s.look.shake * (u.uSnare as number);
```

`src/render/renderer.ts` has the post-processing couplings (e.g. kicks widen bloom,
snares widen chromatic aberration).

To add a new slider: add a range in `src/settings.ts` (`REACTIVITY_RANGES` or
`LOOK_RANGES`) and a default in `defaultSettings()`. The panel builds itself from those.

## 3. Write or edit a scene (GLSL)

A scene is a single fragment shader body in `src/render/scenes/<id>.glsl` plus an entry
in `src/render/scenes/index.ts`. The shared header `src/render/shaders/common.glsl` is
prepended, so you get every uniform and helper for free:

```glsl
// src/render/scenes/pulse.glsl: a minimal scene
uniform float p_size;               // from the scene's params list

void main() {
  vec2 uv = centeredUv() + uShake;  // aspect-correct, y in [-1, 1]
  float r = length(uv);
  float ring = exp(-abs(r - p_size * (0.4 + 0.3 * uBass)) * 40.0);
  vec3 col = ramp(0.7) * ring * (0.3 + 2.0 * uKick);         // kick flashes the ring
  col += palette(r + uTimbre.x * 0.3) * spectrum(r) * 0.5;   // spectrum radially, tinted by timbre
  fragColor = vec4(col, 1.0);                                // linear HDR; post does the rest
}
```

```ts
// src/render/scenes/index.ts
import pulse from "./pulse.glsl?raw";
// …add to SCENES:
{
  id: "pulse", name: "Pulse", description: "…", source: pulse,
  params: [{ key: "size", label: "Size", min: 0.2, max: 2, value: 1 }],
  look: { feedback: 0.5, bloom: 1.2 }, palette: "Neon", exposureKey: 0.03,
},
```

Uniform cheat-sheet (all in `common.glsl`):

| Uniform | Meaning |
| --- | --- |
| `uKick uSnare uHat uOnset uNote uBeat uDownbeat uSection` | decaying hit envelopes, 0..~1.5 |
| `uKickHist[8] uSnareHist[8] uHatHist[8]` | last hits as `(age s, strength)`, newest first, age < 0 = empty |
| `uSub uBass uLowMid uMid uHigh uAir` | band energies 0..1 |
| `uLoud uIntensity uPerc uHarm` | loudness, slow loudness, percussive vs harmonic energy |
| `uBright uNoisy uTonal uWidth uNovelty` | spectral centroid, flatness, pitchedness, stereo width, "something changed" |
| `uTimbre` (vec3, −1..1) | instrument coordinates; a new sound moves this |
| `uKeyHue uKeyStrength uChroma[12]` | key on the circle of fifths |
| `uBeatPhase uBarPhase uTempo` | 0..1 through the beat / 4-beat bar |
| `uFlow` | time that runs faster when the music is busy; use it for motion |
| `uCount` (kick, snare, hat, section) | counters for per-hit randomness: `hash11(uCount.y)` |
| `spectrum(x)` / `spectrogram(x, age)` | mel spectrum 0..1, and its last 2 s |
| `palette(t)` / `ramp(t)` | cyclic palette / dark→highlight ramp of the current palette |

**Hot reload:** with `just dev` running and a song playing, save any
`src/render/scenes/*.glsl` and the scene recompiles in place: no page reload, no
re-analysis, playback continues. If the shader doesn't compile, the error (with line
numbers matching your .glsl file) appears at the top of the page and the previous
version keeps running.

Workflow for look-dev without a GPU-heavy loop:

```bash
just dev   # in another terminal
just shot --scene pulse --t 45,60,90 --out out/pulse.png        # stills at three times
just shot --scene pulse --t 59.95 --sheet 12 --w 320 --h 180    # 12 consecutive frames around a hit
```

Keep frames **dark with bright structure**. Bloom and ACES reward highlights above 1.0,
and YouTube's compression punishes large mid-grey areas and fine noise. Measure your
scene's average brightness (the still mode logs `adapted luminance` to the console)
and put it in `exposureKey`.

## 4. Tune the drum detectors

Everything shared by offline and live analysis is in `src/analysis/bands.ts`:

- `KICK`, `SNARE_CRACK`, `HAT`, `NOTE`: frequency ranges each detector listens to
- `DETECTORS`: per-detector `floor` (absolute threshold), `delta` (margin above the
  local mean) and `minGap`
- `hatGate`: how much of a hit's new energy must be above 7 kHz to count as a hat

Check changes against real songs:

```bash
just analyze "path/to/song.mp3" --png out/song.png --from 40 --seconds 12
```

The PNG shows the spectrogram, then one lane per detector (faint curve = onset
function, bright ticks = detected events), then the continuous features. Grey lines are
beats, white lines downbeats, magenta lines section changes. Then run `just test`: the
synthetic-drum tests in `src/analysis/*.test.ts` catch regressions.

## 5. Palettes

`src/render/palettes.ts`: each palette is 4 hex stops, dark → vivid → highlight.
`just palettes` writes `out/palettes.png` to preview them. Mark a palette `manualOnly`
to keep it out of the per-section cycle.
