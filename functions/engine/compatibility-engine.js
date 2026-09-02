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

// ═══ 15개 캐릭터 = 6기질에서 2개를 뽑는 모든 조합 C(6,2) = 15 ═══
// 2026-09-03 군자상(GUNJA) 제거 — 군자상은 2축 조합이 아니라 "2축을 못 고를 만큼 평평한 얼굴"을
// 받는 예외 처리였고, 6기질이 모두 60인 평평한 벡터라 코사인 유사도가 모든 벡터의 중심 근처에
// 놓였다. 그 결과 15명 전원과 같은 등급(3★ 잔잔한 일상 드라마)이 나왔다 — 다른 캐릭터는 4~5종의
// 등급을 보는데 군자상만 1종이었다. 인연도감은 서로 다른 등급을 비교하며 공유하는 기능이라,
// 도감 15줄이 전부 같은 문구인 건 재미가 없는 정도가 아니라 화면이 고장 난 것처럼 읽힌다.
// 벡터에 기복을 줘도 해결되지 않는다(균형 벡터는 정의상 중심에 가까워 편차가 작다 —
// scratch/gunja-vector-analysis.html에서 4천 개 벡터를 탐색해 확인).
// 평평한 얼굴은 이제 상위 2개 기질을 그대로 써서 15개 중 하나로 배정된다.
const CHARACTER_TRAITS = {
  JAESANG: ['lead', 'strategy'], JANGGUN: ['lead', 'drive'], GUNWANG: ['lead', 'social'],
  SURYEONG: ['lead', 'stability'], GAEHYEOKGA: ['lead', 'sense'], CHAEKSA: ['strategy', 'drive'],
  SASIN: ['strategy', 'social'], SEONBI: ['strategy', 'stability'], HAKJA: ['strategy', 'sense'],
  SANGDANJU: ['drive', 'social'], MUGWAN: ['drive', 'stability'], GAECHEOKJA: ['drive', 'sense'],
  UIWON: ['social', 'stability'], YEIN: ['social', 'sense'], JANGIN: ['stability', 'sense'],
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
};

// pair가 빈 배열인 경우(전 축 60의 평평한 벡터)는 군자상 전용 분기였다 — 군자상을 없앤 뒤로는
// 호출되지 않지만, 잘못된 입력이 들어와도 터지지 않게 방어 코드로 남겨둔다.
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

// 2026-09-03 군자상 제거 — 전 축 60인 평평한 벡터를 따로 순위 매기던 GUNJA 전용 분기와, 나머지
// 캐릭터의 후보 목록에서 GUNJA를 빼던 필터를 함께 걷어냈다. 이제 15개가 모두 같은 규칙을 탄다.
function classifyCompatibility(characterId) {
  const ids = Object.keys(CHARACTER_TRAITS);
  const pair = CHARACTER_TRAITS[characterId];

  const others = ids.filter(o => o !== characterId).map(o => ({
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
};

// ═══ 궁합 점수 (2026-09-02 재설계) ═══
// 이전 구현은 코사인 유사도를 0~100으로 편 뒤 good/spark/clash 보정(+18/+8/-15)을 그대로 더했는데,
// 16×16 전수 계산에서 결함 두 개가 확인돼 아래 3단계 구조로 바꿨다.
//
//  ① 비대칭 — 보정을 COMPATIBILITY_DB[idA]만 보고 걸어서 A→B와 B→A 점수가 달라졌다(120개 짝 중
//     43개). 인연도감은 "인연은 양쪽에 함께 등록돼요"가 핵심 약속인데, 같은 관계를 두고 두 사람이
//     서로 다른 숫자를 보면 공유의 재미가 그 자리에서 깨진다.
//     → 양쪽 방향의 보정을 각각 구해 평균한다(REL_ADJUST + relationAdjust).
//
//  ② 캐릭터별 편향 — 코사인 유사도는 벡터의 "위치"만 보기 때문에, 6기질이 모두 60인 평평한 벡터인
//     군자상은 누구와도 유사도가 높고(받는 평균 78점), 주도력·실행력 축에서 멀리 떨어진 예인상은
//     누구와도 낮았다(47점). 최하위 5개 조합이 전부 예인상 짝이었다 — 하필 "매력으로 사람을
//     끌어당기는" 캐릭터가 모두의 꽝이 되니 바이럴에 정면으로 역행한다.
//     → 각 캐릭터가 받는 평균의 전체 평균 대비 편차(bias)를 양쪽에서 빼서 없앤다. bias의 합이 0이라
//       전체 평균은 그대로 보존되고, A와 B에 대칭으로 적용되므로 ①의 대칭성도 깨지지 않는다.
//       추천 시스템에서 쓰는 표준적인 가산 편향 제거(additive bias removal)와 같은 방식이다.
//       결과: 받는 평균 격차 31점 → 2점, 비대칭 43개 → 0개.
//
// 참고: 편향 제거 후 예인상은 점수 폭이 크게 넓어져, 강한 궁합과 강한 불합을 함께 가진
//    "호불호가 뚜렷한" 캐릭터가 됐다(최상위 10%와 최하위 10%에 모두 자주 등장). 반대로 벡터가
//    중심에 가까운 캐릭터는 폭이 좁아 중간 등급에 몰린다 — 군자상이 그 극단이라 15명 전원과
//    같은 등급이 나왔고, 그래서 2026-09-03에 제거했다(CHARACTER_TRAITS 주석 참고).

// good/spark/clash 보정치 — 코사인 유사도와 같은 0~1 스케일. 최종 점수로는 각각 ±18/±8/∓15점
// 수준(0.09 × 200 = 18)이라 이전 구현의 체감 폭을 유지한다.
const REL_ADJUST = { good: 0.09, spark: 0.04, clash: -0.075 };

// 한쪽 방향의 보정 — idX가 가진 관계 목록에서 idY를 찾는다.
function relationAdjustOneWay(idX, idY) {
  const rel = COMPATIBILITY_DB[idX];
  if (!rel) return 0;
  if ((rel.good || []).indexOf(idY) >= 0) return REL_ADJUST.good;
  if ((rel.spark || []).indexOf(idY) >= 0) return REL_ADJUST.spark;
  if ((rel.clash || []).indexOf(idY) >= 0) return REL_ADJUST.clash;
  return 0;
}
// 결함① 해결 — 양방향 평균이라 A/B 순서를 바꿔도 같은 값이 나온다.
function relationAdjust(idA, idB) {
  return (relationAdjustOneWay(idA, idB) + relationAdjustOneWay(idB, idA)) / 2;
}

// 편향 제거 전의 원점수(0~1) — 대칭 코사인 + 대칭 보정.
function baseAffinity(idA, idB) {
  return cosineSimilarity(CHARACTER_VECTOR[idA], CHARACTER_VECTOR[idB]) + relationAdjust(idA, idB);
}

// 결함② 해결 — 캐릭터별 편향표를 최초 호출 때 한 번만 계산해 캐싱한다. 15캐릭터 고정이라
// 240회 코사인 계산 한 번이면 끝나고, 이후 호출은 표 조회만 한다.
let biasTable = null;
function getBiasTable() {
  if (biasTable) return biasTable;
  const ids = Object.keys(CHARACTER_VECTOR);
  const rowMean = {};
  ids.forEach(a => {
    const others = ids.filter(b => b !== a);
    rowMean[a] = others.reduce((sum, b) => sum + baseAffinity(a, b), 0) / others.length;
  });
  const globalMean = ids.reduce((sum, a) => sum + rowMean[a], 0) / ids.length;
  biasTable = {};
  ids.forEach(a => { biasTable[a] = rowMean[a] - globalMean; });
  return biasTable;
}

// 같은 캐릭터끼리도 점수를 낸다(idA === idB). 인연도감에서 친구 둘이 같은 캐릭터로 판정되는 일은
// 자주 생기고, 그때 점수가 비어 보이면 그대로 버그로 읽힌다.
//
// 단, 자기 자신과의 비교에는 편향 보정을 걸지 않는다. 편향 보정은 "이 캐릭터가 *다른* 캐릭터들을
// 상대로 유리하거나 불리한 정도"를 상쇄하는 장치인데, 같은 벡터끼리의 비교에는 상쇄할 유불리가
// 애초에 없다. 그냥 걸면 편차가 큰 캐릭터가 두 번 감점돼서, 벡터가 가장 중심에 있는 군자상만
// 자기 자신과 61점(3등급)이 나오고 나머지 15개는 91~99점(5등급)이 되는 모순이 생긴다.
function compatScore(idA, idB) {
  if (!CHARACTER_VECTOR[idA] || !CHARACTER_VECTOR[idB]) return null;
  if (idA === idB) {
    return Math.max(5, Math.min(99, Math.round((baseAffinity(idA, idB) - 0.5) * 200)));
  }
  const bias = getBiasTable();
  const fair = baseAffinity(idA, idB) - bias[idA] - bias[idB];
  return Math.max(5, Math.min(99, Math.round((fair - 0.5) * 200)));
}

// ═══ 얼굴합 5단 등급 ═══
// 절대 점수로 자르지 않고 전체 120개 짝 중 순위(백분위)로 자른다 — 점수 분포가 중앙에 몰려 있어서
// 절대 구간으로 나누면 최상위 등급이 사실상 안 나오고 대부분 한 칸에 뭉친다. 15캐릭터 고정이라
// 조합이 120개로 정해져 있으므로 경계 점수를 상수로 박아둘 수 있다(compatScore 재계산 결과 기준).
// 비율은 상위 10% / 20% / 40% / 20% / 10%.
// display: 화면에 보여줄 점수 밴드([최저, 최고]). 아래 displayScore() 참고.
//
// ⚠️ min 값은 2026-09-03 군자상 제거로 조합이 120쌍 → 105쌍이 되면서 다시 뽑은 것이다
// (이전: 79/71/46/33). 캐릭터를 더하거나 빼면 백분위 컷이 움직이니 반드시 재계산해야 한다 —
// scratch/verify-compat-engine.html의 검증10이 분포가 목표(10/20/40/20/10)에서 벗어나면 잡아준다.
const FACE_TIERS = [
  { key: 'PERFECT', min: 76, genre: '천만 영화 투톱',      stars: 5, display: [92, 99] },
  { key: 'BEST',    min: 69, genre: '믿고 보는 시즌제',    stars: 4, display: [82, 91] },
  { key: 'GOOD',    min: 38, genre: '잔잔한 일상 드라마',  stars: 3, display: [70, 81] },
  { key: 'GROWTH',  min: 26, genre: '고난 끝 성장 청춘물', stars: 2, display: [62, 69] },
  { key: 'CLASH',   min: 0,  genre: '좌충우돌 일일시트콤', stars: 1, display: [55, 61] },
];
function faceTier(score) {
  if (score == null) return null;
  return FACE_TIERS.find(t => score >= t.min) || FACE_TIERS[FACE_TIERS.length - 1];
}

// ═══ 표시용 점수 리맵 (2026-09-03) ═══
// 내부 점수는 14~81점 범위인데, 이 숫자를 그대로 보여주면 서비스적으로 두 가지가 걸린다.
//   · 최고 81점 — 사람들은 100점 척도를 성적으로 읽어서 84는 "잘 맞네" 수준이다. 공유되는 게
//     목적인 기능에서 "우리 81점"과 "우리 99점"은 전파력이 다르다.
//   · 최저 14점 — 친구·가족에게 나오면 모욕처럼 읽히고, 무엇보다 등급명과 충돌한다.
//     "좌충우돌 일일시트콤"이라는 웃긴 프레이밍에 14점이 붙으면 재미가 아니라 재난으로 읽힌다.
// 그래서 내부 점수(정렬·등급 판정의 기준)는 건드리지 않고, 화면에 쓸 숫자만 55~99로 다시 편다.
//
// 등급별로 겹치지 않는 밴드에 각각 선형 배치하므로 두 성질이 보장된다.
//   ① 순위 보존 — 내부 점수가 높을수록 표시 점수도 높다(밴드 경계에서도 단조성이 유지된다).
//   ② 숫자와 등급명이 절대 어긋나지 않는다 — 92점인데 "시트콤"이라고 나오는 일이 없다.
//
// ⚠️ 숫자가 정보를 덜 담게 되는 건 의도된 대가다. 전부 55점 이상이 되면 두 사람이 나란히 78점을
//    받는 일이 흔해져 숫자만으로는 구분이 잘 안 된다. 그래서 화면 위계는 장르명을 크게, 점수를
//    보조로 두는 것을 전제로 한다 — 이 리맵은 그 전제에서만 정당하다.
//
// 각 등급의 내부 점수 실측 범위는 벡터가 바뀌면 함께 움직이므로, 상수로 박지 않고 최초 호출 때
// 전체 조합을 훑어 구한다(편향표와 같은 지연 캐싱). 벡터를 손봐도 리맵이 저절로 따라온다.
let tierRangeTable = null;
function getTierRanges() {
  if (tierRangeTable) return tierRangeTable;
  const ids = Object.keys(CHARACTER_VECTOR);
  const acc = {};
  FACE_TIERS.forEach(t => { acc[t.key] = { lo: Infinity, hi: -Infinity }; });
  ids.forEach((a, i) => ids.slice(i + 1).forEach(b => {
    const s = compatScore(a, b);
    if (s == null) return;
    const cell = acc[faceTier(s).key];
    if (s < cell.lo) cell.lo = s;
    if (s > cell.hi) cell.hi = s;
  }));
  tierRangeTable = acc;
  return tierRangeTable;
}

// 내부 점수 → 화면에 보여줄 점수. 등급이 비어 있으면(해당 구간 조합이 하나도 없으면) 밴드 상한을 준다.
function displayScore(internalScore) {
  if (internalScore == null) return null;
  const tier = faceTier(internalScore);
  if (!tier) return null;
  const obs = getTierRanges()[tier.key];
  const [lo, hi] = tier.display;
  if (!obs || !isFinite(obs.lo) || obs.hi === obs.lo) return hi;
  const ratio = (internalScore - obs.lo) / (obs.hi - obs.lo);
  return Math.round(lo + Math.max(0, Math.min(1, ratio)) * (hi - lo));
}

module.exports = {
  TRAIT_CORRELATION, CHARACTER_TRAITS, CHARACTER_VECTOR,
  buildRepresentativeVector, cosineSimilarity, sharedTraitCount,
  classifyCompatibility, COMPATIBILITY_DB, compatScore,
  REL_ADJUST, relationAdjust, baseAffinity, FACE_TIERS, faceTier, displayScore,
};
