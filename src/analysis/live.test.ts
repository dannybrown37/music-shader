import { describe, expect, it } from "vitest";
import { LiveAnalyzer } from "./live.ts";
import { createFeatures } from "./sampler.ts";
import { MEL_BANDS } from "./frame.ts";
import { EVENT_KINDS, SCALAR_NAMES } from "./types.ts";
import type { EventKind } from "./types.ts";
import { drumPattern, melody, pad, precision, recall, SR } from "./test-signals.ts";

const CHUNK = 1024;
const TOL = 0.05;

function feed(audio: Float32Array): LiveAnalyzer {
  const live = new LiveAnalyzer(SR);
  for (let i = 0; i < audio.length; i += CHUNK) live.push(audio.subarray(i, Math.min(audio.length, i + CHUNK)), null);
  return live;
}

/** Ignore the first seconds while adaptive ranges and the tempo estimate warm up. */
const after = (times: number[], t0: number): number[] => times.filter((t) => t >= t0);

describe("LiveAnalyzer drums", () => {
  const truth = drumPattern(124, 16, true);
  const live = feed(truth.audio);
  const ev = (k: EventKind): number[] => Array.from(live.eventTimes(k));

  it.each([
    ["kick", truth.kicks],
    ["snare", truth.snares],
    ["hat", truth.hats],
  ] as const)("detects %s hits causally", (kind, times) => {
    const detected = after(ev(kind), 2);
    const expected = after(times, 2);
    expect(recall(detected, expected, TOL)).toBeGreaterThan(0.85);
    expect(precision(detected, expected, TOL)).toBeGreaterThan(0.8);
  });

  it("estimates the tempo", () => {
    expect(live.tempo).toBeCloseTo(124, -0.5);
  });

  it("locks beats onto the kicks once the tempo is known", () => {
    const beats = after(ev("beat"), 8);
    expect(beats.length).toBeGreaterThan(10);
    expect(precision(beats, truth.beats, 0.06)).toBeGreaterThan(0.8);
  });
});

describe("LiveAnalyzer notes", () => {
  it("finds melody notes and keeps drum hits out of them", () => {
    const { audio, notes } = melody(8);
    const live = feed(audio);
    const found = after(Array.from(live.eventTimes("note")), 1.5);
    expect(recall(found, after(notes, 1.5), TOL)).toBeGreaterThan(0.8);
    expect(precision(found, notes, TOL)).toBeGreaterThan(0.8);
    const drums = feed(drumPattern(124, 8, false).audio);
    expect(after(Array.from(drums.eventTimes("note")), 1.5).length).toBeLessThanOrEqual(3);
  });
});

describe("LiveAnalyzer on a sustained pad", () => {
  const live = feed(pad(8, 0.2));
  it.each(["kick", "snare", "hat"] as const)("fires almost no %s events", (kind) => {
    expect(after(Array.from(live.eventTimes(kind)), 1).length).toBeLessThanOrEqual(2);
  });
});

describe("LiveAnalyzer features", () => {
  const live = feed(drumPattern(124, 6, true).audio);
  const f = createFeatures();
  const decays = Object.fromEntries(EVENT_KINDS.map((k) => [k, 0.1])) as Record<EventKind, number>;

  it("produces finite, in-range scalars", () => {
    live.sample(live.time, f, decays);
    for (const name of SCALAR_NAMES) {
      const v = f.scalars[name];
      const signed = name.startsWith("timbre") || name.startsWith("hue");
      expect(Number.isFinite(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(signed ? -1 : 0);
      expect(v).toBeLessThanOrEqual(1);
    }
    expect(f.tempo).toBeGreaterThan(0);
    expect(f.beatPhase).toBeGreaterThanOrEqual(0);
    expect(f.beatPhase).toBeLessThan(1);
  });

  it("fills a spectrogram history", () => {
    const out = new Float32Array(MEL_BANDS * 32);
    live.spectrogram(live.time, 32, 2, out);
    expect(out.every((v) => Number.isFinite(v) && v >= 0 && v <= 1)).toBe(true);
    expect(out.some((v) => v > 0)).toBe(true);
  });
});
