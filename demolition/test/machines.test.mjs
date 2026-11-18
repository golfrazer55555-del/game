import test from 'node:test';
import assert from 'node:assert/strict';
import { loadPhysics } from '../src/physics.js';
import { Sim } from '../src/sim.js';
import { buildSite } from '../src/site.js';
import { Crane } from '../src/machines/crane.js';
import { Excavator } from '../src/machines/excavator.js';
import { VS } from '../src/config.js';

async function site(building) {
  await loadPhysics();
  const sim = new Sim({ seed: 2 });
  const layout = buildSite(sim, { building, seed: 4 });
  sim.finalizeSetup();
  return { sim, layout };
}

test('wrecking ball pumped by luffing breaks the warehouse wall', async () => {
  const { sim, layout } = await site('warehouse');
  const cr = new Crane(sim, layout.spawns.crane, { ball: 1, boom: 0 });
  const tb = sim.world.owners[layout.target].box;
  cr.aimAt((tb.x0 + (tb.x1 - tb.x0) * 0.28) * VS, tb.z0 * VS - 3.2, 3);
  sim.machines = [cr];
  cr.active = true;
  const before = sim.world.structCount[layout.target];
  for (let k = 0; k < 60 * 30; k++) {
    const period = 2 * Math.PI * Math.sqrt(cr.s.rope / 9.81);
    const phase = (sim.time % period) / period;
    sim.input = { lx: 0, ly: phase < 0.5 ? -1 : 1, rx: 0, ry: 0, a: false };
    sim.step();
  }
  const lost = before - sim.world.structCount[layout.target];
  const es = sim.fx.filter((e) => e.t === 'ballhit').map((e) => Math.round(e.e / 1000));
  console.log('hit energies kJ', es.slice(0, 20).join(','));
  console.log(`ball hits ${cr.s.hits}, blocks broken ${lost}, overloads ${cr.s.overloads}, maxLMI ~${cr.s.lmi.toFixed(2)}`);
  assert.ok(cr.s.hits > 2, 'ball reached the wall');
  assert.ok(lost > 100, 'wall got smashed');
});

test('excavator crusher bites and breaker chips concrete', async () => {
  const { sim, layout } = await site('shop');
  const tb = sim.world.owners[layout.target].box;
  // 상가 앞 기둥 앞에 굴착기를 세운다
  const ex = new Excavator(sim, { x: tb.x0 + 9, z: tb.z0 - 30, heading: 0 }, { boomset: 'std', attach: 'crusher' });
  sim.machines = [ex];
  ex.active = true;
  const before = sim.world.structCount[layout.target];
  // 팔을 펴서 벽에 닿을 때까지 앞으로
  for (let k = 0; k < 60 * 6; k++) { sim.input = { lx: 0, ly: 1, rx: 0, ry: 0, a: false }; sim.step(); }
  for (let k = 0; k < 60 * 6; k++) { sim.input = { lx: 0, ly: 0.3, rx: 0, ry: 0, a: true }; sim.step(); }
  const afterCrush = sim.world.structCount[layout.target];
  ex.setAttachment('breaker');
  for (let k = 0; k < 60 * 5; k++) { sim.input = { lx: 0, ly: 0.4, rx: 0, ry: 0, a: true }; sim.step(); }
  const afterBreak = sim.world.structCount[layout.target];
  console.log(`crusher removed ${before - afterCrush}, breaker removed ${afterCrush - afterBreak}, contact=${ex.s.contact}, jaw=${ex.s.jaw.toFixed(2)}`);
  assert.ok(before - afterBreak > 20, 'excavator removed material');
});
