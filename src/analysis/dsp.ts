/** Small array helpers shared by the offline and live analyzers. */

export function percentile(data: ArrayLike<number>, p: number): number {
  const sorted = Array.from(data)
    .filter((v) => !Number.isNaN(v))
    .sort((a, b) => a - b);
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.round((p / 100) * (sorted.length - 1))));
  return sorted[idx];
}

/** In place: maps [p(lo), p(hi)] to [0, 1], clamped. */
export function normalizeRange(data: Float32Array, lo: number, hi: number): Float32Array {
  const a = percentile(data, lo);
  const b = percentile(data, hi);
  const span = b - a;
  for (let i = 0; i < data.length; i++) data[i] = span > 1e-12 ? Math.min(1, Math.max(0, (data[i] - a) / span)) : 0;
  return data;
}

export function medianFilter(data: Float32Array, size: number): Float32Array {
  const half = size >> 1;
  const out = new Float32Array(data.length);
  const scratch = new Float32Array(size);
  for (let i = 0; i < data.length; i++) {
    let n = 0;
    for (let j = Math.max(0, i - half); j <= Math.min(data.length - 1, i + half); j++) {
      const v = data[j];
      let k = n++;
      while (k > 0 && scratch[k - 1] > v) {
        scratch[k] = scratch[k - 1];
        k--;
      }
      scratch[k] = v;
    }
    out[i] = scratch[n >> 1];
  }
  return out;
}

export function movingMean(data: Float32Array, pre: number, post: number): Float32Array {
  const prefix = new Float64Array(data.length + 1);
  for (let i = 0; i < data.length; i++) prefix[i + 1] = prefix[i] + data[i];
  const out = new Float32Array(data.length);
  for (let i = 0; i < data.length; i++) {
    const a = Math.max(0, i - pre);
    const b = Math.min(data.length - 1, i + post);
    out[i] = (prefix[b + 1] - prefix[a]) / (b - a + 1);
  }
  return out;
}

/** One-pole follower with separate per-step retain factors for rising and falling input (0 = instant). */
export function followEnvelope(data: Float32Array, attack: number, release: number): Float32Array {
  const out = new Float32Array(data.length);
  let y = 0;
  for (let i = 0; i < data.length; i++) {
    const x = data[i];
    y = x + (y - x) * (x > y ? attack : release);
    out[i] = y;
  }
  return out;
}

/** Retain factor for a one-pole decay with time constant `seconds` at `fps`. */
export function retain(seconds: number, fps: number): number {
  return seconds <= 0 ? 0 : Math.exp(-1 / (seconds * fps));
}

export interface PeakPickOptions {
  /** Frames before/after that the peak must dominate. */
  preMax: number;
  postMax: number;
  /** Frames before/after used for the adaptive mean threshold. */
  preAvg: number;
  postAvg: number;
  /** Margin above the local mean. */
  delta: number;
  /** Absolute minimum value. */
  floor: number;
  minGap: number;
}

export function peakPick(odf: Float32Array, o: PeakPickOptions): number[] {
  const mean = movingMean(odf, o.preAvg, o.postAvg);
  const peaks: number[] = [];
  let last = -Infinity;
  for (let i = 0; i < odf.length; i++) {
    const v = odf[i];
    if (v < o.floor || v < mean[i] + o.delta || i - last < o.minGap) continue;
    let isMax = true;
    for (let j = Math.max(0, i - o.preMax); j <= Math.min(odf.length - 1, i + o.postMax) && isMax; j++) {
      if (j < i ? odf[j] >= v : odf[j] > v) isMax = false;
    }
    if (!isMax) continue;
    peaks.push(i);
    last = i;
  }
  return peaks;
}
