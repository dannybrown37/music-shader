import { analyzeTrack } from "../analysis/track.ts";
import type { TrackAnalysis } from "../analysis/types.ts";

export interface AnalyzeRequest {
  left: Float32Array;
  right: Float32Array | null;
  sampleRate: number;
}

export type AnalyzeResponse = { type: "progress"; fraction: number } | { type: "done"; analysis: TrackAnalysis } | { type: "error"; message: string };

const post = (msg: AnalyzeResponse, transfer: Transferable[] = []): void => (self as unknown as Worker).postMessage(msg, transfer);

self.onmessage = (e: MessageEvent<AnalyzeRequest>): void => {
  try {
    const { left, right, sampleRate } = e.data;
    const analysis = analyzeTrack(left, right, sampleRate, (fraction) => post({ type: "progress", fraction }));
    const buffers = [...new Set([analysis.mel, analysis.chroma, ...Object.values(analysis.scalars)].map((a) => a.buffer as ArrayBuffer))];
    post({ type: "done", analysis }, buffers);
  } catch (err: unknown) {
    post({ type: "error", message: err instanceof Error ? err.message : String(err) });
  }
};
