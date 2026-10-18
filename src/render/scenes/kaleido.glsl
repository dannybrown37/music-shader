// Kaleido: a mirrored fractal (Kali's "kaliset" iteration p = |p|/p·p − c). The constant c
// is steered by timbre, so a new instrument visibly reshapes the crystal; bass zooms in,
// kicks punch, snares rotate the mirror, hats light fine sparks at the fold seams.

uniform float p_folds;
uniform float p_zoom;
uniform float p_detail;
uniform float p_spin;
uniform float p_glow;
uniform float p_morph;

void main() {
  vec2 uv = centeredUv() + uShake;
  float t = uFlow * 0.15;
  uv *= 1.0 - 0.18 * uKick;

  float n = floor(p_folds + 0.5);
  float seg = TAU / n;
  float spin = t * 0.25 * p_spin + 0.35 * uSnare + uCount.y * 0.08;
  float r = length(uv);
  float a = atan(uv.y, uv.x) + spin;
  a = mod(a, seg);
  a = abs(a - seg * 0.5);
  vec2 p = r * vec2(cos(a), sin(a));

  vec2 c = vec2(0.82, 0.52) + p_morph * vec2(0.12 * uTimbre.x + 0.05 * sin(t * 0.7), 0.12 * uTimbre.y + 0.05 * cos(t * 0.9));
  p *= p_zoom * (0.8 + 0.35 * uBass) * (1.0 + 0.1 * sin(t * 0.3));
  p += vec2(0.15 * sin(t * 0.2), 0.1 * cos(t * 0.17));

  vec3 hue = vec3(0.0);
  float total = 0.0;
  int iters = 6 + int(p_detail * (2.0 + 4.0 * uBright));
  float lineTrap = 1e3;
  float pointTrap = 1e3;
  for (int i = 0; i < 16; i++) {
    if (i >= iters) break;
    p = abs(p) / max(dot(p, p), 1e-3) - c;
    float m = exp(-length(p) * (3.0 - 1.5 * uNoisy));
    // Only shallow iterations feed the traps: deeper ones are sub-pixel and alias into shimmer.
    if (i < 6) {
      lineTrap = min(lineTrap, abs(p.y));
      pointTrap = min(pointTrap, length(p - vec2(0.2 * uTimbre.z, 0.0)));
    }
    hue += palette(float(i) * 0.06 + length(p) * 0.12 + t * 0.05) * m;
    total += m;
  }
  hue /= max(total, 1e-3);
  float energy = 0.2 + 0.6 * uLoud + 0.3 * uHarm;

  // Dim body, bright structure: seams from the line trap, jewels from the point trap.
  float body = smoothstep(0.3, 1.0, total / float(iters) * 2.0);
  vec3 col = hue * body * body * 0.18 * energy;
  float seam = exp(-lineTrap * mix(70.0, 30.0, uHigh));
  col += mix(hue, ramp(0.9), 0.4) * seam * (0.2 + 0.6 * uMid + 1.2 * uHat) * p_glow * energy;
  float jewel = exp(-pointTrap * 9.0);
  col += ramp(0.6 + 0.3 * jewel) * jewel * (0.3 + 1.2 * uBass + 0.8 * uNote) * energy;
  col += ramp(0.7) * exp(-r * 4.0) * (uKick * 1.2 + uBass * 0.2) * p_glow;
  col *= 1.0 + 0.3 * uSection + 0.2 * uOnset;
  fragColor = vec4(col, 1.0);
}
