// Ensemble: every part of the music gets its own visual voice, so you can watch the
// arrangement. Kick: expanding rings and the core pulse. Snare/clap: shard bursts.
// Hats: sparks on the outer orbit. Harmony: a 12-note wheel on the circle of fifths
// (chords light up as shapes). Spectrum: a mirrored ring. Timbre bends the ring and
// tints everything; bass swells the core.

uniform float p_wheel;
uniform float p_rings;
uniform float p_shards;
uniform float p_sparks;
uniform float p_spectrum;
uniform float p_spin;

const float WHEEL_R = 0.62;
const float SPEC_R = 0.3;

float angleDist(float a, float b) {
  float d = mod(a - b + PI, TAU) - PI;
  return abs(d);
}

void main() {
  vec2 uv = centeredUv() + uShake;
  uv *= rot(uFlow * 0.05 * p_spin);
  float r = length(uv);
  float a = atan(uv.y, uv.x);
  vec3 col = vec3(0.0);

  float neb = fbm(uv * 1.6 + vec2(uFlow * 0.03, 0.0) + uTimbre.xy * 0.4, 5);
  col += ramp(0.2) * pow(neb, 3.0) * (0.06 + 0.25 * uHarm) * smoothstep(1.6, 0.3, r);

  // Spectrum ring, mirrored left/right; timbre makes it wobble or go angular.
  float x = abs(mod(a + PI * 0.5, TAU) - PI) / PI;
  float sx = 0.03 + x * 0.9;
  float spec = (spectrum(sx - 0.015) + 2.0 * spectrum(sx) + spectrum(sx + 0.015)) * 0.25;
  float wobble = 0.02 * uTimbre.x * sin(a * 5.0 + uFlow * 0.4) + 0.015 * uNoisy * sin(a * 23.0);
  float inner = SPEC_R + 0.04 * uBass + wobble;
  float outer = inner + spec * spec * 0.28 * p_spectrum * (0.6 + 0.6 * uLoud);
  float body = smoothstep(inner - 0.004, inner + 0.004, r) * smoothstep(outer + 0.004, outer - 0.004, r);
  float edge = exp(-abs(r - outer) * 160.0) * step(inner, r + 0.01);
  col += ramp(0.35 + 0.5 * x) * body * (0.12 + 0.3 * spec);
  col += ramp(0.65 + 0.3 * spec) * edge * (0.4 + 1.2 * spec);

  float core = exp(-r * (16.0 - 5.0 * uSub));
  col += ramp(0.8) * core * (0.15 + 0.8 * uBass + 1.5 * uKick);

  for (int i = 0; i < 8; i++) {
    vec2 k = uKickHist[i];
    if (k.x < 0.0 || k.x > 1.5) continue;
    float rr = inner + k.x * 1.3;
    col += ramp(0.9) * exp(-abs(r - rr) * mix(90.0, 25.0, min(k.x, 1.0))) * k.y * exp(-k.x * 3.0) * p_rings;
  }

  for (int i = 0; i < 8; i++) {
    vec2 s = uSnareHist[i];
    if (s.x < 0.0 || s.x > 1.0) continue;
    float seed = uCount.y - float(i);
    float base = hash11(seed * 3.7) * TAU;
    float sector = TAU / 9.0;
    float local = mod(a - base, sector) - sector * 0.5;
    float jitter = (hash11(seed + floor((a - base) / sector)) - 0.5) * 0.25;
    float r0 = inner + 0.05 + s.x * 1.1;
    float len = 0.12 + 0.1 * hash11(seed * 1.3);
    float radial = smoothstep(r0 - 0.01, r0, r) * smoothstep(r0 + len, r0, r);
    float shard = exp(-abs(local - jitter * sector) * r * 140.0) * radial;
    col += mix(vec3(1.0), ramp(0.75), 0.4) * shard * s.y * exp(-s.x * 4.0) * 1.6 * p_shards;
  }

  for (int i = 0; i < 8; i++) {
    vec2 h = uHatHist[i];
    if (h.x < 0.0 || h.x > 0.4) continue;
    float seed = uCount.z - float(i);
    float phi = hash11(seed * 5.1) * TAU;
    float rad = WHEEL_R + 0.12 + 0.18 * hash11(seed * 2.3);
    vec2 p = rad * vec2(cos(phi), sin(phi));
    float d = length(uv - p);
    col += vec3(0.9, 0.95, 1.0) * h.y * exp(-h.x * 14.0) * (exp(-d * 140.0) * 2.5 + exp(-d * 35.0) * 0.15) * p_sparks;
  }

  // Note wheel: pitch classes on the circle of fifths, so consonant notes sit together.
  float ringLine = exp(-abs(r - WHEEL_R) * 250.0) * (0.15 + 0.3 * uTonal);
  col += ramp(0.5) * ringLine * p_wheel;
  for (int k = 0; k < 12; k++) {
    float pos = mod(float(k) * 7.0, 12.0);
    float th = pos / 12.0 * TAU - PI * 0.5;
    vec2 p = WHEEL_R * vec2(cos(th), sin(th));
    float c = uChroma[k];
    float lit = c * c * c * (0.35 + 0.8 * uTonal + 1.2 * uNote);
    float d = length(uv - p);
    vec3 noteCol = mix(ramp(0.35 + 0.6 * pos / 11.0), vec3(1.0), 0.15);
    col += noteCol * lit * (exp(-d * 28.0) * 2.0 + exp(-d * 10.0) * 0.15) * p_wheel;
    float arc = exp(-abs(r - WHEEL_R) * 120.0) * exp(-angleDist(a, th) * 6.0);
    col += noteCol * arc * lit * 0.6 * p_wheel;
  }

  col *= 1.0 + 0.3 * uSection;
  fragColor = vec4(col, 1.0);
}
