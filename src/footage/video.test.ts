import { describe, expect, it } from "vitest";
import { isVideoFile, waitForMetadata } from "./video.ts";

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

describe("waitForMetadata", () => {
  const fakeVideo = (readyState = 0): EventTarget & { readyState: number } => Object.assign(new EventTarget(), { readyState });

  it.each([
    ["loadedmetadata", "resolves"],
    ["error", "rejects"],
  ])("%s event → %s", async (event, outcome) => {
    const v = fakeVideo();
    const p = waitForMetadata(v, 1000);
    v.dispatchEvent(new Event(event));
    if (outcome === "resolves") await expect(p).resolves.toBeUndefined();
    else await expect(p).rejects.toThrow(/can't play/);
  });

  it("resolves at once when metadata is already there", async () => {
    await expect(waitForMetadata(fakeVideo(1), 1000)).resolves.toBeUndefined();
  });

  it("rejects instead of hanging when the browser never answers", async () => {
    await expect(waitForMetadata(fakeVideo(), 10)).rejects.toThrow(/didn't open/);
  });
});
