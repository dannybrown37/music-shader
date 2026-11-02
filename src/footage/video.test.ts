import { describe, expect, it } from "vitest";
import { isVideoFile } from "./video.ts";

describe("isVideoFile", () => {
  it.each([
    ["synths.mp4", "", true],
    ["take.MOV", "", true],
    ["clip", "video/webm", true],
    ["song.mp3", "audio/mpeg", false],
    ["song.m4a", "audio/mp4", false],
  ])("%s (%s) → %s", (name, type, expected) => {
    expect(isVideoFile({ name, type })).toBe(expected);
  });
});
