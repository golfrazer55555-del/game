// 한 현장(의뢰 하나 또는 자유 철거)의 진행: 시뮬레이션, 장비, 발파, 리플레이, 비용
import * as THREE from 'three';
import { SIM_DT, VS, GX, GZ } from './config.js';
import { Sim } from './sim.js';
import { buildSite, BUILDINGS } from './site.js';
import { ChunkView, BodyView } from './render.js';
import { Crane } from './machines/crane.js';
import { Excavator } from './machines/excavator.js';
import { Explosives } from './machines/explosives.js';
import { Truck } from './machines/truck.js';
import { measure, RATES } from './contracts.js';
import { STRENGTH } from './materials.js';
import { level, owns } from './save.js';

export class Session {
  constructor(game, contract, opts = {}) {
    this.g = game;
    this.contract = contract;
    this.free = !!opts.free;
    this.demo = !!opts.demo;
    this.title = contract.title;
    const q = game.quality;
    this.sim = new Sim({ particles: q.particles, seed: opts.seed || 20261118 });
    this.layout = buildSite(this.sim, { building: contract.building, cars: contract.cars ?? 4, seed: opts.seed || 11, neighbors: true });
    this.sim.finalizeSetup();
    const sp = this.layout.spawns;
    const save = game.save;
    const avail = this.free ? ['crane', 'excavator', 'blast'] : contract.machines.slice();
    this.available = avail;
    this.machines = {};
    if (avail.includes('crane')) {
      const cr = this.machines.crane = new Crane(this.sim, sp.crane, { ball: this.free ? 2 : level(save, 'ball'), boom: this.free ? 2 : level(save, 'boom') });
      // 쇠공을 건물 앞면 조금 앞에 매달아 둔다
      const tb = this.sim.world.owners[this.layout.target].box;
      const cx = (tb.x0 + (tb.x1 - tb.x0) * 0.28) * VS, fz = tb.z0 * VS - 3.2;
      cr.aimAt(cx + (sp.crane.aimDx || 0), fz, Math.min(4.5, (tb.y1 + 1) * VS * 0.45));
      const rb = this.sim.phys.pw.getRigidBody(cr.rbHandle);
      if (rb) rb.setTranslation({ x: cr.s.bp[0], y: cr.s.bp[1], z: cr.s.bp[2] }, true);
    }
    if (avail.includes('excavator')) {
      const long = this.free || owns(save, 'long');
      this.machines.excavator = new Excavator(this.sim, sp.excavator, { boomset: long && contract.building !== 'warehouse' && contract.building !== 'house' ? 'long' : 'std', power: this.free || owns(save, 'power') ? 1.6 : 1, attach: 'crusher' });
      this.longAvailable = long;
    }
    this.sim.machines = Object.values(this.machines);
    if (avail.includes('blast')) { this.explosives = new Explosives(); this.sim.explosives = this.explosives; }
    if (this.machines.excavator && (contract.truck || this.free)) {
      this.truck = new Truck(sp.truck || { x: 150, z: 84, heading: 0 });
      this.machines.excavator.truck = this.truck;
    }
    this.activeKind = avail[0];
    this.machineSeconds = { crane: 0, excavator: 0 };
    this.acc = 0;
    this.timeScale = 1;
    this.slowT = 0;
    this.paused = false;
    this.finished = false;
    this.chargeType = 'std';
    this.chargeDelay = 0;
    this.selCharge = 0;
    this.blastSnap = null;
    this.replaying = false;
    this.cineAngle = 0;
    this.tips = new Set();
    this.buildViews();
  }

  get active() { return this.activeKind === 'blast' ? null : this.machines[this.activeKind]; }

  buildViews() {
    const g = this.g, scene = g.scene;
    this.chunkView = new ChunkView(scene, this.sim.world, g.voxMat);
    this.chunkView.setShadows(g.quality.shadows);
    this.chunkView.update(0, true);
    this.bodyView = new BodyView(scene, g.voxMat);
    this.bodyView.shadows = g.quality.shadows;
    for (const m of Object.values(this.machines)) m.buildModel(scene);
    if (this.explosives) this.explosives.buildModel(scene);
    if (this.truck) this.truck.buildModel(scene);
    // 목표 구역 표시
    const z = this.layout.zone;
    if (z) {
      const w = (z.x1 - z.x0 + 1) * VS, d = (z.z1 - z.z0 + 1) * VS;
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshBasicMaterial({ color: 0xf2b705, transparent: true, opacity: 0.22, depthWrite: false }));
      m.rotation.x = -Math.PI / 2;
      m.position.set((z.x0 * VS) + w / 2, 0.03, (z.z0 * VS) + d / 2);
      const edge = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(w, 0.05, d)), new THREE.LineBasicMaterial({ color: 0xf2b705 }));
      edge.position.copy(m.position);
      this.zoneMesh = new THREE.Group();
      this.zoneMesh.add(m, edge);
      scene.add(this.zoneMesh);
    }
    // 구조 보기 오버레이
    this.structGroup = new THREE.Group();
    this.structGroup.visible = false;
    scene.add(this.structGroup);
    this.structVersion = null;
    this.selectMachine(this.activeKind);
  }

  selectMachine(kind) {
    if (!this.available.includes(kind)) return;
    if (this.explosives && this.explosives.state === 'countdown') return;
    this.activeKind = kind;
    for (const [k, m] of Object.entries(this.machines)) m.active = k === kind;
    const rig = this.g.rig;
    if (kind === 'blast') { if (rig.mode !== 'cine') rig.setMode('site'); }
    else {
      if (rig.mode === 'site') rig.setMode('follow');
      // 장비 뒤쪽 비스듬한 곳에서 보도록 카메라를 돌린다
      const mc = this.machines[kind];
      if (mc && !this.demo) { rig.yaw = -mc.yaw() + (kind === 'crane' ? 0.75 : 0.5); rig.pitch = kind === 'crane' ? 0.4 : 0.36; rig.dist = kind === 'crane' ? 27 : 17; }
    }
    if (!this.demo) {
      this.g.ui.machineChanged(this);
      this.tip(kind);
    }
  }

  tip(kind) {
    if (this.tips.has(kind)) return;
    this.tips.add(kind);
    const ui = this.g.ui;
    const touch = this.g.touchUI;
    const T = {
      crane: [touch ? '왼쪽 레버 ↑↓로 붐을 박자 맞춰 올렸다 내리면 쇠공이 앞뒤로 크게 흔들려요' : 'W·S로 붐을 박자 맞춰 올렸다 내리면 쇠공이 앞뒤로 크게 흔들려요', touch ? '왼쪽 레버 ←→로 겨누고, 오른쪽 레버로 쇠공 높이를 맞추세요' : 'A·D로 좌우를 겨누고 ↑·↓로 쇠공 높이를 맞추세요'],
      excavator: ['압쇄기 턱을 벽 모서리에 대고 ' + (touch ? '빨간 버튼' : 'Space') + '으로 물어뜯으세요', '위층부터 차례로 부수면 안전해요. 아래 기둥부터 부수면 무너져 내려요!'],
      blast: ['1층 기둥·내력벽을 눌러 장약을 설치하세요. 유리·칸막이 너머 안쪽 기둥도 고를 수 있어요', '대부분의 기둥을 끊어야 무너져요. 구조 보기(건물 아이콘)로 하중과 무게중심을 확인하세요'],
    }[kind];
    if (!T) return;
    for (const h of this.tipTimers || []) clearTimeout(h);
    this.tipTimers = T.map((t, i) => setTimeout(() => { if (this.g.session === this && this.activeKind === kind) ui.toast(t, 'tip', 5200); }, 600 + i * 5400));
  }

  setAttachment(t) { if (this.machines.excavator) { this.machines.excavator.setAttachment(t); this.g.ui.updateLabels(this); } }

  // ───── 매 프레임 ─────
  update(dt) {
    if (this.paused) return;
    const sim = this.sim;
    const input = this.g.input;
    this.acc += dt * this.timeScale;
    let steps = 0;
    const travelToggle = input.takeEdge('KeyR');
    while (this.acc >= SIM_DT && steps < 4) {
      const st = input.state;
      sim.input = this.replaying || this.demo ? this.demoInput() : { lx: st.lx, ly: st.ly, rx: st.rx, ry: st.ry, a: st.a, b: st.b, iso: st.iso, travelToggle: steps === 0 && travelToggle };
      sim.step();
      if (this.truck) this.truck.step(SIM_DT);
      if (!this.replaying && !this.demo && this.active) {
        const mc = this.active;
        if (mc.s.engine > 0.3 || mc.kind === 'crane') this.machineSeconds[mc.kind] += SIM_DT;
      }
      this.handleEvents();
      this.acc -= SIM_DT;
      steps++;
    }
    if (this.acc > SIM_DT * 4) this.acc = 0;
    // 슬로모션 복귀
    if (this.slowT > 0) {
      this.slowT -= dt;
      if (this.slowT <= 0) this.timeScale = this.replaying ? 0.5 : 1;
    }
    if (this.replaying) {
      this.replayT += dt;
      if (this.replayT > this.nextCut) { this.nextCut += 2.6; this.cineAngle++; this.g.rig.startCine(this.cineCenter(), this.buildingHeight(), this.cineAngle); }
      if (this.replayT > 13 || (this.explosives.state === 'done' && this.sim.bodies.list.length === 0 && this.replayT > 6)) this.endReplay();
    }
  }

  demoInput() {
    if (!this.demo) return { lx: 0, ly: 0, rx: 0, ry: 0, a: false, b: false, iso: false };
    // 타이틀 화면: 크레인이 박자에 맞춰 쇠공을 흔든다
    const t = this.sim.time;
    const c = this.machines.crane;
    const period = 2 * Math.PI * Math.sqrt(Math.max(4, c.s.rope) / 9.81);
    const phase = (t % period) / period;
    return { lx: 0, ly: phase < 0.5 ? -1 : 1, rx: 0, ry: 0, a: false, b: false, iso: false };
  }

  handleEvents() {
    const sim = this.sim, ui = this.g.ui, audio = this.g.audio;
    // 한 프레임에 여러 틱이 돌 수 있으므로 아직 처리하지 않은 이벤트만
    const from = this.fxSeen || 0;
    this.fxSeen = sim.fx.length;
    for (let k = from; k < sim.fx.length; k++) {
      const e = sim.fx[k];
      switch (e.t) {
        case 'count':
          if (!this.replaying) { ui.setCount(e.n > 0 ? e.n : null); audio.beep(e.n > 0 ? 880 : 1320, e.n > 0 ? 0.12 : 0.3); }
          break;
        case 'fire':
          ui.setCount(null);
          audio.setSiren(false);
          ui.renderBlast(this);
          if (!this.replaying) this.blastSnap = sim.snapshot();
          this.timeScale = this.replaying ? 0.4 : 0.35;
          this.slowT = 3.2;
          if (!this.replaying) { this.prevCam = this.g.rig.mode === 'cine' ? 'site' : this.g.rig.mode; this.g.rig.startCine(this.cineCenter(), this.buildingHeight(), 0); }
          break;
        case 'blastdone':
          if (!this.replaying) { setTimeout(() => { if (this.g.session === this && !this.replaying && this.g.rig.mode === 'cine') this.g.rig.endCine(this.prevCam || 'site'); }, 6000); ui.renderBlast(this); }
          break;
        case 'overload':
          if (!this.replaying) ui.toast('과부하! 크레인이 기우뚱합니다 — 안전 위반 기록', 'warn');
          break;
        case 'truck':
          if (e.s === 'leave' && !this.replaying) ui.toast('덤프트럭 가득 참 — 반출하러 갑니다', 'good');
          break;
      }
    }
  }

  cineCenter() {
    const b = this.sim.world.owners[this.layout.target].box;
    return new THREE.Vector3((b.x0 + b.x1) / 2 * VS, (b.y0 + b.y1) / 2 * VS, (b.z0 + b.z1) / 2 * VS);
  }
  buildingHeight() { const b = this.sim.world.owners[this.layout.target].box; return (b.y1 + 1) * VS; }

  // ───── 발파 ─────
  tapWorld(ray) {
    const ex = this.explosives;
    if (!ex || this.activeKind !== 'blast' || ex.state !== 'plan') return;
    // 기존 장약 고르기
    let best = null, bd = 0.7;
    for (const c of ex.list) {
      const p = new THREE.Vector3(c.x, c.y, c.z);
      const d = ray.distanceToPoint(p);
      if (d < bd) { bd = d; best = c; }
    }
    if (best) { this.selCharge = best.id; this.g.ui.renderBlast(this); this.g.audio.ui(); return; }
    const o = ray.origin, d = ray.direction;
    // 유리·칸막이·가구는 통과해서 뒤의 기둥·내력벽을 고른다 (실제로도 구조체에 구멍을 뚫어 장약을 넣는다)
    const hit = this.sim.world.raycast(o.x, o.y, o.z, d.x, d.y, d.z, 200, (m) => STRENGTH[m] >= 0.5 || (m & 64) !== 0);
    if (!hit || hit.ground) return;
    const type = this.chargeType === 'big' && (this.free || this.g.hasBigCharge()) ? 'big' : 'std';
    const c = ex.place(this.sim, hit, type, this.chargeDelay);
    if (c) { this.selCharge = c.id; this.g.audio.ui(); this.g.ui.renderBlast(this); }
  }

  blastAction(act) {
    const ex = this.explosives;
    if (!ex) return;
    const ui = this.g.ui;
    if (act === 'del') { ex.remove(this.selCharge); this.selCharge = 0; }
    else if (act === 'clear') { ex.clear(); this.selCharge = 0; }
    else if (act === 'fire') {
      if (ex.arm(5)) {
        this.g.audio.setSiren(true);
        ui.toast('발파 5초 전 — 사이렌!', 'warn');
        ui.setCount(5);
        this.g.audio.beep(880, 0.12);
      }
    } else if (act === 'cancel') { ex.cancel(); this.g.audio.setSiren(false); ui.setCount(null); }
    else if (act === 'again') { ex.reset(); this.selCharge = 0; }
    else if (act === 'replay') { this.g.replay(); return; }
    ui.renderBlast(this);
  }

  startReplay() {
    if (!this.blastSnap) return;
    this.replaying = true;
    this.restoreSnapshot(this.blastSnap);
    this.timeScale = 0.4;
    this.replayT = 0;
    this.nextCut = 2.6;
    this.cineAngle = 1;
    this.g.rig.startCine(this.cineCenter(), this.buildingHeight(), this.cineAngle);
    this.g.ui.renderBlast(this);
    this.g.ui.toast('다시 보기 — 슬로모션', 'tip', 2000);
  }
  endReplay() {
    this.replaying = false;
    this.timeScale = 1;
    this.slowT = 0;
    this.g.rig.endCine('site');
    this.g.ui.renderBlast(this);
  }

  restoreSnapshot(snap) {
    this.sim.restore(snap);
    this.fxSeen = 0;
    this.chunkView.update(0, true);
    this.bodyView.clear();
    this.g.presenter.clear();
  }

  // ───── 측정 ─────
  measure() { return measure(this); }
  runningCost() {
    let c = 0;
    for (const [k, sec] of Object.entries(this.machineSeconds)) c += (sec / 60) * (RATES[k] || 0);
    if (this.explosives) c += this.explosives.cost;
    return c;
  }
  overloads() { return this.machines.crane ? this.machines.crane.s.overloads : 0; }
  blocksBroken() { let n = 0; const w = this.sim.world; for (let o = 0; o < w.owners.length; o++) n += w.removedByOwner[o]; return n; }

  // 구조 보기 갱신
  updateStruct() {
    const g = this.structGroup;
    if (!g.visible) return;
    const views = this.sim.struct.lastView;
    if (!views || views === this.structVersion) return;
    this.structVersion = views;
    for (const c of [...g.children]) { g.remove(c); c.geometry.dispose(); }
    const pos = [], col = [];
    const C = new THREE.Color();
    for (const v of views) {
      const n = v.y1 - v.y0 + 1;
      for (let yy = 0; yy < n; yy += 2) {
        let r = 0;
        for (let k = yy; k < Math.min(n, yy + 2); k++) r = Math.max(r, v.ratio[k]);
        const k4 = yy * 4;
        const x0 = v.ext[k4] * VS, x1 = (v.ext[k4 + 1] + 1) * VS, z0 = v.ext[k4 + 2] * VS, z1 = (v.ext[k4 + 3] + 1) * VS;
        if (x1 <= x0) continue;
        const y = (v.y0 + yy + 0.5) * VS;
        const t = Math.min(1, r);
        if (t < 0.5) C.setRGB(0.27 + t * 1.2, 0.72, 0.33); else C.setRGB(0.9, 0.72 - (t - 0.5) * 1.3, 0.2);
        const seg = [[x0, z0, x1, z0], [x1, z0, x1, z1], [x1, z1, x0, z1], [x0, z1, x0, z0]];
        for (const [a, b, c2, d] of seg) { pos.push(a, y, b, c2, y, d); col.push(C.r, C.g, C.b, C.r, C.g, C.b); }
      }
      const cx = v.comX * VS, cz = v.comZ * VS;
      pos.push(cx, 0, cz, cx, (v.y1 + 1) * VS, cz);
      col.push(1, 1, 1, 1, 1, 1);
      pos.push(cx - 0.6, 0.05, cz, cx + 0.6, 0.05, cz, cx, 0.05, cz - 0.6, cx, 0.05, cz + 0.6);
      col.push(1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    const lines = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ vertexColors: true, depthTest: false, transparent: true, opacity: 0.95 }));
    lines.renderOrder = 10;
    g.add(lines);
  }

  // 화면 모델 동기화 (매 프레임)
  sync(time, budgetMs) {
    for (const m of Object.values(this.machines)) m.sync();
    if (this.truck) this.truck.sync();
    if (this.explosives) this.explosives.sync(this.selCharge, time);
    this.bodyView.sync(this.sim.bodies.list);
    this.chunkView.update(budgetMs);
    this.updateStruct();
  }

  focusPoint() {
    if (this.activeKind === 'blast' || !this.active) {
      const c = this.cineCenter();
      return [c.x, Math.min(8, c.y), c.z];
    }
    return this.active.focus();
  }

  dispose() {
    const scene = this.g.scene;
    this.chunkView.clearAll();
    scene.remove(this.chunkView.group);
    this.bodyView.clear();
    for (const m of Object.values(this.machines)) m.disposeModel(scene);
    if (this.explosives) this.explosives.disposeModel(scene);
    if (this.truck) this.truck.disposeModel(scene);
    if (this.zoneMesh) scene.remove(this.zoneMesh);
    scene.remove(this.structGroup);
    this.sim.phys.free();
    this.g.presenter.clear();
  }
}

export { BUILDINGS, GX, GZ };
