// Terrain: a synthwave flyover where the land is the spectrogram. New sound rises at the
// horizon and rolls toward you; bass builds the hills beside the road, highs the far peaks.
// Kicks heave the land in waves that roll toward you (so the beat pattern is laid out
// on the ground), snares flash the grid, hats run lights down the road, and the sun is
// an equalizer. Each section moves the camera.

uniform float p_height;
uniform float p_grid;
uniform float p_sun;
uniform float p_road;
uniform float p_fog;
uniform float p_stars;
uniform float p_waves;
uniform float p_camera;

const float NEAR = 0.6;
const float FAR = 26.0;
const float HISTORY = 2.0; // seconds of spectrogram, see SPECTROGRAM_SPAN_SECONDS

// Terrain depth z maps to spectrogram age: the horizon is "now", the camera is 2 s ago.
float ageAt(float z) { return 1.0 - clamp((z - NEAR) / (FAR - NEAR), 0.0, 1.0); }
float zAtAge(float age) { return FAR - (FAR - NEAR) * (age / HISTORY); }

float gKickZ[8];
float gKickA[8];

void setupKicks() {
  for (int i = 0; i < 8; i++) {
    vec2 k = uKickHist[i];
    bool live = k.x >= 0.0 && k.x <= HISTORY;
    gKickA[i] = live ? k.y : 0.0;
    gKickZ[i] = zAtAge(max(k.x, 0.0));
  }
}

float kickWave(float z) {
  float w = 0.0;
  for (int i = 0; i < 8; i++) {
    if (gKickA[i] <= 0.0) continue;
    float d = z - gKickZ[i];
    // Steep front, longer tail behind it, like a swell rolling in.
    w += gKickA[i] * exp(-max(d, 0.0) * 2.5 - max(-d, 0.0) * 0.9);
  }
  return w;
}

float kickFront(float z) {
  float w = 0.0;
  for (int i = 0; i < 8; i++) {
    if (gKickA[i] <= 0.0) continue;
    w += gKickA[i] * exp(-abs(z - gKickZ[i]) * 7.0);
  }
  return w;
}

float bandAt(float x) {
  float d = abs(x) - p_road;
  return clamp(d / 9.0, 0.0, 1.0);
}

float heightAt(vec2 xz) {
  float d = abs(xz.x) - p_road;
  if (d < 0.0) return 0.0;
  float band = bandAt(xz.x);
  float s = spectrogram(pow(band, 0.8), ageAt(xz.y));
  float rise = smoothstep(0.0, 1.2, d);
  float ridges = 0.35 + 0.65 * noise(vec2(xz.x * 0.7, xz.y * 0.35 - uFlow * 0.4));
  float swell = 1.0 + 1.1 * p_waves * kickWave(xz.y) * (1.0 - 0.6 * band);
  return rise * s * s * p_height * (1.0 + 0.8 * uBass) * (0.4 + 0.6 * ridges) * (1.0 + 0.08 * d) * swell;
}

vec3 horizonGlow(float h) { return ramp(0.6) * exp(-h * 14.0) * 0.35; }

vec3 sky(vec3 rd, float sunPulse) {
  float h = clamp(rd.y, 0.0, 1.0);
  vec3 col = ramp(0.0) * 0.12 + ramp(0.35) * 0.08 * (1.0 - h) + horizonGlow(h);

  vec2 sp = vec2(rd.x, rd.y - 0.1) / (0.33 + 0.05 * sunPulse);
  float r = length(sp);
  if (r < 1.0 && rd.y > -0.02) {
    float stripes = step(0.5, fract(sp.y * 7.0 - uTime * 0.5)) + step(0.25, sp.y + 0.1);
    vec3 sunCol = mix(ramp(0.85), ramp(0.5), smoothstep(0.6, -0.8, sp.y));
    // The sun is an equalizer: bass on the left, highs on the right, each column filled to its level.
    const float COLS = 20.0;
    float cx = (sp.x + 1.0) * 0.5 * COLS;
    float level = spectrum((floor(cx) + 0.5) / COLS);
    float fill = step((sp.y + 0.3) / 1.3, level * 1.1) * step(0.14, fract(cx));
    float lit = mix(0.3, 1.0, fill);
    col = mix(col, sunCol * lit * (0.5 + 0.9 * sunPulse) * p_sun, smoothstep(1.0, 0.97, r) * min(1.0, stripes));
  }
  col += ramp(0.75) * exp(-r * 2.5) * (0.25 + sunPulse) * p_sun * 0.4;

  vec2 g = rd.xy / max(rd.z, 0.1) * 40.0;
  vec2 id = floor(g);
  float star = smoothstep(0.08, 0.0, length(fract(g) - 0.5 - (hash22(id) - 0.5) * 0.7));
  float lit = step(0.93, hash12(id)) * (0.25 + 0.75 * uAir) + step(1.0 - 0.06 * p_stars, hash12(id + floor(uCount.z))) * uHat * 2.5;
  col += star * lit * smoothstep(0.05, 0.25, rd.y);
  col += ramp(0.95) * uSnare * 0.25 * smoothstep(0.0, 0.6, rd.y);
  return col;
}

void main() {
  vec2 uv = centeredUv() + uShake;
  setupKicks();
  // A new camera for each section: lower and wider, or high and looking down.
  vec3 shot = vec3(hash11(uSeed * 3.1), hash11(uSeed * 5.7), hash11(uSeed * 9.3)) * 2.0 - 1.0;
  float camH = 1.05 + 0.25 * uIntensity - 0.12 * uKick + 0.45 * p_camera * shot.x;
  vec3 ro = vec3(0.15 * sin(uFlow * 0.13) * uWidth * 3.0 + 0.3 * p_camera * shot.y, camH, 0.0);
  vec3 rd = normalize(vec3(uv.x, uv.y - 0.18 - 0.1 * p_camera * max(shot.x, 0.0), 1.4 - 0.25 * p_camera * shot.z));
  rd.xy *= rot(0.03 * sin(uFlow * 0.21) + 0.05 * uTimbre.y + 0.07 * p_camera * shot.z);

  float sunPulse = uKick;
  vec3 col = sky(rd, sunPulse);

  float t = NEAR;
  float prevT = NEAR;
  float hit = -1.0;
  for (int i = 0; i < 110; i++) {
    vec3 p = ro + rd * t;
    if (p.z > FAR) break;
    float h = heightAt(p.xz);
    if (p.y < h) {
      hit = t;
      break;
    }
    prevT = t;
    t += max(0.02, (p.y - h) * 0.45) + t * 0.004;
  }
  // Bisect between the last miss and the hit for clean ridgelines.
  if (hit > 0.0) {
    float lo = prevT;
    float hi = hit;
    for (int i = 0; i < 6; i++) {
      float mid = 0.5 * (lo + hi);
      vec3 p = ro + rd * mid;
      if (p.y < heightAt(p.xz)) hi = mid;
      else lo = mid;
    }
    hit = hi;
  }

  if (hit > 0.0) {
    vec3 p = ro + rd * hit;
    float h = heightAt(p.xz);
    float scroll = (FAR - NEAR) / HISTORY * uTime;
    vec2 cell = vec2(p.x, p.z + mod(scroll, 1000.0)) * vec2(1.0, 1.0);
    vec2 gw = fwidth(cell) * 1.2 + 0.015;
    vec2 lineDist = 0.5 - abs(fract(cell) - 0.5);
    vec2 gl = 1.0 - smoothstep(vec2(0.0), gw, lineDist);
    float grid = max(gl.x, gl.y);
    float band = bandAt(p.x);
    float lineLevel = clamp(h / max(0.2, p_height), 0.0, 1.0);
    // Bass hills and treble peaks get different colours, so you can tell which part is rising.
    vec3 lineCol = mix(ramp(0.55 + 0.4 * lineLevel + 0.1 * uTimbre.x), palette(0.15 + 0.6 * band), 0.45);
    vec3 base = ramp(0.05) * 0.04 + ramp(0.3 + 0.4 * lineLevel) * lineLevel * lineLevel * 0.12;
    float pulse = 0.0;
    for (int i = 0; i < 8; i++) {
      vec2 s = uSnareHist[i];
      if (s.x < 0.0 || s.x > HISTORY) continue;
      pulse += s.y * exp(-abs(p.z - zAtAge(s.x)) * 2.5) * exp(-s.x);
    }
    float wave = kickWave(p.z) * p_waves;
    float energy = 0.6 + 1.6 * uHigh * band + 0.8 * uMid + 3.5 * pulse + 1.2 * uSnare + 1.8 * wave;
    col = base + lineCol * grid * p_grid * energy;
    col += ramp(0.7) * wave * lineLevel * 0.25;
    col += ramp(0.95) * kickFront(p.z) * p_waves * 0.9;

    float road = 1.0 - step(p_road, abs(p.x));
    float hatLight = 0.0;
    for (int i = 0; i < 8; i++) {
      vec2 hh = uHatHist[i];
      if (hh.x < 0.0 || hh.x > HISTORY) continue;
      hatLight += hh.y * exp(-abs(p.z - zAtAge(hh.x)) * 1.5);
    }
    float dash = smoothstep(0.08, 0.0, abs(abs(p.x) - p_road * 0.5)) * step(0.5, fract(cell.y * 0.5));
    col += ramp(0.9) * road * dash * (0.35 + 2.5 * hatLight * p_stars);
    float far = hit / FAR;
    float fog = 1.0 - exp(-far * far * 4.0 * p_fog);
    col = mix(col, ramp(0.0) * 0.12 + horizonGlow(0.0), fog);
  }

  fragColor = vec4(col, 1.0);
}
