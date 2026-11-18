// 유압 굴착기: 선회 + 붐/암/어태치먼트 3관절. 압쇄기(물어뜯기), 브레이커(쪼기), 버킷(잔해 퍼 담기).
//  조작은 실제 굴착기와 같은 두 레버 방식 (ISO 패턴).
import * as THREE from 'three';
import { RAPIER } from '../physics.js';
import { VS, GX, GY, GZ } from '../config.js';
import { MCLS, CLS, TOUGH, RUBBLE, BASE, isStruct } from '../materials.js';
import { clamp, approach, DEG } from '../util.js';
import { footprint, groundHeightAt, box, boxMat } from './common.js';

export const ATTACH = {
  crusher: { name: '압쇄기', len: 2.1 },
  breaker: { name: '브레이커', len: 2.2 },
  bucket: { name: '버킷', len: 1.55 },
};
export const BOOMSETS = {
  std: { name: '표준 붐', boom: 5.9, arm: 3.1, foot: 2.0 },
  long: { name: '롱붐(하이리치)', boom: 12.5, arm: 7.2, foot: 2.2 },
};

const FOOT_FWD = 0.95;

export class Excavator {
  constructor(sim, spawn, opts = {}) {
    this.kind = 'excavator';
    this.name = '굴착기';
    this.set = BOOMSETS[opts.boomset || 'std'];
    this.power = opts.power || 1;
    this.s = {
      x: spawn.x * VS, z: spawn.z * VS, y: 0, heading: spawn.heading || 0, pitch: 0, roll: 0,
      swing: 0, swingV: 0, boom: 28 * DEG, boomV: 0, arm: -95 * DEG, armV: 0, att: -40 * DEG, attV: 0,
      jaw: 1, travel: false, tv: 0, tw: 0, att_type: opts.attach || 'crusher',
      load: 0, loadMats: {}, hammerT: 0, biteT: 0, contact: false, engine: 0.2, dumpT: 0,
    };
    this.capacity = 380;
    this.active = false;
    this.truck = null;
    this.attachPhysics(sim);
  }

  attachPhysics(sim) {
    const pw = sim.phys.pw;
    const rb = pw.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(this.s.x, 2, this.s.z));
    const col = pw.createCollider(RAPIER.ColliderDesc.cuboid(0.5, 0.5, 0.7).setFriction(0.5), rb);
    this.rbHandle = rb.handle;
    sim.phys.info.set(col.handle, { kind: 'ball' });
  }

  setAttachment(t) { this.s.att_type = t; this.s.jaw = 1; }
  attLen() { return ATTACH[this.s.att_type].len; }
  yaw() { return this.s.heading + this.s.swing; }

  // 관절 위치들 (m): [붐 발, 붐 끝, 암 끝, 어태치먼트 끝]
  joints(st = this.s) {
    const y = st.heading + st.swing;
    const fx = Math.sin(y), fz = Math.cos(y);
    const F = [st.x + fx * FOOT_FWD, st.y + this.set.foot, st.z + fz * FOOT_FWD];
    const a1 = st.boom, a2 = a1 + st.arm, a3 = a2 + st.att;
    const L1 = this.set.boom, L2 = this.set.arm, L3 = this.attLen();
    const B = [F[0] + fx * Math.cos(a1) * L1, F[1] + Math.sin(a1) * L1, F[2] + fz * Math.cos(a1) * L1];
    const A = [B[0] + fx * Math.cos(a2) * L2, B[1] + Math.sin(a2) * L2, B[2] + fz * Math.cos(a2) * L2];
    const T = [A[0] + fx * Math.cos(a3) * L3, A[1] + Math.sin(a3) * L3, A[2] + fz * Math.cos(a3) * L3];
    return { F, B, A, T, fx, fz, a3 };
  }

  // 관절 막대들이 구조 블록에 박힌 정도 (앞쪽 집게 부분은 제외)
  penetration(sim, st) {
    const { F, B, A, T } = this.joints(st);
    const mat = sim.world.mat;
    let pen = 0, weak = [];
    const seg = (P, Q, from, to) => {
      const len = Math.hypot(Q[0] - P[0], Q[1] - P[1], Q[2] - P[2]);
      const n = Math.max(2, Math.ceil(len / 0.3));
      for (let k = Math.round(n * from); k <= Math.round(n * to); k++) {
        const t = k / n;
        const x = P[0] + (Q[0] - P[0]) * t, y = P[1] + (Q[1] - P[1]) * t, z = P[2] + (Q[2] - P[2]) * t;
        const gx = Math.floor(x / VS), gy = Math.floor(y / VS), gz = Math.floor(z / VS);
        if (gy < 0) { pen += 0.5; continue; }
        if (gx < 0 || gx >= GX || gz < 0 || gz >= GZ || gy >= GY) continue;
        const i = gx + GX * (gz + GZ * gy);
        const m = mat[i];
        if (m && isStruct(m)) { pen++; if (TOUGH[m] < 0.5) weak.push(i); }
      }
    };
    seg(F, B, 0.15, 1); seg(B, A, 0, 1);
    const front = this.s.att_type === 'bucket' ? 1 : 0.45;
    seg(A, T, 0, front);
    return { pen, weak };
  }

  step(dt, sim) {
    const s = this.s;
    const inp = this.active && sim.input ? sim.input : null;
    const lx = inp ? inp.lx : 0, ly = inp ? inp.ly : 0, rx = inp ? inp.rx : 0, ry = inp ? inp.ry : 0;
    const act = !!(inp && inp.a);
    if (inp && inp.travelToggle) s.travel = !s.travel;
    const iso = inp ? inp.iso : false;
    const P = this.power;
    // 목표 속도 (유압 응답 지연 포함)
    if (s.travel) {
      s.tv = approach(s.tv, ly * 1.5, 2 * dt);
      s.tw = approach(s.tw, -lx * 0.5, 1.2 * dt);
      s.swingV = approach(s.swingV, 0, 1.5 * dt); s.boomV = approach(s.boomV, 0, 2 * dt); s.armV = approach(s.armV, 0, 2 * dt); s.attV = approach(s.attV, 0, 3 * dt);
    } else {
      s.tv = approach(s.tv, 0, 3 * dt); s.tw = approach(s.tw, 0, 2 * dt);
      s.swingV = approach(s.swingV, -lx * 0.62, 1.5 * dt);
      s.armV = approach(s.armV, ly * 30 * DEG, 160 * DEG * dt);
      s.boomV = approach(s.boomV, (iso ? -ry : ry) * 24 * DEG, 130 * DEG * dt);
      s.attV = approach(s.attV, rx * 46 * DEG, 260 * DEG * dt);
    }
    const prev = { ...s };
    const before = this.penetration(sim, s);
    s.swing += s.swingV * dt;
    s.boom = clamp(s.boom + s.boomV * dt, -42 * DEG, 74 * DEG);
    s.arm = clamp(s.arm + s.armV * dt, -168 * DEG, -22 * DEG);
    s.att = clamp(s.att + s.attV * dt, -150 * DEG, 40 * DEG);
    // 구조물에 막히면 멈춘다 (약한 재질은 밀어서 부순다)
    const after = this.penetration(sim, s);
    s.contact = after.pen > 0;
    if (after.pen > before.pen) {
      if (after.weak.length && after.weak.length >= after.pen - before.pen) {
        const list = after.weak.slice(0, 40);
        const r = sim.damage.removeWorld(list, { mode: 'push', vel: [Math.sin(this.yaw()) * 1.2, -0.5, Math.cos(this.yaw()) * 1.2] });
        if (r.n) sim.fx.push({ t: 'bite', x: s.x, y: 2, z: s.z, v: 0.6 });
      } else {
        s.swing = prev.swing; s.boom = prev.boom; s.arm = prev.arm; s.att = prev.att;
        s.swingV *= 0.2; s.boomV *= 0.2; s.armV *= 0.2; s.attV *= 0.2;
      }
    }
    // 주행 (잔해 더미는 타고 오른다)
    if (Math.abs(s.tv) > 0.01 || Math.abs(s.tw) > 0.001) {
      const nh = s.heading + s.tw * dt;
      const nx = s.x + Math.sin(nh) * s.tv * dt, nz = s.z + Math.cos(nh) * s.tv * dt;
      const fp = footprint(sim.world, nx, nz, nh, 1.6, 2.2, 0.65, s.y);
      const inside = nx > 2 && nx < GX * VS - 2 && nz > 2 && nz < GZ * VS - 2;
      if (!fp.blocked && inside) { s.x = nx; s.z = nz; s.heading = nh; } else { s.tv = 0; s.tw = 0; }
    }
    // 바닥 높이·기울기
    const cs = Math.cos(s.heading), sn = Math.sin(s.heading);
    const hAt = (u, v) => groundHeightAt(sim.world, s.x + u * cs + v * sn, s.z - u * sn + v * cs, s.y);
    const hf = Math.max(hAt(-1.2, 2), hAt(1.2, 2)), hb = Math.max(hAt(-1.2, -2), hAt(1.2, -2));
    const hl = Math.max(hAt(1.4, 1.5), hAt(1.4, -1.5)), hr = Math.max(hAt(-1.4, 1.5), hAt(-1.4, -1.5));
    const targetY = Math.max(hf, hb, hl, hr) * 0.5 + (hf + hb + hl + hr) / 8;
    s.y = targetY > s.y ? approach(s.y, targetY, 1.2 * dt) : approach(s.y, targetY, 3 * dt);
    s.pitch = s.pitch * 0.9 + Math.atan2(hf - hb, 4) * 0.1;
    s.roll = s.roll * 0.9 + Math.atan2(hl - hr, 2.8) * 0.1;
    // ── 어태치먼트 동작 ──
    const J = this.joints();
    if (s.att_type === 'crusher') this.crush(sim, J, act, dt, P);
    else if (s.att_type === 'breaker') this.breaker(sim, J, act, dt, P);
    else this.bucket(sim, J, dt, prev);
    const moving = Math.abs(s.swingV) + Math.abs(s.boomV) + Math.abs(s.armV) + Math.abs(s.attV);
    s.engine = 0.25 + Math.min(1, moving * 1.4 + Math.abs(s.tv) * 0.5 + (act ? 0.5 : 0));
    // 강체를 밀어낼 운동학 상자 = 어태치먼트
    const rb = sim.phys.pw.getRigidBody(this.rbHandle);
    if (rb) rb.setNextKinematicTranslation({ x: (J.A[0] + J.T[0]) / 2, y: (J.A[1] + J.T[1]) / 2, z: (J.A[2] + J.T[2]) / 2 });
  }

  // 집게 사이 공간(어태치먼트 좌표계 상자) 안 블록
  biteVoxels(sim, J, gapHalf, from, to, thick, pred) {
    const { A, fx, fz, a3 } = J;
    const L = this.attLen();
    const dir = [fx * Math.cos(a3), Math.sin(a3), fz * Math.cos(a3)];
    const up = [-fx * Math.sin(a3), Math.cos(a3), -fz * Math.sin(a3)];   // 평면 안 수직
    const side = [fz, 0, -fx];
    const mat = sim.world.mat;
    const out = [];
    const seen = new Set();
    const step = VS * 0.7;
    for (let t = from * L; t <= to * L; t += step) for (let g = -gapHalf; g <= gapHalf; g += step) for (let w = -thick; w <= thick; w += step) {
      const x = A[0] + dir[0] * t + up[0] * g + side[0] * w, y = A[1] + dir[1] * t + up[1] * g + side[1] * w, z = A[2] + dir[2] * t + up[2] * g + side[2] * w;
      const gx = Math.floor(x / VS), gy = Math.floor(y / VS), gz = Math.floor(z / VS);
      if (gx < 0 || gx >= GX || gz < 0 || gz >= GZ || gy < 0 || gy >= GY) continue;
      const i = gx + GX * (gz + GZ * gy);
      if (seen.has(i)) continue;
      seen.add(i);
      const m = mat[i];
      if (m && pred(m)) out.push([i, Math.abs(g)]);
    }
    return out;
  }

  crush(sim, J, act, dt, P) {
    const s = this.s;
    if (!act) { s.jaw = approach(s.jaw, 1, 2.2 * dt); return; }
    const gap = 0.1 + s.jaw * 0.62;
    const inside = this.biteVoxels(sim, J, gap + VS, 0.35, 1.02, 0.42, (m) => isStruct(m) || (m & RUBBLE));
    let avgT = 0;
    for (const [i] of inside) avgT += TOUGH[sim.world.mat[i]] || 0.1;
    avgT = inside.length ? avgT / inside.length : 0;
    // 턱이 닫히는 속도 = 유압 힘 / 재료 저항. 닫히는 턱 바깥으로 밀려난 블록은 짓이겨진다.
    const rate = inside.length ? 0.62 * P / Math.max(0.35, avgT) : 1.6;
    const jaw = approach(s.jaw, 0, rate * dt);
    const newGap = 0.1 + jaw * 0.62;
    const list = [];
    for (const [i, g] of inside) if (g > newGap - VS * 0.6) list.push(i);
    if (list.length) {
      const r = sim.damage.removeWorld(list.slice(0, 70), { mode: 'bite', vel: [0, -1, 0], jitter: 1.2 });
      if (r.n) sim.fx.push({ t: 'bite', x: J.T[0], y: J.T[1], z: J.T[2], v: Math.min(1, 0.35 + avgT * 0.5) });
    }
    s.jaw = jaw;
  }

  breaker(sim, J, act, dt, P) {
    const s = this.s;
    if (!act) { s.hammerT = 0; return; }
    s.hammerT -= dt;
    if (s.hammerT > 0) return;
    s.hammerT = 1 / 9;
    const { T, fx, fz, a3 } = J;
    const dir = [fx * Math.cos(a3), Math.sin(a3), fz * Math.cos(a3)];
    // 끝에 닿은 블록이 있는지
    let hit = false;
    for (let t = -0.1; t <= 0.35; t += 0.12) {
      if (sim.world.solidAtM(T[0] + dir[0] * t, T[1] + dir[1] * t, T[2] + dir[2] * t)) { hit = true; break; }
    }
    if (hit) {
      const r = sim.damage.sphere(T[0] + dir[0] * 0.15, T[1] + dir[1] * 0.15, T[2] + dir[2] * 0.15, 46000 * P, { mode: 'hammer', vel: [-dir[0], -dir[1] * 0.5, -dir[2]], maxR: 2.4, jitter: 1.6 });
      void r;
    }
    sim.fx.push({ t: 'hammer', x: T[0], y: T[1], z: T[2], hit });
  }

  bucket(sim, J, dt, prev) {
    const s = this.s;
    const curling = s.att < prev.att - 1e-4;
    // 퍼 담기: 오므릴 때 버킷 안 잔해를 가져온다
    if (curling && s.load < this.capacity) {
      const inside = this.biteVoxels(sim, J, 0.5, 0.15, 1.0, 0.55, (m) => (m & RUBBLE) !== 0);
      const room = this.capacity - s.load;
      const take = inside.slice(0, Math.min(room, 40));
      for (const [i] of take) {
        const m = sim.world.mat[i];
        s.loadMats[m & BASE] = (s.loadMats[m & BASE] || 0) + 1;
        sim.world.remove(i);
        s.load++;
      }
    }
    // 쏟기: 버킷 날이 아래를 향하면 (오므린 상태에서는 날이 위를 향해 흙을 담고 있다)
    const facingDown = Math.sin(J.a3) < -0.5;
    if (s.load > 0 && facingDown && !curling) {
      s.dumpT += dt;
      if (s.dumpT > 0.05) {
        s.dumpT = 0;
        const n = Math.min(s.load, 30);
        const truck = this.truck;
        const mid = [(J.A[0] + J.T[0]) / 2, (J.A[1] + J.T[1]) / 2, (J.A[2] + J.T[2]) / 2];
        if (truck && (truck.catches(J.T) || truck.catches(mid))) {
          truck.receive(s.loadMats, n, sim);
          s.load -= n;
          this.drainMats(n);
          sim.fx.push({ t: 'dump', n });
        } else {
          const mats = Object.keys(s.loadMats);
          for (let k = 0; k < n; k++) {
            const m = +mats[k % mats.length];
            sim.debris.spawn(J.T[0] + (sim.rng.next() - 0.5) * 0.8, J.T[1] - 0.2, J.T[2] + (sim.rng.next() - 0.5) * 0.8, (sim.rng.next() - 0.5), -1, (sim.rng.next() - 0.5), m, 0, 1, sim.rng);
          }
          s.load -= n;
          this.drainMats(n);
        }
      }
    }
  }

  drainMats(n) {
    const lm = this.s.loadMats;
    let left = n;
    for (const k of Object.keys(lm)) {
      const t = Math.min(lm[k], left);
      lm[k] -= t; left -= t;
      if (lm[k] <= 0) delete lm[k];
      if (left <= 0) break;
    }
  }

  focus() { const J = this.joints(); return [(J.T[0] * 2 + this.s.x) / 3, Math.max(1.5, J.T[1] * 0.6 + 1), (J.T[2] * 2 + this.s.z) / 3]; }
  cabView() {
    const y = this.yaw(), cs = Math.cos(y), sn = Math.sin(y);
    return { pos: [this.s.x + sn * 0.55 + cs * 0.8, this.s.y + 2.75, this.s.z + cs * 0.55 - sn * 0.8], yaw: y, pitch: -0.05 };
  }

  // ───── 화면 모델 ─────
  buildModel(scene) {
    const YEL = 0xf2b705, DARK = 0x26282c, GRAY = 0x666b73, STEEL = 0x8b9099, GLASS = 0x6c9bb8;
    const root = new THREE.Group();
    for (const side of [-1, 1]) {
      box(root, 0.75, 0.85, 4.5, DARK, side * 1.3, 0.43, 0);
      for (let k = -3; k <= 3; k++) box(root, 0.8, 0.12, 0.3, GRAY, side * 1.3, 0.88, k * 0.6, false);
    }
    box(root, 1.8, 0.4, 2.4, GRAY, 0, 0.9, 0);
    const upper = new THREE.Group();
    upper.position.y = 1.15;
    root.add(upper);
    box(upper, 2.7, 1.05, 3.3, YEL, 0, 0.55, -0.45);
    box(upper, 2.72, 0.7, 0.9, DARK, 0, 0.5, -2.05);       // 평형추
    box(upper, 0.95, 1.5, 1.4, YEL, 0.8, 1.3, 0.55);        // 운전실
    box(upper, 0.97, 0.95, 1.2, GLASS, 0.8, 1.5, 0.62, false);
    box(upper, 0.6, 0.18, 0.6, GRAY, -0.7, 1.15, -1.0, false); // 배기
    const boomPivot = new THREE.Group();
    boomPivot.position.set(0, this.set.foot - 1.15, FOOT_FWD);
    upper.add(boomPivot);
    const L1 = this.set.boom, L2 = this.set.arm;
    const boom = new THREE.Group(); boomPivot.add(boom);
    box(boom, 0.55, 0.62, L1, YEL, 0, 0, L1 / 2);
    box(boom, 0.2, 0.2, L1 * 0.55, STEEL, 0, -0.42, L1 * 0.35, false);
    const arm = new THREE.Group(); arm.position.set(0, 0, L1); boom.add(arm);
    box(arm, 0.42, 0.48, L2, YEL, 0, 0, L2 / 2);
    box(arm, 0.16, 0.16, L2 * 0.6, STEEL, 0, 0.34, L2 * 0.4, false);
    const att = new THREE.Group(); att.position.set(0, 0, L2); arm.add(att);
    const parts = { crusher: new THREE.Group(), breaker: new THREE.Group(), bucket: new THREE.Group() };
    // 압쇄기: 고정 턱 + 움직이는 턱
    {
      const g = parts.crusher;
      box(g, 0.7, 0.7, 0.8, DARK, 0, 0, 0.4);
      const j1 = new THREE.Group(); j1.position.set(0, 0.12, 0.75); g.add(j1);
      box(j1, 0.55, 0.22, 1.35, GRAY, 0, 0, 0.65);
      for (let k = 0; k < 4; k++) box(j1, 0.5, 0.14, 0.12, STEEL, 0, -0.17, 0.3 + k * 0.3, false);
      const j2 = new THREE.Group(); j2.position.set(0, -0.12, 0.75); g.add(j2);
      box(j2, 0.55, 0.22, 1.35, GRAY, 0, 0, 0.65);
      for (let k = 0; k < 4; k++) box(j2, 0.5, 0.14, 0.12, STEEL, 0, 0.17, 0.3 + k * 0.3, false);
      g.userData = { j1, j2 };
    }
    {
      const g = parts.breaker;
      box(g, 0.55, 0.55, 1.6, DARK, 0, 0, 0.8);
      box(g, 0.58, 0.2, 0.3, YEL, 0, 0, 0.5, false);
      box(g, 0.16, 0.16, 0.6, STEEL, 0, 0, 1.9);
    }
    {
      const g = parts.bucket;
      box(g, 1.3, 0.12, 1.2, DARK, 0, -0.45, 0.75);
      box(g, 1.3, 0.9, 0.12, DARK, 0, 0, 0.15);
      box(g, 0.12, 0.9, 1.2, DARK, -0.6, 0, 0.75);
      box(g, 0.12, 0.9, 1.2, DARK, 0.6, 0, 0.75);
      for (let k = -2; k <= 2; k++) box(g, 0.14, 0.1, 0.25, STEEL, k * 0.27, -0.45, 1.45, false);
      const loadMesh = box(g, 1.1, 0.6, 1.0, 0x7b6a57, 0, -0.1, 0.75, false);
      g.userData = { loadMesh };
    }
    for (const p of Object.values(parts)) att.add(p);
    scene.add(root);
    this.model = { root, upper, boomPivot, boom, arm, att, parts };
  }

  sync() {
    const m = this.model, s = this.s;
    if (!m) return;
    m.root.position.set(s.x, s.y, s.z);
    m.root.rotation.set(0, s.heading, 0);
    m.root.rotateX(-s.pitch); m.root.rotateZ(s.roll);
    m.upper.rotation.y = s.swing;
    m.boom.rotation.x = -s.boom;
    m.arm.rotation.x = -s.arm;
    m.att.rotation.x = -s.att;
    for (const [k, p] of Object.entries(m.parts)) p.visible = k === s.att_type;
    const c = m.parts.crusher.userData;
    c.j1.rotation.x = -s.jaw * 0.38; c.j2.rotation.x = s.jaw * 0.38;
    const b = m.parts.bucket.userData;
    b.loadMesh.visible = s.load > 0;
    b.loadMesh.scale.y = Math.max(0.1, s.load / this.capacity);
  }

  disposeModel(scene) { if (this.model) { scene.remove(this.model.root); this.model = null; } }

  hud() {
    const s = this.s;
    return {
      title: this.name + ' · ' + ATTACH[s.att_type].name,
      gauges: [
        { k: '붐', v: Math.round(s.boom / DEG) + '°' },
        { k: '암', v: Math.round(-s.arm / DEG) + '°' },
        { k: '선회', v: Math.round(((s.swing / DEG) % 360 + 360) % 360) + '°' },
        s.att_type === 'crusher' ? { k: '턱 열림', v: Math.round(s.jaw * 100) + '%', bar: s.jaw } :
          s.att_type === 'bucket' ? { k: '버킷 적재', v: Math.round(s.load / this.capacity * 100) + '%', bar: s.load / this.capacity } :
            { k: '타격', v: s.hammerT > 0 ? '작동' : '대기' },
        { k: '접촉', v: s.contact ? '닿음' : '-', warn: s.contact },
      ],
      mode: s.travel ? '주행' : '작업',
    };
  }

  snapshot() { return JSON.parse(JSON.stringify(this.s)); }
  restore(d) { this.s = JSON.parse(JSON.stringify(d)); }
}

export { boxMat, MCLS, CLS };
