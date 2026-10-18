import { describe, expect, it } from "vitest";
import { hatGate, isNearAny } from "./bands.ts";

describe("isNearAny", () => {
  const kicks = [1, 2, 3];
  const hats = [1.5];
  it.each([
    [1.03, true],
    [1.05, false],
    [1.49, true],
    [0.5, false],
    [3.035, true],
  ])("t=%f near a drum: %s", (t, expected) => {
    expect(isNearAny(t, [kicks, hats], 0.04)).toBe(expected);
  });

  it("handles empty lists", () => {
    expect(isNearAny(1, [[], []], 0.04)).toBe(false);
  });
});

describe("hatGate", () => {
  it.each([
    [10, 0, 1],
    [1, 1, 0],
    [0, 10, 0],
  ])("high rise %f vs crack rise %f gives %f", (hat, crack, expected) => {
    expect(hatGate(hat, crack)).toBeCloseTo(expected, 3);
  });
});
