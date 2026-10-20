// Tunnel: flying down a tiled tube. Kick rings race toward you, snares wrench the
// tunnel round, hats fire light streaks along the walls, and the spectrum lights
// angular sectors (bass at the floor, highs at the ceiling) so every instrument owns
// a slice of the wall. Noisy timbres crack the tiles; tonal ones smooth them.

uniform float p_speed;
uniform float p_twist;
uniform float p_rings;
uniform float p_segments;
uniform float p_spectrum;
uniform float p_streaks;
uniform float p_melody;

const float RING_SPAWN = 7.0;
const float RING_SPEED = 5.0;

float voronoiEdge(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  float d1 = 8.0;
  float d2 = 8.0;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 o = vec2(x, y);
      vec2 c = o + hash22(i + o) - f;
      float d = dot(c, c);
      if (d < d1) {
        d2 = d1;
        d1 = d;
      } else if (d < d2) d2 = d;
    }
  }
  return sqrt(d2) - sqrt(d1);
}

void main() {
  vec2 uv = centeredUv() + uShake;
  uv *= rot(0.2 * sin(uFlow * 0.07) + 0.25 * uTimbre.y);
  float r = max(length(uv), 1e-3);
  float a = atan(uv.y, uv.x);
  float z = 0.4 / r;
  float travel = uFlow * 1.4 * p_speed;

  float twist = p_twist * (0.9 * uSnare + 0.08 * z * (uMid - 0.3));
  float aa = a + twist + 0.12 * z * sin(travel * 0.15);
  vec2 tuv = vec2(aa / TAU * p_segments, (z + travel) * 1.5);

  vec2 id = floor(tuv);
  vec2 fc = fract(tuv) - 0.5;
  float box = max(abs(fc.x), abs(fc.y));
  float tile = smoothstep(0.5, 0.44, box);
  float cracks = smoothstep(0.0, 0.06, voronoiEdge(tuv * 2.0));
  float panel = mix(tile, tile * cracks, smoothstep(0.2, 0.8, uNoisy));
  float seam = 1.0 - tile;

  float band = 1.0 - abs(a) / PI;
  float spec = spectrum(band);
  // Equalizer tiles: each tile lights when its band is loud enough to beat the tile's random threshold.
  float lit = step(hash12(id * 1.31), spec * spec * 1.15);
  float flicker = step(1.0 - 0.3 * uOnset, hash12(id + floor(uCount.x) * 0.37));
  vec3 wall = ramp(0.1 + 0.25 * hash12(id)) * panel * 0.05;
  wall += ramp(0.5 + 0.4 * spec) * panel * lit * p_spectrum * smoothstep(10.0, 1.5, z) * (0.35 + 0.6 * uLoud);
  wall += ramp(0.75) * panel * flicker * uOnset * 0.4;
  wall += ramp(0.85) * seam * (0.04 + 0.45 * uHigh + 0.2 * uBright);

  float rings = 0.0;
  for (int i = 0; i < 8; i++) {
    vec2 k = uKickHist[i];
    if (k.x < 0.0) continue;
    float zr = RING_SPAWN - k.x * RING_SPEED;
    if (zr < 0.2) continue;
    rings += k.y * exp(-abs(z - zr) * 6.0) * smoothstep(0.2, 1.0, zr);
  }
  wall += ramp(0.95) * rings * p_rings * 1.4;

  // Melody ribbons: painted far away as the line sounds, then carried toward you like the rings.
  // Angle is pitch (low by the bass side of the wall, high by the treble side), mirrored top and bottom.
  float age = (RING_SPAWN - z) / RING_SPEED / 2.0;
  if (age > 0.0 && age < 1.0) {
    vec2 ml = melodyLine(age);
    float d = abs(abs(aa) - PI * (1.0 - ml.x));
    float width = 0.035 + 0.035 * uVoice;
    float core = smoothstep(width, width * 0.4, d);
    float glow = exp(-d / (width * 3.0)) * 0.25;
    float shimmer = 1.0 + 0.6 * uVoice * sin(z * 24.0 - uTime * 9.0);
    float fadeIn = smoothstep(0.0, 0.04, age) * smoothstep(1.0, 0.7, age);
    wall += mix(ramp(0.9), vec3(1.0, 0.85, 0.7), 0.4 * uVoice) * (core + glow) * smoothstep(0.15, 0.5, ml.y) * shimmer * fadeIn * p_melody * 1.6;
  }

  float lane = floor((aa / TAU + 0.5) * 48.0);
  float streakOn = step(1.0 - 0.12 * p_streaks, hash11(lane * 1.7 + floor(uCount.z) * 13.1));
  float streak = streakOn * smoothstep(0.5, 0.0, abs(fract((aa / TAU + 0.5) * 48.0) - 0.5) * 2.0);
  wall += vec3(0.9, 0.95, 1.0) * streak * uHat * 1.6 * exp(-z * 0.15);

  // Fade the far end into fog and the huge near walls into shadow, so the eye goes down the tube.
  float fog = exp(-z * 0.16) * smoothstep(0.12, 0.75, z);
  vec3 col = wall * fog;
  col += ramp(0.8) * exp(-r * 10.0) * (0.15 + 0.8 * uBass + 1.0 * uKick);
  col *= 1.0 + 0.3 * uSection;
  fragColor = vec4(col, 1.0);
}
