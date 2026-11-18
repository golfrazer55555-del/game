// 크롤러 크레인 + 쇠공. 선회·붐 기복·윈치를 각각 레버로 조작하는 시뮬레이션 방식.
//  쇠공은 진자 운동을 직접 적분하고, 블록과 부딪히면 운동 에너지만큼 부순다.
import * as THREE from 'three';
import { RAPIER } from '../physics.js';
import { VS, GX, GY, GZ, GRAVITY } from '../config.js';
import { MCLS, CLS, TOUGH } from '../materials.js';
import { clamp, approach, DEG } from '../util.js';
import { footprint, box, voxelBall, latticeBoom, boxMat } from './common.js';

export const BALLS = [
  { id: 'b1', name: '1톤 쇠공', mass: 1000, r: 0.42 },
  { id: 'b2', name: '2톤 쇠공', mass: 2000, r: 0.52 },
  { id: 'b35', name: '3.5톤 쇠공', mass: 3500, r: 0.64 },
];
export const BOOMS = [28, 34, 40];

const FOOT_H = 2.5, FOOT_OFF = 1.2;
const BALL_E_MULT = 7;

export class Crane {
  constructor(sim, spawn, opts = {}) {
    this.kind = 'crane';
    this.name = '크롤러 크레인';
    const ball = BALLS[opts.ball || 0];
    this.boomLen = BOOMS[opts.boom || 0];
    this.s = {
      x: spawn.x * VS, z: spawn.z * VS, heading: spawn.heading || 0,
      slew: 0, slewVel: 0, luff: 62 * DEG, luffVel: 0, rope: 0, ropeVel: 0,
      bp: [0, 0, 0], bv: [0, 0, 0], free: false, travel: false, tv: 0, tw: 0,
      lmi: 0, tension: 0, overloadT: 0, overloads: 0, tilt: 0, hits: 0, engine: 0.2,
    };
    this.ballMass = ball.mass; this.ballR = ball.r;
    this.active = false;
    // 쇠공 초기 위치: 붐 끝 아래
    const tip = this.tip();
    this.s.rope = Math.min(tip[1] - this.ballR - 1.5, 12);
    this.s.bp = [tip[0], tip[1] - this.s.rope, tip[2]];
    // 강체들을 밀어낼 수 있도록 물리 월드에 운동학 공 추가
    this.attachPhysics(sim);
  }

  attachPhysics(sim) {
    const pw = sim.phys.pw;
    const rb = pw.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(this.s.bp[0], this.s.bp[1], this.s.bp[2]));
    const col = pw.createCollider(RAPIER.ColliderDesc.ball(this.ballR).setFriction(0.4).setDensity(this.ballMass / (4 / 3 * Math.PI * this.ballR ** 3)), rb);
    this.rbHandle = rb.handle;
    sim.phys.info.set(col.handle, { kind: 'ball' });
  }

  // 붐 발·끝 위치
  yaw() { return this.s.heading + this.s.slew; }
  foot() { const y = this.yaw(); return [this.s.x + Math.sin(y) * FOOT_OFF, FOOT_H + this.s.tilt * 0, this.s.z + Math.cos(y) * FOOT_OFF]; }
  tip() {
    const f = this.foot(), y = this.yaw(), L = this.boomLen, a = this.s.luff;
    return [f[0] + Math.sin(y) * Math.cos(a) * L, f[1] + Math.sin(a) * L, f[2] + Math.cos(y) * Math.cos(a) * L];
  }
  radius() { const t = this.tip(); return Math.hypot(t[0] - this.s.x, t[2] - this.s.z); }
  capacity() { return Math.min(80, 270 / Math.max(3, this.radius())); }   // 톤 (정격 하중표 근사)

  // 목표 지점(m) 바로 앞에 쇠공이 매달리도록 붐 각도와 줄 길이를 맞춘다
  aimAt(tx, tz, ty) {
    const s = this.s;
    const dx = tx - s.x, dz = tz - s.z;
    s.slew = Math.atan2(dx, dz) - s.heading;
    const R = Math.max(4, Math.hypot(dx, dz) - FOOT_OFF);
    s.luff = clamp(Math.acos(clamp(R / this.boomLen, 0, 1)), 25 * DEG, 80 * DEG);
    const tip = this.tip();
    s.rope = clamp(tip[1] - ty, 1.5, tip[1] - this.ballR - 0.2);
    s.bp = [tip[0], tip[1] - s.rope, tip[2]];
    s.bv = [0, 0, 0];
  }

  step(dt, sim) {
    const s = this.s;
    const inp = this.active && sim.input ? sim.input : null;
    const lx = inp ? inp.lx : 0, ly = inp ? inp.ly : 0, ry = inp ? inp.ry : 0, rx = inp ? inp.rx : 0;
    s.free = !!(inp && inp.a);
    if (inp && inp.travelToggle) s.travel = !s.travel;
    // ── 유압 응답 (레버 → 속도, 관성 있게) ──
    if (s.travel) {
      s.tv = approach(s.tv, ly * 1.1, 1.2 * dt);
      s.tw = approach(s.tw, -lx * 0.22, 0.5 * dt);
      s.slewVel = approach(s.slewVel, 0, 0.6 * dt);
    } else {
      s.tv = approach(s.tv, 0, 2 * dt); s.tw = approach(s.tw, 0, 1 * dt);
      s.slewVel = approach(s.slewVel, -lx * 0.5, 0.9 * dt);
    }
    const lmiBlock = s.lmi > 1.0;
    let luffCmd = s.travel ? 0 : ly;
    if (lmiBlock && luffCmd < 0) luffCmd = 0;   // 과부하 방지: 붐 내리기 차단
    s.luffVel = approach(s.luffVel, luffCmd * 9 * DEG, 18 * DEG * dt);
    s.slew += s.slewVel * dt;
    s.luff = clamp(s.luff + s.luffVel * dt, 18 * DEG, 82 * DEG);
    if (s.luff <= 18 * DEG || s.luff >= 82 * DEG) s.luffVel = 0;
    // 주행
    if (Math.abs(s.tv) > 0.01 || Math.abs(s.tw) > 0.001) {
      const nh = s.heading + s.tw * dt;
      const nx = s.x + Math.sin(nh) * s.tv * dt, nz = s.z + Math.cos(nh) * s.tv * dt;
      const fp = footprint(sim.world, nx, nz, nh, 2.4, 3.1, 0.5, 0);
      const inside = nx > 3 && nx < GX * VS - 3 && nz > 3 && nz < GZ * VS - 3;
      if (!fp.blocked && inside) {
        // 차체가 움직이면 공도 같이 끌려간다
        s.x = nx; s.z = nz; s.heading = nh;
      } else { s.tv = 0; s.tw = 0; }
    }
    // 윈치 (위로 당기면 줄이 짧아진다)
    const tip = this.tip();
    const maxRope = Math.max(2, tip[1] - 0.2);
    if (!s.free) {
      let winch = s.travel ? 0 : -ry;
      if (lmiBlock && winch < 0) winch = 0;
      s.ropeVel = approach(s.ropeVel, winch * (winch > 0 ? 3.2 : 2.6), 6 * dt);
      s.rope = clamp(s.rope + s.ropeVel * dt, 1.2, maxRope);
    } else s.ropeVel = 0;
    void rx;
    // ── 쇠공 진자 (4번 나눠 적분) ──
    const n = 4, h = dt / n;
    let tension = 0;
    const bp = s.bp, bv = s.bv;
    for (let k = 0; k < n; k++) {
      bv[1] -= GRAVITY * h;
      const dr = 1 - 0.03 * h;
      bv[0] *= dr; bv[1] *= dr; bv[2] *= dr;
      bp[0] += bv[0] * h; bp[1] += bv[1] * h; bp[2] += bv[2] * h;
      // 줄 구속 (늘어나지 않음, 느슨해질 수는 있음)
      const dx = bp[0] - tip[0], dy = bp[1] - tip[1], dz = bp[2] - tip[2];
      const len = Math.hypot(dx, dy, dz);
      if (s.free) s.rope = clamp(Math.max(s.rope, len), 1.2, maxRope);
      if (len > s.rope) {
        const nx = dx / len, ny = dy / len, nz = dz / len;
        bp[0] = tip[0] + nx * s.rope; bp[1] = tip[1] + ny * s.rope; bp[2] = tip[2] + nz * s.rope;
        const vr = bv[0] * nx + bv[1] * ny + bv[2] * nz;
        // 줄이 팽팽해지는 순간의 충격 하중: 와이어가 늘어나는 시간(약 0.15초)에 걸쳐 전달된다
        if (vr > 0) { bv[0] -= nx * vr; bv[1] -= ny * vr; bv[2] -= nz * vr; tension += this.ballMass * vr / 0.15; }
        tension += this.ballMass * Math.max(0, -GRAVITY * ny + (bv[0] ** 2 + bv[1] ** 2 + bv[2] ** 2) / s.rope);
      }
      this.collide(sim, h);
    }
    tension /= n;
    s.tension += (tension - s.tension) * (1 - Math.exp(-dt / 0.2));
    // 과부하 표시기 (LMI)
    const load = s.tension / GRAVITY / 1000 + 0.4;
    s.lmi = load / this.capacity();
    if (s.lmi > 1.12) { s.overloadT += dt; if (s.overloadT > 0.5) { s.overloads++; s.overloadT = -2; sim.fx.push({ t: 'overload' }); } }
    else if (s.overloadT > 0) s.overloadT = 0; else s.overloadT = Math.min(0, s.overloadT + dt);
    s.tilt = s.tilt * 0.9 + clamp((s.lmi - 1) * 0.04, 0, 0.05) * 0.1;
    s.engine = 0.2 + Math.min(1, Math.abs(s.slewVel) * 2 + Math.abs(s.luffVel) * 6 + Math.abs(s.ropeVel) * 0.3 + Math.abs(s.tv));
    // 운동학 공 위치 갱신
    const rb = sim.phys.pw.getRigidBody(this.rbHandle);
    if (rb) rb.setNextKinematicTranslation({ x: bp[0], y: bp[1], z: bp[2] });
  }

  // 쇠공과 블록 충돌
  collide(sim, h) {
    const s = this.s, w = sim.world, mat = w.mat;
    const bp = s.bp, bv = s.bv;
    const R = this.ballR / VS;
    const cx = bp[0] / VS, cy = bp[1] / VS, cz = bp[2] / VS;
    // 땅
    if (bp[1] < this.ballR) {
      bp[1] = this.ballR;
      if (bv[1] < 0) { if (bv[1] < -3) sim.fx.push({ t: 'ballhit', x: bp[0], y: 0, z: bp[2], e: 0.5 * this.ballMass * bv[1] * bv[1] * 0.3, cls: CLS.concrete }); bv[1] = -bv[1] * 0.12; }
      bv[0] *= 0.94; bv[2] *= 0.94;
    }
    const x0 = Math.floor(cx - R - 1), x1 = Math.floor(cx + R + 1), y0 = Math.max(0, Math.floor(cy - R - 1)), y1 = Math.min(GY - 1, Math.floor(cy + R + 1)), z0 = Math.floor(cz - R - 1), z1 = Math.floor(cz + R + 1);
    let nx = 0, ny = 0, nz = 0, hits = 0, maxPen = 0, hitCls = CLS.concrete, toughest = 0;
    for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
      if (x < 0 || x >= GX || z < 0 || z >= GZ) continue;
      const m = mat[x + GX * (z + GZ * y)];
      if (!m) continue;
      const qx = clamp(cx, x, x + 1), qy = clamp(cy, y, y + 1), qz = clamp(cz, z, z + 1);
      let dx = cx - qx, dy = cy - qy, dz = cz - qz;
      let d = Math.hypot(dx, dy, dz);
      if (d >= R) continue;
      if (d < 1e-4) { dx = cx - x - 0.5; dy = cy - y - 0.5; dz = cz - z - 0.5; d = Math.hypot(dx, dy, dz) || 1; }
      const pen = R - Math.min(d, R);
      nx += dx / d * pen; ny += dy / d * pen; nz += dz / d * pen;
      hits++;
      if (pen > maxPen) maxPen = pen;
      if (TOUGH[m] > toughest) { toughest = TOUGH[m]; hitCls = MCLS[m]; }
    }
    if (!hits) return;
    const nl = Math.hypot(nx, ny, nz) || 1;
    nx /= nl; ny /= nl; nz /= nl;
    const vn = bv[0] * nx + bv[1] * ny + bv[2] * nz;
    if (vn < -0.6) {
      const E = 0.5 * this.ballMass * vn * vn;
      const off = this.ballR * 0.45;
      const res = sim.damage.sphere(bp[0] - nx * off, bp[1] - ny * off, bp[2] - nz * off, E * BALL_E_MULT, {
        mode: 'ball', vel: [bv[0] * 0.45, bv[1] * 0.45, bv[2] * 0.45], maxR: R + 2.2, jitter: 2.5,
      });
      const used = Math.min(E, res.used / BALL_E_MULT);
      const rem = Math.max(0, E - used);
      const through = res.n > 0 && rem > E * 0.25;
      // 법선 방향 속도: 뚫고 지나가면 남은 에너지만큼, 아니면 튕김
      const vnNew = through ? -Math.sqrt(2 * rem / this.ballMass) * 0.8 : -vn * 0.18;
      bv[0] += nx * (vnNew - vn); bv[1] += ny * (vnNew - vn); bv[2] += nz * (vnNew - vn);
      if (E > 600) sim.fx.push({ t: 'ballhit', x: bp[0] - nx * this.ballR, y: bp[1] - ny * this.ballR, z: bp[2] - nz * this.ballR, e: E, cls: hitCls, spark: hitCls === CLS.metal });
      s.hits++;
      if (through) return;
    } else if (vn < 0) {
      bv[0] -= nx * vn; bv[1] -= ny * vn; bv[2] -= nz * vn;
    }
    // 겹친 만큼 밀어내기
    const push = Math.min(maxPen, 0.6) * VS * 0.8;
    bp[0] += nx * push; bp[1] += ny * push; bp[2] += nz * push;
    void h;
  }

  // 카메라가 따라갈 지점
  focus() { const b = this.s.bp; return [b[0] * 0.8 + this.s.x * 0.2, clamp(b[1], 2, 14), b[2] * 0.8 + this.s.z * 0.2]; }
  cabView() {
    const y = this.yaw();
    const cs = Math.cos(y), sn = Math.sin(y);
    // 운전석: 상부 오른쪽 앞 (상부 좌표 x=-1.95, z=1.4)
    const lx = -1.95, lz = 1.4;
    const px = this.s.x + lx * cs + lz * sn, pz = this.s.z - lx * sn + lz * cs;
    return { pos: [px, 3.0, pz], yaw: y, pitch: 0.32 };
  }

  // ───── 화면 모델 ─────
  buildModel(scene) {
    const root = new THREE.Group();
    const upper = new THREE.Group();
    const RED = 0xd8462b, WHITE = 0xe9e6df, DARK = 0x2a2c30, GRAY = 0x5c6068, YEL = 0xf2b705;
    // 하부 (무한궤도)
    for (const side of [-1, 1]) {
      box(root, 0.9, 0.95, 6.2, DARK, side * 2.0, 0.48, 0);
      for (let k = -2; k <= 2; k++) box(root, 0.95, 0.25, 0.25, GRAY, side * 2.0, 0.95, k * 1.2, false);
    }
    box(root, 3.0, 0.7, 3.4, GRAY, 0, 1.15, 0);
    box(root, 2.2, 0.3, 2.2, DARK, 0, 1.6, 0);
    root.add(upper);
    upper.position.y = 1.6;
    box(upper, 3.3, 1.9, 5.0, RED, 0, 1.05, -0.6);
    box(upper, 3.32, 0.25, 5.02, WHITE, 0, 1.55, -0.6, false);
    box(upper, 3.4, 1.5, 1.4, DARK, 0, 0.9, -3.6);                   // 평형추
    box(upper, 1.2, 1.7, 1.6, WHITE, -1.95, 1.05, 1.0);              // 운전실
    box(upper, 1.22, 0.9, 1.1, 0x5d8fb0, -1.95, 1.35, 1.35, false);  // 창
    box(upper, 0.4, 0.4, 0.4, YEL, 0.9, 2.15, -2.4, false);          // 경광등
    box(upper, 1.0, 0.5, 1.0, DARK, 0, 0.6, 1.4);
    // 붐 (발: 앞쪽, 높이 FOOT_H)
    const boomPivot = new THREE.Group();
    boomPivot.position.set(0, FOOT_H - 1.6, FOOT_OFF);
    upper.add(boomPivot);
    const boom = latticeBoom(this.boomLen, 0.9, RED);
    boom.rotation.y = -Math.PI / 2;   // x축 → +z 방향
    const boomHold = new THREE.Group();
    boomHold.add(boom);
    boomPivot.add(boomHold);
    box(boom, 0.7, 0.9, 0.9, DARK, this.boomLen, 0, 0);   // 끝 도르래
    // 줄과 쇠공
    const ropeGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, -1, 0)]);
    const rope = new THREE.Line(ropeGeo, new THREE.LineBasicMaterial({ color: 0x1b1b1b }));
    rope.frustumCulled = false;
    scene.add(rope);
    const ball = voxelBall(this.ballR, 0x34373c, this.ballR / 4);
    const hook = new THREE.Group();
    hook.add(ball);
    box(hook, 0.25, 0.5, 0.25, YEL, 0, this.ballR + 0.25, 0);
    scene.add(hook);
    scene.add(root);
    this.model = { root, upper, boomPivot, boomHold, rope, hook, ball };
  }

  sync() {
    const m = this.model, s = this.s;
    if (!m) return;
    m.root.position.set(s.x, 0, s.z);
    m.root.rotation.set(-s.tilt, s.heading, 0);
    m.upper.rotation.y = s.slew;
    m.boomHold.rotation.x = -s.luff;
    const t = this.tip();
    const pos = m.rope.geometry.attributes.position;
    pos.setXYZ(0, t[0], t[1], t[2]);
    pos.setXYZ(1, s.bp[0], s.bp[1] + this.ballR + 0.5, s.bp[2]);
    pos.needsUpdate = true;
    m.hook.position.set(s.bp[0], s.bp[1], s.bp[2]);
  }

  disposeModel(scene) {
    if (!this.model) return;
    scene.remove(this.model.root, this.model.rope, this.model.hook);
    this.model = null;
  }

  hud() {
    const s = this.s;
    return {
      title: this.name,
      gauges: [
        { k: '과부하(LMI)', v: Math.round(s.lmi * 100) + '%', bar: Math.min(1.2, s.lmi), warn: s.lmi > 0.9 },
        { k: '붐 각도', v: Math.round(s.luff / DEG) + '°' },
        { k: '반경', v: this.radius().toFixed(1) + ' m' },
        { k: '줄 길이', v: s.rope.toFixed(1) + ' m' },
        { k: '쇠공', v: Math.hypot(...s.bv).toFixed(1) + ' m/s' },
      ],
      mode: s.travel ? '주행' : s.free ? '자유낙하' : '작업',
    };
  }

  snapshot() { return JSON.parse(JSON.stringify(this.s)); }
  restore(d) { this.s = JSON.parse(JSON.stringify(d)); }
}

export { boxMat };
