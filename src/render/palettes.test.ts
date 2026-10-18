import { describe, expect, it } from "vitest";
import { hexToLinear, linearStops, paletteForSection, PALETTES, samplePalette } from "./palettes.ts";

describe("hexToLinear", () => {
  it.each([
    ["#000000", [0, 0, 0]],
    ["#ffffff", [1, 1, 1]],
    ["#808080", [0.2158605, 0.2158605, 0.2158605]],
  ])("%s → %j", (hex, expected) => {
    hexToLinear(hex).forEach((v, i) => expect(v).toBeCloseTo(expected[i], 5));
  });
});

describe("paletteForSection", () => {
  const cycle = PALETTES.filter((p) => !p.manualOnly);
  const manual = PALETTES.find((p) => p.manualOnly);

  it("walks the cycle from the chosen palette and wraps", () => {
    expect(paletteForSection(cycle[1].name, 0)).toBe(cycle[1]);
    expect(paletteForSection(cycle[1].name, 1)).toBe(cycle[2]);
    expect(paletteForSection(cycle[1].name, cycle.length)).toBe(cycle[1]);
  });

  it("never lands on a manual-only palette", () => {
    for (let n = 0; n < 30; n++) expect(paletteForSection(cycle[0].name, n).manualOnly).toBeFalsy();
  });

  it("keeps a manual-only choice until the first section, then joins the cycle", () => {
    if (!manual) throw new TypeError("expected at least one manual-only palette");
    expect(paletteForSection(manual.name, 0)).toBe(manual);
    expect(paletteForSection(manual.name, 1)).toBe(cycle[0]);
  });
});

describe("samplePalette", () => {
  const stops = linearStops(PALETTES[0]);

  it.each([0, 0.25, 0.5, 0.75])("hits stop exactly at t=%f", (t) => {
    expect(samplePalette(stops, t)).toEqual(stops[t * 4]);
  });

  it("wraps around so t=1 equals t=0 and negative t works", () => {
    expect(samplePalette(stops, 1)).toEqual(samplePalette(stops, 0));
    expect(samplePalette(stops, -0.25)).toEqual(stops[3]);
  });
});
