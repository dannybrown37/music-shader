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

  it.each([
    [{ overlay: { artMode: "badge", artSize: 1.5, showLyrics: false } }, "badge", 1.5, false],
    [{ overlay: { artMode: "sticker", artSize: 99 } }, "off", 2, true],
    [{ overlay: { artMode: 2, artSize: -1, showLyrics: "no" } }, "off", 0.3, true],
  ])("merges cover art and lyrics settings from %j", (patch, mode, size, lyrics) => {
    const out = mergeSettings(base, patch);
    expect(out.overlay.artMode).toBe(mode);
    expect(out.overlay.artSize).toBe(size);
    expect(out.overlay.showLyrics).toBe(lyrics);
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

  it.each([
    [{ autoCuts: false, autoCutIntensity: 0.5, autoCutBars: 8 }, false, 0.5, 8],
    [{ autoCutIntensity: 7, autoCutBars: 3 }, true, 1, 4],
    [{ autoCuts: 1, autoCutIntensity: -1, autoCutBars: "2" }, true, 0, 4],
  ])("merges beat-cut settings from %j", (patch, cuts, intensity, bars) => {
    const out = mergeSettings(base, patch);
    expect(out.autoCuts).toBe(cuts);
    expect(out.autoCutIntensity).toBe(intensity);
    expect(out.autoCutBars).toBe(bars);
  });

  it.each([
    [{ sectionLooks: 0.8 }, 0.8],
    [{ sectionLooks: 5 }, 1],
    [{ sectionLooks: "lots" }, defaultSettings().sectionLooks],
  ])("merges section look variation from %j", (patch, expected) => {
    expect(mergeSettings(base, patch).sectionLooks).toBe(expected);
  });

  it("does not mutate the base", () => {
    mergeSettings(base, { reactivity: { kick: 3 } });
    expect(base.reactivity.kick).toBe(defaultSettings().reactivity.kick);
  });
});
