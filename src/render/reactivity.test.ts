import { describe, expect, it } from "vitest";
import { createFeatures } from "../analysis/sampler.ts";
import { defaultSettings } from "../settings.ts";
import { linearStops, PALETTES } from "./palettes.ts";
import { currentPalette, keyHue, Reactor } from "./reactivity.ts";

describe("currentPalette", () => {
  const s = { ...defaultSettings(), palette: PALETTES[1].name, paletteCycle: true };
  s.reactivity = { ...s.reactivity, harmony: 0 };

  it("uses the chosen palette before any section change", () => {
    const f = createFeatures();
    expect(currentPalette(s, f).stops).toEqual(linearStops(PALETTES[1]));
  });

  it("settles on the next palette after a section change", () => {
    const f = createFeatures();
    f.count.section = 1;
    f.since.section = 10;
    expect(currentPalette(s, f).stops).toEqual(linearStops(PALETTES[2]));
  });

  it("starts the crossfade from the previous palette", () => {
    const f = createFeatures();
    f.count.section = 1;
    f.since.section = 0;
    expect(currentPalette(s, f).stops).toEqual(linearStops(PALETTES[1]));
  });

  it("stays put when cycling is off", () => {
    const f = createFeatures();
    f.count.section = 3;
    f.since.section = 10;
    expect(currentPalette({ ...s, paletteCycle: false }, f).stops).toEqual(linearStops(PALETTES[1]));
  });
});

describe("keyHue", () => {
  it.each([
    [1, 0, 0],
    [0, 1, 0.25],
    [-1, 0, 0.5],
    [0, -1, 0.75],
  ])("maps chroma vector (%f, %f) to hue %f", (x, y, hue) => {
    const f = createFeatures();
    f.scalars.hueX = x;
    f.scalars.hueY = y;
    expect(keyHue(f).hue).toBeCloseTo(hue);
  });
});

describe("Reactor", () => {
  it("scales event envelopes by per-drum gain and master sensitivity, capped at 2", () => {
    const f = createFeatures();
    f.env.kick = 0.5;
    f.env.snare = 1.5;
    const s = defaultSettings();
    s.reactivity = { ...s.reactivity, sensitivity: 2, kick: 1.5, snare: 1 };
    const u = new Reactor().build(f, s, { warp: 0.3 });
    expect(u.uKick).toBeCloseTo(1.5);
    expect(u.uSnare).toBe(2);
    expect(u.p_warp).toBe(0.3);
  });

  it("silences everything audio-driven at zero sensitivity", () => {
    const f = createFeatures();
    f.env.kick = 1;
    f.scalars.bass = 1;
    f.scalars.timbreX = 1;
    const s = defaultSettings();
    s.reactivity = { ...s.reactivity, sensitivity: 0 };
    const u = new Reactor().build(f, s, {});
    expect(u.uKick).toBe(0);
    expect(u.uBass).toBe(0);
    expect((u.uTimbre as Float32Array)[0]).toBe(0);
  });
});
