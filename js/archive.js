// ═══════════════════════════════════════════════════════════════════════
// 보관함 — 결제한 사용자의 분석 리포트가 쌓이는 페이지(팝업 아님).
// 결제 모듈 연동 전이라, 지금은 "리포트가 완성되면 로그인한 아이디(uid) 기준으로 저장"한다.
// 결제 모듈이 붙으면 저장 시점(Archive.save 호출 지점)에 결제 여부만 확인하면 된다.
//
// app.js의 계산/렌더 로직은 건드리지 않는다. 각 분석이 완전히 끝나는 지점에서
// Archive.save(type)를 한 줄 호출하는 것이 유일한 연결점이다.
//
// 저장 구조
//   목록  localStorage `gwansang_archive_v1:<uid>`      + Firestore users/{uid}.archive
//   본문  localStorage `gwansang_report_v1:<uid>:<id>`  + Firestore users/{uid}/reports/{id}
// 본문을 별도 문서로 나눈 이유 — Firestore 문서 1개당 1MB 제한이라 리포트를 한 문서에 몰면 금방 넘친다.
// ═══════════════════════════════════════════════════════════════════════
(function () {
  const IDX_PREFIX = 'gwansang_archive_v1:';
  const REPORT_PREFIX = 'gwansang_report_v1:';
  // 인연도감은 원래 비로그인으로 만드는 게 기본 경로다(30일 기기 보관 정책과 같은 전제) — 그래서
  // 로그인 전에 완성된 리포트는 uid가 없어 계정에 못 붙이는 대신, 완성된 스냅샷 자체를 uid 없이
  // "이 기기"에 저장해둔다. 나중에 언제 로그인하든(새로고침·기기 재방문 다 포함) 그 순간 로그인한
  // uid로 그대로 편입한다 — Dogam이 로컬 slug를 계정에 편입하는 것과 같은 구조.
  const PENDING_KEY = 'gwansang_archive_pending_v1';

  const SECTIONS = [
    { type: 'combined', label: '통합분석' },
    { type: 'gungham',  label: '궁합보기' },
    { type: 'gwansang', label: '인연도감' },
    { type: 'saju',     label: '사주보기' },
  ];
  // 각 분석 결과가 그려지는 컨테이너 — 이 DOM을 그대로 떠서 보관한다.
  const CONTAINERS = {
    combined: ['cmbResult'],
    // canvasCard = 16캐릭터 일러스트 카드(#gwansangCharacterCard). 원래 이 목록에 없어서 보관함에는
    // 캐릭터 카드 없이 상세 리포트만 저장되고 있었다(사용자 리포트 2026-08-16) — 추가해서 같이 스냅샷.
    gwansang: ['canvasCard', 'gwansangResult'],
    saju: ['sajuResult', 'sajuComplement'],
    gungham: ['ggResult'],
  };

  let sortDesc = true;   // 최신순이 기본
  let openState = null;  // 아코디언 펼침 상태 (첫 렌더 때 기록 유무로 초기화)
  let viewingId = null;  // 리포트 상세를 보고 있으면 그 기록 id
  let prevTab = 'combined';

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
  }
  function currentUid() {
    return (window.fbAuth && fbAuth.currentUser) ? fbAuth.currentUser.uid : null;
  }
  // 인연도감이 비로그인 등록을 위해 발급하는 익명 인증(Firebase Anonymous Auth)은 실계정이 아니다
  // — Dogam의 loggedIn 판정(inyeon-dogam.js)과 같은 기준. 저장 대상 uid로 실계정만 인정해야
  // "임시 보관 → 로그인 시 편입" 흐름이 익명 uid에 새는 걸 막는다.
  function isRealUid() {
    const u = window.fbAuth && fbAuth.currentUser;
    return (u && !u.isAnonymous) ? u.uid : null;
  }

  // ── 목록 저장소 ──────────────────────────────────────────────────────
  function loadIndex() {
    const uid = currentUid();
    if (!uid) return [];
    try { return JSON.parse(localStorage.getItem(IDX_PREFIX + uid)) || []; }
    catch (e) { return []; }
  }
  // ⚠️ 버그 수정(2026-08-20 사용자 리포트: 기기마다 보관함 내용이 다르게 보이는 근본 원인).
  // 로그인 직후 Dogam.render()(paintOwnerView의 자가복구 저장, Archive.save('gwansang'))가
  // loadFromCloud()의 병합이 끝나기도 전에 먼저 실행되면, 이 기기가 아직 못 받아온 클라우드
  // 목록을 "없다"고 오판해 새 항목을 만들고 saveIndex()가 그걸로 archive 필드 전체를 덮어써버린다
  // (Firestore set({merge:true})는 배열 필드를 원소 단위로 합치지 않고 통째로 교체한다). uid별로
  // "이번 로그인에서 클라우드 병합이 끝났는지" 게이트를 두고, 끝나기 전의 쓰기는 병합이 끝난
  // 뒤로 미룬다 — 로컬 저장(화면 반영)은 그대로 즉시 하고, 클라우드 쓰기만 미룬다.
  const cloudGates = {}; // uid -> { promise, resolve, done }
  function cloudGate(uid) {
    if (!cloudGates[uid]) {
      let resolveFn;
      const p = new Promise(function (r) { resolveFn = r; });
      cloudGates[uid] = { promise: p, resolve: resolveFn, done: false };
      console.log('[archive] 게이트 생성', { uid: uid });
    }
    return cloudGates[uid];
  }
  function saveIndex(list) {
    const uid = currentUid();
    if (!uid) return;
    localStorage.setItem(IDX_PREFIX + uid, JSON.stringify(list));
    if (!window.fbDb) return;
    const write = function () {
      // 게이트가 풀리기까지 기다린 경우, 그 사이 로컬이 더 바뀌어 있을 수 있어 이 시점의
      // 최신 로컬 목록을 올린다(호출 당시의 list를 그대로 쓰면 뒤늦게 덮어쓰는 꼴이 된다).
      const latest = loadIndex();
      console.log('[archive] 클라우드 쓰기 실행', { uid: uid, count: latest.length, types: latest.map(r => r.type) });
      fbDb.collection('users').doc(uid).set({ archive: latest }, { merge: true })
        .catch(e => console.error('[archive] 목록 클라우드 저장 실패', e));
    };
    const gate = cloudGates[uid];
    if (gate && !gate.done) {
      console.log('[archive] 클라우드 쓰기 보류(병합 대기)', { uid: uid, count: list.length, types: list.map(r => r.type) });
      gate.promise.then(write);
      return;
    }
    console.log('[archive] 게이트 없음/이미 완료 — 즉시 씀', { uid: uid, hasGate: !!gate, done: gate && gate.done });
    write();
  }

  // ── 리포트 본문 저장소 ───────────────────────────────────────────────
  function saveReportHtml(uid, id, html) {
    try { localStorage.setItem(REPORT_PREFIX + uid + ':' + id, html); }
    catch (e) { console.warn('[archive] 로컬 저장 용량 초과 — 클라우드에만 저장한다', e); }
    if (!window.fbDb) return;
    fbDb.collection('users').doc(uid).collection('reports').doc(id)
      .set({ html: html, createdAt: new Date().toISOString() })
      .catch(e => console.error('[archive] 리포트 클라우드 저장 실패', e));
  }
  async function loadReportHtml(id) {
    const uid = currentUid();
    if (!uid) return null;
    const local = localStorage.getItem(REPORT_PREFIX + uid + ':' + id);
    if (local) return local;
    if (!window.fbDb) return null;
    try {
      const doc = await fbDb.collection('users').doc(uid).collection('reports').doc(id).get();
      if (!doc.exists) return null;
      const html = doc.data().html || null;
      // 다음 열람부터는 네트워크 없이 뜨도록 로컬에도 채워둔다.
      if (html) { try { localStorage.setItem(REPORT_PREFIX + uid + ':' + id, html); } catch (e) {} }
      return html;
    } catch (e) {
      console.error('[archive] 리포트 불러오기 실패', e);
      return null;
    }
  }
  function removeReportHtml(uid, id) {
    localStorage.removeItem(REPORT_PREFIX + uid + ':' + id);
    if (!window.fbDb) return;
    fbDb.collection('users').doc(uid).collection('reports').doc(id).delete()
      .catch(e => console.error('[archive] 리포트 삭제 실패', e));
  }

  // 보관 목록이 바뀌었을 때(저장·삭제·로그인·로그아웃) 보관함 밖에서 이 목록을 쓰는 화면에도 알린다.
  // 지금은 통합분석 첫 화면이 "저장된 리포트가 있으면 사진 등록 대신 그 리포트를 보여주는" 용도로 쓴다.
  function notifyChanged() {
    if (typeof renderCombinedSavedReport === 'function') renderCombinedSavedReport();
    if (typeof renderGunghamSavedReport === 'function') renderGunghamSavedReport();
  }

  // 클라우드본과 로컬본을 합친다 — 어느 한쪽이 비어 보여도 다른 쪽 내용이 사라지지 않도록
  // (profile.js의 mergeProfiles와 같은 원칙). 같은 id면 로컬본을 우선한다.
  // ⚠️ 버그 수정(2026-08-20 사용자 리포트: 기기마다 보관함 내용이 다르게 보임 — PC엔 통합분석·
  // 궁합보기·인연도감이 다 있는데 모바일엔 인연도감 하나만 있고 이름도 "나"로 나옴). 예전엔
  // loadFromCloud가 병합 없이 그냥 덮어써서, 한쪽 기기의(특히 아직 다른 기록을 못 받아온) 로컬
  // 목록이 나중에 saveIndex로 다시 올라가면 클라우드의 다른 기록을 통째로 지워버릴 수 있었다.
  function mergeIndex(localList, cloudList) {
    const merged = localList.slice();
    const seen = {};
    merged.forEach(function (r) { seen[r.id] = true; });
    (cloudList || []).forEach(function (r) { if (r && !seen[r.id]) { merged.push(r); seen[r.id] = true; } });
    // 인연도감(gwansang)은 계정당 한 건이어야 한다는 게 commitSave의 전제다 — 두 기기가 로그인 전에
    // 각자 만든 서로 다른 gwansang 기록이 병합되면 이 전제가 깨진다. 가장 최근 것만 남긴다(실제
    // 친구 참여 기록은 이 스냅샷이 아니라 별도 dogam 컬렉션에 있어서, 스냅샷 하나를 정리해도
    // 데이터가 사라지지 않는다).
    const gwansangRows = merged.filter(function (r) { return r.type === 'gwansang'; });
    if (gwansangRows.length > 1) {
      gwansangRows.sort(function (a, b) { return (a.createdAt < b.createdAt ? 1 : -1); });
      const keepId = gwansangRows[0].id;
      return merged.filter(function (r) { return r.type !== 'gwansang' || r.id === keepId; });
    }
    return merged;
  }

  // 로그인 직후 — 다른 기기에서 만든 목록을 이 기기로 가져온다(본문은 열람할 때 개별로 받는다).
  async function loadFromCloud() {
    // 이 기기에 이미 있는 목록만으로 먼저 화면을 맞춘다 — 클라우드 응답을 기다리는 동안
    // 통합분석 첫 화면이 "기록 없음"으로 보이지 않게 한다.
    notifyChanged();
    const uid = currentUid();
    if (!uid || !window.fbDb) return;
    // await 전에 동기적으로 게이트를 만들어둔다 — 호출자가 이 Promise를 기다리지 않아도(호출만
    // 해도) 이 시점부터 saveIndex()의 쓰기가 병합 완료까지 미뤄진다. kakao-auth.js가 Dogam.render()
    // (자가복구 저장을 유발)보다 먼저 Archive.loadFromCloud()를 호출해두는 것과 세트로 동작한다.
    const gate = cloudGate(uid);
    try {
      // ⚠️ 버그 수정(2026-08-20 사용자 재현: 같은 PC의 일반 창은 정상, 시크릿 창만 로그인 직후
      // 클라우드가 통째로 비어 보임). 이 세션에서 Firestore SDK가 처음 통신하는 경우 로그인 직후
      // 발급된 ID 토큰이 네트워크 계층에 붙기 전에 첫 Firestore 요청이 나갈 수 있다 — 그러면
      // 인증 안 된 요청으로 취급돼 있는 데이터를 못 읽는다. 첫 조회 전에 토큰을 강제로 한 번
      // 갱신해 이 요청부터는 확실히 인증된 상태로 나가게 한다.
      if (window.fbAuth && fbAuth.currentUser) {
        try { await fbAuth.currentUser.getIdToken(true); }
        catch (e) { console.warn('[archive] 토큰 갱신 실패 — 원래 토큰으로 계속 진행', e); }
      }
      const doc = await fbDb.collection('users').doc(uid).get();
      const cloud = (doc.exists && Array.isArray(doc.data().archive)) ? doc.data().archive : [];
      const local = loadIndex();
      const merged = mergeIndex(local, cloud);
      console.log('[archive] 클라우드 병합', {
        uid: uid, exists: doc.exists, hasArchiveField: doc.exists ? Array.isArray(doc.data().archive) : null,
        cloudCount: cloud.length, cloudTypes: cloud.map(r => r.type),
        localCount: local.length, localTypes: local.map(r => r.type),
        mergedCount: merged.length, mergedTypes: merged.map(r => r.type),
      });
      localStorage.setItem(IDX_PREFIX + uid, JSON.stringify(merged));
      gate.done = true; gate.resolve(); // 로컬은 이미 맞춰졌으니 여기서 게이트를 먼저 푼다
      // 합친 결과가 클라우드본과 다르면(로컬에만 있던 게 있었거나, 중복 gwansang을 정리했으면)
      // 다시 올려서 양쪽을 맞춘다. 완전히 같으면 불필요한 쓰기를 하지 않는다.
      if (JSON.stringify(merged) !== JSON.stringify(cloud)) saveIndex(merged);
      if (isOpen()) renderPage();
      notifyChanged();
    } catch (e) {
      console.error('[archive] 목록 불러오기 실패', e);
      gate.done = true; gate.resolve(); // 실패해도 게이트는 풀어준다 — 이후 저장이 영원히 막히면 안 된다
    }
  }

  // ── 리포트 스냅샷 ────────────────────────────────────────────────────
  // 화면에 그려진 결과 카드를 그대로 복제해 보관한다. 다시 열었을 때 앱의 살아있는 DOM과
  // 충돌하지 않도록 id/onclick을 떼고, 직렬화되지 않는 canvas와 script는 제거한다.
  // 보관함에는 리포트 "내용"만 남긴다. 뒤로가기·공유·CTA 같은 조작 요소가 함께 저장되면
  // 저장된 리포트를 열었을 때 보관함 자체의 뒤로가기와 겹쳐 두 개로 보이고, 눌러도 아무 일이
  // 일어나지 않는다(복원 시 id·onclick을 떼기 때문). 인연 도감처럼 실시간 데이터도 스냅샷에 맞지 않는다.
  const REPORT_CHROME = [
    '.report-back-btn', '.cta-dock', '.submit-btn', '.print-btn',
    '.dogam-block', '.dogam-actions', '.dogam-cta', '.dogam-cta-label', '.dogam-keep', '.dogam-policy',
    '.dogam-share-btn', '.dogam-link-btn', '.dogam-delete-btn',
  ].join(', ');
  function stripChrome(rootEl) {
    rootEl.querySelectorAll(REPORT_CHROME).forEach(n => n.remove());
  }

  function snapshot(type) {
    const wrap = document.createElement('div');
    (CONTAINERS[type] || []).forEach(function (id) {
      const el = document.getElementById(id);
      if (!el || el.classList.contains('hidden')) return;
      wrap.appendChild(el.cloneNode(true));
    });
    if (!wrap.children.length) return null;
    stripChrome(wrap);
    wrap.querySelectorAll('canvas, script').forEach(n => n.remove());
    wrap.querySelectorAll('[id]').forEach(n => n.removeAttribute('id'));
    wrap.querySelectorAll('[onclick]').forEach(n => n.removeAttribute('onclick'));
    // 저장 시점에 접혀 있던 상세(details)는 그대로 두되, 카드 자체가 숨겨지진 않게 한다.
    Array.from(wrap.children).forEach(n => n.classList.remove('hidden'));
    return wrap.innerHTML;
  }

  // 분석 대상이 누구였는지 — 각 탭이 쓰는 프로필/관계에서 가져온다.
  function buildLabel(type) {
    const rep = window.Profile ? Profile.getRepresentative() : null;
    const repName = rep ? rep.name : '나';
    // app.js의 state는 const 전역이라 window에 붙지 않는다 — 전역 렉시컬 스코프로 직접 참조한다.
    const st = (typeof state !== 'undefined') ? state : null;
    if (type === 'gungham') {
      const partner = window.Profile && Profile.getGunghamPartner ? Profile.getGunghamPartner() : null;
      return {
        title: repName + ' ✕ ' + (partner ? partner.name : '상대방'),
        sub: (st && st.gungham && st.gungham.relation) || '',
        profileId: rep ? rep.id : null,
      };
    }
    if (type === 'gwansang') {
      // 인연도감 자체의 실제 생성 시각(도감 문서의 createdAt — 한 번 정해지면 안 바뀜)을 그대로
      // 쓴다. 보관함 자체의 저장 시각을 새로 찍으면(사용자 리포트 2026-08-19) 자가복구·재동기화가
      // 일어날 때마다 "생성 시간"이 그 순간으로 밀려서, 기기·시점마다 다른 시간이 보이는 문제가 있었다.
      const dogamCreatedAt = (window.Dogam && Dogam.getMyDogamCreatedAt) ? Dogam.getMyDogamCreatedAt() : null;
      return { title: repName, sub: (rep && (rep.relationDetail || rep.relation)) || '', profileId: rep ? rep.id : null, createdAt: dogamCreatedAt };
    }
    const rel = (st && st[type] && st[type].relation) || (rep && (rep.relationDetail || rep.relation)) || '';
    // profileId — "이 프로필로 이미 분석한 적 있는지" 나중에 확인하려면 이름만으로는 부족하다
    // (동명이인 프로필이 있을 수 있음). 저장 시점의 대표 프로필 id를 같이 남긴다(사용자 요청
    // 2026-08-19: 같은 사주를 다시 골라도 새로 분석하는 것처럼 보이는 문제).
    return { title: repName, sub: rel, profileId: rep ? rep.id : null };
  }

  // ── 결제 게이트 ──────────────────────────────────────────────────────
  // 통합분석·사주보기는 AI를 돌리는 유료 상품이다. 결제 모듈 연동 전이라 지금은 "결제했다"고 전제하고
  // 무조건 통과시킨다. 결제 모듈이 붙으면 이 함수 하나만 실제 결제 여부 조회로 바꾸면 된다.
  const PAID_TYPES = ['combined', 'saju'];
  function hasPaidFor(type) {
    if (PAID_TYPES.indexOf(type) < 0) return true; // 무료 분석은 게이트 없음
    return true; // TODO(결제 연동): 해당 분석 건의 결제 완료 여부로 교체
  }

  // 실제 저장 — uid가 확정된 뒤에만 부른다(로그인 직후 save()에서, 또는 나중에 commitPending()에서).
  function commitSave(uid, type, html, label) {
    // ⚠️ 사용자 리포트(2026-08-18): 인연도감(gwansang)은 "내 캐릭터" 리포트가 계정당 하나뿐인데,
    // 친구 도감에 등록할 때마다(재분석이 껴 있으면) Archive.save가 매번 새 항목을 만들어서
    // 보관함에 똑같은 내용이 여러 개 쌓였다. 이미 있으면 새로 쌓지 않고 기존 항목 본문만 갱신한다.
    if (type === 'gwansang') {
      const existing = loadIndex().find(function (r) { return r.type === 'gwansang'; });
      if (existing) {
        saveReportHtml(uid, existing.id, html);
        const list = loadIndex();
        const idx = list.findIndex(function (r) { return r.id === existing.id; });
        if (idx >= 0) {
          list[idx].title = label.title;
          list[idx].sub = label.sub;
          list[idx].profileId = label.profileId || null;
          // 인연도감은 목록에 항상 1건뿐이라 "최신순 정렬"을 위해 갱신할 이유가 없다 — 도감의 실제
          // 생성 시각(label.createdAt)을 알면 그걸 그대로 쓰고, 모르면(도감 조회 실패 등) 기존 값을
          // 그대로 둔다. 매번 지금 시각으로 찍으면 갱신될 때마다 "생성 시간"이 달라져 보인다
          // (사용자 리포트 2026-08-19: 기기·시점마다 인연도감 생성 시간이 다르게 보임).
          if (label.createdAt) list[idx].createdAt = label.createdAt;
          saveIndex(list);
        }
        console.log('[archive] 인연도감 리포트 갱신(중복 생성 방지)', { id: existing.id, uid: uid });
        if (isOpen()) renderPage();
        notifyChanged();
        return;
      }
    }
    const id = 'a_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    saveReportHtml(uid, id, html);
    const list = loadIndex();
    list.push({
      id: id, type: type, title: label.title, sub: label.sub,
      profileId: label.profileId || null, // "이 프로필로 이미 분석했는지" 나중에 대조하기 위함
      paid: PAID_TYPES.indexOf(type) >= 0, // 결제 상품 여부 — 결제내역 화면에서 재사용할 수 있게 남긴다
      createdAt: label.createdAt || new Date().toISOString(), // 인연도감은 도감 자체의 실제 생성 시각을 그대로 쓴다
    });
    saveIndex(list);
    console.log('[archive] 리포트 보관 완료', { type: type, id: id, bytes: html.length, uid: uid });
    if (isOpen()) renderPage();
    notifyChanged();
  }

  function loadPending() {
    try { return JSON.parse(localStorage.getItem(PENDING_KEY)) || []; }
    catch (e) { return []; }
  }
  function savePendingList(list) {
    try { localStorage.setItem(PENDING_KEY, JSON.stringify(list)); }
    catch (e) { console.warn('[archive] 임시 보관 저장 실패(로컬 저장소 용량 등)', e); }
  }

  // 이 기기가 로그인 전(익명)에 남겨둔 대기 스냅샷이 알고 보니 지금 로그인한 계정의 것이 아니라고
  // 판명됐을 때(예: 인연도감 — 계정에 이미 진짜 도감이 있어서 이 기기의 도감은 별개의 미아였던 경우)
  // 호출한다. inyeon-dogam.js의 migrateLocalOnLogin()이 그 판단을 내린 뒤 부른다 — 여기서 버리지
  // 않으면 commitPending()이 이 미아 스냅샷을 계정의 진짜 기록에 덮어써 버린다(사용자 리포트
  // 2026-08-19: PC에서 비로그인으로 만든 다른 인연도감이 로그인 후 진짜 계정 도감을 덮어씀).
  function discardPending(type) {
    const pending = loadPending().filter(function (p) { return p.type !== type; });
    savePendingList(pending);
  }

  // 분석이 완전히 끝난 지점에서 app.js가 호출한다.
  // 보관에 실패해도 분석 화면 자체는 영향을 받으면 안 되므로 모든 실패를 여기서 흡수하고 로그만 남긴다.
  function save(type) {
    try {
      if (!CONTAINERS[type]) { console.warn('[archive] 저장 대상이 아닌 분석', type); return; }

      const html = snapshot(type);
      if (!html) {
        // 결과 카드가 아직 화면에 없거나(hidden) 비어 있으면 스냅샷할 게 없다.
        console.warn('[archive] 스냅샷할 결과 카드가 없다', {
          type: type,
          containers: (CONTAINERS[type] || []).map(function (cid) {
            const el = document.getElementById(cid);
            return cid + (!el ? '(없음)' : el.classList.contains('hidden') ? '(hidden)' : '(ok)');
          }),
        });
        return;
      }
      const uid = isRealUid();
      if (!uid) {
        // 인연도감은 원래 비로그인이 기본 경로라, 여기서 포기하지 않고 완성된 스냅샷을 기기에
        // 남겨둔다. 같은 type이 또 완성되면(사진을 다시 찍는 등) 최신 것으로 덮어쓴다.
        const label = buildLabel(type);
        const pending = loadPending().filter(function (p) { return p.type !== type; });
        pending.push({ type: type, html: html, title: label.title, sub: label.sub, profileId: label.profileId || null, ts: Date.now() });
        savePendingList(pending);
        console.warn('[archive] 비로그인 상태 — 리포트를 기기에 임시 보관(로그인 시 편입)', type);
        return;
      }
      if (!hasPaidFor(type)) { console.warn('[archive] 미결제 — 리포트를 보관하지 않는다', type); return; }
      // ⚠️ 버그 수정(2026-08-20): 로그인 직후 첫 자가복구 저장(paintOwnerView)은 loadFromCloud의
      // 클라우드 병합이 끝나기 전에 일어날 수 있다. 그 시점엔 "이 계정에 기존 기록이 있는지"
      // (commitSave의 gwansang 중복 방지 판단)도, label(대표 프로필 이름표)도 아직 정확하지 않아서
      // — 병합 전 로컬 목록엔 다른 기기의 기존 기록이 없으니 새 항목을 만들어버리고, 그 새 항목이
      // 나중에 병합 시 "최신"으로 오인돼 진짜 기록을 밀어낼 수 있다. 병합이 끝난 뒤 다시 판단해서
      // 커밋한다 — label도 그 시점에 다시 계산해야 그 사이 로딩된 진짜 대표 프로필 이름이 반영된다.
      const gate = cloudGates[uid];
      console.log('[archive] save() 게이트 확인', { type: type, uid: uid, hasGate: !!gate, done: gate && gate.done });
      if (gate && !gate.done) {
        gate.promise.then(function () { commitSave(uid, type, html, buildLabel(type)); });
        return;
      }
      commitSave(uid, type, html, buildLabel(type));
    } catch (e) {
      console.error('[archive] 리포트 보관 실패', type, e);
    }
  }

  // 로그인 확정 시 kakao-auth.js가 호출한다 — 비로그인 동안 기기에 임시 보관해둔 리포트를
  // 지금 로그인한 계정으로 편입한다. 새로고침이나 기기 재방문을 거쳤어도(로컬 저장소라) 그대로 남아있다.
  function commitPending() {
    const uid = isRealUid();
    if (!uid) return;
    const pending = loadPending();
    if (!pending.length) return;
    pending.forEach(function (p) {
      // ⚠️ 버그 수정(2026-08-20 사용자 리포트: 모바일 인연도감이 "최주연" 대신 "나"로 보임) —
      // p.title/p.sub는 로그인 전(익명, 대표 프로필 없음) 임시 보관 시점에 찍힌 이름표라 항상
      // "나"/빈 문자열이다. 편입은 로그인·프로필 로딩이 끝난 뒤에만 일어나므로(kakao-auth.js가
      // migrateLocalOnLogin·Profile.loadFromCloud·Archive.loadFromCloud를 먼저 기다린 뒤 호출),
      // 그 시점의 진짜 대표 프로필로 이름표를 다시 계산한다 — 옛 이름표를 그대로 쓰면 이미 있던
      // 정확한 기록(다른 기기에서 만든 "최주연")을 "나"로 덮어써버린다.
      const label = buildLabel(p.type);
      commitSave(uid, p.type, p.html, label);
    });
    localStorage.removeItem(PENDING_KEY);
    console.log('[archive] 임시 보관 리포트 편입 완료', { count: pending.length });
  }

  // 콘솔에서 상태를 바로 확인하기 위한 진단용 — Archive.debug()
  function debug() {
    const uid = currentUid();
    const info = {
      uid: uid,
      indexCount: loadIndex().length,
      byType: {},
      containers: {},
    };
    SECTIONS.forEach(function (s) {
      info.byType[s.type] = loadIndex().filter(r => r.type === s.type).length;
      info.containers[s.type] = (CONTAINERS[s.type] || []).map(function (cid) {
        const el = document.getElementById(cid);
        return cid + (!el ? '(없음)' : el.classList.contains('hidden') ? '(hidden)' : '(ok)');
      }).join(', ');
    });
    console.log('[archive] 진단', info);
    return info;
  }

  async function remove(id) {
    const uid = currentUid();
    if (!uid) return;
    const rec = loadIndex().find(r => r.id === id);
    if (!confirm('이 리포트를 삭제할까요?\n' + (rec ? rec.title : '') + '\n삭제하면 되돌릴 수 없습니다.')) return;
    removeReportHtml(uid, id);
    const left = loadIndex().filter(r => r.id !== id);
    saveIndex(left);

    // 인연도감(type:'gwansang') 마지막 기록을 지운 경우 — 도감 본체까지 정리한다(사용자 원칙
    // 2026-08-20: "보관함은 그냥 보관일 뿐이고, 인연도감과 보관함은 정확히 같은 걸 봐야 한다.
    // 그래서 인연도감에서 지우면 보관함도, 보관함에서 지우면 인연도감도 같이 지워져야 한다").
    // ⚠️ 도감 삭제는 친구들이 남긴 참여 기록까지 함께 사라지는 되돌릴 수 없는 작업이라, 여기서 조용히
    // 지우지 않고 Dogam.deleteMyDogam()을 부른다 — 그 안에서 "인연 N명도 함께 사라진다"는 확인을
    // 다시 받는다. 사용자가 거기서 취소하면 보관함 기록만 지워지고 도감은 남는다.
    // (이 연결이 안전하려면 보관함이 실제 도감과 항상 정확히 같아야 한다 — paintOwnerView가 렌더할
    // 때마다 Archive.save('gwansang')로 다시 맞춰두는 것과 세트로 봐야 한다.)
    if (rec && rec.type === 'gwansang' && !left.some(r => r.type === 'gwansang')) {
      localStorage.removeItem('inyeonLastCharacter');
      if (typeof renderGwansangRevisitCard === 'function') renderGwansangRevisitCard();
      console.log('[archive] 관상 기록이 모두 삭제돼 재방문 카드도 정리');
      if (window.Dogam && Dogam.deleteMyDogam) {
        try { await Dogam.deleteMyDogam(); }
        catch (e) { console.error('[archive] 인연도감 삭제 실패 — 보관함 기록만 지워졌다', e); }
      }
    }

    if (viewingId === id) viewingId = null;
    // 삭제 후 화면 곳곳(보관함 목록·인연도감 섹션·재방문 카드 등)을 부분적으로 다시 그리는 대신
    // 새로고침 한 번으로 확실하게 맞춘다(사용자 요청 2026-08-18) — 이 세션에서 render 순서·캐시
    // 어긋남으로 여러 번 "삭제했는데 화면엔 남아있다"가 났던 걸 반복하지 않기 위함.
    location.reload();
  }

  // 인연도감 쪽(Dogam.deleteMyDogam)에서 도감을 지웠을 때 보관함의 해당 리포트도 함께 정리하기 위한
  // 조용한 캐스케이드용 함수 — remove(id)와 달리 확인창을 띄우지 않는다. 호출부(Dogam)가 이미
  // "인연도감을 삭제할까요?" 확인을 한 번 받은 뒤에 부르는 것이라, 여기서 또 물으면 두 번 확인받는다.
  function removeReportsByType(type) {
    const uid = currentUid();
    if (!uid) return;
    const list = loadIndex();
    const toRemove = list.filter(r => r.type === type);
    if (!toRemove.length) return;
    toRemove.forEach(r => removeReportHtml(uid, r.id));
    const left = list.filter(r => r.type !== type);
    saveIndex(left);
    if (viewingId && toRemove.some(r => r.id === viewingId)) viewingId = null;
    console.log('[archive] 캐스케이드 삭제(type)', { type: type, count: toRemove.length });
  }

  // 로그아웃 시 화면만 정리한다. 저장소는 계정(uid)별로 나뉘어 있어 로그아웃 상태에서는 어차피
  // 조회되지 않고, 사본을 남겨둬야 클라우드 조회가 어긋나도 재로그인 시 그대로 복원된다.
  function clearLocal() {
    if (isOpen()) renderPage();
    notifyChanged(); // 로그아웃 — 저장된 리포트를 감추고 다시 사진 등록 화면으로
  }

  function fmtWhen(iso) {
    const d = new Date(iso);
    if (isNaN(d)) return '';
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }

  // ── 페이지 ───────────────────────────────────────────────────────────
  function host() { return document.getElementById('panel-archive'); }
  function isOpen() { const h = host(); return !!(h && h.classList.contains('active')); }

  function openPage() {
    if (window.KakaoAuth) KakaoAuth.closePopup(); // 마이페이지 오버레이에서 넘어온 경우
    const active = document.querySelector('.panel.active');
    if (active && active.id !== 'panel-archive') prevTab = active.id.replace('panel-', '');
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    host().classList.add('active');
    viewingId = null;
    renderPage();
    window.scrollTo(0, 0);
  }

  // 보관함에서 나가기 — 들어오기 전 보던 탭으로 되돌린다.
  function closePage() {
    const btns = Array.from(document.querySelectorAll('.tab-btn'));
    const btn = btns.find(b => (b.getAttribute('onclick') || '').indexOf("'" + prevTab + "'") >= 0) || btns[0];
    if (btn) btn.click();
    window.scrollTo(0, 0);
  }

  function toggle(type) {
    ensureOpenState();
    openState[type] = !openState[type];
    renderPage();
  }
  function toggleSort() { sortDesc = !sortDesc; renderPage(); }

  function ensureOpenState() {
    if (openState) return;
    const all = loadIndex();
    openState = {};
    // 기록이 있는 섹션만 펼친 채로 시작한다 — 빈 섹션까지 열려 있으면 화면만 길어진다.
    SECTIONS.forEach(s => { openState[s.type] = all.some(r => r.type === s.type); });
  }

  function rowsFor(type, all) {
    return all
      .filter(r => r.type === type)
      .sort((a, b) => sortDesc ? (a.createdAt < b.createdAt ? 1 : -1) : (a.createdAt > b.createdAt ? 1 : -1));
  }

  function renderPage() {
    const h = host();
    if (!h) return;
    if (viewingId) { renderReport(h); return; }

    if (!currentUid()) {
      h.innerHTML = pageHeader() +
        '<div class="arc-guest">로그인하면 분석한 리포트가 이곳에 보관됩니다.</div>';
      return;
    }

    ensureOpenState();
    const all = loadIndex();

    const sections = SECTIONS.map(function (s) {
      const rows = rowsFor(s.type, all);
      const isOpenSec = !!openState[s.type];
      const body = rows.length
        ? rows.map(rec =>
            '<div class="arc-row" onclick="Archive.openReport(\'' + rec.id + '\')">' +
              '<span class="arc-row-mark material-symbols-outlined">description</span>' +
              '<span class="arc-row-body">' +
                '<span class="arc-row-name">' + esc(rec.title) + '</span>' +
                (rec.sub ? '<span class="arc-row-sub">' + esc(rec.sub) + '</span>' : '') +
              '</span>' +
              '<button class="arc-row-del" aria-label="삭제" title="삭제" ' +
                'onclick="event.stopPropagation();Archive.remove(\'' + rec.id + '\')">' +
                '<span class="material-symbols-outlined">delete</span></button>' +
            '</div>').join('')
        : '<div class="arc-empty">아직 분석 내용이 없어요</div>';

      return '<section class="arc-acc' + (isOpenSec ? ' is-open' : '') + '">' +
               '<button class="arc-acc-head" onclick="Archive.toggle(\'' + s.type + '\')">' +
                 '<span class="arc-acc-title">' + s.label + '</span>' +
                 (rows.length ? '<span class="arc-acc-count">' + rows.length + '</span>' : '') +
                 '<span class="arc-acc-icon material-symbols-outlined">' + (isOpenSec ? 'remove' : 'add') + '</span>' +
               '</button>' +
               (isOpenSec ? '<div class="arc-acc-body">' + body + '</div>' : '') +
             '</section>';
    }).join('');

    h.innerHTML = pageHeader() +
      '<div class="arc-sort">' +
        '<button class="arc-sort-btn" onclick="Archive.toggleSort()">' +
          (sortDesc ? '최신순' : '오래된순') +
          '<span class="material-symbols-outlined">swap_vert</span></button>' +
      '</div>' +
      sections;
  }

  function pageHeader() {
    return '<div class="arc-page-head">' +
             '<button class="arc-back" aria-label="뒤로" onclick="Archive.closePage()">' +
               '<span class="material-symbols-outlined">arrow_back</span></button>' +
             '<h2>보관함</h2>' +
           '</div>';
  }

  function openReport(id) {
    viewingId = id;
    renderPage();
    window.scrollTo(0, 0);
  }
  function backToList() { viewingId = null; renderPage(); window.scrollTo(0, 0); }

  async function renderReport(h) {
    const rec = loadIndex().find(r => r.id === viewingId);
    const section = SECTIONS.find(s => rec && s.type === rec.type);
    h.innerHTML =
      '<div class="arc-page-head">' +
        '<button class="arc-back" aria-label="목록으로" onclick="Archive.backToList()">' +
          '<span class="material-symbols-outlined">arrow_back</span></button>' +
        '<h2>' + esc(section ? section.label : '리포트') + '</h2>' +
      '</div>' +
      (rec ? '<div class="arc-report-meta">' + esc(rec.title) +
               (rec.sub ? ' · ' + esc(rec.sub) : '') + '</div>' : '') +
      '<div class="arc-report" id="arcReportBody"><div class="arc-empty">리포트를 불러오는 중…</div></div>';

    const html = await loadReportHtml(viewingId);
    const body = document.getElementById('arcReportBody');
    if (!body) return; // 불러오는 사이에 화면을 떠난 경우
    body.innerHTML = html || '<div class="arc-empty">저장된 리포트를 찾을 수 없습니다. 분석을 다시 실행해주세요.</div>';
    // 이미 저장돼 있던 리포트에도 조작 요소가 섞여 있을 수 있어 여는 시점에도 한 번 걷어낸다.
    stripChrome(body);
    attachLiveDogam(body, rec);
  }

  // 인연도감 리포트에는 도감 영역(인연 목록·보관 안내·공유·통합분석 CTA)을 살아있는 상태로 덧붙인다.
  // 스냅샷에 넣지 않는 이유는 그대로다 — 친구가 계속 등록되는 실시간 데이터라 저장 시점에 얼어붙으면
  // 실제 도감과 어긋난다. 대신 열 때마다 지금 상태로 다시 그린다(사용자 요청 2026-08-18).
  // stripChrome 뒤에 붙여야 방금 걷어낸 선택자(.dogam-*)에 다시 걸리지 않는다.
  function attachLiveDogam(body, rec) {
    if (!rec || rec.type !== 'gwansang') return;
    if (!window.Dogam || !Dogam.renderInto) return;
    const live = document.createElement('div');
    live.className = 'arc-live-dogam';
    body.appendChild(live);
    Dogam.renderInto(live);
  }

  // ── 보관함 밖에서 저장된 리포트를 쓰기 위한 창구 ─────────────────────
  // 해당 분석의 기록 전체(최신순). 비로그인·기록 없음이면 빈 배열.
  function listOf(type) {
    return loadIndex()
      .filter(r => r.type === type)
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)) // 항상 최신순 — 목록 화면의 정렬 토글과 무관하게
      .map(r => ({ id: r.id, type: r.type, title: r.title, sub: r.sub, profileId: r.profileId || null, createdAt: r.createdAt, when: fmtWhen(r.createdAt) }));
  }
  function latestOf(type) { return listOf(type)[0] || null; }
  // 저장된 리포트 본문을 임의의 컨테이너에 그린다. 보관함 상세와 같은 정리(조작 요소 제거)를 거친다.
  async function renderInto(el, id) {
    if (!el) return false;
    const html = await loadReportHtml(id);
    if (!html) { el.innerHTML = ''; return false; }
    el.innerHTML = html;
    stripChrome(el);
    return true;
  }

  window.Archive = {
    openPage: openPage, closePage: closePage,
    latestOf: latestOf, listOf: listOf, renderInto: renderInto,
    save: save, commitPending: commitPending, discardPending: discardPending, remove: remove, removeReportsByType: removeReportsByType, debug: debug,
    toggle: toggle, toggleSort: toggleSort,
    openReport: openReport, backToList: backToList,
    loadFromCloud: loadFromCloud, clearLocal: clearLocal,
  };
})();
