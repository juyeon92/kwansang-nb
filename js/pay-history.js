// ═══ 결제내역 (사용자 본인 화면) ═══
// 관상냥반_냥시스템_기획서.md v2.0 — 잔액 증감을 모두 nyangLedger 원장에 남기는 이유가 "본인도 왜
// 이렇게 됐는지 확인할 수 있어야 한다"였다. js/nyang-history.js(관리자 CS 도구)가 같은 원장을 전체
// 조회하는 것과 달리, 이 화면은 로그인한 본인 것만 보여준다.
//
// nyangLedger는 firestore.rules에서 "본인 것만 read" 허용이라(resource.data.userId == uid),
// 관리자 화면과 달리 Cloud Function 없이 클라이언트에서 바로 조회한다. userId+createdAt 복합
// 인덱스는 firestore.indexes.json에 이 화면을 위해 이미 만들어져 있다.
//
// 확장 지점: type은 grant_admin(관리자 지급)/spend(사용) 두 가지가 실제로 쌓이고, purchase(구매)/
// refund(환불)는 결제 모듈이 붙으면 같은 원장에 같은 구조로 쌓이기 시작한다. TYPE_META에 라벨만
// 이미 채워뒀으니, 그 시점에 이 화면은 코드 변경 없이 그대로 구매내역을 같이 보여준다.
(function () {
  // ⚠️ 탭 구조 신설(2026-09-15, Figma node 87:4832 전체/126:5230 구매/126:5358 사용 재대조) — Figma
  // 배지는 "사용"/"구매" 2종류만 쓴다(냥 지급·환불도 배지 텍스트는 전부 "구매"로 통일하고, 무엇인지는
  // 아래 desc 줄의 실제 항목명으로 구분한다 — "이벤트 지급"/"베이직 패키지 500냥" 등). tab 필드로
  // 전체/구매/사용 필터링에 쓴다.
  const TYPE_META = {
    grant_admin: { label: '냥 지급', cls: 'is-plus', tab: 'purchase' },
    purchase: { label: '냥 구매', cls: 'is-plus', tab: 'purchase' },
    refund: { label: '환불', cls: 'is-minus', tab: 'purchase' },
    spend: { label: '사용', cls: 'is-minus', tab: 'usage' },
  };
  const TAB_META = {
    all: { label: '전체' },
    purchase: { label: '구매' },
    usage: { label: '사용' },
  };
  const TAB_ORDER = ['all', 'purchase', 'usage']; // Figma 탭 순서(왼쪽부터 전체·구매·사용)
  // spend의 note에는 어떤 분석에 썼는지가 feature 코드로 들어온다(wallet.js → profile.js:chargeNyangOrAlert).
  // 보관함(js/archive.js SECTIONS)과 같은 한글 라벨을 쓴다 — 사용자가 보관함에서 보는 이름과 여기서
  // 보는 이름이 다르면 "이게 그건가?" 하고 헷갈린다. 아직 실제로 차감되는 건 combined/gungham뿐이지만
  // saju/gwansang도 향후 유료화될 수 있어 미리 채워둔다.
  const FEATURE_LABEL = { combined: '통합분석', gungham: '궁합보기', gwansang: '인연도감', saju: '사주보기' };

  let rows = null;      // null = 아직 안 불러옴
  let loadError = null;
  let activeTab = 'all';   // 'all' | 'purchase' | 'usage' — Figma 3탭
  let sortAsc = false;     // false = 최신순(기본, Firestore 쿼리와 동일), true = 오래된순(클라이언트에서 뒤집기만 함)

  function host() { return document.getElementById('panel-payhistory'); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function fmtTime(ms) {
    if (!ms) return '-';
    const d = new Date(ms), p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }

  // ⚠️ 팝업 → 페이지 전환(2026-09-15, Figma 재대조) — 마이페이지 메뉴에서 들어오는 건 그대로지만,
  // 화면 자체는 더 이상 "닫기(X)"로 되돌아가는 팝업이 아니라 다른 탭들처럼 그 자리에 계속 떠 있는
  // 페이지다. 나가는 길은 하단 네비게이션(다른 탭 클릭)뿐이라 close()/prevTab은 더 이상 쓰이지 않아
  // 걷어냈다.
  function open() {
    if (window.KakaoAuth && KakaoAuth.closePopup) KakaoAuth.closePopup();
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    host().classList.add('active');
    rows = null; loadError = null; activeTab = 'all'; sortAsc = false;
    render();
    window.scrollTo(0, 0);
    load();
  }

  async function load() {
    rows = null; loadError = null; render();
    if (!window.fbDb || !window.fbAuth || !fbAuth.currentUser) {
      loadError = '로그인이 필요해요.'; rows = []; render(); return;
    }
    try {
      const snap = await fbDb.collection('nyangLedger')
        .where('userId', '==', fbAuth.currentUser.uid)
        .orderBy('createdAt', 'desc')
        .limit(100)
        .get();
      rows = snap.docs.map(doc => {
        const d = doc.data() || {};
        return {
          ledgerId: doc.id, type: d.type, amount: d.amount, balanceAfter: d.balanceAfter,
          note: d.note || '',
          createdAt: (d.createdAt && d.createdAt.toMillis) ? d.createdAt.toMillis() : null,
        };
      });
    } catch (e) {
      console.error('[pay-history] 내역 조회 실패', e);
      loadError = '내역을 불러오지 못했어요.';
      rows = [];
    }
    render();
  }

  function rowHtml(r) {
    const meta = TYPE_META[r.type] || { label: r.type, cls: '', tab: 'purchase' };
    const sign = r.amount > 0 ? '+' : '';
    const desc = r.type === 'spend' ? (FEATURE_LABEL[r.note] || r.note || meta.label) : (r.note || meta.label);
    // Figma 배지는 세부 라벨(냥 지급/환불 등)이 아니라 탭 이름(구매/사용) 그대로를 쓴다 — 세부 항목은
    // desc(아래 제목 줄)로 이미 구분되므로, 배지는 "이게 어느 탭에 속하는지"만 보여준다.
    const badgeLabel = (TAB_META[meta.tab] && TAB_META[meta.tab].label) || meta.label;
    return '<div class="ph-row">' +
        '<div class="ph-row-main">' +
          '<span class="ph-badge ' + meta.cls + '">' + esc(badgeLabel) + '</span>' +
          '<span class="ph-desc">' + esc(desc) + '</span>' +
          '<span class="ph-amount ' + meta.cls + '">' + sign + r.amount + '냥</span>' +
        '</div>' +
        '<div class="ph-row-sub">' +
          esc(fmtTime(r.createdAt)) + ' · 잔액 ' + esc(String(r.balanceAfter)) + '냥' +
        '</div>' +
      '</div>';
  }

  function tabsHtml() {
    return '<div class="ph-tabs">' +
      TAB_ORDER.map(function (tab) {
        return '<button type="button" class="ph-tab' + (activeTab === tab ? ' is-on' : '') + '" onclick="PayHistory.setTab(\'' + tab + '\')">' +
          esc(TAB_META[tab].label) + '</button>';
      }).join('') +
      '</div>';
  }

  function render() {
    const h = host();
    if (!h) return;

    // Figma는 탭마다("전체"·"구매"·"사용") 목록 자체가 달라진다 — 로딩/에러 상태에서도 탭은
    // 그대로 눌러볼 수 있어야 하므로 탭바는 항상 그리고, 그 아래 목록 영역만 상태에 따라 바꾼다.
    const filtered = rows === null ? null : (activeTab === 'all' ? rows : rows.filter(r => (TYPE_META[r.type] || {}).tab === activeTab));
    const sorted = filtered && sortAsc ? filtered.slice().reverse() : filtered;

    let listArea;
    if (loadError) {
      listArea = '<div class="ph-empty">' + esc(loadError) + '</div>';
    } else if (sorted === null) {
      listArea = '<div class="ph-empty">불러오는 중…</div>';
    } else if (!sorted.length) {
      listArea = '<div class="ph-empty">' + (activeTab === 'all' ? '아직 결제·사용 내역이 없어요.' : '아직 ' + esc(TAB_META[activeTab].label) + ' 내역이 없어요.') + '</div>';
    } else {
      listArea =
        '<div class="ph-toolbar">' +
          '<span class="ph-count">총 <b>' + sorted.length + '건</b></span>' +
          '<button type="button" class="ph-sort-btn" onclick="PayHistory.toggleSort()">' +
            esc(sortAsc ? '오래된순' : '최신순') +
            '<span class="material-symbols-outlined">swap_vert</span>' +
          '</button>' +
        '</div>' +
        '<div class="ph-list">' + sorted.map(rowHtml).join('') + '</div>';
    }

    h.innerHTML =
      '<div class="arc-page-head"><h2>결제내역</h2></div>' +
      '<div class="ph-card">' + tabsHtml() + listArea + '</div>';
  }

  function setTab(tab) {
    if (!TAB_META[tab] || tab === activeTab) return;
    activeTab = tab;
    render();
  }
  function toggleSort() {
    sortAsc = !sortAsc;
    render();
  }

  window.PayHistory = { open: open, reload: load, setTab: setTab, toggleSort: toggleSort };
})();
