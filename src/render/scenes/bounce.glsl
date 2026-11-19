// Bounce: a big ball hops to a new spot on every kick, timed to land on the next beat.
// Each snare drops a ball from the sky that bounces itself out; each note pops a small
// ball up from the floor at its pitch's place (low notes left); hats glint along the floor.
// The floor line is the spectrum, every landing sends a ripple along it, and the glossy
// floor mirrors everything. All motion is closed-form from the hit history, so exports
// stay frame-exact.

uniform float p_height;
uniform float p_size;
uniform float p_drops;
uniform float p_pops;
uniform float p_glints;
uniform float p_floor;
uniform float p_reflect;

const float FLOOR = -0.62;
const float DROP_LIFE = 4.0;
const float DROP_GRAVITY = 3.2;
const float POP_LIFE = 2.5;
const float POP_GRAVITY = 5.0;
const float GLINT_LIFE = 0.4;
const vec3 LIGHT = vec3(-0.45, 0.6, 0.66);

// Height above the floor and seconds since the last landing (99 before the first) for a
// ball released at height h0 with upward speed v0, losing (1 - e) of its speed per bounce.
vec2 bounce(float t, float h0, float v0, float g, float e) {
  float tHit = (v0 + sqrt(v0 * v0 + 2.0 * g * h0)) / g;
  if (t < tHit) return vec2(h0 + v0 * t - 0.5 * g * t * t, 99.0);
  float v = (g * tHit - v0) * e;
  t -= tHit;
  for (int k = 0; k < 8; k++) {
    float span = 2.0 * v / g;
    if (t < span) return vec2(v * t - 0.5 * g * t * t, t);
    t -= span;
    v *= e;
  }
  return vec2(0.0, t);
}

// Bounces between the side walls instead of leaving the screen.
float wallFold(float x, float w) {
  float u = (x + w) / (2.0 * w);
  return -w + 2.0 * w * (1.0 - abs(mod(u, 2.0) - 1.0));
}

float squashOf(float since) { return 0.38 * exp(-since * 16.0); }

// A glossy sphere squashed against the floor on landing; radius r, height above floor h.
vec3 ball(vec2 p, float x, float h, float r, float squash, vec3 tint, float energy) {
  vec2 rad = r * vec2(1.0 + squash, 1.0 - squash);
  vec2 c = vec2(x, FLOOR + rad.y + h);
  vec2 q = (p - c) / rad;
  float d = length(q);
  if (d > 5.0) return vec3(0.0);
  float aa = 2.0 * uCamZoom / (uResolution.y * rad.y);
  float body = 1.0 - smoothstep(1.0 - aa, 1.0 + aa, d);
  vec3 n = vec3(q, sqrt(max(0.0, 1.0 - d * d)));
  vec3 l = normalize(LIGHT);
  float diff = max(0.0, dot(n, l));
  float spec = pow(max(0.0, dot(reflect(-l, n), vec3(0.0, 0.0, 1.0))), 40.0);
  float rim = pow(1.0 - n.z, 3.0);
  vec3 lit = tint * (0.04 + 0.55 * diff) + vec3(1.0) * spec * (1.2 + energy) + tint * rim * (0.5 + 1.5 * energy);
  float halo = exp(-max(d - 1.0, 0.0) * 5.0) * (1.0 - body);
  return lit * body + tint * halo * 0.12 * (0.3 + energy);
}

float ripple(float x, float at, float since, float strength) {
  if (since > 2.0) return 0.0;
  float front = abs(abs(x - at) - since * 1.3);
  return strength * exp(-front * 35.0) * exp(-since * 2.5);
}

// Everything that moves. `waves` collects floor ripples at p.x from each latest landing.
vec3 balls(vec2 p, out float waves) {
  float halfW = uResolution.x / uResolution.y;
  vec3 col = vec3(0.0);
  waves = 0.0;

  // The kick ball: replay its hops oldest to newest so each one starts where the last
  // one was when the kick came, wherever that was in the air.
  float beat = clamp(60.0 / max(uTempo, 1.0), 0.3, 0.9);
  float top = max(0.55 * p_height, 0.02);
  float g = 8.0 * top / (beat * beat);
  vec2 hop = vec2(0.0);
  float since = 99.0;
  for (int i = 7; i >= 0; i--) {
    vec2 k = uKickHist[i];
    if (k.x < 0.0) continue;
    float until = k.x;
    if (i > 0 && uKickHist[i - 1].x >= 0.0) until = k.x - uKickHist[i - 1].x;
    // Aim for the same apex however high the ball already is, so fast kicks can't stack it off-screen.
    float apex = top * (0.55 + 0.45 * min(k.y, 1.2));
    float v0 = sqrt(2.0 * g * max(apex - hop.y, 0.0));
    float flight = (v0 + sqrt(v0 * v0 + 2.0 * g * hop.y)) / g;
    float target = (hash11((uCount.x - float(i)) * 7.31) * 2.0 - 1.0) * halfW * 0.7;
    vec2 b = bounce(until, hop.y, v0, g, 0.35);
    hop = vec2(mix(hop.x, target, clamp(until / flight, 0.0, 1.0)), b.x);
    since = b.y;
  }
  float r = 0.13 * p_size;
  col += ball(p, hop.x, hop.y, r, squashOf(since), castNow(ramp(0.8)), uKick);
  waves += ripple(p.x, hop.x, since, 1.0);

  for (int i = 0; i < 8; i++) {
    vec2 s = uSnareHist[i];
    if (s.x < 0.0 || s.x > DROP_LIFE) continue;
    float seed = uCount.y - float(i);
    vec3 h = hash33(vec3(seed * 1.31, seed * 0.77, 4.1));
    float rs = (0.035 + 0.03 * h.z) * p_size;
    vec2 b = bounce(s.x, 1.1 - FLOOR, 0.0, DROP_GRAVITY, 0.62);
    float x = wallFold((h.x * 2.0 - 1.0) * halfW * 0.85 + (h.y - 0.5) * 0.7 * s.x, halfW - rs);
    float life = 1.0 - smoothstep(DROP_LIFE * 0.6, DROP_LIFE, s.x);
    float flash = s.y * exp(-b.y * 8.0);
    col += ball(p, x, b.x, rs, squashOf(b.y), mix(palette(h.z), ramp(0.9), 0.3), flash) * life * p_drops;
    waves += ripple(p.x, x, b.y, 0.6 * s.y) * life * p_drops;
  }

  for (int i = 0; i < 8; i++) {
    vec2 n = uNoteHist[i];
    if (n.x < 0.0 || n.x > POP_LIFE) break;
    float seed = uNoteCount - float(i);
    float pc = uNotePitch[i] >= 0.0 ? uNotePitch[i] : floor(hash11(seed) * 12.0);
    float x = ((pc + 0.5) / 12.0 * 2.0 - 1.0) * halfW * 0.85;
    vec2 b = bounce(n.x, 0.0, 1.6 + 0.9 * min(n.y, 1.2), POP_GRAVITY, 0.5);
    float life = 1.0 - smoothstep(POP_LIFE * 0.5, POP_LIFE, n.x);
    vec3 tint = noteColor(i, palette(pc / 12.0));
    col += ball(p, x, b.x, 0.028 * p_size, squashOf(b.y), tint, n.y * exp(-n.x * 4.0)) * life * p_pops;
    waves += ripple(p.x, x, b.y, 0.3 * n.y) * life * p_pops;
  }
  return col;
}

void main() {
  vec2 uv = centeredUv() + uShake;
  float halfW = uResolution.x / uResolution.y;
  float aa = 2.0 * uCamZoom / uResolution.y;
  float below = FLOOR - uv.y;

  vec3 col = ramp(0.08) * 0.03 * smoothstep(-0.2, 1.0, 1.0 - uv.y);

  float waves;
  vec3 front = balls(uv, waves);

  float band = clamp((uv.x + halfW) / (2.0 * halfW), 0.0, 1.0);
  float lvl = spectrum(band);
  float edge = exp(-abs(below) / (aa * 1.5));
  col += mix(ramp(0.55 + 0.4 * lvl), ramp(1.0), clamp(waves, 0.0, 1.0)) * edge * (0.12 + 1.6 * lvl * lvl + 2.5 * waves) * p_floor;
  col += ramp(0.6) * exp(-max(below, 0.0) * 30.0) * step(0.0, below) * (0.05 + 0.3 * lvl) * lvl * p_floor;

  if (below > 0.0) {
    float z = 0.25 / below;
    vec2 gc = vec2(uv.x * z * 0.9, z * 0.6);
    vec2 fw = fwidth(gc);
    vec2 line = (1.0 - smoothstep(vec2(0.0), 1.5 * fw, abs(fract(gc + 0.5) - 0.5))) * clamp(1.0 - fw * 3.0, 0.0, 1.0);
    col += ramp(0.4) * max(line.x, line.y) * 0.05 * p_floor;
    col += ramp(0.8) * waves * exp(-below * 12.0) * 0.4 * p_floor;
    float ignored;
    vec2 m = vec2(uv.x + 0.006 * sin(below * 90.0 - uTime * 4.0) * (0.3 + uBass), FLOOR + below);
    col += balls(m, ignored) * p_reflect * 0.35 * exp(-below * 3.0);
  }

  for (int i = 0; i < 8; i++) {
    vec2 h = uHatHist[i];
    if (h.x < 0.0 || h.x > GLINT_LIFE) continue;
    float x = (hash11((uCount.z - float(i)) * 3.17) * 2.0 - 1.0) * halfW * 0.95;
    vec2 d = uv - vec2(x, FLOOR);
    float star = exp(-length(d) * 160.0) + 0.35 * exp(-abs(d.y) * 900.0 - abs(d.x) * 25.0) + 0.2 * exp(-abs(d.x) * 900.0 - abs(d.y) * 60.0);
    col += vec3(0.95, 0.97, 1.0) * star * h.y * exp(-h.x * 10.0) * 2.0 * p_glints;
  }

  col += front;
  col += ramp(0.95) * dropRing(uv) * 1.5;
  col *= 1.0 + 0.25 * uSection;
  fragColor = vec4(col, 1.0);
}
