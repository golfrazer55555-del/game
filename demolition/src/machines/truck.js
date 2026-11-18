// 덤프트럭: 버킷으로 잔해를 실으면 가득 찼을 때 반출하고 돌아온다. 고철은 팔아서 돈이 된다.
import * as THREE from 'three';
import { VS } from '../config.js';
import { DENSITY, MCLS, SCRAP_VALUE } from '../materials.js';
import { box } from './common.js';

const VOL = VS * VS * VS;

export class Truck {
  constructor(spawn) {
    this.kind = 'truck';
    this.home = { x: spawn.x * VS, z: spawn.z * VS, heading: spawn.heading || Math.PI / 2 };
    this.s = { x: this.home.x, z: this.home.z, heading: this.home.heading, load: 0, cap: 1500, state: 'parked', t: 0, trips: 0, hauled: 0, value: 0, kg: 0 };
  }
  catches(p) {
    const s = this.s;
    if (s.state !== 'parked') return false;
    const cs = Math.cos(s.heading), sn = Math.sin(s.heading);
    const dx = p[0] - s.x, dz = p[2] - s.z;
    const u = dx * cs - dz * sn, v = dx * sn + dz * cs;   // 트럭 좌표 (v = 앞뒤)
    return Math.abs(u) < 1.7 && v > -3.6 && v < 0.8 && p[1] > 0.8 && p[1] < 10;
  }
  receive(mats, n, sim) {
    const s = this.s;
    let left = n;
    for (const k of Object.keys(mats)) {
      const t = Math.min(mats[k], left);
      const kg = t * VOL * DENSITY[+k];
      s.kg += kg;
      s.value += kg * (SCRAP_VALUE[MCLS[+k]] || 0);
      left -= t;
      if (left <= 0) break;
    }
    s.load += n;
    s.hauled += n;
    if (s.load >= s.cap) { s.state = 'leaving'; s.t = 0; sim.fx.push({ t: 'truck', s: 'leave' }); }
  }
  step(dt) {
    const s = this.s;
    if (s.state === 'parked') return;
    s.t += dt;
    if (s.state === 'leaving') {
      const k = Math.min(1, s.t / 6);
      s.x = this.home.x + k * k * 40;
      if (k >= 1) { s.state = 'away'; s.t = 0; s.trips++; s.load = 0; }
    } else if (s.state === 'away') {
      if (s.t > 6) { s.state = 'returning'; s.t = 0; }
    } else if (s.state === 'returning') {
      const k = Math.min(1, s.t / 6);
      s.x = this.home.x + (1 - k) * (1 - k) * 40;
      if (k >= 1) { s.state = 'parked'; s.x = this.home.x; }
    }
  }
  focus() { return [this.s.x, 2, this.s.z]; }

  buildModel(scene) {
    const g = new THREE.Group();
    const BLUE = 0x2f5fa8, DARK = 0x222428, YEL = 0xf2b705;
    for (const v of [-2.4, -0.6, 1.4]) for (const u of [-1.05, 1.05]) box(g, 0.4, 0.9, 0.9, DARK, u, 0.45, v);
    box(g, 2.3, 0.4, 6.0, DARK, 0, 0.9, -0.4);
    box(g, 2.3, 1.7, 1.6, BLUE, 0, 1.9, 1.9);
    box(g, 2.32, 0.8, 1.0, 0x6c9bb8, 0, 2.2, 2.2, false);
    const bed = new THREE.Group(); bed.position.set(0, 1.15, -1.3); g.add(bed);
    box(bed, 2.4, 0.15, 3.8, YEL, 0, 0, 0);
    box(bed, 0.12, 1.1, 3.8, YEL, -1.15, 0.6, 0); box(bed, 0.12, 1.1, 3.8, YEL, 1.15, 0.6, 0);
    box(bed, 2.4, 1.1, 0.12, YEL, 0, 0.6, -1.85); box(bed, 2.4, 1.3, 0.12, YEL, 0, 0.7, 1.85);
    const loadMesh = box(bed, 2.2, 1, 3.6, 0x7b6a57, 0, 0.6, 0, false);
    scene.add(g);
    this.model = { g, loadMesh };
  }
  sync() {
    const m = this.model, s = this.s;
    if (!m) return;
    m.g.position.set(s.x, 0, s.z);
    m.g.rotation.y = s.heading;
    m.loadMesh.visible = s.load > 0;
    m.loadMesh.scale.y = Math.max(0.05, Math.min(1, s.load / s.cap));
    m.loadMesh.position.y = 0.1 + 0.5 * m.loadMesh.scale.y;
  }
  disposeModel(scene) { if (this.model) scene.remove(this.model.g); this.model = null; }
  snapshot() { return { ...this.s }; }
  restore(d) { this.s = { ...d }; }
}
