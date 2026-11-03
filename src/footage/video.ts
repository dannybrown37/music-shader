import { ALL_FORMATS, BlobSource, CanvasSink, Input } from "mediabunny";
import type { WrappedCanvas } from "mediabunny";

/** Live playback lets the <video> drift this far from the audio before it is re-seeked. */
const MAX_DRIFT = 0.12;

/**
 * The camera footage of a loaded video file.
 *
 *   live:    muted <video> kept in step with Player.time (cheap, may lag a frame)
 *   export:  mediabunny decodes the exact frame for each t (see `sequence` / `seek`)
 */
export class FootageVideo {
  readonly element: HTMLVideoElement;
  readonly width: number;
  readonly height: number;
  /** Set by seek/sequence: the decoded frame to draw instead of the <video>. */
  private exact: WrappedCanvas | null = null;
  private sink: Promise<CanvasSink> | null = null;
  private readonly url: string;
  private readonly file: Blob;

  private constructor(file: Blob, element: HTMLVideoElement, url: string) {
    this.file = file;
    this.element = element;
    this.url = url;
    this.width = element.videoWidth;
    this.height = element.videoHeight;
  }

  static async open(file: Blob): Promise<FootageVideo> {
    const url = URL.createObjectURL(file);
    const v = document.createElement("video");
    v.muted = true;
    v.playsInline = true;
    v.preload = "auto";
    v.src = url;
    await new Promise<void>((resolve, reject) => {
      v.onloadeddata = (): void => resolve();
      v.onerror = (): void => reject(new Error("This browser can't play the video track"));
    });
    return new FootageVideo(file, v, url);
  }

  get duration(): number {
    return this.element.duration;
  }

  get aspect(): number {
    return this.height > 0 ? this.width / this.height : 16 / 9;
  }

  /** What to upload this frame. */
  get frame(): TexImageSource | null {
    if (this.exact) return this.exact.canvas;
    return this.element.readyState >= 2 ? this.element : null;
  }

  /** Live: follow the audio clock. Leaves exact mode. */
  follow(t: number, playing: boolean): void {
    this.exact = null;
    const v = this.element;
    if (playing && v.paused) void v.play().catch(() => undefined);
    if (!playing && !v.paused) v.pause();
    if (Math.abs(v.currentTime - t) > (playing ? MAX_DRIFT : 0.02)) v.currentTime = t;
  }

  private canvasSink(): Promise<CanvasSink> {
    this.sink ??= (async (): Promise<CanvasSink> => {
      const input = new Input({ source: new BlobSource(this.file), formats: ALL_FORMATS });
      const track = await input.getPrimaryVideoTrack();
      if (!track) throw new Error("The file has no video track");
      return new CanvasSink(track, { poolSize: 2 });
    })();
    return this.sink;
  }

  /** Stills: decode the exact frame at t. */
  async seek(t: number): Promise<void> {
    this.element.pause();
    this.exact = await (await this.canvasSink()).getCanvas(t);
  }

  /** Export: frames at ascending times, each decoded once. Call `next()` before rendering each one. */
  async sequence(times: number[]): Promise<{ next: () => Promise<void>; done: () => void }> {
    this.element.pause();
    const frames = (await this.canvasSink()).canvasesAtTimestamps(times);
    return {
      next: async (): Promise<void> => {
        const r = await frames.next();
        if (!r.done && r.value) this.exact = r.value;
      },
      done: (): void => {
        void frames.return(undefined);
        this.exact = null;
      },
    };
  }

  dispose(): void {
    this.element.pause();
    this.element.removeAttribute("src");
    URL.revokeObjectURL(this.url);
  }
}

export function isVideoFile(file: { name: string; type: string }): boolean {
  return file.type.startsWith("video/") || /\.(mp4|mov|m4v|webm|mkv)$/i.test(file.name);
}
