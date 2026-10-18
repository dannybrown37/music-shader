import { describe, expect, it } from "vitest";
import { estimateTempo, pickDownbeat, trackBeats } from "./beats.ts";

const FPS = 86;

/** Impulse train onset envelope with optional off-beat hits at half strength. */
function clickEnvelope(bpm: number, seconds: number, offbeats: boolean): Float32Array {
  const env = new Float32Array(Math.round(seconds * FPS));
  const period = (60 / bpm) * FPS;
  for (let b = 0; 0.5 * FPS + b * period < env.length; b++) {
    const i = Math.round(0.5 * FPS + b * period);
    env[i] = 1;
    const off = Math.round(0.5 * FPS + (b + 0.5) * period);
    if (offbeats && off < env.length) env[off] = 0.5;
  }
  return env;
}

describe("estimateTempo", () => {
  it.each([
    [90, false],
    [100, true],
    [120, true],
    [128, true],
    [140, true],
    [160, true],
  ])("finds %i BPM (off-beats: %s)", (bpm, offbeats) => {
    expect(estimateTempo(clickEnvelope(bpm, 30, offbeats), FPS)).toBeCloseTo(bpm, -0.5);
  });

  it("returns 0 for silence", () => {
    expect(estimateTempo(new Float32Array(FPS * 10), FPS)).toBe(0);
  });
});

describe("trackBeats", () => {
  it.each([100, 128, 140])("places beats on the clicks at %i BPM", (bpm) => {
    const env = clickEnvelope(bpm, 20, true);
    const beats = trackBeats(env, FPS, bpm);
    const truth: number[] = [];
    for (let i = 0; i < env.length; i++) if (env[i] === 1) truth.push(i);
    const matched = truth.filter((t) => beats.some((b) => Math.abs(b - t) <= 2)).length;
    expect(matched / truth.length).toBeGreaterThan(0.9);
    expect(beats.length).toBeLessThan(truth.length * 1.15);
  });
});

describe("pickDownbeat", () => {
  it("chooses the beat offset whose beats carry the most weight", () => {
    const weights = [0.2, 0.1, 0.1, 1, 0.2, 0.1, 0.1, 1, 0.2, 0.1, 0.1, 1];
    expect(pickDownbeat(weights)).toBe(3);
  });

  it("defaults to 0 with no information", () => {
    expect(pickDownbeat([])).toBe(0);
  });
});
