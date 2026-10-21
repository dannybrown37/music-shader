import { estimateTempo, pickDownbeat, trackBeats } from "./beats.ts";
import { findCast, harmonicMfcc } from "./cast.ts";
import { findDrops } from "./drops.ts";
import { estimateKey } from "./key.ts";
import { followEnvelope, medianFilter, movingMean, normalizeRange, peakPick, percentile, retain } from "./dsp.ts";
import type { PeakPickOptions } from "./dsp.ts";
import { BANDS, bandIndices, compressValue, DETECTORS, EPS, hatGate, HAT, HPSS_FREQ, HPSS_TIME, isNearAny, KICK, NOTE_DRUM_GUARD, REF_FLOOR, rowFlux, SNARE_CRACK, SNARE_TONAL_DELAY, snareGate, toDb } from "./bands.ts";
import type { Detector, Range } from "./bands.ts";
import { FFT_SIZE, FrameAnalyzer, HOP, MEL_BANDS, MFCC_COUNT, melCenters } from "./frame.ts";
import { MELODY_CANDIDATES, MelodySalience, trackMelody } from "./pitch.ts";
import { EVENT_KINDS, SCALAR_NAMES } from "./types.ts";
import type { EventKind, EventTrack, ScalarName, TrackAnalysis } from "./types.ts";

/**
 * Offline analysis of a whole track. Because the full file is available we can
 * look ahead: peak picking uses future frames, beats come from global dynamic
 * programming, and every feature is normalised against the whole song.
 */

export type ProgressCallback = (fraction: number) => void;


class Matrix {
  readonly data: Float32Array;
  readonly rows: number;
  readonly cols: number;
  constructor(rows: number, cols: number) {
    this.rows = rows;
    this.cols = cols;
    this.data = new Float32Array(rows * cols);
  }
  row(r: number): Float32Array {
    return this.data.subarray(r * this.cols, (r + 1) * this.cols);
  }
  column(c: number): Float32Array {
    const out = new Float32Array(this.rows);
    for (let r = 0; r < this.rows; r++) out[r] = this.data[r * this.cols + c];
    return out;
  }
  setColumn(c: number, values: Float32Array): void {
    for (let r = 0; r < this.rows; r++) this.data[r * this.cols + c] = values[r];
  }
}

/** Separates sustained (horizontal) from transient (vertical) energy with median filters. */
function hpss(power: Matrix): { percussive: Matrix; harmonic: Matrix } {
  const harmonicMedian = new Matrix(power.rows, power.cols);
  for (let c = 0; c < power.cols; c++) harmonicMedian.setColumn(c, medianFilter(power.column(c), HPSS_TIME));
  const percussive = new Matrix(power.rows, power.cols);
  const harmonic = new Matrix(power.rows, power.cols);
  for (let r = 0; r < power.rows; r++) {
    const p = medianFilter(power.row(r), HPSS_FREQ);
    const h = harmonicMedian.row(r);
    const x = power.row(r);
    const pr = percussive.row(r);
    const hr = harmonic.row(r);
    for (let c = 0; c < power.cols; c++) {
      const mask = (p[c] * p[c]) / (p[c] * p[c] + h[c] * h[c] + EPS);
      pr[c] = x[c] * mask;
      hr[c] = x[c] * (1 - mask);
    }
  }
  return { percussive, harmonic };
}

/** log(1 + C·x/ref) per band, with ref from the full mix so every band has a comparable scale. */
function compress(power: Matrix, refs: Float32Array): Matrix {
  const out = new Matrix(power.rows, power.cols);
  for (let i = 0; i < power.data.length; i++) out.data[i] = compressValue(power.data[i], refs[i % power.cols]);
  return out;
}

function bandFlux(spec: Matrix, bands: number[]): Float32Array {
  const out = new Float32Array(spec.rows);
  for (let r = 1; r < spec.rows; r++) out[r] = rowFlux(spec.row(r), spec.row(r - 1), bands);
  return out;
}

function detect(odf: Float32Array, fps: number, d: Detector): EventTrack {
  const opts: PeakPickOptions = {
    preMax: 3,
    postMax: 3,
    preAvg: Math.round(0.1 * fps),
    postAvg: Math.round(0.05 * fps),
    delta: d.delta,
    floor: d.floor,
    minGap: Math.max(1, Math.round(d.minGap * fps)),
  };
  let peaks = peakPick(odf, opts);
  const ref = percentile(
    peaks.map((p) => odf[p]),
    90,
  );
  peaks = peaks.filter((p) => odf[p] >= 0.12 * ref);
  return {
    times: Float32Array.from(peaks, (p) => p / fps),
    strengths: Float32Array.from(peaks, (p) => Math.min(1.5, odf[p] / (ref || 1))),
  };
}

function gateSnares(track: EventTrack, crackTonal: Float32Array, fps: number): EventTrack {
  const kept = Array.from(track.times, (t, i) => {
    const f = Math.min(crackTonal.length - 1, Math.round(t * fps) + SNARE_TONAL_DELAY);
    return { t, s: track.strengths[i] * snareGate(crackTonal[f]) };
  }).filter((e) => e.s > 0);
  return { times: Float32Array.from(kept, (e) => e.t), strengths: Float32Array.from(kept, (e) => e.s) };
}

function smooth(data: Float32Array, radius: number): Float32Array {
  return movingMean(data, radius, radius);
}

/** Top-k principal components by power iteration with deflation. */
function principalComponents(cov: Float64Array[], k: number): { vectors: Float64Array[]; values: number[] } {
  const n = cov.length;
  const m = cov.map((row) => Float64Array.from(row));
  const vectors: Float64Array[] = [];
  const values: number[] = [];
  for (let comp = 0; comp < k; comp++) {
    let v = Float64Array.from({ length: n }, (_, i) => 1 + i * 0.01);
    let lambda = 0;
    for (let iter = 0; iter < 200; iter++) {
      const next = new Float64Array(n);
      for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) next[i] += m[i][j] * v[j];
      const norm = Math.hypot(...next);
      if (norm < 1e-12) break;
      for (let i = 0; i < n; i++) next[i] /= norm;
      lambda = norm;
      v = next;
    }
    vectors.push(v);
    values.push(lambda);
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) m[i][j] -= lambda * v[i] * v[j];
  }
  return { vectors, values };
}

function correlation(a: Float32Array, b: Float32Array): number {
  let ma = 0;
  let mb = 0;
  for (let i = 0; i < a.length; i++) {
    ma += a[i];
    mb += b[i];
  }
  ma /= a.length;
  mb /= b.length;
  let cov = 0;
  for (let i = 0; i < a.length; i++) cov += (a[i] - ma) * (b[i] - mb);
  return cov;
}

function timbreSpace(mfcc: Matrix, voiced: Uint8Array, anchors: Float32Array[]): Float32Array[] {
  const dims = MFCC_COUNT - 1;
  const frames = mfcc.rows;
  const z = new Matrix(frames, dims);
  const mean = new Float64Array(dims);
  const std = new Float64Array(dims);
  let count = 0;
  for (let r = 0; r < frames; r++) {
    if (!voiced[r]) continue;
    count++;
    for (let d = 0; d < dims; d++) mean[d] += mfcc.data[r * MFCC_COUNT + d + 1];
  }
  const empty = (): Float32Array[] => [0, 1, 2].map(() => new Float32Array(frames));
  if (count < 2) return empty();
  for (let d = 0; d < dims; d++) mean[d] /= count;
  for (let r = 0; r < frames; r++) {
    if (!voiced[r]) continue;
    for (let d = 0; d < dims; d++) std[d] += (mfcc.data[r * MFCC_COUNT + d + 1] - mean[d]) ** 2;
  }
  for (let d = 0; d < dims; d++) std[d] = Math.sqrt(std[d] / count) || 1;
  for (let r = 0; r < frames; r++) {
    if (!voiced[r]) continue;
    for (let d = 0; d < dims; d++) z.data[r * dims + d] = (mfcc.data[r * MFCC_COUNT + d + 1] - mean[d]) / std[d];
  }
  const cov = Array.from({ length: dims }, () => new Float64Array(dims));
  for (let r = 0; r < frames; r++) {
    if (!voiced[r]) continue;
    const row = z.row(r);
    for (let i = 0; i < dims; i++) for (let j = 0; j < dims; j++) cov[i][j] += row[i] * row[j];
  }
  for (const row of cov) for (let j = 0; j < dims; j++) row[j] /= count;
  const { vectors, values } = principalComponents(cov, 3);
  return vectors.map((v, k) => {
    const scale = 1 / (2.5 * Math.sqrt(values[k] || 1));
    const out = new Float32Array(frames);
    for (let r = 0; r < frames; r++) {
      if (!voiced[r]) continue;
      let p = 0;
      for (let d = 0; d < dims; d++) p += z.data[r * dims + d] * v[d];
      out[r] = p * scale;
    }
    // Fix the arbitrary eigenvector sign so X tracks brightness, Y noisiness, Z loudness across songs.
    const sign = correlation(out, anchors[k]) < 0 ? -1 : 1;
    const smoothed = smooth(out, 2);
    for (let r = 0; r < frames; r++) smoothed[r] = Math.max(-1, Math.min(1, smoothed[r] * sign));
    return smoothed;
  });
}

function noveltyCurve(features: Matrix, fps: number): Float32Array {
  const block = Math.max(1, Math.round(fps / 10));
  const blocks = Math.ceil(features.rows / block);
  const dims = features.cols;
  const pooled = new Matrix(blocks, dims);
  for (let r = 0; r < features.rows; r++) {
    const b = Math.floor(r / block);
    for (let d = 0; d < dims; d++) pooled.data[b * dims + d] += features.data[r * dims + d] / block;
  }
  const half = Math.round((3 * fps) / block);
  const prefix = new Float64Array((blocks + 1) * dims);
  for (let b = 0; b < blocks; b++) for (let d = 0; d < dims; d++) prefix[(b + 1) * dims + d] = prefix[b * dims + d] + pooled.data[b * dims + d];
  const meanOf = (a: number, z: number, d: number): number => (prefix[z * dims + d] - prefix[a * dims + d]) / Math.max(1, z - a);
  const novelty = new Float32Array(blocks);
  for (let b = 1; b < blocks; b++) {
    const a = Math.max(0, b - half);
    const z = Math.min(blocks, b + half);
    let sum = 0;
    for (let d = 0; d < dims; d++) sum += (meanOf(a, b, d) - meanOf(b, z, d)) ** 2;
    // Fade in from the edges so the song start and end don't read as section changes.
    const edge = Math.min(b - a, z - b) / half;
    novelty[b] = Math.sqrt(sum) * edge;
  }
  const out = new Float32Array(features.rows);
  for (let r = 0; r < features.rows; r++) {
    const pos = r / block;
    const i = Math.min(blocks - 1, Math.floor(pos));
    const j = Math.min(blocks - 1, i + 1);
    out[r] = novelty[i] + (novelty[j] - novelty[i]) * (pos - i);
  }
  return out;
}

export function analyzeTrack(left: Float32Array, right: Float32Array | null, sampleRate: number, onProgress?: ProgressCallback): TrackAnalysis {
  const length = left.length;
  const fps = sampleRate / HOP;
  const frames = Math.floor(length / HOP) + 1;
  const analyzer = new FrameAnalyzer(sampleRate);
  const centers = melCenters(sampleRate);

  const power = new Matrix(frames, MEL_BANDS);
  const mfcc = new Matrix(frames, MFCC_COUNT);
  const chroma = new Matrix(frames, 12);
  const rms = new Float32Array(frames);
  const centroid = new Float32Array(frames);
  const flatness = new Float32Array(frames);
  const crackTonal = new Float32Array(frames);
  const width = new Float32Array(frames);
  const salience = new MelodySalience(sampleRate);
  const candMidi = new Float32Array(frames * MELODY_CANDIDATES);
  const candSal = new Float32Array(frames * MELODY_CANDIDATES);
  const clarity = new Float32Array(frames);
  const buf = new Float32Array(FFT_SIZE);

  for (let f = 0; f < frames; f++) {
    const start = f * HOP - FFT_SIZE / 2;
    let mid2 = 0;
    let side2 = 0;
    for (let i = 0; i < FFT_SIZE; i++) {
      const s = start + i;
      if (s < 0 || s >= length) {
        buf[i] = 0;
        continue;
      }
      const l = left[s];
      const r = right ? right[s] : l;
      const m = 0.5 * (l + r);
      const sd = 0.5 * (l - r);
      buf[i] = m;
      mid2 += m * m;
      side2 += sd * sd;
    }
    analyzer.process(buf);
    power.row(f).set(analyzer.melPower);
    mfcc.row(f).set(analyzer.mfcc);
    chroma.row(f).set(analyzer.chroma);
    rms[f] = analyzer.rms;
    centroid[f] = analyzer.centroid;
    flatness[f] = analyzer.flatness;
    crackTonal[f] = analyzer.crackTonal;
    width[f] = mid2 > 1e-9 ? Math.min(1, Math.sqrt(side2 / mid2)) : 0;
    salience.process(analyzer.magnitude);
    candMidi.set(salience.candMidi, f * MELODY_CANDIDATES);
    candSal.set(salience.candSalience, f * MELODY_CANDIDATES);
    clarity[f] = salience.clarity;
    if (onProgress && f % 2000 === 0) onProgress((0.7 * f) / frames);
  }

  const { percussive, harmonic } = hpss(power);
  onProgress?.(0.8);

  const refs = new Float32Array(MEL_BANDS);
  for (let c = 0; c < MEL_BANDS; c++) refs[c] = percentile(power.column(c), 99);
  // Floor each band's reference relative to the loudest band so near-silent bands aren't amplified into noise.
  const refFloor = Math.max(EPS, Math.max(...refs) * REF_FLOOR);
  for (let c = 0; c < MEL_BANDS; c++) refs[c] = Math.max(refs[c], refFloor);
  const cFull = compress(power, refs);
  const cPerc = compress(percussive, refs);

  const kickOdf = bandFlux(cPerc, bandIndices(centers, KICK));
  const snareOdf = bandFlux(cPerc, bandIndices(centers, SNARE_CRACK));
  const hatBands = bandIndices(centers, HAT);
  const crackBands = bandIndices(centers, SNARE_CRACK);
  const hatRise = bandFlux(percussive, hatBands);
  const crackRise = bandFlux(percussive, crackBands);
  const hatFlux = bandFlux(cPerc, hatBands);
  const hatOdf = Float32Array.from(hatFlux, (h, i) => h * hatGate(hatRise[i], crackRise[i]));
  const onsetOdf = bandFlux(cFull, centers.map((_, i) => i));

  const events = {} as Record<EventKind, EventTrack>;
  events.kick = detect(kickOdf, fps, DETECTORS.kick);
  events.snare = gateSnares(detect(snareOdf, fps, DETECTORS.snare), crackTonal, fps);
  events.hat = detect(hatOdf, fps, DETECTORS.hat);
  events.onset = detect(onsetOdf, fps, DETECTORS.onset);
  const drums = [events.kick.times, events.snare.times, events.hat.times];
  const noteIdx = Array.from(events.onset.times.keys()).filter((i) => !isNearAny(events.onset.times[i], drums, NOTE_DRUM_GUARD));
  events.note = { times: Float32Array.from(noteIdx, (i) => events.onset.times[i]), strengths: Float32Array.from(noteIdx, (i) => events.onset.strengths[i]) };
  const noteOdf = Float32Array.from(onsetOdf, (v, f) => (isNearAny(f / fps, drums, NOTE_DRUM_GUARD) ? 0 : v));

  // Equal-weight the drum detectors so a loud backbeat snare doesn't pull the tempo to half time.
  const pulse = new Float32Array(frames);
  for (const odf of [kickOdf, snareOdf, hatOdf, onsetOdf]) {
    const ref = percentile(odf, 99) || 1;
    for (let f = 0; f < frames; f++) pulse[f] += Math.min(1.5, odf[f] / ref);
  }
  const tempo = estimateTempo(pulse, fps);
  const beatFrames = trackBeats(pulse, fps, tempo);
  const pulseRef = percentile(pulse, 99) || 1;
  events.beat = {
    times: Float32Array.from(beatFrames, (b) => b / fps),
    strengths: Float32Array.from(beatFrames, (b) => Math.min(1, pulse[b] / pulseRef)),
  };
  const kickNear = beatFrames.map((b) => {
    let m = 0;
    for (let i = Math.max(0, b - 3); i <= Math.min(frames - 1, b + 3); i++) m = Math.max(m, kickOdf[i]);
    return m;
  });
  const downOffset = pickDownbeat(kickNear);
  const downFrames = beatFrames.filter((_, i) => i % 4 === downOffset);
  events.downbeat = {
    times: Float32Array.from(downFrames, (b) => b / fps),
    strengths: Float32Array.from(downFrames, () => 1),
  };
  onProgress?.(0.85);

  const scalars = {} as Record<ScalarName, Float32Array>;
  const loudDb = Float32Array.from(rms, (r) => 20 * Math.log10(r + 1e-6));
  const release = (seconds: number): number => retain(seconds, fps);
  scalars.loudness = followEnvelope(normalizeRange(Float32Array.from(loudDb), 5, 99.5), 0, release(0.1));
  scalars.intensity = normalizeRange(movingMean(loudDb, Math.round(1.5 * fps), Math.round(1.5 * fps)), 5, 99);

  for (const [name, range] of Object.entries(BANDS) as [keyof typeof BANDS, Range][]) {
    const idx = bandIndices(centers, range);
    const db = new Float32Array(frames);
    for (let f = 0; f < frames; f++) {
      let p = 0;
      for (const c of idx) p += power.data[f * MEL_BANDS + c];
      db[f] = toDb(p / idx.length);
    }
    scalars[name] = followEnvelope(normalizeRange(db, 3, 99.5), 0, release(0.08));
  }

  const sumRows = (m: Matrix): Float32Array => {
    const out = new Float32Array(m.rows);
    for (let r = 0; r < m.rows; r++) {
      let s = 0;
      for (let c = 0; c < m.cols; c++) s += m.data[r * m.cols + c];
      out[r] = toDb(s);
    }
    return out;
  };
  scalars.percussive = followEnvelope(normalizeRange(sumRows(percussive), 5, 99.5), 0, release(0.06));
  scalars.harmonic = smooth(normalizeRange(sumRows(harmonic), 5, 99.5), 6);

  const voiced = Uint8Array.from(scalars.loudness, (l, i) => (l > 0.02 && rms[i] > 1e-4 ? 1 : 0));
  scalars.brightness = smooth(
    normalizeRange(
      Float32Array.from(centroid, (c) => Math.log2(Math.max(c, 50))),
      2,
      98,
    ),
    2,
  );
  scalars.noisiness = smooth(normalizeRange(Float32Array.from(flatness), 2, 98), 2);
  const peakiness = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    const row = chroma.row(f);
    let sum = 0;
    for (const v of row) sum += v;
    peakiness[f] = sum > 0 ? ((1 / sum - 1 / 12) / (1 - 1 / 12)) * (1 - flatness[f]) : 0;
  }
  scalars.tonalness = smooth(normalizeRange(peakiness, 2, 98), 4);
  scalars.width = smooth(width, 3);

  const hueX = new Float32Array(frames);
  const hueY = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    const row = chroma.row(f);
    let x = 0;
    let y = 0;
    let sum = 0;
    for (let k = 0; k < 12; k++) {
      const theta = (2 * Math.PI * ((7 * k) % 12)) / 12;
      x += row[k] * Math.cos(theta);
      y += row[k] * Math.sin(theta);
      sum += row[k];
    }
    hueX[f] = sum > 0 ? x / sum : 0;
    hueY[f] = sum > 0 ? y / sum : 0;
  }
  const hueRadius = Math.round(0.25 * fps);
  scalars.hueX = smooth(hueX, hueRadius);
  scalars.hueY = smooth(hueY, hueRadius);

  [scalars.timbreX, scalars.timbreY, scalars.timbreZ] = timbreSpace(mfcc, voiced, [scalars.brightness, scalars.noisiness, scalars.loudness]);
  const harmonicShare = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    let h = 0;
    let all = 0;
    for (let c = 0; c < MEL_BANDS; c++) {
      h += harmonic.data[f * MEL_BANDS + c];
      all += power.data[f * MEL_BANDS + c];
    }
    harmonicShare[f] = all > EPS ? h / all : 0;
  }
  const melody = trackMelody(candMidi, candSal, clarity, harmonicShare, voiced, fps);
  scalars.melody = melody.melody;
  scalars.pitch = melody.pitch;
  scalars.voice = melody.voice;
  onProgress?.(0.9);

  const noveltyFeatures = new Matrix(frames, 3 + 12 + 1);
  for (let f = 0; f < frames; f++) {
    const row = noveltyFeatures.row(f);
    row[0] = scalars.timbreX[f] * 2;
    row[1] = scalars.timbreY[f] * 2;
    row[2] = scalars.timbreZ[f] * 2;
    row.set(chroma.row(f), 3);
    row[15] = scalars.intensity[f] * 2;
  }
  const novelty = noveltyCurve(noveltyFeatures, fps);
  normalizeRange(novelty, 0, 99.5);
  scalars.novelty = novelty;
  const sectionPeaks = peakPick(novelty, {
    preMax: Math.round(2 * fps),
    postMax: Math.round(2 * fps),
    preAvg: Math.round(4 * fps),
    postAvg: Math.round(4 * fps),
    delta: 0.08,
    floor: 0.45,
    minGap: Math.round(8 * fps),
  });
  events.section = {
    times: Float32Array.from(sectionPeaks, (p) => p / fps),
    strengths: Float32Array.from(sectionPeaks, (p) => novelty[p]),
  };
  const { drops, build } = findDrops({ loudness: scalars.loudness, bass: scalars.bass, percussive: scalars.percussive, fps, downbeats: events.downbeat.times });
  events.drop = drops;
  scalars.build = build;
  const cast = findCast({
    features: harmonicMfcc(harmonic.data, frames),
    dims: MFCC_COUNT - 1,
    voiced,
    fps,
    describe: { brightness: scalars.brightness, noisiness: scalars.noisiness, tonalness: scalars.tonalness, voice: scalars.voice },
  });
  const key = estimateKey(chroma.data, scalars.tonalness);

  const mel = new Float32Array(frames * MEL_BANDS);
  for (let c = 0; c < MEL_BANDS; c++) {
    const col = Float32Array.from(power.column(c), toDb);
    normalizeRange(col, 5, 99.5);
    for (let f = 0; f < frames; f++) mel[f * MEL_BANDS + c] = col[f];
  }
  const chromaSmooth = new Float32Array(frames * 12);
  for (let k = 0; k < 12; k++) {
    const col = smooth(chroma.column(k), 3);
    for (let f = 0; f < frames; f++) chromaSmooth[f * 12 + k] = col[f];
  }

  for (const name of SCALAR_NAMES) if (!scalars[name]) throw new TypeError(`scalar ${name} was not computed`);
  for (const kind of EVENT_KINDS) if (!events[kind]) throw new TypeError(`event ${kind} was not computed`);
  onProgress?.(1);

  const odfs = { kick: kickOdf, snare: snareOdf, hat: hatOdf, onset: onsetOdf, note: noteOdf };
  const debug = { hatFlux, pulse, melodyMidi: melody.midi, clarity };
  return { sampleRate, fps, frames, duration: length / sampleRate, tempo, scalars, mel, chroma: chromaSmooth, events, cast, key, odfs, debug };
}
