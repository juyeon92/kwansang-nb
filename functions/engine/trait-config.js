// ═══ 16캐릭터 시스템 — 6대 기질 정의 & 엔진 상수 (서버 전용) ═══
// js/character/trait-config.js를 서버로 이전한 것 — 판단 가중치·임계값·baseline은 클라이언트에
// 절대 노출하지 않는다(2026-08-30 DB 이원화). TRAITS/TRAIT_LABEL_KO만 표시용으로 클라이언트에
// js/character/trait-labels.js라는 별도의 최소 사본으로 남아 있다 — 이 파일과 동기화 필요.
const TRAITS = ['lead', 'strategy', 'drive', 'social', 'stability', 'sense'];

const TRAIT_LABEL_KO = {
  lead: '주도력', strategy: '지략', drive: '실행력',
  social: '관계력', stability: '신뢰력', sense: '감각력',
};

const FACE_CATEGORY_WEIGHT = {
  face_archetype: 5,
  eye_archetype: 5,
  face_shape: 14,
  eye_shape: 15,
  eyebrow: 11,
  nose: 11,
  mouth: 10,
  chin: 10,
  forehead: 6,
  part_status: 13,
};

const CONFIDENCE_FULL = 0.75;
const CONFIDENCE_PARTIAL = 0.55;
const CONFIDENCE_PARTIAL_RATIO = 0.7;

const SAJU_WEIGHT = { ohaeng: 0.70, dayMaster: 0.20, sinsalGwiin: 0.10 };

const FUSION_WEIGHT = {
  faceAndSajuWithHour: { face: 0.70, saju: 0.30 },
  faceAndSajuNoHour: { face: 0.75, saju: 0.25 },
  faceOnly: { face: 1.00, saju: 0 },
  sajuOnly: { face: 0, saju: 1.00 },
};

const GUNJA_STDEV_MAX = 6.4;
const GUNJA_RANGE_MAX = 17;

const SAJU_MODIFIER_CAP_PER_ITEM = 4;
const SAJU_MODIFIER_CAP_TOTAL = 12;

const TIEBREAK_PRIORITY = ['face_archetype', 'eye_archetype', 'face_shape', 'eye_shape', 'eyebrow', 'nose', 'mouth', 'chin', 'forehead', 'saju'];
const TIEBREAK_EPSILON = 3;

// ⚠️ 2026-09-03 재도출 — js/landmark-engine.js의 이마/눈썹/눈크기/코/입/턱/얼굴형/동물상 8개 분류기를
// "목표값 최근접" 방식에서 "실측 백분위 매칭" 방식으로 전면 개편하면서 함께 다시 계산했다. 분류기
// 출력값이 통째로 바뀌었는데 이 baseline을 예전 그대로 두면, baseline 자체가 옛 분류기의 버그투성이
// 출력 분포에 맞춰져 있던 탓에 특정 트레잇(특히 관계력)으로 쏠리는 새 회귀가 생겼다(73장 시뮬레이션:
// 관계력 73장 중 53장=73%). 아래 값은 새 분류기 + confidence 배율 1.0(위 nearestSignatureMatchWithConfidencePct
// 주석 참고)으로 기획서/ 폴더 실사진 73장을 다시 돌려 나온 6개 트레잇 원점수(raw)의 평균/표준편차다 —
// "새 분류기가 실제로 뭘 내놓는지"에 baseline을 맞춘 것이라, 8개 분류기나 confidence 배율 중 하나라도
// 다시 바뀌면 이 값도 함께 재도출해야 한다. 결과 검증: 16캐릭터 전부 등장, 최대 쏠림 15.1%,
// 9개 카테고리 전부 confidence 미달인 사진 73장 중 1장(1.4%, 개편 전과 동일 수준).
const FACE_TRAIT_BASELINE = {
  lead:      { mean: 0.2224, stdev: 0.0888 },
  strategy:  { mean: 0.1966, stdev: 0.1066 },
  drive:     { mean: 0.2308, stdev: 0.1147 },
  social:    { mean: 0.2985, stdev: 0.1261 },
  stability: { mean: 0.2981, stdev: 0.1144 },
  sense:     { mean: 0.2159, stdev: 0.1433 },
};
const SAJU_TRAIT_BASELINE = {
  lead:      { mean: 0.1240, stdev: 0.0242 },
  strategy:  { mean: 0.1738, stdev: 0.0408 },
  drive:     { mean: 0.1661, stdev: 0.0290 },
  social:    { mean: 0.1431, stdev: 0.0288 },
  stability: { mean: 0.1683, stdev: 0.0477 },
  sense:     { mean: 0.1897, stdev: 0.0379 },
};

const T_SCORE_CENTER = 50;
const T_SCORE_SPREAD = 15;

module.exports = {
  TRAITS, TRAIT_LABEL_KO, FACE_CATEGORY_WEIGHT,
  CONFIDENCE_FULL, CONFIDENCE_PARTIAL, CONFIDENCE_PARTIAL_RATIO,
  SAJU_WEIGHT, FUSION_WEIGHT,
  GUNJA_STDEV_MAX, GUNJA_RANGE_MAX,
  SAJU_MODIFIER_CAP_PER_ITEM, SAJU_MODIFIER_CAP_TOTAL,
  TIEBREAK_PRIORITY, TIEBREAK_EPSILON,
  FACE_TRAIT_BASELINE, SAJU_TRAIT_BASELINE,
  T_SCORE_CENTER, T_SCORE_SPREAD,
};
