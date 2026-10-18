import { describe, expect, it } from "vitest";
import { FFT } from "./fft.ts";

function naiveMagnitudes(input: Float32Array): Float32Array {
  const n = input.length;
  const out = new Float32Array(n / 2 + 1);
  for (let k = 0; k <= n / 2; k++) {
    let re = 0;
    let im = 0;
    for (let t = 0; t < n; t++) {
      re += input[t] * Math.cos((-2 * Math.PI * k * t) / n);
      im += input[t] * Math.sin((-2 * Math.PI * k * t) / n);
    }
    out[k] = Math.hypot(re, im);
  }
  return out;
}

describe("FFT", () => {
  it.each([8, 64, 512])("matches a naive DFT for size %i", (size) => {
    const input = new Float32Array(size);
    for (let i = 0; i < size; i++) input[i] = Math.sin(i * 0.37) + 0.5 * Math.cos(i * 1.91) + ((i * 7919) % 13) / 13;
    const fft = new FFT(size);
    const mags = new Float32Array(size / 2 + 1);
    fft.magnitudes(input, mags);
    const expected = naiveMagnitudes(input);
    for (let k = 0; k < mags.length; k++) expect(mags[k]).toBeCloseTo(expected[k], 2);
  });

  it("puts a pure tone in the right bin", () => {
    const size = 1024;
    const bin = 37;
    const input = Float32Array.from({ length: size }, (_, i) => Math.sin((2 * Math.PI * bin * i) / size));
    const mags = new Float32Array(size / 2 + 1);
    new FFT(size).magnitudes(input, mags);
    const peak = mags.indexOf(Math.max(...mags));
    expect(peak).toBe(bin);
  });

  it.each([0, 3, 1000])("rejects a non power of two size %i", (size) => {
    expect(() => new FFT(size)).toThrow(RangeError);
  });
});
