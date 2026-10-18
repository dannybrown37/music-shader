#version 300 es
precision highp float;

// Physically-inspired bloom (Jimenez, "Next Generation Post Processing in Call of Duty", 2014):
// mode 0: soft-threshold prefilter + 13-tap downsample
// mode 1: 13-tap downsample
// mode 2: 3×3 tent upsample of uLow added to uHigh
uniform int uMode;
uniform sampler2D uSource;
uniform sampler2D uLow;
uniform sampler2D uHigh;
uniform vec2 uTexel;        // 1 / source size
uniform float uThreshold;
uniform float uKnee;

in vec2 vUv;
out vec4 fragColor;

vec3 down13(vec2 uv) {
  vec2 t = uTexel;
  vec3 a = texture(uSource, uv + t * vec2(-2, -2)).rgb;
  vec3 b = texture(uSource, uv + t * vec2(0, -2)).rgb;
  vec3 c = texture(uSource, uv + t * vec2(2, -2)).rgb;
  vec3 d = texture(uSource, uv + t * vec2(-1, -1)).rgb;
  vec3 e = texture(uSource, uv + t * vec2(1, -1)).rgb;
  vec3 f = texture(uSource, uv + t * vec2(-2, 0)).rgb;
  vec3 g = texture(uSource, uv).rgb;
  vec3 h = texture(uSource, uv + t * vec2(2, 0)).rgb;
  vec3 i = texture(uSource, uv + t * vec2(-1, 1)).rgb;
  vec3 j = texture(uSource, uv + t * vec2(1, 1)).rgb;
  vec3 k = texture(uSource, uv + t * vec2(-2, 2)).rgb;
  vec3 l = texture(uSource, uv + t * vec2(0, 2)).rgb;
  vec3 m = texture(uSource, uv + t * vec2(2, 2)).rgb;
  return (d + e + i + j) * 0.125 + (a + b + g + f) * 0.03125 + (b + c + h + g) * 0.03125 + (f + g + l + k) * 0.03125 + (g + h + m + l) * 0.03125;
}

vec3 prefilter(vec3 c) {
  float br = max(c.r, max(c.g, c.b));
  float soft = clamp(br - uThreshold + uKnee, 0.0, 2.0 * uKnee);
  soft = soft * soft / (4.0 * uKnee + 1e-4);
  float contrib = max(soft, br - uThreshold) / max(br, 1e-4);
  return c * contrib;
}

void main() {
  if (uMode == 2) {
    vec2 t = uTexel;
    vec3 s = texture(uLow, vUv).rgb * 4.0;
    s += (texture(uLow, vUv + t * vec2(-1, 0)).rgb + texture(uLow, vUv + t * vec2(1, 0)).rgb + texture(uLow, vUv + t * vec2(0, -1)).rgb + texture(uLow, vUv + t * vec2(0, 1)).rgb) * 2.0;
    s += texture(uLow, vUv + t * vec2(-1, -1)).rgb + texture(uLow, vUv + t * vec2(1, -1)).rgb + texture(uLow, vUv + t * vec2(-1, 1)).rgb + texture(uLow, vUv + t * vec2(1, 1)).rgb;
    fragColor = vec4(texture(uHigh, vUv).rgb + s / 16.0, 1.0);
    return;
  }
  vec3 c = down13(vUv);
  fragColor = vec4(uMode == 0 ? prefilter(min(c, vec3(64.0))) : c, 1.0);
}
