import test from 'node:test';
import assert from 'node:assert/strict';
import { loadPhysics } from '../src/physics.js';
import { Sim } from '../src/sim.js';
import { M } from '../src/materials.js';

function tower(sim) {
  const w = sim.world;
  const o = w.addOwner({ name: 'tower', kind: 'target' });
  const put = (x0, y0, z0, x1, y1, z1, m) => { for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) w.put(x, y, z, m, o); };
  const cols = [[80, 80], [80, 100], [100, 80], [100, 100]];
  for (let f = 0; f < 3; f++) {
    const yb = f * 12;
    for (const [cx, cz] of cols) put(cx, yb, cz, cx + 1, yb + 10, cz + 1, M.CONCRETE2);
    put(78, yb + 11, 78, 103, yb + 11, 103, M.CONCRETE);
  }
  w.owners[o].box = { x0: 78, x1: 103, y0: 0, y1: 35, z0: 78, z1: 103 };
  return o;
}

test('cutting ground columns brings the tower down into rubble', async () => {
  await loadPhysics();
  const sim = new Sim({ seed: 7 });
  const o = tower(sim);
  sim.finalizeSetup();
  const w = sim.world;
  const standing0 = w.standing[o];
  assert.ok(standing0 > 1000);
  // 정상 상태 1초: 아무 일 없음
  for (let k = 0; k < 60; k++) sim.step();
  assert.equal(sim.bodies.list.length, 0);
  // 1층 기둥 4개 모두 절단
  for (const [cx, cz] of [[80, 80], [80, 100], [100, 80], [100, 100]]) {
    const list = [];
    for (let y = 3; y <= 5; y++) for (let dz = 0; dz < 2; dz++) for (let dx = 0; dx < 2; dx++) list.push(w.idx(cx + dx, y, cz + dz));
    sim.damage.removeWorld(list, { mode: 'blast' });
  }
  let maxBodies = 0;
  const t0 = performance.now();
  for (let k = 0; k < 60 * 8; k++) { sim.step(); maxBodies = Math.max(maxBodies, sim.bodies.list.length); }
  const ms = performance.now() - t0;
  console.log(`8s sim: ${ms.toFixed(0)} ms, max bodies ${maxBodies}, standing ${w.standing[o]} / ${standing0}, rubble ${w.rubTotal[o]}`);
  assert.ok(maxBodies >= 1, 'upper part detached as a body');
  assert.ok(w.standing[o] < standing0 * 0.5, 'most of the tower no longer standing');
  assert.ok(w.rubTotal[o] > 500, 'rubble pile formed');
});

test('snapshot and restore replays identically', async () => {
  await loadPhysics();
  const run = (sim) => { for (let k = 0; k < 180; k++) sim.step(); return [sim.world.standing[1], sim.world.rubTotal[1], sim.bodies.list.length, sim.debris.n]; };
  const sim = new Sim({ seed: 3 });
  tower(sim);
  sim.finalizeSetup();
  const w = sim.world;
  const cut = () => {
    for (const [cx, cz] of [[100, 80], [100, 100]]) {
      const list = [];
      for (let y = 2; y <= 6; y++) for (let dz = 0; dz < 2; dz++) for (let dx = 0; dx < 2; dx++) list.push(w.idx(cx + dx, y, cz + dz));
      sim.damage.removeWorld(list, { mode: 'blast' });
    }
  };
  const snap = sim.snapshot();
  cut();
  const a = run(sim);
  sim.restore(snap);
  cut();
  const b = run(sim);
  console.log('replay', a, b);
  assert.deepEqual(a, b);
});
