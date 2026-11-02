import { describe, expect, it } from "vitest";
import { autoFootageCues, cameraAt, footageMixAt, parseFootageCues, popAt, toggleFootageCue } from "./footage.ts";
import type { FootageCue, FootagePlanInput } from "./footage.ts";

const bars = (n: number, bar = 2): Float32Array => Float32Array.from({ length: n }, (_, i) => i * bar);

/** 120 s song, bar = 2 s, sections every 20 s, intensity set per section. */
function song(levels: number[], drops: number[] = []): FootagePlanInput {
  const fps = 10;
  const duration = levels.length * 20;
  const intensity = new Float32Array(duration * fps);
  levels.forEach((v, i) => intensity.fill(v, i * 20 * fps, (i + 1) * 20 * fps));
  return {
    duration,
    fps,
    intensity,
    sections: Float32Array.from(levels.slice(1).map((_, i) => (i + 1) * 20)),
    drops: Float32Array.from(drops),
    downbeats: bars(duration / 2),
  };
}

const options = { cameraShare: 0.4, fadeBars: 1, intro: 8 };

describe("footageMixAt", () => {
  const cues: FootageCue[] = [
    { time: 0, camera: true, fade: 0 },
    { time: 10, camera: false, fade: 2 },
    { time: 20, camera: true, fade: 1 },
  ];
  it.each([
    [0, 0],
    [7.9, 0],
    // The fade ends on the cue, so the scene has fully arrived when the section lands.
    [8, 0],
    [9, 0.5],
    [10, 1],
    [19, 1],
    [19.5, 0.5],
    [25, 0],
  ])("at %f s the shader weighs %f", (t, mix) => {
    expect(footageMixAt(t, cues)).toBeCloseTo(mix, 3);
  });

  it("is all shader without cues", () => {
    expect(footageMixAt(5, [])).toBe(1);
  });

  it("eases rather than moving linearly", () => {
    expect(footageMixAt(8.5, cues)).toBeLessThan(0.25);
  });
});

describe("autoFootageCues", () => {
  it("opens on the camera", () => {
    const cues = autoFootageCues(song([0.9, 0.9, 0.9, 0.9, 0.9, 0.9]), { ...options, cameraShare: 0 });
    expect(cameraAt(0, cues)).toBe(true);
    expect(cameraAt(30, cues)).toBe(false);
  });

  it.each([
    [0, 0.2],
    [0.5, 0.5],
    [1, 1],
  ])("camera share %f puts about %f of the song on camera", (cameraShare, expected) => {
    const input = song([0.1, 0.8, 0.3, 0.9, 0.2, 0.7]);
    const cues = autoFootageCues(input, { ...options, cameraShare });
    let onCamera = 0;
    for (let t = 0; t < input.duration; t += 0.5) if (cameraAt(t, cues)) onCamera += 0.5;
    expect(onCamera / input.duration).toBeCloseTo(expected, 1);
  });

  it("keeps the quietest sections on camera and the loudest on the shader", () => {
    const cues = autoFootageCues(song([0.5, 0.9, 0.1, 0.95, 0.15, 0.8]), options);
    expect([10, 30, 50, 70, 90, 110].map((t) => cameraAt(t, cues))).toEqual([true, false, true, false, true, false]);
  });

  it("slams into the shader on a drop", () => {
    const cues = autoFootageCues(song([0.2, 0.2, 0.2, 0.9, 0.9, 0.2], [61]), { ...options, cameraShare: 0.6 });
    const drop = cues.find((c) => !c.camera && c.time > 50);
    expect(drop?.time).toBe(61);
    expect(drop?.fade).toBeLessThan(0.5);
    expect(footageMixAt(60.5, cues)).toBe(0);
    expect(footageMixAt(61, cues)).toBe(1);
  });

  it("lands changes on downbeats, fading over the set bars", () => {
    const input = { ...song([0.1, 0.9, 0.1]), sections: Float32Array.from([20.7, 40.3]) };
    const cues = autoFootageCues(input, { ...options, cameraShare: 0.6, fadeBars: 2 });
    expect(cues.slice(1).map((c) => c.time)).toEqual([20, 40]);
    expect(cues.slice(1).map((c) => c.fade)).toEqual([4, 4]);
  });

  it("never emits two cues in a row with the same state", () => {
    const cues = autoFootageCues(song([0.1, 0.1, 0.9, 0.9, 0.1, 0.1]), options);
    for (let i = 1; i < cues.length; i++) expect(cues[i].camera).not.toBe(cues[i - 1].camera);
  });
});

describe("popAt", () => {
  const changes = [10, 30];
  it.each([
    [0, 0],
    [8.9, 0],
    // Rises over `before` seconds into the change, then fades over `after`.
    [9.5, 0.5],
    [10, 1],
    [11, 0.5],
    [12, 0],
    [30, 1],
    [40, 0],
  ])("at %f s pops %f", (t, expected) => {
    expect(popAt(t, changes, 1, 2)).toBeCloseTo(expected, 3);
  });
  it("is zero without changes", () => {
    expect(popAt(5, [], 1, 2)).toBe(0);
  });
});

describe("toggleFootageCue", () => {
  const auto: FootageCue[] = [
    { time: 0, camera: true, fade: 0 },
    { time: 20, camera: false, fade: 2 },
  ];
  it("adds a cue that flips what's on screen, snapped to the bar", () => {
    const cues = toggleFootageCue(auto, 30.6, bars(60), 2);
    expect(cues.at(-1)).toEqual({ time: 30, camera: true, fade: 2 });
  });
  it("removes a cue at the same bar instead of stacking", () => {
    expect(toggleFootageCue(auto, 20.4, bars(60), 2)).toEqual([{ time: 0, camera: true, fade: 0 }]);
  });
});

describe("parseFootageCues", () => {
  it.each([
    [null, []],
    ["junk", []],
    [[{ time: 5, camera: true, fade: 1 }, { time: "x" }, { time: 1, camera: false, fade: -3 }], [
      { time: 1, camera: false, fade: 0 },
      { time: 5, camera: true, fade: 1 },
    ]],
  ])("%j → %j", (raw, expected) => {
    expect(parseFootageCues(raw)).toEqual(expected);
  });
});
