// 블록 재질 표. 밀도(kg/m³), 압축 강도(상대값), 인성(부수는 데 드는 에너지 배수), 수평으로 버틸 수 있는 칸 수(span).
//  id 하위 6비트 = 재질, 64 = 잔해(구조물이 아님), 128 = 흘러내리는 잔해(모래처럼 미끄러짐)

export const RUBBLE = 64;
export const GRANULAR = 128;
export const BASE = 63;

// 소리·파편 분류
export const CLS = { concrete: 0, brick: 1, wood: 2, glass: 3, metal: 4, soft: 5, plant: 6 };

const defs = [];
function def(id, name, hex, cls, density, strength, toughness, span, extra = {}) {
  defs[id] = { id, name, hex, cls: CLS[cls], density, strength, toughness, span, ...extra };
}

export const M = {
  AIR: 0,
  CONCRETE: 1, CONCRETE2: 2, CONCRETE_CRACK: 3, FOUNDATION: 4,
  BRICK: 5, BRICK2: 6, BRICK_CRACK: 7, BLOCK: 8,
  PLASTER: 9, PAINT_CREAM: 10, PAINT_BLUE: 11, PAINT_GREEN: 12, PAINT_PINK: 13, PAINT_GRAY: 14,
  WOOD: 15, WOOD_DARK: 16,
  GLASS: 17, GLASS_DARK: 18,
  STEEL: 19, STEEL_RUST: 20, METAL_SHEET: 21, METAL_RED: 22,
  ROOF_TILE: 23, ROOF_RED: 24, TILE_FLOOR: 25,
  FURN_WOOD: 26, FURN_FABRIC: 27, FURN_WHITE: 28, FURN_DARK: 29,
  SIGN_RED: 30, SIGN_YELLOW: 31, SIGN_BLUE: 32, SIGN_WHITE: 33, SIGN_GREEN: 34,
  CAR_RED: 35, CAR_WHITE: 36, CAR_BLUE: 37, CAR_BLACK: 38, CAR_GLASS: 39, TIRE: 40,
  LEAF: 41, LEAF2: 42, TRUNK: 43,
  STRIPE_RED: 44, STRIPE_WHITE: 45, TANK_BLUE: 46, FENCE: 47, FENCE_STRIPE: 48,
  STONE: 49, BRICK_OLD: 50, PAINT_ORANGE: 51, TERRACOTTA: 52,
};

//  id                 이름            색상       분류        밀도  강도   인성   span
def(M.CONCRETE,       '콘크리트',     0x9b9a94, 'concrete', 2400, 1.00, 1.00, 26);
def(M.CONCRETE2,      '콘크리트 기둥', 0x8a8a86, 'concrete', 2400, 1.15, 1.25, 26);
def(M.CONCRETE_CRACK, '금 간 콘크리트', 0x6f6c66, 'concrete', 2400, 0.80, 0.70, 18);
def(M.FOUNDATION,     '기초',         0x77756e, 'concrete', 2400, 2.50, 3.50, 30);
def(M.BRICK,          '벽돌',         0xa3523a, 'brick',    1900, 0.55, 0.42, 8);
def(M.BRICK2,         '벽돌',         0x8f4532, 'brick',    1900, 0.55, 0.42, 8);
def(M.BRICK_CRACK,    '금 간 벽돌',    0x6e3426, 'brick',    1900, 0.40, 0.30, 6);
def(M.BLOCK,          '시멘트 블록',   0xb4ab98, 'brick',    1700, 0.50, 0.38, 8);
def(M.PLASTER,        '미장 벽',       0xe6dfcf, 'brick',    1600, 0.45, 0.33, 8);
def(M.PAINT_CREAM,    '도장 벽',       0xeadcb4, 'concrete', 2300, 0.95, 0.90, 24);
def(M.PAINT_BLUE,     '도장 벽',       0x6f93b8, 'concrete', 2300, 0.95, 0.90, 24);
def(M.PAINT_GREEN,    '도장 벽',       0x7fa58a, 'concrete', 2300, 0.95, 0.90, 24);
def(M.PAINT_PINK,     '도장 벽',       0xd9a5a0, 'concrete', 2300, 0.95, 0.90, 24);
def(M.PAINT_GRAY,     '도장 벽',       0xc9c8c2, 'concrete', 2300, 0.95, 0.90, 24);
def(M.WOOD,           '목재',         0x9c7444, 'wood',      650, 0.40, 0.26, 14);
def(M.WOOD_DARK,      '목재',         0x6b4a2b, 'wood',      650, 0.40, 0.26, 14);
def(M.GLASS,          '유리',         0x9fd3e6, 'glass',    2500, 0.03, 0.02, 3);
def(M.GLASS_DARK,     '색유리',        0x4f7f96, 'glass',    2500, 0.03, 0.02, 3);
def(M.STEEL,          '강철',         0x5c6670, 'metal',    7850, 4.00, 6.00, 44);
def(M.STEEL_RUST,     '녹슨 강철',     0x8a5a3c, 'metal',    7850, 3.00, 4.50, 40);
def(M.METAL_SHEET,    '철판',         0x9aa5ad, 'metal',    1200, 0.20, 0.30, 20);
def(M.METAL_RED,      '철판',         0xb0473b, 'metal',    1200, 0.20, 0.30, 20);
def(M.ROOF_TILE,      '기와',         0x4a5566, 'brick',    1800, 0.30, 0.22, 8);
def(M.ROOF_RED,       '지붕',         0xa34636, 'brick',    1800, 0.30, 0.22, 8);
def(M.TILE_FLOOR,     '바닥 타일',     0xc8bfa8, 'concrete', 2200, 0.90, 0.80, 24);
def(M.FURN_WOOD,      '가구',         0xa87b4f, 'wood',      500, 0.20, 0.10, 6);
def(M.FURN_FABRIC,    '소파',         0x8c3b46, 'soft',      300, 0.15, 0.08, 6);
def(M.FURN_WHITE,     '가전',         0xe9ecee, 'metal',     500, 0.20, 0.12, 6);
def(M.FURN_DARK,      '가구',         0x3d3f45, 'wood',      500, 0.20, 0.10, 6);
def(M.SIGN_RED,       '간판',         0xd8352a, 'metal',     800, 0.20, 0.10, 16);
def(M.SIGN_YELLOW,    '간판',         0xf2c230, 'metal',     800, 0.20, 0.10, 16);
def(M.SIGN_BLUE,      '간판',         0x2f6fd0, 'metal',     800, 0.20, 0.10, 16);
def(M.SIGN_WHITE,     '간판',         0xf4f1e8, 'metal',     800, 0.20, 0.10, 16);
def(M.SIGN_GREEN,     '간판',         0x2f9a5a, 'metal',     800, 0.20, 0.10, 16);
def(M.CAR_RED,        '자동차',        0xc23a32, 'metal',     900, 0.60, 0.35, 20);
def(M.CAR_WHITE,      '자동차',        0xe8eaea, 'metal',     900, 0.60, 0.35, 20);
def(M.CAR_BLUE,       '자동차',        0x2f5c9e, 'metal',     900, 0.60, 0.35, 20);
def(M.CAR_BLACK,      '자동차',        0x2a2d33, 'metal',     900, 0.60, 0.35, 20);
def(M.CAR_GLASS,      '차 유리',       0x5b7d8f, 'glass',    2500, 0.05, 0.03, 8);
def(M.TIRE,           '타이어',        0x1e1f22, 'soft',     1100, 0.60, 0.40, 8);
def(M.LEAF,           '나뭇잎',        0x5d8a3c, 'plant',     200, 0.10, 0.04, 14);
def(M.LEAF2,          '나뭇잎',        0x497a32, 'plant',     200, 0.10, 0.04, 14);
def(M.TRUNK,          '나무 줄기',     0x6b4f33, 'wood',      700, 0.80, 0.50, 6);
def(M.STRIPE_RED,     '굴뚝 띠',       0xc04434, 'brick',    1900, 0.60, 0.45, 8);
def(M.STRIPE_WHITE,   '굴뚝 띠',       0xe9e4da, 'brick',    1900, 0.60, 0.45, 8);
def(M.TANK_BLUE,      '물탱크',        0x4d86b0, 'concrete', 2300, 0.90, 0.85, 26);
def(M.FENCE,          '가림막',        0xdfe5e8, 'metal',     600, 0.30, 0.12, 30);
def(M.FENCE_STRIPE,   '가림막',        0x2b7bc0, 'metal',     600, 0.30, 0.12, 30);
def(M.STONE,          '석재',         0x8e8a80, 'concrete', 2600, 1.20, 1.30, 12);
def(M.BRICK_OLD,      '붉은 벽돌',     0x7d3b2c, 'brick',    1900, 0.60, 0.46, 8);
def(M.PAINT_ORANGE,   '도장 벽',       0xd98b4e, 'concrete', 2300, 0.95, 0.90, 24);
def(M.TERRACOTTA,     '외장 타일',     0xb86a4b, 'brick',    2000, 0.70, 0.50, 10);

export const MATS = defs;

// 빠른 조회용 배열 (256칸: 잔해 플래그 포함 id 그대로 색인)
export const DENSITY = new Float32Array(256);
export const STRENGTH = new Float32Array(256);
export const TOUGH = new Float32Array(256);
export const SPAN = new Uint8Array(256);
export const MCLS = new Uint8Array(256);
export const COLOR = new Float32Array(256 * 3);   // 선형이 아닌 sRGB 0..1

for (let id = 0; id < 256; id++) {
  const d = defs[id & BASE];
  if (!d || id === 0) continue;
  const rubble = (id & RUBBLE) !== 0;
  DENSITY[id] = d.density;
  STRENGTH[id] = rubble ? 0 : d.strength;
  TOUGH[id] = rubble ? d.toughness * 0.5 : d.toughness;
  SPAN[id] = d.span;
  MCLS[id] = d.cls;
  let r = ((d.hex >> 16) & 255) / 255, g = ((d.hex >> 8) & 255) / 255, b = (d.hex & 255) / 255;
  if (rubble) {
    // 잔해는 먼지를 뒤집어써서 어둡고 색이 빠진다
    const l = (r + g + b) / 3;
    const k = id & GRANULAR ? 0.78 : 0.86;
    r = (r * 0.7 + l * 0.3) * k; g = (g * 0.7 + l * 0.3) * k; b = (b * 0.7 + l * 0.3) * k;
  }
  COLOR[id * 3] = r; COLOR[id * 3 + 1] = g; COLOR[id * 3 + 2] = b;
}

export const isSolid = (m) => m !== 0;
export const isStruct = (m) => m !== 0 && (m & RUBBLE) === 0;
export const isRubble = (m) => (m & RUBBLE) !== 0;
export const toRubble = (m, granular = true) => (m & BASE) | RUBBLE | (granular ? GRANULAR : 0);

// 균열 재질로 바꾸기 (붕괴 예고 연출)
export function crackedOf(m) {
  const b = m & BASE;
  if (b === M.CONCRETE || b === M.CONCRETE2 || b === M.PAINT_CREAM || b === M.PAINT_BLUE || b === M.PAINT_GREEN ||
      b === M.PAINT_PINK || b === M.PAINT_GRAY || b === M.PAINT_ORANGE || b === M.TANK_BLUE) return M.CONCRETE_CRACK;
  if (b === M.BRICK || b === M.BRICK2 || b === M.BLOCK || b === M.PLASTER || b === M.BRICK_OLD ||
      b === M.STRIPE_RED || b === M.STRIPE_WHITE || b === M.TERRACOTTA) return M.BRICK_CRACK;
  return 0;
}

// 재활용 가치 (반출 시 kg당 원)
export const SCRAP_VALUE = { [CLS.concrete]: 6, [CLS.brick]: 4, [CLS.wood]: 3, [CLS.glass]: 2, [CLS.metal]: 180, [CLS.soft]: 0, [CLS.plant]: 0 };
