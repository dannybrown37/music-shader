import { EPS } from "./bands.ts";
import { buildDct, MEL_BANDS, MFCC_COUNT } from "./frame.ts";

/**
 * The song's cast: the handful of recurring sounds in its pitched part, so a sound can keep one
 * colour everywhere it appears (every scene, the HUD, the timeline, the poster).
 *
 *   harmonic mel (HPSS, drums removed) ─► MFCC 1–12 ─► mean per 0.25 s block ─► z-score
 *     ─► k-means for K = 1…6, keep adding a cluster while it cuts the spread by CLUSTER_GAIN
 *     ─► merge clusters under MIN_SHARE ─► soft weights per block, smoothed over ±0.5 s
 *     ─► members renumbered by entrance (the first sound heard is member 0)
 *
 * A cluster is a timbre *state* of the mix, which in practice tracks the lead instrument or layer.
 * Two instruments that always play together are one member.
 */

export const CAST_BLOCK_SECONDS = 0.25;
export const MAX_CAST = 6;
/** Add a cluster only while it leaves at most this share of the previous spread (lower = fewer members). */
const CLUSTER_GAIN = 0.75;
const MIN_SHARE = 0.04;
const SMOOTH_BLOCKS = 2;

export interface CastInput {
  /** frames × dims timbre features. */
  features: Float32Array;
  dims: number;
  voiced: Uint8Array;
  fps: number;
  /** Per-frame 0..1 features averaged per member to describe it. */
  describe: Record<"brightness" | "noisiness" | "tonalness" | "voice", Float32Array>;
}

export interface CastMember {
  /** Seconds when this sound first holds a block. */
  firstSeen: number;
  /** Share of the song's sounding blocks. */
  share: number;
  brightness: number;
  noisiness: number;
  tonalness: number;
  voice: number;
  label: string;
}

export interface Cast {
  members: CastMember[];
  blockSeconds: number;
  maxMembers: number;
  /** Per block: the member sounding, or -1 for silence. */
  ids: Int8Array;
  /** blocks × maxMembers: how much each member is sounding (0 in silence, else sums to ~1). */
  weights: Float32Array;
}

export function emptyCast(): Cast {
  return { members: [], blockSeconds: CAST_BLOCK_SECONDS, maxMembers: MAX_CAST, ids: new Int8Array(0), weights: new Float32Array(0) };
}

/** MFCC 1–12 of the harmonic part: the pitched instruments' timbre without the drums. */
export function harmonicMfcc(mel: Float32Array, frames: number): Float32Array {
  const dct = buildDct();
  const dims = MFCC_COUNT - 1;
  const out = new Float32Array(frames * dims);
  const log = new Float32Array(MEL_BANDS);
  for (let f = 0; f < frames; f++) {
    for (let m = 0; m < MEL_BANDS; m++) log[m] = Math.log10(mel[f * MEL_BANDS + m] + EPS);
    for (let c = 1; c < MFCC_COUNT; c++) {
      let v = 0;
      for (let m = 0; m < MEL_BANDS; m++) v += dct[c * MEL_BANDS + m] * log[m];
      out[f * dims + c - 1] = v;
    }
  }
  return out;
}

const dist2 = (a: Float32Array, i: number, b: Float32Array, j: number, dims: number): number => {
  let s = 0;
  for (let d = 0; d < dims; d++) s += (a[i * dims + d] - b[j * dims + d]) ** 2;
  return s;
};

/** Lloyd's k-means with a deterministic farthest-point start, so the same song always gets the same cast. */
export function kmeans(points: Float32Array, dims: number, k: number): { assign: Int32Array; centres: Float32Array; sse: number } {
  const n = points.length / dims;
  const centres = new Float32Array(k * dims);
  const mean = new Float32Array(dims);
  for (let i = 0; i < n; i++) for (let d = 0; d < dims; d++) mean[d] += points[i * dims + d] / n;
  let first = 0;
  for (let i = 1; i < n; i++) if (dist2(points, i, mean, 0, dims) < dist2(points, first, mean, 0, dims)) first = i;
  centres.set(points.subarray(first * dims, (first + 1) * dims), 0);
  const nearest = Float64Array.from({ length: n }, (_, i) => dist2(points, i, centres, 0, dims));
  for (let c = 1; c < k; c++) {
    let far = 0;
    for (let i = 1; i < n; i++) if (nearest[i] > nearest[far]) far = i;
    centres.set(points.subarray(far * dims, (far + 1) * dims), c * dims);
    for (let i = 0; i < n; i++) nearest[i] = Math.min(nearest[i], dist2(points, i, centres, c, dims));
  }
  const assign = new Int32Array(n);
  let sse = 0;
  for (let iter = 0; iter < 50; iter++) {
    let moved = false;
    sse = 0;
    for (let i = 0; i < n; i++) {
      let best = 0;
      let bestD = Infinity;
      for (let c = 0; c < k; c++) {
        const d = dist2(points, i, centres, c, dims);
        if (d < bestD) [best, bestD] = [c, d];
      }
      if (assign[i] !== best) moved = true;
      assign[i] = best;
      sse += bestD;
    }
    if (!moved && iter > 0) break;
    const sums = new Float64Array(k * dims);
    const counts = new Int32Array(k);
    for (let i = 0; i < n; i++) {
      counts[assign[i]]++;
      for (let d = 0; d < dims; d++) sums[assign[i] * dims + d] += points[i * dims + d];
    }
    for (let c = 0; c < k; c++) if (counts[c] > 0) for (let d = 0; d < dims; d++) centres[c * dims + d] = sums[c * dims + d] / counts[c];
  }
  return { assign, centres, sse };
}

export function findCast(input: CastInput): Cast {
  const { features, dims, voiced, fps } = input;
  const frames = voiced.length;
  const per = Math.max(1, Math.round(CAST_BLOCK_SECONDS * fps));
  const blocks = Math.ceil(frames / per);
  const sounding: number[] = [];
  const pooled: number[] = [];
  for (let b = 0; b < blocks; b++) {
    const sum = new Float64Array(dims);
    let n = 0;
    for (let f = b * per; f < Math.min(frames, (b + 1) * per); f++) {
      if (!voiced[f]) continue;
      n++;
      for (let d = 0; d < dims; d++) sum[d] += features[f * dims + d];
    }
    if (n < per / 2) continue;
    sounding.push(b);
    for (let d = 0; d < dims; d++) pooled.push(sum[d] / n);
  }
  const cast: Cast = { ...emptyCast(), ids: new Int8Array(blocks).fill(-1), weights: new Float32Array(blocks * MAX_CAST) };
  if (sounding.length < 2) return cast;

  // One scale for every dimension: MFCCs share units, and per-dimension z-scores would blow quiet, noisy coefficients up.
  const points = Float32Array.from(pooled);
  const n = sounding.length;
  const mean = new Float64Array(dims);
  for (let i = 0; i < n; i++) for (let d = 0; d < dims; d++) mean[d] += points[i * dims + d] / n;
  let variance = 0;
  for (let i = 0; i < n; i++) for (let d = 0; d < dims; d++) variance += (points[i * dims + d] - mean[d]) ** 2 / n;
  const scale = 1 / (Math.sqrt(variance / dims) || 1);
  for (let i = 0; i < n; i++) for (let d = 0; d < dims; d++) points[i * dims + d] = (points[i * dims + d] - mean[d]) * scale;

  // Largest K that still beats K − 1 clearly: a weak 2-way split can hide a clean 3-way one.
  const fits = [kmeans(points, dims, 1)];
  for (let k = 2; k <= Math.min(MAX_CAST, n); k++) fits.push(kmeans(points, dims, k));
  let fit = fits[0];
  for (let k = 2; k <= fits.length; k++) if (fits[k - 1].sse <= CLUSTER_GAIN * fits[k - 2].sse) fit = fits[k - 1];
  const centres = mergeSmall(points, dims, fit.assign, fit.centres);
  const k = centres.length / dims;

  const spread = new Float64Array(n);
  const d2 = new Float64Array(n * k);
  for (let i = 0; i < n; i++) {
    let min = Infinity;
    for (let c = 0; c < k; c++) min = Math.min(min, (d2[i * k + c] = dist2(points, i, centres, c, dims)));
    spread[i] = min;
  }
  const sigma2 = Math.max(1e-6, spread.reduce((s, v) => s + v, 0) / n);
  const raw = new Float32Array(blocks * k);
  sounding.forEach((b, i) => {
    let total = 0;
    for (let c = 0; c < k; c++) total += raw[b * k + c] = Math.exp(-(d2[i * k + c] - spread[i]) / (2 * sigma2));
    for (let c = 0; c < k; c++) raw[b * k + c] /= total;
  });

  const isSounding = new Uint8Array(blocks);
  for (const b of sounding) isSounding[b] = 1;
  const smooth = new Float32Array(blocks * k);
  const ids = new Int8Array(blocks).fill(-1);
  for (let b = 0; b < blocks; b++) {
    if (!isSounding[b]) continue;
    let best = 0;
    for (let c = 0; c < k; c++) {
      let s = 0;
      for (let o = -SMOOTH_BLOCKS; o <= SMOOTH_BLOCKS; o++) if (b + o >= 0 && b + o < blocks) s += raw[(b + o) * k + c];
      smooth[b * k + c] = s / (2 * SMOOTH_BLOCKS + 1);
      if (smooth[b * k + c] > smooth[b * k + best]) best = c;
    }
    ids[b] = best;
  }

  const order: number[] = [];
  for (let b = 0; b < blocks; b++) if (ids[b] >= 0 && !order.includes(ids[b])) order.push(ids[b]);
  const rank = new Int8Array(k).fill(-1);
  order.forEach((c, r) => (rank[c] = r));
  for (let b = 0; b < blocks; b++) {
    if (ids[b] >= 0) cast.ids[b] = rank[ids[b]];
    for (let c = 0; c < k; c++) if (rank[c] >= 0) cast.weights[b * MAX_CAST + rank[c]] = smooth[b * k + c];
  }

  const described = order.map((_, r) => {
    const acc = { brightness: 0, noisiness: 0, tonalness: 0, voice: 0, blocks: 0, frames: 0, first: -1 };
    for (let b = 0; b < blocks; b++) {
      if (cast.ids[b] !== r) continue;
      if (acc.first < 0) acc.first = b;
      acc.blocks++;
      for (let f = b * per; f < Math.min(frames, (b + 1) * per); f++) {
        acc.frames++;
        acc.brightness += input.describe.brightness[f];
        acc.noisiness += input.describe.noisiness[f];
        acc.tonalness += input.describe.tonalness[f];
        acc.voice += input.describe.voice[f];
      }
    }
    const m = Math.max(1, acc.frames);
    return {
      firstSeen: acc.first * per / fps,
      share: acc.blocks / n,
      brightness: acc.brightness / m,
      noisiness: acc.noisiness / m,
      tonalness: acc.tonalness / m,
      voice: acc.voice / m,
    };
  });
  const labels = castLabels(described);
  cast.members = described.map((d, i) => ({ ...d, label: labels[i] }));
  return cast;
}

/** Folds clusters with under MIN_SHARE of the blocks into their nearest neighbour; returns the surviving centres. */
function mergeSmall(points: Float32Array, dims: number, assign: Int32Array, centres: Float32Array): Float32Array {
  const n = assign.length;
  const k = centres.length / dims;
  const counts = new Int32Array(k);
  for (const a of assign) counts[a]++;
  const keep = Array.from({ length: k }, (_, c) => c).filter((c) => counts[c] >= MIN_SHARE * n);
  if (keep.length === 0) return centres.slice(0, dims);
  const kept = new Float32Array(keep.length * dims);
  keep.forEach((c, i) => kept.set(centres.subarray(c * dims, (c + 1) * dims), i * dims));
  const sums = new Float64Array(keep.length * dims);
  const sizes = new Int32Array(keep.length);
  for (let i = 0; i < n; i++) {
    let best = 0;
    for (let c = 1; c < keep.length; c++) if (dist2(points, i, kept, c, dims) < dist2(points, i, kept, best, dims)) best = c;
    sizes[best]++;
    for (let d = 0; d < dims; d++) sums[best * dims + d] += points[i * dims + d];
  }
  for (let c = 0; c < keep.length; c++) for (let d = 0; d < dims; d++) kept[c * dims + d] = sums[c * dims + d] / Math.max(1, sizes[c]);
  return kept;
}

type Description = Pick<CastMember, "brightness" | "noisiness" | "tonalness" | "voice">;

/**
 * Short, unique, honest names: register from brightness rank ("low", "mid", "high"), plus a
 * character word only when the features say so clearly. A timbre cluster isn't an instrument name.
 */
export function castLabels(members: Description[]): string[] {
  const k = members.length;
  const byBrightness = members.map((m, i) => ({ i, b: m.brightness })).sort((a, b) => a.b - b.b || a.i - b.i);
  const lo = byBrightness[0]?.b ?? 0;
  const span = (byBrightness[k - 1]?.b ?? 0) - lo;
  const register = new Array<string>(k);
  byBrightness.forEach(({ i, b }, r) => {
    const q = span > 0.05 ? (b - lo) / span : r / Math.max(1, k - 1);
    register[i] = k === 1 ? "main" : q < 0.34 ? "low" : q > 0.66 ? "high" : "mid";
  });
  const names = members.map((m, i) => {
    const character = m.voice > 0.25 ? "voice" : m.noisiness >= 0.35 && m.noisiness > m.tonalness ? "noise" : m.tonalness >= 0.45 ? "tones" : "";
    return character ? `${register[i]} ${character}` : register[i];
  });
  const seen = new Map<string, number>();
  return names.map((name) => {
    const count = (seen.get(name) ?? 0) + 1;
    seen.set(name, count);
    return count === 1 ? name : `${name} ${count}`;
  });
}
