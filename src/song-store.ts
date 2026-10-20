/**
 * Per-song data in localStorage, keyed by the analysis cache key (file name + size). Everything
 * read back goes through `parse`, so a hand-edited or stale entry can't break the app.
 */
export interface SongStore<T> {
  load(song: string): T;
  /** Empty values delete the entry. */
  save(song: string, value: T): void;
}

export function songStore<T>(storageKey: string, parse: (raw: unknown) => T, isEmpty: (value: T) => boolean): SongStore<T> {
  const loadAll = (): Record<string, unknown> => {
    try {
      const raw: unknown = JSON.parse(localStorage.getItem(storageKey) ?? "{}");
      return typeof raw === "object" && raw !== null && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  };
  return {
    load: (song) => parse(loadAll()[song]),
    save: (song, value) => {
      try {
        const all = loadAll();
        if (isEmpty(value)) delete all[song];
        else all[song] = value;
        localStorage.setItem(storageKey, JSON.stringify(all));
      } catch {
        // Storage full or blocked: it lasts until the page closes. Download it to keep it.
      }
    },
  };
}
