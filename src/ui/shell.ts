import type { App } from "../app.ts";
import type { LiveSource } from "../audio/live-input.ts";
import { PALETTES } from "../render/palettes.ts";
import { sceneById, vjScenes } from "../render/scenes/index.ts";
import { REACTIVITY_RANGES, LOOK_RANGES } from "../settings.ts";
import type { Range } from "../settings.ts";
import type { PresetBrowser } from "./browser.ts";
import { availableSources, classifyGesture, stepScene } from "./gestures.ts";
import type { Source } from "./gestures.ts";
import type { Panel } from "./panel.ts";

const IDLE_MS = 3500;
const BATTERY_SCALE = 0.5;

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} missing from index.html`);
  return el as T;
};

function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> = {}, ...children: (Node | string)[]): HTMLElementTagNameMap[K] {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

/**
 * The everyday UI: a welcome screen that starts a source (the microphone first, since the main
 * use is visualising music already playing on the phone), a dock with scene / auto / surprise / more,
 * bottom sheets for scenes and settings, and touch gestures on the visuals. The lil-gui panel stays
 * behind "Advanced controls" for everything else.
 */
export class Shell {
  private readonly app: App;
  private readonly panel: Panel;
  private readonly browser: PresetBrowser;
  private readonly openFile: () => void;
  private readonly sources: Source[];
  private readonly dock = $("dock");
  private readonly welcome = $("welcome");
  private readonly settingsRoot = $("settings");
  private readonly autoButton: HTMLButtonElement;
  private idleTimer = 0;
  private wakeLock: WakeLockSentinel | null = null;

  constructor(app: App, panel: Panel, browser: PresetBrowser, tracks: string[], openFile: () => void) {
    this.app = app;
    this.panel = panel;
    this.browser = browser;
    this.openFile = openFile;
    const coarse = window.matchMedia("(pointer: coarse)").matches;
    this.sources = availableSources({
      mic: window.isSecureContext && typeof navigator.mediaDevices?.getUserMedia === "function",
      display: typeof navigator.mediaDevices?.getDisplayMedia === "function",
      coarse,
    });
    this.autoButton = this.dock.querySelector('[data-action="auto"]') as HTMLButtonElement;
    this.wireWelcome(tracks);
    this.wireDock();
    this.wireSettings();
    this.wireGestures();
    this.wireIdle();
    $("advanced-close").onclick = (): void => this.setAdvanced(false);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible" && this.active) void this.keepAwake();
    });
    this.welcome.hidden = false;
    requestAnimationFrame(this.tick);
  }

  /** Something is driving the visuals: a song (loaded) or live input. */
  private get hasSource(): boolean {
    return this.app.isLive || this.app.player.buffer !== null;
  }

  private get active(): boolean {
    return this.app.isLive || this.app.player.playing;
  }

  /** Called when a song or live input starts. */
  sourceStarted(): void {
    this.welcome.hidden = true;
    this.dock.hidden = false;
    $("track-name").textContent = this.app.isLive ? "" : this.app.settings.overlay.title;
    void this.keepAwake();
    this.wake();
  }

  start(kind: Source): void {
    if (kind === "file") {
      this.openFile();
      return;
    }
    this.app.startLive(kind as LiveSource).catch((err: unknown) => this.app.onStatus(liveError(kind, err), true));
  }

  private wireWelcome(tracks: string[]): void {
    for (const button of this.welcome.querySelectorAll<HTMLButtonElement>("[data-source]")) {
      const kind = button.dataset.source as Source;
      button.hidden = !this.sources.includes(kind);
      button.onclick = (): void => this.start(kind);
    }
    if (!this.sources.includes("mic")) {
      this.welcome.querySelector(".mic-hint")?.remove();
      this.welcome.querySelector('[data-source="file"]')?.classList.add("primary");
    }
    const library = $<HTMLSelectElement>("library");
    if (tracks.length > 0) {
      library.hidden = false;
      library.append(el("option", { value: "", textContent: "…or pick from the library" }), ...tracks.map((t) => el("option", { value: t, textContent: t })));
      library.onchange = (): void => {
        if (library.value) this.app.loadTrackByName(library.value).catch((err: unknown) => this.app.onStatus(String(err), true));
      };
    }
  }

  private wireDock(): void {
    const actions: Record<string, () => void> = {
      prev: () => this.stepScene(-1),
      next: () => this.stepScene(1),
      scenes: () => this.browser.open(),
      auto: () => this.setAuto(!this.app.settings.autoScenes),
      surprise: () => this.panel.surprise(),
      settings: () => this.openSettings(),
    };
    for (const button of this.dock.querySelectorAll<HTMLButtonElement>("[data-action]")) {
      button.onclick = (): void => actions[button.dataset.action ?? ""]?.();
    }
    $<HTMLButtonElement>("play").onclick = (): void => {
      if (this.app.isLive) {
        this.app.stopLive();
        this.app.onStatus("Stopped listening");
      } else void this.app.togglePlay();
    };
  }

  /** Manual scene choice: pick it and stop Auto VJ from immediately switching away. */
  pickedScene(): void {
    if (this.app.settings.autoScenes) this.setAuto(false, true);
  }

  private stepScene(step: number): void {
    const ids = vjScenes().map((s) => s.id);
    const id = stepScene(ids, this.app.activeScene || this.app.settings.scene, step);
    this.panel.applyPreset(sceneById(id).name);
    this.pickedScene();
    this.app.onStatus(sceneById(id).name);
  }

  private setAuto(on: boolean, quiet = false): void {
    this.app.settings.autoScenes = on;
    this.app.applyScene();
    this.app.settingsChanged();
    this.panel.refresh();
    if (!quiet) this.app.onStatus(on ? "Auto VJ on: a new scene at each new section of the music" : "Auto VJ off");
  }

  private readonly tick = (): void => {
    const app = this.app;
    if (!this.hasSource && this.welcome.hidden) {
      this.welcome.hidden = false;
      this.dock.hidden = true;
      this.releaseWake();
    }
    const live = app.isLive;
    this.dock.classList.toggle("live", live);
    const play = $("play");
    play.textContent = live ? "■" : app.player.playing ? "❚❚" : "▶";
    play.setAttribute("aria-label", live ? "Stop listening" : app.player.playing ? "Pause" : "Play");
    if (live) {
      const bpm = app.features.tempo;
      $("track-name").textContent = bpm > 0 ? `${Math.round(bpm)} BPM` : "";
    }
    const name = sceneById(app.activeScene || app.settings.scene).name;
    const label = $("scene-name");
    if (label.textContent !== name) label.textContent = name;
    this.autoButton.setAttribute("aria-pressed", String(app.settings.autoScenes));
    requestAnimationFrame(this.tick);
  };

  // ---------- settings sheet ----------

  private wireSettings(): void {
    const root = this.settingsRoot;
    root.addEventListener("click", (e) => {
      if (e.target === root) this.closeSettings();
    });
    root.querySelector(".close")?.addEventListener("click", () => this.closeSettings());
  }

  get settingsOpen(): boolean {
    return !this.settingsRoot.hidden;
  }

  closeSettings(): void {
    this.settingsRoot.hidden = true;
  }

  private openSettings(): void {
    this.renderSettings();
    this.settingsRoot.hidden = false;
  }

  private renderSettings(): void {
    const app = this.app;
    const s = app.settings;
    const body = this.settingsRoot.querySelector(".settings-body") as HTMLElement;
    const changed = (): void => {
      app.settingsChanged();
      this.panel.refresh();
    };

    const sourceButtons = el("div", { className: "buttons" });
    const labels: Record<Source, string> = { mic: "● Listen", tab: "▣ Capture a tab", file: "♪ Open a song file" };
    for (const kind of this.sources) {
      if (kind === "mic" && app.isLive) continue;
      sourceButtons.append(button(labels[kind], () => (this.closeSettings(), this.start(kind)), kind === "mic"));
    }
    if (app.isLive) sourceButtons.append(button("■ Stop listening", () => (app.stopLive(), this.closeSettings())));

    const chips = el("div", { className: "chips" });
    for (const p of PALETTES) {
      const swatch = el("span", { className: "swatch" });
      swatch.style.background = `linear-gradient(90deg, ${p.stops.join(", ")})`;
      const chip = el("button", { type: "button", className: `chip${p.name === s.palette ? " on" : ""}` }, swatch, p.name);
      chip.onclick = (): void => {
        s.palette = p.name;
        changed();
        for (const c of chips.children) c.classList.toggle("on", c === chip);
      };
      chips.append(chip);
    }

    const r = REACTIVITY_RANGES;
    const l = LOOK_RANGES;
    body.replaceChildren(
      el("h3", { textContent: "Music" }),
      sourceButtons,
      el("h3", { textContent: "Colours" }),
      chips,
      toggleRow("New colours each section", "Moves to the next palette when the music changes", () => s.paletteCycle, (v) => ((s.paletteCycle = v), changed())),
      el("h3", { textContent: "Feel" }),
      sliderRow({ ...r.sensitivity, label: "Sensitivity" }, "How hard everything reacts", () => s.reactivity.sensitivity, (v) => ((s.reactivity.sensitivity = v), changed())),
      sliderRow(r.motion, "", () => s.reactivity.motion, (v) => ((s.reactivity.motion = v), changed())),
      sliderRow(l.feedback, "Each frame lingers into the next", () => s.look.feedback, (v) => ((s.look.feedback = v), changed())),
      sliderRow({ ...l.bloom, label: "Glow" }, "", () => s.look.bloom, (v) => ((s.look.bloom = v), changed())),
      sliderRow({ ...l.exposure, label: "Brightness" }, "", () => s.look.exposure, (v) => ((s.look.exposure = v), changed())),
      el("h3", { textContent: "Options" }),
      toggleRow("Auto VJ", "Switches scene at each new section", () => s.autoScenes, (v) => this.setAuto(v)),
      toggleRow("Battery saver", "Renders at lower resolution: cooler phone, longer battery", () => s.look.renderScale <= BATTERY_SCALE, (v) => ((s.look.renderScale = v ? BATTERY_SCALE : 1), changed())),
      toggleRow("Debug meters", "What the visualiser hears", () => s.overlay.showHud, (v) => ((s.overlay.showHud = v), (app.hud.visible = v), changed())),
      el("h3", { textContent: "More" }),
      el(
        "div",
        { className: "buttons" },
        ...(document.fullscreenEnabled ? [button("⛶ Fullscreen", () => (toggleFullscreen(), this.closeSettings()))] : []),
        button("Hide controls", () => (this.closeSettings(), this.hideNow())),
        button("Copy share link", () => void this.panel.copyShareLink()),
        button("Advanced controls…", () => (this.closeSettings(), this.setAdvanced(true))),
      ),
    );
  }

  setAdvanced(on: boolean): void {
    document.body.classList.toggle("advanced", on);
    $("advanced-close").hidden = !on;
    if (on) {
      this.panel.refresh();
      this.panel.gui.open();
    }
  }

  // ---------- gestures, idle, wake lock ----------

  private wireGestures(): void {
    const view = $("view");
    let down: { x: number; y: number; at: number } | null = null;
    view.addEventListener("pointerdown", (e) => {
      down = { x: e.clientX, y: e.clientY, at: performance.now() };
    });
    view.addEventListener("pointerup", (e) => {
      if (!down) return;
      const g = classifyGesture({ dx: e.clientX - down.x, dy: e.clientY - down.y, ms: performance.now() - down.at });
      down = null;
      if (!this.hasSource) return;
      if (g === "tap") {
        if (document.body.classList.contains("idle") || document.body.classList.contains("ui-hidden")) this.wake();
        else this.hideNow();
      } else if (g === "next" || g === "prev") this.stepScene(g === "next" ? 1 : -1);
    });
    view.addEventListener("pointercancel", () => (down = null));
  }

  private wireIdle(): void {
    window.addEventListener("pointermove", (e) => {
      if (e.pointerType === "mouse") this.wake();
    });
    window.addEventListener("keydown", () => this.wake());
    this.dock.addEventListener("pointerdown", () => this.wake());
  }

  /** Show the controls, then fade them after a few seconds if the music is going and no sheet is open. */
  wake(): void {
    document.body.classList.remove("idle", "ui-hidden");
    window.clearTimeout(this.idleTimer);
    const check = (): void => {
      const busy = this.settingsOpen || this.browser.isOpen || document.body.classList.contains("advanced");
      if (this.active && !busy) document.body.classList.add("idle");
      else this.idleTimer = window.setTimeout(check, 1000);
    };
    this.idleTimer = window.setTimeout(check, IDLE_MS);
  }

  private hideNow(): void {
    window.clearTimeout(this.idleTimer);
    document.body.classList.add("idle");
  }

  /** Phones dim and lock mid-song otherwise. Released by the browser when the tab is hidden. */
  private async keepAwake(): Promise<void> {
    if (!("wakeLock" in navigator) || this.wakeLock) return;
    try {
      const lock = await navigator.wakeLock.request("screen");
      this.wakeLock = lock;
      lock.addEventListener("release", () => {
        if (this.wakeLock === lock) this.wakeLock = null;
      });
    } catch {
      // Denied (low battery, not visible): the screen just follows its normal timeout.
    }
  }

  private releaseWake(): void {
    void this.wakeLock?.release();
    this.wakeLock = null;
  }
}

function liveError(kind: Source, err: unknown): string {
  const name = err instanceof DOMException ? err.name : "";
  if (name === "NotAllowedError") {
    return kind === "mic"
      ? "Microphone blocked. Allow it for this site (the icon by the address bar, or your browser's site settings), then tap Listen again."
      : "Sharing was cancelled.";
  }
  if (name === "NotFoundError") return "No microphone found on this device.";
  if (name === "NotReadableError") return "The microphone is busy in another app. Close it and try again.";
  return `Live input failed: ${err instanceof Error ? err.message : String(err)}`;
}

function toggleFullscreen(): void {
  if (document.fullscreenElement) void document.exitFullscreen();
  else void document.documentElement.requestFullscreen();
}

function button(label: string, onClick: () => void, accent = false): HTMLButtonElement {
  const b = el("button", { type: "button", className: accent ? "btn accent" : "btn", textContent: label });
  b.onclick = onClick;
  return b;
}

let rowId = 0;

function labelFor(id: string, text: string, help: string): HTMLLabelElement {
  const label = el("label", { htmlFor: id }, text);
  if (help) label.append(el("small", { textContent: help }));
  return label;
}

function sliderRow(r: Range, help: string, get: () => number, set: (v: number) => void): HTMLElement {
  const id = `set-${rowId++}`;
  const input = el("input", { type: "range", id, min: String(r.min), max: String(r.max), step: String(r.step ?? (r.max - r.min) / 200), value: String(get()) });
  input.oninput = (): void => set(Number(input.value));
  return el("div", { className: "row" }, labelFor(id, r.label ?? "", help), input);
}

function toggleRow(text: string, help: string, get: () => boolean, set: (v: boolean) => void): HTMLElement {
  const id = `set-${rowId++}`;
  const input = el("input", { type: "checkbox", id, className: "switch", checked: get() });
  input.onchange = (): void => set(input.checked);
  return el("div", { className: "row" }, labelFor(id, text, help), input);
}
