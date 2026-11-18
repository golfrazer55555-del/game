// 발파: 기둥·벽에 장약을 설치하고 지연 시간을 정해 순서대로 터뜨린다.
import * as THREE from 'three';
import { VS, GX, GZ } from '../config.js';
import { LAYER } from '../world.js';
import { isStruct } from '../materials.js';

export const CHARGES = {
  std: { name: '표준 장약', E: 1.7e6, maxR: 5.5, price: 150000, size: 1 },
  big: { name: '대형 장약', E: 3.6e6, maxR: 7.5, price: 320000, size: 1.6 },
};
export const DELAYS = [0, 0.25, 0.5, 1, 1.5, 2, 3];
const DELAY_COLORS = [0xe23b2e, 0xf07c22, 0xf2c230, 0x58b947, 0x2fb5c9, 0x3a6fd8, 0x9a52d6];

export class Explosives {
  constructor() {
    this.list = [];
    this.nextId = 1;
    this.state = 'plan';        // plan → countdown → firing → done
    this.t = 0;
    this.countdown = 0;
    this.used = 0;              // 터뜨린 장약 수 (비용)
    this.cost = 0;
  }

  place(sim, hit, type = 'std', delay = 0) {
    if (this.state !== 'plan') return null;
    if (!hit || hit.ground || hit.i < 0) return null;
    const m = sim.world.mat[hit.i];
    if (!isStruct(m)) return null;
    // 같은 자리 근처에 이미 있으면 그걸 고른다
    const px = (hit.x + 0.5 + hit.nx * 0.35) * VS, py = (hit.y + 0.5 + hit.ny * 0.35) * VS, pz = (hit.z + 0.5 + hit.nz * 0.35) * VS;
    const near = this.list.find((c) => Math.hypot(c.x - px, c.y - py, c.z - pz) < 0.6);
    if (near) return near;
    const c = { id: this.nextId++, i: hit.i, x: px, y: py, z: pz, nx: hit.nx, ny: hit.ny, nz: hit.nz, type, delay, fired: false };
    this.list.push(c);
    return c;
  }
  remove(id) { this.list = this.list.filter((c) => c.id !== id); }
  clear() { this.list = []; }
  setDelay(id, d) { const c = this.list.find((q) => q.id === id); if (c) c.delay = d; }
  setType(id, t) { const c = this.list.find((q) => q.id === id); if (c) c.type = t; }
  totalCost() { return this.list.reduce((s, c) => s + CHARGES[c.type].price, 0); }

  arm(seconds = 5) {
    if (!this.list.length || this.state !== 'plan') return false;
    this.state = 'countdown';
    this.countdown = seconds;
    return true;
  }
  cancel() { if (this.state === 'countdown') this.state = 'plan'; }

  step(dt, sim) {
    if (this.state === 'countdown') {
      const before = Math.ceil(this.countdown);
      this.countdown -= dt;
      const after = Math.ceil(this.countdown);
      if (after !== before && after >= 0) sim.fx.push({ t: 'count', n: after });
      if (this.countdown <= 0) { this.state = 'firing'; this.t = 0; sim.fx.push({ t: 'fire' }); }
      return;
    }
    if (this.state !== 'firing') return;
    this.t += dt;
    let pending = 0;
    for (const c of this.list) {
      if (c.fired) continue;
      if (c.delay <= this.t + 1e-6) this.detonate(sim, c);
      else pending++;
    }
    if (!pending && this.t > 0.6) {
      this.state = 'done';
      this.used += this.list.length;
      this.cost += this.totalCost();
      sim.fx.push({ t: 'blastdone' });
    }
  }

  detonate(sim, c) {
    c.fired = true;
    const C = CHARGES[c.type];
    // 장약은 벽 안쪽(구멍 속)에 있다
    const x = c.x - c.nx * VS * 0.8, y = c.y - c.ny * VS * 0.8, z = c.z - c.nz * VS * 0.8;
    sim.damage.sphere(x, y, z, C.E, { mode: 'blast', origin: [x, y, z], speed: 15, maxR: C.maxR, jitter: 3 });
    sim.bodies.blastImpulse(x, y, z, C.E * 0.004, 9 * C.size);
    sim.fx.push({ t: 'blast', x, y, z, size: C.size });
  }

  // 다음 발파를 위해 설치 상태로 (터진 장약은 지운다)
  reset() {
    this.list = this.list.filter((c) => !c.fired);
    this.state = 'plan';
    this.t = 0;
  }

  // ───── 화면 ─────
  buildModel(scene) {
    this.group = new THREE.Group();
    scene.add(this.group);
    this.meshes = new Map();
    this.geo = new THREE.BoxGeometry(0.34, 0.34, 0.34);
    this.mats = DELAY_COLORS.map((c) => new THREE.MeshLambertMaterial({ color: c, emissive: c, emissiveIntensity: 0.25 }));
    this.selMat = new THREE.MeshBasicMaterial({ color: 0xffffff, wireframe: true });
    this.sel = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.6, 0.6), this.selMat);
    this.sel.visible = false;
    this.group.add(this.sel);
  }
  sync(selectedId, time) {
    if (!this.group) return;
    const alive = new Set();
    for (const c of this.list) {
      if (c.fired) continue;
      alive.add(c.id);
      let m = this.meshes.get(c.id);
      if (!m) { m = new THREE.Mesh(this.geo, this.mats[0]); m.castShadow = false; this.group.add(m); this.meshes.set(c.id, m); }
      const di = Math.max(0, DELAYS.indexOf(c.delay));
      m.material = this.mats[di];
      m.position.set(c.x, c.y, c.z);
      const s = CHARGES[c.type].size * (this.state === 'countdown' ? 1 + 0.15 * Math.sin(time * 18) : 1);
      m.scale.setScalar(s);
      if (c.id === selectedId) { this.sel.visible = true; this.sel.position.copy(m.position); this.sel.rotation.y = time * 2; }
    }
    if (!this.list.some((c) => c.id === selectedId && !c.fired)) this.sel.visible = false;
    for (const [id, m] of this.meshes) if (!alive.has(id)) { this.group.remove(m); this.meshes.delete(id); }
  }
  disposeModel(scene) { if (this.group) scene.remove(this.group); this.group = null; this.meshes = new Map(); }

  snapshot() { return { list: this.list.map((c) => ({ ...c })), nextId: this.nextId, state: this.state, t: this.t, countdown: this.countdown, used: this.used, cost: this.cost }; }
  restore(s) { this.list = s.list.map((c) => ({ ...c })); this.nextId = s.nextId; this.state = s.state; this.t = s.t; this.countdown = s.countdown; this.used = s.used; this.cost = s.cost; }
}

export { DELAY_COLORS, LAYER, GX, GZ };
