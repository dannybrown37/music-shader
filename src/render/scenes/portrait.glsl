// Portrait: the whole song as one ring, drawn by a pen as it plays.
// Angle = time (clockwise from twelve o'clock), radius = frequency (bass inside), outline = intensity,
// colour = the cast member playing. Kicks and snares ring the inside, the melody orbits outside,
// build-ups glow toward each drop and drops fire rays. See render/portrait.ts for the data layout.
uniform sampler2D uSong;
uniform float uReveal;      // 0..1 of the song drawn so far
uniform float p_rings, p_glow, p_rays, p_melody, p_hits;

const float COLS = 720.0;
const float R0 = 0.33;      // inner edge of the spectrum; the title sits inside
const float SPAN = 0.42;    // spectrum depth at full intensity
const float MEL_R = 0.8;    // melody orbit, low → high outward
const float MEL_SPAN = 0.09;
const int ROW_LEVELS = 64, ROW_HITS = 65, ROW_MARKS = 66, ROW_CAST0 = 67, ROW_CAST1 = 68;

vec4 fetchCol(int c, int row) { return texelFetch(uSong, ivec2(clamp(c, 0, int(COLS) - 1), row), 0); }

// Linear between columns.
vec4 song(float col, int row) {
  float c = clamp(col, 0.0, COLS - 1.0);
  int i = int(floor(c));
  return mix(fetchCol(i, row), fetchCol(i + 1, row), fract(c));
}

vec3 castColor(float col, vec3 fallback) {
  vec4 a = song(col, ROW_CAST0), b = song(col, ROW_CAST1);
  float w = a.x + a.y + a.z + a.w + b.x + b.y;
  if (uCastCount < 0.5 || w < 1e-3) return fallback;
  vec3 c = uCastColor[0] * a.x + uCastColor[1] * a.y + uCastColor[2] * a.z + uCastColor[3] * a.w + uCastColor[4] * b.x + uCastColor[5] * b.y;
  return mix(fallback, c / w, uCastMix * min(1.0, w * 1.5));
}

float melodyRadius(float col) { return MEL_R + MEL_SPAN * song(col, ROW_LEVELS).w; }

void main() {
  vec2 uv = centeredUv();
  float r = length(uv);
  float u = fract(atan(uv.x, uv.y) / TAU);
  float colF = u * COLS;
  float col = colF - 0.5;
  float px = 2.0 / uResolution.y;
  // Arc length of one column at this radius, for keeping lines a constant width.
  float colArc = TAU * max(r, 0.05) / COLS;

  vec4 levels = song(col, ROW_LEVELS);
  vec4 hits = song(col, ROW_HITS);
  vec4 marks = fetchCol(int(colF), ROW_MARKS);
  float intensity = levels.x;
  vec3 voice = castColor(col, ramp(0.55));
  vec3 c = vec3(0.0);

  // The spectrum: one filament per mel band, the outline breathing with the song's intensity.
  float reach = SPAN * (0.4 + 0.6 * intensity);
  float x = (r - R0) / reach;
  if (x > 0.0 && x < 1.0) {
    float bf = x * 63.0;
    int b = int(floor(bf));
    vec2 v0 = song(col, b).xy, v1 = song(col, min(b + 1, 63)).xy;
    vec2 v = mix(v0, v1, fract(bf));
    float ridge = 0.5 + 0.5 * cos(bf * TAU);
    ridge = 0.25 + 0.75 * ridge * ridge;
    float fade = smoothstep(1.0, 0.8, x) * smoothstep(0.0, 0.04, x);
    float e = pow(v.x, 1.7) * ridge * fade;
    float gap = 1.0 - 0.75 * marks.w;
    c += voice * e * 1.1 * p_rings * gap;
    c += mix(voice, vec3(1.0), 0.5) * pow(v.y, 8.0) * ridge * fade * 0.35 * p_rings * gap;
  }
  float outline = r - (R0 + reach);
  c += voice * exp(-abs(outline) / (px * 1.5)) * (0.15 + 0.7 * intensity) * p_glow;
  c += voice * exp(-max(outline, 0.0) * 30.0) * step(0.0, outline) * 0.05 * intensity * p_glow;

  // Drums: kicks as a warm inner ring, snares a thinner one inside it.
  float kick = hits.x, snare = hits.y;
  c += ramp(0.75) * smoothstep(0.004 + 0.012 * kick, 0.0, abs(r - (R0 - 0.035))) * kick * 1.2 * p_hits;
  c += ramp(0.95) * smoothstep(0.002 + 0.007 * snare, 0.0, abs(r - (R0 - 0.065))) * snare * 0.9 * p_hits;

  // Hats: a dust of sparks just outside the spectrum's furthest reach.
  vec2 g = vec2(colF * 0.5, r * 260.0);
  float spark = step(1.0 - 0.6 * hits.z, hash12(floor(g))) * smoothstep(0.45, 0.0, length(fract(g) - 0.5));
  c += vec3(0.85, 0.92, 1.0) * spark * smoothstep(0.012, 0.0, abs(r - (R0 + SPAN + 0.02))) * 0.6 * p_hits;

  // Melody: the tune orbiting outside, its radius its pitch, lit where a line stands out.
  float rm = melodyRadius(col);
  float slope = (melodyRadius(col + 1.0) - rm) / colArc;
  float dm = abs(r - rm) / sqrt(1.0 + slope * slope);
  float line = exp(-dm / (px * 1.2)) + 0.25 * exp(-dm / (px * 6.0));
  // Held notes draw bright, the leaps between them faintly, so the tune reads as an orbit, not spikes.
  float held = mix(0.08, 1.0, 1.0 / (1.0 + slope * slope * 4.0));
  c += mix(voice, vec3(1.0), 0.35) * line * held * smoothstep(0.1, 0.45, levels.z) * 1.4 * p_melody;

  // Build-ups: a glow that swells along the rim toward each drop.
  float rb = MEL_R + MEL_SPAN + 0.035;
  c += ramp(0.85) * levels.y * levels.y * exp(-abs(r - rb) / (0.004 + 0.02 * levels.y)) * 0.8 * p_rays;

  // Drops: rays fired outward from the spectrum, a few columns wide.
  for (int k = -3; k <= 3; k++) {
    float s = fetchCol(int(colF) + k, ROW_MARKS).z;
    if (s <= 0.0) continue;
    float d = abs(float(k) + 0.5 - fract(colF)) * colArc;
    float along = smoothstep(R0, R0 + 0.1, r) * smoothstep(0.97 + 0.03 * s, MEL_R - 0.05, r);
    c += vec3(1.0, 0.9, 0.7) * exp(-d / (px * (1.0 + 2.0 * s))) * along * s * 2.0 * p_rays;
    c += ramp(0.9) * exp(-length(vec2(d, r - (rb + 0.03))) / 0.012) * s * 1.5 * p_rays;
  }

  // Sections: a tick outside the ring.
  c += vec3(0.8) * marks.w * smoothstep(0.012, 0.0, abs(r - (rb + 0.065))) * 0.6;

  // Not drawn yet: a faint ghost of what's to come.
  float drawn = step(u, uReveal);
  float ghost = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = mix(vec3(ghost) * 0.05, c, drawn);

  // The pen: a bright radius at the playhead, pulsing with the kick.
  if (uReveal > 0.0 && uReveal < 1.0) {
    float pa = uReveal * TAU;
    vec2 dir = vec2(sin(pa), cos(pa));
    float along = dot(uv, dir);
    float dp = length(uv - dir * clamp(along, R0 - 0.08, 0.97));
    c += ramp(0.95) * (exp(-dp / (px * 1.5)) * 0.8 + exp(-dp / 0.02) * 0.15) * (0.6 + uKick);
    vec2 tip = dir * melodyRadius(uReveal * COLS - 0.5);
    c += mix(voice, vec3(1.0), 0.5) * exp(-length(uv - tip) / 0.012) * (0.5 + 1.5 * uMelody);
  }

  // Background: dark, faintly tinted, with a hush in the centre for the title.
  c += uPal1 * 0.02 * smoothstep(1.4, 0.2, r);
  c *= smoothstep(R0 - 0.11, R0 - 0.085, r) * 0.9 + 0.1;
  c += ramp(0.5) * exp(-abs(r - (R0 - 0.1)) / px) * 0.15;
  fragColor = vec4(c, 1.0);
}
