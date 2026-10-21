import { describe, expect, it } from "vitest";
import { CAST_HEX, castHex } from "./cast-colors.ts";

const member = (brightness: number): { brightness: number } => ({ brightness });

describe("castHex", () => {
  it("gives darker sounds warmer colours, whatever order they entered in", () => {
    expect(castHex([member(0.8), member(0.2), member(0.5)])).toEqual([CAST_HEX[4], CAST_HEX[0], CAST_HEX[2]]);
  });

  it.each([1, 2, 3, 4, 5, 6])("gives %i members distinct colours", (k) => {
    const colors = castHex(Array.from({ length: k }, (_, i) => member(i / 6)));
    expect(new Set(colors).size).toBe(k);
  });

  it("is empty for an empty cast", () => {
    expect(castHex([])).toEqual([]);
  });
});
