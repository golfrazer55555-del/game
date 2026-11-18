// 복셀 지형: 생성, 메시 생성(AO 포함), 파괴
import * as THREE from 'three';
import { W, D, H, CHUNK, V, PALETTE } from './config.js';
import { mulberry32, makeNoise2D, fbm, hash3, clamp, smoothstep, lerp } from './util.js';

const AO = [0.5, 0.68, 0.84, 1.0];

// 6면 정의: 축 a, 방향 s, 접선축 u·v (u × v = 법선)
const FACES = [];
for (let a = 0; a < 3; a++) {
  for (const s of [1, -1]) {
    let u = (a + 1) % 3, v = (a + 2) % 3;
    if (s < 0) [u, v] = [v, u];
    FACES.push({ a, s, u, v, n: [a === 0 ? s : 0, a === 1 ? s : 0, a === 2 ? s : 0] });
  }
}

const SCORCHABLE = new Set([V.GRASS, V.GRASS2, V.DIRT, V.ROAD, V.SAND, V.STONE]);
const TREE_TYPES = new Set([V.WOOD, V.LEAVES, V.PINE]);

export class VoxelWorld {
  constructor(scene) {
    this.data = new Uint8Array(W * H * D);
    this.material = new THREE.MeshLambertMaterial({ vertexColors: true });
    this.group = new THREE.Group();
    scene.add(this.group);
    this.ncx = Math.ceil(W / CHUNK);
    this.ncz = Math.ceil(D / CHUNK);
    this.meshes = [];
    this.dirty = new Set();
    this.trees = [];
    this.spawns = [];
    this.version = 0;
    this.baseColors = {};
    for (const k in PALETTE) this.baseColors[k] = new THREE.Color(PALETTE[k]);
  }

  get(x, y, z) {
    if (y < 0) return V.BEDROCK;
    if (x < 0 || x >= W || z < 0 || z >= D || y >= H) return V.AIR;
    return this.data[x + W * (z + D * y)];
  }

  set(x, y, z, t) {
    if (x < 0 || x >= W || z < 0 || z >= D || y < 0 || y >= H) return;
    this.data[x + W * (z + D * y)] = t;
  }

  solidAt(px, py, pz) {
    return this.get(Math.floor(px), Math.floor(py), Math.floor(pz)) !== V.AIR;
  }

  // (x,z) 열에서 maxY 아래 가장 높은 블록의 윗면 높이
  groundAt(px, pz, maxY = H) {
    const x = Math.floor(px), z = Math.floor(pz);
    if (x < 0 || x >= W || z < 0 || z >= D) return -50;
    for (let y = Math.min(H - 1, Math.ceil(maxY) - 1); y >= 0; y--) {
      if (this.data[x + W * (z + D * y)]) return y + 1;
    }
    return 0;
  }

  topHeight(x, z) { return this.groundAt(x, z, H); }

  markDirty(x0, z0, x1, z1) {
    const cx0 = clamp(Math.floor((x0 - 1) / CHUNK), 0, this.ncx - 1);
    const cx1 = clamp(Math.floor((x1 + 1) / CHUNK), 0, this.ncx - 1);
    const cz0 = clamp(Math.floor((z0 - 1) / CHUNK), 0, this.ncz - 1);
    const cz1 = clamp(Math.floor((z1 + 1) / CHUNK), 0, this.ncz - 1);
    for (let cz = cz0; cz <= cz1; cz++) for (let cx = cx0; cx <= cx1; cx++) this.dirty.add(cx + cz * this.ncx);
  }

  // ───────────────────────── 지형 생성 ─────────────────────────
  generate(seed) {
    const rand = mulberry32(seed);
    const n1 = makeNoise2D(rand), n2 = makeNoise2D(rand), n3 = makeNoise2D(rand);
    this.data.fill(0);
    this.trees = [];
    const reserved = new Uint8Array(W * D); // 나무를 심지 않을 칸

    const pz = Math.floor(16 + rand() * (D - 32));
    const ez = Math.floor(16 + rand() * (D - 32));
    this.spawns = [{ x: 18.5, z: pz + 0.5 }, { x: W - 18.5, z: ez + 0.5 }];

    // 1) 높이맵
    const hm = new Float32Array(W * D);
    for (let z = 0; z < D; z++) {
      for (let x = 0; x < W; x++) {
        let h = 7 + fbm(n1, x * 0.03, z * 0.03, 4) * 9;
        const rx = x - W * 0.5 - Math.sin(z * 0.07 + seed % 7) * 7;
        h += 8.5 * Math.exp(-(rx * rx) / (2 * 11 * 11)) * (0.55 + 0.6 * fbm(n2, z * 0.05, 3.7, 3));
        hm[x + z * W] = h;
      }
    }
    for (const s of this.spawns) {
      const padH = hm[Math.floor(s.x) + Math.floor(s.z) * W];
      for (let z = 0; z < D; z++) for (let x = 0; x < W; x++) {
        const d = Math.hypot(x + 0.5 - s.x, z + 0.5 - s.z);
        if (d < 7) hm[x + z * W] = lerp(hm[x + z * W], padH, smoothstep(7, 3, d));
        if (d < 14) reserved[x + z * W] = 1; // 조준 시점을 가리지 않도록 나무 금지
      }
    }
    const colH = new Int32Array(W * D);
    for (let i = 0; i < W * D; i++) colH[i] = clamp(Math.round(hm[i]), 3, H - 9);

    // 2) 열 채우기
    const roadZ = (x) => D * 0.5 + Math.sin(x * 0.045 + (seed % 13)) * D * 0.28;
    for (let z = 0; z < D; z++) {
      for (let x = 0; x < W; x++) {
        const i = x + z * W, h = colH[i];
        const patch = n3(x * 0.08, z * 0.08);
        let steep = 0;
        if (x > 0 && x < W - 1 && z > 0 && z < D - 1) {
          steep = Math.max(Math.abs(h - colH[i - 1]), Math.abs(h - colH[i + 1]), Math.abs(h - colH[i - W]), Math.abs(h - colH[i + W]));
        }
        const onRoad = Math.abs(z + 0.5 - roadZ(x)) < 1.6;
        if (onRoad) reserved[i] = 1;
        for (let y = 0; y < h; y++) {
          let t;
          if (y === 0) t = V.BEDROCK;
          else if (y === h - 1) t = onRoad ? V.ROAD : steep >= 3 ? V.STONE : patch > 0.64 ? V.DIRT : patch < 0.36 ? V.GRASS2 : V.GRASS;
          else if (y >= h - 4) t = V.DIRT;
          else t = V.STONE;
          this.set(x, y, z, t);
        }
      }
    }

    // 3) 폐허가 된 집
    const houses = 2 + Math.floor(rand() * 2);
    for (let k = 0, tries = 0; k < houses && tries < 60; tries++) {
      const hx = Math.floor(34 + rand() * (W - 76)), hz = Math.floor(6 + rand() * (D - 18));
      if (Math.abs(hx + 3.5 - W / 2) < 10) continue;
      let ok = true;
      for (let z = hz - 1; z < hz + 7 && ok; z++) for (let x = hx - 1; x < hx + 8; x++) if (reserved[x + z * W] === 2) ok = false;
      if (!ok) continue;
      this.buildHouse(hx, hz, 7, 6, colH, reserved, rand);
      k++;
    }

    // 4) 모래주머니 참호 (서로를 향해)
    for (let i = 0; i < 2; i++) {
      const s = this.spawns[i], o = this.spawns[1 - i];
      const base = Math.atan2(o.z - s.z, o.x - s.x);
      for (let a = -42; a <= 42; a += 7) {
        const ang = base + a * Math.PI / 180;
        const x = Math.floor(s.x + Math.cos(ang) * 4.6), z = Math.floor(s.z + Math.sin(ang) * 4.6);
        const g = this.topHeight(x, z);
        this.set(x, g, z, V.SAND);
        if (Math.abs(a) < 30 && (a / 7) % 2 === 0) this.set(x, g + 1, z, V.SAND);
      }
    }

    // 5) 대전차 장애물
    for (let k = 0, tries = 0; k < 6 && tries < 80; tries++) {
      const x = Math.floor(30 + rand() * (W - 60)), z = Math.floor(4 + rand() * (D - 8));
      if (reserved[x + z * W]) continue;
      const g = this.topHeight(x, z);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
        if ((dz === 0 && Math.abs(dx) === Math.abs(dy)) || (dx === 0 && Math.abs(dz) === Math.abs(dy))) {
          if (this.get(x + dx, g + 1 + dy, z + dz) === V.AIR) this.set(x + dx, g + 1 + dy, z + dz, V.METAL);
        }
      }
      reserved[x + z * W] = 1;
      k++;
    }

    // 6) 나무
    for (let k = 0, tries = 0; k < 42 && tries < 400; tries++) {
      const x = Math.floor(3 + rand() * (W - 6)), z = Math.floor(3 + rand() * (D - 6));
      if (reserved[x + z * W]) continue;
      const g = this.topHeight(x, z);
      if (this.get(x, g - 1, z) === V.STONE && rand() < 0.7) continue;
      this.plantTree(x, g, z, rand() < 0.6, rand);
      for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) {
        const xx = x + dx, zz = z + dz;
        if (xx >= 0 && xx < W && zz >= 0 && zz < D && !reserved[xx + zz * W]) reserved[xx + zz * W] = 1;
      }
      k++;
    }

    // 7) 이미 패인 포탄 구덩이
    for (let k = 0, tries = 0; k < 8 && tries < 60; tries++) {
      const x = 20 + rand() * (W - 40), z = 4 + rand() * (D - 8);
      if (this.spawns.some((s) => Math.hypot(s.x - x, s.z - z) < 12)) continue;
      const g = this.topHeight(Math.floor(x), Math.floor(z));
      this.explode(x, g - 0.3, z, 1.6 + rand() * 1.2);
      k++;
    }

    for (const s of this.spawns) s.y = this.topHeight(Math.floor(s.x), Math.floor(s.z));
    this.dirty.clear();
    this.buildAll();
  }

  buildHouse(hx, hz, w, d, colH, reserved, rand) {
    let sum = 0;
    for (let z = hz; z < hz + d; z++) for (let x = hx; x < hx + w; x++) sum += colH[x + z * W];
    const base = Math.round(sum / (w * d));
    for (let z = hz - 1; z <= hz + d; z++) for (let x = hx - 1; x <= hx + w; x++) {
      for (let y = 1; y < H; y++) {
        if (y < base) { if (this.get(x, y, z) === V.AIR) this.set(x, y, z, y === base - 1 ? V.DIRT : V.STONE); }
        else this.set(x, y, z, V.AIR);
      }
      if (x >= 0 && x < W && z >= 0 && z < D) reserved[x + z * W] = 2;
    }
    const doorX = hx + 2 + Math.floor(rand() * (w - 4));
    for (let z = hz; z < hz + d; z++) for (let x = hx; x < hx + w; x++) {
      const edge = x === hx || x === hx + w - 1 || z === hz || z === hz + d - 1;
      if (!edge) {
        this.set(x, base - 1, z, V.STONE);
        if (rand() < 0.18) this.set(x, base, z, rand() < 0.5 ? V.BRICK : V.PLASTER); // 잔해
        continue;
      }
      const corner = (x === hx || x === hx + w - 1) && (z === hz || z === hz + d - 1);
      const ruin = Math.floor(hash3(x, 7, z) * 3.2 + Math.sin(x * 1.7 + z) * 0.8);
      const top = corner ? 5 : clamp(5 - ruin, 1, 5);
      for (let y = 0; y < top; y++) {
        const window = !corner && y === 2 && ((x + z) % 3 === 0);
        const door = z === hz + d - 1 && x === doorX && y < 2;
        if (window || door) continue;
        this.set(x, base + y, z, corner || hash3(x, y, z) < 0.3 ? V.BRICK : V.PLASTER);
      }
    }
    for (let z = hz; z < hz + d; z++) for (let x = hx; x < hx + w; x++) {
      if (hash3(x, 99, z) < 0.38) this.set(x, base + 5, z, V.ROOF);
    }
  }

  plantTree(x, g, z, pine, rand) {
    const tree = { trunk: [], all: [], x, z, base: g, alive: true };
    const put = (xx, yy, zz, t, trunk) => {
      if (yy >= H || this.get(xx, yy, zz) !== V.AIR) return;
      this.set(xx, yy, zz, t);
      tree.all.push([xx, yy, zz]);
      if (trunk) tree.trunk.push([xx, yy, zz]);
    };
    if (pine) {
      const th = 4 + Math.floor(rand() * 3), top = g + th + 2;
      for (let y = g; y < g + th; y++) put(x, y, z, V.WOOD, true);
      for (let y = g + 2; y <= top; y++) {
        const r = Math.min(2, Math.round((top - y) * 0.5));
        for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
          if (dx * dx + dz * dz <= r * r + 0.6) put(x + dx, y, z + dz, V.PINE, false);
        }
      }
    } else {
      const th = 3 + Math.floor(rand() * 2), cy = g + th;
      for (let y = g; y < cy; y++) put(x, y, z, V.WOOD, true);
      for (let dy = -2; dy <= 2; dy++) for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) {
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 <= 5.3 && !(d2 > 3 && hash3(x + dx, cy + dy, z + dz) < 0.25)) put(x + dx, cy + dy, z + dz, V.LEAVES, false);
      }
    }
    this.trees.push(tree);
  }

  // ───────────────────────── 파괴 ─────────────────────────
  // 반경 r 안의 블록 제거. 제거된 블록 목록 반환 (파편 연출용)
  explode(cx, cy, cz, r) {
    const removed = [];
    const R = Math.ceil(r + 2);
    const ix = Math.floor(cx), iy = Math.floor(cy), iz = Math.floor(cz);
    const y0 = Math.max(1, iy - R), y1 = Math.min(H - 1, iy + R);
    const x0 = Math.max(0, ix - R), x1 = Math.min(W - 1, ix + R);
    const z0 = Math.max(0, iz - R), z1 = Math.min(D - 1, iz + R);
    for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
      const i = x + W * (z + D * y), t = this.data[i];
      if (!t || t === V.BEDROCK) continue;
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy, z + 0.5 - cz);
      if (d < r * (0.8 + hash3(x * 7, y * 13, z * 3) * 0.4)) {
        removed.push({ x, y, z, t });
        this.data[i] = V.AIR;
      }
    }
    // 그을림
    for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
      const i = x + W * (z + D * y), t = this.data[i];
      if (!SCORCHABLE.has(t)) continue;
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy, z + 0.5 - cz);
      if (d > r + 1.6 || hash3(x, y * 3, z) > 0.85) continue;
      if (!this.get(x, y + 1, z) || !this.get(x + 1, y, z) || !this.get(x - 1, y, z) || !this.get(x, y, z + 1) || !this.get(x, y, z - 1)) {
        this.data[i] = V.SCORCH;
      }
    }
    // 줄기가 끊기거나 땅이 꺼진 나무는 쓰러짐
    for (const tree of this.trees) {
      if (!tree.alive || Math.abs(tree.x - cx) > R + 3 || Math.abs(tree.z - cz) > R + 3) continue;
      const broken = tree.trunk.some(([x, y, z]) => this.get(x, y, z) !== V.WOOD) || this.get(tree.x, tree.base - 1, tree.z) === V.AIR;
      if (!broken) continue;
      tree.alive = false;
      for (const [x, y, z] of tree.all) {
        const t = this.get(x, y, z);
        if (TREE_TYPES.has(t)) {
          removed.push({ x, y, z, t, fall: true });
          this.set(x, y, z, V.AIR);
        }
      }
      this.markDirty(tree.x - 3, tree.z - 3, tree.x + 3, tree.z + 3);
    }
    this.markDirty(x0, z0, x1, z1);
    this.version++;
    return removed;
  }

  // ───────────────────────── 메시 ─────────────────────────
  buildAll() {
    for (let cz = 0; cz < this.ncz; cz++) for (let cx = 0; cx < this.ncx; cx++) this.buildChunk(cx, cz);
  }

  rebuildDirty() {
    for (const key of this.dirty) this.buildChunk(key % this.ncx, Math.floor(key / this.ncx));
    this.dirty.clear();
  }

  buildChunk(cx, cz) {
    const x0 = cx * CHUNK, z0 = cz * CHUNK;
    const x1 = Math.min(W, x0 + CHUNK), z1 = Math.min(D, z0 + CHUNK);
    const pos = [], nor = [], col = [], ind = [];
    const p = [0, 0, 0], q = [0, 0, 0], c = [0, 0, 0], ao = [0, 0, 0, 0];
    let vi = 0;
    for (let y = 0; y < H; y++) for (let z = z0; z < z1; z++) for (let x = x0; x < x1; x++) {
      const t = this.data[x + W * (z + D * y)];
      if (!t) continue;
      const base = this.baseColors[t];
      const jitter = 0.9 + hash3(x, y, z) * 0.2;
      for (let f = 0; f < 6; f++) {
        const F = FACES[f];
        p[0] = x; p[1] = y; p[2] = z; p[F.a] += F.s;
        if (this.get(p[0], p[1], p[2])) continue;
        const shade = jitter * (F.a === 1 && F.s < 0 ? 0.75 : 1);
        for (let k = 0; k < 4; k++) {
          const cu = k === 1 || k === 2 ? 1 : 0, cv = k >= 2 ? 1 : 0;
          const du = cu ? 1 : -1, dv = cv ? 1 : -1;
          q[0] = p[0]; q[1] = p[1]; q[2] = p[2]; q[F.u] += du;
          const s1 = this.get(q[0], q[1], q[2]) ? 1 : 0;
          q[F.v] += dv;
          const cc = this.get(q[0], q[1], q[2]) ? 1 : 0;
          q[F.u] -= du;
          const s2 = this.get(q[0], q[1], q[2]) ? 1 : 0;
          const a = s1 && s2 ? 0 : 3 - (s1 + s2 + cc);
          ao[k] = a;
          c[0] = x; c[1] = y; c[2] = z;
          if (F.s > 0) c[F.a] += 1;
          c[F.u] += cu; c[F.v] += cv;
          pos.push(c[0], c[1], c[2]);
          nor.push(F.n[0], F.n[1], F.n[2]);
          const m = shade * AO[a];
          col.push(base.r * m, base.g * m, base.b * m);
        }
        if (ao[0] + ao[2] < ao[1] + ao[3]) ind.push(vi + 1, vi + 2, vi + 3, vi + 1, vi + 3, vi);
        else ind.push(vi, vi + 1, vi + 2, vi, vi + 2, vi + 3);
        vi += 4;
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(ind);
    g.computeBoundingSphere();
    const key = cx + cz * this.ncx;
    let mesh = this.meshes[key];
    if (mesh) {
      mesh.geometry.dispose();
      mesh.geometry = g;
    } else {
      mesh = new THREE.Mesh(g, this.material);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.group.add(mesh);
      this.meshes[key] = mesh;
    }
  }
}
