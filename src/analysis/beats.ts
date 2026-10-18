/** Global tempo estimate plus Ellis (2007) dynamic-programming beat tracking. */

const MIN_BPM = 60;
const MAX_BPM = 240;
const PRIOR_BPM = 120;
const PRIOR_OCTAVES = 1;
const TIGHTNESS = 100;

function gaussianSmooth(data: Float32Array, sigma: number): Float32Array {
  const radius = Math.ceil(sigma * 3);
  const kernel = Array.from({ length: 2 * radius + 1 }, (_, i) => Math.exp(-0.5 * ((i - radius) / sigma) ** 2));
  const out = new Float32Array(data.length);
  for (let i = 0; i < data.length; i++) {
    let acc = 0;
    for (let k = -radius; k <= radius; k++) {
      const j = i + k;
      if (j >= 0 && j < data.length) acc += data[j] * kernel[k + radius];
    }
    out[i] = acc;
  }
  return out;
}

/** Returns BPM, or 0 when the envelope carries no rhythm. */
export function estimateTempo(onsetEnvelope: Float32Array, fps: number): number {
  const env = gaussianSmooth(onsetEnvelope, 1);
  let mean = 0;
  for (const v of env) mean += v;
  mean /= env.length || 1;
  if (mean < 1e-9) return 0;
  for (let i = 0; i < env.length; i++) env[i] -= mean;

  const lagMin = Math.floor((60 * fps) / MAX_BPM);
  const lagMax = Math.min(env.length - 1, Math.ceil((60 * fps) / MIN_BPM));
  const score = new Float64Array(lagMax + 2);
  let best = -1;
  for (let lag = lagMin; lag <= lagMax; lag++) {
    let ac = 0;
    for (let i = 0; i + lag < env.length; i++) ac += env[i] * env[i + lag];
    ac /= env.length - lag;
    const bpm = (60 * fps) / lag;
    score[lag] = Math.max(0, ac) * Math.exp(-0.5 * (Math.log2(bpm / PRIOR_BPM) / PRIOR_OCTAVES) ** 2);
    if (best < 0 || score[lag] > score[best]) best = lag;
  }
  if (best < 0 || score[best] <= 0) return 0;
  const [a, b, c] = [score[best - 1] ?? 0, score[best], score[best + 1] ?? 0];
  const denom = a - 2 * b + c;
  const lag = best + (denom < 0 ? (0.5 * (a - c)) / denom : 0);
  return (60 * fps) / lag;
}

/** Beat positions in frames. */
export function trackBeats(onsetEnvelope: Float32Array, fps: number, bpm: number): number[] {
  if (bpm <= 0 || onsetEnvelope.length === 0) return [];
  const period = (60 * fps) / bpm;
  let sq = 0;
  for (const v of onsetEnvelope) sq += v * v;
  const std = Math.sqrt(sq / onsetEnvelope.length) || 1;
  const local = gaussianSmooth(onsetEnvelope, Math.max(0.5, period / 32));
  for (let i = 0; i < local.length; i++) local[i] /= std;

  const n = local.length;
  const cum = new Float64Array(n);
  const back = new Int32Array(n).fill(-1);
  const minPrev = Math.round(period / 2);
  const maxPrev = Math.round(2 * period);
  for (let t = 0; t < n; t++) {
    let bestScore = -Infinity;
    let bestPrev = -1;
    for (let p = Math.max(0, t - maxPrev); p <= t - minPrev; p++) {
      const s = cum[p] - TIGHTNESS * Math.log((t - p) / period) ** 2;
      if (s > bestScore) {
        bestScore = s;
        bestPrev = p;
      }
    }
    cum[t] = local[t] + (bestPrev >= 0 ? Math.max(0, bestScore) : 0);
    back[t] = bestScore > 0 ? bestPrev : -1;
  }

  const maxima: number[] = [];
  for (let t = 1; t < n - 1; t++) if (cum[t] > cum[t - 1] && cum[t] >= cum[t + 1]) maxima.push(cum[t]);
  maxima.sort((x, y) => x - y);
  const threshold = 0.5 * (maxima[maxima.length >> 1] ?? 0);
  let last = n - 1;
  while (last > 0 && cum[last] < threshold) last--;
  let peak = last;
  for (let t = last; t >= Math.max(0, last - Math.round(period)); t--) if (cum[t] > cum[peak]) peak = t;

  const beats: number[] = [];
  for (let t = peak; t >= 0; t = back[t]) beats.push(t);
  beats.reverse();

  let rms = 0;
  for (const b of beats) rms += local[b] ** 2;
  rms = Math.sqrt(rms / (beats.length || 1));
  let start = 0;
  let end = beats.length;
  while (start < end && local[beats[start]] < 0.5 * rms) start++;
  while (end > start && local[beats[end - 1]] < 0.5 * rms) end--;
  return beats.slice(start, end);
}

/** Index in [0, 4) of the beat-in-bar that carries the most weight (e.g. kick energy). */
export function pickDownbeat(beatWeights: number[]): number {
  const sums = [0, 0, 0, 0];
  beatWeights.forEach((w, i) => (sums[i % 4] += w));
  return sums.indexOf(Math.max(...sums));
}
