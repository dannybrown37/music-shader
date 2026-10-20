/** Intros and outros are often sparse, and a big ending is usually a fade or a hit, not a scene. */
const SEARCH_FROM = 0.15;
const SEARCH_TO = 0.85;
const FLAT_FALLBACK = 0.4;

/**
 * Seconds into the song where a still best sells it: the most intense moment (slow intensity,
 * with loudness to break ties) between 15% and 85% of the way through.
 */
export function thumbnailTime(intensity: Float32Array, loudness: Float32Array, fps: number): number {
  const n = intensity.length;
  const lo = Math.floor(n * SEARCH_FROM);
  const hi = Math.ceil(n * SEARCH_TO);
  let best = -1;
  let bestScore = -Infinity;
  for (let i = lo; i < hi; i++) {
    const score = intensity[i] + 0.3 * loudness[i];
    if (score > bestScore + 1e-6) {
      bestScore = score;
      best = i;
    }
  }
  const flat = best < 0 || bestScore <= intensity[lo] + 0.3 * loudness[lo] + 1e-6;
  if (flat) return (n * FLAT_FALLBACK) / fps;
  let end = best;
  while (end + 1 < hi && intensity[end + 1] + 0.3 * loudness[end + 1] >= bestScore - 1e-6) end++;
  return (best + end) / 2 / fps;
}
