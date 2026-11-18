// 복셀 월드: 블록 저장, 청크 단위 변경 추적, 레이캐스트
import { GX, GY, GZ, CS, VS } from './config.js';
import { RUBBLE, GRANULAR, isStruct } from './materials.js';

export const LAYER = GX * GZ;
export const N = GX * GY * GZ;
export const NCX = GX / CS, NCY = GY / CS, NCZ = GZ / CS;
export const NCHUNK = NCX * NCY * NCZ;

export class World {
  constructor() {
    this.mat = new Uint8Array(N);      // 재질 id (0 = 빈칸)
    this.own = new Uint8Array(N);      // 소유 건물 번호 (점수·강도 보정용)
    this.chunkCount = new Uint16Array(NCHUNK);
    this.meshDirty = new Uint8Array(NCHUNK);
    this.meshDirtyList = [];
    this.colDirty = new Uint8Array(NCHUNK);
    this.colDirtyList = [];
    this.rubbleActive = new Set();     // 아래가 비었는지 확인해야 할 잔해 칸
    this.owners = [{ name: '잔해', kind: 'none' }];
    this.damage = { x0: GX, y0: GY, z0: GZ, x1: -1, y1: -1, z1: -1 }; // 마지막 구조 검사 이후 바뀐 범위
    this.dirtyOwners = new Set();
    this.structDirty = false;
    this.removedByOwner = new Float64Array(256);  // 부서진 구조 블록 수
    this.structCount = new Float64Array(256);     // 소유자별 남은 구조 블록
    this.standing = new Float64Array(256);        // 소유자별 1 m 이상 높이에 서 있는 구조 블록
    this.rubOut = new Float64Array(256);          // 부지 밖 잔해
    this.rubZone = new Float64Array(256);         // 목표 구역 안 잔해
    this.rubTotal = new Float64Array(256);
    this.lotRect = null;                          // {x0,x1,z0,z1} 칸 단위
    this.zoneRect = null;
    this.version = 0;
  }

  // 소유자별 집계 (sign = +1 추가, -1 제거)
  account(x, y, z, m, own, sign) {
    if (m === 0) return;
    if (m & RUBBLE) {
      this.rubTotal[own] += sign;
      const L = this.lotRect;
      if (L && (x < L.x0 || x > L.x1 || z < L.z0 || z > L.z1)) this.rubOut[own] += sign;
      const Z = this.zoneRect;
      if (Z && x >= Z.x0 && x <= Z.x1 && z >= Z.z0 && z <= Z.z1) this.rubZone[own] += sign;
    } else {
      this.structCount[own] += sign;
      if (y >= 4) this.standing[own] += sign;
    }
  }

  // 구조 검사를 다시 부르지 않는 겉모습 변경 (균열 표시)
  setSilent(i, m) {
    const old = this.mat[i];
    if (!old || !m || old === m) return;
    const x = i % GX, z = ((i / GX) | 0) % GZ, y = (i / LAYER) | 0;
    this.account(x, y, z, old, this.own[i], -1);
    this.mat[i] = m;
    this.account(x, y, z, m, this.own[i], 1);
    this.version++;
    const ci = this.chunkOf(x, y, z);
    // 메시만 갱신
    const lx = x & 15, ly = y & 15, lz = z & 15;
    if (lx > 0 && lx < 15 && ly > 0 && ly < 15 && lz > 0 && lz < 15) { if (!this.meshDirty[ci]) { this.meshDirty[ci] = 1; this.meshDirtyList.push(ci); } }
    else this.touchMeshOnly(x, y, z);
  }

  touchMeshOnly(x, y, z) {
    const cx0 = (x - 1) >> 4, cx1 = (x + 1) >> 4, cy0 = (y - 1) >> 4, cy1 = (y + 1) >> 4, cz0 = (z - 1) >> 4, cz1 = (z + 1) >> 4;
    for (let cy = Math.max(0, cy0); cy <= Math.min(NCY - 1, cy1); cy++) for (let cz = Math.max(0, cz0); cz <= Math.min(NCZ - 1, cz1); cz++) for (let cx = Math.max(0, cx0); cx <= Math.min(NCX - 1, cx1); cx++) {
      const c = cx + NCX * (cz + NCZ * cy);
      if (!this.meshDirty[c]) { this.meshDirty[c] = 1; this.meshDirtyList.push(c); }
    }
  }

  // ───── 좌표 ─────
  idx(x, y, z) { return x + GX * (z + GZ * y); }
  inside(x, y, z) { return x >= 0 && x < GX && y >= 0 && y < GY && z >= 0 && z < GZ; }
  get(x, y, z) { return x >= 0 && x < GX && y >= 0 && y < GY && z >= 0 && z < GZ ? this.mat[x + GX * (z + GZ * y)] : 0; }
  // 땅(y<0)까지 포함한 고체 판정
  solid(x, y, z) {
    if (y < 0) return true;
    if (x < 0 || x >= GX || z < 0 || z >= GZ || y >= GY) return false;
    return this.mat[x + GX * (z + GZ * y)] !== 0;
  }
  // 미터 좌표 고체 판정
  solidAtM(px, py, pz) {
    return this.solid(Math.floor(px / VS), Math.floor(py / VS), Math.floor(pz / VS));
  }

  addOwner(info) {
    this.owners.push({ initial: 0, ...info });
    return this.owners.length - 1;
  }

  // ───── 변경 ─────
  // 생성 단계용: 더티 표시 없이 기록 (끝나면 markAllDirty)
  put(x, y, z, m, owner = 0) {
    if (x < 0 || x >= GX || y < 0 || y >= GY || z < 0 || z >= GZ) return;
    const i = x + GX * (z + GZ * y);
    const old = this.mat[i];
    if (old === 0 && m !== 0) this.chunkCount[this.chunkOf(x, y, z)]++;
    else if (old !== 0 && m === 0) this.chunkCount[this.chunkOf(x, y, z)]--;
    this.account(x, y, z, old, this.own[i], -1);
    this.mat[i] = m;
    this.own[i] = m ? owner : 0;
    this.account(x, y, z, m, this.own[i], 1);
  }

  chunkOf(x, y, z) { return (x >> 4) + NCX * ((z >> 4) + NCZ * (y >> 4)); }

  set(i, m, owner) {
    if (m === 0) { this.remove(i); return; }
    const old = this.mat[i];
    if (old === m && (m === 0 || this.own[i] === owner)) return;
    const x = i % GX, z = ((i / GX) | 0) % GZ, y = (i / LAYER) | 0;
    const ci = this.chunkOf(x, y, z);
    if (old === 0 && m !== 0) this.chunkCount[ci]++;
    else if (old !== 0 && m === 0) this.chunkCount[ci]--;
    this.account(x, y, z, old, this.own[i], -1);
    this.mat[i] = m;
    this.own[i] = m ? owner : 0;
    this.account(x, y, z, m, this.own[i], 1);
    this.touch(x, y, z, ci);
    if ((old !== 0) !== (m !== 0) || isStruct(old) !== isStruct(m)) this.noteStructChange(x, y, z, old, i);
  }

  // 블록 제거. 위에 얹힌 잔해를 깨우고 구조 검사 범위에 넣는다.
  remove(i) {
    const old = this.mat[i];
    if (old === 0) return 0;
    const x = i % GX, z = ((i / GX) | 0) % GZ, y = (i / LAYER) | 0;
    const ci = this.chunkOf(x, y, z);
    this.chunkCount[ci]--;
    this.mat[i] = 0;
    const own = this.own[i];
    this.own[i] = 0;
    this.account(x, y, z, old, own, -1);
    this.touch(x, y, z, ci);
    if (isStruct(old)) this.removedByOwner[own]++;
    this.noteStructChange(x, y, z, old, i, own);
    this.wakeAbove(x, y, z);
    return old;
  }

  wakeAbove(x, y, z) {
    if (y + 1 >= GY) return;
    const up = x + GX * (z + GZ * (y + 1));
    if (this.mat[up] & RUBBLE) this.rubbleActive.add(up);
    // 대각선 위의 흘러내리는 잔해도 굴러떨어질 수 있다
    if (x > 0 && (this.mat[up - 1] & GRANULAR)) this.rubbleActive.add(up - 1);
    if (x < GX - 1 && (this.mat[up + 1] & GRANULAR)) this.rubbleActive.add(up + 1);
    if (z > 0 && (this.mat[up - GX] & GRANULAR)) this.rubbleActive.add(up - GX);
    if (z < GZ - 1 && (this.mat[up + GX] & GRANULAR)) this.rubbleActive.add(up + GX);
  }

  noteStructChange(x, y, z, old, i, own = this.own[i]) {
    if (!isStruct(old) && !isStruct(this.mat[i])) return;
    const d = this.damage;
    if (x < d.x0) d.x0 = x; if (x > d.x1) d.x1 = x;
    if (y < d.y0) d.y0 = y; if (y > d.y1) d.y1 = y;
    if (z < d.z0) d.z0 = z; if (z > d.z1) d.z1 = z;
    this.structDirty = true;
    if (own) this.dirtyOwners.add(own);
  }

  takeDamageBox() {
    const d = this.damage;
    if (d.x1 < 0) return null;
    const box = { ...d };
    d.x0 = GX; d.y0 = GY; d.z0 = GZ; d.x1 = -1; d.y1 = -1; d.z1 = -1;
    return box;
  }

  // 메시(면·AO는 이웃 칸도 보므로 경계 청크 포함)와 충돌체 갱신 표시
  touch(x, y, z, ci) {
    this.version++;
    if (!this.colDirty[ci]) { this.colDirty[ci] = 1; this.colDirtyList.push(ci); }
    const lx = x & 15, ly = y & 15, lz = z & 15;
    if (lx > 0 && lx < 15 && ly > 0 && ly < 15 && lz > 0 && lz < 15) {
      if (!this.meshDirty[ci]) { this.meshDirty[ci] = 1; this.meshDirtyList.push(ci); }
      return;
    }
    const cx0 = (x - 1) >> 4, cx1 = (x + 1) >> 4, cy0 = (y - 1) >> 4, cy1 = (y + 1) >> 4, cz0 = (z - 1) >> 4, cz1 = (z + 1) >> 4;
    for (let cy = cy0; cy <= cy1; cy++) {
      if (cy < 0 || cy >= NCY) continue;
      for (let cz = cz0; cz <= cz1; cz++) {
        if (cz < 0 || cz >= NCZ) continue;
        for (let cx = cx0; cx <= cx1; cx++) {
          if (cx < 0 || cx >= NCX) continue;
          const c = cx + NCX * (cz + NCZ * cy);
          if (!this.meshDirty[c]) { this.meshDirty[c] = 1; this.meshDirtyList.push(c); }
        }
      }
    }
  }

  markAllDirty() {
    for (let c = 0; c < NCHUNK; c++) {
      if (!this.meshDirty[c]) { this.meshDirty[c] = 1; this.meshDirtyList.push(c); }
      if (!this.colDirty[c]) { this.colDirty[c] = 1; this.colDirtyList.push(c); }
    }
  }

  clear() {
    this.mat.fill(0);
    this.own.fill(0);
    this.chunkCount.fill(0);
    this.rubbleActive.clear();
    this.owners = [{ name: '잔해', kind: 'none' }];
    this.removedByOwner.fill(0);
    for (const a of [this.structCount, this.standing, this.rubOut, this.rubZone, this.rubTotal]) a.fill(0);
    this.lotRect = null; this.zoneRect = null;
    this.dirtyOwners.clear();
    this.structDirty = false;
    this.takeDamageBox();
    this.markAllDirty();
  }

  // 각 소유자의 초기 구조 블록 수 기록
  countOwners() {
    const cnt = new Float64Array(256);
    const mat = this.mat, own = this.own;
    for (let i = 0; i < N; i++) if (mat[i] && !(mat[i] & RUBBLE)) cnt[own[i]]++;
    for (let o = 1; o < this.owners.length; o++) { this.owners[o].initial = cnt[o]; this.owners[o].initialStanding = this.standing[o]; }
    this.removedByOwner.fill(0);
    return cnt;
  }

  // ───── 레이캐스트 (미터 단위 입력, 복셀 DDA) ─────
  raycast(ox, oy, oz, dx, dy, dz, maxDist, pred = (m) => m !== 0) {
    const inv = 1 / VS;
    let x = Math.floor(ox * inv), y = Math.floor(oy * inv), z = Math.floor(oz * inv);
    const sx = dx > 0 ? 1 : -1, sy = dy > 0 ? 1 : -1, sz = dz > 0 ? 1 : -1;
    const tdx = Math.abs(VS / (dx || 1e-9)), tdy = Math.abs(VS / (dy || 1e-9)), tdz = Math.abs(VS / (dz || 1e-9));
    const fx = ox * inv - x, fy = oy * inv - y, fz = oz * inv - z;
    let tx = (dx > 0 ? 1 - fx : fx) * tdx, ty = (dy > 0 ? 1 - fy : fy) * tdy, tz = (dz > 0 ? 1 - fz : fz) * tdz;
    let t = 0, nx = 0, ny = 0, nz = 0;
    for (let k = 0; k < 2000 && t <= maxDist; k++) {
      if (y < 0) return { x, y: -1, z, i: -1, nx, ny, nz, t, ground: true };
      if (this.inside(x, y, z)) {
        const i = x + GX * (z + GZ * y);
        const m = this.mat[i];
        if (m && pred(m)) return { x, y, z, i, nx, ny, nz, t, ground: false };
      } else if ((x < -2 && sx < 0) || (x > GX + 1 && sx > 0) || (z < -2 && sz < 0) || (z > GZ + 1 && sz > 0) || (y > GY + 1 && sy > 0)) {
        // 바깥으로 나가는 중이면 땅만 확인
        if (dy < 0) { const tg = -oy / dy; if (tg <= maxDist) return { x: Math.floor((ox + dx * tg) * inv), y: -1, z: Math.floor((oz + dz * tg) * inv), i: -1, nx: 0, ny: 1, nz: 0, t: tg, ground: true }; }
        return null;
      }
      if (tx < ty && tx < tz) { x += sx; t = tx; tx += tdx; nx = -sx; ny = 0; nz = 0; }
      else if (ty < tz) { y += sy; t = ty; ty += tdy; nx = 0; ny = -sy; nz = 0; }
      else { z += sz; t = tz; tz += tdz; nx = 0; ny = 0; nz = -sz; }
    }
    return null;
  }

  // (x,z) 열의 가장 높은 고체 칸 윗면 (칸 단위). maxY 아래에서 찾는다.
  topAt(x, z, maxY = GY) {
    if (x < 0 || x >= GX || z < 0 || z >= GZ) return 0;
    for (let y = Math.min(GY, maxY) - 1; y >= 0; y--) if (this.mat[x + GX * (z + GZ * y)]) return y + 1;
    return 0;
  }

  snapshot() {
    return { mat: this.mat.slice(), own: this.own.slice(), chunkCount: this.chunkCount.slice(), rubble: [...this.rubbleActive],
      removed: this.removedByOwner.slice(), damage: { ...this.damage }, dirtyOwners: [...this.dirtyOwners], structDirty: this.structDirty,
      counts: [this.structCount, this.standing, this.rubOut, this.rubZone, this.rubTotal].map((a) => a.slice()) };
  }
  restore(s) {
    this.mat.set(s.mat); this.own.set(s.own); this.chunkCount.set(s.chunkCount);
    this.rubbleActive = new Set(s.rubble);
    this.removedByOwner.set(s.removed);
    Object.assign(this.damage, s.damage);
    this.dirtyOwners = new Set(s.dirtyOwners);
    this.structDirty = s.structDirty;
    [this.structCount, this.standing, this.rubOut, this.rubZone, this.rubTotal].forEach((a, k) => a.set(s.counts[k]));
    this.markAllDirty();
  }
}
