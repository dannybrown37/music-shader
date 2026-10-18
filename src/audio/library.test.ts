import { describe, expect, it } from "vitest";
import { titleFromFilename } from "./library.ts";

describe("titleFromFilename", () => {
  it.each([
    ["Haus of You [2019, edm].mp3", "Haus of You", "2019 · edm"],
    ["Inspirational Robots (were created by people) [2025, edm].mp3", "Inspirational Robots (were created by people)", "2025 · edm"],
    ["plain-song.wav", "plain-song", ""],
    ["Odd [ , ].flac", "Odd", ""],
  ])("%s → %s / %s", (name, title, subtitle) => {
    expect(titleFromFilename(name)).toEqual({ title, subtitle });
  });
});
