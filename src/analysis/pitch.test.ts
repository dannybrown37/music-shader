import { describe, expect, it } from "vitest";
import { FFT_SIZE, FrameAnalyzer } from "./frame.ts";
import { LiveAnalyzer } from "./live.ts";
import { MelodySalience, melodyPath, vibratoDepth } from "./pitch.ts";
import { createFeatures } from "./sampler.ts";
import { analyzeTrack } from "./track.ts";
import { EVENT_KINDS } from "./types.ts";
import type { EventKind, TrackAnalysis } from "./types.ts";
import { drumPattern, noise, piano, SR, sung, voiced } from "./test-signals.ts";
import type { SungNote } from "./test-signals.ts";

const midiOf = (hz: number): number => 69 + 12 * Math.log2(hz / 440);

function salienceOf(audio: Float32Array): MelodySalience {
  const frame = new FrameAnalyzer(SR);
  const sal = new MelodySalience(SR);
  frame.process(audio.subarray(audio.length - FFT_SIZE));
  sal.process(frame.magnitude);
  return sal;
}

describe("MelodySalience", () => {
  it.each([110, 147, 196, 262, 330, 440, 587, 880])("puts a %i Hz voice at the top candidate", (hz) => {
    const sal = salienceOf(voiced(hz, 0.2));
    expect(sal.candMidi[0]).toBeCloseTo(midiOf(hz), 0);
    expect(Math.abs(sal.candMidi[0] - midiOf(hz))).toBeLessThan(0.25);
  });

  it.each([
    ["a pitched voice", voiced(220, 0.2), 0.5, 1],
    ["white noise", noise(0.2, 0.3, 4), 0, 0.3],
    ["silence", new Float32Array(FFT_SIZE * 2), 0, 0],
  ] as const)("rates the clarity of %s", (_, audio, lo, hi) => {
    const sal = salienceOf(audio);
    expect(sal.clarity).toBeGreaterThanOrEqual(lo);
    expect(sal.clarity).toBeLessThanOrEqual(hi);
  });

  it("sorts candidates by salience, best first, relative to the best", () => {
    const sal = salienceOf(voiced(330, 0.2));
    expect(sal.candSalience[0]).toBe(1);
    for (let k = 1; k < sal.candSalience.length; k++) expect(sal.candSalience[k]).toBeLessThanOrEqual(sal.candSalience[k - 1]);
  });
});

describe("melodyPath", () => {
  it("follows the strongest line and ignores a one-frame octave flicker", () => {
    const frames = 40;
    const k = 2;
    const midi = new Float32Array(frames * k);
    const sal = new Float32Array(frames * k);
    for (let f = 0; f < frames; f++) {
      const flicker = f === 20;
      midi.set([flicker ? 72 : 60, flicker ? 60 : 72], f * k);
      sal.set([1, flicker ? 0.3 : 0.5], f * k);
    }
    const path = melodyPath(midi, sal, frames, k);
    expect(Array.from(path).every((m) => m === 60)).toBe(true);
  });

  it("holds one of two close candidates instead of flipping between them every frame", () => {
    const frames = 40;
    const k = 2;
    const midi = new Float32Array(frames * k);
    const sal = new Float32Array(frames * k);
    for (let f = 0; f < frames; f++) {
      midi.set(f % 2 ? [60, 59] : [59, 60], f * k);
      sal.set([1, 0.8], f * k);
    }
    const path = melodyPath(midi, sal, frames, k);
    expect(new Set(Array.from(path.slice(1))).size).toBe(1);
  });

  it("switches when the other line stays stronger", () => {
    const frames = 40;
    const k = 2;
    const midi = new Float32Array(frames * k);
    const sal = new Float32Array(frames * k);
    for (let f = 0; f < frames; f++) {
      midi.set([60, 64], f * k);
      sal.set(f < 20 ? [1, 0.4] : [0.4, 1], f * k);
    }
    const path = melodyPath(midi, sal, frames, k);
    expect(path[5]).toBe(60);
    expect(path[35]).toBe(64);
  });
});

describe("vibratoDepth", () => {
  const fps = 86;
  const line = (depth: number, rate: number): Float32Array => Float32Array.from({ length: 200 }, (_, i) => 60 + (i >= 100 ? 2 : 0) + depth * Math.sin((2 * Math.PI * rate * i) / fps));
  const sure = new Float32Array(200).fill(1);

  it.each([
    ["steady notes with a step", 0, 5.5, 0, 0.05],
    ["half-semitone vibrato", 0.5, 5.5, 0.2, 0.6],
    ["21 Hz jitter from beating partials", 0.45, 21.5, 0, 0.08],
  ] as const)("measures %s", (_, vib, rate, lo, hi) => {
    const depth = vibratoDepth(line(vib, rate), sure, fps);
    const mid = depth.slice(30, 170);
    const mean = mid.reduce((a, b) => a + b, 0) / mid.length;
    expect(mean).toBeGreaterThanOrEqual(lo);
    expect(mean).toBeLessThanOrEqual(hi);
  });
});

/** Mid-note frames (skipping 80 ms at each edge), with the note they belong to. */
function midNoteFrames(a: TrackAnalysis, notes: SungNote[]): { f: number; midi: number }[] {
  return notes.flatMap((n) => {
    const out: { f: number; midi: number }[] = [];
    for (let f = Math.ceil((n.start + 0.08) * a.fps); f < (n.end - 0.08) * a.fps; f++) out.push({ f, midi: n.midi });
    return out;
  });
}

const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);

describe("analyzeTrack melody", () => {
  const steady = sung(8);
  const wobbly = sung(8, { vibrato: 0.5 });
  const a = analyzeTrack(steady.audio, null, SR);
  const v = analyzeTrack(wobbly.audio, null, SR);

  it("is confident during a sung line", () => {
    expect(mean(midNoteFrames(a, steady.notes).map(({ f }) => a.scalars.melody[f]))).toBeGreaterThan(0.7);
  });

  it("raises pitch with the notes", () => {
    const frames = midNoteFrames(a, steady.notes);
    const at = (m: number): number => mean(frames.filter((x) => x.midi === m).map(({ f }) => a.scalars.pitch[f]));
    expect(at(57)).toBeLessThan(at(60));
    expect(at(60)).toBeLessThan(at(64));
    expect(at(64)).toBeLessThan(at(69));
    expect(at(57)).toBeGreaterThanOrEqual(0);
    expect(at(69)).toBeLessThanOrEqual(1);
  });

  it("tracks the sung pitch in semitones", () => {
    const frames = midNoteFrames(a, steady.notes);
    const good = frames.filter(({ f, midi }) => Math.abs(a.debug.melodyMidi[f] - midi) < 0.5);
    expect(good.length / frames.length).toBeGreaterThan(0.9);
  });

  it("hears vibrato as a voice and a steady line as not", () => {
    const voiceSteady = mean(midNoteFrames(a, steady.notes).map(({ f }) => a.scalars.voice[f]));
    const voiceWobbly = mean(midNoteFrames(v, wobbly.notes).map(({ f }) => v.scalars.voice[f]));
    expect(voiceSteady).toBeLessThan(0.2);
    expect(voiceWobbly).toBeGreaterThan(0.5);
  });

  it("still hears a sung line and its vibrato over drums", () => {
    const drums = drumPattern(124, 8, true).audio;
    const mix = Float32Array.from(wobbly.audio, (x, i) => x + 0.6 * (drums[i] ?? 0));
    const m = analyzeTrack(mix, null, SR);
    const frames = midNoteFrames(m, wobbly.notes);
    expect(mean(frames.map(({ f }) => m.scalars.melody[f]))).toBeGreaterThan(0.5);
    expect(mean(frames.map(({ f }) => m.scalars.voice[f]))).toBeGreaterThan(0.3);
    expect(frames.filter(({ f, midi }) => Math.abs(m.debug.melodyMidi[f] - midi) < 0.75).length / frames.length).toBeGreaterThan(0.8);
  });

  it("finds little melody in drums alone", () => {
    const d = analyzeTrack(drumPattern(124, 8, false).audio, null, SR);
    expect(mean(Array.from(d.scalars.melody))).toBeLessThan(0.25);
    expect(mean(Array.from(d.scalars.voice))).toBeLessThan(0.1);
  });

  it("does not call struck piano chords a voice", () => {
    const p = analyzeTrack(piano(8).audio, null, SR);
    expect(mean(Array.from(p.scalars.voice))).toBeLessThan(0.15);
  });
});

describe("LiveAnalyzer melody", () => {
  const CHUNK = 1024;
  const feedUntil = (audio: Float32Array, t: number): LiveAnalyzer => {
    const live = new LiveAnalyzer(SR);
    const end = Math.round(t * SR);
    for (let i = 0; i < end; i += CHUNK) live.push(audio.subarray(i, Math.min(end, i + CHUNK)), null);
    return live;
  };
  const probe = (audio: Float32Array, notes: SungNote[]): { midi: number[]; melody: number[]; voice: number[]; truth: number[] } => {
    const out = { midi: [] as number[], melody: [] as number[], voice: [] as number[], truth: [] as number[] };
    const f = createFeatures();
    const decays = Object.fromEntries(EVENT_KINDS.map((k) => [k, 0.1])) as Record<EventKind, number>;
    for (const n of notes.slice(2)) {
      const live = feedUntil(audio, n.end - 0.05);
      live.sample(live.time, f, decays);
      out.midi.push(live.melodyMidi);
      out.melody.push(f.scalars.melody);
      out.voice.push(f.scalars.voice);
      out.truth.push(n.midi);
    }
    return out;
  };

  it("follows a sung line causally", () => {
    const { audio, notes } = sung(6);
    const r = probe(audio, notes);
    r.midi.forEach((m, i) => expect(Math.abs(m - r.truth[i])).toBeLessThan(0.5));
    expect(mean(r.melody)).toBeGreaterThan(0.6);
    expect(mean(r.voice)).toBeLessThan(0.2);
  });

  it("hears vibrato as a voice", () => {
    const { audio, notes } = sung(6, { vibrato: 0.5 });
    expect(mean(probe(audio, notes).voice)).toBeGreaterThan(0.5);
  });
});
