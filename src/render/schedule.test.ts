import { describe, expect, it } from "vitest";
import { sceneAt } from "./schedule.ts";

const sections = Float32Array.from([10, 15, 40, 70, 75]);
const opts = { minSeconds: 20, sceneCount: 4, start: 1, lead: 0.75, fade: 1.5 };

describe("sceneAt", () => {
  it.each([
    [0, 1, -1, 1],
    [9, 1, -1, 1],
    [12, 2, -1, 1],
    [30, 2, -1, 1],
    [45, 3, -1, 1],
    [80, 0, -1, 1],
    [40, 3, 2, 0.5],
  ])("at t=%f shows scene %i (fading from %i, mix %f)", (t, current, previous, mix) => {
    const s = sceneAt(t, sections, opts);
    expect(s.current).toBe(current);
    expect(s.previous).toBe(previous);
    expect(s.mix).toBeCloseTo(mix, 3);
  });

  it("skips sections closer than minSeconds to the last switch", () => {
    // 15 is 5 s after 10, and 75 is 5 s after 70: neither switches.
    expect(sceneAt(16, sections, opts).current).toBe(2);
    expect(sceneAt(76, sections, opts).current).toBe(0);
  });

  it("starts the crossfade `lead` seconds before the section so the new scene lands on it", () => {
    const before = sceneAt(10 - 0.75, sections, opts);
    expect(before.current).toBe(2);
    expect(before.mix).toBeCloseTo(0, 3);
    const mid = sceneAt(10 - 0.75 + 0.75, sections, opts);
    expect(mid.mix).toBeGreaterThan(0.3);
    expect(mid.mix).toBeLessThan(0.7);
  });

  it("never switches with a single scene or no sections", () => {
    expect(sceneAt(100, sections, { ...opts, sceneCount: 1 }).current).toBe(0);
    expect(sceneAt(100, new Float32Array(), opts)).toEqual({ current: 1, previous: -1, mix: 1 });
  });
});
