import { describe, expect, it } from "vitest";
import { outroAt } from "./outro.ts";

describe("outroAt", () => {
  // A 200 s song with a 12 s outro: it starts at 188 s.
  it.each([
    [100, 0, 0, 0],
    [188, 0, 0, 0],
    [189, 0.5, 0, 0],
    [190, 1, 0, 0],
    [190 + 0.65 * 12, 1, 1, 1],
    [200, 1, 1, 1],
  ])("at %f s: portrait %f, revealed %f, text %f", (t, mix, reveal, text) => {
    const o = outroAt(t, 200, 12);
    expect(o.mix).toBeCloseTo(mix, 2);
    expect(o.reveal).toBeCloseTo(reveal, 2);
    expect(o.text).toBeCloseTo(text, 2);
  });

  it("reveals steadily, faster than the song", () => {
    const a = outroAt(192, 200, 12).reveal;
    const b = outroAt(194, 200, 12).reveal;
    expect(b).toBeGreaterThan(a);
    expect(b - a).toBeGreaterThan(0.2);
  });

  it.each([
    ["off", 200, 0],
    ["a song too short for it", 30, 12],
  ])("does nothing when %s", (_, duration, seconds) => {
    expect(outroAt(duration - 1, duration, seconds).mix).toBe(0);
  });
});
