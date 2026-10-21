import { MAX_CAST } from "../analysis/cast.ts";
import { MEL_BANDS } from "../analysis/frame.ts";
import type { EventTrack, TrackAnalysis } from "../analysis/types.ts";

/**
 * The whole song squeezed into one RGBA32F texture for the Portrait scene: one column per
 * slice of time, read with texelFetch.
 *
 *   rows 0–63   mel band b: (mean, max, –, –)
 *   ROW.levels  (intensity, build peak, melody, pitch weighted by melody)
 *   ROW.hits    (kick, snare, hat, note) per column, relative to the busiest column
 *   ROW.marks   (dominant cast member or -1, its weight, drop strength, section 1/0)
 *   ROW.cast0   cast weights of members 0–3
 *   ROW.cast1   cast weights of members 4–5, loudness, voice
 */
export const SONG_COLUMNS = 720;
export const ROW = { levels: MEL_BANDS, hits: MEL_BANDS + 1, marks: MEL_BANDS + 2, cast0: MEL_BANDS + 3, cast1: MEL_BANDS + 4 } as const;
export const SONG_ROWS = MEL_BANDS + 5;

export function buildSongTexture(a: TrackAnalysis, columns = SONG_COLUMNS): Float32Array {
  const out = new Float32Array(columns * SONG_ROWS * 4);
  const at = (column: number, row: number): number => (row * columns + column) * 4;
  const columnOf = (t: number): number => Math.min(columns - 1, Math.max(0, Math.floor((t / a.duration) * columns)));
  const s = a.scalars;
  const { cast } = a;
  const blocks = cast.ids.length;

  for (let c = 0; c < columns; c++) {
    const f0 = Math.floor((c / columns) * a.frames);
    const f1 = Math.max(f0 + 1, Math.floor(((c + 1) / columns) * a.frames));
    const n = f1 - f0;
    for (let b = 0; b < MEL_BANDS; b++) {
      let sum = 0;
      let max = 0;
      for (let f = f0; f < f1; f++) {
        const v = a.mel[f * MEL_BANDS + b];
        sum += v;
        max = Math.max(max, v);
      }
      out[at(c, b)] = sum / n;
      out[at(c, b) + 1] = max;
    }
    let intensity = 0;
    let build = 0;
    let melody = 0;
    let pitch = 0;
    let loud = 0;
    let voice = 0;
    for (let f = f0; f < f1; f++) {
      intensity += s.intensity[f] / n;
      build = Math.max(build, s.build[f]);
      melody += s.melody[f] / n;
      pitch += s.pitch[f] * s.melody[f];
      loud += s.loudness[f] / n;
      voice += s.voice[f] / n;
    }
    out.set([intensity, build, melody, melody > 0 ? pitch / (melody * n) : 0], at(c, ROW.levels));

    const b0 = Math.floor((c / columns) * blocks);
    const b1 = Math.max(b0 + 1, Math.floor(((c + 1) / columns) * blocks));
    const weights = new Float32Array(MAX_CAST);
    for (let b = b0; b < Math.min(b1, blocks); b++) for (let k = 0; k < MAX_CAST; k++) weights[k] += cast.weights[b * cast.maxMembers + k] / (b1 - b0);
    let dominant = -1;
    for (let k = 0; k < MAX_CAST; k++) if (weights[k] > 0.05 && (dominant < 0 || weights[k] > weights[dominant])) dominant = k;
    out.set([dominant, dominant >= 0 ? weights[dominant] : 0, 0, 0], at(c, ROW.marks));
    out.set(weights.subarray(0, 4), at(c, ROW.cast0));
    out.set([weights[4], weights[5], loud, voice], at(c, ROW.cast1));
  }

  const kinds = ["kick", "snare", "hat", "note"] as const;
  kinds.forEach((kind, channel) => {
    const counts = new Float32Array(columns);
    for (const t of a.events[kind].times) counts[columnOf(t)]++;
    const max = Math.max(1, ...counts);
    for (let c = 0; c < columns; c++) out[at(c, ROW.hits) + channel] = counts[c] / max;
  });
  const mark = (track: EventTrack, channel: number, value: (i: number) => number): void => {
    for (let i = 0; i < track.times.length; i++) {
      const o = at(columnOf(track.times[i]), ROW.marks) + channel;
      out[o] = Math.max(out[o], value(i));
    }
  };
  mark(a.events.drop, 2, (i) => a.events.drop.strengths[i]);
  mark(a.events.section, 3, () => 1);
  return out;
}
