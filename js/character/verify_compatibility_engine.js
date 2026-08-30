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
check('CHARACTER_VECTOR 16개 전부 buildRepresentativeVector() 재계산과 일치', vecMatch);

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
check('COMPATIBILITY_DB 16개 전부 classifyCompatibility() 재계산과 일치(재현성 확인)', compatMatch);

// ── 검증4: 구조적 불변식 — 군자상 제외 15개는 서로 기질을 0개 또는 1개만 공유(2개=버그) ──
const ids15 = Object.keys(CHARACTER_TRAITS).filter(id => id !== 'GUNJA');
let sharedInvariant = true;
ids15.forEach(a => ids15.forEach(b => {
  if (a === b) return;
  const s = sharedTraitCount(CHARACTER_TRAITS[a], CHARACTER_TRAITS[b]);
  if (s !== 0 && s !== 1) { sharedInvariant = false; console.log('  위반:', a, b, 'shared=', s); }
}));
check('15개(군자상 제외) 간 기질 공유 개수가 항상 0 또는 1 (2 나오면 로직 버그)', sharedInvariant);

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
check('16개 전부 good 2 / spark 1 / clash 2, 중복·자기참조 없음', slotShape);

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

console.log('');
console.log(failCount === 0 ? `✅ 전체 통과 (7/7) — 계산 과정 감사 가능·재현성 확인됨` : `❌ ${failCount}개 항목 실패 — 확인 필요`);
console.log('⚠️ 참고: 이 스크립트는 "계산이 맞게 재현되는지"만 확인한다. "이 궁합 배정이 사람이 보기에');
console.log('   그럴듯한가"는 검증 대상이 아니다 — 그건 결국 사람이 읽고 판단할 몫이다.');
