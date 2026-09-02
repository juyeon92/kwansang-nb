// ═══ compatibility-engine.js 검증 스크립트 ═══
// 사용법: node verify_compatibility_engine.js
// 목적: "계산 과정이 감사 가능하고 재현되는가"를 확인한다. "이 궁합이 그럴듯한가"는 이 스크립트로
// 증명할 수 없다 — 그건 사람이 읽고 판단할 몫이다(코드 상단 주석 참고).
// 2026-08-30: face-trait-map.js/compatibility-engine.js가 DB 이원화로 functions/engine/으로
// 옮겨가서, 이제 진짜 module.exports를 쓰는 CommonJS 모듈이라 require()로 그대로 불러온다.

const path = require('path');
const { FACE_TRAIT_MAP } = require(path.join(__dirname, '..', '..', 'functions', 'engine', 'face-trait-map'));
const {
  TRAIT_CORRELATION, CHARACTER_TRAITS, CHARACTER_VECTOR, COMPATIBILITY_DB,
  buildRepresentativeVector, cosineSimilarity, sharedTraitCount, classifyCompatibility,
  compatScore, faceTier, FACE_TIERS, displayScore,
} = require(path.join(__dirname, '..', '..', 'functions', 'engine', 'compatibility-engine'));

const TRAITS = ['lead','strategy','drive','social','stability','sense'];

let failCount = 0;
function check(label, pass) {
  console.log((pass ? '✅ ' : '❌ ') + label);
  if (!pass) failCount++;
}

// ── 검증1: TRAIT_CORRELATION이 face-trait-map.js 원본 데이터에서 실제로 나온 값인가 ──
function pearson(a, b) {
  const n = a.length;
  const meanA = a.reduce((s,x)=>s+x,0)/n, meanB = b.reduce((s,x)=>s+x,0)/n;
  let num=0, denA=0, denB=0;
  for (let i=0;i<n;i++){ const da=a[i]-meanA, db=b[i]-meanB; num+=da*db; denA+=da*da; denB+=db*db; }
  return num / Math.sqrt(denA*denB);
}
const allVectors = [];
Object.values(FACE_TRAIT_MAP).forEach(db => Object.values(db).forEach(v => allVectors.push(v)));
let corrMatch = true;
TRAITS.forEach(t1 => TRAITS.forEach(t2 => {
  const recomputed = t1===t2 ? 1 : pearson(allVectors.map(v=>v[t1]), allVectors.map(v=>v[t2]));
  if (Math.abs(recomputed - TRAIT_CORRELATION[t1][t2]) > 0.001) corrMatch = false;
}));
check(`TRAIT_CORRELATION이 face-trait-map.js 69개 벡터(N=${allVectors.length})에서 재계산한 값과 일치`, corrMatch);

// ── 검증2: CHARACTER_VECTOR가 buildRepresentativeVector() 공식으로 재현되는가 ──
let vecMatch = true;
Object.keys(CHARACTER_TRAITS).forEach(id => {
  const recomputed = buildRepresentativeVector(CHARACTER_TRAITS[id]);
  TRAITS.forEach(t => { if (recomputed[t] !== CHARACTER_VECTOR[id][t]) vecMatch = false; });
});
check('CHARACTER_VECTOR 15개 전부 buildRepresentativeVector() 재계산과 일치', vecMatch);

// ── 검증3: COMPATIBILITY_DB가 classifyCompatibility() 재계산과 일치(재현성) ──
let compatMatch = true;
Object.keys(CHARACTER_TRAITS).forEach(id => {
  const live = classifyCompatibility(id);
  const stored = COMPATIBILITY_DB[id];
  const same = JSON.stringify(live.good.sort())===JSON.stringify(stored.good.slice().sort())
    && JSON.stringify(live.spark)===JSON.stringify(stored.spark)
    && JSON.stringify(live.clash.sort())===JSON.stringify(stored.clash.slice().sort());
  if (!same) { compatMatch = false; console.log('  불일치:', id, live, stored); }
});
check('COMPATIBILITY_DB 15개 전부 classifyCompatibility() 재계산과 일치(재현성 확인)', compatMatch);

// ── 검증4: 구조적 불변식 — 15개는 서로 기질을 0개 또는 1개만 공유(2개=버그) ──
// 2026-09-03 군자상 제거 후로는 예외 없이 15개 전부가 이 불변식을 만족해야 한다.
const ids15 = Object.keys(CHARACTER_TRAITS);
let sharedInvariant = true;
ids15.forEach(a => ids15.forEach(b => {
  if (a === b) return;
  const s = sharedTraitCount(CHARACTER_TRAITS[a], CHARACTER_TRAITS[b]);
  if (s !== 0 && s !== 1) { sharedInvariant = false; console.log('  위반:', a, b, 'shared=', s); }
}));
check('15개 간 기질 공유 개수가 항상 0 또는 1 (2 나오면 로직 버그)', sharedInvariant);
check(`캐릭터가 정확히 15개 = C(6,2) (실제 ${ids15.length}개)`, ids15.length === 15);

// ── 검증5: 각 캐릭터마다 정확히 good 2 / spark 1 / clash 2 (총 5개, 중복 없음) ──
let slotShape = true;
Object.keys(CHARACTER_TRAITS).forEach(id => {
  const r = COMPATIBILITY_DB[id];
  const all = [...r.good, ...r.spark, ...r.clash];
  const uniq = new Set(all);
  if (r.good.length!==2 || r.spark.length!==1 || r.clash.length!==2 || uniq.size!==5 || all.includes(id)) {
    slotShape = false; console.log('  형식 위반:', id, r);
  }
});
check('15개 전부 good 2 / spark 1 / clash 2, 중복·자기참조 없음', slotShape);

// ── 검증6: 상호 모순 없음 (A→B good인데 B→A clash, 또는 그 반대) ──
const allIds = Object.keys(CHARACTER_TRAITS);
let conflicts = 0;
allIds.forEach(a => allIds.forEach(b => {
  if (a >= b) return;
  const ab = COMPATIBILITY_DB[a], ba = COMPATIBILITY_DB[b];
  const aGoodB = ab.good.includes(b), aClashB = ab.clash.includes(b);
  const bGoodA = ba.good.includes(a), bClashA = ba.clash.includes(a);
  if ((aGoodB && bClashA) || (aClashB && bGoodA)) {
    conflicts++;
    console.log(`  모순: ${a}↔${b}`);
  }
}));
check(`상호 모순(A는 good인데 B는 clash, 또는 반대) 0건 — 실제 ${conflicts}건`, conflicts === 0);

// ── 검증7: 문서 §30의 유일한 실제 예시와 일치 (장군상 × 책사상 = good) ──
check('§30 문서 예시 "장군상×책사상" good 관계 유지', COMPATIBILITY_DB.CHAEKSA.good.includes('JANGGUN'));

// ═══ 아래 3개는 2026-09-02 궁합 점수 재설계의 회귀 테스트 ═══
// 고친 결함이 다시 들어오는 걸 막는 게 목적이다. 검증1~7과 달리 compatScore()를 직접 호출한다.

// ── 검증8(결함①): compatScore가 대칭인가 — A→B와 B→A가 같아야 한다 ──
// 인연도감은 한 인연을 두 사람의 도감에 함께 저장하므로, 비대칭이면 같은 관계에 다른 숫자가 남는다.
let asymPairs = 0;
allIds.forEach(a => allIds.forEach(b => {
  if (a >= b) return;
  if (compatScore(a, b) !== compatScore(b, a)) {
    asymPairs++;
    if (asymPairs <= 3) console.log(`  비대칭: ${a}↔${b} = ${compatScore(a, b)} vs ${compatScore(b, a)}`);
  }
}));
check(`compatScore 대칭 — 비대칭 페어 0건 (실제 ${asymPairs}건 / ${allIds.length*(allIds.length-1)/2})`, asymPairs === 0);

// ── 검증9(결함②): 캐릭터별 편향이 제거됐는가 ──
// 편향 제거 전에는 군자상이 받는 평균 78점, 예인상이 47점으로 31점이나 벌어져 있었다. 특정
// 캐릭터가 구조적으로 유리·불리해지면 "누구와 만나도 꽝"인 캐릭터가 생겨 바이럴에 역행한다.
const BIAS_GAP_LIMIT = 6;
const recvAvg = {};
allIds.forEach(a => {
  const scores = allIds.filter(b => b !== a).map(b => compatScore(a, b));
  recvAvg[a] = scores.reduce((s, x) => s + x, 0) / scores.length;
});
const avgVals = Object.values(recvAvg);
const biasGap = Math.round(Math.max(...avgVals) - Math.min(...avgVals));
if (biasGap > BIAS_GAP_LIMIT) {
  Object.entries(recvAvg).sort((x, y) => y[1] - x[1])
    .forEach(([id, v]) => console.log(`  ${id}: ${v.toFixed(1)}`));
}
check(`캐릭터별 받는 평균점수 격차 ${BIAS_GAP_LIMIT}점 이하 (실제 ${biasGap}점)`, biasGap <= BIAS_GAP_LIMIT);

// ── 검증10: 얼굴합 5단 등급이 실제로 5개 구간을 모두 쓰는가 ──
// 경계값(FACE_TIERS.min)은 점수 분포에서 뽑은 상수라, 점수 계산식을 손대면 특정 등급이 비거나
// 한 등급에 전부 몰릴 수 있다. 그러면 등급제 자체가 무의미해진다.
const tierCount = {};
FACE_TIERS.forEach(t => { tierCount[t.key] = 0; });
allIds.forEach((a, i) => allIds.slice(i + 1).forEach(b => {
  const t = faceTier(compatScore(a, b));
  if (t) tierCount[t.key]++;
}));
const emptyTiers = Object.entries(tierCount).filter(([, v]) => v === 0).map(([k]) => k);
const totalPairs = Object.values(tierCount).reduce((s, x) => s + x, 0);
const maxShare = Math.max(...Object.values(tierCount)) / totalPairs;
console.log(`   등급 분포: ${Object.entries(tierCount).map(([k, v]) => `${k} ${v}`).join(' / ')} (총 ${totalPairs}짝)`);
check(`5개 등급 모두 사용되고 한 등급이 60%를 넘지 않음 (빈 등급 ${emptyTiers.length}개, 최대 ${Math.round(maxShare * 100)}%)`,
  emptyTiers.length === 0 && maxShare <= 0.6);

// ── 검증11: 표시용 점수 리맵이 순위를 보존하고 등급과 어긋나지 않는가 ──
// 리맵은 내부 점수(14~81)를 화면용(55~99)으로 다시 펴는 것이라, 두 성질이 반드시 지켜져야 한다.
//  ① 단조성 — 내부 점수가 높으면 표시 점수도 높거나 같다. 깨지면 "점수는 낮은데 등급은 위"가 생긴다.
//  ② 밴드 일치 — 표시 점수가 그 등급의 display 범위 안에 있어야 한다. 밴드가 서로 겹치지 않으므로
//     이게 지켜지면 "92점인데 시트콤" 같은 모순이 원천적으로 불가능해진다.
const scored = [];
allIds.forEach((a, i) => allIds.slice(i + 1).forEach(b => {
  const s = compatScore(a, b);
  scored.push({ pair: `${a}×${b}`, s, d: displayScore(s), tier: faceTier(s) });
}));
scored.sort((x, y) => x.s - y.s);
let monoOk = true;
for (let i = 1; i < scored.length; i++) {
  if (scored[i].d < scored[i - 1].d) {
    monoOk = false;
    console.log(`  단조성 위반: ${scored[i - 1].pair}(내부 ${scored[i - 1].s}→표시 ${scored[i - 1].d}) > ${scored[i].pair}(내부 ${scored[i].s}→표시 ${scored[i].d})`);
  }
}
check('표시 점수 단조성 — 내부 점수 순서가 표시 점수에서도 유지됨', monoOk);

const bandOk = scored.every(x => {
  const [lo, hi] = x.tier.display;
  const ok = x.d >= lo && x.d <= hi;
  if (!ok) console.log(`  밴드 이탈: ${x.pair} ${x.tier.key} 표시 ${x.d} (밴드 ${lo}~${hi})`);
  return ok;
});
const dMin = Math.min(...scored.map(x => x.d)), dMax = Math.max(...scored.map(x => x.d));
console.log(`   표시 점수 범위: ${dMin}~${dMax}점 (내부 ${scored[0].s}~${scored[scored.length - 1].s}점)`);
check(`표시 점수가 등급 밴드를 벗어나지 않음 (범위 ${dMin}~${dMax})`, bandOk);

// ── 검증12: 같은 캐릭터끼리도 점수가 나오고, 전부 최고 등급인가 ──
// 인연도감에서 친구 둘이 같은 캐릭터로 판정되는 일은 흔하다. null이면 화면에 "-"로 보여 버그로
// 읽힌다. 또 자기 자신과의 비교에는 편향 보정을 걸지 않으므로(compatScore 주석 참고) 15개가
// 예외 없이 같은 최고점이어야 한다 — 한 캐릭터만 낮게 나오면 그 보정이 새어 들어온 것이다.
const selfPairs = allIds.map(id => ({ id, s: compatScore(id, id) }));
const selfNull = selfPairs.filter(o => o.s == null);
selfNull.forEach(o => console.log(`  null 반환: ${o.id}×${o.id}`));
check(`15개 전부 자기 자신과의 점수가 나옴 (null ${selfNull.length}개)`, selfNull.length === 0);

const selfNotTop = selfPairs.filter(o => o.s != null && faceTier(o.s).key !== FACE_TIERS[0].key);
selfNotTop.forEach(o => console.log(`  최고 등급 아님: ${o.id}×${o.id} = ${o.s}점 (${faceTier(o.s).key})`));
const selfVals = selfPairs.filter(o => o.s != null).map(o => o.s);
console.log(`   같은 캐릭터 점수: 내부 ${Math.min(...selfVals)}~${Math.max(...selfVals)}점 → 표시 ${displayScore(Math.min(...selfVals))}~${displayScore(Math.max(...selfVals))}점`);
check(`같은 캐릭터 조합이 전부 최고 등급(${FACE_TIERS[0].key})`, selfNotTop.length === 0);

console.log('');
console.log(failCount === 0 ? `✅ 전체 통과 (14/14) — 계산 과정 감사 가능·재현성 확인됨` : `❌ ${failCount}개 항목 실패 — 확인 필요`);
console.log('⚠️ 참고: 이 스크립트는 "계산이 맞게 재현되는지"만 확인한다. "이 궁합 배정이 사람이 보기에');
console.log('   그럴듯한가"는 검증 대상이 아니다 — 그건 결국 사람이 읽고 판단할 몫이다.');
