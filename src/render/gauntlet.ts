/**
 * The Gauntlet scene's dodge plan, mirrored line for line in scenes/gauntlet.glsl so the
 * no-collision guarantee can be tested here. Keep the two in step.
 *
 * Every snare n is an obstacle in the lane the ship held after snare n-1. If the ship's lane
 * for n differs it slides out of the way (a pylon); otherwise it shoots (a mine). A slide must
 * finish before the pylon reaches the nose and may not start until the previous lane change's
 * obstacle has cleared the tail; lane changes too cramped for that become mines and the ship
 * sidesteps quickly once the way is clear.
 */
import { RECENT_COUNT } from "../analysis/sampler.ts";

export const HISTORY_SLOTS = RECENT_COUNT;
const NEAR = 0.6;
const FAR = 26;
const HISTORY = 2;
const SPEED = (FAR - NEAR) / HISTORY;
export const SHIP_Z = 3;
export const SHIP_AGE = (FAR - SHIP_Z) / SPEED;
export const SHIP_NOSE = 0.5;
export const SHIP_TAIL = 0.34;
export const SHIP_HALF_SPAN = 0.42;
const LANE_MARGIN = 0.22;
const DEPTH_MARGIN = 0.3;
const SLIDE = 0.28;
const QUICK = 0.16;
const NO_PREDECESSOR = 1e3;

export interface GauntletParams {
  road: number;
  size: number;
  shots: number;
}

export function zAtAge(age: number): number {
  return FAR - SPEED * age;
}

export function shipLane(n: number, shots: number): number {
  const b = Math.floor(n / (Math.floor(shots + 0.5) + 1));
  return mod(b + Math.floor(b / 3), 3) - 1;
}

export function laneX(lane: number, road: number): number {
  return lane * road * 0.62;
}

export function pylonHalfWidth(p: GauntletParams): number {
  return Math.min(Math.max(0.28 * p.size, 0.06), laneX(1, p.road) - SHIP_HALF_SPAN - LANE_MARGIN);
}

export function pylonHalfDepth(p: GauntletParams): number {
  return pylonHalfWidth(p);
}

/** Seconds before (and after) a pylon's arrival that the ship must already be clear of its lane. */
function clearTime(p: GauntletParams): number {
  return (SHIP_NOSE + pylonHalfDepth(p) + DEPTH_MARGIN) / SPEED;
}

export function obstacleId(count: number, i: number): number {
  return count - 1 - i;
}

/**
 * Seconds since the previous lane change. The obstacles in between are mines, shot before they
 * reach the ship, so only that one can still be in the way. Unknown once it has left the history.
 */
function gapBefore(ages: number[], count: number, i: number, shots: number): number {
  const back = Math.floor(shots + 0.5) + 1;
  if (obstacleId(count, i) - back < 0) return NO_PREDECESSOR;
  if (i + back >= HISTORY_SLOTS) return 0;
  return ages[i + back] - ages[i];
}

export function isPylon(n: number, ages: number[], i: number, p: GauntletParams): boolean {
  const count = n + 1 + i;
  return shipLane(n, p.shots) !== shipLane(n - 1, p.shots) && gapBefore(ages, count, i, p.shots) >= 2 * clearTime(p) + QUICK;
}

/** Lateral position and velocity: the newest lane minus whatever slides are still to come. */
export function shipLateral(ages: number[], count: number, p: GauntletParams): { x: number; v: number } {
  let x = laneX(shipLane(count - 1, p.shots), p.road);
  let v = 0;
  const c = clearTime(p);
  for (let i = 0; i < HISTORY_SLOTS; i++) {
    if (ages[i] < 0) continue;
    const n = obstacleId(count, i);
    const delta = laneX(shipLane(n, p.shots), p.road) - laneX(shipLane(n - 1, p.shots), p.road);
    if (delta === 0) continue;
    const gap = gapBefore(ages, count, i, p.shots);
    const tau = SHIP_AGE - ages[i];
    const [end, start] = isPylon(n, ages, i, p) ? [c, c + Math.min(SLIDE + 0.1 * (Math.abs(delta) / laneX(1, p.road) - 1), gap - 2 * c)] : [gap - c - QUICK, gap - c];
    const u = Math.min(1, Math.max(0, (tau - end) / (start - end)));
    x -= delta * u * u * (3 - 2 * u);
    v += (delta * 6 * u * (1 - u)) / (start - end);
  }
  return { x, v };
}

/** The shader's view of the snare track at time t: ages of the newest HISTORY_SLOTS hits (-1 = empty). */
export function snareHistory(times: number[], t: number): { ages: number[]; count: number } {
  let count = 0;
  while (count < times.length && times[count] <= t) count++;
  const ages = Array.from({ length: HISTORY_SLOTS }, (_, i) => (count - 1 - i >= 0 ? t - times[count - 1 - i] : -1));
  return { ages, count };
}

function mod(a: number, b: number): number {
  return a - b * Math.floor(a / b);
}
