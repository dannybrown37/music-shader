import type { TempoFactor } from "./analysis/beats.ts";

const STORAGE_KEY = "music-shader.tempo-factors";
const FACTORS: readonly TempoFactor[] = [1, 2, 0.5];

export function isTempoFactor(x: unknown): x is TempoFactor {
  return FACTORS.includes(x as TempoFactor);
}

/** Per-song tempo corrections, keyed by the analysis cache key. Invalid entries are dropped. */
export function parseTempoFactors(raw: unknown): Record<string, TempoFactor> {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return {};
  return Object.fromEntries(Object.entries(raw).filter((e): e is [string, TempoFactor] => isTempoFactor(e[1])));
}

/** The T key cycles: as detected → double → half → as detected. */
export function nextTempoFactor(f: TempoFactor): TempoFactor {
  return FACTORS[(FACTORS.indexOf(f) + 1) % FACTORS.length];
}

export function loadTempoFactor(song: string): TempoFactor {
  try {
    return parseTempoFactors(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}"))[song] ?? 1;
  } catch {
    return 1;
  }
}

export function saveTempoFactor(song: string, factor: TempoFactor): void {
  try {
    const all = parseTempoFactors(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}"));
    if (factor === 1) delete all[song];
    else all[song] = factor;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch {
    // Storage full or blocked: the correction just won't be remembered.
  }
}
