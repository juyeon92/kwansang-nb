// ═══ AI 리포트 3종 — 서버 API 클라이언트 (ANALYSIS_LOGIC_SERVER_MIGRATION.md "아직 남은 작업 3번") ═══
// js/character-api.js·js/saju-api.js와 같은 패턴(wallet.js getIdToken() 그대로). 시스템 프롬프트·
// 스키마·Gemini 호출은 전부 서버(functions/engine/prompt-builders.js) 안에서 끝나고, 여기서는
// 원재료를 보내고 최종 리포트 텍스트(JSON)만 받는다 — 실패하면 null을 돌려줘서 호출부가 기존
// "AI 실패 시 로컬 카드만 노출" 폴백을 그대로 쓸 수 있게 한다(에러를 던지지 않음).
const AiReportAPI = (function () {
  async function getIdToken() {
    if (!window.fbAuth || !fbAuth.currentUser) return null;
    try { return await fbAuth.currentUser.getIdToken(); }
    catch (e) { console.error('[ai-report-api] ID 토큰 발급 실패', e); return null; }
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

  // opts: { ratios, statusMap, pillars, ohaeng, sajuInsight, relVal, archetypeAnalysis, sewoonInfo,
  //         zone1Character, zone3Extra, situation, hasSaju, hasFace, q1, q2, q3, imageDataUrl }
  async function generateDeepReport(opts) {
    const data = await postJson(GENERATE_DEEP_REPORT_FUNCTION_URL, opts);
    return data.data;
  }

  // opts: { ratios, statusMap, pillars, ohaeng, imageDataUrl }
  async function generateAiEnhancement(opts) {
    const data = await postJson(GENERATE_AI_ENHANCEMENT_FUNCTION_URL, opts);
    return data.data;
  }

  // opts: { cache, isRomantic, nameA, nameB, images }
  async function generateGunghapReport(opts) {
    const data = await postJson(GENERATE_GUNGHAP_REPORT_FUNCTION_URL, opts);
    return data.data;
  }

  return { generateDeepReport, generateAiEnhancement, generateGunghapReport };
})();
