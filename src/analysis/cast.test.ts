import { describe, expect, it } from "vitest";
import { castLabels, findCast, kmeans, CAST_BLOCK_SECONDS } from "./cast.ts";
import type { CastInput } from "./cast.ts";
import { rng } from "./test-signals.ts";

const FPS = 86;
const DIMS = 4;

/** A song made of timbre regimes: each [until seconds, centre] holds that feature vector (plus noise) until `until`. */
function song(regimes: [until: number, centre: number[] | null][], seed = 1): CastInput {
  const r = rng(seed);
  const seconds = regimes[regimes.length - 1][0];
  const frames = Math.round(seconds * FPS);
  const features = new Float32Array(frames * DIMS);
  const voiced = new Uint8Array(frames);
  const brightness = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    const centre = regimes.find(([until]) => f / FPS < until)?.[1] ?? null;
    if (!centre) continue;
    voiced[f] = 1;
    for (let d = 0; d < DIMS; d++) features[f * DIMS + d] = centre[d] + (r() - 0.5) * 0.6;
    brightness[f] = (centre[0] + 3) / 6;
  }
  const zeros = new Float32Array(frames);
  return { features, dims: DIMS, voiced, fps: FPS, describe: { brightness, noisiness: zeros, tonalness: zeros, voice: zeros } };
}

const A = [2, 0, 0, 0];
const B = [-2, 2, 0, 0];
const C = [0, -2, 2, 0];
const idAt = (cast: ReturnType<typeof findCast>, t: number): number => cast.ids[Math.floor(t / CAST_BLOCK_SECONDS)];

describe("kmeans", () => {
  it("separates three blobs", () => {
    const r = rng(3);
    const centres = [A, B, C];
    const points = new Float32Array(300 * DIMS);
    for (let i = 0; i < 300; i++) for (let d = 0; d < DIMS; d++) points[i * DIMS + d] = centres[i % 3][d] + (r() - 0.5) * 0.5;
    const { assign } = kmeans(points, DIMS, 3);
    for (let i = 3; i < 300; i++) expect(assign[i]).toBe(assign[i % 3]);
    expect(new Set([assign[0], assign[1], assign[2]]).size).toBe(3);
  });
});

describe("findCast", () => {
  it("finds each recurring sound once, in order of entrance, with the same id when it returns", () => {
    const cast = findCast(
      song([
        [20, A],
        [40, B],
        [60, A],
        [80, C],
      ]),
    );
    expect(cast.members.length).toBe(3);
    expect(cast.members.map((m) => Math.round(m.firstSeen))).toEqual([0, 20, 60]);
    expect(cast.members[0].share).toBeCloseTo(0.5, 1);
    expect([idAt(cast, 10), idAt(cast, 30), idAt(cast, 50), idAt(cast, 70)]).toEqual([0, 1, 0, 2]);
  });

  it("finds a single sound in a song that never changes", () => {
    expect(findCast(song([[60, A]])).members.length).toBe(1);
  });

  it("leaves silence unassigned", () => {
    const cast = findCast(
      song([
        [20, A],
        [30, null],
        [50, B],
      ]),
    );
    expect(idAt(cast, 25)).toBe(-1);
    const block = Math.floor(25 / CAST_BLOCK_SECONDS);
    const w = cast.weights.subarray(block * cast.maxMembers, (block + 1) * cast.maxMembers);
    expect(Math.max(...w)).toBe(0);
  });

  it("gives soft weights that sum to 1 while a sound plays", () => {
    const cast = findCast(
      song([
        [20, A],
        [40, B],
      ]),
    );
    const block = Math.floor(10 / CAST_BLOCK_SECONDS);
    const w = Array.from(cast.weights.subarray(block * cast.maxMembers, (block + 1) * cast.maxMembers));
    expect(w.reduce((s, v) => s + v, 0)).toBeCloseTo(1, 3);
    expect(w[0]).toBeGreaterThan(0.9);
  });

  it("returns no members for a silent song", () => {
    expect(findCast(song([[20, null]])).members.length).toBe(0);
  });
});

describe("castLabels", () => {
  const m = (brightness: number, noisiness = 0.4, voice = 0, tonalness = 0.6): Parameters<typeof castLabels>[0][number] => ({ brightness, noisiness, voice, tonalness });

  it("names sounds by register, plus character when it's clear", () => {
    expect(castLabels([m(0.2), m(0.5, 0.8, 0, 0.2), m(0.8, 0.3, 0.4), m(0.9, 0.1, 0, 0.3)])).toEqual(["low tones", "mid noise", "high voice", "high"]);
  });

  it("calls a lone sound the main one", () => {
    expect(castLabels([m(0.5, 0.1, 0, 0.3)])).toEqual(["main"]);
  });

  it("keeps labels unique", () => {
    expect(castLabels([m(0.5), m(0.52)])).toEqual(["low tones", "high tones"]);
    expect(new Set(castLabels([m(0.5), m(0.5), m(0.5)])).size).toBe(3);
  });
});
