// 고정 시간 간격 시뮬레이션. 같은 상태에서 같은 입력이면 항상 같은 결과가 나온다 (발파 리플레이용).
import { SIM_DT, STRUCT_LOCAL_EVERY, STRUCT_GLOBAL_EVERY, WARN_RATIO } from './config.js';
import { World } from './world.js';
import { Structure } from './structure.js';
import { Physics } from './physics.js';
import { Bodies } from './bodies.js';
import { Debris, Rubble } from './debris.js';
import { Damage } from './damage.js';
import { Rng } from './util.js';
import { crackedOf, isStruct } from './materials.js';

export class Sim {
  constructor(opts = {}) {
    this.world = new World();
    this.struct = new Structure(this.world);
    this.phys = new Physics(this.world);
    this.bodies = new Bodies(this);
    this.debris = new Debris(opts.particles || 2400);
    this.rubble = new Rubble(this.world);
    this.damage = new Damage(this);
    this.rng = new Rng(opts.seed || 12345);
    this.fx = [];
    this.tick = 0;
    this.time = 0;
    this.machines = [];
    this.explosives = null;
    this.input = null;          // 이번 틱 조작 입력 (게임이 채움)
    this.pendingGlobal = false;
    this.lastWarnTick = 0;
    this.events = { collapses: 0, maxStress: 0 };
    this.paused = false;
  }

  // 건물 생성 직후: 메시·충돌체 준비, 강도 보정
  finalizeSetup() {
    const w = this.world;
    w.countOwners();
    const structOwners = [];
    for (let o = 1; o < w.owners.length; o++) if (w.owners[o].box) structOwners.push(o);
    this.struct.globalPass(structOwners, true);
    w.takeDamageBox();
    w.dirtyOwners.clear();
    w.structDirty = false;
    this.phys.rebuildAll();
    // 첫 화면용 구조 보기
    const target = structOwners.filter((o) => w.owners[o].kind === 'target');
    if (target.length) this.struct.lastView = this.struct.globalPass(target).views;
    w.takeDamageBox();
    w.dirtyOwners.clear();
  }

  step() {
    const dt = SIM_DT;
    this.tick++;
    this.time += dt;
    for (const m of this.machines) m.step(dt, this);
    if (this.explosives) this.explosives.step(dt, this);
    this.phys.rebuildDirty();
    this.phys.step();
    this.bodies.postStep();
    this.debris.step(dt, this.world, this.rubble);
    if (this.tick & 1) this.rubble.step(this.rng, 700);
    this.structureStep();
  }

  structureStep() {
    const w = this.world;
    if (this.tick % STRUCT_LOCAL_EVERY === 0) {
      const box = w.takeDamageBox();
      if (box) {
        const lost = this.struct.localSupport(box);
        if (lost.length) {
          const groups = this.struct.groupVoxels(lost);
          groups.sort((a, b) => b.length - a.length);
          for (const g of groups) this.detach(g, 'local');
        }
        this.pendingGlobal = true;
      }
    }
    if (this.pendingGlobal && this.tick % STRUCT_GLOBAL_EVERY === 0 && w.dirtyOwners.size) {
      const owners = [...w.dirtyOwners].sort((a, b) => a - b).filter((o) => w.owners[o] && w.owners[o].box);
      w.dirtyOwners.clear();
      this.pendingGlobal = false;
      const res = this.struct.globalPass(owners);
      if (res.views.length) this.struct.lastView = res.views;
      for (const v of res.views) this.events.maxStress = Math.max(this.events.maxStress * 0.98, v.maxRatio);
      for (const list of res.detach) this.detach(list, 'float');
      for (const t of res.topple) {
        const len = Math.hypot(t.dirX, t.dirZ) || 1;
        // 넘어가는 방향으로 살짝 밀어 준다 (기울기 시작)
        const ang = { x: (t.dirZ / len) * 0.12, y: 0, z: (-t.dirX / len) * 0.12 };
        this.fx.push({ t: 'topple', owner: t.owner, n: t.list.length });
        this.events.collapses++;
        this.bodies.fromWorld(t.list, { ang });
      }
      if (res.crush.length) {
        const uniq = [...new Set(res.crush)];
        const r = this.damage.removeWorld(uniq, { mode: 'fail', vel: [0, -1.5, 0], jitter: 1.4 });
        this.fx.push({ t: 'crack', n: r.n, i: uniq[0] });
        this.events.collapses++;
      }
      if (res.warnings.length && this.tick - this.lastWarnTick > 18) {
        this.lastWarnTick = this.tick;
        const top = res.warnings[0];
        this.fx.push({ t: 'creak', ratio: top.ratio, i: top.i });
        for (const wv of res.warnings) {
          if (wv.ratio > 0.82 && this.rng.next() < 0.45) {
            const m = w.mat[wv.i];
            const c = crackedOf(m);
            if (c && isStruct(m)) w.setSilent(wv.i, c);
          }
          if (this.rng.next() < 0.5) this.fx.push({ t: 'crumb', i: wv.i });
        }
      }
      void WARN_RATIO;
    }
  }

  detach(list, why) {
    if (list.length >= 6) {
      const b = this.bodies.fromWorld(list, {});
      if (b && b.count > 400) { this.fx.push({ t: 'detach', n: b.count, why }); this.events.collapses++; }
    } else {
      this.damage.removeWorld(list, { mode: 'fail', vel: [0, -1, 0] });
    }
  }

  // ───── 스냅샷 (발파 리플레이·재도전) ─────
  snapshot() {
    return {
      tick: this.tick, time: this.time, rng: this.rng.s,
      world: this.world.snapshot(), struct: this.struct.snapshot(), phys: this.phys.snapshot(),
      bodies: this.bodies.snapshot(), debris: this.debris.snapshot(), rubble: this.rubble.snapshot(),
      machines: this.machines.map((m) => (m.snapshot ? m.snapshot() : null)),
      explosives: this.explosives ? this.explosives.snapshot() : null,
      events: { ...this.events }, pendingGlobal: this.pendingGlobal, lastWarnTick: this.lastWarnTick,
    };
  }
  restore(s) {
    this.tick = s.tick; this.time = s.time; this.rng.s = s.rng;
    this.world.restore(s.world);
    this.struct.restore(s.struct);
    this.bodies.restore(s.bodies);
    this.phys.restore(s.phys, this.bodies.byId);
    this.debris.restore(s.debris);
    this.rubble.restore(s.rubble);
    this.machines.forEach((m, k) => { if (m.restore && s.machines[k]) m.restore(s.machines[k], this); });
    if (this.explosives && s.explosives) this.explosives.restore(s.explosives);
    this.events = { ...s.events };
    this.pendingGlobal = s.pendingGlobal; this.lastWarnTick = s.lastWarnTick;
    this.fx.length = 0;
    // 물리 월드를 새로 만들었으므로 colDirty는 비운다 (스냅샷 안 충돌체가 이미 일치)
    this.world.colDirty.fill(0); this.world.colDirtyList.length = 0;
  }
}
