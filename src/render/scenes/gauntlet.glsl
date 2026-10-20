// Gauntlet: Terrain's synthwave flyover with a ship on the road and something in its way.
// Every snare drops an obstacle at the horizon that rolls toward you with the land. The ship
// either slides to another lane past a pylon or shoots a floating mine with twin lasers.
// Everything is a pure function of the hit history: obstacle n sits in the lane the ship held
// after obstacle n-1, so if the ship's lane for n is the same it has to shoot, otherwise it dodges.

uniform float p_height;
uniform float p_grid;
uniform float p_sun;
uniform float p_road;
uniform float p_fog;
uniform float p_stars;
uniform float p_waves;
uniform float p_camera;
uniform float p_size;
uniform float p_shots;
uniform float p_lasers;
uniform float p_blast;
uniform float p_melody;

const float NEAR = 0.6;
const float FAR = 26.0;
const float HISTORY = 2.0; // seconds of spectrogram, see SPECTROGRAM_SPAN_SECONDS
const float SHIP_Z = 3.0;
const float SHIP_Y = 0.38;

float ageAt(float z) { return 1.0 - clamp((z - NEAR) / (FAR - NEAR), 0.0, 1.0); }
float zAtAge(float age) { return FAR - (FAR - NEAR) * (age / HISTORY); }

const float SHIP_AGE = (FAR - SHIP_Z) / (FAR - NEAR) * HISTORY;
const float FIRE_AGE = SHIP_AGE - 0.55;
const float BLAST_AGE = SHIP_AGE - 0.3;
const float LAST_AGE = HISTORY + 0.4;

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

float bandAt(float x) { return clamp((abs(x) - p_road) / 9.0, 0.0, 1.0); }

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

// ---- The run: lanes, obstacles, ship ------------------------------------------------

// The dodge plan is mirrored in src/render/gauntlet.ts, where it is tested; keep them in step.
const int SLOTS = 16;
const float SPEED = (FAR - NEAR) / HISTORY;
const float SHIP_NOSE = 0.5;
const float SHIP_HALF_SPAN = 0.42;
const float LANE_MARGIN = 0.22;
const float DEPTH_MARGIN = 0.3;
const float SLIDE = 0.28;
const float QUICK = 0.16;
const float NO_PREDECESSOR = 1e3;

// The ship's lane after obstacle n has passed: constant within a run of p_shots+1 obstacles
// (those get shot), and always different from one run to the next (the first one is dodged).
float shipLane(float n) {
  float b = floor(n / (floor(p_shots + 0.5) + 1.0));
  return mod(b + floor(b / 3.0), 3.0) - 1.0;
}

float laneX(float lane) { return lane * p_road * 0.62; }

float pylonHalfWidth() { return min(max(0.28 * p_size, 0.06), laneX(1.0) - SHIP_HALF_SPAN - LANE_MARGIN); }

// Seconds before (and after) a pylon's arrival that the ship must already be clear of its lane.
float clearTime() { return (SHIP_NOSE + pylonHalfWidth() + DEPTH_MARGIN) / SPEED; }

float obstacleId(int i) { return uCount.y - 1.0 - float(i); }

// Seconds since the previous lane change. The obstacles in between are mines, shot before they
// reach the ship, so only that one can still be in the way. Unknown once it has left the history.
float gapBefore(int i) {
  int back = int(floor(p_shots + 0.5)) + 1;
  if (obstacleId(i) - float(back) < 0.0) return NO_PREDECESSOR;
  if (i + back >= SLOTS) return 0.0;
  return uSnareHist[i + back].x - uSnareHist[i].x;
}

// A lane change with room to slide is a pylon; everything else is a mine to shoot.
bool gMine[SLOTS];

void setupRun() {
  float minGap = 2.0 * clearTime() + QUICK;
  for (int i = 0; i < SLOTS; i++) {
    float n = obstacleId(i);
    gMine[i] = shipLane(n) == shipLane(n - 1.0) || gapBefore(i) < minGap;
  }
}

vec3 obstacleCenter(float n, bool mine, float age, float strength) {
  float rise = smoothstep(0.0, 0.25, age);
  float x = laneX(shipLane(n - 1.0));
  if (mine) return vec3(x, SHIP_Y + 0.05 + 0.06 * sin(age * 9.0 + n), zAtAge(age));
  return vec3(x, (0.35 + 0.25 * min(strength, 1.5)) * p_size * rise, zAtAge(age));
}

vec3 obstacleSize(bool mine, float age, float strength) {
  float rise = smoothstep(0.0, 0.25, age);
  if (mine) return vec3(0.2 + 0.06 * min(strength, 1.5)) * p_size * rise;
  float w = pylonHalfWidth();
  return vec3(w, (0.35 + 0.25 * min(strength, 1.5)) * p_size * rise, w);
}

mat3 obstacleSpin(float n, bool mine, float age) {
  if (!mine) return mat3(1.0);
  float a = hash11(n * 1.7) * TAU + age * 2.5;
  float b = 0.6 + age * 1.3;
  mat3 ry = mat3(cos(a), 0.0, sin(a), 0.0, 1.0, 0.0, -sin(a), 0.0, cos(a));
  mat3 rx = mat3(1.0, 0.0, 0.0, 0.0, cos(b), -sin(b), 0.0, sin(b), cos(b));
  return rx * ry;
}

float blastAge(int i) { return uSnareHist[i].x - BLAST_AGE; }

// Where a mine's blast is now: it drifts toward the camera a little slower than the land.
vec3 blastCenter(int i) {
  float age = uSnareHist[i].x;
  return obstacleCenter(obstacleId(i), true, BLAST_AGE, uSnareHist[i].y) + vec3(0.0, 0.0, -(zAtAge(BLAST_AGE) - zAtAge(age)) * 0.6);
}

// Light cast on the land by recent explosions.
vec3 blastLight(vec3 p) {
  vec3 light = vec3(0.0);
  for (int i = 0; i < SLOTS; i++) {
    float since = blastAge(i);
    if (!gMine[i] || since < 0.0 || since > 0.8) continue;
    float d = length(p - blastCenter(i));
    light += palette(0.08 + 0.1 * hash11(obstacleId(i))) * exp(-since * 5.0) / (1.0 + d * d * 3.0);
  }
  return light * p_blast;
}

// Lateral position and velocity: the newest lane minus whatever slides are still to come.
// A pylon's slide ends clearTime before it arrives and starts no earlier than the previous
// obstacle clearing the tail; lane changes too cramped for that sidestep once the way is clear.
vec2 shipLateral() {
  float c = clearTime();
  float x = laneX(shipLane(uCount.y - 1.0));
  float v = 0.0;
  for (int i = 0; i < SLOTS; i++) {
    float age = uSnareHist[i].x;
    if (age < 0.0) continue;
    float n = obstacleId(i);
    float delta = laneX(shipLane(n)) - laneX(shipLane(n - 1.0));
    if (delta == 0.0) continue;
    float gap = gapBefore(i);
    float lanes = abs(delta) / laneX(1.0);
    vec2 win = gMine[i] ? vec2(gap - c - QUICK, gap - c) : vec2(c, c + min(SLIDE + 0.1 * (lanes - 1.0), gap - 2.0 * c));
    float u = clamp((SHIP_AGE - age - win.x) / (win.y - win.x), 0.0, 1.0);
    x -= delta * u * u * (3.0 - 2.0 * u);
    v += delta * 6.0 * u * (1.0 - u) / (win.y - win.x);
  }
  return vec2(x, v);
}

vec2 boxHit(vec3 ro, vec3 rd, vec3 he) {
  vec3 m = 1.0 / rd;
  vec3 n = m * ro;
  vec3 k = abs(m) * he;
  vec3 t1 = -n - k;
  vec3 t2 = -n + k;
  float tn = max(max(t1.x, t1.y), t1.z);
  float tf = min(min(t2.x, t2.y), t2.z);
  return (tn > tf || tf < 0.0) ? vec2(-1.0) : vec2(tn, tf);
}

float sdTriangle(vec2 p, vec2 p0, vec2 p1, vec2 p2) {
  vec2 e0 = p1 - p0, e1 = p2 - p1, e2 = p0 - p2;
  vec2 v0 = p - p0, v1 = p - p1, v2 = p - p2;
  vec2 pq0 = v0 - e0 * clamp(dot(v0, e0) / dot(e0, e0), 0.0, 1.0);
  vec2 pq1 = v1 - e1 * clamp(dot(v1, e1) / dot(e1, e1), 0.0, 1.0);
  vec2 pq2 = v2 - e2 * clamp(dot(v2, e2) / dot(e2, e2), 0.0, 1.0);
  float s = sign(e0.x * e2.y - e0.y * e2.x);
  vec2 d = min(min(vec2(dot(pq0, pq0), s * (v0.x * e0.y - v0.y * e0.x)),
                   vec2(dot(pq1, pq1), s * (v1.x * e1.y - v1.y * e1.x))),
                   vec2(dot(pq2, pq2), s * (v2.x * e2.y - v2.y * e2.x)));
  return -sqrt(d.x) * sign(d.y);
}

// Arrowhead outline in the ship's xz plane, nose toward +z.
float shipOutline(vec2 q) {
  float wing = sdTriangle(q, vec2(0.0, 0.5), vec2(0.42, -0.28), vec2(-0.42, -0.28));
  float notch = sdTriangle(q, vec2(0.0, -0.1), vec2(-0.22, -0.34), vec2(0.22, -0.34));
  return max(wing, -notch);
}

float shipSdf(vec3 q) {
  float cockpit = 0.07 * exp(-q.x * q.x * 60.0 - (q.z - 0.1) * (q.z - 0.1) * 25.0);
  return max(shipOutline(q.xz), abs(q.y) - 0.025 - cockpit) * 0.7;
}

float rayPointDist(vec3 ro, vec3 rd, vec3 p, out float t) {
  t = max(dot(p - ro, rd), 0.0);
  return length(ro + rd * t - p);
}

float raySegmentDist(vec3 ro, vec3 rd, vec3 a, vec3 b, out float t) {
  vec3 ba = b - a;
  vec3 w0 = ro - a;
  float bd = dot(rd, ba), c = dot(ba, ba), d = dot(rd, w0), e = dot(ba, w0);
  float denom = c - bd * bd;
  float s = denom > 1e-6 ? clamp((e - bd * d) / denom, 0.0, 1.0) : 0.0;
  t = max(bd * s - d, 0.0);
  return length(ro + rd * t - (a + ba * s));
}

void main() {
  vec2 uv = centeredUv() + uShake;
  setupKicks();
  setupRun();
  vec2 lateral = shipLateral();
  vec3 ship = vec3(lateral.x, SHIP_Y + 0.04 * sin(uTime * 2.3) + 0.06 * uKick, SHIP_Z);
  float roll = clamp(-0.1 * lateral.y, -0.9, 0.9) + 0.05 * sin(uTime * 1.7);

  vec3 shot = vec3(hash11(uSeed * 3.1), hash11(uSeed * 5.7), hash11(uSeed * 9.3)) * 2.0 - 1.0;
  float camH = 1.2 + 0.2 * uIntensity - 0.1 * uKick + 0.35 * p_camera * shot.x;
  vec3 ro = vec3(ship.x * 0.6 + 0.25 * p_camera * shot.y, camH, 0.0);
  vec3 rd = normalize(vec3(uv.x, uv.y - 0.2 - 0.08 * p_camera * max(shot.x, 0.0), 1.4 - 0.2 * p_camera * shot.z));
  rd.xy *= rot(0.03 * sin(uFlow * 0.21) + 0.04 * uTimbre.y + 0.05 * p_camera * shot.z - clamp(0.012 * lateral.y, -0.1, 0.1));

  vec3 col = sky(rd, uKick);
  float sceneT = 1e9;

  // ---- Land
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
    sceneT = hit;
    vec3 p = ro + rd * hit;
    float h = heightAt(p.xz);
    float scroll = (FAR - NEAR) / HISTORY * uTime;
    vec2 cell = vec2(p.x, p.z + mod(scroll, 1000.0));
    vec2 gw = fwidth(cell) * 1.2 + 0.015;
    vec2 lineDist = 0.5 - abs(fract(cell) - 0.5);
    vec2 gl = 1.0 - smoothstep(vec2(0.0), gw, lineDist);
    float grid = max(gl.x, gl.y);
    float band = bandAt(p.x);
    float lineLevel = clamp(h / max(0.2, p_height), 0.0, 1.0);
    vec3 lineCol = mix(ramp(0.55 + 0.4 * lineLevel + 0.1 * uTimbre.x), palette(0.15 + 0.6 * band), 0.45);
    vec3 base = ramp(0.05) * 0.04 + ramp(0.3 + 0.4 * lineLevel) * lineLevel * lineLevel * 0.12;
    float wave = kickWave(p.z) * p_waves;
    float energy = 0.6 + 1.6 * uHigh * band + 0.8 * uMid + 1.2 * uSnare + 1.8 * wave;
    col = base + lineCol * grid * p_grid * energy;
    col += ramp(0.7) * wave * lineLevel * 0.25;
    col += ramp(0.95) * kickFront(p.z) * p_waves * 0.9;

    // Lane dividers on the road, with hat lights running down them.
    float road = 1.0 - step(p_road, abs(p.x));
    float hatLight = 0.0;
    for (int i = 0; i < 8; i++) {
      vec2 hh = uHatHist[i];
      if (hh.x < 0.0 || hh.x > HISTORY) continue;
      hatLight += hh.y * exp(-abs(p.z - zAtAge(hh.x)) * 1.5);
    }
    float divider = abs(abs(p.x) - p_road * 0.31);
    float dash = smoothstep(0.06, 0.0, divider) * step(0.5, fract(cell.y * 0.5));
    col += ramp(0.9) * road * dash * (0.3 + 2.5 * hatLight * p_stars);
    // The ship's shadow-glow on the road.
    col += palette(0.55) * road * exp(-length((p.xz - ship.xz) * vec2(3.0, 1.6)) * 2.0) * 0.25;
    col += blastLight(p) * (0.3 + 1.5 * grid);
  }

  // ---- Obstacles: pylons to dodge, spinning mines to shoot
  vec3 glow = vec3(0.0);
  for (int i = 0; i < SLOTS; i++) {
    vec2 sn = uSnareHist[i];
    if (sn.x < 0.0 || sn.x > LAST_AGE) continue;
    float n = obstacleId(i);
    bool mine = gMine[i];
    if (mine && sn.x > BLAST_AGE) continue;
    vec3 c = obstacleCenter(n, mine, sn.x, sn.y);
    vec3 he = obstacleSize(mine, sn.x, sn.y);
    mat3 spin = obstacleSpin(n, mine, sn.x);
    vec3 lro = spin * (ro - c);
    vec3 lrd = spin * rd;
    vec2 bh = boxHit(lro, lrd, he);
    if (bh.x <= 0.0 || bh.x >= sceneT) continue;
    sceneT = bh.x;
    vec3 q = (lro + lrd * bh.x) / he;
    vec3 a = abs(q);
    float second = a.x + a.y + a.z - max(a.x, max(a.y, a.z)) - min(a.x, min(a.y, a.z));
    float edgeW = (0.03 + 0.004 * bh.x) / min(he.x, min(he.y, he.z));
    float edge = smoothstep(1.0 - edgeW, 1.0 - 0.3 * edgeW, second);
    float charge = mine ? smoothstep(FIRE_AGE, BLAST_AGE, sn.x) : 0.0;
    vec3 edgeCol = mine ? mix(ramp(0.95), palette(0.05), 0.4) : palette(0.6 + 0.1 * n);
    float scan = 0.5 + 0.5 * sin((q.y * he.y - uTime * 0.8) * 60.0);
    vec3 face = ramp(0.15) * 0.15 + edgeCol * (0.12 + 0.1 * scan) * (1.0 + 1.5 * uSnare);
    col = face + edgeCol * edge * (2.5 + 2.0 * min(sn.y, 1.5) + 4.0 * charge) + ramp(1.0) * charge * charge * 0.6;
  }

  // ---- Ship
  vec3 shipRo = ro - ship;
  float b = dot(shipRo, rd);
  float disc = b * b - dot(shipRo, shipRo) + 0.36;
  if (disc > 0.0) {
    float st = max(-b - sqrt(disc), 0.0);
    float stEnd = -b + sqrt(disc);
    mat2 bank = rot(roll);
    for (int i = 0; i < 40; i++) {
      if (st > stEnd || st > sceneT) break;
      vec3 q = shipRo + rd * st;
      q.xy = bank * q.xy;
      float d = shipSdf(q);
      if (d < 0.002) {
        sceneT = st;
        vec2 e = vec2(0.003, 0.0);
        vec3 nrm = normalize(vec3(shipSdf(q + e.xyy) - shipSdf(q - e.xyy), shipSdf(q + e.yxy) - shipSdf(q - e.yxy), shipSdf(q + e.yyx) - shipSdf(q - e.yyx)));
        float rim = pow(1.0 - abs(dot(nrm, rd)), 3.0);
        float outline = smoothstep(0.03, 0.0, abs(shipOutline(q.xz)));
        float spine = smoothstep(0.012, 0.0, abs(q.x)) * step(q.z, 0.45);
        col = ramp(0.1) * 0.25 + ramp(0.5) * max(nrm.y, 0.0) * 0.1 + palette(0.5) * rim * 0.6;
        col += palette(0.5 + 0.1 * uTimbre.x) * (outline * (1.6 + 1.5 * uMid) + spine * 0.8);
        break;
      }
      st += max(d, 0.004);
    }
  }

  // Engine: a hot core with a trail streaming back toward the camera.
  vec3 tail = ship + vec3(0.0, 0.0, -0.3);
  float tt;
  float ed = rayPointDist(ro, rd, tail, tt);
  if (tt < sceneT + 0.05) glow += ramp(0.95) * (0.004 / (ed * ed + 0.0006)) * (0.5 + 0.8 * uBass + 0.5 * uKick) * 0.06;
  ed = raySegmentDist(ro, rd, tail, tail + vec3(0.0, 0.0, -0.9 - 0.6 * uLoud), tt);
  if (tt < sceneT) glow += palette(0.55) * exp(-ed * 90.0) * 0.6;

  // ---- Lasers and explosions for every mine in range
  for (int i = 0; i < SLOTS; i++) {
    vec2 sn = uSnareHist[i];
    if (sn.x < FIRE_AGE || sn.x > LAST_AGE || !gMine[i]) continue;
    float n = obstacleId(i);
    if (sn.x < BLAST_AGE) {
      vec3 target = obstacleCenter(n, true, sn.x, sn.y);
      float f = (sn.x - FIRE_AGE) / (BLAST_AGE - FIRE_AGE);
      for (int w = 0; w < 2; w++) {
        vec3 muzzle = ship + vec3((float(w) * 2.0 - 1.0) * 0.36 * cos(roll), (float(w) * 2.0 - 1.0) * -0.36 * sin(roll), -0.2);
        vec3 head = mix(muzzle, target, f);
        vec3 back = mix(muzzle, target, max(f - 0.45, 0.0));
        float ld = raySegmentDist(ro, rd, back, head, tt);
        if (tt < sceneT + 0.1) {
          float px = ld / (0.004 * max(tt, 0.5));
          glow += mix(palette(0.05), ramp(1.0), 0.5) * (exp(-px * px) * 4.0 + exp(-px * 0.25) * 0.5) * p_lasers;
        }
        float md = rayPointDist(ro, rd, muzzle, tt);
        glow += ramp(1.0) * exp(-md * 40.0) * (1.0 - f) * p_lasers * 0.8;
      }
      continue;
    }
    // Shockwave shell, a white flash, and debris thrown forward with the land.
    float since = blastAge(i);
    vec3 c = blastCenter(i);
    float fade = exp(-since * 2.5);
    float cd = rayPointDist(ro, rd, c, tt);
    if (tt < sceneT + 1.0) {
      float radius = 0.15 + 1.1 * since * p_size;
      glow += palette(0.08 + 0.1 * hash11(n)) * exp(-abs(cd - radius) * 18.0) * fade * fade * 2.0 * p_blast;
      glow += mix(ramp(1.0), palette(0.05), 0.3) * exp(-cd * 4.0) * exp(-since * 7.0) * 2.5 * p_blast;
    }
    for (int k = 0; k < 10; k++) {
      vec3 dir = normalize(hash33(vec3(n, float(k), 3.7)) * 2.0 - 1.0 + vec3(0.0, 0.4, 0.0));
      vec3 bit = c + dir * since * (2.5 + 1.5 * hash11(float(k) + n)) * p_size + vec3(0.0, -3.0 * since * since, 0.0);
      if (bit.y < 0.0) continue;
      float bd = rayPointDist(ro, rd, bit, tt);
      if (tt < sceneT) glow += ramp(0.9) * exp(-bd / (0.006 * max(tt, 0.5))) * fade * 1.4 * p_blast;
    }
  }

  // ---- Melody contrail: the tune written across the sky, now above the sun, older toward the edges.
  if (sceneT > 1e8 && p_melody > 0.0) {
    float aspect = uResolution.x / uResolution.y;
    float age = abs(uv.x) / aspect;
    vec2 ml = melodyLine(age);
    float y = 0.32 + 0.55 * ml.x;
    float slope = (0.55 * melodyLine(age + 0.01).x + 0.32 - y) / (0.01 * aspect);
    float steep = sqrt(1.0 + slope * slope);
    float d = abs(uv.y - y) / steep;
    float w = 0.006 + 0.01 * uVoice;
    float line = smoothstep(w, w * 0.3, d) + exp(-d / (w * 4.0)) * 0.3;
    vec3 tint = mix(palette(0.6), vec3(1.0, 0.85, 0.7), 0.4 * uVoice);
    // Held notes draw bright; the jumps between them only faintly, so the tune reads as steps.
    float held = mix(0.15, 1.0, 1.0 / steep);
    glow += tint * line * held * smoothstep(0.15, 0.5, ml.y) * smoothstep(1.0, 0.6, age) * p_melody * 1.2;
  }

  if (sceneT < 1e8) {
    float far = sceneT / FAR;
    float fog = 1.0 - exp(-far * far * 4.0 * p_fog);
    col = mix(col, ramp(0.0) * 0.12 + horizonGlow(0.0), fog);
  }
  fragColor = vec4(col + glow, 1.0);
}
