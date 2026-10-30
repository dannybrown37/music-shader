import { LiveAnalyzer } from "../analysis/live.ts";
import workletUrl from "./capture.worklet.ts?worker&url";

export type LiveSource = "mic" | "tab";

const workletLoaded = new WeakMap<AudioContext, Promise<void>>();

/**
 * Captures a microphone / line-in, or the audio of a browser tab or the whole system
 * (Chrome's share dialog: pick a tab and tick "Also share tab audio"), and feeds it to a
 * LiveAnalyzer. Nothing is played back, so there's no feedback loop.
 */
export class LiveInput {
  readonly analyzer: LiveAnalyzer;
  private readonly stream: MediaStream;
  private readonly node: AudioWorkletNode;
  private readonly source: MediaStreamAudioSourceNode;
  private lastChunkAt = performance.now();
  onEnded: (() => void) | null = null;

  private constructor(sampleRate: number, stream: MediaStream, source: MediaStreamAudioSourceNode, node: AudioWorkletNode) {
    this.stream = stream;
    this.source = source;
    this.node = node;
    this.analyzer = new LiveAnalyzer(sampleRate);
    node.port.onmessage = (e: MessageEvent<{ left: Float32Array; right: Float32Array }>): void => {
      this.analyzer.push(e.data.left, e.data.right);
      this.lastChunkAt = performance.now();
    };
    for (const track of stream.getAudioTracks()) track.addEventListener("ended", () => this.onEnded?.());
  }

  static async start(ctx: AudioContext, kind: LiveSource): Promise<LiveInput> {
    // Mobile Safari only lets an AudioContext start inside the tap; after the permission prompt it's too late.
    const resumed = ctx.state === "running" ? Promise.resolve() : ctx.resume();
    // A phone mic across the room is far quieter than shared tab audio; let the browser level it up.
    const audio = { echoCancellation: false, noiseSuppression: false, autoGainControl: kind === "mic" };
    const stream = kind === "mic" ? await navigator.mediaDevices.getUserMedia({ audio }) : await navigator.mediaDevices.getDisplayMedia({ video: true, audio });
    if (stream.getAudioTracks().length === 0) {
      for (const t of stream.getTracks()) t.stop();
      throw new Error("No audio was shared. In Chrome's dialog pick a tab and tick “Also share tab audio”.");
    }
    // The share dialog insists on video. It's left running because stopping it can end the share.
    await resumed;
    // Opening the mic switches iOS's audio session, which can interrupt the context again.
    if (ctx.state !== "running") await ctx.resume();
    // Registering the same processor name twice throws, so load the module once per context.
    let ready = workletLoaded.get(ctx);
    if (!ready) {
      ready = ctx.audioWorklet.addModule(workletUrl);
      workletLoaded.set(ctx, ready);
    }
    await ready;
    const source = ctx.createMediaStreamSource(stream);
    const node = new AudioWorkletNode(ctx, "capture", { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 2, channelCountMode: "explicit" });
    // Safari never calls process() on a node nothing pulls from, so route it into a muted sink.
    const mute = ctx.createGain();
    mute.gain.value = 0;
    source.connect(node);
    node.connect(mute).connect(ctx.destination);
    return new LiveInput(ctx.sampleRate, stream, source, node);
  }

  /** Analyser time plus however long since the last chunk, so motion stays smooth between chunks. */
  get time(): number {
    return this.analyzer.time + Math.min(0.05, (performance.now() - this.lastChunkAt) / 1000);
  }

  /** Also send the input audio to `node` (e.g. a recorder); it isn't played to the speakers. */
  connect(node: AudioNode): void {
    this.source.connect(node);
  }

  stop(): void {
    this.source.disconnect();
    this.node.port.onmessage = null;
    this.node.disconnect();
    for (const t of this.stream.getTracks()) t.stop();
  }
}
