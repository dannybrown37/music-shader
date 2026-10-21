import { describe, expect, it } from "vitest";
import { estimateKey } from "./key.ts";

/** Frames of chroma where the given pitch classes sound with the given weights. */
function chroma(weights: Record<number, number>, frames = 10): Float32Array {
  const out = new Float32Array(frames * 12);
  for (let f = 0; f < frames; f++) for (const [pc, w] of Object.entries(weights)) out[f * 12 + Number(pc)] = w;
  return out;
}

const scale = (tonic: number, steps: number[], emphasis: number[]): Record<number, number> => Object.fromEntries(steps.map((s, i) => [(tonic + s) % 12, emphasis[i]]));
const MAJOR = [0, 2, 4, 5, 7, 9, 11];
const MINOR = [0, 2, 3, 5, 7, 8, 10];
const TRIAD_HEAVY = [1, 0.4, 0.8, 0.5, 0.9, 0.4, 0.3];

describe("estimateKey", () => {
  it.each([
    [0, MAJOR, "C major"],
    [7, MAJOR, "G major"],
    [9, MINOR, "A minor"],
    [3, MAJOR, "E♭ major"],
    [6, MINOR, "F♯ minor"],
  ])("tonic %i → %s", (tonic, steps, name) => {
    expect(estimateKey(chroma(scale(tonic, steps, TRIAD_HEAVY))).name).toBe(name);
  });

  it("is unsure about a flat chroma", () => {
    const flat = chroma(Object.fromEntries(Array.from({ length: 12 }, (_, k) => [k, 1])));
    expect(estimateKey(flat).confidence).toBeLessThan(0.2);
  });

  it("is confident about a clear scale", () => {
    expect(estimateKey(chroma(scale(0, MAJOR, TRIAD_HEAVY))).confidence).toBeGreaterThan(0.7);
  });
});
