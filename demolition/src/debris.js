// 날아가는 파편(시뮬레이션) — 땅에 떨어지면 잔해 블록이 되어 쌓인다
import { VS, GX, GY, GZ, GRAVITY } from './config.js';
import { MCLS, CLS, RUBBLE, GRANULAR, BASE } from './materials.js';
import { LAYER } from './world.js';

export class Debris {
  constructor(max = 3000) {
    this.setMax(max);
  }
  setMax(max) {
    this.max = max;
    const f = () => new Float32Array(max);
    this.px = f(); this.py = f(); this.pz = f();
    this.vx = f(); this.vy = f(); this.vz = f();
    this.rx = f(); this.ry = f(); this.spin = f();
    this.size = f(); this.life = f();
    this.mat = new Uint8Array(max); this.own = new Uint8Array(max);
    this.n = 0;
    this.outside = 0;     // 부지 밖(격자 밖)으로 나간 블록 수
  }

  spawn(x, y, z, vx, vy, vz, m, own, size, rng) {
    if (this.n >= this.max) return false;
    const k = this.n++;
    this.px[k] = x; this.py[k] = y; this.pz[k] = z;
    this.vx[k] = vx; this.vy[k] = vy; this.vz[k] = vz;
    this.rx[k] = rng.next() * 6.28; this.ry[k] = rng.next() * 6.28; this.spin[k] = (rng.next() - 0.5) * 16;
    this.size[k] = size; this.life[k] = 7;
    this.mat[k] = m; this.own[k] = own;
    return true;
  }

  // 한 틱 진행. 착지한 파편은 rubble.place로 넘긴다
  step(dt, world, rubble) {
    const mat = world.mat;
    const inv = 1 / VS;
    let n = this.n;
    for (let k = 0; k < n; k++) {
      let vx = this.vx[k], vy = this.vy[k] - GRAVITY * dt, vz = this.vz[k];
      const drag = 1 - 0.15 * dt;
      vx *= drag; vy *= drag; vz *= drag;
      let x = this.px[k], y = this.py[k], z = this.pz[k];
      let rest = false;
      // x
      let nx = x + vx * dt;
      if (this.solidAt(mat, nx * inv, y * inv, z * inv)) { vx *= -0.25; nx = x; }
      // z
      let nz = z + vz * dt;
      if (this.solidAt(mat, nx * inv, y * inv, nz * inv)) { vz *= -0.25; nz = z; }
      // y
      let ny = y + vy * dt;
      if (this.solidAt(mat, nx * inv, ny * inv, nz * inv)) {
        if (vy < 0) {
          // 바닥에 닿음
          ny = (Math.floor(y * inv)) * VS + 0.001;
          if (ny < 0) ny = 0.001;
          if (vy > -2.2 && Math.abs(vx) + Math.abs(vz) < 1.6) rest = true;
          vy *= -0.22; vx *= 0.55; vz *= 0.55;
          this.spin[k] *= 0.5;
        } else { vy = 0; ny = y; }
      }
      this.px[k] = nx; this.py[k] = ny; this.pz[k] = nz;
      this.vx[k] = vx; this.vy[k] = vy; this.vz[k] = vz;
      this.rx[k] += this.spin[k] * dt; this.ry[k] += this.spin[k] * 0.7 * dt;
      this.life[k] -= dt;
      if (rest || this.life[k] <= 0 || ny < -2) {
        this.land(k, world, rubble);
        // 마지막 원소를 당겨 채운다
        n--;
        this.copy(n, k);
        k--;
      }
    }
    this.n = n;
  }

  solidAt(mat, fx, fy, fz) {
    if (fy < 0) return true;
    const x = Math.floor(fx), y = Math.floor(fy), z = Math.floor(fz);
    if (x < 0 || x >= GX || z < 0 || z >= GZ || y >= GY) return false;
    return mat[x + GX * (z + GZ * y)] !== 0;
  }

  land(k, world, rubble) {
    const m = this.mat[k];
    const cls = MCLS[m];
    const x = Math.floor(this.px[k] / VS), y = Math.max(0, Math.floor(this.py[k] / VS)), z = Math.floor(this.pz[k] / VS);
    if (x < 0 || x >= GX || z < 0 || z >= GZ) { this.outside++; rubble.outsideBy[this.own[k]] = (rubble.outsideBy[this.own[k]] || 0) + 1; return; }
    if (cls === CLS.glass || cls === CLS.plant) return;   // 유리 조각·잎은 사라진다
    rubble.place(x, Math.min(y, GY - 1), z, (m & BASE) | RUBBLE | GRANULAR, this.own[k]);
  }

  copy(from, to) {
    if (from === to) return;
    this.px[to] = this.px[from]; this.py[to] = this.py[from]; this.pz[to] = this.pz[from];
    this.vx[to] = this.vx[from]; this.vy[to] = this.vy[from]; this.vz[to] = this.vz[from];
    this.rx[to] = this.rx[from]; this.ry[to] = this.ry[from]; this.spin[to] = this.spin[from];
    this.size[to] = this.size[from]; this.life[to] = this.life[from];
    this.mat[to] = this.mat[from]; this.own[to] = this.own[from];
  }

  clear() { this.n = 0; }

  snapshot() {
    const n = this.n;
    const s = { n, outside: this.outside };
    for (const key of ['px', 'py', 'pz', 'vx', 'vy', 'vz', 'rx', 'ry', 'spin', 'size', 'life', 'mat', 'own']) s[key] = this[key].slice(0, n);
    return s;
  }
  restore(s) {
    this.n = s.n; this.outside = s.outside;
    for (const key of ['px', 'py', 'pz', 'vx', 'vy', 'vz', 'rx', 'ry', 'spin', 'size', 'life', 'mat', 'own']) this[key].set(s[key]);
  }
}

// 잔해 블록: 받침이 없으면 떨어지고, 흘러내리는 잔해는 비탈을 따라 미끄러진다
export class Rubble {
  constructor(world) {
    this.w = world;
    this.outsideBy = {};       // 소유자별 부지 밖 잔해 수
    this.lotOutside = 0;
  }

  // (x,y,z) 칸에서 아래로 떨어뜨려 놓는다
  place(x, y, z, m, own) {
    const w = this.w, mat = w.mat;
    if (y >= GY) y = GY - 1;
    let i = x + GX * (z + GZ * y);
    // 이미 차 있으면 위로
    let tries = 0;
    while (mat[i] !== 0 && tries < 6 && y < GY - 1) { y++; i += LAYER; tries++; }
    if (mat[i] !== 0) return false;
    while (y > 0 && mat[i - LAYER] === 0) { y--; i -= LAYER; }
    w.set(i, m, own);
    if (m & GRANULAR) w.rubbleActive.add(i);
    return true;
  }

  // 활성 잔해 처리. maxMoves로 한 번에 움직이는 수를 제한
  step(rng, maxMoves = 500) {
    const w = this.w, mat = w.mat, own = w.own;
    const act = w.rubbleActive;
    if (!act.size) return 0;
    const items = [...act];
    act.clear();
    let moves = 0;
    for (let k = 0; k < items.length; k++) {
      const i = items[k];
      const m = mat[i];
      if (!(m & RUBBLE)) continue;
      if (moves >= maxMoves) { act.add(i); continue; }
      const y = (i / LAYER) | 0;
      if (y === 0) continue;
      const below = i - LAYER;
      if (mat[below] === 0) {
        // 자유 낙하: 바로 바닥까지
        let j = below, yy = y - 1;
        while (yy > 0 && mat[j - LAYER] === 0) { j -= LAYER; yy--; }
        const o = own[i];
        w.remove(i);
        w.set(j, m, o);
        act.add(j);
        moves++;
        continue;
      }
      if (!(m & GRANULAR)) continue;
      // 대각선 아래로 미끄러짐 (안식각)
      if (rng.next() < 0.35) { act.add(i); continue; }   // 천천히 흘러내리도록
      const x = i % GX, z = ((i / GX) | 0) % GZ;
      const dir = rng.int(4);
      let moved = false;
      for (let t = 0; t < 4 && !moved; t++) {
        const d = (dir + t) & 3;
        const dx = d === 0 ? 1 : d === 1 ? -1 : 0, dz = d === 2 ? 1 : d === 3 ? -1 : 0;
        const nx = x + dx, nz = z + dz;
        if (nx < 0 || nx >= GX || nz < 0 || nz >= GZ) continue;
        const side = i + dx + GX * dz;
        if (mat[side] !== 0 || mat[side - LAYER] !== 0) continue;
        const o = own[i];
        w.remove(i);
        let j = side - LAYER, yy = y - 1;
        while (yy > 0 && mat[j - LAYER] === 0) { j -= LAYER; yy--; }
        w.set(j, m, o);
        act.add(j);
        moves++;
        moved = true;
      }
    }
    return moves;
  }

  snapshot() { return { outsideBy: { ...this.outsideBy } }; }
  restore(s) { this.outsideBy = { ...s.outsideBy }; }
}
