// 전역 설정. 밸런스와 성능 수치는 대부분 여기서 조정한다.

export const VS = 0.25;            // 블록 한 칸 크기 (m). 작을수록 부서지는 조각이 많아진다.
export const GX = 192;             // 부지 가로 칸 수 (x) → 48 m
export const GZ = 192;             // 부지 세로 칸 수 (z) → 48 m
export const GY = 144;             // 최대 높이 칸 수 (y) → 36 m
export const CS = 16;              // 청크 크기 (칸)

export const SIM_HZ = 60;
export const SIM_DT = 1 / SIM_HZ;
export const GRAVITY = 9.81;

// 블록 1칸을 부수는 데 드는 기준 에너지 (J). 재질 인성(toughness)이 곱해진다.
export const E_UNIT = 2600;

// 구조 해석
export const DESIGN_RATIO = 0.32;  // 멀쩡한 건물의 가장 위험한 층 응력비 (낮을수록 튼튼)
export const WARN_RATIO = 0.62;    // 이 이상이면 균열·삐걱 소리로 붕괴를 예고
export const STRUCT_LOCAL_EVERY = 4;   // 국부 지지 검사 주기 (틱)
export const STRUCT_GLOBAL_EVERY = 12; // 전체 하중 검사 주기 (틱)

// 화면 품질 단계
export const QUALITY = {
  low:    { label: '낮음', pixelRatio: 1.0, shadows: false, shadowSize: 1024, particles: 900,  dust: 140, meshBudgetMs: 5, antialias: false },
  medium: { label: '보통', pixelRatio: 1.5, shadows: true,  shadowSize: 1024, particles: 1800, dust: 260, meshBudgetMs: 7, antialias: false },
  high:   { label: '높음', pixelRatio: 2.0, shadows: true,  shadowSize: 2048, particles: 3200, dust: 420, meshBudgetMs: 9, antialias: true },
};

// 부지 구획 (칸 단위). 도로는 z가 작은 쪽.
export const SITE = {
  roadZ1: 26,      // 도로 끝 (z < 26 → 도로)
  walkZ1: 34,      // 인도 끝
  lot: { x0: 30, x1: 162, z0: 36, z1: 166 },  // 철거 부지 (펜스 안쪽)
};

export const won = (n) => '₩' + Math.round(n).toLocaleString('ko-KR');
