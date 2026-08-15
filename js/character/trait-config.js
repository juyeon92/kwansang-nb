// ═══ 16캐릭터 시스템 — 6대 기질 정의 & 엔진 상수 ═══
// 기존 관상/사주 기능과 완전히 별개인 신규 레이어(기획서 "Character Archetype System v1.0" §33·41).
// 여기 값들은 face-trait-map.js·saju-trait-map.js·character-engine.js가 공유하며, 가중치·임계값은
// 전부 "V1 초안"이라 실사용자 분포(§37 운영 데이터)가 쌓이면 재보정이 필요하다 — 기획서 원문 그대로 반영.
const TRAITS = ['lead', 'strategy', 'drive', 'social', 'stability', 'sense'];

const TRAIT_LABEL_KO = {
  lead: '주도력', strategy: '지략', drive: '실행력',
  social: '관계력', stability: '신뢰력', sense: '감각력',
};

// 기획서 §6 — 관상 데이터 카테고리별 기본 가중치(합계 100). face-trait-map.js의 FACE_TRAIT_MAP 키와 1:1 매칭.
//
// ⚠️ 2026-08-15 리스크2(이중 계산) 대응으로 재조정함 — as-is 값은 git 이력 참고.
// 문제: face_archetype/eye_archetype(구 가중치 합 35%)이 쓰는 원시 랜드마크 비율(lenR/jigakR/waJ/
// junduR/mouthR/cheekR 등)을 세부 카테고리 7개가 그대로 재사용하고 있어, 같은 얼굴 정보가 동물형상과
// 세부형상 양쪽에서 2~3중으로 카운트되고 있었음(같은 눈이 크고 둥글면 EYE_OX와 ES_BIG가 동시에
// 같은 방향 기질을 밀어올리는 식) → 특정 기질이 구조적으로 부풀어 리스크1(분포 쏠림)을 가속시킴.
// 해결: 동물형상 2종은 점수 드라이버가 아니라 "요약 라벨"(faceEvidence 근거·카피용)로 격하하고,
// 겹치지 않는 세부 카테고리와 독립 실측치(part_status)의 비중을 올림. 계산 로직(character-engine.js)은
// 전혀 건드리지 않음 — computeFaceTraitRaw가 감지된 카테고리 가중치 합으로 재정규화하는 기존 구조를
// 그대로 활용한 설정값 변경만으로 대응.
// ⚠️ part_status 키는 character-engine.js가 `FACE_CATEGORY_WEIGHT.part_status`로 직접 참조한다.
// 이 키를 지우면 그 값이 undefined가 되어 sums/totalWeight가 NaN으로 오염되고, 강점 부위가 하나라도
// 감지되는 사용자 전원의 6대 기질 점수가 깨진다 — 절대 삭제 금지, 개념상 "보조 근거"라는 주석과
// 별개로 코드 구현은 9개 카테고리와 동일한 가중합 방식이라는 점에 유의.
const FACE_CATEGORY_WEIGHT = {
  face_archetype: 5,   // 전체 얼굴 형상 9종 — 요약 라벨로 격하(구 20)
  eye_archetype: 5,    // 전통 눈 형상 13종 — 요약 라벨로 격하(구 15)
  face_shape: 14,      // 얼굴형 6종(구 10)
  eye_shape: 15,       // 눈 크기·모양 8종 — 겹침 없는 독자 지표(waJ/eyeTiltR/innerEyeGapR) 3종이라 최상위권(구 10)
  eyebrow: 11,         // 구 8
  nose: 11,            // 구 8
  mouth: 10,           // 구 7
  chin: 10,            // 구 7
  forehead: 6,         // 측정 신뢰도가 낮아 낮은 가중치 유지(구 5) — 헤어라인 랜드마크 1점뿐이라 M자/3자형
                        // 같은 곡률 기반 구분이 구조적으로 어려움(landmark-engine.js 참고). MediaPipe 마이그레이션은
                        // gwanR(이마 높이 비율) 버그를 고친 것이지 이 유형분류 지표 자체를 개선한 것이 아님.
  part_status: 13,     // judgePartStatus(랜드마크 실측 11부위 strength/complement) — 겹침 없는 독립 실측치라 상향(구 10)
};
// 합계 100 (5+5+14+15+11+11+10+10+6+13)

// 기획서 §7 — Feature Confidence 반영 기준. 규칙기반 분류기는 확률이 아니라 nearestSignatureMatch의
// 1위/2위 격차(margin)를 confidence로 대신 쓴다(landmark-engine.js의 nearestSignatureMatchWithConfidence).
const CONFIDENCE_FULL = 0.75;     // 이상 — 카테고리 가중치 100% 반영
const CONFIDENCE_PARTIAL = 0.55;  // ~0.74 — 70%만 반영
const CONFIDENCE_PARTIAL_RATIO = 0.7;
// 0.55 미만 — 캐릭터 판정에서 완전히 제외하고 남은 가중치를 재정규화(기획서 §41 규칙5)

// 기획서 §9 — 사주 파생 점수 내부 구성 비율(오행/일간/신살·귀인)
const SAJU_WEIGHT = { ohaeng: 0.70, dayMaster: 0.20, sinsalGwiin: 0.10 };

// 기획서 §12 — 관상×사주 최종 통합 비율(가진 데이터 조합에 따라 분기)
const FUSION_WEIGHT = {
  faceAndSajuWithHour: { face: 0.70, saju: 0.30 },
  faceAndSajuNoHour: { face: 0.75, saju: 0.25 },
  faceOnly: { face: 1.00, saju: 0 },
  sajuOnly: { face: 0, saju: 1.00 },
};

// 기획서 §17 — 균형형(군자상) 판정 조건. 이 두 임계값은 반드시 "정규화 전 원점수"(character-engine.js의
// raw trait score)에 적용해야 한다 — 화면 표시용으로 점수를 인위적으로 늘려 펼치면(예: 기존
// calcFaceOhaeng의 대비 강조 기법) 원래 고르게 나온 사람도 강제로 벌어져 버려 이 판정 자체가 무의미해진다.
// ⚠️ 2026-08-15 재보정: 리스크1 대응으로 z-score 정규화를 도입하면서 원래 값(7.5/20)을 그대로
// 쓰면 군자상 비율이 시뮬레이션(N=100,000) 기준 15.8%로 튀어 §17 목표(5~10%)를 벗어남 —
// 9개 카테고리를 고르게 정규화해 섞다 보니 평균 쪽으로 약간 수렴하는 효과가 생기기 때문(단,
// 이건 "인위적으로 좁힌 것"이 아니라 정규화의 자연스러운 부작용이라 임계값 쪽을 다시 맞추는 게
// 맞다 — 점수 자체를 왜곡하는 sharpening과는 다른 대응이다). 이분탐색으로 8.55%가 나오는
// 지점을 새 기준으로 채택. 실사용자 데이터가 쌓이면(§37) 이 값도 실측 분포로 재검증할 것.
const GUNJA_STDEV_MAX = 6.4;
const GUNJA_RANGE_MAX = 17;

// 기획서 §11 — 신살/귀인 보정 상한(항목당 ±4, 합계 ±12)
const SAJU_MODIFIER_CAP_PER_ITEM = 4;
const SAJU_MODIFIER_CAP_TOTAL = 12;

// 기획서 §18 — 동점(Top2 vs Top3 격차가 작을 때) 처리 우선순위. 값이 클수록 먼저 참고한다.
// "Confidence 높은 얼굴 Feature" → "전체 얼굴 형상" → "전통 눈 형상" → "세부 생김새" → "사주 점수" 순.
const TIEBREAK_PRIORITY = ['face_archetype', 'eye_archetype', 'face_shape', 'eye_shape', 'eyebrow', 'nose', 'mouth', 'chin', 'forehead', 'saju'];
const TIEBREAK_EPSILON = 3; // 이 점수차 미만이면 "거의 동일"로 보고 위 우선순위로 재결정

// ═══ 리스크1(분포 쏠림) 대응 — 관상/사주 원점수 baseline (z-score 정규화용) ═══
// 2026-08-15. 실사용자 데이터가 없는 런칭 전이라, 몬테카를로 시뮬레이션(N=200,000)으로 만든
// "이론적 baseline"이다 — face-trait-map.js의 69개 feature 벡터·saju-trait-map.js의 오행/신살
// 벡터를 그대로 쓰고, 각 카테고리는 균등분포(uniform prior)로 무작위 조합했을 때 나오는 raw
// trait score의 평균(mean)·표준편차(stdev)를 기질별로 구한 값이다(가정 상세는 시뮬레이션 스크립트
// 주석 참고). ⚠️ V1 근사치 — 실사용자 데이터가 쌓이면(§37) 이 값을 실측 평균/표준편차로 교체할 것.
// 그때도 정규화 로직(z-score) 자체는 안 바뀌고 이 상수만 교체하면 된다.
//
// 왜 필요한가: 관상 raw는 카테고리 가중치를 리스크2 대응으로 재조정한 뒤에도, feature 벡터
// 자체의 성향 때문에 drive/social/stability가 lead/strategy/sense보다 구조적으로 높게 나온다
// (시뮬레이션 결과 최대 약 40% 격차). 기질마다 서로 다른 baseline으로 정규화해야 이 쏠림이
// 실제로 교정된다 — 6개 기질에 동일한 min-max 선형변환을 걸면 상대적 격차가 그대로 보존되어
// 쏠림이 전혀 해소되지 않으므로 반드시 "기질별" 평균·표준편차를 써야 한다.
const FACE_TRAIT_BASELINE = {
  lead:      { mean: 0.2192, stdev: 0.0689 },
  strategy:  { mean: 0.2372, stdev: 0.0835 },
  drive:     { mean: 0.2997, stdev: 0.0856 },
  social:    { mean: 0.3161, stdev: 0.0999 },
  stability: { mean: 0.3086, stdev: 0.0791 },
  sense:     { mean: 0.2383, stdev: 0.0842 },
};
const SAJU_TRAIT_BASELINE = {
  lead:      { mean: 0.1240, stdev: 0.0242 },
  strategy:  { mean: 0.1738, stdev: 0.0408 },
  drive:     { mean: 0.1661, stdev: 0.0290 },
  social:    { mean: 0.1431, stdev: 0.0288 },
  stability: { mean: 0.1683, stdev: 0.0477 },
  sense:     { mean: 0.1897, stdev: 0.0379 },
};

// z-score → 화면/판정용 점수 변환(T-score 방식): score = T_SCORE_CENTER + z × T_SCORE_SPREAD.
// 평균(z=0)이 50점이 되고, ±1 표준편차가 ±15점이 되도록 하는 통상적인 변환 — 화면 표시를 위한
// 스케일 이동일 뿐, 값을 인위적으로 "펼치는" 대비 강조(calcFaceOhaeng류)와는 다르다(그 방식은
// 실제 분산을 왜곡하지만 이 변환은 선형이라 상대적 분산 구조를 그대로 보존한다).
const T_SCORE_CENTER = 50;
const T_SCORE_SPREAD = 15;
