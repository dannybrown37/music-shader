// Nebula: domain-warped smoke. The spectrum runs outward from the core (bass in the
// middle, highs at the rim) and quiet passages thin the smoke to wisps. Kicks send
// shockwaves out from the core, so the beat stays visible as ripples. Snares fire
// refracting rings, notes flare on a clock face by pitch, hats scatter sparkles.
// Each section turns the drift a new way.

uniform float p_scale;
uniform float p_warp;
uniform float p_rings;
uniform float p_stars;
uniform float p_glow;
uniform float p_filaments;
uniform float p_hueSpread;
uniform float p_shock;
uniform float p_notes;
uniform float p_layout;

const float SHOCK_SPEED = 0.9;
const float SHOCK_LIFE = 2.0;
const float NOTE_RADIUS = 0.62;

float field(vec2 p, float t, out vec2 q, out vec2 r) {
  int oct = 4 + int(uBright * 3.0);
  vec2 tw = uTimbre.xy * 1.2;
  float warp = p_warp + uBass * 1.2;
  q = vec2(fbm(p + 0.10 * t + uSeed, oct), fbm(p + vec2(5.2, 1.3) - 0.12 * t, oct));
  r = vec2(fbm(p + warp * q + vec2(1.7, 9.2) + tw + 0.15 * t, oct), fbm(p + warp * q + vec2(8.3, 2.8) - tw + 0.126 * t, oct));
  return fbm(p + (warp + uLowMid) * 1.4 * r + uTimbre.z * 0.7, oct);
}

// Each snare gets its own epicentre so consecutive hits don't stack into a target.
vec2 snareCenter(float index) {
  return (hash22(vec2(index, 7.7)) - 0.5) * vec2(0.9, 0.6);
}

void main() {
  vec2 uv = centeredUv() + uShake;
  float t = uFlow * 0.25;
  float rr = length(uv);
  float spin = mix(1.0, hash11(uSeed * 2.3) < 0.5 ? -1.0 : 1.0, step(0.5, p_layout));
  vec2 drift = (hash22(vec2(uSeed, 1.7)) - 0.5) * p_layout;

  vec2 p = uv * (1.0 - 0.16 * uKick);
  float shockGlow = 0.0;
  for (int i = 0; i < 8; i++) {
    vec2 k = uKickHist[i];
    if (k.x < 0.0 || k.x > SHOCK_LIFE) continue;
    float x = rr - (0.05 + k.x * SHOCK_SPEED);
    float w = 0.015 + k.x * 0.025;
    float ring = exp(-x * x / (w * w)) * k.y * exp(-k.x * 2.2);
    p += normalize(uv + 1e-5) * ring * 0.1 * p_shock;
    shockGlow += ring;
  }
  float ringGlow = 0.0;
  for (int i = 0; i < 8; i++) {
    vec2 h = uSnareHist[i];
    if (h.x < 0.0 || h.x > 1.6) continue;
    vec2 c = snareCenter(uCount.y - float(i));
    vec2 d = uv - c;
    float radius = h.x * 1.4;
    float w = 0.015 + h.x * 0.05;
    float x = length(d) - radius;
    float ring = exp(-x * x / (w * w)) * h.y * exp(-h.x * 3.0);
    p += normalize(d + 1e-5) * ring * 0.12 * p_rings;
    ringGlow += ring;
  }
  p = rot(spin * t * 0.12 + uTimbre.y * 0.6) * p;

  vec2 q, r;
  float f = field(p * p_scale + drift * t, t, q, r);

  // Cubic shaping keeps most of the frame dark so the bright folds read as structure.
  // Quiet passages raise the threshold, so the smoke thins out and thickens back when the music swells.
  float shape = f * f * f + 0.6 * f * f + 0.5 * f;
  float density = smoothstep(0.25 + 0.35 * (1.0 - uLoud), 1.15, shape);
  float specR = spectrum(clamp(rr / 1.5, 0.0, 1.0));
  float energy = (0.2 + 0.5 * uLoud + 0.2 * uHarm) * (0.35 + 1.3 * specR);
  // Lightness follows density along the palette ramp; hue variety comes from the warp field.
  float tone = 0.45 * length(q) + 0.25 * r.x + 0.15 * uTimbre.x;
  vec3 col = mix(ramp(density * 0.8), palette(tone), p_hueSpread * (1.0 - density)) * density * density * energy * 1.6;

  float vein = exp(-abs(r.x - r.y) * mix(70.0, 18.0, uBright));
  col += ramp(0.75 + 0.25 * uHigh) * vein * density * p_filaments * (0.25 + 1.6 * uHigh + 1.2 * uNoisy * uPerc);

  float core = exp(-length(uv) * (3.5 - uSub));
  col += ramp(0.6) * core * (uKick * 1.4 + uBass * 0.25) * p_glow;
  col += ramp(0.85) * ringGlow * 1.2 * p_rings;
  // The wavefront lights the smoke it passes through; in empty space it is only a faint line.
  col += ramp(0.9) * shockGlow * p_shock * (0.08 + 1.4 * density);

  // Notes flare on a clock face: C at twelve o'clock, then clockwise by semitone.
  for (int i = 0; i < 8; i++) {
    vec2 n = uNoteHist[i];
    if (n.x < 0.0 || n.x > 1.5) continue;
    float pc = uNotePitch[i] >= 0.0 ? uNotePitch[i] : floor(hash11(uNoteCount - float(i)) * 12.0);
    float ang = PI * 0.5 - pc / 12.0 * TAU;
    vec2 d = uv - NOTE_RADIUS * vec2(cos(ang), sin(ang));
    float s = 0.03 + n.x * 0.12;
    float flare = exp(-dot(d, d) / (s * s)) + 0.25 * exp(-length(d) * 9.0);
    col += mix(ramp(0.9), palette(pc / 12.0), 0.6) * flare * n.y * exp(-n.x * 2.5) * p_notes * 1.5;
  }

  vec2 g = uv * 26.0;
  vec2 id = floor(g);
  float pick = hash12(id + floor(uCount.z) * 7.13);
  vec2 off = hash22(id + 3.1) - 0.5;
  float star = smoothstep(0.12, 0.0, length(fract(g) - 0.5 - off * 0.6));
  col += vec3(0.9, 0.95, 1.0) * star * step(1.0 - 0.07 * p_stars, pick) * uHat * 3.0;
  float dust = step(0.985, hash12(id + 91.0)) * star * (0.15 + 0.6 * uAir);
  col += palette(pick) * dust;

  col *= 1.0 + 0.25 * uOnset + 0.3 * uSection;
  fragColor = vec4(col, 1.0);
}
