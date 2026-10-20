import type { App } from "../app.ts";
import { CUE_SNAP, moveCue, snapToBar } from "../render/show.ts";
import type { Cue } from "../render/show.ts";
import { SCENES } from "../render/scenes/index.ts";

const HEIGHT = 46;
const HANDLE_PX = 7;

/**
 * The show timeline above the transport bar: the song's sections (pink ticks) and bars,
 * one block per cue coloured by scene, and the playhead.
 *
 *   ┊   ┊   ┊   ┊   ┊   ┊   ┊   ┊   ┊   ┊   ┊   ┊   ┊   ┊      bars
 *   │▓▓ preset ▓▓│◢ Tunnel ████████│ Orb · Ice ████│ Terrain …   cues (◢ = crossfade, │ = cut)
 *
 * Click a block to select its cue and jump there; drag a cue's left edge to move it (snaps to
 * downbeats; hold Alt for free placement).
 */
export class Timeline {
  /** Time of the selected cue, or null. */
  selected: number | null = null;
  onSelect: (cue: Cue | null) => void = () => {};
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly app: App;
  private drag: { from: number; to: number } | null = null;

  constructor(canvas: HTMLCanvasElement, app: App) {
    this.canvas = canvas;
    this.app = app;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("2D canvas unavailable");
    this.ctx = ctx;
    canvas.addEventListener("pointerdown", (e) => this.pointerDown(e));
    canvas.addEventListener("pointermove", (e) => this.pointerMove(e));
    canvas.addEventListener("pointerup", (e) => this.pointerUp(e));
    const frame = (): void => {
      this.draw();
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }

  get selectedCue(): Cue | null {
    const t = this.selected;
    return t === null ? null : (this.app.show.find((c) => Math.abs(c.t - t) <= CUE_SNAP) ?? null);
  }

  select(t: number | null): void {
    this.selected = t;
    this.onSelect(this.selectedCue);
  }

  private get duration(): number {
    return this.app.analysis?.duration ?? 0;
  }

  private timeAt(e: PointerEvent): number {
    const rect = this.canvas.getBoundingClientRect();
    return Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)) * this.duration;
  }

  private xOf(t: number, width: number): number {
    return this.duration > 0 ? (t / this.duration) * width : 0;
  }

  private handleAt(e: PointerEvent): Cue | null {
    const rect = this.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    let best: Cue | null = null;
    for (const c of this.app.show) {
      const d = Math.abs(this.xOf(c.t, rect.width) - x);
      if (d <= HANDLE_PX && (!best || d < Math.abs(this.xOf(best.t, rect.width) - x))) best = c;
    }
    return best;
  }

  private pointerDown(e: PointerEvent): void {
    if (this.duration <= 0) return;
    const handle = this.handleAt(e);
    if (handle) {
      this.drag = { from: handle.t, to: handle.t };
      this.canvas.setPointerCapture(e.pointerId);
      this.select(handle.t);
      return;
    }
    const t = this.timeAt(e);
    const owner = [...this.app.show].reverse().find((c) => c.t <= t);
    this.select(owner?.t ?? null);
    void this.app.player.seek(t);
  }

  private pointerMove(e: PointerEvent): void {
    this.canvas.style.cursor = this.drag || this.handleAt(e) ? "ew-resize" : "pointer";
    if (!this.drag) return;
    const t = this.timeAt(e);
    this.drag.to = e.altKey ? t : snapToBar(t, this.app.analysis?.events.downbeat.times ?? []);
  }

  private pointerUp(e: PointerEvent): void {
    const drag = this.drag;
    if (!drag) return;
    this.drag = null;
    this.canvas.releasePointerCapture(e.pointerId);
    if (Math.abs(drag.to - drag.from) <= CUE_SNAP) return;
    this.app.setShow(moveCue(this.app.show, drag.from, drag.to));
    this.select(drag.to);
  }

  private draw(): void {
    const visible = this.duration > 0 && !this.app.isLive;
    this.canvas.hidden = !visible;
    if (!visible) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const width = this.canvas.clientWidth;
    if (this.canvas.width !== Math.round(width * dpr)) {
      this.canvas.width = Math.round(width * dpr);
      this.canvas.height = Math.round(HEIGHT * dpr);
    }
    const c = this.ctx;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, width, HEIGHT);
    c.fillStyle = "rgba(10,10,14,0.72)";
    c.beginPath();
    c.roundRect(0, 0, width, HEIGHT, 10);
    c.fill();

    const a = this.app.analysis;
    if (!a) return;
    c.fillStyle = "rgba(255,255,255,0.12)";
    for (const t of a.events.downbeat.times) c.fillRect(this.xOf(t, width), 4, 1, 6);
    c.fillStyle = "#ff4fd8";
    for (const t of a.events.section.times) c.fillRect(this.xOf(t, width) - 1, 2, 2, 10);

    const cues = this.drag ? moveCue(this.app.show, this.drag.from, this.drag.to) : this.app.show;
    const top = 14;
    const h = HEIGHT - top - 6;
    c.font = "11px Inter, 'Segoe UI', system-ui, sans-serif";
    c.textBaseline = "middle";
    const block = (x0: number, x1: number, color: string, label: string, selected: boolean): void => {
      c.fillStyle = color;
      c.fillRect(x0, top, Math.max(1, x1 - x0), h);
      if (selected) {
        c.strokeStyle = "#fff";
        c.lineWidth = 2;
        c.strokeRect(x0 + 1, top + 1, Math.max(1, x1 - x0 - 2), h - 2);
      }
      if (x1 - x0 > 30) {
        c.save();
        c.beginPath();
        c.rect(x0, top, x1 - x0 - 4, h);
        c.clip();
        c.fillStyle = "rgba(255,255,255,0.92)";
        c.fillText(label, x0 + 6, top + h / 2);
        c.restore();
      }
    };
    const first = cues.length > 0 ? this.xOf(cues[0].t, width) : width;
    block(0, first, "rgba(255,255,255,0.08)", cues.length > 0 ? "preset scene" : "No cues yet: press K to add one here", false);
    cues.forEach((cue, i) => {
      const x0 = this.xOf(cue.t, width);
      const x1 = i + 1 < cues.length ? this.xOf(cues[i + 1].t, width) : width;
      const index = Math.max(0, SCENES.findIndex((s) => s.id === cue.scene));
      const name = SCENES[index]?.name ?? cue.scene;
      const selected = this.selected !== null && Math.abs(cue.t - (this.drag ? this.drag.from : this.selected)) <= CUE_SNAP;
      block(x0, x1, `hsla(${(index * 360) / SCENES.length}, 55%, 42%, 0.85)`, cue.palette ? `${name} · ${cue.palette}` : name, selected);
      c.fillStyle = "#fff";
      if (cue.cut) c.fillRect(x0 - 1, top - 2, 2, h + 4);
      else {
        c.beginPath();
        c.moveTo(x0, top);
        c.lineTo(x0, top + h);
        c.lineTo(x0 - 8, top + h);
        c.closePath();
        c.fill();
      }
    });

    const px = this.xOf(this.app.player.time, width);
    c.fillStyle = "#ff7a45";
    c.fillRect(px - 1, 0, 2, HEIGHT);
  }
}
