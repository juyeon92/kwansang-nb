// ═══ 15캐릭터 판정 / 궁합 — 서버 API 클라이언트 (2026-08-30 DB 이원화 1단계) ═══
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

  // 궁합 점수 + 얼굴합 5단 등급을 함께 받는다(2026-09-02). 등급 경계값과 표시 점수 밴드는
  // 서버에만 두고, 화면은 여기서 받은 displayScore/key/genre/stars를 그대로 쓴다 — 점수 구간을
  // 클라이언트에서 다시 계산하면 서버와 기준이 엇갈릴 수 있다.
  //   · score        내부 점수(14~81) — 정렬·등급 판정용. 화면에 그대로 쓰지 말 것.
  //   · displayScore 화면용 점수(55~99) — 사용자에게 보여주는 숫자.
  async function getScoreWithTier(idA, idB) {
    if (!idA || !idB) return null;
    try {
      const data = await postJson(GET_COMPATIBILITY_FUNCTION_URL, { idA, idB });
      if (typeof data.score !== 'number') return null;
      return {
        score: data.score,
        displayScore: typeof data.displayScore === 'number' ? data.displayScore : null,
        tier: data.tier || null,
      };
    } catch (e) {
      console.error('[character-api] getScoreWithTier 실패', e);
      return null;
    }
  }

  // ═══ 콘텐츠 카탈로그 캐시 (2026-08-30 DB 이원화 2단계) ═══
  // js/archetype-db.js·js/character/character-db.js는 이제 빈 캐시 객체만 선언해두고, 아래 두 함수가
  // 서버에서 전체 카탈로그를 받아 그 객체들을 채운다. 세션당 한 번만 받으면 되므로 진행 중/완료된
  // Promise를 그대로 캐시해서, 여러 곳에서 거의 동시에 호출해도 네트워크 요청은 한 번만 나간다.
  let archetypeCatalogPromise = null;
  function ensureArchetypeCatalog() {
    if (!archetypeCatalogPromise) {
      archetypeCatalogPromise = postJson(GET_ARCHETYPE_CATALOG_FUNCTION_URL, {}).then(data => {
        const c = data.catalog || {};
        Object.assign(EYE_ARCHETYPE_DB, c.EYE_ARCHETYPE_DB);
        Object.assign(FACE_ARCHETYPE_DB, c.FACE_ARCHETYPE_DB);
        Object.assign(FOREHEAD_TYPE_DB, c.FOREHEAD_TYPE_DB);
        Object.assign(EYEBROW_TYPE_DB, c.EYEBROW_TYPE_DB);
        Object.assign(EYE_SHAPE_DB, c.EYE_SHAPE_DB);
        Object.assign(NOSE_SHAPE_DB, c.NOSE_SHAPE_DB);
        Object.assign(MOUTH_SHAPE_DB, c.MOUTH_SHAPE_DB);
        Object.assign(CHIN_SHAPE_DB, c.CHIN_SHAPE_DB);
        Object.assign(FACE_SHAPE_TYPE_DB, c.FACE_SHAPE_TYPE_DB);
        Object.assign(FACE_ARCHETYPE_EMOJI, c.FACE_ARCHETYPE_EMOJI);
        Object.assign(EYE_ICON_SVG, c.EYE_ICON_SVG);
      }).catch(e => {
        console.error('[character-api] ensureArchetypeCatalog 실패', e);
        archetypeCatalogPromise = null; // 다음 호출이 재시도할 수 있게
        throw e;
      });
    }
    return archetypeCatalogPromise;
  }

  let characterCatalogPromise = null;
  function ensureCharacterCatalog() {
    if (!characterCatalogPromise) {
      characterCatalogPromise = postJson(GET_CHARACTER_CATALOG_FUNCTION_URL, {}).then(data => {
        Object.assign(CHARACTER_DB, data.catalog || {});
      }).catch(e => {
        console.error('[character-api] ensureCharacterCatalog 실패', e);
        characterCatalogPromise = null;
        throw e;
      });
    }
    return characterCatalogPromise;
  }

  return { analyzeCharacter, getRelation, getScore, getScoreWithTier, ensureArchetypeCatalog, ensureCharacterCatalog };
})();
