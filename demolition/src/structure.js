// 구조 해석
//  1) 국부 지지: 아래층부터 올라가며 "아래가 받쳐 주는 블록"에서 재질별 허용 거리(span) 안에 있는 블록만 버틴다.
//     → 기둥을 여러 개 잃으면 그 위 슬래브가 떨어지고, 벽에 큰 구멍이 나면 위쪽 벽이 무너진다.
//  2) 전체 하중: 건물을 층(블록 한 줄 높이)마다 잘라 단면 강도, 위쪽 무게, 무게중심 편심을 계산한다.
//     편심 압축 공식 σ = P/A·(1 + e·c/ρ²)로 가장 위험한 층의 응력비를 구해
//     1을 넘으면 그 층이 압괴(한쪽부터 부서짐)하고, 무게중심이 받침 밖으로 나가면 통째로 넘어간다.
import { GX, GY, GZ, DESIGN_RATIO, WARN_RATIO } from './config.js';
import { SPAN, RUBBLE } from './materials.js';
import { LAYER, N } from './world.js';


export class Structure {
  constructor(world) {
    this.w = world;
    this.label = new Uint16Array(N);
    this.lastView = null;     // 구조 보기 화면용 데이터
    this.bufCap = 0;
    this.ratio = new Float32Array(GY);
    this.ext = new Int16Array(GY * 4);
  }

  // ───────────────────── 1) 국부 지지 검사 ─────────────────────
  // box: 손상 범위. 받쳐지지 않는 구조 블록 인덱스 배열을 돌려준다.
  localSupport(box) {
    const w = this.w, mat = w.mat;
    const E = 34;
    const x0 = Math.max(0, box.x0 - E), x1 = Math.min(GX - 1, box.x1 + E);
    const z0 = Math.max(0, box.z0 - E), z1 = Math.min(GZ - 1, box.z1 + E);
    const W = x1 - x0 + 1, D = z1 - z0 + 1, A = W * D;
    if (this.bufCap < A) {
      this.bufCap = A;
      this.prev = new Uint8Array(A); this.cur = new Uint8Array(A);
      this.dist = new Uint8Array(A); this.queue = new Int32Array(A);
    }
    let prev = this.prev, cur = this.cur;
    const dist = this.dist, queue = this.queue;
    const y0 = Math.max(0, box.y0);
    // 시작층 바로 아래는 "있으면 받쳐 준다"고 가정
    for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
      const c = (x - x0) + (z - z0) * W;
      prev[c] = y0 === 0 ? 1 : (mat[x + GX * (z + GZ * (y0 - 1))] !== 0 ? 1 : 0);
    }
    const out = [];
    const bx0 = x0 > 0, bx1 = x1 < GX - 1, bz0 = z0 > 0, bz1 = z1 < GZ - 1;
    for (let y = y0; y < GY; y++) {
      const base = y * LAYER;
      cur.fill(0, 0, A);
      let qt = 0, solid = 0, unsup = 0;
      for (let z = z0; z <= z1; z++) {
        const row = (z - z0) * W;
        const ib = base + GX * z;
        const zb = (z === z0 && bz0) || (z === z1 && bz1);
        for (let x = x0; x <= x1; x++) {
          const m = mat[ib + x];
          if (m === 0) continue;
          const c = row + x - x0;
          if (m & RUBBLE) { cur[c] = 1; continue; }
          solid++;
          if (prev[c] || zb || (x === x0 && bx0) || (x === x1 && bx1)) { cur[c] = 2; dist[c] = 0; queue[qt++] = c; }
        }
      }
      if (solid === 0) { if (y > box.y1) break; [prev, cur] = [cur, prev]; continue; }
      // 수평 전파 (재질별 허용 거리)
      let qh = 0;
      while (qh < qt) {
        const c = queue[qh++];
        const d = dist[c] + 1;
        const cx = c % W, cz = (c / W) | 0;
        const ib = base + GX * (cz + z0) + cx + x0;
        if (cx > 0 && !cur[c - 1]) { const m = mat[ib - 1]; if (m && !(m & RUBBLE) && d <= SPAN[m]) { cur[c - 1] = 2; dist[c - 1] = d; queue[qt++] = c - 1; } }
        if (cx < W - 1 && !cur[c + 1]) { const m = mat[ib + 1]; if (m && !(m & RUBBLE) && d <= SPAN[m]) { cur[c + 1] = 2; dist[c + 1] = d; queue[qt++] = c + 1; } }
        if (cz > 0 && !cur[c - W]) { const m = mat[ib - GX]; if (m && !(m & RUBBLE) && d <= SPAN[m]) { cur[c - W] = 2; dist[c - W] = d; queue[qt++] = c - W; } }
        if (cz < D - 1 && !cur[c + W]) { const m = mat[ib + GX]; if (m && !(m & RUBBLE) && d <= SPAN[m]) { cur[c + W] = 2; dist[c + W] = d; queue[qt++] = c + W; } }
      }
      for (let z = z0; z <= z1; z++) {
        const row = (z - z0) * W;
        const ib = base + GX * z;
        for (let x = x0; x <= x1; x++) {
          const m = mat[ib + x];
          if (m === 0 || (m & RUBBLE)) continue;
          if (!cur[row + x - x0]) { out.push(ib + x); unsup++; }
        }
      }
      if (unsup === 0 && y > box.y1 + 1) break;
      // 한 번에 너무 높이 올라가지 않는다: 떨어져 나간 자리에서 다음 검사가 이어서 올라간다 (연쇄 붕괴)
      if (y > box.y1 + 26) break;
      [prev, cur] = [cur, prev];
    }
    this.prev = prev; this.cur = cur;
    return out;
  }

  // 인덱스 목록을 서로 붙어 있는 덩어리로 나눈다
  groupVoxels(list) {
    const lab = this.label, w = this.w, mat = w.mat;
    const MARK = 65535, DONE = 65534;
    for (let k = 0; k < list.length; k++) lab[list[k]] = MARK;
    const groups = [];
    for (let k = 0; k < list.length; k++) {
      const s = list[k];
      if (lab[s] !== MARK) continue;
      const g = [s];
      lab[s] = DONE;
      for (let h = 0; h < g.length; h++) {
        const i = g[h];
        const x = i % GX, z = ((i / GX) | 0) % GZ, y = (i / LAYER) | 0;
        if (x > 0 && lab[i - 1] === MARK) { lab[i - 1] = DONE; g.push(i - 1); }
        if (x < GX - 1 && lab[i + 1] === MARK) { lab[i + 1] = DONE; g.push(i + 1); }
        if (z > 0 && lab[i - GX] === MARK) { lab[i - GX] = DONE; g.push(i - GX); }
        if (z < GZ - 1 && lab[i + GX] === MARK) { lab[i + GX] = DONE; g.push(i + GX); }
        if (y > 0 && lab[i - LAYER] === MARK) { lab[i - LAYER] = DONE; g.push(i - LAYER); }
        if (y < GY - 1 && lab[i + LAYER] === MARK) { lab[i + LAYER] = DONE; g.push(i + LAYER); }
      }
      groups.push(g);
    }
    for (let k = 0; k < list.length; k++) lab[list[k]] = 0;
    void mat;
    return groups;
  }

  // ───────────────────── 2) 전체 하중 검사 ─────────────────────
  // 소유자별 층 통계(World.st)로 계산하므로 블록 수와 상관없이 빠르다.
  // owners: 검사할 소유자 번호들. calibrate=true면 각 소유자의 설계 강도(kStrength)를 정한다.
  globalPass(owners, calibrate = false) {
    const w = this.w;
    const res = { detach: [], topple: [], crush: [], warnings: [], views: [] };
    for (const o of owners) {
      const info = w.owners[o], S = w.st[o];
      if (!info || !info.box || !S) continue;
      const k = calibrate ? 1 : info.kStrength || 1;
      const ev = this.evaluate(o, S, k);
      if (!ev) continue;
      if (calibrate) { info.kStrength = Math.max(1e-6, ev.maxRatio / DESIGN_RATIO); continue; }
      if (info.kind === 'target') res.views.push(ev.view);
      if (ev.fail) {
        if (ev.fail.type === 'topple') {
          const list = this.collectAbove(o, info.box, ev.fail.y);
          if (list.length) res.topple.push({ list, y: ev.fail.y, dirX: ev.fail.ex, dirZ: ev.fail.ez, owner: o });
        } else res.crush.push(...this.crushList(o, info.box, ev.fail));
      } else if (ev.warn) res.warnings.push(...this.warnVoxels(o, info.box, ev.warn));
    }
    return res;
  }

  // 층 단면의 x·z 범위 (히스토그램에서)
  extents(S, y) {
    const hx = S.hx, hz = S.hz, bx = y * GX, bz = y * GZ;
    let x0 = 0, x1 = GX - 1, z0 = 0, z1 = GZ - 1;
    while (x0 < GX && hx[bx + x0] <= 0) x0++;
    while (x1 >= 0 && hx[bx + x1] <= 0) x1--;
    while (z0 < GZ && hz[bz + z0] <= 0) z0++;
    while (z1 >= 0 && hz[bz + z1] <= 0) z1--;
    return [x0, x1, z0, z1];
  }

  evaluate(o, S, k) {
    let y0 = -1, y1 = -1;
    for (let y = 0; y < GY; y++) if (S.cnt[y] > 0) { if (y0 < 0) y0 = y; y1 = y; }
    if (y0 < 0) return null;
    const ratio = this.ratio, ext = this.ext;
    let P = 0, PX = 0, PZ = 0;
    let fail = null, maxRatio = 0, warn = null, toppleY = -1;
    for (let y = y1; y >= y0; y--) {
      if (y < y1) { P += S.MW[y + 1]; PX += S.MX[y + 1]; PZ += S.MZ[y + 1]; }
      ratio[y] = 0;
      if (S.cnt[y] <= 0) {
        // 단면이 완전히 끊긴 층: 위쪽 전체가 떠 있다
        if (P > 0) toppleY = Math.max(toppleY, y);
        continue;
      }
      const [ex0, ex1, ez0, ez1] = this.extents(S, y);
      ext[y * 4] = ex0; ext[y * 4 + 1] = ex1; ext[y * 4 + 2] = ez0; ext[y * 4 + 3] = ez1;
      if (P <= 0) continue;
      const A = Math.max(S.A[y], 1e-4);
      const cx = S.SX[y] / A, cz = S.SZ[y] / A;
      const rx2 = Math.max(S.SXX[y] / A - cx * cx, 0) + 1 / 12;
      const rz2 = Math.max(S.SZZ[y] / A - cz * cz, 0) + 1 / 12;
      const comX = PX / P, comZ = PZ / P;
      const ex = comX - cx, ez = comZ - cz;
      const cX = ex >= 0 ? ex1 + 1 - cx : cx - ex0;
      const cZ = ez >= 0 ? ez1 + 1 - cz : cz - ez0;
      const r = (P / (A * k)) * (1 + Math.abs(ex) * cX / rx2 + Math.abs(ez) * cZ / rz2);
      ratio[y] = r;
      if (r > maxRatio) maxRatio = r;
      const outside = comX < ex0 - 0.05 || comX > ex1 + 1.05 || comZ < ez0 - 0.05 || comZ > ez1 + 1.05;
      if (outside && y < y1 - 1) toppleY = y;     // 가장 낮은 전도 층
      if (r > 1 && (!fail || r > fail.ratio)) fail = { type: 'crush', y, ratio: r, cx, cz, rx2, rz2, ex, ez, P, A, k };
      if (r > WARN_RATIO && r <= 1 && (!warn || r > warn.ratio)) warn = { y, ratio: r, cx, cz, rx2, rz2, ex, ez, P, A, k };
    }
    if (toppleY >= 0) {
      let P2 = 0, PX2 = 0, PZ2 = 0;
      for (let y = y1; y > toppleY; y--) { P2 += S.MW[y]; PX2 += S.MX[y]; PZ2 += S.MZ[y]; }
      const A = Math.max(S.A[toppleY], 1e-4);
      const cx = S.cnt[toppleY] > 0 ? S.SX[toppleY] / A : PX2 / P2, cz = S.cnt[toppleY] > 0 ? S.SZ[toppleY] / A : PZ2 / P2;
      fail = { type: 'topple', y: toppleY, ex: PX2 / P2 - cx, ez: PZ2 / P2 - cz };
    }
    let tP = 0, tX = 0, tZ = 0;
    for (let y = y0; y <= y1; y++) { tP += S.MW[y]; tX += S.MX[y]; tZ += S.MZ[y]; }
    const view = {
      owner: o, y0, y1, ratio: ratio.slice(y0, y1 + 1), ext: ext.slice(y0 * 4, (y1 + 1) * 4),
      comX: tP ? tX / tP : 0, comZ: tP ? tZ / tP : 0, maxRatio, mass: tP,
    };
    return { fail, maxRatio, warn, view };
  }

  // 소유자의 y층 위 구조 블록 전부
  collectAbove(o, box, yFail) {
    const mat = this.w.mat, own = this.w.own, out = [];
    for (let y = yFail + 1; y <= box.y1; y++) for (let z = box.z0; z <= box.z1; z++) {
      const row = GX * (z + GZ * y);
      for (let x = box.x0; x <= box.x1; x++) {
        const i = row + x, m = mat[i];
        if (m && !(m & RUBBLE) && own[i] === o) out.push(i);
      }
    }
    return out;
  }

  layerVoxels(o, box, y, f, fn) {
    const mat = this.w.mat, own = this.w.own;
    const scale = f.P / (f.A * f.k);
    for (let z = box.z0; z <= box.z1; z++) {
      const row = GX * (z + GZ * y);
      for (let x = box.x0; x <= box.x1; x++) {
        const i = row + x, m = mat[i];
        if (!m || (m & RUBBLE) || own[i] !== o) continue;
        const u = scale * (1 + f.ex * (x + 0.5 - f.cx) / f.rx2 + f.ez * (z + 0.5 - f.cz) / f.rz2);
        fn(i, u);
      }
    }
  }

  // 압괴: 이용률 1을 넘는 블록과 그 위아래 한 칸씩
  crushList(o, box, f) {
    const mat = this.w.mat, own = this.w.own;
    const cand = [];
    this.layerVoxels(o, box, f.y, f, (i, u) => cand.push([u, i]));
    let crushed = cand.filter((c) => c[0] > 1);
    if (crushed.length === 0) {
      cand.sort((p, q) => q[0] - p[0]);
      crushed = cand.slice(0, Math.max(1, Math.ceil(cand.length * 0.25)));
    }
    const out = [];
    for (const [, i] of crushed) {
      out.push(i);
      const up = i + LAYER, dn = i - LAYER;
      if (up < N && mat[up] && !(mat[up] & RUBBLE) && own[up] === o) out.push(up);
      if (dn >= 0 && mat[dn] && !(mat[dn] & RUBBLE) && own[dn] === o) out.push(dn);
    }
    return out;
  }

  // 붕괴 예고: 가장 응력이 큰 쪽 블록 몇 개
  warnVoxels(o, box, f) {
    const best = [];
    this.layerVoxels(o, box, f.y, f, (i, u) => {
      if (best.length < 6) { best.push([u, i]); best.sort((p, q) => q[0] - p[0]); }
      else if (u > best[5][0]) { best[5] = [u, i]; best.sort((p, q) => q[0] - p[0]); }
    });
    return best.map(([u, i]) => ({ i, u, ratio: f.ratio, owner: o }));
  }

  snapshot() { return { lastView: this.lastView }; }
  restore(s) { this.lastView = s.lastView; }
}
