// ═══ 15캐릭터 시스템 — 6대 기질 정의 & 엔진 상수 (서버 전용) ═══
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

// GUNJA_STDEV_MAX / GUNJA_RANGE_MAX는 2026-09-03 군자상 제거와 함께 삭제했다 — 기질이 평평할 때
// 군자상으로 빼는 분기가 없어졌으므로 임계값도 쓰이지 않는다(character-engine.js determineCharacter).

const SAJU_MODIFIER_CAP_PER_ITEM = 4;
const SAJU_MODIFIER_CAP_TOTAL = 12;

const TIEBREAK_PRIORITY = ['face_archetype', 'eye_archetype', 'face_shape', 'eye_shape', 'eyebrow', 'nose', 'mouth', 'chin', 'forehead', 'saju'];
const TIEBREAK_EPSILON = 3;

// ⚠️ 2026-09-03 재계산 — 이전 값은 FACE_TRAIT_MAP이 실제로 만들어내는 분포와 크게 어긋나 있었고,
// 그 때문에 캐릭터 배정이 한쪽으로 심하게 쏠렸다.
//   · 감각력 mean 0.1051 (실제 0.2500) — z로 +3.46만큼 낮게 잡혀 있었다
//   · 관계력 mean 0.1725 (실제 0.3224) — z로 +2.31만큼 낮게
// 베이스라인이 실제보다 낮으면 그 기질의 z-score가 항상 높게 나온다. 하필 예인상이 관계력+감각력
// 조합이어서, 무작위 얼굴 2만 건 시뮬레이션에서 예인상이 66.9%를 독식하고 재상상·책사상·사신상·
// 선비상은 0%였다(4개 캐릭터가 아예 배정 불가). 재계산 후 최대 쏠림 11.2%, 0%인 캐릭터 0개.
//
// 계산 방식 — computeFaceTraitRaw의 가중평균을 그대로 따라 해석적으로 구한 값이다(몬테카를로 아님).
//   raw_t = [ Σ_c w_c·v_c[t] + w_ps·avg_ps[t] ] / (Σ_c w_c + w_ps),  가중치 합 100
//   · 9개 얼굴 카테고리: 각 카테고리에서 옵션 하나를 균등 확률로 고른다고 가정
//   · part_status: judgePartStatus(js/app.js)가 11개 부위 중 항상 Math.ceil(11/2)=6개를 'strength'로
//     표시하므로, C(11,6)=462개 부분집합을 전수 열거해 평균·분산을 정확히 구했다
//   각 항이 독립이라 E[raw]=Σw·E/W, Var[raw]=Σw²·Var/W² 로 닫힌 형태 계산이 가능하다.
//   재현 도구: scratch/baseline-recalc.html
//
// ⚠️ 남은 가정: "각 카테고리에서 옵션이 균등하게 나온다"는 전제다. 실제 사람 얼굴에서 특정 옵션이
//    훨씬 자주 판정된다면 이 값도 그만큼 치우친다. 실이용자 분포는 Firestore dogam/*/entries/*의
//    characterId를 집계하면 확인할 수 있고, 쏠림이 남아 있으면 이 값을 그 분포로 다시 잡아야 한다.
const FACE_TRAIT_BASELINE = {
  lead:      { mean: 0.2194, stdev: 0.0687 },
  strategy:  { mean: 0.2511, stdev: 0.0855 },
  drive:     { mean: 0.2845, stdev: 0.0843 },
  social:    { mean: 0.3224, stdev: 0.1002 },
  stability: { mean: 0.3209, stdev: 0.0806 },
  sense:     { mean: 0.2500, stdev: 0.0829 },
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
  SAJU_MODIFIER_CAP_PER_ITEM, SAJU_MODIFIER_CAP_TOTAL,
  TIEBREAK_PRIORITY, TIEBREAK_EPSILON,
  FACE_TRAIT_BASELINE, SAJU_TRAIT_BASELINE,
  T_SCORE_CENTER, T_SCORE_SPREAD,
};
