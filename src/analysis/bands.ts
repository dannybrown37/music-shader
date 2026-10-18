/**
 * Detector definitions shared by the offline (track.ts) and live (live.ts) analysers,
 * so both hear drums the same way. Tune detection here.
 */

export const EPS = 1e-10;
/** log(1 + C·x/ref): C sets how far below a band's loud level we still hear changes (40 dB here). */
export const LOG_COMPRESSION = 100;
/** Band references never drop below this fraction of the loudest band, so silent bands aren't amplified into noise. */
export const REF_FLOOR = 3e-4;
/** Harmonic/percussive separation median lengths: frames in time, mel bands in frequency. */
export const HPSS_TIME = 17;
export const HPSS_FREQ = 7;

export type Range = [number, number];

export const BANDS: Record<"sub" | "bass" | "lowMid" | "mid" | "high" | "air", Range> = {
  sub: [20, 60],
  bass: [60, 250],
  lowMid: [250, 800],
  mid: [800, 2500],
  high: [2500, 7000],
  air: [7000, 20000],
};

export const KICK: Range = [35, 150];
export const SNARE_CRACK: Range = [1000, 5000];
export const HAT: Range = [7000, 20000];

/**
 * A "note" is any onset with no drum hit nearby: a new pitch, chord or synth stab.
 * (Harmonic-only flux was tried first, but HPSS files note attacks under percussive for
 * ~100 ms, so it fired late; snare bodies are tonal enough to fire it falsely.)
 */
export const NOTE_DRUM_GUARD = 0.04;

export function isNearAny(t: number, times: ArrayLike<number>[], guard: number): boolean {
  for (const list of times) {
    let lo = 0;
    let hi = list.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const d = list[mid] - t;
      if (Math.abs(d) <= guard) return true;
      if (d < 0) lo = mid + 1;
      else hi = mid - 1;
    }
  }
  return false;
}

/**
 * Snares spray into the hat band too. In linear power a hat's new energy sits almost
 * entirely above 7 kHz while a snare's sits mostly in 1–5 kHz, so gate the hat detector
 * on the high band's share of the combined rise.
 */
const HAT_SHARE_MIN = 0.6;
const HAT_SHARE_RAMP = 0.3;

export function hatGate(hatRise: number, crackRise: number): number {
  const share = hatRise / (hatRise + crackRise + EPS);
  return Math.min(1, Math.max(0, (share - HAT_SHARE_MIN) / HAT_SHARE_RAMP));
}

export interface Detector {
  /** Seconds between two events of this kind. */
  minGap: number;
  /** Absolute onset-function level an event must reach. */
  floor: number;
  /** Margin above the local mean. */
  delta: number;
}

export type DetectorName = "kick" | "snare" | "hat" | "onset";

export const DETECTORS: Record<DetectorName, Detector> = {
  kick: { minGap: 0.07, floor: 0.8, delta: 0.3 },
  snare: { minGap: 0.07, floor: 0.4, delta: 0.15 },
  hat: { minGap: 0.04, floor: 0.6, delta: 0.2 },
  onset: { minGap: 0.04, floor: 0.1, delta: 0.06 },
};

/** Mel band indices whose centre lies in [lo, hi); the nearest band if none does. */
export function bandIndices(centers: number[], [lo, hi]: Range): number[] {
  const idx = centers.flatMap((f, i) => (f >= lo && f < hi ? [i] : []));
  if (idx.length > 0) return idx;
  const mid = (lo + hi) / 2;
  let best = 0;
  centers.forEach((f, i) => {
    if (Math.abs(f - mid) < Math.abs(centers[best] - mid)) best = i;
  });
  return [best];
}

/** SuperFlux-style positive flux: rise of `cur` over the max of `prev`'s neighbouring bands, averaged. */
export function rowFlux(cur: ArrayLike<number>, prev: ArrayLike<number>, bands: number[]): number {
  const last = prev.length - 1;
  let sum = 0;
  for (const c of bands) {
    const before = Math.max(prev[Math.max(0, c - 1)], prev[c], prev[Math.min(last, c + 1)]);
    sum += Math.max(0, cur[c] - before);
  }
  return sum / bands.length;
}

export function compressValue(power: number, ref: number): number {
  return Math.log1p((LOG_COMPRESSION * power) / ref);
}

export function toDb(x: number): number {
  return 10 * Math.log10(x + EPS);
}
