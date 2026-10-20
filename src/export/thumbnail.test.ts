import { describe, expect, it } from "vitest";
import { thumbnailTime } from "./thumbnail.ts";

const fps = 10;
const curve = (n: number, peaks: [number, number][]): Float32Array => {
  const out = new Float32Array(n).fill(0.2);
  for (const [at, v] of peaks) for (let i = at - 5; i <= at + 5; i++) if (i >= 0 && i < n) out[i] = v;
  return out;
};

describe("thumbnailTime", () => {
  it.each([
    ["the loudest stretch", [[600, 0.9]], 60],
    ["the loudest stretch, ignoring a blast in the intro", [[30, 1], [400, 0.8]], 40],
    ["the loudest stretch, ignoring a big ending", [[980, 1], [500, 0.7]], 50],
  ] as const)("picks %s", (_, peaks, expected) => {
    const intensity = curve(1000, peaks.map(([a, b]) => [a, b]));
    expect(thumbnailTime(intensity, intensity, fps)).toBeCloseTo(expected, 0);
  });

  it("falls back to 40% in for a flat song", () => {
    const flat = new Float32Array(1000).fill(0.5);
    expect(thumbnailTime(flat, flat, fps)).toBeCloseTo(40, 0);
  });
});
