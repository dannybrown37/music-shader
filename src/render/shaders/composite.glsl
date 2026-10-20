#version 300 es
precision highp float;

// Final look: chromatic aberration, bloom, flash, exposure, ACES tonemap, vignette, grain, title overlay.
uniform sampler2D uImage;
uniform sampler2D uBloom;
uniform sampler2D uOverlay;
uniform vec2 uResolution;
uniform float uTime;
uniform float uBloomStrength;
uniform float uExposure;
uniform float uChromatic;
uniform float uGrain;
uniform float uVignette;
uniform float uFlash;
uniform float uOverlayAlpha;
uniform sampler2D uArt;         // cover art / logo, straight alpha
uniform float uArtMode;         // 0 off, 1 badge mid-screen, 2 backdrop
uniform float uArtSize;         // badge size, or backdrop strength
uniform float uArtAspect;       // image width / height
uniform float uArtPulse;        // kick envelope: the badge and backdrop breathe with it
uniform sampler2D uLyrics;      // current lyric line, drawn like the title card
uniform float uLyricsAlpha;
uniform sampler2D uAdapted;     // 1×1: log of the eye-adapted average luminance
uniform float uAutoExposure;    // 0 = fixed exposure, 1 = fully normalise to uKey
uniform float uKey;

in vec2 vUv;
out vec4 fragColor;

// Narkowicz ACES fit.
vec3 aces(vec3 x) { return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }

float hash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }

vec3 sampleSplit(sampler2D tex, vec2 uv, vec2 offset) {
  return vec3(texture(tex, uv - offset).r, texture(tex, uv).g, texture(tex, uv + offset).b);
}

void main() {
  vec2 d = vUv - 0.5;
  vec2 offset = d * dot(d, d) * uChromatic * 0.06;
  vec3 col = sampleSplit(uImage, vUv, offset);
  col += sampleSplit(uBloom, vUv, offset * 1.5) * uBloomStrength;
  col += uFlash * (col * 0.6 + vec3(0.04));
  float avg = exp(texture(uAdapted, vec2(0.5)).r);
  float auto = clamp(uKey / max(avg, 1e-4), 0.5, 2.0);
  col = aces(col * uExposure * mix(1.0, auto, uAutoExposure));

  float aspect = uResolution.x / uResolution.y;
  float r = length(d * vec2(aspect, 1.0));
  col *= mix(1.0, smoothstep(1.25, 0.25, r), uVignette);

  float luma = dot(col, vec3(0.2126, 0.7152, 0.0722));
  float g = hash(gl_FragCoord.xy + fract(uTime * 7.31) * 931.0) - 0.5;
  col += g * uGrain * 0.12 * (1.0 - luma * 0.7);

  col = pow(max(col, 0.0), vec3(1.0 / 2.2));

  // p: centred, screen height = 1.
  vec2 p = d * vec2(aspect, 1.0);
  if (uArtMode > 1.5) {
    // Backdrop: cover-fit, breathing with the kick, screened under the scene so bright structure stays on top.
    float h = max(1.0, aspect / uArtAspect) * (1.0 - 0.015 * uArtPulse);
    vec2 auv = vec2(0.5 + p.x / (h * uArtAspect), 0.5 - p.y / h);
    vec4 art = texture(uArt, auv);
    vec3 under = art.rgb * art.a * 0.3 * uArtSize;
    col = 1.0 - (1.0 - col) * (1.0 - under);
  } else if (uArtMode > 0.5) {
    // Badge: a centred disc of the art's middle square, pulsing on kicks, with a lit rim.
    float radius = 0.2 * uArtSize * (1.0 + 0.05 * uArtPulse);
    float r = length(p);
    vec2 crop = vec2(min(1.0, 1.0 / uArtAspect), min(1.0, uArtAspect));
    vec4 art = texture(uArt, vec2(0.5, 0.5) + vec2(p.x, -p.y) / (2.0 * radius) * crop);
    float inside = smoothstep(radius, radius - 0.003, r);
    col *= 1.0 - 0.6 * exp(-max(r - radius, 0.0) * 25.0) * step(radius, r);
    col = mix(col, art.rgb, inside * art.a);
    col += vec3(1.0) * exp(-abs(r - radius) * 220.0) * (0.25 + 0.6 * uArtPulse);
  }

  vec4 lyric = texture(uLyrics, vec2(vUv.x, 1.0 - vUv.y));
  col = mix(col, lyric.rgb, lyric.a * uLyricsAlpha);
  vec4 overlay = texture(uOverlay, vec2(vUv.x, 1.0 - vUv.y));
  col = mix(col, overlay.rgb, overlay.a * uOverlayAlpha);
  col += (hash(gl_FragCoord.xy * 1.37) - 0.5) / 255.0;
  fragColor = vec4(col, 1.0);
}
