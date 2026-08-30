// ═══ 16캐릭터 판정 / 궁합 — 서버 API 클라이언트 (2026-08-30 DB 이원화 1단계) ═══
// js/character/character-engine.js·compatibility-engine.js(판단 가중치·공식)를 functions/engine/으로
// 옮기면서, 클라이언트는 이 파일을 통해서만 결과를 받는다. wallet.js의 getIdToken() 패턴을 그대로
// 따른다 — 이 판정은 nyangSpend로 이미 인증된 세션에서만 호출되므로 idToken이 항상 있어야 정상이다.
const CharacterAPI = (function () {
  async function getIdToken() {
    if (!window.fbAuth || !fbAuth.currentUser) return null;
    try { return await fbAuth.currentUser.getIdToken(); }
    catch (e) { console.error('[character-api] ID 토큰 발급 실패', e); return null; }
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

  // opts: { featureIds, confidences, partStatusMap, pillars, ohaengCounts, sinsalList, gwiinList, hasHour }
  // 반환: characterResult 원본 객체(+ faceOnlyCharacterId) — 원래 클라이언트 computeCharacterResult()가
  // 돌려주던 것과 같은 모양. 실패하면 null(기존 로컬 계산이 실패 없이 늘 값을 내던 것과 달리 네트워크
  // 오류가 새로 생기므로, 호출부가 null을 기존 "판별 실패" 케이스와 동일하게 다루면 된다).
  async function analyzeCharacter(opts) {
    try {
      const data = await postJson(ANALYZE_CHARACTER_FUNCTION_URL, opts);
      return data.characterResult || null;
    } catch (e) {
      console.error('[character-api] analyzeCharacter 실패', e);
      return null;
    }
  }

  // characterId 하나의 good/spark/clash 관계만 필요할 때
  async function getRelation(characterId) {
    if (!characterId) return null;
    try {
      const data = await postJson(GET_COMPATIBILITY_FUNCTION_URL, { characterId });
      return data.relation || null;
    } catch (e) {
      console.error('[character-api] getRelation 실패', e);
      return null;
    }
  }

  // 두 캐릭터 사이의 궁합 점수(js/inyeon-dogam.js의 옛 compatScore)
  async function getScore(idA, idB) {
    if (!idA || !idB) return null;
    try {
      const data = await postJson(GET_COMPATIBILITY_FUNCTION_URL, { idA, idB });
      return typeof data.score === 'number' ? data.score : null;
    } catch (e) {
      console.error('[character-api] getScore 실패', e);
      return null;
    }
  }

  return { analyzeCharacter, getRelation, getScore };
})();
