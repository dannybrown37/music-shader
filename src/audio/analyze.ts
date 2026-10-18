import type { TrackAnalysis } from "../analysis/types.ts";
import type { AnalyzeRequest, AnalyzeResponse } from "./analysis.worker.ts";

/** Runs the offline analysis in a worker so the UI keeps animating while a song is analysed. */
export function analyzeInWorker(buffer: AudioBuffer, onProgress: (fraction: number) => void): Promise<TrackAnalysis> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./analysis.worker.ts", import.meta.url), { type: "module" });
    const left = buffer.getChannelData(0).slice();
    const right = buffer.numberOfChannels > 1 ? buffer.getChannelData(1).slice() : null;
    worker.onmessage = (e: MessageEvent<AnalyzeResponse>): void => {
      const msg = e.data;
      if (msg.type === "progress") onProgress(msg.fraction);
      else {
        worker.terminate();
        if (msg.type === "done") resolve(msg.analysis);
        else reject(new Error(msg.message));
      }
    };
    worker.onerror = (e): void => {
      worker.terminate();
      reject(new Error(e.message));
    };
    const req: AnalyzeRequest = { left, right, sampleRate: buffer.sampleRate };
    worker.postMessage(req, [left.buffer, ...(right ? [right.buffer] : [])]);
  });
}
