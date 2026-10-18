import { describe, expect, it } from "vitest";
import { analyzeTrack } from "./track.ts";
import type { TrackAnalysis } from "./types.ts";
import { drumPattern, melody, noise, pad, precision, recall, SR, sine } from "./test-signals.ts";

const TOL = 0.035;
const cache = new Map<string, TrackAnalysis>();

function analyzed(bpm: number, withPad: boolean): { a: TrackAnalysis; truth: ReturnType<typeof drumPattern> } {
  const truth = drumPattern(bpm, 12, withPad);
  const key = `${bpm}-${withPad}`;
  if (!cache.has(key)) cache.set(key, analyzeTrack(truth.audio, null, SR));
  return { a: cache.get(key)!, truth };
}

describe("analyzeTrack drum detection", () => {
  it.each([
    [124, true],
    [140, false],
  ])("finds kicks, snares and hats at %i BPM (pad: %s)", (bpm, withPad) => {
    const { a, truth } = analyzed(bpm, withPad);
    const kick = Array.from(a.events.kick.times);
    const snare = Array.from(a.events.snare.times);
    const hat = Array.from(a.events.hat.times);
    expect(recall(kick, truth.kicks, TOL)).toBeGreaterThan(0.9);
    expect(precision(kick, truth.kicks, TOL)).toBeGreaterThan(0.9);
    expect(recall(snare, truth.snares, TOL)).toBeGreaterThan(0.9);
    expect(precision(snare, truth.snares, TOL)).toBeGreaterThan(0.85);
    expect(recall(hat, truth.hats, TOL)).toBeGreaterThan(0.9);
    expect(precision(hat, truth.hats, TOL)).toBeGreaterThan(0.85);
  });

  it("finds the tempo and beats", () => {
    const { a, truth } = analyzed(124, true);
    expect(a.tempo).toBeCloseTo(124, -0.5);
    expect(recall(a.events.beat.times, truth.beats, 0.05)).toBeGreaterThan(0.85);
  });

  it("puts downbeats on every fourth beat", () => {
    const { a } = analyzed(124, true);
    const beats = Array.from(a.events.beat.times);
    const downs = Array.from(a.events.downbeat.times);
    expect(downs.length).toBeGreaterThan(0);
    const idx = downs.map((d) => beats.indexOf(d));
    for (let i = 1; i < idx.length; i++) expect(idx[i] - idx[i - 1]).toBe(4);
  });

  it("detects no drums in a sustained pad", () => {
    const a = analyzeTrack(pad(8, 0.2), null, SR);
    expect(a.events.kick.times.length).toBeLessThanOrEqual(1);
    expect(a.events.snare.times.length).toBeLessThanOrEqual(1);
    expect(a.events.hat.times.length).toBeLessThanOrEqual(1);
  });
});

describe("analyzeTrack notes", () => {
  it("finds the onsets of a drumless melody", () => {
    const { audio, notes } = melody(8);
    const a = analyzeTrack(audio, null, SR);
    const found = Array.from(a.events.note.times);
    expect(recall(found, notes, TOL)).toBeGreaterThan(0.85);
    expect(precision(found, notes, TOL)).toBeGreaterThan(0.85);
  });

  it("does not mistake drum hits for notes", () => {
    const { a } = analyzed(124, false);
    expect(a.events.note.times.length).toBeLessThanOrEqual(3);
  });
});

describe("analyzeTrack timbre", () => {
  const tone = sine(300, 6, 0.3);
  const hiss = noise(6, 0.3, 9);
  const audio = new Float32Array(tone.length + hiss.length);
  audio.set(tone);
  audio.set(hiss, tone.length);
  const a = analyzeTrack(audio, null, SR);
  const at = (name: keyof TrackAnalysis["scalars"], t: number): number => a.scalars[name][Math.round(t * a.fps)];

  it("marks a section change where the instrument switches", () => {
    const sections = Array.from(a.events.section.times);
    expect(sections.some((t) => Math.abs(t - 6) < 0.6)).toBe(true);
  });

  it("moves the timbre coordinate between the two instruments", () => {
    const d = Math.hypot(at("timbreX", 3) - at("timbreX", 9), at("timbreY", 3) - at("timbreY", 9), at("timbreZ", 3) - at("timbreZ", 9));
    expect(d).toBeGreaterThan(0.5);
  });

  it("reads the noise as brighter, noisier and less tonal", () => {
    expect(at("brightness", 9)).toBeGreaterThan(at("brightness", 3));
    expect(at("noisiness", 9)).toBeGreaterThan(at("noisiness", 3));
    expect(at("tonalness", 3)).toBeGreaterThan(at("tonalness", 9));
  });

  it("keeps every scalar finite and in range", () => {
    for (const [name, data] of Object.entries(a.scalars)) {
      const signed = name.startsWith("timbre") || name.startsWith("hue");
      for (const v of data) {
        expect(Number.isFinite(v)).toBe(true);
        expect(v).toBeGreaterThanOrEqual(signed ? -1 : 0);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe("analyzeTrack stereo", () => {
  it("reports width for decorrelated channels and none for mono", () => {
    const left = noise(3, 0.3, 1);
    const right = noise(3, 0.3, 2);
    const wide = analyzeTrack(left, right, SR);
    const mono = analyzeTrack(left, left, SR);
    const mid = Math.round(1.5 * wide.fps);
    expect(wide.scalars.width[mid]).toBeGreaterThan(0.5);
    expect(mono.scalars.width[mid]).toBeLessThan(0.05);
  });
});
