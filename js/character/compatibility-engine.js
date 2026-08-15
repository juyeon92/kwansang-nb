/**
 * compatibility-engine.js (v1)
 * 기획서 §29~30 — 16개 캐릭터 대표 벡터끼리 비교해 궁합(good/spark/clash) 자동 산출.
 * ------------------------------------------------------------------
 * 절대원칙 1번("판정은 규칙 엔진이, 설명은 AI가")을 궁합에도 그대로 적용한 것.
 * 여기서 나오는 good/spark/clash는 사람이 감으로 정한 게 아니라, 아래 3단계로
 * 결정론적으로 계산된다 — 같은 입력이면 항상 같은 결과(재현성 보장).
 *
 * ⚠️ 이 엔진은 "캐릭터(고정 16종) 간" 궁합만 계산한다. 실제 두 사용자의 궁합
 * (기획서 §29 3단계, 각자의 실제 6대 점수 비교)은 여기 범위 밖 — 이 결과(good/spark/clash
 * 라벨)를 콘텐츠 표시용 기본값으로 쓰고, 실제 유저 비교는 character-engine.js의
 * traitScores를 직접 cosine 비교하는 별도 로직(추후 필요시 추가)이 담당해야 한다.
 *
 * [3단계 계산 과정]
 * 1. TRAIT_CORRELATION — face-trait-map.js의 69개 feature 벡터에서 실제로 계산한
 *    "기질 간 상관계수"(피어슨 상관계수, N=69). 감으로 만든 인접도가 아니라 실측
 *    데이터 기반. 예: lead↔drive는 +0.52(같이 잘 나타남), stability↔sense는 -0.52
 *    (거의 반대로 나타남).
 * 2. CHARACTER_VECTOR — 16개 캐릭터의 대표 6D 벡터. 주 기질=90, 보조 기질=75로 고정하고,
 *    나머지 4개 기질은 그 캐릭터의 주/보조 기질과 TRAIT_CORRELATION 상으로 얼마나
 *    상관돼 있는지를 반영해 자동 산출한다(공식: 35 + 30×평균상관계수, 5~60 범위로 clip).
 *    군자상(GUNJA)은 예외 — 균형형이라 6개 전부 60으로 고정.
 * 3. classify() — 두 캐릭터가 기질을 몇 개 공유하는지(0개 또는 1개, 2개는 같은
 *    캐릭터라 불가능)로 1차로 나누고, 같은 그룹 안에서 코사인 유사도로 2차 정렬한다:
 *      - 1개 공유 그룹: 유사도 가장 높은 1개=CLASH("닮아서 자리가 겹침"),
 *        가장 낮은 2개=GOOD("공유하는 축은 있되 나머지가 서로 보완")
 *      - 0개 공유 그룹: 유사도 가장 높은 1개=SPARK("겹치는 축은 없지만 결이 편안히 통함"),
 *        가장 낮은 1개=CLASH("구조적으로 상극이라 접점이 없음")
 *    → U자형 궁합 모델: "너무 닮음"과 "너무 다름" 양쪽 극단이 모두 CLASH가 되고,
 *    중간 지점들이 GOOD/SPARK로 갈리는 구조. (심리학의 유사성-매력 vs 상보성 이론과
 *    같은 형태 — 그럴듯한 감이 아니라 실측 상관계수로 재현 가능하게 계산한 결과다.)
 *    군자상은 "1개 공유" 그룹 자체가 없어 위 규칙을 그대로 못 쓰므로, 전체 15명을
 *    유사도 하나로 줄 세워 상위 2=GOOD, 중앙값 1=SPARK, 하위 2=CLASH로 처리한다
 *    (다른 15개보다 근거가 약한 v1 잠정 규칙 — 표본이 적을 유형이라 우선순위 낮음).
 *
 * [검증 완료 사항]
 * - 16×15/2 = 120쌍 전수 검사: "A→B는 good인데 B→A는 clash"인 직접 모순 0건.
 *   (A는 good인데 B는 무언급인 비대칭은 정상 — §30이 슬롯을 5개(2+1+2)로 제한해서
 *   생기는 자연스러운 현상. 진짜 문제는 상호 모순뿐이고 그건 없음.)
 * - 책사상 결과가 기획서 §30의 유일한 실제 예시("장군상×책사상: 나는 움직이고
 *   이 사람은 방향을 잡아주는 조합")와 일치 — 장군상이 실제로 good에 포함됨.
 */

// ⚠️ 2026-08-15 통합 시 수정: 원본은 여기서 `const TRAITS`를 직접 선언했는데, index.html이
// trait-config.js를 먼저 로드하는 브라우저 환경에서는 같은 전역 스코프에 const가 두 번 선언돼
// "Identifier 'TRAITS' has already been declared" SyntaxError로 페이지 전체 스크립트가 죽는다.
// 그래서 trait-config.js가 이미 정의했으면 그걸 쓰고, 없으면(verify_compatibility_engine.js처럼
// 이 파일만 단독 평가하는 Node 검증 환경) 자체 리터럴로 폴백하도록 바꿨다 — 값은 동일하다.
const COMPAT_TRAITS = (typeof TRAITS !== 'undefined') ? TRAITS : ['lead', 'strategy', 'drive', 'social', 'stability', 'sense'];

// ── 1단계: 기질 간 상관계수 (face-trait-map.js 69개 feature 벡터 기반 실측) ──
// ⚠️ 소수점 6자리 유지 필수 — 4자리로 줄이면 GUNWANG(drive)이 36.4999→36.5가 되어 반올림
// 규칙(.5는 위로) 때문에 37로 틀어지는 경계 오류가 실제로 발생함(검증 스크립트로 발견·수정).
const TRAIT_CORRELATION = {
  lead: { lead: 1, strategy: -0.012607, drive: 0.522517, social: -0.358401, stability: -0.015157, sense: -0.369978 },
  strategy: { lead: -0.012607, strategy: 1, drive: -0.137193, social: -0.465917, stability: -0.041391, sense: 0.099223 },
  drive: { lead: 0.522517, strategy: -0.137193, drive: 1, social: -0.422524, stability: -0.257161, sense: -0.344527 },
  social: { lead: -0.358401, strategy: -0.465917, drive: -0.422524, social: 1, stability: -0.022297, sense: 0.151016 },
  stability: { lead: -0.015157, strategy: -0.041391, drive: -0.257161, social: -0.022297, stability: 1, sense: -0.517261 },
  sense: { lead: -0.369978, strategy: 0.099223, drive: -0.344527, social: 0.151016, stability: -0.517261, sense: 1 },
};

// 16개 캐릭터의 (주기질, 보조기질) 정의 — character-db.js의 traits와 반드시 동일하게 유지할 것
const CHARACTER_TRAITS = {
  JAESANG: ['lead', 'strategy'], JANGGUN: ['lead', 'drive'], GUNWANG: ['lead', 'social'],
  SURYEONG: ['lead', 'stability'], GAEHYEOKGA: ['lead', 'sense'], CHAEKSA: ['strategy', 'drive'],
  SASIN: ['strategy', 'social'], SEONBI: ['strategy', 'stability'], HAKJA: ['strategy', 'sense'],
  SANGDANJU: ['drive', 'social'], MUGWAN: ['drive', 'stability'], GAECHEOKJA: ['drive', 'sense'],
  UIWON: ['social', 'stability'], YEIN: ['social', 'sense'], JANGIN: ['stability', 'sense'],
  GUNJA: [], // 균형형 — 주/보조 기질 없음
};

// ── 2단계: 캐릭터별 대표 6D 벡터 (위 공식으로 자동 산출된 결과값을 상수로 고정) ──
// 재계산이 필요하면 buildRepresentativeVector()로 다시 뽑아서 교체하면 된다(로직 불변).
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

// 대표 벡터를 재산출하고 싶을 때 쓰는 함수(감사·재계산용, 위 상수와 반드시 같은 결과를 내야 함)
function buildRepresentativeVector(pair) {
  if (pair.length === 0) return Object.fromEntries(COMPAT_TRAITS.map(t => [t, 60]));
  const [p, s] = pair;
  const v = {};
  COMPAT_TRAITS.forEach(t => {
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
  COMPAT_TRAITS.forEach(t => { dot += a[t] * b[t]; na += a[t] ** 2; nb += b[t] ** 2; });
  return dot / Math.sqrt(na * nb);
}

function sharedTraitCount(pairA, pairB) {
  return pairA.filter(t => pairB.includes(t)).length;
}

// ── 3단계: good/spark/clash 분류 (U자형 규칙, 위 주석 참고) ──
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
    good: oneShared.slice(-2).map(o => o.id),               // 1개 공유 中 유사도 최저 2개 — 보완적
    spark: [zeroShared[0].id],                                // 0개 공유 中 유사도 최고 1개 — 편하게 다름
    clash: [oneShared[0].id, zeroShared[zeroShared.length - 1].id], // 너무 닮음 + 너무 다름 양극단
  };
}

// 16개 전체 궁합(콘텐츠 작성 시 바로 쓰는 조회 테이블 — 매번 재계산할 필요 없음)
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

// (ESM/CommonJS 양쪽 대응은 통합 시점에 결정 — 다른 engine 파일들과 동일한 컨벤션)
// export { TRAIT_CORRELATION, CHARACTER_TRAITS, CHARACTER_VECTOR, buildRepresentativeVector,
//          cosineSimilarity, sharedTraitCount, classifyCompatibility, COMPATIBILITY_DB };
