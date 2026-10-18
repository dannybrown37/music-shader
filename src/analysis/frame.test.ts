import { describe, expect, it } from "vitest";
import { FrameAnalyzer, FFT_SIZE, MEL_BANDS } from "./frame.ts";
import { noise, SR, sine } from "./test-signals.ts";

const PITCH_CLASSES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

function harmonicTone(seconds: number): Float32Array {
  const out = new Float32Array(Math.round(seconds * SR));
  for (let h = 1; h <= 20; h++) {
    const part = sine(330 * h, seconds, 0.3 / h);
    for (let i = 0; i < out.length; i++) out[i] += part[i];
  }
  return out;
}

function analyzeSteady(signal: Float32Array): FrameAnalyzer {
  const analyzer = new FrameAnalyzer(SR);
  analyzer.process(signal.subarray(0, FFT_SIZE));
  return analyzer;
}

describe("FrameAnalyzer", () => {
  it.each([
    [440, "A"],
    [261.63, "C"],
    [196, "G"],
    [329.63, "E"],
    [880, "A"],
  ])("chroma of a %f Hz tone peaks at %s", (freq, name) => {
    const a = analyzeSteady(sine(freq, 0.2));
    const chroma = Array.from(a.chroma);
    expect(PITCH_CLASSES[chroma.indexOf(Math.max(...chroma))]).toBe(name);
  });

  it.each([
    ["a harmonic tone", harmonicTone(0.3), 0.8, 1],
    ["noise", noise(0.3), -0.3, 0.3],
  ])("crack tonality of %s is in [%f, %f]", (_, signal, lo, hi) => {
    const a = new FrameAnalyzer(SR);
    for (let f = 0; f < 4; f++) a.process(signal.subarray(f * 512, f * 512 + FFT_SIZE));
    expect(a.crackTonal).toBeGreaterThanOrEqual(lo);
    expect(a.crackTonal).toBeLessThanOrEqual(hi);
  });

  it("finds white noise brighter and flatter than a low tone", () => {
    const tone = analyzeSteady(sine(120, 0.2));
    const toneCentroid = tone.centroid;
    const toneFlatness = tone.flatness;
    const hiss = analyzeSteady(noise(0.2));
    expect(hiss.centroid).toBeGreaterThan(toneCentroid * 10);
    expect(hiss.flatness).toBeGreaterThan(0.5);
    expect(toneFlatness).toBeLessThan(0.1);
  });

  it("concentrates a low tone in the low mel bands", () => {
    const a = analyzeSteady(sine(60, 0.2));
    const mel = Array.from(a.melPower);
    expect(mel.indexOf(Math.max(...mel))).toBeLessThan(MEL_BANDS / 8);
  });

  it("reports rms of a full-scale sine near 0.707 of its amplitude", () => {
    const a = analyzeSteady(sine(1000, 0.2, 0.5));
    expect(a.rms).toBeCloseTo(0.5 / Math.SQRT2, 2);
  });

  it("produces silence features without NaN", () => {
    const a = analyzeSteady(new Float32Array(FFT_SIZE));
    for (const v of [a.rms, a.centroid, a.flatness, ...a.chroma, ...a.mfcc, ...a.logMel]) expect(Number.isFinite(v)).toBe(true);
  });
});
