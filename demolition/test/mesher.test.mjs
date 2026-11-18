import test from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../src/world.js';
import { meshWorldChunk, meshPadded } from '../src/mesher.js';
import { M } from '../src/materials.js';

test('single block makes 5 visible faces on the ground', () => {
  const w = new World();
  w.put(5, 0, 5, M.CONCRETE, 1);
  const m = meshWorldChunk(w, 0, 0, 0, 16);
  assert.equal(m.quads, 5); // 아랫면은 땅에 가려짐
});

test('floating block makes 6 faces, bar merges to 6 quads', () => {
  const w = new World();
  w.put(5, 4, 5, M.CONCRETE, 1);
  assert.equal(meshWorldChunk(w, 0, 0, 0, 16).quads, 6);
  const w2 = new World();
  for (let x = 2; x < 10; x++) w2.put(x, 4, 5, M.CONCRETE, 1);
  assert.equal(meshWorldChunk(w2, 0, 0, 0, 16).quads, 6);
});

test('flat wall merges into few quads', () => {
  const w = new World();
  for (let x = 0; x < 16; x++) for (let y = 0; y < 16; y++) w.put(x, y, 8, M.BRICK, 1);
  const m = meshWorldChunk(w, 0, 0, 0, 16);
  assert.ok(m.quads <= 12, `quads=${m.quads}`);
  // 모든 정점이 청크 범위 안
  for (let i = 0; i < m.pos.length; i++) assert.ok(m.pos[i] >= 0 && m.pos[i] <= 16);
});

test('faces between chunks are culled', () => {
  const w = new World();
  w.put(15, 3, 3, M.CONCRETE, 1);
  w.put(16, 3, 3, M.CONCRETE, 1);
  const a = meshWorldChunk(w, 0, 0, 0, 16);
  const b = meshWorldChunk(w, 1, 0, 0, 16);
  assert.equal(a.quads + b.quads, 10);
});

test('winding: normals agree with triangle orientation', () => {
  const pad = new Uint8Array(5 * 5 * 5);
  pad[2 + 5 * (2 + 5 * 2)] = M.CONCRETE; // (1,1,1) 내부 좌표
  const m = meshPadded(pad, 3, 3, 3, 0, 0, 0);
  for (let t = 0; t < m.idx.length; t += 3) {
    const A = m.idx[t] * 3, B = m.idx[t + 1] * 3, C = m.idx[t + 2] * 3;
    const ux = m.pos[B] - m.pos[A], uy = m.pos[B + 1] - m.pos[A + 1], uz = m.pos[B + 2] - m.pos[A + 2];
    const vx = m.pos[C] - m.pos[A], vy = m.pos[C + 1] - m.pos[A + 1], vz = m.pos[C + 2] - m.pos[A + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const dot = nx * m.nor[A] + ny * m.nor[A + 1] + nz * m.nor[A + 2];
    assert.ok(dot > 0, 'triangle faces along its normal');
  }
});
