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
  const TYPE_META = {
    grant_admin: { label: '냥 지급', cls: 'is-plus' },
    purchase: { label: '냥 구매', cls: 'is-plus' },
    refund: { label: '환불', cls: 'is-minus' },
    spend: { label: '사용', cls: 'is-minus' },
  };
  // spend의 note에는 어떤 분석에 썼는지가 feature 코드로 들어온다(wallet.js → profile.js:chargeNyangOrAlert).
  // 보관함(js/archive.js SECTIONS)과 같은 한글 라벨을 쓴다 — 사용자가 보관함에서 보는 이름과 여기서
  // 보는 이름이 다르면 "이게 그건가?" 하고 헷갈린다. 아직 실제로 차감되는 건 combined/gungham뿐이지만
  // saju/gwansang도 향후 유료화될 수 있어 미리 채워둔다.
  const FEATURE_LABEL = { combined: '통합분석', gungham: '궁합보기', gwansang: '인연도감', saju: '사주보기' };

  let prevTab = 'combined';
  let rows = null;      // null = 아직 안 불러옴
  let loadError = null;

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

  function open() {
    if (window.KakaoAuth && KakaoAuth.closePopup) KakaoAuth.closePopup();
    const active = document.querySelector('.panel.active');
    if (active && active.id !== 'panel-payhistory') prevTab = active.id.replace('panel-', '');
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    host().classList.add('active');
    rows = null; loadError = null;
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
    const meta = TYPE_META[r.type] || { label: r.type, cls: '' };
    const sign = r.amount > 0 ? '+' : '';
    const desc = r.type === 'spend' ? (FEATURE_LABEL[r.note] || r.note || meta.label) : (r.note || meta.label);
    return '<div class="ph-row">' +
        '<div class="ph-row-main">' +
          '<span class="ph-badge ' + meta.cls + '">' + esc(meta.label) + '</span>' +
          '<span class="ph-desc">' + esc(desc) + '</span>' +
          '<span class="ph-amount ' + meta.cls + '">' + sign + r.amount + '냥</span>' +
        '</div>' +
        '<div class="ph-row-sub">' +
          esc(fmtTime(r.createdAt)) + ' · 잔액 ' + esc(String(r.balanceAfter)) + '냥' +
        '</div>' +
      '</div>';
  }

  function render() {
    const h = host();
    if (!h) return;

    let body;
    if (loadError) {
      body = '<div class="ph-empty">' + esc(loadError) + '</div>';
    } else if (rows === null) {
      body = '<div class="ph-empty">불러오는 중…</div>';
    } else if (!rows.length) {
      body = '<div class="ph-empty">아직 결제·사용 내역이 없어요.</div>';
    } else {
      const plus = rows.filter(r => r.amount > 0).reduce((s, r) => s + r.amount, 0);
      const minus = rows.filter(r => r.amount < 0).reduce((s, r) => s + r.amount, 0);
      body = '<div class="ph-summary">' +
          '<span>총 ' + rows.length + '건</span>' +
          '<span class="is-plus">지급·구매 +' + plus + '냥</span>' +
          '<span class="is-minus">사용 ' + minus + '냥</span>' +
        '</div>' + rows.map(rowHtml).join('');
    }

    h.innerHTML =
      '<div class="shop-head">' +
        '<h2>결제내역</h2>' +
        '<button class="shop-close" onclick="PayHistory.close()" aria-label="닫기"><span class="material-symbols-outlined">close</span></button>' +
      '</div>' +
      body;
  }

  window.PayHistory = { open: open, close: close, reload: load };
})();
