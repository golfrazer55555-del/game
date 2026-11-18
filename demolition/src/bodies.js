// 떨어져 나온 블록 덩어리 = 동적 강체. 부딪히면 부딪힌 자리부터 부서지고, 멈추면 잔해가 되어 월드에 다시 붙는다.
import { RAPIER, greedyBoxes } from './physics.js';
import { VS, GX, GY, GZ, E_UNIT } from './config.js';
import { DENSITY, TOUGH, RUBBLE, BASE } from './materials.js';
import { LAYER } from './world.js';
import { qrot, qrotInv } from './util.js';

const VOL = VS * VS * VS;
let visitBuf = new Uint8Array(1 << 16);
const tmp = [0, 0, 0];

export class VBody {
  constructor(id, lx, ly, lz, o) {
    this.id = id;
    this.lx = lx; this.ly = ly; this.lz = lz;
    this.o = o;                         // 생성 당시 월드 블록 좌표 (셰이더 무늬 고정용)
    this.mat = new Uint8Array(lx * ly * lz);
    this.own = new Uint8Array(lx * ly * lz);
    this.count = 0; this.mass = 0; this.tough = 0;
    this.handle = -1; this.cols = [];
    this.pos = { x: 0, y: 0, z: 0 }; this.rot = { x: 0, y: 0, z: 0, w: 1 };
    this.prevV = { x: 0, y: 0, z: 0 };
    this.rest = 0; this.age = 0;
    this.subDirty = new Set();
    this.needSplit = false; this.colDirty = false; this.lastCol = 0; this.lastSplit = 0;
    this.impacts = 0;
  }
  li(x, y, z) { return x + this.lx * (z + this.lz * y); }
  subOf(x, y, z) { const nsx = Math.ceil(this.lx / 16), nsz = Math.ceil(this.lz / 16); return (x >> 4) + nsx * ((z >> 4) + nsz * (y >> 4)); }
  markAll() { const n = Math.ceil(this.lx / 16) * Math.ceil(this.ly / 16) * Math.ceil(this.lz / 16); for (let s = 0; s < n; s++) this.subDirty.add(s); }
  markVox(x, y, z) {
    this.subDirty.add(this.subOf(x, y, z));
    if ((x & 15) === 0 && x > 0) this.subDirty.add(this.subOf(x - 1, y, z));
    if ((x & 15) === 15 && x < this.lx - 1) this.subDirty.add(this.subOf(x + 1, y, z));
    if ((y & 15) === 0 && y > 0) this.subDirty.add(this.subOf(x, y - 1, z));
    if ((y & 15) === 15 && y < this.ly - 1) this.subDirty.add(this.subOf(x, y + 1, z));
    if ((z & 15) === 0 && z > 0) this.subDirty.add(this.subOf(x, y, z - 1));
    if ((z & 15) === 15 && z < this.lz - 1) this.subDirty.add(this.subOf(x, y, z + 1));
  }
  recount() {
    let c = 0, m = 0, t = 0;
    for (let i = 0; i < this.mat.length; i++) { const v = this.mat[i]; if (v) { c++; m += DENSITY[v] * VOL; t += TOUGH[v]; } }
    this.count = c; this.mass = m; this.tough = c ? t / c : 1;
  }
  // 로컬 칸 중심 → 월드 미터
  toWorld(x, y, z, out) {
    qrot(this.rot, (x + 0.5) * VS, (y + 0.5) * VS, (z + 0.5) * VS, out);
    out[0] += this.pos.x; out[1] += this.pos.y; out[2] += this.pos.z;
    return out;
  }
}

export class Bodies {
  constructor(sim) {
    this.sim = sim;
    this.list = [];
    this.byId = new Map();
    this.nextId = 1;
    this.max = 56;
    this.lost = 0;
  }

  get pw() { return this.sim.phys.pw; }

  // 월드 블록들을 떼어 낸다
  fromWorld(indices, opts = {}) {
    const sim = this.sim, w = sim.world, mat = w.mat;
    if (indices.length < 6 || this.list.length >= this.max) {
      sim.damage.removeWorld(indices, { mode: 'fail', vel: [0, -1, 0] });
      return null;
    }
    let x0 = GX, y0 = GY, z0 = GZ, x1 = -1, y1 = -1, z1 = -1;
    for (const i of indices) {
      const x = i % GX, z = ((i / GX) | 0) % GZ, y = (i / LAYER) | 0;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; if (z < z0) z0 = z; if (z > z1) z1 = z;
    }
    const b = new VBody(this.nextId++, x1 - x0 + 1, y1 - y0 + 1, z1 - z0 + 1, [x0, y0, z0]);
    for (const i of indices) {
      const m = mat[i];
      if (!m) continue;
      const x = i % GX, z = ((i / GX) | 0) % GZ, y = (i / LAYER) | 0;
      const li = b.li(x - x0, y - y0, z - z0);
      b.mat[li] = m;
      b.own[li] = w.own[i];
    }
    for (const i of indices) w.remove(i);
    b.recount();
    b.pos = { x: x0 * VS, y: y0 * VS, z: z0 * VS };
    b.markAll();
    this.attach(b, opts.vel || { x: 0, y: 0, z: 0 }, opts.ang || { x: 0, y: 0, z: 0 });
    return b;
  }

  attach(b, lin, ang) {
    const desc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(b.pos.x, b.pos.y, b.pos.z)
      .setRotation(b.rot)
      .setLinvel(lin.x, lin.y, lin.z)
      .setAngvel(ang)
      .setLinearDamping(0.04)
      .setAngularDamping(0.3)
      .setCanSleep(true);
    if (b.count < 600) desc.setCcdEnabled(true);
    const rb = this.pw.createRigidBody(desc);
    b.handle = rb.handle;
    b.prevV = { x: lin.x, y: lin.y, z: lin.z };
    this.buildColliders(b);
    this.list.push(b);
    this.byId.set(b.id, b);
  }

  buildColliders(b) {
    const pw = this.pw, info = this.sim.phys.info;
    for (const h of b.cols) { const c = pw.getCollider(h); if (c) pw.removeCollider(c, false); info.delete(h); }
    b.cols = [];
    const rb = pw.getRigidBody(b.handle);
    if (!rb) return;
    const C = b.count <= 5000 ? 1 : b.count <= 40000 ? 2 : 4;
    const sx = Math.ceil(b.lx / C), sy = Math.ceil(b.ly / C), sz = Math.ceil(b.lz / C);
    const n = sx * sy * sz;
    if (visitBuf.length < n) visitBuf = new Uint8Array(n * 2);
    let occ = null;
    if (C > 1) {
      occ = new Uint16Array(n);
      for (let y = 0; y < b.ly; y++) for (let z = 0; z < b.lz; z++) for (let x = 0; x < b.lx; x++) {
        if (b.mat[b.li(x, y, z)]) occ[((x / C) | 0) + sx * (((z / C) | 0) + sz * ((y / C) | 0))]++;
      }
    }
    const thr = C === 1 ? 1 : Math.max(1, Math.round(C * C * C * 0.3));
    const get = C === 1 ? (x, y, z) => b.mat[b.li(x, y, z)] !== 0 : (x, y, z) => occ[x + sx * (z + sz * y)] >= thr;
    const boxes = greedyBoxes(get, sx, sy, sz, visitBuf, 700);
    let totalMass = 0;
    for (const [x, y, z, w, h, d] of boxes) {
      // 이 상자 안 실제 블록 질량
      const X0 = x * C, Y0 = y * C, Z0 = z * C;
      const X1 = Math.min(b.lx, (x + w) * C), Y1 = Math.min(b.ly, (y + h) * C), Z1 = Math.min(b.lz, (z + d) * C);
      let mass = 0;
      for (let yy = Y0; yy < Y1; yy++) for (let zz = Z0; zz < Z1; zz++) for (let xx = X0; xx < X1; xx++) {
        const m = b.mat[b.li(xx, yy, zz)]; if (m) mass += DENSITY[m] * VOL;
      }
      if (mass <= 0) continue;
      const hx = (X1 - X0) * VS / 2, hy = (Y1 - Y0) * VS / 2, hz = (Z1 - Z0) * VS / 2;
      const vol = hx * hy * hz * 8;
      const desc = RAPIER.ColliderDesc.cuboid(hx * 0.98, hy * 0.98, hz * 0.98)
        .setTranslation(X0 * VS + hx, Y0 * VS + hy, Z0 * VS + hz)
        .setDensity(mass / vol).setFriction(0.75).setRestitution(0.04);
      const c = pw.createCollider(desc, rb);
      b.cols.push(c.handle);
      info.set(c.handle, { kind: 'body', bodyId: b.id, body: b });
      totalMass += mass;
    }
    b.colDirty = false;
    b.lastCol = this.sim.tick;
    if (!b.cols.length) this.removeBody(b);
  }

  removeBody(b) {
    const pw = this.pw, info = this.sim.phys.info;
    for (const h of b.cols) { const c = pw.getCollider(h); if (c) pw.removeCollider(c, false); info.delete(h); }
    b.cols = [];
    const rb = pw.getRigidBody(b.handle);
    if (rb) pw.removeRigidBody(rb);
    b.handle = -1;
    const k = this.list.indexOf(b);
    if (k >= 0) this.list.splice(k, 1);
    this.byId.delete(b.id);
  }

  // 물리 한 단계 뒤 처리
  postStep() {
    const sim = this.sim, pw = this.pw;
    const impacts = [];
    for (let k = 0; k < this.list.length; k++) {
      const b = this.list[k];
      const rb = pw.getRigidBody(b.handle);
      if (!rb) continue;
      const t = rb.translation(), q = rb.rotation(), v = rb.linvel(), av = rb.angvel();
      b.pos = { x: t.x, y: t.y, z: t.z }; b.rot = { x: q.x, y: q.y, z: q.z, w: q.w };
      const dvx = v.x - b.prevV.x, dvy = v.y - b.prevV.y, dvz = v.z - b.prevV.z;
      const dv = Math.hypot(dvx, dvy, dvz);
      if (dv > 2.4 && b.age > 1) impacts.push([b, dv, v]);
      const speed = Math.hypot(v.x, v.y, v.z), spin = Math.hypot(av.x, av.y, av.z);
      if (speed < 0.3 && spin < 0.35) b.rest++; else b.rest = 0;
      b.age++;
      b.prevV = { x: v.x, y: v.y, z: v.z };
    }
    for (const [b, dv, v] of impacts) if (this.byId.has(b.id)) this.impact(b, dv, v);
    // 정리: 굳히기, 쪼개기, 충돌체 갱신
    for (let k = this.list.length - 1; k >= 0; k--) {
      const b = this.list[k];
      if (!b) continue;
      const rb = pw.getRigidBody(b.handle);
      if (!rb) { this.list.splice(k, 1); this.byId.delete(b.id); continue; }
      if (b.count < 4) { this.dissolve(b); continue; }
      if (b.pos.y < -12) { this.lost += b.count; this.removeBody(b); continue; }
      if (b.rest > 40 || rb.isSleeping() || b.age > 60 * 25) { this.bake(b); continue; }
      if (b.needSplit && sim.tick - b.lastSplit > 5) this.split(b);
      if (b.colDirty && sim.tick - b.lastCol > 5 && this.byId.has(b.id)) this.buildColliders(b);
    }
  }

  // 충돌: 접촉점 주변 블록을 양쪽에서 부순다
  impact(b, dv, vNow) {
    const sim = this.sim, pw = this.pw, info = sim.phys.info;
    const E = 0.5 * b.mass * Math.max(0, dv * dv - 4);
    if (E <= 0) return;
    const pts = [];
    for (const h of b.cols) {
      if (pts.length >= 24) break;
      const col = pw.getCollider(h);
      if (!col) continue;
      pw.contactPairsWith(col, (other) => {
        if (pts.length >= 24) return;
        pw.contactPair(col, other, (man) => {
          const nc = man.numSolverContacts();
          for (let i = 0; i < nc && pts.length < 24; i++) {
            const p = man.solverContactPoint(i);
            pts.push({ x: p.x, y: p.y, z: p.z, other: other.handle });
          }
        });
      });
    }
    if (!pts.length) return;
    // 접촉점은 최대 8개만
    const step = Math.max(1, Math.floor(pts.length / 8));
    const use = [];
    for (let i = 0; i < pts.length && use.length < 8; i += step) use.push(pts[i]);
    const budget = E / (E_UNIT * Math.max(0.15, b.tough));
    const per = budget / use.length;
    const r = Math.min(6.5, Math.max(0.9, Math.cbrt(per * 3 / (4 * Math.PI))));
    let crushedB = 0, crushedO = 0;
    const vel = [b.prevV.x * 0.3, Math.max(-4, b.prevV.y * 0.2), b.prevV.z * 0.3];
    for (const p of use) {
      crushedB += this.crushAt(b, p.x, p.y, p.z, r, vel);
      const oi = info.get(p.other);
      if (!oi) continue;
      if (oi.kind === 'static') crushedO += sim.damage.crushWorldAt(p.x, p.y, p.z, r * 0.9, { vel });
      else if (oi.kind === 'body' && oi.body && oi.body !== b && this.byId.has(oi.body.id)) crushedO += this.crushAt(oi.body, p.x, p.y, p.z, r * 0.75, vel);
    }
    b.impacts++;
    const rb = pw.getRigidBody(b.handle);
    if (rb && crushedB + crushedO > 0) {
      const keep = 0.2 + 0.6 * (crushedO / (crushedB + crushedO + 2));
      const nv = { x: vNow.x + (b.prevV.x - vNow.x) * keep, y: vNow.y + (b.prevV.y - vNow.y) * keep, z: vNow.z + (b.prevV.z - vNow.z) * keep };
      // prevV는 이미 이번 틱 값으로 바뀌었으므로 충돌 전 속도 추정에 dv 방향 사용
      rb.setLinvel(nv, true);
      b.prevV = nv;
    }
    sim.fx.push({ t: 'impact', x: use[0].x, y: use[0].y, z: use[0].z, e: E, n: crushedB + crushedO });
    // 크게 부딪히면 여러 조각으로 깨진다
    if (dv > 6.5 && b.count > 260 && this.byId.has(b.id)) this.fracture(b, dv);
  }

  // 월드 좌표 지점 반경 r칸 안의 바디 블록 부수기
  crushAt(b, px, py, pz, r, vel) {
    qrotInv(b.rot, px - b.pos.x, py - b.pos.y, pz - b.pos.z, tmp);
    const fx = tmp[0] / VS, fy = tmp[1] / VS, fz = tmp[2] / VS;
    const R = Math.ceil(r);
    const ix = Math.floor(fx), iy = Math.floor(fy), iz = Math.floor(fz);
    const pts = [];
    const out = [0, 0, 0];
    for (let y = Math.max(0, iy - R); y <= Math.min(b.ly - 1, iy + R); y++) for (let z = Math.max(0, iz - R); z <= Math.min(b.lz - 1, iz + R); z++) for (let x = Math.max(0, ix - R); x <= Math.min(b.lx - 1, ix + R); x++) {
      const li = b.li(x, y, z);
      const m = b.mat[li];
      if (!m) continue;
      const dx = x + 0.5 - fx, dy = y + 0.5 - fy, dz = z + 0.5 - fz;
      const rr = r / Math.max(0.35, Math.cbrt(TOUGH[m]));
      if (dx * dx + dy * dy + dz * dz >= rr * rr) continue;
      b.toWorld(x, y, z, out);
      pts.push(out[0], out[1], out[2], m, b.own[li]);
      b.mat[li] = 0; b.own[li] = 0;
      b.count--; b.mass -= DENSITY[m] * VOL;
      b.markVox(x, y, z);
    }
    if (!pts.length) return 0;
    b.needSplit = true; b.colDirty = true;
    this.sim.damage.scatterLoose(pts, { mode: 'crush', vel, jitter: 2 });
    return pts.length / 5;
  }

  // 연결이 끊긴 조각 분리
  split(b) {
    b.needSplit = false;
    b.lastSplit = this.sim.tick;
    if (b.count > 90000) return;
    const n = b.mat.length;
    const lab = new Int32Array(n);
    const comps = [];
    const stack = [];
    for (let s = 0; s < n; s++) {
      if (!b.mat[s] || lab[s]) continue;
      const id = comps.length + 1;
      const cells = [s];
      lab[s] = id;
      for (let h = 0; h < cells.length; h++) {
        const i = cells[h];
        const x = i % b.lx, z = ((i / b.lx) | 0) % b.lz, y = (i / (b.lx * b.lz)) | 0;
        const L = b.lx * b.lz;
        if (x > 0 && b.mat[i - 1] && !lab[i - 1]) { lab[i - 1] = id; cells.push(i - 1); }
        if (x < b.lx - 1 && b.mat[i + 1] && !lab[i + 1]) { lab[i + 1] = id; cells.push(i + 1); }
        if (z > 0 && b.mat[i - b.lx] && !lab[i - b.lx]) { lab[i - b.lx] = id; cells.push(i - b.lx); }
        if (z < b.lz - 1 && b.mat[i + b.lx] && !lab[i + b.lx]) { lab[i + b.lx] = id; cells.push(i + b.lx); }
        if (y > 0 && b.mat[i - L] && !lab[i - L]) { lab[i - L] = id; cells.push(i - L); }
        if (y < b.ly - 1 && b.mat[i + L] && !lab[i + L]) { lab[i + L] = id; cells.push(i + L); }
      }
      comps.push(cells);
    }
    void stack;
    if (comps.length <= 1) return;
    comps.sort((p, q) => q.length - p.length);
    for (let c = 1; c < comps.length; c++) this.extract(b, comps[c]);
    b.recount();
    b.colDirty = true;
    b.markAll();
  }

  // 바디 일부 칸을 새 바디로 (또는 작으면 흩뿌림)
  extract(b, cells, extraVel = null) {
    const sim = this.sim;
    if (cells.length < 8 || this.list.length >= this.max) {
      const pts = [];
      const out = [0, 0, 0];
      for (const i of cells) {
        const x = i % b.lx, z = ((i / b.lx) | 0) % b.lz, y = (i / (b.lx * b.lz)) | 0;
        b.toWorld(x, y, z, out);
        pts.push(out[0], out[1], out[2], b.mat[i], b.own[i]);
        b.mat[i] = 0; b.own[i] = 0;
        b.markVox(x, y, z);
      }
      sim.damage.scatterLoose(pts, { mode: 'crush', vel: [b.prevV.x, b.prevV.y, b.prevV.z], jitter: 1.2 });
      return null;
    }
    let x0 = 1e9, y0 = 1e9, z0 = 1e9, x1 = -1, y1 = -1, z1 = -1;
    for (const i of cells) {
      const x = i % b.lx, z = ((i / b.lx) | 0) % b.lz, y = (i / (b.lx * b.lz)) | 0;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; if (z < z0) z0 = z; if (z > z1) z1 = z;
    }
    const nb = new VBody(this.nextId++, x1 - x0 + 1, y1 - y0 + 1, z1 - z0 + 1, [b.o[0] + x0, b.o[1] + y0, b.o[2] + z0]);
    for (const i of cells) {
      const x = i % b.lx, z = ((i / b.lx) | 0) % b.lz, y = (i / (b.lx * b.lz)) | 0;
      const li = nb.li(x - x0, y - y0, z - z0);
      nb.mat[li] = b.mat[i]; nb.own[li] = b.own[i];
      b.mat[i] = 0; b.own[i] = 0;
      b.markVox(x, y, z);
    }
    nb.recount();
    // 새 바디 원점 = 원래 바디 로컬 (x0,y0,z0) 의 월드 위치
    qrot(b.rot, x0 * VS, y0 * VS, z0 * VS, tmp);
    nb.pos = { x: b.pos.x + tmp[0], y: b.pos.y + tmp[1], z: b.pos.z + tmp[2] };
    nb.rot = { ...b.rot };
    nb.markAll();
    const rb = this.pw.getRigidBody(b.handle);
    const v = rb ? rb.linvel() : b.prevV, av = rb ? rb.angvel() : { x: 0, y: 0, z: 0 };
    const lin = { x: v.x + (extraVel ? extraVel[0] : 0), y: v.y + (extraVel ? extraVel[1] : 0), z: v.z + (extraVel ? extraVel[2] : 0) };
    this.attach(nb, lin, { x: av.x, y: av.y, z: av.z });
    return nb;
  }

  // 큰 충격: 격자 모양으로 여러 조각으로 깨뜨린다
  fracture(b, dv) {
    const rng = this.sim.rng;
    const room = this.max - this.list.length;
    if (room < 2) return;
    const cell = b.count > 20000 ? 18 : b.count > 4000 ? 12 : 8;
    const ox = rng.int(cell), oy = rng.int(cell), oz = rng.int(cell);
    const groups = new Map();
    for (let y = 0; y < b.ly; y++) for (let z = 0; z < b.lz; z++) for (let x = 0; x < b.lx; x++) {
      const i = b.li(x, y, z);
      if (!b.mat[i]) continue;
      const key = (((x + ox) / cell) | 0) + 1000 * ((((y + oy) / cell) | 0) + 1000 * (((z + oz) / cell) | 0));
      let g = groups.get(key);
      if (!g) groups.set(key, (g = []));
      g.push(i);
    }
    if (groups.size < 2) return;
    const arr = [...groups.values()].sort((p, q) => q.length - p.length);
    const maxNew = Math.min(room - 1, 14);
    const sp = Math.min(3, dv * 0.25);
    // 남는 조각은 본체에 그대로 둔다 (나중에 split이 분리)
    for (let k = 1; k < arr.length && k <= maxNew; k++) this.extract(b, arr[k], [(rng.next() - 0.5) * sp, rng.next() * sp * 0.6, (rng.next() - 0.5) * sp]);
    b.recount();
    b.colDirty = true;
    b.needSplit = true;
    b.markAll();
    this.sim.fx.push({ t: 'fracture', x: b.pos.x, y: b.pos.y, z: b.pos.z, n: arr.length });
  }

  // 작은 바디는 파편으로
  dissolve(b) {
    const pts = [];
    const out = [0, 0, 0];
    for (let y = 0; y < b.ly; y++) for (let z = 0; z < b.lz; z++) for (let x = 0; x < b.lx; x++) {
      const i = b.li(x, y, z);
      if (!b.mat[i]) continue;
      b.toWorld(x, y, z, out);
      pts.push(out[0], out[1], out[2], b.mat[i], b.own[i]);
    }
    if (pts.length) this.sim.damage.scatterLoose(pts, { mode: 'crush', vel: [b.prevV.x, b.prevV.y, b.prevV.z], jitter: 1 });
    this.removeBody(b);
  }

  // 멈춘 바디를 잔해 블록으로 월드에 굳힌다
  bake(b) {
    const w = this.sim.world, mat = w.mat;
    const out = [0, 0, 0];
    const rub = this.sim.rubble;
    for (let y = 0; y < b.ly; y++) for (let z = 0; z < b.lz; z++) for (let x = 0; x < b.lx; x++) {
      const li = b.li(x, y, z);
      const m = b.mat[li];
      if (!m) continue;
      b.toWorld(x, y, z, out);
      const gx = Math.floor(out[0] / VS), gy = Math.floor(out[1] / VS), gz = Math.floor(out[2] / VS);
      const o = b.own[li];
      if (gx < 0 || gx >= GX || gz < 0 || gz >= GZ) { rub.outsideBy[o] = (rub.outsideBy[o] || 0) + 1; continue; }
      let yy = Math.max(0, Math.min(GY - 1, gy));
      let i = gx + GX * (gz + GZ * yy);
      let t = 0;
      while (mat[i] !== 0 && t < 4 && yy < GY - 1) { yy++; i += LAYER; t++; }
      if (mat[i] !== 0) continue;
      w.set(i, (m & BASE) | RUBBLE, o);
      w.rubbleActive.add(i);
    }
    this.sim.fx.push({ t: 'settle', x: b.pos.x, y: b.pos.y, z: b.pos.z, n: b.count });
    this.removeBody(b);
  }

  // 폭발 등 외부 충격량
  blastImpulse(cx, cy, cz, strength, radius) {
    for (const b of this.list) {
      const rb = this.pw.getRigidBody(b.handle);
      if (!rb) continue;
      const c = rb.worldCom ? rb.worldCom() : rb.translation();
      const dx = c.x - cx, dy = c.y - cy, dz = c.z - cz;
      const d = Math.hypot(dx, dy, dz);
      if (d > radius) continue;
      const f = strength * (1 - d / radius) / (d + 0.5);
      rb.applyImpulse({ x: dx / (d + 1e-3) * f, y: (dy / (d + 1e-3) + 0.3) * f, z: dz / (d + 1e-3) * f }, true);
    }
  }

  clear() {
    for (const b of [...this.list]) this.removeBody(b);
    this.list = [];
    this.byId.clear();
  }

  snapshot() {
    return {
      nextId: this.nextId, lost: this.lost,
      list: this.list.map((b) => ({
        id: b.id, lx: b.lx, ly: b.ly, lz: b.lz, o: b.o.slice(), mat: b.mat.slice(), own: b.own.slice(),
        count: b.count, mass: b.mass, tough: b.tough, handle: b.handle, cols: b.cols.slice(), pos: { ...b.pos }, rot: { ...b.rot },
        prevV: { ...b.prevV }, rest: b.rest, age: b.age, needSplit: b.needSplit, colDirty: b.colDirty, lastCol: b.lastCol, lastSplit: b.lastSplit, impacts: b.impacts,
      })),
    };
  }
  restore(s) {
    this.nextId = s.nextId; this.lost = s.lost;
    this.list = []; this.byId.clear();
    for (const d of s.list) {
      const b = new VBody(d.id, d.lx, d.ly, d.lz, d.o.slice());
      b.mat.set(d.mat); b.own.set(d.own);
      Object.assign(b, { count: d.count, mass: d.mass, tough: d.tough, handle: d.handle, cols: d.cols.slice(), pos: { ...d.pos }, rot: { ...d.rot },
        prevV: { ...d.prevV }, rest: d.rest, age: d.age, needSplit: d.needSplit, colDirty: d.colDirty, lastCol: d.lastCol, lastSplit: d.lastSplit, impacts: d.impacts });
      b.markAll();
      this.list.push(b);
      this.byId.set(b.id, b);
    }
  }
}
