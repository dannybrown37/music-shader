import { ANALYSIS_VERSION } from "../analysis/types.ts";
import type { TrackAnalysis } from "../analysis/types.ts";

/**
 * Remembers analyses in IndexedDB so reopening a song (or reloading the page while
 * editing code) skips the few-second analysis. Bump ANALYSIS_VERSION in types.ts whenever
 * the analysis output changes; old entries are then ignored and pruned.
 */

const DB_NAME = "music-shader";
const STORE = "analysis";
const MAX_ENTRIES = 24;

interface Entry {
  key: string;
  savedAt: number;
  analysis: TrackAnalysis;
}

export function cacheKey(name: string, byteLength: number): string {
  return `v${ANALYSIS_VERSION}:${byteLength}:${name}`;
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = (): void => {
      req.result.createObjectStore(STORE, { keyPath: "key" });
    };
    req.onsuccess = (): void => resolve(req.result);
    req.onerror = (): void => reject(req.error ?? new Error("IndexedDB open failed"));
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = (): void => resolve();
    tx.onerror = (): void => reject(tx.error ?? new Error("IndexedDB transaction failed"));
    tx.onabort = (): void => reject(tx.error ?? new Error("IndexedDB transaction aborted"));
  });
}

/** Null on a miss, or when storage is unavailable (private browsing, quota): caching is best-effort. */
export async function loadCachedAnalysis(key: string): Promise<TrackAnalysis | null> {
  try {
    const db = await open();
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).get(key);
    await done(tx);
    db.close();
    return (req.result as Entry | undefined)?.analysis ?? null;
  } catch (err: unknown) {
    // Caching is best-effort (private browsing, quota, blocked storage): log and analyse normally.
    console.warn(`analysis cache read failed: ${String(err)}`);
    return null;
  }
}

export async function saveCachedAnalysis(key: string, analysis: TrackAnalysis): Promise<void> {
  try {
    const db = await open();
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    store.put({ key, savedAt: Date.now(), analysis } satisfies Entry);
    const all = store.getAll();
    all.onsuccess = (): void => {
      const entries = all.result as Entry[];
      const stale = entries.filter((e) => !e.key.startsWith(`v${ANALYSIS_VERSION}:`));
      const current = entries.filter((e) => e.key.startsWith(`v${ANALYSIS_VERSION}:`)).sort((a, b) => b.savedAt - a.savedAt);
      for (const e of [...stale, ...current.slice(MAX_ENTRIES)]) store.delete(e.key);
    };
    await done(tx);
    db.close();
  } catch (err: unknown) {
    console.warn(`analysis cache write failed: ${String(err)}`);
  }
}
