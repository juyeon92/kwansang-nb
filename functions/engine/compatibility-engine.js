// ═══ compatibility-engine.js (서버 전용) — 기획서 §29~30 궁합 엔진 ═══
// js/character/compatibility-engine.js를 Cloud Functions로 이전한 것(2026-08-30 DB 이원화).
// 브라우저 전역 스코프 충돌을 피하려던 원본의 COMPAT_TRAITS 폴백은 Node 모듈이라 필요 없어
// TRAITS를 그대로 쓴다 — 나머지 계산 로직은 원본과 동일.
const { TRAITS } = require('./trait-config');

const TRAIT_CORRELATION = {
  lead: { lead: 1, strategy: -0.012607, drive: 0.522517, social: -0.358401, stability: -0.015157, sense: -0.369978 },
  strategy: { lead: -0.012607, strategy: 1, drive: -0.137193, social: -0.465917, stability: -0.041391, sense: 0.099223 },
  drive: { lead: 0.522517, strategy: -0.137193, drive: 1, social: -0.422524, stability: -0.257161, sense: -0.344527 },
  social: { lead: -0.358401, strategy: -0.465917, drive: -0.422524, social: 1, stability: -0.022297, sense: 0.151016 },
  stability: { lead: -0.015157, strategy: -0.041391, drive: -0.257161, social: -0.022297, stability: 1, sense: -0.517261 },
  sense: { lead: -0.369978, strategy: 0.099223, drive: -0.344527, social: 0.151016, stability: -0.517261, sense: 1 },
};

const CHARACTER_TRAITS = {
  JAESANG: ['lead', 'strategy'], JANGGUN: ['lead', 'drive'], GUNWANG: ['lead', 'social'],
  SURYEONG: ['lead', 'stability'], GAEHYEOKGA: ['lead', 'sense'], CHAEKSA: ['strategy', 'drive'],
  SASIN: ['strategy', 'social'], SEONBI: ['strategy', 'stability'], HAKJA: ['strategy', 'sense'],
  SANGDANJU: ['drive', 'social'], MUGWAN: ['drive', 'stability'], GAECHEOKJA: ['drive', 'sense'],
  UIWON: ['social', 'stability'], YEIN: ['social', 'sense'], JANGIN: ['stability', 'sense'],
  GUNJA: [],
};

const CHARACTER_VECTOR = {
  JAESANG: { lead: 90, strategy: 75, drive: 41, social: 23, stability: 34, sense: 31 },
  JANGGUN: { lead: 90, strategy: 33, drive: 75, social: 23, stability: 31, sense: 24 },
  GUNWANG: { lead: 90, strategy: 28, drive: 36, social: 75, stability: 34, sense: 32 },
  SURYEONG: { lead: 90, strategy: 34, drive: 39, social: 29, stability: 75, sense: 22 },
  GAEHYEOKGA: { lead: 90, strategy: 36, drive: 38, social: 32, stability: 27, sense: 75 },
  CHAEKSA: { lead: 43, strategy: 90, drive: 75, social: 22, stability: 31, sense: 31 },
  SASIN: { lead: 29, strategy: 90, drive: 27, social: 75, stability: 34, sense: 39 },
  SEONBI: { lead: 35, strategy: 90, drive: 29, social: 28, stability: 75, sense: 29 },
  HAKJA: { lead: 29, strategy: 90, drive: 28, social: 30, stability: 27, sense: 75 },
  SANGDANJU: { lead: 37, strategy: 26, drive: 90, social: 75, stability: 31, sense: 32 },
  MUGWAN: { lead: 43, strategy: 32, drive: 90, social: 28, stability: 75, sense: 22 },
  GAECHEOKJA: { lead: 37, strategy: 34, drive: 90, social: 31, stability: 23, sense: 75 },
  UIWON: { lead: 29, strategy: 27, drive: 25, social: 90, stability: 75, sense: 30 },
  YEIN: { lead: 24, strategy: 29, drive: 23, social: 90, stability: 27, sense: 75 },
  JANGIN: { lead: 29, strategy: 36, drive: 26, social: 37, stability: 90, sense: 75 },
  GUNJA: { lead: 60, strategy: 60, drive: 60, social: 60, stability: 60, sense: 60 },
};

function buildRepresentativeVector(pair) {
  if (pair.length === 0) return Object.fromEntries(TRAITS.map(t => [t, 60]));
  const [p, s] = pair;
  const v = {};
  TRAITS.forEach(t => {
    if (t === p) v[t] = 90;
    else if (t === s) v[t] = 75;
    else {
      const avgCorr = (TRAIT_CORRELATION[t][p] + TRAIT_CORRELATION[t][s]) / 2;
      v[t] = Math.round(Math.max(5, Math.min(60, 35 + avgCorr * 30)));
    }
  });
  return v;
}

function cosineSimilarity(a, b) {
  let dot = 0, na = 0, nb = 0;
  TRAITS.forEach(t => { dot += a[t] * b[t]; na += a[t] ** 2; nb += b[t] ** 2; });
  return dot / Math.sqrt(na * nb);
}

function sharedTraitCount(pairA, pairB) {
  return pairA.filter(t => pairB.includes(t)).length;
}

function classifyCompatibility(characterId) {
  const ids = Object.keys(CHARACTER_TRAITS);
  const pair = CHARACTER_TRAITS[characterId];

  if (characterId === 'GUNJA') {
    const ranked = ids.filter(o => o !== 'GUNJA')
      .map(o => ({ id: o, sim: cosineSimilarity(CHARACTER_VECTOR.GUNJA, CHARACTER_VECTOR[o]) }))
      .sort((a, b) => b.sim - a.sim);
    return {
      good: ranked.slice(0, 2).map(o => o.id),
      spark: [ranked[Math.floor(ranked.length / 2)].id],
      clash: ranked.slice(-2).map(o => o.id),
    };
  }

  const others = ids.filter(o => o !== characterId && o !== 'GUNJA').map(o => ({
    id: o,
    sim: cosineSimilarity(CHARACTER_VECTOR[characterId], CHARACTER_VECTOR[o]),
    shared: sharedTraitCount(pair, CHARACTER_TRAITS[o]),
  }));
  const oneShared = others.filter(o => o.shared === 1).sort((a, b) => b.sim - a.sim);
  const zeroShared = others.filter(o => o.shared === 0).sort((a, b) => b.sim - a.sim);

  return {
    good: oneShared.slice(-2).map(o => o.id),
    spark: [zeroShared[0].id],
    clash: [oneShared[0].id, zeroShared[zeroShared.length - 1].id],
  };
}

const COMPATIBILITY_DB = {
  JAESANG: { good: ["HAKJA","SASIN"], spark: ["MUGWAN"], clash: ["JANGGUN","YEIN"] },
  JANGGUN: { good: ["GAECHEOKJA","SANGDANJU"], spark: ["SEONBI"], clash: ["JAESANG","YEIN"] },
  GUNWANG: { good: ["YEIN","SASIN"], spark: ["MUGWAN"], clash: ["GAEHYEOKGA","HAKJA"] },
  SURYEONG: { good: ["JANGIN","UIWON"], spark: ["CHAEKSA"], clash: ["JANGGUN","YEIN"] },
  GAEHYEOKGA: { good: ["JANGIN","YEIN"], spark: ["CHAEKSA"], clash: ["JAESANG","UIWON"] },
  CHAEKSA: { good: ["JANGGUN","SANGDANJU"], spark: ["GAEHYEOKGA"], clash: ["JAESANG","YEIN"] },
  SASIN: { good: ["GUNWANG","SANGDANJU"], spark: ["JANGIN"], clash: ["HAKJA","JANGGUN"] },
  SEONBI: { good: ["MUGWAN","UIWON"], spark: ["GAEHYEOKGA"], clash: ["SASIN","YEIN"] },
  HAKJA: { good: ["GAECHEOKJA","YEIN"], spark: ["GUNWANG"], clash: ["SASIN","MUGWAN"] },
  SANGDANJU: { good: ["CHAEKSA","SASIN"], spark: ["GAEHYEOKGA"], clash: ["GAECHEOKJA","HAKJA"] },
  MUGWAN: { good: ["JANGIN","UIWON"], spark: ["JAESANG"], clash: ["SANGDANJU","YEIN"] },
  GAECHEOKJA: { good: ["YEIN","JANGIN"], spark: ["JAESANG"], clash: ["SANGDANJU","UIWON"] },
  UIWON: { good: ["SEONBI","MUGWAN"], spark: ["GAEHYEOKGA"], clash: ["YEIN","CHAEKSA"] },
  YEIN: { good: ["GAEHYEOKGA","GAECHEOKJA"], spark: ["SEONBI"], clash: ["UIWON","JANGGUN"] },
  JANGIN: { good: ["GAEHYEOKGA","GAECHEOKJA"], spark: ["SASIN"], clash: ["UIWON","JANGGUN"] },
  GUNJA: { good: ["GAEHYEOKGA","GUNWANG"], spark: ["GAECHEOKJA"], clash: ["JANGGUN","YEIN"] },
};

// js/inyeon-dogam.js의 compatScore()를 서버로 그대로 옮긴 것 — 두 캐릭터의 벡터 코사인 유사도를
// 0~100으로 편 뒤, good/spark/clash 보정(+18/+8/-15)을 더한다.
function compatScore(idA, idB) {
  if (!CHARACTER_VECTOR[idA] || !CHARACTER_VECTOR[idB]) return null;
  const sim = cosineSimilarity(CHARACTER_VECTOR[idA], CHARACTER_VECTOR[idB]);
  let score = Math.round((sim - 0.5) * 200);
  const rel = COMPATIBILITY_DB[idA] || null;
  if (rel) {
    if ((rel.good || []).indexOf(idB) >= 0) score += 18;
    else if ((rel.spark || []).indexOf(idB) >= 0) score += 8;
    else if ((rel.clash || []).indexOf(idB) >= 0) score -= 15;
  }
  return Math.max(5, Math.min(99, score));
}

module.exports = {
  TRAIT_CORRELATION, CHARACTER_TRAITS, CHARACTER_VECTOR,
  buildRepresentativeVector, cosineSimilarity, sharedTraitCount,
  classifyCompatibility, COMPATIBILITY_DB, compatScore,
};
