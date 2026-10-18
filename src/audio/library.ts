/** Track list served by the dev server's music-library plugin (see vite.config.ts). */
export async function listTracks(): Promise<string[]> {
  try {
    const res = await fetch("/api/tracks");
    if (!res.ok) return [];
    const body: unknown = await res.json();
    if (typeof body === "object" && body !== null && Array.isArray((body as { tracks?: unknown }).tracks)) {
      return ((body as { tracks: unknown[] }).tracks).filter((t): t is string => typeof t === "string");
    }
    return [];
  } catch (err: unknown) {
    if (err instanceof TypeError || err instanceof SyntaxError) return [];
    throw err;
  }
}

export async function fetchTrack(name: string): Promise<ArrayBuffer> {
  const res = await fetch(`/tracks/${encodeURIComponent(name)}`);
  if (!res.ok) throw new Error(`could not load ${name}: HTTP ${res.status}`);
  return res.arrayBuffer();
}

/** "Haus of You [2019, edm].mp3" → { title: "Haus of You", subtitle: "2019 · edm" } */
export function titleFromFilename(name: string): { title: string; subtitle: string } {
  const base = name.replace(/\.[a-z0-9]+$/i, "");
  const m = base.match(/^(.*?)\s*\[(.*)\]\s*$/);
  if (!m) return { title: base.trim(), subtitle: "" };
  return { title: m[1].trim(), subtitle: m[2].split(",").map((s) => s.trim()).filter(Boolean).join(" · ") };
}
