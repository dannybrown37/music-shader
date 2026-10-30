import GUI from "lil-gui";
import type { Controller } from "lil-gui";
import type { App } from "../app.ts";
import { builtinPresets, loadUserPresets, saveUserPresets, sceneParamsFor } from "../presets.ts";
import { PALETTES } from "../render/palettes.ts";
import { SCENES, sceneById } from "../render/scenes/index.ts";
import { ART_MODES, ART_SIZE, AUTO_CUT_BARS, DECAY_RANGES, LOOK_RANGES, mergeSettings, OUTRO_RANGE, REACTIVITY_RANGES } from "../settings.ts";
import type { Range, Settings } from "../settings.ts";
import { EXPORT_RESOLUTIONS } from "../export/video.ts";
import type { TempoFactor } from "../analysis/beats.ts";
import { nextTempoFactor } from "../tempo-memory.ts";
import { parseShow, removeCue, setCue, snapToBar } from "../render/show.ts";
import type { Cue } from "../render/show.ts";
import type { Timeline } from "./timeline.ts";
import { encodeShare } from "../share.ts";

const POSTER_SIZE = 2160;

const KEEP_PALETTE = "(preset's)";

export interface PanelActions {
  openFile: () => void;
  browsePresets: () => void;
  toggleRecording: () => void;
  exportVideo: (opts: { resolution: string; fps: number; start: number; end: number; quality: string }) => void;
}

/** The lil-gui control panel. Every slider writes straight into app.settings. */
export class Panel {
  readonly gui: GUI;
  private readonly app: App;
  private sceneFolder: GUI;
  private trackController: Controller | null = null;
  private presetController: Controller | null = null;
  private readonly state: { track: string; preset: string; saveAs: string; tempo: TempoFactor } = { track: "", preset: "", saveAs: "My preset", tempo: 1 };
  private readonly exportState = { resolution: "1080p", fps: 60, start: 0, end: 0, quality: "very high" };
  private readonly cueState = { scene: SCENES[0].id, transition: "fade", palette: KEEP_PALETTE };
  private cueControllers: Controller[] = [];
  private timeline: Timeline | null = null;

  constructor(app: App, tracks: string[], actions: PanelActions) {
    this.app = app;
    const gui = new GUI({ title: "Music Shader" });
    this.gui = gui;
    const changed = (): void => app.settingsChanged();

    const music = gui.addFolder("Music").close();
    if (tracks.length > 0) {
      this.state.track = tracks[0];
      this.trackController = music
        .add(this.state, "track", tracks)
        .name("Library")
        .onChange((name: string) => {
          app.loadTrackByName(name).catch((err: unknown) => app.onStatus(String(err), true));
        });
    }
    music.add({ open: actions.openFile }, "open").name("Open audio file… (O)");
    music.add({ play: () => void app.togglePlay() }, "play").name("Play / pause (Space)");
    music
      .add(this.state, "tempo", { "as detected": 1, "double ×2": 2, "half ÷2": 0.5 })
      .name("Tempo (T)")
      .onChange((f: TempoFactor) => app.setTempoFactor(f));
    const live = (kind: "mic" | "tab") => (): void => {
      app.startLive(kind).catch((err: unknown) => app.onStatus(`Live input failed: ${err instanceof Error ? err.message : String(err)}`, true));
    };
    music.add({ mic: live("mic") }, "mic").name("Live: microphone / line-in");
    music.add({ tab: live("tab") }, "tab").name("Live: tab or system audio");
    music.add({ stop: () => app.stopLive() }, "stop").name("Stop live input");

    const presets = gui.addFolder("Presets").close();
    this.presetController = presets.add(this.state, "preset", this.presetNames()).name("Load").onChange((name: string) => this.applyPreset(name));
    presets.add(this.state, "saveAs").name("Name");
    presets.add({ browse: actions.browsePresets }, "browse").name("Browse presets… (B)");
    presets.add({ surprise: () => this.surprise() }, "surprise").name("Surprise me (R)");
    presets.add({ save: () => this.savePreset() }, "save").name("Save current as preset");
    presets.add({ exp: () => this.exportPreset() }, "exp").name("Download preset JSON");
    presets.add({ link: () => void this.copyShareLink() }, "link").name("Copy share link");
    presets.add({ imp: () => this.importPreset() }, "imp").name("Import preset JSON…");

    const s = app.settings;
    const sceneNames = Object.fromEntries(SCENES.map((x) => [x.name, x.id]));
    gui
      .add(s, "scene", sceneNames)
      .name("Scene")
      .onChange(() => {
        app.applyScene();
        this.buildSceneFolder();
        changed();
      });
    gui
      .add(s, "autoScenes")
      .name("Auto VJ: next scene each section")
      .onChange(() => {
        app.applyScene();
        changed();
      });
    gui.add(s, "autoSceneSeconds", 8, 90, 1).name("Auto VJ: min seconds per scene").onChange(changed);
    gui.add(s, "autoCuts").name("Auto VJ: cut on the beat when loud").onChange(changed);
    gui.add(s, "autoCutIntensity", 0.3, 1, 0.01).name("Auto VJ: loud above").onChange(changed);
    gui.add(s, "autoCutBars", AUTO_CUT_BARS).name("Auto VJ: bars between cuts").onChange(changed);
    this.sceneFolder = gui.addFolder("Scene parameters");
    this.buildSceneFolder();

    const react = gui.addFolder("Reactivity");
    addRanges(react, s.reactivity, REACTIVITY_RANGES, changed);

    const look = gui.addFolder("Look");
    look.add(s, "palette", PALETTES.map((p) => p.name)).name("Palette").onChange(changed);
    look.add(s, "paletteCycle").name("New palette each section").onChange(changed);
    look.add(s, "sectionLooks", 0, 1, 0.01).name("New look each section").onChange(changed).domElement.title =
      "How far each section change nudges the scene parameters (0 = never)";
    addRanges(look, s.look, LOOK_RANGES, changed);
    look.close();

    const decay = gui.addFolder("Envelope decay");
    addRanges(decay, s.decay, DECAY_RANGES, changed);
    decay.close();

    const overlay = gui.addFolder("Overlay");
    overlay.add(s.overlay, "showTitle").name("Title card").onChange(changed);
    overlay.add(s.overlay, "title").name("Title").onChange(changed);
    overlay.add(s.overlay, "subtitle").name("Subtitle").onChange(changed);
    overlay
      .add(s.overlay, "showHud")
      .name("Debug meters (D)")
      .onChange((v: boolean) => {
        app.hud.visible = v;
        changed();
      });
    overlay.add({ art: () => chooseFile("image/*", (f) => this.loadArt(f)) }, "art").name("Load cover art / logo…");
    overlay.add(s.overlay, "artMode", [...ART_MODES]).name("Cover art").onChange(changed);
    overlay.add(s.overlay, "artSize", ART_SIZE.min, ART_SIZE.max, 0.01).name("Art size / strength").onChange(changed);
    overlay.add({ lrc: () => chooseFile(".lrc,text/plain", (f) => this.loadLyrics(f)) }, "lrc").name("Load lyrics (.lrc)…");
    overlay.add(s.overlay, "showLyrics").name("Show lyrics").onChange(changed);
    overlay.add({ clear: () => this.loadLyricsText("", "") }, "clear").name("Clear lyrics");
    overlay.close();

    this.buildShowFolder();

    const exp = gui.addFolder("Export video");
    exp.add(this.exportState, "resolution", Object.keys(EXPORT_RESOLUTIONS)).name("Resolution");
    exp.add(this.exportState, "fps", [24, 30, 60]).name("Frame rate");
    exp.add(this.exportState, "quality", ["high", "very high"]).name("Quality");
    exp.add(this.exportState, "start", 0, 3600, 0.1).name("Start (s)");
    exp.add(this.exportState, "end", 0, 3600, 0.1).name("End (s, 0 = song end)");
    exp.add({ go: () => actions.exportVideo({ ...this.exportState }) }, "go").name("Render video…");
    exp.add({ rec: actions.toggleRecording }, "rec").name("Record live, start / stop (C)");
    exp.add({ thumb: () => void this.savePng(() => this.app.renderYouTubeThumbnail(), "thumbnail") }, "thumb").name("YouTube thumbnail (PNG)");
    exp.add({ poster: () => void this.savePng(() => this.app.renderPoster(POSTER_SIZE, POSTER_SIZE), "poster") }, "poster").name("Song poster (PNG)");
    exp.add(s.overlay, "outro", OUTRO_RANGE.min, OUTRO_RANGE.max, 1).name(OUTRO_RANGE.label).onChange(changed).domElement.title = OUTRO_RANGE.help;
    exp.close();

    app.hud.visible = s.overlay.showHud;
    this.state.preset = SCENES.find((x) => x.id === s.scene)?.name ?? "";
    this.presetController?.updateDisplay();
  }

  /** Re-read every control after something outside the panel changed settings. */
  refresh(): void {
    this.gui.controllersRecursive().forEach((c) => c.updateDisplay());
  }

  /** Show: hand-placed scene changes for this song, edited here and on the timeline. */
  private buildShowFolder(): void {
    const app = this.app;
    const folder = this.gui.addFolder("Show (this song)");
    folder.add(app, "useShow").name("Play this song's show");
    folder.add({ add: () => this.addCue() }, "add").name("Add cue here: current scene (K)");
    folder.add({ fill: () => this.fillShowFromAutoVj() }, "fill").name("Start from Auto VJ's choices");
    const sceneNames = Object.fromEntries(SCENES.map((x) => [x.name, x.id]));
    const cue = this.cueState;
    const edit = (): void => this.editSelectedCue();
    this.cueControllers = [
      folder.add(cue, "scene", sceneNames).name("Selected cue: scene").onChange(edit),
      folder.add(cue, "transition", ["fade", "cut"]).name("Selected cue: arrives by").onChange(edit),
      folder.add(cue, "palette", [KEEP_PALETTE, ...PALETTES.map((p) => p.name)]).name("Selected cue: palette").onChange(edit),
      folder.add({ del: () => this.deleteSelectedCue() }, "del").name("Delete selected cue (Del)"),
    ];
    folder.add({ clear: () => this.clearShow() }, "clear").name("Clear show");
    folder.add({ exp: () => this.exportShow() }, "exp").name("Download show JSON");
    folder.add({ imp: () => this.importShow() }, "imp").name("Import show JSON…");
    folder.close();
    this.showSelection(null);
  }

  attachTimeline(timeline: Timeline): void {
    this.timeline = timeline;
    timeline.onSelect = (cue): void => this.showSelection(cue);
  }

  private showSelection(cue: Cue | null): void {
    if (cue) {
      this.cueState.scene = cue.scene;
      this.cueState.transition = cue.cut ? "cut" : "fade";
      this.cueState.palette = cue.palette ?? KEEP_PALETTE;
    }
    for (const c of this.cueControllers) {
      c.enable(cue !== null);
      c.updateDisplay();
    }
  }

  /** K: a cue for the panel's current scene at the playhead, snapped to the nearest downbeat. */
  addCue(): void {
    const app = this.app;
    if (!app.analysis || app.isLive) {
      app.onStatus("Load a song to make a show", true);
      return;
    }
    const t = snapToBar(app.player.time, app.analysis.events.downbeat.times);
    app.setShow(setCue(app.show, { t, scene: app.settings.scene, palette: null, cut: false }));
    this.timeline?.select(t);
    app.onStatus(`Cue at ${t.toFixed(1)} s: ${sceneById(app.settings.scene).name}`);
  }

  deleteSelectedCue(): void {
    const cue = this.timeline?.selectedCue;
    if (!cue) return;
    this.app.setShow(removeCue(this.app.show, cue.t));
    this.timeline?.select(null);
  }

  private editSelectedCue(): void {
    const cue = this.timeline?.selectedCue;
    if (!cue) return;
    const { scene, transition, palette } = this.cueState;
    this.app.setShow(setCue(this.app.show, { t: cue.t, scene, cut: transition === "cut", palette: palette === KEEP_PALETTE ? null : palette }));
  }

  private fillShowFromAutoVj(): void {
    const app = this.app;
    if (app.show.length > 0 && !window.confirm("Replace this song's show with Auto VJ's choices?")) return;
    const cues = app.autoVjCues();
    app.setShow(cues);
    this.timeline?.select(null);
    app.onStatus(cues.length > 0 ? `${cues.length} cues from Auto VJ. Click one on the timeline to change it` : "Auto VJ found no section changes in this song");
  }

  private clearShow(): void {
    if (this.app.show.length === 0 || !window.confirm("Delete every cue in this song's show?")) return;
    this.app.setShow([]);
    this.timeline?.select(null);
  }

  private exportShow(): void {
    const blob = new Blob([JSON.stringify({ song: this.app.trackName, cues: this.app.show }, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${this.app.settings.overlay.title || "show"} show.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  private importShow(): void {
    if (!this.app.analysis) {
      this.app.onStatus("Load the song first, then import its show", true);
      return;
    }
    chooseFile("application/json,.json", (file) => {
      file
        .text()
        .then((text) => {
          const cues = parseShow(JSON.parse(text));
          this.app.setShow(cues);
          this.app.onStatus(`Imported ${cues.length} cues from ${file.name}`);
        })
        .catch((err: unknown) => this.app.onStatus(`Could not import ${file.name}: ${err instanceof Error ? err.message : String(err)}`, true));
    });
  }

  loadArt(file: File): void {
    this.app
      .setArt(file)
      .then(() => {
        this.gui.controllersRecursive().forEach((c) => c.updateDisplay());
        this.app.settingsChanged();
        this.app.onStatus(`Cover art: ${file.name} (kept until you reload; Overlay → Cover art switches badge / backdrop)`);
      })
      .catch((err: unknown) => this.app.onStatus(`Could not load ${file.name} as an image: ${String(err)}`, true));
  }

  loadLyrics(file: File): void {
    file
      .text()
      .then((text) => this.loadLyricsText(text, file.name))
      .catch((err: unknown) => this.app.onStatus(`Could not read ${file.name}: ${String(err)}`, true));
  }

  private loadLyricsText(text: string, name: string): void {
    if (!this.app.analysis) {
      this.app.onStatus("Load the song first, then its lyrics", true);
      return;
    }
    const lines = this.app.setLyrics(text);
    if (name && lines === 0) this.app.onStatus(`${name} has no timed lines like “[01:23.45] words”`, true);
    else this.app.onStatus(name ? `${lines} lyric lines from ${name}` : "Lyrics cleared");
  }

  private async savePng(render: () => Promise<Blob>, what: string): Promise<void> {
    try {
      const blob = await render();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `${this.app.settings.overlay.title || "music-shader"} ${what}.png`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (err: unknown) {
      this.app.onStatus(`Saving the ${what} failed: ${err instanceof Error ? err.message : String(err)}`, true);
    }
  }

  cycleTempo(): void {
    this.state.tempo = nextTempoFactor(this.app.tempoFactor);
    this.app.setTempoFactor(this.state.tempo);
    this.state.tempo = this.app.tempoFactor;
    this.gui.controllersRecursive().forEach((c) => c.updateDisplay());
  }

  setTrack(name: string): void {
    this.state.track = name;
    this.state.tempo = this.app.tempoFactor;
    this.trackController?.updateDisplay();
    this.gui.controllersRecursive().forEach((c) => c.updateDisplay());
  }

  private buildSceneFolder(): void {
    const app = this.app;
    const scene = sceneById(app.settings.scene);
    this.sceneFolder.destroy();
    this.sceneFolder = this.gui.addFolder(`${scene.name} parameters`);
    const params = sceneParamsFor(app.settings, scene.id);
    for (const p of scene.params) {
      this.sceneFolder
        .add(params, p.key, p.min, p.max, p.step ?? (p.max - p.min) / 200)
        .name(p.label)
        .onChange(() => app.settingsChanged());
    }
    this.sceneFolder.add({ about: scene.description }, "about").name("About").disable();
  }

  private presetNames(): string[] {
    return this.presetEntries().map(([name]) => name);
  }

  /** Built-in presets, then saved ones (marked ★), as [display name, settings]. */
  presetEntries(): [string, Settings][] {
    return [...Object.entries(builtinPresets()), ...Object.entries(loadUserPresets()).map(([n, s]): [string, Settings] => [`★ ${n}`, s])];
  }

  private refreshPresetList(): void {
    this.presetController = this.presetController?.options(this.presetNames()).name("Load").onChange((name: string) => this.applyPreset(name)) ?? null;
  }

  applyPreset(name: string): void {
    const user = loadUserPresets();
    const preset = name.startsWith("★ ") ? user[name.slice(2)] : builtinPresets()[name];
    if (!preset) return;
    this.state.preset = name;
    this.replaceSettings(preset);
  }

  replaceSettings(next: Settings): void {
    const app = this.app;
    // Mutate in place: lil-gui controllers hold references to these objects.
    const s = app.settings;
    const { title, subtitle, showHud } = s.overlay;
    s.scene = next.scene;
    s.palette = next.palette;
    s.paletteCycle = next.paletteCycle;
    s.sectionLooks = next.sectionLooks;
    Object.assign(s.reactivity, next.reactivity);
    Object.assign(s.decay, next.decay);
    Object.assign(s.look, next.look);
    for (const [id, params] of Object.entries(next.sceneParams)) Object.assign((s.sceneParams[id] ??= {}), params);
    Object.assign(s.overlay, next.overlay, { title, subtitle, showHud });
    app.applyScene();
    this.buildSceneFolder();
    this.gui.controllersRecursive().forEach((c) => c.updateDisplay());
    app.settingsChanged();
  }

  /** Random variation for exploring: scene params wander around their defaults, plus palette and trail style. */
  surprise(): void {
    const s = this.app.settings;
    const scene = sceneById(this.app.activeScene || s.scene);
    const params = sceneParamsFor(s, scene.id);
    for (const p of scene.params) {
      const random = p.min + Math.random() * (p.max - p.min);
      const v = p.value + (random - p.value) * 0.6;
      params[p.key] = p.step ? Math.round(v / p.step) * p.step : v;
    }
    const pick = <T>(xs: T[]): T => xs[Math.floor(Math.random() * xs.length)];
    s.palette = pick(PALETTES.filter((p) => !p.manualOnly)).name;
    s.look.feedback = 0.2 + Math.random() * 0.5;
    s.look.feedbackZoom = pick([-0.006, 0, 0.004, 0.008, 0.012]);
    s.look.feedbackSpin = pick([-0.004, 0, 0, 0.003]);
    s.look.feedbackHue = pick([0, 0, 0.002, 0.005]);
    this.gui.controllersRecursive().forEach((c) => c.updateDisplay());
    this.app.settingsChanged();
    this.app.onStatus(`Surprise: ${s.palette} palette, trails ${s.look.feedback.toFixed(2)}. Save it under Presets if you like it`);
  }

  private savePreset(): void {
    const name = this.state.saveAs.trim();
    if (!name) return;
    const presets = loadUserPresets();
    presets[name] = structuredClone(this.app.settings);
    saveUserPresets(presets);
    this.refreshPresetList();
    this.app.onStatus(`Saved preset “${name}”`);
  }

  private exportPreset(): void {
    const blob = new Blob([JSON.stringify(this.app.settings, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${this.state.saveAs.trim() || "preset"}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  async copyShareLink(): Promise<void> {
    const url = `${location.origin}${location.pathname}#${encodeShare(this.app.settings)}`;
    try {
      await navigator.clipboard.writeText(url);
      this.app.onStatus("Share link copied: it opens the app with this look (not the song)");
    } catch {
      window.prompt("Copy this link:", url);
    }
  }

  private importPreset(): void {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "application/json,.json";
    input.onchange = async (): Promise<void> => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        this.replaceSettings(mergeSettings(this.app.settings, JSON.parse(await file.text())));
        this.app.onStatus(`Imported ${file.name}`);
      } catch (err: unknown) {
        this.app.onStatus(`Could not import ${file.name}: ${err instanceof Error ? err.message : String(err)}`, true);
      }
    };
    input.click();
  }
}

function chooseFile(accept: string, onFile: (file: File) => void): void {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = accept;
  input.onchange = (): void => {
    const file = input.files?.[0];
    if (file) onFile(file);
  };
  input.click();
}

function addRanges<K extends string>(folder: GUI, target: Record<K, number>, ranges: Record<K, Range>, onChange: () => void): void {
  for (const key of Object.keys(ranges) as K[]) {
    const r = ranges[key];
    const c = folder.add(target, key, r.min, r.max, r.step ?? (r.max - r.min) / 200).name(r.label ?? key).onChange(onChange);
    if (r.help) c.domElement.title = r.help;
  }
}
