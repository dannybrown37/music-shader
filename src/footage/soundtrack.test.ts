import { describe, expect, it } from "vitest";
import { pairVideoAndSoundtrack, soundtrackMismatch } from "./soundtrack.ts";

describe("soundtrackMismatch", () => {
  it.each([
    [190, 190, null],
    [190.04, 190, null],
    [189.95, 190, null],
    [190.2, 190, "The soundtrack is 3:10.2 but the video is 3:10.0; master it with Lead-in and Tail at 0"],
    [185, 190, "The soundtrack is 3:05.0 but the video is 3:10.0; master it with Lead-in and Tail at 0"],
    [190, Number.NaN, "Couldn't read the video's length"],
    [190, Number.POSITIVE_INFINITY, "Couldn't read the video's length"],
  ])("audio %s s vs video %s s → %s", (audio, video, expected) => {
    expect(soundtrackMismatch(audio, video)).toBe(expected);
  });
});

const f = (name: string, type = ""): { name: string; type: string } => ({ name, type });

describe("pairVideoAndSoundtrack", () => {
  it.each([
    ["video then wav", [f("take.mp4"), f("take-master.wav", "audio/wav")], ["take.mp4", "take-master.wav"]],
    ["wav then video", [f("m.wav"), f("t.mov")], ["t.mov", "m.wav"]],
    ["single video", [f("take.mp4")], null],
    ["single audio", [f("song.mp3")], null],
    ["two videos", [f("a.mp4"), f("b.mp4")], null],
    ["two audio", [f("a.wav"), f("b.mp3")], null],
    ["video + image", [f("a.mp4"), f("c.png", "image/png")], null],
    ["three files", [f("a.mp4"), f("b.wav"), f("c.wav")], null],
  ])("%s", (_label, files, expected) => {
    const pair = pairVideoAndSoundtrack(files);
    expect(pair && [pair.video.name, pair.soundtrack.name]).toEqual(expected);
  });
});
