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
import { eventsFromAnalysis, LiveMosaicFeed, MAX_SHAPES, MosaicPlanner, TEXELS_PER_SHAPE } from "./render/mosaic.ts";
import { castHex } from "./render/cast-colors.ts";
import { hexToLinear } from "./render/palettes.ts";
import { QualityGovernor } from "./render/quality.ts";
import { Reactor, sectionParams } from "./render/reactivity.ts";
import { Renderer, SPECTROGRAM_ROWS } from "./render/renderer.ts";
import type { SceneFade } from "./render/renderer.ts";
import { buildSchedule, sceneAt } from "./render/schedule.ts";
import type { Downbeats, ScheduleOptions } from "./render/schedule.ts";
import { cuesFromSchedule, parseShow, showAt } from "./render/show.ts";
import type { Cue } from "./render/show.ts";
import { songStore } from "./song-store.ts";
import { lyricAt, parseLrc } from "./lyrics.ts";
import type { LyricLine } from "./lyrics.ts";
import { thumbnailTime } from "./export/thumbnail.ts";
import { sceneById, SCENES, SCENES_UPDATED, vjScenes } from "./render/scenes/index.ts";
import { outroAt } from "./render/outro.ts";
import { buildSongTexture, SONG_COLUMNS, SONG_ROWS } from "./render/portrait.ts";
import type { SceneDef } from "./render/scenes/index.ts";
import { ShaderError } from "./render/gl.ts";
import { defaultSettings } from "./settings.ts";
import { loadTempoFactor, saveTempoFactor } from "./tempo-memory.ts";
import type { Settings } from "./settings.ts";
import { Hud } from "./ui/hud.ts";
import { clock, drawLyric, drawPoster, drawTitleCard, titleAlpha } from "./ui/overlay.ts";
import type { PosterInfo } from "./ui/overlay.ts";

const SPECTROGRAM_SPAN_SECONDS = 2;
const MAX_PIXEL_RATIO = 2;

/** Where features come from: a pre-analysed file (FeatureSampler) or live input (LiveAnalyzer). */
interface FeatureSource {
  sample(t: number, out: Features, decays: Settings["decay"]): void;
  spectrogram(t: number, rows: number, span: number, out: Float32Array): void;
  melodyLine(t: number, rows: number, span: number, out: Float32Array): void;
  sectionTimes(): Float32Array;
  dropTimes(): ArrayLike<number>;
  downbeats(): Downbeats;
}

const shows = songStore(
  "music-shader.shows",
  (raw) => parseShow({ cues: raw }),
  (cues) => cues.length === 0,
);
const MAX_LRC_CHARS = 200_000;
const lyricsStore = songStore(
  "music-shader.lyrics",
  (raw) => (typeof raw === "string" ? raw.slice(0, MAX_LRC_CHARS) : ""),
  (text) => text === "",
);

const FADE_SECONDS = 1.5;
const PORTRAIT = "portrait";
/** Below this the key estimate is a guess, so the poster leaves it out. */
const KEY_CONFIDENCE = 0.6;
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
  /** Hand-placed scene changes for the loaded song (see render/show.ts). */
  show: Cue[] = [];
  /** Off: the show is kept but Auto VJ / the chosen scene play instead. */
  useShow = true;
  onShowChanged: () => void = () => {};
  lyrics: LyricLine[] = [];
  private lyricKey = "";

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
  private readonly melodyData = new Float32Array(2 * SPECTROGRAM_ROWS);
  private mosaic: { source: FeatureSource | null; size: number; planner: MosaicPlanner; feed: LiveMosaicFeed } | null = null;
  private readonly shapeData = new Float32Array(MAX_SHAPES * TEXELS_PER_SHAPE * 4);
  private lastFrame = performance.now();
  private lastTime = 0;
  private overlayKey = "";
  private posterKey = "";
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
    live.onStall = (stalled): void => {
      this.onStatus(
        stalled
          ? "Your phone paused the mic (another app took over audio). Retrying… If it stays paused, play the music from a different device or speaker."
          : "Mic is back",
        stalled,
      );
    };
    this.live = live;
    this.applyCast();
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
    this.applyCast();
    this.renderer.resetFeedback();
  }

  /** Cast colours of the loaded song; none for live input, which has no cast. */
  get castColors(): string[] {
    return this.live || !this.rawAnalysis ? [] : castHex(this.rawAnalysis.cast.members);
  }

  /** Cast colours and the Portrait's whole-song texture for whatever is playing now. */
  private applyCast(): void {
    this.hud.castColors = this.castColors;
    const colors = this.castColors.map(hexToLinear);
    this.reactor.setCast(colors);
    this.fadeReactor.setCast(colors);
    const song = this.live || !this.rawAnalysis ? new Float32Array(SONG_COLUMNS * SONG_ROWS * 4) : buildSongTexture(this.rawAnalysis);
    this.renderer.song.upload(song);
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
    this.applyCast();
    this.songKey = key;
    this.show = shows.load(key);
    this.lyrics = parseLrc(lyricsStore.load(key));
    this.onShowChanged();
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
      source.melodyLine(t, SPECTROGRAM_ROWS, SPECTROGRAM_SPAN_SECONDS, this.melodyData);
    } else idleFeatures(f, t);
    this.renderer.spectrum.upload(f.mel);
    if (source) {
      this.renderer.spectrogram.upload(this.spectrogramData);
      this.renderer.melodyLine.upload(this.melodyData);
    }
    let scene = sceneById(s.scene);
    let fade: SceneFade | undefined;
    let looks = s;
    if (this.showActive) {
      const at = showAt(t, this.show, { scene: s.scene, palette: null }, { fade: FADE_SECONDS, lead: FADE_LEAD_SECONDS });
      scene = sceneById(at.scene);
      looks = withPalette(s, at.palette);
      if (at.from) {
        const from = sceneById(at.from.scene);
        fade = { scene: from, uniforms: this.fadeReactor.build(f, withPalette(s, at.from.palette), this.paramsNow(from)), mix: at.mix };
      }
    } else if (s.autoScenes && source) {
      const scenes = vjScenes();
      const start = Math.max(0, scenes.findIndex((x) => x.id === s.scene));
      const events = buildSchedule(source.sectionTimes(), source.downbeats(), this.scheduleOptions(), source.dropTimes());
      const at = sceneAt(t, events, { sceneCount: scenes.length, start, fade: FADE_SECONDS });
      scene = scenes[at.current];
      if (at.previous >= 0) {
        const from = scenes[at.previous];
        fade = { scene: from, uniforms: this.fadeReactor.build(f, s, this.paramsNow(from)), mix: at.mix };
      }
    }
    const song = this.sampler !== null && !this.live;
    const duration = this.analysis?.duration ?? 0;
    const outro = song ? outroAt(t, duration, s.overlay.outro) : outroAt(0, 0, 0);
    if (outro.mix > 0 && scene.id !== PORTRAIT) {
      fade = outro.mix < 1 ? { scene, uniforms: this.fadeReactor.build(f, looks, this.paramsNow(scene)), mix: outro.mix } : undefined;
      scene = sceneById(PORTRAIT);
    }
    if (scene.id !== this.activeScene) {
      this.renderer.setScene(scene);
      this.activeScene = scene.id;
    }
    const uniforms = this.reactor.build(f, looks, this.paramsNow(scene));
    if (scene.id === "mosaic" || fade?.scene.id === "mosaic") {
      const shapes = this.updateMosaic(t, source);
      uniforms.uShapeCount = shapes;
      if (fade) fade.uniforms.uShapeCount = shapes;
    }
    const reveal = !song || duration <= 0 ? 0 : outro.mix > 0 ? outro.reveal : Math.min(1, t / duration);
    uniforms.uReveal = reveal;
    if (fade) fade.uniforms.uReveal = reveal;
    const poster = song && scene.id === PORTRAIT ? (outro.mix > 0 ? outro.text : 1) : 0;
    if (poster > 0) this.updatePosterText();
    this.updateOverlay();
    this.renderer.render(
      uniforms,
      s.look,
      {
        title: s.overlay.showTitle && song ? titleAlpha(t - this.titleStart) : 0,
        lyrics: s.overlay.showLyrics && song ? this.updateLyric(t) : 0,
        art: s.overlay.artMode,
        artSize: s.overlay.artSize,
        poster,
      },
      dt,
      fade,
    );
  }

  private scheduleOptions(): ScheduleOptions {
    const s = this.settings;
    return {
      minSeconds: s.autoSceneSeconds,
      lead: this.live ? 0 : FADE_LEAD_SECONDS,
      cuts: s.autoCuts,
      cutIntensity: s.autoCutIntensity,
      cutBars: s.autoCutBars,
      lookahead: !this.live,
    };
  }

  /** The show drives scenes only for a loaded file: its cue times are song times. */
  get showActive(): boolean {
    return this.useShow && this.show.length > 0 && this.sampler !== null && !this.live;
  }

  /** Replaces the song's show and remembers it. */
  setShow(cues: Cue[]): void {
    this.show = cues;
    if (this.songKey) shows.save(this.songKey, cues);
    this.onShowChanged();
  }

  /** Timed lyrics (.lrc text) for the loaded song; remembered per song. Returns the line count. */
  setLyrics(lrc: string): number {
    const text = lrc.slice(0, MAX_LRC_CHARS);
    this.lyrics = parseLrc(text);
    if (this.songKey) lyricsStore.save(this.songKey, this.lyrics.length > 0 ? text : "");
    this.lyricKey = "";
    return this.lyrics.length;
  }

  /** Cover art or a logo, kept for this session. Turns the badge on if art was off. */
  async setArt(file: Blob): Promise<void> {
    const image = await createImageBitmap(file);
    this.renderer.setArt(image);
    image.close();
    if (this.settings.overlay.artMode === "off") this.settings.overlay.artMode = "badge";
  }

  /**
   * A 1280×720 PNG for the video's YouTube thumbnail: the song's most intense moment, with the
   * title card fully in. Borrows the canvas like the preset browser does.
   */
  async renderYouTubeThumbnail(): Promise<Blob> {
    const a = this.analysis;
    if (!a) throw new Error("Load a song first");
    const t = thumbnailTime(a.scalars.intensity, a.scalars.loudness, a.fps);
    const { showTitle } = this.settings.overlay;
    const wasExporting = this.exporting;
    this.exporting = true;
    this.settings.overlay.showTitle = true;
    this.titleStart = t - 3;
    try {
      this.renderStill(t, 1280, 720, 1.5, 30);
      return await new Promise<Blob>((resolve, reject) => this.renderer.canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("PNG encoding failed"))), "image/png"));
    } finally {
      this.settings.overlay.showTitle = showTitle;
      this.titleStart = 0;
      this.exporting = wasExporting;
      this.renderer.resetFeedback();
    }
  }

  /** Auto VJ's choices for this song as cues, to start a show from. */
  autoVjCues(): Cue[] {
    if (!this.sampler) return [];
    const start = Math.max(0, vjScenes().findIndex((x) => x.id === this.settings.scene));
    const events = buildSchedule(this.sampler.sectionTimes(), this.sampler.downbeats(), this.scheduleOptions(), this.sampler.dropTimes());
    return cuesFromSchedule(
      events,
      vjScenes().map((x) => x.id),
      start,
      FADE_LEAD_SECONDS,
    );
  }

  /**
   * Mosaic's shape layout depends on every earlier hit: a file is planned once from its whole
   * analysis, live input feeds the planner frame by frame. Re-planned when the source or size changes.
   */
  private updateMosaic(t: number, source: FeatureSource | null): number {
    const size = sceneParamsFor(this.settings, "mosaic").size;
    if (!this.mosaic || this.mosaic.source !== source || this.mosaic.size !== size) {
      const planner = new MosaicPlanner({ size });
      if (source === this.sampler && this.analysis) for (const e of eventsFromAnalysis(this.analysis)) planner.push(e);
      this.mosaic = { source, size, planner, feed: new LiveMosaicFeed() };
    }
    if (source && source !== this.sampler) this.mosaic.feed.update(this.features, this.mosaic.planner);
    const n = this.mosaic.planner.visible(t, this.shapeData);
    this.renderer.shapes.upload(this.shapeData);
    return n;
  }

  /** The scene's params as set in the panel, nudged by the current section's look. */
  private paramsNow(scene: SceneDef): Record<string, number> {
    return sectionParams(sceneParamsFor(this.settings, scene.id), scene.params, this.features, this.settings.sectionLooks);
  }

  /** Redraws the lyric texture only when the line or canvas size changes; returns the line's opacity. */
  private updateLyric(t: number): number {
    const { text, alpha } = lyricAt(t, this.lyrics);
    const [w, h] = [this.renderer.canvas.width, this.renderer.canvas.height];
    const key = `${text}|${w}x${h}`;
    if (key !== this.lyricKey) {
      this.lyricKey = key;
      this.renderer.setLyrics(text ? drawLyric(w, h, text) : null);
    }
    return alpha;
  }

  /** What the Portrait's text says about the loaded song. */
  posterInfo(): PosterInfo {
    const a = this.rawAnalysis;
    const o = this.settings.overlay;
    if (!a) return { title: o.title, subtitle: o.subtitle, caption: "", cast: [], drops: [] };
    const colors = this.castColors;
    const key = a.key.confidence >= KEY_CONFIDENCE ? a.key.name : "";
    return {
      title: o.title,
      subtitle: o.subtitle,
      caption: [`${Math.round(this.analysis?.tempo ?? a.tempo)} BPM`, key, clock(a.duration)].filter(Boolean).join(" · "),
      cast: a.cast.members.map((m, i) => ({ label: m.label, color: colors[i], from: clock(m.firstSeen) })),
      drops: Array.from(a.events.drop.times, clock),
    };
  }

  /** Redraws the poster text only when the song, title or canvas size changes. */
  private updatePosterText(): void {
    const [w, h] = [this.renderer.canvas.width, this.renderer.canvas.height];
    const info = this.posterInfo();
    const key = `${this.songKey}|${this.tempoFactor}|${info.title}|${info.subtitle}|${w}x${h}`;
    if (key === this.posterKey) return;
    this.posterKey = key;
    this.renderer.setPosterText(drawPoster(w, h, info));
  }

  /**
   * The song's Portrait as a still: fully drawn, with its title, cast and key. Borrows the canvas
   * like the YouTube thumbnail does.
   */
  async renderPoster(width: number, height: number): Promise<Blob> {
    const a = this.analysis;
    if (!a || this.live) throw new Error("Load a song first");
    const saved = this.settings;
    const { useShow, exporting } = this;
    const portrait = sceneById(PORTRAIT);
    this.exporting = true;
    this.useShow = false;
    this.settings = {
      ...saved,
      scene: PORTRAIT,
      autoScenes: false,
      paletteCycle: false,
      look: { ...saved.look, ...portrait.look },
      overlay: { ...saved.overlay, showTitle: false, showLyrics: false, artMode: "off", outro: 0 },
    };
    try {
      this.renderStill(a.duration, width, height, 0.3, 30);
      return await new Promise<Blob>((resolve, reject) => this.renderer.canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("PNG encoding failed"))), "image/png"));
    } finally {
      this.settings = saved;
      this.useShow = useShow;
      this.exporting = exporting;
      this.activeScene = "";
      this.renderer.resetFeedback();
    }
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

/** A cue's palette replaces the preset's, and holds still instead of cycling per section. */
function withPalette(s: Settings, palette: string | null): Settings {
  return palette === null ? s : { ...s, palette, paletteCycle: false };
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
