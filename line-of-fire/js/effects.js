// 파티클 연출: 폭발, 파편, 연기, 포구 화염, 바람에 날리는 재
import * as THREE from 'three';
import { W, D } from './config.js';

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler();
const _s = new THREE.Vector3(), _p = new THREE.Vector3(), _c = new THREE.Color();
const rnd = (a = 1) => (Math.random() * 2 - 1) * a;

class Pool {
  constructor(scene, max, material, castShadow) {
    this.mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), material, max);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.setColorAt(0, _c.set(0xffffff));
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = castShadow;
    this.max = max;
    this.items = [];
    scene.add(this.mesh);
  }

  add(p) {
    if (this.items.length >= this.max) return;
    p.max = p.life;
    p.rx = p.rx ?? Math.random() * 3; p.ry = p.ry ?? Math.random() * 3; p.rz = p.rz ?? 0;
    p.sx = p.sx ?? 0; p.sy = p.sy ?? 0; p.sz = p.sz ?? 0;
    p.g = p.g ?? 0; p.drag = p.drag ?? 0; p.wind = p.wind ?? 0;
    p.s1 = p.s1 ?? p.s0; p.shrink = p.shrink ?? 0.7;
    this.items.push(p);
  }

  update(dt, wind, world) {
    const items = this.items;
    let n = 0;
    for (let i = 0; i < items.length; i++) {
      const p = items[i];
      p.life -= dt;
      if (p.life <= 0) continue;
      p.vy -= p.g * dt;
      if (p.wind) { p.vx += wind.x * p.wind * dt; p.vz += wind.z * p.wind * dt; }
      if (p.drag) { const k = Math.exp(-p.drag * dt); p.vx *= k; p.vy *= k; p.vz *= k; }
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      p.rx += p.sx * dt; p.ry += p.sy * dt; p.rz += p.sz * dt;
      const t = 1 - p.life / p.max;
      let s = p.s0 + (p.s1 - p.s0) * t;
      if (t > p.shrink) s *= 1 - (t - p.shrink) / (1 - p.shrink);
      if (p.bounce) {
        const gy = world.groundAt(p.x, p.z, p.y + 0.6);
        if (p.y - s * 0.5 < gy) {
          p.y = gy + s * 0.5;
          if (p.vy < 0) p.vy *= -0.28;
          p.vx *= 0.6; p.vz *= 0.6; p.sx *= 0.5; p.sy *= 0.5; p.sz *= 0.5;
        }
      }
      _e.set(p.rx, p.ry, p.rz);
      _q.setFromEuler(_e);
      _s.set(s, s, s);
      _p.set(p.x, p.y, p.z);
      _m.compose(_p, _q, _s);
      this.mesh.setMatrixAt(n, _m);
      if (p.c1) _c.copy(p.color).lerp(p.c1, t); else _c.copy(p.color);
      this.mesh.setColorAt(n, _c);
      items[n++] = p;
    }
    items.length = n;
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.instanceColor.needsUpdate = true;
  }

  clear() { this.items.length = 0; this.mesh.count = 0; }
}

const FIRE_A = new THREE.Color(0xfff2b0), FIRE_B = new THREE.Color(0xc8381a);
const SMOKE_DARK = new THREE.Color(0x2e2b28), SMOKE_MID = new THREE.Color(0x5d5852), SMOKE_LIGHT = new THREE.Color(0x9d968a);
const DUST = new THREE.Color(0x7a6448), ASH = new THREE.Color(0xd8d2c2);

export class Effects {
  constructor(scene, world) {
    this.world = world;
    this.debris = new Pool(scene, 1400, new THREE.MeshLambertMaterial(), true);
    this.smoke = new Pool(scene, 1100, new THREE.MeshLambertMaterial(), false);
    this.glow = new Pool(scene, 700, new THREE.MeshBasicMaterial({ toneMapped: false }), false);
    this.light = new THREE.PointLight(0xffa850, 0, 40, 2);
    scene.add(this.light);
    this.lightT = 0; this.lightDur = 1; this.lightI = 0;
    this.ashT = 0;
  }

  flash(pos, intensity, dur) {
    this.light.position.set(pos.x, pos.y + 1.5, pos.z);
    this.lightI = intensity; this.lightDur = dur; this.lightT = dur;
  }

  explosion(pos, radius, removed, big = false) {
    const k = big ? 1.7 : 1;
    this.flash(pos, big ? 900 : 500, big ? 0.5 : 0.32);
    for (let i = 0; i < 28 * k; i++) {
      const a = Math.random() * Math.PI * 2, u = Math.random(), sp = (3 + Math.random() * 7) * k;
      const h = Math.sqrt(1 - u * u);
      this.glow.add({
        x: pos.x + rnd(0.5), y: pos.y + 0.4, z: pos.z + rnd(0.5),
        vx: Math.cos(a) * h * sp, vy: u * sp + 2, vz: Math.sin(a) * h * sp,
        life: 0.35 + Math.random() * 0.4, s0: (1 + Math.random() * 0.9) * k, s1: 0.4,
        color: FIRE_A, c1: FIRE_B, g: -3, drag: 4.5, shrink: 0.45,
      });
    }
    for (let i = 0; i < 16 * k; i++) {
      this.glow.add({
        x: pos.x, y: pos.y + 0.3, z: pos.z,
        vx: rnd(12), vy: 6 + Math.random() * 12, vz: rnd(12),
        life: 0.5 + Math.random() * 0.5, s0: 0.18, color: FIRE_A, c1: FIRE_B, g: 24, drag: 0.6, shrink: 0.8,
      });
    }
    for (let i = 0; i < 22 * k; i++) {
      this.smoke.add({
        x: pos.x + rnd(radius * 0.7), y: pos.y + Math.random() * 1.5, z: pos.z + rnd(radius * 0.7),
        vx: rnd(2.2), vy: 1.2 + Math.random() * 3.2, vz: rnd(2.2),
        life: 2.4 + Math.random() * 2.8, s0: 1.1 + Math.random() * 0.6, s1: 3.2 * k,
        color: SMOKE_DARK, c1: SMOKE_LIGHT, g: -0.25, drag: 1.1, wind: 0.9, shrink: 0.6, sy: rnd(0.6),
      });
    }
    const step = Math.max(1, Math.floor(removed.length / 80));
    for (let i = 0; i < removed.length; i += step) {
      const v = removed[i];
      const color = this.world.baseColors[v.t];
      const x = v.x + 0.5, y = v.y + 0.5, z = v.z + 0.5;
      if (v.fall) {
        this.debris.add({ x, y, z, vx: rnd(1.5), vy: Math.random() * 2, vz: rnd(1.5), life: 2.5 + Math.random() * 1.5,
          s0: 0.9, color, g: 18, drag: 0.3, bounce: true, shrink: 0.75, sx: rnd(2), sz: rnd(2) });
        continue;
      }
      let dx = x - pos.x, dy = y - pos.y, dz = z - pos.z;
      const len = Math.hypot(dx, dy, dz) || 1;
      dx /= len; dy /= len; dz /= len;
      const sp = 5 + Math.random() * 10;
      this.debris.add({
        x, y, z, vx: dx * sp + rnd(2), vy: (Math.abs(dy) * 0.5 + 0.7) * sp, vz: dz * sp + rnd(2),
        life: 2.2 + Math.random() * 2.2, s0: 0.45 + Math.random() * 0.4, color, g: 26, drag: 0.35,
        bounce: true, shrink: 0.8, sx: rnd(8), sy: rnd(8), sz: rnd(8),
      });
    }
  }

  muzzle(pos, dir) {
    this.flash(pos, 260, 0.14);
    for (let i = 0; i < 12; i++) {
      const sp = 7 + Math.random() * 9, off = Math.random() * 1.2;
      this.glow.add({
        x: pos.x + dir.x * off, y: pos.y + dir.y * off, z: pos.z + dir.z * off,
        vx: dir.x * sp + rnd(1.5), vy: dir.y * sp + rnd(1.5), vz: dir.z * sp + rnd(1.5),
        life: 0.1 + Math.random() * 0.12, s0: 0.5 + Math.random() * 0.5, s1: 0.2, color: FIRE_A, c1: FIRE_B, drag: 6,
      });
    }
    for (let i = 0; i < 14; i++) {
      const sp = 1.5 + Math.random() * 5;
      this.smoke.add({
        x: pos.x, y: pos.y, z: pos.z,
        vx: dir.x * sp + rnd(1.2), vy: dir.y * sp + Math.random(), vz: dir.z * sp + rnd(1.2),
        life: 1.4 + Math.random() * 1.4, s0: 0.45, s1: 1.7, color: SMOKE_LIGHT, c1: SMOKE_MID,
        drag: 1.8, wind: 0.8, g: -0.3, shrink: 0.55,
      });
    }
  }

  trail(pos) {
    this.smoke.add({ x: pos.x, y: pos.y, z: pos.z, vx: rnd(0.2), vy: 0.3, vz: rnd(0.2), life: 0.9,
      s0: 0.32, s1: 0.7, color: SMOKE_LIGHT, c1: SMOKE_MID, wind: 0.6, shrink: 0.4 });
  }

  tankSmoke(pos, heavy) {
    this.smoke.add({ x: pos.x + rnd(0.3), y: pos.y, z: pos.z + rnd(0.3), vx: rnd(0.3), vy: 1.6 + Math.random(), vz: rnd(0.3),
      life: 2 + Math.random() * 1.5, s0: 0.5, s1: heavy ? 2.2 : 1.5, color: SMOKE_DARK, c1: SMOKE_MID, wind: 0.8, drag: 0.6, shrink: 0.6 });
    if (heavy && Math.random() < 0.5) {
      this.glow.add({ x: pos.x + rnd(0.3), y: pos.y, z: pos.z + rnd(0.3), vx: rnd(0.3), vy: 1.5 + Math.random(), vz: rnd(0.3),
        life: 0.4 + Math.random() * 0.3, s0: 0.45, s1: 0.2, color: FIRE_A, c1: FIRE_B });
    }
  }

  dust(pos) {
    this.smoke.add({ x: pos.x + rnd(0.4), y: pos.y + 0.2, z: pos.z + rnd(0.4), vx: rnd(0.8), vy: 0.6 + Math.random() * 0.6, vz: rnd(0.8),
      life: 1 + Math.random() * 0.6, s0: 0.35, s1: 1.1, color: DUST, wind: 0.5, drag: 1.5, shrink: 0.5 });
  }

  // 바람을 눈으로 보이게 하는 재 입자
  ambient(dt, wind, windSpeed, focus) {
    this.ashT -= dt;
    while (this.ashT < 0) {
      this.ashT += 0.06;
      const x = Math.max(0, Math.min(W, focus.x + rnd(45))), z = Math.max(0, Math.min(D, focus.z + rnd(30)));
      const sp = 0.8 + windSpeed * 0.7, len = Math.hypot(wind.x, wind.z) || 1;
      this.smoke.add({
        x, y: focus.y + 2 + Math.random() * 14, z,
        vx: (wind.x / len) * sp * (windSpeed > 0 ? 1 : 0) + rnd(0.3), vy: -0.25 + rnd(0.15), vz: (wind.z / len) * sp * (windSpeed > 0 ? 1 : 0) + rnd(0.3),
        life: 3 + Math.random() * 2, s0: 0.1 + Math.random() * 0.06, color: ASH, shrink: 0.8, sx: rnd(3), sy: rnd(3),
      });
    }
  }

  update(dt, wind) {
    this.debris.update(dt, wind, this.world);
    this.smoke.update(dt, wind, this.world);
    this.glow.update(dt, wind, this.world);
    if (this.lightT > 0) {
      this.lightT -= dt;
      const t = Math.max(0, this.lightT / this.lightDur);
      this.light.intensity = this.lightI * t * t;
    } else this.light.intensity = 0;
  }

  clear() { this.debris.clear(); this.smoke.clear(); this.glow.clear(); }
}
