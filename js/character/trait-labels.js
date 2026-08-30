// ═══ 6대 기질 — 표시용 최소 상수 (2026-08-30 DB 이원화 1단계) ═══
// 원래 이 파일 자리에 있던 js/character/trait-config.js는 가중치·임계값·baseline까지 포함하고 있어
// 판단 알고리즘 자체가 소스에 노출되는 문제가 있었다 — 그래서 계산에 쓰이는 값(가중치·baseline 등)은
// functions/engine/trait-config.js로 옮기고, 화면 표시에만 쓰는 TRAITS(6개 키)·TRAIT_LABEL_KO(한글
// 라벨)만 여기 남긴다. 이 값을 바꾸면 서버 사본도 같이 바꿔야 한다.
const TRAITS = ['lead', 'strategy', 'drive', 'social', 'stability', 'sense'];

const TRAIT_LABEL_KO = {
  lead: '주도력', strategy: '지략', drive: '실행력',
  social: '관계력', stability: '신뢰력', sense: '감각력',
};
