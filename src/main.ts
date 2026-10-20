import { App } from "./app.ts";
import { listTracks } from "./audio/library.ts";
import { exportVideo, EXPORT_RESOLUTIONS } from "./export/video.ts";
import { builtinPresets } from "./presets.ts";
import { PALETTES } from "./render/palettes.ts";
import { SCENES } from "./render/scenes/index.ts";
import { mergeSettings } from "./settings.ts";
import { decodeShare } from "./share.ts";
import { LiveRecorder } from "./export/recorder.ts";
import { PresetBrowser } from "./ui/browser.ts";
import { Panel } from "./ui/panel.ts";
import { Timeline } from "./ui/timeline.ts";

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} missing from index.html`);
  return el as T;
};

const statusEl = $("status");
let statusTimer = 0;
function showStatus(message: string, isError = false): void {
  statusEl.hidden = false;
  statusEl.textContent = message;
  statusEl.classList.toggle("error", isError);
  window.clearTimeout(statusTimer);
  if (!message.endsWith("…") && !message.includes("%")) statusTimer = window.setTimeout(() => (statusEl.hidden = true), isError ? 12000 : 5000);
}

function formatTime(t: number): string {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

async function main(): Promise<void> {
  const params = new URLSearchParams(location.search);
  let app: App;
  try {
    app = new App($("view"), $("hud"));
  } catch (err: unknown) {
    showStatus(`Can't start: ${err instanceof Error ? err.message : String(err)}`, true);
    throw err;
  }
  app.onStatus = showStatus;

  if (params.has("still")) {
    await runStill(app, params);
    return;
  }
  if (params.has("smoke")) {
    runSmoke(app);
    return;
  }

  const tracks = await listTracks();
  const fileInput = $<HTMLInputElement>("file");
  const openFile = (): void => fileInput.click();
  fileInput.onchange = (): void => {
    const file = fileInput.files?.[0];
    if (file) app.loadFile(file).catch((err: unknown) => showStatus(String(err), true));
  };

  let abort: AbortController | null = null;
  let browser: PresetBrowser | null = null;
  const panel = new Panel(app, tracks, {
    openFile,
    browsePresets: () => browser?.toggle(),
    toggleRecording: () => void toggleRecording(app),
    exportVideo: (opts) => {
      if (!app.player.buffer) {
        showStatus("Load a track first", true);
        return;
      }
      if (abort) {
        abort.abort();
        return;
      }
      const [width, height] = EXPORT_RESOLUTIONS[opts.resolution];
      const end = opts.end > opts.start ? Math.min(opts.end, app.player.duration) : app.player.duration;
      abort = new AbortController();
      app.player.pause();
      app.exporting = true;
      app.titleStart = opts.start;
      app.renderer.resize(width, height, 1);
      app.renderer.resetFeedback();
      app.renderer.resetAdaptation();
      const name = (app.settings.overlay.title || "music-shader").replace(/[^\w\- ]+/g, "").trim();
      exportVideo({
        canvas: app.renderer.canvas,
        audio: app.player.buffer,
        width,
        height,
        fps: opts.fps,
        start: opts.start,
        end,
        quality: opts.quality === "high" ? "high" : "very high",
        fileName: `${name} ${opts.resolution}.mp4`,
        mode: "save",
        renderFrame: (t, dt) => app.renderAt(t, dt),
        onProgress: (p, eta) => showStatus(`Rendering ${Math.round(p * 100)}%, about ${formatTime(eta)} left. Click “Render video…” again to cancel`),
        signal: abort.signal,
      })
        .then(() => showStatus("Export finished"))
        .catch((err: unknown) => showStatus(err instanceof DOMException && err.name === "AbortError" ? "Export cancelled" : `Export failed: ${String(err)}`, true))
        .finally(() => {
          abort = null;
          app.exporting = false;
          app.titleStart = 0;
        });
    },
  });

  const timeline = new Timeline($("timeline"), app);
  panel.attachTimeline(timeline);
  app.onShowChanged = (): void => {
    if (timeline.selected !== null && !timeline.selectedCue) timeline.select(null);
  };

  browser = new PresetBrowser(
    $("browser"),
    app,
    () => panel.presetEntries(),
    (name) => panel.applyPreset(name),
  );

  const welcome = $("welcome");
  welcome.hidden = false;
  app.onTrackLoaded = (): void => {
    welcome.hidden = true;
    panel.setTrack(app.trackName);
    $("track-name").textContent = app.settings.overlay.title;
  };

  wireTransport(app);
  wireDragDrop(app, panel);
  wireKeys(app, panel, browser, openFile);
  wireIdle(app);
  app.start();

  if (params.has("hud")) {
    app.settings.overlay.showHud = true;
    app.hud.visible = true;
  }
  const scene = SCENES.find((x) => x.id === params.get("scene"));
  if (scene) panel.applyPreset(scene.name);
  const shared = decodeShare(location.hash);
  if (shared) {
    panel.replaceSettings(mergeSettings(app.settings, shared));
    history.replaceState(null, "", location.pathname + location.search);
    showStatus("Loaded a shared look. Save it under Presets to keep it");
  }
  const initial = params.get("track");
  if (initial) app.loadTrackByName(initial).catch((err: unknown) => showStatus(String(err), true));
  const live = params.get("live");
  if (live === "mic" || live === "tab") app.startLive(live).catch((err: unknown) => showStatus(String(err), true));
}

function wireTransport(app: App): void {
  const play = $<HTMLButtonElement>("play");
  const seek = $<HTMLInputElement>("seek");
  const time = $("time");
  const duration = $("duration");
  let dragging = false;
  play.onclick = (): void => void app.togglePlay();
  seek.oninput = (): void => {
    dragging = true;
  };
  seek.onchange = (): void => {
    dragging = false;
    void app.player.seek(Number(seek.value) * app.player.duration);
  };
  const tick = (): void => {
    const d = app.player.duration;
    const t = app.player.time;
    play.textContent = app.player.playing ? "❚❚" : "▶";
    play.setAttribute("aria-label", app.player.playing ? "Pause" : "Play");
    const live = app.isLive;
    time.textContent = live ? "● LIVE" : formatTime(t);
    duration.textContent = live ? "" : formatTime(d);
    seek.disabled = live;
    if (!dragging && d > 0) seek.value = String(t / d);
    requestAnimationFrame(tick);
  };
  tick();
}

/** Drop audio to load it, an image for cover art, or an .lrc file for lyrics. */
function wireDragDrop(app: App, panel: Panel): void {
  const drop = $("drop");
  let depth = 0;
  window.addEventListener("dragenter", (e) => {
    e.preventDefault();
    depth++;
    drop.hidden = false;
  });
  window.addEventListener("dragleave", () => {
    if (--depth <= 0) drop.hidden = true;
  });
  window.addEventListener("dragover", (e) => e.preventDefault());
  window.addEventListener("drop", (e) => {
    e.preventDefault();
    depth = 0;
    drop.hidden = true;
    const file = e.dataTransfer?.files[0];
    if (!file) return;
    if (file.type.startsWith("image/")) panel.loadArt(file);
    else if (/\.lrc$/i.test(file.name)) panel.loadLyrics(file);
    else app.loadFile(file).catch((err: unknown) => showStatus(String(err), true));
  });
}

function wireKeys(app: App, panel: Panel, browser: PresetBrowser, openFile: () => void): void {
  window.addEventListener("keydown", (e) => {
    if (e.target instanceof HTMLInputElement && e.target.type !== "range") return;
    const s = app.settings;
    if (e.key === "b" || e.key === "B") {
      browser.toggle();
      return;
    }
    if (e.key === "Escape" && browser.isOpen) {
      browser.close();
      return;
    }
    if (e.code === "Space") {
      e.preventDefault();
      void app.togglePlay();
    } else if (e.key === "ArrowRight") void app.player.seek(app.player.time + (e.shiftKey ? 30 : 5));
    else if (e.key === "ArrowLeft") void app.player.seek(app.player.time - (e.shiftKey ? 30 : 5));
    else if (e.key === "h" || e.key === "H") document.body.classList.toggle("ui-hidden");
    else if (e.key === "f" || e.key === "F") {
      if (document.fullscreenElement) void document.exitFullscreen();
      else void document.documentElement.requestFullscreen();
    } else if (e.key === "d" || e.key === "D") {
      s.overlay.showHud = !s.overlay.showHud;
      app.hud.visible = s.overlay.showHud;
      panel.gui.controllersRecursive().forEach((c) => c.updateDisplay());
    } else if (e.key === "o" || e.key === "O") openFile();
    else if (e.key === "r" || e.key === "R") panel.surprise();
    else if (e.key === "t" || e.key === "T") panel.cycleTempo();
    else if (e.key === "c" || e.key === "C") void toggleRecording(app);
    else if (e.key === "k" || e.key === "K") panel.addCue();
    else if (e.key === "Delete" || e.key === "Backspace") panel.deleteSelectedCue();
    else if (e.key === "p" || e.key === "P") {
      const i = PALETTES.findIndex((p) => p.name === s.palette);
      s.palette = PALETTES[(i + 1) % PALETTES.length].name;
      panel.gui.controllersRecursive().forEach((c) => c.updateDisplay());
      showStatus(`Palette: ${s.palette}`);
    } else if (/^[0-9]$/.test(e.key)) {
      const scene = SCENES[(Number(e.key) + 9) % 10];
      if (scene) panel.applyPreset(scene.name);
    } else return;
    app.settingsChanged();
  });
}

let recorder: LiveRecorder | null = null;

/** C: record the canvas and the song audio in real time (scene keys and live input included). */
async function toggleRecording(app: App): Promise<void> {
  if (recorder) {
    const rec = recorder;
    recorder = null;
    showStatus(`Saving ${rec.fileName}…`);
    await rec.stop().then(
      () => showStatus(`Saved ${rec.fileName} (${Math.round(rec.seconds)} s)`),
      (err: unknown) => showStatus(`Recording failed: ${String(err)}`, true),
    );
    return;
  }
  try {
    recorder = await LiveRecorder.start(app.renderer.canvas, app.recordingAudio(),`${app.settings.overlay.title || "music-shader"} live`);
    showStatus("● Recording… press C to stop");
  } catch (err: unknown) {
    if (err instanceof DOMException && err.name === "AbortError") return;
    showStatus(`Can't record: ${err instanceof Error ? err.message : String(err)}`, true);
  }
}

/** While playing, fades the UI out after a few seconds without input, for clean screen recordings. */
function wireIdle(app: App): void {
  let timer = 0;
  const wake = (): void => {
    document.body.classList.remove("idle");
    window.clearTimeout(timer);
    timer = window.setTimeout(function hideIfPlaying() {
      if (app.player.playing) document.body.classList.add("idle");
      else timer = window.setTimeout(hideIfPlaying, 1000);
    }, 3000);
  };
  window.addEventListener("mousemove", wake);
  window.addEventListener("keydown", wake);
  wake();
}

/**
 * ?still&track=NAME&t=SECONDS[&scene=ID&w=640&h=360&warm=1&fps=30]: renders one frame, then sets the title to "ready".
 * &art=URL and &lrc=URL load cover art and lyrics first; &thumbnail renders the YouTube thumbnail instead.
 */
async function runStill(app: App, params: URLSearchParams): Promise<void> {
  document.body.classList.add("still");
  const scene = params.get("scene");
  const preset = SCENES.find((x) => x.id === scene);
  if (preset) {
    Object.assign(app.settings, structuredClone(builtinPresets()[preset.name]));
    app.applyScene();
  }
  app.settings.overlay.showTitle = params.has("title");
  applyOverrides(app, params.get("set"));
  const track = params.get("track");
  if (track) await app.loadTrackByName(track);
  const art = params.get("art");
  if (art) await app.setArt(await (await fetch(art)).blob());
  const lrc = params.get("lrc");
  if (lrc) app.setLyrics(await (await fetch(lrc)).text());
  if (params.has("thumbnail")) {
    await app.renderYouTubeThumbnail();
    document.title = "ready";
    return;
  }
  const num = (k: string, d: number): number => (params.has(k) ? Number(params.get(k)) : d);
  const [t, w, h, fps] = [num("t", 30), num("w", 640), num("h", 360), num("fps", 30)];
  if (params.has("export")) {
    await runExportTest(app, t, num("export", 2), w, h, fps);
    return;
  }
  app.renderStill(t, w, h, num("warm", 1), fps);
  console.info(`adapted luminance ${app.renderer.adaptedLuminance().toFixed(4)} glError ${app.renderer.gl.getError()}`);
  const frames = num("sheet", 0);
  if (frames > 0) renderSheet(app, t, w, h, fps, frames);
  document.title = "ready";
}

/** ?smoke: compiles every scene and draws a frame of each; per-scene errors land in window.__smoke for tools/smoke.ts. */
function runSmoke(app: App): void {
  document.body.classList.add("still");
  const results = SCENES.map((scene) => {
    try {
      app.settings.scene = scene.id;
      app.applyScene();
      app.renderStill(1, 320, 180, 0.2, 30);
      const glError = app.renderer.gl.getError();
      return { id: scene.id, error: glError === 0 ? "" : `WebGL error 0x${glError.toString(16)}` };
    } catch (err: unknown) {
      return { id: scene.id, error: err instanceof Error ? err.message : String(err) };
    }
  });
  (window as unknown as { __smoke: typeof results }).__smoke = results;
  document.title = "ready";
}

/** `set=look.bloom=0,reactivity.kick=2,palette=Gold`: quick numeric/string overrides for experiments. */
function applyOverrides(app: App, spec: string | null): void {
  if (!spec) return;
  const patch: Record<string, unknown> = {};
  for (const pair of spec.split(",")) {
    const [path, raw] = pair.split("=");
    if (!path || raw === undefined) continue;
    const keys = path.split(".");
    let node = patch;
    for (const k of keys.slice(0, -1)) node = (node[k] ??= {}) as Record<string, unknown>;
    const n = Number(raw);
    node[keys[keys.length - 1]] = raw === "true" ? true : raw === "false" ? false : Number.isFinite(n) ? n : raw;
  }
  app.settings = mergeSettings(app.settings, patch);
  app.applyScene();
}

/** Encodes a short clip into memory and exposes it as base64 on window.__export for tools/shot.ts --export. */
async function runExportTest(app: App, start: number, seconds: number, w: number, h: number, fps: number): Promise<void> {
  const audio = app.player.buffer;
  if (!audio) throw new Error("export test needs a track");
  app.renderer.resize(w, h, 1);
  app.titleStart = start;
  app.renderer.resetFeedback();
  app.renderer.resetAdaptation();
  const began = performance.now();
  const bytes = await exportVideo({
    canvas: app.renderer.canvas,
    audio,
    width: w,
    height: h,
    fps,
    start,
    end: start + seconds,
    quality: "high",
    fileName: "test.mp4",
    mode: "buffer",
    renderFrame: (tt, dt) => app.renderAt(tt, dt),
    onProgress: () => {},
    signal: new AbortController().signal,
  });
  if (!bytes) throw new Error("export returned no data");
  let binary = "";
  const view = new Uint8Array(bytes);
  for (let i = 0; i < view.length; i += 0x8000) binary += String.fromCharCode(...view.subarray(i, i + 0x8000));
  (window as unknown as { __export: string; __exportMs: number }).__export = btoa(binary);
  (window as unknown as { __exportMs: number }).__exportMs = performance.now() - began;
  document.title = "ready";
}

/** Contact sheet of consecutive frames, for checking how hits look frame by frame. */
function renderSheet(app: App, t: number, w: number, h: number, fps: number, frames: number): void {
  const cols = 4;
  const rows = Math.ceil(frames / cols);
  const sheet = document.createElement("canvas");
  sheet.width = w * cols;
  sheet.height = h * rows;
  const ctx = sheet.getContext("2d");
  if (!ctx) return;
  ctx.font = `${Math.round(h / 14)}px monospace`;
  ctx.fillStyle = "#fff";
  for (let i = 0; i < frames; i++) {
    const ft = t + i / fps;
    if (i > 0) app.renderAt(ft, 1 / fps);
    const x = (i % cols) * w;
    const y = Math.floor(i / cols) * h;
    ctx.drawImage(app.renderer.canvas, x, y, w, h);
    const f = app.features;
    ctx.fillText(`${ft.toFixed(3)}s k${f.env.kick.toFixed(1)} s${f.env.snare.toFixed(1)} h${f.env.hat.toFixed(1)}`, x + 6, y + h / 12);
  }
  sheet.id = "view";
  document.body.replaceChildren(sheet);
  document.body.style.overflow = "visible";
}

main().catch((err: unknown) => {
  console.error(err);
  document.title = "error";
});
