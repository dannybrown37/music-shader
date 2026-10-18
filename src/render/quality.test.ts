import { describe, expect, it } from "vitest";
import { QualityGovernor } from "./quality.ts";

function run(g: QualityGovernor, frameSeconds: number, seconds: number, max = 1): number {
  let scale = g.scale;
  for (let t = 0; t < seconds; t += frameSeconds) scale = g.update(frameSeconds, max);
  return scale;
}

describe("QualityGovernor", () => {
  it("keeps full resolution when frames are fast", () => {
    expect(run(new QualityGovernor(1), 1 / 60, 10)).toBe(1);
  });

  it("drops resolution after sustained slow frames", () => {
    const g = new QualityGovernor(1);
    expect(run(g, 0.035, 1)).toBe(1);
    expect(run(g, 0.035, 2)).toBeLessThan(1);
  });

  it.each([0.05, 0.2])("never goes below the floor even at %f s per frame", (frame) => {
    expect(run(new QualityGovernor(1), frame, 120)).toBeGreaterThanOrEqual(0.35);
  });

  it("climbs back once frames are fast again, up to the user's maximum", () => {
    const g = new QualityGovernor(1);
    run(g, 0.04, 20);
    const low = g.scale;
    expect(run(g, 1 / 120, 120, 0.8)).toBe(0.8);
    expect(low).toBeLessThan(0.8);
  });

  it("follows the maximum down immediately when the user lowers it", () => {
    const g = new QualityGovernor(1);
    expect(g.update(1 / 60, 0.5)).toBe(0.5);
  });

  it("recovers on a 60 Hz display where frames never beat vsync", () => {
    const g = new QualityGovernor(1);
    run(g, 0.035, 2);
    expect(g.scale).toBeLessThan(1);
    expect(run(g, 1 / 60, 60)).toBe(1);
  });

  it("does not immediately retry a resolution that was too slow", () => {
    const g = new QualityGovernor(1);
    run(g, 0.035, 2);
    const dropped = g.scale;
    expect(run(g, 1 / 60, 10)).toBeLessThan(1);
    expect(dropped).toBeLessThan(1);
  });

  it("ignores single hitches", () => {
    const g = new QualityGovernor(1);
    run(g, 1 / 60, 2);
    g.update(0.1, 1);
    expect(run(g, 1 / 60, 2)).toBe(1);
  });
});
