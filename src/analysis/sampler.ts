import { MEL_BANDS } from "./frame.ts";
import { EVENT_KINDS, SCALAR_NAMES } from "./types.ts";
import type { EventKind, EventTrack, ScalarName, TrackAnalysis } from "./types.ts";

/** How many past events per kind shaders can see (for shockwaves, trails, rings). */
export const RECENT_COUNT = 16;

/** Everything a visual needs to know about the music at one instant. */
export interface Features {
  time: number;
  scalars: Record<ScalarName, number>;
  /** Decaying impulse per event kind: jumps to the hit strength, decays exponentially. */
  env: Record<EventKind, number>;
  /** Number of events so far, handy for alternating colours or directions per hit. */
  count: Record<EventKind, number>;
  /** Seconds since the last event, Infinity before the first. */
  since: Record<EventKind, number>;
  /** RECENT_COUNT pairs of [age seconds, strength], newest first; age -1 marks an empty slot. */
  recent: Record<EventKind, Float32Array>;
  /** Pitch class 0..11 (C = 0) of each note in recent.note, newest first; -1 when unknown. */
  notePitch: Float32Array;
  tempo: number;
  /** ∫ (0.8·loudness + 0.4·percussive) dt: a clock that runs faster when the music is busy. */
  energyTime: number;
  /** 0..1 through the current beat. */
  beatPhase: number;
  beatIndex: number;
  /** 0..1 through the current four-beat bar. */
  barPhase: number;
  mel: Float32Array;
  chroma: Float32Array;
  /** timbreX/Y/Z averaged over the last TIMBRE_SLOW_SECONDS: follows the instrument, not each hit. */
  timbreSlow: Float32Array;
}

export const TIMBRE_SLOW_SECONDS = 1;
const TIMBRE_AXES = ["timbreX", "timbreY", "timbreZ"] as const;

const record = <T>(keys: readonly string[], make: () => T): Record<string, T> => Object.fromEntries(keys.map((k) => [k, make()]));

export function createFeatures(): Features {
  return {
    time: 0,
    scalars: record(SCALAR_NAMES, () => 0) as Record<ScalarName, number>,
    env: record(EVENT_KINDS, () => 0) as Record<EventKind, number>,
    count: record(EVENT_KINDS, () => 0) as Record<EventKind, number>,
    since: record(EVENT_KINDS, () => Infinity) as Record<EventKind, number>,
    recent: record(EVENT_KINDS, () => new Float32Array(RECENT_COUNT * 2).fill(-1)) as Record<EventKind, Float32Array>,
    notePitch: new Float32Array(RECENT_COUNT).fill(-1),
    tempo: 120,
    energyTime: 0,
    beatPhase: 0,
    beatIndex: 0,
    barPhase: 0,
    mel: new Float32Array(MEL_BANDS),
    chroma: new Float32Array(12),
    timbreSlow: new Float32Array(3),
  };
}

/** Index of the last element <= t, or -1. */
export function lastAtOrBefore(times: Float32Array, t: number): number {
  let lo = 0;
  let hi = times.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (times[mid] <= t) {
      ans = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return ans;
}

/** Pitch class with the most chroma energy, or -1 for silence. */
export function dominantPitch(chroma: ArrayLike<number>, offset = 0): number {
  let best = -1;
  let max = 1e-6;
  for (let k = 0; k < 12; k++) {
    if (chroma[offset + k] > max) {
      max = chroma[offset + k];
      best = k;
    }
  }
  return best;
}

/** Fills out.notePitch to line up with out.recent.note; `pitches` holds one entry per note so far. */
export function notePitchState(pitches: ArrayLike<number>, out: Features): void {
  const last = out.count.note - 1;
  for (let n = 0; n < RECENT_COUNT; n++) out.notePitch[n] = last - n >= 0 && last - n < pitches.length ? pitches[last - n] : -1;
}

/** Read a note's pitch slightly after its onset, once the attack noise has passed. */
export const NOTE_PITCH_DELAY = 0.03;

/** Envelope horizon: past this many time constants an event contributes nothing visible. */
const HORIZON = 6;

export function eventState(track: EventTrack, t: number, decay: number, kind: EventKind, out: Features): void {
  const last = lastAtOrBefore(track.times, t);
  out.count[kind] = last + 1;
  out.since[kind] = last >= 0 ? t - track.times[last] : Infinity;
  let env = 0;
  for (let i = last; i >= 0; i--) {
    const age = t - track.times[i];
    if (age > decay * HORIZON) break;
    env = Math.max(env, track.strengths[i] * Math.exp(-age / Math.max(decay, 1e-4)));
  }
  out.env[kind] = env;
  const recent = out.recent[kind];
  for (let n = 0; n < RECENT_COUNT; n++) {
    const i = last - n;
    recent[2 * n] = i >= 0 ? t - track.times[i] : -1;
    recent[2 * n + 1] = i >= 0 ? track.strengths[i] : 0;
  }
}

export function beatState(beats: Float32Array, downbeats: Float32Array, tempo: number, t: number, out: Features): void {
  const fallback = 60 / (tempo > 0 ? tempo : 120);
  let index: number;
  let phase: number;
  if (beats.length < 2) {
    const pos = t / fallback;
    index = Math.floor(pos);
    phase = pos - index;
  } else {
    const i = lastAtOrBefore(beats, t);
    if (i < 0) {
      const pos = (t - beats[0]) / (beats[1] - beats[0]);
      index = Math.floor(pos);
      phase = pos - index;
    } else if (i >= beats.length - 1) {
      const n = beats.length;
      const pos = (t - beats[n - 1]) / (beats[n - 1] - beats[n - 2]);
      index = n - 1 + Math.floor(pos);
      phase = pos - Math.floor(pos);
    } else {
      index = i;
      phase = (t - beats[i]) / (beats[i + 1] - beats[i]);
    }
  }
  let downIndex = 0;
  if (downbeats.length > 0 && beats.length > 0) downIndex = Math.max(0, lastAtOrBefore(beats, downbeats[0] + 1e-4));
  const inBar = (((index - downIndex) % 4) + 4) % 4;
  out.beatIndex = index;
  out.beatPhase = phase;
  out.barPhase = (inBar + phase) / 4;
  out.tempo = tempo;
}

/** Reads a precomputed TrackAnalysis at any time, with envelope decay chosen at sample time. */
export function energyRate(loudness: number, percussive: number): number {
  return 0.8 * loudness + 0.4 * percussive;
}

export class FeatureSampler {
  readonly analysis: TrackAnalysis;
  /** Prefix integral of energyRate at each frame boundary, so energyTime is exact after any seek. */
  private readonly energyPrefix: Float64Array;
  private downbeatCache: { times: Float32Array; intensity: Float32Array } | null = null;
  private readonly notePitches: Float32Array;
  private readonly timbrePrefix: Float64Array[];

  constructor(analysis: TrackAnalysis) {
    this.analysis = analysis;
    this.timbrePrefix = TIMBRE_AXES.map((name) => {
      const prefix = new Float64Array(analysis.frames + 1);
      for (let i = 0; i < analysis.frames; i++) prefix[i + 1] = prefix[i] + analysis.scalars[name][i];
      return prefix;
    });
    const { loudness, percussive } = analysis.scalars;
    this.energyPrefix = new Float64Array(analysis.frames + 1);
    for (let i = 0; i < analysis.frames; i++) {
      const j = Math.min(analysis.frames - 1, i + 1);
      const trapezoid = (energyRate(loudness[i], percussive[i]) + energyRate(loudness[j], percussive[j])) / 2;
      this.energyPrefix[i + 1] = this.energyPrefix[i] + trapezoid / analysis.fps;
    }
    this.notePitches = Float32Array.from(analysis.events.note.times, (t) => {
      const frame = Math.min(analysis.frames - 1, Math.round((t + NOTE_PITCH_DELAY) * analysis.fps));
      return dominantPitch(analysis.chroma, frame * 12);
    });
  }

  sample(t: number, out: Features, decays: Record<EventKind, number>): void {
    const a = this.analysis;
    out.time = t;
    const pos = Math.max(0, Math.min(a.frames - 1, t * a.fps));
    const i = Math.floor(pos);
    const j = Math.min(a.frames - 1, i + 1);
    const w = pos - i;
    for (const name of SCALAR_NAMES) {
      const d = a.scalars[name];
      out.scalars[name] = d[i] + (d[j] - d[i]) * w;
    }
    for (let b = 0; b < MEL_BANDS; b++) out.mel[b] = a.mel[i * MEL_BANDS + b] * (1 - w) + a.mel[j * MEL_BANDS + b] * w;
    for (let k = 0; k < 12; k++) out.chroma[k] = a.chroma[i * 12 + k] * (1 - w) + a.chroma[j * 12 + k] * w;
    const rateHere = energyRate(a.scalars.loudness[i], a.scalars.percussive[i]);
    const rateNow = energyRate(out.scalars.loudness, out.scalars.percussive);
    out.energyTime = this.energyPrefix[i] + ((rateHere + rateNow) / 2) * ((pos - i) / a.fps);
    const from = Math.max(0, i + 1 - Math.round(TIMBRE_SLOW_SECONDS * a.fps));
    this.timbrePrefix.forEach((prefix, d) => (out.timbreSlow[d] = (prefix[i + 1] - prefix[from]) / (i + 1 - from)));
    for (const kind of EVENT_KINDS) eventState(a.events[kind], t, decays[kind], kind, out);
    notePitchState(this.notePitches, out);
    beatState(a.events.beat.times, a.events.downbeat.times, a.tempo, t, out);
  }

  sectionTimes(): Float32Array {
    return this.analysis.events.section.times;
  }

  /** Downbeat times with the song intensity at each, for Auto VJ's beat-synced cuts. */
  downbeats(): { times: Float32Array; intensity: Float32Array } {
    const a = this.analysis;
    this.downbeatCache ??= {
      times: a.events.downbeat.times,
      intensity: Float32Array.from(a.events.downbeat.times, (t) => a.scalars.intensity[Math.min(a.frames - 1, Math.round(t * a.fps))]),
    };
    return this.downbeatCache;
  }

  /** Fills `out` (rows × MEL_BANDS) with the mel spectrum history: row 0 = t, last row = t - span. */
  spectrogram(t: number, rows: number, span: number, out: Float32Array): void {
    const a = this.analysis;
    for (let r = 0; r < rows; r++) {
      const pos = Math.max(0, Math.min(a.frames - 1, (t - (r / (rows - 1)) * span) * a.fps));
      const i = Math.floor(pos);
      const j = Math.min(a.frames - 1, i + 1);
      const w = pos - i;
      for (let b = 0; b < MEL_BANDS; b++) out[r * MEL_BANDS + b] = a.mel[i * MEL_BANDS + b] * (1 - w) + a.mel[j * MEL_BANDS + b] * w;
    }
  }

  /** Fills `out` (rows × 2) with the melody line history as (pitch, melody): row 0 = t, last row = t - span. */
  melodyLine(t: number, rows: number, span: number, out: Float32Array): void {
    const a = this.analysis;
    const { pitch, melody } = a.scalars;
    for (let r = 0; r < rows; r++) {
      const pos = Math.max(0, Math.min(a.frames - 1, (t - (r / (rows - 1)) * span) * a.fps));
      const i = Math.floor(pos);
      const j = Math.min(a.frames - 1, i + 1);
      const w = pos - i;
      out[2 * r] = pitch[i] + (pitch[j] - pitch[i]) * w;
      out[2 * r + 1] = melody[i] + (melody[j] - melody[i]) * w;
    }
  }
}
