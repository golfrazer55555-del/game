// Rapier 물리: 땅, 월드 청크의 정적 충돌 상자, 동적 덩어리
import RAPIER from '@dimforge/rapier3d-compat';
import { VS, CS, GX, GZ, GRAVITY, SIM_DT } from './config.js';
import { NCX, NCZ, NCHUNK } from './world.js';

let ready = null;
export function loadPhysics() {
  if (!ready) ready = RAPIER.init().then(() => RAPIER);
  return ready;
}
export { RAPIER };

const visited = new Uint8Array(CS * CS * CS);

// 블록 덩어리를 큰 직육면체들로 나눈다 (탐욕 박스 분해)
export function greedyBoxes(get, sx, sy, sz, visit, maxBoxes = 1e9) {
  visit.fill(0, 0, sx * sy * sz);
  const out = [];
  const id = (x, y, z) => x + sx * (z + sz * y);
  for (let y = 0; y < sy; y++) for (let z = 0; z < sz; z++) for (let x = 0; x < sx; x++) {
    if (visit[id(x, y, z)] || !get(x, y, z)) continue;
    let w = 1;
    while (x + w < sx && !visit[id(x + w, y, z)] && get(x + w, y, z)) w++;
    let d = 1;
    grow: while (z + d < sz) {
      for (let t = 0; t < w; t++) if (visit[id(x + t, y, z + d)] || !get(x + t, y, z + d)) break grow;
      d++;
    }
    let h = 1;
    growY: while (y + h < sy) {
      for (let dz = 0; dz < d; dz++) for (let t = 0; t < w; t++) if (visit[id(x + t, y + h, z + dz)] || !get(x + t, y + h, z + dz)) break growY;
      h++;
    }
    for (let yy = 0; yy < h; yy++) for (let dz = 0; dz < d; dz++) for (let t = 0; t < w; t++) visit[id(x + t, y + yy, z + dz)] = 1;
    out.push([x, y, z, w, h, d]);
    if (out.length >= maxBoxes) return out;
  }
  return out;
}

export class Physics {
  constructor(world) {
    this.w = world;
    this.pw = new RAPIER.World({ x: 0, y: -GRAVITY, z: 0 });
    this.pw.timestep = SIM_DT;
    this.eq = new RAPIER.EventQueue(true);
    this.chunkCols = new Array(NCHUNK).fill(null);
    this.info = new Map();           // 충돌체 handle → { kind, ... }
    this.makeGround();
  }

  makeGround() {
    const g = RAPIER.ColliderDesc.cuboid(400, 2, 400).setTranslation(GX * VS / 2, -2, GZ * VS / 2).setFriction(0.9).setRestitution(0.02);
    const c = this.pw.createCollider(g);
    this.groundHandle = c.handle;
    this.info.set(c.handle, { kind: 'ground' });
  }

  // 바뀐 청크의 정적 충돌체를 다시 만든다 (결정적 순서)
  rebuildDirty() {
    const w = this.w;
    const list = w.colDirtyList;
    if (!list.length) return;
    list.sort((a, b) => a - b);
    for (const ci of list) { w.colDirty[ci] = 0; this.rebuildChunk(ci); }
    list.length = 0;
  }

  rebuildChunk(ci) {
    const old = this.chunkCols[ci];
    if (old) {
      for (const h of old) {
        const c = this.pw.getCollider(h);
        if (c) this.pw.removeCollider(c, true);
        this.info.delete(h);
      }
      this.chunkCols[ci] = null;
    }
    if (!this.w.chunkCount[ci]) return;
    const cx = ci % NCX, cz = ((ci / NCX) | 0) % NCZ, cy = (ci / (NCX * NCZ)) | 0;
    const x0 = cx * CS, y0 = cy * CS, z0 = cz * CS;
    const mat = this.w.mat;
    const get = (x, y, z) => mat[(x0 + x) + GX * ((z0 + z) + GZ * (y0 + y))] !== 0;
    const boxes = greedyBoxes(get, CS, CS, CS, visited);
    const hs = [];
    for (const [x, y, z, bw, bh, bd] of boxes) {
      const desc = RAPIER.ColliderDesc.cuboid(bw * VS / 2, bh * VS / 2, bd * VS / 2)
        .setTranslation((x0 + x + bw / 2) * VS, (y0 + y + bh / 2) * VS, (z0 + z + bd / 2) * VS)
        .setFriction(0.85).setRestitution(0.02);
      const c = this.pw.createCollider(desc);
      hs.push(c.handle);
      this.info.set(c.handle, { kind: 'static', chunk: ci });
    }
    this.chunkCols[ci] = hs;
  }

  rebuildAll() {
    for (let ci = 0; ci < NCHUNK; ci++) this.rebuildChunk(ci);
    this.w.colDirty.fill(0);
    this.w.colDirtyList.length = 0;
  }

  step() { this.pw.step(this.eq); }

  free() { this.pw.free(); this.eq.free(); }

  snapshot() {
    return { data: this.pw.takeSnapshot(), chunkCols: this.chunkCols.map((a) => (a ? a.slice() : null)), info: [...this.info.entries()].map(([h, v]) => [h, { ...v }]), groundHandle: this.groundHandle };
  }
  restore(s, bodiesById) {
    this.pw.free();
    this.pw = RAPIER.World.restoreSnapshot(s.data);
    this.pw.timestep = SIM_DT;
    this.chunkCols = s.chunkCols.map((a) => (a ? a.slice() : null));
    this.info = new Map(s.info.map(([h, v]) => [h, { ...v }]));
    for (const v of this.info.values()) if (v.kind === 'body' && bodiesById) v.body = bodiesById.get(v.bodyId) || null;
    this.groundHandle = s.groundHandle;
  }
}
