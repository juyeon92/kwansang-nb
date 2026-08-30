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

const FACE_TRAIT_BASELINE = {
  lead:      { mean: 0.2430, stdev: 0.0763 },
  strategy:  { mean: 0.3869, stdev: 0.1246 },
  drive:     { mean: 0.2448, stdev: 0.1039 },
  social:    { mean: 0.1725, stdev: 0.0650 },
  stability: { mean: 0.3209, stdev: 0.0768 },
  sense:     { mean: 0.1051, stdev: 0.0419 },
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
