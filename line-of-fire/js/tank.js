// 블록 전차 모델과 동작 (포탑 회전, 이동, 추락, 격파)
import * as THREE from 'three';
import { DEG, TANK_HP, W, D } from './config.js';
import { normDeg, angleDiff, damp, rotY } from './util.js';

const GEO = new THREE.BoxGeometry(1, 1, 1);
const MATS = new Map();
function mat(hex) {
  if (!MATS.has(hex)) MATS.set(hex, new THREE.MeshLambertMaterial({ color: hex }));
  return MATS.get(hex);
}
function box(parent, w, h, d, x, y, z, color, cast = true) {
  const m = new THREE.Mesh(GEO, mat(color));
  m.scale.set(w, h, d);
  m.position.set(x, y, z);
  m.castShadow = cast;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}

const TURRET_Y = 1.1, TURRET_Z = 0.2, PIVOT_Y = 0.3, PIVOT_Z = -0.85, BARREL_LEN = 2.7;

export class Tank {
  constructor(scene, world, opts) {
    this.scene = scene;
    this.world = world;
    this.isPlayer = opts.isPlayer;
    this.name = opts.name;
    this.hp = TANK_HP;
    this.alive = true;
    this.hullYaw = 90;
    this.aimAz = 90; this.aimEl = 35;
    this.visAz = 90; this.visEl = 35;
    this.turnK = opts.isPlayer ? 30 : 3.2;
    this.base = new THREE.Vector3();
    this.targetY = 0;
    this.falling = false; this.vy = 0; this.fallFrom = 0;
    this.shakeT = 0; this.recoil = 0;
    this.onLand = null;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.build(opts);
  }

  build({ main, dark, accent, flag }) {
    const h = this.group, TRK = 0x262622, WHL = 0x1b1b18, MET = 0x2e3133;
    this.hull = new THREE.Group();
    h.add(this.hull);
    const b = this.hull;
    for (const sx of [-1, 1]) {
      box(b, 0.62, 0.72, 3.5, sx * 1.0, 0.36, 0, TRK);
      for (let i = 0; i < 5; i++) box(b, 0.1, 0.44, 0.44, sx * 1.33, 0.34, -1.2 + i * 0.6, WHL);
      box(b, 0.1, 0.3, 0.3, sx * 1.33, 0.5, -1.62, WHL);
      box(b, 0.1, 0.3, 0.3, sx * 1.33, 0.5, 1.62, WHL);
      box(b, 0.7, 0.08, 3.62, sx * 1.0, 0.76, 0, dark);
    }
    box(b, 1.5, 0.5, 3.3, 0, 0.5, 0, dark);
    box(b, 1.62, 0.36, 3.1, 0, 0.92, 0.05, main);
    box(b, 1.62, 0.3, 0.5, 0, 0.8, -1.66, main);
    box(b, 1.3, 0.12, 1.0, 0, 1.13, 1.05, dark);
    box(b, 0.16, 0.16, 0.34, -0.55, 0.96, 1.78, MET);
    box(b, 0.16, 0.16, 0.34, 0.55, 0.96, 1.78, MET);
    box(b, 0.3, 0.34, 0.14, 0.6, 1.02, 1.7, accent);
    box(b, 0.9, 0.1, 0.16, 0, 0.99, -1.93, MET);

    this.turret = new THREE.Group();
    this.turret.position.set(0, TURRET_Y, TURRET_Z);
    b.add(this.turret);
    const t = this.turret;
    box(t, 1.45, 0.52, 1.7, 0, 0.26, 0, main);
    box(t, 1.2, 0.16, 1.35, 0, 0.6, 0.05, main);
    box(t, 0.42, 0.24, 0.42, 0.32, 0.78, 0.3, dark);
    box(t, 0.5, 0.3, 0.5, 0, 0.3, 0.95, dark);
    box(t, 0.02, 0.16, 0.6, 0.735, 0.3, 0.1, accent, false);
    box(t, 0.02, 0.16, 0.6, -0.735, 0.3, 0.1, accent, false);
    box(t, 0.04, 1.5, 0.04, -0.5, 1.1, 0.6, 0x111111, false);
    this.flagPivot = new THREE.Group();
    this.flagPivot.position.set(-0.5, 1.72, 0.6);
    t.add(this.flagPivot);
    this.flag = box(this.flagPivot, 0.03, 0.28, 0.5, 0, 0, 0.25, flag, false);

    this.barrel = new THREE.Group();
    this.barrel.position.set(0, PIVOT_Y, PIVOT_Z);
    t.add(this.barrel);
    this.gun = new THREE.Group();
    this.barrel.add(this.gun);
    box(this.gun, 0.62, 0.44, 0.3, 0, 0, 0, dark);
    box(this.gun, 0.17, 0.17, 2.3, 0, 0, -1.25, main);
    box(this.gun, 0.28, 0.26, 0.34, 0, 0, -2.45, MET);
  }

  place(x, z, yaw) {
    this.hullYaw = yaw;
    const y = this.standHeight(x, z, yaw, this.world.topHeight(Math.floor(x), Math.floor(z)) + 3) ?? this.world.topHeight(Math.floor(x), Math.floor(z));
    this.base.set(x, y, z);
    this.targetY = y;
    this.apply();
  }

  center() { return new THREE.Vector3(this.base.x, this.base.y + 1.0, this.base.z); }

  footprint(x, z, yaw) {
    const pts = [];
    for (const lx of [-1.1, 0, 1.1]) for (const lz of [-1.6, 0, 1.6]) {
      const [ox, oz] = rotY(lx, lz, yaw);
      pts.push([x + ox, z + oz]);
    }
    return pts;
  }

  // 이 위치에 설 수 있으면 바닥 높이, 막혀 있으면 null
  standHeight(x, z, yaw, curY) {
    let g = -Infinity;
    for (const [wx, wz] of this.footprint(x, z, yaw)) {
      if (wx < 1 || wx > W - 1 || wz < 1 || wz > D - 1) return null;
      const gy = this.world.groundAt(wx, wz, curY + 1.5);
      if (gy > curY + 1.05) return null;
      if (this.world.solidAt(wx, gy + 0.5, wz) || this.world.solidAt(wx, gy + 1.5, wz)) return null;
      g = Math.max(g, gy);
    }
    return g;
  }

  // 발밑 지형이 사라졌으면 추락 시작
  checkSupport() {
    if (this.falling) return;
    let g = -Infinity;
    for (const [wx, wz] of this.footprint(this.base.x, this.base.z, this.hullYaw)) {
      g = Math.max(g, this.world.groundAt(wx, wz, this.base.y + 0.5));
    }
    if (g < this.base.y - 0.05) {
      this.falling = true;
      this.vy = 0;
      this.fallFrom = this.base.y;
      this.targetY = g;
    }
  }

  muzzleFor(az, el) {
    const [tx, tz] = rotY(0, TURRET_Z, this.hullYaw);
    const [px, pz] = rotY(0, PIVOT_Z, az);
    const a = az * DEG, e = el * DEG;
    return new THREE.Vector3(
      this.base.x + tx + px + Math.cos(e) * Math.sin(a) * BARREL_LEN,
      this.base.y + TURRET_Y + PIVOT_Y + Math.sin(e) * BARREL_LEN,
      this.base.z + tz + pz - Math.cos(e) * Math.cos(a) * BARREL_LEN,
    );
  }

  containsPoint(p) {
    const dy = p.y - this.base.y;
    if (dy < 0 || dy > 2.0) return false;
    const dx = p.x - this.base.x, dz = p.z - this.base.z;
    const r = this.hullYaw * DEG, c = Math.cos(r), s = Math.sin(r);
    const lx = dx * c + dz * s, lz = -dx * s + dz * c;
    return Math.abs(lx) < 1.35 && Math.abs(lz) < 1.9;
  }

  damage(n) {
    this.hp = Math.max(0, this.hp - n);
    this.shakeT = 0.45;
  }

  snapAim() { this.visAz = this.aimAz; this.visEl = this.aimEl; this.apply(); }

  apply() {
    this.group.rotation.y = -this.hullYaw * DEG;
    if (this.alive) {
      this.turret.rotation.y = -(this.visAz - this.hullYaw) * DEG;
      this.barrel.rotation.x = this.visEl * DEG;
    }
  }

  update(dt, time, windBearing, windSpeed) {
    if (this.alive) {
      this.visAz = normDeg(this.visAz + angleDiff(this.visAz, this.aimAz) * damp(this.turnK, dt));
      this.visEl += (this.aimEl - this.visEl) * damp(this.turnK, dt);
      this.recoil *= Math.exp(-dt * 6);
      this.gun.position.z = this.recoil * 0.4;
      this.hull.rotation.x = -this.recoil * 0.05;
      const sway = Math.sin(time * 9 + this.base.x) * 0.18 * Math.min(1, windSpeed / 4);
      this.flagPivot.rotation.y = Math.PI - windBearing * DEG + this.visAz * DEG + sway;
      this.flag.scale.z = 0.25 + Math.min(1, windSpeed / 6) * 0.3;
      this.flag.position.z = this.flag.scale.z / 2;
      this.flag.rotation.x = windSpeed < 1 ? 1.1 : 0;
    }
    if (this.falling) {
      this.vy -= 30 * dt;
      this.base.y += this.vy * dt;
      if (this.base.y <= this.targetY) {
        this.base.y = this.targetY;
        this.falling = false;
        if (this.onLand) this.onLand(this, this.fallFrom - this.targetY);
      }
    } else {
      this.base.y += (this.targetY - this.base.y) * damp(14, dt);
    }
    let ox = 0, oz = 0;
    if (this.shakeT > 0) {
      this.shakeT -= dt;
      const a = this.shakeT * 0.5;
      ox = (Math.random() - 0.5) * a; oz = (Math.random() - 0.5) * a;
    }
    this.group.position.set(this.base.x + ox, this.base.y, this.base.z + oz);
    this.apply();
    if (this.flying) this.updateFlyingTurret(dt);
  }

  destroy() {
    this.alive = false;
    const charred = mat(0x1f1d1a), charred2 = mat(0x2b2824);
    this.group.traverse((o) => { if (o.isMesh) o.material = o.material === mat(0x262622) ? charred2 : charred; });
    this.scene.attach(this.turret);
    this.flying = {
      vel: new THREE.Vector3((Math.random() - 0.5) * 5, 12 + Math.random() * 3, (Math.random() - 0.5) * 5),
      spin: new THREE.Vector3(Math.random() * 6 - 3, Math.random() * 8 - 4, Math.random() * 6 - 3),
    };
  }

  updateFlyingTurret(dt) {
    const f = this.flying, t = this.turret;
    if (f.done) return;
    f.vel.y -= 26 * dt;
    t.position.addScaledVector(f.vel, dt);
    t.rotation.x += f.spin.x * dt; t.rotation.y += f.spin.y * dt; t.rotation.z += f.spin.z * dt;
    const g = this.world.groundAt(t.position.x, t.position.z, t.position.y + 0.5);
    if (f.vel.y < 0 && t.position.y < g + 0.3) {
      t.position.y = g + 0.3;
      if (Math.abs(f.vel.y) < 3) { f.done = true; t.rotation.x = Math.round(t.rotation.x / Math.PI) * Math.PI; t.rotation.z = 0; return; }
      f.vel.multiplyScalar(0.35); f.vel.y = -f.vel.y * 0.8 + 2; f.spin.multiplyScalar(0.4);
    }
  }

  dispose() {
    this.scene.remove(this.group);
    if (this.turret.parent) this.turret.parent.remove(this.turret);
  }
}
