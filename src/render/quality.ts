/**
 * Dynamic resolution: if frames stay slow, render the scene at a lower scale; when there's
 * headroom again, climb back to the user's chosen maximum. Only the live view uses it;
 * exports always render at full size.
 */

const SLOW_FRAME = 0.024;
/** A 60 Hz display caps frames at ~16.7 ms, so anything at or under vsync counts as fast. */
const FAST_FRAME = 0.0185;
const SLOW_HOLD = 1.5;
const FAST_HOLD = 4;
/** After a scale proves too slow, don't try it again for this long (avoids visible see-sawing). */
const RETRY_AFTER = 30;
const MIN_SCALE = 0.35;
const STEP_DOWN = 0.1;
const STEP_UP = 0.05;

export class QualityGovernor {
  scale: number;
  private ema = 1 / 60;
  private slowFor = 0;
  private fastFor = 0;
  private elapsed = 0;
  private tooSlowAt = Infinity;
  private retryAt = 0;

  constructor(maxScale: number) {
    this.scale = maxScale;
  }

  /** Feed the last frame's duration; returns the scale to render at. */
  update(frameSeconds: number, maxScale: number): number {
    this.elapsed += frameSeconds;
    this.ema += (Math.min(frameSeconds, 0.25) - this.ema) * 0.1;
    this.slowFor = this.ema > SLOW_FRAME ? this.slowFor + frameSeconds : 0;
    this.fastFor = this.ema < FAST_FRAME ? this.fastFor + frameSeconds : 0;
    if (this.slowFor > SLOW_HOLD) {
      this.tooSlowAt = this.scale;
      this.retryAt = this.elapsed + RETRY_AFTER;
      this.scale = Math.max(MIN_SCALE, this.scale - STEP_DOWN);
      this.slowFor = 0;
      this.ema = (SLOW_FRAME + FAST_FRAME) / 2;
    } else if (this.fastFor > FAST_HOLD && this.scale < maxScale) {
      const next = this.scale + STEP_UP;
      if (next < this.tooSlowAt - 1e-6 || this.elapsed >= this.retryAt) this.scale = next;
      this.fastFor = 0;
    }
    this.scale = Math.round(Math.min(this.scale, maxScale) * 100) / 100;
    return this.scale;
  }
}
