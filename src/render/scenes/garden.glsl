// Garden: plants grow through each section. Stems rise from the soil, each tied to a band
// of the spectrum (bass on the left) that lights its leaves and flower; leaves unfurl as
// the stem climbs past them and a flower opens at the tip once it's grown. Kicks send sap
// pulses up the stems and make the flowers breathe, snares are gusts the plants spring
// back from, every note opens a blossom on a vine (higher notes higher up), hats are
// fireflies and the grass along the bottom is the live spectrum. Each section the old
// garden wilts away and a new one sprouts.

uniform float p_plants;
uniform float p_growth;
uniform float p_wind;
uniform float p_blooms;
uniform float p_notes;
uniform float p_fireflies;
uniform float p_grass;
uniform float p_layout;

const float GROUND = -0.82;
const float NODE = 0.13;
const int MAX_PLANTS = 14;
const float WILT_SECONDS = 2.0;
const float BLOSSOM_LIFE = 2.5;
const float FIREFLY_LIFE = 1.6;
const vec3 LEAF_DARK = vec3(0.008, 0.04, 0.01);
const vec3 LEAF_LIT = vec3(0.07, 0.38, 0.05);

// Foliage stays green whatever the palette cycles to, tinted a little toward it.
vec3 foliage(float t) { return mix(mix(LEAF_DARK, LEAF_LIT, t), ramp(0.15 + 0.2 * t), 0.25); }

struct Stem {
  float x0;
  float h;
  float len;
  float g;
  float amp;
  float freq;
  float phase;
  float band;
  float bend;
  float petals;
  float hue;
};

// Slow breeze plus a damped spring after every snare, travelling across the garden.
float wind(float x) {
  float w = 0.04 * sin(uFlow * 0.6 + x * 1.7) + 0.015 * sin(uTime * 1.3 + x * 3.1);
  for (int i = 0; i < 8; i++) {
    vec2 s = uSnareHist[i];
    if (s.x < 0.0 || s.x > 3.0) continue;
    float age = max(0.0, s.x - (x + 2.0) * 0.06);
    float dir = hash11(uCount.y - float(i)) < 0.5 ? -1.0 : 1.0;
    w += dir * 0.11 * s.y * sin(age * 6.0) * exp(-age * 2.0);
  }
  return w * p_wind;
}

Stem stemOf(int j, float count, float seed, float age) {
  Stem s;
  float fj = float(j);
  vec4 h = vec4(hash12(vec2(fj, seed)), hash12(vec2(fj + 17.3, seed)), hash12(vec2(fj + 41.7, seed)), hash12(vec2(fj + 73.1, seed)));
  float halfW = uResolution.x / uResolution.y;
  s.x0 = (-1.0 + 2.0 * (fj + 0.5 + (h.x - 0.5) * 0.7) / count) * halfW * 0.92;
  s.h = 0.7 + 0.95 * h.y;
  float grown = max(0.0, age - h.z * 5.0) * p_growth / (8.0 + 6.0 * h.w);
  s.g = 1.0 - exp(-grown);
  s.len = s.h * s.g;
  s.amp = 0.02 + 0.05 * h.z;
  s.freq = 3.0 + 4.0 * h.w;
  s.phase = h.x * TAU;
  s.band = (fj + 0.5) / count;
  s.bend = wind(s.x0);
  s.petals = 5.0 + floor(h.y * 4.0);
  s.hue = h.w;
  return s;
}

// Shaped against the full height, so the curve doesn't stretch as the stem grows into it.
float stemX(Stem s, float y) {
  float t = y / s.h;
  return s.x0 + s.amp * sin(y * s.freq + s.phase) * t + s.bend * t * t;
}

float sap(float y) {
  float v = 0.0;
  for (int i = 0; i < 6; i++) {
    vec2 k = uKickHist[i];
    if (k.x < 0.0 || k.x > 2.0) continue;
    v += k.y * exp(-abs(y - k.x * 0.9) * 18.0) * (1.0 - k.x * 0.5);
  }
  return v;
}

float flowerMask(vec2 q, float r, float petals, float spin, float aa, out float core) {
  float th = atan(q.y, q.x) + spin;
  float rq = length(q);
  float edge = r * (0.35 + 0.65 * pow(abs(cos(th * petals * 0.5)), 0.6));
  core = smoothstep(r * 0.26 + aa, r * 0.26 - aa, rq);
  return smoothstep(edge + aa, edge - aa, rq);
}

// One plant layered over col; fade < 1 while it wilts away.
vec3 plant(vec2 p, Stem s, float fade, float aa, vec3 col) {
  float reach = s.amp + abs(s.bend) + 0.25;
  if (abs(p.x - s.x0) > reach || s.len < 0.005) return col;
  float y = p.y - GROUND;
  float lvl = spectrum(s.band);
  float droop = 1.0 - fade;

  if (y > -0.01 && y < s.len + 0.01) {
    float yc = clamp(y, 0.0, s.len);
    float dx = p.x - stemX(s, yc);
    float slope = (stemX(s, yc + 0.01) - stemX(s, yc - 0.01)) / 0.02;
    float d = abs(dx) / sqrt(1.0 + slope * slope);
    float w = 0.003 + 0.007 * (1.0 - yc / s.h);
    float m = smoothstep(w + aa, w - aa, d) * fade;
    vec3 c = foliage(0.4 + 0.3 * yc / s.h) * (0.5 + 1.0 * lvl) + mix(foliage(1.0) * 4.0, ramp(0.95), 0.3) * sap(yc) * 0.5;
    col = mix(col, c, m);
  }

  for (int dk = -1; dk <= 1; dk++) {
    float k = floor(y / NODE) + float(dk);
    if (k < 1.0) continue;
    float sy = k * NODE;
    float grown = clamp((s.len - sy) / 0.22, 0.0, 1.0);
    if (grown <= 0.0) continue;
    float side = mod(k, 2.0) < 0.5 ? 1.0 : -1.0;
    vec2 base = vec2(stemX(s, sy), GROUND + sy);
    float ang = side * (1.0 - 0.35 * grown + 0.9 * droop) + s.bend * 1.5 + 0.08 * sin(uFlow * 0.8 + k + s.phase);
    vec2 dir = vec2(sin(ang), cos(ang));
    float len = (0.06 + 0.05 * hash12(vec2(k, s.phase))) * grown * (1.0 - 0.35 * sy / s.h);
    vec2 q = p - base;
    float u = dot(q, dir);
    if (u < 0.0 || u > len) continue;
    float v = dot(q, vec2(dir.y, -dir.x));
    float half_ = len * 0.3 * sin(PI * u / len);
    float m = smoothstep(half_ + aa, half_ - aa, abs(v)) * fade;
    float vein = exp(-abs(v) / aa * 0.7);
    vec3 c = foliage(0.45 + 0.55 * u / len) * (0.4 + 1.8 * lvl) + foliage(1.0) * vein * 0.6;
    col = mix(col, c, m);
  }

  float open = smoothstep(0.6, 0.9, s.g) * fade;
  if (open > 0.0) {
    vec2 tip = vec2(stemX(s, s.len), GROUND + s.len);
    float r = (0.06 + 0.04 * s.hue) * p_blooms * open * (1.0 + 0.18 * uKick + 0.3 * lvl);
    vec2 q = p - tip;
    q.y += droop * 0.5 * r;
    if (dot(q, q) < r * r * 9.0) {
      float core;
      float m = flowerMask(q, r, s.petals, s.phase + s.bend * 2.0, aa, core);
      float rq = length(q) / max(r, 1e-4);
      vec3 petal = castNow(mix(ramp(0.66), palette(s.hue * 0.3 + 0.55), 0.35)) * (0.5 + 0.5 * rq) * (0.3 + 0.9 * lvl);
      col = mix(col, petal, m);
      col = mix(col, ramp(1.0) * (1.2 + 3.0 * uKick), core);
      col += ramp(0.85) * exp(-rq * 2.5) * 0.25 * (0.3 + lvl) * open;
    }
  }
  return col;
}

vec3 garden(vec2 p, float seed, float age, float fade, float count, float aa, vec3 col) {
  for (int j = 0; j < MAX_PLANTS; j++) {
    if (float(j) >= count) break;
    col = plant(p, stemOf(j, count, seed, age), fade, aa, col);
  }
  return col;
}

vec3 grass(vec2 p, float aa, vec3 col) {
  float halfW = uResolution.x / uResolution.y;
  float bw = 0.016;
  float c = floor((p.x + halfW) / bw);
  for (int dc = -1; dc <= 1; dc++) {
    float cc = c + float(dc);
    float h = hash11(cc * 1.71);
    float bx = -halfW + (cc + 0.5 + (h - 0.5) * 0.8) * bw;
    float lvl = spectrum((bx + halfW) / (2.0 * halfW));
    float tall = (0.03 + 0.05 * h + 0.25 * lvl * lvl) * p_grass;
    float y = p.y - (GROUND - 0.03);
    if (y < 0.0 || y > tall) continue;
    float t = y / tall;
    float x = bx + (wind(bx) * 0.6 + (h - 0.5) * 0.04) * t * t;
    float w = bw * 0.3 * (1.0 - t) + aa * 0.5;
    float m = smoothstep(w + aa, w - aa, abs(p.x - x));
    col = mix(col, foliage(0.3 + 0.7 * t) * (0.3 + 2.8 * lvl * t * t), m);
  }
  return col;
}

vec3 blossoms(vec2 p, float seed, float age, float count, float aa, vec3 col) {
  for (int i = 0; i < 8; i++) {
    vec2 n = uNoteHist[i];
    if (n.x < 0.0 || n.x > BLOSSOM_LIFE) break;
    float ns = uNoteCount - float(i);
    int j = int(hash11(ns * 3.1) * count);
    Stem s = stemOf(j, count, seed, age);
    if (s.len < 0.12) continue;
    float pc = uNotePitch[i] >= 0.0 ? uNotePitch[i] : floor(hash11(ns) * 12.0);
    float y = s.len * (0.2 + 0.7 * pc / 11.0);
    float side = hash11(ns * 7.7) < 0.5 ? -1.0 : 1.0;
    vec2 at = vec2(stemX(s, y) + side * 0.018, GROUND + y);
    float r = 0.028 * (0.7 + 0.5 * min(n.y, 1.2)) * min(1.0, n.x * 10.0) * (1.0 - smoothstep(BLOSSOM_LIFE * 0.5, BLOSSOM_LIFE, n.x));
    vec2 q = p - at;
    if (dot(q, q) > r * r * 9.0) continue;
    float core;
    float m = flowerMask(q, r, 5.0, ns, aa, core);
    vec3 c = noteColor(i, mix(palette(pc / 12.0), ramp(0.9), 0.3)) * (1.0 + 3.0 * exp(-n.x * 6.0));
    col = mix(col, c * p_notes, m * min(p_notes, 1.0));
    col += c * exp(-length(q) / r * 2.0) * 0.3 * exp(-n.x * 2.0) * p_notes;
  }
  return col;
}

vec3 fireflies(vec2 p) {
  float halfW = uResolution.x / uResolution.y;
  vec3 c = vec3(0.0);
  for (int i = 0; i < 8; i++) {
    vec2 h = uHatHist[i];
    if (h.x < 0.0 || h.x > FIREFLY_LIFE) continue;
    float seed = uCount.z - float(i);
    vec2 r = hash22(vec2(seed * 0.37, 2.9));
    vec2 at = vec2((r.x * 2.0 - 1.0) * halfW * 0.95, GROUND + 0.15 + r.y * 1.4);
    at += 0.06 * h.x * vec2(sin(h.x * 2.0 + seed), cos(h.x * 1.7 + seed * 1.3));
    float blink = exp(-h.x * 2.5) * (0.7 + 0.3 * sin(h.x * 20.0 + seed));
    float d = length(p - at);
    c += ramp(0.95) * (exp(-d * 220.0) * 2.5 + exp(-d * 30.0) * 0.12) * h.y * blink;
  }
  for (int k = 0; k < 10; k++) {
    float fk = float(k);
    vec2 at = vec2(sin(uTime * 0.11 * (1.0 + fk * 0.13) + fk * 7.0) * halfW * 0.9, -0.25 + 0.55 * sin(uTime * 0.17 + fk * 3.3));
    float pulse = pow(0.5 + 0.5 * sin(uTime * (1.3 + 0.2 * fk) + fk * 2.1), 4.0);
    float d = length(p - at);
    c += ramp(0.9) * (exp(-d * 260.0) * 1.5 + exp(-d * 40.0) * 0.08) * pulse * (0.1 + uAir);
  }
  return c * p_fireflies;
}

void main() {
  vec2 uv = centeredUv() + uShake;
  float aa = 2.0 * uCamZoom / uResolution.y;
  float count = clamp(floor(p_plants + 0.5), 1.0, float(MAX_PLANTS));
  bool perSection = p_layout > 0.5;
  float seed = perSection ? uCount.w : 0.0;
  float age = perSection ? uSectionAge : uTime;

  float mist = fbm(uv * 1.5 + vec2(uFlow * 0.03, 0.0), 4);
  vec3 col = ramp(0.12) * (0.02 + 0.05 * smoothstep(0.6, -0.8, uv.y)) + ramp(0.3) * pow(mist, 3.0) * (0.03 + 0.12 * uHarm);

  if (perSection && uCount.w > 0.0 && uSectionAge < WILT_SECONDS) {
    float wilt = 1.0 - uSectionAge / WILT_SECONDS;
    col = garden(uv, seed - 1.0, 60.0, wilt * wilt, count, aa, col);
  }
  col = garden(uv, seed, age, 1.0, count, aa, col);
  col = blossoms(uv, seed, age, count, aa, col);
  col = grass(uv, aa, col);

  if (uv.y < GROUND) {
    float soil = fbm(uv * vec2(6.0, 12.0), 3);
    col = mix(col, ramp(0.05) * (0.02 + 0.05 * soil), smoothstep(GROUND - 0.03, GROUND - 0.06, uv.y));
  }

  col += fireflies(uv);
  col += ramp(0.95) * dropRing(uv) * 1.2;
  col *= 1.0 + 0.2 * uSection;
  fragColor = vec4(col, 1.0);
}
