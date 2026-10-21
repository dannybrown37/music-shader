/**
 * Auto VJ: which scene is on screen at time t.
 *
 *   sections ─┐                    quiet part: crossfade that lands on the section
 *   downbeats ├─► buildSchedule ─► loud part:  hard cut on the nearest downbeat,
 *   intensity ┘                                plus a cut every `cutBars` bars
 *                         │
 *                         ▼
 *                  sceneAt(t, events)
 *
 * Both are pure functions of the analysis, so exports and seeks always agree.
 */

export interface ScheduleOptions {
  /** Ignore sections closer than this to the previous section switch. */
  minSeconds: number;
  /** Start a crossfade this long before the section so the new scene lands on it. */
  lead: number;
  /** Cut on downbeats in loud parts instead of crossfading. */
  cuts: boolean;
  /** Intensity (0..1) at a downbeat above which the music counts as loud. */
  cutIntensity: number;
  /** Bars between cuts while the music stays loud. */
  cutBars: number;
  /**
   * Offline the whole song is known, so cuts can avoid landing just before a section change.
   * Live input must not look ahead, or a late-detected section would rewrite the past.
   */
  lookahead: boolean;
}

export interface Downbeats {
  times: ArrayLike<number>;
  /** Intensity 0..1 at each downbeat. */
  intensity: ArrayLike<number>;
}

export interface ScheduleEvent {
  /** When the change starts: the cut itself, or the start of a crossfade. */
  time: number;
  cut: boolean;
}

export interface ScheduledScene {
  current: number;
  /** Scene fading out, or -1 when no transition is running. */
  previous: number;
  /** Weight of `current`: 0..1 during a crossfade, 1 otherwise. */
  mix: number;
}

/** A section change this close to a drop is the same change (offline only). */
const DROP_ABSORB_SECONDS = 4;

/** `drops` always switch scene (a hard cut when cuts are on), whatever the minimum spacing. */
export function buildSchedule(sections: ArrayLike<number>, bars: Downbeats, o: ScheduleOptions, drops: ArrayLike<number> = []): ScheduleEvent[] {
  const loud = (i: number): boolean => o.cuts && bars.intensity[i] >= o.cutIntensity;
  const events: (ScheduleEvent & { bar: number })[] = [];
  const changes = [
    ...Array.from(drops, (t) => ({ t, drop: true })),
    // Live input already played the section by the time it hears the drop, so only offline can merge them.
    ...Array.from(sections, (t) => ({ t, drop: false })).filter(({ t }) => !o.lookahead || Array.from(drops).every((d) => Math.abs(d - t) > DROP_ABSORB_SECONDS)),
  ].sort((a, b) => a.t - b.t);
  let lastSection = -Infinity;
  for (const { t: s, drop } of changes) {
    if (!drop && s - lastSection < o.minSeconds) continue;
    lastSection = s;
    const bar = nearestBar(bars.times, s);
    if (drop) events.push(o.cuts ? { time: s, cut: true, bar } : { time: s - o.lead, cut: false, bar });
    else if (bar >= 0 && loud(bar)) events.push({ time: bars.times[bar], cut: true, bar });
    else events.push({ time: s - o.lead, cut: false, bar });
  }
  if (!o.cuts) return events.map(({ time, cut }) => ({ time, cut }));

  // Phrases line up with section changes, so cuts fall on the grid of whichever change is nearer.
  const anchors = events.map((e) => e.bar).filter((b) => b >= 0);
  let previousAnchor = -Infinity;
  let previousEvent = -Infinity;
  let next = 0;
  for (let i = 0; i < bars.times.length; i++) {
    while (next < anchors.length && anchors[next] <= i) {
      previousAnchor = anchors[next++];
      previousEvent = Math.max(previousEvent, previousAnchor);
    }
    if (!loud(i) || i - previousEvent < o.cutBars) continue;
    const nextAnchor = o.lookahead && next < anchors.length ? anchors[next] : Infinity;
    const grid = nextAnchor - i <= i - previousAnchor ? nextAnchor - i : i - (Number.isFinite(previousAnchor) ? previousAnchor : 0);
    if (grid % o.cutBars !== 0) continue;
    events.push({ time: bars.times[i], cut: true, bar: i });
    previousEvent = i;
  }
  return events.sort((a, b) => a.time - b.time).map(({ time, cut }) => ({ time, cut }));
}

/** Index of the downbeat within half a bar of t, or -1. Binary search: live sessions grow long. */
function nearestBar(times: ArrayLike<number>, t: number): number {
  if (times.length < 2) return -1;
  let lo = 0;
  let hi = times.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (times[mid] <= t) lo = mid;
    else hi = mid;
  }
  const best = Math.abs(times[lo] - t) <= Math.abs(times[hi] - t) ? lo : hi;
  const spacing = best + 1 < times.length ? times[best + 1] - times[best] : times[best] - times[best - 1];
  return Math.abs(times[best] - t) <= spacing / 2 ? best : -1;
}

export function sceneAt(t: number, events: ScheduleEvent[], o: { sceneCount: number; start: number; fade: number }): ScheduledScene {
  if (o.sceneCount <= 1) return { current: 0, previous: -1, mix: 1 };
  let switches = 0;
  let last: ScheduleEvent | null = null;
  for (const e of events) {
    if (e.time > t) break;
    switches++;
    last = e;
  }
  const current = (o.start + switches) % o.sceneCount;
  if (!last || last.cut) return { current, previous: -1, mix: 1 };
  const x = (t - last.time) / o.fade;
  if (x >= 1) return { current, previous: -1, mix: 1 };
  const previous = (o.start + switches - 1) % o.sceneCount;
  return { current, previous, mix: x * x * (3 - 2 * x) };
}
