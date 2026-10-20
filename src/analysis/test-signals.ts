/** Deterministic synthetic audio used by the analysis tests. */

export const SR = 44100;

export function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function sine(freq: number, seconds: number, amp = 0.5, sr = SR): Float32Array {
  return Float32Array.from({ length: Math.round(seconds * sr) }, (_, i) => amp * Math.sin((2 * Math.PI * freq * i) / sr));
}

export function noise(seconds: number, amp = 0.5, seed = 1, sr = SR): Float32Array {
  const r = rng(seed);
  return Float32Array.from({ length: Math.round(seconds * sr) }, () => amp * (r() * 2 - 1));
}

function addAt(target: Float32Array, source: Float32Array, start: number, gain = 1): void {
  for (let i = 0; i < source.length && start + i < target.length; i++) target[start + i] += source[i] * gain;
}

export function kick(sr = SR): Float32Array {
  const n = Math.round(0.35 * sr);
  const out = new Float32Array(n);
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const freq = 45 + 90 * Math.exp(-t / 0.04);
    phase += (2 * Math.PI * freq) / sr;
    out[i] = 0.9 * Math.sin(phase) * Math.exp(-t / 0.12);
  }
  return out;
}

function highpass(signal: Float32Array, passes: number): Float32Array {
  let out = signal;
  for (let p = 0; p < passes; p++) {
    const next = new Float32Array(out.length);
    for (let i = 1; i < out.length; i++) next[i] = 0.5 * (out[i] - out[i - 1]);
    out = next;
  }
  return out;
}

function lowpass(signal: Float32Array, cutoff: number, passes: number, sr: number): Float32Array {
  const a = 1 - Math.exp((-2 * Math.PI * cutoff) / sr);
  let out = signal;
  for (let p = 0; p < passes; p++) {
    const next = new Float32Array(out.length);
    let y = 0;
    for (let i = 0; i < out.length; i++) next[i] = y += a * (out[i] - y);
    out = next;
  }
  return out;
}

/** Tone body plus wire noise band-limited to roughly 1–5 kHz, like a real snare's spectrum. */
export function snare(seed = 2, sr = SR): Float32Array {
  const n = Math.round(0.25 * sr);
  const body = new Float32Array(n);
  const r = rng(seed);
  const hiss = lowpass(highpass(Float32Array.from({ length: n }, () => r() * 2 - 1), 1), 5000, 2, sr);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    body[i] = 0.4 * Math.sin(2 * Math.PI * 190 * t) * Math.exp(-t / 0.06) + 1.2 * hiss[i] * Math.exp(-t / 0.09);
  }
  return body;
}

export function hat(seed = 3, sr = SR): Float32Array {
  const n = Math.round(0.08 * sr);
  const r = rng(seed);
  const hiss = highpass(Float32Array.from({ length: n }, () => r() * 2 - 1), 3);
  for (let i = 0; i < n; i++) hiss[i] *= 1.5 * Math.exp(-i / sr / 0.02);
  return hiss;
}

/** Quiet sustained A-minor saw pad so the drum detectors have to ignore tonal content. */
export function pad(seconds: number, amp = 0.08, sr = SR): Float32Array {
  const n = Math.round(seconds * sr);
  const out = new Float32Array(n);
  for (const f of [220, 261.63, 329.63]) {
    for (let i = 0; i < n; i++) {
      const x = (f * i) / sr;
      out[i] += amp * 2 * (x - Math.floor(x + 0.5));
    }
  }
  return out;
}

/** A legato melody of harmonic tones (no drums) over a quiet pad; returns note start times. */
export function melody(seconds: number, noteSeconds = 0.4, sr = SR): { audio: Float32Array; notes: number[] } {
  const audio = pad(seconds, 0.03, sr);
  const scale = [261.63, 293.66, 329.63, 392.0, 440.0, 523.25, 392.0, 329.63];
  const notes: number[] = [];
  for (let i = 0; 0.5 + (i + 1) * noteSeconds < seconds; i++) {
    const start = 0.5 + i * noteSeconds;
    notes.push(start);
    const f = scale[i % scale.length];
    const s0 = Math.round(start * sr);
    const n = Math.round(noteSeconds * sr);
    for (let k = 0; k < n && s0 + k < audio.length; k++) {
      const t = k / sr;
      const env = Math.min(1, t / 0.015) * Math.exp(-t / 0.6) * Math.min(1, (noteSeconds - t) / 0.02);
      let v = 0;
      for (let h = 1; h <= 4; h++) v += Math.sin(2 * Math.PI * f * h * t) / h;
      audio[s0 + k] += 0.25 * env * v;
    }
  }
  return { audio, notes };
}

export interface SungNote {
  start: number;
  end: number;
  midi: number;
}

/** Ten harmonics under a vowel-like formant bump near 800 Hz. */
export function voiced(f0: number, seconds: number, amp = 0.3, sr = SR): Float32Array {
  return sung(seconds, { notes: [f0ToMidi(f0)], noteSeconds: seconds, start: 0, amp, pad: false, sr }).audio;
}

const f0ToMidi = (f: number): number => 69 + 12 * Math.log2(f / 440);
const midiToHz = (m: number): number => 440 * 2 ** ((m - 69) / 12);

/**
 * A voice-like line: legato notes of ten harmonics under a vowel formant, with optional
 * vibrato (± semitones at 5.5 Hz). A3 C4 D4 E4 G4 A4 G4 E4 by default.
 */
export function sung(
  seconds: number,
  { vibrato = 0, noteSeconds = 0.5, start = 0.5, amp = 0.3, pad: withPad = true, notes: scale = [57, 60, 62, 64, 67, 69, 67, 64], sr = SR } = {},
): { audio: Float32Array; notes: SungNote[] } {
  const audio = withPad ? pad(seconds, 0.02, sr) : new Float32Array(Math.round(seconds * sr));
  const notes: SungNote[] = [];
  for (let i = 0; start + (i + 1) * noteSeconds <= seconds + 1e-9; i++) notes.push({ start: start + i * noteSeconds, end: start + (i + 1) * noteSeconds, midi: scale[i % scale.length] });
  let phase = 0;
  for (const note of notes) {
    const s0 = Math.round(note.start * sr);
    const n = Math.round((note.end - note.start) * sr);
    for (let k = 0; k < n && s0 + k < audio.length; k++) {
      const t = (s0 + k) / sr;
      const f = midiToHz(note.midi + vibrato * Math.sin(2 * Math.PI * 5.5 * t));
      phase += (2 * Math.PI * f) / sr;
      const edge = Math.min(1, k / (0.01 * sr), (n - k) / (0.01 * sr));
      let v = 0;
      for (let h = 1; h <= 10; h++) {
        const fh = f * h;
        v += (Math.sin(phase * h) / h) * (1 + 2 * Math.exp(-(((fh - 800) / 300) ** 2)));
      }
      audio[s0 + k] += amp * 0.4 * edge * v;
    }
  }
  return { audio, notes };
}

/**
 * Struck notes like a piano: a click of hammer noise, then rich slightly-stretched
 * harmonics that decay. Sharp 1–5 kHz attacks, but tonal ones; returns note start times.
 */
export function piano(seconds: number, noteSeconds = 0.5, sr = SR): { audio: Float32Array; notes: number[] } {
  const audio = pad(seconds, 0.03, sr);
  const chords = [
    [261.63, 329.63, 392.0],
    [220.0, 261.63, 329.63],
    [349.23, 440.0, 523.25],
    [392.0, 493.88, 587.33],
  ];
  const r = rng(7);
  const notes: number[] = [];
  for (let i = 0; 0.5 + (i + 1) * noteSeconds < seconds; i++) {
    const start = 0.5 + i * noteSeconds;
    notes.push(start);
    const s0 = Math.round(start * sr);
    const n = Math.round(1.2 * sr);
    for (const f of chords[i % chords.length]) {
      for (let h = 1; h <= 16; h++) {
        const fh = 2 * f * h * Math.sqrt(1 + 0.0004 * h * h);
        if (fh > 8000) break;
        const amp = (0.12 / h ** 0.7) * (1 + (h % 3 === 0 ? 0.3 : 0));
        const decay = 0.9 / (1 + 0.25 * h);
        for (let k = 0; k < n && s0 + k < audio.length; k++) {
          const t = k / sr;
          audio[s0 + k] += amp * Math.min(1, t / 0.006) * Math.exp(-t / decay) * Math.sin(2 * Math.PI * fh * t);
        }
      }
    }
    for (let k = 0; k < 0.004 * sr; k++) audio[s0 + k] += 0.04 * (r() * 2 - 1) * Math.exp(-k / sr / 0.001);
  }
  return { audio, notes };
}

export interface DrumPattern {
  audio: Float32Array;
  kicks: number[];
  snares: number[];
  hats: number[];
  beats: number[];
}

/** Four-on-the-floor: kick every beat, snare on 2 and 4, hats on the off-beat eighths. */
export function drumPattern(bpm: number, seconds: number, withPad = true, sr = SR): DrumPattern {
  const audio = withPad ? pad(seconds, 0.08, sr) : new Float32Array(Math.round(seconds * sr));
  const beat = 60 / bpm;
  const start = 0.5;
  const out: DrumPattern = { audio, kicks: [], snares: [], hats: [], beats: [] };
  const k = kick(sr);
  const s = snare(2, sr);
  for (let i = 0; start + i * beat < seconds - 0.4; i++) {
    const t = start + i * beat;
    out.beats.push(t);
    out.kicks.push(t);
    addAt(audio, k, Math.round(t * sr));
    if (i % 2 === 1) {
      out.snares.push(t);
      addAt(audio, s, Math.round(t * sr));
    }
    const off = t + beat / 2;
    out.hats.push(off);
    addAt(audio, hat(3 + i, sr), Math.round(off * sr));
  }
  return out;
}

/** Fraction of `truth` times matched by some detected time within `tolerance` seconds. */
export function recall(detected: ArrayLike<number>, truth: number[], tolerance: number): number {
  if (truth.length === 0) return 1;
  let hits = 0;
  for (const t of truth) {
    for (let i = 0; i < detected.length; i++) {
      if (Math.abs(detected[i] - t) <= tolerance) {
        hits++;
        break;
      }
    }
  }
  return hits / truth.length;
}

/** Fraction of detected times that land within `tolerance` of some truth time. */
export function precision(detected: ArrayLike<number>, truth: number[], tolerance: number): number {
  if (detected.length === 0) return 1;
  let good = 0;
  for (let i = 0; i < detected.length; i++) {
    if (truth.some((t) => Math.abs(detected[i] - t) <= tolerance)) good++;
  }
  return good / detected.length;
}
