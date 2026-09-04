// ═══ 냥 구매 페이지 (관상냥반_냥시스템_기획서.md v2.0) ═══
// 팝업이 아니라 .wrap 안의 페이지(#panel-nyangshop)다 — 보관함(js/archive.js)과 같은 방식으로
// .panel을 갈아끼워 "화면 이동"처럼 보이게 한다(라우터가 없는 정적 사이트라 이 패턴을 그대로 따랐다).
//
// ⚠️ 2026-09-03 카카오페이 연동 — 아직 카카오페이 가맹점 심사 전이라 functions/index.js의
// KAKAO_PAY_CID가 테스트 코드(TC0ONETIME)로 되어 있다. 코드 흐름 자체는 실제 가맹점 승인 후에도
// CID만 실제 값으로 바꾸면 그대로 쓸 수 있다 — 결제창 진입부터 승인·냥 지급까지 전부 이 상태로 동작한다.
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

  function notify(msg) {
    if (window.KakaoAuth && KakaoAuth.showConfirm) KakaoAuth.showConfirm(msg, '확인', function () {});
    else alert(msg);
  }

  async function buy() {
    const p = PRODUCTS.find(x => x.id === selectedId);
    if (!p) return;
    if (!window.fbAuth || !fbAuth.currentUser) { notify('로그인 후 구매할 수 있어요.'); return; }
    if (!KAKAO_PAY_READY_FUNCTION_URL) {
      // 함수가 아직 배포 전이면 예전과 같은 "준비 중" 안내로 폴백 — 잔액은 절대 임의로 늘리지 않는다.
      notify(p.name + ' · ' + won(p.price) + '\n결제 기능은 준비 중이에요.');
      return;
    }
    const btn = document.querySelector('.shop-cta-dock .submit-btn');
    if (btn) { btn.disabled = true; btn.textContent = '결제 준비 중...'; }
    const result = await Wallet.kakaoPayReady(p.id);
    if (!result.ok) {
      notify(result.error || '결제 준비에 실패했어요.');
      render();
      return;
    }
    // 모바일 브라우저는 카카오페이 앱/모바일웹으로, PC는 QR·카드결제 선택 화면으로 — 카카오가 각각
    // 다른 리다이렉트 주소를 내려준다. 돌아올 때는 kakaoPayReady가 등록해둔 approval_url(정적 주소)로
    // 오므로 이 페이지 상태와 무관하게 항상 같은 곳(냥샵)으로 복귀한다.
    const isMobile = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);
    const redirectUrl = isMobile ? result.next_redirect_mobile_web_url : result.next_redirect_pc_url;
    window.location.href = redirectUrl || result.next_redirect_pc_url;
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

  // 카카오페이 결제창에서 돌아왔을 때(성공/취소/실패) 처리 — kakao-auth.js의 onAuthStateChanged에서
  // 로그인이 확정된 직후 호출된다. URL 쿼리스트링만으로 판단하고, 처리 즉시 지워서 새로고침해도
  // 중복 승인 요청이 나가지 않게 한다(서버도 kakaoPayOrders.status로 한 번 더 막아주지만 이중 방어).
  function handleKakaoPayReturn() {
    const params = new URLSearchParams(window.location.search);
    const kakaopay = params.get('kakaopay');
    if (!kakaopay) return;
    const orderId = params.get('orderId');
    const pgToken = params.get('pg_token');
    history.replaceState(null, '', window.location.pathname);

    if (kakaopay === 'cancel') { notify('결제를 취소했어요.'); return; }
    if (kakaopay === 'fail') { notify('결제에 실패했어요. 다시 시도해주세요.'); return; }
    if (kakaopay !== 'success' || !orderId || !pgToken) return;

    open();
    notify('결제를 확인하고 있어요...');
    Wallet.kakaoPayApprove(orderId, pgToken).then(function (result) {
      if (result.ok) {
        notify(result.alreadyCompleted ? '이미 처리된 결제예요. 보유 냥 ' + result.balance + '냥.' : '결제가 완료됐어요! 냥이 충전됐어요.');
      } else {
        notify(result.error || '결제 승인에 실패했어요. 문의해주세요.');
      }
      render();
    });
  }

  window.NyangShop = { open: open, close: close, select: select, buy: buy, handleKakaoPayReturn: handleKakaoPayReturn };
})();
