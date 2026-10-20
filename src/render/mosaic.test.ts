import { describe, expect, it } from "vitest";
import { createFeatures } from "../analysis/sampler.ts";
import {
  DRAIN_SECONDS,
  FRAME_ASPECT,
  GAP,
  LiveMosaicFeed,
  MAX_SHAPES,
  MAX_WAIT,
  MosaicPlanner,
  SECTION_MIN_SHAPES,
  shapeGeometry,
  TEXELS_PER_SHAPE,
} from "./mosaic.ts";
import type { MosaicEvent, ShapeKind, Timbre } from "./mosaic.ts";

const FLAT: Timbre = { brightness: 0.5, noisiness: 0.5, tonalness: 0.5, timbreX: 0, timbreY: 0 };

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

/** A steady groove: `rate` shape events per second, downbeats every 2 s. */
function groove(seed: number, rate: number, seconds: number): MosaicEvent[] {
  const r = rng(seed);
  const kinds: ShapeKind[] = ["kick", "snare", "note", "note"];
  const out: MosaicEvent[] = [];
  for (let t = 0.1; t < seconds; t += (0.5 + r()) / rate) {
    out.push({ kind: kinds[Math.floor(r() * kinds.length)], time: t, strength: 0.4 + r(), timbre: { ...FLAT, brightness: r(), noisiness: r() }, pitch: Math.floor(r() * 12) });
  }
  for (let t = 0; t < seconds; t += 2) out.push({ kind: "downbeat", time: t + 0.05, strength: 1 });
  return out.sort((a, b) => a.time - b.time);
}

function plan(events: MosaicEvent[], size = 1): MosaicPlanner {
  const p = new MosaicPlanner({ size });
  for (const e of events) p.push(e);
  return p;
}

describe("MosaicPlanner packing", () => {
  it.each([
    ["sparse", 3, 1],
    ["busy", 12, 1],
    ["busy, big shapes", 12, 2],
    ["frantic, small shapes", 30, 0.5],
  ])("never overlaps and stays inside the frame (%s)", (_, rate, size) => {
    for (let seed = 1; seed <= 4; seed++) {
      const p = plan(groove(seed, rate, 90), size);
      let worst = Infinity;
      for (const c of p.cycles) {
        expect(c.shapes.length).toBeLessThanOrEqual(MAX_SHAPES);
        for (const [i, a] of c.shapes.entries()) {
          worst = Math.min(worst, FRAME_ASPECT - Math.abs(a.x) - a.r, 1 - Math.abs(a.y) - a.r);
          for (const b of c.shapes.slice(i + 1)) worst = Math.min(worst, Math.hypot(a.x - b.x, a.y - b.y) - a.r - b.r - GAP);
        }
      }
      expect(worst).toBeGreaterThanOrEqual(-1e-9);
    }
  });

  it("gives louder hits bigger shapes while there is room", () => {
    const p = plan([
      { kind: "note", time: 0, strength: 0.3, timbre: FLAT },
      { kind: "note", time: 0.1, strength: 1.2, timbre: FLAT },
    ]);
    const [quiet, loud] = p.cycles[0].shapes;
    expect(loud.r).toBeGreaterThan(quiet.r);
  });

  it("is deterministic", () => {
    const a = plan(groove(7, 10, 60));
    const b = plan(groove(7, 10, 60));
    expect(b.cycles).toEqual(a.cycles);
  });
});

describe("MosaicPlanner cycles", () => {
  it("fills up, drains and starts over", () => {
    const p = plan(groove(3, 12, 120));
    expect(p.cycles.length).toBeGreaterThan(2);
    for (const [i, c] of p.cycles.entries()) {
      if (i === p.cycles.length - 1) break;
      expect(c.shapes.length).toBeGreaterThan(20);
      expect(p.cycles[i + 1].start).toBeCloseTo(c.drainStart + DRAIN_SECONDS);
      for (const s of c.shapes) expect(s.birth).toBeLessThan(c.drainStart);
    }
  });

  it.each([0.8, 2, 6, 15])("fills within ~30 s however busy the music is (%f hits/s)", (rate) => {
    const p = plan(groove(11, rate, 120).filter((e) => e.kind !== "section"));
    expect(p.cycles[0].fullAt).toBeLessThan(35);
    expect(p.cycles[0].fullAt).toBeGreaterThan(4);
  });

  it("drains on the first downbeat after it fills", () => {
    const p = plan(groove(5, 12, 60));
    const c = p.cycles[0];
    expect(c.fullAt).toBeLessThan(c.drainStart);
    const downbeats = groove(5, 12, 60).filter((e) => e.kind === "downbeat" && e.time >= c.fullAt);
    expect(c.drainStart).toBeCloseTo(downbeats[0].time);
  });

  it("drains after MAX_WAIT when no downbeat comes", () => {
    const p = plan(groove(5, 12, 60).filter((e) => e.kind !== "downbeat"));
    const c = p.cycles[0];
    expect(c.drainStart).toBeCloseTo(c.fullAt + MAX_WAIT);
  });

  it.each([
    [SECTION_MIN_SHAPES - 1, false],
    [SECTION_MIN_SHAPES, true],
  ])("a section change with %i shapes drains: %s", (n, drains) => {
    const events: MosaicEvent[] = Array.from({ length: n }, (_, i) => ({ kind: "note", time: i * 0.1, strength: 0.3, timbre: FLAT }));
    events.push({ kind: "section", time: n * 0.1 + 0.05, strength: 1 });
    const p = plan(events);
    p.advance(100);
    expect(p.cycles[0].drainStart === n * 0.1 + 0.05).toBe(drains);
  });

  it("ignores hits while draining", () => {
    const p = plan(groove(3, 12, 120));
    const [a] = p.cycles;
    expect(p.cycles[1].shapes.every((s) => s.birth >= a.drainStart + DRAIN_SECONDS)).toBe(true);
  });
});

describe("MosaicPlanner strikes", () => {
  /** Planned only up to the hit that filled the frame, so later pushes land in the full cycle. */
  const fullPlan = (): MosaicPlanner => {
    const events = groove(5, 12, 60).filter((e) => e.kind !== "downbeat");
    const fullAt = plan(events).cycles[0].fullAt;
    return plan(events.filter((e) => e.time <= fullAt));
  };

  it("re-strikes the closest matching shape of the same kind for every hit while full", () => {
    const p = fullPlan();
    const c = p.cycles[0];
    const snare: MosaicEvent = { kind: "snare", time: c.fullAt + 0.5, strength: 1, timbre: { ...FLAT, brightness: 1, noisiness: 1, tonalness: 0 } };
    p.push(snare);
    const struck = c.strikes[c.strikes.length - 1];
    expect(struck.time).toBe(snare.time);
    const target = shapeGeometry("snare", snare.timbre ?? FLAT);
    const cost = (i: number): number => {
      const s = c.shapes[i];
      return Math.abs(s.points - target.points) / 6 + Math.abs(s.spike - target.spike) + Math.abs(s.round - target.round);
    };
    expect(c.shapes[struck.shape].kind).toBe("snare");
    for (const [i, s] of c.shapes.entries()) if (s.kind === "snare") expect(cost(struck.shape)).toBeLessThanOrEqual(cost(i));
  });

  it("strikes on the hit that found the frame full", () => {
    const c = fullPlan().cycles[0];
    expect(c.strikes[0].time).toBe(c.fullAt);
  });

  it("reports how long ago each shape was struck", () => {
    const p = fullPlan();
    const c = p.cycles[0];
    const { time, shape } = c.strikes[0];
    const out = new Float32Array(MAX_SHAPES * TEXELS_PER_SHAPE * 4);
    p.visible(time - 1e-3, out);
    expect(out[shape * TEXELS_PER_SHAPE * 4 + 14]).toBe(-1);
    p.visible(time + 0.25, out);
    expect(out[shape * TEXELS_PER_SHAPE * 4 + 14]).toBeCloseTo(0.25, 4);
  });
});

describe("MosaicPlanner.visible", () => {
  it("shows a cycle's shapes as they are born and none once it has drained", () => {
    const p = plan(groove(3, 12, 120));
    const [a, b] = p.cycles;
    const out = new Float32Array(MAX_SHAPES * TEXELS_PER_SHAPE * 4);
    const mid = a.shapes[10].birth + 1e-3;
    expect(p.visible(mid, out)).toBe(11);
    expect(p.visible(a.drainStart + DRAIN_SECONDS - 1e-3, out)).toBe(a.shapes.length);
    expect(p.visible(b.start + 1e-4, out)).toBe(b.shapes.filter((s) => s.birth <= b.start + 1e-4).length);
  });

  it("gives the same answer queried live (interleaved) as from a full plan", () => {
    const events = groove(9, 12, 60);
    const full = plan(events);
    const live = new MosaicPlanner({ size: 1 });
    const a = new Float32Array(MAX_SHAPES * TEXELS_PER_SHAPE * 4);
    const b = new Float32Array(MAX_SHAPES * TEXELS_PER_SHAPE * 4);
    let next = 0;
    let mismatches = 0;
    for (let t = 0; t < 60; t += 1 / 30) {
      while (next < events.length && events[next].time <= t) live.push(events[next++]);
      const n = live.visible(t, b);
      if (n !== full.visible(t, a) || b.some((v, i) => v !== a[i])) mismatches++;
    }
    expect(mismatches).toBe(0);
  });
});

describe("shapeGeometry", () => {
  it.each([
    ["noisier is spikier", { noisiness: 0.1 }, { noisiness: 0.9 }, "spike"],
    ["tonal is rounder", { tonalness: 0.1 }, { tonalness: 0.9 }, "round"],
    ["brighter has more points", { brightness: 0.1 }, { brightness: 0.9 }, "points"],
  ] as const)("%s", (_, lo, hi, field) => {
    expect(shapeGeometry("note", { ...FLAT, ...hi })[field]).toBeGreaterThan(shapeGeometry("note", { ...FLAT, ...lo })[field]);
  });

  it("gives kicks rounder shapes than snares for the same sound", () => {
    expect(shapeGeometry("kick", FLAT).round).toBeGreaterThan(shapeGeometry("snare", FLAT).round);
  });
});

describe("LiveMosaicFeed", () => {
  it("pushes each event once, oldest first, across frames", () => {
    const f = createFeatures();
    const pushed: MosaicEvent[] = [];
    const feed = new LiveMosaicFeed();
    const sink = { push: (e: MosaicEvent): void => void pushed.push(e) };
    const hit = (kind: "kick" | "note", time: number): void => {
      const r = f.recent[kind];
      r.copyWithin(2, 0, r.length - 2);
      r[0] = f.time - time;
      r[1] = 0.8;
      f.count[kind]++;
    };
    f.time = 1;
    feed.update(f, sink);
    hit("kick", 0.9);
    hit("note", 0.95);
    feed.update(f, sink);
    f.time = 1.1;
    for (let i = 0; i < 16; i++) f.recent.kick[2 * i] += 0.1;
    for (let i = 0; i < 16; i++) f.recent.note[2 * i] += 0.1;
    hit("kick", 1.05);
    feed.update(f, sink);
    feed.update(f, sink);
    expect(pushed.map((e) => [e.kind, Number(e.time.toFixed(3))])).toEqual([
      ["kick", 0.9],
      ["note", 0.95],
      ["kick", 1.05],
    ]);
  });
});
