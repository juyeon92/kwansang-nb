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