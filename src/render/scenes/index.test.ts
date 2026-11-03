import { describe, expect, it } from "vitest";
import { SCENES, vjScenes } from "./index.ts";

const everyVj = SCENES.filter((s) => s.autoVj !== false).map((s) => s.id);

describe("vjScenes", () => {
  it.each([
    [[], everyVj],
    [["orb", "tunnel"], ["tunnel", "orb"].sort((a, b) => everyVj.indexOf(a) - everyVj.indexOf(b))],
    [["portrait", "orb"], ["orb"]],
    [["nope"], everyVj],
    [["portrait"], everyVj],
  ])("picks %j → %j", (picked, want) => {
    expect(vjScenes(picked).map((s) => s.id)).toEqual(want);
  });
});
