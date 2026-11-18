// 탐욕(greedy) 메시 생성: 같은 재질·같은 AO인 면을 크게 합쳐 삼각형 수를 줄인다.
// 블록 하나하나의 경계선과 밝기 차이는 셰이더가 위치로 다시 그려서 픽셀 블록 느낌은 유지된다.
import { COLOR } from './materials.js';
import { GX, GY, GZ } from './config.js';

const AOK = [0.52, 0.7, 0.85, 1.0];
const MAXQ = 16 * 16 * 16 * 3;
const sPos = new Float32Array(MAXQ * 4 * 3);
const sNor = new Int8Array(MAXQ * 4 * 3);
const sCol = new Uint8Array(MAXQ * 4 * 3);
const mask = new Int32Array(64 * 64);

// 패딩된 입력 버퍼 (최대 16+2 = 18 한 변)
export const PAD = 18;
export const padBuf = new Uint8Array(PAD * PAD * PAD);

function vao(s1, s2, c) { return s1 && s2 ? 0 : 3 - (s1 + s2 + c); }

/**
 * pad: (sx+2)×(sy+2)×(sz+2) 크기, 인덱스 = (x+1) + PX*((z+1) + PZ*(y+1))
 * ox,oy,oz: 출력 정점에 더할 블록 좌표 원점
 * 반환: { pos: Float32Array, nor: Int8Array, col: Uint8Array, idx: Uint16Array|Uint32Array } 또는 null
 */
export function meshPadded(pad, sx, sy, sz, ox, oy, oz) {
  const PX = sx + 2, PZ = sz + 2;
  const strideY = PX * PZ;
  const stride = [1, strideY, PX];
  const dims = [sx, sy, sz];
  let nq = 0;
  const c = [0, 0, 0];

  for (let a = 0; a < 3; a++) {
    for (let si = 0; si < 2; si++) {
      const s = si === 0 ? 1 : -1;
      let u = (a + 1) % 3, v = (a + 2) % 3;
      if (s < 0) { const t = u; u = v; v = t; }
      const DU = dims[u], DV = dims[v];
      const sa = stride[a] * s, su = stride[u], sv = stride[v];
      for (let d = 0; d < dims[a]; d++) {
        // 마스크 채우기
        let any = false;
        for (let iv = 0; iv < DV; iv++) {
          for (let iu = 0; iu < DU; iu++) {
            c[a] = d; c[u] = iu; c[v] = iv;
            const pi = (c[0] + 1) + PX * ((c[2] + 1) + PZ * (c[1] + 1));
            const m = pad[pi];
            let key = 0;
            if (m !== 0 && pad[pi + sa] === 0) {
              const q = pi + sa;
              const um = pad[q - su] ? 1 : 0, up = pad[q + su] ? 1 : 0, vm = pad[q - sv] ? 1 : 0, vp = pad[q + sv] ? 1 : 0;
              const a0 = vao(um, vm, pad[q - su - sv] ? 1 : 0);
              const a1 = vao(up, vm, pad[q + su - sv] ? 1 : 0);
              const a2 = vao(up, vp, pad[q + su + sv] ? 1 : 0);
              const a3 = vao(um, vp, pad[q - su + sv] ? 1 : 0);
              key = (m << 8) | a0 | (a1 << 2) | (a2 << 4) | (a3 << 6);
              any = true;
            }
            mask[iu + iv * DU] = key;
          }
        }
        if (!any) continue;
        // 탐욕 병합
        for (let iv = 0; iv < DV; iv++) {
          for (let iu = 0; iu < DU; iu++) {
            const k = mask[iu + iv * DU];
            if (!k) continue;
            const a0 = k & 3, a1 = (k >> 2) & 3, a2 = (k >> 4) & 3, a3 = (k >> 6) & 3;
            const canU = a0 === a1 && a3 === a2;
            const canV = a0 === a3 && a1 === a2;
            let w = 1;
            if (canU) while (iu + w < DU && mask[iu + w + iv * DU] === k) w++;
            let h = 1;
            if (canV) {
              outer: while (iv + h < DV) {
                const row = (iv + h) * DU;
                for (let t = 0; t < w; t++) if (mask[iu + t + row] !== k) break outer;
                h++;
              }
            }
            for (let hh = 0; hh < h; hh++) { const row = (iv + hh) * DU; for (let t = 0; t < w; t++) mask[iu + t + row] = 0; }
            if (nq >= MAXQ) continue;
            // 정점 4개
            const m = k >> 8;
            const base = nq * 12;
            const p0 = [0, 0, 0];
            p0[a] = d + (s > 0 ? 1 : 0); p0[u] = iu; p0[v] = iv;
            const U = [0, 0, 0], V = [0, 0, 0];
            U[u] = w; V[v] = h;
            const P = [p0, [p0[0] + U[0], p0[1] + U[1], p0[2] + U[2]], [p0[0] + U[0] + V[0], p0[1] + U[1] + V[1], p0[2] + U[2] + V[2]], [p0[0] + V[0], p0[1] + V[1], p0[2] + V[2]]];
            const ao = [a0, a1, a2, a3];
            const cr = COLOR[m * 3] * 255, cg = COLOR[m * 3 + 1] * 255, cb = COLOR[m * 3 + 2] * 255;
            for (let vtx = 0; vtx < 4; vtx++) {
              const o = base + vtx * 3;
              sPos[o] = P[vtx][0] + ox; sPos[o + 1] = P[vtx][1] + oy; sPos[o + 2] = P[vtx][2] + oz;
              sNor[o] = a === 0 ? s : 0; sNor[o + 1] = a === 1 ? s : 0; sNor[o + 2] = a === 2 ? s : 0;
              const f = AOK[ao[vtx]];
              sCol[o] = cr * f; sCol[o + 1] = cg * f; sCol[o + 2] = cb * f;
            }
            // 대각선 방향: AO 이방성 보정
            sFlip[nq] = a0 + a2 < a1 + a3 ? 1 : 0;
            nq++;
          }
        }
      }
    }
  }
  if (nq === 0) return null;
  const nv = nq * 4;
  const idx = nv > 65535 ? new Uint32Array(nq * 6) : new Uint16Array(nq * 6);
  for (let q = 0; q < nq; q++) {
    const b = q * 4, o = q * 6;
    if (sFlip[q]) { idx[o] = b + 1; idx[o + 1] = b + 2; idx[o + 2] = b + 3; idx[o + 3] = b + 1; idx[o + 4] = b + 3; idx[o + 5] = b; }
    else { idx[o] = b; idx[o + 1] = b + 1; idx[o + 2] = b + 2; idx[o + 3] = b; idx[o + 4] = b + 2; idx[o + 5] = b + 3; }
  }
  return { pos: sPos.slice(0, nv * 3), nor: sNor.slice(0, nv * 3), col: sCol.slice(0, nv * 3), idx, quads: nq };
}
const sFlip = new Uint8Array(MAXQ);

/**
 * 월드 청크 하나를 메시로. getter는 (x,y,z) → 재질 (y<0은 땅으로 간주해 아랫면을 숨김)
 */
export function meshWorldChunk(world, cx, cy, cz, CS) {
  const x0 = cx * CS, y0 = cy * CS, z0 = cz * CS;
  const P = CS + 2;
  const mat = world.mat;
  const GXw = GX, GZw = GZ, GYw = GY;
  for (let y = -1; y <= CS; y++) {
    const wy = y0 + y;
    for (let z = -1; z <= CS; z++) {
      const wz = z0 + z;
      let pi = 0 + P * ((z + 1) + P * (y + 1));
      for (let x = -1; x <= CS; x++, pi++) {
        const wx = x0 + x;
        let m = 0;
        if (wy < 0) m = 1;
        else if (wx >= 0 && wx < GXw && wz >= 0 && wz < GZw && wy < GYw) m = mat[wx + GXw * (wz + GZw * wy)];
        padBuf[pi] = m;
      }
    }
  }
  return meshPadded(padBuf, CS, CS, CS, x0, y0, z0);
}
