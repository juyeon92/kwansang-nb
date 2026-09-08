// ═══ 사주 계산 — 서버 API 클라이언트 (ANALYSIS_LOGIC_SERVER_MIGRATION.md "아직 남은 작업 2번") ═══
// js/character-api.js와 같은 패턴(wallet.js getIdToken() 그대로) — 이 계산도 로그인(익명 포함)된
// 세션에서만 호출되므로 idToken이 항상 있어야 정상이다.
const SajuAPI = (function () {
  async function getIdToken() {
    if (!window.fbAuth || !fbAuth.currentUser) return null;
    try { return await fbAuth.currentUser.getIdToken(); }
    catch (e) { console.error('[saju-api] ID 토큰 발급 실패', e); return null; }
  }

  async function postJson(url, body) {
    const idToken = await getIdToken();
    if (!idToken) throw new Error('로그인이 필요해요.');
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + idToken },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.ok === false) throw new Error(data.error || `요청 실패(${res.status})`);
    return data;
  }

  // birthHour: '-1' 또는 없음 = 시간 미상. 반환: pillars/ohaengCounts/daeun/unseongList/sinsalList/
  // gwiinList/sinkang/yongsin — computeSajuBundle이 돌려주는 것과 같은 모양 그대로.
  async function computeSaju(birthDate, birthHour, gender) {
    const data = await postJson(COMPUTE_SAJU_FUNCTION_URL, { birthDate, birthHour, gender });
    const { ok, ...bundle } = data;
    return bundle;
  }

  return { computeSaju };
})();
