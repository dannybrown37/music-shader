// Tessellate: the whole plane tiled by one shape that keeps changing. The tiles are the Voronoi cells
// of a lattice carrying two point pairs per cell, one on each colour of a checkerboard. Pairs close
// together give diamonds, pulled apart Cairo pentagons, then long hexagons; turned toward each other
// they make yet other tilings. Timbre picks the shape (bright → pairs apart, noisy → edges bend into
// interlocking curves, the third axis leans the lattice from square toward hexagonal). Every snare
// turns the pairs a notch and every kick pushes them apart, so the shape steps with the rhythm.
// Each tile fills with nested outlines as its frequency band gets louder (bass at the centre),
// kicks roll waves of lit tiles outward, notes light the tiles of their pitch, hats glint at the
// corners, and each section brings a new lattice.

uniform float p_scale;
uniform float p_morph;
uniform float p_snap;
uniform float p_edges;
uniform float p_insets;
uniform float p_waves;
uniform float p_notes;
uniform float p_glints;
uniform float p_layout;

const float WAVE_LIFE = 1.6;
const float NOTE_LIFE = 1.2;
const float INSET_SPACING = 0.05;
// Above 1/TAU the bend folds the plane over itself and tiles overlap.
const float MAX_BEND = 0.14;

mat2 gLattice;
vec2 gPairA, gPairB;

vec2 site(vec2 cell, int k) {
  vec2 half_ = k < 2 ? gPairA : gPairB;
  vec2 base = k < 2 ? vec2(0.0) : vec2(0.5);
  return gLattice * (cell + base + ((k == 0 || k == 2) ? half_ : -half_));
}

void main() {
  vec2 uv = centeredUv() + uShake;
  float t = uFlow * 0.15;
  vec2 look = hash22(vec2(uSeed, 9.3));

  float density = 2.4 / p_scale * (1.0 + 0.35 * (look.x - 0.5) * p_layout) * (1.0 - 0.06 * uKick);
  mat2 spin = rot(t * 0.12 + (look.y - 0.5) * p_layout);
  vec2 w = spin * uv * density + vec2(t * 0.6, t * 0.23);

  float lean = clamp(look.x * p_layout * 0.7 + 0.35 * p_morph * uTimbreSlow.z, 0.0, 1.0);
  float theta = mix(PI * 0.5, PI / 3.0, lean);
  gLattice = mat2(1.0, 0.0, cos(theta), sin(theta));

  float snareEase = uSnareHist[0].x < 0.0 ? 1.0 : smoothstep(0.0, 0.18, uSnareHist[0].x);
  float phi = look.y * PI * 0.5 * p_layout + p_snap * PI / 8.0 * (max(uCount.y - 1.0, 0.0) + snareEase);
  float sep = clamp(0.12 + 0.09 * p_morph * uTimbreSlow.x + 0.03 * sin(t * 0.4) + 0.025 * p_snap * uKick, 0.02, 0.22);
  gPairA = sep * vec2(cos(phi), sin(phi));
  gPairB = sep * vec2(cos(PI * 0.5 - phi), sin(PI * 0.5 - phi));

  // The bend is periodic in the lattice, so every tile stays the same shape (Escher-style).
  vec2 q = inverse(gLattice) * w;
  float bend = min(0.12 * clamp(0.5 + 0.6 * uTimbreSlow.y, 0.0, 1.0) * p_morph, MAX_BEND);
  q += bend * vec2(sin(TAU * q.y + t), sin(TAU * q.x - t * 0.7));
  vec2 P = gLattice * q;

  vec2 cell = floor(q);
  float md = 1e9;
  vec2 mr = vec2(0.0), mc = vec2(0.0);
  float mk = 0.0;
  for (int j = -1; j <= 1; j++)
    for (int i = -1; i <= 1; i++)
      for (int k = 0; k < 4; k++) {
        vec2 c = cell + vec2(i, j);
        vec2 r = site(c, k) - P;
        float d = dot(r, r);
        if (d < md) { md = d; mr = r; mc = c; mk = float(k); }
      }

  // Distance to the nearest and second-nearest tile edge (both small only at a corner).
  float edge = 1e9, edge2 = 1e9;
  for (int j = -1; j <= 1; j++)
    for (int i = -1; i <= 1; i++)
      for (int k = 0; k < 4; k++) {
        vec2 r = site(mc + vec2(i, j), k) - P;
        vec2 d = r - mr;
        if (dot(d, d) < 1e-6) continue;
        float e = dot(0.5 * (mr + r), normalize(d));
        if (e < edge) { edge2 = edge; edge = e; } else edge2 = min(edge2, e);
      }

  float h = hash12(mc * vec2(1.37, 2.11) + mk * 5.3 + 0.1);
  vec2 centre = uv + transpose(spin) * mr / density;
  float rt = length(centre);
  float band = clamp(rt / 1.6, 0.0, 1.0);
  float spec = spectrum(band);

  float waves = 0.0;
  for (int i = 0; i < 8; i++) {
    vec2 k = uKickHist[i];
    if (k.x < 0.0 || k.x > WAVE_LIFE) continue;
    float x = rt - k.x * 1.3;
    waves += exp(-x * x / 0.02) * k.y * exp(-k.x * 1.8);
  }
  float pitch = floor(h * 12.0);
  float notes = 0.0;
  for (int i = 0; i < 8; i++) {
    vec2 n = uNoteHist[i];
    if (n.x < 0.0 || n.x > NOTE_LIFE || abs(uNotePitch[i] - pitch) > 0.5) continue;
    notes += n.y * exp(-n.x * 3.5);
  }
  float lit = waves * p_waves + notes * p_notes;

  float fw = fwidth(edge) + 1e-4;
  float gap = 0.025 + 0.03 * uKick;
  float inside = edge - gap;
  float face = smoothstep(0.0, fw, inside);
  vec3 tint = palette(h * 0.22 + band * 0.35 + t * 0.03);
  float energy = 0.25 + 0.75 * uLoud;

  float spec2 = spec * spec;
  vec3 col = tint * face * (0.01 + 0.06 * spec2) * energy;
  col += mix(tint, ramp(0.9), 0.3) * face * lit * 0.3;

  // Nested outlines crawl inward on the beat; a louder band reaches deeper into its tile.
  float x = inside / INSET_SPACING - uBeatPhase;
  float dl = abs(fract(x + 0.5) - 0.5) * INSET_SPACING;
  float insetLine = smoothstep(0.005 + fw, 0.005, dl) * face;
  float reach = (0.03 + 0.12 * spec2) * min(p_insets, 1.0) + 0.1 * lit;
  float insetMask = smoothstep(reach, reach - 0.02, inside);
  col += mix(tint, ramp(0.85), 0.4) * insetLine * insetMask * (0.06 + 0.5 * spec2 + 0.4 * uDownbeat + 1.0 * lit) * p_insets * energy;

  float rimLine = smoothstep(0.008 + fw, 0.003, abs(inside - 0.006));
  float glow = exp(-abs(inside) * 35.0);
  col += mix(tint, ramp(0.95), 0.6) * (rimLine * (0.2 + 0.9 * uSnare + 0.8 * lit) + glow * 0.1 * (uMid + uSnare)) * p_edges * energy;

  float corner = exp(-(edge + edge2) * 40.0);
  float twinkle = step(0.55, hash11(h * 97.0 + uCount.z * 1.7));
  col += ramp(1.0) * corner * (2.0 * uHat * twinkle + 0.1 * uHigh) * p_glints;

  col *= 1.0 + 0.3 * uSection + 0.15 * uOnset;
  fragColor = vec4(col, 1.0);
}
