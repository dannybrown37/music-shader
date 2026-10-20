/**
 * The Mosaic scene's plan: every kick, snare and note drops a shape into a 16:9 frame wherever
 * it still fits (best-candidate circle packing). When nothing fits any more the frame is full;
 * on the next downbeat (or after MAX_WAIT) every shape falls away and a fresh frame starts.
 * A section change with enough on screen drains early, so a new part starts on a clean frame.
 *
 * Placement depends on every earlier shape, so it can't live in the shader. A file is planned
 * once from its whole analysis (seeks and exports agree); live input pushes events as they come.
 * Both give the same frames because visible(t) only reads what is known at t.
 */
import { dominantPitch, NOTE_PITCH_DELAY, RECENT_COUNT } from "../analysis/sampler.ts";
import type { Features } from "../analysis/sampler.ts";
import type { TrackAnalysis } from "../analysis/types.ts";

export const FRAME_ASPECT = 16 / 9;
export const MAX_SHAPES = 128;
export const TEXELS_PER_SHAPE = 4;
export const MIN_RADIUS = 0.03;
export const GAP = 0.012;
export const MAX_WAIT = 2.5;
export const DRAIN_SECONDS = 1.8;
export const DRAIN_STAGGER = 0.6;
export const SECTION_MIN_SHAPES = 12;
const CANDIDATES = 32;
/** A hit that only fits at under this fraction of its size means the frame is full. */
const MIN_FIT = 0.3;
/** Hits per second the base radii are tuned for; sparser music gets bigger shapes so it still fills. */
const REF_RATE = 4;
const RATE_WINDOW = 8;
const BASE_RADIUS: Record<ShapeKind, number> = { kick: 0.24, snare: 0.17, note: 0.12 };
const KIND_INDEX: Record<ShapeKind, number> = { kick: 0, snare: 1, note: 2 };

export type ShapeKind = "kick" | "snare" | "note";

export interface Timbre {
  brightness: number;
  noisiness: number;
  tonalness: number;
  timbreX: number;
  timbreY: number;
}

export interface MosaicEvent {
  kind: ShapeKind | "downbeat" | "section";
  time: number;
  strength: number;
  timbre?: Timbre;
  /** Pitch class 0..11 for notes, -1 when unknown. */
  pitch?: number;
}

export interface Geometry {
  /** Corners (or star points) around the outline, 3..9. */
  points: number;
  /** 0 = straight edges, up to ~0.75 = deep star. */
  spike: number;
  /** 0 = sharp polygon, 1 = circle. */
  round: number;
}

export interface Shape extends Geometry {
  x: number;
  y: number;
  r: number;
  rotation: number;
  birth: number;
  kind: ShapeKind;
  strength: number;
  /** Palette position from the per-song timbre PCA: the same instrument keeps its colour. */
  hue: number;
  pitch: number;
}

export interface Cycle {
  start: number;
  /** When the last shape didn't fit; Infinity while there is still room. */
  fullAt: number;
  /** When the shapes start falling; Infinity until decided. */
  drainStart: number;
  shapes: Shape[];
  /** Hits that came once the frame was full, each relighting one shape (index into shapes), in time order. */
  strikes: { time: number; shape: number }[];
}

export interface EventSink {
  push(e: MosaicEvent): void;
}

const NEUTRAL: Timbre = { brightness: 0.5, noisiness: 0.5, tonalness: 0.5, timbreX: 0, timbreY: 0 };

const clamp01 =(v: number): number => Math.min(1, Math.max(0, v));

/** Bright sounds get more corners, noisy ones go spiky, pitched ones round off. */
export function shapeGeometry(kind: ShapeKind, t: Timbre): Geometry {
  return {
    points: 3 + Math.round(clamp01(t.brightness) * 6),
    spike: clamp01(t.noisiness) * 0.6 + (kind === "snare" ? 0.15 : 0),
    round: clamp01(clamp01(t.tonalness) * 0.8 + (kind === "kick" ? 0.5 : 0) - (kind === "snare" ? 0.3 : 0)),
  };
}

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let x = Math.imul(s ^ (s >>> 15), 1 | s);
    x ^= x + Math.imul(x ^ (x >>> 7), 61 | x);
    return ((x ^ (x >>> 14)) >>> 0) / 2 ** 32;
  };
}

export class MosaicPlanner {
  readonly cycles: Cycle[] = [{ start: -Infinity, fullAt: Infinity, drainStart: Infinity, shapes: [], strikes: [] }];
  private readonly size: number;
  private clock = -Infinity;
  private readonly recentHits: number[] = [];
  private firstHit = Infinity;
  private readonly lastStrike = new Float64Array(MAX_SHAPES);

  constructor(opts: { size: number }) {
    this.size = opts.size;
  }

  private get current(): Cycle {
    return this.cycles[this.cycles.length - 1];
  }

  /** Resolves drain timeouts and starts new cycles up to time t. Never goes back in time. */
  advance(t: number): void {
    if (t <= this.clock) return;
    this.clock = t;
    for (;;) {
      const c = this.current;
      if (Number.isFinite(c.drainStart)) {
        const end = c.drainStart + DRAIN_SECONDS;
        if (t < end) return;
        this.cycles.push({ start: end, fullAt: Infinity, drainStart: Infinity, shapes: [], strikes: [] });
      } else if (Number.isFinite(c.fullAt) && t >= c.fullAt + MAX_WAIT) {
        c.drainStart = c.fullAt + MAX_WAIT;
      } else return;
    }
  }

  push(e: MosaicEvent): void {
    this.advance(e.time);
    const c = this.current;
    const draining = Number.isFinite(c.drainStart);
    if (e.kind === "downbeat") {
      if (Number.isFinite(c.fullAt) && !draining) c.drainStart = Math.max(e.time, c.fullAt);
      return;
    }
    if (e.kind === "section") {
      if (!draining && c.shapes.length >= SECTION_MIN_SHAPES) c.drainStart = e.time;
      return;
    }
    const density = this.densityScale(e.time);
    if (draining) return;
    if (Number.isFinite(c.fullAt) || !this.place(c, e, e.kind, density)) {
      c.fullAt = Math.min(c.fullAt, e.time);
      this.strike(c, e, e.kind);
    }
  }

  /** No room left: the hit lights up the shape that looks most like it would have, so no hit goes unseen. */
  private strike(c: Cycle, e: MosaicEvent, kind: ShapeKind): void {
    const g = shapeGeometry(kind, e.timbre ?? NEUTRAL);
    const sameKind = c.shapes.some((s) => s.kind === kind);
    let best = -1;
    let bestCost = Infinity;
    for (const [i, s] of c.shapes.entries()) {
      if (sameKind && s.kind !== kind) continue;
      const cost = Math.abs(s.points - g.points) / 6 + Math.abs(s.spike - g.spike) + Math.abs(s.round - g.round);
      if (cost < bestCost) {
        bestCost = cost;
        best = i;
      }
    }
    if (best >= 0) c.strikes.push({ time: e.time, shape: best });
  }

  /** Area per shape ∝ 1 / hit rate, so a sparse piano piece fills about as fast as a busy drop. */
  private densityScale(t: number): number {
    this.firstHit = Math.min(this.firstHit, t);
    this.recentHits.push(t);
    while (this.recentHits[0] < t - RATE_WINDOW) this.recentHits.shift();
    const rate = this.recentHits.length / Math.max(2, Math.min(RATE_WINDOW, t - this.firstHit));
    return Math.min(3, Math.max(0.45, Math.sqrt(REF_RATE / rate)));
  }

  private place(c: Cycle, e: MosaicEvent, kind: ShapeKind, density: number): boolean {
    if (c.shapes.length >= MAX_SHAPES) return false;
    const random = rng(this.cycles.length * 7919 + c.shapes.length * 104729 + 1);
    const want = BASE_RADIUS[kind] * this.size * density * (0.55 + 0.45 * Math.min(e.strength, 1.5));
    let best = { x: 0, y: 0, free: -Infinity };
    for (let k = 0; k < CANDIDATES; k++) {
      const x = (random() * 2 - 1) * FRAME_ASPECT;
      const y = random() * 2 - 1;
      const free = this.freeRadius(c, x, y);
      if (free >= want) {
        best = { x, y, free };
        break;
      }
      if (free > best.free) best = { x, y, free };
    }
    if (best.free < Math.max(MIN_RADIUS, MIN_FIT * want)) return false;
    const timbre = e.timbre ?? NEUTRAL;
    const hue = Math.atan2(timbre.timbreY, timbre.timbreX) / (2 * Math.PI) + 0.5;
    c.shapes.push({
      x: best.x,
      y: best.y,
      r: Math.min(want, best.free),
      rotation: random() * 2 * Math.PI,
      birth: Math.max(e.time, c.start),
      kind,
      strength: e.strength,
      hue,
      pitch: e.pitch ?? -1,
      ...shapeGeometry(kind, timbre),
    });
    return true;
  }

  private freeRadius(c: Cycle, x: number, y: number): number {
    let free = Math.min(FRAME_ASPECT - Math.abs(x), 1 - Math.abs(y));
    for (const s of c.shapes) free = Math.min(free, Math.hypot(x - s.x, y - s.y) - s.r - GAP);
    return free;
  }

  /**
   * Packs the shapes on screen at t into `out` (TEXELS_PER_SHAPE RGBA texels each) and returns how many:
   *   0: x, y, radius, rotation        1: age, drain age (-1 = not draining), kind, strength
   *   2: points, spike, round, hue     3: pitch, fall delay, strike age (-1 = never), 0
   */
  visible(t: number, out: Float32Array): number {
    this.advance(t);
    let lo = 0;
    let hi = this.cycles.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.cycles[mid].start <= t) lo = mid;
      else hi = mid - 1;
    }
    const c = this.cycles[lo];
    const drainAge = t >= c.drainStart ? t - c.drainStart : -1;
    const struck = this.lastStrike.fill(-Infinity);
    for (const s of c.strikes) {
      if (s.time > t) break;
      struck[s.shape] = s.time;
    }
    let n = 0;
    for (const [i, s] of c.shapes.entries()) {
      if (s.birth > t || n >= MAX_SHAPES) continue;
      const o = n * TEXELS_PER_SHAPE * 4;
      out[o] = s.x;
      out[o + 1] = s.y;
      out[o + 2] = s.r;
      out[o + 3] = s.rotation;
      out[o + 4] = t - s.birth;
      out[o + 5] = drainAge;
      out[o + 6] = KIND_INDEX[s.kind];
      out[o + 7] = s.strength;
      out[o + 8] = s.points;
      out[o + 9] = s.spike;
      out[o + 10] = s.round;
      out[o + 11] = s.hue;
      out[o + 12] = s.pitch;
      out[o + 13] = (DRAIN_STAGGER * (s.y + 1)) / 2;
      out[o + 14] = Number.isFinite(struck[i]) ? t - struck[i] : -1;
      out[o + 15] = 0;
      n++;
    }
    return n;
  }
}

/** Every shape event and drain cue in a pre-analysed song, in time order. */
export function eventsFromAnalysis(a: TrackAnalysis): MosaicEvent[] {
  const out: MosaicEvent[] = [];
  const frameAt = (t: number): number => Math.min(a.frames - 1, Math.max(0, Math.round((t + NOTE_PITCH_DELAY) * a.fps)));
  for (const kind of ["kick", "snare", "note"] as const) {
    const { times, strengths } = a.events[kind];
    for (let i = 0; i < times.length; i++) {
      const f = frameAt(times[i]);
      const s = a.scalars;
      out.push({
        kind,
        time: times[i],
        strength: strengths[i],
        timbre: { brightness: s.brightness[f], noisiness: s.noisiness[f], tonalness: s.tonalness[f], timbreX: s.timbreX[f], timbreY: s.timbreY[f] },
        pitch: kind === "note" ? dominantPitch(a.chroma, f * 12) : -1,
      });
    }
  }
  for (const kind of ["downbeat", "section"] as const) {
    for (const time of a.events[kind].times) out.push({ kind, time, strength: 1 });
  }
  return out.sort((x, y) => x.time - y.time);
}

const LIVE_KINDS = ["kick", "snare", "note", "downbeat", "section"] as const;

/** Turns per-frame Features (live input) into planner events, each pushed once. */
export class LiveMosaicFeed {
  private readonly seen: Record<(typeof LIVE_KINDS)[number], number> = { kick: 0, snare: 0, note: 0, downbeat: 0, section: 0 };

  update(f: Features, sink: EventSink): void {
    const fresh: MosaicEvent[] = [];
    const s = f.scalars;
    const timbre: Timbre = { brightness: s.brightness, noisiness: s.noisiness, tonalness: s.tonalness, timbreX: s.timbreX, timbreY: s.timbreY };
    for (const kind of LIVE_KINDS) {
      const count = f.count[kind];
      if (count < this.seen[kind]) this.seen[kind] = 0;
      const n = Math.min(count - this.seen[kind], RECENT_COUNT);
      this.seen[kind] = count;
      for (let i = n - 1; i >= 0; i--) {
        const r = f.recent[kind];
        fresh.push({ kind, time: f.time - r[2 * i], strength: r[2 * i + 1], timbre, pitch: kind === "note" ? f.notePitch[i] : -1 });
      }
    }
    fresh.sort((a, b) => a.time - b.time);
    for (const e of fresh) sink.push(e);
  }
}
