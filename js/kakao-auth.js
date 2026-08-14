// ═══ 카카오 로그인 ═══
// 카카오 로그인 → 액세스 토큰을 Cloud Function(KAKAO_LOGIN_FUNCTION_URL)에 보내 검증받고
// Firebase 커스텀 토큰을 돌려받아 Firebase Auth에 로그인 → Firestore에 저장된 프로필을 불러온다.
// KAKAO_LOGIN_FUNCTION_URL이 비어있으면(Cloud Function 배포 전) 닉네임 표시까지만 동작한다.
//
// Firebase Auth 세션 자체는 브라우저에 자동으로 유지되지만, 새로고침 시 그 상태를 확인하지 않으면
// 화면은 매번 "로그아웃"으로 보인다 — onAuthStateChanged로 새로고침 후에도 로그인 상태를 복원한다.
(function () {
  let currentUser = null;
  const NICKNAME_KEY_PREFIX = 'kakaoAuthNickname:';

  function init() {
    if (window.Kakao && !Kakao.isInitialized()) {
      Kakao.init(KAKAO_JS_KEY);
    }
    if (!window.fbAuth) { renderLoggedOut(); return; }
    // 최초 호출(페이지 로드 시 세션 복원 여부)과 이후 모든 로그인/로그아웃 변화를 여기 한 곳에서 처리한다.
    fbAuth.onAuthStateChanged(function (user) {
      console.log('[kakao-auth] onAuthStateChanged', user ? { uid: user.uid } : null);
      if (user) {
        const nickname = localStorage.getItem(NICKNAME_KEY_PREFIX + user.uid) || '카카오 사용자';
        currentUser = { uid: user.uid, nickname: nickname };
        renderLoggedIn(currentUser);
        Profile.loadFromCloud();
      } else {
        renderLoggedOut();
      }
    });
  }

  function login() {
    if (!window.Kakao) { alert('카카오 SDK 로딩에 실패했습니다. 새로고침 후 다시 시도해주세요.'); return; }
    Kakao.Auth.login({
      // scope를 코드에서 강제 지정하면 카카오 콘솔의 동의항목 설정과 어긋날 때 KOE205 등으로 막힌다.
      // 콘솔(카카오 로그인 → 동의항목)에 등록된 항목만 자연스럽게 동의창에 노출되도록 비워둔다.
      // 참고: prompt는 Kakao.Auth.authorize()(리다이렉트 방식) 전용 옵션 — 팝업 방식인 login()에
      // 넘기면 "Invalid parameter keys" 에러로 로그인 자체가 막힌다. 계정 전환은 계정 로그아웃 절차로 처리한다.
      success: function () {
        Kakao.API.request({
          url: '/v2/user/me',
          success: function (res) {
            const nickname = (res.kakao_account && res.kakao_account.profile && res.kakao_account.profile.nickname) || '카카오 사용자';
            // Cloud Function이 만드는 Firebase uid(kakao_<id>)를 미리 계산해 닉네임을 캐싱해둔다 —
            // signInWithCustomToken 이후 onAuthStateChanged가 이 값을 곧바로 찾아 쓸 수 있도록.
            localStorage.setItem(NICKNAME_KEY_PREFIX + 'kakao_' + res.id, nickname);
            currentUser = { id: res.id, nickname: nickname };
            renderLoggedIn(currentUser);
            signInToFirebase();
          },
          fail: function (err) {
            console.error('카카오 사용자 정보 조회 실패', err);
            alert('카카오 사용자 정보를 가져오지 못했습니다.');
          },
        });
      },
      fail: function (err) {
        console.error('카카오 로그인 실패', err);
        alert('카카오 로그인에 실패했습니다.');
      },
    });
  }

  // 카카오 액세스 토큰 → (Cloud Function) → Firebase 커스텀 토큰 → Firebase Auth 로그인
  // (로그인 성공 후 화면 갱신·프로필 로드는 onAuthStateChanged가 담당한다)
  async function signInToFirebase() {
    if (!KAKAO_LOGIN_FUNCTION_URL) { console.warn('[kakao-auth] KAKAO_LOGIN_FUNCTION_URL 미설정 — Firebase 로그인 생략'); return; }
    if (!window.fbAuth) { console.error('Firebase 초기화 실패 — firebase-init.js 로딩 확인'); return; }
    try {
      const kakaoAccessToken = Kakao.Auth.getAccessToken();
      console.log('[kakao-auth] Cloud Function 호출 시작');
      const res = await fetch(KAKAO_LOGIN_FUNCTION_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kakaoAccessToken }),
      });
      const data = await res.json();
      if (!res.ok || !data.customToken) throw new Error(data.error || '커스텀 토큰 발급 실패');
      console.log('[kakao-auth] 커스텀 토큰 수신 완료 — Firebase 로그인 시도');
      const cred = await fbAuth.signInWithCustomToken(data.customToken);
      console.log('[kakao-auth] Firebase 로그인 성공', cred.user.uid);
    } catch (e) {
      console.error('[kakao-auth] Firebase 로그인 실패', e);
    }
  }

  function logout() {
    const afterKakaoLogout = function () { renderLoggedOut(); };
    if (window.Profile) Profile.clearLocal(); // 계정에 연결된 프로필이 로그아웃 후 화면에 남지 않도록 즉시 비운다
    if (window.fbAuth && fbAuth.currentUser) fbAuth.signOut().catch(e => console.error('Firebase 로그아웃 실패', e));
    if (window.Kakao && Kakao.Auth.getAccessToken()) {
      Kakao.Auth.logout(afterKakaoLogout);
    } else {
      afterKakaoLogout();
    }
  }

  function renderLoggedIn(user) {
    const box = document.getElementById('kakaoAuthBox');
    if (!box) return;
    box.innerHTML =
      '<span class="kakao-user-name">' + user.nickname + '님</span>' +
      '<button class="kakao-logout-btn" onclick="KakaoAuth.logout()">로그아웃</button>';
  }

  function renderLoggedOut() {
    currentUser = null;
    const box = document.getElementById('kakaoAuthBox');
    if (!box) return;
    box.innerHTML = '<button class="kakao-login-btn" onclick="KakaoAuth.login()">카카오 로그인</button>';
  }

  document.addEventListener('DOMContentLoaded', init);

  window.KakaoAuth = { login: login, logout: logout, getUser: function () { return currentUser; } };
})();
