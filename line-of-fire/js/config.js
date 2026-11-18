// 게임 전역 설정값. 밸런스 조정은 대부분 이 파일에서 합니다.

export const W = 160;          // 맵 가로 (동서, x)
export const D = 80;           // 맵 세로 (남북, z)
export const H = 32;           // 최대 높이 (y)
export const CHUNK = 16;       // 메시 청크 크기
export const M_PER_UNIT = 4;   // 블록 1칸 = 4m (화면 표시용)

export const GRAVITY = 20;     // 중력 가속도 (칸/s²)
export const VMAX = 58;        // 장약 100일 때 포구 속도 (칸/s)
export const WIND_ACC = 0.22;  // 풍속 1m/s 당 포탄 가속도 (칸/s²)

export const TURN_TIME = 30;   // 플레이어 턴 제한 시간 (초)
export const MOVE_RANGE = 10;  // 턴당 이동 가능 거리 (칸)
export const TANK_HP = 100;
export const BLAST_RADIUS = 3.2;   // 지형 파괴 반경
export const DAMAGE_RADIUS = 5.5;  // 피해 반경
export const MAX_DAMAGE = 55;      // 중심 직격 피해
export const CHARGE_SPEED = 50;    // 장약 게이지 충전 속도 (초당)

export const DEG = Math.PI / 180;

export const DIFFICULTY = {
  easy:   { label: '훈련병', desc: '궤적 가이드 30% · 약한 바람', guide: 0.30, azErr: 7,   powErr: 9,   decay: 0.7,  windMax: 4 },
  normal: { label: '정규군', desc: '궤적 가이드 15% · 보통 바람', guide: 0.15, azErr: 5,   powErr: 6.5, decay: 0.62, windMax: 7 },
  hard:   { label: '베테랑', desc: '가이드 없음 · 강한 바람',     guide: 0,    azErr: 3.2, powErr: 4.5, decay: 0.5,  windMax: 10 },
};

// 블록 종류
export const V = {
  AIR: 0, GRASS: 1, GRASS2: 2, DIRT: 3, STONE: 4, BEDROCK: 5, WOOD: 6, LEAVES: 7,
  PINE: 8, BRICK: 9, PLASTER: 10, ROOF: 11, SAND: 12, METAL: 13, SCORCH: 14, ROAD: 15,
};

// 블록 색상 (2차대전 전장 톤)
export const PALETTE = {
  1: 0x6d7b3a,  // 풀
  2: 0x5c6a30,  // 짙은 풀
  3: 0x6e5236,  // 흙
  4: 0x77766c,  // 돌
  5: 0x34332f,  // 기반암
  6: 0x5a3d24,  // 나무 줄기
  7: 0x56702e,  // 활엽수 잎
  8: 0x2f4a2a,  // 침엽수 잎
  9: 0x8a4c38,  // 벽돌
  10: 0xb3a88e, // 회벽
  11: 0x6b3a2e, // 지붕
  12: 0xb19a68, // 모래주머니
  13: 0x3b3f42, // 강철 (대전차 장애물)
  14: 0x3a3127, // 그을린 흙
  15: 0x86714f, // 비포장 도로
};
