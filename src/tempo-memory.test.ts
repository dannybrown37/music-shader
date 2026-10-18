import { describe, expect, it } from "vitest";
import { nextTempoFactor, parseTempoFactors } from "./tempo-memory.ts";

describe("parseTempoFactors", () => {
  it.each([
    [{ a: 2, b: 0.5, c: 1 }, { a: 2, b: 0.5, c: 1 }],
    [{ a: 3, b: "2", c: null, d: 0.5 }, { d: 0.5 }],
    [null, {}],
    [[2, 0.5], {}],
    ["junk", {}],
  ])("keeps only valid factors from %j", (raw, expected) => {
    expect(parseTempoFactors(raw)).toEqual(expected);
  });
});

describe("nextTempoFactor", () => {
  it.each([
    [1, 2],
    [2, 0.5],
    [0.5, 1],
  ] as const)("%f is followed by %f", (factor, expected) => {
    expect(nextTempoFactor(factor)).toBe(expected);
  });
});
