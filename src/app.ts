import { scaleBeats } from "./analysis/beats.ts";
import type { TempoFactor } from "./analysis/beats.ts";
import { MEL_BANDS } from "./analysis/frame.ts";
import { createFeatures, FeatureSampler } from "./analysis/sampler.ts";
import type { Features } from "./analysis/sampler.ts";
import type { TrackAnalysis } from "./analysis/types.ts";
import { analyzeInWorker } from "./audio/analyze.ts";
import { cacheKey, loadCachedAnalysis, saveCachedAnalysis } from "./audio/cache.ts";
import { fetchTrack, titleFromFilename } from "./audio/library.ts";
import { LiveInput } from "./audio/live-input.ts";
import type { LiveSource } from "./audio/live-input.ts";
import { Player } from "./audio/player.ts";
import { loadCurrent, saveCurrent, sceneParamsFor } from "./presets.ts";
import { QualityGovernor } from "./render/quality.ts";
import { Reactor, sectionParams } from "./render/reactivity.ts";
import { Renderer, SPECTROGRAM_ROWS } from "./render/renderer.ts";
import type { SceneFade } from "./render/renderer.ts";
import { buildSchedule, sceneAt } from "./render/schedule.ts";
import type { Downbeats } from "./render/schedule.ts";
import { sceneById, SCENES, SCENES_UPDATED } from "./render/scenes/index.ts";
import type { SceneDef } from "./render/scenes/index.ts";
import { ShaderError } from "./render/gl.ts";
import { defaultSettings } from "./settings.ts";
import { loadTempoFactor, saveTempoFactor } from "./tempo-memory.ts";
import type { Settings } from "./settings.ts";
import { Hud } from "./ui/hud.ts";
import { drawTitleCard, titleAlpha } from "./ui/overlay.ts";

const SPECTROGRAM_SPAN_SECONDS = 2;
const MAX_PIXEL_RATIO = 2;

/** Where features come from: a pre-analysed file (FeatureSampler) or live input (LiveAnalyzer). */
interface FeatureSource {
  sample(t: number, out: Features, decays: Settings["decay"]): void;
  spectrogram(t: number, rows: number, span: number, out: Float32Array): void;
  sectionTimes(): Float32Array;
  downbeats(): Downbeats;
}

const FADE_SECONDS = 1.5;
/** Offline we know where sections are, so the crossfade starts early and the new scene lands on the change. */
const FADE_LEAD_SECONDS = 0.75;

/**
 * Owns the moving parts and the frame loop:
 *
 *   Player.time ──► FeatureSampler.sample ─┐
 *                                          ├─► Reactor.build ─► Renderer.render
 *   LiveInput.time ► LiveAnalyzer.sample ──┘     (Settings)      (scene + post)
 */
export class App {
  settings: Settings;
  readonly renderer: Renderer;
  readonly player = new Player();
  readonly hud: Hud;
  readonly features: Features = createFeatures();
  /** The analysis in use: rawAnalysis with the song's tempo correction applied. */
  analysis: TrackAnalysis | null = null;
  tempoFactor: TempoFactor = 1;
  trackName = "";
  /** Set while exporting so the live loop doesn't fight over the canvas. */
  exporting = false;
  /** Song time the title card is timed from: 0 normally, the range start during an export. */
  titleStart = 0;
  onStatus: (message: string, isError?: boolean) => void = () => {};
  onTrackLoaded: () => void = () => {};

  private sampler: FeatureSampler | null = null;
  private rawAnalysis: TrackAnalysis | null = null;
  private songKey = "";
  private recordTap: MediaStreamAudioDestinationNode | null = null;
  private live: LiveInput | null = null;
  private readonly reactor = new Reactor();
  /** Separate uniform set for the outgoing scene during an auto-VJ crossfade. */
  private readonly fadeReactor = new Reactor();
  /** Scene actually on screen (differs from settings.scene when auto-VJ is on). */
  activeScene = "";
  private readonly quality = new QualityGovernor(1);
  private readonly spectrogramData = new Float32Array(MEL_BANDS * SPECTROGRAM_ROWS);
  private lastFrame = performance.now();
  private lastTime = 0;
  private overlayKey = "";
  private saveTimer = 0;

  constructor(canvas: HTMLCanvasElement, hudCanvas: HTMLCanvasElement) {
    this.settings = loadCurrent() ?? defaultSettings();
    this.renderer = new Renderer(canvas);
    this.hud = new Hud(hudCanvas);
    this.applyScene();
    this.player.onEnded = (): void => this.onStatus("Finished");
    window.addEventListener(SCENES_UPDATED, () => this.reloadScenes());
  }

  /** Recompiles every scene after a hot reload; a broken shader keeps the previous version running. */
  reloadScenes(): void {
    for (const scene of SCENES) {
      try {
        this.renderer.reloadScene(scene);
      } catch (err: unknown) {
        if (!(err instanceof ShaderError)) throw err;
        this.onStatus(err.message, true);
        return;
      }
    }
    this.activeScene = "";
    this.applyScene();
    this.onStatus("Shaders reloaded");
  }

  applyScene(): void {
    const scene = sceneById(this.settings.scene);
    this.renderer.setScene(scene);
    this.activeScene = scene.id;
    if (this.settings.autoScenes) this.renderer.precompile(SCENES);
  }

  /** Debounced persistence of the current settings to localStorage. */
  settingsChanged(): void {
    window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => saveCurrent(this.settings), 300);
  }

  async loadTrackByName(name: string): Promise<void> {
    this.onStatus(`Loading ${name}…`);
    await this.loadArrayBuffer(name, await fetchTrack(name));
  }

  async loadFile(file: File): Promise<void> {
    await this.loadArrayBuffer(file.name, await file.arrayBuffer());
  }

  get isLive(): boolean {
    return this.live !== null;
  }

  /** Space / play button: leaves live mode if needed and toggles the loaded file. */
  async togglePlay(): Promise<void> {
    if (this.live) {
      this.stopLive();
      if (!this.player.buffer) return;
      this.onStatus("Live input stopped");
    }
    await this.player.toggle();
  }

  async startLive(kind: LiveSource): Promise<void> {
    this.stopLive();
    this.player.pause();
    this.onStatus(kind === "mic" ? "Asking for microphone access…" : "Pick a tab or screen and tick “Also share audio”…");
    const live = await LiveInput.start(this.player.ctx, kind);
    live.onEnded = (): void => {
      this.stopLive();
      this.onStatus("Live input ended");
    };
    this.live = live;
    if (this.recordTap) live.connect(this.recordTap);
    this.trackName = kind === "mic" ? "Live: microphone" : "Live: shared audio";
    this.renderer.resetFeedback();
    this.onStatus(`${this.trackName}. The tempo locks after about 4 seconds of music.`);
    this.onTrackLoaded();
  }

  /** Audio for a live recording: the song playing and any live input, now or started later. */
  recordingAudio(): MediaStream {
    if (!this.recordTap) {
      this.recordTap = this.player.ctx.createMediaStreamDestination();
      this.player.output.connect(this.recordTap);
    }
    this.live?.connect(this.recordTap);
    return this.recordTap.stream;
  }

  stopLive(): void {
    if (!this.live) return;
    this.live.stop();
    this.live = null;
    this.renderer.resetFeedback();
  }

  private source(): FeatureSource | null {
    return this.live?.analyzer ?? this.sampler;
  }

  private async loadArrayBuffer(name: string, data: ArrayBuffer): Promise<void> {
    this.stopLive();
    this.player.pause();
    // decodeAudioData detaches `data`, so take its size for the cache key first.
    const key = cacheKey(name, data.byteLength);
    this.onStatus(`Decoding ${name}…`);
    const buffer = await this.player.decode(data);
    const t0 = performance.now();
    let analysis = await loadCachedAnalysis(key);
    const cached = analysis !== null;
    if (!analysis) {
      this.onStatus("Analysing… 0%");
      analysis = await analyzeInWorker(buffer, (p) => this.onStatus(`Analysing… ${Math.round(p * 100)}%`));
      void saveCachedAnalysis(key, analysis);
    }
    this.rawAnalysis = analysis;
    this.songKey = key;
    this.useTempoFactor(loadTempoFactor(key));
    this.player.setBuffer(buffer);
    this.trackName = name;
    const { title, subtitle } = titleFromFilename(name);
    this.settings.overlay.title = title;
    this.settings.overlay.subtitle = subtitle;
    this.renderer.resetFeedback();
    const how = cached ? "analysis from cache" : `analysed in ${((performance.now() - t0) / 1000).toFixed(1)}s`;
    const bpm = this.analysis?.tempo ?? analysis.tempo;
    this.onStatus(`${title}: ${bpm.toFixed(0)} BPM, ${analysis.events.kick.times.length} kicks, ${analysis.events.snare.times.length} snares, ${analysis.events.hat.times.length} hats, ${how}`);
    this.onTrackLoaded();
  }

  /** Fixes a tempo octave error for this song (×2 / ÷2) and remembers it. */
  setTempoFactor(factor: TempoFactor): void {
    if (!this.rawAnalysis || this.live) {
      this.onStatus("Tempo correction works on loaded files, not live input");
      return;
    }
    this.useTempoFactor(factor);
    saveTempoFactor(this.songKey, factor);
    const label = factor === 1 ? "as detected" : factor === 2 ? "doubled" : "halved";
    this.onStatus(`Tempo ${label}: ${this.analysis?.tempo.toFixed(0)} BPM`);
  }

  private useTempoFactor(factor: TempoFactor): void {
    const raw = this.rawAnalysis;
    if (!raw) return;
    this.tempoFactor = factor;
    const { beat, downbeat } = scaleBeats(raw.events.beat, raw.events.downbeat, factor);
    this.analysis = { ...raw, tempo: raw.tempo * factor, events: { ...raw.events, beat, downbeat } };
    this.sampler = new FeatureSampler(this.analysis);
  }

  /** Canvas pixel size for the current window, honouring device pixel ratio. */
  windowSize(): [number, number] {
    const dpr = Math.min(MAX_PIXEL_RATIO, window.devicePixelRatio || 1);
    return [Math.round(window.innerWidth * dpr), Math.round(window.innerHeight * dpr)];
  }

  start(): void {
    const loop = (now: number): void => {
      if (!this.exporting) {
        const dt = Math.min(0.1, Math.max(0, (now - this.lastFrame) / 1000));
        this.lastFrame = now;
        const [w, h] = this.windowSize();
        this.renderer.resize(w, h, this.quality.update(dt, this.settings.look.renderScale));
        const t = this.live ? this.live.time : this.sampler ? this.player.time : now / 1000;
        if (Math.abs(t - this.lastTime) > 0.5) this.renderer.resetFeedback();
        this.lastTime = t;
        this.renderAt(t, dt);
        if (this.settings.overlay.showHud) this.hud.draw(this.features, `${this.trackName} · ${Math.round(this.quality.scale * 100)}% res`);
      }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  /** Deterministic: the same t and dt always produce the same frame (given the same history). */
  renderAt(t: number, dt: number): void {
    const s = this.settings;
    const f = this.features;
    const source = this.source();
    if (source) {
      source.sample(t, f, s.decay);
      source.spectrogram(t, SPECTROGRAM_ROWS, SPECTROGRAM_SPAN_SECONDS, this.spectrogramData);
    } else idleFeatures(f, t);
    this.renderer.spectrum.upload(f.mel);
    if (source) this.renderer.spectrogram.upload(this.spectrogramData);
    let scene = sceneById(s.scene);
    let fade: SceneFade | undefined;
    if (s.autoScenes && source) {
      const start = Math.max(0, SCENES.findIndex((x) => x.id === s.scene));
      const events = buildSchedule(source.sectionTimes(), source.downbeats(), {
        minSeconds: s.autoSceneSeconds,
        lead: this.live ? 0 : FADE_LEAD_SECONDS,
        cuts: s.autoCuts,
        cutIntensity: s.autoCutIntensity,
        cutBars: s.autoCutBars,
        lookahead: !this.live,
      });
      const at = sceneAt(t, events, { sceneCount: SCENES.length, start, fade: FADE_SECONDS });
      scene = SCENES[at.current];
      if (at.previous >= 0) {
        const from = SCENES[at.previous];
        fade = { scene: from, uniforms: this.fadeReactor.build(f, s, this.paramsNow(from)), mix: at.mix };
      }
    }
    if (scene.id !== this.activeScene) {
      this.renderer.setScene(scene);
      this.activeScene = scene.id;
    }
    const uniforms = this.reactor.build(f, s, this.paramsNow(scene));
    this.updateOverlay();
    const alpha = s.overlay.showTitle && this.sampler && !this.live ? titleAlpha(t - this.titleStart) : 0;
    this.renderer.render(uniforms, s.look, alpha, dt, fade);
  }

  /** The scene's params as set in the panel, nudged by the current section's look. */
  private paramsNow(scene: SceneDef): Record<string, number> {
    return sectionParams(sceneParamsFor(this.settings, scene.id), scene.params, this.features, this.settings.sectionLooks);
  }

  private updateOverlay(): void {
    const o = this.settings.overlay;
    const [w, h] = [this.renderer.canvas.width, this.renderer.canvas.height];
    const key = `${o.showTitle}|${o.title}|${o.subtitle}|${w}x${h}`;
    if (key === this.overlayKey) return;
    this.overlayKey = key;
    this.renderer.setOverlay(o.showTitle ? drawTitleCard(w, h, o.title, o.subtitle) : null);
  }

  /** A song moment worth previewing: now if playing or seeked, else partway in where it's usually busy. */
  previewTime(): number {
    const t = this.player.time;
    if (!this.sampler || t > 1) return t;
    return Math.min(60, this.player.duration * 0.4);
  }

  /**
   * Renders `settings` as a small PNG data URL at song time t (for the preset browser).
   * Borrows the main canvas, so it pauses the frame loop the way export does.
   */
  renderThumbnail(settings: Settings, t: number, width: number, height: number): string {
    const saved = this.settings;
    const wasExporting = this.exporting;
    this.exporting = true;
    this.settings = { ...settings, overlay: { ...settings.overlay, showTitle: false } };
    try {
      this.renderStill(t, width, height, 0.6, 30);
      return this.renderer.canvas.toDataURL("image/jpeg", 0.85);
    } finally {
      this.settings = saved;
      this.exporting = wasExporting;
      this.activeScene = "";
      this.renderer.resetFeedback();
    }
  }

  /** Renders a still at time t after `warmup` seconds of frames so trails and envelopes look natural. */
  renderStill(t: number, width: number, height: number, warmup: number, fps: number): void {
    this.renderer.resize(width, height, this.settings.look.renderScale);
    this.renderer.resetFeedback();
    this.renderer.adaptInstantly = true;
    const dt = 1 / fps;
    for (let tt = Math.max(0, t - warmup); tt < t; tt += dt) this.renderAt(tt, dt);
    this.renderAt(t, dt);
    this.renderer.adaptInstantly = false;
  }
}

/** Gentle synthetic motion for when no track is loaded, so the welcome screen isn't static. */
function idleFeatures(f: Features, t: number): void {
  const s = f.scalars;
  f.time = t;
  s.loudness = 0.35 + 0.1 * Math.sin(t * 0.3);
  s.intensity = 0.3;
  s.bass = s.sub = 0.3 + 0.2 * Math.sin(t * 0.21);
  s.lowMid = s.mid = s.high = s.air = 0.3;
  s.harmonic = 0.5;
  s.brightness = 0.5 + 0.3 * Math.sin(t * 0.13);
  s.timbreX = Math.sin(t * 0.07);
  s.timbreY = Math.cos(t * 0.05);
  s.timbreZ = Math.sin(t * 0.03);
  f.energyTime = t * 0.4;
  f.mel.fill(0.3);
}
