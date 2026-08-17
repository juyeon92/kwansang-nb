// ═══ 냥 내역 (관리자 전용 · CS 대응용) ═══
// 관상냥반_냥시스템_기획서.md v2.0 §1 — 잔액만 두지 않고 모든 증감을 NyangLedger에 남기는 이유가
// "왜 이렇게 됐는지 추적 가능해야 CS 대응·감사가 된다"였다. 이 화면이 그 원장을 실제로 읽는 자리다.
//
// 보이는 것: 관리자 지급(grant_admin) + 사용자 사용(spend) + 향후 구매(purchase)/환불(refund)까지
// 같은 원장에 쌓이므로 type만 추가되면 이 화면은 그대로 따라간다(기획서 §6 확장 구조).
// 각 행에 balanceAfter(그 시점 잔액)가 함께 있어, 취소·환불 문의가 왔을 때 당시 상태를 재구성할 수 있다.
//
// ⚠️ nyangLedger는 firestore.rules에서 "본인 것만 read"라 클라이언트가 전체를 못 읽는다.
// 반드시 Cloud Function(adminNyangHistory)을 거치며, 서버에서도 admin 여부를 다시 검증한다.
(function () {
  const TYPE_TABS = [
    { key: 'all', label: '전체' },
    { key: 'grant_admin', label: '관리자 지급' },
    { key: 'spend', label: '사용' },
    { key: 'purchase', label: '구매' },
  ];
  // 원장 type → 화면 표기. purchase/refund는 결제 모듈이 붙으면 실제로 쌓이기 시작한다.
  const TYPE_META = {
    grant_admin: { label: '관리자 지급', cls: 'is-plus' },
    purchase: { label: '구매', cls: 'is-plus' },
    refund: { label: '환불', cls: 'is-minus' },
    spend: { label: '사용', cls: 'is-minus' },
  };
  // spend의 note에는 어떤 분석에 썼는지가 들어온다(wallet.js가 feature를 그대로 note로 넘김).
  const FEATURE_LABEL = { combined: '통합분석', gungham: '궁합 분석' };

  let prevTab = 'combined';
  let rows = null;      // null = 아직 안 불러옴
  let loadError = null;
  let activeType = 'all';
  // 사용자 지정 조회 — 닉네임/이메일/uid로 찾아 한 사람의 거래만 본다(CS에서 "이 사람 내역만").
  let searchResults = null;   // null = 검색 안 함
  let searchError = null;
  let pickedUser = null;      // { uid, nickname, account, balance }

  function host() { return document.getElementById('panel-nyanghistory'); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function fmtTime(ms) {
    if (!ms) return '-';
    const d = new Date(ms), p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }

  function open() {
    if (window.KakaoAuth && KakaoAuth.closePopup) KakaoAuth.closePopup();
    const active = document.querySelector('.panel.active');
    if (active && active.id !== 'panel-nyanghistory') prevTab = active.id.replace('panel-', '');
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    host().classList.add('active');
    rows = null; loadError = null; activeType = 'all';
    render();
    window.scrollTo(0, 0);
    load();
  }

  function close() {
    const btns = Array.from(document.querySelectorAll('.tab-btn'));
    const btn = btns.find(b => (b.getAttribute('onclick') || '').indexOf("'" + prevTab + "'") >= 0) || btns[0];
    if (btn) btn.click();
    window.scrollTo(0, 0);
  }

  async function load() {
    rows = null; loadError = null; render();
    try {
      rows = await Wallet.adminHistory(activeType, 200, pickedUser ? pickedUser.uid : '');
    } catch (e) {
      loadError = e.message || '내역을 불러오지 못했어요.';
      rows = [];
    }
    render();
  }

  function setType(t) { activeType = t; load(); }

  // ── 사용자 검색 ──────────────────────────────────────────────────────
  // 관리자 지급 화면과 같은 검색 API를 재사용한다(adminSearchUsers) — 닉네임·이메일·uid 부분 일치.
  async function search() {
    const input = document.getElementById('nhSearchInput');
    const q = input ? input.value.trim() : '';
    if (!q) { searchResults = null; searchError = null; render(); return; }
    searchResults = 'loading'; searchError = null; render();
    try {
      searchResults = await Wallet.adminSearchUsers(q);
    } catch (e) {
      searchError = e.message || '검색에 실패했어요.';
      searchResults = [];
    }
    render();
  }
  function pickUser(uid) {
    const list = Array.isArray(searchResults) ? searchResults : [];
    pickedUser = list.find(u => u.uid === uid) || null;
    searchResults = null;
    load();
  }
  function clearUser() { pickedUser = null; searchResults = null; searchError = null; load(); }
  // 엔터로도 검색되게 — 검색 버튼까지 가지 않아도 되도록.
  function onSearchKey(e) { if (e && e.key === 'Enter') search(); }

  function rowHtml(r) {
    const meta = TYPE_META[r.type] || { label: r.type, cls: '' };
    const who = r.nickname || r.account || r.userId;
    const sign = r.amount > 0 ? '+' : '';
    // spend는 note가 feature 코드라 한글로 바꿔주고, 지급은 note가 사유 텍스트라 그대로 쓴다.
    const note = r.type === 'spend' ? (FEATURE_LABEL[r.note] || r.note || '') : (r.note || '');
    return '<div class="nh-row">' +
        '<div class="nh-row-main">' +
          '<span class="nh-badge ' + meta.cls + '">' + esc(meta.label) + '</span>' +
          '<span class="nh-who">' + esc(who) + '</span>' +
          '<span class="nh-amount ' + meta.cls + '">' + sign + r.amount + '냥</span>' +
        '</div>' +
        '<div class="nh-row-sub">' +
          esc(fmtTime(r.createdAt)) +
          (note ? ' · ' + esc(note) : '') +
          ' · 처리 후 잔액 ' + esc(String(r.balanceAfter)) + '냥' +
        '</div>' +
        // CS에서 특정 거래를 특정하려면 원장 id가 필요하다 — 눈에 띄지 않게 작게 남긴다.
        '<div class="nh-row-id">' + esc(r.ledgerId) + (r.account ? ' · ' + esc(r.account) : '') + '</div>' +
      '</div>';
  }

  function render() {
    const h = host();
    if (!h) return;

    const tabs = TYPE_TABS.map(t =>
      '<button class="nh-tab' + (activeType === t.key ? ' is-on' : '') + '" onclick="NyangHistory.setType(\'' + t.key + '\')">' +
        t.label + '</button>').join('');

    let body;
    if (loadError) {
      body = '<div class="nh-empty">' + esc(loadError) + '</div>';
    } else if (rows === null) {
      body = '<div class="nh-empty">불러오는 중…</div>';
    } else if (!rows.length) {
      body = '<div class="nh-empty">아직 내역이 없어요.</div>';
    } else {
      const plus = rows.filter(r => r.amount > 0).reduce((s, r) => s + r.amount, 0);
      const minus = rows.filter(r => r.amount < 0).reduce((s, r) => s + r.amount, 0);
      body = '<div class="nh-summary">' +
          '<span>총 ' + rows.length + '건</span>' +
          '<span class="is-plus">지급·구매 +' + plus + '냥</span>' +
          '<span class="is-minus">사용 ' + minus + '냥</span>' +
        '</div>' + rows.map(rowHtml).join('');
    }

    // 검색 결과 목록 — 고르면 그 사용자 내역만 보게 된다.
    let searchBlock = '';
    if (searchError) {
      searchBlock = '<div class="nh-search-msg">' + esc(searchError) + '</div>';
    } else if (searchResults === 'loading') {
      searchBlock = '<div class="nh-search-msg">검색 중…</div>';
    } else if (Array.isArray(searchResults)) {
      searchBlock = searchResults.length
        ? '<div class="nh-search-list">' + searchResults.map(u =>
            '<button class="nh-search-row" onclick="NyangHistory.pickUser(\'' + esc(u.uid) + '\')">' +
              '<span class="nh-search-name">' + esc(u.nickname || u.account || u.uid) + '</span>' +
              '<span class="nh-search-sub">' + esc(u.account || u.uid) + ' · 보유 ' + esc(String(u.balance)) + '냥</span>' +
            '</button>').join('') + '</div>'
        : '<div class="nh-search-msg">일치하는 사용자가 없어요.</div>';
    }

    const pickedBlock = pickedUser
      ? '<div class="nh-picked">' +
          '<span class="nh-picked-name">' + esc(pickedUser.nickname || pickedUser.account || pickedUser.uid) + '</span>' +
          '<span class="nh-picked-sub">' + esc(pickedUser.account || pickedUser.uid) + '</span>' +
          // "전체 보기"라고 쓰면 타입 탭까지 초기화되는 걸로 읽힌다 — 실제로는 사용자 한정만 푸는 버튼이라
          // 라벨을 "전체 사용자"로 둔다(선택된 타입 탭은 그대로 유지된다).
          '<button class="nh-picked-clear" onclick="NyangHistory.clearUser()">전체 사용자</button>' +
        '</div>'
      : '';

    h.innerHTML =
      '<div class="shop-head">' +
        '<h2>냥 내역</h2>' +
        '<button class="shop-close" onclick="NyangHistory.close()" aria-label="닫기"><span class="material-symbols-outlined">close</span></button>' +
      '</div>' +
      '<div class="nh-search-row-wrap">' +
        '<input type="text" id="nhSearchInput" class="field-input" placeholder="닉네임 · 이메일 · 아이디로 찾기" ' +
          'onkeydown="NyangHistory._key(event)">' +
        '<button class="btn-outline-primary btn-md" onclick="NyangHistory.search()">검색</button>' +
      '</div>' +
      searchBlock +
      pickedBlock +
      '<div class="nh-tabs">' + tabs + '</div>' +
      body;
  }

  window.NyangHistory = {
    open: open, close: close, setType: setType, reload: load,
    search: search, pickUser: pickUser, clearUser: clearUser, _key: onSearchKey,
  };
})();
