// ═══ 카카오 JavaScript 키 (developers.kakao.com → 앱 설정 → 플랫폼 키) ═══
// JS 키는 카카오 정책상 클라이언트(브라우저)에 노출되는 걸 전제로 설계된 키라 여기 그대로 둬도 된다.
// 단, 카카오 개발자 콘솔의 "플랫폼" 설정에 등록된 도메인에서만 동작한다.
const KAKAO_JS_KEY = '007161fdf290fc02876e272595e2cac3';

// ═══ Firebase 설정 (console.firebase.google.com → 프로젝트 설정 → 일반 → 내 앱) ═══
// apiKey는 Firebase 정책상 클라이언트에 노출되는 걸 전제로 한 값 — 실제 접근 제어는 Firestore 보안 규칙이 담당한다.
const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyBweygltLarPG2iikAS0zoQpw2i9Aef3ws',
  authDomain: 'kwansang-nb.firebaseapp.com',
  projectId: 'kwansang-nb',
  storageBucket: 'kwansang-nb.firebasestorage.app',
  messagingSenderId: '95025237525',
  appId: '1:95025237525:web:7e120a944aa5825466881c',
};

// 카카오 액세스 토큰 → Firebase 커스텀 토큰으로 바꿔주는 Cloud Function의 배포 URL.
// firebase deploy 이후 나오는 함수 URL을 여기 채워 넣으면 로그인↔프로필 저장 연동이 활성화된다.
const KAKAO_LOGIN_FUNCTION_URL = 'https://us-central1-kwansang-nb.cloudfunctions.net/kakaoLogin';

// ═══ Gemini 프록시 함수 URL (functions/index.js의 geminiProxy) ═══
// 진짜 Gemini API 키는 이제 이 파일에 없다 — Firebase Secret Manager에만 저장되고 Cloud Function
// 안에서만 쓰인다. 브라우저는 이 프록시 주소로만 요청하고, 응답을 Gemini 원본 형식 그대로 받는다.
// firebase deploy 이후 나오는 geminiProxy 함수 URL을 여기 채워 넣으면 AI 정밀 해석이 켜진다.
const GEMINI_PROXY_URL = 'https://us-central1-kwansang-nb.cloudfunctions.net/geminiProxy';

// ═══ 냥(포인트) 시스템 함수 URL (functions/index.js — 관상냥반_냥시스템_기획서.md v2.0) ═══
// firebase deploy 전까지는 비워두면 js/wallet.js가 차감 자체를 건너뛴다(로컬 UI 확인용) — 배포 후
// 아래 3개를 실제 함수 URL로 채워야 통합분석/궁합보기 진입 시 냥이 실제로 차감된다.
const NYANG_SPEND_FUNCTION_URL = 'https://us-central1-kwansang-nb.cloudfunctions.net/nyangSpend';
const NYANG_ADMIN_SEARCH_FUNCTION_URL = 'https://us-central1-kwansang-nb.cloudfunctions.net/adminSearchUsers';
const NYANG_ADMIN_GRANT_FUNCTION_URL = 'https://us-central1-kwansang-nb.cloudfunctions.net/adminGrantNyang';
// 냥 내역(지급·사용) 전체 조회 — CS 대응용 관리자 전용. ⚠️ 이 함수는 아직 배포 전이라,
// firebase deploy --only functions:adminNyangHistory 를 돌려야 내역 화면이 실제 데이터를 받아온다.
const NYANG_ADMIN_HISTORY_FUNCTION_URL = 'https://us-central1-kwansang-nb.cloudfunctions.net/adminNyangHistory';

// ═══ 16캐릭터 판정 / 궁합 함수 URL (2026-08-30 DB 이원화 1단계) ═══
// 판단 가중치·공식(functions/engine/*)이 브라우저에 노출되지 않도록 서버로 옮기면서 추가된 함수들.
// firebase deploy 후 아래 URL이 실제로 배포될 때까지는 js/character-api.js가 이 값들이 비어 있으면
// 에러를 그대로 사용자에게 보여준다(기존 프록시들과 달리 조용히 스킵하지 않음 — 캐릭터 판정은
// 화면의 핵심 기능이라 실패를 숨기면 안 됨).
const ANALYZE_CHARACTER_FUNCTION_URL = 'https://us-central1-kwansang-nb.cloudfunctions.net/analyzeCharacter';
const GET_COMPATIBILITY_FUNCTION_URL = 'https://us-central1-kwansang-nb.cloudfunctions.net/getCompatibility';

// ═══ 관상/캐릭터 콘텐츠 카탈로그 함수 URL (2026-08-30 DB 이원화 2단계) ═══
// archetype-db.js·character-db.js의 실제 콘텐츠(이름/설명/강점/약점 등)를 서버로 옮기면서 추가.
// 클라이언트는 세션당 한 번만 받아 캐시한다(js/character-api.js의 ensureArchetypeCatalog/ensureCharacterCatalog).
const GET_ARCHETYPE_CATALOG_FUNCTION_URL = 'https://us-central1-kwansang-nb.cloudfunctions.net/getArchetypeCatalog';
const GET_CHARACTER_CATALOG_FUNCTION_URL = 'https://us-central1-kwansang-nb.cloudfunctions.net/getCharacterCatalog';

// ═══ 인연도감 공유 미리보기 함수 URL (2026-09-04) ═══
// 카카오톡 등에 공유됐을 때 "관상냥반"이라는 고정 제목 대신 "{이름}님의 인연도감"이 뜨도록,
// js/inyeon-dogam.js shareUrl()이 실제 서비스 주소 대신 이 함수 주소를 공유 링크로 쓴다.
// firebase deploy 후 비어 있으면 shareUrl()이 예전처럼 서비스 주소를 그대로 쓴다(폴백).
const DOGAM_SHARE_PREVIEW_FUNCTION_URL = 'https://us-central1-kwansang-nb.cloudfunctions.net/dogamSharePreview';