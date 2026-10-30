import { describe, expect, it } from "vitest";
import { availableSources, classifyGesture, stepScene } from "./gestures.ts";

describe("stepScene", () => {
  it.each([
    ["next", "b", 1, "c"],
    ["wraps forward", "c", 1, "a"],
    ["wraps back", "a", -1, "c"],
    ["unknown counts as first", "zzz", 1, "b"],
  ])("%s", (_name, current, step, expected) => {
    expect(stepScene(["a", "b", "c"], current, step)).toBe(expected);
  });
});

describe("classifyGesture", () => {
  it.each([
    ["short still press is a tap", { dx: 2, dy: -3, ms: 150 }, "tap"],
    ["long press is nothing", { dx: 0, dy: 0, ms: 900 }, "none"],
    ["fast left swipe goes to the next scene", { dx: -120, dy: 10, ms: 220 }, "next"],
    ["fast right swipe goes to the previous scene", { dx: 110, dy: -20, ms: 260 }, "prev"],
    ["mostly vertical drag is not a swipe", { dx: -80, dy: 140, ms: 250 }, "none"],
    ["short drag is not a swipe", { dx: -30, dy: 0, ms: 200 }, "none"],
    ["slow drag is not a swipe", { dx: -200, dy: 0, ms: 1500 }, "none"],
  ])("%s", (_name, g, expected) => {
    expect(classifyGesture(g)).toBe(expected);
  });
});

describe("availableSources", () => {
  it.each([
    ["desktop Chrome", { mic: true, display: true, coarse: false }, ["mic", "file", "tab"]],
    ["phone: no tab capture even if the API exists", { mic: true, display: true, coarse: true }, ["mic", "file"]],
    ["insecure page: no mic", { mic: false, display: false, coarse: false }, ["file"]],
  ])("%s", (_name, caps, expected) => {
    expect(availableSources(caps)).toEqual(expected);
  });
});
