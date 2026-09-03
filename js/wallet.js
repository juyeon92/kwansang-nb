// ═══ 냥(포인트) 지갑 — 관상냥반_냥시스템_기획서.md v2.0 ═══
// wallets/{uid}는 firestore.rules에서 클라이언트 write를 완전히 막아뒀다(read만 허용) — 잔액 증감은
// 반드시 이 파일이 호출하는 Cloud Function(Admin SDK, 트랜잭션 처리)을 거친다. 그래서 이 파일엔
// balance를 직접 쓰는 코드가 없고, 전부 "서버에 물어보고 서버가 알려준 값을 캐시"하는 구조다.
(function () {
  let cachedBalance = null; // 마지막으로 서버가 확인해준 값 — UI 즉시 표시용(신뢰의 원천은 항상 서버)

  async function getIdToken() {
    if (!window.fbAuth || !fbAuth.currentUser) return null;
    try { return await fbAuth.currentUser.getIdToken(); }
    catch (e) { console.error('[wallet] ID 토큰 발급 실패', e); return null; }
  }

  // 로그인 상태에서만 의미가 있다 — 비로그인이면 지갑 자체가 없다(가입=카카오 로그인이 곧 지갑 생성 시점).
  async function fetchBalance() {
    if (!window.fbDb || !window.fbAuth || !fbAuth.currentUser) { cachedBalance = null; return null; }
    try {
      const doc = await fbDb.collection('wallets').doc(fbAuth.currentUser.uid).get();
      cachedBalance = doc.exists ? (doc.data().balance || 0) : 0;
      return cachedBalance;
    } catch (e) {
      console.error('[wallet] 잔액 조회 실패', e);
      return cachedBalance;
    }
  }

  function getCachedBalance() { return cachedBalance; }

  // feature: 'combined' | 'gungham' — 어떤 분석에 썼는지 Ledger의 note로 남는다.
  // relatedId: 있으면 어떤 리포트에 썼는지 추적용(현재는 아직 report_id가 차감 시점엔 없어 생략 가능).
  // 반환: { ok:true, balance, ticketId } | { ok:false, error, code }
  // ⚠️ ticketId는 functions/index.js analyzeCharacter가 요구하는 1회용 결제 증표다 — 차감이 끝났다고
  // 곧바로 분석을 시작하지 말고, 반드시 이 ticketId를 CharacterAPI.analyzeCharacter 호출에 함께
  // 실어 보내야 한다(js/ai-analysis.js CTX_CONFIG 참고). 그냥 잔액만 깎고 ticketId를 버리면 서버가
  // "결제가 필요합니다"로 analyzeCharacter를 거절한다.
  async function spend(feature, relatedId) {
    if (!NYANG_SPEND_FUNCTION_URL) {
      // 배포 전 로컬 확인 단계 — 차감 없이 항상 통과시킨다(기존 GEMINI_PROXY_URL 미설정 시 패턴과 동일).
      console.warn('[wallet] NYANG_SPEND_FUNCTION_URL 미설정 — 냥 차감을 건너뜁니다(배포 전 로컬 테스트 전용).');
      return { ok: true, balance: cachedBalance, skipped: true };
    }
    const idToken = await getIdToken();
    if (!idToken) return { ok: false, error: '로그인이 필요해요.', code: 'LOGIN_REQUIRED' };
    try {
      const res = await fetch(NYANG_SPEND_FUNCTION_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + idToken },
        body: JSON.stringify({ feature, relatedId: relatedId || null }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) return { ok: false, error: data.error || '냥 차감에 실패했어요.', code: data.code };
      cachedBalance = data.balance;
      return { ok: true, balance: data.balance, ticketId: data.ticketId };
    } catch (e) {
      console.error('[wallet] 차감 요청 실패', e);
      return { ok: false, error: '네트워크 오류로 냥 차감에 실패했어요. 잠시 후 다시 시도해주세요.' };
    }
  }


  // ── 관리자 전용 — kakao-auth.js의 마이페이지 관리자 섹션에서만 호출된다 ──
  async function adminSearchUsers(q) {
    const idToken = await getIdToken();
    if (!idToken) throw new Error('로그인이 필요해요.');
    const res = await fetch(NYANG_ADMIN_SEARCH_FUNCTION_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + idToken },
      body: JSON.stringify({ q }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '검색에 실패했어요.');
    return data.users || [];
  }

  async function adminGrant(targetUserId, amount, reason) {
    const idToken = await getIdToken();
    if (!idToken) throw new Error('로그인이 필요해요.');
    const res = await fetch(NYANG_ADMIN_GRANT_FUNCTION_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + idToken },
      body: JSON.stringify({ targetUserId, amount, reason }),
    });
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || '지급에 실패했어요.');
    return data.balance;
  }

  // 냥 내역 전체 조회(관리자 전용) — nyangLedger는 규칙상 본인 것만 읽히므로 서버를 거친다.
  async function adminHistory(type, limit, userId) {
    const idToken = await getIdToken();
    if (!idToken) throw new Error('로그인이 필요해요.');
    const res = await fetch(NYANG_ADMIN_HISTORY_FUNCTION_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + idToken },
      body: JSON.stringify({ type: type || 'all', limit: limit || 100, userId: userId || '' }),
    });
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || '내역을 불러오지 못했어요.');
    return data.rows || [];
  }

  window.Wallet = { fetchBalance, getCachedBalance, spend, adminSearchUsers, adminGrant, adminHistory };
})();
