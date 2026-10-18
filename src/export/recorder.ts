/**
 * Real-time recording: whatever the canvas shows (scene switches, key presses, live input)
 * plus the audio, via MediaRecorder. Unlike the offline export it runs at whatever frame
 * rate the GPU manages, so record at a resolution your GPU can play smoothly.
 */

const MIME_CANDIDATES = ["video/mp4;codecs=avc1.640028,mp4a.40.2", "video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"];
const BITS_PER_PIXEL_FRAME = 0.12;
const MIN_BITRATE = 4_000_000;
const MAX_BITRATE = 40_000_000;
const CHUNK_MS = 1000;

export function pickRecorderMime(isSupported: (mime: string) => boolean): string | null {
  return MIME_CANDIDATES.find(isSupported) ?? null;
}

export function extensionFor(mime: string): "mp4" | "webm" {
  return mime.startsWith("video/mp4") ? "mp4" : "webm";
}

/** Roughly YouTube's recommended upload bitrates (about 15 Mbit/s for 1080p60). */
export function recorderBitrate(width: number, height: number, fps: number): number {
  return Math.round(Math.min(MAX_BITRATE, Math.max(MIN_BITRATE, width * height * fps * BITS_PER_PIXEL_FRAME)));
}

interface Sink {
  write: (chunk: Blob) => Promise<void>;
  close: () => Promise<void>;
}

interface WritableFile {
  write: (data: Blob) => Promise<void>;
  close: () => Promise<void>;
}

interface SaveFilePicker {
  showSaveFilePicker?: (opts: { suggestedName: string; types: { description: string; accept: Record<string, string[]> }[] }) => Promise<{
    createWritable: () => Promise<WritableFile>;
  }>;
}

/** Streams to a file the user picks when the browser allows it, so long sets don't fill memory; else downloads at the end. */
async function openSink(fileName: string, mime: string): Promise<Sink> {
  const picker = (window as unknown as SaveFilePicker).showSaveFilePicker;
  if (picker) {
    try {
      const ext = extensionFor(mime);
      const handle = await picker({ suggestedName: fileName, types: [{ description: `${ext.toUpperCase()} video`, accept: { [mime.split(";")[0]]: [`.${ext}`] } }] });
      const file = await handle.createWritable();
      return { write: (chunk) => file.write(chunk), close: () => file.close() };
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === "AbortError") throw err;
      if (!(err instanceof DOMException)) throw err;
    }
  }
  const chunks: Blob[] = [];
  return {
    write: async (chunk) => {
      chunks.push(chunk);
    },
    close: async () => {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob(chunks, { type: mime }));
      a.download = fileName;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
    },
  };
}

export class LiveRecorder {
  readonly fileName: string;
  private readonly recorder: MediaRecorder;
  private readonly startedAt = performance.now();
  private readonly done: Promise<void>;

  private constructor(recorder: MediaRecorder, sink: Sink, fileName: string) {
    this.recorder = recorder;
    this.fileName = fileName;
    let writes = Promise.resolve();
    recorder.ondataavailable = (e: BlobEvent): void => {
      if (e.data.size > 0) writes = writes.then(() => sink.write(e.data));
    };
    this.done = new Promise((resolve, reject) => {
      recorder.onstop = (): void => {
        writes.then(() => sink.close()).then(resolve, reject);
      };
    });
  }

  /** Call from a click or key handler: the save dialog needs the user gesture. */
  static async start(canvas: HTMLCanvasElement, audio: MediaStream | null, baseName: string, fps = 60): Promise<LiveRecorder> {
    const mime = pickRecorderMime((m) => MediaRecorder.isTypeSupported(m));
    if (!mime) throw new Error("This browser can't record video (no MediaRecorder format available)");
    const fileName = `${baseName}.${extensionFor(mime)}`;
    const sink = await openSink(fileName, mime);
    const stream = canvas.captureStream(fps);
    for (const track of audio?.getAudioTracks() ?? []) stream.addTrack(track);
    const recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: recorderBitrate(canvas.width, canvas.height, fps), audioBitsPerSecond: 192_000 });
    const rec = new LiveRecorder(recorder, sink, fileName);
    recorder.start(CHUNK_MS);
    return rec;
  }

  get seconds(): number {
    return (performance.now() - this.startedAt) / 1000;
  }

  /** Resolves once the file is fully written (or downloaded). */
  stop(): Promise<void> {
    if (this.recorder.state !== "inactive") this.recorder.stop();
    return this.done;
  }
}
