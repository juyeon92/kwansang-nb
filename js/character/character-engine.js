// ═══ 16캐릭터 Character Engine — 결정론적 Rule Engine (기획서 §33~41) ═══
// 이 파일은 순수 함수만 담는다(전역 state를 읽거나 DOM을 만지지 않음) — 같은 입력이면 언제나 같은
// 결과를 반환해야 한다는 기획서 §38 QA 기준(동일 사진 5회 분석 시 Character ID 동일률 ≥95%)을
// "룰 엔진 자체가 100% 결정론적"으로 만족시키기 위함이다. LLM은 이 결과를 설명만 하고 바꾸지 않는다(§2·§35).
//
// 카테고리 이름 매핑 — landmark-engine.js의 classifyAllFeaturesRuleBased()가 반환하는 ids/confidences의
// 키(예: eye_archetype_id)와 face-trait-map.js/trait-config.js가 쓰는 카테고리 키(예: eye_archetype)를
// 서로 연결해준다.
const FACE_CATEGORY_FIELD = {
  eye_archetype: { idField: 'eye_archetype_id', db: () => EYE_ARCHETYPE_DB },
  face_archetype: { idField: 'face_archetype_id', db: () => FACE_ARCHETYPE_DB },
  forehead: { idField: 'forehead_type_id', db: () => FOREHEAD_TYPE_DB },
  eyebrow: { idField: 'eyebrow_type_id', db: () => EYEBROW_TYPE_DB },
  eye_shape: { idField: 'eye_shape_id', db: () => EYE_SHAPE_DB },
  nose: { idField: 'nose_shape_id', db: () => NOSE_SHAPE_DB },
  mouth: { idField: 'mouth_shape_id', db: () => MOUTH_SHAPE_DB },
  chin: { idField: 'chin_shape_id', db: () => CHIN_SHAPE_DB },
  face_shape: { idField: 'face_shape_type_id', db: () => FACE_SHAPE_TYPE_DB },
};

// ── 관상 6D 원점수 (0~1 스케일 가중평균) ──────────────────────────────────────────
// featureIds/confidences: classifyAllFeaturesRuleBased(lm)의 반환값(ids, confidences)을 그대로 넣는다.
// partStatusMap: judgePartStatus(ratios)의 반환값(app.js) — {forehead:'strength'|'complement', ...}.
function computeFaceTraitRaw(featureIds, confidences, partStatusMap) {
  const sums = {}; TRAITS.forEach(t => sums[t] = 0);
  let totalWeight = 0;
  const evidence = []; // [{category, id, nameKo, weight}] — 실제로 점수에 반영된 것만

  Object.entries(FACE_CATEGORY_FIELD).forEach(([category, cfg]) => {
    const id = featureIds && featureIds[cfg.idField];
    if (!id) return; // 판별 안 됨 — 가중치 계산에서 아예 제외(기획서 §41 규칙5)
    const vector = FACE_TRAIT_MAP[category] && FACE_TRAIT_MAP[category][id];
    if (!vector) return;

    const conf = (confidences && confidences[cfg.idField] != null) ? confidences[cfg.idField] : 1;
    if (conf < CONFIDENCE_PARTIAL) return; // 0.55 미만 — 캐릭터 판정에서 제외(§7)
    const effWeight = FACE_CATEGORY_WEIGHT[category] * (conf < CONFIDENCE_FULL ? CONFIDENCE_PARTIAL_RATIO : 1);

    TRAITS.forEach(t => { sums[t] += vector[t] * effWeight; });
    totalWeight += effWeight;

    const db = cfg.db();
    evidence.push({ category, id, nameKo: (db[id] && db[id].nameKo) || id, weight: effWeight, confidence: conf });
  });

  // judgePartStatus 기반 보조 근거(§6 "랜드마크 기반 부위 강점" 10점) — strength로 판정된 부위만 사용,
  // complement(약점 쪽)는 반영하지 않는다(약점은 shadow 전용, §8).
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

  if (totalWeight === 0) return null; // 판별된 Feature가 하나도 없음 — 관상 점수 산출 불가
  const raw = {}; TRAITS.forEach(t => { raw[t] = sums[t] / totalWeight; });
  return { raw, totalWeight, evidence };
}

// ── 사주 6D 원점수 (기획서 §9~11) ──────────────────────────────────────────────
// pillars: computePillars() 결과([년,월,일,시]). ohaengCounts: computeOhaeng(pillars) 결과.
// sinsalList/gwiinList: collectSajuInsightSummary(pillars)의 {name, meaning}[] — name만 사용.
function computeSajuTraitRaw(pillars, ohaengCounts, sinsalList, gwiinList) {
  if (!pillars) return null;
  const dayStemIdx = pillars[2] ? pillars[2].stem : -1;

  // 1) 오행 분포 70%
  const total = Object.values(ohaengCounts || {}).reduce((a, b) => a + b, 0) || 1;
  const ohaengVec = {}; TRAITS.forEach(t => ohaengVec[t] = 0);
  Object.entries(ohaengCounts || {}).forEach(([oh, count]) => {
    const v = OHAENG_TRAIT_VECTOR[oh]; if (!v || !count) return;
    const w = count / total;
    TRAITS.forEach(t => { ohaengVec[t] += v[t] * w; });
  });

  // 2) 일간 보정 20% — 일간 자체의 오행 벡터를 그대로 얹는다(사주에서 "나 자신"을 대표하는 글자라는
  // 통상적 해석을 그대로 반영 — 오행 분포에도 이미 포함돼 있는 값이지만 §9에 따라 별도 가중치로 강조).
  const dayOh = dayStemIdx >= 0 ? CG_OH[dayStemIdx] : null;
  const dayMasterVec = (dayOh && OHAENG_TRAIT_VECTOR[dayOh]) || {};

  // 3) 신살·귀인 보정 10% — 항목당 ±4, 합계 ±12로 캡(§11)
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
  const modifierVec = {}; TRAITS.forEach(t => modifierVec[t] = (modRaw[t] * modScale) / SAJU_MODIFIER_CAP_TOTAL); // 0~1 스케일로 정규화

  const raw = {};
  TRAITS.forEach(t => {
    raw[t] = ohaengVec[t] * SAJU_WEIGHT.ohaeng
      + (dayMasterVec[t] || 0) * SAJU_WEIGHT.dayMaster
      + modifierVec[t] * SAJU_WEIGHT.sinsalGwiin;
  });

  const evidence = [];
  const topOh = Object.entries(ohaengCounts || {}).sort((a, b) => b[1] - a[1])[0];
  if (topOh && topOh[1] > 0) evidence.push(`${topOh[0]} 기운 강함`);
  if (dayOh) evidence.push(`일간: ${CG_KO[dayStemIdx]}(${dayOh})`);
  matchedMods.forEach(name => evidence.push(name));

  return { raw, evidence };
}

// ── 리스크1(분포 쏠림) 대응 — 도메인별 z-score 정규화 ──────────────────────────
// raw(0~1 가중평균)를 그대로 융합하면 두 가지가 깨진다: ①관상 feature 벡터 자체가
// drive/social/stability 쪽으로 구조적으로 후하게 설계돼 있어 그 방향 기질이 항상 높게 나옴,
// ②관상 raw의 스케일(mean 0.22~0.32)이 사주 raw 스케일(mean 0.12~0.19)보다 커서, 단순
// 가중합을 하면 "관상 70%: 사주 30%"라는 의도보다 사주 실제 기여도가 더 쪼그라든다(약 81:19로
// 왜곡). z-score(기질별·도메인별 baseline 대비 정규화)로 바꾸면 두 문제가 동시에 해결된다 —
// 정규화 후에는 두 도메인 모두 "평균 0, 표준편차 1" 기준이라 그 다음 가중합이 실제로 의도한
// 비율대로 반영된다. baseline 값은 trait-config.js의 FACE_TRAIT_BASELINE/SAJU_TRAIT_BASELINE
// 참고(현재는 실사용자 데이터가 없어 시뮬레이션 기반 근사치 — §37 데이터 축적 후 교체 예정).
function zScoreNormalize(raw, baseline) {
  const z = {};
  TRAITS.forEach(t => { z[t] = (raw[t] - baseline[t].mean) / baseline[t].stdev; });
  return z;
}

// ── 관상×사주 최종 통합 (기획서 §12) ──────────────────────────────────────────
// hasFace/hasSaju/hasHour: 어떤 데이터가 있는지에 따라 FUSION_WEIGHT 중 하나를 고른다.
// z-score로 정규화한 뒤 가중합하고, 화면/판정용으로 T-score 변환(평균 50, ±1표준편차 15점)해
// 0~100 범위로 옮긴다. 이 변환은 순수 선형(score = 50 + z×15)이라 상대적 분산 구조를 그대로
// 보존한다 — calcFaceOhaeng류의 "대비 강조"(순위 기반으로 인위적으로 벌리는 방식)와는 다르다.
// 그런 방식을 쓰면 실제로 고르게 나온 사람도 강제로 벌어져 버려 GUNJA_STDEV_MAX/GUNJA_RANGE_MAX
// 임계값 자체가 무의미해진다(이전 검토에서 확인한 안티패턴 — 절대 재도입 금지).
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

// ── Top2 → 16캐릭터 판정 + 균형형(§17) + 동점처리(§18) ──────────────────────────
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

  // Top2-Top3 격차가 거의 없으면(§18) TIEBREAK_PRIORITY 순서로 "어느 후보 기질을 더 강하게 뒷받침하는
  // Feature가 있는가"를 본다. Random 없이 항상 같은 입력 → 같은 결과가 나오도록, 우선순위가 높은
  // 카테고리부터 순서대로 검사하다가 한쪽을 명확히 지지하는 첫 카테고리에서 멈춘다.
  if (secondaryCandidateB && (secondaryCandidateA.score - secondaryCandidateB.score) < TIEBREAK_EPSILON) {
    for (const category of TIEBREAK_PRIORITY) {
      const ev = faceEvidenceByCategory && faceEvidenceByCategory[category];
      if (!ev || !ev.vector) continue;
      const scoreA = ev.vector[secondaryCandidateA.t] || 0;
      const scoreB = ev.vector[secondaryCandidateB.t] || 0;
      if (scoreA > scoreB) { secondary = secondaryCandidateA; break; }
      if (scoreB > scoreA) { secondary = secondaryCandidateB; break; }
      // 같으면 다음 우선순위 카테고리로 계속
    }
  }

  const key = traitPairKey(primary.t, secondary.t);
  const characterId = TRAIT_PAIR_TO_CHARACTER[key] || null;
  return { characterId, primaryTrait: primary.t, secondaryTrait: secondary.t, balanced: false, sorted };
}

// ── 결과 Confidence (§19) — v1 휴리스틱. margin(Top2와 Top3 격차) + Feature 커버리지로 계산한다. ──
function computeResultConfidence(sorted, evidenceCount, avgFeatureConfidence) {
  const margin = sorted[1].score - sorted[2].score; // 클수록 "뚜렷하게 이 조합"이라는 확신
  const marginNorm = Math.max(0, Math.min(1, margin / 20));
  const coverage = Math.max(0, Math.min(1, evidenceCount / 9)); // 관상 9개 카테고리 중 실제 반영된 비율
  const confNorm = avgFeatureConfidence != null ? avgFeatureConfidence : 0.6;
  return Math.round((0.4 * marginNorm + 0.35 * coverage + 0.25 * confNorm) * 100) / 100;
}

// ── 최상위 진입점 ────────────────────────────────────────────────────────────
// opts: { featureIds, confidences, partStatusMap, pillars, hasHour, ohaengCounts, sinsalList, gwiinList }
// featureIds/confidences가 없으면 관상 없이 사주만으로, pillars가 없으면 사주 없이 관상만으로 계산한다.
function computeCharacterResult(opts) {
  const faceResult = opts.featureIds ? computeFaceTraitRaw(opts.featureIds, opts.confidences, opts.partStatusMap) : null;
  const sajuResult = opts.pillars ? computeSajuTraitRaw(opts.pillars, opts.ohaengCounts, opts.sinsalList, opts.gwiinList) : null;
  if (!faceResult && !sajuResult) return null;

  const combined = combineFinalTraitScore(faceResult, sajuResult, !!opts.hasHour);
  if (!combined) return null;

  // 동점처리(§18)용 — 카테고리별 벡터를 미리 꺼내둔다(evidence에 이미 있는 것 재사용).
  const faceEvidenceByCategory = {};
  if (faceResult) {
    faceResult.evidence.forEach(e => {
      if (e.category === 'part_status') return;
      faceEvidenceByCategory[e.category] = { vector: FACE_TRAIT_MAP[e.category][e.id] };
    });
  }
  if (sajuResult) faceEvidenceByCategory.saju = { vector: sajuResult.raw };

  const decision = determineCharacter(combined.traitScores, faceEvidenceByCategory);
  const character = CHARACTER_DB[decision.characterId] || null;

  const avgConf = faceResult && faceResult.evidence.length
    ? faceResult.evidence.reduce((s, e) => s + e.confidence, 0) / faceResult.evidence.length
    : null;
  const confidence = computeResultConfidence(decision.sorted, faceResult ? faceResult.evidence.length : 0, avgConf);

  return {
    characterId: decision.characterId,
    characterName: character ? character.name : null,
    primaryTrait: decision.primaryTrait,
    secondaryTrait: decision.secondaryTrait,
    balanced: decision.balanced,
    traitScores: combined.traitScores,
    // 정규화 전 원시 벡터 — baseline(FACE_TRAIT_BASELINE) 재보정 때 이 값의 분포가 기준이 된다.
    // traitScores는 0~100으로 잘리기 때문에(clamp) 역산하면 극단값에서 분산이 왜곡된다.
    faceRaw: faceResult ? faceResult.raw : null,
    basisLabel: combined.basisLabel, // '관상 + 사주 종합 유형' | '관상 기반 유형' | '사주 기반 유형'
    faceEvidence: faceResult ? faceResult.evidence.map(e => e.id).filter(id => id !== undefined) : [],
    faceEvidenceDetail: faceResult ? faceResult.evidence : [],
    sajuEvidence: sajuResult ? sajuResult.evidence : [],
    confidence,
  };
}
