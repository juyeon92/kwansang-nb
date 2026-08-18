// ═══ 사주 → 6D 기질 벡터 매핑 (기획서 §9~11) ═══
// app.js의 CG_OH(천간→오행)·computeOhaeng(오행 분포)·collectSajuInsightSummary(신살/귀인 목록)를
// 그대로 재사용하고, 여기서는 그 결과를 6대 기질 벡터로 변환하는 것만 담당한다.
// 오행 → 기질 매핑(§10)은 기획서 원문 값을 그대로 썼다. "전통 명리학의 절대 공식이 아니라 서비스
// 분류용 V1 초기 가중치"라는 기획서의 단서도 그대로 유효하다.
const OHAENG_TRAIT_VECTOR = {
  목: { lead: 0.10, strategy: 0.10, drive: 0.25, social: 0.10, stability: 0.10, sense: 0.35 },
  화: { lead: 0.15, strategy: 0.05, drive: 0.25, social: 0.30, stability: 0.05, sense: 0.20 },
  토: { lead: 0.10, strategy: 0.10, drive: 0.10, social: 0.15, stability: 0.45, sense: 0.10 },
  금: { lead: 0.25, strategy: 0.30, drive: 0.20, social: 0.05, stability: 0.15, sense: 0.05 },
  수: { lead: 0.05, strategy: 0.35, drive: 0.05, social: 0.15, stability: 0.10, sense: 0.30 },
};

// 기획서 §11 — 신살·귀인 보정. 항목당 최대 ±4, 전체 합 ±12(SAJU_MODIFIER_CAP_*, trait-config.js).
// 값은 app.js의 SIBISINSAL_MEANING/GWIIN_MEANING에 이미 서술된 의미를 그대로 기질로 옮긴 것 —
// 새로운 살/귀인 해석을 만들지 않고 기존 서비스가 이미 채택한 뜻풀이에서만 도출했다(기획서 §11 원칙).
// 약점 성격이 강한 항목(겁살·재살 등)도 "이 힘을 어떻게 쓰는가"의 긍정적 방향으로만 반영하고,
// 감점 용도로는 쓰지 않는다(기획서 §8과 동일한 원칙 — 약점은 여기서도 차감하지 않는다).
const SAJU_MODIFIER_DB = {
  // 십이신살(SIBISINSAL_MEANING 키와 동일)
  겁살:   { drive: 2, strategy: 1 },
  재살:   { stability: 2 },
  천살:   { stability: 2, strategy: 1 },
  지살:   { drive: 2, sense: 1 },
  년살:   { social: 3, sense: 1 },
  월살:   { stability: 2 },
  망신살: { sense: 1, social: 1 },
  장성살: { lead: 3, drive: 2 },
  반안살: { stability: 2, lead: 1 },
  역마살: { drive: 3, sense: 1 },
  육해살: { stability: 1 },
  화개살: { sense: 3, stability: 1 },
  // 귀인/기타(GWIIN_MEANING 키와 동일 — 고란살·현침살·과숙살·괴강살·백호대살도 이 목록에서 함께 온다)
  천을귀인: { stability: 3, social: 1 },
  태극귀인: { strategy: 3, stability: 1 },
  문곡귀인: { strategy: 3, sense: 1 },
  암록:     { stability: 2, social: 1 },
  학당귀인: { strategy: 3, sense: 1 },
  월덕귀인: { stability: 2, social: 2 },
  고란살:   { drive: 2, strategy: 1 },
  현침살:   { strategy: 3 },
  문창귀인: { sense: 2, strategy: 1 },
  천주귀인: { stability: 2, social: 1 },
  관귀학관: { lead: 2, stability: 1 },
  천의성:   { social: 3, stability: 1 },
  과숙살:   { drive: 1, strategy: 1 },
  천문성:   { sense: 3 },
  괴강살:   { lead: 3, drive: 1 },
  백호대살: { drive: 3, lead: 1 },
};
