// Orb: a living sphere. Its surface is the spectrum wrapped by latitude (bass at the
// bottom, highs at the top), so each instrument raises its own band. Timbre morphs the
// lobes and roughness, snares erupt spikes, kicks launch expanding shockwave shells,
// hats glint off the surface and the stars.

uniform float p_size;
uniform float p_spikes;
uniform float p_shells;
uniform float p_rim;
uniform float p_orbit;
uniform float p_iridescence;

float radius() { return p_size * (0.78 + 0.12 * uBass + 0.16 * uKick); }

float surface(vec3 p) {
  vec3 n = normalize(p);
  float lat = n.y * 0.5 + 0.5;
  float disp = spectrum(lat * 0.96) * 0.28 * (0.45 + uLoud);
  vec3 q = p * (1.8 + 1.8 * uBright) + vec3(0.0, uFlow * 0.25, 0.0);
  float rough = noise3(q * 2.0) * 0.55 + noise3(q * 4.3) * 0.3;
  disp += (rough - 0.42) * (0.05 + 0.22 * uNoisy);
  disp += 0.13 * uTimbre.x * sin(3.0 * n.x + uFlow * 0.2) * sin(3.0 * n.z - uFlow * 0.1);
  disp += 0.1 * uTimbre.y * sin(4.0 * n.y + uFlow * 0.15);
  float spike = pow(max(0.0, noise3(n * 7.0 + uCount.y * 3.17) * 1.25 - 0.25), 5.0) * 4.0;
  disp += spike * uSnare * 0.4 * p_spikes;
  return length(p) - radius() - disp;
}

float map(vec3 p) { return surface(p) * 0.55; }

vec3 normalAt(vec3 p) {
  const vec2 k = vec2(1.0, -1.0) * 0.002;
  return normalize(k.xyy * map(p + k.xyy) + k.yyx * map(p + k.yyx) + k.yxy * map(p + k.yxy) + k.xxx * map(p + k.xxx));
}

vec3 background(vec3 rd) {
  vec3 col = ramp(0.05) * 0.05;
  float neb = fbm(rd.xy * 2.0 + rd.z + uFlow * 0.02, 4);
  col += ramp(0.3) * pow(neb, 3.0) * 0.12 * (0.5 + uHarm);
  vec2 g = vec2(atan(rd.z, rd.x), asin(rd.y)) * 60.0;
  vec2 id = floor(g);
  float star = smoothstep(0.1, 0.0, length(fract(g) - 0.5 - (hash22(id) - 0.5) * 0.7));
  col += star * (step(0.97, hash12(id)) * 0.4 + step(0.985, hash12(id + floor(uCount.z))) * uHat * 2.0);
  return col;
}

// Halo where the camera ray grazes an expanding spherical shell, one per recent kick.
float shells(vec3 ro, vec3 rd) {
  float tc = -dot(ro, rd);
  float dmin = length(ro + rd * max(tc, 0.0));
  float glow = 0.0;
  for (int i = 0; i < 8; i++) {
    vec2 h = uKickHist[i];
    if (h.x < 0.0 || h.x > 2.0) continue;
    float r = radius() + h.x * 2.2;
    float edge = abs(dmin - r);
    glow += h.y * exp(-h.x * 2.2) * (exp(-edge * 30.0) * 1.2 + exp(-edge * 6.0) * 0.15);
  }
  return glow;
}

void main() {
  vec2 uv = centeredUv() + uShake;
  float a = uFlow * 0.12 * p_orbit;
  float elev = 0.35 * sin(uFlow * 0.05);
  float dist = 3.4 - 0.35 * uIntensity;
  vec3 ro = dist * vec3(cos(a) * cos(elev), sin(elev), sin(a) * cos(elev));
  vec3 fw = normalize(-ro);
  vec3 rt = normalize(cross(vec3(0.0, 1.0, 0.0), fw));
  vec3 up = cross(fw, rt);
  vec3 rd = normalize(fw * 1.6 + rt * uv.x + up * uv.y);

  vec3 col = background(rd);
  float t = 0.0;
  float aura = 0.0;
  bool hit = false;
  for (int i = 0; i < 96; i++) {
    vec3 p = ro + rd * t;
    float d = map(p);
    aura += exp(-max(d, 0.0) * 10.0) * 0.012;
    if (d < 0.0015) {
      hit = true;
      break;
    }
    t += d;
    if (t > 8.0) break;
  }

  if (hit) {
    vec3 p = ro + rd * t;
    vec3 n = normalAt(p);
    vec3 l = normalize(vec3(0.6, 0.8, -0.3));
    float lat = normalize(p).y * 0.5 + 0.5;
    float band = spectrum(lat * 0.96);
    float diff = max(dot(n, l), 0.0);
    float fres = pow(1.0 - max(dot(n, -rd), 0.0), 3.0);
    vec3 base = ramp(0.15 + 0.5 * band) * (0.08 + 0.5 * diff);
    vec3 irid = palette(dot(n, rd) * 1.5 + lat + uTimbre.z * 0.4);
    base = mix(base, irid * (0.15 + 0.6 * diff), p_iridescence * 0.6);
    vec3 h = normalize(l - rd);
    float spec = pow(max(dot(n, h), 0.0), 60.0) * (0.6 + 3.0 * uHat + 1.5 * uHigh);
    col = base + vec3(spec) + ramp(0.85) * fres * p_rim * (0.6 + 1.2 * uMid + uKick);
    col += ramp(0.7) * band * band * (0.4 + 1.5 * uOnset) * 0.6;
  }

  col += ramp(0.7) * aura * (0.4 + uBass + uKick) * p_rim;
  col += ramp(0.9) * shells(ro, rd) * p_shells;
  col *= 1.0 + 0.3 * uSection;
  fragColor = vec4(col, 1.0);
}
