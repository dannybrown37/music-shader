#version 300 es
precision highp float;

// Milkdrop-style trails: the previous frame is zoomed, spun, warped and hue-shifted,
// then laid under the new scene frame. Bounded so trails never blow out to white.
uniform sampler2D uScene;
uniform sampler2D uSceneFrom;   // outgoing scene during an auto-VJ crossfade
uniform float uSceneMix;        // weight of uScene (1 = no crossfade)
uniform sampler2D uPrevFeedback;
uniform vec2 uResolution;
uniform float uAmount;
uniform float uZoom;
uniform float uSpin;
uniform float uHueShift;
uniform float uWarp;
uniform float uTime;

in vec2 vUv;
out vec4 fragColor;

vec3 hueRotate(vec3 c, float turns) {
  const mat3 toYiq = mat3(0.299, 0.596, 0.211, 0.587, -0.274, -0.523, 0.114, -0.322, 0.312);
  const mat3 toRgb = mat3(1.0, 1.0, 1.0, 0.956, -0.272, -1.106, 0.621, -0.647, 1.703);
  vec3 yiq = toYiq * c;
  float a = turns * 6.28318530718;
  float cs = cos(a), sn = sin(a);
  yiq.yz = mat2(cs, -sn, sn, cs) * yiq.yz;
  return max(toRgb * yiq, 0.0);
}

void main() {
  float aspect = uResolution.x / uResolution.y;
  vec2 p = vUv - 0.5;
  p.x *= aspect;
  float c = cos(uSpin), s = sin(uSpin);
  p = mat2(c, -s, s, c) * p / (1.0 + uZoom);
  p += uWarp * 0.01 * vec2(sin(p.y * 7.0 + uTime * 0.7), cos(p.x * 6.0 - uTime * 0.6));
  p.x /= aspect;
  vec3 prev = hueRotate(texture(uPrevFeedback, p + 0.5).rgb, uHueShift);
  vec3 scene = texture(uScene, vUv).rgb;
  if (uSceneMix < 1.0) scene = mix(texture(uSceneFrom, vUv).rgb, scene, uSceneMix);
  float cover = clamp(dot(scene, vec3(0.2126, 0.7152, 0.0722)), 0.0, 1.0);
  fragColor = vec4(scene + prev * uAmount * (1.0 - cover), 1.0);
}
