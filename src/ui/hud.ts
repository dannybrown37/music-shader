import type { Features } from "../analysis/sampler.ts";
import type { EventKind, ScalarName } from "../analysis/types.ts";
import { keyHue } from "../render/reactivity.ts";

/**
 * "What the visualizer hears": lamps for each detected event, bars for continuous features,
 * the timbre coordinate, the key wheel and the beat/bar clock. Never part of exported video.
 */

const LAMPS: [EventKind, string, string][] = [
  ["kick", "KICK", "#ff5a3c"],
  ["snare", "SNARE", "#ffd23c"],
  ["hat", "HAT", "#50dcff"],
  ["onset", "ONSET", "#cccccc"],
  ["note", "NOTE", "#b478ff"],
  ["beat", "BEAT", "#888888"],
  ["downbeat", "BAR", "#ffffff"],
  ["section", "SECTION", "#ff4fd8"],
];

const BARS: [ScalarName, string][] = [
  ["sub", "sub"],
  ["bass", "bass"],
  ["lowMid", "lo-mid"],
  ["mid", "mid"],
  ["high", "high"],
  ["air", "air"],
  ["loudness", "loud"],
  ["intensity", "intensity"],
  ["percussive", "perc"],
  ["harmonic", "harm"],
  ["brightness", "bright"],
  ["noisiness", "noisy"],
  ["tonalness", "tonal"],
  ["width", "width"],
  ["novelty", "novelty"],
];

const NOTE_NAMES = ["C", "C♯", "D", "E♭", "E", "F", "F♯", "G", "A♭", "A", "B♭", "B"];

export class Hud {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly width = 300;
  private readonly height = 470;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = this.width * dpr;
    canvas.height = this.height * dpr;
    canvas.style.width = `${this.width}px`;
    canvas.style.height = `${this.height}px`;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("2D canvas unavailable");
    ctx.scale(dpr, dpr);
    this.ctx = ctx;
  }

  set visible(v: boolean) {
    this.canvas.style.display = v ? "block" : "none";
  }

  draw(f: Features, label: string): void {
    const c = this.ctx;
    c.clearRect(0, 0, this.width, this.height);
    c.fillStyle = "rgba(8,8,12,0.72)";
    c.beginPath();
    c.roundRect(0, 0, this.width, this.height, 10);
    c.fill();
    c.font = "10px ui-monospace, Consolas, monospace";
    c.textBaseline = "middle";

    LAMPS.forEach(([kind, name, color], i) => {
      const x = 22 + (i % 4) * 70;
      const y = 22 + Math.floor(i / 4) * 30;
      const v = Math.min(1, f.env[kind]);
      c.fillStyle = color;
      c.globalAlpha = 0.15 + 0.85 * v;
      c.beginPath();
      c.arc(x, y, 7, 0, Math.PI * 2);
      c.fill();
      c.globalAlpha = 1;
      c.fillStyle = "#bbb";
      c.fillText(name, x + 11, y);
    });

    const top = 84;
    BARS.forEach(([name, label], i) => {
      const y = top + i * 14;
      const v = f.scalars[name];
      c.fillStyle = "#777";
      c.fillText(label, 10, y);
      c.fillStyle = "rgba(255,255,255,0.08)";
      c.fillRect(74, y - 4, 120, 8);
      c.fillStyle = `hsl(${20 + i * 18}, 80%, 60%)`;
      c.fillRect(74, y - 4, 120 * Math.max(0, Math.min(1, v)), 8);
    });

    const tx = 250;
    const ty = 130;
    c.strokeStyle = "rgba(255,255,255,0.2)";
    c.strokeRect(tx - 40, ty - 40, 80, 80);
    c.fillStyle = "#777";
    c.fillText("timbre", tx - 18, ty - 50);
    const s = f.scalars;
    c.fillStyle = `hsl(${180 + s.timbreZ * 120}, 90%, 65%)`;
    c.beginPath();
    c.arc(tx + s.timbreX * 38, ty - s.timbreY * 38, 4 + 3 * (s.timbreZ + 1), 0, Math.PI * 2);
    c.fill();

    const wy = 300;
    const wx = 230;
    c.fillStyle = "#777";
    c.fillText("key (circle of fifths)", 150, wy - 70);
    for (let k = 0; k < 12; k++) {
      const pos = (7 * k) % 12;
      const a = (pos / 12) * Math.PI * 2 - Math.PI / 2;
      const v = f.chroma[k];
      c.strokeStyle = `hsl(${pos * 30}, 80%, ${30 + v * 40}%)`;
      c.lineWidth = 5;
      c.beginPath();
      c.moveTo(wx + Math.cos(a) * 18, wy + Math.sin(a) * 18);
      c.lineTo(wx + Math.cos(a) * (18 + v * 32), wy + Math.sin(a) * (18 + v * 32));
      c.stroke();
    }
    const key = keyHue(f);
    const dominant = NOTE_NAMES[(Math.round(key.hue * 12) * 7) % 12];
    c.fillStyle = "#ddd";
    c.fillText(dominant, wx - 6, wy);
    c.lineWidth = 1;

    const by = top + BARS.length * 14 + 18;
    c.fillStyle = "#777";
    c.fillText(`${f.tempo.toFixed(1)} BPM`, 10, by);
    for (let b = 0; b < 4; b++) {
      const active = Math.floor(f.barPhase * 4) === b;
      c.fillStyle = active ? "#fff" : "rgba(255,255,255,0.15)";
      c.fillRect(80 + b * 26, by - 5, 22 * (active ? f.beatPhase : 1), 10);
    }

    const sy = this.height - 70;
    const bw = (this.width - 20) / f.mel.length;
    for (let i = 0; i < f.mel.length; i++) {
      const v = f.mel[i];
      c.fillStyle = `hsl(${280 - i * 4}, 80%, ${25 + v * 45}%)`;
      c.fillRect(10 + i * bw, sy + 40 - v * 40, Math.max(1, bw - 0.5), v * 40);
    }
    c.fillStyle = "#777";
    c.fillText(label, 10, this.height - 14);
  }
}
