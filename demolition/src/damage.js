// 파괴 처리: 블록을 없애고 파편·잔해·먼지·소리 이벤트를 만든다
import { VS, GX, GY, GZ, E_UNIT } from './config.js';
import { TOUGH, MCLS, CLS, COLOR, RUBBLE, GRANULAR, BASE, isStruct } from './materials.js';
import { LAYER } from './world.js';

// 방식별 연출 비율: 파편으로 날릴 비율, 나머지 중 잔해로 남길 비율, 한 번에 날릴 최대 파편 수
const MODES = {
  ball:   { part: 0.34, rub: 0.8, maxPart: 220, dust: 9 },
  blast:  { part: 0.42, rub: 0.6, maxPart: 420, dust: 7 },
  crush:  { part: 0.10, rub: 0.92, maxPart: 70, dust: 10 },
  fail:   { part: 0.07, rub: 0.94, maxPart: 60, dust: 8 },
  bite:   { part: 0.18, rub: 0.88, maxPart: 26, dust: 7 },
  hammer: { part: 0.28, rub: 0.85, maxPart: 18, dust: 6 },
  push:   { part: 0.22, rub: 0.88, maxPart: 40, dust: 8 },
};

export class Damage {
  constructor(sim) { this.sim = sim; }

  /**
   * 월드 블록 목록 제거 + 연출
   * opts: { mode, vel:[vx,vy,vz] 기본 속도, origin:[x,y,z](m) 폭발 중심, speed 방사 속도, ownerHit }
   */
  removeWorld(list, opts = {}) {
    if (!list.length) return { n: 0, cls: null };
    const sim = this.sim, w = sim.world, mat = w.mat, own = w.own, rng = sim.rng;
    const mode = MODES[opts.mode || 'ball'];
    const items = [];
    for (const i of list) {
      const m = mat[i];
      if (!m) continue;
      items.push(i, m, own[i]);
    }
    // 먼저 모두 비운다 (잔해가 아직 지워질 칸에 떨어지지 않도록)
    for (let k = 0; k < items.length; k += 3) w.remove(items[k]);
    return this.scatter(items, opts, mode, (k) => {
      const i = items[k];
      return [(i % GX + 0.5) * VS, (((i / LAYER) | 0) + 0.5) * VS, ((((i / GX) | 0) % GZ) + 0.5) * VS];
    });
  }

  // 덩어리(바디)에서 떨어져 나온 블록: pts = [x,y,z(m), m, own, ...] 5개씩
  scatterLoose(pts, opts = {}) {
    const mode = MODES[opts.mode || 'crush'];
    const items = [];
    for (let k = 0; k < pts.length; k += 5) items.push(k, pts[k + 3], pts[k + 4]);
    return this.scatter(items, opts, mode, (k) => [pts[items[k]], pts[items[k] + 1], pts[items[k] + 2]]);
  }

  scatter(items, opts, mode, posOf) {
    const sim = this.sim, rng = sim.rng, debris = sim.debris, rubble = sim.rubble;
    const n = items.length / 3;
    const cls = new Float32Array(8);
    let partBudget = Math.min(mode.maxPart, debris.max - debris.n);
    const vel = opts.vel || [0, 0, 0];
    const org = opts.origin;
    let sx = 0, sy = 0, sz = 0, cr = 0, cg = 0, cb = 0;
    const dustEvery = Math.max(1, Math.round(mode.dust * (n > 400 ? 3 : n > 120 ? 1.6 : 1)));
    let dustN = 0;
    for (let k = 0; k < items.length; k += 3) {
      const m = items[k + 1], o = items[k + 2];
      const c = MCLS[m];
      cls[c]++;
      const [x, y, z] = posOf(k);
      sx += x; sy += y; sz += z;
      cr += COLOR[m * 3]; cg += COLOR[m * 3 + 1]; cb += COLOR[m * 3 + 2];
      const glassy = c === CLS.glass || c === CLS.plant;
      const pPart = glassy ? Math.max(mode.part, 0.45) : mode.part;
      if (partBudget > 0 && rng.next() < pPart) {
        let vx = vel[0], vy = vel[1], vz = vel[2];
        if (org) {
          const dx = x - org[0], dy = y - org[1], dz = z - org[2];
          const d = Math.hypot(dx, dy, dz) + 0.3;
          const sp = (opts.speed || 10) * (0.4 + rng.next() * 0.8) / (0.6 + d * 0.5);
          vx += dx / d * sp; vy += dy / d * sp + rng.next() * 3; vz += dz / d * sp;
        }
        const j = opts.jitter ?? 2.2;
        vx += (rng.next() - 0.5) * j; vy += rng.next() * j * 0.8; vz += (rng.next() - 0.5) * j;
        const size = glassy ? 0.55 : rng.next() < 0.2 ? 1.6 : 1.0;
        if (debris.spawn(x, y, z, vx, vy, vz, m, o, size, rng)) partBudget--;
      } else if (!glassy && rng.next() < mode.rub) {
        const gx = Math.floor(x / VS) + (rng.int(3) - 1), gz = Math.floor(z / VS) + (rng.int(3) - 1);
        const gy = Math.floor(y / VS);
        if (gx >= 0 && gx < GX && gz >= 0 && gz < GZ && gy >= 0) rubble.place(gx, Math.min(gy, GY - 1), gz, (m & BASE) | RUBBLE | GRANULAR, o);
        else rubble.outsideBy[o] = (rubble.outsideBy[o] || 0) + 1;
      }
      // 먼지
      if (++dustN >= dustEvery) {
        dustN = 0;
        sim.fx.push({ t: 'dust', x, y, z, r: COLOR[m * 3], g: COLOR[m * 3 + 1], b: COLOR[m * 3 + 2], s: 1 + rng.next() * 1.5, vx: vel[0] * 0.15, vy: 0.4, vz: vel[2] * 0.15 });
      }
    }
    sx /= n; sy /= n; sz /= n;
    sim.fx.push({ t: 'break', x: sx, y: sy, z: sz, n, cls: Array.from(cls), mode: opts.mode || 'ball' });
    if (cls[CLS.glass] > 3) sim.fx.push({ t: 'glint', x: sx, y: sy, z: sz, n: cls[CLS.glass] });
    return { n, cls };
  }

  /**
   * 구형 손상. 재질별 반경 R_m = ∛(3E / (4π·E_UNIT·T_m)) 안의 블록이 부서진다.
   * 유리는 인성이 낮아 훨씬 넓게 깨진다. 반환: 소모 에너지, 부서진 수
   */
  sphere(cx, cy, cz, E, opts = {}) {
    const w = this.sim.world, mat = w.mat;
    const maxR = opts.maxR || 9;          // 칸
    const kV = 3 * E / (4 * Math.PI * E_UNIT);
    const rCap = Math.min(maxR * 4, Math.cbrt(kV / 0.02));
    const R = Math.ceil(Math.min(rCap, maxR * 3));
    const ix = Math.floor(cx / VS), iy = Math.floor(cy / VS), iz = Math.floor(cz / VS);
    const list = [];
    let used = 0;
    const fx = cx / VS, fy = cy / VS, fz = cz / VS;
    const onlyStruct = opts.onlyStruct;
    for (let y = Math.max(0, iy - R); y <= Math.min(GY - 1, iy + R); y++) {
      for (let z = Math.max(0, iz - R); z <= Math.min(GZ - 1, iz + R); z++) {
        const rowBase = GX * (z + GZ * y);
        for (let x = Math.max(0, ix - R); x <= Math.min(GX - 1, ix + R); x++) {
          const i = rowBase + x;
          const m = mat[i];
          if (!m) continue;
          if (onlyStruct && !isStruct(m)) continue;
          const T = TOUGH[m] || 0.01;
          let rm = Math.cbrt(kV / T);
          if (rm > maxR && MCLS[m] !== CLS.glass) rm = maxR;
          const dx = x + 0.5 - fx, dy = y + 0.5 - fy, dz = z + 0.5 - fz;
          const d2 = dx * dx + dy * dy + dz * dz;
          // 가장자리는 조금 들쭉날쭉하게
          const jag = 0.85 + ((x * 73856093 ^ y * 19349663 ^ z * 83492791) >>> 0) % 1000 / 1000 * 0.3;
          const rr = rm * jag;
          if (d2 < rr * rr) { list.push(i); used += T * E_UNIT; }
        }
      }
    }
    const res = this.removeWorld(list, opts);
    return { used, n: res.n, cls: res.cls };
  }

  // 충돌 지점 주변 구조 블록을 짓이긴다 (잔해는 쿠션 역할이라 그대로)
  crushWorldAt(px, py, pz, r, opts = {}) {
    const w = this.sim.world, mat = w.mat;
    const fx = px / VS, fy = py / VS, fz = pz / VS;
    const R = Math.ceil(r);
    const ix = Math.floor(fx), iy = Math.floor(fy), iz = Math.floor(fz);
    const list = [];
    let mass = 0;
    for (let y = Math.max(0, iy - R); y <= Math.min(GY - 1, iy + R); y++) for (let z = Math.max(0, iz - R); z <= Math.min(GZ - 1, iz + R); z++) for (let x = Math.max(0, ix - R); x <= Math.min(GX - 1, ix + R); x++) {
      const i = x + GX * (z + GZ * y);
      const m = mat[i];
      if (!m || !isStruct(m)) continue;
      const dx = x + 0.5 - fx, dy = y + 0.5 - fy, dz = z + 0.5 - fz;
      const rr = r / Math.max(0.35, Math.cbrt(TOUGH[m]));
      if (dx * dx + dy * dy + dz * dz < rr * rr) { list.push(i); mass += 1; }
    }
    if (list.length) this.removeWorld(list, { mode: 'crush', vel: opts.vel, jitter: 1.5 });
    return mass;
  }
}

export { MODES };
