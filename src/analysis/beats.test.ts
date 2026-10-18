import { describe, expect, it } from "vitest";
import { estimateTempo, pickDownbeat, scaleBeats, trackBeats } from "./beats.ts";
import type { EventTrack } from "./types.ts";

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

describe("scaleBeats", () => {
  const track = (times: number[]): EventTrack => ({ times: Float32Array.from(times), strengths: Float32Array.from(times, () => 1) });
  const range = (n: number, step = 1): number[] => Array.from({ length: n }, (_, i) => i * step);
  const beats = track(range(17));
  const downbeats = track([1, 5, 9, 13]);

  it.each([
    [1, range(17), [1, 5, 9, 13]],
    [2, range(33, 0.5), [1, 3, 5, 7, 9, 11, 13, 15]],
    [0.5, [1, 3, 5, 7, 9, 11, 13, 15], [1, 9]],
  ] as const)("factor %f gives the expected beat and bar grid", (factor, wantBeats, wantDown) => {
    const out = scaleBeats(beats, downbeats, factor);
    expect(Array.from(out.beat.times)).toEqual(wantBeats);
    expect(Array.from(out.downbeat.times)).toEqual(wantDown);
  });

  it("makes inserted half-beats weaker than the real beats", () => {
    const out = scaleBeats(beats, downbeats, 2);
    expect(out.beat.strengths[1]).toBeLessThan(out.beat.strengths[0]);
  });

  it.each([0.5, 2] as const)("copes with no beats at factor %f", (factor) => {
    const out = scaleBeats(track([]), track([]), factor);
    expect(out.beat.times.length).toBe(0);
    expect(out.downbeat.times.length).toBe(0);
  });
});
