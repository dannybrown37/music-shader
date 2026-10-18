import { estimateTempo } from "./beats.ts";
import { BANDS, bandIndices, compressValue, DETECTORS, EPS, hatGate, HAT, HPSS_FREQ, HPSS_TIME, isNearAny, KICK, NOTE_DRUM_GUARD, REF_FLOOR, rowFlux, SNARE_CRACK, SNARE_TONAL_DELAY, snareGate, toDb } from "./bands.ts";
import type { DetectorName } from "./bands.ts";
import { retain } from "./dsp.ts";
import { FFT_SIZE, FrameAnalyzer, HOP, MEL_BANDS, melCenters } from "./frame.ts";
import { dominantPitch, energyRate, eventState, notePitchState } from "./sampler.ts";
import type { Features } from "./sampler.ts";
import { EVENT_KINDS, SCALAR_NAMES } from "./types.ts";
import type { EventKind, EventTrack, ScalarName } from "./types.ts";

/**
 * Causal analysis for live input (mic, line-in, captured tab audio). Same detectors as the
 * offline analyser, but every decision uses only the past plus two frames (~23 ms) of
 * look-ahead, and normalisation adapts over the last few seconds instead of the whole song.
 */

const LOOKAHEAD = 2;
const ODF_HISTORY = 16;
const TEMPO_WINDOW_SECONDS = 8;
const SPECTROGRAM_SECONDS = 3;
const MAX_EVENTS = 256;
const SECTION_GAP_SECONDS = 6;

/** Tracks a slowly forgetting min/max so values can be normalised without seeing the whole song. */
class AdaptiveRange {
  private lo = Number.NaN;
  private hi = Number.NaN;
  private readonly drift: number;
  private readonly minSpan: number;

  /** `drift` is how far per second the bounds relax toward the signal; `minSpan` stops silence being stretched to 0..1. */
  constructor(drift: number, minSpan: number) {
    this.drift = drift;
    this.minSpan = minSpan;
  }

  normalize(x: number, dt: number): number {
    if (Number.isNaN(this.lo)) {
      this.lo = x - this.minSpan / 2;
      this.hi = x + this.minSpan / 2;
    }
    this.hi = Math.max(x, this.hi - this.drift * dt);
    this.lo = Math.min(x, this.lo + this.drift * dt);
    const span = Math.max(this.minSpan, this.hi - this.lo);
    return Math.min(1, Math.max(0, (x - (this.hi - span)) / span));
  }
}

class GrowingTrack {
  times: number[] = [];
  strengths: number[] = [];
  private cache: EventTrack | null = null;
  private readonly cap: number;

  constructor(cap: number) {
    this.cap = cap;
  }

  add(t: number, s: number): void {
    this.times.push(t);
    this.strengths.push(s);
    if (this.times.length > this.cap) {
      this.times.splice(0, this.times.length - this.cap);
      this.strengths.splice(0, this.strengths.length - this.cap);
    }
    this.cache = null;
  }

  get track(): EventTrack {
    this.cache ??= { times: Float32Array.from(this.times), strengths: Float32Array.from(this.strengths) };
    return this.cache;
  }
}

/** Causal peak picker: decides about frame n−LOOKAHEAD once frame n arrives. */
class LivePeakPicker {
  private readonly values = new Float32Array(ODF_HISTORY);
  private count = 0;
  private lastEvent = -Infinity;
  private peakRef: number;
  private readonly minGapFrames: number;
  private readonly floor: number;
  private readonly delta: number;

  constructor(name: DetectorName, fps: number) {
    const d = DETECTORS[name];
    this.minGapFrames = Math.max(1, Math.round(d.minGap * fps));
    this.floor = d.floor;
    this.delta = d.delta;
    this.peakRef = d.floor * 2;
  }

  /** Typical peak height, for scaling into a 0..1-ish strength and for the tempo pulse. */
  get reference(): number {
    return this.peakRef;
  }

  /** Returns the strength of an event at frame (n − LOOKAHEAD), or 0. */
  push(v: number): number {
    const n = this.count++;
    this.values[n % ODF_HISTORY] = v;
    if (n < 6) return 0;
    const at = (k: number): number => this.values[(((n - k) % ODF_HISTORY) + ODF_HISTORY) % ODF_HISTORY];
    const c = at(LOOKAHEAD);
    if (c < this.floor || n - LOOKAHEAD - this.lastEvent < this.minGapFrames) return 0;
    for (let k = 0; k < LOOKAHEAD; k++) if (at(k) > c) return 0;
    for (let k = LOOKAHEAD + 1; k <= LOOKAHEAD + 3; k++) if (at(k) >= c) return 0;
    let mean = 0;
    const span = Math.min(ODF_HISTORY - 1, n);
    for (let k = 0; k <= span; k++) mean += at(k);
    mean /= span + 1;
    if (c < mean + this.delta || c < 0.12 * this.peakRef) return 0;
    this.lastEvent = n - LOOKAHEAD;
    this.peakRef += (c - this.peakRef) * 0.1;
    return Math.min(1.5, c / this.peakRef);
  }
}

export class LiveAnalyzer {
  readonly sampleRate: number;
  readonly fps: number;
  /** Time (s) of the most recently analysed frame centre. */
  time = 0;
  tempo = 0;

  private readonly frame: FrameAnalyzer;
  private readonly window = new Float32Array(FFT_SIZE);
  private readonly sideWindow = new Float32Array(FFT_SIZE);
  private filled = 0;
  private samplesSeen = 0;
  private frames = 0;

  private readonly history = new Float32Array(HPSS_TIME * MEL_BANDS);
  private readonly refs = new Float32Array(MEL_BANDS);
  private readonly refRetain: number;
  private readonly cur = { full: new Float32Array(MEL_BANDS), perc: new Float32Array(MEL_BANDS), percLin: new Float32Array(MEL_BANDS) };
  private readonly prev = { full: new Float32Array(MEL_BANDS), perc: new Float32Array(MEL_BANDS), percLin: new Float32Array(MEL_BANDS) };
  private readonly bands: Record<"kick" | "crack" | "hat" | "all", number[]>;
  private readonly bandGroups: [ScalarName, number[]][];
  private readonly pickers: Record<DetectorName, LivePeakPicker>;
  /** Sections and downbeats keep their whole history: Auto VJ counts them from the start. */
  private readonly tracks = Object.fromEntries(EVENT_KINDS.map((k) => [k, new GrowingTrack(k === "section" || k === "downbeat" ? Infinity : MAX_EVENTS)])) as Record<EventKind, GrowingTrack>;
  private readonly downbeatIntensity: number[] = [];
  /** Pitch class of each note in tracks.note, kept the same length. */
  private readonly notePitches: number[] = [];
  private downbeatCache: { times: Float32Array; intensity: Float32Array } | null = null;

  private readonly pulse: Float32Array;
  private pulseCount = 0;
  private nextBeat = Number.NaN;
  private beatCount = 0;
  private lastBeat = Number.NaN;
  private readonly downWeights = [0, 0, 0, 0];
  private tempoCandidate = 0;
  private tempoVotes = 0;
  private readonly pendingNotes: [number, number][] = [];
  /** Snare candidates [frame, time, strength] waiting SNARE_TONAL_DELAY frames for their tonality. */
  private readonly pendingSnares: [number, number, number][] = [];
  private readonly crackTonal = new Float32Array(8);

  private readonly ranges = new Map<string, AdaptiveRange>();
  private readonly values = Object.fromEntries(SCALAR_NAMES.map((n) => [n, 0])) as Record<ScalarName, number>;
  private readonly mfccMean = new Float64Array(4);
  private readonly mfccVar = new Float64Array(4).fill(1);
  private readonly noveltyShort = new Float32Array(16);
  private readonly noveltyLong = new Float32Array(16);
  private lastSection = -Infinity;
  private noveltyArmed = true;
  private energyTime = 0;
  private intensityDb = Number.NaN;
  private readonly chroma = new Float32Array(12);
  private readonly mel = new Float32Array(MEL_BANDS);
  private readonly specRing: Float32Array;
  private readonly specRows: number;

  constructor(sampleRate: number) {
    this.sampleRate = sampleRate;
    this.fps = sampleRate / HOP;
    this.frame = new FrameAnalyzer(sampleRate);
    this.refRetain = retain(8, this.fps);
    const centers = melCenters(sampleRate);
    this.bands = {
      kick: bandIndices(centers, KICK),
      crack: bandIndices(centers, SNARE_CRACK),
      hat: bandIndices(centers, HAT),
      all: centers.map((_, i) => i),
    };
    this.bandGroups = (Object.entries(BANDS) as [ScalarName, [number, number]][]).map(([name, r]) => [name, bandIndices(centers, r)]);
    this.pickers = {
      kick: new LivePeakPicker("kick", this.fps),
      snare: new LivePeakPicker("snare", this.fps),
      hat: new LivePeakPicker("hat", this.fps),
      onset: new LivePeakPicker("onset", this.fps),
    };
    this.pulse = new Float32Array(Math.round(TEMPO_WINDOW_SECONDS * this.fps));
    this.specRows = Math.round(SPECTROGRAM_SECONDS * this.fps);
    this.specRing = new Float32Array(this.specRows * MEL_BANDS);
  }

  /** Feed any number of new samples. `right` may be null for mono input. */
  push(left: Float32Array, right: Float32Array | null): void {
    let i = 0;
    while (i < left.length) {
      const take = Math.min(HOP - this.filled, left.length - i);
      const base = FFT_SIZE - HOP + this.filled;
      for (let k = 0; k < take; k++) {
        const l = left[i + k];
        const r = right ? right[i + k] : l;
        this.window[base + k] = 0.5 * (l + r);
        this.sideWindow[base + k] = 0.5 * (l - r);
      }
      this.filled += take;
      this.samplesSeen += take;
      i += take;
      if (this.filled === HOP) {
        this.analyzeFrame();
        this.window.copyWithin(0, HOP);
        this.sideWindow.copyWithin(0, HOP);
        this.filled = 0;
      }
    }
  }

  sectionTimes(): Float32Array {
    return this.tracks.section.track.times;
  }

  downbeats(): { times: Float32Array; intensity: Float32Array } {
    this.downbeatCache ??= { times: this.tracks.downbeat.track.times, intensity: Float32Array.from(this.downbeatIntensity) };
    return this.downbeatCache;
  }

  eventTimes(kind: EventKind): Float32Array {
    return this.tracks[kind].track.times;
  }

  private range(key: string, drift: number, minSpan: number): AdaptiveRange {
    let r = this.ranges.get(key);
    if (!r) {
      r = new AdaptiveRange(drift, minSpan);
      this.ranges.set(key, r);
    }
    return r;
  }

  private analyzeFrame(): void {
    const dt = 1 / this.fps;
    const t = (this.samplesSeen - FFT_SIZE / 2) / this.sampleRate;
    this.time = t;
    const n = this.frames++;
    this.frame.process(this.window);
    this.crackTonal[n % this.crackTonal.length] = this.frame.crackTonal;
    const power = this.frame.melPower;

    this.history.set(power, (n % HPSS_TIME) * MEL_BANDS);
    const hist = Math.min(HPSS_TIME, n + 1);
    const scratch = new Float32Array(hist);
    const harmonicMedian = new Float32Array(MEL_BANDS);
    for (let c = 0; c < MEL_BANDS; c++) {
      for (let k = 0; k < hist; k++) scratch[k] = this.history[k * MEL_BANDS + c];
      scratch.sort();
      harmonicMedian[c] = scratch[hist >> 1];
    }
    const freqWindow = new Float32Array(HPSS_FREQ);
    let refMax = 0;
    for (let c = 0; c < MEL_BANDS; c++) {
      this.refs[c] = Math.max(power[c], this.refs[c] * this.refRetain);
      refMax = Math.max(refMax, this.refs[c]);
    }
    const refFloor = Math.max(EPS, refMax * REF_FLOOR);

    for (const k of ["full", "perc", "percLin"] as const) this.prev[k].set(this.cur[k]);
    let percSum = 0;
    let harmSum = 0;
    for (let c = 0; c < MEL_BANDS; c++) {
      let m = 0;
      for (let j = c - (HPSS_FREQ >> 1); j <= c + (HPSS_FREQ >> 1); j++) if (j >= 0 && j < MEL_BANDS) freqWindow[m++] = power[j];
      const sorted = freqWindow.subarray(0, m).sort();
      const p = sorted[m >> 1];
      const h = harmonicMedian[c];
      const mask = (p * p) / (p * p + h * h + EPS);
      const ref = Math.max(this.refs[c], refFloor);
      const perc = power[c] * mask;
      const harm = power[c] * (1 - mask);
      this.cur.percLin[c] = perc;
      this.cur.full[c] = compressValue(power[c], ref);
      this.cur.perc[c] = compressValue(perc, ref);
      percSum += perc;
      harmSum += harm;
    }

    if (n > 0) this.detect(t, n);
    this.updateScalars(t, dt, power, percSum, harmSum);
    this.updateBeats(t);
  }

  private detect(t: number, n: number): void {
    const { cur, prev, bands } = this;
    const kick = rowFlux(cur.perc, prev.perc, bands.kick);
    const snare = rowFlux(cur.perc, prev.perc, bands.crack);
    const hat = rowFlux(cur.perc, prev.perc, bands.hat) * hatGate(rowFlux(cur.percLin, prev.percLin, bands.hat), rowFlux(cur.percLin, prev.percLin, bands.crack));
    const onset = rowFlux(cur.full, prev.full, bands.all);
    const odf: Record<DetectorName, number> = { kick, snare, hat, onset };
    const eventTime = t - LOOKAHEAD / this.fps;
    let pulse = 0;
    for (const name of Object.keys(odf) as DetectorName[]) {
      const picker = this.pickers[name];
      pulse += Math.min(1.5, odf[name] / picker.reference);
      const strength = picker.push(odf[name]);
      if (strength <= 0) continue;
      if (name === "snare") {
        this.pendingSnares.push([n - LOOKAHEAD, eventTime, strength]);
        continue;
      }
      this.tracks[name].add(eventTime, strength);
      if (name === "onset") this.pendingNotes.push([eventTime, strength]);
      if (name === "kick" || name === "onset") this.nudgeBeat(eventTime, strength);
    }
    this.pulse[n % this.pulse.length] = pulse;
    this.pulseCount = n + 1;
    this.settleSnares(n);
    this.settleNotes(eventTime);
  }

  private settleSnares(n: number): void {
    while (this.pendingSnares.length > 0 && this.pendingSnares[0][0] + SNARE_TONAL_DELAY <= n) {
      const [frame, t, s] = this.pendingSnares.shift() as [number, number, number];
      const kept = s * snareGate(this.crackTonal[(frame + SNARE_TONAL_DELAY) % this.crackTonal.length]);
      if (kept <= 0) continue;
      this.tracks.snare.add(t, kept);
      this.nudgeBeat(t, kept);
    }
  }

  /** An onset becomes a note once the drum guard window has passed with no drum hit near it. */
  private settleNotes(now: number): void {
    const drums = [this.tracks.kick.times, this.tracks.snare.times, this.tracks.hat.times];
    while (this.pendingNotes.length > 0 && this.pendingNotes[0][0] < now - NOTE_DRUM_GUARD) {
      const [t, s] = this.pendingNotes.shift() as [number, number];
      if (isNearAny(t, drums, NOTE_DRUM_GUARD)) continue;
      // The note settles ~40 ms after its onset, so the current chroma is already the note's.
      this.tracks.note.add(t, s);
      this.notePitches.push(dominantPitch(this.chroma));
      if (this.notePitches.length > this.tracks.note.times.length) this.notePitches.shift();
    }
  }

  /** Phase-locked loop: onsets near a predicted beat pull the beat grid toward them. */
  private nudgeBeat(te: number, strength: number): void {
    if (this.tempo <= 0 || Number.isNaN(this.nextBeat)) return;
    const period = 60 / this.tempo;
    const candidates = [this.nextBeat - period, this.nextBeat];
    const nearest = Math.abs(te - candidates[0]) < Math.abs(te - candidates[1]) ? candidates[0] : candidates[1];
    const err = te - nearest;
    if (Math.abs(err) < 0.2 * period) this.nextBeat += 0.3 * err * Math.min(1, strength);
  }

  private updateBeats(t: number): void {
    const n = this.pulseCount;
    if (n >= 4 * this.fps && n % Math.round(this.fps) === 0) {
      const len = Math.min(n, this.pulse.length);
      const ordered = new Float32Array(len);
      for (let k = 0; k < len; k++) ordered[k] = this.pulse[(n - len + k) % this.pulse.length];
      const estimate = estimateTempo(ordered, this.fps);
      if (estimate > 0) this.acceptTempo(estimate, t);
    }
    if (this.tempo <= 0 || Number.isNaN(this.nextBeat)) return;
    const period = 60 / this.tempo;
    while (t >= this.nextBeat) {
      const beat = this.nextBeat;
      this.tracks.beat.add(beat, 1);
      const kicks = this.tracks.kick;
      const lastKick = kicks.times.length ? kicks.times[kicks.times.length - 1] : -Infinity;
      const slot = this.beatCount % 4;
      const hit = Math.abs(lastKick - beat) < 0.08 ? kicks.strengths[kicks.strengths.length - 1] : 0;
      this.downWeights[slot] = this.downWeights[slot] * 0.9 + hit;
      if (slot === this.downWeights.indexOf(Math.max(...this.downWeights))) {
        this.tracks.downbeat.add(beat, 1);
        this.downbeatIntensity.push(this.values.intensity);
        this.downbeatCache = null;
      }
      this.lastBeat = beat;
      this.beatCount++;
      this.nextBeat += period;
    }
  }

  /** Small tempo changes are followed smoothly; a new tempo must win three estimates in a row. */
  private acceptTempo(estimate: number, t: number): void {
    if (this.tempo <= 0) {
      this.tempo = estimate;
      const onsets = this.tracks.onset.times;
      const anchor = onsets.length ? onsets[onsets.length - 1] : t;
      const period = 60 / estimate;
      this.nextBeat = anchor + Math.ceil((t - anchor) / period + 1e-6) * period;
      return;
    }
    if (Math.abs(estimate / this.tempo - 1) < 0.04) {
      this.tempo += (estimate - this.tempo) * 0.2;
      this.tempoVotes = 0;
      return;
    }
    if (Math.abs(estimate / (this.tempoCandidate || 1) - 1) < 0.04) this.tempoVotes++;
    else {
      this.tempoCandidate = estimate;
      this.tempoVotes = 1;
    }
    if (this.tempoVotes >= 3) {
      this.tempo = this.tempoCandidate;
      this.tempoVotes = 0;
    }
  }

  private updateScalars(t: number, dt: number, power: Float32Array, percSum: number, harmSum: number): void {
    const v = this.values;
    const a = this.frame;
    const follow = (name: ScalarName, x: number, release: number): void => {
      v[name] = x > v[name] ? x : x + (v[name] - x) * retain(release, this.fps);
    };
    const ema = (cur: number, x: number, seconds: number): number => x + (cur - x) * retain(seconds, this.fps);

    const loudDb = 20 * Math.log10(a.rms + 1e-6);
    follow("loudness", this.range("loud", 1.5, 18).normalize(loudDb, dt), 0.1);
    this.intensityDb = Number.isNaN(this.intensityDb) ? loudDb : ema(this.intensityDb, loudDb, 3);
    v.intensity = this.range("intensity", 0.5, 10).normalize(this.intensityDb, dt);
    for (const [name, idx] of this.bandGroups) {
      let p = 0;
      for (const c of idx) p += power[c];
      follow(name, this.range(name, 2, 18).normalize(toDb(p / idx.length), dt), 0.08);
    }
    follow("percussive", this.range("perc", 2, 18).normalize(toDb(percSum), dt), 0.06);
    v.harmonic = ema(v.harmonic, this.range("harm", 1.5, 18).normalize(toDb(harmSum), dt), 0.07);
    v.brightness = ema(v.brightness, this.range("bright", 0.15, 1.5).normalize(Math.log2(Math.max(a.centroid, 50)), dt), 0.025);
    v.noisiness = ema(v.noisiness, this.range("noisy", 0.02, 0.15).normalize(a.flatness, dt), 0.025);
    let csum = 0;
    let cmax = 0;
    for (let k = 0; k < 12; k++) {
      this.chroma[k] = ema(this.chroma[k], a.chroma[k], 0.05);
      csum += a.chroma[k];
      cmax = Math.max(cmax, a.chroma[k]);
    }
    const peakiness = csum > 0 ? ((cmax / csum - 1 / 12) / (1 - 1 / 12)) * (1 - a.flatness) : 0;
    v.tonalness = ema(v.tonalness, this.range("tonal", 0.02, 0.2).normalize(peakiness, dt), 0.05);
    const side = rmsOf(this.sideWindow);
    const mid = rmsOf(this.window);
    v.width = ema(v.width, mid > 1e-5 ? Math.min(1, side / mid) : 0, 0.035);

    let hx = 0;
    let hy = 0;
    for (let k = 0; k < 12; k++) {
      const theta = (2 * Math.PI * ((7 * k) % 12)) / 12;
      hx += this.chroma[k] * Math.cos(theta);
      hy += this.chroma[k] * Math.sin(theta);
    }
    let chromaSum = 0;
    for (const c of this.chroma) chromaSum += c;
    v.hueX = ema(v.hueX, chromaSum > 0 ? hx / chromaSum : 0, 0.25);
    v.hueY = ema(v.hueY, chromaSum > 0 ? hy / chromaSum : 0, 0.25);

    // Timbre: running z-scores of MFCC 1–3. Negated MFCC1 so X rises with brightness like the offline PCA.
    const signs = [0, -1, 1, 1];
    const timbre: ScalarName[] = ["timbreX", "timbreY", "timbreZ"];
    const voiced = v.loudness > 0.02;
    for (let d = 1; d <= 3; d++) {
      const x = a.mfcc[d];
      if (voiced) {
        this.mfccMean[d] = ema(this.mfccMean[d], x, 15);
        this.mfccVar[d] = ema(this.mfccVar[d], (x - this.mfccMean[d]) ** 2, 15);
      }
      const z = (signs[d] * (x - this.mfccMean[d])) / Math.sqrt(this.mfccVar[d] + 1e-6);
      v[timbre[d - 1]] = ema(v[timbre[d - 1]], voiced ? Math.max(-1, Math.min(1, z / 2.5)) : 0, 0.03);
    }

    const feat = [v.timbreX * 2, v.timbreY * 2, v.timbreZ * 2, v.intensity * 2, ...this.chroma];
    let dist = 0;
    for (let k = 0; k < feat.length; k++) {
      this.noveltyShort[k] = ema(this.noveltyShort[k], feat[k], 1.5);
      this.noveltyLong[k] = ema(this.noveltyLong[k], feat[k], 6);
      dist += (this.noveltyShort[k] - this.noveltyLong[k]) ** 2;
    }
    v.novelty = this.range("novelty", 0.05, 0.5).normalize(Math.sqrt(dist), dt);
    if (v.novelty < 0.4) this.noveltyArmed = true;
    if (this.noveltyArmed && v.novelty > 0.8 && t - this.lastSection > SECTION_GAP_SECONDS && t > SECTION_GAP_SECONDS) {
      this.tracks.section.add(t, v.novelty);
      this.lastSection = t;
      this.noveltyArmed = false;
    }

    this.energyTime += energyRate(v.loudness, v.percussive) * dt;
    const row = (this.frames - 1) % this.specRows;
    for (let c = 0; c < MEL_BANDS; c++) {
      this.mel[c] = this.range(`mel${c}`, 1, 24).normalize(toDb(power[c]), dt);
      this.specRing[row * MEL_BANDS + c] = this.mel[c];
    }
  }

  sample(t: number, out: Features, decays: Record<EventKind, number>): void {
    out.time = t;
    for (const name of SCALAR_NAMES) out.scalars[name] = this.values[name];
    out.mel.set(this.mel);
    out.chroma.set(this.chroma);
    out.energyTime = this.energyTime + Math.max(0, t - this.time) * energyRate(this.values.loudness, this.values.percussive);
    for (const kind of EVENT_KINDS) eventState(this.tracks[kind].track, t, decays[kind], kind, out);
    notePitchState(this.notePitches, out);
    out.tempo = this.tempo || 120;
    const period = 60 / out.tempo;
    if (Number.isNaN(this.lastBeat)) {
      const pos = t / period;
      out.beatIndex = Math.floor(pos);
      out.beatPhase = pos - out.beatIndex;
    } else {
      const pos = (t - this.lastBeat) / period;
      const whole = Math.floor(pos);
      out.beatIndex = this.beatCount - 1 + whole;
      out.beatPhase = pos - whole;
    }
    const down = this.downWeights.indexOf(Math.max(...this.downWeights));
    out.barPhase = (((((out.beatIndex - down) % 4) + 4) % 4) + out.beatPhase) / 4;
  }

  /** Same contract as FeatureSampler.spectrogram: row 0 = now, last row = `span` seconds ago. */
  spectrogram(t: number, rows: number, span: number, out: Float32Array): void {
    const newest = this.frames - 1;
    for (let r = 0; r < rows; r++) {
      const back = Math.min(this.specRows - 1, ((r / (rows - 1)) * span + Math.max(0, t - this.time)) * this.fps);
      const i = Math.floor(back);
      const w = back - i;
      const a = (((newest - i) % this.specRows) + this.specRows) % this.specRows;
      const b = (((newest - i - 1) % this.specRows) + this.specRows) % this.specRows;
      for (let c = 0; c < MEL_BANDS; c++) {
        const valid = newest - i - 1 >= 0;
        const va = newest - i >= 0 ? this.specRing[a * MEL_BANDS + c] : 0;
        const vb = valid ? this.specRing[b * MEL_BANDS + c] : 0;
        out[r * MEL_BANDS + c] = va * (1 - w) + vb * w;
      }
    }
  }
}

function rmsOf(x: Float32Array): number {
  let s = 0;
  for (const v of x) s += v * v;
  return Math.sqrt(s / x.length);
}
