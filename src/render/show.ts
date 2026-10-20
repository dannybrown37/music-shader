import type { ScheduleEvent } from "./schedule.ts";

/**
 * A show: hand-placed scene changes for one song, for when Auto VJ's choices aren't the video
 * you want. Each cue says "from t on, show this scene (in this palette)", arriving with a hard
 * cut or a crossfade that lands on t. Like the schedule, it's a pure function of time, so
 * seeking and exporting always agree.
 *
 *   base scene ──┤cue 10 s: tunnel, cut├──╱fade╲┤cue 20 s: orb, Ice├── …
 */

export interface Cue {
  /** Seconds into the song where the cue's scene is fully on screen. */
  t: number;
  scene: string;
  /** Palette name, or null to keep the preset's palette (and its per-section cycling). */
  palette: string | null;
  cut: boolean;
}

export interface Look {
  scene: string;
  palette: string | null;
}

export interface ShowFrame {
  scene: string;
  palette: string | null;
  /** The look fading out, or null when no crossfade is running. */
  from: Look | null;
  /** Weight of `scene`: 0..1 during a crossfade, 1 otherwise. */
  mix: number;
}

export interface ShowTiming {
  /** Crossfade length in seconds. */
  fade: number;
  /** Crossfades start this long before the cue, so the new scene is mostly in by t. */
  lead: number;
}

/** Cues closer than this are the same cue: setting one replaces the other. */
export const CUE_SNAP = 0.05;
const MAX_CUES = 1000;
const MAX_NAME = 64;

const start = (c: Cue, lead: number): number => (c.cut ? c.t : c.t - lead);

export function showAt(t: number, cues: readonly Cue[], base: Look, o: ShowTiming): ShowFrame {
  let i = -1;
  while (i + 1 < cues.length && start(cues[i + 1], o.lead) <= t) i++;
  if (i < 0) return { ...base, from: null, mix: 1 };
  const cue = cues[i];
  const look = { scene: cue.scene, palette: cue.palette ?? base.palette };
  const x = (t - start(cue, o.lead)) / o.fade;
  if (cue.cut || x >= 1) return { ...look, from: null, mix: 1 };
  const prev = i > 0 ? cues[i - 1] : null;
  const from = prev ? { scene: prev.scene, palette: prev.palette ?? base.palette } : base;
  return { ...look, from, mix: x * x * (3 - 2 * x) };
}

const byTime = (a: Cue, b: Cue): number => a.t - b.t;

/** Adds `cue`, replacing any cue within CUE_SNAP of it. Returns a new list. */
export function setCue(cues: readonly Cue[], cue: Cue): Cue[] {
  return [...cues.filter((c) => Math.abs(c.t - cue.t) > CUE_SNAP), cue].sort(byTime);
}

export function removeCue(cues: readonly Cue[], t: number): Cue[] {
  return cues.filter((c) => Math.abs(c.t - t) > CUE_SNAP);
}

export function moveCue(cues: readonly Cue[], from: number, to: number): Cue[] {
  const cue = cues.find((c) => Math.abs(c.t - from) <= CUE_SNAP);
  return cue ? setCue(removeCue(cues, from), { ...cue, t: Math.max(0, to) }) : [...cues];
}

/** The downbeat nearest t if it's within half a bar, else t itself. */
export function snapToBar(t: number, downbeats: ArrayLike<number>): number {
  let best = -1;
  for (let i = 0; i < downbeats.length; i++) if (best < 0 || Math.abs(downbeats[i] - t) < Math.abs(downbeats[best] - t)) best = i;
  if (best < 0 || downbeats.length < 2) return t;
  const spacing = best + 1 < downbeats.length ? downbeats[best + 1] - downbeats[best] : downbeats[best] - downbeats[best - 1];
  return Math.abs(downbeats[best] - t) <= spacing / 2 ? downbeats[best] : t;
}

/** Auto VJ's schedule as editable cues: a starting point for a hand-made show. */
export function cuesFromSchedule(events: readonly ScheduleEvent[], sceneIds: readonly string[], startIndex: number, lead: number): Cue[] {
  return events.map((e, i) => ({
    t: e.cut ? e.time : e.time + lead,
    scene: sceneIds[(startIndex + i + 1) % sceneIds.length],
    palette: null,
    cut: e.cut,
  }));
}

const isName = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= MAX_NAME;

/** Validates an imported or stored show ({ cues: [...] }); bad cues are dropped, not trusted. */
export function parseShow(raw: unknown): Cue[] {
  if (typeof raw !== "object" || raw === null || !Array.isArray((raw as { cues?: unknown }).cues)) return [];
  const cues: Cue[] = [];
  for (const c of (raw as { cues: unknown[] }).cues) {
    if (cues.length >= MAX_CUES) break;
    if (typeof c !== "object" || c === null) continue;
    const { t, scene, palette, cut } = c as Record<string, unknown>;
    if (typeof t !== "number" || !Number.isFinite(t) || t < 0) continue;
    if (!isName(scene) || !(palette === null || isName(palette)) || typeof cut !== "boolean") continue;
    cues.push({ t, scene, palette, cut });
  }
  return cues.sort(byTime);
}
