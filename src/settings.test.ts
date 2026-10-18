import { describe, expect, it } from "vitest";
import { defaultSettings, mergeSettings } from "./settings.ts";

describe("mergeSettings", () => {
  const base = defaultSettings();

  it.each([null, 42, "x", [1, 2]])("returns a copy of the defaults for %j", (patch) => {
    const out = mergeSettings(base, patch);
    expect(out).toEqual(base);
    expect(out).not.toBe(base);
  });

  it("overrides known numbers and keeps the rest", () => {
    const out = mergeSettings(base, { reactivity: { kick: 2.5 }, look: { bloom: 0 } });
    expect(out.reactivity.kick).toBe(2.5);
    expect(out.reactivity.snare).toBe(base.reactivity.snare);
    expect(out.look.bloom).toBe(0);
  });

  it.each([
    [{ reactivity: { kick: "loud" } }],
    [{ reactivity: { kick: Number.NaN } }],
    [{ reactivity: { madeUp: 3 } }],
    [{ scene: 7 }],
    [{ overlay: { showTitle: "yes" } }],
  ])("drops invalid input %j", (patch) => {
    expect(mergeSettings(base, patch)).toEqual(base);
  });

  it("accepts arbitrary scene param keys since scenes define their own", () => {
    const out = mergeSettings(base, { sceneParams: { nebula: { swirl: 0.4, bad: "x" } } });
    expect(out.sceneParams.nebula).toEqual({ swirl: 0.4 });
  });

  it.each([
    [{ autoScenes: true, autoSceneSeconds: 30 }, true, 30],
    [{ autoSceneSeconds: 1 }, false, 4],
    [{ autoScenes: "yes", autoSceneSeconds: Number.POSITIVE_INFINITY }, false, 24],
  ])("merges auto-scene settings from %j", (patch, enabled, seconds) => {
    const out = mergeSettings(base, patch);
    expect(out.autoScenes).toBe(enabled);
    expect(out.autoSceneSeconds).toBe(seconds);
  });

  it("does not mutate the base", () => {
    mergeSettings(base, { reactivity: { kick: 3 } });
    expect(base.reactivity.kick).toBe(defaultSettings().reactivity.kick);
  });
});
