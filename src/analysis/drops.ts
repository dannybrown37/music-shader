import { movingMean, percentile } from "./dsp.ts";
import type { EventTrack } from "./types.ts";

/**
 * Drops and build-ups: where the song releases, and the stretch before it that leads there.
 * Offline only: a build-up is defined by the drop it ends in, so finding one needs the future.
 *
 *   energy  ▁▁▂▂▃▃▄▅▆▇█ │ ████████
 *   build   0 ────────► 1│ 0          ramp x², from the breakdown's trough to the drop
 *   drop                 ▲            downbeat where energy(after) − energy(before) peaks
 */

/** Energy after minus before a downbeat (2 bars each side) that counts as a drop. */
export const DROP_LIFT_MIN = 0.12;
/** …and it must be at least this share of the song's biggest lift, so one huge drop doesn't drag small bumps along. */
const DROP_LIFT_RELATIVE = 0.55;
/** Energy after the drop must reach this (0..1, per-song normalised): a lift into a still-quiet part isn't a drop. */
export const DROP_AFTER_MIN = 0.5;
/** Lift that maps to strength 1. */
const LIFT_FULL = 0.35;
const WINDOW_BARS = 2;
const MIN_GAP_BARS = 8;
const BUILD_MIN_BARS = 4;
const BUILD_MAX_BARS = 8;
/** Energy within this of the breakdown's minimum still counts as the trough; the build starts at the latest such point. */
const TROUGH_TOLERANCE = 0.03;

export interface DropInput {
  loudness: Float32Array;
  bass: Float32Array;
  percussive: Float32Array;
  fps: number;
  downbeats: ArrayLike<number>;
}

export interface Drops {
  drops: EventTrack;
  /** Per frame 0..1: rises (x²) through each build-up, scaled by its drop's strength; 0 from the drop on. */
  build: Float32Array;
}

/** What a drop is made of: overall level, low end coming in, drums coming in. */
export function dropEnergy(loudness: number, bass: number, percussive: number): number {
  return 0.45 * loudness + 0.3 * bass + 0.25 * percussive;
}

export function findDrops(input: DropInput): Drops {
  const { fps, downbeats } = input;
  const frames = input.loudness.length;
  const raw = Float32Array.from(input.loudness, (l, f) => dropEnergy(l, input.bass[f], input.percussive[f]));
  const energy = movingMean(raw, Math.round(0.25 * fps), Math.round(0.25 * fps));
  const slow = movingMean(raw, Math.round(0.5 * fps), Math.round(0.5 * fps));
  const build = new Float32Array(frames);
  const empty = { drops: { times: new Float32Array(0), strengths: new Float32Array(0) }, build };
  if (downbeats.length < 2) return empty;

  const spacings = Array.from({ length: downbeats.length - 1 }, (_, i) => downbeats[i + 1] - downbeats[i]);
  const bar = percentile(spacings, 50);
  const prefix = new Float64Array(frames + 1);
  for (let f = 0; f < frames; f++) prefix[f + 1] = prefix[f] + energy[f];
  const frameAt = (t: number): number => Math.max(0, Math.min(frames, Math.round(t * fps)));
  const mean = (a: number, b: number): number => {
    const [i, j] = [frameAt(a), frameAt(b)];
    return j > i ? (prefix[j] - prefix[i]) / (j - i) : 0;
  };

  const window = WINDOW_BARS * bar;
  const lifts = Array.from(downbeats, (d) => {
    if (d < window || d + bar > frames / fps) return -Infinity;
    const after = mean(d, d + window);
    return after >= DROP_AFTER_MIN ? after - mean(d - window, d) : -Infinity;
  });
  const threshold = Math.max(DROP_LIFT_MIN, DROP_LIFT_RELATIVE * Math.max(...lifts));
  const candidates = lifts
    .map((lift, i) => ({ i, lift }))
    .filter(({ lift }) => lift >= threshold)
    .sort((a, b) => b.lift - a.lift);
  const chosen: { i: number; lift: number }[] = [];
  for (const c of candidates) if (chosen.every((k) => Math.abs(downbeats[k.i] - downbeats[c.i]) >= MIN_GAP_BARS * bar - 1e-3)) chosen.push(c);
  chosen.sort((a, b) => a.i - b.i);

  const times = Float32Array.from(chosen, (c) => downbeats[c.i]);
  const strengths = Float32Array.from(chosen, (c) => Math.min(1.5, c.lift / LIFT_FULL));
  let previous = 0;
  times.forEach((drop, k) => {
    const floor = Math.max(previous, drop - BUILD_MAX_BARS * bar);
    const start = Math.max(floor, Math.min(drop - BUILD_MIN_BARS * bar, troughStart(slow, frameAt(floor), frameAt(drop - bar), fps, downbeats)));
    const level = Math.min(1, strengths[k]);
    for (let f = frameAt(start); f < frameAt(drop); f++) {
      const x = (f / fps - start) / (drop - start);
      build[f] = level * x * x;
    }
    previous = drop;
  });
  return { drops: { times, strengths }, build };
}

/** The downbeat at or before the latest frame in [from, to) whose energy is still at the trough. */
function troughStart(energy: Float32Array, from: number, to: number, fps: number, downbeats: ArrayLike<number>): number {
  if (to <= from) return from / fps;
  let min = Infinity;
  for (let f = from; f < to; f++) min = Math.min(min, energy[f]);
  let latest = from;
  for (let f = from; f < to; f++) if (energy[f] <= min + TROUGH_TOLERANCE) latest = f;
  const t = latest / fps;
  let snapped = from / fps;
  for (let i = 0; i < downbeats.length && downbeats[i] <= t; i++) snapped = Math.max(snapped, downbeats[i]);
  return snapped;
}

const SURGE_SECONDS = 1;

/** The drop's push on the choreography clock `age` seconds after it: decays over about a second. */
export function dropSurge(age: number, strength: number): number {
  return age >= 0 ? strength * Math.exp(-age / SURGE_SECONDS) : 0;
}

/**
 * Rate of the choreography clock, added to the energy clock that drives scene motion:
 * motion slows through a build (down to 30% at its peak) and lunges forward after the drop.
 */
export function choreoRate(build: number, energyRate: number, surge: number): number {
  return -0.7 * build * energyRate + 1.2 * surge;
}

/** Live: a jump of this many dB over the last ~8 s counts as a drop. */
const LIVE_LIFT_DB = 6;
/** …if it lands within this many dB of the loudest the input has been. */
const LIVE_NEAR_PEAK_DB = 6;

/**
 * Live input can't see a drop coming, but it can notice one ~0.3 s in: short-term loudness jumping
 * well above the last few seconds. Works in raw dB: live features are normalised to recent history,
 * so after a long quiet stretch the quiet part already reads as "loud". Fires once, then re-arms.
 */
export class LiveDropDetector {
  private short = Number.NaN;
  private long = Number.NaN;
  private peak = -Infinity;
  private armed = true;
  private last = -Infinity;
  private start = Number.NaN;

  /** `db` is this frame's loudness in dB; returns the drop's strength, or 0. */
  push(t: number, db: number, dt: number): number {
    if (Number.isNaN(this.short)) {
      this.short = this.long = db;
      this.start = t;
    }
    this.short += (db - this.short) * (1 - Math.exp(-dt / 0.4));
    // Until there are a few seconds of history the long average just follows, so the start isn't a "jump".
    const warm = t - this.start >= 8;
    this.long = warm ? this.long + (db - this.long) * (1 - Math.exp(-dt / 8)) : this.short;
    this.peak = Math.max(this.short, this.peak - 0.5 * dt);
    const lift = this.short - this.long;
    if (lift < 2) this.armed = true;
    if (!warm || !this.armed || lift < LIVE_LIFT_DB || this.short < this.peak - LIVE_NEAR_PEAK_DB || t - this.last < 12) return 0;
    this.armed = false;
    this.last = t;
    return Math.min(1.5, lift / 12);
  }
}
