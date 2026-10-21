// Mosaic: every kick, snare and note drops a shape into the frame until it's full, then they all fall away.
// The layout is planned in src/render/mosaic.ts; this shader only draws the records it packs into uShapes.
// Shape from timbre: bright = more corners, noisy = spiky star, pitched = rounded. Colour = which instrument.
// Kicks are solid, snares hollow, notes inset; each shape breathes with its own sound while it stays.

uniform sampler2D uShapes;   // TEXELS_PER_SHAPE texels per row, one shape per row
uniform float uShapeCount;
uniform float p_glow;
uniform float p_breathe;
uniform float p_glints;
uniform float p_fall;
uniform float p_spin;

const float FRAME_ASPECT = 16.0 / 9.0;
const float GRAVITY = 5.0;

// Outline radius at angle a for a unit shape: polygon with `points` corners, pinched toward a star by
// `spike`, blended toward a circle by `round`.
float outline(float a, float points, float spike, float round) {
  float seg = TAU / points;
  float h = mod(a, seg) - 0.5 * seg;
  float poly = cos(0.5 * seg) / cos(h);
  float corner = abs(h) / (0.5 * seg);
  float star = poly * (1.0 - spike * (1.0 - corner * corner));
  return mix(star, 1.0, round);
}

// Full size on the very first frame (growing in from zero reads as ~100 ms late), slammed in
// slightly oversized and settling with a small wobble.
float punch(float age) {
  return 1.0 + 0.3 * exp(-age * 14.0) * cos(age * 26.0);
}

void main() {
  vec2 p = centeredUv() * min(1.0, FRAME_ASPECT / (uResolution.x / uResolution.y));
  vec3 col = uPal0 * 0.03 * (1.0 - 0.3 * length(p));
  int count = int(uShapeCount + 0.5);

  for (int i = 0; i < 128; i++) {
    if (i >= count) break;
    vec4 a = texelFetch(uShapes, ivec2(0, i), 0);
    vec4 b = texelFetch(uShapes, ivec2(1, i), 0);
    vec4 d3 = texelFetch(uShapes, ivec2(3, i), 0);
    float seed = hash11(float(i) * 7.31 + a.x * 13.7);
    vec2 c = a.xy;
    float rotation = a.w + p_spin * 0.15 * (seed - 0.5) * uTime;
    float fall = b.y - d3.y;
    if (b.y >= 0.0 && fall > 0.0) {
      c.y -= 0.5 * GRAVITY * p_fall * fall * fall;
      c.x += (seed - 0.5) * 0.8 * fall;
      rotation += (seed - 0.5) * 5.0 * fall;
    }
    float kind = b.z;
    int pitch = int(d3.x + 0.5);
    float activity = kind < 0.5 ? uKick : kind < 1.5 ? uSnare : 0.5 * (pitch >= 0 ? uChroma[pitch] * uHarm : uNote);
    // Seconds since this shape was born or, once the frame is full, last re-struck by a matching hit.
    float hit = d3.z >= 0.0 ? min(b.x, d3.z) : b.x;
    float scale = a.z * punch(hit) * (1.0 + 0.08 * p_breathe * activity);
    float wave = 1.0 + 3.5 * hit;
    float reach = scale * (hit < 0.35 ? max(1.3, wave + 0.1) : 1.3) + 0.08;
    vec2 rel = p - c;
    if (dot(rel, rel) > reach * reach) continue;

    vec4 g = texelFetch(uShapes, ivec2(2, i), 0);
    vec2 q = rot(-rotation) * rel / max(scale, 1e-4);
    float ang = atan(q.y, q.x);
    float d = (length(q) - outline(ang, g.x, g.y, g.z)) * scale;
    float px = 1.5 / uResolution.y;
    float inside = 1.0 - smoothstep(-px, px, d);
    float rim = 1.0 - smoothstep(0.0, 2.0 * px + 0.004, abs(d));

    // Stay between the vivid stops: the dark and highlight stops would read as "no colour".
    float birth = exp(-hit * 9.0) * min(b.w, 1.5);
    vec3 own = palette(0.22 + 0.45 * g.w);
    if (d3.w >= 0.0 && uCastCount > 0.5) {
      vec3 member = uCastColor[int(d3.w + 0.5)];
      own = mix(own, member * dot(own, vec3(0.2126, 0.7152, 0.0722)) / max(dot(member, vec3(0.2126, 0.7152, 0.0722)), 1e-3), uCastMix);
    }
    vec3 tint = mix(own, uPal3, 0.6 * min(birth, 1.0));
    float lit = 0.35 + p_glow * (0.9 * activity + 2.5 * birth);
    float fill;
    if (kind < 0.5) {
      fill = inside * (0.45 + 0.55 * smoothstep(-scale, 0.0, d));
    } else if (kind < 1.5) {
      fill = inside * (0.12 + 0.88 * smoothstep(-0.18 * scale, -0.1 * scale, d));
    } else {
      float inset = 1.0 - smoothstep(0.0, 2.0 * px + 0.003, abs(d + 0.28 * scale));
      fill = inside * (0.55 + 0.9 * inset);
    }
    float glint = pow(max(0.0, cos(ang - uTime * 3.0 - seed * TAU)), 12.0) * uHat * p_glints * 3.0;
    float halo = exp(-max(d, 0.0) / (0.02 + 0.03 * birth)) * (1.0 - inside) * 0.25 * lit;
    float shock = 0.0;
    if (hit < 0.35) {
      float dw = (length(q) - outline(ang, g.x, g.y, g.z) * wave) * scale;
      shock = (1.0 - smoothstep(0.0, 2.0 * px + 0.006, abs(dw))) * exp(-hit * 10.0) * min(b.w, 1.5) * p_glow;
    }
    col += tint * (fill * lit + halo) + mix(tint, uPal3, 0.6) * (rim * (0.6 * lit + glint) + shock);
  }

  fragColor = vec4(col, 1.0);
}
