// ═══ Firebase 초기화 (compat SDK — 빌드 단계 없는 정적 페이지 구조에 맞춤) ═══
(function () {
  if (typeof firebase === 'undefined') {
    console.error('Firebase SDK 로딩 실패');
    return;
  }
  firebase.initializeApp(FIREBASE_CONFIG);
  window.fbAuth = firebase.auth();
  window.fbDb = firebase.firestore();

  // 새로고침/재방문 시에도 로그인 상태가 유지되도록 명시적으로 LOCAL 지속성을 요청한다.
  // (기본값이 LOCAL이긴 하지만, 시크릿 모드 등 저장소 제약이 있는 환경에서 조용히 실패하는 경우를
  //  놓치지 않도록 성공/실패를 콘솔에 남긴다.)
  fbAuth.setPersistence(firebase.auth.Auth.Persistence.LOCAL)
    .then(() => console.log('[firebase] LOCAL 지속성 설정 완료'))
    .catch(e => console.error('[firebase] 지속성 설정 실패 — 새로고침 시 로그인이 풀릴 수 있음', e));
})();
