/**
 * Four-stop cyclic gradients, dark → vivid → highlight, so scenes glow against black.
 * Shaders call `palette(t)`; t wraps, and stop 3 blends back into stop 0.
 * Edit the hex values here to make your own; `node tools/palettes.ts` previews them.
 */
export interface Palette {
  name: string;
  stops: [string, string, string, string];
  /** Skip this palette when "new palette each section" cycles. */
  manualOnly?: boolean;
}

export const PALETTES: Palette[] = [
  { name: "Ember", stops: ["#1c0503", "#b3240b", "#ff7a1a", "#ffd28a"] },
  { name: "Abyss", stops: ["#020814", "#0b3c78", "#12a3c9", "#c9f4ff"] },
  { name: "Synthwave", stops: ["#14002e", "#7a12c4", "#ff2fa0", "#ffb347"] },
  { name: "Aurora", stops: ["#03140f", "#0c7a5a", "#3ff2b0", "#8a5cff"] },
  { name: "Neon", stops: ["#07010f", "#ff006e", "#8338ec", "#3a86ff"] },
  { name: "Gold", stops: ["#120a02", "#7a4a0f", "#e0a838", "#fff1c4"] },
  { name: "Ice", stops: ["#01030a", "#1d3b6e", "#7fb6ff", "#eef7ff"], manualOnly: true },
  { name: "Blood Moon", stops: ["#0b0000", "#5c0010", "#e0003a", "#ff9e7a"] },
  { name: "Acid", stops: ["#020a00", "#2bd60f", "#00d9f0", "#f000d0"] },
  { name: "Mono", stops: ["#000000", "#3a3a3a", "#a8a8a8", "#ffffff"], manualOnly: true },
];

export type Rgb = [number, number, number];

/** sRGB hex → linear RGB, since shaders light and blend in linear space. */
export function hexToLinear(hex: string): Rgb {
  const n = Number.parseInt(hex.replace("#", ""), 16);
  const channel = (v: number): number => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return [channel((n >> 16) & 255), channel((n >> 8) & 255), channel(n & 255)];
}

export function paletteByName(name: string): Palette {
  return PALETTES.find((p) => p.name === name) ?? PALETTES[0];
}

/** Palette for the n-th section when cycling: starts at `name`, then walks the cycle-eligible list. */
export function paletteForSection(name: string, n: number): Palette {
  const cycle = PALETTES.filter((p) => !p.manualOnly);
  const start = cycle.findIndex((p) => p.name === name);
  if (start >= 0) return cycle[(start + n) % cycle.length];
  return n === 0 ? paletteByName(name) : cycle[(n - 1) % cycle.length];
}

export function linearStops(p: Palette): [Rgb, Rgb, Rgb, Rgb] {
  return p.stops.map(hexToLinear) as [Rgb, Rgb, Rgb, Rgb];
}

export function mixStops(a: Rgb[], b: Rgb[], t: number): [Rgb, Rgb, Rgb, Rgb] {
  return a.map((x, i) => [x[0] + (b[i][0] - x[0]) * t, x[1] + (b[i][1] - x[1]) * t, x[2] + (b[i][2] - x[2]) * t]) as [Rgb, Rgb, Rgb, Rgb];
}

/** CPU mirror of the shader's palette(t), for previews and tests. */
export function samplePalette(stops: Rgb[], t: number): Rgb {
  const x = (((t % 1) + 1) % 1) * 4;
  const i = Math.floor(x) % 4;
  const f = x - Math.floor(x);
  const s = f * f * (3 - 2 * f);
  const a = stops[i];
  const b = stops[(i + 1) % 4];
  return [a[0] + (b[0] - a[0]) * s, a[1] + (b[1] - a[1]) * s, a[2] + (b[2] - a[2]) * s];
}
