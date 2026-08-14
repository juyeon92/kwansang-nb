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
const FACE_CATEGORY_WEIGHT = {
  face_archetype: 20,  // 전체 얼굴 형상 9종
  eye_archetype: 15,   // 전통 눈 형상 13종
  face_shape: 10,      // 얼굴형 6종
  eye_shape: 10,       // 눈 크기·모양 8종
  eyebrow: 8,
  nose: 8,
  mouth: 7,
  chin: 7,
  forehead: 5,         // 측정 신뢰도가 낮아 가장 낮은 가중치로 둠(기존 코드의 isForeheadReliable()과 같은 맥락)
  part_status: 10,     // judgePartStatus(랜드마크 실측 11부위 strength/complement) — 보조 근거
};

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
const GUNJA_STDEV_MAX = 7.5;
const GUNJA_RANGE_MAX = 20;

// 기획서 §11 — 신살/귀인 보정 상한(항목당 ±4, 합계 ±12)
const SAJU_MODIFIER_CAP_PER_ITEM = 4;
const SAJU_MODIFIER_CAP_TOTAL = 12;

// 기획서 §18 — 동점(Top2 vs Top3 격차가 작을 때) 처리 우선순위. 값이 클수록 먼저 참고한다.
// "Confidence 높은 얼굴 Feature" → "전체 얼굴 형상" → "전통 눈 형상" → "세부 생김새" → "사주 점수" 순.
const TIEBREAK_PRIORITY = ['face_archetype', 'eye_archetype', 'face_shape', 'eye_shape', 'eyebrow', 'nose', 'mouth', 'chin', 'forehead', 'saju'];
const TIEBREAK_EPSILON = 3; // 이 점수차 미만이면 "거의 동일"로 보고 위 우선순위로 재결정
