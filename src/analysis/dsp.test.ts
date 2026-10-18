import { describe, expect, it } from "vitest";
import { followEnvelope, medianFilter, movingMean, normalizeRange, peakPick, percentile } from "./dsp.ts";

describe("percentile", () => {
  it.each([
    [0, 1],
    [50, 3],
    [100, 5],
  ])("p%i of 1..5 is %i", (p, expected) => {
    expect(percentile(Float32Array.from([5, 1, 4, 2, 3]), p)).toBe(expected);
  });

  it("ignores NaN", () => {
    expect(percentile(Float32Array.from([NaN, 2, 2]), 50)).toBe(2);
  });
});

describe("normalizeRange", () => {
  it("maps the low and high percentiles to 0 and 1 and clamps the rest", () => {
    const data = Float32Array.from({ length: 101 }, (_, i) => i);
    normalizeRange(data, 10, 90);
    expect(data[10]).toBeCloseTo(0);
    expect(data[90]).toBeCloseTo(1);
    expect(data[0]).toBe(0);
    expect(data[100]).toBe(1);
  });

  it("returns zeros for a constant signal instead of NaN", () => {
    const data = new Float32Array(10).fill(3);
    normalizeRange(data, 5, 95);
    expect(Array.from(data)).toEqual(new Array(10).fill(0));
  });
});

describe("medianFilter", () => {
  it("removes a single-sample spike", () => {
    const out = medianFilter(Float32Array.from([1, 1, 9, 1, 1]), 3);
    expect(Array.from(out)).toEqual([1, 1, 1, 1, 1]);
  });
});

describe("movingMean", () => {
  it("averages over a centered window, shrinking at the edges", () => {
    expect(Array.from(movingMean(Float32Array.from([0, 3, 6]), 1, 1))).toEqual([1.5, 3, 4.5]);
  });
});

describe("followEnvelope", () => {
  it("jumps up instantly and decays on release", () => {
    const out = followEnvelope(Float32Array.from([0, 1, 0, 0]), 0, 0.5);
    expect(out[1]).toBe(1);
    expect(out[2]).toBeCloseTo(0.5);
    expect(out[3]).toBeCloseTo(0.25);
  });
});

describe("peakPick", () => {
  const odf = new Float32Array(100);
  for (const [i, v] of [
    [10, 1],
    [11, 0.6],
    [40, 0.8],
    [42, 0.5],
    [70, 0.05],
  ])
    odf[i] = v;

  it("finds clear local maxima above the adaptive threshold", () => {
    const peaks = peakPick(odf, { preMax: 3, postMax: 3, preAvg: 10, postAvg: 5, delta: 0.1, floor: 0.1, minGap: 3 });
    expect(peaks).toEqual([10, 40]);
  });

  it("respects the minimum gap between peaks", () => {
    const data = Float32Array.from([0, 1, 0, 0.9, 0, 0, 0, 0.9, 0]);
    const peaks = peakPick(data, { preMax: 1, postMax: 1, preAvg: 2, postAvg: 2, delta: 0.05, floor: 0.1, minGap: 3 });
    expect(peaks).toEqual([1, 7]);
  });

  it("can run causally with no look-ahead", () => {
    const peaks = peakPick(odf, { preMax: 3, postMax: 0, preAvg: 10, postAvg: 0, delta: 0.1, floor: 0.1, minGap: 3 });
    expect(peaks).toContain(10);
  });
});
