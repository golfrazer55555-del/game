// 앱 아이콘(PNG) 생성: 32×32 픽셀 그림을 크게 키운다. 외부 도구 없이 zlib로 PNG를 직접 만든다.
//   npm run icons
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const out = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'icons');
mkdirSync(out, { recursive: true });

const C = {
  bg: [22, 24, 28], bg2: [34, 37, 43], yel: [242, 183, 5], blk: [20, 20, 20], red: [216, 70, 43], wht: [233, 230, 223],
  brick: [163, 82, 58], brick2: [125, 59, 44], win: [159, 211, 230], ball: [52, 55, 60], ball2: [92, 96, 104], rope: [12, 12, 12], dust: [190, 180, 160],
};

function art() {
  const W = 32, px = Array.from({ length: W * W }, () => C.bg);
  const set = (x, y, c) => { if (x >= 0 && x < W && y >= 0 && y < W) px[y * W + x] = c; };
  // 하늘 쪽 살짝 밝게
  for (let y = 0; y < 26; y++) for (let x = 0; x < W; x++) if ((x + y) % 7 === 0 && y < 10) set(x, y, C.bg2);
  // 건물 (오른쪽), 왼쪽 위 모서리가 깨짐
  for (let y = 9; y < 27; y++) for (let x = 17; x < 29; x++) {
    const broken = x < 17 + Math.max(0, 7 - (y - 9)) && y < 16;
    if (broken) continue;
    set(x, y, ((x + (y % 2 ? 1 : 0)) % 4 === 0) ? C.brick2 : C.brick);
  }
  for (const [wx, wy] of [[24, 11], [20, 17], [24, 17], [20, 22], [24, 22]]) for (let y = 0; y < 3; y++) for (let x = 0; x < 2; x++) set(wx + x, wy + y, C.win);
  // 크레인 붐 (왼쪽 아래 → 위)
  for (let k = 0; k <= 22; k++) {
    const x = 2 + Math.round(k * 0.55), y = 27 - k;
    set(x, y, k % 3 === 0 ? C.wht : C.red);
    set(x + 1, y, C.red);
  }
  // 붐 끝 → 줄 → 쇠공
  const tipX = 14, tipY = 5;
  for (let y = tipY; y < 13; y++) set(tipX + Math.round((y - tipY) * 0.35), y, C.rope);
  const bx = 17, by = 14;
  for (let y = -3; y <= 3; y++) for (let x = -3; x <= 3; x++) if (x * x + y * y <= 9) set(bx + x, by + y, x + y < -1 ? C.ball2 : C.ball);
  // 파편
  for (const [x, y, c] of [[21, 7, C.brick], [23, 5, C.brick2], [20, 4, C.dust], [25, 8, C.brick], [22, 10, C.dust], [26, 4, C.brick], [19, 8, C.brick2]]) set(x, y, c);
  // 크레인 몸체
  for (let y = 24; y < 28; y++) for (let x = 0; x < 7; x++) set(x, y, y === 24 ? C.wht : C.red);
  // 바닥 경고 줄무늬
  for (let y = 28; y < 32; y++) for (let x = 0; x < W; x++) set(x, y, ((x + y) >> 1) % 2 ? C.yel : C.blk);
  return px;
}

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size, getPixel) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const [r, g, b] = getPixel(x, y);
      const o = y * (size * 4 + 1) + 1 + x * 4;
      raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; raw[o + 3] = 255;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

const A = art();
const plain = (size) => png(size, (x, y) => A[Math.floor(y * 32 / size) * 32 + Math.floor(x * 32 / size)]);
// 마스크 가능 아이콘: 가운데 80% 안에 그림, 바깥은 배경색
const maskable = (size) => png(size, (x, y) => {
  const m = size * 0.1, s = size * 0.8;
  const u = (x - m) / s, v = (y - m) / s;
  if (u < 0 || u >= 1 || v < 0 || v >= 1) return v >= 0.875 || y > size * 0.9 ? (((x + y) / (size / 16) | 0) % 2 ? C.yel : C.blk) : C.bg;
  return A[Math.floor(v * 32) * 32 + Math.floor(u * 32)];
});

writeFileSync(path.join(out, 'icon-192.png'), plain(192));
writeFileSync(path.join(out, 'icon-512.png'), plain(512));
writeFileSync(path.join(out, 'maskable-512.png'), maskable(512));
writeFileSync(path.join(out, 'apple-touch-icon.png'), plain(180));
console.log('아이콘 생성 완료:', out);
