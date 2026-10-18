import { describe, expect, it } from "vitest";
import { extensionFor, pickRecorderMime, recorderBitrate } from "./recorder.ts";

describe("pickRecorderMime", () => {
  it.each([
    ["MP4 with H.264 + AAC when supported", (m: string) => m.startsWith("video/mp4"), "video/mp4;codecs=avc1.640028,mp4a.40.2"],
    ["VP9 WebM otherwise", (m: string) => m.includes("vp9"), "video/webm;codecs=vp9,opus"],
    ["plain WebM as a last resort", (m: string) => m === "video/webm", "video/webm"],
    ["nothing when recording is unsupported", () => false, null],
  ])("prefers %s", (_, isSupported, expected) => {
    expect(pickRecorderMime(isSupported)).toBe(expected);
  });
});

describe("extensionFor", () => {
  it.each([
    ["video/mp4;codecs=avc1.640028,mp4a.40.2", "mp4"],
    ["video/webm;codecs=vp9,opus", "webm"],
  ])("%s saves as .%s", (mime, ext) => {
    expect(extensionFor(mime)).toBe(ext);
  });
});

describe("recorderBitrate", () => {
  it.each([
    [1920, 1080, 60, 14_929_920],
    [3840, 2160, 60, 40_000_000],
    [320, 180, 30, 4_000_000],
  ])("%ix%i at %i fps gets %i bit/s", (w, h, fps, expected) => {
    expect(recorderBitrate(w, h, fps)).toBe(expected);
  });
});
