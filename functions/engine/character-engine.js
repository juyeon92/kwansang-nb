// ═══ 16캐릭터 Character Engine — 결정론적 Rule Engine (서버 전용) ═══
// js/character/character-engine.js를 Cloud Functions로 이전한 것(2026-08-30 DB 이원화) — 판단
// 가중치·공식이 브라우저에 노출되지 않도록 서버에서만 계산하고 결과만 반환한다.
// 원본과의 차이 2가지:
//  ① FACE_CATEGORY_FIELD의 db() 조회는 원래 archetype-db.js에서 nameKo(사람이 읽는 이름)를 꺼내
//     evidence에 붙였는데, archetype-db.js는 이번 단계에서 서버로 옮기지 않으므로 그 조회를 걷어내고
//     id를 그대로 쓴다 — nameKo는 클라이언트 콘솔 로그에만 쓰이던 값이라(화면에는 노출 안 됨,
//     "판정 근거는 콘솔로만" 2026-08-15 결정) 계산 결과에는 영향 없다.
//  ② computeCharacterResult가 faceTraitScores/sajuTraitScores를 함께 반환한다 — 원래 클라이언트
//     (ai-analysis.js)가 computeTraitScoresFromRaw+FACE_TRAIT_BASELINE을 직접 호출해서 만들던 값인데,
//     그 baseline도 서버 전용 상수가 됐으므로 여기서 미리 계산해 함께 내려준다.
const {
  TRAITS, FACE_CATEGORY_WEIGHT, CONFIDENCE_FULL, CONFIDENCE_PARTIAL, CONFIDENCE_PARTIAL_RATIO,
  SAJU_WEIGHT, FUSION_WEIGHT, GUNJA_STDEV_MAX, GUNJA_RANGE_MAX,
  SAJU_MODIFIER_CAP_PER_ITEM, SAJU_MODIFIER_CAP_TOTAL, TIEBREAK_PRIORITY, TIEBREAK_EPSILON,
  FACE_TRAIT_BASELINE, SAJU_TRAIT_BASELINE, T_SCORE_CENTER, T_SCORE_SPREAD,
} = require('./trait-config');
const { FACE_TRAIT_MAP, PART_STATUS_TRAIT_MAP } = require('./face-trait-map');
const { OHAENG_TRAIT_VECTOR, SAJU_MODIFIER_DB } = require('./saju-trait-map');
const { CG_OH } = require('./saju-tables');
const { CHARACTER_TRAITS } = require('./compatibility-engine');

// 기질 2개 조합("lead|strategy" 형태, TRAITS 순서로 정렬한 키) → 캐릭터 ID.
// js/character/character-db.js의 traitPairKey/TRAIT_PAIR_TO_CHARACTER와 동일한 방식이지만,
// character-db.js(콘텐츠 DB)는 이번 단계에서 서버로 옮기지 않으므로 compatibility-engine.js가
// 이미 갖고 있는 CHARACTER_TRAITS(캐릭터별 주/보조 기질)에서 역으로 만든다 — 원본은 그대로 유지.
function traitPairKey(t1, t2) {
  return TRAITS.indexOf(t1) <= TRAITS.indexOf(t2) ? `${t1}|${t2}` : `${t2}|${t1}`;
}
const TRAIT_PAIR_TO_CHARACTER = {};
Object.entries(CHARACTER_TRAITS).forEach(([id, pair]) => {
  if (pair.length === 2) TRAIT_PAIR_TO_CHARACTER[traitPairKey(pair[0], pair[1])] = id;
});

const FACE_CATEGORY_FIELD = {
  eye_archetype: { idField: 'eye_archetype_id' },
  face_archetype: { idField: 'face_archetype_id' },
  forehead: { idField: 'forehead_type_id' },
  eyebrow: { idField: 'eyebrow_type_id' },
  eye_shape: { idField: 'eye_shape_id' },
  nose: { idField: 'nose_shape_id' },
  mouth: { idField: 'mouth_shape_id' },
  chin: { idField: 'chin_shape_id' },
  face_shape: { idField: 'face_shape_type_id' },
};

function computeFaceTraitRaw(featureIds, confidences, partStatusMap) {
  const sums = {}; TRAITS.forEach(t => sums[t] = 0);
  let totalWeight = 0;
  const evidence = [];

  Object.entries(FACE_CATEGORY_FIELD).forEach(([category, cfg]) => {
    const id = featureIds && featureIds[cfg.idField];
    if (!id) return;
    const vector = FACE_TRAIT_MAP[category] && FACE_TRAIT_MAP[category][id];
    if (!vector) return;

    const conf = (confidences && confidences[cfg.idField] != null) ? confidences[cfg.idField] : 1;
    if (conf < CONFIDENCE_PARTIAL) return;
    const effWeight = FACE_CATEGORY_WEIGHT[category] * (conf < CONFIDENCE_FULL ? CONFIDENCE_PARTIAL_RATIO : 1);

    TRAITS.forEach(t => { sums[t] += vector[t] * effWeight; });
    totalWeight += effWeight;

    evidence.push({ category, id, nameKo: id, weight: effWeight, confidence: conf });
  });

  if (partStatusMap) {
    const strongParts = Object.entries(partStatusMap).filter(([, v]) => v === 'strength').map(([k]) => k);
    if (strongParts.length) {
      const agg = {}; TRAITS.forEach(t => agg[t] = 0);
      strongParts.forEach(p => {
        const v = PART_STATUS_TRAIT_MAP[p];
        if (v) TRAITS.forEach(t => { agg[t] += v[t] || 0; });
      });
      const w = FACE_CATEGORY_WEIGHT.part_status;
      TRAITS.forEach(t => { sums[t] += (agg[t] / strongParts.length) * w; });
      totalWeight += w;
      evidence.push({ category: 'part_status', id: strongParts.join(','), nameKo: `강점 부위: ${strongParts.join('·')}`, weight: w, confidence: 1 });
    }
  }

  if (totalWeight === 0) return null;
  const raw = {}; TRAITS.forEach(t => { raw[t] = sums[t] / totalWeight; });
  return { raw, totalWeight, evidence };
}

function computeSajuTraitRaw(pillars, ohaengCounts, sinsalList, gwiinList) {
  if (!pillars) return null;
  const dayStemIdx = pillars[2] ? pillars[2].stem : -1;

  const total = Object.values(ohaengCounts || {}).reduce((a, b) => a + b, 0) || 1;
  const ohaengVec = {}; TRAITS.forEach(t => ohaengVec[t] = 0);
  Object.entries(ohaengCounts || {}).forEach(([oh, count]) => {
    const v = OHAENG_TRAIT_VECTOR[oh]; if (!v || !count) return;
    const w = count / total;
    TRAITS.forEach(t => { ohaengVec[t] += v[t] * w; });
  });

  const dayOh = dayStemIdx >= 0 ? CG_OH[dayStemIdx] : null;
  const dayMasterVec = (dayOh && OHAENG_TRAIT_VECTOR[dayOh]) || {};

  const modRaw = {}; TRAITS.forEach(t => modRaw[t] = 0);
  const matchedMods = [];
  [...(sinsalList || []), ...(gwiinList || [])].forEach(({ name }) => {
    const mod = SAJU_MODIFIER_DB[name];
    if (!mod) return;
    matchedMods.push(name);
    Object.entries(mod).forEach(([t, delta]) => {
      const clipped = Math.max(-SAJU_MODIFIER_CAP_PER_ITEM, Math.min(SAJU_MODIFIER_CAP_PER_ITEM, delta));
      modRaw[t] += clipped;
    });
  });
  const modTotalAbs = TRAITS.reduce((s, t) => s + Math.abs(modRaw[t]), 0);
  const modScale = modTotalAbs > SAJU_MODIFIER_CAP_TOTAL ? SAJU_MODIFIER_CAP_TOTAL / modTotalAbs : 1;
  const modifierVec = {}; TRAITS.forEach(t => modifierVec[t] = (modRaw[t] * modScale) / SAJU_MODIFIER_CAP_TOTAL);

  const raw = {};
  TRAITS.forEach(t => {
    raw[t] = ohaengVec[t] * SAJU_WEIGHT.ohaeng
      + (dayMasterVec[t] || 0) * SAJU_WEIGHT.dayMaster
      + modifierVec[t] * SAJU_WEIGHT.sinsalGwiin;
  });

  const evidence = [];
  const topOh = Object.entries(ohaengCounts || {}).sort((a, b) => b[1] - a[1])[0];
  if (topOh && topOh[1] > 0) evidence.push(`${topOh[0]} 기운 강함`);
  if (dayOh) evidence.push(`일간: ${dayOh}`);
  matchedMods.forEach(name => evidence.push(name));

  return { raw, evidence };
}

function zScoreNormalize(raw, baseline) {
  const z = {};
  TRAITS.forEach(t => { z[t] = (raw[t] - baseline[t].mean) / baseline[t].stdev; });
  return z;
}

function computeGwansangSajuChemi(faceRaw, sajuRaw) {
  if (!faceRaw || !sajuRaw) return null;
  const zFace = zScoreNormalize(faceRaw, FACE_TRAIT_BASELINE);
  const zSaju = zScoreNormalize(sajuRaw, SAJU_TRAIT_BASELINE);
  let dot = 0, magFace = 0, magSaju = 0;
  TRAITS.forEach(t => {
    dot += zFace[t] * zSaju[t];
    magFace += zFace[t] * zFace[t];
    magSaju += zSaju[t] * zSaju[t];
  });
  if (magFace === 0 || magSaju === 0) return null;
  const cos = dot / (Math.sqrt(magFace) * Math.sqrt(magSaju));
  const clamped = Math.max(-1, Math.min(1, cos));
  return Math.round(((clamped + 1) / 2) * 100);
}

function computeChemiDominance(faceRaw, sajuRaw) {
  if (!faceRaw || !sajuRaw) return null;
  const zFace = zScoreNormalize(faceRaw, FACE_TRAIT_BASELINE);
  const zSaju = zScoreNormalize(sajuRaw, SAJU_TRAIT_BASELINE);
  let magFace = 0, magSaju = 0;
  TRAITS.forEach(t => { magFace += zFace[t] * zFace[t]; magSaju += zSaju[t] * zSaju[t]; });
  magFace = Math.sqrt(magFace);
  magSaju = Math.sqrt(magSaju);
  const total = magFace + magSaju;
  if (total === 0) return null;
  const facePct = Math.round((magFace / total) * 100);
  return { facePct, sajuPct: 100 - facePct };
}

function computeTraitScoresFromRaw(raw, baseline) {
  if (!raw) return null;
  const z = zScoreNormalize(raw, baseline);
  const scores = {};
  TRAITS.forEach(t => { scores[t] = Math.max(0, Math.min(100, Math.round(T_SCORE_CENTER + z[t] * T_SCORE_SPREAD))); });
  return scores;
}

function combineFinalTraitScore(faceResult, sajuResult, hasHour) {
  let weight;
  let basisLabel;
  if (faceResult && sajuResult) {
    weight = hasHour ? FUSION_WEIGHT.faceAndSajuWithHour : FUSION_WEIGHT.faceAndSajuNoHour;
    basisLabel = '관상 + 사주 종합 유형';
  } else if (faceResult) {
    weight = FUSION_WEIGHT.faceOnly;
    basisLabel = '관상 기반 유형';
  } else if (sajuResult) {
    weight = FUSION_WEIGHT.sajuOnly;
    basisLabel = '사주 기반 유형';
  } else {
    return null;
  }
  const zFace = faceResult ? zScoreNormalize(faceResult.raw, FACE_TRAIT_BASELINE) : null;
  const zSaju = sajuResult ? zScoreNormalize(sajuResult.raw, SAJU_TRAIT_BASELINE) : null;
  const traitScores = {};
  TRAITS.forEach(t => {
    const zf = zFace ? zFace[t] : 0;
    const zs = zSaju ? zSaju[t] : 0;
    const zCombined = zf * weight.face + zs * weight.saju;
    traitScores[t] = Math.max(0, Math.min(100, Math.round(T_SCORE_CENTER + zCombined * T_SCORE_SPREAD)));
  });
  return { traitScores, basisLabel };
}

function determineCharacter(traitScores, faceEvidenceByCategory) {
  const sorted = TRAITS.map(t => ({ t, score: traitScores[t] })).sort((a, b) => b.score - a.score);
  const mean = sorted.reduce((s, x) => s + x.score, 0) / sorted.length;
  const stdev = Math.sqrt(sorted.reduce((s, x) => s + (x.score - mean) ** 2, 0) / sorted.length);
  const range = sorted[0].score - sorted[sorted.length - 1].score;

  if (stdev <= GUNJA_STDEV_MAX && range <= GUNJA_RANGE_MAX) {
    return { characterId: 'GUNJA', primaryTrait: sorted[0].t, secondaryTrait: sorted[1].t, balanced: true, sorted };
  }

  let primary = sorted[0], secondaryCandidateA = sorted[1], secondaryCandidateB = sorted[2];
  let secondary = secondaryCandidateA;

  if (secondaryCandidateB && (secondaryCandidateA.score - secondaryCandidateB.score) < TIEBREAK_EPSILON) {
    for (const category of TIEBREAK_PRIORITY) {
      const ev = faceEvidenceByCategory && faceEvidenceByCategory[category];
      if (!ev || !ev.vector) continue;
      const scoreA = ev.vector[secondaryCandidateA.t] || 0;
      const scoreB = ev.vector[secondaryCandidateB.t] || 0;
      if (scoreA > scoreB) { secondary = secondaryCandidateA; break; }
      if (scoreB > scoreA) { secondary = secondaryCandidateB; break; }
    }
  }

  const key = traitPairKey(primary.t, secondary.t);
  const characterId = TRAIT_PAIR_TO_CHARACTER[key] || null;
  return { characterId, primaryTrait: primary.t, secondaryTrait: secondary.t, balanced: false, sorted };
}

function computeResultConfidence(sorted, evidenceCount, avgFeatureConfidence) {
  const margin = sorted[1].score - sorted[2].score;
  const marginNorm = Math.max(0, Math.min(1, margin / 20));
  const coverage = Math.max(0, Math.min(1, evidenceCount / 9));
  const confNorm = avgFeatureConfidence != null ? avgFeatureConfidence : 0.6;
  return Math.round((0.4 * marginNorm + 0.35 * coverage + 0.25 * confNorm) * 100) / 100;
}

function computeCharacterResult(opts) {
  const faceResult = opts.featureIds ? computeFaceTraitRaw(opts.featureIds, opts.confidences, opts.partStatusMap) : null;
  const sajuResult = opts.pillars ? computeSajuTraitRaw(opts.pillars, opts.ohaengCounts, opts.sinsalList, opts.gwiinList) : null;
  if (!faceResult && !sajuResult) return null;

  const combined = combineFinalTraitScore(faceResult, sajuResult, !!opts.hasHour);
  if (!combined) return null;

  const faceEvidenceByCategory = {};
  if (faceResult) {
    faceResult.evidence.forEach(e => {
      if (e.category === 'part_status') return;
      faceEvidenceByCategory[e.category] = { vector: FACE_TRAIT_MAP[e.category][e.id] };
    });
  }
  if (sajuResult) faceEvidenceByCategory.saju = { vector: sajuResult.raw };

  const decision = determineCharacter(combined.traitScores, faceEvidenceByCategory);

  const avgConf = faceResult && faceResult.evidence.length
    ? faceResult.evidence.reduce((s, e) => s + e.confidence, 0) / faceResult.evidence.length
    : null;
  const confidence = computeResultConfidence(decision.sorted, faceResult ? faceResult.evidence.length : 0, avgConf);

  return {
    characterId: decision.characterId,
    primaryTrait: decision.primaryTrait,
    secondaryTrait: decision.secondaryTrait,
    balanced: decision.balanced,
    traitScores: combined.traitScores,
    faceRaw: faceResult ? faceResult.raw : null,
    sajuRaw: sajuResult ? sajuResult.raw : null,
    faceTraitScores: faceResult ? computeTraitScoresFromRaw(faceResult.raw, FACE_TRAIT_BASELINE) : null,
    sajuTraitScores: sajuResult ? computeTraitScoresFromRaw(sajuResult.raw, SAJU_TRAIT_BASELINE) : null,
    chemiScore: computeGwansangSajuChemi(faceResult && faceResult.raw, sajuResult && sajuResult.raw),
    dominance: computeChemiDominance(faceResult && faceResult.raw, sajuResult && sajuResult.raw),
    basisLabel: combined.basisLabel,
    faceEvidence: faceResult ? faceResult.evidence.map(e => e.id).filter(id => id !== undefined) : [],
    faceEvidenceDetail: faceResult ? faceResult.evidence : [],
    sajuEvidence: sajuResult ? sajuResult.evidence : [],
    confidence,
  };
}

module.exports = { computeCharacterResult };
