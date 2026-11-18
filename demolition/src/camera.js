// 카메라: 장비 따라가기(궤도), 운전석 시점, 현장 전체, 발파 연출
import * as THREE from 'three';
import { clamp, damp } from './util.js';

export class CameraRig {
  constructor(camera, dom) {
    this.cam = camera;
    this.dom = dom;
    this.mode = 'follow';            // follow | cab | site | cine
    this.yaw = 0.35; this.pitch = 0.36; this.dist = 24;
    this.cur = { yaw: 0.35, pitch: 0.36, dist: 24 };
    this.target = new THREE.Vector3(24, 4, 24);
    this.curTarget = this.target.clone();
    this.look = { yaw: 0, pitch: 0 };
    this.shakeAmt = 0; this.shakeEnabled = true;
    this.cine = null;
    this.onTap = null;
    this.invert = false;
    this.pointers = new Map();
    this.pinch = 0;
    this.bind();
  }

  bind() {
    const el = this.dom;
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    el.addEventListener('pointerdown', (e) => {
      try { el.setPointerCapture(e.pointerId); } catch { /* */ }
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, t: performance.now(), moved: 0, button: e.button });
      if (this.pointers.size === 2) this.pinch = this.pinchDist();
    });
    el.addEventListener('pointermove', (e) => {
      const p = this.pointers.get(e.pointerId);
      if (!p) return;
      const dx = e.clientX - p.x, dy = e.clientY - p.y;
      p.x = e.clientX; p.y = e.clientY;
      p.moved += Math.abs(dx) + Math.abs(dy);
      if (this.pointers.size === 2) {
        const d = this.pinchDist();
        if (this.pinch > 0) this.zoom(this.pinch / d);
        this.pinch = d;
        return;
      }
      if (p.moved < 5) return;
      const k = this.invert ? -1 : 1;
      if (this.mode === 'cab') {
        this.look.yaw = clamp(this.look.yaw - dx * 0.005 * k, -2.6, 2.6);
        this.look.pitch = clamp(this.look.pitch + dy * 0.004 * k, -0.7, 1.2);
      } else {
        this.yaw -= dx * 0.006 * k;
        this.pitch = clamp(this.pitch + dy * 0.005 * k, 0.05, 1.45);
      }
    });
    const up = (e) => {
      const p = this.pointers.get(e.pointerId);
      this.pointers.delete(e.pointerId);
      if (this.pointers.size < 2) this.pinch = 0;
      if (p && p.moved < 8 && performance.now() - p.t < 450 && this.onTap && p.button === 0) this.onTap(e.clientX, e.clientY);
    };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', (e) => { this.pointers.delete(e.pointerId); this.pinch = 0; });
    el.addEventListener('wheel', (e) => { e.preventDefault(); this.zoom(Math.exp(e.deltaY * 0.0012)); }, { passive: false });
  }

  pinchDist() {
    const a = [...this.pointers.values()];
    return Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y) || 1;
  }
  zoom(f) { this.dist = clamp(this.dist * f, 6, 140); }

  setMode(m) {
    this.mode = m;
    this.look.yaw = 0; this.look.pitch = 0;
    if (m === 'site') { this.dist = Math.max(this.dist, 50); this.pitch = Math.max(this.pitch, 0.55); }
  }

  shake(a, dist = 20) {
    if (!this.shakeEnabled) return;
    const k = clamp(30 / (dist + 10), 0.2, 1.4);
    this.shakeAmt = Math.min(1.6, this.shakeAmt + a * k);
  }

  // 발파 연출: 건물 중심과 높이를 받아 천천히 도는 넓은 화면
  startCine(center, height, angleIdx = 0) {
    // [방위각, 고도, 거리 배율] — 현장 안쪽(도로 위·부지 모서리)에서만 찍어 배경 건물에 가리지 않게
    const angles = [[0.5, 0.32, 1.25], [-0.75, 0.16, 0.95], [0.05, 0.62, 1.15], [1.1, 0.24, 1.0]];
    const [yaw, pitch, dk] = angles[angleIdx % angles.length];
    const dist = Math.min(44, Math.max(26, height * dk + 14));
    this.cine = { center: center.clone(), yaw, pitch, dist, t: 0, height };
    this.mode = 'cine';
  }
  endCine(prevMode = 'follow') { this.cine = null; this.mode = prevMode; }

  update(dt, focus, cab) {
    const cam = this.cam;
    let pos = new THREE.Vector3(), look = new THREE.Vector3();
    if (this.mode === 'cine' && this.cine) {
      const c = this.cine;
      c.t += dt;
      const yaw = c.yaw + c.t * 0.035;
      pos.set(c.center.x + Math.sin(yaw) * Math.cos(c.pitch) * c.dist, c.center.y * 0.4 + Math.sin(c.pitch) * c.dist + 2, c.center.z - Math.cos(yaw) * Math.cos(c.pitch) * c.dist);
      // 현장 범위 밖으로 나가지 않게 (배경 도시에 묻히지 않도록)
      pos.x = clamp(pos.x, -4, 52); pos.z = clamp(pos.z, -5, 51);
      look.set(c.center.x, c.height * 0.35, c.center.z);
      this.yaw = yaw; this.pitch = c.pitch; this.dist = c.dist;
      this.cur.yaw = yaw; this.cur.pitch = c.pitch; this.cur.dist = c.dist;
      this.curTarget.copy(look);
    } else if (this.mode === 'cab' && cab) {
      const v = cab();
      const yaw = v.yaw + this.look.yaw, pitch = v.pitch + this.look.pitch;
      pos.set(v.pos[0], v.pos[1], v.pos[2]);
      look.set(pos.x + Math.sin(yaw) * Math.cos(pitch), pos.y + Math.sin(pitch), pos.z + Math.cos(yaw) * Math.cos(pitch));
      this.yaw = -yaw;
    } else {
      if (focus) this.target.set(focus[0], focus[1], focus[2]);
      this.curTarget.x = damp(this.curTarget.x, this.target.x, 4, dt);
      this.curTarget.y = damp(this.curTarget.y, this.target.y, 4, dt);
      this.curTarget.z = damp(this.curTarget.z, this.target.z, 4, dt);
      this.cur.yaw = damp(this.cur.yaw, this.yaw, 12, dt);
      this.cur.pitch = damp(this.cur.pitch, this.pitch, 12, dt);
      this.cur.dist = damp(this.cur.dist, this.dist, 8, dt);
      const { yaw, pitch, dist } = this.cur;
      pos.set(this.curTarget.x + Math.sin(yaw) * Math.cos(pitch) * dist, this.curTarget.y + Math.sin(pitch) * dist, this.curTarget.z - Math.cos(yaw) * Math.cos(pitch) * dist);
      if (pos.y < 1.2) pos.y = 1.2;
      look.copy(this.curTarget);
    }
    // 흔들림
    if (this.shakeAmt > 0.001) {
      const s = this.shakeAmt * 0.35;
      pos.x += (Math.random() - 0.5) * s; pos.y += (Math.random() - 0.5) * s; pos.z += (Math.random() - 0.5) * s;
      this.shakeAmt *= Math.exp(-dt * 5);
    }
    cam.position.copy(pos);
    cam.lookAt(look);
  }
}
