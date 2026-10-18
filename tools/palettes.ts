/** Renders every palette as a horizontal strip (t = 0..1) to out/palettes.png for eyeballing. */
import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { linearStops, PALETTES, samplePalette } from "../src/render/palettes.ts";

const W = 600;
const ROW = 32;
const H = ROW * PALETTES.length;
const px = new Uint8Array(W * H * 3);
PALETTES.forEach((p, row) => {
  const stops = linearStops(p);
  for (let x = 0; x < W; x++) {
    const rgb = samplePalette(stops, x / W);
    for (let y = row * ROW; y < (row + 1) * ROW - 2; y++) for (let k = 0; k < 3; k++) px[(y * W + x) * 3 + k] = Math.round(255 * Math.min(1, rgb[k]) ** (1 / 2.2));
  }
});
mkdirSync("out", { recursive: true });
spawnSync("ffmpeg", ["-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", `${W}x${H}`, "-i", "-", "out/palettes.png"], { input: px });
console.log(`out/palettes.png: ${PALETTES.map((p) => p.name).join(", ")}`);
