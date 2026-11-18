// 현장 배치: 부지, 펜스, 철거 대상 건물, 이웃 건물, 도로 위 자동차와 가로수
import { SITE, GX, GZ } from './config.js';
import { M } from './materials.js';
import { Rng } from './util.js';
import * as G from './buildings/gen.js';

export const BUILDINGS = {
  warehouse:  { name: '낡은 창고', desc: '벽돌 벽에 철골 지붕. 쇠공 연습용.', floors: 1, height: 8 },
  house:      { name: '2층 단독주택', desc: '붉은 벽돌집. 바로 옆에 이웃집이 있다.', floors: 2, height: 9 },
  shop:       { name: '3층 상가', desc: '철근콘크리트 기둥·보 구조. 1층은 통유리.', floors: 3, height: 10 },
  office:     { name: '5층 사무실', desc: '커튼월 유리와 콘크리트 코어.', floors: 5, height: 18 },
  chimney:    { name: '공장 굴뚝', desc: '높이 29 m 벽돌 굴뚝. 정해진 방향으로 쓰러뜨려야 한다.', floors: 0, height: 29 },
  watertower: { name: '급수탑', desc: '네 다리 위 물탱크. 앞마당 쪽으로 넘어뜨린다.', floors: 0, height: 24 },
  apartment:  { name: '10층 아파트', desc: '벽식 구조 아파트. 양옆 건물을 지켜야 한다.', floors: 10, height: 31 },
};

const CAR_COLORS = [M.CAR_RED, M.CAR_WHITE, M.CAR_BLUE, M.CAR_BLACK, M.CAR_WHITE];

export function buildSite(sim, spec) {
  const w = sim.world;
  const rng = new Rng(spec.seed || 77);
  const L = SITE.lot;
  w.lotRect = { ...L };
  const owner = (name, kind) => w.addOwner({ name, kind });
  const B = (name, kind) => new G.Builder(w, owner(name, kind), rng);
  const out = { target: 0, neighbors: [], cars: [], props: [], zone: null, spawns: {}, lot: { ...L }, building: spec.building };

  // 펜스 (출입구는 앞쪽 가운데)
  const gate = { x0: 84, x1: 116 };
  G.fenceRing(B('가림막', 'fence'), L, gate);

  const tb = (name) => B(name, 'target');
  let t;
  switch (spec.building) {
    case 'warehouse': {
      const b = tb('창고'); G.warehouse(b, 64, 112); t = b;
      out.spawns = { crane: { x: 104, z: 66, heading: 0 }, excavator: { x: 58, z: 82, heading: 0 } };
      break;
    }
    case 'house': {
      const b = tb('단독주택'); G.house(b, 74, 118); t = b;
      out.spawns = { crane: { x: 108, z: 64, heading: 0 }, excavator: { x: 62, z: 84, heading: 0 } };
      break;
    }
    case 'shop': {
      const b = tb('상가'); G.shop(b, 68, 112); t = b;
      out.spawns = { crane: { x: 110, z: 62, heading: 0 }, excavator: { x: 70, z: 82, heading: 0 } };
      break;
    }
    case 'office': {
      const b = tb('사무실'); G.office(b, 60, 106); t = b;
      out.spawns = { crane: { x: 112, z: 58, heading: 0 }, excavator: { x: 64, z: 76, heading: 0 } };
      break;
    }
    case 'chimney': {
      const b = tb('굴뚝'); G.chimney(b, 41, 142); t = b;
      // 쓰러뜨릴 구역: +x 방향
      out.zone = { x0: 54, x1: 161, z0: 124, z1: 160, dir: [1, 0] };
      const f = B('보존할 공장', 'neighbor'); G.factory(f, 36, 60); out.neighbors.push(f.o);
      out.spawns = { crane: { x: 128, z: 70, heading: 0 }, excavator: { x: 96, z: 84, heading: -0.6 } };
      break;
    }
    case 'watertower': {
      const b = tb('급수탑'); G.waterTower(b, 84, 124); t = b;
      // 앞마당(-z) 쪽으로 쓰러뜨린다
      out.zone = { x0: 72, x1: 124, z0: 38, z1: 120, dir: [0, -1] };
      out.spawns = { crane: { x: 140, z: 70, heading: -0.5 }, excavator: { x: 50, z: 80, heading: 0.5 } };
      break;
    }
    case 'apartment': {
      const b = tb('아파트'); G.apartment(b, 40, 112, { label: spec.label || '101' }); t = b;
      out.spawns = { crane: { x: 112, z: 60, heading: 0 }, excavator: { x: 60, z: 80, heading: 0 } };
      break;
    }
    default: throw new Error('unknown building ' + spec.building);
  }
  out.target = t.o;
  if (out.zone) w.zoneRect = { ...out.zone };

  // 이웃 건물 (부지 밖 양옆·뒤)
  const nb = spec.neighbors ?? true;
  if (nb && spec.building !== 'chimney') {
    const left = B('왼쪽 이웃', 'neighbor');
    if (spec.building === 'apartment' || spec.building === 'office') G.rcFrame(left, 2, 104, { W: 26, D: 40, floors: 3, colX: [0, 12, 24], colZ: [0, 19, 38], finish: M.PAINT_GREEN, accent: M.PAINT_GRAY, signs: 1, core: false });
    else G.house(left, 3, 116, { w: 24, d: 30, brickA: M.BRICK, brickB: M.BRICK2, roof: M.ROOF_TILE });
    out.neighbors.push(left.o);
    const right = B('오른쪽 이웃', 'neighbor');
    if (spec.building === 'apartment' || spec.building === 'shop') G.rcFrame(right, 165, 100, { W: 26, D: 44, floors: 4, colX: [0, 12, 24], colZ: [0, 21, 42], finish: M.PAINT_PINK, accent: M.PAINT_GRAY, signs: 2, core: false });
    else G.house(right, 166, 112, { w: 24, d: 32, roof: M.ROOF_TILE });
    out.neighbors.push(right.o);
  }
  if (nb) {
    const backN = B('뒷집', 'neighbor');
    G.rcFrame(backN, 52, 170, { W: 64, D: 20, floors: 2, colX: [0, 21, 42, 62], colZ: [0, 18], finish: M.PAINT_ORANGE, accent: M.PAINT_GRAY, core: false });
    out.neighbors.push(backN.o);
  }

  // 도로 위 주차된 차
  const ncar = spec.cars ?? 4;
  const slots = [8, 40, 72, 124, 156];
  for (let k = 0; k < Math.min(ncar, slots.length); k++) {
    const c = B('주차 차량', 'car');
    G.car(c, slots[k] + rng.int(6), 14 + rng.int(3), CAR_COLORS[(k + rng.int(3)) % CAR_COLORS.length], true);
    out.cars.push(c.o);
  }
  // 가로수, 가로등
  for (const x of [20, 70, 130, 176]) { const p = B('가로수', 'prop'); G.tree(p, x, 29); out.props.push(p.o); }
  for (const x of [48, 150]) { const p = B('가로등', 'prop'); G.streetLight(p, x, 31, -1); out.props.push(p.o); }
  // 현장 사무실
  const so = B('현장 사무실', 'site');
  G.siteOffice(so, 34, 40);
  // 연석
  for (let x = 0; x < GX; x++) { w.put(x, 0, SITE.roadZ1, M.STONE, 0); }
  void GZ;
  return out;
}
