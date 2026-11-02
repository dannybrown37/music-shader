import { snapToBar } from "./show.ts";

/**
 * When a video is loaded, which moments show the camera and which the shader.
 *
 *   cue.time  ─ the change has fully landed (fades lead in, like scene crossfades)
 *   mix 0 = camera only, 1 = shader only
 *
 * Auto: the song splits at sections and drops; the quietest parts go to the camera until
 * `cameraShare` of the song is covered, the rest to the shader. Drops slam in fast.
 */
export interface FootageCue {
  time: number;
  camera: boolean;
  /** Seconds the transition takes, ending at `time`. */
  fade: number;
}

export interface FootagePlanInput {
  duration: number;
  fps: number;
  intensity: Float32Array;
  sections: ArrayLike<number>;
  drops: ArrayLike<number>;
  downbeats: ArrayLike<number>;
}

export interface FootageOptions {
  /** 0..1 of the song kept on camera. */
  cameraShare: number;
  /** Bars a normal transition takes. */
  fadeBars: number;
  /** Seconds that always open on camera (0 = don't force it). */
  intro: number;
}

const DROP_FADE = 0.25;
/** A section change this close to a drop is the same moment. */
const DROP_MERGE = 4;

export function cameraAt(t: number, cues: readonly FootageCue[]): boolean {
  let camera = false;
  for (const c of cues) {
    if (c.time > t) break;
    camera = c.camera;
  }
  return camera;
}

export function footageMixAt(t: number, cues: readonly FootageCue[]): number {
  if (cues.length === 0) return 1;
  let mix = cues[0].camera ? 0 : 1;
  for (const c of cues) {
    const target = c.camera ? 0 : 1;
    if (t >= c.time) {
      mix = target;
      continue;
    }
    const start = c.time - c.fade;
    if (t > start) {
      const x = (t - start) / c.fade;
      mix += (target - mix) * x * x * (3 - 2 * x);
    }
    break;
  }
  return mix;
}

/** 0..1 swell around each scene change: up over `before` seconds, down over `after`. */
export function popAt(t: number, changes: ArrayLike<number>, before: number, after: number): number {
  let pop = 0;
  for (let i = 0; i < changes.length; i++) {
    const d = t - changes[i];
    const x = d < 0 ? 1 + d / before : 1 - d / after;
    if (x > 0) pop = Math.max(pop, x * x * (3 - 2 * x));
  }
  return pop;
}

export function barSeconds(downbeats: ArrayLike<number>): number {
  const gaps: number[] = [];
  for (let i = 1; i < downbeats.length; i++) gaps.push(downbeats[i] - downbeats[i - 1]);
  if (gaps.length === 0) return 2;
  gaps.sort((a, b) => a - b);
  return gaps[gaps.length >> 1];
}

interface Segment {
  start: number;
  end: number;
  score: number;
  drop: boolean;
  camera: boolean;
}

export function autoFootageCues(input: FootagePlanInput, options: FootageOptions): FootageCue[] {
  const { duration } = input;
  if (duration <= 0) return [];
  const drops = Array.from(input.drops).filter((d) => d > 0 && d < duration);
  const bounds = Array.from(input.sections).filter((s) => s > 1 && s < duration - 1 && !drops.some((d) => Math.abs(d - s) < DROP_MERGE));
  const starts = [0, ...bounds, ...drops].sort((a, b) => a - b);
  const segments: Segment[] = starts.map((start, i) => {
    const end = starts[i + 1] ?? duration;
    const drop = drops.includes(start);
    return { start, end, score: meanIntensity(input, start, end) + (drop ? 1 : 0), drop, camera: false };
  });

  let covered = 0;
  for (const s of segments) {
    if (s.start >= options.intro || options.intro <= 0) break;
    s.camera = true;
    covered += s.end - s.start;
  }
  const target = Math.min(1, Math.max(0, options.cameraShare)) * duration;
  for (const s of [...segments].sort((a, b) => a.score - b.score)) {
    if (covered >= target - 1e-6) break;
    if (s.camera) continue;
    s.camera = true;
    covered += s.end - s.start;
  }

  const fade = Math.max(0, options.fadeBars) * barSeconds(input.downbeats);
  const cues: FootageCue[] = [];
  for (const s of segments) {
    if (cues.length > 0 && cues[cues.length - 1].camera === s.camera) continue;
    if (cues.length === 0) {
      cues.push({ time: 0, camera: s.camera, fade: 0 });
      continue;
    }
    const time = s.drop ? s.start : snapToBar(s.start, input.downbeats);
    const room = time - cues[cues.length - 1].time;
    cues.push({ time, camera: s.camera, fade: Math.min(s.drop ? DROP_FADE : fade, room / 2) });
  }
  return cues;
}

function meanIntensity(input: FootagePlanInput, start: number, end: number): number {
  const a = Math.max(0, Math.floor(start * input.fps));
  const b = Math.min(input.intensity.length, Math.ceil(end * input.fps));
  if (b <= a) return 0;
  let sum = 0;
  for (let i = a; i < b; i++) sum += input.intensity[i];
  return sum / (b - a);
}

/** V: flip camera/shader from the bar nearest t, or remove the cue already on that bar. */
export function toggleFootageCue(cues: readonly FootageCue[], t: number, downbeats: ArrayLike<number>, fade: number): FootageCue[] {
  const time = snapToBar(t, downbeats);
  const bar = barSeconds(downbeats);
  const existing = cues.findIndex((c) => c.time > 0 && Math.abs(c.time - time) < bar / 2);
  if (existing >= 0) return cues.filter((_, i) => i !== existing);
  return [...cues, { time, camera: !cameraAt(time, cues), fade }].sort((a, b) => a.time - b.time);
}

export function parseFootageCues(raw: unknown): FootageCue[] {
  if (!Array.isArray(raw)) return [];
  const cues: FootageCue[] = [];
  for (const c of raw as unknown[]) {
    if (typeof c !== "object" || c === null) continue;
    const { time, camera, fade } = c as Record<string, unknown>;
    if (typeof time !== "number" || !Number.isFinite(time) || time < 0 || typeof camera !== "boolean") continue;
    cues.push({ time, camera, fade: typeof fade === "number" && Number.isFinite(fade) ? Math.max(0, fade) : 0 });
  }
  return cues.sort((a, b) => a.time - b.time);
}
