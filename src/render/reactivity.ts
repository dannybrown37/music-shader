import { RECENT_COUNT } from "../analysis/sampler.ts";
import type { Features } from "../analysis/sampler.ts";
import type { Settings } from "../settings.ts";
import { linearStops, mixStops, paletteByName, paletteForSection } from "./palettes.ts";
import type { Rgb } from "./palettes.ts";
import type { UniformValue } from "./gl.ts";
import type { SceneParam } from "./scenes/index.ts";

/**
 * The mapping layer: turns musical features plus the user's reactivity settings into
 * shader uniforms. Every scene reads the same uniforms, so this file is where
 * "what in the music drives what on screen" is decided globally.
 */

const PALETTE_FADE_SECONDS = 1.5;

export interface ActivePalette {
  stops: [Rgb, Rgb, Rgb, Rgb];
  /** Added to every palette(t) lookup: the musical key slides colours along the gradient. */
  shift: number;
}

/** Palette after section cycling and key tinting. */
export function currentPalette(s: Settings, f: Features): ActivePalette {
  let stops = linearStops(paletteByName(s.palette));
  if (s.paletteCycle && f.count.section > 0) {
    const cur = linearStops(paletteForSection(s.palette, f.count.section));
    const prev = linearStops(paletteForSection(s.palette, f.count.section - 1));
    const fade = Math.min(1, f.since.section / PALETTE_FADE_SECONDS);
    stops = fade >= 1 ? cur : mixStops(prev, cur, fade * fade * (3 - 2 * fade));
  }
  const { hue, strength } = keyHue(f);
  return { stops, shift: (hue - 0.5) * strength * s.reactivity.harmony };
}

export function keyHue(f: Features): { hue: number; strength: number } {
  const x = f.scalars.hueX;
  const y = f.scalars.hueY;
  const angle = Math.atan2(y, x) / (2 * Math.PI);
  return { hue: angle < 0 ? angle + 1 : angle, strength: Math.min(1, Math.hypot(x, y) * 2) };
}

function hash(n: number): number {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

/**
 * Per-section looks: each section change nudges every scene param by a fixed random
 * amount (up to `amount` × half its range), so a long video doesn't sit on one look.
 * Continuous params glide like the palette; stepped ones (fold counts) switch on the change.
 */
export function sectionParams(values: Record<string, number>, defs: SceneParam[], f: Features, amount: number): Record<string, number> {
  const k = f.count.section;
  if (amount <= 0 || k <= 0) return values;
  const x = Math.min(1, f.since.section / PALETTE_FADE_SECONDS);
  const glide = x * x * (3 - 2 * x);
  const out = { ...values };
  for (const d of defs) {
    const base = values[d.key] ?? d.value;
    const look = (section: number): number => {
      if (section <= 0) return base;
      const offset = (hash(section * 7.13 + keySeed(d.key)) * 2 - 1) * amount * 0.5 * (d.max - d.min);
      return Math.min(d.max, Math.max(d.min, base + offset));
    };
    out[d.key] = d.step ? Math.round(look(k) / d.step) * d.step : look(k - 1) + (look(k) - look(k - 1)) * glide;
  }
  return out;
}

function keySeed(key: string): number {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) % 9973;
  return h;
}

export class Reactor {
  private readonly u: Record<string, UniformValue> = {};
  private readonly kickHist = new Float32Array(RECENT_COUNT * 2);
  private readonly snareHist = new Float32Array(RECENT_COUNT * 2);
  private readonly hatHist = new Float32Array(RECENT_COUNT * 2);
  private readonly noteHist = new Float32Array(RECENT_COUNT * 2);
  private readonly count = new Float32Array(4);
  private readonly shake = new Float32Array(2);
  private readonly timbre = new Float32Array(3);

  build(f: Features, s: Settings, sceneParams: Record<string, number>): Record<string, UniformValue> {
    const r = s.reactivity;
    const sens = r.sensitivity;
    const u = this.u;
    const sc = f.scalars;
    const ev = (v: number, gain: number): number => Math.min(2, v * gain * sens);
    const level = (v: number, gain: number): number => Math.min(1.5, v * gain * sens);

    u.uTime = f.time;
    u.uFlow = r.motion * (0.4 * f.time + sens * f.energyTime);
    u.uSeed = hash(f.count.section + 1) * 10;

    u.uLoud = level(sc.loudness, 1);
    u.uIntensity = sc.intensity;
    u.uSub = level(sc.sub, r.bass);
    u.uBass = level(sc.bass, r.bass);
    u.uLowMid = level(sc.lowMid, r.bass);
    u.uMid = level(sc.mid, 1);
    u.uHigh = level(sc.high, 1);
    u.uAir = level(sc.air, r.hat);
    u.uPerc = level(sc.percussive, 1);
    u.uHarm = level(sc.harmonic, 1);
    u.uBright = sc.brightness;
    u.uNoisy = sc.noisiness;
    u.uTonal = sc.tonalness;
    u.uWidth = sc.width;
    u.uNovelty = sc.novelty;
    const tg = r.timbre * sens;
    this.timbre[0] = Math.max(-1.5, Math.min(1.5, sc.timbreX * tg));
    this.timbre[1] = Math.max(-1.5, Math.min(1.5, sc.timbreY * tg));
    this.timbre[2] = Math.max(-1.5, Math.min(1.5, sc.timbreZ * tg));
    u.uTimbre = this.timbre;
    const key = keyHue(f);
    u.uKeyHue = key.hue;
    u.uKeyStrength = key.strength;
    u.uChroma = f.chroma;

    u.uKick = ev(f.env.kick, r.kick);
    u.uSnare = ev(f.env.snare, r.snare);
    u.uHat = ev(f.env.hat, r.hat);
    u.uOnset = ev(f.env.onset, r.onset);
    u.uNote = ev(f.env.note, r.onset);
    u.uBeat = ev(f.env.beat, 1);
    u.uDownbeat = ev(f.env.downbeat, 1);
    u.uSection = Math.min(1.5, f.env.section);
    this.count[0] = f.count.kick;
    this.count[1] = f.count.snare;
    this.count[2] = f.count.hat;
    this.count[3] = f.count.section;
    u.uCount = this.count;
    u.uBeatPhase = f.beatPhase;
    u.uBarPhase = f.barPhase;
    u.uTempo = f.tempo;
    copyHistory(f.recent.kick, this.kickHist, r.kick * sens);
    copyHistory(f.recent.snare, this.snareHist, r.snare * sens);
    copyHistory(f.recent.hat, this.hatHist, r.hat * sens);
    copyHistory(f.recent.note, this.noteHist, sens);
    u.uKickHist = this.kickHist;
    u.uSnareHist = this.snareHist;
    u.uHatHist = this.hatHist;
    u.uNoteHist = this.noteHist;
    u.uNotePitch = f.notePitch;
    u.uNoteCount = f.count.note;

    const angle = hash(f.count.kick) * Math.PI * 2;
    const amp = 0.025 * s.look.shake * (u.uKick as number);
    this.shake[0] = Math.cos(angle) * amp * Math.cos(f.time * 50);
    this.shake[1] = Math.sin(angle) * amp * Math.cos(f.time * 50);
    u.uShake = this.shake;

    const pal = currentPalette(s, f);
    u.uPal0 = pal.stops[0];
    u.uPal1 = pal.stops[1];
    u.uPal2 = pal.stops[2];
    u.uPal3 = pal.stops[3];
    u.uPalShift = pal.shift;

    for (const key in sceneParams) u[`p_${key}`] = sceneParams[key];
    return u;
  }
}

function copyHistory(src: Float32Array, dst: Float32Array, gain: number): void {
  for (let i = 0; i < src.length; i += 2) {
    dst[i] = src[i];
    dst[i + 1] = Math.min(2, src[i + 1] * gain);
  }
}
