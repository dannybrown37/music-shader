/** Bump whenever analysis output changes, so cached analyses (src/audio/cache.ts) are recomputed. */
export const ANALYSIS_VERSION = 2;

/**
 * Continuous per-frame features. All are 0..1 except `timbre*` and `hue*`, which are -1..1.
 * Normalised per track so a quiet song moves the visuals as much as a loud one.
 */
export const SCALAR_NAMES = [
  "loudness",
  /** Slow loudness: calm passage vs drop. */
  "intensity",
  "sub",
  "bass",
  "lowMid",
  "mid",
  "high",
  "air",
  /** Energy in the percussive (transient) part of the spectrum. */
  "percussive",
  /** Energy in the harmonic (sustained) part of the spectrum. */
  "harmonic",
  /** Spectral centroid. */
  "brightness",
  /** Spectral flatness: hiss/distortion/cymbals vs pure tones. */
  "noisiness",
  /** How clearly pitched the sound is. */
  "tonalness",
  /** Stereo side/mid ratio. */
  "width",
  /** Chroma on the circle of fifths: harmonically related keys sit near each other. */
  "hueX",
  "hueY",
  /** Per-track PCA of MFCCs: different instruments land at different points. */
  "timbreX",
  "timbreY",
  "timbreZ",
  /** How different the sound is now from the last few seconds. */
  "novelty",
] as const;

export type ScalarName = (typeof SCALAR_NAMES)[number];

export const EVENT_KINDS = ["kick", "snare", "hat", "onset", "note", "beat", "downbeat", "section"] as const;
export type EventKind = (typeof EVENT_KINDS)[number];

export interface EventTrack {
  /** Seconds, ascending. */
  times: Float32Array;
  /** Roughly 0..1, may exceed 1 for unusually strong hits. */
  strengths: Float32Array;
}

export interface TrackAnalysis {
  sampleRate: number;
  fps: number;
  frames: number;
  duration: number;
  tempo: number;
  scalars: Record<ScalarName, Float32Array>;
  /** frames × MEL_BANDS, 0..1 per band. */
  mel: Float32Array;
  /** frames × 12, max-normalised per frame. */
  chroma: Float32Array;
  events: Record<EventKind, EventTrack>;
  /** Raw onset detection functions behind the detected events, kept for plotting and tuning. */
  odfs: Record<DetectorKind, Float32Array>;
  /** Intermediate per-frame signals worth inspecting when tuning (see tools/analyze.ts). */
  debug: Record<string, Float32Array>;
}

export type DetectorKind = "kick" | "snare" | "hat" | "onset" | "note";
