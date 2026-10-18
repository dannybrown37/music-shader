#version 300 es
precision highp float;
precision highp int;

// ---- Frame -----------------------------------------------------------------
uniform vec2 uResolution;   // render target size in pixels
uniform float uTime;        // song time in seconds
uniform float uFlow;        // integrated motion: advances faster when the music is loud
uniform float uSeed;        // changes on every section so scenes can re-roll details
uniform vec2 uShake;        // camera shake offset from kicks

// ---- Continuous features (0..1 unless noted, already scaled by reactivity) ----
uniform float uLoud, uIntensity;
uniform float uSub, uBass, uLowMid, uMid, uHigh, uAir;
uniform float uPerc, uHarm;
uniform float uBright, uNoisy, uTonal, uWidth, uNovelty;
uniform vec3 uTimbre;       // -1..1: per-song instrument coordinates (x≈bright, y≈noisy, z≈loud)
uniform float uKeyHue;      // 0..1 position of the dominant key on the circle of fifths
uniform float uKeyStrength; // 0..1 how clear that key is
uniform float uChroma[12];

// ---- Events: decaying envelopes (0..~1.5) -----------------------------------
uniform float uKick, uSnare, uHat, uOnset, uNote, uBeat, uDownbeat, uSection;
uniform vec4 uCount;        // events so far: kick, snare, hat, section
uniform float uBeatPhase, uBarPhase, uTempo;
// Recent hits, newest first: (age seconds, strength); age < 0 means empty slot.
uniform vec2 uKickHist[8];
uniform vec2 uSnareHist[8];
uniform vec2 uHatHist[8];
uniform vec2 uNoteHist[8];   // melodic onsets (not drums)
uniform float uNotePitch[8]; // pitch class of each uNoteHist entry, 0 = C … 11 = B; -1 unknown
uniform float uNoteCount;    // notes so far: uNoteCount - i identifies uNoteHist[i]

// ---- Textures ----------------------------------------------------------------
uniform sampler2D uSpectrum;     // 64×1 mel spectrum, low → high
uniform sampler2D uSpectrogram;  // 64×128 history, row v=0 is now, v=1 is ~2s ago
uniform sampler2D uPrev;         // previous output frame (for feedback-style scenes)

// ---- Palette: four linear-RGB stops, dark → vivid → highlight, cyclic in t ------
uniform vec3 uPal0, uPal1, uPal2, uPal3;
uniform float uPalShift;

in vec2 vUv;
out vec4 fragColor;

#define PI 3.14159265359
#define TAU 6.28318530718

vec3 palette(float t) {
  float x = fract(t + uPalShift) * 4.0;
  float f = smoothstep(0.0, 1.0, fract(x));
  if (x < 1.0) return mix(uPal0, uPal1, f);
  if (x < 2.0) return mix(uPal1, uPal2, f);
  if (x < 3.0) return mix(uPal2, uPal3, f);
  return mix(uPal3, uPal0, f);
}

// Non-wrapping ramp for "how lit" lookups: 0 = darkest stop, 1 = highlight.
vec3 ramp(float t) {
  float x = clamp(t, 0.0, 1.0) * 3.0;
  float f = smoothstep(0.0, 1.0, fract(x));
  if (x < 1.0) return mix(uPal0, uPal1, f);
  if (x < 2.0) return mix(uPal1, uPal2, f);
  return mix(uPal2, uPal3, x >= 3.0 ? 1.0 : f);
}

float spectrum(float x) { return texture(uSpectrum, vec2(clamp(x, 0.0, 1.0), 0.5)).r; }
float spectrogram(float x, float age) { return texture(uSpectrogram, vec2(clamp(x, 0.0, 1.0), clamp(age, 0.0, 1.0))).r; }

mat2 rot(float a) { float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }

float hash11(float p) { p = fract(p * 0.1031); p *= p + 33.33; p *= p + p; return fract(p); }
float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
vec2 hash22(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973)); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.xx + p3.yz) * p3.zy); }
vec3 hash33(vec3 p3) { p3 = fract(p3 * vec3(0.1031, 0.1030, 0.0973)); p3 += dot(p3, p3.yxz + 33.33); return fract((p3.xxy + p3.yxx) * p3.zyx); }

float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1, 0)), u.x), mix(hash12(i + vec2(0, 1)), hash12(i + vec2(1, 1)), u.x), u.y);
}

float noise3(vec3 p) {
  vec3 i = floor(p), f = fract(p);
  vec3 u = f * f * (3.0 - 2.0 * f);
  float n000 = hash12(i.xy + i.z * 17.17), n100 = hash12(i.xy + vec2(1, 0) + i.z * 17.17);
  float n010 = hash12(i.xy + vec2(0, 1) + i.z * 17.17), n110 = hash12(i.xy + vec2(1, 1) + i.z * 17.17);
  float n001 = hash12(i.xy + (i.z + 1.0) * 17.17), n101 = hash12(i.xy + vec2(1, 0) + (i.z + 1.0) * 17.17);
  float n011 = hash12(i.xy + vec2(0, 1) + (i.z + 1.0) * 17.17), n111 = hash12(i.xy + vec2(1, 1) + (i.z + 1.0) * 17.17);
  return mix(mix(mix(n000, n100, u.x), mix(n010, n110, u.x), u.y), mix(mix(n001, n101, u.x), mix(n011, n111, u.x), u.y), u.z);
}

float fbm(vec2 p, int octaves) {
  float v = 0.0, a = 0.5;
  mat2 m = mat2(0.8, 0.6, -0.6, 0.8);
  for (int i = 0; i < 8; i++) {
    if (i >= octaves) break;
    v += a * noise(p);
    p = m * p * 2.03;
    a *= 0.5;
  }
  return v;
}

// Centered, aspect-correct coordinates: y in [-1, 1].
vec2 centeredUv() { return (gl_FragCoord.xy - 0.5 * uResolution) / (0.5 * uResolution.y); }
