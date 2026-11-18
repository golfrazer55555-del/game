// 진행 저장 (이 기기의 브라우저에만 저장됨)
const KEY = 'demolition-king-v1';

export const UPGRADES = [
  { id: 'ball2', group: 'ball', level: 1, name: '2톤 쇠공', desc: '더 무거운 쇠공. 같은 속도로 두 배 부순다.', price: 4000000 },
  { id: 'ball3', group: 'ball', level: 2, name: '3.5톤 쇠공', desc: '최대 크기 쇠공. 콘크리트 기둥도 한 방에 금이 간다.', price: 9500000, needs: 'ball2' },
  { id: 'boom2', group: 'boom', level: 1, name: '크레인 붐 34 m', desc: '더 높은 층까지 닿는다.', price: 5000000 },
  { id: 'boom3', group: 'boom', level: 2, name: '크레인 붐 40 m', desc: '10층 아파트 꼭대기까지.', price: 10000000, needs: 'boom2' },
  { id: 'long', group: 'longarm', level: 1, name: '굴착기 롱붐(하이리치)', desc: '팔 길이 약 20 m. 5~6층 높이까지 물어뜯는다.', price: 8000000 },
  { id: 'power', group: 'power', level: 1, name: '압쇄기·브레이커 강화', desc: '유압을 올려 부수는 속도 1.6배.', price: 6000000 },
  { id: 'bigcharge', group: 'charge', level: 1, name: '대형 장약 사용 허가', desc: '두꺼운 내력벽도 한 번에 끊는 큰 장약.', price: 5000000 },
];

const DEFAULT = {
  money: 5000000,
  stars: {},
  owned: [],
  settings: { quality: 'auto', volume: 0.8, haptics: true, iso: false, shake: true, touch: 'auto', invertCam: false },
  stats: { blocks: 0, contracts: 0 },
};

export function loadSave() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return structuredClone(DEFAULT);
    const d = JSON.parse(raw);
    return { ...structuredClone(DEFAULT), ...d, settings: { ...DEFAULT.settings, ...(d.settings || {}) }, stats: { ...DEFAULT.stats, ...(d.stats || {}) } };
  } catch {
    return structuredClone(DEFAULT);
  }
}

export function writeSave(s) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* 저장 불가 (사생활 보호 모드 등) */ }
}

export function owns(save, id) { return save.owned.includes(id); }
export function level(save, group) {
  let lv = 0;
  for (const u of UPGRADES) if (u.group === group && save.owned.includes(u.id)) lv = Math.max(lv, u.level);
  return lv;
}

export function resetSave() { try { localStorage.removeItem(KEY); } catch { /* */ } return structuredClone(DEFAULT); }
