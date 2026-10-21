import { describe, expect, it } from "vitest";
import { createFeatures, dominantPitch, FeatureSampler } from "./sampler.ts";
import { EVENT_KINDS, SCALAR_NAMES } from "./types.ts";
import type { EventKind, TrackAnalysis } from "./types.ts";
import { MEL_BANDS } from "./frame.ts";
import { emptyCast, MAX_CAST } from "./cast.ts";

function fakeAnalysis(): TrackAnalysis {
  const fps = 10;
  const frames = 101;
  const scalars = Object.fromEntries(SCALAR_NAMES.map((n) => [n, Float32Array.from({ length: frames }, (_, i) => i / (frames - 1))])) as TrackAnalysis["scalars"];
  const events = Object.fromEntries(EVENT_KINDS.map((k) => [k, { times: new Float32Array(), strengths: new Float32Array() }])) as TrackAnalysis["events"];
  events.kick = { times: Float32Array.from([1, 2, 3]), strengths: Float32Array.from([1, 0.5, 1]) };
  const beats = Array.from({ length: 10 }, (_, i) => 1 + i * 0.5);
  events.beat = { times: Float32Array.from(beats), strengths: new Float32Array(10).fill(1) };
  events.downbeat = { times: Float32Array.from([2, 4]), strengths: Float32Array.from([1, 1]) };
  return {
    sampleRate: 44100,
    fps,
    frames,
    duration: 10,
    tempo: 120,
    scalars,
    mel: new Float32Array(frames * MEL_BANDS).fill(0.5),
    chroma: new Float32Array(frames * 12).fill(0.25),
    events,
    cast: emptyCast(),
    key: { tonic: 0, minor: false, confidence: 0, name: "C major" },
    odfs: { kick: new Float32Array(frames), snare: new Float32Array(frames), hat: new Float32Array(frames), onset: new Float32Array(frames), note: new Float32Array(frames) },
    debug: {},
  };
}

describe("FeatureSampler", () => {
  const sampler = new FeatureSampler(fakeAnalysis());
  const f = createFeatures();
  const decays = Object.fromEntries(EVENT_KINDS.map((k) => [k, 0.1])) as Record<EventKind, number>;

  it("interpolates scalars between frames", () => {
    sampler.sample(5.05, f, decays);
    expect(f.scalars.loudness).toBeCloseTo(0.505, 3);
  });

  it.each([
    [0.99, 0],
    [1, 1],
    [1.1, Math.exp(-1)],
    [2, 0.5],
  ])("kick envelope at %f s is %f", (t, expected) => {
    sampler.sample(t, f, decays);
    expect(f.env.kick).toBeCloseTo(expected, 3);
  });

  it("keeps the louder of overlapping envelopes", () => {
    sampler.sample(2.01, f, { ...decays, kick: 10 });
    expect(f.env.kick).toBeCloseTo(Math.exp(-1.01 / 10), 3);
  });

  it("counts events and time since the last one", () => {
    sampler.sample(2.5, f, decays);
    expect(f.count.kick).toBe(2);
    expect(f.since.kick).toBeCloseTo(0.5);
    sampler.sample(0.5, f, decays);
    expect(f.count.kick).toBe(0);
    expect(f.since.kick).toBe(Infinity);
  });

  it.each([
    [1.25, 0.5, 0],
    [2.25, 0.5, 2],
    [3.0, 0, 4],
  ])("beat phase at %f s is %f (beat %i)", (t, phase, index) => {
    sampler.sample(t, f, decays);
    expect(f.beatPhase).toBeCloseTo(phase, 3);
    expect(f.beatIndex).toBe(index);
  });

  it("extrapolates beats before the first detected beat using the tempo", () => {
    sampler.sample(0.75, f, decays);
    expect(f.beatPhase).toBeCloseTo(0.5, 3);
  });

  it.each([
    [2, 0],
    [2.5, 0.25],
    [3.75, 0.875],
  ])("bar phase at %f s is %f", (t, phase) => {
    sampler.sample(t, f, decays);
    expect(f.barPhase).toBeCloseTo(phase, 3);
  });

  it("integrates loudness and percussion into energy time", () => {
    // loudness and percussive both ramp 0→1 over 10 s, so ∫(0.8·l + 0.4·p) dt from 0 to 10 = 1.2 · 5 = 6.
    sampler.sample(10, f, decays);
    expect(f.energyTime).toBeCloseTo(6, 1);
    sampler.sample(5, f, decays);
    expect(f.energyTime).toBeCloseTo(1.5, 1);
  });

  it.each([
    // Timbre ramps frame / 100 at 10 fps; slow timbre averages the frames of the last second.
    [5, 0.455],
    [5.05, 0.455],
    [0.3, 0.015],
    [0, 0],
  ])("slow timbre at %f s averages the past second (%f)", (t, expected) => {
    sampler.sample(t, f, decays);
    Array.from(f.timbreSlow).forEach((v) => expect(v).toBeCloseTo(expected, 4));
  });

  it("lists recent events newest first with their ages", () => {
    sampler.sample(3.5, f, decays);
    expect(Array.from(f.recent.kick.slice(0, 6))).toEqual([0.5, 1, 1.5, 0.5, 2.5, 1]);
    expect(f.recent.kick[6]).toBe(-1);
  });

  it("fills the melody line history as (pitch, melody) pairs, newest first", () => {
    // Every fake scalar ramps 0→1 over 10 s, so both channels read t / 10.
    const out = new Float32Array(3 * 2);
    sampler.melodyLine(5, 3, 2, out);
    Array.from(out).forEach((v, i) => expect(v).toBeCloseTo([0.5, 0.5, 0.4, 0.4, 0.3, 0.3][i], 4));
  });

  it("gives each recent note the pitch class that sounded just after it, newest first", () => {
    const a = fakeAnalysis();
    a.events.note = { times: Float32Array.from([1, 2]), strengths: Float32Array.from([1, 1]) };
    // Note 1 rings as G (7) from frame 10, note 2 as D (2) from frame 20.
    for (let fr = 10; fr < 20; fr++) a.chroma[fr * 12 + 7] = 1;
    for (let fr = 20; fr < 30; fr++) a.chroma[fr * 12 + 2] = 1;
    const g = createFeatures();
    new FeatureSampler(a).sample(2.5, g, decays);
    expect(Array.from(g.notePitch.slice(0, 3))).toEqual([2, 7, -1]);
  });
});

describe("FeatureSampler cast and choreography", () => {
  const decays = Object.fromEntries(EVENT_KINDS.map((k) => [k, 0.1])) as Record<EventKind, number>;

  /** 10 s, two cast members: member 0 for 0–5 s, member 1 for 5–10 s, in 1 s blocks. */
  function withCast(): TrackAnalysis {
    const a = fakeAnalysis();
    const blocks = 10;
    const weights = new Float32Array(blocks * MAX_CAST);
    const ids = new Int8Array(blocks);
    for (let b = 0; b < blocks; b++) {
      ids[b] = b < 5 ? 0 : 1;
      weights[b * MAX_CAST + ids[b]] = 1;
    }
    const member = { firstSeen: 0, share: 0.5, brightness: 0.5, noisiness: 0.5, tonalness: 0.5, voice: 0, label: "mid tone" };
    a.cast = { members: [member, { ...member, firstSeen: 5 }], blockSeconds: 1, maxMembers: MAX_CAST, ids, weights };
    return a;
  }

  it.each([
    [2.5, [1, 0]],
    [5, [0.5, 0.5]],
    [8, [0, 1]],
  ])("weights each cast member by how much it sounds at %f s", (t, expected) => {
    const f = createFeatures();
    new FeatureSampler(withCast()).sample(t, f, decays);
    expect(Array.from(f.cast.slice(0, 2)).map((v) => Number(v.toFixed(2)))).toEqual(expected);
  });

  it("tags each recent note with the cast member playing it, newest first", () => {
    const a = withCast();
    a.events.note = { times: Float32Array.from([1, 7]), strengths: Float32Array.from([1, 1]) };
    const f = createFeatures();
    new FeatureSampler(a).sample(8, f, decays);
    expect(Array.from(f.noteCast.slice(0, 3))).toEqual([1, 0, -1]);
  });

  it("slows the choreography clock through a build and surges it after a drop", () => {
    const a = fakeAnalysis();
    a.scalars.build = Float32Array.from({ length: a.frames }, (_, i) => (i < 50 ? i / 50 : 0));
    a.events.drop = { times: Float32Array.from([5]), strengths: Float32Array.from([1]) };
    const sampler = new FeatureSampler(a);
    const f = createFeatures();
    const at = (t: number): number => {
      sampler.sample(t, f, decays);
      return f.choreoTime;
    };
    expect(at(4.9)).toBeLessThan(at(3));
    expect(at(6) - at(5)).toBeGreaterThan(0.5);
    expect(at(9.9) - at(9)).toBeLessThan(at(6) - at(5));
  });
});

describe("dominantPitch", () => {
  it.each([
    [[0, 0, 0, 0, 0, 0, 0, 0, 0, 0.9, 0.2, 0], 9],
    [[0.5, 0, 0, 0, 0, 0, 0, 0.6, 0, 0, 0, 0], 7],
    [new Array(12).fill(0), -1],
  ])("of %j is %i", (chroma, expected) => {
    expect(dominantPitch(chroma)).toBe(expected);
  });
});
