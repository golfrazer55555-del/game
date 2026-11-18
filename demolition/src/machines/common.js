// 장비 공통: 주행 충돌, 박스 모델 도우미
import * as THREE from 'three';
import { VS, GX, GY, GZ } from '../config.js';
import { RUBBLE } from '../materials.js';

// 장비 바닥 면적(직사각형) 안 블록 검사. 반환: { blocked, ground } (ground = 밟고 설 높이 m)
export function footprint(world, x, z, heading, halfW, halfL, stepH = 0.6, curY = 0) {
  const cs = Math.cos(heading), sn = Math.sin(heading);
  let maxTop = 0, blocked = false;
  const mat = world.mat;
  const samples = [];
  for (let u = -halfW; u <= halfW + 1e-6; u += VS * 2) for (let v = -halfL; v <= halfL + 1e-6; v += VS * 2) samples.push([u, v]);
  for (const [u, v] of samples) {
    // 앞(+z)이 heading 방향
    const px = x + u * cs + v * sn, pz = z - u * sn + v * cs;
    const gx = Math.floor(px / VS), gz = Math.floor(pz / VS);
    if (gx < 0 || gx >= GX || gz < 0 || gz >= GZ) continue;
    // 현재 높이 위쪽 몇 칸 안에서 가장 높은 블록
    const y0 = Math.max(0, Math.floor(curY / VS) - 2), y1 = Math.min(GY - 1, Math.floor((curY + 2.5) / VS));
    let top = 0;
    for (let y = y0; y <= y1; y++) {
      const m = mat[gx + GX * (gz + GZ * y)];
      if (!m) continue;
      if (!(m & RUBBLE) && (y + 1) * VS - curY > stepH) { blocked = true; }
      top = Math.max(top, (y + 1) * VS);
    }
    maxTop = Math.max(maxTop, top);
  }
  return { blocked: blocked || maxTop - curY > stepH, ground: maxTop };
}

// 지면 높이 샘플 (잔해 더미를 타고 오를 때)
export function groundHeightAt(world, px, pz, curY) {
  const gx = Math.floor(px / VS), gz = Math.floor(pz / VS);
  if (gx < 0 || gx >= GX || gz < 0 || gz >= GZ) return 0;
  const y1 = Math.min(GY - 1, Math.floor((curY + 0.9) / VS));
  for (let y = y1; y >= 0; y--) if (world.mat[gx + GX * (gz + GZ * y)]) return (y + 1) * VS;
  return 0;
}

const matCache = new Map();
export function boxMat(color) {
  let m = matCache.get(color);
  if (!m) { m = new THREE.MeshLambertMaterial({ color }); matCache.set(color, m); }
  return m;
}

export function box(parent, w, h, d, color, x = 0, y = 0, z = 0, shadow = true) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), boxMat(color));
  m.position.set(x, y, z);
  m.castShadow = shadow; m.receiveShadow = shadow;
  parent.add(m);
  return m;
}

// 블록으로 만든 공 모양 (쇠공)
export function voxelBall(radius, color, cell = 0.125) {
  const geos = [];
  const n = Math.ceil(radius / cell);
  const base = new THREE.BoxGeometry(cell, cell, cell);
  const positions = [], normals = [], indices = [];
  let vi = 0;
  for (let y = -n; y < n; y++) for (let z = -n; z < n; z++) for (let x = -n; x < n; x++) {
    const cx = (x + 0.5) * cell, cy = (y + 0.5) * cell, cz = (z + 0.5) * cell;
    if (Math.hypot(cx, cy, cz) > radius) continue;
    // 바깥 껍질만
    const inner = Math.hypot(Math.abs(cx) + cell, Math.abs(cy) + cell, Math.abs(cz) + cell) <= radius;
    if (inner) continue;
    const p = base.attributes.position.array, nn = base.attributes.normal.array, id = base.index.array;
    for (let k = 0; k < p.length; k += 3) { positions.push(p[k] + cx, p[k + 1] + cy, p[k + 2] + cz); normals.push(nn[k], nn[k + 1], nn[k + 2]); }
    for (let k = 0; k < id.length; k++) indices.push(id[k] + vi);
    vi += p.length / 3;
  }
  void geos;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  g.setIndex(indices);
  const mesh = new THREE.Mesh(g, boxMat(color));
  mesh.castShadow = true;
  return mesh;
}

// 격자 붐 (길이 len, x축 방향)
export function latticeBoom(len, width, color) {
  const group = new THREE.Group();
  const chord = 0.12, lace = 0.06;
  const hw = width / 2;
  for (const [y, z] of [[-hw, -hw], [-hw, hw], [hw, -hw], [hw, hw]]) box(group, len, chord, chord, color, len / 2, y, z);
  const segs = Math.max(4, Math.round(len / 1.4));
  const sl = len / segs;
  const diag = Math.hypot(sl, width);
  const ang = Math.atan2(width, sl);
  for (let k = 0; k < segs; k++) {
    const x = (k + 0.5) * sl;
    for (const [side, axis] of [[-hw, 'z'], [hw, 'z'], [-hw, 'y'], [hw, 'y']]) {
      const m = box(group, diag, lace, lace, color, x, axis === 'z' ? 0 : side, axis === 'z' ? side : 0, false);
      if (axis === 'z') m.rotation.z = (k % 2 ? 1 : -1) * ang; else m.rotation.y = (k % 2 ? 1 : -1) * ang;
    }
  }
  return group;
}

export function stripeTexture(a = '#f2b705', b = '#222') {
  const c = document.createElement('canvas'); c.width = 16; c.height = 16;
  const g = c.getContext('2d');
  g.fillStyle = a; g.fillRect(0, 0, 16, 16);
  g.fillStyle = b;
  for (let k = -16; k < 32; k += 8) { g.beginPath(); g.moveTo(k, 0); g.lineTo(k + 4, 0); g.lineTo(k + 20, 16); g.lineTo(k + 16, 16); g.fill(); }
  const t = new THREE.CanvasTexture(c); t.magFilter = THREE.NearestFilter; t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
