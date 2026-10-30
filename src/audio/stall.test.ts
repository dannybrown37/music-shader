import { describe, expect, it } from "vitest";
import { silenceToFill, STALL_GRACE_MS, MAX_FILL_SECONDS } from "./stall.ts";

const SR = 48000;

describe("silenceToFill", () => {
  it.each([
    ["chunks arriving normally", 20, 0],
    ["just inside the grace period", STALL_GRACE_MS, 0],
    ["stalled for half a second", 500, SR * 0.5],
    ["stalled for one second", 1000, SR],
    ["backgrounded for a minute (capped)", 60_000, SR * MAX_FILL_SECONDS],
    ["clock went backwards", -100, 0],
  ])("%s", (_name, gapMs, expected) => {
    expect(silenceToFill(10_000 + gapMs, 10_000, SR)).toBe(expected);
  });
});

describe("silenceToFill once already stalled", () => {
  it.each([
    [0, 0],
    [100, SR * 0.1],
  ])("gap %ims fills without waiting out the grace period", (gapMs, expected) => {
    expect(silenceToFill(10_000 + gapMs, 10_000, SR, 0)).toBe(expected);
  });
});
