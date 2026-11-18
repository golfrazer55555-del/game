// 블록 렌더링: 픽셀 블록 셰이더, 월드 청크 메시, 움직이는 덩어리 메시
import * as THREE from 'three';
import { VS, CS, GX, GY, GZ } from './config.js';
import { NCX, NCZ, NCHUNK } from './world.js';
import { meshWorldChunk, meshPadded, padBuf } from './mesher.js';

// 합쳐진 큰 면 위에도 블록 한 칸마다 밝기 차이와 경계선을 다시 그린다
export function createVoxelMaterial() {
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vVox;\nvarying vec3 vVoxN;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n\tvVox = position;\n\tvVoxN = normal;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec3 vVox;
varying vec3 vVoxN;
float vhash(vec3 p) {
  p = fract(p * 0.3183099 + vec3(0.71, 0.113, 0.419));
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
  {
    vec3 cell = floor(vVox - vVoxN * 0.5);
    float h = vhash(cell);
    diffuseColor.rgb *= 0.9 + 0.2 * h;
    vec3 f = fract(vVox);
    vec3 e = min(f, 1.0 - f);
    vec3 an = abs(vVoxN);
    float d = 1.0;
    if (an.x < 0.5) d = min(d, e.x);
    if (an.y < 0.5) d = min(d, e.y);
    if (an.z < 0.5) d = min(d, e.z);
    vec3 fw3 = fwidth(vVox);
    float fw = max(max(fw3.x, fw3.y), fw3.z);
    float lineW = 0.045;
    float edge = smoothstep(lineW - fw * 0.6, lineW + fw * 0.6, d);
    float fade = 1.0 - smoothstep(0.12, 0.4, fw);
    diffuseColor.rgb *= mix(1.0, mix(0.74, 1.0, edge), fade);
  }`);
  };
  mat.customProgramCacheKey = () => 'voxel-v1';
  return mat;
}

function buildGeometry(m, center, radius) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(m.pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(m.nor, 3));
  g.setAttribute('color', new THREE.BufferAttribute(m.col, 3, true));
  g.setIndex(new THREE.BufferAttribute(m.idx, 1));
  g.boundingSphere = new THREE.Sphere(center, radius);
  return g;
}

export class ChunkView {
  constructor(scene, world, material) {
    this.world = world;
    this.material = material;
    this.group = new THREE.Group();
    this.group.scale.setScalar(VS);
    this.group.matrixAutoUpdate = false;
    this.group.updateMatrix();
    scene.add(this.group);
    this.meshes = new Array(NCHUNK).fill(null);
    this.shadows = true;
  }

  setShadows(on) {
    this.shadows = on;
    for (const m of this.meshes) if (m) { m.castShadow = on; m.receiveShadow = on; }
  }

  // 시간 예산 안에서 바뀐 청크를 다시 만든다
  update(budgetMs = 6, force = false) {
    const w = this.world;
    const list = w.meshDirtyList;
    if (!list.length) return 0;
    const t0 = performance.now();
    let n = 0;
    while (list.length) {
      const ci = list.shift();
      w.meshDirty[ci] = 0;
      this.rebuild(ci);
      n++;
      if (!force && performance.now() - t0 > budgetMs) break;
    }
    return n;
  }

  rebuild(ci) {
    const cx = ci % NCX, cz = ((ci / NCX) | 0) % NCZ, cy = (ci / (NCX * NCZ)) | 0;
    let old = this.meshes[ci];
    // 비어 있으면서 이웃도 영향 없으면 제거
    const m = this.world.chunkCount[ci] ? meshWorldChunk(this.world, cx, cy, cz, CS) : null;
    if (!m) {
      if (old) { this.group.remove(old); old.geometry.dispose(); this.meshes[ci] = null; }
      return;
    }
    const center = new THREE.Vector3(cx * CS + CS / 2, cy * CS + CS / 2, cz * CS + CS / 2);
    const geo = buildGeometry(m, center, CS * 0.87);
    if (old) { old.geometry.dispose(); old.geometry = geo; }
    else {
      old = new THREE.Mesh(geo, this.material);
      old.castShadow = this.shadows; old.receiveShadow = this.shadows;
      old.matrixAutoUpdate = false;
      this.group.add(old);
      this.meshes[ci] = old;
    }
  }

  clearAll() {
    for (let i = 0; i < NCHUNK; i++) {
      const m = this.meshes[i];
      if (m) { this.group.remove(m); m.geometry.dispose(); this.meshes[i] = null; }
    }
  }
}

// 움직이는 덩어리(복셀 바디) 메시: 16칸 하위 청크 단위로 다시 만든다
export class BodyView {
  constructor(scene, material) {
    this.scene = scene;
    this.material = material;
    this.views = new Map();   // body.id → { group, inner, subs: Map }
    this.shadows = true;
  }

  sync(bodies, budgetMs = 4) {
    const seen = new Set();
    const t0 = performance.now();
    for (const b of bodies) {
      seen.add(b.id);
      let v = this.views.get(b.id);
      if (!v) {
        const group = new THREE.Group();
        const inner = new THREE.Group();
        inner.scale.setScalar(VS);
        inner.position.set(-b.o[0] * VS, -b.o[1] * VS, -b.o[2] * VS);
        group.add(inner);
        this.scene.add(group);
        v = { group, inner, subs: new Map(), built: false };
        this.views.set(b.id, v);
      }
      // 처음 만들 때는 예산과 상관없이 전부, 이후엔 바뀐 하위 청크만
      if (b.subDirty.size && (!v.built || performance.now() - t0 < budgetMs)) {
        for (const sc of b.subDirty) this.buildSub(b, v, sc);
        b.subDirty.clear();
        v.built = true;
      }
      v.group.position.set(b.pos.x, b.pos.y, b.pos.z);
      v.group.quaternion.set(b.rot.x, b.rot.y, b.rot.z, b.rot.w);
    }
    for (const [id, v] of this.views) {
      if (seen.has(id)) continue;
      this.scene.remove(v.group);
      for (const m of v.subs.values()) m.geometry.dispose();
      this.views.delete(id);
    }
  }

  buildSub(b, v, sc) {
    const nsx = Math.ceil(b.lx / 16), nsz = Math.ceil(b.lz / 16);
    const sx = sc % nsx, sz = ((sc / nsx) | 0) % nsz, sy = (sc / (nsx * nsz)) | 0;
    const x0 = sx * 16, y0 = sy * 16, z0 = sz * 16;
    const w = Math.min(16, b.lx - x0), h = Math.min(16, b.ly - y0), d = Math.min(16, b.lz - z0);
    const PX = w + 2, PZ = d + 2;
    const pad = padBuf;
    for (let y = -1; y <= h; y++) {
      for (let z = -1; z <= d; z++) {
        let pi = PX * ((z + 1) + PZ * (y + 1));
        for (let x = -1; x <= w; x++, pi++) {
          const gx = x0 + x, gy = y0 + y, gz = z0 + z;
          pad[pi] = gx >= 0 && gx < b.lx && gy >= 0 && gy < b.ly && gz >= 0 && gz < b.lz ? b.mat[gx + b.lx * (gz + b.lz * gy)] : 0;
        }
      }
    }
    const m = meshPadded(pad, w, h, d, b.o[0] + x0, b.o[1] + y0, b.o[2] + z0);
    const old = v.subs.get(sc);
    if (!m) {
      if (old) { v.inner.remove(old); old.geometry.dispose(); v.subs.delete(sc); }
      return;
    }
    const center = new THREE.Vector3(b.o[0] + x0 + w / 2, b.o[1] + y0 + h / 2, b.o[2] + z0 + d / 2);
    const geo = buildGeometry(m, center, 14);
    if (old) { old.geometry.dispose(); old.geometry = geo; }
    else {
      const mesh = new THREE.Mesh(geo, this.material);
      mesh.castShadow = this.shadows; mesh.receiveShadow = this.shadows;
      v.inner.add(mesh);
      v.subs.set(sc, mesh);
    }
  }

  clear() {
    for (const v of this.views.values()) {
      this.scene.remove(v.group);
      for (const m of v.subs.values()) m.geometry.dispose();
    }
    this.views.clear();
  }
}

export { GX, GY, GZ };
