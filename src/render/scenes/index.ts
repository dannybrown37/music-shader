import type { LookKey } from "../../settings.ts";
import ensemble from "./ensemble.glsl?raw";
import kaleido from "./kaleido.glsl?raw";
import nebula from "./nebula.glsl?raw";
import orb from "./orb.glsl?raw";
import terrain from "./terrain.glsl?raw";
import tunnel from "./tunnel.glsl?raw";

export interface SceneParam {
  key: string;
  label: string;
  min: number;
  max: number;
  value: number;
  step?: number;
}

export interface SceneDef {
  id: string;
  name: string;
  description: string;
  /** Fragment shader body; the shared header (common.glsl) is prepended. Params arrive as `uniform float p_<key>`. */
  source: string;
  params: SceneParam[];
  /** Look settings this scene was designed around; applied by its built-in preset. */
  look: Partial<Record<LookKey, number>>;
  /** Typical average linear luminance of a well-exposed frame; auto-exposure steers toward it. */
  exposureKey: number;
  palette: string;
}

export const SCENES: SceneDef[] = [
  {
    id: "nebula",
    name: "Nebula",
    description: "Domain-warped smoke with shockwave rings and sparkles",
    source: nebula,
    params: [
      { key: "scale", label: "Field scale", min: 0.5, max: 5, value: 2.2 },
      { key: "warp", label: "Warp depth", min: 0, max: 3, value: 1.3 },
      { key: "filaments", label: "Filaments", min: 0, max: 3, value: 1 },
      { key: "rings", label: "Snare rings", min: 0, max: 3, value: 1 },
      { key: "stars", label: "Hat sparkles", min: 0, max: 3, value: 1 },
      { key: "glow", label: "Kick core glow", min: 0, max: 3, value: 1 },
      { key: "hueSpread", label: "Hue spread", min: 0, max: 1, value: 0.5 },
    ],
    look: { feedback: 0.55, feedbackZoom: 0.008, feedbackSpin: 0.002, bloom: 1.1, bloomThreshold: 0.7 },
    palette: "Ember",
    exposureKey: 0.07,
  },
  {
    id: "terrain",
    name: "Terrain",
    description: "Synthwave flyover; the landscape is the last two seconds of spectrum",
    source: terrain,
    params: [
      { key: "height", label: "Mountain height", min: 0, max: 6, value: 1.6 },
      { key: "grid", label: "Grid glow", min: 0, max: 3, value: 1.2 },
      { key: "sun", label: "Sun", min: 0, max: 2, value: 1 },
      { key: "road", label: "Road width", min: 0, max: 2, value: 0.7 },
      { key: "fog", label: "Fog", min: 0, max: 3, value: 1 },
      { key: "stars", label: "Hat stars", min: 0, max: 3, value: 1 },
    ],
    look: { feedback: 0.25, feedbackZoom: 0.0, feedbackSpin: 0, bloom: 1.3, bloomThreshold: 0.6, chromatic: 0.8 },
    palette: "Synthwave",
    exposureKey: 0.03,
  },
  {
    id: "orb",
    name: "Orb",
    description: "Raymarched sphere: spectrum by latitude, snare spikes, kick shockwave shells",
    source: orb,
    params: [
      { key: "size", label: "Size", min: 0.4, max: 1.6, value: 1 },
      { key: "spikes", label: "Snare spikes", min: 0, max: 3, value: 1 },
      { key: "shells", label: "Kick shells", min: 0, max: 3, value: 1 },
      { key: "rim", label: "Rim glow", min: 0, max: 3, value: 1 },
      { key: "orbit", label: "Orbit speed", min: 0, max: 3, value: 1 },
      { key: "iridescence", label: "Iridescence", min: 0, max: 1, value: 0.6 },
    ],
    look: { feedback: 0.4, feedbackZoom: -0.004, feedbackSpin: 0, bloom: 1.2, bloomThreshold: 0.65 },
    palette: "Abyss",
    exposureKey: 0.03,
  },
  {
    id: "tunnel",
    name: "Tunnel",
    description: "Tiled tube: kick rings rush in, snares twist it, the spectrum lights the walls",
    source: tunnel,
    params: [
      { key: "speed", label: "Speed", min: 0, max: 3, value: 1 },
      { key: "twist", label: "Snare twist", min: 0, max: 3, value: 1 },
      { key: "rings", label: "Kick rings", min: 0, max: 3, value: 1 },
      { key: "segments", label: "Tiles around", min: 4, max: 32, value: 16, step: 1 },
      { key: "spectrum", label: "Spectrum on walls", min: 0, max: 3, value: 1 },
      { key: "streaks", label: "Hat streaks", min: 0, max: 3, value: 1 },
    ],
    look: { feedback: 0.35, feedbackZoom: 0.004, feedbackSpin: 0, bloom: 1.2, bloomThreshold: 0.6, chromatic: 1 },
    palette: "Neon",
    exposureKey: 0.01,
  },
  {
    id: "kaleido",
    name: "Kaleido",
    description: "Mirrored fractal crystal; timbre reshapes it, snares rotate the mirror",
    source: kaleido,
    params: [
      { key: "folds", label: "Mirror folds", min: 2, max: 16, value: 6, step: 1 },
      { key: "zoom", label: "Zoom", min: 0.3, max: 3, value: 1.1 },
      { key: "detail", label: "Detail", min: 0, max: 2, value: 1 },
      { key: "spin", label: "Spin", min: 0, max: 3, value: 1 },
      { key: "glow", label: "Spark glow", min: 0, max: 3, value: 1 },
      { key: "morph", label: "Timbre morph", min: 0, max: 3, value: 1 },
    ],
    look: { feedback: 0.45, feedbackZoom: 0.006, feedbackSpin: 0.003, feedbackHue: 0.004, bloom: 1.2, bloomThreshold: 0.6 },
    palette: "Aurora",
    exposureKey: 0.025,
  },
  {
    id: "ensemble",
    name: "Ensemble",
    description: "Every part gets its own voice: kick rings, snare shards, hat sparks, a note wheel, a spectrum ring",
    source: ensemble,
    params: [
      { key: "wheel", label: "Note wheel", min: 0, max: 3, value: 1 },
      { key: "rings", label: "Kick rings", min: 0, max: 3, value: 1 },
      { key: "shards", label: "Snare shards", min: 0, max: 3, value: 1 },
      { key: "sparks", label: "Hat sparks", min: 0, max: 3, value: 1 },
      { key: "spectrum", label: "Spectrum ring", min: 0, max: 3, value: 1 },
      { key: "spin", label: "Spin", min: -3, max: 3, value: 1 },
    ],
    look: { feedback: 0.3, feedbackZoom: 0.003, feedbackSpin: 0, bloom: 1.3, bloomThreshold: 0.55, vignette: 0.8 },
    palette: "Synthwave",
    exposureKey: 0.004,
  },
];

export function sceneById(id: string): SceneDef {
  return SCENES.find((s) => s.id === id) ?? SCENES[0];
}

export const SCENES_UPDATED = "music-shader:scenes-updated";

// Hot reload: saving a .glsl file swaps the shader in without reloading the page (or re-analysing the song).
if (import.meta.hot) {
  import.meta.hot.accept((next) => {
    const fresh = (next as { SCENES?: SceneDef[] } | undefined)?.SCENES;
    if (!fresh) return;
    SCENES.splice(0, SCENES.length, ...fresh);
    window.dispatchEvent(new CustomEvent(SCENES_UPDATED));
  });
}
