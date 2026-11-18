import test from 'node:test';
import assert from 'node:assert/strict';
import { loadPhysics } from '../src/physics.js';
import { Sim } from '../src/sim.js';
import { buildSite, BUILDINGS } from '../src/site.js';
import { GX, GZ } from '../src/config.js';

for (const key of Object.keys(BUILDINGS)) {
  test(`${key} stands on its own`, async () => {
    await loadPhysics();
    const sim = new Sim({ seed: 5 });
    const layout = buildSite(sim, { building: key, seed: 9 });
    sim.finalizeSetup();
    const w = sim.world;
    // 모든 소유자 범위에서 국부 지지 검사
    let lost = 0;
    const where = {};
    for (let o = 1; o < w.owners.length; o++) {
      const b = w.owners[o].box;
      if (!b) continue;
      const l = sim.struct.localSupport({ ...b });
      for (const i of l) { const y = (i / (GX * GZ)) | 0; where[w.owners[o].name + '@' + y] = (where[w.owners[o].name + '@' + y] || 0) + 1; }
      lost += l.length;
    }
    if (lost) console.log(key, 'unsupported', JSON.stringify(where).slice(0, 600));
    assert.equal(lost, 0, 'nothing hangs unsupported');
    const t0 = performance.now();
    for (let k = 0; k < 120; k++) sim.step();
    const ms = (performance.now() - t0) / 120;
    const tgt = w.owners[layout.target];
    console.log(`${key}: ${tgt.initial} blocks, k=${tgt.kStrength.toFixed(0)}, bodies after 2s=${sim.bodies.list.length}, step ${ms.toFixed(2)} ms, owners=${w.owners.length}`);
    assert.equal(sim.bodies.list.length, 0, 'no collapse at rest');
    assert.equal(w.standing[layout.target], tgt.initialStanding, 'target intact');
  });
}
