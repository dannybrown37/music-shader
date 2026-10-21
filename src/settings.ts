import type { EventKind } from "./analysis/types.ts";

/**
 * Everything the user can tweak. Plain JSON so presets can be saved, shared and diffed.
 * Ranges live next to the values so the panel, presets and docs share one source of truth.
 */

export interface Range {
  min: number;
  max: number;
  step?: number;
  label?: string;
  help?: string;
}

export const REACTIVITY_RANGES = {
  sensitivity: { min: 0, max: 3, label: "Master sensitivity", help: "Scales every audio-driven motion" },
  kick: { min: 0, max: 3, label: "Kick", help: "Zoom punch, flashes, shockwave cores" },
  snare: { min: 0, max: 3, label: "Snare / clap", help: "Shockwave rings, chromatic split" },
  hat: { min: 0, max: 3, label: "Hi-hat", help: "Sparkles and glints" },
  onset: { min: 0, max: 3, label: "Any onset", help: "Small jolts on every new sound" },
  bass: { min: 0, max: 3, label: "Bass energy", help: "Warp depth, size, terrain height" },
  timbre: { min: 0, max: 3, label: "Timbre", help: "How far instrument changes move shape and colour" },
  harmony: { min: 0, max: 1, label: "Key → hue", help: "How much the musical key tints the palette" },
  melody: { min: 0, max: 3, label: "Melody / voice", help: "How bright the melody line and voice glow are" },
  motion: { min: 0, max: 3, label: "Motion speed", help: "Base speed of flow/camera, scaled by loudness" },
  drop: { min: 0, max: 2, label: "Build-up & drop", help: "Before a drop the picture draws in, slows and drains of colour; on the drop it bursts" },
  dynamics: { min: 0, max: 1, label: "Quiet vs loud", help: "Calms the visuals in quiet passages so the loud ones hit harder" },
  cast: { min: 0, max: 1, label: "Instrument colours", help: "Notes and melody take the colour of the instrument playing them (the song's cast)" },
} satisfies Record<string, Range>;

export type ReactivityKey = keyof typeof REACTIVITY_RANGES;

export const DECAY_RANGES: Record<EventKind, Range> = {
  kick: { min: 0.02, max: 1, label: "Kick decay (s)" },
  snare: { min: 0.02, max: 1, label: "Snare decay (s)" },
  hat: { min: 0.01, max: 0.5, label: "Hat decay (s)" },
  onset: { min: 0.02, max: 1, label: "Onset decay (s)" },
  note: { min: 0.02, max: 2, label: "Note decay (s)" },
  beat: { min: 0.02, max: 1, label: "Beat decay (s)" },
  downbeat: { min: 0.05, max: 2, label: "Downbeat decay (s)" },
  section: { min: 0.2, max: 6, label: "Section decay (s)" },
  drop: { min: 0.3, max: 4, label: "Drop decay (s)" },
};

export const LOOK_RANGES = {
  feedback: { min: 0, max: 0.98, label: "Trails", help: "How much of the last frame persists" },
  feedbackZoom: { min: -0.05, max: 0.05, step: 0.001, label: "Trail zoom" },
  feedbackSpin: { min: -0.05, max: 0.05, step: 0.001, label: "Trail spin" },
  feedbackHue: { min: -0.05, max: 0.05, step: 0.001, label: "Trail hue drift" },
  bloom: { min: 0, max: 3, label: "Bloom" },
  bloomThreshold: { min: 0, max: 2, label: "Bloom threshold" },
  exposure: { min: 0.2, max: 3, label: "Exposure" },
  autoExposure: { min: 0, max: 1, label: "Auto exposure", help: "Evens out brightness between quiet and loud passages; lower keeps more contrast between them" },
  chromatic: { min: 0, max: 3, label: "Chromatic aberration" },
  grain: { min: 0, max: 1, label: "Film grain" },
  vignette: { min: 0, max: 1.5, label: "Vignette" },
  flash: { min: 0, max: 1, label: "Hit flash" },
  shake: { min: 0, max: 2, label: "Camera shake" },
  renderScale: { min: 0.25, max: 1, step: 0.05, label: "Render scale", help: "Lower = faster on weak GPUs" },
} satisfies Record<string, Range>;

export type LookKey = keyof typeof LOOK_RANGES;

export const AUTO_CUT_BARS = [1, 2, 4, 8];

export interface Settings {
  scene: string;
  palette: string;
  /** Advance to the next palette on every detected section change. */
  paletteCycle: boolean;
  /** 0..1: how far each section change nudges the scene params (0 = never). */
  sectionLooks: number;
  /** Auto VJ: switch to the next scene at section changes (crossfaded). */
  autoScenes: boolean;
  /** Minimum seconds a scene stays before the next section may switch it. */
  autoSceneSeconds: number;
  /** Auto VJ: in loud parts, hard-cut on downbeats instead of crossfading. */
  autoCuts: boolean;
  /** Intensity 0..1 above which the music counts as loud enough for cuts. */
  autoCutIntensity: number;
  /** Bars between cuts while it stays loud: one of AUTO_CUT_BARS. */
  autoCutBars: number;
  reactivity: Record<ReactivityKey, number>;
  decay: Record<EventKind, number>;
  look: Record<LookKey, number>;
  /** Per-scene parameter values keyed by scene id then param key. */
  sceneParams: Record<string, Record<string, number>>;
  overlay: {
    title: string;
    subtitle: string;
    showTitle: boolean;
    showHud: boolean;
    /** Cover art / logo image (loaded per session): off, a pulsing badge mid-screen, or a dim backdrop. */
    artMode: ArtMode;
    artSize: number;
    showLyrics: boolean;
    /** Seconds at the end of the song that recap it as the Portrait (0 = off). */
    outro: number;
  };
}

export const ART_MODES = ["off", "badge", "backdrop"] as const;
export type ArtMode = (typeof ART_MODES)[number];
export const ART_SIZE: Range = { min: 0.3, max: 2, label: "Art size" };
export const OUTRO_RANGE = {
  min: 0,
  max: 30,
  label: "Portrait outro (s, 0 = off)",
  help: "The song's last seconds crossfade into its Portrait, which redraws the whole song as a recap (exports too)",
} satisfies Range;

export function defaultSettings(): Settings {
  return {
    scene: "nebula",
    palette: "Ember",
    paletteCycle: true,
    sectionLooks: 0.3,
    autoScenes: false,
    autoSceneSeconds: 24,
    autoCuts: true,
    autoCutIntensity: 0.75,
    autoCutBars: 4,
    reactivity: { sensitivity: 1, kick: 1, snare: 1, hat: 1, onset: 0.6, bass: 1, timbre: 1, harmony: 0.35, melody: 1, motion: 1, drop: 1, dynamics: 0.5, cast: 0.8 },
    decay: { kick: 0.18, snare: 0.22, hat: 0.07, onset: 0.12, note: 0.3, beat: 0.15, downbeat: 0.5, section: 2.5, drop: 1.6 },
    look: {
      feedback: 0.0,
      feedbackZoom: 0.006,
      feedbackSpin: 0.002,
      feedbackHue: 0.0,
      bloom: 1,
      bloomThreshold: 0.8,
      exposure: 1,
      autoExposure: 0.6,
      chromatic: 0.6,
      grain: 0.12,
      vignette: 0.6,
      flash: 0.25,
      shake: 0.5,
      renderScale: 1,
    },
    sceneParams: {},
    overlay: { title: "", subtitle: "", showTitle: false, showHud: false, artMode: "off", artSize: 1, showLyrics: true, outro: 12 },
  };
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function copyNumbers(target: Record<string, number>, src: unknown, allowNewKeys: boolean): void {
  if (!isObject(src)) return;
  for (const [k, v] of Object.entries(src)) {
    if (typeof v !== "number" || !Number.isFinite(v)) continue;
    if (allowNewKeys || k in target) target[k] = v;
  }
}

/**
 * Overlays a partial preset (possibly hand-edited or from an older version) on `base`.
 * Unknown keys and wrongly-typed values are dropped rather than trusted.
 */
export function mergeSettings(base: Settings, patch: unknown): Settings {
  const out = structuredClone(base);
  if (!isObject(patch)) return out;
  if (typeof patch.scene === "string") out.scene = patch.scene;
  if (typeof patch.palette === "string") out.palette = patch.palette;
  if (typeof patch.paletteCycle === "boolean") out.paletteCycle = patch.paletteCycle;
  if (typeof patch.sectionLooks === "number" && Number.isFinite(patch.sectionLooks)) out.sectionLooks = Math.min(1, Math.max(0, patch.sectionLooks));
  if (typeof patch.autoScenes === "boolean") out.autoScenes = patch.autoScenes;
  if (typeof patch.autoSceneSeconds === "number" && Number.isFinite(patch.autoSceneSeconds)) out.autoSceneSeconds = Math.max(4, patch.autoSceneSeconds);
  if (typeof patch.autoCuts === "boolean") out.autoCuts = patch.autoCuts;
  if (typeof patch.autoCutIntensity === "number" && Number.isFinite(patch.autoCutIntensity)) out.autoCutIntensity = Math.min(1, Math.max(0, patch.autoCutIntensity));
  if (AUTO_CUT_BARS.includes(patch.autoCutBars as number)) out.autoCutBars = patch.autoCutBars as number;
  copyNumbers(out.reactivity, patch.reactivity, false);
  copyNumbers(out.decay, patch.decay, false);
  copyNumbers(out.look, patch.look, false);
  if (isObject(patch.sceneParams)) {
    for (const [scene, params] of Object.entries(patch.sceneParams)) {
      out.sceneParams[scene] ??= {};
      copyNumbers(out.sceneParams[scene], params, true);
    }
  }
  if (isObject(patch.overlay)) {
    const o = patch.overlay;
    if (typeof o.title === "string") out.overlay.title = o.title;
    if (typeof o.subtitle === "string") out.overlay.subtitle = o.subtitle;
    if (typeof o.showTitle === "boolean") out.overlay.showTitle = o.showTitle;
    if (typeof o.showHud === "boolean") out.overlay.showHud = o.showHud;
    if (ART_MODES.includes(o.artMode as ArtMode)) out.overlay.artMode = o.artMode as ArtMode;
    if (typeof o.artSize === "number" && Number.isFinite(o.artSize)) out.overlay.artSize = Math.min(ART_SIZE.max, Math.max(ART_SIZE.min, o.artSize));
    if (typeof o.showLyrics === "boolean") out.overlay.showLyrics = o.showLyrics;
    if (typeof o.outro === "number" && Number.isFinite(o.outro)) out.overlay.outro = Math.min(OUTRO_RANGE.max, Math.max(OUTRO_RANGE.min, o.outro));
  }
  return out;
}
