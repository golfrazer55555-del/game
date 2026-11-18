import test from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../src/world.js';
import { Structure } from '../src/structure.js';
import { M } from '../src/materials.js';

function setup() {
  const w = new World();
  const o = w.addOwner({ name: 'test', kind: 'target' });
  return { w, o, s: new Structure(w) };
}
function box(w, o, x0, y0, z0, x1, y1, z1, m) {
  for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) w.put(x, y, z, m, o);
}
function bounds(w, o, b) { w.owners[o].box = b; }

test('cut column: slab and upper column lose support', () => {
  const { w, o, s } = setup();
  box(w, o, 50, 0, 50, 51, 19, 51, M.CONCRETE2);     // 기둥
  box(w, o, 46, 20, 46, 55, 20, 55, M.CONCRETE);     // 슬래브
  // 중간 층 하나 절단
  for (let z = 50; z <= 51; z++) for (let x = 50; x <= 51; x++) w.remove(w.idx(x, 10, z));
  const dmg = w.takeDamageBox();
  const lost = s.localSupport(dmg);
  const expected = 2 * 2 * 9 + 10 * 10;  // y=11..19 기둥 + 슬래브
  assert.equal(lost.length, expected);
  const groups = s.groupVoxels(lost);
  assert.equal(groups.length, 1);
});

test('wide hole in brick wall drops the wall above the middle', () => {
  const { w, o, s } = setup();
  box(w, o, 40, 0, 60, 79, 19, 60, M.BRICK);
  for (let y = 0; y < 8; y++) for (let x = 50; x < 70; x++) w.remove(w.idx(x, y, 60));
  const lost = s.localSupport(w.takeDamageBox());
  assert.ok(lost.length > 0, 'middle part above the opening falls');
  // 구멍 가장자리에서 8칸 안쪽은 버틴다
  const xs = new Set(lost.map((i) => i % 192));
  for (const x of xs) assert.ok(x >= 58 && x <= 61, `x=${x}`);
});

test('narrow window opening is fine', () => {
  const { w, o, s } = setup();
  box(w, o, 40, 0, 60, 79, 19, 60, M.BRICK);
  for (let y = 4; y < 10; y++) for (let x = 55; x < 61; x++) w.remove(w.idx(x, y, 60));
  assert.equal(s.localSupport(w.takeDamageBox()).length, 0);
});

test('global pass: calibrated tower stands, one-sided loss topples or crushes', () => {
  const { w, o, s } = setup();
  // 4개 기둥 + 3개 층 슬래브 (작은 건물)
  const cols = [[60, 60], [60, 80], [80, 60], [80, 80]];
  for (let f = 0; f < 3; f++) {
    const yb = f * 12;
    for (const [cx, cz] of cols) box(w, o, cx, yb, cz, cx + 1, yb + 10, cz + 1, M.CONCRETE2);
    box(w, o, 58, yb + 11, 58, 83, yb + 11, 83, M.CONCRETE);
  }
  bounds(w, o, { x0: 58, x1: 83, y0: 0, y1: 35, z0: 58, z1: 83 });
  s.globalPass([o], true);
  assert.ok(w.owners[o].kStrength > 0);
  let r = s.globalPass([o]);
  assert.equal(r.detach.length + r.topple.length + r.crush.length, 0, 'intact building is stable');
  assert.ok(r.views[0].maxRatio < 0.4);
  // 한쪽(x=80) 1층 기둥 두 개를 모두 자름
  for (const [cx, cz] of cols.filter((c) => c[0] === 80)) for (let y = 0; y <= 10; y++) for (let dz = 0; dz < 2; dz++) for (let dx = 0; dx < 2; dx++) w.remove(w.idx(cx + dx, y, cz + dz));
  r = s.globalPass([o]);
  assert.ok(r.topple.length + r.crush.length + r.detach.length > 0, 'loses stability');
});
