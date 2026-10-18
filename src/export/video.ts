import {
  AudioBufferSource,
  BufferTarget,
  CanvasSource,
  getFirstEncodableAudioCodec,
  getFirstEncodableVideoCodec,
  Mp4OutputFormat,
  Output,
  QUALITY_HIGH,
  QUALITY_VERY_HIGH,
  StreamTarget,
} from "mediabunny";
import type { StreamTargetChunk, Target } from "mediabunny";

/**
 * Offline export: every frame is rendered at an exact timestamp (t = start + i / fps)
 * and encoded with WebCodecs, so the video is frame-perfect even if the GPU can't
 * render that resolution in real time.
 */

export const EXPORT_RESOLUTIONS: Record<string, [number, number]> = {
  "720p": [1280, 720],
  "1080p": [1920, 1080],
  "1440p": [2560, 1440],
  "4K": [3840, 2160],
  "Vertical 1080×1920": [1080, 1920],
  "Square 1080": [1080, 1080],
};

export interface ExportJob {
  canvas: HTMLCanvasElement;
  audio: AudioBuffer;
  width: number;
  height: number;
  fps: number;
  start: number;
  end: number;
  quality: "high" | "very high";
  fileName: string;
  /** "save": ask where to save (or download); "buffer": just return the bytes (used by tests). */
  mode: "save" | "buffer";
  /** Draws the frame for time t into `canvas`. */
  renderFrame: (t: number, dt: number) => void;
  onProgress: (fraction: number, etaSeconds: number) => void;
  signal: AbortSignal;
}

interface SaveFilePicker {
  showSaveFilePicker?: (opts: { suggestedName: string; types: { description: string; accept: Record<string, string[]> }[] }) => Promise<{
    createWritable: () => Promise<WritableStream<StreamTargetChunk>>;
  }>;
}

function sliceAudio(audio: AudioBuffer, start: number, end: number): AudioBuffer {
  const from = Math.floor(start * audio.sampleRate);
  const to = Math.min(audio.length, Math.ceil(end * audio.sampleRate));
  const out = new AudioBuffer({ length: Math.max(1, to - from), numberOfChannels: audio.numberOfChannels, sampleRate: audio.sampleRate });
  for (let c = 0; c < audio.numberOfChannels; c++) out.copyToChannel(audio.getChannelData(c).subarray(from, to), c);
  return out;
}

interface OpenedTarget {
  target: Target;
  finish: () => ArrayBuffer | null;
  abort: () => Promise<void>;
}

function bufferTarget(fileName: string, download: boolean): OpenedTarget {
  const target = new BufferTarget();
  return {
    target,
    finish: () => {
      if (target.buffer && download) {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(new Blob([target.buffer], { type: "video/mp4" }));
        a.download = fileName;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
      }
      return target.buffer;
    },
    abort: async () => {},
  };
}

/**
 * Streams straight to disk when the browser offers a save dialog (needed for long 4K renders,
 * which won't fit in memory); otherwise buffers in memory and downloads at the end.
 */
async function openTarget(fileName: string, mode: ExportJob["mode"]): Promise<OpenedTarget> {
  const picker = (window as unknown as SaveFilePicker).showSaveFilePicker;
  if (mode === "buffer" || !picker) return bufferTarget(fileName, mode === "save");
  try {
    const handle = await picker({ suggestedName: fileName, types: [{ description: "MP4 video", accept: { "video/mp4": [".mp4"] } }] });
    const writable = await handle.createWritable();
    return { target: new StreamTarget(writable, { chunked: true }), finish: () => null, abort: () => writable.abort() };
  } catch (err: unknown) {
    // A cancelled dialog cancels the export; a refused one (no user gesture, policy) falls back to a download.
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    if (err instanceof DOMException) return bufferTarget(fileName, true);
    throw err;
  }
}

/** Returns the encoded file when `mode` is "buffer", otherwise null once it has been saved. */
export async function exportVideo(job: ExportJob): Promise<ArrayBuffer | null> {
  const quality = job.quality === "very high" ? QUALITY_VERY_HIGH : QUALITY_HIGH;
  // Open the save dialog first, while the click that started the export still counts as a user gesture.
  const { target, finish, abort } = await openTarget(job.fileName, job.mode);
  const videoCodec = await getFirstEncodableVideoCodec(["avc", "hevc", "vp9", "av1"], { width: job.width, height: job.height, quality });
  const audioCodec = await getFirstEncodableAudioCodec(["aac", "opus"], { numberOfChannels: job.audio.numberOfChannels, sampleRate: job.audio.sampleRate, quality: QUALITY_HIGH });
  if (!videoCodec || !audioCodec) {
    await abort();
    throw new Error(!videoCodec ? `This browser can't encode ${job.width}×${job.height} video; try a lower resolution` : "This browser can't encode AAC or Opus audio");
  }

  const output = new Output({ format: new Mp4OutputFormat({ fastStart: target instanceof BufferTarget ? "in-memory" : false }), target });
  const video = new CanvasSource(job.canvas, { codec: videoCodec, bitrate: quality, keyFrameInterval: 2 });
  const audio = new AudioBufferSource({ codec: audioCodec, bitrate: QUALITY_HIGH });
  output.addVideoTrack(video, { frameRate: job.fps });
  output.addAudioTrack(audio);
  await output.start();

  try {
    await audio.add(sliceAudio(job.audio, job.start, job.end));
    const dt = 1 / job.fps;
    const frames = Math.max(1, Math.round((job.end - job.start) * job.fps));
    const began = performance.now();
    for (let i = 0; i < frames; i++) {
      if (job.signal.aborted) throw new DOMException("Export cancelled", "AbortError");
      job.renderFrame(job.start + i * dt, dt);
      await video.add(i * dt, dt);
      if (i % 10 === 0) {
        const elapsed = (performance.now() - began) / 1000;
        job.onProgress((i + 1) / frames, (elapsed / (i + 1)) * (frames - i - 1));
      }
    }
    await output.finalize();
    return finish();
  } catch (err: unknown) {
    await output.cancel();
    throw err;
  }
}
