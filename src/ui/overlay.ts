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

/** One lyric line, centred above the title card's spot, wrapped to at most two lines. */
export function drawLyric(width: number, height: number, text: string): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx || !text) return canvas;
  const unit = height / 1080;
  const size = Math.round(54 * unit);
  ctx.font = `500 ${size}px "Inter", "Segoe UI", "Helvetica Neue", sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.shadowColor = "rgba(0,0,0,0.8)";
  ctx.shadowBlur = 18 * unit;
  ctx.fillStyle = "rgba(255,255,255,0.97)";
  const lines = wrap(ctx, text, width * 0.8).slice(0, 2);
  const bottom = height - 270 * unit;
  lines.forEach((line, i) => ctx.fillText(line, width / 2, bottom - (lines.length - 1 - i) * size * 1.25));
  return canvas;
}

function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/)) {
    const next = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(next).width > maxWidth) {
      lines.push(line);
      line = word;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines;
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
