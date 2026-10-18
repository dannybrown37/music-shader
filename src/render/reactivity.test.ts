import { describe, expect, it } from "vitest";
import { createFeatures } from "../analysis/sampler.ts";
import { defaultSettings } from "../settings.ts";
import { linearStops, PALETTES } from "./palettes.ts";
import { currentPalette, keyHue, Reactor, sectionParams } from "./reactivity.ts";

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

describe("sectionParams", () => {
  const defs = [
    { key: "warp", label: "", min: 0, max: 3, value: 1.3 },
    { key: "scale", label: "", min: 0.5, max: 5, value: 2.2 },
    { key: "folds", label: "", min: 2, max: 16, value: 6, step: 1 },
  ];
  const values = { warp: 1.3, scale: 2.2, folds: 6 };
  const at = (section: number, since: number): ReturnType<typeof createFeatures> => {
    const f = createFeatures();
    f.count.section = section;
    f.since.section = since;
    return f;
  };

  it.each([
    ["before the first section", 0, 0.5],
    ["with variation off", 3, 0],
  ])("leaves params alone %s", (_, section, amount) => {
    expect(sectionParams(values, defs, at(section, 10), amount)).toEqual(values);
  });

  it("gives each settled section its own deterministic look within range", () => {
    const a = sectionParams(values, defs, at(2, 10), 0.5);
    const b = sectionParams(values, defs, at(3, 10), 0.5);
    expect(a).not.toEqual(b);
    expect(sectionParams(values, defs, at(2, 10), 0.5)).toEqual(a);
    for (const d of defs) {
      expect(a[d.key]).toBeGreaterThanOrEqual(d.min);
      expect(a[d.key]).toBeLessThanOrEqual(d.max);
      expect(Math.abs(a[d.key] - values[d.key as keyof typeof values])).toBeLessThanOrEqual(0.25 * (d.max - d.min) + 1e-6);
    }
    expect(Number.isInteger(a.folds)).toBe(true);
  });

  it("glides continuous params from the previous section's look", () => {
    const prev = sectionParams(values, defs, at(2, 10), 0.5);
    const start = sectionParams(values, defs, at(3, 0), 0.5);
    expect(start.warp).toBeCloseTo(prev.warp, 6);
    expect(start.scale).toBeCloseTo(prev.scale, 6);
  });

  it("switches stepped params right on the section change", () => {
    expect(sectionParams(values, defs, at(3, 0), 0.5).folds).toBe(sectionParams(values, defs, at(3, 10), 0.5).folds);
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

  it("passes recent notes with their pitch classes and count to the shaders", () => {
    const f = createFeatures();
    f.recent.note.set([0.2, 0.8, 0.6, 1]);
    f.notePitch.set([7, 2]);
    f.count.note = 12;
    const u = new Reactor().build(f, defaultSettings(), {});
    expect(Array.from((u.uNoteHist as Float32Array).slice(0, 4))).toEqual([0.2, 0.8, 0.6, 1].map(Math.fround));
    expect(Array.from((u.uNotePitch as Float32Array).slice(0, 3))).toEqual([7, 2, -1]);
    expect(u.uNoteCount).toBe(12);
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
