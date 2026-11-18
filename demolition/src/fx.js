// 화면 연출: 날아가는 파편, 먼지 구름(픽셀 모양), 불꽃, 섬광. 시뮬레이션 이벤트(sim.fx)를 소리·흔들림으로도 바꾼다.
import * as THREE from 'three';
import { VS, GX, GZ } from './config.js';
import { COLOR, CLS } from './materials.js';
import { LAYER } from './world.js';

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _s = new THREE.Vector3(), _p = new THREE.Vector3(), _c = new THREE.Color();

class Billboards {
  constructor(scene, max, additive, pixel) {
    this.max = max;
    const base = new THREE.PlaneGeometry(1, 1);
    const g = new THREE.InstancedBufferGeometry();
    g.index = base.index;
    g.attributes.position = base.attributes.position;
    g.attributes.uv = base.attributes.uv;
    this.aPos = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.aCol = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.aSR = new THREE.InstancedBufferAttribute(new Float32Array(max * 2), 2).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('iPos', this.aPos); g.setAttribute('iCol', this.aCol); g.setAttribute('iSR', this.aSR);
    g.instanceCount = 0;
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, fog: true,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog]),
      vertexShader: `
        attribute vec3 iPos; attribute vec4 iCol; attribute vec2 iSR;
        varying vec2 vUv; varying vec4 vCol;
        #include <fog_pars_vertex>
        void main() {
          vUv = uv; vCol = iCol;
          vec4 mvPosition = modelViewMatrix * vec4(iPos, 1.0);
          float c = cos(iSR.y), s = sin(iSR.y);
          vec2 p = position.xy * iSR.x;
          mvPosition.xy += vec2(c * p.x - s * p.y, s * p.x + c * p.y);
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: `
        varying vec2 vUv; varying vec4 vCol;
        #include <fog_pars_fragment>
        void main() {
          vec2 q = ${pixel ? '(floor(vUv * 10.0) + 0.5) / 10.0' : 'vUv'} - 0.5;
          float r = length(q) * 2.0;
          float a = ${pixel ? 'step(r, 1.0) * (1.0 - r * r * 0.55)' : 'smoothstep(1.0, 0.0, r)'};
          gl_FragColor = vec4(vCol.rgb, vCol.a * a);
          if (gl_FragColor.a < 0.01) discard;
          #include <fog_fragment>
        }`,
    });
    this.mesh = new THREE.Mesh(g, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = additive ? 3 : 2;
    scene.add(this.mesh);
    this.p = [];
  }
  add(o) {
    if (this.p.length >= this.max) this.p.shift();
    o.life = o.max = o.life || 2;
    o.rot = o.rot ?? Math.random() * 6.28;
    o.vr = o.vr ?? (Math.random() - 0.5) * 0.6;
    o.grow = o.grow ?? 0.5;
    o.drag = o.drag ?? 0.6;
    o.g = o.g ?? 0;
    o.a = o.a ?? 0.6;
    o.fadeIn = o.fadeIn ?? 0.12;
    this.p.push(o);
  }
  update(dt, wind) {
    const P = this.p;
    let n = 0;
    const pos = this.aPos.array, col = this.aCol.array, sr = this.aSR.array;
    for (let k = 0; k < P.length; k++) {
      const o = P[k];
      o.life -= dt;
      if (o.life <= 0) continue;
      const d = Math.exp(-o.drag * dt);
      o.vx = o.vx * d + wind[0] * dt * 0.3; o.vy = o.vy * d - o.g * dt; o.vz = o.vz * d + wind[1] * dt * 0.3;
      o.x += o.vx * dt; o.y += o.vy * dt; o.z += o.vz * dt;
      if (o.y < o.size * 0.25) { o.y = o.size * 0.25; o.vy = Math.abs(o.vy) * 0.2; }
      o.size += o.grow * dt;
      o.rot += o.vr * dt;
      const t = 1 - o.life / o.max;
      const fade = Math.min(1, t / o.fadeIn) * (1 - t * t);
      pos[n * 3] = o.x; pos[n * 3 + 1] = o.y; pos[n * 3 + 2] = o.z;
      col[n * 4] = o.r; col[n * 4 + 1] = o.gg; col[n * 4 + 2] = o.b; col[n * 4 + 3] = o.a * fade;
      sr[n * 2] = o.size; sr[n * 2 + 1] = o.rot;
      P[n++] = o;
    }
    P.length = n;
    this.mesh.geometry.instanceCount = n;
    this.aPos.needsUpdate = this.aCol.needsUpdate = this.aSR.needsUpdate = true;
  }
  clear() { this.p.length = 0; this.mesh.geometry.instanceCount = 0; }
}

export class Presenter {
  constructor(scene, quality) {
    this.scene = scene;
    this.quality = quality;
    // 파편 (시뮬레이션 데이터 그대로 그림)
    const maxDebris = 4000;
    this.debrisMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshLambertMaterial(), maxDebris);
    this.debrisMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.debrisMesh.setColorAt(0, _c.set(1, 1, 1));
    this.debrisMesh.count = 0;
    this.debrisMesh.frustumCulled = false;
    this.debrisMesh.castShadow = quality.shadows;
    scene.add(this.debrisMesh);
    this.dust = new Billboards(scene, quality.dust, false, true);
    this.glow = new Billboards(scene, 260, true, false);
    this.flash = new THREE.PointLight(0xffb866, 0, 60, 1.6);
    scene.add(this.flash);
    this.flashT = 0;
    this.wind = [0.6, 0.25];
    this.audio = null; this.camera = null; this.haptics = null; this.ui = null;
    this.listener = new THREE.Vector3();
    this.warnLevel = 0;
  }

  setQuality(q) {
    this.quality = q;
    this.debrisMesh.castShadow = q.shadows;
    this.dust.max = q.dust;
  }

  // 시뮬레이션 이벤트 처리
  consume(sim) {
    const fx = sim.fx;
    if (!fx.length) return;
    const A = this.audio;
    let breakBudget = 6;
    for (let k = 0; k < fx.length; k++) {
      const e = fx[k];
      switch (e.t) {
        case 'dust':
          this.dust.add({ x: e.x, y: e.y, z: e.z, vx: e.vx + (Math.random() - 0.5) * 0.6, vy: e.vy + Math.random() * 0.5, vz: e.vz + (Math.random() - 0.5) * 0.6,
            size: e.s * 0.9, grow: 0.9 + Math.random() * 0.6, life: 2.5 + Math.random() * 2.5, r: e.r * 0.8 + 0.18, gg: e.g * 0.8 + 0.17, b: e.b * 0.8 + 0.15, a: 0.5 });
          break;
        case 'break': {
          if (breakBudget-- <= 0) break;
          const vol = Math.min(1, 0.18 + e.n / 160);
          if (A) A.breakSound(e.cls, vol, this.pan(e.x, e.z), this.dist(e.x, e.y, e.z), e.mode);
          if (e.n > 40 && this.camera) this.camera.shake(Math.min(0.5, e.n / 900), this.dist(e.x, e.y, e.z));
          break;
        }
        case 'glint':
          for (let i = 0; i < Math.min(30, e.n / 2); i++) this.glow.add({ x: e.x + (Math.random() - 0.5) * 2, y: e.y + (Math.random() - 0.5) * 2, z: e.z + (Math.random() - 0.5) * 2, vx: (Math.random() - 0.5) * 3, vy: Math.random() * 2, vz: (Math.random() - 0.5) * 3, g: 6, size: 0.12, grow: 0, life: 0.6 + Math.random() * 0.6, r: 0.6, gg: 0.85, b: 1.0, a: 0.9, drag: 1 });
          break;
        case 'impact': {
          const d = this.dist(e.x, e.y, e.z);
          for (let i = 0; i < Math.min(10, 2 + e.n / 20); i++) this.dust.add({ x: e.x + (Math.random() - 0.5) * 2, y: e.y, z: e.z + (Math.random() - 0.5) * 2, vx: (Math.random() - 0.5) * 3, vy: 0.4 + Math.random(), vz: (Math.random() - 0.5) * 3, size: 1.2 + Math.random() * 1.6, grow: 1.4, life: 3 + Math.random() * 2, r: 0.62, gg: 0.58, b: 0.52, a: 0.45 });
          if (A) A.thud(Math.min(1, e.e / 4e6), this.pan(e.x, e.z), d);
          if (this.camera) this.camera.shake(Math.min(0.8, e.e / 1.2e7), d);
          if (this.haptics && e.e > 2e6) this.haptics(Math.min(60, 15 + e.e / 2e5));
          break;
        }
        case 'fracture': if (A) A.crack(0.8, this.pan(e.x, e.z)); break;
        case 'topple': case 'detach':
          if (A) A.collapse(Math.min(1, e.n / 30000));
          if (this.camera) this.camera.shake(Math.min(1, e.n / 40000), 20);
          if (this.ui) this.ui.flashMessage(e.t === 'topple' ? '건물이 기울어진다!' : '무너진다!', 'warn');
          break;
        case 'crack': {
          const p = this.posOf(e.i);
          if (A) A.crack(Math.min(1, 0.4 + e.n / 200), this.pan(p[0], p[2]));
          for (let i = 0; i < 6; i++) this.dust.add({ x: p[0] + (Math.random() - 0.5), y: p[1], z: p[2] + (Math.random() - 0.5), vx: (Math.random() - 0.5) * 2, vy: -0.2, vz: (Math.random() - 0.5) * 2, size: 0.8, grow: 1.2, life: 2.5, r: 0.7, gg: 0.66, b: 0.6, a: 0.5 });
          if (this.camera) this.camera.shake(0.25, this.dist(p[0], p[1], p[2]));
          break;
        }
        case 'creak':
          this.warnLevel = Math.max(this.warnLevel, e.ratio);
          if (A) A.creak(Math.min(1, (e.ratio - 0.55) * 2));
          break;
        case 'crumb': {
          const p = this.posOf(e.i);
          this.dust.add({ x: p[0], y: p[1], z: p[2], vx: 0, vy: -0.8, vz: 0, g: 1.5, size: 0.35, grow: 0.3, life: 1.6, r: 0.75, gg: 0.72, b: 0.66, a: 0.7 });
          break;
        }
        case 'blast': this.explosion(e); break;
        case 'settle': break;
        case 'ballhit':
          if (A) A.ballHit(e.e, e.cls, this.pan(e.x, e.z), this.dist(e.x, e.y, e.z));
          if (this.camera) this.camera.shake(Math.min(0.7, e.e / 250000), this.dist(e.x, e.y, e.z));
          if (this.haptics && e.e > 20000) this.haptics(Math.min(50, 10 + e.e / 8000));
          if (e.spark) for (let i = 0; i < 12; i++) this.glow.add({ x: e.x, y: e.y, z: e.z, vx: (Math.random() - 0.5) * 8, vy: Math.random() * 6, vz: (Math.random() - 0.5) * 8, g: 9.8, size: 0.1, grow: 0, life: 0.4 + Math.random() * 0.4, r: 1, gg: 0.75, b: 0.35, a: 1, drag: 0.5 });
          break;
        case 'bite': if (A) A.crunch(e.v, this.pan(e.x, e.z)); break;
        case 'hammer':
          if (A) A.hammer(this.pan(e.x, e.z), e.hit);
          if (this.camera) this.camera.shake(0.05, this.dist(e.x, e.y, e.z));
          if (e.hit) this.glow.add({ x: e.x, y: e.y, z: e.z, vx: 0, vy: 1, vz: 0, size: 0.25, grow: 0, life: 0.12, r: 1, gg: 0.8, b: 0.5, a: 0.8 });
          break;
        case 'dump': if (A) A.dump(e.n); break;
      }
    }
    fx.length = 0;
  }

  explosion(e) {
    const A = this.audio;
    this.flash.position.set(e.x, e.y + 1, e.z);
    this.flash.intensity = 60;
    this.flashT = 0.35;
    for (let i = 0; i < 9; i++) this.glow.add({ x: e.x + (Math.random() - 0.5) * 1.2, y: e.y + Math.random() * 1.2, z: e.z + (Math.random() - 0.5) * 1.2, vx: (Math.random() - 0.5) * 6, vy: 1 + Math.random() * 4, vz: (Math.random() - 0.5) * 6, size: 1.2 + Math.random() * 1.5, grow: 3, life: 0.35 + Math.random() * 0.25, r: 1, gg: 0.62, b: 0.22, a: 1, drag: 3 });
    for (let i = 0; i < 24; i++) this.glow.add({ x: e.x, y: e.y, z: e.z, vx: (Math.random() - 0.5) * 22, vy: Math.random() * 14, vz: (Math.random() - 0.5) * 22, g: 9.8, size: 0.12, grow: 0, life: 0.5 + Math.random() * 0.7, r: 1, gg: 0.8, b: 0.4, a: 1, drag: 0.4 });
    for (let i = 0; i < 18; i++) {
      const a = Math.random() * Math.PI * 2, sp = 2 + Math.random() * 5;
      this.dust.add({ x: e.x, y: e.y + Math.random(), z: e.z, vx: Math.cos(a) * sp, vy: 0.5 + Math.random() * 2.5, vz: Math.sin(a) * sp, size: 1.4 + Math.random() * 1.6, grow: 2.2, life: 4 + Math.random() * 3, r: 0.42, gg: 0.4, b: 0.38, a: 0.55, drag: 0.9 });
    }
    const d = this.dist(e.x, e.y, e.z);
    if (A) A.explosion(Math.min(1, 0.6 + e.size * 0.2), this.pan(e.x, e.z), d);
    if (this.camera) this.camera.shake(1.1, d * 0.6);
    if (this.haptics) this.haptics([60, 30, 90]);
  }

  posOf(i) { return [(i % GX + 0.5) * VS, (((i / LAYER) | 0) + 0.5) * VS, ((((i / GX) | 0) % GZ) + 0.5) * VS]; }
  pan(x, z) {
    if (!this.camera) return 0;
    const cam = this.camera.cam;
    const dx = x - cam.position.x, dz = z - cam.position.z;
    const rx = -Math.cos(this.camera.yaw), rz = -Math.sin(this.camera.yaw);
    const len = Math.hypot(dx, dz) || 1;
    return Math.max(-1, Math.min(1, (dx * rx + dz * rz) / len));
  }
  dist(x, y, z) { if (!this.camera) return 20; const p = this.camera.cam.position; return Math.hypot(x - p.x, y - p.y, z - p.z); }

  // 매 프레임: 파편 행렬, 먼지 이동, 섬광 감쇠
  update(sim, dt) {
    const D = sim.debris;
    const n = Math.min(D.n, 4000);
    const mesh = this.debrisMesh;
    for (let k = 0; k < n; k++) {
      _e.set(D.rx[k], D.ry[k], 0);
      _q.setFromEuler(_e);
      const s = D.size[k] * VS;
      _s.set(s, s, s);
      _p.set(D.px[k], D.py[k] + s * 0.5, D.pz[k]);
      _m.compose(_p, _q, _s);
      mesh.setMatrixAt(k, _m);
      const m = D.mat[k];
      _c.setRGB(COLOR[m * 3], COLOR[m * 3 + 1], COLOR[m * 3 + 2]);
      mesh.setColorAt(k, _c);
    }
    mesh.count = n;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    this.dust.update(dt, this.wind);
    this.glow.update(dt, [0, 0]);
    if (this.flashT > 0) { this.flashT -= dt; this.flash.intensity = Math.max(0, this.flashT / 0.35) * 60; }
    else this.flash.intensity = 0;
    this.warnLevel = Math.max(0, this.warnLevel - dt * 0.35);
    // 무너지는 덩어리의 굉음
    if (this.audio) {
      let e = 0;
      for (const b of sim.bodies.list) { const v = b.prevV; e += b.mass * Math.min(8, Math.hypot(v.x, v.y, v.z)); }
      this.audio.setRumble(Math.min(1, e / 2.5e6));
    }
  }

  clear() { this.dust.clear(); this.glow.clear(); this.debrisMesh.count = 0; this.flash.intensity = 0; }
}

export { CLS };
