// ═══ 관상 유형 DB — 서버 카탈로그 캐시 (2026-08-30 DB 이원화 2단계) ═══
// 실제 내용(눈모양·동물형상 원문, 강점/약점 문구 등)은 functions/engine/archetype-db.js에만 있다.
// 여기 있는 객체들은 처음엔 비어 있다가, CharacterAPI.ensureArchetypeCatalog()가 로그인 세션으로
// 서버에서 받아온 뒤 채워 넣는 캐시일 뿐이다. 렌더링 코드(ai-analysis.js/app.js)는 그대로
// EYE_ARCHETYPE_DB[id] 식으로 읽으면 되지만, 캐시가 채워지기 전에 읽으면 빈 값이 나오므로 반드시
// 그 전에 await CharacterAPI.ensureArchetypeCatalog()가 끝나 있어야 한다(classifyAndBuildCharacter
// 참고 — 판정 흐름에서 이미 이 순서를 지키고 있다).
const EYE_ARCHETYPE_DB = {};
const FACE_ARCHETYPE_DB = {};
const FOREHEAD_TYPE_DB = {};
const EYEBROW_TYPE_DB = {};
const EYE_SHAPE_DB = {};
const NOSE_SHAPE_DB = {};
const MOUTH_SHAPE_DB = {};
const CHIN_SHAPE_DB = {};
const FACE_SHAPE_TYPE_DB = {};
const FACE_ARCHETYPE_EMOJI = {};
// eyeIconSVG(id)가 참조하는, 서버가 미리 렌더링해 내려준 SVG 문자열 캐시.
const EYE_ICON_SVG = {};
function eyeIconSVG(id) { return EYE_ICON_SVG[id] || ''; }
