#version 300 es
precision highp float;

// mode 0: log luminance of the frame (mipmapped afterwards to get the scene average)
// mode 1: eases the remembered average toward the new one, like an eye adapting
uniform int uMode;
uniform sampler2D uSource;
uniform sampler2D uPrevAdapted;
uniform float uMaxLevel;
uniform float uBlend;

in vec2 vUv;
out vec4 fragColor;

void main() {
  if (uMode == 0) {
    vec3 c = texture(uSource, vUv).rgb;
    fragColor = vec4(log(dot(c, vec3(0.2126, 0.7152, 0.0722)) + 1e-4), 0.0, 0.0, 1.0);
    return;
  }
  float current = textureLod(uSource, vec2(0.5), uMaxLevel).r;
  float previous = texture(uPrevAdapted, vec2(0.5)).r;
  fragColor = vec4(mix(previous, current, uBlend), 0.0, 0.0, 1.0);
}
