// ═══ 냥 구매 페이지 (관상냥반_냥시스템_기획서.md v2.0) ═══
// 팝업이 아니라 .wrap 안의 페이지(#panel-nyangshop)다 — 보관함(js/archive.js)과 같은 방식으로
// .panel을 갈아끼워 "화면 이동"처럼 보이게 한다(라우터가 없는 정적 사이트라 이 패턴을 그대로 따랐다).
//
// ⚠️ 결제(PG) 연동은 기획서 표지에 명시된 대로 이번 스코프가 아니다. 그래서 이 페이지는 "가격표를
// 보여주고 상품을 고르는 데"까지만 담당하고, 실제 결제 버튼은 준비중 안내로 끝난다. 결제가 붙는
// 시점에 buy()의 안내 부분만 PG 호출로 바꾸면 되고, 냥 지급은 서버가 NyangLedger에 type='purchase'로
// 기록하는 흐름(기획서 §6)이라 이 파일은 더 손댈 필요가 없다.
(function () {
  // 가격표 — 사용자 요청 2026-08-16: "우선은 1냥 990원, 가격표는 1냥만". 묶음 상품(3냥/5냥/10냥 등)은
  // 여기 배열에 행을 추가하기만 하면 화면·선택 로직이 그대로 따라간다.
  const PRODUCTS = [
    { id: 'nyang1', name: '냥 1개', desc: '통합분석 1회', amount: 1, price: 990 },
  ];

  let prevTab = 'combined';
  let selectedId = null;

  function host() { return document.getElementById('panel-nyangshop'); }
  function won(n) { return n.toLocaleString('ko-KR') + '원'; }

  function open() {
    if (window.KakaoAuth && KakaoAuth.closePopup) KakaoAuth.closePopup(); // 마이페이지에서 넘어온 경우
    const active = document.querySelector('.panel.active');
    if (active && active.id !== 'panel-nyangshop') prevTab = active.id.replace('panel-', '');
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    host().classList.add('active');
    selectedId = null;
    render();
    window.scrollTo(0, 0);
    if (window.Wallet) Wallet.fetchBalance().then(render); // 보유 냥은 서버 확인 후 다시 그린다
  }

  // 들어오기 전에 보던 탭으로 되돌린다(보관함 closePage와 같은 방식).
  function close() {
    const btns = Array.from(document.querySelectorAll('.tab-btn'));
    const btn = btns.find(b => (b.getAttribute('onclick') || '').indexOf("'" + prevTab + "'") >= 0) || btns[0];
    if (btn) btn.click();
    window.scrollTo(0, 0);
  }

  function select(id) { selectedId = id; render(); }

  function buy() {
    const p = PRODUCTS.find(x => x.id === selectedId);
    if (!p) return;
    // 결제 모듈이 붙기 전까지는 여기서 끝난다. 냥을 임의로 늘려주는 임시 코드는 절대 넣지 않는다 —
    // 잔액은 서버(Cloud Function)만 바꿀 수 있고, 테스트용 충전은 관리자 지급(기획서 §3.3)으로 한다.
    if (window.KakaoAuth && KakaoAuth.showConfirm) {
      KakaoAuth.showConfirm(p.name + ' · ' + won(p.price) + '\n결제 기능은 준비 중이에요.\n지금은 관리자 지급으로만 냥을 받을 수 있어요.', '확인', function () {});
    } else {
      alert('결제 기능은 준비 중이에요.');
    }
  }

  function render() {
    const h = host();
    if (!h) return;
    const balance = window.Wallet ? Wallet.getCachedBalance() : null;
    const balanceText = balance == null ? '–' : balance + '냥';
    const rows = PRODUCTS.map(function (p) {
      return '<button class="shop-row' + (selectedId === p.id ? ' is-selected' : '') + '" onclick="NyangShop.select(\'' + p.id + '\')">' +
          '<div class="shop-row-info">' +
            '<div class="shop-row-name">' + p.name + '</div>' +
            '<div class="shop-row-desc">' + p.desc + '</div>' +
          '</div>' +
          '<div class="shop-row-price">' + won(p.price) + '</div>' +
        '</button>';
    }).join('');

    const picked = PRODUCTS.find(function (x) { return x.id === selectedId; });
    h.innerHTML =
      '<div class="shop-head">' +
        '<h2>냥 가격표</h2>' +
        '<button class="shop-close" onclick="NyangShop.close()" aria-label="닫기"><span class="material-symbols-outlined">close</span></button>' +
      '</div>' +
      '<div class="shop-balance">보유 냥 <strong>' + balanceText + '</strong></div>' +
      '<div class="shop-menu-card">' +
        '<div class="shop-menu-title">MENU</div>' +
        '<div class="shop-menu-coin"><span class="shop-menu-coin-label">냥</span><span class="shop-menu-coin-price">990원</span></div>' +
        '<div class="shop-menu-note">냥 1개로 통합분석 1회를 볼 수 있어요</div>' +
      '</div>' +
      '<div class="shop-list">' + rows + '</div>' +
      '<div class="shop-cta-dock">' +
        '<button class="submit-btn" onclick="NyangShop.buy()"' + (picked ? '' : ' disabled') + '>' +
          (picked ? picked.name + ' · ' + won(picked.price) + ' 구매하기' : '상품을 선택하세요') +
        '</button>' +
      '</div>';
  }

  window.NyangShop = { open: open, close: close, select: select, buy: buy };
})();
