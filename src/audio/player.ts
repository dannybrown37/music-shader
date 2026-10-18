/** Plays a decoded AudioBuffer and reports the song position that is audible right now. */
export class Player {
  readonly ctx: AudioContext;
  readonly output: GainNode;
  buffer: AudioBuffer | null = null;
  private source: AudioBufferSourceNode | null = null;
  /** ctx.currentTime at which song position 0 would have played. */
  private origin = 0;
  private pausedAt = 0;
  playing = false;
  onEnded: (() => void) | null = null;

  constructor() {
    this.ctx = new AudioContext({ latencyHint: "playback" });
    this.output = this.ctx.createGain();
    this.output.connect(this.ctx.destination);
  }

  async decode(data: ArrayBuffer): Promise<AudioBuffer> {
    return this.ctx.decodeAudioData(data);
  }

  setBuffer(buffer: AudioBuffer): void {
    this.stop();
    this.buffer = buffer;
    this.pausedAt = 0;
  }

  get duration(): number {
    return this.buffer?.duration ?? 0;
  }

  /**
   * Song time of the sample reaching the speakers now. Uses getOutputTimestamp so the visuals
   * line up with what you hear even on high-latency outputs like Bluetooth headphones.
   */
  get time(): number {
    if (!this.playing) return this.pausedAt;
    const ts = this.ctx.getOutputTimestamp?.();
    let audible = this.ctx.currentTime - (this.ctx.outputLatency || 0);
    if (ts && ts.contextTime !== undefined && ts.performanceTime !== undefined && ts.performanceTime > 0) {
      audible = ts.contextTime + (performance.now() - ts.performanceTime) / 1000;
    }
    return Math.max(0, Math.min(this.duration, audible - this.origin));
  }

  async play(): Promise<void> {
    if (!this.buffer || this.playing) return;
    if (this.ctx.state !== "running") await this.ctx.resume();
    const source = this.ctx.createBufferSource();
    source.buffer = this.buffer;
    source.connect(this.output);
    const offset = Math.min(this.pausedAt, this.buffer.duration - 0.01);
    source.start(0, offset);
    this.origin = this.ctx.currentTime - offset;
    source.onended = () => {
      if (this.source !== source) return;
      this.playing = false;
      this.source = null;
      this.pausedAt = this.duration;
      this.onEnded?.();
    };
    this.source = source;
    this.playing = true;
  }

  pause(): void {
    if (!this.playing) return;
    this.pausedAt = this.time;
    this.stop();
  }

  async toggle(): Promise<void> {
    if (this.playing) this.pause();
    else {
      if (this.pausedAt >= this.duration - 0.05) this.pausedAt = 0;
      await this.play();
    }
  }

  async seek(t: number): Promise<void> {
    const wasPlaying = this.playing;
    this.stop();
    this.pausedAt = Math.max(0, Math.min(this.duration, t));
    if (wasPlaying) await this.play();
  }

  private stop(): void {
    const s = this.source;
    this.source = null;
    this.playing = false;
    if (s) {
      s.onended = null;
      s.stop();
      s.disconnect();
    }
  }
}
