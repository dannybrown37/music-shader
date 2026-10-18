/** Title card drawn to a 2D canvas, uploaded as a texture, and composited by the shader so exports include it. */

const FADE_IN = [0.6, 1.8];
const FADE_OUT = [6.5, 8.5];

export function titleAlpha(t: number): number {
  const smooth = (a: number, b: number, x: number): number => {
    const k = Math.min(1, Math.max(0, (x - a) / (b - a)));
    return k * k * (3 - 2 * k);
  };
  return smooth(FADE_IN[0], FADE_IN[1], t) * (1 - smooth(FADE_OUT[0], FADE_OUT[1], t));
}

export function drawTitleCard(width: number, height: number, title: string, subtitle: string): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx || (!title && !subtitle)) return canvas;
  const unit = height / 1080;
  const x = 96 * unit;
  const y = height - 120 * unit;
  ctx.shadowColor = "rgba(0,0,0,0.65)";
  ctx.shadowBlur = 24 * unit;
  ctx.fillStyle = "rgba(255,255,255,0.96)";
  ctx.textBaseline = "alphabetic";
  ctx.font = `300 ${Math.round(72 * unit)}px "Inter", "Segoe UI", "Helvetica Neue", sans-serif`;
  ctx.letterSpacing = `${Math.round(6 * unit)}px`;
  ctx.fillText(title.toUpperCase(), x, y);
  ctx.font = `400 ${Math.round(26 * unit)}px "Inter", "Segoe UI", "Helvetica Neue", sans-serif`;
  ctx.letterSpacing = `${Math.round(10 * unit)}px`;
  ctx.fillStyle = "rgba(255,255,255,0.7)";
  ctx.fillText(subtitle.toUpperCase(), x + 4 * unit, y + 52 * unit);
  ctx.fillRect(x + 4 * unit, y - 104 * unit, 64 * unit, 3 * unit);
  return canvas;
}
