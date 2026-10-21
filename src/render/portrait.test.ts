import { describe, expect, it } from "vitest";
import { emptyCast, MAX_CAST } from "../analysis/cast.ts";
import { MEL_BANDS } from "../analysis/frame.ts";
import { EVENT_KINDS, SCALAR_NAMES } from "../analysis/types.ts";
import type { TrackAnalysis } from "../analysis/types.ts";
import { buildSongTexture, ROW, SONG_ROWS } from "./portrait.ts";

const COLUMNS = 10;

/** 10 s at 10 fps: mel band b reads b / 64 everywhere, intensity ramps 0 → 1. */
function song(): TrackAnalysis {
  const fps = 10;
  const frames = 100;
  const scalars = Object.fromEntries(SCALAR_NAMES.map((n) => [n, new Float32Array(frames)])) as TrackAnalysis["scalars"];
  scalars.intensity = Float32Array.from({ length: frames }, (_, i) => i / (frames - 1));
  const events = Object.fromEntries(EVENT_KINDS.map((k) => [k, { times: new Float32Array(), strengths: new Float32Array() }])) as TrackAnalysis["events"];
  const mel = new Float32Array(frames * MEL_BANDS);
  for (let f = 0; f < frames; f++) for (let b = 0; b < MEL_BANDS; b++) mel[f * MEL_BANDS + b] = b / MEL_BANDS;
  return {
    sampleRate: 44100,
    fps,
    frames,
    duration: 10,
    tempo: 120,
    scalars,
    mel,
    chroma: new Float32Array(frames * 12),
    events,
    cast: emptyCast(),
    key: { tonic: 0, minor: false, confidence: 0, name: "C major" },
    odfs: { kick: new Float32Array(frames), snare: new Float32Array(frames), hat: new Float32Array(frames), onset: new Float32Array(frames), note: new Float32Array(frames) },
    debug: {},
  };
}

const texel = (data: Float32Array, column: number, row: number): number[] => Array.from(data.subarray((row * COLUMNS + column) * 4, (row * COLUMNS + column) * 4 + 4));

describe("buildSongTexture", () => {
  it("has a row per mel band plus the summary rows", () => {
    expect(buildSongTexture(song(), COLUMNS).length).toBe(COLUMNS * SONG_ROWS * 4);
  });

  it("averages each band over its column", () => {
    const data = buildSongTexture(song(), COLUMNS);
    expect(texel(data, 3, 32)[0]).toBeCloseTo(0.5);
  });

  it("follows the intensity across the song", () => {
    const data = buildSongTexture(song(), COLUMNS);
    expect(texel(data, 0, ROW.levels)[0]).toBeLessThan(0.1);
    expect(texel(data, 9, ROW.levels)[0]).toBeGreaterThan(0.9);
  });

  it("marks drops and sections in their columns", () => {
    const a = song();
    a.events.drop = { times: Float32Array.from([6.5]), strengths: Float32Array.from([0.8]) };
    a.events.section = { times: Float32Array.from([2.1]), strengths: Float32Array.from([1]) };
    const data = buildSongTexture(a, COLUMNS);
    expect(texel(data, 6, ROW.marks)[2]).toBeCloseTo(0.8);
    expect(texel(data, 5, ROW.marks)[2]).toBe(0);
    expect(texel(data, 2, ROW.marks)[3]).toBe(1);
  });

  it("counts hits per column relative to the busiest column", () => {
    const a = song();
    a.events.kick = { times: Float32Array.from([1.1, 1.5, 1.9, 4.2]), strengths: Float32Array.from([1, 1, 1, 1]) };
    const data = buildSongTexture(a, COLUMNS);
    expect(texel(data, 1, ROW.hits)[0]).toBe(1);
    expect(texel(data, 4, ROW.hits)[0]).toBeCloseTo(1 / 3);
  });

  it("averages the cast weights and keeps the dominant member", () => {
    const a = song();
    const weights = new Float32Array(10 * MAX_CAST);
    const ids = new Int8Array(10);
    for (let b = 0; b < 10; b++) {
      ids[b] = b < 5 ? 0 : 1;
      weights[b * MAX_CAST + ids[b]] = 1;
    }
    a.cast = { ...emptyCast(), blockSeconds: 1, ids, weights };
    const data = buildSongTexture(a, COLUMNS);
    expect(texel(data, 2, ROW.cast0)).toEqual([1, 0, 0, 0]);
    expect(texel(data, 8, ROW.cast0)).toEqual([0, 1, 0, 0]);
    expect(texel(data, 8, ROW.marks)[0]).toBe(1);
  });
});
