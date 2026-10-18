/**
 * Auto VJ: which scene is on screen at time t when scenes change at section boundaries.
 * A pure function of the section times, so exports and seeks always agree.
 */

export interface ScheduleOptions {
  /** Ignore sections closer than this to the previous switch. */
  minSeconds: number;
  sceneCount: number;
  /** Index of the scene shown before the first switch. */
  start: number;
  /** Start the crossfade this long before the section so the new scene lands on it. */
  lead: number;
  fade: number;
}

export interface ScheduledScene {
  current: number;
  /** Scene fading out, or -1 when no transition is running. */
  previous: number;
  /** Weight of `current`: 0..1 during a crossfade, 1 otherwise. */
  mix: number;
}

export function sceneAt(t: number, sections: Float32Array, o: ScheduleOptions): ScheduledScene {
  if (o.sceneCount <= 1) return { current: 0, previous: -1, mix: 1 };
  let switches = 0;
  let lastSwitch = -Infinity;
  let fadeStart = -Infinity;
  for (const s of sections) {
    if (s - lastSwitch < o.minSeconds) continue;
    const begins = s - o.lead;
    if (begins > t) break;
    switches++;
    lastSwitch = s;
    fadeStart = begins;
  }
  const current = (o.start + switches) % o.sceneCount;
  if (switches === 0) return { current, previous: -1, mix: 1 };
  const x = (t - fadeStart) / o.fade;
  if (x >= 1) return { current, previous: -1, mix: 1 };
  const previous = (o.start + switches - 1) % o.sceneCount;
  return { current, previous, mix: x * x * (3 - 2 * x) };
}
