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
  const ACCOUNT_KEY_PREFIX = 'kakaoAuthAccount:'; // 마이페이지에 보여줄 카카오 계정(이메일 등)

  function init() {
    if (window.Kakao && !Kakao.isInitialized()) {
      Kakao.init(KAKAO_JS_KEY);
    }
    if (!window.fbAuth) { renderLoggedOut(); return; }
    // 최초 호출(페이지 로드 시 세션 복원 여부)과 이후 모든 로그인/로그아웃 변화를 여기 한 곳에서 처리한다.
    fbAuth.onAuthStateChanged(function (user) {
      console.log('[kakao-auth] onAuthStateChanged', user ? { uid: user.uid } : null);
      if (user) {
        const nickname = localStorage.getItem(NICKNAME_KEY_PREFIX + user.uid) || '';
        const account = localStorage.getItem(ACCOUNT_KEY_PREFIX + user.uid) || '';
        currentUser = { uid: user.uid, nickname: nickname, account: account };
        renderLoggedIn(currentUser);
        Profile.loadFromCloud();
        if (window.Archive) Archive.loadFromCloud();
        resolveAccountInfo(user.uid);
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
            // Cloud Function이 만드는 Firebase uid(kakao_<id>)를 미리 계산해 캐싱해둔다 —
            // signInWithCustomToken 이후 onAuthStateChanged가 이 값을 곧바로 찾아 쓸 수 있도록.
            const info = cacheAccountInfo('kakao_' + res.id, res);
            currentUser = { id: res.id, nickname: info.nickname, account: info.account };
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
        // 카카오가 내려주는 error/error_description을 그대로 드러낸다 — 이게 없으면 콘솔에
        // "Object"만 남아 원인(도메인 미등록/Client Secret/SDK 지원 종료)을 구분할 수 없다.
        const code = (err && (err.error || err.code)) || '';
        const desc = (err && (err.error_description || err.msg)) || '';
        console.error('[kakao-auth] 카카오 로그인 실패', { code: code, description: desc, raw: err });
        alert('카카오 로그인에 실패했습니다.\n' + (code ? '(' + code + ') ' : '') + desc);
      },
    });
  }

  // ── 카카오 계정 정보(이메일/닉네임) 확보 ─────────────────────────────
  // 이메일은 카카오 콘솔 [카카오 로그인 → 동의항목]에서 "카카오계정(이메일)"을 켜고 사용자가
  // 동의했을 때만 내려온다. 동의를 안 했거나 항목이 꺼져 있으면 닉네임으로 대체한다.
  function cacheAccountInfo(uid, res) {
    const acc = res.kakao_account || {};
    const nickname = (acc.profile && acc.profile.nickname) || '카카오 사용자';
    const account = acc.email || nickname;
    localStorage.setItem(NICKNAME_KEY_PREFIX + uid, nickname);
    localStorage.setItem(ACCOUNT_KEY_PREFIX + uid, account);
    return { nickname: nickname, account: account };
  }

  // 새로고침으로 세션만 복원된 경우엔 로컬 캐시가 비어 있을 수 있다 —
  // 살아있는 카카오 토큰이 있으면 카카오에서, 없으면 Firestore에 백업해둔 값에서 채운다.
  function resolveAccountInfo(uid) {
    if (currentUser && currentUser.account) { backupAccountToCloud(uid); return; }
    if (window.Kakao && Kakao.Auth.getAccessToken()) {
      Kakao.API.request({
        url: '/v2/user/me',
        success: function (res) {
          const info = cacheAccountInfo(uid, res);
          applyAccountInfo(uid, info);
        },
        fail: function () { readAccountFromCloud(uid); },
      });
      return;
    }
    readAccountFromCloud(uid);
  }

  function applyAccountInfo(uid, info) {
    if (!currentUser || currentUser.uid !== uid) return;
    currentUser.nickname = info.nickname;
    currentUser.account = info.account;
    backupAccountToCloud(uid);
    // 마이페이지를 열어둔 채로 값이 도착했다면 그 자리에서 다시 그린다.
    if (document.querySelector('.form-popup.fullpage')) openMyPage();
  }

  // 기기를 바꿔도 계정 표시가 유지되도록 Firestore에 함께 백업해둔다(프로필과 같은 문서).
  function backupAccountToCloud(uid) {
    if (!window.fbDb || !currentUser || !currentUser.account) return;
    fbDb.collection('users').doc(uid).set({
      kakaoNickname: currentUser.nickname, kakaoAccount: currentUser.account,
    }, { merge: true }).catch(e => console.error('[kakao-auth] 계정 정보 백업 실패', e));
  }

  async function readAccountFromCloud(uid) {
    if (!window.fbDb) return;
    try {
      const doc = await fbDb.collection('users').doc(uid).get();
      const data = doc.exists ? doc.data() : null;
      if (!data || !data.kakaoAccount) return;
      localStorage.setItem(NICKNAME_KEY_PREFIX + uid, data.kakaoNickname || '카카오 사용자');
      localStorage.setItem(ACCOUNT_KEY_PREFIX + uid, data.kakaoAccount);
      applyAccountInfo(uid, { nickname: data.kakaoNickname || '카카오 사용자', account: data.kakaoAccount });
    } catch (e) {
      console.error('[kakao-auth] 계정 정보 불러오기 실패', e);
    }
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
    showConfirm('로그아웃하시겠습니까?', '로그아웃', doLogout);
  }

  // 보관함·문의하기·결제내역은 로그인 상태에서만 성립하는 화면이라, 로그아웃하면 그 자리에 머무를 수
  // 없다 — 로딩을 띄운 뒤 메인(통합분석)으로 돌려보낸다.
  function doLogout() {
    closePopup();
    showLoading('로그아웃 중입니다…');
    let settled = false;
    const finish = function () {
      if (settled) return;
      settled = true;
      renderLoggedOut();
      closeDialog();
      goToMain();
    };
    // 방금 등록한 프로필의 클라우드 동기화가 아직 전송 중일 수 있다. 그 상태로 signOut()을 부르면
    // Firestore가 미전송 쓰기를 버려서, 다시 로그인했을 때 프로필이 사라진 것처럼 보인다.
    // 로딩을 이미 띄워둔 참이니 여기서 기다렸다가 로그아웃한다.
    const flush = (window.Profile && Profile.flushPending) ? Profile.flushPending() : Promise.resolve();
    flush.then(function () {
      if (window.fbAuth && fbAuth.currentUser) fbAuth.signOut().catch(e => console.error('Firebase 로그아웃 실패', e));
      if (window.Profile) Profile.clearLocal(); // 계정에 연결된 프로필이 로그아웃 후 화면에 남지 않도록 비운다
      if (window.Archive) Archive.clearLocal();
      // 카카오 토큰이 이미 만료됐으면 logout 요청이 401로 끝나고 콜백이 오지 않을 수 있다 —
      // 로딩이 영영 안 걷히지 않도록 타임아웃을 함께 건다.
      if (window.Kakao && Kakao.Auth.getAccessToken()) {
        Kakao.Auth.logout(finish);
        setTimeout(finish, 3000);
      } else {
        setTimeout(finish, 500); // 최소 노출 시간 — 로딩이 깜빡이고 사라지지 않도록
      }
    });
  }

  // 메인(통합분석) 탭으로 이동 — 보관함 페이지에 있었다면 여기서 함께 빠져나온다.
  function goToMain() {
    const btns = Array.prototype.slice.call(document.querySelectorAll('.tab-btn'));
    const btn = btns.filter(b => (b.getAttribute('onclick') || '').indexOf("'combined'") >= 0)[0] || btns[0];
    if (btn) btn.click();
    window.scrollTo(0, 0);
  }

  // 회원탈퇴 — 카카오 연결 끊기(unlink) → Firestore 사용자 문서 삭제 → Firebase 계정 삭제 순서로 진행한다.
  // 계정을 지운 뒤에는 Firestore 접근 권한이 사라지므로(보안 규칙이 request.auth.uid를 요구) 문서 삭제가 먼저다.
  function withdraw() {
    showConfirm('회원탈퇴를 진행하면 저장된 프로필과\n분석 기록이 모두 삭제되며 복구할 수 없습니다.\n\n정말 탈퇴하시겠습니까?', '회원탈퇴', doWithdraw);
  }

  async function doWithdraw() {
    closePopup();
    showLoading('회원탈퇴 처리 중입니다…');
    const user = window.fbAuth && fbAuth.currentUser;
    try {
      if (window.Kakao && Kakao.Auth.getAccessToken()) {
        await new Promise(function (resolve) {
          Kakao.API.request({ url: '/v1/user/unlink', success: resolve, fail: function (e) { console.error('카카오 연결 끊기 실패', e); resolve(); } });
        });
      }
      if (user && window.fbDb) await fbDb.collection('users').doc(user.uid).delete();
      if (user) {
        localStorage.removeItem(NICKNAME_KEY_PREFIX + user.uid);
        localStorage.removeItem(ACCOUNT_KEY_PREFIX + user.uid);
        await user.delete();
      }
      if (window.Profile) Profile.clearLocal();
      if (window.Archive) Archive.clearLocal();
      renderLoggedOut();
      closeDialog();
      goToMain();
      alert('회원탈퇴가 완료되었습니다.');
    } catch (e) {
      console.error('[kakao-auth] 회원탈퇴 실패', e);
      closeDialog();
      // 마지막 로그인이 오래되면 Firebase가 계정 삭제를 거부한다(auth/requires-recent-login).
      if (e && e.code === 'auth/requires-recent-login') {
        alert('보안을 위해 다시 로그인한 뒤 탈퇴를 진행해주세요.');
        doLogout();
      } else {
        alert('회원탈퇴 처리 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.');
      }
    }
  }

  // ── 헤더 아이콘 ──────────────────────────────────────────────────────
  function renderLoggedIn(user) {
    const box = document.getElementById('kakaoAuthBox');
    if (!box) return;
    box.innerHTML =
      '<button class="header-icon-btn" aria-label="메뉴" onclick="KakaoAuth.openMyPage()">' +
      '<span class="material-symbols-outlined">menu</span></button>';
  }

  function renderLoggedOut() {
    currentUser = null;
    const box = document.getElementById('kakaoAuthBox');
    if (!box) return;
    box.innerHTML =
      '<button class="header-icon-btn" aria-label="로그인" onclick="KakaoAuth.openLoginPopup()">' +
      '<span class="material-symbols-outlined">login</span></button>';
  }

  // ── 로그인 / 마이페이지 팝업 (프로필 팝업과 같은 오버레이 루트·스타일을 그대로 쓴다) ──
  function root() { return document.getElementById('profileOverlayRoot'); }
  function closePopup() {
    const r = root();
    if (r) r.innerHTML = '';
    document.body.classList.remove('overlay-open');
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // ── 확인 다이얼로그 / 전환 로딩 ──────────────────────────────────────
  // 마이페이지 팝업 위에 겹쳐 떠야 해서 오버레이 루트를 따로 쓴다(같은 루트를 쓰면 마이페이지가 지워진다).
  function dialogRoot() {
    let r = document.getElementById('authDialogRoot');
    if (!r) { r = document.createElement('div'); r.id = 'authDialogRoot'; document.body.appendChild(r); }
    return r;
  }
  function closeDialog() {
    dialogRoot().innerHTML = '';
    const r = root();
    if (!r || !r.innerHTML) document.body.classList.remove('overlay-open');
  }

  let pendingConfirm = null;
  function showConfirm(message, okLabel, onOk) {
    pendingConfirm = onOk;
    dialogRoot().innerHTML =
      '<div class="overlay-backdrop confirm-backdrop" onclick="KakaoAuth._cancelConfirm()"></div>' +
      '<div class="confirm-dialog" role="alertdialog">' +
        '<p class="confirm-msg">' + esc(message) + '</p>' +
        '<div class="confirm-actions">' +
          '<button class="btn-outline-primary" onclick="KakaoAuth._cancelConfirm()">취소</button>' +
          '<button class="btn-solid-primary" onclick="KakaoAuth._okConfirm()">' + esc(okLabel) + '</button>' +
        '</div>' +
      '</div>';
    document.body.classList.add('overlay-open');
  }
  function cancelConfirm() { pendingConfirm = null; closeDialog(); }
  function okConfirm() {
    const fn = pendingConfirm;
    pendingConfirm = null;
    closeDialog();
    if (fn) fn();
  }

  function showLoading(message) {
    dialogRoot().innerHTML =
      '<div class="overlay-backdrop confirm-backdrop"></div>' +
      '<div class="transition-loading"><div class="spin-ring"></div><p>' + esc(message) + '</p></div>';
    document.body.classList.add('overlay-open');
  }

  function openLoginPopup() {
    const r = root();
    if (!r) { login(); return; }
    r.innerHTML =
      '<div class="overlay-backdrop" onclick="KakaoAuth.closePopup()"></div>' +
      '<div class="form-popup small">' +
        '<div class="popup-header">' +
          '<span>로그인</span>' +
          '<button class="overlay-close" onclick="KakaoAuth.closePopup()"><span class="material-symbols-outlined">close</span></button>' +
        '</div>' +
        '<div class="popup-body login-popup-body">' +
          '<p class="login-popup-lead">로그인하면 등록한 프로필과 분석 결과를<br>다른 기기에서도 이어서 볼 수 있어요.</p>' +
          '<button class="kakao-login-big-btn" onclick="KakaoAuth.loginFromPopup()">' +
            '<span class="kakao-mark material-symbols-outlined">chat_bubble</span>카카오 로그인하기</button>' +
        '</div>' +
      '</div>';
    document.body.classList.add('overlay-open');
  }
  // 카카오 로그인은 팝업 창을 띄우므로, 오버레이를 먼저 닫아 화면이 겹치지 않게 한다.
  function loginFromPopup() { closePopup(); login(); }

  function openMyPage() {
    const r = root();
    if (!r) return;
    const account = (currentUser && (currentUser.account || currentUser.nickname)) || '계정 정보를 불러오는 중…';
    const rep = window.Profile ? Profile.getRepresentative() : null;
    const info = window.Profile ? Profile.describe(rep) : null;
    const repCard = info
      ? '<div class="mypage-rep-card">' +
          '<span class="mypage-rep-initial">' + esc(info.name.charAt(0)) + '</span>' +
          '<div class="mypage-rep-body">' +
            '<div class="mypage-rep-top"><span class="mypage-rep-name">' + esc(info.name) + '</span>' +
            '<span class="mypage-rep-badge">' + esc(info.relation) + '</span></div>' +
            '<div class="mypage-rep-sub">' + esc(info.birth) + '</div>' +
          '</div>' +
          '<button class="mypage-rep-change" onclick="KakaoAuth.changeProfile()">변경</button>' +
        '</div>'
      : '<div class="mypage-rep-card">' +
          '<span class="mypage-rep-empty">등록된 프로필이 없습니다</span>' +
          '<button class="mypage-rep-change" onclick="KakaoAuth.changeProfile()">등록</button>' +
        '</div>';

    r.innerHTML =
      '<div class="overlay-backdrop" onclick="KakaoAuth.closePopup()"></div>' +
      '<div class="form-popup fullpage">' +
        '<div class="popup-header">' +
          '<span>마이페이지</span>' +
          '<button class="overlay-close" onclick="KakaoAuth.closePopup()"><span class="material-symbols-outlined">close</span></button>' +
        '</div>' +
        '<div class="popup-body mypage-body">' +
          '<div class="mypage-account">' +
            '<span class="mypage-avatar material-symbols-outlined">person</span>' +
            '<div>' +
              '<div class="mypage-account-title">카카오로 로그인했습니다.</div>' +
              '<div class="mypage-account-id">' + esc(account) + '</div>' +
            '</div>' +
          '</div>' +
          '<div class="mypage-divider"></div>' +
          '<div class="mypage-section">' +
            '<div class="mypage-section-title"><span class="material-symbols-outlined">star</span>대표프로필</div>' +
            repCard +
          '</div>' +
          '<div class="mypage-divider"></div>' +
          '<div class="mypage-menu">' +
            menuItem('보관함', 'inventory_2', 'Archive.openPage()') +
            menuItem('문의하기', 'mail', "KakaoAuth._todo('문의하기')") +
            menuItem('결제내역', 'receipt_long', "KakaoAuth._todo('결제내역')") +
          '</div>' +
          '<div class="mypage-divider"></div>' +
          '<div class="mypage-menu">' +
            '<button class="mypage-menu-item is-quiet" onclick="KakaoAuth.logout()">로그아웃</button>' +
            '<button class="mypage-menu-item is-danger" onclick="KakaoAuth.withdraw()">회원탈퇴</button>' +
          '</div>' +
        '</div>' +
      '</div>';
    document.body.classList.add('overlay-open');
  }

  function menuItem(label, icon, handler) {
    return '<button class="mypage-menu-item" onclick="' + handler + '">' + label +
      '<span class="material-symbols-outlined">' + icon + '</span></button>';
  }

  // 대표 프로필 변경 — 프로필 전환 시트를 띄우고, 선택이 끝나면 마이페이지로 되돌아온다.
  function changeProfile() {
    if (!window.Profile) return;
    Profile.openSwitcher({ onDone: openMyPage });
  }

  function todo(name) { alert(name + ' 기능은 준비 중입니다.'); }

  document.addEventListener('DOMContentLoaded', init);

  window.KakaoAuth = {
    login: login, logout: logout, withdraw: withdraw,
    openLoginPopup: openLoginPopup, loginFromPopup: loginFromPopup,
    openMyPage: openMyPage, changeProfile: changeProfile, closePopup: closePopup,
    _todo: todo, _cancelConfirm: cancelConfirm, _okConfirm: okConfirm,
    getUser: function () { return currentUser; },
  };
})();
