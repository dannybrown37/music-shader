import { describe, expect, it } from "vitest";
import { buildSchedule, sceneAt } from "./schedule.ts";
import type { ScheduleEvent, ScheduleOptions } from "./schedule.ts";

const sections = Float32Array.from([10, 15, 40, 70, 75]);
const noBars = { times: new Float32Array(), intensity: new Float32Array() };
const fades: ScheduleOptions = { minSeconds: 20, lead: 0.75, cuts: false, cutIntensity: 0.75, cutBars: 4, lookahead: true };
const show = { sceneCount: 4, start: 1, fade: 1.5 };

/** A bar every 2 s from 0 to 98 s; loud (0.9) from 30 s to 50 s, quiet (0.3) elsewhere. */
const bars = (() => {
  const times = Float32Array.from({ length: 50 }, (_, i) => 2 * i);
  return { times, intensity: Float32Array.from(times, (t) => (t >= 30 && t <= 50 ? 0.9 : 0.3)) };
})();

const timesOf = (events: ScheduleEvent[], cut: boolean): number[] => events.filter((e) => e.cut === cut).map((e) => e.time);

describe("sceneAt with crossfades only", () => {
  const events = buildSchedule(sections, noBars, fades);

  it.each([
    [0, 1, -1, 1],
    [9, 1, -1, 1],
    [12, 2, -1, 1],
    [30, 2, -1, 1],
    [45, 3, -1, 1],
    [80, 0, -1, 1],
    [40, 3, 2, 0.5],
  ])("at t=%f shows scene %i (fading from %i, mix %f)", (t, current, previous, mix) => {
    const s = sceneAt(t, events, show);
    expect(s.current).toBe(current);
    expect(s.previous).toBe(previous);
    expect(s.mix).toBeCloseTo(mix, 3);
  });

  it("skips sections closer than minSeconds to the last switch", () => {
    // 15 is 5 s after 10, and 75 is 5 s after 70: neither switches.
    expect(sceneAt(16, events, show).current).toBe(2);
    expect(sceneAt(76, events, show).current).toBe(0);
  });

  it("starts the crossfade `lead` seconds before the section so the new scene lands on it", () => {
    const before = sceneAt(10 - 0.75, events, show);
    expect(before.current).toBe(2);
    expect(before.mix).toBeCloseTo(0, 3);
    const mid = sceneAt(10, events, show);
    expect(mid.mix).toBeGreaterThan(0.3);
    expect(mid.mix).toBeLessThan(0.7);
  });

  it("never switches with a single scene or no sections", () => {
    expect(sceneAt(100, events, { ...show, sceneCount: 1 }).current).toBe(0);
    expect(sceneAt(100, buildSchedule(new Float32Array(), noBars, fades), show)).toEqual({ current: 1, previous: -1, mix: 1 });
  });
});

describe("buildSchedule with beat-synced cuts", () => {
  const cuts = { ...fades, cuts: true };
  const events = buildSchedule(sections, bars, cuts);

  it("turns a section change in a loud part into a cut on the nearest downbeat", () => {
    expect(timesOf(events, true)).toContain(40);
    expect(timesOf(events, false)).not.toContain(40 - 0.75);
  });

  it("keeps crossfades for section changes in quiet parts", () => {
    expect(timesOf(events, false)).toEqual([10 - 0.75, 70 - 0.75]);
  });

  it("adds a cut every cutBars bars while loud, on the phrase grid that ends at the next section", () => {
    // Bars are 2 s, so 4 bars = 8 s: 32 is 8 s before the section cut at 40, and 48 is 8 s after it.
    expect(timesOf(events, true)).toEqual([32, 40, 48]);
  });

  it.each([
    [2, [32, 36, 40, 44, 48]],
    [8, [40]],
  ])("with cutBars %i cuts at %j", (cutBars, expected) => {
    expect(timesOf(buildSchedule(sections, bars, { ...cuts, cutBars }), true)).toEqual(expected);
  });

  it("falls back to a crossfade when there are no downbeats to snap to", () => {
    expect(timesOf(buildSchedule(sections, noBars, cuts), true)).toEqual([]);
  });

  it("switches instantly on a cut", () => {
    expect(sceneAt(39.99, events, show).current).not.toBe(sceneAt(40, events, show).current);
    expect(sceneAt(40, events, show)).toMatchObject({ previous: -1, mix: 1 });
  });

  it("doesn't rewrite the past when later sections arrive (live input grows the lists)", () => {
    const live = { ...cuts, lookahead: false };
    const early = buildSchedule(sections.subarray(0, 3), bars, live);
    const later = buildSchedule(sections, bars, live);
    expect(later.filter((e) => e.time < 60)).toEqual(early.filter((e) => e.time < 60));
  });
});
