/**
 * Offline analysis report for tuning the detectors against real music.
 *
 *   node tools/analyze.ts <file.mp3> [--from 30] [--seconds 20] [--png out/plot.png]
 *
 * Prints event counts and tempo, and optionally renders a strip-chart PNG:
 * spectrogram, then one lane per detector (curve = onset function, ticks = detected events),
 * then the continuous features. Grey lines are beats, white lines are downbeats.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { parseArgs } from "node:util";
import { analyzeTrack } from "../src/analysis/track.ts";
import { MEL_BANDS } from "../src/analysis/frame.ts";
import { EVENT_KINDS } from "../src/analysis/types.ts";
import type { DetectorKind, ScalarName, TrackAnalysis } from "../src/analysis/types.ts";

const SAMPLE_RATE = 44100;

export function decode(path: string): { left: Float32Array; right: Float32Array } {
  const res = spawnSync("ffmpeg", ["-v", "error", "-i", path, "-f", "f32le", "-ac", "2", "-ar", String(SAMPLE_RATE), "-"], {
    maxBuffer: 1 << 30,
  });
  if (res.status !== 0) throw new Error(`ffmpeg failed: ${res.stderr.toString()}`);
  const buf = res.stdout;
  const all = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
  const n = all.length / 2;
  const left = new Float32Array(n);
  const right = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    left[i] = all[2 * i];
    right[i] = all[2 * i + 1];
  }
  return { left, right };
}

type RGB = [number, number, number];

class Canvas {
  readonly pixels: Uint8Array;
  readonly width: number;
  readonly height: number;
  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.pixels = new Uint8Array(width * height * 3).fill(12);
  }
  set(x: number, y: number, [r, g, b]: RGB, alpha = 1): void {
    x = Math.round(x);
    y = Math.round(y);
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    const i = (y * this.width + x) * 3;
    this.pixels[i] += (r - this.pixels[i]) * alpha;
    this.pixels[i + 1] += (g - this.pixels[i + 1]) * alpha;
    this.pixels[i + 2] += (b - this.pixels[i + 2]) * alpha;
  }
  vline(x: number, y0: number, y1: number, c: RGB, alpha = 1): void {
    for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) this.set(x, y, c, alpha);
  }
  hline(y: number, c: RGB, alpha = 1): void {
    for (let x = 0; x < this.width; x++) this.set(x, y, c, alpha);
  }
}

const heat = (v: number): RGB => {
  const t = Math.max(0, Math.min(1, v));
  return [255 * Math.min(1, t * 2), 255 * Math.max(0, t * 2 - 0.6), 255 * Math.max(0, 1 - Math.abs(t - 0.25) * 4) * 0.8];
};

const DETECTOR_COLORS: Record<DetectorKind, RGB> = {
  kick: [255, 80, 60],
  snare: [255, 220, 60],
  hat: [80, 220, 255],
  onset: [200, 200, 200],
  note: [180, 120, 255],
};

const SCALAR_GROUPS: { names: ScalarName[]; colors: RGB[] }[] = [
  { names: ["sub", "bass", "lowMid", "mid", "high", "air"], colors: [[255, 60, 60], [255, 150, 60], [230, 230, 60], [80, 230, 80], [60, 180, 255], [200, 120, 255]] },
  { names: ["loudness", "intensity", "percussive", "harmonic"], colors: [[255, 255, 255], [255, 120, 200], [255, 120, 60], [80, 200, 255]] },
  { names: ["brightness", "noisiness", "tonalness", "width"], colors: [[255, 230, 120], [180, 180, 180], [120, 255, 160], [255, 120, 255]] },
  { names: ["timbreX", "timbreY", "timbreZ", "novelty"], colors: [[255, 90, 90], [90, 255, 90], [90, 140, 255], [255, 255, 255]] },
];

function plot(a: TrackAnalysis, from: number, seconds: number, out: string): void {
  const width = 1600;
  const specH = 160;
  const laneH = 70;
  const lanes = Object.keys(DETECTOR_COLORS).length + SCALAR_GROUPS.length;
  const height = specH + lanes * laneH;
  const c = new Canvas(width, height);
  const f0 = Math.floor(from * a.fps);
  const frameAt = (x: number): number => Math.min(a.frames - 1, f0 + Math.floor((x / width) * seconds * a.fps));
  const xOf = (t: number): number => ((t - from) / seconds) * width;

  for (let x = 0; x < width; x++) {
    const f = frameAt(x);
    for (let y = 0; y < specH; y++) {
      const band = Math.floor(((specH - 1 - y) / specH) * MEL_BANDS);
      c.set(x, y, heat(a.mel[f * MEL_BANDS + band]));
    }
  }

  let top = specH;
  for (const [kind, color] of Object.entries(DETECTOR_COLORS) as [DetectorKind, RGB][]) {
    const odf = a.odfs[kind];
    let max = 1e-9;
    for (let f = f0; f < Math.min(a.frames, f0 + seconds * a.fps); f++) max = Math.max(max, odf[f]);
    for (let x = 0; x < width; x++) c.vline(x, top + laneH - 2, top + laneH - 2 - (odf[frameAt(x)] / max) * (laneH - 8), color, 0.35);
    const ev = a.events[kind];
    for (let i = 0; i < ev.times.length; i++) {
      const x = xOf(ev.times[i]);
      if (x >= 0 && x < width) c.vline(x, top + 2, top + 2 + Math.min(1, ev.strengths[i]) * (laneH - 10), color);
    }
    c.hline(top + laneH - 1, [60, 60, 60]);
    top += laneH;
  }

  for (const group of SCALAR_GROUPS) {
    group.names.forEach((name, gi) => {
      const data = a.scalars[name];
      const signed = name.startsWith("timbre");
      for (let x = 0; x < width; x++) {
        const v = data[frameAt(x)];
        const norm = signed ? 0.5 + 0.5 * v : v;
        c.set(x, top + laneH - 3 - norm * (laneH - 6), group.colors[gi]);
      }
    });
    c.hline(top + laneH - 1, [60, 60, 60]);
    top += laneH;
  }

  const beatTimes = a.events.beat.times;
  const downTimes = new Set(Array.from(a.events.downbeat.times));
  for (const t of beatTimes) {
    const x = xOf(t);
    if (x >= 0 && x < width) c.vline(x, 0, height - 1, downTimes.has(t) ? [255, 255, 255] : [120, 120, 120], downTimes.has(t) ? 0.45 : 0.25);
  }
  for (const t of a.events.section.times) {
    const x = xOf(t);
    if (x >= 0 && x < width) c.vline(x, 0, height - 1, [255, 0, 255], 0.9);
  }

  mkdirSync(dirname(out), { recursive: true });
  const res = spawnSync("ffmpeg", ["-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", `${width}x${height}`, "-i", "-", out], { input: c.pixels });
  if (res.status !== 0) throw new Error(`ffmpeg png failed: ${res.stderr.toString()}`);
}

function main(): void {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      from: { type: "string", default: "30" },
      seconds: { type: "string", default: "20" },
      png: { type: "string" },
    },
  });
  if (positionals.length !== 1) {
    console.error("usage: node tools/analyze.ts <file.mp3> [--from 30] [--seconds 20] [--png out/plot.png]");
    process.exit(2);
  }
  const path = positionals[0];
  const t0 = performance.now();
  const { left, right } = decode(path);
  const t1 = performance.now();
  const a = analyzeTrack(left, right, SAMPLE_RATE);
  const t2 = performance.now();
  const name = path.split("/").pop();
  const counts = EVENT_KINDS.map((k) => `${k}=${a.events[k].times.length}`).join(" ");
  console.log(`${name} | ${a.duration.toFixed(1)}s | tempo ${a.tempo.toFixed(1)} | ${counts} | decode ${(t1 - t0).toFixed(0)}ms analyze ${(t2 - t1).toFixed(0)}ms`);
  if (values.png) plot(a, Number(values.from), Number(values.seconds), values.png);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
