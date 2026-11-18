// 건물 생성기. 모든 좌표는 블록(0.25 m) 단위, y=0은 지면 바로 위 첫 칸.
import { GX, GY, GZ } from '../config.js';
import { M } from '../materials.js';

export class Builder {
  constructor(world, owner, rng) {
    this.w = world; this.o = owner; this.rng = rng;
    this.box = { x0: GX, y0: GY, z0: GZ, x1: -1, y1: -1, z1: -1 };
  }
  put(x, y, z, m) {
    if (x < 0 || x >= GX || y < 0 || y >= GY || z < 0 || z >= GZ) return;
    this.w.put(x, y, z, m, m ? this.o : 0);
    if (!m) return;
    const b = this.box;
    if (x < b.x0) b.x0 = x; if (x > b.x1) b.x1 = x; if (y < b.y0) b.y0 = y; if (y > b.y1) b.y1 = y; if (z < b.z0) b.z0 = z; if (z > b.z1) b.z1 = z;
  }
  fill(x0, y0, z0, x1, y1, z1, m) {
    if (x0 > x1) [x0, x1] = [x1, x0]; if (y0 > y1) [y0, y1] = [y1, y0]; if (z0 > z1) [z0, z1] = [z1, z0];
    for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) this.put(x, y, z, typeof m === 'function' ? m(x, y, z) : m);
  }
  clear(x0, y0, z0, x1, y1, z1) { this.fill(x0, y0, z0, x1, y1, z1, 0); }
  // 테두리 벽 (두께 1)
  ring(x0, y0, z0, x1, y1, z1, m) {
    this.fill(x0, y0, z0, x1, y1, z0, m); this.fill(x0, y0, z1, x1, y1, z1, m);
    this.fill(x0, y0, z0, x0, y1, z1, m); this.fill(x1, y0, z0, x1, y1, z1, m);
  }
  get(x, y, z) { return this.w.get(x, y, z); }
  done() { this.w.owners[this.o].box = { ...this.box }; return this.box; }
}

// 벽돌 쌓기 무늬
const brick = (a, b) => (x, y, z) => ((((x + z + ((y & 1) ? 2 : 0)) >> 2) & 1) ? b : a);

// ───────────── 픽셀 글자 (간판, 동 번호) ─────────────
let textCanvas = null;
export function textMask(text, px = 12, font = 'Galmuri11') {
  try {
    if (!textCanvas) {
      if (typeof OffscreenCanvas !== 'undefined') textCanvas = new OffscreenCanvas(256, 32);
      else if (typeof document !== 'undefined') { textCanvas = document.createElement('canvas'); textCanvas.width = 256; textCanvas.height = 32; }
      else return null;
    }
    const ctx = textCanvas.getContext('2d', { willReadFrequently: true });
    ctx.clearRect(0, 0, 256, 32);
    ctx.font = `bold ${px}px "${font}", sans-serif`;
    ctx.textBaseline = 'top';
    ctx.fillStyle = '#fff';
    const wdt = Math.min(254, Math.ceil(ctx.measureText(text).width) + 2);
    ctx.fillText(text, 1, 1);
    const h = px + 3;
    const data = ctx.getImageData(0, 0, wdt, h).data;
    const rows = [];
    for (let y = 0; y < h; y++) { const r = []; for (let x = 0; x < wdt; x++) r.push(data[(y * wdt + x) * 4 + 3] > 110 ? 1 : 0); rows.push(r); }
    // 빈 줄 잘라내기
    while (rows.length && !rows[0].some(Boolean)) rows.shift();
    while (rows.length && !rows[rows.length - 1].some(Boolean)) rows.pop();
    let minX = 1e9, maxX = -1;
    for (const r of rows) r.forEach((v, x) => { if (v) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); } });
    if (maxX < 0) return null;
    return rows.map((r) => r.slice(minX, maxX + 1));
  } catch { return null; }
}

// 벽 면(정면이 -z 또는 +x 등)에 글자 붙이기. axis: 'x'면 x 방향으로 글자가 이어진다
function stampText(b, mask, x0, yTop, z0, axis, dirSign, m, scale = 1) {
  if (!mask) return;
  const H = mask.length;
  for (let r = 0; r < H; r++) for (let c = 0; c < mask[r].length; c++) {
    if (!mask[r][c]) continue;
    for (let sy = 0; sy < scale; sy++) for (let sx = 0; sx < scale; sx++) {
      const y = yTop - r * scale - sy;
      const u = c * scale + sx;
      if (axis === 'x') b.put(x0 + u * dirSign, y, z0, m); else b.put(x0, y, z0 + u * dirSign, m);
    }
  }
}

// ───────────── 가구 (건물 안 소품) ─────────────
function furniture(b, x, y, z, kind) {
  switch (kind) {
    case 'sofa': b.fill(x, y, z, x + 7, y + 1, z + 2, M.FURN_FABRIC); b.fill(x, y + 2, z + 2, x + 7, y + 3, z + 2, M.FURN_FABRIC); break;
    case 'table': b.fill(x, y + 2, z, x + 5, y + 2, z + 3, M.FURN_WOOD); b.put(x, y, z, M.FURN_WOOD); b.put(x, y + 1, z, M.FURN_WOOD); b.put(x + 5, y, z + 3, M.FURN_WOOD); b.put(x + 5, y + 1, z + 3, M.FURN_WOOD); b.put(x + 5, y, z, M.FURN_WOOD); b.put(x + 5, y + 1, z, M.FURN_WOOD); b.put(x, y, z + 3, M.FURN_WOOD); b.put(x, y + 1, z + 3, M.FURN_WOOD); break;
    case 'fridge': b.fill(x, y, z, x + 2, y + 6, z + 2, M.FURN_WHITE); break;
    case 'bed': b.fill(x, y, z, x + 5, y, z + 8, M.FURN_WOOD); b.fill(x, y + 1, z, x + 5, y + 1, z + 8, M.FURN_WHITE); b.fill(x, y + 2, z + 7, x + 5, y + 3, z + 8, M.FURN_WOOD); break;
    case 'desk': b.fill(x, y + 2, z, x + 5, y + 2, z + 2, M.FURN_WOOD); b.fill(x, y, z, x, y + 1, z + 2, M.FURN_DARK); b.fill(x + 5, y, z, x + 5, y + 1, z + 2, M.FURN_DARK); b.fill(x + 2, y + 3, z + 1, x + 3, y + 4, z + 1, M.FURN_DARK); break;
    case 'shelf': b.fill(x, y, z, x + 5, y + 6, z + 1, M.FURN_WOOD); for (let k = 1; k < 6; k += 2) b.fill(x + 1, y + k, z, x + 4, y + k, z, M.SIGN_YELLOW); break;
    case 'crate': b.fill(x, y, z, x + 4, y + 4, z + 4, M.WOOD); b.fill(x, y + 2, z, x + 4, y + 2, z + 4, M.WOOD_DARK); break;
    case 'tv': b.fill(x, y, z, x + 3, y + 1, z + 1, M.FURN_DARK); b.fill(x, y + 2, z + 1, x + 3, y + 4, z + 1, M.FURN_DARK); break;
  }
}

function openings(b, x0, x1, y0, y1, z, m) { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) b.put(x, y, z, m); }
function openingsZ(b, z0, z1, y0, y1, x, m) { for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) b.put(x, y, z, m); }

// ───────────── 1. 낡은 창고 (벽돌 + 철골 지붕) ─────────────
export function warehouse(b, X, Z) {
  const W = 64, D = 40, H = 24;
  b.fill(X, 0, Z, X + W - 1, 0, Z + D - 1, M.FOUNDATION);
  b.fill(X, 1, Z, X + W - 1, H, Z + D - 1, (x, y, z) => (x === X || x === X + W - 1 || z === Z || z === Z + D - 1 ? brick(M.BRICK_OLD, M.BRICK)(x, y, z) : 0));
  // 철골 기둥
  for (let x = X; x < X + W; x += 16) {
    const xc = Math.min(x, X + W - 2);
    b.fill(xc, 1, Z + 1, xc + 1, H, Z + 2, M.STEEL_RUST);
    b.fill(xc, 1, Z + D - 3, xc + 1, H, Z + D - 2, M.STEEL_RUST);
  }
  // 큰 출입문 + 철 인방
  b.clear(X + 22, 1, Z, X + 41, 16, Z);
  b.fill(X + 20, 17, Z, X + 43, 18, Z, M.STEEL_RUST);
  // 높은 창
  for (let k = 0; k < 7; k++) {
    const x = X + 5 + k * 8;
    openings(b, x, x + 3, 15, 19, Z + D - 1, M.GLASS);
    if (x < X + 20 || x > X + 41) openings(b, x, x + 3, 19, 21, Z, M.GLASS);
  }
  openingsZ(b, Z + 8, Z + 13, 12, 18, X, M.GLASS);
  openingsZ(b, Z + 26, Z + 31, 12, 18, X + W - 1, M.GLASS);
  // 박공벽 + 지붕
  const ridge = (z) => H + 1 + Math.floor(Math.min(z - Z + 1, Z + D - z) / 2.6);
  for (let z = Z; z < Z + D; z++) {
    const top = ridge(z);
    for (let y = H + 1; y < top; y++) { b.put(X, y, z, M.BRICK_OLD); b.put(X + W - 1, y, z, M.BRICK_OLD); }
  }
  for (let x = X; x < X + W; x += 16) {
    const xc = Math.min(x, X + W - 2);
    for (let z = Z; z < Z + D; z++) { b.put(xc, H + 1, z, M.STEEL); b.put(xc, ridge(z) - 1, z, M.STEEL); }
  }
  for (let x = X - 1; x <= X + W; x++) for (let z = Z - 1; z <= Z + D; z++) b.put(x, ridge(Math.max(Z, Math.min(Z + D - 1, z))), z, ((x >> 1) & 1) ? M.METAL_SHEET : M.METAL_RED);
  // 안에 쌓인 상자들
  for (let k = 0; k < 9; k++) {
    const cx = X + 4 + b.rng.int(W - 12), cz = Z + 6 + b.rng.int(D - 14);
    furniture(b, cx, 1, cz, 'crate');
    if (b.rng.next() < 0.5) furniture(b, cx, 6, cz, 'crate');
  }
  return b.done();
}

// ───────────── 2. 단독주택 (붉은 벽돌 2층 + 박공 지붕) ─────────────
export function house(b, X, Z, opts = {}) {
  const W = opts.w || 40, D = opts.d || 32, FH = 12;
  const wall = brick(opts.brickA || M.BRICK_OLD, opts.brickB || M.BRICK);
  b.fill(X, 0, Z, X + W - 1, 0, Z + D - 1, M.FOUNDATION);
  for (let f = 0; f < 2; f++) {
    const yb = 1 + f * FH, yt = yb + FH - 2;
    b.fill(X, yb, Z, X + W - 1, yt, Z + D - 1, (x, y, z) => (x === X || x === X + W - 1 || z === Z || z === Z + D - 1 ? wall(x, y, z) : 0));
    b.fill(X, yt + 1, Z, X + W - 1, yt + 1, Z + D - 1, M.CONCRETE);
    // 칸막이
    const px = X + Math.floor(W / 2);
    b.fill(px, yb, Z + 1, px, yt, Z + D - 2, M.PLASTER);
    b.clear(px, yb, Z + 8, px, yb + 7, Z + 11);
    // 창문
    for (const wx of [X + 5, X + W - 13]) { openings(b, wx, wx + 7, yb + 3, yb + 8, Z, M.GLASS); openings(b, wx, wx + 7, yb + 3, yb + 8, Z + D - 1, M.GLASS); }
    openingsZ(b, Z + 10, Z + 17, yb + 3, yb + 8, X, M.GLASS);
    openingsZ(b, Z + 10, Z + 17, yb + 3, yb + 8, X + W - 1, M.GLASS);
  }
  // 현관문
  const dx = X + Math.floor(W / 2) - 6;
  openings(b, dx, dx + 4, 1, 8, Z, M.WOOD_DARK);
  b.fill(dx - 1, 9, Z - 3, dx + 5, 9, Z - 1, M.CONCRETE);     // 차양
  // 지붕 (용마루가 x 방향)
  const roofM = opts.roof || M.ROOF_RED;
  const base = 1 + 2 * FH;
  const half = D / 2 + 2;
  for (let z = Z - 2; z <= Z + D + 1; z++) {
    const t = Math.min(z - (Z - 2), Z + D + 1 - z);
    const y = base + Math.floor(t * 0.62);
    for (let x = X - 2; x <= X + W + 1; x++) b.put(x, y, z, ((x + y) % 5 === 0) ? M.ROOF_TILE : roofM);
    if (z >= Z && z < Z + D) for (let yy = base; yy < y; yy++) { b.put(X, yy, z, wall(X, yy, z)); b.put(X + W - 1, yy, z, wall(X + W - 1, yy, z)); }
  }
  void half;
  // 가구
  furniture(b, X + 3, 1, Z + 3, 'sofa');
  furniture(b, X + 4, 1, Z + 10, 'table');
  furniture(b, X + W - 6, 1, Z + 3, 'fridge');
  furniture(b, X + W - 10, 1, Z + D - 5, 'tv');
  furniture(b, X + 3, 1 + FH, Z + 4, 'bed');
  furniture(b, X + W - 9, 1 + FH, Z + 14, 'bed');
  furniture(b, X + W - 8, 1 + FH, Z + 3, 'desk');
  return b.done();
}

// ───────────── 3. 3층 상가 (철근콘크리트 라멘조) ─────────────
const SIGNS = [['치킨', M.SIGN_RED, M.SIGN_WHITE], ['PC방', M.SIGN_BLUE, M.SIGN_WHITE], ['약국', M.SIGN_GREEN, M.SIGN_WHITE], ['분식', M.SIGN_YELLOW, M.SIGN_RED], ['세탁', M.SIGN_WHITE, M.SIGN_BLUE], ['당구장', M.SIGN_RED, M.SIGN_YELLOW], ['노래방', M.SIGN_BLUE, M.SIGN_YELLOW], ['학원', M.SIGN_WHITE, M.SIGN_GREEN]];

export function rcFrame(b, X, Z, o) {
  const { W, D, floors, colX, colZ, finish = M.PLASTER, accent = M.TERRACOTTA, glassFront = false, curtain = false, signs = 0, core = true, groundH = 14, FH = 12 } = o;
  b.fill(X, 0, Z, X + W - 1, 0, Z + D - 1, M.FOUNDATION);
  let yb = 1;
  const levels = [];
  for (let f = 0; f < floors; f++) {
    const h = f === 0 ? groundH : FH;
    const slab = yb + h - 1;
    levels.push({ yb, slab });
    // 기둥
    for (const cx of colX) for (const cz of colZ) b.fill(X + cx, yb, Z + cz, X + cx + 1, slab - 1, Z + cz + 1, M.CONCRETE2);
    // 보
    for (const cz of colZ) b.fill(X, slab - 2, Z + cz, X + W - 1, slab - 1, Z + cz + 1, M.CONCRETE2);
    for (const cx of colX) b.fill(X + cx, slab - 2, Z, X + cx + 1, slab - 1, Z + D - 1, M.CONCRETE2);
    // 슬래브
    b.fill(X, slab, Z, X + W - 1, slab, Z + D - 1, M.CONCRETE);
    // 외벽 (기둥 사이 채움벽)
    const top = slab - 3;
    const isCol = (u, list) => list.some((c) => u >= c && u <= c + 1);
    for (let y = yb; y <= top; y++) {
      for (let x = X; x < X + W; x++) {
        if (isCol(x - X, colX)) continue;
        const fm = y === yb || y === top ? accent : finish;
        b.put(x, y, Z, fm); b.put(x, y, Z + D - 1, fm);
      }
      for (let z = Z; z < Z + D; z++) {
        if (isCol(z - Z, colZ)) continue;
        const fm = y === yb || y === top ? accent : finish;
        b.put(X, y, z, fm); b.put(X + W - 1, y, z, fm);
      }
    }
    // 창 / 유리
    for (let k = 0; k < colX.length - 1; k++) {
      const a = X + colX[k] + 3, e = X + colX[k + 1] - 2;
      if (curtain) {
        for (let y = yb; y <= slab - 1; y++) for (let x = X + colX[k] + 2; x <= X + colX[k + 1] - 1; x++) b.put(x, y, Z, (x - X) % 6 === 0 || y === yb ? M.STEEL : M.GLASS_DARK);
      } else if (f === 0 && glassFront) {
        openings(b, a - 1, e, yb, yb + 9, Z, M.GLASS);
        b.clear(a + 2, yb, Z, a + 5, yb + 8, Z);   // 출입문
      } else openings(b, a + 1, e - 1, yb + 4, yb + 8, Z, M.GLASS);
      openings(b, a + 1, e - 1, yb + 4, yb + 8, Z + D - 1, M.GLASS);
    }
    for (let k = 0; k < colZ.length - 1; k++) {
      const a = Z + colZ[k] + 3, e = Z + colZ[k + 1] - 2;
      if (curtain) for (let y = yb; y <= slab - 1; y++) for (let z = Z + colZ[k] + 2; z <= Z + colZ[k + 1] - 1; z++) b.put(X, y, z, (z - Z) % 6 === 0 || y === yb ? M.STEEL : M.GLASS_DARK);
      else openingsZ(b, a + 1, e - 1, yb + 4, yb + 8, X, M.GLASS);
      openingsZ(b, a + 1, e - 1, yb + 4, yb + 8, X + W - 1, M.GLASS);
    }
    // 간판
    if (signs && f < signs) {
      const [txt, bg, fg] = SIGNS[b.rng.int(SIGNS.length)];
      const sy0 = f === 0 ? yb + 10 : yb + 9, sy1 = f === 0 ? slab - 1 : slab - 1;
      const sx0 = X + 3 + b.rng.int(4), sx1 = X + W - 4 - b.rng.int(4);
      b.fill(sx0, sy0, Z - 1, sx1, sy1, Z - 1, bg);
      const mask = textMask(txt, 11);
      if (mask) {
        const tw = mask[0].length, th = mask.length;
        const cx = Math.floor((sx0 + sx1) / 2 - tw / 2);
        const ty = Math.floor((sy0 + sy1) / 2 + th / 2);
        stampText(b, mask, cx, ty, Z - 2, 'x', 1, fg);
      }
    }
    // 실내 칸막이·가구
    const midX = X + colX[Math.floor(colX.length / 2)];
    b.fill(midX - 1, yb, Z + 2, midX - 1, slab - 3, Z + D - 3, M.PLASTER);
    b.clear(midX - 1, yb, Z + 10, midX - 1, yb + 7, Z + 13);
    for (let k = 0; k < 4; k++) {
      const fx = X + 4 + b.rng.int(W - 12), fz = Z + 4 + b.rng.int(D - 12);
      furniture(b, fx, yb, fz, f === 0 && signs ? (k % 2 ? 'shelf' : 'table') : (k % 2 ? 'desk' : 'shelf'));
    }
    yb = slab + 1;
  }
  // 계단실 코어
  if (core) {
    const cx0 = X + W - 14, cz0 = Z + D - 14;
    for (const { yb: y0, slab } of levels) {
      b.ring(cx0, y0, cz0, cx0 + 10, slab - 1, cz0 + 10, M.CONCRETE);
      b.clear(cx0 + 3, y0, cz0, cx0 + 6, y0 + 7, cz0);
    }
  }
  // 옥상: 난간, 물탱크, 실외기
  const roofY = yb;
  b.ring(X, roofY, Z, X + W - 1, roofY + 2, Z + D - 1, finish === M.PLASTER ? M.PAINT_CREAM : finish);
  b.fill(X + 6, roofY, Z + D - 12, X + 14, roofY + 6, Z + D - 5, M.TANK_BLUE);
  b.fill(X + W - 24, roofY, Z + 5, X + W - 21, roofY + 2, Z + 7, M.FURN_WHITE);
  b.fill(X + W - 18, roofY, Z + 5, X + W - 15, roofY + 2, Z + 7, M.FURN_WHITE);
  return b.done();
}

export function shop(b, X, Z) {
  return rcFrame(b, X, Z, { W: 56, D: 40, floors: 3, colX: [0, 18, 36, 54], colZ: [0, 19, 38], glassFront: true, signs: 2 });
}

export function office(b, X, Z) {
  return rcFrame(b, X, Z, { W: 72, D: 48, floors: 5, colX: [0, 23, 46, 70], colZ: [0, 23, 46], finish: M.PAINT_GRAY, accent: M.PAINT_GRAY, curtain: true, groundH: 14, FH: 14 });
}

// ───────────── 4. 공장 굴뚝 (벽돌 원통) ─────────────
export function chimney(b, CX, CZ) {
  const H = 106;
  b.fill(CX - 10, 0, CZ - 10, CX + 10, 0, CZ + 10, M.FOUNDATION);
  // 받침 기단
  b.fill(CX - 9, 1, CZ - 9, CX + 9, 8, CZ + 9, (x, y, z) => (Math.abs(x - CX) === 9 || Math.abs(z - CZ) === 9 || y === 8 ? M.BRICK_OLD : 0));
  b.clear(CX - 2, 1, CZ - 9, CX + 2, 6, CZ - 9);
  for (let y = 9; y < 9 + H; y++) {
    const t = (y - 9) / H;
    const R = 8.4 - t * 2.9;
    const Ri = R - 2.1;
    let m = brick(M.BRICK_OLD, M.BRICK);
    const band = y - 9;
    let bandM = 0;
    if (band >= H - 22) bandM = Math.floor((band - (H - 22)) / 5) % 2 === 0 ? M.STRIPE_WHITE : M.STRIPE_RED;
    for (let z = Math.floor(CZ - R - 1); z <= Math.ceil(CZ + R + 1); z++) for (let x = Math.floor(CX - R - 1); x <= Math.ceil(CX + R + 1); x++) {
      const d = Math.hypot(x + 0.5 - CX, z + 0.5 - CZ);
      if (d <= R && d >= Ri) b.put(x, y, z, bandM || m(x, y, z));
    }
    // 철 띠
    if (band % 24 === 12) for (let z = Math.floor(CZ - R - 1); z <= Math.ceil(CZ + R + 1); z++) for (let x = Math.floor(CX - R - 1); x <= Math.ceil(CX + R + 1); x++) {
      const d = Math.hypot(x + 0.5 - CX, z + 0.5 - CZ);
      if (d <= R && d > R - 1) b.put(x, y, z, M.STEEL_RUST);
    }
  }
  return b.done();
}

// 굴뚝 옆 작은 공장 (보호 대상)
export function factory(b, X, Z, W = 44, D = 30) {
  b.fill(X, 0, Z, X + W - 1, 0, Z + D - 1, M.FOUNDATION);
  b.fill(X, 1, Z, X + W - 1, 14, Z + D - 1, (x, y, z) => (x === X || x === X + W - 1 || z === Z || z === Z + D - 1 ? brick(M.BLOCK, M.PLASTER)(x, y, z) : 0));
  for (let k = 0; k < 4; k++) openings(b, X + 4 + k * 10, X + 9 + k * 10, 6, 10, Z, M.GLASS);
  // 톱날 지붕 (속이 찬 쐐기 모양이라 스스로 선다)
  for (let x = X; x < X + W; x++) {
    const t = (x - X) % 11;
    const top = 15 + Math.min(t, 7);
    for (let z = Z; z < Z + D; z++) for (let y = 15; y <= top; y++) b.put(x, y, z, t === 10 && y > 16 ? M.GLASS : y === top ? M.METAL_SHEET : M.METAL_RED);
  }
  return b.done();
}

// ───────────── 5. 급수탑 ─────────────
export function waterTower(b, X, Z) {
  const S = 24, LEG = 3, H = 64;
  b.fill(X - 2, 0, Z - 2, X + S + 1, 0, Z + S + 1, M.FOUNDATION);
  const legs = [[0, 0], [S - LEG, 0], [0, S - LEG], [S - LEG, S - LEG]];
  for (const [lx, lz] of legs) b.fill(X + lx, 1, Z + lz, X + lx + LEG - 1, H, Z + lz + LEG - 1, M.CONCRETE2);
  for (const yb of [22, 44]) {
    b.fill(X, yb, Z, X + S - 1, yb + 1, Z + 1, M.CONCRETE2); b.fill(X, yb, Z + S - 2, X + S - 1, yb + 1, Z + S - 1, M.CONCRETE2);
    b.fill(X, yb, Z, X + 1, yb + 1, Z + S - 1, M.CONCRETE2); b.fill(X + S - 2, yb, Z, X + S - 1, yb + 1, Z + S - 1, M.CONCRETE2);
  }
  // 물탱크
  const cx = X + S / 2, cz = Z + S / 2, R = 15;
  b.fill(X - 2, H + 1, Z - 2, X + S + 1, H + 2, Z + S + 1, (x, y, z) => (Math.hypot(x + 0.5 - cx, z + 0.5 - cz) <= R ? M.CONCRETE : 0));
  for (let y = H + 3; y <= H + 24; y++) for (let z = Math.floor(cz - R); z <= Math.ceil(cz + R); z++) for (let x = Math.floor(cx - R); x <= Math.ceil(cx + R); x++) {
    const d = Math.hypot(x + 0.5 - cx, z + 0.5 - cz);
    if (d <= R && d > R - 2) b.put(x, y, z, (y - H) % 8 === 0 ? M.PAINT_GRAY : M.TANK_BLUE);
  }
  for (let y = H + 25; y <= H + 31; y++) {
    const r = R - (y - H - 25) * 2.2;
    for (let z = Math.floor(cz - r); z <= Math.ceil(cz + r); z++) for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
      const d = Math.hypot(x + 0.5 - cx, z + 0.5 - cz);
      if (d <= r && d > r - 2.6) b.put(x, y, z, M.PAINT_GRAY);
    }
  }
  return b.done();
}

// ───────────── 6. 10층 아파트 (벽식 구조) ─────────────
export function apartment(b, X, Z, opts = {}) {
  const W = 112, D = 44, FH = 12, F = opts.floors || 10, BAL = 6;
  const back = Z + D - 1, front = Z + BAL;   // 발코니 안쪽 외벽
  b.fill(X, 0, Z, X + W - 1, 0, Z + D - 1, M.FOUNDATION);
  const walls = [0, 28, 56, 84, W - 1];
  for (let f = 0; f < F; f++) {
    const yb = 1 + f * FH, slab = yb + FH - 1;
    // 세대 경계벽 (내력벽)
    for (const wx of walls) b.fill(X + wx, yb, front, X + wx, slab - 1, back, f % 3 === 0 && (wx === 0 || wx === W - 1) ? M.PAINT_BLUE : M.PAINT_CREAM);
    // 앞뒤 외벽
    b.fill(X, yb, front, X + W - 1, slab - 1, front, M.CONCRETE);
    b.fill(X, yb, back, X + W - 1, slab - 1, back, M.PAINT_CREAM);
    // 슬래브 (발코니 포함)
    b.fill(X, slab, Z, X + W - 1, slab, Z + D - 1, M.CONCRETE);
    for (let u = 0; u < 4; u++) {
      const ux = X + walls[u];
      // 뒤 창
      openings(b, ux + 5, ux + 11, yb + 3, yb + 8, back, M.GLASS);
      openings(b, ux + 17, ux + 23, yb + 3, yb + 8, back, M.GLASS);
      // 거실 문 (발코니 쪽)
      b.clear(ux + 6, yb, front, ux + 21, yb + 8, front);
      // 발코니 난간 + 창
      b.fill(ux + 1, yb, Z, ux + 27, yb + 2, Z, M.PAINT_CREAM);
      openings(b, ux + 1, ux + 27, yb + 3, slab - 1, Z, M.GLASS);
      for (let k = ux + 1; k <= ux + 27; k += 9) b.fill(k, yb + 3, Z, k, slab - 1, Z, M.PAINT_GRAY);
      // 방 칸막이
      b.fill(ux + 14, yb, front + 14, ux + 14, slab - 1, back - 1, M.PLASTER);
      b.clear(ux + 14, yb, front + 20, ux + 14, yb + 7, front + 23);
      // 가구
      const r = b.rng.next();
      furniture(b, ux + 3, yb, front + 3, r < 0.5 ? 'sofa' : 'table');
      furniture(b, ux + 18, yb, back - 10, 'bed');
      if (b.rng.next() < 0.6) furniture(b, ux + 24, yb, front + 3, 'fridge');
    }
    // 발코니 옆 칸막이
    for (const wx of walls) b.fill(X + wx, yb, Z, X + wx, slab - 1, front, M.PAINT_CREAM);
  }
  // 계단실 (뒤쪽 가운데로 튀어나옴)
  const sx = X + 52;
  for (let f = 0; f < F; f++) {
    const yb = 1 + f * FH, slab = yb + FH - 1;
    b.ring(sx, yb, back, sx + 8, slab, back + 7, M.PAINT_CREAM);
    openings(b, sx + 3, sx + 5, yb + 5, yb + 8, back + 7, M.GLASS);
    b.fill(sx, slab, back, sx + 8, slab, back + 7, M.CONCRETE);
  }
  // 옥상
  const roofY = 1 + F * FH;
  b.ring(X, roofY, Z, X + W - 1, roofY + 2, Z + D - 1, M.PAINT_CREAM);
  b.fill(sx - 4, roofY, Z + 16, sx + 12, roofY + 9, Z + 30, (x, y, z) => (x === sx - 4 || x === sx + 12 || z === Z + 16 || z === Z + 30 || y === roofY + 9 ? M.PAINT_CREAM : 0));
  b.fill(sx - 2, roofY + 10, Z + 19, sx + 8, roofY + 15, Z + 27, M.TANK_BLUE);
  // 동 번호
  const label = opts.label || '101';
  const mask = textMask(label, 12);
  if (mask) {
    stampText(b, mask, X - 1, roofY - 4, Z + 30, 'z', -1, M.PAINT_BLUE, 2);
    stampText(b, mask, X + W, roofY - 4, Z + 14, 'z', 1, M.PAINT_BLUE, 2);
  }
  return b.done();
}

// ───────────── 거리 소품 ─────────────
export function car(b, X, Z, color, alongX = true) {
  const L = 17, Wd = 8;
  const P = (u, y, v, m) => (alongX ? b.put(X + u, y, Z + v, m) : b.put(X + v, y, Z + u, m));
  for (let u = 0; u < L; u++) for (let v = 0; v < Wd; v++) {
    for (let y = 1; y <= 3; y++) P(u, y, v, color);
    if (u >= 4 && u <= 12) for (let y = 4; y <= 5; y++) P(u, y, v, v === 0 || v === Wd - 1 || u === 4 || u === 12 ? M.CAR_GLASS : 0);
    if (u >= 5 && u <= 11) P(u, 6, v, color);
  }
  for (const u of [3, 13]) for (const v of [0, Wd - 1]) { P(u, 0, v, M.TIRE); P(u + 1, 0, v, M.TIRE); P(u, 1, v, M.TIRE); P(u + 1, 1, v, M.TIRE); }
  for (const u of [0, L - 1]) { P(u, 2, 1, M.SIGN_YELLOW); P(u, 2, Wd - 2, M.SIGN_YELLOW); }
  return b.done();
}

export function tree(b, X, Z) {
  const h = 10 + b.rng.int(4);
  b.fill(X, 0, Z, X + 1, h, Z + 1, M.TRUNK);
  const r = 5 + b.rng.next() * 1.5;
  const cy = h + 3;
  for (let y = Math.floor(cy - r); y <= cy + r; y++) for (let z = Math.floor(Z - r); z <= Z + 1 + r; z++) for (let x = Math.floor(X - r); x <= X + 1 + r; x++) {
    const d = Math.hypot(x - X - 0.5, (y - cy) * 1.2, z - Z - 0.5);
    if (d <= r && b.rng.next() < 0.92) b.put(x, y, z, b.rng.next() < 0.5 ? M.LEAF : M.LEAF2);
  }
  return b.done();
}

export function streetLight(b, X, Z, armDir = 1) {
  b.fill(X, 0, Z, X, 26, Z, M.STEEL);
  for (let k = 1; k <= 5; k++) b.put(X, 26, Z + k * armDir, M.STEEL);
  b.fill(X - 1, 26, Z + 5 * armDir, X + 1, 26, Z + 6 * armDir, M.SIGN_WHITE);
  return b.done();
}

export function siteOffice(b, X, Z) {
  b.fill(X, 0, Z, X + 23, 9, Z + 9, (x, y, z) => (y === 9 ? M.METAL_SHEET : x === X || x === X + 23 || z === Z || z === Z + 9 || y === 0 ? M.METAL_RED : 0));
  openings(b, X + 4, X + 9, 4, 7, Z, M.GLASS);
  openings(b, X + 14, X + 17, 1, 7, Z, M.WOOD_DARK);
  return b.done();
}

export function fenceRing(b, L, gate) {
  const H = 12;
  const m = (x, y, z) => (y >= 4 && y <= 5 ? M.FENCE_STRIPE : M.FENCE);
  for (let x = L.x0 - 1; x <= L.x1 + 1; x++) {
    if (!(x >= gate.x0 && x <= gate.x1)) for (let y = 0; y < H; y++) b.put(x, y, L.z0 - 1, m(x, y, L.z0 - 1));
    for (let y = 0; y < H; y++) b.put(x, y, L.z1 + 1, m(x, y, L.z1 + 1));
  }
  for (let z = L.z0 - 1; z <= L.z1 + 1; z++) for (let y = 0; y < H; y++) { b.put(L.x0 - 1, y, z, m(L.x0 - 1, y, z)); b.put(L.x1 + 1, y, z, m(L.x1 + 1, y, z)); }
  // 버팀 기둥
  for (let x = L.x0 - 1; x <= L.x1 + 1; x += 8) if (!(x >= gate.x0 && x <= gate.x1)) b.fill(x, 0, L.z0 - 2, x, H - 1, L.z0 - 2, M.STEEL);
  return b.done();
}
