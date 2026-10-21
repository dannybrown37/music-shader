import { describe, expect, it } from "vitest";
import { findDrops, LiveDropDetector } from "./drops.ts";

const FPS = 86;
const BAR = 2;

/** Curves from a level function of time; the same level for loudness, bass and percussive. */
function song(seconds: number, level: (t: number) => number, firstBar = 0): Parameters<typeof findDrops>[0] {
  const frames = Math.round(seconds * FPS);
  const curve = Float32Array.from({ length: frames }, (_, f) => level(f / FPS));
  const downbeats: number[] = [];
  for (let t = firstBar; t < seconds; t += BAR) downbeats.push(t);
  return { loudness: curve, bass: curve, percussive: curve, fps: FPS, downbeats: Float32Array.from(downbeats) };
}

const step =
  (...parts: [until: number, level: number][]) =>
  (t: number): number =>
    (parts.find(([until]) => t < until) ?? parts[parts.length - 1])[1];

describe("findDrops", () => {
  it("finds the drop where a quiet part turns loud, on the downbeat", () => {
    const { drops } = findDrops(song(40, step([16, 0.2], [99, 0.9])));
    expect(Array.from(drops.times)).toEqual([16]);
    expect(drops.strengths[0]).toBeGreaterThan(0.8);
  });

  it.each([
    ["steady loud", step([99, 0.85])],
    ["steady quiet", step([99, 0.2])],
    ["a slow 40 s crescendo", (t: number) => Math.min(0.9, 0.1 + t / 50)],
    ["a lift that stays quiet", step([16, 0.05], [99, 0.35])],
  ])("finds nothing in %s", (_, level) => {
    expect(findDrops(song(40, level)).drops.times.length).toBe(0);
  });

  it("ramps the build up to the drop and releases it on the drop", () => {
    const s = song(40, step([16, 0.2], [99, 0.9]));
    const { build } = findDrops(s);
    const at = (t: number): number => build[Math.round(t * FPS)];
    expect(at(2)).toBe(0);
    expect(at(14)).toBeGreaterThan(at(12));
    expect(at(15.9)).toBeGreaterThan(0.8);
    expect(at(16.05)).toBe(0);
    expect(at(30)).toBe(0);
  });

  it("starts the build at the trough of a breakdown", () => {
    const { build } = findDrops(song(48, step([12, 0.8], [20, 0.1], [28, 0.4], [99, 0.95])));
    expect(build[Math.round(13 * FPS)]).toBe(0);
    expect(build[Math.round(21 * FPS)]).toBeGreaterThan(0);
  });

  it("separates two drops and keeps the second build after the first drop", () => {
    const { drops, build } = findDrops(song(80, step([16, 0.15], [32, 0.9], [48, 0.15], [99, 0.9])));
    expect(Array.from(drops.times)).toEqual([16, 48]);
    for (let t = 16.05; t < 32; t += 0.5) expect(build[Math.round(t * FPS)]).toBe(0);
  });

  it("finds a modest lift in a song without a bigger one", () => {
    expect(Array.from(findDrops(song(40, step([16, 0.45], [99, 0.6]))).drops.times)).toEqual([16]);
  });

  it("ignores small lifts in a song with a much bigger drop", () => {
    const { drops } = findDrops(song(80, step([16, 0.45], [36, 0.6], [56, 0.1], [99, 0.95])));
    expect(Array.from(drops.times)).toEqual([56]);
  });

  it("gives a bigger lift a bigger strength", () => {
    const small = findDrops(song(40, step([16, 0.4], [99, 0.8]))).drops.strengths[0];
    const big = findDrops(song(40, step([16, 0.05], [99, 1]))).drops.strengths[0];
    expect(big).toBeGreaterThan(small);
  });

  it("needs downbeats", () => {
    const s = { ...song(40, step([16, 0.2], [99, 0.9])), downbeats: new Float32Array(0) };
    const { drops, build } = findDrops(s);
    expect(drops.times.length).toBe(0);
    expect(build.every((b) => b === 0)).toBe(true);
  });
});

describe("LiveDropDetector", () => {
  function run(seconds: number, level: (t: number) => number): number[] {
    const d = new LiveDropDetector();
    const fired: number[] = [];
    for (let f = 0; f < seconds * FPS; f++) {
      const t = f / FPS;
      if (d.push(t, level(t), 1 / FPS) > 0) fired.push(t);
    }
    return fired;
  }

  it("fires once, soon after a quiet part turns loud", () => {
    const fired = run(40, step([16, -30], [99, -12]));
    expect(fired.length).toBe(1);
    expect(fired[0]).toBeGreaterThan(16);
    expect(fired[0]).toBeLessThan(17);
  });

  it.each([
    ["steady loud", step([99, -10])],
    ["a slow crescendo", (t: number) => -40 + t / 2],
    ["a jump that is still far below the song's loudest", step([6, -10], [12, -50], [99, -35])],
    ["warming up from silence", step([1, -90], [99, -12])],
  ])("stays quiet for %s", (_, level) => {
    expect(run(40, level)).toEqual([]);
  });
});
