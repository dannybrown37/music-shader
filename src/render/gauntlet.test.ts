import { describe, expect, it } from "vitest";
import {
  HISTORY_SLOTS,
  isPylon,
  laneX,
  obstacleId,
  pylonHalfDepth,
  pylonHalfWidth,
  SHIP_HALF_SPAN,
  SHIP_NOSE,
  SHIP_TAIL,
  SHIP_Z,
  shipLane,
  shipLateral,
  snareHistory,
  zAtAge,
} from "./gauntlet.ts";
import type { GauntletParams } from "./gauntlet.ts";

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

/** Snare times drawn from musical gaps, from 16th-note rolls to sparse backbeats. */
function snarePattern(seed: number, gaps: number[], seconds: number): number[] {
  const r = rng(seed);
  const out: number[] = [];
  for (let t = 0.5 + r(); t < seconds; t += gaps[Math.floor(r() * gaps.length)]) out.push(t);
  return out;
}

const DT = 1 / 240;
const SPARSE = [0.25, 0.375, 0.5, 0.75, 1];
const DENSE = [0.125, 0.125, 0.25, 0.375, 0.5];

const params: [string, GauntletParams][] = [
  ["defaults", { road: 1.6, size: 1, shots: 1 }],
  ["all dodges", { road: 1.6, size: 1, shots: 0 }],
  ["narrow road, big obstacles", { road: 1.2, size: 2, shots: 0 }],
  ["wide road", { road: 2, size: 0.4, shots: 2 }],
];

describe("shipLane", () => {
  it.each([0, 1, 2, 4])("stays in a lane for a run of shots+1 obstacles, then always changes (shots=%i)", (shots) => {
    for (let n = 1; n < 200; n++) {
      const changes = shipLane(n, shots) !== shipLane(n - 1, shots);
      expect(changes).toBe(n % (shots + 1) === 0);
    }
  });
});

describe("pylonHalfWidth", () => {
  it.each(params)("leaves room for the ship between lanes (%s)", (_, p) => {
    expect(laneX(1, p.road) - pylonHalfWidth(p) - SHIP_HALF_SPAN).toBeGreaterThanOrEqual(0.2);
  });
});

describe("shipLateral", () => {
  it.each(
    params.flatMap(([name, p]) => [
      [`${name}, sparse`, p, SPARSE],
      [`${name}, dense`, p, DENSE],
    ]) as [string, GauntletParams, number[]][],
  )("never brushes a pylon (%s)", (_, p, gaps) => {
    for (let seed = 1; seed <= 6; seed++) {
      const times = snarePattern(seed, gaps, 40);
      for (let t = 0; t < 42; t += DT) {
        const { ages, count } = snareHistory(times, t);
        const ship = shipLateral(ages, count, p).x;
        for (let i = 0; i < HISTORY_SLOTS; i++) {
          if (ages[i] < 0 || !isPylon(obstacleId(count, i), ages, i, p)) continue;
          const z = zAtAge(ages[i]);
          const reach = pylonHalfDepth(p) + 0.25;
          const alongside = z - reach < SHIP_Z + SHIP_NOSE && z + reach > SHIP_Z - SHIP_TAIL;
          if (!alongside) continue;
          const pylonX = laneX(shipLane(obstacleId(count, i) - 1, p.shots), p.road);
          const clearance = Math.abs(ship - pylonX) - pylonHalfWidth(p) - SHIP_HALF_SPAN;
          if (clearance < 0.15) throw new Error(`seed ${seed} t=${t.toFixed(3)}: clearance ${clearance.toFixed(3)}`);
        }
      }
    }
  });

  it.each([
    ["sparse", SPARSE],
    ["dense", DENSE],
  ])("moves without jumps (%s)", (_, gaps) => {
    const p = params[0][1];
    for (let seed = 1; seed <= 6; seed++) {
      const times = snarePattern(seed, gaps as number[], 40);
      let prev = shipLateral(...historyArgs(times, 0), p).x;
      for (let t = DT; t < 42; t += DT) {
        const x = shipLateral(...historyArgs(times, t), p).x;
        expect(Math.abs(x - prev) / DT, `seed ${seed} t=${t.toFixed(3)}`).toBeLessThan(25);
        prev = x;
      }
    }
  });

  it("reports velocity that matches its own motion", () => {
    const p = params[0][1];
    const times = snarePattern(3, SPARSE, 20);
    for (let t = 1; t < 20; t += 0.05) {
      const a = shipLateral(...historyArgs(times, t - 1e-4), p).x;
      const b = shipLateral(...historyArgs(times, t + 1e-4), p);
      expect(b.v).toBeCloseTo((b.x - a) / 2e-4, 0);
    }
  });

  it("sits in the newest obstacle's lane once everything has passed", () => {
    const p = params[0][1];
    const { ages, count } = snareHistory([1, 2, 3], 10);
    expect(shipLateral(ages, count, p).x).toBeCloseTo(laneX(shipLane(2, p.shots), p.road));
  });
});

describe("isPylon", () => {
  it.each([
    ["sparse", SPARSE],
    ["dense", DENSE],
  ])("keeps each obstacle's kind for its whole flight (%s)", (_, gaps) => {
    for (const [name, p] of params) {
      for (let seed = 1; seed <= 6; seed++) {
        const times = snarePattern(seed, gaps as number[], 40);
        const kind = new Map<number, boolean>();
        for (let t = 0; t < 42; t += DT) {
          const { ages, count } = snareHistory(times, t);
          for (let i = 0; i < HISTORY_SLOTS; i++) {
            if (ages[i] < 0 || zAtAge(ages[i]) < SHIP_Z - 3) continue;
            const id = obstacleId(count, i);
            const pylon = isPylon(id, ages, i, p);
            if ((kind.get(id) ?? pylon) !== pylon) throw new Error(`${name} seed ${seed} id ${id} t=${t.toFixed(3)} flipped`);
            kind.set(id, pylon);
          }
        }
      }
    }
  });

  it("dodges in busy patterns when the obstacles in between are shot", () => {
    const p = params[0][1];
    const times = snarePattern(2, [0.25], 20);
    let pylons = 0;
    for (let n = 0; n < times.length; n++) {
      const { ages, count } = snareHistory(times, times[n]);
      if (isPylon(obstacleId(count, 0), ages, 0, p)) pylons++;
    }
    expect(pylons).toBeGreaterThan(times.length / 4);
  });
});

function historyArgs(times: number[], t: number): [number[], number] {
  const { ages, count } = snareHistory(times, t);
  return [ages, count];
}
