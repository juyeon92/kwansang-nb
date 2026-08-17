// ═══ 카카오 로그인 ═══
// 카카오 로그인 → 액세스 토큰을 Cloud Function(KAKAO_LOGIN_FUNCTION_URL)에 보내 검증받고
// Firebase 커스텀 토큰을 돌려받아 Firebase Auth에 로그인 → Firestore에 저장된 프로필을 불러온다.
// KAKAO_LOGIN_FUNCTION_URL이 비어있으면(Cloud Function 배포 전) 닉네임 표시까지만 동작한다.
//
// Firebase Auth 세션 자체는 브라우저에 자동으로 유지되지만, 새로고침 시 그 상태를 확인하지 않으면
// 화면은 매번 "로그아웃"으로 보인다 — onAuthStateChanged로 새로고침 후에도 로그인 상태를 복원한다.
(function () {
  let currentUser = null;
  let isAdminUser = false; // roles/{uid} 문서 존재 + role==='admin'일 때만 true — 마이페이지 관리자 섹션 노출 여부
  const NICKNAME_KEY_PREFIX = 'kakaoAuthNickname:';
  const ACCOUNT_KEY_PREFIX = 'kakaoAuthAccount:'; // 마이페이지에 보여줄 카카오 계정(이메일 등)
  // 이메일은 따로 보관한다 — account는 이메일이 없을 때 닉네임으로 채워지는 자리라, 둘을 한 칸에 두면
  // "이 값이 진짜 이메일인지 닉네임인지" 구분이 안 돼 화면에 무엇을 보여줄지 판단할 수 없다.
  const EMAIL_KEY_PREFIX = 'kakaoAuthEmail:';
  // 저장된 값이 진짜 이메일인지 판별 — 예전 버전이 이 자리에 닉네임을 넣어둔 문서가 남아 있을 수 있다.
  function looksLikeEmail(v) { return !!v && String(v).indexOf('@') > 0; }

  function init() {
    if (window.Kakao && !Kakao.isInitialized()) {
      Kakao.init(KAKAO_JS_KEY);
    }
    if (!window.fbAuth) { renderLoggedOut(); return; }
    // 최초 호출(페이지 로드 시 세션 복원 여부)과 이후 모든 로그인/로그아웃 변화를 여기 한 곳에서 처리한다.
    fbAuth.onAuthStateChanged(function (user) {
      console.log('[kakao-auth] onAuthStateChanged', user ? { uid: user.uid, anonymous: !!user.isAnonymous } : null);
      // 익명 인증(인연도감이 비로그인 등록을 위해 발급)은 로그인이 아니다 — 헤더·마이페이지·프로필
      // 동기화는 카카오로 실제 로그인했을 때만 동작해야 한다.
      // 인연도감은 로그인 여부에 따라 내용이 달라지는데(내 도감 조회, "로그인하고 유지하기" 후킹),
      // 페이지 로드 직후엔 Firebase 세션 복원이 아직 끝나지 않아 비로그인으로 그려진다.
      // 그 뒤 여기서 상태가 확정되므로, 확정된 시점에 다시 그려야 "로그인했는데 로그인 유도가 뜨고
      // 등록해둔 인연이 사라져 보이는" 상태가 남지 않는다.
      if (window.Dogam) Dogam.render();
      if (user && user.isAnonymous) {
        isAdminUser = false;
        renderLoggedOut();
        return;
      }
      if (user) {
        const nickname = localStorage.getItem(NICKNAME_KEY_PREFIX + user.uid) || '';
        const account = localStorage.getItem(ACCOUNT_KEY_PREFIX + user.uid) || '';
        const email = localStorage.getItem(EMAIL_KEY_PREFIX + user.uid) || '';
        currentUser = { uid: user.uid, nickname: nickname, account: account, email: email };
        renderLoggedIn(currentUser);
        Profile.loadFromCloud();
        if (window.Archive) Archive.loadFromCloud();
        resolveAccountInfo(user.uid);
        // 냥 잔액·관리자 여부는 마이페이지를 열기 전에 미리 받아둔다 — 열자마자 바로 보이도록.
        if (window.Wallet) Wallet.fetchBalance().then(refreshMyPageIfOpen);
        checkAdminRole(user.uid).then(refreshMyPageIfOpen);
      } else {
        isAdminUser = false;
        renderLoggedOut();
      }
    });
  }

  // roles/{uid} 문서는 본인만 읽을 수 있고 쓰기는 항상 막혀 있다(firestore.rules) — 클라이언트가
  // 스스로를 admin으로 만들 수 없다. 관리자 지정은 Firebase 콘솔에서 이 문서를 직접 만드는 방식뿐.
  async function checkAdminRole(uid) {
    if (!window.fbDb) { isAdminUser = false; return; }
    try {
      const doc = await fbDb.collection('roles').doc(uid).get();
      isAdminUser = doc.exists && doc.data().role === 'admin';
    } catch (e) {
      console.error('[kakao-auth] 관리자 여부 확인 실패', e);
      isAdminUser = false;
    }
  }

  // 잔액/관리자 정보가 비동기로 늦게 도착했을 때, 마이페이지를 이미 열어둔 상태였다면 다시 그려준다.
  function refreshMyPageIfOpen() {
    if (document.querySelector('.form-popup.fullpage')) openMyPage();
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
            currentUser = { id: res.id, nickname: info.nickname, account: info.account, email: info.email };
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
  // ⚠️ 닉네임이 오는 자리가 두 군데다. 카카오는 동의항목 구성에 따라 최신 위치
  // kakao_account.profile.nickname 로 주기도 하고, 예전부터 쓰이던 properties.nickname 으로만
  // 주기도 한다. 앞쪽만 보고 있으면 "닉네임 동의를 받았는데도 '카카오 사용자'로 뜨는" 상태가 된다
  // (실제로 이 증상이 났다 — 2026-08-17). 두 자리를 모두 확인한다.
  function pickKakaoNickname(res) {
    const acc = res.kakao_account || {};
    return (acc.profile && acc.profile.nickname) || (res.properties && res.properties.nickname) || '';
  }
  // 이 계정이 실제로 어떤 항목에 "동의된 상태"인지 카카오에 직접 물어본다(/v2/user/scopes).
  // 콘솔에서 동의항목을 켜도 그 전에 이미 로그인해둔 계정에는 소급 적용되지 않기 때문에,
  // "콘솔은 필수 동의인데 값은 안 온다"는 상황이 생긴다. 이 로그로 설정 문제인지 동의 상태
  // 문제인지 한 번에 구분된다. 값이 아니라 항목 id와 동의 여부만 찍는다(개인정보 로그 방지).
  function logKakaoScopes() {
    if (!window.Kakao || !Kakao.Auth.getAccessToken()) return;
    Kakao.API.request({
      url: '/v2/user/scopes',
      success: function (r) {
        const list = (r && r.scopes) || [];
        console.log('[kakao-auth] 동의 상태', list.map(s => s.id + '=' + (s.agreed ? '동의됨' : '미동의')).join(', ') || '(항목 없음)');
      },
      fail: function (e) { console.warn('[kakao-auth] 동의 상태 조회 실패', e); },
    });
  }

  function cacheAccountInfo(uid, res) {
    const acc = res.kakao_account || {};
    const nickname = pickKakaoNickname(res) || '카카오 사용자';
    const account = acc.email || nickname;
    // 어떤 항목이 실제로 내려왔는지 확인용 — 값은 찍지 않고 존재 여부만 남긴다(개인정보 로그 방지).
    console.log('[kakao-auth] 카카오 응답 항목', {
      'kakao_account.profile.nickname': !!(acc.profile && acc.profile.nickname),
      'properties.nickname': !!(res.properties && res.properties.nickname),
      email: !!acc.email,
    });
    logKakaoScopes();
    localStorage.setItem(NICKNAME_KEY_PREFIX + uid, nickname);
    localStorage.setItem(ACCOUNT_KEY_PREFIX + uid, account);
    localStorage.setItem(EMAIL_KEY_PREFIX + uid, acc.email || '');
    return { nickname: nickname, account: account, email: acc.email || '' };
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
    if (info.email) currentUser.email = info.email;
    backupAccountToCloud(uid);
    // 마이페이지를 열어둔 채로 값이 도착했다면 그 자리에서 다시 그린다.
    if (document.querySelector('.form-popup.fullpage')) openMyPage();
  }

  // 기기를 바꿔도 계정 표시가 유지되도록 Firestore에 함께 백업해둔다(프로필과 같은 문서).
  function backupAccountToCloud(uid) {
    if (!window.fbDb || !currentUser || !currentUser.account) return;
    // kakaoAccount에는 진짜 이메일만 넣는다 — 예전엔 이메일이 없으면 닉네임을 그대로 넣었는데,
    // 그러면 관리자 화면에서 "이메일 칸에 닉네임이 들어있는" 문서가 쌓이고 서버가 저장한 실제
    // 이메일을 닉네임으로 덮어쓰는 사고도 난다.
    const payload = { kakaoNickname: currentUser.nickname };
    if (looksLikeEmail(currentUser.email)) payload.kakaoAccount = currentUser.email;
    fbDb.collection('users').doc(uid).set(payload, { merge: true })
      .catch(e => console.error('[kakao-auth] 계정 정보 백업 실패', e));
  }

  async function readAccountFromCloud(uid) {
    if (!window.fbDb) return;
    try {
      const doc = await fbDb.collection('users').doc(uid).get();
      const data = doc.exists ? doc.data() : null;
      // 예전엔 kakaoAccount(이메일)가 없으면 그냥 돌아갔는데, 이메일 동의를 못 받는 경우가 흔해서
      // 닉네임만 저장된 계정은 화면에 아무것도 못 채우고 '카카오 사용자'로 남았다. 둘 중 하나만 있어도 쓴다.
      if (!data || (!data.kakaoAccount && !data.kakaoNickname)) return;
      const nickname = data.kakaoNickname || '카카오 사용자';
      // 저장된 kakaoAccount가 실제 이메일일 때만 이메일로 인정한다(옛 문서엔 닉네임이 들어있을 수 있음).
      const email = looksLikeEmail(data.kakaoAccount) ? data.kakaoAccount : '';
      const account = email || nickname;
      localStorage.setItem(NICKNAME_KEY_PREFIX + uid, nickname);
      localStorage.setItem(ACCOUNT_KEY_PREFIX + uid, account);
      localStorage.setItem(EMAIL_KEY_PREFIX + uid, email);
      applyAccountInfo(uid, { nickname: nickname, account: account, email: email });
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
      // 비로그인(익명)으로 인연도감을 쓰던 중이라면, 그 세션의 ID 토큰을 함께 보내 계정으로 이관받는다.
      // 로그인하면 uid가 kakao_<id>로 바뀌므로, 이 토큰이 없으면 익명일 때 만든 도감·참여 기록이 끊긴다.
      let anonIdToken = null;
      if (fbAuth.currentUser && fbAuth.currentUser.isAnonymous) {
        try { anonIdToken = await fbAuth.currentUser.getIdToken(); }
        catch (e) { console.error('[kakao-auth] 익명 토큰 확보 실패 — 이관 없이 진행', e); }
      }
      console.log('[kakao-auth] Cloud Function 호출 시작', { 이관시도: !!anonIdToken });
      const res = await fetch(KAKAO_LOGIN_FUNCTION_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kakaoAccessToken, anonIdToken }),
      });
      const data = await res.json();
      if (!res.ok || !data.customToken) throw new Error(data.error || '커스텀 토큰 발급 실패');
      if (data.migrated) console.log('[kakao-auth] 익명 데이터 이관 완료', data.migrated);
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
      // signOut이 끝나야 계정별 저장소가 아닌 게스트 저장소를 보게 된다 — 먼저 기다린 뒤 화면을 비운다.
      // (기다리지 않으면 로그아웃 직후에도 헤더에 이전 계정의 프로필이 남는다.)
      const signedOut = (window.fbAuth && fbAuth.currentUser)
        ? fbAuth.signOut().catch(e => console.error('Firebase 로그아웃 실패', e))
        : Promise.resolve();
      return signedOut;
    }).then(function () {
      if (window.Profile) Profile.clearLocal(); // 화면 정리 — 계정별 사본은 남겨둔다(재로그인 시 복원용)
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
  // 로그아웃·탈퇴 후 착지할 화면 — 통합분석이 아니라 인연도감이다.
  // 통합분석은 냥이 드는 유료 분석이라 방금 로그아웃한 사람이 할 수 있는 게 없다.
  // 인연도감은 로그인 없이도 사진만으로 끝까지 되는 화면이라 여기로 보내는 게 맞다.
  function goToMain() {
    const btns = Array.prototype.slice.call(document.querySelectorAll('.tab-btn'));
    const btn = btns.filter(b => (b.getAttribute('onclick') || '').indexOf("'gwansang'") >= 0)[0] || btns[0];
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

  // 냥 잔액 카드 — 관상냥반_냥시스템_기획서.md v2.0.
  // "냥 구매하기"는 구매 페이지(js/nyang-shop.js)로 연결한다 — 사용자 요청 2026-08-16으로 활성화.
  // 페이지 안의 실제 결제 버튼은 여전히 준비중 안내로 끝난다(PG 연동은 기획서 스코프 밖).
  function walletCardHtml() {
    const balance = window.Wallet ? Wallet.getCachedBalance() : null;
    const balanceText = balance == null ? '불러오는 중…' : balance + '냥';
    return '<div class="mypage-section">' +
        '<div class="mypage-section-title"><span class="material-symbols-outlined">paid</span>보유 냥</div>' +
        '<div class="wallet-balance-card">' +
          '<span class="wallet-balance-num">' + esc(balanceText) + '</span>' +
          // 대표프로필의 "변경" 버튼(.mypage-rep-change)과 같은 스타일로 통일 — 사용자 요청 2026-08-16
          '<button class="mypage-rep-change" onclick="NyangShop.open()">냥 구매하기</button>' +
        '</div>' +
      '</div>';
  }

  // 관리자 전용 — roles/{uid}.role==='admin'일 때만 마이페이지에 노출(기획서 §3.3 "화면 위치").
  // 서버(Cloud Function)에서도 admin 여부를 다시 검증하므로, 여기 UI를 억지로 열어도 실제 지급은 막힌다.
  function adminSectionHtml() {
    if (!isAdminUser) return '';
    return '<div class="mypage-section admin-section">' +
        '<div class="mypage-section-title"><span class="material-symbols-outlined">admin_panel_settings</span>관리자 냥 지급</div>' +
        '<div class="admin-search-row">' +
          '<input type="text" id="adminSearchInput" class="field-input" placeholder="아이디 또는 이메일">' +
          '<button class="btn-outline-primary" onclick="KakaoAuth._adminSearch()">검색</button>' +
        '</div>' +
        '<div id="adminSearchResults"></div>' +
        // 지급·사용 원장을 CS 대응용으로 열어보는 자리(js/nyang-history.js). 관리자 전용이라 이 섹션 안에 둔다.
        '<button class="mypage-menu-item admin-history-link" onclick="NyangHistory.open()">냥 지급·사용 내역' +
          '<span class="material-symbols-outlined">receipt_long</span></button>' +
      '</div>';
  }

  function adminUserRowHtml(u) {
    const label = u.nickname || u.account || u.uid;
    return '<div class="admin-user-row" data-uid="' + esc(u.uid) + '">' +
        '<div class="admin-user-info">' +
          '<div class="admin-user-name">' + esc(label) + '</div>' +
          '<div class="admin-user-sub">' + esc(u.account || u.uid) + ' · 현재 보유: <span class="admin-user-balance">' + esc(String(u.balance)) + '</span>냥</div>' +
        '</div>' +
        '<input type="number" min="1" step="1" class="admin-grant-amount" placeholder="냥 수">' +
        '<select class="admin-grant-reason">' +
          '<option value="로컬 테스트용">로컬 테스트용</option>' +
          '<option value="베타 테스터 지급">베타 테스터 지급</option>' +
          '<option value="기타">기타</option>' +
        '</select>' +
        '<button class="btn-solid-primary btn-md" onclick="KakaoAuth._adminGrant(\'' + esc(u.uid) + '\')">지급하기</button>' +
      '</div>';
  }

  async function adminSearch() {
    const input = document.getElementById('adminSearchInput');
    const resultsEl = document.getElementById('adminSearchResults');
    if (!input || !resultsEl) return;
    const q = input.value.trim();
    if (!q) { resultsEl.innerHTML = ''; return; }
    resultsEl.innerHTML = '<div class="arc-empty">검색 중…</div>';
    try {
      const users = await Wallet.adminSearchUsers(q);
      resultsEl.innerHTML = users.length
        ? users.map(adminUserRowHtml).join('')
        : '<div class="arc-empty">일치하는 사용자가 없어요</div>';
    } catch (e) {
      resultsEl.innerHTML = '<div class="err-msg show">' + esc(e.message) + '</div>';
    }
  }

  async function adminGrant(targetUid) {
    const row = document.querySelector('.admin-user-row[data-uid="' + CSS.escape(targetUid) + '"]');
    if (!row) return;
    const amountInput = row.querySelector('.admin-grant-amount');
    const reasonSelect = row.querySelector('.admin-grant-reason');
    const amount = Number(amountInput.value);
    // amount는 1 이상의 정수만 허용(기획서 §3.3) — 서버도 다시 검증하지만, 헛된 요청을 미리 막는다.
    if (!Number.isInteger(amount) || amount < 1) { alert('지급할 냥 수는 1 이상의 정수로 입력해주세요.'); return; }
    const reason = reasonSelect.value;
    const btn = row.querySelector('.btn-solid-primary');
    btn.disabled = true; btn.textContent = '지급 중…';
    try {
      const newBalance = await Wallet.adminGrant(targetUid, amount, reason);
      row.querySelector('.admin-user-balance').textContent = String(newBalance);
      amountInput.value = '';
      alert('지급 완료 — 현재 잔액 ' + newBalance + '냥');
    } catch (e) {
      alert(e.message || '지급에 실패했어요.');
    } finally {
      btn.disabled = false; btn.textContent = '지급하기';
    }
  }

  // 마이페이지에 보여줄 "계정" 한 줄 — 사용자가 자기 계정으로 인식하는 값은 카카오계정(이메일)이므로
  // 이메일이 있으면 그걸 쓴다. 내부 식별자(uid=kakao_<회원번호>)는 사용자에게 의미 없는 값이라
  // 절대 계정처럼 노출하지 않는다(사용자 지적 2026-08-17).
  // 이메일이 없는 건 코드로 만들어낼 수 없는 값이라, 닉네임으로 대체하고 그마저 없으면
  // 왜 비어 있는지 알 수 있는 문구를 보여준다 — 카카오 콘솔 동의항목에서 이메일을 켜야 채워진다.
  function mypageAccountLabel() {
    if (!currentUser) return '계정 정보를 불러오는 중…';
    const email = currentUser.email || '';
    if (email) return email;
    // account는 이메일이 없을 때 닉네임으로 채워져 내려온다(cacheAccountInfo 참고).
    const nick = (currentUser.account && currentUser.account !== '카카오 사용자') ? currentUser.account
      : (currentUser.nickname && currentUser.nickname !== '카카오 사용자') ? currentUser.nickname
      : '';
    if (nick) return nick;
    return '카카오계정 정보 미연동';
  }

  function openMyPage() {
    const r = root();
    if (!r) return;
    // 표시할 계정 문자열 — 이메일 > 닉네임 > 카카오 회원번호 순으로 내려간다.
    // 카카오가 이메일·닉네임을 안 내려주는 경우(동의항목 미설정 등)엔 예전엔 '카카오 사용자'라는
    // 아무 정보 없는 문구만 남아서, 본인조차 자기 계정을 확인할 수 없었다(사용자 지적 2026-08-17).
    // uid는 항상 kakao_<회원번호> 형태로 존재하므로 최후 수단으로 그 번호를 보여준다 —
    // 문의할 때 "이 번호요"라고 말할 수 있는 값이 화면에 하나는 있어야 한다.
    const account = mypageAccountLabel();
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
          // 관리자는 이 자리에 보유 냥 카드 대신 관리자 지급 패널을 보여준다(사용자 요청 2026-08-16) —
          // 관리자 본인도 지갑이 있긴 하지만, 이 화면에서 관리자에게 더 중요한 건 지급 기능 쪽이라 우선 노출.
          (isAdminUser ? adminSectionHtml() : walletCardHtml()) +
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
    // showConfirm은 원래 이 파일 안에서만 쓰던 헬퍼인데, 냥 차감 전 확인 다이얼로그(profile.js)에서도
    // 같은 디자인을 써야 해서 외부로 연다 — 브라우저 기본 confirm()을 쓰면 앱 톤과 따로 놀기 때문.
    showConfirm: showConfirm,
    _todo: todo, _cancelConfirm: cancelConfirm, _okConfirm: okConfirm,
    _adminSearch: adminSearch, _adminGrant: adminGrant,
    getUser: function () { return currentUser; },
  };
})();
