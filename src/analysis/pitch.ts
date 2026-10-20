import { FFT_SIZE } from "./frame.ts";
import { medianFilter, movingMean, percentile } from "./dsp.ts";

/**
 * Predominant melody: which pitch the ear follows (a singer, a lead synth, a solo) and how
 * clearly. Shared by the offline (track.ts) and live (live.ts) analysers.
 *
 * Every spectral peak votes for the fundamentals it could be a harmonic of (harmonic
 * summation, after Salamon & Gómez 2012). The best few candidates per frame are kept, and
 * a pitch line is threaded through them that prefers small steps, so a one-frame octave
 * error doesn't make the line jump.
 */

/** A2 (110 Hz) to C6 (1047 Hz): voices and lead instruments. Bass lines sit below on purpose. */
export const PITCH_MIN = 45;
export const PITCH_MAX = 84;
export const MELODY_CANDIDATES = 5;

const STEP = 0.1;
const BINS = Math.round((PITCH_MAX - PITCH_MIN) / STEP) + 1;
const HARMONICS = 8;
const HARMONIC_DECAY = 0.8;
const HARMONIC_SEMITONES = Array.from({ length: HARMONICS + 1 }, (_, h) => (h > 0 ? 12 * Math.log2(h) : 0));
/** Semitones either side of a candidate a peak still votes for, with cos² falloff. */
const SPREAD = 0.5;
const PEAK_MIN_HZ = 80;
const PEAK_MAX_HZ = 5000;
const MAX_PEAKS = 40;
/** Peaks more than 40 dB under the loudest are ignored. */
const PEAK_FLOOR = 0.01;
/** Partials below about this frequency count less, roughly like the ear, so the bass doesn't outvote the tune. */
const TILT_HZ = 250;

/** Clarity (share of the peak energy one harmonic series explains) that maps to melody 0 and 1. */
const CLARITY_NONE = 0.2;
const CLARITY_FULL = 0.4;
/**
 * Pitch-line cost of a jump: a fixed part, so the line can't flip between two close candidates
 * every frame, plus a part per semitone capped at an octave. Glides and vibrato move less than
 * JUMP_FREE per frame and cost nothing.
 */
const JUMP_FREE = 0.4;
const JUMP_FIXED = 0.15;
const JUMP_COST = 0.05;
/** Frames below this confidence don't move the pitch or count toward vibrato. */
export const MELODY_GATE = 0.3;
/** RMS pitch wobble (semitones) around the local median: steady synths ≈ 0, sung vibrato 0.2–0.5. */
const WOBBLE_NONE = 0.1;
const WOBBLE_FULL = 0.25;
/** Larger deviations are note changes or tracking glitches, not vibrato, and are skipped. */
const WOBBLE_CLIP = 1;
const MEDIAN_SECONDS = 0.17;
/** Moving-mean length (odd, in frames) that passes 4–8 Hz vibrato and removes ~20 Hz beating. */
const vibratoSmoothing = (fps: number): number => 2 * Math.round((0.05 * fps) / 2) + 1;
const WOBBLE_SECONDS = 0.2;
const BLIP_SECONDS = 0.08;
/** Normalised pitch spans at least this many semitones, so a two-note riff doesn't fill the screen. */
export const PITCH_MIN_SPAN = 12;

const smoothstep = (lo: number, hi: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - lo) / (hi - lo)));
  return t * t * (3 - 2 * t);
};

/** Share of the frame's power HPSS calls sustained: drum hits are pitched for a moment too, but not sustained. */
const SUSTAIN_NONE = 0.4;
const SUSTAIN_FULL = 0.7;

export const melodyConfidence = (clarity: number, harmonicShare: number): number =>
  smoothstep(CLARITY_NONE, CLARITY_FULL, clarity) * smoothstep(SUSTAIN_NONE, SUSTAIN_FULL, harmonicShare);
export const voiceFrom = (wobble: number, confidence: number): number => smoothstep(WOBBLE_NONE, WOBBLE_FULL, wobble) * confidence;

const jumpCost = (a: number, b: number): number => {
  const d = Math.abs(a - b);
  return d < JUMP_FREE ? 0 : JUMP_FIXED + JUMP_COST * Math.min(12, d);
};

/** Pitch salience of one spectrum frame: the best MELODY_CANDIDATES fundamentals and how clear the best is. */
export class MelodySalience {
  /** Candidate pitches (MIDI, fractional), best first. */
  readonly candMidi = new Float32Array(MELODY_CANDIDATES);
  /** Salience relative to the best candidate (1), or all 0 when there are no peaks. */
  readonly candSalience = new Float32Array(MELODY_CANDIDATES);
  /** 0..1: share of the (tilted) peak energy the best harmonic series explains. */
  clarity = 0;

  private readonly salience = new Float32Array(BINS);
  private readonly binHz: number;
  private readonly peakHz: number[] = [];
  private readonly peakAmp: number[] = [];
  private readonly order: number[] = [];

  constructor(sampleRate: number) {
    this.binHz = sampleRate / FFT_SIZE;
  }

  /** `mag` is FrameAnalyzer.magnitude. */
  process(mag: Float32Array): void {
    this.findPeaks(mag);
    const sal = this.salience;
    sal.fill(0);
    let total = 0;
    for (const p of this.order) {
      const amp = this.peakAmp[p];
      const m1 = 69 + 12 * Math.log2(this.peakHz[p] / 440);
      total += amp;
      let weight = 1;
      for (let h = 1; h <= HARMONICS; h++, weight *= HARMONIC_DECAY) {
        const m = m1 - HARMONIC_SEMITONES[h];
        if (m < PITCH_MIN - SPREAD) break;
        if (m > PITCH_MAX + SPREAD) continue;
        const b0 = Math.max(0, Math.ceil((m - SPREAD - PITCH_MIN) / STEP));
        const b1 = Math.min(BINS - 1, Math.floor((m + SPREAD - PITCH_MIN) / STEP));
        for (let b = b0; b <= b1; b++) {
          const d = (PITCH_MIN + b * STEP - m) / SPREAD;
          const c = Math.cos((Math.PI / 2) * d);
          sal[b] += weight * amp * c * c;
        }
      }
    }
    this.pickCandidates(total);
  }

  private findPeaks(mag: Float32Array): void {
    const lo = Math.max(2, Math.floor(PEAK_MIN_HZ / this.binHz));
    const hi = Math.min(mag.length - 2, Math.ceil(PEAK_MAX_HZ / this.binHz));
    let max = 0;
    for (let k = lo; k <= hi; k++) max = Math.max(max, mag[k]);
    this.peakHz.length = 0;
    this.peakAmp.length = 0;
    this.order.length = 0;
    if (max < 1e-6) return;
    const floor = max * PEAK_FLOOR;
    for (let k = lo; k <= hi; k++) {
      const b = mag[k];
      if (b < floor || b <= mag[k - 1] || b < mag[k + 1]) continue;
      const a = Math.log(mag[k - 1] + 1e-10);
      const c = Math.log(mag[k + 1] + 1e-10);
      const lb = Math.log(b);
      const denom = a - 2 * lb + c;
      const delta = denom === 0 ? 0 : (0.5 * (a - c)) / denom;
      const hz = (k + delta) * this.binHz;
      const amp = Math.exp(lb - 0.25 * (a - c) * delta);
      this.peakHz.push(hz);
      this.peakAmp.push((amp * hz * hz) / (hz * hz + TILT_HZ * TILT_HZ));
      this.order.push(this.order.length);
    }
    if (this.order.length > MAX_PEAKS) {
      this.order.sort((i, j) => this.peakAmp[j] - this.peakAmp[i]);
      this.order.length = MAX_PEAKS;
    }
  }

  private pickCandidates(total: number): void {
    const sal = this.salience;
    this.candSalience.fill(0);
    this.candMidi.fill(PITCH_MIN);
    this.clarity = 0;
    if (total <= 0) return;
    let filled = 0;
    for (let b = 0; b < BINS; b++) {
      const v = sal[b];
      if (v <= 0 || (b > 0 && v <= sal[b - 1]) || (b < BINS - 1 && v < sal[b + 1])) continue;
      if (filled === MELODY_CANDIDATES && v <= this.candSalience[filled - 1]) continue;
      let at = Math.min(filled, MELODY_CANDIDATES - 1);
      while (at > 0 && this.candSalience[at - 1] < v) {
        this.candSalience[at] = this.candSalience[at - 1];
        this.candMidi[at] = this.candMidi[at - 1];
        at--;
      }
      this.candSalience[at] = v;
      this.candMidi[at] = PITCH_MIN + (b + refine(sal, b)) * STEP;
      filled = Math.min(MELODY_CANDIDATES, filled + 1);
    }
    const best = this.candSalience[0];
    if (best <= 0) return;
    this.clarity = Math.min(1, best / total);
    for (let k = 0; k < MELODY_CANDIDATES; k++) this.candSalience[k] /= best;
  }
}

/** Parabolic offset (-0.5..0.5 bins) of the true peak around bin b. */
function refine(v: Float32Array, b: number): number {
  if (b <= 0 || b >= v.length - 1) return 0;
  const denom = v[b - 1] - 2 * v[b] + v[b + 1];
  return denom === 0 ? 0 : Math.max(-0.5, Math.min(0.5, (0.5 * (v[b - 1] - v[b + 1])) / denom));
}

/**
 * Offline: the pitch line through each frame's candidates (frames × k, best first) that
 * maximises salience minus jump costs (Viterbi). Frames with no candidates keep the line.
 */
export function melodyPath(candidates: Float32Array, candSal: Float32Array, frames: number, k: number): Float32Array {
  const candMidi = Float32Array.from(candidates);
  const path = new Float32Array(frames);
  if (frames === 0) return path;
  const back = new Uint8Array(frames * k);
  let score = new Float64Array(k);
  let next = new Float64Array(k);
  for (let i = 0; i < k; i++) score[i] = candSal[i];
  for (let f = 1; f < frames; f++) {
    const empty = candSal[f * k] <= 0;
    for (let i = 0; i < k; i++) {
      if (empty) {
        next[i] = score[i];
        back[f * k + i] = i;
        continue;
      }
      const m = candMidi[f * k + i];
      let best = -Infinity;
      let arg = 0;
      for (let j = 0; j < k; j++) {
        const s = score[j] - jumpCost(candMidi[(f - 1) * k + j], m);
        if (s > best) {
          best = s;
          arg = j;
        }
      }
      next[i] = best + candSal[f * k + i];
      back[f * k + i] = arg;
    }
    if (empty) for (let i = 0; i < k; i++) candMidi[f * k + i] = candMidi[(f - 1) * k + i];
    [score, next] = [next, score];
  }
  let state = 0;
  for (let i = 1; i < k; i++) if (score[i] > score[state]) state = i;
  for (let f = frames - 1; f >= 0; f--) {
    path[f] = candMidi[f * k + state];
    state = back[f * k + state];
  }
  return path;
}

/**
 * RMS pitch wobble (semitones) around a running median, over confident frames only. The
 * residual is low-passed first so only vibrato-rate wobble counts: two close partials beating
 * (a chorus, unison instruments) jitter the pitch at ~20 Hz, which isn't a voice.
 */
export function vibratoDepth(midi: Float32Array, confidence: Float32Array, fps: number): Float32Array {
  const median = medianFilter(midi, 2 * Math.round((MEDIAN_SECONDS * fps) / 2) + 1);
  const n = midi.length;
  const on = Uint8Array.from(midi, (m, i) => (confidence[i] >= MELODY_GATE && Math.abs(m - median[i]) < WOBBLE_CLIP ? 1 : 0));
  const half = vibratoSmoothing(fps) >> 1;
  const residual = movingMean(
    Float32Array.from(midi, (m, i) => (on[i] ? m - median[i] : 0)),
    half,
    half,
  );
  const sq = new Float64Array(n + 1);
  const w = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) {
    sq[i + 1] = sq[i] + on[i] * residual[i] * residual[i];
    w[i + 1] = w[i] + on[i];
  }
  const r = Math.round(WOBBLE_SECONDS * fps);
  return Float32Array.from({ length: n }, (_, i) => {
    const a = Math.max(0, i - r);
    const b = Math.min(n, i + r + 1);
    const weight = w[b] - w[a];
    return weight > 0 ? Math.sqrt((sq[b] - sq[a]) / weight) : 0;
  });
}

export interface MelodyTrack {
  melody: Float32Array;
  pitch: Float32Array;
  voice: Float32Array;
  /** The raw pitch line in MIDI, for plots and tests. */
  midi: Float32Array;
}

/**
 * Offline melody scalars from per-frame salience (see MelodySalience). `harmonicShare` is
 * HPSS harmonic power / total per frame; `voiced` gates out silence.
 */
export function trackMelody(candMidi: Float32Array, candSal: Float32Array, clarity: Float32Array, harmonicShare: Float32Array, voiced: Uint8Array, fps: number): MelodyTrack {
  const frames = clarity.length;
  const midi = melodyPath(candMidi, candSal, frames, MELODY_CANDIDATES);
  const melody = movingMean(
    Float32Array.from(clarity, (c, i) => (voiced[i] ? melodyConfidence(c, harmonicShare[i]) : 0)),
    2,
    2,
  );
  const wobble = vibratoDepth(midi, melody, fps);
  const voice = movingMean(
    Float32Array.from(wobble, (w, i) => voiceFrom(w, melody[i])),
    3,
    3,
  );
  const sure = midi.filter((_, i) => melody[i] >= MELODY_GATE);
  const [lo, hi] = pitchRange(sure.length > 0 ? percentile(sure, 5) : 60, sure.length > 0 ? percentile(sure, 95) : 60);
  let held = sure.length > 0 ? sure[0] : 60;
  const pitch = Float32Array.from(midi, (m, i) => {
    if (melody[i] >= MELODY_GATE) held = m;
    return Math.min(1, Math.max(0, (held - lo) / (hi - lo)));
  });
  // The median drops blips shorter than ~40 ms (grace notes, octave slips) that would draw as spikes.
  return { melody, pitch: movingMean(medianFilter(pitch, 2 * Math.round((BLIP_SECONDS * fps) / 2) + 1), 1, 1), voice, midi };
}

/** Widens [lo, hi] (MIDI) about its centre to at least PITCH_MIN_SPAN. */
export function pitchRange(lo: number, hi: number): [number, number] {
  const pad = Math.max(0, PITCH_MIN_SPAN - (hi - lo)) / 2;
  return [lo - pad, hi + pad];
}

/**
 * Causal version for live input: picks the candidate with the best salience after a jump
 * cost (doubled, since a live wrong jump can't be undone), and measures vibrato a
 * median-window late.
 */
export class LiveMelody {
  midi = PITCH_MIN + 12;
  confidence = 0;
  wobble = 0;
  private readonly ring: Float32Array;
  private readonly ringOn: Uint8Array;
  /** Last few residuals, averaged to pass only vibrato-rate wobble (see vibratoDepth). */
  private readonly residuals: Float32Array;
  private count = 0;
  private readonly retainConf: number;
  private readonly retainWobble: number;
  private wobbleSq = 0;

  constructor(fps: number) {
    const len = 2 * Math.round((MEDIAN_SECONDS * fps) / 2) + 1;
    this.ring = new Float32Array(len);
    this.ringOn = new Uint8Array(len);
    this.residuals = new Float32Array(vibratoSmoothing(fps));
    this.retainConf = Math.exp(-1 / (0.04 * fps));
    this.retainWobble = Math.exp(-1 / (WOBBLE_SECONDS * fps));
  }

  push(s: MelodySalience, harmonicShare: number): void {
    const conf = melodyConfidence(s.clarity, harmonicShare);
    this.confidence = conf + (this.confidence - conf) * this.retainConf;
    if (s.candSalience[0] > 0 && conf >= MELODY_GATE) {
      let best = -Infinity;
      for (let i = 0; i < MELODY_CANDIDATES; i++) {
        const v = s.candSalience[i] - 2 * jumpCost(this.midi, s.candMidi[i]);
        if (s.candSalience[i] > 0 && v > best) {
          best = v;
          this.midi = s.candMidi[i];
        }
      }
    }
    const len = this.ring.length;
    this.ring[this.count % len] = this.midi;
    this.ringOn[this.count % len] = conf >= MELODY_GATE ? 1 : 0;
    this.count++;
    if (this.count < len) return;
    const centre = (this.count - 1 - (len >> 1)) % len;
    const sorted = Float32Array.from(this.ring).sort();
    const r = this.ring[centre] - sorted[len >> 1];
    const on = this.ringOn[centre] === 1 && Math.abs(r) < WOBBLE_CLIP;
    this.residuals[this.count % this.residuals.length] = on ? r : 0;
    if (!on) return;
    let mean = 0;
    for (const x of this.residuals) mean += x / this.residuals.length;
    this.wobbleSq = mean * mean + (this.wobbleSq - mean * mean) * this.retainWobble;
    this.wobble = Math.sqrt(this.wobbleSq);
  }

  get voice(): number {
    return voiceFrom(this.wobble, this.confidence);
  }
}
