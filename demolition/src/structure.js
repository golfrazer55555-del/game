// 구조 해석
//  1) 국부 지지: 아래층부터 올라가며 "아래가 받쳐 주는 블록"에서 재질별 허용 거리(span) 안에 있는 블록만 버틴다.
//     → 기둥을 여러 개 잃으면 그 위 슬래브가 떨어지고, 벽에 큰 구멍이 나면 위쪽 벽이 무너진다.
//  2) 전체 하중: 건물을 층(블록 한 줄 높이)마다 잘라 단면 강도, 위쪽 무게, 무게중심 편심을 계산한다.
//     편심 압축 공식 σ = P/A·(1 + e·c/ρ²)로 가장 위험한 층의 응력비를 구해
//     1을 넘으면 그 층이 압괴(한쪽부터 부서짐)하고, 무게중심이 받침 밖으로 나가면 통째로 넘어간다.
import { GX, GY, GZ, DESIGN_RATIO, WARN_RATIO, VS } from './config.js';
import { STRENGTH, DENSITY, SPAN, RUBBLE } from './materials.js';
import { LAYER, N } from './world.js';

const VOL = VS * VS * VS;

class Acc {
  constructor() {
    this.A = new Float64Array(GY); this.SX = new Float64Array(GY); this.SZ = new Float64Array(GY);
    this.SXX = new Float64Array(GY); this.SZZ = new Float64Array(GY);
    this.MW = new Float64Array(GY); this.MX = new Float64Array(GY); this.MZ = new Float64Array(GY);
    this.minX = new Int16Array(GY); this.maxX = new Int16Array(GY); this.minZ = new Int16Array(GY); this.maxZ = new Int16Array(GY);
    this.cnt = new Int32Array(GY);
    this.ratio = new Float32Array(GY);
  }
  reset(y0, y1) {
    for (let y = y0; y <= y1; y++) {
      this.A[y] = 0; this.SX[y] = 0; this.SZ[y] = 0; this.SXX[y] = 0; this.SZZ[y] = 0;
      this.MW[y] = 0; this.MX[y] = 0; this.MZ[y] = 0; this.cnt[y] = 0; this.ratio[y] = 0;
      this.minX[y] = 32767; this.maxX[y] = -1; this.minZ[y] = 32767; this.maxZ[y] = -1;
    }
  }
}

export class Structure {
  constructor(world) {
    this.w = world;
    this.label = new Uint16Array(N);
    this.order = new Int32Array(1 << 18);
    this.accPool = [];
    this.lastView = null;     // 구조 보기 화면용 데이터
    this.bufCap = 0;
  }

  ensureOrder(n) {
    if (this.order.length >= n) return;
    let cap = this.order.length;
    while (cap < n) cap *= 2;
    const o = new Int32Array(cap);
    o.set(this.order);
    this.order = o;
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
  // owners: 검사할 소유자 번호 집합. calibrate=true면 각 소유자의 설계 강도를 정한다.
  globalPass(owners, calibrate = false) {
    const w = this.w, mat = w.mat, own = w.own, lab = this.label;
    const res = { detach: [], topple: [], crush: [], warnings: [], views: [] };
    let nextLabel = 1;
    let op = 0;
    const comps = [];
    for (const o of owners) {
      const info = w.owners[o];
      if (!info || !info.box) continue;
      const b = info.box;
      // 이 소유자 범위의 표시 지우기
      for (let y = b.y0; y <= b.y1; y++) for (let z = b.z0; z <= b.z1; z++) {
        const s = b.x0 + GX * (z + GZ * y);
        lab.fill(0, s, s + (b.x1 - b.x0 + 1));
      }
      for (let y = b.y0; y <= b.y1; y++) for (let z = b.z0; z <= b.z1; z++) {
        const rowStart = b.x0 + GX * (z + GZ * y);
        for (let x = b.x0; x <= b.x1; x++) {
          const s = rowStart + x - b.x0;
          const m = mat[s];
          if (m === 0 || (m & RUBBLE) || own[s] !== o || lab[s] !== 0) continue;
          if (nextLabel >= 65000) break;
          const id = nextLabel++;
          const acc = this.accPool[comps.length] || (this.accPool[comps.length] = new Acc());
          acc.reset(0, GY - 1);
          const comp = { id, owner: o, start: op, end: op, grounded: false, y0: GY, y1: -1, acc, count: 0, mass: 0 };
          this.ensureOrder(op + 1);
          lab[s] = id;
          this.order[op++] = s;
          for (let h = comp.start; h < op; h++) {
            const i = this.order[h];
            const vx = i % GX, vz = ((i / GX) | 0) % GZ, vy = (i / LAYER) | 0;
            const vm = mat[i];
            // 통계 누적
            const st = STRENGTH[vm], ms = DENSITY[vm] * VOL;
            const cxp = vx + 0.5, czp = vz + 0.5;
            acc.A[vy] += st; acc.SX[vy] += st * cxp; acc.SZ[vy] += st * czp;
            acc.SXX[vy] += st * cxp * cxp; acc.SZZ[vy] += st * czp * czp;
            acc.MW[vy] += ms; acc.MX[vy] += ms * cxp; acc.MZ[vy] += ms * czp;
            acc.cnt[vy]++;
            if (vx < acc.minX[vy]) acc.minX[vy] = vx; if (vx > acc.maxX[vy]) acc.maxX[vy] = vx;
            if (vz < acc.minZ[vy]) acc.minZ[vy] = vz; if (vz > acc.maxZ[vy]) acc.maxZ[vy] = vz;
            if (vy < comp.y0) comp.y0 = vy; if (vy > comp.y1) comp.y1 = vy;
            comp.mass += ms;
            if (!comp.grounded) {
              if (vy === 0) comp.grounded = true;
              else { const bm = mat[i - LAYER]; if (bm !== 0 && ((bm & RUBBLE) || own[i - LAYER] !== o)) comp.grounded = true; }
            }
            this.ensureOrder(op + 6);
            const ord = this.order;
            if (vx > 0) { const j = i - 1; if (!lab[j] && mat[j] && !(mat[j] & RUBBLE) && own[j] === o) { lab[j] = id; ord[op++] = j; } }
            if (vx < GX - 1) { const j = i + 1; if (!lab[j] && mat[j] && !(mat[j] & RUBBLE) && own[j] === o) { lab[j] = id; ord[op++] = j; } }
            if (vz > 0) { const j = i - GX; if (!lab[j] && mat[j] && !(mat[j] & RUBBLE) && own[j] === o) { lab[j] = id; ord[op++] = j; } }
            if (vz < GZ - 1) { const j = i + GX; if (!lab[j] && mat[j] && !(mat[j] & RUBBLE) && own[j] === o) { lab[j] = id; ord[op++] = j; } }
            if (vy > 0) { const j = i - LAYER; if (!lab[j] && mat[j] && !(mat[j] & RUBBLE) && own[j] === o) { lab[j] = id; ord[op++] = j; } }
            if (vy < GY - 1) { const j = i + LAYER; if (!lab[j] && mat[j] && !(mat[j] & RUBBLE) && own[j] === o) { lab[j] = id; ord[op++] = j; } }
          }
          comp.end = op;
          comp.count = op - comp.start;
          comps.push(comp);
        }
      }
    }

    const calib = new Map();
    for (const comp of comps) {
      if (!comp.grounded) { res.detach.push(this.order.slice(comp.start, comp.end)); continue; }
      const info = w.owners[comp.owner];
      const k = calibrate ? 1 : info.kStrength || 1;
      const ev = this.evaluate(comp, k);
      if (calibrate) {
        calib.set(comp.owner, Math.max(calib.get(comp.owner) || 0, ev.maxRatio));
        continue;
      }
      if (info.kind === 'target') res.views.push(ev.view);
      if (ev.fail) {
        if (ev.fail.type === 'topple') {
          const list = [];
          for (let h = comp.start; h < comp.end; h++) { const i = this.order[h]; if (((i / LAYER) | 0) > ev.fail.y) list.push(i); }
          if (list.length) res.topple.push({ list, y: ev.fail.y, dirX: ev.fail.ex, dirZ: ev.fail.ez, owner: comp.owner });
        } else {
          res.crush.push(...this.crushList(comp, ev.fail, k));
        }
      } else if (ev.warn) {
        res.warnings.push(...this.warnVoxels(comp, ev.warn, k));
      }
    }
    if (calibrate) {
      for (const [o, raw] of calib) w.owners[o].kStrength = Math.max(1e-6, raw / DESIGN_RATIO);
    }
    return res;
  }

  // 층별 응력비 계산
  evaluate(comp, k) {
    const a = comp.acc;
    let P = 0, PX = 0, PZ = 0;
    let fail = null, maxRatio = 0, warn = null;
    let toppleY = -1;
    for (let y = comp.y1; y >= comp.y0; y--) {
      if (y < comp.y1) { P += a.MW[y + 1]; PX += a.MX[y + 1]; PZ += a.MZ[y + 1]; }
      if (P <= 0 || a.cnt[y] === 0) { a.ratio[y] = 0; continue; }
      const A = Math.max(a.A[y], 1e-4);
      const cx = a.SX[y] / A, cz = a.SZ[y] / A;
      const rx2 = Math.max(a.SXX[y] / A - cx * cx, 0) + 1 / 12;
      const rz2 = Math.max(a.SZZ[y] / A - cz * cz, 0) + 1 / 12;
      const comX = PX / P, comZ = PZ / P;
      const ex = comX - cx, ez = comZ - cz;
      const cX = ex >= 0 ? a.maxX[y] + 1 - cx : cx - a.minX[y];
      const cZ = ez >= 0 ? a.maxZ[y] + 1 - cz : cz - a.minZ[y];
      const ratio = (P / (A * k)) * (1 + Math.abs(ex) * cX / rx2 + Math.abs(ez) * cZ / rz2);
      a.ratio[y] = ratio;
      if (ratio > maxRatio) maxRatio = ratio;
      const outside = comX < a.minX[y] - 0.05 || comX > a.maxX[y] + 1.05 || comZ < a.minZ[y] - 0.05 || comZ > a.maxZ[y] + 1.05;
      if (outside && y < comp.y1 - 1) toppleY = y;   // 가장 낮은 전도 층 기억
      if (ratio > 1 && (!fail || ratio > fail.ratio)) fail = { type: 'crush', y, ratio, cx, cz, rx2, rz2, ex, ez, P, A };
      if (ratio > WARN_RATIO && ratio <= 1 && (!warn || ratio > warn.ratio)) warn = { y, ratio, cx, cz, rx2, rz2, ex, ez, P, A };
    }
    if (toppleY >= 0) {
      // 전도: 해당 층 위 전체가 한 덩어리로 넘어간다
      let P2 = 0, PX2 = 0, PZ2 = 0;
      for (let y = comp.y1; y > toppleY; y--) { P2 += a.MW[y]; PX2 += a.MX[y]; PZ2 += a.MZ[y]; }
      const A = Math.max(a.A[toppleY], 1e-4);
      fail = { type: 'topple', y: toppleY, ex: PX2 / P2 - a.SX[toppleY] / A, ez: PZ2 / P2 - a.SZ[toppleY] / A };
    }
    // 구조 보기용 요약
    let tP = 0, tX = 0, tZ = 0;
    for (let y = comp.y0; y <= comp.y1; y++) { tP += a.MW[y]; tX += a.MX[y]; tZ += a.MZ[y]; }
    const view = {
      owner: comp.owner, y0: comp.y0, y1: comp.y1, ratio: a.ratio.slice(comp.y0, comp.y1 + 1),
      minX: a.minX.slice(comp.y0, comp.y1 + 1), maxX: a.maxX.slice(comp.y0, comp.y1 + 1),
      minZ: a.minZ.slice(comp.y0, comp.y1 + 1), maxZ: a.maxZ.slice(comp.y0, comp.y1 + 1),
      comX: tP ? tX / tP : 0, comZ: tP ? tZ / tP : 0, maxRatio, mass: comp.mass,
      baseMinX: a.minX[comp.y0], baseMaxX: a.maxX[comp.y0], baseMinZ: a.minZ[comp.y0], baseMaxZ: a.maxZ[comp.y0],
    };
    return { fail, maxRatio, warn, view };
  }

  // 압괴: 이용률 1을 넘는 블록과 그 위아래 한 칸씩
  crushList(comp, f, k) {
    const w = this.w, mat = w.mat, own = w.own;
    const scale = f.P / (f.A * k);
    const cand = [];
    for (let h = comp.start; h < comp.end; h++) {
      const i = this.order[h];
      if (((i / LAYER) | 0) !== f.y) continue;
      const x = i % GX + 0.5, z = ((i / GX) | 0) % GZ + 0.5;
      const u = scale * (1 + f.ex * (x - f.cx) / f.rx2 + f.ez * (z - f.cz) / f.rz2);
      cand.push([u, i]);
    }
    let crushed = cand.filter((c) => c[0] > 1);
    if (crushed.length === 0) {
      cand.sort((p, q) => q[0] - p[0]);
      crushed = cand.slice(0, Math.max(1, Math.ceil(cand.length * 0.25)));
    }
    const out = [];
    for (const [, i] of crushed) {
      out.push(i);
      const up = i + LAYER, dn = i - LAYER;
      if (up < N && mat[up] && !(mat[up] & RUBBLE) && own[up] === comp.owner) out.push(up);
      if (dn >= 0 && mat[dn] && !(mat[dn] & RUBBLE) && own[dn] === comp.owner) out.push(dn);
    }
    return out;
  }

  // 붕괴 예고: 가장 응력이 큰 쪽 블록 몇 개
  warnVoxels(comp, f, k) {
    const scale = f.P / (f.A * k);
    let best = [];
    for (let h = comp.start; h < comp.end; h++) {
      const i = this.order[h];
      if (((i / LAYER) | 0) !== f.y) continue;
      const x = i % GX + 0.5, z = ((i / GX) | 0) % GZ + 0.5;
      const u = scale * (1 + f.ex * (x - f.cx) / f.rx2 + f.ez * (z - f.cz) / f.rz2);
      if (best.length < 6) { best.push([u, i]); best.sort((p, q) => q[0] - p[0]); }
      else if (u > best[5][0]) { best[5] = [u, i]; best.sort((p, q) => q[0] - p[0]); }
    }
    return best.map(([u, i]) => ({ i, u, ratio: f.ratio, owner: comp.owner }));
  }

  snapshot() { return { lastView: this.lastView }; }
  restore(s) { this.lastView = s.lastView; }
}
