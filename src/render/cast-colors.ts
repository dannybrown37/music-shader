/**
 * One colour per cast member, fixed for the whole song and the same in every scene, palette,
 * the HUD, the timeline and the poster. Warm → cool follows the sound's brightness, so a dark
 * pad glows ember and a bright lead glows blue. Not tied to the palette on purpose: palettes
 * change per section, the cast shouldn't.
 */
export const CAST_HEX = ["#ff4a3d", "#ff9f1c", "#c6f432", "#2de2b0", "#3aa8ff", "#a46bff"];

/** Which of the six colours a cast of k members uses, spread for contrast. */
const SPREAD: Record<number, number[]> = {
  1: [1],
  2: [0, 4],
  3: [0, 2, 4],
  4: [0, 1, 3, 5],
  5: [0, 1, 2, 4, 5],
  6: [0, 1, 2, 3, 4, 5],
};

export function castHex(members: readonly { brightness: number }[]): string[] {
  const slots = SPREAD[members.length] ?? [];
  const order = members.map((m, i) => ({ i, b: m.brightness })).sort((a, b) => a.b - b.b || a.i - b.i);
  const out = new Array<string>(members.length);
  order.forEach(({ i }, rank) => (out[i] = CAST_HEX[slots[rank]]));
  return out;
}
