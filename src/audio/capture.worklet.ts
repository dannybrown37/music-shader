// Runs on the audio thread: batches input into 1024-frame chunks and posts them to the main thread.

declare const sampleRate: number;
declare function registerProcessor(name: string, ctor: unknown): void;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
}

const CHUNK = 1024;

class CaptureProcessor extends AudioWorkletProcessor {
  private left = new Float32Array(CHUNK);
  private right = new Float32Array(CHUNK);
  private filled = 0;

  process(inputs: Float32Array[][]): boolean {
    const input = inputs[0];
    if (!input || input.length === 0) return true;
    const l = input[0];
    const r = input[1] ?? input[0];
    for (let i = 0; i < l.length; i++) {
      this.left[this.filled] = l[i];
      this.right[this.filled] = r[i];
      if (++this.filled === CHUNK) {
        this.port.postMessage({ left: this.left, right: this.right, sampleRate }, [this.left.buffer, this.right.buffer]);
        this.left = new Float32Array(CHUNK);
        this.right = new Float32Array(CHUNK);
        this.filled = 0;
      }
    }
    return true;
  }
}

registerProcessor("capture", CaptureProcessor);
