// 공용 수학/난수 도구

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 2D 밸류 노이즈 (0~1)
export function makeNoise2D(rand) {
  const perm = new Uint16Array(512);
  const vals = new Float32Array(256);
  for (let i = 0; i < 256; i++) { perm[i] = i; vals[i] = rand(); }
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const t = perm[i]; perm[i] = perm[j]; perm[j] = t;
  }
  for (let i = 0; i < 256; i++) perm[i + 256] = perm[i];
  const fade = (t) => t * t * (3 - 2 * t);
  return (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = fade(x - xi), yf = fade(y - yi);
    const X = xi & 255, Y = yi & 255, X1 = (X + 1) & 255;
    const v00 = vals[perm[perm[X] + Y]], v10 = vals[perm[perm[X1] + Y]];
    const v01 = vals[perm[perm[X] + Y + 1]], v11 = vals[perm[perm[X1] + Y + 1]];
    const a = v00 + (v10 - v00) * xf, b = v01 + (v11 - v01) * xf;
    return a + (b - a) * yf;
  };
}

export function fbm(noise, x, y, oct = 4) {
  let sum = 0, amp = 1, norm = 0, f = 1;
  for (let i = 0; i < oct; i++) {
    sum += noise(x * f, y * f) * amp;
    norm += amp; amp *= 0.5; f *= 2.03;
  }
  return sum / norm;
}

export function hash3(x, y, z) {
  let h = (x * 374761393 + y * 668265263 + z * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

// 평균 0, 표준편차 1 근사 정규분포
export function gauss(rand = Math.random) {
  return (rand() + rand() + rand() + rand() - 2) / 0.5774;
}

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const damp = (k, dt) => 1 - Math.exp(-k * dt);

export function smoothstep(e0, e1, x) {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}

export function normDeg(a) {
  a %= 360;
  return a < 0 ? a + 360 : a;
}

// a → b 로 가는 최단 각도 차 (-180, 180]
export function angleDiff(a, b) {
  let d = (b - a) % 360;
  if (d > 180) d -= 360;
  if (d <= -180) d += 360;
  return d;
}

// 방위각: 0 = 북(-z), 90 = 동(+x)
export function bearingTo(from, to) {
  return normDeg(Math.atan2(to.x - from.x, -(to.z - from.z)) * 180 / Math.PI);
}

// 탱크 로컬 좌표 (lx, lz) 를 방위각 yaw 만큼 돌린 월드 오프셋
export function rotY(lx, lz, yawDeg) {
  const r = yawDeg * Math.PI / 180, c = Math.cos(r), s = Math.sin(r);
  return [lx * c - lz * s, lx * s + lz * c];
}

export function loadPref(key, fallback) {
  try {
    const v = localStorage.getItem('lof.' + key);
    return v === null ? fallback : JSON.parse(v);
  } catch { return fallback; }
}

export function savePref(key, value) {
  try { localStorage.setItem('lof.' + key, JSON.stringify(value)); } catch { /* 저장 불가 환경 */ }
}
