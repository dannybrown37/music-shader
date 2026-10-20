/**
 * Timed lyrics from an .lrc file ("[mm:ss.xx]words" per line), shown one line at a time by the
 * overlay and composited by the shader, so exports include them.
 */

export interface LyricLine {
  t: number;
  text: string;
}

const FADE = 0.2;
/** A line fades out after this long even if the next one is later (instrumental breaks). */
const MAX_HOLD = 8;
const MAX_LINES = 5000;
const MAX_TEXT = 200;

const STAMP = /^\[(\d{1,3}):(\d{1,2}(?:\.\d{1,3})?)\]/;

export function parseLrc(source: string): LyricLine[] {
  let offset = 0;
  const lines: LyricLine[] = [];
  for (const raw of source.split(/\r?\n/)) {
    const tag = /^\[offset:\s*([+-]?\d+)\s*\]/i.exec(raw.trim());
    if (tag) offset = Number(tag[1]) / 1000;
    let rest = raw.trim();
    const times: number[] = [];
    for (let m = STAMP.exec(rest); m; m = STAMP.exec(rest)) {
      times.push(Number(m[1]) * 60 + Number(m[2]));
      rest = rest.slice(m[0].length);
    }
    const text = rest.trim().slice(0, MAX_TEXT);
    for (const t of times) if (lines.length < MAX_LINES) lines.push({ t, text });
  }
  return lines.map((l) => ({ ...l, t: Math.max(0, l.t - offset) })).sort((a, b) => a.t - b.t);
}

const smooth = (x: number): number => {
  const k = Math.min(1, Math.max(0, x));
  return k * k * (3 - 2 * k);
};

/** The line on screen at t and its opacity (fades in, holds, fades out before the next). */
export function lyricAt(t: number, lines: readonly LyricLine[]): { text: string; alpha: number } {
  let i = -1;
  while (i + 1 < lines.length && lines[i + 1].t <= t) i++;
  if (i < 0 || lines[i].text === "") return { text: "", alpha: 0 };
  const start = lines[i].t;
  const end = Math.min(i + 1 < lines.length ? lines[i + 1].t : Infinity, start + MAX_HOLD);
  return { text: lines[i].text, alpha: smooth((t - start) / FADE) * (1 - smooth((t - (end - FADE)) / FADE)) };
}
