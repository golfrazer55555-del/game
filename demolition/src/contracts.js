// 철거 의뢰 목록과 점수 계산
import { won } from './config.js';

export const RATES = { crane: 32000, excavator: 26000 };   // 장비 가동비 (분당)
export const PENALTY = { neighborBlock: 4200, car: 3500000, outsideBlock: 900, overload: 600000 };

export const CONTRACTS = [
  {
    id: 'c1', title: '낡은 창고', building: 'warehouse', client: '한빛물류', fee: 9000000,
    machines: ['crane', 'excavator'], tutorial: 'crane', req: 0.85, time: 600, cars: 3,
    brief: '문 닫은 물류창고입니다. 벽돌이 약하니 쇠공으로 시원하게 부수세요. 굴착기로 마무리해도 됩니다.',
    goals: [{ k: 'demolish', v: 0.85 }],
  },
  {
    id: 'c2', title: '골목 단독주택', building: 'house', client: '김○○ 님', fee: 14000000,
    machines: ['crane', 'excavator'], req: 0.9, time: 720, cars: 4,
    brief: '양옆에 이웃집이 바짝 붙어 있습니다. 쇠공이 이웃집을 치지 않도록 줄 길이와 선회를 조심하세요.',
    goals: [{ k: 'demolish', v: 0.9 }, { k: 'neighbor', v: 0.01 }],
  },
  {
    id: 'c3', title: '3층 상가', building: 'shop', client: '새마을상가 조합', fee: 22000000,
    machines: ['excavator', 'crane'], tutorial: 'excavator', req: 0.9, time: 900, cars: 4, truck: true,
    brief: '철근콘크리트 기둥·보 구조입니다. 압쇄기로 위층부터 물어뜯고, 기둥은 브레이커로 쪼개세요. 도로 쪽 차량 피해 금지.',
    goals: [{ k: 'demolish', v: 0.9 }, { k: 'cars', v: 0 }, { k: 'outside', v: 400 }],
  },
  {
    id: 'c4', title: '공장 굴뚝', building: 'chimney', client: '대성제지', fee: 30000000,
    machines: ['blast', 'excavator'], tutorial: 'blast', req: 0.8, time: 600, cars: 2,
    brief: '굴뚝을 공장 반대편(오른쪽 노란 구역)으로 쓰러뜨려야 합니다. 쓰러질 쪽 밑동에 장약을 몰아 넣으세요. 공장 건물은 계속 씁니다.',
    goals: [{ k: 'demolish', v: 0.8 }, { k: 'zone', v: 0.6 }, { k: 'neighbor', v: 0.01 }],
  },
  {
    id: 'c5', title: '5층 사무실', building: 'office', client: '도시재생공사', fee: 42000000,
    machines: ['crane', 'excavator', 'blast'], req: 0.9, time: 1200, cars: 5, truck: true,
    brief: '유리 커튼월과 콘크리트 코어가 있는 사무실입니다. 장비와 발파를 섞어 가장 싸게 끝내 보세요.',
    goals: [{ k: 'demolish', v: 0.9 }, { k: 'neighbor', v: 0.02 }, { k: 'cars', v: 0 }],
  },
  {
    id: 'c6', title: '급수탑', building: 'watertower', client: '시 상수도사업소', fee: 34000000,
    machines: ['blast', 'crane'], req: 0.8, time: 600, cars: 3,
    brief: '물탱크가 무거운 급수탑입니다. 앞마당(노란 구역) 쪽 다리를 먼저 끊어 그쪽으로 넘어뜨리세요.',
    goals: [{ k: 'demolish', v: 0.8 }, { k: 'zone', v: 0.55 }],
  },
  {
    id: 'c7', title: '10층 아파트', building: 'apartment', client: '은행나무아파트 재건축조합', fee: 80000000,
    machines: ['blast', 'excavator', 'crane'], req: 0.9, time: 1500, cars: 5, truck: true,
    brief: '이번 공사의 하이라이트. 1층 내력벽에 장약을 넣고 지연 시간을 잘 짜서 제자리에 주저앉히세요. 양옆 건물이 무사해야 합니다.',
    goals: [{ k: 'demolish', v: 0.9 }, { k: 'neighbor', v: 0.02 }, { k: 'outside', v: 1500 }],
  },
];

export const FREE_SITES = ['warehouse', 'house', 'shop', 'office', 'chimney', 'watertower', 'apartment'];

const GOAL_TEXT = {
  demolish: (v) => `철거율 ${Math.round(v * 100)}% 이상`,
  neighbor: (v) => `이웃 건물 피해 ${Math.round(v * 100)}% 이하`,
  cars: () => '주차 차량 피해 없음',
  outside: (v) => `부지 밖 잔해 ${v}칸 이하`,
  zone: (v) => `목표 구역에 ${Math.round(v * 100)}% 이상 쓰러뜨리기`,
};
export const goalText = (g) => GOAL_TEXT[g.k](g.v);

// 현재 현장 상태 측정
export function measure(session) {
  const sim = session.sim, w = sim.world, L = session.layout;
  const t = w.owners[L.target];
  const standing0 = Math.max(1, t.initialStanding);
  const demolish = Math.max(0, Math.min(1, 1 - w.standing[L.target] / standing0));
  let nInit = 0, nLost = 0;
  for (const o of L.neighbors) { const info = w.owners[o]; nInit += info.initial; nLost += Math.max(0, info.initial - w.structCount[o]); }
  const neighbor = nInit ? nLost / nInit : 0;
  let cars = 0;
  for (const o of L.cars) { const info = w.owners[o]; if (info.initial - w.structCount[o] > info.initial * 0.04) cars++; }
  let outside = 0;
  for (let o = 0; o < w.owners.length; o++) outside += w.rubOut[o] + (sim.rubble.outsideBy[o] || 0);
  outside = Math.round(outside);
  const tgtRubble = w.rubTotal[L.target] + (sim.rubble.outsideBy[L.target] || 0);
  const zone = L.zone ? (tgtRubble > 50 ? w.rubZone[L.target] / tgtRubble : 0) : 0;
  return { demolish, neighbor, nLost, cars, outside, zone, time: sim.time };
}

export function goalMet(g, m) {
  switch (g.k) {
    case 'demolish': return m.demolish >= g.v;
    case 'neighbor': return m.neighbor <= g.v;
    case 'cars': return m.cars <= g.v;
    case 'outside': return m.outside <= g.v;
    case 'zone': return m.zone >= g.v;
  }
  return false;
}
export function goalValue(g, m) {
  switch (g.k) {
    case 'demolish': return Math.round(m.demolish * 100) + '%';
    case 'neighbor': return (m.neighbor * 100).toFixed(1) + '%';
    case 'cars': return m.cars + '대';
    case 'outside': return m.outside + '칸';
    case 'zone': return Math.round(m.zone * 100) + '%';
  }
  return '';
}

// 정산
export function settle(session) {
  const c = session.contract, m = measure(session);
  const lines = [];
  const fee = c.fee;
  lines.push(['계약금', fee]);
  const minutes = session.machineSeconds;
  let costs = 0;
  for (const [k, sec] of Object.entries(minutes)) {
    if (!sec) continue;
    const v = Math.round((sec / 60) * RATES[k]);
    costs += v;
    lines.push([k === 'crane' ? '크레인 가동비' : '굴착기 가동비', -v]);
  }
  if (session.explosives && session.explosives.cost) { costs += session.explosives.cost; lines.push([`장약 ${session.explosives.used}개`, -session.explosives.cost]); }
  let pen = 0;
  if (m.nLost > 0) { const v = Math.round(m.nLost * PENALTY.neighborBlock); pen += v; lines.push(['이웃 건물 배상', -v]); }
  if (m.cars) { const v = m.cars * PENALTY.car; pen += v; lines.push([`차량 배상 ${m.cars}대`, -v]); }
  if (m.outside > 0) { const v = Math.round(m.outside * PENALTY.outsideBlock); pen += v; lines.push(['부지 밖 잔해 청소', -v]); }
  const over = session.overloads();
  if (over) { const v = over * PENALTY.overload; pen += v; lines.push([`안전 위반(과부하) ${over}회`, -v]); }
  const scrap = session.truck ? Math.round(session.truck.s.value) : 0;
  if (scrap) lines.push([`고철·폐기물 판매 (${session.truck.s.trips}회 반출)`, scrap]);
  const met = c.goals.map((g) => goalMet(g, m));
  const success = met[0];
  const profit = (success ? fee : Math.round(fee * 0.15)) - costs - pen + scrap;
  if (!success) lines[0] = ['계약금 (미완료: 착수금만)', Math.round(fee * 0.15)];
  let stars = 0;
  if (success) {
    stars = 1;
    if (met.every(Boolean)) stars = 2;
    if (stars === 2 && profit >= fee * 0.55 && m.time <= c.time) stars = 3;
  }
  return { m, lines, profit, stars, success, met };
}

export { won };
