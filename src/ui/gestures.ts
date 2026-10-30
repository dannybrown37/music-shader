export type Gesture = "tap" | "next" | "prev" | "none";

const TAP_MOVE = 12;
const TAP_MS = 400;
const SWIPE_MIN = 60;
const SWIPE_MS = 700;

/** A finished pointer stroke on the visuals: tap toggles the controls, horizontal swipes change scene. */
export function classifyGesture(g: { dx: number; dy: number; ms: number }): Gesture {
  const ax = Math.abs(g.dx);
  const ay = Math.abs(g.dy);
  if (ax < TAP_MOVE && ay < TAP_MOVE) return g.ms < TAP_MS ? "tap" : "none";
  if (g.ms > SWIPE_MS || ax < SWIPE_MIN || ax < ay * 1.5) return "none";
  return g.dx < 0 ? "next" : "prev";
}

/** The scene `step` places away from `current` in `ids`, wrapping; an unknown current counts as the first. */
export function stepScene(ids: string[], current: string, step: number): string {
  const i = Math.max(0, ids.indexOf(current));
  return ids[(((i + step) % ids.length) + ids.length) % ids.length];
}

export type Source ="mic" | "file" | "tab";

/** Tab capture only exists in desktop browsers; phones advertise getDisplayMedia but can't share audio. */
export function availableSources(caps: { mic: boolean; display: boolean; coarse: boolean }): Source[] {
  const out: Source[] = [];
  if (caps.mic) out.push("mic");
  out.push("file");
  if (caps.display && !caps.coarse) out.push("tab");
  return out;
}
