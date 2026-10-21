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

  it.each([1, 2, 3, 7])("never moves steady params (section %i)", (section) => {
    const steady = [...defs, { key: "shots", label: "", min: 0, max: 4, value: 1, step: 1, steady: true }];
    expect(sectionParams({ ...values, shots: 1 }, steady, at(section, 10), 1).shots).toBe(1);
  });
});

describe("Reactor", () => {
  it("scales event envelopes by per-drum gain and master sensitivity, capped at 2", () => {
    const f = createFeatures();
    f.scalars.intensity = 1;
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

  it.each([
    [1, 1, 0.6, 0.3],
    [2, 1, 1.2, 0.6],
    [1, 3, 1.5, 0.9],
  ])("scales melody and voice by sensitivity %f and melody gain %f", (sensitivity, gain, melody, voice) => {
    const f = createFeatures();
    f.scalars.intensity = 1;
    f.scalars.melody = 0.6;
    f.scalars.voice = 0.3;
    f.scalars.pitch = 0.25;
    const s = defaultSettings();
    s.reactivity = { ...s.reactivity, sensitivity, melody: gain };
    const u = new Reactor().build(f, s, {});
    expect(u.uMelody).toBeCloseTo(melody);
    expect(u.uVoice).toBeCloseTo(voice);
    expect(u.uPitch).toBeCloseTo(0.25);
  });

  it.each([
    [0.4, 1, 0.4],
    [0.4, 2, 0.8],
    [-0.9, 3, -1.5],
  ])("slow timbre %f at timbre gain %f reaches the shader as %f", (slow, gain, expected) => {
    const f = createFeatures();
    f.timbreSlow.set([slow, slow, slow]);
    const s = defaultSettings();
    s.reactivity = { ...s.reactivity, sensitivity: 1, timbre: gain };
    const u = new Reactor().build(f, s, {});
    Array.from(u.uTimbreSlow as Float32Array).forEach((v) => expect(v).toBeCloseTo(expected));
  });

  it("silences everything audio-driven at zero sensitivity", () => {
    const f = createFeatures();
    f.env.kick = 1;
    f.scalars.bass = 1;
    f.scalars.timbreX = 1;
    f.timbreSlow[0] = 1;
    f.scalars.melody = 1;
    f.scalars.voice = 1;
    const s = defaultSettings();
    s.reactivity = { ...s.reactivity, sensitivity: 0 };
    const u = new Reactor().build(f, s, {});
    expect(u.uKick).toBe(0);
    expect(u.uBass).toBe(0);
    expect((u.uTimbre as Float32Array)[0]).toBe(0);
    expect((u.uTimbreSlow as Float32Array)[0]).toBe(0);
    expect(u.uMelody).toBe(0);
    expect(u.uVoice).toBe(0);
  });
});

describe("Reactor choreography", () => {
  const settings = (patch: Partial<ReturnType<typeof defaultSettings>["reactivity"]> = {}): ReturnType<typeof defaultSettings> => {
    const s = defaultSettings();
    s.reactivity = { ...s.reactivity, ...patch };
    return s;
  };
  const hit = (intensity: number): ReturnType<typeof createFeatures> => {
    const f = createFeatures();
    f.env.kick = 1;
    f.scalars.intensity = intensity;
    return f;
  };
  const afterDrop = (age: number): ReturnType<typeof createFeatures> => {
    const f = createFeatures();
    f.env.drop = Math.exp(-age);
    f.since.drop = age;
    f.recent.drop[0] = age;
    f.recent.drop[1] = 1;
    return f;
  };

  it.each([
    [0, 1],
    [1, 0.6],
  ])("with Quiet vs loud at %f, a kick in a quiet passage hits at %f of its loud strength", (dynamics, ratio) => {
    const r = new Reactor();
    const quiet = r.build(hit(0), settings({ dynamics }), {}).uKick as number;
    const loud = r.build(hit(1), settings({ dynamics }), {}).uKick as number;
    expect(quiet / loud).toBeCloseTo(ratio, 1);
  });

  it("draws the camera back through a build and punches in on the drop", () => {
    const r = new Reactor();
    const build = createFeatures();
    build.scalars.build = 0.9;
    expect(r.build(build, settings(), {}).uCamZoom as number).toBeGreaterThan(1.1);
    expect(r.build(afterDrop(0), settings(), {}).uCamZoom as number).toBeLessThan(0.9);
    expect(r.build(afterDrop(4), settings(), {}).uCamZoom as number).toBeCloseTo(1, 2);
  });

  it("does nothing with Build-up & drop at 0", () => {
    const r = new Reactor();
    const f = afterDrop(0);
    f.scalars.build = 0.9;
    f.choreoTime = -3;
    const u = r.build(f, settings({ drop: 0 }), {});
    expect([u.uCamZoom, u.uBuild, u.uDrop]).toEqual([1, 0, 0]);
    expect(u.uFlow).toBe(r.build({ ...f, choreoTime: 0 }, settings({ drop: 0 }), {}).uFlow);
  });

  it("adds the choreography clock to the flow", () => {
    const r = new Reactor();
    const f = createFeatures();
    f.time = 10;
    const base = r.build(f, settings(), {}).uFlow as number;
    f.choreoTime = 2;
    expect(r.build(f, settings(), {}).uFlow as number).toBeGreaterThan(base);
  });
});

describe("Reactor cast", () => {
  it("passes the cast's colours and who is playing now", () => {
    const r = new Reactor();
    r.setCast([
      [1, 0, 0],
      [0, 0, 1],
    ]);
    const f = createFeatures();
    f.cast[1] = 1;
    f.noteCast[0] = 1;
    const u = r.build(f, defaultSettings(), {});
    expect(u.uCastCount).toBe(2);
    expect(Array.from(u.uCastColor as Float32Array).slice(0, 6)).toEqual([1, 0, 0, 0, 0, 1]);
    expect(Array.from(u.uCastNow as Float32Array).slice(0, 2)).toEqual([0, 1]);
    expect((u.uNoteCast as Float32Array)[0]).toBe(1);
    expect(u.uCastMix).toBe(defaultSettings().reactivity.cast);
  });

  it("turns cast colouring off without a cast", () => {
    const r = new Reactor();
    r.setCast([]);
    const u = r.build(createFeatures(), defaultSettings(), {});
    expect([u.uCastCount, u.uCastMix]).toEqual([0, 0]);
  });
});
