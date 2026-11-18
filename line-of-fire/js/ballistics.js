// 탄도 계산: 중력 + 바람, 지형/전차 충돌
import * as THREE from 'three';
import { GRAVITY, VMAX, DEG, W, D } from './config.js';

export function launchVelocity(az, el, power, out = new THREE.Vector3()) {
  const v = (power / 100) * VMAX, a = az * DEG, e = el * DEG;
  return out.set(Math.cos(e) * Math.sin(a) * v, Math.sin(e) * v, -Math.cos(e) * Math.cos(a) * v);
}

export function step(p, v, wind, dt) {
  v.x += wind.x * dt;
  v.z += wind.z * dt;
  v.y -= GRAVITY * dt;
  p.x += v.x * dt;
  p.y += v.y * dt;
  p.z += v.z * dt;
}

export function testHit(p, world, tanks, shooter, t) {
  for (const tk of tanks) {
    if (!tk.alive || (tk === shooter && t < 0.3)) continue;
    if (tk.containsPoint(p)) return { kind: 'tank', tank: tk };
  }
  const inside = p.x >= 0 && p.x < W && p.z >= 0 && p.z < D;
  if (inside) {
    if (p.y < 0 || world.solidAt(p.x, p.y, p.z)) return { kind: 'ground' };
  } else if (p.y < -1 || p.x < -40 || p.x > W + 40 || p.z < -40 || p.z > D + 40) {
    return { kind: 'out' };
  }
  return null;
}

// 착탄 예측. path 배열을 넘기면 경로 점을 기록
export function predict(start, vel, wind, world, tanks, shooter, dt = 1 / 90, path = null, pathEvery = 3) {
  const p = start.clone(), v = vel.clone();
  let i = 0;
  for (let t = 0; t < 14; t += dt) {
    step(p, v, wind, dt);
    if (path && i++ % pathEvery === 0) path.push(p.clone());
    const hit = testHit(p, world, tanks, shooter, t);
    if (hit) return { ...hit, point: p, t };
  }
  return { kind: 'out', point: p, t: 14 };
}
