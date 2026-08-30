// ═══ 16개 관상 캐릭터 DB — 서버 카탈로그 캐시 (2026-08-30 DB 이원화 2단계) ═══
// 실제 내용(캐릭터 이름·강점·약점·상황별 서술 등)은 functions/engine/character-db.js에만 있다.
// CHARACTER_DB는 처음엔 빈 객체이고, CharacterAPI.ensureCharacterCatalog()가 로그인 세션으로 서버에서
// 받아온 뒤 채워 넣는다 — 각 레코드에는 illustration(이미지 경로)·compatTags(good/spark/clash)도
// 서버가 미리 붙여서 내려준다. 렌더링 코드는 그대로 CHARACTER_DB[id]/getCharacterIllustration(id)/
// getCompatibilityTags(id)를 쓰면 되지만, 캐시가 채워지기 전에 읽으면 안 되므로 반드시 그 전에
// await CharacterAPI.ensureCharacterCatalog()가 끝나 있어야 한다.
const CHARACTER_DB = {};
const CHARACTER_ILLUSTRATION_FALLBACK = 'images/UIWON.png';
function getCharacterIllustration(characterId) {
  const c = CHARACTER_DB[characterId];
  return (c && c.illustration) || CHARACTER_ILLUSTRATION_FALLBACK;
}
function getCompatibilityTags(characterId) {
  const c = CHARACTER_DB[characterId];
  return c ? c.compatTags : null;
}
