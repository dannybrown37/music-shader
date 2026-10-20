import { MEL_BANDS } from "../analysis/frame.ts";
import { ART_MODES } from "../settings.ts";
import type { ArtMode, Settings } from "../settings.ts";
import { createTarget, DataTexture, deleteTarget, FullscreenTriangle, Program } from "./gl.ts";
import type { Target, UniformValue } from "./gl.ts";
import { MAX_SHAPES, TEXELS_PER_SHAPE } from "./mosaic.ts";
import type { SceneDef } from "./scenes/index.ts";
import bloomSource from "./shaders/bloom.glsl?raw";
import common from "./shaders/common.glsl?raw";
import compositeSource from "./shaders/composite.glsl?raw";
import feedbackSource from "./shaders/feedback.glsl?raw";
import luminanceSource from "./shaders/luminance.glsl?raw";

export const SPECTROGRAM_ROWS = 128;

export interface SceneFade {
  scene: SceneDef;
  uniforms: Record<string, UniformValue>;
  /** Weight of the incoming (current) scene, 0..1. */
  mix: number;
}
/** What's composited over the scene: opacities of the title card and lyric line, and the cover art mode. */
export interface Layers {
  title: number;
  lyrics: number;
  art: ArtMode;
  artSize: number;
}

const BLOOM_LEVELS = 6;
const LUM_SIZE = 256;
const LUM_LEVELS = Math.log2(LUM_SIZE) + 1;
const ADAPT_SECONDS = 1.2;

/**
 *   scene ──► feedback (trails) ──┬─► bloom chain ──────────────┬─► composite ──► canvas
 *     ▲            │              └─► avg luminance ─► adapt ───┘
 *     └── uPrev ◄──┘
 */
export class Renderer {
  readonly gl: WebGL2RenderingContext;
  readonly canvas: HTMLCanvasElement;
  readonly spectrum: DataTexture;
  readonly spectrogram: DataTexture;
  /** (pitch, melody) per row, same rows as the spectrogram. */
  readonly melodyLine: DataTexture;
  /** Mosaic's shape records (see mosaic.ts); other scenes don't declare uShapes. */
  readonly shapes: DataTexture;
  private readonly tri: FullscreenTriangle;
  private readonly feedback: Program;
  private readonly bloom: Program;
  private readonly composite: Program;
  private readonly luminance: Program;
  private readonly lumTarget: Target;
  private readonly adapted: Target[];
  private adaptPing = 0;
  /** Stills skip the gradual eye adaptation so a single frame is exposed as it would be mid-song. */
  adaptInstantly = false;
  private exposureKey = 0.05;
  private readonly overlayTexture: WebGLTexture;
  private readonly lyricsTexture: WebGLTexture;
  private readonly artTexture: WebGLTexture;
  private artAspect = 0;
  private hasLyrics = false;
  private readonly scenePrograms = new Map<string, Program>();
  private scene: Program | null = null;
  private sceneTarget: Target | null = null;
  private sceneFromTarget: Target | null = null;
  private feedbackTargets: Target[] = [];
  private bloomDown: Target[] = [];
  private bloomUp: Target[] = [];
  private ping = 0;
  private size: [number, number] = [0, 0];
  private renderScale = 1;
  private hasOverlay = false;

  constructor(canvas: HTMLCanvasElement) {
    const gl = canvas.getContext("webgl2", { antialias: false, alpha: false, preserveDrawingBuffer: true, powerPreference: "high-performance" });
    if (!gl) throw new Error("WebGL2 is not available in this browser");
    if (!gl.getExtension("EXT_color_buffer_float")) throw new Error("EXT_color_buffer_float is required for HDR rendering");
    this.gl = gl;
    this.canvas = canvas;
    this.tri = new FullscreenTriangle(gl);
    this.feedback = new Program(gl, feedbackSource, "feedback");
    this.bloom = new Program(gl, bloomSource, "bloom");
    this.composite = new Program(gl, compositeSource, "composite");
    this.luminance = new Program(gl, luminanceSource, "luminance");
    this.lumTarget = createMipmappedTarget(gl, LUM_SIZE);
    this.adapted = [createTarget(gl, 1, 1, true), createTarget(gl, 1, 1, true)];
    this.resetAdaptation();
    this.spectrum = new DataTexture(gl, MEL_BANDS, 1);
    this.spectrogram = new DataTexture(gl, MEL_BANDS, SPECTROGRAM_ROWS);
    this.melodyLine = new DataTexture(gl, 2, SPECTROGRAM_ROWS);
    this.shapes = new DataTexture(gl, TEXELS_PER_SHAPE, MAX_SHAPES, true);
    this.overlayTexture = createImageTexture(gl, false);
    this.lyricsTexture = createImageTexture(gl, false);
    this.artTexture = createImageTexture(gl, true);
  }

  /** Compiles on first use; throws ShaderError with line context if the scene doesn't compile. */
  private programFor(def: SceneDef): Program {
    let program = this.scenePrograms.get(def.id);
    if (!program) {
      program = new Program(this.gl, `${common}\n#line 1\n${def.source}`, `scene "${def.id}"`);
      this.scenePrograms.set(def.id, program);
    }
    return program;
  }

  setScene(def: SceneDef): void {
    this.scene = this.programFor(def);
    this.exposureKey = def.exposureKey;
  }

  /** Compile ahead of time so an automatic scene change doesn't stall mid-song. */
  precompile(defs: SceneDef[]): void {
    for (const d of defs) this.programFor(d);
  }

  /** Swaps in freshly edited shader source. Compiles first, so a broken edit leaves the old program in place. */
  reloadScene(def: SceneDef): void {
    const fresh = new Program(this.gl, `${common}\n#line 1\n${def.source}`, `scene "${def.id}"`);
    const old = this.scenePrograms.get(def.id);
    this.scenePrograms.set(def.id, fresh);
    if (old) {
      if (this.scene === old) this.scene = fresh;
      this.gl.deleteProgram(old.program);
    }
  }

  setOverlay(image: TexImageSource | null): void {
    this.hasOverlay = image !== null;
    if (image) this.uploadImage(this.overlayTexture, image, false);
  }

  setLyrics(image: TexImageSource | null): void {
    this.hasLyrics = image !== null;
    if (image) this.uploadImage(this.lyricsTexture, image, false);
  }

  /** Cover art / logo. Mipmapped, since a large image is usually drawn much smaller. */
  setArt(image: (TexImageSource & { width: number; height: number }) | null): void {
    this.artAspect = image && image.height > 0 ? image.width / image.height : 0;
    if (image) this.uploadImage(this.artTexture, image, true);
  }

  get hasArt(): boolean {
    return this.artAspect > 0;
  }

  private uploadImage(texture: WebGLTexture, image: TexImageSource, mipmaps: boolean): void {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
    if (mipmaps) gl.generateMipmap(gl.TEXTURE_2D);
  }

  resize(width: number, height: number, renderScale: number): void {
    if (this.size[0] === width && this.size[1] === height && this.renderScale === renderScale && this.sceneTarget) return;
    const gl = this.gl;
    this.canvas.width = width;
    this.canvas.height = height;
    this.size = [width, height];
    this.renderScale = renderScale;
    for (const t of [this.sceneTarget, this.sceneFromTarget, ...this.feedbackTargets, ...this.bloomDown, ...this.bloomUp]) if (t) deleteTarget(gl, t);
    const w = Math.max(1, Math.round(width * renderScale));
    const h = Math.max(1, Math.round(height * renderScale));
    this.sceneTarget = createTarget(gl, w, h, true);
    this.sceneFromTarget = createTarget(gl, w, h, true);
    this.feedbackTargets = [createTarget(gl, w, h, true), createTarget(gl, w, h, true)];
    this.bloomDown = [];
    this.bloomUp = [];
    let bw = w;
    let bh = h;
    for (let i = 0; i < BLOOM_LEVELS; i++) {
      bw = Math.max(1, bw >> 1);
      bh = Math.max(1, bh >> 1);
      this.bloomDown.push(createTarget(gl, bw, bh, true));
      this.bloomUp.push(createTarget(gl, bw, bh, true));
    }
  }

  private drawScene(program: Program, uniforms: Record<string, UniformValue>, target: Target, prev: Target): void {
    program.use();
    program.setAll(uniforms);
    program.set("uResolution", [target.width, target.height]);
    program.set("uSpectrum", this.spectrum.texture);
    program.set("uSpectrogram", this.spectrogram.texture);
    program.set("uMelodyLine", this.melodyLine.texture);
    program.set("uPrev", prev.texture);
    program.set("uShapes", this.shapes.texture);
    this.tri.draw(target);
  }

  /**
   * `dt` keeps trail length and drift identical whether we draw at 30, 60 or 144 fps.
   * `fadeFrom` renders a second, outgoing scene and crossfades it out (auto-VJ transitions).
   */
  render(uniforms: Record<string, UniformValue>, look: Settings["look"], layers: Layers, dt: number, fadeFrom?: SceneFade): void {
    const frames60 = Math.max(0, dt * 60);
    const scene = this.scene;
    const sceneTarget = this.sceneTarget;
    const fromTarget = this.sceneFromTarget;
    if (!scene || !sceneTarget || !fromTarget) return;
    const tri = this.tri;
    const prev = this.feedbackTargets[this.ping];
    const next = this.feedbackTargets[1 - this.ping];

    this.drawScene(scene, uniforms, sceneTarget, prev);
    const fading = fadeFrom !== undefined && fadeFrom.mix < 1;
    if (fading) this.drawScene(this.programFor(fadeFrom.scene), fadeFrom.uniforms, fromTarget, prev);
    const key = fading ? fadeFrom.scene.exposureKey + (this.exposureKey - fadeFrom.scene.exposureKey) * fadeFrom.mix : this.exposureKey;

    const fb = this.feedback;
    fb.use();
    fb.set("uScene", sceneTarget.texture);
    fb.set("uSceneFrom", fromTarget.texture);
    fb.set("uSceneMix", fading ? fadeFrom.mix : 1);
    fb.set("uPrevFeedback", prev.texture);
    fb.set("uResolution", [next.width, next.height]);
    fb.set("uAmount", look.feedback ** frames60);
    const kick = (uniforms.uKick as number) ?? 0;
    fb.set("uZoom", look.feedbackZoom * (1 + 2 * kick) * frames60);
    fb.set("uSpin", look.feedbackSpin * frames60);
    fb.set("uHueShift", look.feedbackHue * frames60);
    fb.set("uWarp", (uniforms.uBass as number) ?? 0);
    fb.set("uTime", (uniforms.uTime as number) ?? 0);
    tri.draw(next);
    this.ping = 1 - this.ping;

    const bloom = this.bloom;
    bloom.use();
    bloom.set("uThreshold", look.bloomThreshold);
    bloom.set("uKnee", Math.max(0.05, look.bloomThreshold * 0.5));
    let src: Target = next;
    for (let i = 0; i < BLOOM_LEVELS; i++) {
      bloom.set("uMode", i === 0 ? 0 : 1);
      // Every sampler must point at something other than the target, or WebGL reports a feedback loop.
      bloom.set("uLow", this.spectrum.texture);
      bloom.set("uHigh", this.spectrum.texture);
      bloom.set("uSource", src.texture);
      bloom.set("uTexel", [1 / src.width, 1 / src.height]);
      tri.draw(this.bloomDown[i]);
      src = this.bloomDown[i];
    }
    let low = this.bloomDown[BLOOM_LEVELS - 1];
    for (let i = BLOOM_LEVELS - 2; i >= 0; i--) {
      bloom.set("uMode", 2);
      bloom.set("uLow", low.texture);
      bloom.set("uHigh", this.bloomDown[i].texture);
      bloom.set("uTexel", [1 / low.width, 1 / low.height]);
      tri.draw(this.bloomUp[i]);
      low = this.bloomUp[i];
    }

    const lum = this.luminance;
    lum.use();
    lum.set("uMode", 0);
    lum.set("uPrevAdapted", this.spectrum.texture);
    lum.set("uSource", next.texture);
    tri.draw(this.lumTarget);
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.lumTarget.texture);
    gl.generateMipmap(gl.TEXTURE_2D);
    const adaptedPrev = this.adapted[this.adaptPing];
    const adaptedNext = this.adapted[1 - this.adaptPing];
    lum.set("uMode", 1);
    lum.set("uSource", this.lumTarget.texture);
    lum.set("uPrevAdapted", adaptedPrev.texture);
    lum.set("uMaxLevel", LUM_LEVELS - 1);
    lum.set("uBlend", this.adaptInstantly ? 1 : 1 - Math.exp(-dt / ADAPT_SECONDS));
    tri.draw(adaptedNext);
    this.adaptPing = 1 - this.adaptPing;

    const comp = this.composite;
    comp.use();
    comp.set("uImage", next.texture);
    comp.set("uBloom", low.texture);
    comp.set("uOverlay", this.overlayTexture);
    comp.set("uOverlayAlpha", this.hasOverlay ? layers.title : 0);
    comp.set("uLyrics", this.lyricsTexture);
    comp.set("uLyricsAlpha", this.hasLyrics ? layers.lyrics : 0);
    comp.set("uArt", this.artTexture);
    comp.set("uArtMode", this.hasArt ? ART_MODES.indexOf(layers.art) : 0);
    comp.set("uArtSize", layers.artSize);
    comp.set("uArtAspect", this.artAspect || 1);
    comp.set("uArtPulse", kick);
    comp.set("uResolution", this.size);
    comp.set("uTime", (uniforms.uTime as number) ?? 0);
    // The upsample chain sums every level, so normalise by the level count.
    comp.set("uBloomStrength", (look.bloom * (1 + 0.6 * kick)) / BLOOM_LEVELS);
    comp.set("uExposure", look.exposure);
    comp.set("uAdapted", adaptedNext.texture);
    comp.set("uAutoExposure", look.autoExposure);
    comp.set("uKey", key);
    comp.set("uChromatic", look.chromatic * (0.3 + 1.5 * ((uniforms.uSnare as number) ?? 0) + 0.7 * kick));
    comp.set("uGrain", look.grain);
    comp.set("uVignette", look.vignette);
    comp.set("uFlash", look.flash * Math.max(kick * 0.6, (uniforms.uSnare as number) ?? 0));
    tri.draw(null, this.size);
  }

  /** Clears trails, e.g. after a seek so stale frames don't smear into the new position. */
  resetFeedback(): void {
    const gl = this.gl;
    for (const t of this.feedbackTargets) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, t.framebuffer);
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  /** Starts auto-exposure from "already correctly exposed", so exports begin identically every time. */
  resetAdaptation(): void {
    const gl = this.gl;
    for (const t of this.adapted) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, t.framebuffer);
      gl.clearColor(Math.log(this.exposureKey), 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  /** Current adapted average luminance (linear). Reads back from the GPU, so only for diagnostics. */
  adaptedLuminance(): number {
    const gl = this.gl;
    const px = new Float32Array(4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.adapted[this.adaptPing].framebuffer);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.FLOAT, px);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return Math.exp(px[0]);
  }
}

/** A 1×1 transparent texture, replaced later by an uploaded image. */
function createImageTexture(gl: WebGL2RenderingContext, mipmapped: boolean): WebGLTexture {
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 0]));
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mipmapped ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  if (mipmapped) gl.generateMipmap(gl.TEXTURE_2D);
  return texture;
}

function createMipmappedTarget(gl: WebGL2RenderingContext, size: number): Target {
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texStorage2D(gl.TEXTURE_2D, Math.log2(size) + 1, gl.RGBA16F, size, size);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  const framebuffer = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return { texture, framebuffer, width: size, height: size };
}
