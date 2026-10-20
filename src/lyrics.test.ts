import { describe, expect, it } from "vitest";
import { lyricAt, parseLrc } from "./lyrics.ts";

const LRC = `[ti:Example]
[ar:Someone]
[00:01.00]First line
[00:04.50]Second line
[00:10.00][00:20.00]Chorus
[00:12.000]
not a lyric line
[00:30.25] trailing spaces   `;

describe("parseLrc", () => {
  it("reads timed lines in order, skipping tags and junk", () => {
    expect(parseLrc(LRC)).toEqual([
      { t: 1, text: "First line" },
      { t: 4.5, text: "Second line" },
      { t: 10, text: "Chorus" },
      { t: 12, text: "" },
      { t: 20, text: "Chorus" },
      { t: 30.25, text: "trailing spaces" },
    ]);
  });

  it.each([
    ["[offset:+500]", 0.5],
    ["[offset:-250]", -0.25],
  ])("applies %s (positive = lyrics come earlier)", (tag, shift) => {
    expect(parseLrc(`${tag}\n[00:02.00]Hi`)[0].t).toBeCloseTo(2 - shift, 5);
  });

  it.each([
    ["[1:02.5]x", 62.5],
    ["[01:02]x", 62],
    ["[61:00.00]x", 3660],
  ])("parses the timestamp in %s", (line, t) => {
    expect(parseLrc(line)[0].t).toBeCloseTo(t, 5);
  });

  it("caps line length and count", () => {
    const long = `[00:01.00]${"x".repeat(1000)}`;
    expect(parseLrc(long)[0].text.length).toBe(200);
    const many = Array.from({ length: 6000 }, (_, i) => `[00:${String(i % 60).padStart(2, "0")}.00]l`).join("\n");
    expect(parseLrc(many).length).toBe(5000);
  });

  it("returns nothing for text with no timestamps", () => {
    expect(parseLrc("just some words\nmore words")).toEqual([]);
  });
});

describe("lyricAt", () => {
  const lines = parseLrc(LRC);

  it.each([
    [0.5, "", 0],
    [1.0, "First line", 0],
    [1.1, "First line", 0.5],
    [3, "First line", 1],
    [4.4, "First line", 0.5],
    [5, "Second line", 1],
    [12.5, "", 0],
    [21, "Chorus", 1],
  ])("at %f s shows %j at alpha %f", (t, text, alpha) => {
    const l = lyricAt(t, lines);
    expect(l.text).toBe(text);
    expect(l.alpha).toBeCloseTo(alpha, 1);
  });

  it("fades a line out after a long hold even if the next line is far away", () => {
    expect(lyricAt(29, lines).alpha).toBe(0);
  });
});
