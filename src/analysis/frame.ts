import { FFT } from "./fft.ts";

export const FFT_SIZE = 2048;
export const HOP = 512;
export const MEL_BANDS = 64;
export const MFCC_COUNT = 13;
const MEL_MIN_HZ = 30;
const MEL_MAX_HZ = 16000;
const CHROMA_MIN_HZ = 80;
const CHROMA_MAX_HZ = 5000;
const FLATNESS_MIN_HZ = 100;
const FLATNESS_MAX_HZ = 10000;
const CRACK_MIN_HZ = 1000;
const CRACK_MAX_HZ = 5000;
const CRACK_SMOOTH_BINS = 6;
const EPS = 1e-10;

const hzToMel = (hz: number): number => 2595 * Math.log10(1 + hz / 700);
const melToHz = (mel: number): number => 700 * (10 ** (mel / 2595) - 1);

interface MelFilter {
  start: number;
  weights: Float32Array;
}

function melEdges(sampleRate: number): number[] {
  const lo = hzToMel(MEL_MIN_HZ);
  const hi = hzToMel(Math.min(MEL_MAX_HZ, sampleRate / 2));
  return Array.from({ length: MEL_BANDS + 2 }, (_, i) => melToHz(lo + ((hi - lo) * i) / (MEL_BANDS + 1)));
}

/** Center frequency in Hz of each mel band. */
export function melCenters(sampleRate: number): number[] {
  return melEdges(sampleRate).slice(1, -1);
}

function buildMelFilters(sampleRate: number): MelFilter[] {
  const edges = melEdges(sampleRate);
  const binHz = sampleRate / FFT_SIZE;
  const filters: MelFilter[] = [];
  for (let m = 0; m < MEL_BANDS; m++) {
    const [left, center, right] = [edges[m], edges[m + 1], edges[m + 2]];
    const start = Math.max(1, Math.floor(left / binHz));
    const end = Math.min(FFT_SIZE / 2, Math.ceil(right / binHz));
    const weights = new Float32Array(end - start + 1);
    for (let k = start; k <= end; k++) {
      const f = k * binHz;
      const w = f <= center ? (f - left) / (center - left) : (right - f) / (right - center);
      weights[k - start] = Math.max(0, w);
    }
    // Low bands can fall between bins; give them the nearest bin so no band is silent.
    if (weights.every((w) => w === 0)) weights[Math.min(weights.length - 1, Math.round(center / binHz) - start)] = 1;
    const sum = weights.reduce((a, b) => a + b, 0);
    for (let i = 0; i < weights.length; i++) weights[i] /= sum;
    filters.push({ start, weights });
  }
  return filters;
}

export function buildDct(): Float32Array {
  const dct = new Float32Array(MFCC_COUNT * MEL_BANDS);
  for (let c = 0; c < MFCC_COUNT; c++) {
    const scale = Math.sqrt((c === 0 ? 1 : 2) / MEL_BANDS);
    for (let m = 0; m < MEL_BANDS; m++) dct[c * MEL_BANDS + m] = scale * Math.cos((Math.PI * c * (m + 0.5)) / MEL_BANDS);
  }
  return dct;
}

/**
 * Turns one windowed slice of mono audio into spectral features.
 * Results live on the instance and are overwritten by the next `process` call.
 */
export class FrameAnalyzer {
  readonly sampleRate: number;
  readonly magnitude = new Float32Array(FFT_SIZE / 2 + 1);
  readonly melPower = new Float32Array(MEL_BANDS);
  readonly logMel = new Float32Array(MEL_BANDS);
  readonly mfcc = new Float32Array(MFCC_COUNT);
  readonly chroma = new Float32Array(12);
  rms = 0;
  /** Spectral centroid in Hz: perceived brightness. */
  centroid = 0;
  /** Spectral flatness 0..1: 0 is a pure tone, 1 is white noise. */
  flatness = 0;
  /** Frequency below which 85% of the energy lies. */
  rolloff = 0;
  /**
   * How much the fine spectral structure in the snare band (1–5 kHz) matches two frames
   * (23 ms) ago, -1..1. Harmonics keep their peaks, so piano and plucks score high;
   * noise (snare wires, claps) decorrelates, so it scores near 0.
   */
  crackTonal = 0;

  private readonly fft = new FFT(FFT_SIZE);
  private readonly window = new Float32Array(FFT_SIZE);
  private readonly windowed = new Float32Array(FFT_SIZE);
  private readonly filters: MelFilter[];
  private readonly dct = buildDct();
  private readonly binHz: number;
  private readonly magnitudeScale: number;
  private readonly crackLog: Float32Array;
  private readonly crackDetail: Float32Array[];
  private frameCount = 0;

  constructor(sampleRate: number) {
    this.sampleRate = sampleRate;
    this.binHz = sampleRate / FFT_SIZE;
    let windowSum = 0;
    for (let i = 0; i < FFT_SIZE; i++) {
      this.window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / FFT_SIZE);
      windowSum += this.window[i];
    }
    this.magnitudeScale = 2 / windowSum;
    this.filters = buildMelFilters(sampleRate);
    const crackBins = Math.floor(CRACK_MAX_HZ / this.binHz) - Math.ceil(CRACK_MIN_HZ / this.binHz) + 1;
    this.crackLog = new Float32Array(crackBins);
    this.crackDetail = [0, 1, 2].map(() => new Float32Array(crackBins));
  }

  /** `samples` must hold exactly FFT_SIZE mono samples. */
  process(samples: Float32Array): void {
    let sumSq = 0;
    for (let i = 0; i < FFT_SIZE; i++) {
      sumSq += samples[i] * samples[i];
      this.windowed[i] = samples[i] * this.window[i];
    }
    this.rms = Math.sqrt(sumSq / FFT_SIZE);
    this.fft.magnitudes(this.windowed, this.magnitude);
    const mag = this.magnitude;
    for (let k = 0; k < mag.length; k++) mag[k] *= this.magnitudeScale;

    this.computeMel();
    this.computeShape();
    this.computeChroma();
    this.computeCrackTonal();
  }

  /** Correlates the detrended log spectrum with the one from two frames back (windows overlap 50%, so noise barely correlates). */
  private computeCrackTonal(): void {
    const mag = this.magnitude;
    const lo = Math.ceil(CRACK_MIN_HZ / this.binHz);
    const n = this.crackDetail[0].length;
    const log = this.crackLog;
    for (let i = 0; i < n; i++) log[i] = Math.log(mag[lo + i] + 1e-7);
    const cur = this.crackDetail[this.frameCount % 3];
    for (let i = 0; i < n; i++) {
      let sum = 0;
      let count = 0;
      for (let j = Math.max(0, i - CRACK_SMOOTH_BINS); j <= Math.min(n - 1, i + CRACK_SMOOTH_BINS); j++, count++) sum += log[j];
      cur[i] = log[i] - sum / count;
    }
    const old = this.crackDetail[(this.frameCount + 1) % 3];
    let dot = 0;
    let a2 = 0;
    let b2 = 0;
    for (let i = 0; i < n; i++) {
      dot += cur[i] * old[i];
      a2 += cur[i] * cur[i];
      b2 += old[i] * old[i];
    }
    this.crackTonal = this.frameCount >= 2 && a2 > 0 && b2 > 0 ? dot / Math.sqrt(a2 * b2) : 0;
    this.frameCount++;
  }

  private computeMel(): void {
    const mag = this.magnitude;
    for (let m = 0; m < MEL_BANDS; m++) {
      const { start, weights } = this.filters[m];
      let p = 0;
      for (let i = 0; i < weights.length; i++) p += weights[i] * mag[start + i] * mag[start + i];
      this.melPower[m] = p;
      this.logMel[m] = Math.log10(p + EPS);
    }
    for (let c = 0; c < MFCC_COUNT; c++) {
      let v = 0;
      for (let m = 0; m < MEL_BANDS; m++) v += this.dct[c * MEL_BANDS + m] * this.logMel[m];
      this.mfcc[c] = v;
    }
  }

  private computeShape(): void {
    const mag = this.magnitude;
    let total = 0;
    let weighted = 0;
    for (let k = 1; k < mag.length; k++) {
      const p = mag[k] * mag[k];
      total += p;
      weighted += p * k * this.binHz;
    }
    this.centroid = total > EPS ? weighted / total : 0;

    let acc = 0;
    let k = 1;
    for (; k < mag.length && acc < 0.85 * total; k++) acc += mag[k] * mag[k];
    this.rolloff = total > EPS ? k * this.binHz : 0;

    const lo = Math.ceil(FLATNESS_MIN_HZ / this.binHz);
    const hi = Math.min(mag.length - 1, Math.floor(FLATNESS_MAX_HZ / this.binHz));
    let logSum = 0;
    let linSum = 0;
    for (let b = lo; b <= hi; b++) {
      const p = mag[b] * mag[b] + EPS;
      logSum += Math.log(p);
      linSum += p;
    }
    const n = hi - lo + 1;
    this.flatness = linSum > EPS * n * 10 ? Math.exp(logSum / n) / (linSum / n) : 0;
  }

  /** Peak-picked chroma: parabolic interpolation recovers pitch that 2048-point bins can't resolve. */
  private computeChroma(): void {
    const mag = this.magnitude;
    this.chroma.fill(0);
    const lo = Math.max(2, Math.floor(CHROMA_MIN_HZ / this.binHz));
    const hi = Math.min(mag.length - 2, Math.ceil(CHROMA_MAX_HZ / this.binHz));
    let peakMax = 0;
    for (let k = lo; k <= hi; k++) peakMax = Math.max(peakMax, mag[k]);
    if (peakMax < 1e-5) return;
    const floor = peakMax * 0.02;
    for (let k = lo; k <= hi; k++) {
      const b = mag[k];
      if (b < floor || b <= mag[k - 1] || b < mag[k + 1]) continue;
      const a = Math.log(mag[k - 1] + EPS);
      const c = Math.log(mag[k + 1] + EPS);
      const lb = Math.log(b + EPS);
      const denom = a - 2 * lb + c;
      const delta = denom === 0 ? 0 : (0.5 * (a - c)) / denom;
      const freq = (k + delta) * this.binHz;
      const midi = 69 + 12 * Math.log2(freq / 440);
      const nearest = Math.round(midi);
      const detune = Math.abs(midi - nearest);
      const pc = ((nearest % 12) + 12) % 12;
      this.chroma[pc] += b * (1 - detune);
    }
    let max = 0;
    for (let i = 0; i < 12; i++) max = Math.max(max, this.chroma[i]);
    if (max > 0) for (let i = 0; i < 12; i++) this.chroma[i] /= max;
  }
}
