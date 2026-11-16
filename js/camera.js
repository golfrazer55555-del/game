// 카메라 연출: 조준 시점, 포탄 추적, 착탄 관측, 쌍안경, 타이틀 회전
import * as THREE from 'three';
import { W, D, DEG } from './config.js';
import { damp } from './util.js';

export class CameraRig {
  constructor(camera) {
    this.cam = camera;
    this.pos = new THREE.Vector3(W / 2, 60, D + 60);
    this.look = new THREE.Vector3(W / 2, 0, D / 2);
    this.tPos = this.pos.clone();
    this.tLook = this.look.clone();
    this.k = 3;
    this.orbit = true;
    this.zoom = 1;
    this.fov = 55;
    this.shakeA = 0;
    this.off = new THREE.Vector3();
  }

  baseFov() { return this.cam.aspect < 1 ? 70 : 52; }

  set(pos, look, k = 4) {
    this.orbit = false;
    this.tPos.copy(pos);
    this.tLook.copy(look);
    this.k = k;
  }

  snap() { this.pos.copy(this.tPos); this.look.copy(this.tLook); }

  shake(a) { this.shakeA = Math.max(this.shakeA, a); }

  // 전차 뒤에서 포신 방향을 바라보는 시점
  aimAt(tank, az, el, k = 6) {
    const c = tank.center(), a = az * DEG, fx = Math.sin(a), fz = -Math.cos(a);
    const portrait = this.cam.aspect < 1;
    const back = portrait ? 12 : 9.5, h = portrait ? 5 : 4.4, ahead = 16;
    // 전차가 화면 아래쪽 약 70% 높이에 오도록 내려다보는 각도를 계산
    const tanHalf = Math.tan((this.baseFov() / 2) * DEG);
    const lookAng = Math.atan2(h - 0.3, back) - Math.atan((portrait ? 0.3 : 0.42) * tanHalf) - el * 0.0015;
    this.set(
      new THREE.Vector3(c.x - fx * back, c.y + h, c.z - fz * back),
      new THREE.Vector3(c.x + fx * ahead, c.y + h - (back + ahead) * Math.tan(lookAng), c.z + fz * ahead),
      k,
    );
  }

  update(dt, time) {
    if (this.orbit) {
      const a = time * 0.05;
      this.tPos.set(W / 2 + Math.cos(a) * 100, 50, D / 2 + Math.sin(a) * 100);
      this.tLook.set(W / 2, 6, D / 2);
      this.k = 1.5;
    }
    const f = damp(this.k, dt);
    this.pos.lerp(this.tPos, f);
    this.look.lerp(this.tLook, f);
    const fov = this.baseFov() / this.zoom;
    this.fov += (fov - this.fov) * damp(7, dt);
    if (this.shakeA > 0.001) {
      const s = this.shakeA;
      this.off.set((Math.random() - 0.5) * s, (Math.random() - 0.5) * s, (Math.random() - 0.5) * s);
      this.shakeA *= Math.exp(-dt * 6);
    } else this.off.set(0, 0, 0);
    this.cam.position.copy(this.pos).add(this.off);
    this.cam.lookAt(this.look.x + this.off.x * 0.5, this.look.y + this.off.y * 0.5, this.look.z);
    if (Math.abs(this.cam.fov - this.fov) > 0.01) {
      this.cam.fov = this.fov;
      this.cam.updateProjectionMatrix();
    }
  }
}
