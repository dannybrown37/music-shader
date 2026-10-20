import { describe, expect, it } from "vitest";
import { cuesFromSchedule, moveCue, parseShow, removeCue, setCue, showAt, snapToBar } from "./show.ts";
import type { Cue } from "./show.ts";

const base = { scene: "nebula", palette: "Ember" };
const timing = { fade: 2, lead: 1 };
const cues: Cue[] = [
  { t: 10, scene: "tunnel", palette: null, cut: true },
  { t: 20, scene: "orb", palette: "Ice", cut: false },
  { t: 30, scene: "terrain", palette: null, cut: true },
];

describe("showAt", () => {
  it.each([
    [0, "nebula", "Ember", null, 1],
    [9.99, "nebula", "Ember", null, 1],
    [10, "tunnel", "Ember", null, 1],
    [18.9, "tunnel", "Ember", null, 1],
    // The fade into orb starts `lead` early so it lands on t = 20, and lasts `fade`.
    [19, "orb", "Ice", "tunnel", 0],
    [20, "orb", "Ice", "tunnel", 0.5],
    [21, "orb", "Ice", null, 1],
    [30, "terrain", "Ember", null, 1],
  ])("at %f s shows %s in %s (fading from %s, mix %f)", (t, scene, palette, from, mix) => {
    const s = showAt(t, cues, base, timing);
    expect(s.scene).toBe(scene);
    expect(s.palette).toBe(palette);
    expect(s.from?.scene ?? null).toBe(from);
    expect(s.mix).toBeCloseTo(mix, 3);
  });

  it("fades in from the base scene before the first cue", () => {
    const s = showAt(4.5, [{ t: 5, scene: "orb", palette: null, cut: false }], base, timing);
    expect(s.scene).toBe("orb");
    expect(s.from).toEqual(base);
  });

  it("shows the base scene with no cues", () => {
    expect(showAt(50, [], base, timing)).toEqual({ ...base, from: null, mix: 1 });
  });
});

describe("editing cues", () => {
  it("adds a cue in time order", () => {
    const next = setCue(cues, { t: 15, scene: "kaleido", palette: null, cut: true });
    expect(next.map((c) => c.t)).toEqual([10, 15, 20, 30]);
    expect(cues).toHaveLength(3);
  });

  it("replaces a cue at (almost) the same time instead of stacking two", () => {
    const next = setCue(cues, { t: 20.02, scene: "kaleido", palette: null, cut: true });
    expect(next.map((c) => c.scene)).toEqual(["tunnel", "kaleido", "terrain"]);
  });

  it("removes the cue at a time", () => {
    expect(removeCue(cues, 20).map((c) => c.t)).toEqual([10, 30]);
  });

  it("moves a cue and keeps the list sorted", () => {
    expect(moveCue(cues, 10, 25).map((c) => [c.t, c.scene])).toEqual([
      [20, "orb"],
      [25, "tunnel"],
      [30, "terrain"],
    ]);
  });

  it.each([
    [9.1, 10],
    [11.4, 12],
    [0.4, 0],
    [17.5, 17.5],
  ])("snaps %f s to the nearest downbeat within half a bar (%f)", (t, expected) => {
    expect(snapToBar(t, [0, 2, 4, 6, 8, 10, 12, 14])).toBeCloseTo(expected, 5);
  });
});

describe("cuesFromSchedule", () => {
  it("turns Auto VJ events into cues that land where the scenes change", () => {
    const events = [
      { time: 9, cut: false },
      { time: 20, cut: true },
    ];
    expect(cuesFromSchedule(events, ["a", "b", "c"], 1, 1)).toEqual([
      { t: 10, scene: "c", palette: null, cut: false },
      { t: 20, scene: "a", palette: null, cut: true },
    ]);
  });
});

describe("parseShow", () => {
  it("keeps valid cues, sorted", () => {
    const raw = { cues: [cues[2], cues[0], cues[1]] };
    expect(parseShow(raw)).toEqual(cues);
  });

  it.each([
    ["not an object", 42],
    ["no cue list", { foo: 1 }],
    ["a cue list that isn't an array", { cues: "nope" }],
  ])("returns no cues for %s", (_, raw) => {
    expect(parseShow(raw)).toEqual([]);
  });

  it.each([
    ["negative time", { t: -1, scene: "orb", palette: null, cut: true }],
    ["non-finite time", { t: Infinity, scene: "orb", palette: null, cut: true }],
    ["missing scene", { t: 1, palette: null, cut: true }],
    ["non-string palette", { t: 1, scene: "orb", palette: 3, cut: true }],
    ["non-boolean cut", { t: 1, scene: "orb", palette: null, cut: "yes" }],
    ["absurdly long scene id", { t: 1, scene: "x".repeat(200), palette: null, cut: true }],
  ])("drops a cue with %s", (_, cue) => {
    expect(parseShow({ cues: [cue, cues[0]] })).toEqual([cues[0]]);
  });

  it("caps the number of cues", () => {
    const many = Array.from({ length: 5000 }, (_, i) => ({ t: i, scene: "orb", palette: null, cut: true }));
    expect(parseShow({ cues: many }).length).toBe(1000);
  });
});
