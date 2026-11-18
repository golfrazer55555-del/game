// AI 포수: 바람까지 계산한 정답을 구한 뒤, 사격할수록 줄어드는 오차를 더한다.
// 플레이어가 크게 움직이면 보정이 일부 초기화된다.
import { launchVelocity, step, predict } from './ballistics.js';
import { DEG } from './config.js';
import { bearingTo, angleDiff, normDeg, gauss, clamp } from './util.js';

export class AIGunner {
  constructor(diff) {
    this.diff = diff;
    this.shots = 0;
    this.lastTarget = null;
  }

  // 목표 높이 평면을 내려오며 통과하는 지점 (지형 무시)
  flatImpact(start, vel, wind, yLevel) {
    const p = start.clone(), v = vel.clone(), dt = 1 / 60;
    for (let t = 0; t < 14; t += dt) {
      step(p, v, wind, dt);
      if (v.y < 0 && p.y <= yLevel) return p;
    }
    return null; // 목표 높이까지 못 올라감 = 짧음
  }

  solve(me, target, wind, el) {
    let az = bearingTo(me.base, target);
    let power = 60;
    for (let iter = 0; iter < 4; iter++) {
      const start = me.muzzleFor(az, el);
      const dist = Math.hypot(target.x - start.x, target.z - start.z);
      const a = az * DEG, fx = Math.sin(a), fz = -Math.cos(a);
      let lo = 5, hi = 100;
      for (let k = 0; k < 18; k++) {
        const mid = (lo + hi) / 2;
        const p = this.flatImpact(start, launchVelocity(az, el, mid), wind, target.y);
        if (!p || (p.x - start.x) * fx + (p.z - start.z) * fz < dist) lo = mid; else hi = mid;
      }
      power = (lo + hi) / 2;
      const p = this.flatImpact(start, launchVelocity(az, el, power), wind, target.y);
      if (p) az = normDeg(az + angleDiff(bearingTo(start, p), bearingTo(start, target)));
    }
    return { az, el, power };
  }

  plan(me, targetTank, wind, world, tanks) {
    const target = targetTank.center();
    if (this.lastTarget && this.lastTarget.distanceTo(target) > 3) this.shots = Math.max(0, this.shots - 2);
    this.lastTarget = target.clone();

    let best = null;
    for (const el of [45, 52, 38, 60, 68, 30]) {
      const s = this.solve(me, target, wind, el);
      const res = predict(me.muzzleFor(s.az, s.el), launchVelocity(s.az, s.el, s.power), wind, world, tanks, me);
      const miss = res.kind === 'tank' && res.tank === targetTank ? 0 : res.point.distanceTo(target);
      if (!best || miss < best.miss) best = { ...s, miss };
      if (miss < 2.5) break;
    }
    const f = Math.pow(this.diff.decay, this.shots++);
    const az = normDeg(best.az + clamp(gauss(), -2.2, 2.2) * (this.diff.azErr * f + 0.25));
    const power = clamp(best.power + clamp(gauss(), -2.2, 2.2) * (this.diff.powErr * f + 0.4), 5, 100);
    return { az, el: best.el, power };
  }
}
