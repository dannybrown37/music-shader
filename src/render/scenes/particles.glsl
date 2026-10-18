// Particles: each instrument class throws its own kind of particle, so the arrangement
// plays out as physics. Kick: a heavy burst of embers from the centre that slows and
// falls. Snare/clap: a fan of fast, motion-blurred sparks, aimed somewhere new each hit.
// Hats: glitter that blinks on across the field. Notes: glowing orbs launched from
// their pitch's place on the circle of fifths (a melody traces a path), coloured by
// pitch. Timbre steers the dust; bass swells the centre glow.

uniform float p_embers;
uniform float p_sparks;
uniform float p_glitter;
uniform float p_orbs;
uniform float p_gravity;
uniform float p_spread;

const int EMBERS = 40;
const int SPARKS = 24;
const int GLITTER = 16;
const float EMBER_LIFE = 1.6;
const float SPARK_LIFE = 0.7;
const float GLITTER_LIFE = 0.35;
const float ORB_LIFE = 3.0;
const float ORB_RADIUS = 0.5;

// Position after t seconds for launch velocity v0 under linear drag k and gravity g.
vec2 ballistic(vec2 v0, float k, float g, float t) {
  float e = (1.0 - exp(-k * t)) / k;
  return v0 * e + vec2(0.0, -g) * (t - e) / k;
}

float glow(vec2 d, float r) {
  float q = dot(d, d) / (r * r);
  return exp(-q) + 0.03 / (1.0 + q);
}

float segmentDist(vec2 p, vec2 a, vec2 b) {
  vec2 ab = b - a;
  float h = clamp(dot(p - a, ab) / max(dot(ab, ab), 1e-8), 0.0, 1.0);
  return length(p - a - ab * h);
}

void main() {
  vec2 uv = centeredUv() + uShake;
  uv *= 1.0 - 0.04 * uKick;
  uv *= rot(uFlow * 0.015);
  float r = length(uv);
  vec3 col = vec3(0.0);

  float dust = fbm(uv * 1.3 + uTimbre.xy * 0.6 + vec2(uFlow * 0.02, -uFlow * 0.01), 4);
  col += ramp(0.25) * pow(dust, 3.0) * (0.06 + 0.35 * uHarm);
  col += ramp(0.7) * exp(-r * 12.0) * (0.03 + 0.25 * uBass + 0.7 * uKick) * p_embers;

  float gravity = 0.45 * p_gravity;

  for (int i = 0; i < 8; i++) {
    vec2 k = uKickHist[i];
    if (k.x < 0.0 || k.x > EMBER_LIFE) continue;
    float seed = uCount.x - float(i);
    float life = 1.0 - k.x / EMBER_LIFE;
    float hot = 1.0 - smoothstep(0.0, 0.2, k.x);
    for (int j = 0; j < EMBERS; j++) {
      vec2 h = hash22(vec2(seed * 1.17, float(j) * 3.31));
      float a = h.x * TAU;
      float speed = (0.8 + 2.6 * h.y * h.y) * p_spread * (0.6 + 0.5 * k.y);
      vec2 p = ballistic(speed * vec2(cos(a), sin(a)), 1.6, gravity, k.x);
      vec2 d = uv - p;
      if (dot(d, d) > 0.03) continue;
      float size = 0.004 + 0.014 * life * (0.5 + h.y);
      vec3 c = mix(ramp(0.55 + 0.4 * h.y), vec3(1.0), hot * 0.7);
      col += c * glow(d, size) * k.y * life * life * (0.5 + 0.8 * hash11(float(j) + seed)) * p_embers;
    }
  }

  for (int i = 0; i < 8; i++) {
    vec2 s = uSnareHist[i];
    if (s.x < 0.0 || s.x > SPARK_LIFE) continue;
    float seed = uCount.y - float(i);
    float base = hash11(seed * 3.7) * TAU;
    float fade = exp(-s.x * 4.0);
    for (int j = 0; j < SPARKS; j++) {
      vec2 h = hash22(vec2(seed * 2.03, float(j) * 1.71));
      float a = base + (h.x - 0.5) * 1.8;
      vec2 dir = vec2(cos(a), sin(a));
      vec2 v0 = dir * (2.0 + 2.5 * h.y) * p_spread;
      vec2 origin = dir * 0.08;
      vec2 head = origin + ballistic(v0, 4.0, gravity * 0.5, s.x);
      vec2 tail = origin + ballistic(v0, 4.0, gravity * 0.5, max(0.0, s.x - 0.035));
      float dist = segmentDist(uv, tail, head);
      if (dist > 0.05) continue;
      vec3 c = mix(ramp(0.9), vec3(1.0), 0.5);
      col += c * (exp(-dist * 700.0) * 1.6 + exp(-dist * 120.0) * 0.12) * s.y * fade * p_sparks;
    }
  }

  for (int i = 0; i < 8; i++) {
    vec2 g = uHatHist[i];
    if (g.x < 0.0 || g.x > GLITTER_LIFE) continue;
    float seed = uCount.z - float(i);
    float blink = exp(-g.x * 12.0);
    for (int j = 0; j < GLITTER; j++) {
      vec2 h = hash22(vec2(seed * 0.73, float(j) * 5.13));
      vec2 p = (h * 2.0 - 1.0) * vec2(1.7, 0.95);
      vec2 d = uv - p;
      if (dot(d, d) > 0.01) continue;
      float star = exp(-length(d) * 180.0) + 0.3 * (exp(-abs(d.x) * 700.0 - abs(d.y) * 40.0) + exp(-abs(d.y) * 700.0 - abs(d.x) * 40.0));
      col += vec3(0.9, 0.95, 1.0) * star * g.y * blink * 2.5 * p_glitter;
    }
  }

  // Faint pitch wheel on the circle of fifths, lit by the harmony, so orb positions read as notes.
  for (int k = 0; k < 12; k++) {
    float th = mod(float(k) * 7.0, 12.0) / 12.0 * TAU + PI * 0.5;
    float c = uChroma[k];
    col += ramp(0.6) * glow(uv - ORB_RADIUS * vec2(cos(th), sin(th)), 0.008) * (0.15 + 1.5 * c * c * c * (0.3 + uTonal)) * p_orbs;
  }

  // Note orbs, each joined to the note before it, so a melody draws a constellation.
  vec2 newer = vec2(0.0);
  float newerLife = 0.0;
  for (int i = 0; i < 8; i++) {
    vec2 n = uNoteHist[i];
    if (n.x < 0.0 || n.x > ORB_LIFE) break;
    float seed = uNoteCount - float(i);
    float pc = uNotePitch[i] >= 0.0 ? uNotePitch[i] : floor(hash11(seed) * 12.0);
    float fifths = mod(pc * 7.0, 12.0);
    float th = fifths / 12.0 * TAU + PI * 0.5;
    vec2 dir = vec2(cos(th), sin(th));
    vec2 p = dir * ORB_RADIUS + ballistic(dir * 0.3 + vec2(0.0, 0.2), 1.2, -0.04, n.x);
    p += 0.04 * n.x * vec2(sin(n.x * 2.7 + seed), cos(n.x * 2.1 + seed * 1.3));
    float life = 1.0 - n.x / ORB_LIFE;
    vec3 c = mix(ramp(0.4 + 0.6 * fifths / 11.0), vec3(1.0), 0.25);
    float pop = 1.0 + 3.0 * exp(-n.x * 8.0);
    col += c * glow(uv - p, 0.025 + 0.025 * life) * n.y * life * pop * 2.0 * p_orbs;
    if (i > 0) {
      float line = exp(-segmentDist(uv, p, newer) * 500.0);
      col += c * line * min(life, newerLife) * 0.35 * p_orbs;
    }
    newer = p;
    newerLife = life;
  }

  col *= 1.0 + 0.25 * uSection;
  fragColor = vec4(col, 1.0);
}
