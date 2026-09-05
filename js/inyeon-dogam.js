// ═══════════════════════════════════════════════════════════════════════
// 인연도감 — 내 관상 캐릭터를 중심으로 친구들을 모아 궁합 랭킹을 쌓는 영역.
//
// ■ 명세서(인연도감_정책및개발명세서.md)와 실제 구현의 차이 — 확인 후 반영
//   명세서는 "생년월일 + 사주"를 전제로 쓰여 있지만, 실제 인연도감(관상보기 탭)은
//   ai-analysis.js CTX_CONFIG.gwansang이 pillars:null 로 호출해 **얼굴 랜드마크만으로**
//   캐릭터를 산출한다. 생년월일은 수집하지도, 쓰지도 않는다.
//   → 명세서 §1.1의 생년월일 수집·§2의 AES 암호화/해시 인증·§1.3의 "생년월일 재입력 삭제"는
//     이 구현에 해당하지 않아 제외했고, 대신 실제로 다루는 정보(사진·이름/별명·캐릭터 결과)
//     기준으로 보관·삭제 정책을 다시 썼다(DOGAM_POLICY).
//
// ■ 실제로 다루는 개인정보
//   - 사진: 브라우저에서만 분석하고 서버로 보내지 않는다. 저장하지 않는다.
//   - 이름/별명: 도감에 표시되고, 도감을 공유하면 다른 참여자에게 보인다 → 별명 권장 고지 필요.
//   - 관상 캐릭터 결과(캐릭터 ID·궁합 점수): 비식별 결과값만 저장한다.
//
// ■ 저장 구조 (Firestore)
//   dogam/{slug}                  오너 정보 + TTL 기준 시각 (공개 읽기)
//   dogam/{slug}/entries/{uid}    친구 참여 기록. 문서 id = 친구 uid라 본인 삭제 권한이 규칙에서 명확해진다.
//   users/{uid}.dogamSlug         내 도감을 찾아가는 역인덱스
//
// ■ 인증 전제 (명세서 §1과 다른 선택)
//   명세서는 비로그인 진입을 원칙으로 두지만, 비로그인 쓰기를 허용하려면 Firebase 익명 인증을
//   켜거나 규칙을 열어야 한다(어뷰징 노출). 지금은 **쓰기에만 로그인을 요구**한다 — 요청받은
//   버튼 분기("비로그인: 로그인하고 도감 보관하기")와도 맞고, 콘솔 설정 변경 없이 동작한다.
//   나중에 익명 인증으로 바꾸려면 currentUid()와 firestore.rules만 손보면 된다.
// ═══════════════════════════════════════════════════════════════════════
(function () {
  const RETENTION_DAYS = 30; // 보관 기간 — 정책 문구(DOGAM_POLICY)와 expiresAt 계산이 모두 이 값을 따른다
  const SLUG_KEY = 'dogamMySlug';        // 내 도감 slug (로그인 전에도 기억해두기 위한 로컬 사본)
  const PARAM = 'dogam';                 // 공유 링크 쿼리 파라미터 (?dogam=<slug>)
  let enteredViaShare = false;           // 공유 링크로 들어온 세션인지 — 뒤로 갈 화면이 없으므로 뒤로가기를 숨긴다
  // 방금 맺은 인연(초대해준 사람) — 등록 직후 매칭 결과를 보여주기 위해 기억해둔다. 일부러 메모리
  // 변수로만 둔다(사용자 요청 2026-08-18): localStorage였다면 새로고침해도 계속 남아서, "방금"이 아닌
  // 옛 결과가 언제까지고 다시 보였다. 새로고침하면 이 값도 자연히 비워지는 게 맞다.
  let lastMatch = null;
  // ⚠️ 정책 개편(인연도감 서비스 정책.md v4, 2-2 7번·8번) — B가 A의 링크에 등록하면 곧바로 B
  // 본인 도감을 만들던 예전 동작을 없애고, 등록 직후엔 이 변수에만 결과를 담아 "1회성 병합 화면"
  // (registerEntry 참고)을 보여준다. B가 실제로 "내 인연도감 만들기"를 눌러야 그때 도감이 생긴다.
  // lastMatch와 같은 이유로 일부러 메모리 변수만 쓴다 — 같은 링크로 재방문(새로고침 포함)하면
  // 자연히 비워져서 2-3의 "게스트는 항상 등록 폼" 규칙으로 돌아간다.
  let justRegistered = null;

  // 화면에 그대로 노출하는 정책 문구 — 명세서를 관상 기준으로 다시 쓴 것.
  const DOGAM_POLICY = [
    { q: '어떤 정보를 저장하나요?',
      a: '이름(별명)과 관상 캐릭터 결과, 궁합 점수만 저장해요. <b>사진은 브라우저에서만 분석하고 서버로 보내지 않으며 저장하지도 않아요.</b> 생년월일은 받지 않아요 — 인연도감은 관상만으로 계산해요.' },
    { q: '얼마나 보관하나요?',
      a: '마지막으로 도감을 연 날부터 <b>' + RETENTION_DAYS + '일</b>간 보관해요. 그 사이에 다시 열면 기간이 다시 늘어나요. ' + RETENTION_DAYS + '일 동안 한 번도 열지 않으면 도감과 참여 기록이 함께 삭제돼요.' },
    { q: '삭제하고 싶어요',
      a: '친구는 자기가 등록한 기기에서 자기 기록을 지울 수 있어요. 도감 주인은 언제든 참여 기록을 지우거나 도감 전체를 삭제할 수 있고, 삭제하면 참여 기록도 함께 사라져요. <b>삭제한 내용은 되돌릴 수 없어요.</b>' },
    { q: '이름은 누구에게 보이나요?',
      a: '도감에 등록한 이름은 도감을 여는 사람 모두에게 보여요. 실명 대신 <b>별명</b>을 권해요.' },
    { q: '등록하면 서로의 도감에 올라가나요?',
      a: '네. 인연은 <b>양쪽에 함께 등록돼요</b> — 친구가 내 도감에 올라오는 동시에, 나도 그 친구의 도감에 올라가요. 그래서 서로의 인연 도감에서 상대의 캐릭터와 매칭 점수를 볼 수 있어요. 원하지 않으면 언제든 내 기록을 삭제할 수 있어요.' },
  ];

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
  }
  function currentUid() {
    return (window.fbAuth && fbAuth.currentUser) ? fbAuth.currentUser.uid : null;
  }

  // 인연 등록에는 로그인을 요구하지 않는다 — 로그인은 "내 도감을 계정에 묶어 오래 보관"하는
  // 용도(후킹)이지 등록 조건이 아니다. 다만 Firestore에 글을 쓰려면 신원이 있어야 보안 규칙으로
  // 어뷰징을 막을 수 있어서, 로그인하지 않은 사람에게는 Firebase 익명 인증으로 uid만 발급한다.
  async function ensureAuthUid() {
    const uid = currentUid();
    if (uid) return uid;
    if (!window.fbAuth || !fbAuth.signInAnonymously) return null;
    console.log('[dogam] 익명 인증으로 uid 발급');
    const cred = await fbAuth.signInAnonymously();
    return cred && cred.user ? cred.user.uid : null;
  }
  function isAnonymousUser() {
    return !!(window.fbAuth && fbAuth.currentUser && fbAuth.currentUser.isAnonymous);
  }
  function makeSlug() {
    // 추측 불가한 공개 URL용 문자열 (명세서 §2 "랜덤 slug")
    const chars = 'abcdefghijkmnpqrstuvwxyz23456789';
    let s = '';
    for (let i = 0; i < 12; i++) s += chars.charAt(Math.floor(Math.random() * chars.length));
    return s;
  }
  function sharedSlugFromUrl() {
    return new URLSearchParams(location.search).get(PARAM);
  }
  // ⚠️ 2026-09-04 — 카카오톡 등에 이 링크를 붙여넣으면 index.html의 고정 <meta> 태그 때문에 누가
  // 공유하든 항상 "관상냥반"이라는 같은 제목으로만 미리보기가 떴다(사용자 리포트). 크롤러는 자바스크립트를
  // 안 돌리고 응답 HTML의 태그만 읽어서, 정적 SPA인 이 페이지 자체로는 사람마다 다른 제목을 보여줄
  // 방법이 없다 — 그래서 실제 서비스 페이지 대신 functions/index.js dogamSharePreview를 먼저 거치게
  // 한다. 그 함수가 slug로 ownerName을 찾아 "{이름}님의 인연도감" 태그를 응답한 뒤, 실제로 클릭한
  // 사람은 곧바로 이 페이지(진짜 서비스 주소)로 다시 보낸다. 함수가 배포 전이면(URL 비어있음) 예전처럼
  // 이 페이지 주소를 그대로 공유한다.
  function shareUrl(slug) {
    const target = location.origin + location.pathname + '?' + PARAM + '=' + slug;
    if (typeof DOGAM_SHARE_PREVIEW_FUNCTION_URL === 'undefined' || !DOGAM_SHARE_PREVIEW_FUNCTION_URL) return target;
    return DOGAM_SHARE_PREVIEW_FUNCTION_URL + '?slug=' + encodeURIComponent(slug);
  }

  // ── 궁합 점수 ────────────────────────────────────────────────────────
  // 2026-08-30 DB 이원화 1단계 — 캐릭터 6기질 벡터·good/spark/clash 분류(compatibility-engine.js)가
  // 서버로 옮겨가서 CharacterAPI.getScore를 거친다. async가 됐으니 호출부도 await 필요.
  async function compatScore(idA, idB) {
    return await CharacterAPI.getScore(idA, idB);
  }
  // ⚠️ 사용자 리포트(2026-08-18): 예전엔 캐릭터별로 미리 정해둔 "특별 5명"(good 2·spark 1·
  // clash 2)에 들었는지만 보고 나머지 10명은 점수(5~99)와 무관하게 전부 "내 사람"으로 뭉뚱그렸다
  // — 그래서 69점·69점·28점이 나란히 다 "내 사람"으로 보이는 문제가 있었다. compatScore()가 이미
  // good/spark/clash 보정(+18/+8/-15)을 점수에 반영해두므로, 레이블도 그 최종 점수 하나로만
  // 4단계로 나눈다(사용자 지정 구간).
  function relationLabel(score) {
    if (score == null) return '';
    if (score >= 80) return '귀인';
    if (score >= 60) return '단짝';
    if (score >= 40) return '내 사람';
    return '호랑이 선생';
  }

  // ── 저장소 ───────────────────────────────────────────────────────────
  let myDogam = null;      // { slug, ownerName, ownerCharacterId, entries: [] }
  let guestDogam = null;   // 공유 링크로 들어왔을 때 보고 있는 남의 도감

  // ── 실시간 갱신 ──────────────────────────────────────────────────────
  // 친구가 다른 기기/브라우저에서 등록해도(사용자 요청 2026-08-18) 지금 열어둔 화면이 새로고침 없이
  // 갱신되도록, 내 도감의 entries를 구독해둔다. slug가 안 바뀌면 재구독하지 않는다 — render()는
  // 로그인 상태 변화·탭 전환 등으로 자주 다시 불리는데, 매번 새로 구독하면 리스너가 계속 쌓인다.
  let watchedSlug = null;
  let entriesUnsub = null;
  function stopWatchingEntries() {
    if (entriesUnsub) { entriesUnsub(); entriesUnsub = null; }
    watchedSlug = null;
  }
  function watchEntries(slug) {
    if (!window.fbDb || !slug || watchedSlug === slug) return;
    stopWatchingEntries();
    watchedSlug = slug;
    entriesUnsub = fbDb.collection('dogam').doc(slug).collection('entries')
      .onSnapshot(function (snap) {
        if (!myDogam || myDogam.slug !== slug) return; // 그 사이 도감이 바뀌었거나 사라짐 — 무시
        const entries = [];
        snap.forEach(function (d) { entries.push(d.data()); });
        entries.sort(function (a, b) { return (b.score || 0) - (a.score || 0); }); // 점수 높은 순
        myDogam.entries = entries;
        const el = host();
        if (el) el.innerHTML = renderOwnerView(myDogam);
        syncLiveBlocks();
      }, function (e) {
        console.error('[dogam] 실시간 구독 실패', e);
      });
  }

  function myCharacterId() {
    const saved = (typeof state !== 'undefined' && state.gwansang && state.gwansang.characterResult) || null;
    if (saved && saved.characterId) return saved.characterId;
    try { return (JSON.parse(localStorage.getItem(inyeonCharacterKey()) || 'null') || {}).characterId || null; }
    catch (e) { return null; }
  }
  // ⚠️ 사용자 리포트(2026-08-18): "공유하기"로 도감을 처음 만들 때는 닉네임을 입력받는 화면이
  // 없어서, 프로필 이름이 없으면(비로그인 등) 그냥 문자열 "나"를 그대로 저장했다. 그러면 닉네임을
  // 안 정한 서로 다른 사람들이 전부 "나"로 저장되고, 그 사람이 남의 도감에 등록될 때도 "나"가
  // 그대로 보여서 여러 사람이 똑같은 이름으로 뭉개져 보였다. share()는 이제 닉네임을 직접 물어서
  // 이 함수 자체를 안 거치게 하지만, render()가 조용히 자동으로 도감을 만드는 경로(사용자가 아무
  // 버튼도 안 눌렀는데 만들어지는 경우)는 팝업을 띄우기 부적절해서, 그 경로의 안전망으로 uid
  // 뒷자리를 붙여 최소한 서로 구분은 되게 한다.
  function myName() {
    // 인연도감 서비스 정책.md v4 2-0/2-1 1번 — A의 최초 진입 화면에 닉네임 입력을 새로 추가했다
    // (index.html #gwansangOwnerName). 그 값이 있으면 최우선으로 쓴다 — Profile은 사주 프로필
    // 시스템 것이라 인연도감(사주 없이 관상만 쓰는 기능)이 굳이 그걸 빌려 쓸 이유가 없어졌다.
    const nameEl = document.getElementById('gwansangOwnerName');
    const typed = (nameEl && nameEl.value || '').trim();
    if (typed) return typed;
    const rep = window.Profile ? Profile.getRepresentative() : null;
    if (rep && rep.name) return rep.name;
    const uid = currentUid();
    return uid ? '익명' + uid.slice(-4) : '나';
  }
  // myName()이 실제 이름 대신 내놓은 안전망 값인지 — 공유하기 시점에 이 상태면 진짜 닉네임을 물어본다.
  function isPlaceholderName(name) {
    return !name || name === '나' || /^익명/.test(name);
  }
  // 닉네임을 취소 없이 받을 때까지 반복한다 — 빈 값으로 도감을 만들면 결국 같은 문제(전부 "나")로
  // 되돌아간다. 사용자가 취소를 누르면 null을 돌려주고, 부른 곳에서 공유 자체를 중단한다.
  function promptForNickname() {
    let name = null;
    while (!name) {
      name = prompt('도감에 표시될 이름(별명)을 입력해주세요.\n실명 대신 별명을 권장해요.');
      if (name === null) return null; // 취소
      name = name.trim();
      if (!name) alert('이름을 입력해주세요.');
    }
    return name.slice(0, 12); // 등록 폼(dogamGuestName)과 동일한 길이 제한
  }

  async function loadDogam(slug) {
    if (!window.fbDb || !slug) return null;
    const doc = await fbDb.collection('dogam').doc(slug).get();
    if (!doc.exists) return null;
    const data = doc.data();
    const snap = await fbDb.collection('dogam').doc(slug).collection('entries').get();
    const entries = [];
    snap.forEach(function (d) { entries.push(d.data()); });
    // 점수 높은 순으로 위에서부터 노출 (요청 사항)
    entries.sort(function (a, b) { return (b.score || 0) - (a.score || 0); });
    return { slug: slug, ownerUid: data.ownerUid, ownerName: data.ownerName, ownerCharacterId: data.ownerCharacterId, createdAt: data.createdAt || null, entries: entries };
  }

  // 도감을 열 때마다 TTL 기준 시각을 갱신한다 — 명세서 §4의 last_accessed_at 연장에 해당.
  function touchDogam(slug, ownerUid) {
    if (!window.fbDb || currentUid() !== ownerUid) return;
    const now = new Date();
    const expires = new Date(now.getTime() + RETENTION_DAYS * 86400000);
    fbDb.collection('dogam').doc(slug).set({
      lastAccessedAt: now.toISOString(), expiresAt: expires.toISOString(),
    }, { merge: true }).catch(e => console.error('[dogam] TTL 갱신 실패', e));
  }

  // ⚠️ 버그 수정(2026-08-18 사용자 리포트: 친구가 등록한 인연이 안 보이고, 로그인한 같은 계정을
  // 다른 기기/브라우저에서 열면 안 보임) — 두 가지가 겹쳐서 난 문제였다.
  //   ① localStorage의 SLUG_KEY는 "이 브라우저가 마지막으로 다룬" 도감일 뿐, 지금 로그인된 uid의
  //      것이라는 보장이 없다. 인연도감은 비로그인(익명 인증)으로도 만들어지는데, 같은 브라우저에서
  //      나중에 진짜 카카오 계정으로 로그인하면 uid가 바뀌면서도 SLUG_KEY는 그대로 익명 uid의
  //      도감을 가리킨다. 예전 코드는 "SLUG_KEY가 있으면" Firestore 역인덱스(users/{uid}.dogamSlug)
  //      조회를 건너뛰어서, 소유자가 안 맞는 걸 확인한 뒤에도 진짜 내 도감을 다시 찾지 않고 그냥
  //      포기했다(return null) — 그 상태에서 새 도감을 만들면 원래 도감(과 그 안의 친구 기록)이
  //      통째로 미아가 된다.
  //   ② 조회 자체가 실패(네트워크 등)해도 그냥 삼켜서 null을 리턴했는데, 호출부(render)는 null을
  //      "정말 도감이 없다"로 오해해 새 도감을 만들어버렸다 — 그래서 아래에서는 실패를 삼키지 않고
  //      그대로 던져서, 호출부가 "확인 못 함"과 "확인했는데 없음"을 구분할 수 있게 한다.
  // 조회는 성공했지만 참여 인원이 0명일 때만 쓰는 안전망 — dogamSlug 참조 자체는 "유효"해서 위
  // 두 분기가 정상 종료해버리므로, 참조가 가리키는 도감이 방금 잘못 만들어진 빈 도감일 가능성을
  // 놓치지 않으려면 여기서 한 번 더 확인해야 한다(참여 인원이 있으면 이 확인은 건너뛴다 — 매번
  // 여러 문서를 훑는 비용을 정상 케이스에는 물리지 않기 위함). 사용자 리포트(2026-08-20).
  async function preferNonEmptySibling(uid, found) {
    if (!found || found.entries.length > 0) return found;
    const better = await recoverDogamByOwner(uid);
    return (better && better.entries.length > found.entries.length) ? better : found;
  }

  async function ensureMyDogam() {
    const uid = currentUid();
    if (!window.fbDb) return null;

    // 캐시된 slug가 있으면 먼저 시도한다. dogam 문서는 read:true(공개 읽기)라 uid 없이도(비로그인)
    // 조회 자체는 늘 가능하다 — 인연도감은 원칙적으로 "이 기기" 기준(비로그인 기준)이라, 로그인
    // 안 한 상태에서는 소유자 uid를 대조할 대상이 없으니 이 기기가 마지막으로 다룬 도감을 그대로
    // 믿고 보여준다(사용자 요청 2026-08-18: 로그아웃하면 등록된 리스트가 사라짐 — 그러면 안 된다).
    // 로그인 상태에서는 여전히 소유자가 지금 uid와 맞는지 확인한다(다른 계정/익명 도감을 내 것처럼
    // 보여주지 않기 위해).
    const cachedSlug = localStorage.getItem(SLUG_KEY);
    if (cachedSlug) {
      const cachedFound = await loadDogam(cachedSlug);
      if (cachedFound && (!uid || cachedFound.ownerUid === uid)) {
        if (uid) touchDogam(cachedSlug, uid);
        return uid ? await preferNonEmptySibling(uid, cachedFound) : cachedFound;
      }
    }

    if (!uid) return null; // 비로그인이고 이 기기에 도감 흔적도 없으면 정말 없는 상태

    // 캐시가 없거나 다른 uid의 것이었다면, 계정 문서의 역인덱스로 "진짜 내 도감"을 확인한다.
    // ⚠️ 사용자 리포트(2026-08-20: 인연도감 친구 6명이 사라짐) — archive.js의 loadFromCloud()가
    // 이미 겪고 고친 것과 같은 증상: 로그인 직후 이 users/{uid} 문서의 "첫" 조회가 가끔 dogamSlug
    // 필드까지 통째로 빠진 스냅샷을 돌려준다(같은 조회를 한 번 더 하면 항상 정상). 여기서 그걸 그대로
    // "도감이 없다"로 오판하면 아래 recoverDogamByOwner도 못 찾을 경우 새 빈 도감을 만들고
    // dogamSlug를 그쪽으로 덮어써서, 원래 도감(과 친구 전원)이 참조를 잃고 미아가 된다.
    let u = await fbDb.collection('users').doc(uid).get();
    if (u.exists && u.data().dogamSlug === undefined && u.data().archive === undefined && u.data().profiles === undefined) {
      console.warn('[dogam] 첫 조회가 비어 보임 — 700ms 뒤 한 번 더 조회', { uid: uid });
      await new Promise(function (r) { setTimeout(r, 700); });
      u = await fbDb.collection('users').doc(uid).get();
    }
    const slug = (u.exists && u.data().dogamSlug) || null;
    if (slug) {
      const found = await loadDogam(slug);
      if (found && found.ownerUid === uid) {
        localStorage.setItem(SLUG_KEY, slug);
        touchDogam(slug, uid);
        return await preferNonEmptySibling(uid, found);
      }
    }
    // ⚠️ 사고 리포트(2026-08-18): users/{uid}.dogamSlug 참조가 (버그로) 다른 값으로 덮어써지거나
    // 아예 없어도, 이 uid가 실제 소유한 도감 문서 자체는 Firestore에 그대로 남아있을 수 있다.
    // 여기서 포기하고 호출부가 createMyDogam()으로 새 빈 도감을 만들게 하면, 원래 도감(과 친구
    // 기록)이 참조를 잃고 미아가 된다 — 실제로 같은 계정 밑에 도감이 11개까지 쌓인 사고가 있었다.
    // 마지막으로 ownerUid로 직접 검색해서 있으면 그걸 되살리고, 끊어진 참조를 다시 이어준다.
    return await recoverDogamByOwner(uid);
  }

  // ⚠️ 사용자 리포트(2026-08-20)로 강화 — 예전엔 limit(1)로 아무거나 하나 집었는데, ensureMyDogam이
  // "도감이 없다"고 오판해 새 빈 도감을 만들어버린 뒤라면 이 uid로 도감이 2개 이상 존재하는 상태다
  // (원래 있던 것 + 방금 잘못 만들어진 빈 것). limit(1)은 그중 무엇이 나올지 보장이 없어 빈 도감을
  // "복구"해버릴 수 있었다. 이제 전부 조회해서 참여 인원이 가장 많은 도감을 진짜로 취급한다 —
  // 잘못 만들어진 빈 도감이 우연히 먼저 나오는 경우까지 막는다.
  async function recoverDogamByOwner(uid) {
    try {
      const snap = await fbDb.collection('dogam').where('ownerUid', '==', uid).get();
      if (snap.empty) return null;
      const candidates = await Promise.all(snap.docs.map(async function (doc) {
        const data = doc.data();
        const entriesSnap = await fbDb.collection('dogam').doc(doc.id).collection('entries').get();
        const entries = [];
        entriesSnap.forEach(function (d) { entries.push(d.data()); });
        entries.sort(function (a, b) { return (b.score || 0) - (a.score || 0); });
        return { slug: doc.id, ownerUid: data.ownerUid, ownerName: data.ownerName, ownerCharacterId: data.ownerCharacterId, createdAt: data.createdAt || null, entries: entries };
      }));
      if (candidates.length > 1) {
        console.warn('[dogam] 같은 계정에 도감이 여러 개 발견됨 — 참여 인원이 가장 많은 것을 진짜로 취급',
          candidates.map(function (c) { return { slug: c.slug, entries: c.entries.length, createdAt: c.createdAt }; }));
      }
      candidates.sort(function (a, b) {
        if (b.entries.length !== a.entries.length) return b.entries.length - a.entries.length;
        return (a.createdAt || '') < (b.createdAt || '') ? -1 : 1; // 인원 같으면 더 오래된 것
      });
      const recovered = candidates[0];
      const losers = candidates.slice(1);
      console.warn('[dogam] 끊어진 참조를 도감 직접 검색으로 복구', { uid: uid, slug: recovered.slug, entries: recovered.entries.length });
      await fbDb.collection('users').doc(uid).set({ dogamSlug: recovered.slug }, { merge: true });
      localStorage.setItem(SLUG_KEY, recovered.slug);
      touchDogam(recovered.slug, uid);
      // ⚠️ 버그 리포트(2026-08-31: "삭제해도 계속 생겨") — 예전엔 나머지를 그냥 방치했다. 방치하면
      // 다음에 recovered를 지워도 여기서 또 다른 loser가 "복구"되며 계속 반복된다. 한 사람이 도감을
      // 2개 이상 가질 정당한 이유가 없으므로, 복구하는 김에 나머지는 그 자리에서 완전히 지운다.
      if (losers.length) {
        console.warn('[dogam] 중복 도감 ' + losers.length + '개 정리', losers.map(function (c) { return c.slug; }));
        for (const loser of losers) {
          try {
            const entriesSnap = await fbDb.collection('dogam').doc(loser.slug).collection('entries').get();
            for (const d of entriesSnap.docs) await d.ref.delete();
            await fbDb.collection('dogam').doc(loser.slug).delete();
          } catch (e) {
            console.warn('[dogam] 중복 도감 정리 실패 slug=' + loser.slug, e);
          }
        }
      }
      return recovered;
    } catch (e) {
      console.error('[dogam] 소유자 기준 도감 복구 실패', e);
      return null;
    }
  }

  // nameOverride: 친구 도감에 등록하며 방금 입력한 이름 — 그 이름으로 내 도감도 만들어야 표기가 어긋나지 않는다.
  async function createMyDogam(nameOverride) {
    const uid = currentUid();
    const charId = myCharacterId();
    if (!uid || !charId || !window.fbDb) return null;
    const ownerName = (nameOverride && nameOverride.trim()) || myName();
    const slug = makeSlug();
    const now = new Date();
    await fbDb.collection('dogam').doc(slug).set({
      ownerUid: uid, ownerName: ownerName, ownerCharacterId: charId,
      createdAt: now.toISOString(), lastAccessedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + RETENTION_DAYS * 86400000).toISOString(),
    });
    await fbDb.collection('users').doc(uid).set({ dogamSlug: slug }, { merge: true });
    localStorage.setItem(SLUG_KEY, slug);
    console.log('[dogam] 내 도감 생성', { slug: slug, ownerName: ownerName, character: charId });
    return { slug: slug, ownerUid: uid, ownerName: ownerName, ownerCharacterId: charId, createdAt: now.toISOString(), entries: [] };
  }

  // ⚠️ 사용자 요청(2026-08-18): "인연도감은 비로그인(이 기기) 기준이고, 로그인하면 그 데이터를
  // 계정으로 이관해야 한다." 지금까지 이 기기에서 비로그인(또는 다른 계정)으로 쌓아온 도감이
  // 있는데 방금 실제 계정으로 로그인했다면, 그 도감에 등록된 참여 기록(entries)을 계정의 진짜
  // 도감으로 복사해온다.
  //
  // ownerUid 자체는 바꾸지 않는다 — Firestore 규칙상 도감 문서는 "지금 그 도감의 주인으로 인증된
  // 사람만" ownerUid를 바꿀 수 있는데, 익명 세션에서 실계정으로 전환되는 순간 이미 그 익명 uid로는
  // 인증할 수 없어서(로그인은 한 번에 한 신원) 애초에 불가능하다. 대신 계정이 소유한 "진짜" 도감
  // 쪽에 참여 기록만 복사해 넣는다 — 그건 계정이 자기 도감의 주인이라 항상 허용된다.
  // 원본(로컬 도감)은 그대로 둔다 — 이미 공유된 링크일 수 있어 삭제하면 그 링크로 들어온 사람들이
  // 보던 화면이 깨진다.
  async function migrateLocalOnLogin() {
    const uid = currentUid();
    if (!uid || isAnonymousUser() || !window.fbDb) return;

    // inyeonLastCharacter를 계정별 key로 나누면서(ai-analysis.js의 inyeonCharacterKey 참고) 생긴
    // 이관 지점 — 게스트 때 이 기기에서 이미 뽑아둔 캐릭터가 있는데 방금 로그인한 계정엔 아직 그
    // 기록이 없으면 그대로 넘겨준다. 계정 쪽에 이미 값이 있으면(다른 기기에서 만든 계정 캐릭터 등)
    // 게스트 값으로 덮어쓰지 않는다 — 위 도감 이관과 같은 "이미 내 것이면 손대지 않는다" 원칙.
    try {
      const guestRaw = localStorage.getItem(INYEON_LAST_CHARACTER_KEY);
      if (guestRaw && !localStorage.getItem(inyeonCharacterKey())) {
        localStorage.setItem(inyeonCharacterKey(), guestRaw);
      }
    } catch (e) { /* 프라이빗 브라우징 등 localStorage 불가 — 조용히 스킵 */ }

    const localSlug = localStorage.getItem(SLUG_KEY);
    if (!localSlug) return;
    const local = await loadDogam(localSlug).catch(function (e) {
      console.error('[dogam] 이관 대상 조회 실패', e);
      return null;
    });
    if (!local || local.ownerUid === uid) return; // 이미 내 것이면 이관할 게 없다

    let mine = await ensureMyDogam().catch(function () { return null; });
    const hadExistingAccountDogam = !!mine; // 승격(계정에 도감이 없어 이 기기 걸 새로 만든 것)과 구분하기 위해 미리 기록
    if (!mine) {
      // 계정에 아직 도감이 없으면 이 기기의 캐릭터/이름으로 새로 만든다 — 등록만 해뒀지 계정을
      // 안 만든 상태였다는 뜻이라, 이 기기의 도감을 그대로 계정의 도감으로 승격시키는 셈이다.
      mine = await createMyDogam(local.ownerName).catch(function (e) {
        console.error('[dogam] 이관용 내 도감 생성 실패', e);
        return null;
      });
    }
    if (!mine || mine.slug === local.slug) return;

    // ⚠️ 사용자 리포트(2026-08-19): 계정에 이미 진짜 도감이 있는데, 이 기기가 로그인 전(익명)에
    // 만든 도감은 그것과 전혀 다른 별개의 도감이다 — 그 도감을 분석했을 때 보관함(archive.js)에
    // 남겨둔 대기 스냅샷(PENDING_KEY)은 이제 미아라, 아래에서 이 기기의 참여 기록만 계정 도감으로
    // 옮기고 원본은 그대로 두는 것처럼, 보관함 쪽 미아 스냅샷도 버려야 한다. 안 그러면 잠시 뒤
    // Archive.commitPending()이 이걸 계정의 진짜 인연도감 기록에 덮어써 버린다("PC에서 로그인했더니
    // 내 인연도감이 로그인 전 다른 도감으로 바뀌어 보인다").
    if (hadExistingAccountDogam && window.Archive && Archive.discardPending) {
      Archive.discardPending('gwansang');
    }

    let migrated = 0;
    for (const entry of (local.entries || [])) {
      try {
        await fbDb.collection('dogam').doc(mine.slug).collection('entries').doc(entry.uid).set(entry, { merge: true });
        migrated++;
      } catch (e) { console.error('[dogam] 참여 기록 이관 실패', entry.uid, e); }
    }
    if (migrated) console.log('[dogam] 로컬 도감 참여 기록 이관 완료', { from: local.slug, to: mine.slug, count: migrated });
    localStorage.setItem(SLUG_KEY, mine.slug);
    myDogam = null; // 다음 render()가 이관된 결과를 새로 읽도록 캐시를 비운다
  }

  // ── 화면 ─────────────────────────────────────────────────────────────
  function host() { return document.getElementById('dogamSection'); }

  // 공유받은 친구 화면은 관상 리포트 안(#dogamSection)이 아니라 관상 탭 맨 위에 그린다 —
  // "나를 초대한 사람의 도감 → 내 인연 등록" 순서로 읽혀야 하기 때문.
  function guestHost() {
    let el = document.getElementById('dogamGuestSection');
    if (!el) {
      el = document.createElement('div');
      el.id = 'dogamGuestSection';
      const panel = document.getElementById('panel-gwansang');
      if (!panel) return null;
      panel.insertBefore(el, panel.firstChild);
    }
    return el;
  }

  // 사진 업로드 UI는 이미 화면에 있는 진짜 DOM(드래그·클릭 핸들러가 붙어 있는)을 그대로 옮겨 쓴다.
  // 새로 만들어 붙이면 fileInput 연결이 끊겨 업로드 자체가 동작하지 않는다.
  let uploadNodes = null;
  function captureUploadNodes() {
    if (uploadNodes) return uploadNodes;
    const sec = document.getElementById('gwansangUploadSection');
    if (!sec) return [];
    // 이름 입력(gwansangOwnerNameBlock)·동의 체크박스(gwansangOwnerAgreeBlock)는 gwansangInputCard
    // 안에 중첩돼 있어 더 이상 sec의 직계 자식이 아니다 — 그 카드 전체가 여기서 통째로 캡처돼 B의
    // 등록 폼(.dogam-block) 안으로 옮겨가고, 안에 있는 이 둘은 A 전용이라 showGuestView()가
    // setDisplay(...,'none')으로 숨긴다(B는 자기 이름 #dogamGuestName·동의 #dogamAgree를 따로 씀).
    const skip = { gwansangHero: 1, gwansangRevisitLabel: 1, gwansangRevisitCard: 1 };
    uploadNodes = Array.prototype.filter.call(sec.children, function (n) { return !skip[n.id]; });
    return uploadNodes;
  }
  function stashUploadNodes() {
    const sec = document.getElementById('gwansangUploadSection');
    if (!sec) return;
    captureUploadNodes().forEach(function (n) { if (n.parentElement !== sec) sec.appendChild(n); });
  }
  function setDisplay(id, value) {
    const el = document.getElementById(id);
    if (el) el.style.display = value;
  }

  // render()는 여러 곳에서 각각 호출된다 — 로그인 상태 확정(kakao-auth), 관상 분석 완료(app.js),
  // 보관함 삭제(archive.js), 등록 직후 등. 전부 async라 서로 겹쳐 돌 수 있는데, 예전엔 마지막에
  // "끝난" 호출이 화면을 덮어썼다. 그래서 캐릭터가 나오기 전에 시작된 렌더(도감 없음)가 캐릭터가
  // 나온 뒤 시작된 렌더(도감 있음)보다 늦게 끝나면, 방금 만든 도감이 화면에서 사라졌다
  // — 새로고침해야 보이던 증상의 원인(사용자 리포트 2026-08-17).
  // 해결: 호출마다 번호를 매기고, DOM에 쓰기 직전에 "내가 아직 최신 호출인지" 확인한다.
  // 최신이 아니면 조용히 물러나 더 늦게 시작된 렌더의 결과를 남긴다.
  let renderSeq = 0;
  // ═══ 공유 링크(?dogam=code) 우선순위 정책 (2026-08-19, 상세: Obsidian
  // AI_Face_Read/인연도감_공유링크_우선순위_정책.md) ═══
  // 원칙: "지금 URL에 dogam=code가 있는가"만이 화면을 가른다. 내가 이미 도감이 있든, 이 도감에
  // 이미 등록했든 상관없이 code가 붙어있는 동안은 그 code의 도감이 항상 1순위로 뜬다. 자동으로
  // "내 도감"으로 넘어가는 경우는 없고, 오직 leaveSharedView()(사용자가 직접 누르는 버튼)로 URL의
  // code를 지웠을 때만 아래(B) "내 도감" 규칙으로 전환된다.

  async function render() {
    const el = host();
    if (!el) return;
    // 정책 2-4 9번 — "내 인연도감 만들기"를 로그인 게이트로 막았을 때(createMyDogamFromInvite 참고)
    // 남겨둔 pendingCreateAfterLogin을 여기서 소비한다. render()는 kakao-auth.js가 로그인 완료
    // 직후에도 부르므로, 로그인이 실제로 끝난 시점을 이 자리에서 자연스럽게 감지할 수 있다. 한 번
    // 소비하면 바로 false로 되돌려 다음 render() 호출들이 중복 실행하지 않게 한다.
    if (pendingCreateAfterLogin && justRegistered && !!currentUid() && !isAnonymousUser()) {
      pendingCreateAfterLogin = false;
      await createMyDogamFromInvite();
      return; // createMyDogamFromInvite가 끝에서 render()를 다시 불러 최종 화면을 그린다
    }
    // ⚠️ 버그 수정(2026-09-03 사용자 리포트: "로그인 안 한 상태로 인연도감 들어갔더니 텅 빔") —
    // 아래 CharacterAPI.ensureCharacterCatalog()는 Firebase ID 토큰을 요구하는데(character-api.js),
    // 이 브라우저가 예전에 익명으로 만든 도감이 localStorage(SLUG_KEY)에 캐시돼 있으면 ensureMyDogam()이
    // 로그인 없이도(공개 읽기) 그 도감을 그대로 찾아 ownerCharacterId를 채워 넣는데, 정작 지금 이
    // 세션엔 유효한 익명 인증이 없어(로그아웃했거나 세션이 끊긴 경우) 카탈로그를 못 받아온다. 그러면
    // populateGwansangReportFromSaved도 같은 이유로 실패해 도감 내용이 하나도 안 그려지고, 이번에
    // 업로드 섹션까지 숨겨져(mine이 truthy라서, 아래 B분기 참고) 화면에 아무것도 안 남는다. 익명
    // 인증은 원래 도감 등록/공유 시에만 발급했는데, 여기서도 먼저 확보해 최소 조건(로그인 아니어도
    // 토큰은 있음)을 만들어준다 — 실패해도(오프라인 등) 무시하고 계속 진행(아래 catch가 그 몫).
    try { await ensureAuthUid(); } catch (e) { console.warn('[dogam] 익명 인증 확보 실패', e); }
    // 2026-08-30 DB 이원화 2단계 — CHARACTER_DB가 이제 서버 카탈로그 캐시라, 아래 모든 분기(오너
    // 화면·게스트 화면 등)가 캐릭터 이름/설명을 읽기 전에 한 번은 채워져 있어야 한다. 캐시가 있으면
    // 즉시 반환되니 재호출 비용은 거의 없다. 로그인 세션이 아직 안 잡혔을 때(예: 페이지 로드 직후)
    // 실패해도 render() 전체를 막지는 않는다 — 캐릭터 이름 표시만 비어 보이고, 다음 render()
    // 호출(예: 인증 준비된 뒤 재시도)에서 정상적으로 채워진다.
    try { await CharacterAPI.ensureCharacterCatalog(); } catch (e) { console.warn('[dogam] 캐릭터 카탈로그를 아직 못 받아왔어요', e); }
    const mySeq = ++renderSeq;
    const stale = function () { return mySeq !== renderSeq; };
    const sharedSlug = sharedSlugFromUrl();

    if (sharedSlug) {
      enteredViaShare = true;
      guestDogam = await loadDogam(sharedSlug).catch(function (e) { console.error('[dogam] 공유 도감 조회 실패', e); return null; });
      if (stale()) return;

      if (guestDogam) {
        // 오너 판단: 계정이 실제 소유자이거나(ownerUid 일치), 이 기기가 마지막으로 다루던 도감과
        // 같은 code면(SLUG_KEY 일치) 오너로 취급한다 — 익명 인증 세션이 새로고침 사이 유지되지
        // 않아도(사용자 리포트 2026-08-18) 내 링크가 낯선 사람 화면으로 오판되지 않게 하는 안전장치.
        const isOwner = guestDogam.ownerUid === currentUid() || sharedSlug === localStorage.getItem(SLUG_KEY);
        if (isOwner) {
          // A-1: code가 곧 내 도감 — 계정/기기 기준 재조회 없이 이 도감을 그대로 오너 화면으로 그린다.
          localStorage.setItem(SLUG_KEY, sharedSlug);
          touchDogam(sharedSlug, currentUid());
          const gh = document.getElementById('dogamGuestSection');
          if (gh) { stashUploadNodes(); gh.remove(); }
          setDisplay('gwansangHero', '');
          setDisplay('gwansangCtaDock', '');
          // A-1은 항상 "이미 있는 내 도감"이라 업로드 입구를 다시 보일 필요가 없다(아래 B 분기와
          // 같은 2026-09-01 원칙 — 도감이 있으면 사진을 더 넣을 필요가 없다).
          setDisplay('gwansangUploadSection', 'none');
          setDisplay('gwansangBackBtn', 'none');
          await paintOwnerView(el, guestDogam, stale);
          return;
        }
        // A-2/A-3: 남의 도감. (v4 정책 2-3) 게스트는 등록 이력과 무관하게 항상 같은 화면을 본다 —
        // 기기/세션으로 "이미 등록한 사람"을 구분해서 다른 화면을 보여주면, 같은 기기로 여러 명이
        // 순서대로 등록하는 흔한 상황(모임 자리 등)에서 다음 사람이 이전 사람의 결과를 그대로 보게
        // 되는 프라이버시 문제가 생긴다(정책 문서 2-3 근거). 예전의 "이미 등록했어요" 분기는 제거.
        // 다만 방금 이 링크에 등록을 마친 직후라면(justRegistered) 1회성 병합 결과 화면을 보여준다
        // (registerEntry/renderGuestMergedResult 참고) — 새로고침하면 justRegistered가 비워져
        // 자연히 아래 showGuestView(등록 폼)로 돌아간다.
        if (justRegistered && justRegistered.slug === sharedSlug) {
          renderGuestMergedResult(guestDogam, justRegistered);
        } else {
          showGuestView(guestDogam);
        }
        el.innerHTML = '';
        return;
      }
      // A-4: code가 무효/만료 — guestDogam이 null이라 아래 B 규칙(내 도감)으로 자연스럽게 폴백.
    }

    // ── B: dogam 파라미터가 없거나(또는 무효해서 폴백) — 내 도감 ──
    const gh = document.getElementById('dogamGuestSection');
    if (gh) { stashUploadNodes(); gh.remove(); }
    setDisplay('gwansangHero', '');
    setDisplay('gwansangCtaDock', '');
    // "인연도감 메인으로"는 돌아갈 이전 화면이 있을 때만 의미가 있다. 공유 링크로 바로 들어온
    // 세션에는 그 화면 자체가 없었으므로 숨긴다.
    setDisplay('gwansangBackBtn', enteredViaShare ? 'none' : '');
    // ⚠️ ensureMyDogam이 "확인했는데 없음"(null)과 "확인 자체가 실패함"(throw)을 구분해서 던지므로,
    // 여기서도 실패는 그냥 null로 뭉개면 안 된다 — 뭉개면 조회 한 번 실패했을 뿐인데 "도감이 없다"로
    // 오해해서 아래 자동 생성 분기가 새 도감을 만들어버리고, 원래 도감(과 친구 기록)이 미아가 된다.
    let mine;
    try {
      mine = await ensureMyDogam();
    } catch (e) {
      console.error('[dogam] 내 도감 조회 실패 — 확인이 안 된 상태라 새로 만들지 않고 중단', e);
      if (!stale()) el.innerHTML = '<p class="dogam-empty">인연도감을 불러오지 못했어요. 새로고침해서 다시 시도해주세요.</p>';
      return;
    }
    if (stale()) return;
    // 공유 버튼을 누른 뒤에 도감을 만들면 그 통신 때문에 클립보드 복사가 막힌다 —
    // 화면을 그리는 이 시점에 미리 만들어 두고, 버튼은 복사만 하도록 한다.
    // (여기 도달했다는 건 ensureMyDogam이 "확인했는데 정말 없음"을 리턴한 경우뿐이다.)
    if (!mine && currentUid() && myCharacterId()) {
      const created = await createMyDogam().catch(function (e) { console.error('[dogam] 도감 생성 실패', e); return null; });
      // 도감 생성은 되돌릴 수 없는 쓰기라, 뒤늦게 끝났더라도 결과 자체는 캐시에 반영해둔다.
      // 다만 화면은 최신 렌더에 맡긴다(아래 stale 체크).
      if (created) mine = created;
      if (stale()) return;
    }
    // ⚠️ 기능 변경(2026-09-01 사용자 요청) — 계정당 인연도감 1개 원칙(916cf48 등)이 있는데도 이
    // 업로드 섹션은 도감이 이미 있어도 계속 떠 있었다. "이미 등록한 재방문" 게스트 화면이 숨겨둔 걸
    // 되돌리려던 게 원래 의도였는데(예전 주석), 도감이 있는 사람한테까지 "사진을 또 올릴 수 있는
    // 입구"를 열어두는 부작용이 있었다 — 그 입구로 다른 사람 사진을 넣으면 state.gwansang.characterResult가
    // 새 결과로 바뀌면서 myCharacterId()가 그 값을 읽어가 버려, 정작 화면(도감 소유자 캐릭터, 이미
    // 고정됨)과 다른 캐릭터가 다른 곳(리스트 등)에서 새어 보이는 혼란까지 이어졌다(사용자 리포트).
    // 도감이 없는 사람에게만 업로드 입구를 보여준다 — 있으면 더 이상 사진을 넣을 필요가 없다.
    setDisplay('gwansangUploadSection', mine ? 'none' : '');
    // ⚠️ 버그 수정(2026-09-04) — showGuestView()가 게스트 화면에서 이 블록을 숨겨두는데(위 참고),
    // 같은 브라우저가 나중에(도감 없이) 자기 도감을 새로 만들려는 화면으로 돌아오면 그 숨김이 남아
    // 닉네임 입력창이 안 보이는 반대 문제가 생긴다. 여기서 매번 도감 없음 여부에 맞춰 다시 확정한다.
    setDisplay('gwansangOwnerNameBlock', mine ? 'none' : '');
    // 2026-09-05 — 동의 체크박스(gwansangOwnerAgreeBlock)도 이름 입력과 같은 이유로 같은 규칙을
    // 적용한다: 도감이 이미 있으면(더 이상 새로 만들 상황이 아니면) 숨긴다.
    setDisplay('gwansangOwnerAgreeBlock', mine ? 'none' : '');
    await paintOwnerView(el, mine, stale);
  }

  // 오너 화면을 그리는 공통 마무리 — 클라우드 캐릭터 복원("다시 보기" 카드), 실제 렌더, 실시간
  // 참여 기록 구독까지. A-1(code로 직접 찾은 내 도감)과 B(계정/기기 기준 내 도감) 양쪽이 공유한다.
  async function paintOwnerView(el, dogam, stale) {
    myDogam = dogam;
    const charId = myDogam ? myDogam.ownerCharacterId : null;
    // ⚠️ 사용자 리포트(2026-08-18): 보관함(Archive, 클라우드 동기화)엔 인연도감 리포트가 있는데
    // 인연도감 탭엔 없어 보임 — myCharacterId()는 이 기기의 localStorage(inyeonLastCharacter)만
    // 보기 때문에, 다른 기기에서 만든 도감을 이 기기(로그인은 같은 계정)에서 열면 "처음 온 사람"처럼
    // 사진 업로드부터 다시 시켰다. 클라우드 도감(dogam.ownerCharacterId)이 있으면 그 캐릭터로 이 기기의
    // 로컬 기록도 채워서 두 화면이 어긋나지 않게 한다 — 계산 로직은 그대로, 저장된 결과를 복원만
    // 하는 것이라 재분석은 안 일어난다.
    if (charId && !myCharacterId()) {
      try {
        localStorage.setItem(inyeonCharacterKey(), JSON.stringify({
          characterId: charId,
          characterName: (typeof CHARACTER_DB !== 'undefined' && CHARACTER_DB[charId]) ? CHARACTER_DB[charId].name : null,
          ts: Date.now(),
        }));
      } catch (e) { /* 프라이빗 브라우징 등 localStorage 불가 — 조용히 스킵 */ }
    }
    // ⚠️ 사용자 리포트(2026-08-19): "내 도감"의 정의엔 내 캐릭터 설명도 포함인데, 친구 도감(즉시
    // 전체 노출)과 달리 "다시 보기" 축소 카드로만 연결돼 있어서 한 번 더 눌러야 보였다. 게다가
    // showGuestView()가 앞서 이 카드 영역을 숨겨놓은 채로 남아있는 경우 아예 안 보이기도 했다.
    // 캐릭터가 있으면 항상 전체 카드+설명을 곧바로 펼친다 — Dogam.render()를 다시 부르면(reopenSavedCharacter가
    // 그렇게 한다) 무한 재귀라, 그 안쪽 함수(populateGwansangReportFromSaved)만 직접 쓴다.
    if (charId && typeof populateGwansangReportFromSaved === 'function') {
      await populateGwansangReportFromSaved(charId);
      // 2026-08-31 정책 변경(사용자 확정: "원본은 하나여야 해") — 예전엔 여기서 매 렌더마다
      // Archive.save('gwansang')를 불러 보관함에 스냅샷을 다시 찍어 "동기화"를 흉내냈다. 그런데
      // 그 스냅샷 자체가 실제 도감과는 별개의 사본이라, 도감을 지워도 스냅샷이 살아남거나 반대로
      // 스냅샷만 지워지고 도감은 살아남아 "삭제해도 다시 생긴다"는 사고가 반복됐다(사용자 리포트
      // 2026-08-31). 이제 보관함은 인연도감을 따로 저장하지 않고 Dogam.ensureMyDogam()으로 실물을
      // 그때그때 직접 물어본다(archive.js renderPage 참고) — 여기서 더 이상 찍어둘 스냅샷이 없다.
    }
    if (typeof renderGwansangRevisitCard === 'function') renderGwansangRevisitCard();
    if (stale && stale()) return;
    el.innerHTML = renderOwnerView(myDogam);
    syncLiveBlocks(); // 보관함에서 열어둔 도감 영역도 같은 내용으로 맞춘다(등록·삭제 직후 등)
    if (myDogam && myDogam.slug) watchEntries(myDogam.slug); else stopWatchingEntries();
    maybeShowLoginModal(myDogam); // 정책 2-1 3번 — 오너가 자기 도감(캐릭터 있음)을 볼 때만, 1회
  }

  // "내 도감 보러가기" — 공유 링크(?dogam=code)에 머물던 화면에서 사용자가 직접 눌러야만 내 도감으로
  // 넘어간다(사용자 요청 2026-08-19: 자동 전환 금지). URL에서 code를 지우고 다시 그리면 위 render()가
  // B 규칙(내 도감)을 그린다.
  function leaveSharedView() {
    history.replaceState(null, '', location.origin + location.pathname);
    guestDogam = null;
    render();
  }

  // 보관함 리포트에 덧붙여둔 도감 영역들 — 메인 화면이 다시 그려질 때 함께 갱신한다.
  function syncLiveBlocks() {
    document.querySelectorAll('.arc-live-dogam').forEach(function (el) {
      el.innerHTML = renderOwnerView(myDogam);
    });
  }

  // 보관함에서 연 인연도감 리포트에도 같은 도감 영역(인연 목록·보관 안내·공유·통합분석 CTA)을 붙인다
  // (사용자 요청 2026-08-18). 도감은 친구가 계속 등록되는 실시간 데이터라 리포트 스냅샷에 담지 않고,
  // 열 때마다 지금 상태를 그린다 — 그래서 저장 시점이 아니라 "지금" 등록된 인연이 보인다.
  // #dogamSection(메인 화면)을 건드리지 않으므로 render()와 서로 덮어쓰지 않는다.
  // ⚠️ 사용자 리포트(2026-09-02): 보관함에서 인연도감을 열면 캐릭터 카드/설명이 안 보였다 — 관상 탭의
  // #gwansangCharacterCard·#gwansangCharacterDetail은 관상 탭 고유 DOM이라 이 화면(#arcReportBody)엔
  // 애초에 존재하지 않아서, paintOwnerView가 하는 "캐릭터 복원"이 여기선 채울 대상 자체가 없었다.
  // 친구 초대 화면에서 도감 주인의 캐릭터를 보여줄 때 쓰는 renderCharacterCard+renderOwnerBrief
  // 조합(showGuestView 참고)을 그대로 재사용해, 이 화면 안에 컨테이너를 새로 만들어 채운다.
  async function renderIntoEl(el) {
    if (!el) return;
    try { await CharacterAPI.ensureCharacterCatalog(); } catch (e) { console.warn('[dogam] 캐릭터 카탈로그를 아직 못 받아왔어요', e); }
    const mine = await ensureMyDogam().catch(function (e) {
      console.error('[dogam] 보관함 도감 영역 조회 실패', e);
      return null;
    });
    if (!el.isConnected) return; // 불러오는 사이에 화면을 떠난 경우
    myDogam = mine;
    const charId = mine ? mine.ownerCharacterId : null;
    el.innerHTML = (charId ? '<div id="dogamArcCharCard"></div><div id="dogamArcCharDetail"></div>' : '') + renderOwnerView(mine);
    if (charId) {
      if (typeof renderCharacterCard === 'function') renderCharacterCard('dogamArcCharCard', { characterId: charId });
      renderOwnerBrief('dogamArcCharDetail', charId);
    }
  }

  // 1) 공유자(오너) 입장
  // 정책 9장 — "케미 필터 칩 구간: 일단 기존 관계 라벨을 그대로 탭으로 재사용". relationLabel()이
  // 실제로 내는 4개 라벨과 정확히 맞춰뒀다(하나라도 어긋나면 칩을 눌러도 그 라벨의 참여자가 하나도
  // 안 걸러진다). 필터 상태는 오너/게스트 화면 어느 쪽에서 봐도 같은 하나만 둔다 — 정책이 화면별로
  // 다른 필터를 요구하지 않고, 이번 1차 구현 범위는 "우선 재사용"이었다.
  const RELATION_LABELS = ['귀인', '단짝', '내 사람', '호랑이 선생'];
  let entryFilter = null; // null = 전체
  function filterChips(entries) {
    if (!entries || entries.length < 2) return ''; // 인원이 1명 이하면 걸러볼 의미가 없다
    const chip = function (label, value) {
      const active = entryFilter === value;
      const arg = value === null ? 'null' : "'" + value + "'";
      return '<button type="button" class="rel-chip' + (active ? ' on' : '') + '" onclick="Dogam.setEntryFilter(' + arg + ')">' + esc(label) + '</button>';
    };
    return '<div class="chip-row" style="margin-bottom:10px;">' + chip('전체', null) + RELATION_LABELS.map(function (l) { return chip(l, l); }).join('') + '</div>';
  }
  function applyEntryFilter(entries) {
    if (!entryFilter) return entries;
    return entries.filter(function (e) { return e.relation === entryFilter; });
  }
  // 칩을 눌렀을 때 — 지금 보고 있는 화면이 오너 화면인지 게스트 화면(등록 폼/병합 결과)인지에 맞춰
  // 그 화면만 다시 그린다. 필터는 화면 종류를 안 바꾸므로 render() 전체를 다시 태울 필요는 없다.
  function setEntryFilter(value) {
    entryFilter = value;
    if (myDogam && document.getElementById('dogamSection')) {
      host().innerHTML = renderOwnerView(myDogam);
      syncLiveBlocks();
    } else if (guestDogam) {
      if (justRegistered && justRegistered.slug === sharedSlugFromUrl()) renderGuestMergedResult(guestDogam, justRegistered);
      else showGuestView(guestDogam);
    }
  }

  function renderOwnerView(dogam) {
    const entries = (dogam && dogam.entries) || [];
    const count = entries.length;
    const filtered = applyEntryFilter(entries);
    // 익명 인증은 "로그인"이 아니다 — 기기/브라우저에 묶인 임시 신원이라 보관 안내는 계속 띄운다.
    const loggedIn = !!currentUid() && !isAnonymousUser();

    const list = filtered.length
      ? filtered.map(function (e) { return entryRow(e, { canDelete: true }); }).join('')
      : (count ? '<p class="dogam-empty">이 조건에 맞는 인연이 없어요.</p>'
               : '<p class="dogam-empty">아직 어떤 인연도 등록되지 않았어요.<br>친구들과 공유해서 내 인연을 등록해보세요.</p>');

    return '' +
      matchedBlock() +
      '<div class="dogam-block">' +
        '<div class="dogam-head">' +
          '<span class="dogam-title">인연 도감</span>' +
          '<span class="dogam-count">' + count + '명</span>' +
        '</div>' +
        filterChips(entries) +
        '<div class="dogam-list">' + list + '</div>' +
        keepNotice(loggedIn) +
      '</div>' +
      policyBlock(!!dogam) +
      actionButtons(dogam, loggedIn);
  }

  // 등록 직후 — 나를 초대해준 사람과의 매칭 결과. 내 캐릭터 리포트 바로 아래에 붙어
  // "누구와 어떻게 맺어졌는지"를 먼저 보여주고, 그 다음에 인연 도감이 이어진다.
  function matchedBlock() {
    const m = lastMatch;
    if (!m || !m.characterId) return '';
    const ch = (typeof CHARACTER_DB !== 'undefined' && CHARACTER_DB[m.characterId]) || null;
    const img = (typeof getCharacterIllustration === 'function') ? getCharacterIllustration(m.characterId) : '';
    return '' +
      '<div class="dogam-block dogam-matched">' +
        '<div class="dogam-head"><span class="dogam-title">방금 맺은 인연</span></div>' +
        '<p class="dogam-guide">' + esc(m.name) + '님과 서로의 인연도감에 등록됐어요.</p>' +
        '<div class="dogam-match-row">' +
          '<img class="dogam-match-thumb" src="' + esc(img) + '" alt="' + esc(ch ? ch.name : '') + '">' +
          '<div class="dogam-match-body">' +
            '<div class="dogam-row-name">' + esc(m.name) +
              '<span class="dogam-row-tag">' + esc(m.relation || '') + '</span></div>' +
            '<div class="dogam-row-desc">' + esc(ch ? ch.name + ' · ' + ch.headline : '') + '</div>' +
          '</div>' +
          '<div class="dogam-match-score"><b>' + (m.score == null ? '-' : m.score) + '</b><span>매칭</span></div>' +
        '</div>' +
      '</div>';
  }

  // 비로그인은 익명 신원이라 이 기기/브라우저에만 묶인다 — 기록을 지우거나 기기를 바꾸면 도감을 잃는다.
  // 그 사실을 인연 목록 바로 아래(같은 카드 안)에서 알린다. 쌓인 인연을 눈으로 본 직후라야
  // "이걸 잃을 수 있다"가 와닿는다. 스타일은 업로드 화면의 안심 안내(.reassure-box)를 그대로 쓴다.
  // 인연도감 서비스 정책.md v4 2-1 3번/7장 — "지속 인라인 배너"에 해당. 문구를 정책이 제시한
  // 표현("회원가입 전 도감은 이 기기·브라우저에만 연결돼 있어요... 방장 권한과 보관함 연결을
  // 잃을 수 있어요")에 맞춰 다시 썼다. 로그인 전까지 매번 그대로 노출되고(사주도령 방식), 모달과
  // 달리 "한 번만"이 아니다 — 그래서 별도 노출 이력 관리 없이 loggedIn 여부만으로 매번 판단한다.
  function keepNotice(loggedIn) {
    if (loggedIn) return '';
    return '' +
      '<div class="reassure-box dogam-keep">' +
        '<div class="reassure-head">' +
          '<span class="icon material-symbols-outlined">info</span>' +
          '<span class="label">회원가입 전이에요</span>' +
        '</div>' +
        '<p class="reassure-sub">지금 도감은 이 기기·브라우저에만 연결돼 있어요. 기기를 바꾸거나 브라우저 기록을 지우면 방장 권한과 보관함 연결을 잃을 수 있어요.</p>' +
        '<button class="submit-btn" onclick="Dogam.loginAndKeep()">로그인하고 내 인연도감 유지하기</button>' +
      '</div>';
  }

  // 인연도감 서비스 정책.md v4 2-1 3번/7장 — "로그인 유도 모달".
  // ⚠️ 2026-09-04 사용자 요청으로 노출 규칙 변경 — 처음엔 "닫으면(로그인하러 가든 X·바깥 클릭이든
  // "나중에 할게요"든) 다시는 안 뜬다"였는데, X·바깥 클릭처럼 그냥 닫기만 한 경우까지 영구히 숨기는 건
  // 과했다. 이제 "나중에 할게요"를 눌렀을 때만 24시간 동안 안 뜨고(snoozeLoginModal), 그 외의 방법
  // (X 버튼·바깥 클릭)으로 닫으면 아무 기록도 남기지 않아 다음에 이 도감을 열면 바로 다시 뜬다.
  // 예전엔 localStorage에 "본 적 있음"만 영구 기록했는데, 지금은 "언제까지 미뤘는지" 타임스탬프를
  // 남겨서 그 시각이 지나면 자연히 다시 노출되게 한다.
  function maybeShowLoginModal(dogam) {
    if (!dogam || !dogam.slug || !dogam.ownerCharacterId) return;
    if (!!currentUid() && !isAnonymousUser()) return; // 이미 로그인 — 유도할 필요 없음
    const key = 'dogamLoginModalSnoozeUntil:' + dogam.slug;
    try {
      const until = Number(localStorage.getItem(key) || 0);
      if (until && Date.now() < until) return; // "나중에 할게요"로 미뤄둔 24시간 안이면 스킵
    } catch (e) { return; }
    if (document.getElementById('dogamLoginModalRoot')) return; // 이미 떠 있음(중복 방지)
    const root = document.createElement('div');
    root.id = 'dogamLoginModalRoot';
    // 사용자 요청(2026-09-05, 8차 피드백) — 짧은 확인 모달인데 .form-popup 기본값(top:8vh~bottom:0,
    // 화면의 92%를 강제로 채움)을 그대로 써서 버튼 아래로 빈 공간이 크게 남았다. 같은 패턴의 다른
    // 로그인 팝업(js/kakao-auth.js openLoginPopup)은 이미 "small" 변형(내용 높이만큼만)을 쓰고 있어서
    // 그걸 그대로 맞춘다. 문구도 헤더/본문 메인/서브/유의사항 콜아웃/CTA로 재구성.
    root.innerHTML = '' +
      '<div class="overlay-backdrop" onclick="Dogam.dismissLoginModal()"></div>' +
      '<div class="form-popup small">' +
        '<div class="popup-header">' +
          '<span>인연도감 보관하기</span>' +
          '<button class="overlay-close" onclick="Dogam.dismissLoginModal()"><span class="material-symbols-outlined">close</span></button>' +
        '</div>' +
        '<div class="popup-body">' +
          '<p class="dogam-guide" style="font-size:16px;font-weight:700;color:var(--text-title);">인연도감을 계정에 보관할까요?</p>' +
          '<p class="dogam-guide">지금 로그인하면 접속 기기를 바꾸거나 브라우저 기록을 지워도 보관된 인연도감을 언제든지 펼치고 관리할 수 있어요.</p>' +
          '<div class="tip-box">' +
            '<span class="icon material-symbols-outlined">warning</span>' +
            '<p>지금 건너뛰면 이 인연도감은 현재 접속 기기에만 연결돼서, 사라질 수 있어요</p>' +
          '</div>' +
          '<button class="submit-btn" onclick="Dogam.dismissLoginModal();Dogam.loginAndKeep();">로그인하고 보관하기</button>' +
          '<button type="button" style="display:block;width:100%;margin-top:10px;padding:10px;background:none;border:none;color:var(--text2);font-size:13px;cursor:pointer;" onclick="Dogam.snoozeLoginModal(\'' + dogam.slug + '\')">나중에 할게요</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(root);
    document.body.classList.add('overlay-open');
  }
  function dismissLoginModal() {
    const root = document.getElementById('dogamLoginModalRoot');
    if (root) root.remove();
    document.body.classList.remove('overlay-open');
  }
  // "나중에 할게요" 전용 — 24시간 동안만 다시 안 뜨도록 만료 시각을 남기고 닫는다.
  function snoozeLoginModal(slug) {
    const ONE_DAY_MS = 24 * 60 * 60 * 1000;
    try { localStorage.setItem('dogamLoginModalSnoozeUntil:' + slug, String(Date.now() + ONE_DAY_MS)); }
    catch (e) { /* 프라이빗 브라우징 등 — 못 남기면 다음에 또 뜨는 것으로 그친다(안전한 쪽) */ }
    dismissLoginModal();
  }

  // 참여자 상세 재열람용 캐시(정책 2-3/7장) — "재방문 참여자" 분기를 없앤 대신, 목록에서 본인(또는
  // 아무 참여자) 항목을 탭하면 등록 당시 케미 상세를 다시 볼 수 있게 한다. uid로 찾을 수 있게
  // entryRow가 그릴 때마다 채워둔다 — Firestore에서 다시 조회하지 않고 이미 받아온 값만 재사용.
  let entryLookup = {};

  function entryRow(e, opts) {
    entryLookup[e.uid] = e;
    const ch = (typeof CHARACTER_DB !== 'undefined' && CHARACTER_DB[e.characterId]) || null;
    const img = (typeof getCharacterIllustration === 'function') ? getCharacterIllustration(e.characterId) : '';
    // 삭제는 오너가 자기 도감을 볼 때만 노출한다(정책 4장 "오너의 참여자 삭제 — 단방향, 상대 도감엔
    // 영향 없음"). 게스트 화면(guestEntriesBlock)은 opts 없이 호출되므로 버튼이 안 붙는다.
    const delBtn = (opts && opts.canDelete)
      ? '<button type="button" class="revisit-del" title="삭제" onclick="event.stopPropagation();Dogam.deleteEntry(\'' + esc(e.uid) + '\')"><span class="material-symbols-outlined">close</span></button>'
      : '';
    return '' +
      '<div class="dogam-row" role="button" tabindex="0" style="cursor:pointer;" onclick="Dogam.showEntryDetail(\'' + esc(e.uid) + '\')">' +
        '<img class="dogam-row-thumb" src="' + esc(img) + '" alt="' + esc(ch ? ch.name : '') + '">' +
        '<div class="dogam-row-body">' +
          '<div class="dogam-row-name">' + esc(e.name) +
            '<span class="dogam-row-tag">' + esc(e.relation || '') + '</span></div>' +
          '<div class="dogam-row-desc">' + esc(ch ? ch.name + ' · ' + ch.headline : '') + '</div>' +
        '</div>' +
        '<div class="dogam-row-score"><b>' + (e.score == null ? '-' : e.score) + '</b><span>점</span></div>' +
        delBtn +
      '</div>';
  }

  // 정책 4장 — "오너의 참여자 삭제 기능 추가(단방향 — 상대 도감엔 영향 없음)". firestore.rules가
  // 이미 "entryUid 본인 또는 dogam.ownerUid인 사람"의 delete를 허용하고 있어(오늘 세션에 확인됨)
  // 규칙 변경 없이 클라이언트에서 바로 문서를 지우면 된다 — 상대방 도감 쪽 entries는 별개 문서라
  // 손대지 않는다.
  async function deleteEntry(uid) {
    if (!myDogam || !myDogam.slug) return;
    const e = entryLookup[uid];
    const label = e ? e.name : '이 인연';
    if (!confirm(label + '님을 내 인연도감에서 삭제할까요?\n(상대방의 도감에는 영향이 없어요)')) return;
    try {
      await fbDb.collection('dogam').doc(myDogam.slug).collection('entries').doc(uid).delete();
      myDogam.entries = (myDogam.entries || []).filter(function (x) { return x.uid !== uid; });
      host().innerHTML = renderOwnerView(myDogam);
      syncLiveBlocks();
    } catch (err) {
      alert('삭제 중 문제가 생겼어요. 잠시 후 다시 시도해줘.');
    }
  }

  // 참여자 행 클릭 시 등록 당시 케미 상세를 다시 보여준다 — 새로 계산·조회하지 않고 entryRow가
  // 그릴 때 이미 받아온 값(entryLookup)만 그대로 재사용한다. 오버레이 마크업/클래스는 profile.js가
  // 쓰는 것과 같은 걸 재사용해 새 CSS 없이 바로 붙는다.
  function showEntryDetail(uid) {
    const e = entryLookup[uid];
    if (!e) return;
    closeEntryDetail();
    const root = document.createElement('div');
    root.id = 'dogamEntryDetailRoot';
    root.innerHTML = '' +
      '<div class="overlay-backdrop" onclick="Dogam.closeEntryDetail()"></div>' +
      '<div class="form-popup">' +
        '<div class="popup-header">' +
          '<span>' + esc(e.name) + '님과의 인연</span>' +
          '<button class="overlay-close" onclick="Dogam.closeEntryDetail()"><span class="material-symbols-outlined">close</span></button>' +
        '</div>' +
        '<div class="popup-body">' +
          '<div id="dogamEntryDetailCard"></div>' +
          '<div class="dogam-match-row" style="margin-top:12px;">' +
            '<div class="dogam-match-body">' +
              '<div class="dogam-row-name">' + esc(e.name) + '님과의 궁합' +
                '<span class="dogam-row-tag">' + esc(e.relation || '') + '</span></div>' +
            '</div>' +
            '<div class="dogam-match-score"><b>' + (e.score == null ? '-' : e.score) + '</b><span>점</span></div>' +
          '</div>' +
        '</div>' +
      '</div>';
    document.body.appendChild(root);
    document.body.classList.add('overlay-open');
    if (typeof renderCharacterCard === 'function') renderCharacterCard('dogamEntryDetailCard', { characterId: e.characterId });
  }
  function closeEntryDetail() {
    const root = document.getElementById('dogamEntryDetailRoot');
    if (root) root.remove();
    document.body.classList.remove('overlay-open');
  }

  // ⚠️ 정책 개편(인연도감 서비스 정책.md 3장, 2026-09-05 — "대표 도감" 개념 폐기) — 예전엔 캐릭터가
  // 다른 도감이 충돌하면 자동으로 고른 도감을 "대표"로 쓰고 나머지는 "비대표"로 접어서 계속 남겨뒀다
  // (골라도 삭제되지 않고, 안 골라도 그대로 남는 방식). 이제는 계정당 도감이 항상 정확히 1개여야
  // 한다 — 후보 도감(지금 쓰고 있는 myDogam 포함) 전부를 동등한 선택지로 보여주고, 사용자가 하나를
  // 고르면 그 즉시 나머지는 완전히 삭제한다. 캐릭터가 같은 도감은 여기까지 오지 않는다(서버가
  // settleDogamForUid에서 이미 자동 병합 — notifyDogamMerged로 안내). 캐릭터가 다른 경우에만
  // kakaoLogin 응답의 dogamConflicts에 실려 여기로 온다.
  let conflictCandidates = null; // 지금 화면에 떠 있는 선택지의 slug 전체 — 하나를 고르면 나머지를 지우는 데 쓴다
  function conflictCardHtml(c) {
    const ch = (typeof CHARACTER_DB !== 'undefined' && CHARACTER_DB[c.ownerCharacterId]) || null;
    const img = (typeof getCharacterIllustration === 'function') ? getCharacterIllustration(c.ownerCharacterId) : '';
    return '' +
      '<div class="dogam-row" style="cursor:default;">' +
        '<img class="dogam-row-thumb" src="' + esc(img) + '" alt="' + esc(ch ? ch.name : '') + '">' +
        '<div class="dogam-row-body">' +
          '<div class="dogam-row-name">' + esc(c.ownerName || '') + '<span class="dogam-row-tag">' + esc(ch ? ch.name : '') + '</span></div>' +
          '<div class="dogam-row-desc">' + esc('인연 ' + c.entryCount + '명') + '</div>' +
        '</div>' +
      '</div>' +
      '<div style="margin:8px 0 16px 50px;">' +
        '<button type="button" class="submit-btn" style="padding:8px 14px;font-size:13px;width:auto;" onclick="Dogam.chooseDogam(\'' + esc(c.slug) + '\')">이 도감으로 계속 쓰기</button>' +
      '</div>';
  }
  // ⚠️ 이 화면은 의도적으로 닫을 수 없다(overlay-close 버튼도, backdrop onclick도 없음) — 정책
  // 문서가 "반드시 하나 고를 때까지 모달 유지"로 확정했기 때문. 골라야만 다음으로 넘어간다.
  function showDogamConflict(conflicts) {
    if (!conflicts || !conflicts.length || !myDogam) return;
    closeDogamConflict();
    const candidates = [{ slug: myDogam.slug, ownerCharacterId: myDogam.ownerCharacterId, ownerName: myDogam.ownerName, entryCount: (myDogam.entries || []).length }]
      .concat(conflicts.map(function (c) { return { slug: c.slug, ownerCharacterId: c.ownerCharacterId, ownerName: c.ownerName, entryCount: c.entryCount }; }));
    conflictCandidates = candidates.map(function (c) { return c.slug; });
    const root = document.createElement('div');
    root.id = 'dogamConflictRoot';
    root.innerHTML = '' +
      '<div class="overlay-backdrop"></div>' +
      '<div class="form-popup">' +
        '<div class="popup-header">' +
          '<span>인연도감이 여러 개 있어요</span>' +
        '</div>' +
        '<div class="popup-body">' +
          '<p class="dogam-guide">다른 기기·브라우저에서 이미 만든 인연도감이 있어요. 계정에는 인연도감을 하나만 둘 수 있어서, 계속 쓸 도감을 하나 골라주세요. 고르지 않은 도감은 완전히 삭제되고 되돌릴 수 없어요.</p>' +
          candidates.map(conflictCardHtml).join('') +
        '</div>' +
      '</div>';
    document.body.appendChild(root);
    document.body.classList.add('overlay-open');
  }
  function closeDogamConflict() {
    const root = document.getElementById('dogamConflictRoot');
    if (root) root.remove();
    document.body.classList.remove('overlay-open');
  }
  // 고른 도감만 남기고 나머지는 이 자리에서 바로 지운다 — deleteMyDogam()과 같은 순서(entries
  // 전부 삭제 후 도감 문서 삭제)를 후보 전체에 반복 적용한다. 확인창을 따로 두지 않는 이유는
  // showDogamConflict의 안내 문구에 "고르지 않은 도감은 완전히 삭제된다"를 이미 명시해뒀기 때문
  // (또 한 번 confirm을 띄우면 "골랐는데 왜 또 물어보나"는 혼란만 준다).
  async function chooseDogam(chosenSlug) {
    const uid = currentUid();
    if (!uid || !window.fbDb || !conflictCandidates) return;
    const others = conflictCandidates.filter(function (s) { return s !== chosenSlug; });
    try {
      await fbDb.collection('users').doc(uid).set({ dogamSlug: chosenSlug }, { merge: true });
      localStorage.setItem(SLUG_KEY, chosenSlug);
      for (const slug of others) {
        const ref = fbDb.collection('dogam').doc(slug);
        const entriesSnap = await ref.collection('entries').get();
        for (const d of entriesSnap.docs) await d.ref.delete();
        await ref.delete();
      }
      conflictCandidates = null;
      myDogam = null; // 다음 render()가 방금 고른 도감을 새로 읽도록 캐시를 비운다
      closeDogamConflict();
      toast('선택한 인연도감으로 정리했어요');
      await render();
    } catch (e) {
      alert('정리하는 중 문제가 생겼어요. 잠시 후 다시 시도해줘.');
    }
  }
  // 캐릭터가 같아서 서버가 자동으로 합친 경우 — 데이터는 안 잃었지만 "도감 하나가 사라졌다"는 사실
  // 자체는 사용자에게 조용히 묻히면 안 된다는 요청(2026-09-04)에 따라 매번 명시적으로 알린다.
  function notifyDogamMerged(count) {
    alert('다른 곳에서 만든 인연도감이 지금 도감으로 합쳐졌어요.\n(중복 도감 ' + count + '개, 등록됐던 인연은 모두 그대로 보존됐어요)');
  }

  function policyBlock(showDelete) {
    return '' +
      '<details class="dogam-policy">' +
        '<summary>도감 보관·삭제 안내</summary>' +
        DOGAM_POLICY.map(function (p) {
          return '<div class="dogam-policy-item"><b>' + esc(p.q) + '</b><p>' + p.a + '</p></div>';
        }).join('') +
        // 안내문에 "도감 전체를 삭제할 수 있어요"라고 써놓고 실제 삭제 수단이 없으면 고지와 실제가 어긋난다.
        (showDelete ? '<button class="dogam-delete-btn" onclick="Dogam.deleteMyDogam()">내 인연도감 삭제하기</button>' : '') +
      '</details>';
  }

  // 도감 전체 삭제 — 참여 기록(entries)을 먼저 지운다. Firestore는 상위 문서를 지워도 하위 컬렉션이
  // 남아 접근 불가능한 데이터가 되기 때문(만료 배치 cleanupExpiredDogam과 같은 순서).
  async function deleteMyDogam() {
    // 클라우드에 도감이 없더라도(예전 버전에서 만들어져 로컬 흔적만 남은 경우) 이 기기 흔적은 지운다.
    // 그렇지 않으면 "이미 만드신 도감이 있어요" 카드만 영원히 남아 삭제가 안 되는 것처럼 보인다.
    const mine = myDogam || (await ensureMyDogam().catch(function () { return null; }));
    if (!mine) {
      if (!confirm('이 기기에 남아 있는 도감 기록을 지울까요?')) return;
      forgetLocalDogam();
      myDogam = null;
      // 인연도감에서 지웠으면 보관함의 "인연도감" 리포트도 같이 없어져야 한다(사용자 요청
      // 2026-08-18) — Archive.remove(id)와 달리 확인창 없이 조용히 지우는 캐스케이드용 함수다.
      if (window.Archive && Archive.removeReportsByType) Archive.removeReportsByType('gwansang');
      location.reload(); // 부분 재렌더 대신 새로고침으로 확실하게 반영(사용자 요청 2026-08-18)
      return;
    }
    // ⚠️ 버그 리포트(2026-08-18): 실계정으로 로그인했던 기기는 로그아웃해도 SLUG_KEY 캐시가 그대로
    // 남아, ensureMyDogam()이 "로그인 안 했으니 소유자 대조 없이 이 기기 캐시를 믿는다" 규칙으로
    // 그 실계정의 진짜 도감을 계속 보여준다(로그아웃해도 목록이 안 사라지게 한 의도된 동작).
    // 문제는 "보여주기"까지는 괜찮지만 "삭제"에도 같은 규칙이 적용돼, 로그인조차 안 한 상태에서
    // 다른 기기에 있는 실계정의 도감(과 친구 전원)을 지울 수 있었다 — 실제로 이렇게 날아갔다는 리포트.
    // 실계정 uid는 이 앱에서 항상 'kakao_' 접두어를 쓰므로(익명 uid는 Firebase가 무작위로 발급),
    // 지금 로그인이 안 된 상태에서 그 접두어를 가진 도감을 지우려 하면 막고 로그인부터 하게 한다.
    const isLoggedIn = !!currentUid() && !isAnonymousUser();
    if (!isLoggedIn && /^kakao_/.test(mine.ownerUid || '')) {
      alert('이 인연도감은 로그인된 계정에 연결돼 있어요.\n삭제하려면 먼저 그 계정으로 로그인해주세요.');
      return;
    }
    if (!confirm('내 인연도감을 삭제할까요?\n등록된 인연 ' + (mine.entries || []).length + '명도 함께 사라지고, 되돌릴 수 없어요.')) return;
    try {
      // ⚠️ 버그 리포트(2026-08-31: "삭제해도 계속 생겨") — 예전엔 mine.slug 하나만 지웠는데,
      // migrateAnonymousData가 계정에 이미 도감이 있는지 확인 없이 익명 도감을 계속 이관해온 탓에
      // 같은 ownerUid 밑에 도감이 여러 개 쌓인 계정이 있었다(functions/index.js settleDogamForUid
      // 참고 — 로그인 시점에 정리하는 서버 로직을 새로 넣었지만, 로그아웃 없이 계속 로그인된 채로
      // 테스트하면 그 로직이 아예 실행되지 않는다). "내 도감 삭제"는 지금 보이는 slug 하나가 아니라
      // 이 ownerUid가 가진 도감 전부를 지워야 "지웠는데 다른 게 다시 나타나는" 일이 없다.
      const ownerUid = mine.ownerUid;
      const ownedSnap = await fbDb.collection('dogam').where('ownerUid', '==', ownerUid).get();
      let totalEntries = 0;
      for (const dogamDoc of ownedSnap.docs) {
        const col = dogamDoc.ref.collection('entries');
        const entriesSnap = await col.get();
        for (const d of entriesSnap.docs) await d.ref.delete();
        await dogamDoc.ref.delete();
        totalEntries += entriesSnap.size;
      }
      // ⚠️ 상대 도감에 남아 있는 "내 기록"은 일부러 건드리지 않는다(사용자 확인 2026-08-17).
      // 그건 상대의 도감이고, 지우고 싶으면 본인이 자기 기기에서 지울 수 있다(정책 문구 §삭제).
      const uid = currentUid();
      if (uid) {
        await fbDb.collection('users').doc(uid)
          .set({ dogamSlug: firebase.firestore.FieldValue.delete() }, { merge: true })
          .catch(function (e) { console.warn('[dogam] dogamSlug 정리 실패', e); });
      }
      forgetLocalDogam();
      myDogam = null;
      console.log('[dogam] 도감 삭제 완료', { ownerUid: ownerUid, dogamCount: ownedSnap.size, entries: totalEntries });
      // 인연도감 삭제 → 보관함의 "인연도감" 리포트도 함께 삭제(사용자 요청 2026-08-18).
      if (window.Archive && Archive.removeReportsByType) Archive.removeReportsByType('gwansang');
      location.reload(); // 부분 재렌더 대신 새로고침으로 확실하게 반영(사용자 요청 2026-08-18)
    } catch (e) {
      console.error('[dogam] 도감 삭제 실패', e);
      alert('삭제 중 오류가 발생했어요.\n' + ((e && e.message) || e));
    }
  }

  // 이 기기에 남은 도감 흔적 정리 — 도감을 지웠는데 "이미 만드신 도감이 있어요" 카드가 남으면
  // 사용자 눈에는 삭제가 안 된 것으로 보인다(실제로 그런 신고가 있었다).
  function forgetLocalDogam() {
    localStorage.removeItem(SLUG_KEY);
    lastMatch = null;
    localStorage.removeItem(inyeonCharacterKey());
    // ⚠️ 진짜 원인(2026-09-01, 콘솔로 확인): 위 removeItem은 "이 계정 전용" 캐릭터 캐시만 지운다.
    // migrateLocalOnLogin()이 로그인/새로고침(세션 복원)마다 매번 실행되면서 "계정 전용 캐시가
    // 비어 있으면 로그인 전(게스트) 캐시 inyeonLastCharacter(계정 접미사 없는 bare key)에서 복사해온다"
    // 는 로직을 갖고 있는데, 그 bare key는 방금 위에서 안 지웠다 — 그래서 삭제 직후 재로그인/새로고침될
    // 때마다 게스트 캐시가 계정 캐시로 다시 복사되고, render()가 그 값을 보고 "캐릭터는 있는데 도감이
    // 없네"라며 새 도감을 즉시 자동 생성해버렸다(사용자 리포트: "삭제해도 새로고침하자마자 바로 다시
    // 떠 있어"). bare key까지 함께 지워야 migrateLocalOnLogin이 복사해올 것 자체가 없어진다.
    localStorage.removeItem(INYEON_LAST_CHARACTER_KEY);
    localStorage.removeItem('gwansangReportOpen'); // 도감을 지웠으니 새로고침 시 리포트도 되살리지 않는다
    if (typeof renderGwansangRevisitCard === 'function') renderGwansangRevisitCard();
  }

  // 요청받은 버튼 분기: ① 비로그인이면 로그인 유도 ② 친구에게 공유 ③ 통합분석 이동
  // 로그인은 "도감을 계정에 묶어 오래 보관"하는 후킹일 뿐이라, 비로그인이어도 공유는 막지 않는다.
  function actionButtons(dogam, loggedIn) {
    // 공유 버튼은 마이페이지 "변경" 버튼(.mypage-rep-change)과 같은 그레이 라인 디자인.
    const shareBtn = '<button class="dogam-share-btn" onclick="Dogam.share()">' +
      '<span class="material-symbols-outlined">link</span>친구에게 공유하기</button>';
    const primary = shareBtn;
    // 노출스펙 §4 A안 — "더 자세히"가 아니라 "지금 건 반쪽이었다"로 후킹한다.
    // 사주를 더하면 Face 100% → 70/30으로 실제로 재계산돼 캐릭터가 바뀔 수 있으므로 빈말이 아니다.
    // 배치도 스펙대로 맨 아래, 공유 버튼 다음(공유가 1순위).
    const charId = myCharacterId();
    const charName = (charId && typeof CHARACTER_DB !== 'undefined' && CHARACTER_DB[charId])
      ? CHARACTER_DB[charId].name : '지금 이 캐릭터';
    return '' +
      '<div class="dogam-actions">' +
        primary +
      '</div>' +
      '<div class="dogam-cta">' +
        '<div class="dogam-cta-head">' +
          '<span class="dogam-cta-thumb"><img src="images/Logo.png" alt=""></span>' +
          '<div class="dogam-cta-text">' +
            '<div class="dogam-cta-title">지금 결과는 <b>얼굴만</b> 본 거예요</div>' +
            '<p class="dogam-cta-copy">태어난 시간까지 더하면 <b>' + esc(charName) + '</b> 그대로일까요? ' +
              '아니면 전혀 다른 상이 나올까요?</p>' +
          '</div>' +
        '</div>' +
        '<button class="dogam-cta-btn" onclick="Dogam.goCombined()">관상에 사주까지 더해 깊게 보기' +
          '<span class="material-symbols-outlined">chevron_right</span></button>' +
      '</div>';
  }

  // 초대한 사람 소개 — 리포트 상세(renderCharacterDetail)와 같은 클래스를 쓰되
  // 배지·한줄평·유래·"이런 점이 강해요"까지만 자른다. 그 아래(궁합/조심할 점/상황별)는
  // 등록을 결정하는 데 필요 없고, 길어지면 등록 폼이 화면 밖으로 밀린다.
  function renderOwnerBrief(elId, characterId) {
    const el = document.getElementById(elId);
    if (!el) return;
    const c = (typeof CHARACTER_DB !== 'undefined' && CHARACTER_DB[characterId]) || null;
    if (!c) { el.innerHTML = ''; return; }
    el.innerHTML =
      '<div class="char-detail">' +
        '<div class="char-detail-head">' +
          // 배지는 내 리포트(renderCharacterDetail)와 같은 근거 표기를 쓴다 — 여기만 modernRole을
          // 넣으면 같은 캐릭터인데 화면마다 배지가 달라 보인다(실제로 그렇게 보였다).
          '<span class="char-detail-role">관상 기반 유형</span>' +
          '<div class="char-detail-headline">' + esc(c.headline) + '</div>' +
        '</div>' +
        // 노출스펙 §3-3 — 두 필드를 한 문장으로 합치지 않고 각각 노출한다(합성안은 폐기).
        '<div class="char-detail-sec"><div class="char-detail-sec-title">조선시대의 나</div>' +
          '<div class="char-detail-origin">' + esc(c.historical_role) + '</div></div>' +
        '<div class="char-detail-sec"><div class="char-detail-sec-title">지금의 나</div>' +
          '<div class="char-detail-origin">' + esc(c.modernRole) + '</div></div>' +
        '<div class="char-detail-sec">' +
          '<div class="char-detail-sec-title">이런 점이 강해요</div>' +
          '<ul class="char-detail-list is-strength">' +
            (c.strengths || []).map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') +
          '</ul>' +
        '</div>' +
      '</div>';
  }

  // 게스트 화면에 공통으로 필요한 DOM 정리(히어로/CTA/캔버스 숨기기) — showGuestView와
  // renderGuestMergedResult(병합 결과 화면) 둘 다 같은 준비가 필요해 공용 함수로 뺐다.
  function prepGuestScreen() {
    const el = guestHost();
    if (!el) return null;
    stashUploadNodes();                 // innerHTML로 지워지지 않도록 원래 자리로 잠시 되돌린다
    setDisplay('gwansangHero', 'none'); // "내 얼굴 주변엔 어떤 인연이 있을까?" 히어로는 이 화면에선 방해된다
    setDisplay('gwansangRevisitLabel', 'none');
    setDisplay('gwansangRevisitCard', 'none');
    // 하단 고정 CTA("내 관상 캐릭터 뽑기")는 스스로 들어온 사람을 위한 것 —
    // 초대받은 사람은 "도감에 인연 등록하기" 하나로 분석과 등록이 함께 끝나야 버튼이 겹치지 않는다.
    setDisplay('gwansangCtaDock', 'none');
    // ⚠️ 방어적 수정(2026-08-19): 직전에 "내 도감"을 보고 있어서 내 캐릭터 카드(canvasCard·
    // gwansangResult)가 펼쳐진 상태였다면, 친구 도감 화면으로 넘어와도 그 카드는 계속 DOM에 남아
    // #dogamGuestSection 아래에 그대로 노출된다 — 친구 캐릭터만 보여야 하는 화면에 내 캐릭터가
    // 같이 보이면 안 되므로 여기서 명시적으로 숨긴다. classList를 직접 건드리는 이유: 이 두 카드는
    // .hidden 클래스로 상태를 관리하고(style.display가 아님), markAnalyzed()·resetUpload() 등
    // 기존 로직과 같은 방식으로 다뤄야 나중에 다시 열 때도 어긋나지 않는다.
    document.getElementById('canvasCard').classList.add('hidden');
    document.getElementById('gwansangResult').classList.add('hidden');
    return el;
  }

  // 2) 공유받은 친구 입장 — 등록 폼
  //    ① 나를 초대한 사람의 도감(캐릭터 카드)을 맨 위에
  //    ② 그 아래 "내 인연 등록하기" 안에 관상 사진 등록까지 함께 묶는다 — 등록 버튼과 한 덩어리로 읽히도록.
  // ⚠️ 정책 개편(인연도감 서비스 정책.md v4, 2-3) — 예전엔 "이미 등록한 적 있는 재방문"이면 이 폼을
  // 통째로 숨기고 "내 도감 보러가기" 버튼만 보여줬다. 공용기기에서 여러 명이 순서대로 등록하는
  // 상황에서 다음 사람이 이전 사람 화면을 그대로 보게 되는 문제가 있어, 등록 이력과 무관하게
  // 항상 이 폼을 보여주는 것으로 정책이 바뀌었다(4장 "중복 등록 허용"과도 일관).
  function showGuestView(dogam) {
    const el = prepGuestScreen();
    if (!el) return;
    setDisplay('gwansangUploadSection', '');
    // ⚠️ 버그 수정(2026-09-04 사용자 리포트: "도감 공유하고 나서 보니 정책 안내 밑에 인연도감~이름
    // 또는 별명 입력창이 또 나온다") — #gwansangOwnerNameBlock(A 전용 닉네임 입력)과 #gwansangOwnerAgreeBlock
    // (A 전용 동의 체크박스, 2026-09-05 추가)은 gwansangInputCard 안에 중첩돼 있어 captureUploadNodes()가
    // 카드째로 캡처할 때 같이 딸려 나온다(둘 다 top-level이 아니라 skip 목록으로는 못 막음) — B에게는
    // 둘 다 필요 없으니(자기 이름은 #dogamGuestName, 자기 동의는 #dogamAgree로 따로 있음) 여기서
    // 명시적으로 숨긴다. 안 그러면 #gwansangUploadSection이 이 함수 바로 위에서 다시 보이게 되면서
    // 이 두 블록도 원래 자리에 남아 화면 아래쪽에 혼자 노출된다.
    setDisplay('gwansangOwnerNameBlock', 'none');
    setDisplay('gwansangOwnerAgreeBlock', 'none');

    const myChar = myCharacterId();
    const myName2 = myChar && CHARACTER_DB[myChar] ? CHARACTER_DB[myChar].name : '';
    // 로그인 상태면 카카오 닉네임을 기본값으로 채워둔다(사용자 요청 2026-08-18) — 매번 직접 타이핑
    // 안 해도 되고, 원치 않으면 그대로 지우고 다른 별명으로 바꿀 수 있다.
    const rep = window.Profile ? Profile.getRepresentative() : null;
    const prefillName = (rep && rep.name) || '';

    const registerBlock = '' +
      '<div class="dogam-block">' +
        '<div class="dogam-head"><span class="dogam-title">내 인연 등록하기</span></div>' +
        (myChar
          ? '<p class="dogam-guide">내 관상 캐릭터 <b>' + esc(myName2) + '</b>으로 등록해요.</p>'
          : '<p class="dogam-guide">사진을 올리고 등록하면 관상 분석까지 한번에 진행돼요.</p>') +
        // 2026-09-05(2차 피드백) — A(오너) 화면(index.html #gwansangInputCard)과 순서·구성을 동일하게
        // 맞췄다: 이름(입력+유의사항 콜아웃) → 관상 정보(dogamUploadSlot, A의 사진 영역을 그대로 캡처) →
        // 동의 체크박스 순서. 문구도 A 쪽과 완전히 동일하게 맞춘다(하나만 고치고 다른 쪽을 깜빡하면
        // 문구가 갈라지니 수정할 땐 두 곳 다 같이 봐야 한다 — 정책 문서 2-0 "A/B 항상 동기화" 참고).
        '<label class="field-label" style="display:block;margin:16px 0 8px;">이름</label>' +
        '<input type="text" class="field-input" id="dogamGuestName" maxlength="12" placeholder="이름" value="' + esc(prefillName) + '" style="margin-bottom:8px;">' +
        '<details class="dogam-policy" style="margin-top:0;margin-bottom:12px;">' +
          '<summary style="font-weight:400;">💡실명 대신 별명으로 권장드려요</summary>' +
          '<p style="font-size:12px;line-height:1.7;color:var(--text-sub2);margin-top:8px;">개인정보 보호를 위해 실명 대신 별명을 권해요. 입력한 이름은 이 도감에 표시되고, 도감을 여는 다른 사람에게도 보여요. 전화번호·주소 등 다른 개인정보는 입력하지 마세요.</p>' +
        '</details>' +
        '<div id="dogamUploadSlot"></div>' +
        '<label class="dogam-check"><input type="checkbox" id="dogamAgree">' +
          '<span>입력한 이름과 사진을 인연도감 생성/관리에 이용하는 데 동의해요. <b>(필수)</b></span></label>' +
        // 사진 저장 안내는 이제 A와 같은 안심 콜아웃(dogamUploadSlot에 캡처돼 들어오는 .dogam-policy)이
        // 대신한다 — 여기서 같은 내용을 또 말하면 중복이라 뺐다. "관상 정보는 도감이 삭제되면..."
        // (A 전용, 도감 전체 삭제 안내)과는 의미가 달라서(이건 B 본인 엔트리 삭제 안내) 별도 문장으로
        // 남긴다. 2026-09-05(3차 피드백) — A의 CTA 버튼이 기본 노출로 바뀌면서 짝이던 이 안내도
        // 기본 노출로 통일(더 이상 사진 업로드 여부로 숨기지 않음, A/B 동기화).
        '<p class="dogam-notice" id="dogamDeleteNoticeGuest">등록한 기록은 이 기기에서 언제든 직접 삭제할 수 있고, 도감 주인도 삭제할 수 있어요.</p>' +
        // 사진 업로드는 렌더 이후에 일어나므로 disabled로 막지 않는다 — 누른 시점에 검사해 안내한다.
        '<button class="submit-btn" id="dogamRegisterBtn" onclick="Dogam.registerEntry()">도감에 인연 등록하기</button>' +
      '</div>';

    el.innerHTML = '' +
      '<div class="dogam-block">' +
        '<div class="dogam-head"><span class="dogam-title">' + esc(dogam.ownerName) + '님의 인연도감</span></div>' +
        '<p class="dogam-guide">' + esc(dogam.ownerName) + '님이 나를 인연도감에 초대했어요.</p>' +
        '<div id="dogamOwnerCard"></div>' +
        '<div id="dogamOwnerDetail"></div>' +
      '</div>' +
      registerBlock +
      guestEntriesBlock(dogam) +
      policyBlock();

    // 초대한 사람의 캐릭터는 일러스트 카드 + "이런 점이 강해요"까지만 보여준다.
    // (renderCharacterDetail은 궁합·조심할 점·상황별까지 전부 펼쳐서 등록 폼이 한참 아래로 밀린다)
    if (typeof renderCharacterCard === 'function') {
      renderCharacterCard('dogamOwnerCard', { characterId: dogam.ownerCharacterId });
    }
    renderOwnerBrief('dogamOwnerDetail', dogam.ownerCharacterId);
    // 사진 등록은 항상 "내 인연 등록하기" 안에 묶는다 — 등록 버튼과 한 덩어리로 읽혀야 한다.
    // 예전에 분석한 캐릭터가 남아 있어도 마찬가지다(다른 사진으로 다시 찍을 수 있어야 한다).
    const slot = document.getElementById('dogamUploadSlot');
    if (slot) captureUploadNodes().forEach(function (n) { slot.appendChild(n); });
  }

  // 3) 등록 직후 1회성 병합 결과 화면 (정책 2-2 8번) — 상단 A 결과 고정 + [B 캐릭터 결과 + A기준
  // 케미 점수 + "내 인연도감 만들기" CTA] 병합 섹션 + A 도감 전체 참여자 목록. registerEntry()가
  // justRegistered를 채운 직후에만 render()가 이 함수로 분기한다(showGuestView 대신). 새로고침하면
  // justRegistered가 비워져 다음 render()는 자연히 showGuestView(등록 폼)로 돌아간다 — "1회성" 요구를
  // lastMatch와 같은 방식(메모리 변수만 사용)으로 만족시킨다.
  function renderGuestMergedResult(dogam, match) {
    const el = prepGuestScreen();
    if (!el) return;
    // 업로드 섹션은 이 화면엔 필요 없다(이미 등록을 마쳤으므로) — showGuestView와 달리 숨겨둔다.
    setDisplay('gwansangUploadSection', 'none');

    el.innerHTML = '' +
      '<div class="dogam-block">' +
        '<div class="dogam-head"><span class="dogam-title">' + esc(dogam.ownerName) + '님의 인연도감</span></div>' +
        '<p class="dogam-guide">' + esc(dogam.ownerName) + '님이 나를 인연도감에 초대했어요.</p>' +
        '<div id="dogamOwnerCard"></div>' +
        '<div id="dogamOwnerDetail"></div>' +
      '</div>' +
      '<div class="dogam-block dogam-matched" id="dogamMergedResultBlock">' +
        '<div class="dogam-head"><span class="dogam-title">인연도감 등록 완료</span></div>' +
        '<div id="dogamMyResultCard"></div>' +
        '<div class="dogam-match-row">' +
          '<div class="dogam-match-body">' +
            '<div class="dogam-row-name">' + esc(dogam.ownerName) + '님과의 궁합' +
              '<span class="dogam-row-tag">' + esc(match.relation || '') + '</span></div>' +
          '</div>' +
          '<div class="dogam-match-score"><b>' + (match.score == null ? '-' : match.score) + '</b><span>점</span></div>' +
        '</div>' +
        '<p class="dogam-guide">지금은 ' + esc(dogam.ownerName) + '님 도감에만 등록됐어요. 내 도감도 만들면 나만의 공유 링크가 생겨요.</p>' +
        '<button class="submit-btn" onclick="Dogam.createMyDogamFromInvite()">내 인연도감 만들기</button>' +
      '</div>' +
      guestEntriesBlock(dogam) +
      policyBlock();

    if (typeof renderCharacterCard === 'function') {
      renderCharacterCard('dogamOwnerCard', { characterId: dogam.ownerCharacterId });
      renderCharacterCard('dogamMyResultCard', { characterId: match.characterId });
    }
    renderOwnerBrief('dogamOwnerDetail', dogam.ownerCharacterId);
  }

  // 등록 폼 바로 아래에 "이 도감에 이미 몇 명이 등록했는지"를 보여준다(사용자 요청 2026-08-18:
  // 재미를 위해 등록 전에도 다른 사람들이 얼마나 등록·매칭했는지 보여달라). entries는 public read라
  // 오너 화면(renderOwnerView)과 똑같은 데이터·같은 entryRow 렌더러를 그대로 재사용한다 — 등록하기
  // 전인 손님에게도 "내 사람"/점수까지 그대로 보인다는 뜻이라, 새로운 정보 노출은 아니다.
  function guestEntriesBlock(dogam) {
    const entries = dogam.entries || [];
    const count = entries.length;
    const filtered = applyEntryFilter(entries);
    const list = filtered.length
      ? filtered.map(function (e) { return entryRow(e); }).join('')
      : (count ? '<p class="dogam-empty">이 조건에 맞는 인연이 없어요.</p>'
               : '<p class="dogam-empty">아직 등록된 인연이 없어요. 첫 번째로 등록해보세요!</p>');
    return '' +
      '<div class="dogam-block">' +
        '<div class="dogam-head">' +
          '<span class="dogam-title">인연 도감</span>' +
          '<span class="dogam-count">' + count + '명</span>' +
        '</div>' +
        filterChips(entries) +
        '<div class="dogam-list">' + list + '</div>' +
      '</div>';
  }

  // ── 동작 ─────────────────────────────────────────────────────────────
  async function registerEntry() {
    if (!guestDogam) return;
    // ⚠️ 사용자 리포트(2026-09-04): "등록 누르면 한참 걸리는데 로딩 표시가 없어서 오류난 줄 안다" —
    // 익명 인증 발급부터 얼굴 분석(수 초), 궁합 점수 서버 호출, Firestore 쓰기까지 이어지는 동안
    // 화면에 아무 변화가 없었다. #gwansangSpinner는 이 시점엔 captureUploadNodes()로 이미 등록
    // 폼(#dogamUploadSlot) 안에 옮겨와 있어서(showGuestView 참고) 여기서 그대로 재사용할 수 있다.
    // 버튼도 로딩 중 연타(중복 등록 자체는 정책상 막지 않지만, 불필요한 네트워크 요청만 늘림)를
    // 막기 위해 처리가 끝날 때까지 비활성화한다. 검증 실패로 되돌아가는 경로도 전부 정리해야 하므로
    // 함수 맨 앞에서 한 번만 켜고, 모든 return 지점에서 끄는 짝을 맞춘다.
    const m = ctxMap.gwansang;
    const registerBtn = document.getElementById('dogamRegisterBtn');
    if (registerBtn) registerBtn.disabled = true;
    setSpinner(m.spinner, '등록을 준비하는 중...');
    const stop = function () { hideSpinner(m.spinner); if (registerBtn) registerBtn.disabled = false; };

    let uid;
    try {
      uid = await ensureAuthUid();
    } catch (e) {
      console.error('[dogam] 익명 인증 실패', e);
      stop();
      if (e && e.code === 'auth/operation-not-allowed') {
        alert('로그인 없이 등록하려면 Firebase 콘솔에서 "익명" 로그인을 켜야 해요.\n(Authentication → Sign-in method → 익명)');
      } else {
        alert('등록 준비 중 오류가 발생했어요.\n' + ((e && e.message) || e));
      }
      return;
    }
    if (!uid) { stop(); alert('등록을 처리할 수 없어요. 잠시 후 다시 시도해주세요.'); return; }
    // 2026-09-05(10차 피드백) — 화면 순서(이름 → 관상 정보/사진 → 동의) 그대로 위에서부터 검증한다
    // (A의 startGwansangOwnerAnalysis와 동일한 순서, 정책 2-0 "A/B 항상 동기화"). 예전엔 사진 확인이
    // 동의 확인보다 뒤에 있어서 "사진 안 넣었는데 동의 체크 알림이 먼저 뜨는" 순서 역전이 있었다.
    const nameEl = document.getElementById('dogamGuestName');
    const name = (nameEl && nameEl.value || '').trim();
    if (!name) { stop(); alert('이름을 입력해주세요.'); return; }

    // 초대받은 사람에게는 "내 관상 캐릭터 뽑기" 버튼을 띄우지 않는다 — 이 버튼 하나로 분석까지 끝낸다.
    // 아래 render 과정에서 폼이 다시 그려지므로, 입력값은 이 시점에 이미 name에 담아뒀다.
    let charId = myCharacterId();
    const hasPhoto = (typeof state !== 'undefined' && state.gwansang && state.gwansang.file);
    if (!hasPhoto && !charId) { stop(); alert('사진을 선택해주세요.'); return; }

    const agree = document.getElementById('dogamAgree');
    if (!agree || !agree.checked) { stop(); alert('필수 동의 항목에 체크해주세요.'); return; }
    setSpinner(m.spinner, '관상 캐릭터를 확인하는 중...');

    // ⚠️ 버그 리포트(2026-08-18): 이 브라우저로 이미 한 번 등록해본 적이 있으면(캐릭터가 캐시돼 있으면)
    // 새 사진을 올려도 무시하고 예전 캐릭터로 그대로 등록됐다 — "다른 사진으로 다시 찍을 수 있어야
    // 한다"는 업로드 UI의 의도(showGuestView 주석)와 어긋난다. 새 사진이 올라와 있으면 캐릭터가
    // 이미 있어도 그 사진으로 다시 분석해서 inyeonLastCharacter를 갱신한다 — 사진 없이 등록 버튼만
    // 다시 누른 경우에만(hasPhoto=false) 기존 캐릭터를 그대로 쓴다.
    if (hasPhoto) {
      if (typeof startAnalysis !== 'function') {
        stop();
        alert('분석 기능을 불러오지 못했어요. 새로고침 후 다시 시도해주세요.'); return;
      }
      console.log('[dogam] 새 사진으로 관상 분석 실행');
      await startAnalysis('gwansang'); // 내부에서 같은 스피너를 "관상 분석중~"으로 바꿔 보였다가, 끝나면 스스로 끈다.
      charId = myCharacterId();
      if (!charId) { if (registerBtn) registerBtn.disabled = false; return; } // 얼굴 인식 실패 — startAnalysis가 이미 사유를 화면에 표시한다
      // 분석은 끝났지만 궁합 점수 계산·서버 등록이 아직 남아있으니 스피너를 다시 켠다
      // (startAnalysis가 끝나면서 이미 꺼뒀기 때문에 여기서 다시 안 켜면 이후 구간이 무반응처럼 보인다).
      setSpinner(m.spinner, '인연도감에 등록하는 중...');
    }

    const score = await compatScore(guestDogam.ownerCharacterId, charId);
    const inviter = guestDogam;
    try {
      // 친구 도감에 나를 등록 — 문서 id를 내 uid로 둬서 중복 등록을 막고 본인 삭제 권한을 명확히 한다.
      await fbDb.collection('dogam').doc(inviter.slug).collection('entries').doc(uid).set({
        uid: uid, name: name, characterId: charId, score: score,
        relation: relationLabel(score),
        createdAt: new Date().toISOString(),
      });
      console.log('[dogam] 상대 도감에 등록 완료', { slug: inviter.slug, entry: uid, score: score });

      // ⚠️ 정책 개편(인연도감 서비스 정책.md v4, 2-2 7번) — 예전엔 여기서 곧바로 내 도감을 만들고
      // 상대를 내 도감에도 등록해 "공유받은 사람"에서 "도감 주인" 화면으로 바로 전환했다. 이제 내
      // 도감은 이 시점에 만들지 않는다 — 대신 방금 등록한 결과(A기준 케미 점수 포함)만 justRegistered에
      // 담아 1회성 병합 결과 화면(renderGuestMergedResult)을 보여주고, "내 인연도감 만들기" CTA를
      // 실제로 눌러야 createMyDogamFromInvite()가 그 뒤를 이어 처리한다.
      justRegistered = {
        slug: inviter.slug,
        inviterUid: inviter.ownerUid, inviterName: inviter.ownerName, inviterCharacterId: inviter.ownerCharacterId,
        name: name, characterId: charId, score: score, relation: relationLabel(score),
      };
      // 참여자 목록에 방금 등록한 나를 포함해 최신화한다(guestEntriesBlock이 이 목록을 그대로 씀).
      guestDogam = await loadDogam(inviter.slug).catch(function () { return inviter; });
      hideSpinner(m.spinner); // render()가 이 폼 자체를 병합 결과 화면으로 갈아치우기 직전에 꺼둔다
      await render();
      // ⚠️ 사용자 요청(2026-09-04) — 등록·로딩이 끝나면 화면(특히 #dogamGuestSection 맨 위, A의
      // 카드가 다시 보이는 자리)이 아니라 "인연도감 등록 완료!" 병합 결과 블록(내 캐릭터가 보이는
      // 곳)으로 포커스를 옮긴다 — renderGuestMergedResult가 그 블록에 id를 붙여둔다.
      const resultBlock = document.getElementById('dogamMergedResultBlock');
      if (resultBlock) resultBlock.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (e) {
      console.error('[dogam] 등록 실패', e);
      stop();
      alert('등록 중 오류가 발생했어요. 잠시 후 다시 시도해주세요.');
    }
  }

  // 정책 2-4 9번 — "내 인연도감 만들기"는 로그인이 필수. 비로그인 상태로 누르면 로그인 팝업부터
  // 띄우고, 로그인이 실제로 끝난 뒤에 이 함수가 자동으로 이어서 실행되게 이 플래그만 남겨둔다.
  // localStorage가 아니라 메모리 변수인 이유는 justRegistered와 같다 — 카카오 로그인은 새 창이
  // 아니라 같은 페이지 안 오버레이(kakao-auth.js openLoginPopup)라서 페이지가 새로고침되지 않고,
  // 그래서 로그인 완료 후에도 이 값이 그대로 살아있다.
  let pendingCreateAfterLogin = false;

  // "내 인연도감 만들기" — renderGuestMergedResult의 CTA. 정책 2-4 10번의 "B가 처음 도감을 만드는
  // 경우" 절차(내 도감 생성 + B기준 케미 점수로 A를 자동 등록)를 여기서 수행한다.
  async function createMyDogamFromInvite() {
    if (!justRegistered) return;
    // ⚠️ 정책 개편(인연도감 서비스 정책.md v4, 2-4 9번: "이 버튼은 로그인이 필수다") — 지금까지는
    // 이 버튼도 익명 uid로 동작했는데, 그러면 B의 도감이 계정에 안 묶여 기기를 바꾸면 잃어버린다.
    // 비로그인이면 로그인 팝업만 띄우고 여기서 멈춘다 — render()가 로그인 완료를 감지하면
    // pendingCreateAfterLogin을 보고 이 함수를 자동으로 다시 불러준다(아래 render() 수정 참고).
    if (!currentUid() || isAnonymousUser()) {
      pendingCreateAfterLogin = true;
      if (window.KakaoAuth && KakaoAuth.openLoginPopup) {
        KakaoAuth.openLoginPopup('내 인연도감을 만들려면 로그인이 필요해요.<br>지금까지 등록한 내용은 그대로 이어져요.');
      } else {
        alert('로그인이 필요해요.');
      }
      return;
    }
    const m = justRegistered;
    let uid;
    try {
      uid = await ensureAuthUid();
    } catch (e) {
      console.error('[dogam] 익명 인증 실패', e);
      alert('처리 중 오류가 발생했어요.\n' + ((e && e.message) || e));
      return;
    }
    if (!uid) { alert('처리할 수 없어요. 잠시 후 다시 시도해주세요.'); return; }
    try {
      let mine = await ensureMyDogam();
      if (!mine) mine = await createMyDogam(m.name);
      if (!mine) throw new Error('내 인연도감을 만들지 못했어요.');

      // 인연은 양쪽에 함께 등록된다 — 방금 초대해준 사람도 내 도감에 올린다(B기준 케미 점수).
      const myScore = await compatScore(m.characterId, m.inviterCharacterId);
      const myRelation = relationLabel(myScore);
      await fbDb.collection('dogam').doc(mine.slug).collection('entries').doc(m.inviterUid).set({
        uid: m.inviterUid, name: m.inviterName, characterId: m.inviterCharacterId,
        score: myScore, relation: myRelation,
        createdAt: new Date().toISOString(),
      });
      console.log('[dogam] 내 도감에 상대 등록 완료', { slug: mine.slug, entry: m.inviterUid, score: myScore });

      // 등록 직후 화면에 "방금 맺은 인연"을 보여주기 위해 기억해둔다(이 페이지 세션 동안만).
      lastMatch = { uid: m.inviterUid, name: m.inviterName, characterId: m.inviterCharacterId, score: myScore, relation: myRelation };
      myDogam = null; // 다음 render에서 방금 쓴 항목까지 포함해 다시 읽도록 캐시를 비운다
      justRegistered = null;
      // "공유받은 사람"이 아니라 "내 도감 주인" 화면으로 전환한다.
      history.replaceState(null, '', location.origin + location.pathname);
      guestDogam = null;
      const gh = document.getElementById('dogamGuestSection');
      if (gh) { stashUploadNodes(); gh.remove(); }
      setDisplay('gwansangHero', '');
      await render();
      const card = document.getElementById('canvasCard');
      if (card) card.scrollIntoView({ behavior: 'smooth' });
    } catch (e) {
      console.error('[dogam] 내 도감 생성 실패', e);
      alert('도감을 만드는 중 오류가 발생했어요. 잠시 후 다시 시도해주세요.');
    }
  }

  // 공유 링크는 내 도감 문서의 slug 하나로 고정된다 — 한 번 만들어지면 계속 같은 주소이고,
  // 이 주소로 들어온 사람에게는 "내 도감"이 열린다(renderGuestView).
  async function share() {
    // async 함수라 안에서 던져진 예외는 onclick 밖으로 새어나가 조용히 사라진다 —
    // 그러면 사용자에겐 "버튼이 안 눌린다"로만 보인다. 모든 실패를 여기서 붙잡아 화면에 알린다.
    console.log('[dogam] 공유 링크 준비 시작');
    // slug를 이미 알고 있으면 어떤 await보다 먼저 복사한다 — await를 한 번이라도 거치면
    // 브라우저의 "사용자 조작 중" 판정이 풀려 클립보드 쓰기가 거부된다(복사가 조용히 실패).
    if (myDogam && myDogam.slug) {
      // ⚠️ 사용자 요청(2026-08-18): render()가 미리 만들어둔 도감은 실제 닉네임이 아니라 안전망
      // 이름("나"/"익명xxxx")일 수 있다 — 공유받는 사람 입장에서는 "나"든 "익명xxxx"든 똑같이
      // 누군지 알 수 없다. prompt()는 동기(화면이 멈춘 채 기다리는) 방식이라 await와 달리 "방금
      // 클릭했다" 판정을 깨지 않으므로, 복사 직전에 여기서 물어봐도 클립보드 복사가 안전하다.
      if (isPlaceholderName(myDogam.ownerName)) {
        const nickname = promptForNickname();
        if (nickname) {
          myDogam.ownerName = nickname;
          fbDb.collection('dogam').doc(myDogam.slug).set({ ownerName: nickname }, { merge: true })
            .catch(function (e) { console.error('[dogam] 이름 갱신 실패', e); });
        }
      }
      const ready = shareUrl(myDogam.slug);
      if (await copyText(ready)) { toast('초대 링크를 복사했어요'); console.log('[dogam] 공유 링크', ready); return; }
      prompt('아래 링크를 복사해서 친구에게 보내주세요.', ready);
      return;
    }
    toast('링크를 준비하고 있어요…');
    try {
      await ensureAuthUid(); // 비로그인이어도 공유는 된다(익명 신원 발급)
      let mine = myDogam || await ensureMyDogam();
      // ⚠️ 사용자 요청(2026-08-18): 프로필 이름이 없는 상태(비로그인 등)에서 도감이 새로 만들어지거나
      // (안전망 이름 "나"/"익명xxxx"로) 이미 그렇게 만들어져 있으면, 공유하는 이 시점에 진짜
      // 닉네임을 물어서 채운다 — 공유받는 사람 입장에서는 안전망 이름도 "나"와 마찬가지로 누군지
      // 알 수 없다.
      if (!mine || isPlaceholderName(mine.ownerName)) {
        const rep = window.Profile ? Profile.getRepresentative() : null;
        const nickname = (rep && rep.name) || promptForNickname();
        if (nickname) {
          if (mine) {
            mine.ownerName = nickname;
            fbDb.collection('dogam').doc(mine.slug).set({ ownerName: nickname }, { merge: true })
              .catch(function (e) { console.error('[dogam] 이름 갱신 실패', e); });
          } else {
            mine = await createMyDogam(nickname);
          }
        } else if (!mine) {
          hideToast(); return; // 도감이 아예 없는데 닉네임 입력도 취소함 — 공유 중단
        } // 이미 있는 도감인데 이름만 취소했으면 안전망 이름 그대로 공유는 계속한다.
      }
      if (!mine) { toast('먼저 관상 분석을 완료해주세요'); return; }
      myDogam = mine;
      const url = shareUrl(mine.slug);
      if (await copyText(url)) toast('초대 링크를 복사했어요');
      else prompt('아래 링크를 복사해서 친구에게 보내주세요.', url); // 클립보드를 못 쓰는 브라우저 대비
      console.log('[dogam] 공유 링크', url);
    } catch (e) {
      console.error('[dogam] 공유 링크 생성 실패', e);
      hideToast();
      if (e && e.code === 'permission-denied') {
        alert('도감을 저장할 권한이 없어요.\nFirestore 보안 규칙(dogam)을 배포했는지 확인해주세요.\n\nfirebase deploy --only firestore:rules');
      } else {
        alert('링크를 만들지 못했어요.\n' + ((e && e.message) || e));
      }
    }
  }

  async function copyText(text) {
    try {
      // navigator.clipboard는 보안 컨텍스트(HTTPS·localhost)에서만 동작한다.
      if (navigator.clipboard && window.isSecureContext) { await navigator.clipboard.writeText(text); return true; }
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.cssText = 'position:fixed;top:-1000px;opacity:0;';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch (e) { return false; }
  }

  let toastTimer = null;
  function hideToast() {
    const el = document.getElementById('dogamToast');
    if (el) el.classList.remove('show');
    clearTimeout(toastTimer);
  }
  function toast(message) {
    let el = document.getElementById('dogamToast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'dogamToast';
      el.className = 'dogam-toast';
      document.body.appendChild(el);
    }
    el.textContent = message;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove('show'); }, 2000);
  }

  function loginAndKeep() { if (window.KakaoAuth) KakaoAuth.openLoginPopup(); }
  function goCombined() {
    const btns = Array.prototype.slice.call(document.querySelectorAll('.tab-btn'));
    const btn = btns.filter(function (b) { return (b.getAttribute('onclick') || '').indexOf("'combined'") >= 0; })[0];
    if (btn) btn.click();
    window.scrollTo(0, 0);
  }

  // 공유 링크(?dogam=...)로 들어온 경우엔 관상 탭을 열고 등록 화면을 바로 띄운다.
  function initFromShareLink() {
    if (!sharedSlugFromUrl()) return;
    const btns = Array.prototype.slice.call(document.querySelectorAll('.tab-btn'));
    const btn = btns.filter(function (b) { return (b.getAttribute('onclick') || '').indexOf("'gwansang'") >= 0; })[0];
    if (btn) btn.click();
    const result = document.getElementById('gwansangResult');
    if (result) result.classList.remove('hidden'); // 리포트 카드 안에 도감 영역이 들어있다
    render();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initFromShareLink);
  else initFromShareLink();

  window.Dogam = {
    render: render, renderInto: renderIntoEl, share: share, registerEntry: registerEntry,
    createMyDogamFromInvite: createMyDogamFromInvite,
    showEntryDetail: showEntryDetail, closeEntryDetail: closeEntryDetail,
    deleteEntry: deleteEntry, setEntryFilter: setEntryFilter,
    showDogamConflict: showDogamConflict, closeDogamConflict: closeDogamConflict,
    chooseDogam: chooseDogam,
    notifyDogamMerged: notifyDogamMerged,
    dismissLoginModal: dismissLoginModal,
    snoozeLoginModal: snoozeLoginModal,
    loginAndKeep: loginAndKeep, goCombined: goCombined, deleteMyDogam: deleteMyDogam,
    migrateLocalOnLogin: migrateLocalOnLogin, leaveSharedView: leaveSharedView,
    // 보관함(archive.js)이 "생성 시간"으로 안정적인 값을 쓰게 하려는 용도 — 도감 문서의 실제
    // createdAt(한 번 정해지면 안 바뀜)이라, 어느 기기에서 언제 스냅샷을 다시 찍든 항상 같다.
    getMyDogamCreatedAt: function () { return myDogam ? myDogam.createdAt || null : null; },
    // 2026-08-31 — 보관함이 인연도감을 더 이상 따로 저장하지 않고, 열 때마다 실물을 직접 물어보는
    // 창구(사용자 정책: "원본은 하나여야 해"). ensureMyDogam은 로그인/비로그인 양쪽 다 처리하고
    // SLUG_KEY 캐시까지 갖고 있어 archive.js가 새로 구현할 필요 없이 그대로 재사용할 수 있다.
    ensureMyDogam: ensureMyDogam,
    // ⚠️ 버그 수정(2026-09-03 사용자 리포트: "비로그인으로 인연도감 만들려고 얼굴 넣으면 분석중만
    // 뜨고 안 끝남") — character-api.js가 캐릭터 판정 데이터를 서버(Cloud Functions)에서 받아오는데,
    // 그 호출이 Firebase ID 토큰을 필수로 요구한다(로그인 안 한 사용자는 fbAuth.currentUser가 없어
    // 토큰 자체가 없음). 이 함수(원래 도감 등록/공유 시에만 쓰던 익명 인증 발급)를 startAnalysis가
    // 얼굴 분석 직후·캐릭터 판정 직전에도 불러 최소한 익명 uid라도 먼저 만들어두게 한다.
    ensureAuthUid: ensureAuthUid,
    _score: compatScore, _policy: DOGAM_POLICY,
  };
})();
