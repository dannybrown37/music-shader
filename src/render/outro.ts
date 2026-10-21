/**
 * The Portrait outro: the song's last seconds crossfade into its Portrait, whose pen sweeps the
 * whole song again as a recap, then the title and cast fade in.
 *
 *   end − seconds        +FADE                     +FADE + 0.65·seconds          end
 *   │ scene ⇢ portrait  │ pen sweeps 0 → 100%       │ title & cast in, hold        │
 */
const FADE = 2;
const SWEEP = 0.65;

export interface Outro {
  /** Weight of the Portrait over the playing scene, 0..1. */
  mix: number;
  /** How much of the ring the pen has drawn, 0..1. */
  reveal: number;
  /** Opacity of the poster text. */
  text: number;
}

const smooth = (x: number): number => {
  const k = Math.min(1, Math.max(0, x));
  return k * k * (3 - 2 * k);
};

export function outroAt(t: number, duration: number, seconds: number): Outro {
  if (seconds <= 0 || duration < 3 * seconds) return { mix: 0, reveal: 0, text: 0 };
  const x = t - (duration - seconds);
  if (x <= 0) return { mix: 0, reveal: 0, text: 0 };
  const sweep = SWEEP * seconds;
  return {
    mix: smooth(x / FADE),
    reveal: Math.min(1, Math.max(0, (x - FADE) / sweep)),
    text: smooth((x - FADE - 0.85 * sweep) / (0.15 * sweep)),
  };
}
