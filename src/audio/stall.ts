/** No input for this long means the OS has paused capture (e.g. iOS while another app plays audio). */
export const STALL_GRACE_MS = 250;
/** Longer gaps (a backgrounded tab) jump the clock instead of analysing minutes of silence. */
export const MAX_FILL_SECONDS = 2;

/** Samples of silence to feed so the analyser clock keeps pace with the wall clock during a stall. */
export function silenceToFill(nowMs: number, lastFedMs: number, sampleRate: number, graceMs: number = STALL_GRACE_MS): number {
  const gap = nowMs - lastFedMs;
  if (gap <= graceMs || gap <= 0) return 0;
  return Math.round(Math.min(gap / 1000, MAX_FILL_SECONDS) * sampleRate);
}
