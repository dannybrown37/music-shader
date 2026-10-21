/** Musical key from the song's average chroma, by correlation with the Krumhansl–Kessler key profiles. */

export const NOTE_NAMES = ["C", "C♯", "D", "E♭", "E", "F", "F♯", "G", "A♭", "A", "B♭", "B"];

const MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

export interface Key {
  tonic: number;
  minor: boolean;
  /** Correlation with the best profile, -1..1: below ~0.5 the "key" is a guess. */
  confidence: number;
  name: string;
}

function pearson(a: ArrayLike<number>, b: ArrayLike<number>, shift: number): number {
  let ma = 0;
  let mb = 0;
  for (let k = 0; k < 12; k++) {
    ma += a[k] / 12;
    mb += b[k] / 12;
  }
  let num = 0;
  let va = 0;
  let vb = 0;
  for (let k = 0; k < 12; k++) {
    const x = a[(k + shift) % 12] - ma;
    const y = b[k] - mb;
    num += x * y;
    va += x * x;
    vb += y * y;
  }
  return va > 0 && vb > 0 ? num / Math.sqrt(va * vb) : 0;
}

/** `chroma` is frames × 12; `weights` (optional, per frame) favours clearly pitched frames. */
export function estimateKey(chroma: Float32Array, weights?: Float32Array): Key {
  const frames = chroma.length / 12;
  const mean = new Float64Array(12);
  for (let f = 0; f < frames; f++) {
    const w = weights ? weights[f] : 1;
    for (let k = 0; k < 12; k++) mean[k] += chroma[f * 12 + k] * w;
  }
  let best: Key = { tonic: 0, minor: false, confidence: 0, name: "C major" };
  for (let tonic = 0; tonic < 12; tonic++) {
    for (const minor of [false, true]) {
      const r = pearson(mean, minor ? MINOR : MAJOR, tonic);
      if (r > best.confidence) best = { tonic, minor, confidence: r, name: `${NOTE_NAMES[tonic]} ${minor ? "minor" : "major"}` };
    }
  }
  return best;
}
