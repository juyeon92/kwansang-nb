// ═══════════════════════════════════════════════════════════════════════
// 사주(四柱) 계산 엔진 — 서버 이관 (ANALYSIS_LOGIC_SERVER_MIGRATION.md 1단계)
//
// js/app.js 1173~2461행(═══ SAJU ═══ ~ ═══ COMBINED ═══ 직전)을 그대로 옮긴 것이다.
// 로직은 한 글자도 바꾸지 않았다 — 목적이 "숨기는 것"이지 "개선하는 것"이 아니므로, 순수 이동만
// 했다(마이그레이션 문서 5번 "동작 동등성 검증" 원칙). render*로 시작하는 함수와 그 안에서만
// 쓰이는 DOM 조작(el.innerHTML, document.*)은 브라우저 전용이라 서버에서 호출되지 않지만, 통째로
// 옮겨 온 파일이 원본과 diff 비교 가능하도록 일부러 지우지 않았다 — 클라이언트 쪽 렌더링 코드는
// 그대로 두고, 이 파일이 내보내는 계산 결과만 갖다 쓰면 되게 하려는 목적. 실제로 호출되는 함수는
// 아래 `computeSajuBundle`과 `module.exports`에 나열된 것뿐이다.
//
// 브라우저에서는 index.html이 CDN(<script src=".../lunar-javascript/lunar.js">)으로 전역
// Solar/Lunar/EightChar를 로드했다 — 서버에서는 같은 이름을 내보내는 npm 패키지로 대체한다
// (require('lunar-javascript') → { Solar, Lunar, EightChar, ... }, 실제 확인 완료 2026-09-08).
// ═══════════════════════════════════════════════════════════════════════
const { Solar, Lunar, EightChar } = require('lunar-javascript');

// ═══ SAJU ═══
const CHEONGAN = ['甲','乙','丙','丁','戊','己','庚','辛','壬','癸'];
const JIJI = ['子','丑','寅','卯','辰','巳','午','未','申','酉','戌','亥'];
const CG_KO = ['갑','을','병','정','무','기','경','신','임','계'];
const JJ_KO = ['자','축','인','묘','진','사','오','미','신','유','술','해'];
const CG_OH = ['목','목','화','화','토','토','금','금','수','수'];
const JJ_OH = ['수','토','목','목','토','화','화','토','금','금','토','수'];

// ═══ 12운성(十二運星) — 일간(나) 기준으로 각 지지가 "장생~양" 중 어느 기운 단계인지 ═══
// 양간(甲丙戊庚壬)은 자기 장생지에서 지지 순서대로 순행, 음간(乙丁己辛癸)은 역행한다는
// 명리학 표준 공식 그대로다(학파 차이가 없는 부분). 실제 예시(1992-11-14 사시, 갑일간)로
// 검증함: 일지 午→사, 시지 午→사, 월지 亥→장생, 년지 申→절 — 990사주 결과와 4/4 정확히 일치.
const SIBIUNSEONG_START = [11, 6, 2, 9, 2, 9, 5, 0, 8, 3]; // 천간 인덱스별 장생지(지지 인덱스) — 甲亥 乙午 丙寅 丁酉 戊寅 己酉 庚巳 辛子 壬申 癸卯
const SIBIUNSEONG_NAMES = ['장생','목욕','관대','건록','제왕','쇠','병','사','묘','절','태','양'];
function get12Unseong(dayStemIdx, branchIdx) {
  if (dayStemIdx < 0 || branchIdx < 0) return null;
  const start = SIBIUNSEONG_START[dayStemIdx];
  const isYang = dayStemIdx % 2 === 0; // 짝수 인덱스(甲丙戊庚壬)가 양간
  const diff = isYang ? (branchIdx - start + 12) % 12 : (start - branchIdx + 12) % 12;
  return SIBIUNSEONG_NAMES[diff];
}
const SIBIUNSEONG_MEANING = {
  장생: '새싹이 움트는 시작의 기운. 순수하고 낙천적이며, 새 일을 시작할 때 힘을 잘 받는 시기예요.',
  목욕: '태어나 처음 씻기는 기운. 감수성이 예민하고 이성 관계나 유행에 관심이 많아지는 시기예요.',
  관대: '옷을 갖춰 입는 기운. 자신감이 붙고 사회로 나설 준비가 되는, 성장이 눈에 띄는 시기예요.',
  건록: '스스로 녹(祿)을 버는 기운. 독립심이 강하고 자기 실력으로 자리를 잡아가는 안정적인 시기예요.',
  제왕: '기운이 최고조에 달하는 시기. 리더십과 추진력이 강해지지만, 자칫 고집이 세질 수 있어요.',
  쇠:   '왕성함이 한풀 꺾이는 기운. 경험과 관록이 쌓여 노련해지지만, 새 도전보다는 안정을 찾는 편이에요.',
  병:   '기운이 약해지는 시기. 예민하고 생각이 많아지지만, 그만큼 섬세하고 배려심이 깊어져요.',
  사:   '기운이 멈춘 듯 조용한 시기. 차분하고 신중하며, 겉으로 드러내기보다 속으로 다지는 타입이에요.',
  묘:   '씨앗이 땅속에 숨듯 기운을 갈무리하는 시기. 내면을 다지고 준비하는 힘이 강해요.',
  절:   '기운이 끊어졌다 다시 이어지는 전환점. 변화에 유연하고, 완전히 새로운 방향으로 틀 수 있는 시기예요.',
  태:   '새 생명이 잉태되는 기운. 기대와 가능성이 움트는, 무언가 새로 시작되기 직전의 시기예요.',
  양:   '태아가 자라나는 기운. 보호받으며 차곡차곡 성장하는, 안정 속에서 힘을 키우는 시기예요.',
};

// ═══ 십성(十星) — 일간 대비 다른 천간의 오행·음양 관계로 정하는 10가지 관계. 학파 차이가 없는
// 표준 공식이다(비겁=같은 오행, 식상=일간이 생하는 오행, 재성=일간이 극하는 오행, 관성=일간을
// 극하는 오행, 인성=일간을 생하는 오행 — 각 그룹 내에서 음양이 같으면 비견/식신/편재/편관/편인,
// 다르면 겁재/상관/정재/정관/정인). 갑목 일간 기준 표준표(갑비견·을겁재·병식신·정상관·무편재·
// 기정재·경편관·신정관·임편인·계정인)로 20개 조합 전부 검증함.
function getSipseong(dayStemIdx, targetStemIdx) {
  if (dayStemIdx < 0 || targetStemIdx < 0) return null;
  const dayOh = CG_OH[dayStemIdx], targetOh = CG_OH[targetStemIdx];
  const sameYinYang = (dayStemIdx % 2) === (targetStemIdx % 2);
  if (dayOh === targetOh) return sameYinYang ? '비견' : '겁재';
  if (OHAENG_GENERATES[dayOh] === targetOh) return sameYinYang ? '식신' : '상관';
  if (OHAENG_CONTROLS[dayOh] === targetOh) return sameYinYang ? '편재' : '정재';
  if (OHAENG_CONTROLS[targetOh] === dayOh) return sameYinYang ? '편관' : '정관';
  if (OHAENG_GENERATES[targetOh] === dayOh) return sameYinYang ? '편인' : '정인';
  return null; // 오행 5개가 닫힌 순환이라 이론상 도달 불가
}
// 년간·월간·시간을 일간과 비교해 십성 3개를 한 번에 반환(일간 자신은 "일원"이라 비교 대상에서 제외).
function calcSipseongAll(pillars) {
  const dStem = pillars[2].stem;
  if (dStem < 0) return null;
  return {
    year: getSipseong(dStem, pillars[0].stem),
    month: getSipseong(dStem, pillars[1].stem),
    hour: getSipseong(dStem, pillars[3].stem),
  };
}
const SIPSEONG_MEANING = {
  비견: '나와 같은 힘. 독립심과 자존심이 강하고, 동료·형제 같은 수평적 관계를 뜻해요.',
  겁재: '나와 같은 오행이지만 결이 다른 힘. 경쟁심과 추진력이 있지만, 재물이 새어나가기 쉬운 기운이기도 해요.',
  식신: '내가 만들어내는 온화한 힘. 표현력과 낙천성, 먹고사는 재주(식복)를 뜻해요.',
  상관: '내가 만들어내는 날카로운 힘. 재능과 끼가 넘치지만 규율에 반발하는 기운이기도 해요.',
  편재: '내가 다스리는 유동적인 재물. 통 큰 씀씀이, 사업·투자 감각과 관련 있어요.',
  정재: '내가 다스리는 안정적인 재물. 성실하게 모으는 재물운과 관련 있어요.',
  편관: '나를 다스리는 강한 힘(칠살). 추진력과 카리스마가 있지만 스트레스·압박으로도 작용해요.',
  정관: '나를 다스리는 반듯한 힘. 명예·직장운, 책임감과 관련 있어요.',
  편인: '나를 채워주는 특이한 힘. 직관력과 독창성이 있지만 변덕스러울 수 있어요.',
  정인: '나를 채워주는 다정한 힘. 학문·문서운, 보살핌을 받는 편안함을 뜻해요.',
};

// 궁합보기 Zone2 신규(6-1) — "상대는 나에게 어떤 존재인가"를 서로의 일간을 상대 일간 기준 십성으로
// 교차 계산해서 본다. 개인 성격 서술이 아니라 관계 안에서의 역할이라 궁합보기 취지에 맞는다.
function buildSipseongCross(pillarsA, pillarsB) {
  const dStemA = pillarsA[2].stem, dStemB = pillarsB[2].stem;
  if (dStemA < 0 || dStemB < 0) return null;
  const partnerToMe = getSipseong(dStemA, dStemB); // 내(A) 일간 기준 상대(B)의 역할 = "상대는 나에게 ~"
  const meToPartner = getSipseong(dStemB, dStemA); // 상대(B) 일간 기준 나(A)의 역할 = "나는 상대에게 ~"
  return {
    partnerToMe, meToPartner,
    meaningPartnerToMe: SIPSEONG_MEANING[partnerToMe],
    meaningMeToPartner: SIPSEONG_MEANING[meToPartner],
    dayOhA: CG_OH[dStemA], dayOhB: CG_OH[dStemB],
  };
}
// SIPSEONG_MEANING은 "짧은 명사구. 부연 설명."의 2문장 구조다(예: "나를 채워주는 다정한 힘. 학문·
// 문서운, 보살핌을 받는 편안함을 뜻해요."). 앞의 명사구에 서술어(이에요)가 없어서, 카드 안에 그대로
// 넣으면 문장이 서술어 없이 뚝 끊긴 것처럼 읽힌다(사용자 리포트 2026-08-20). 역할명을 주어로 붙이고
// 첫 문장에 "이에요"를 넣어 완결된 문장 두 개로 만든다.
// ⚠️ 2026-08-20 추가 수정: "그래서 ~ 다가오는 관계예요" 같은 요약 줄은 구체적인 내용이 없어 오히려
// "무슨 말인지 모르겠다"는 반응을 받았다(사용자 리포트) — 정의문 자체가 이미 관계 함의를 담고
// 있으므로 뺐다.
// 한글 받침 유무로 "은/는" 조사를 고른다 — 십성 10개 중 겁재·편재·정재는 받침 없는 "재"로 끝나서
// "은"을 붙이면 문법이 깨진다(예: "편재은" → "편재는").
function josaEunNeun(word) {
  const ch = word.charCodeAt(word.length - 1);
  if (ch < 0xAC00 || ch > 0xD7A3) return '는';
  return (ch - 0xAC00) % 28 !== 0 ? '은' : '는';
}
function sipseongMeaningSentence(role, meaning) {
  const dot = meaning.indexOf('.');
  const subject = `${role}${josaEunNeun(role)}`;
  if (dot < 0) return `${subject} ${meaning}`;
  return `${subject} ${meaning.slice(0, dot)}이에요.${meaning.slice(dot + 1)}`;
}
function renderSipseongCross(cross, elId) {
  const el = document.getElementById(elId);
  if (!el) return;
  if (!cross) { el.innerHTML = ''; return; }
  el.innerHTML = `
    <div class="chemi-card">
      <div class="chemi-title">상대 → 나</div>
      <div class="chemi-role">상대는 나에게 <strong>${cross.partnerToMe}</strong> 같은 존재예요.</div>
      <div class="chemi-role" style="margin-top:4px;">${sipseongMeaningSentence(cross.partnerToMe, cross.meaningPartnerToMe)}</div>
      <div class="chemi-role" style="font-size:11px;color:var(--text2);margin-top:6px;">근거: 내 일간(${cross.dayOhA}) 기준 상대 일간(${cross.dayOhB}) → ${cross.partnerToMe}</div>
    </div>
    <div class="chemi-card">
      <div class="chemi-title">나 → 상대</div>
      <div class="chemi-role">나는 상대에게 <strong>${cross.meToPartner}</strong> 같은 존재예요.</div>
      <div class="chemi-role" style="margin-top:4px;">${sipseongMeaningSentence(cross.meToPartner, cross.meaningMeToPartner)}</div>
      <div class="chemi-role" style="font-size:11px;color:var(--text2);margin-top:6px;">근거: 상대 일간(${cross.dayOhB}) 기준 내 일간(${cross.dayOhA}) → ${cross.meToPartner}</div>
    </div>`;
}

// ═══ 지장간(支藏干) — 지지 12개마다 숨어있는 천간(여기·중기·정기, 마지막 원소=정기). 통근(通根:
// 천간이 지지 속에 뿌리를 갖고 있는가) 판정에만 쓴다. 정기 12개 전부 JJ_OH와 일치함을 검증했다
// (스크래치패드 jijanggan-test.js).
const JIJANGGAN = {
  0: [8, 9],      // 자: 임, 계(정기)
  1: [9, 7, 5],   // 축: 계, 신, 기(정기)
  2: [4, 2, 0],   // 인: 무, 병, 갑(정기)
  3: [0, 1],      // 묘: 갑, 을(정기)
  4: [1, 9, 4],   // 진: 을, 계, 무(정기)
  5: [4, 6, 2],   // 사: 무, 경, 병(정기)
  6: [2, 5, 3],   // 오: 병, 기, 정(정기)
  7: [3, 1, 5],   // 미: 정, 을, 기(정기)
  8: [4, 8, 6],   // 신: 무, 임, 경(정기)
  9: [6, 7],      // 유: 경, 신(정기)
  10: [7, 3, 4],  // 술: 신, 정, 무(정기)
  11: [4, 0, 8],  // 해: 무, 갑, 임(정기)
};
// 천간 하나가 네 지지 중 하나에라도 같은 오행의 지장간을 갖고 있으면 "통근"으로 본다(같은 천간이
// 아니라 같은 오행 기준 — 통근을 넓게 보는 방식).
function hasTonggeun(stemIdx, pillars) {
  if (stemIdx < 0) return false;
  const targetOh = CG_OH[stemIdx];
  return pillars.some(p => p.branch >= 0 && (JIJANGGAN[p.branch] || []).some(hs => CG_OH[hs] === targetOh));
}

// ═══ 신강/신약 판정 + 용신(필요 오행) — 억부법(抑扶法) 간이 버전. 정통 명리학은 격국·조후까지
// 종합 판단해 학파 차이가 큰 영역이라, 여기서는 "일간을 돕는 세력(비겁·인성) 대 소모시키는 세력
// (식상·재성·관성)의 개수 비교"를 기본 축으로 삼는 대중적 간이법을 쓴다(전문 사주 상담 대체 아님).
// 월지(월령)는 사주 강약에 미치는 영향이 가장 커서 가중치 2배를 주고, 천간은 통근 여부(지지에
// 뿌리가 있는가)로 실질 영향력을 가감한다(뿌리 없는 천간은 절반 weight) — 통근/조후 관련 자세한
// 한계는 기획서/명리학 엔진 한계 노트.md 참고.
function calcSinkangSinyak(pillars) {
  const dStem = pillars[2].stem;
  if (dStem < 0) return null;
  const dayOh = CG_OH[dStem];
  let help = 0, drain = 0; // help=비겁+인성(돕는 세력), drain=식상+재성+관성(소모시키는 세력)
  pillars.forEach((p, i) => {
    const weight = (i === 1) ? 2 : 1; // 월주(1)만 가중치 2배
    if (p.stem >= 0 && i !== 2) { // 일간 본인(i===2)의 천간은 비교 대상에서 제외
      const oh = CG_OH[p.stem];
      const rootWeight = hasTonggeun(p.stem, pillars) ? 1 : 0.5; // 통근 없으면 "떠 있는" 천간이라 절반만 반영
      if (oh === dayOh || OHAENG_GENERATES[oh] === dayOh) help += rootWeight; else drain += rootWeight;
    }
    if (p.branch >= 0) {
      const oh = JJ_OH[p.branch];
      if (oh === dayOh || OHAENG_GENERATES[oh] === dayOh) help += weight; else drain += weight;
    }
  });
  const dayRooted = hasTonggeun(dStem, pillars);
  if (dayRooted) help += 1; // 일간 본인이 통근했으면 뿌리 있는 힘으로 가산
  return { isStrong: help >= drain, help, drain, dayRooted };
}
// 용신(필요 오행) — 신강이면 일간을 덜어내는 식상·재성·관성 중, 신약이면 일간을 채워주는 비겁(자기
// 오행)·인성 중, 그 사람 사주 안에 실제로 가장 적게 있는(=가장 부족한) 오행을 "필요한 오행"으로 고른다.
function calcYongsin(pillars) {
  const sinkang = calcSinkangSinyak(pillars);
  if (!sinkang) return null;
  const dStem = pillars[2].stem;
  const dayOh = CG_OH[dStem];
  const ohCount = computeOhaeng(pillars);
  const gwanseongOh = Object.keys(OHAENG_CONTROLS).find(k => OHAENG_CONTROLS[k] === dayOh);
  const inseongOh = Object.keys(OHAENG_GENERATES).find(k => OHAENG_GENERATES[k] === dayOh);
  const candidateOh = sinkang.isStrong
    ? [OHAENG_GENERATES[dayOh], OHAENG_CONTROLS[dayOh], gwanseongOh]
    : [dayOh, inseongOh];
  const yongsinOh = candidateOh.reduce((min, oh) => (ohCount[oh] < ohCount[min] ? oh : min), candidateOh[0]);
  return { isStrong: sinkang.isStrong, help: sinkang.help, drain: sinkang.drain, yongsinOh, ohCount };
}

// 궁합보기 Zone2 신규(6-2) — "내가 부족한 오행을 상대가 갖고 있는가"만 본다. calcYongsin 자체가
// 간이 억부법(기획서/명리학 엔진 한계 노트.md 2절)이라, 카드에도 그 단서를 그대로 노출한다.
function buildYongsinChemi(pillarsA, pillarsB, ohA, ohB) {
  const yA = calcYongsin(pillarsA), yB = calcYongsin(pillarsB);
  if (!yA || !yB) return null;
  const totalA = Object.values(ohA).reduce((a, b) => a + b, 0) || 1;
  const totalB = Object.values(ohB).reduce((a, b) => a + b, 0) || 1;
  const bHasForA = Math.round((ohB[yA.yongsinOh] || 0) / totalB * 100); // 상대가 내 용신 오행을 가진 비중(%)
  const aHasForB = Math.round((ohA[yB.yongsinOh] || 0) / totalA * 100); // 내가 상대 용신 오행을 가진 비중(%)
  return { yongsinOhA: yA.yongsinOh, yongsinOhB: yB.yongsinOh, bHasForA, aHasForB };
}
// 오행 5개가 고르면 각 20%씩이라, 20%를 "평균 이상 갖고 있다"의 기준선으로 삼는다.
function renderYongsinChemi(yongsin, elId) {
  const el = document.getElementById(elId);
  if (!el) return;
  if (!yongsin) { el.innerHTML = ''; return; }
  const { yongsinOhA, yongsinOhB, bHasForA, aHasForB } = yongsin;
  const textForA = bHasForA >= 20
    ? `내게 필요한 ${yongsinOhA} 기운을 상대가 넉넉히 갖고 있어요(${bHasForA}%) — 존재만으로 균형이 맞춰지는 조합이에요.`
    : `내게 필요한 ${yongsinOhA} 기운이 상대에게도 부족한 편이에요(${bHasForA}%) — 둘이 서로 채워주기보단, 취미나 환경에서 그 기운을 보완하면 좋아요.`;
  const textForB = aHasForB >= 20
    ? `상대에게 필요한 ${yongsinOhB} 기운을 내가 넉넉히 갖고 있어요(${aHasForB}%) — 상대에게 내가 힘이 되어주는 조합이에요.`
    : `상대에게 필요한 ${yongsinOhB} 기운이 나에게도 부족한 편이에요(${aHasForB}%) — 둘 다 외부에서 채워야 하는 기운이에요.`;
  el.innerHTML = `
    <div class="chemi-card">
      <div class="chemi-title">나에게 필요한 오행 — ${yongsinOhA}</div>
      <div class="chemi-role">${textForA}</div>
    </div>
    <div class="chemi-card">
      <div class="chemi-title">상대에게 필요한 오행 — ${yongsinOhB}</div>
      <div class="chemi-role">${textForB}</div>
    </div>
    <div class="chemi-role" style="font-size:11px;color:var(--text2);margin-top:4px;">💡 이 판정은 간이 억부법 기준의 참고용 해석이에요.</div>`;
}

// ═══ 천을귀인(天乙貴人) — 일간 기준으로 가장 잘 알려진 길신(吉神). 학파 차이가 거의 없는 표준 공식 ═══
const CHEONEUL_GWIIN = { 0:[1,7], 4:[1,7], 6:[1,7], 1:[0,8], 5:[0,8], 2:[11,9], 3:[11,9], 7:[6,2], 8:[5,3], 9:[5,3] };
// 甲戊庚→丑未(1,7), 乙己→子申(0,8), 丙丁→亥酉(11,9), 辛→午寅(6,2), 壬癸→巳卯(5,3)
function isCheonEulGwiin(dayStemIdx, branchIdx) {
  const targets = CHEONEUL_GWIIN[dayStemIdx];
  return !!targets && targets.includes(branchIdx);
}

// ═══ 12신살(十二神殺) — 사용자가 보내준 상세 만세력 예시(최주연,1992-11-14)로 역산해서 검증한 공식.
// 년지·월지·일지 3개를 각각 기준점으로 삼아, 그 지지가 속한 삼합국(申子辰·亥卯未·寅午戌·巳酉丑) 표를
// 적용해 각 기둥의 지지가 어느 신살에 해당하는지 구한다. 기존엔 기준점을 하나만 썼다가 재현이 안
// 됐는데, 3개 기준점 전부·4개 기둥 전부(12개 데이터포인트)를 이 방식으로 정확히 재현했다.
const SAMHAP_GROUP = { 8:'수국',0:'수국',4:'수국', 11:'목국',3:'목국',7:'목국', 2:'화국',6:'화국',10:'화국', 5:'금국',9:'금국',1:'금국' };
const SIBISINSAL_NAMES = ['겁살','재살','천살','지살','년살','월살','망신살','장성살','반안살','역마살','육해살','화개살'];
const SIBISINSAL_START = { 수국:5, 목국:8, 화국:11, 금국:2 }; // 겁살이 시작하는 지지 인덱스(각 삼합국 생지의 -3)
function get12Sinsal(refBranchIdx, targetBranchIdx) {
  const group = SAMHAP_GROUP[refBranchIdx];
  if (!group) return null;
  const diff = (targetBranchIdx - SIBISINSAL_START[group] + 12) % 12;
  return SIBISINSAL_NAMES[diff];
}
function get12SinsalForBranch(targetBranchIdx, yBranch, mBranch, dBranch) {
  if (targetBranchIdx < 0) return [];
  const labels = new Set();
  [yBranch, mBranch, dBranch].forEach(ref => { if (ref >= 0) { const s = get12Sinsal(ref, targetBranchIdx); if (s) labels.add(s); } });
  return Array.from(labels);
}
const SIBISINSAL_MEANING = {
  겁살: '갑작스러운 손실이나 변화의 기운. 예상 못 한 지출이나 이별을 조심하되, 위기 대응력을 키워주는 시기예요.',
  재살: '얽매이고 구속되는 기운. 인간관계나 상황에 발이 묶이는 느낌이 들 수 있어요. 인내심이 필요한 시기예요.',
  천살: '내 힘으로 어쩔 수 없는 외부 변수를 마주하는 기운. 순응하고 받아들이는 지혜가 필요한 시기예요.',
  지살: '이동과 변화의 기운. 이사, 여행, 새로운 곳으로 나아가는 흐름이 자연스럽게 따라와요.',
  년살: '매력과 사교의 기운(도화살과 비슷해요). 사람을 끄는 매력이 있지만 유혹에는 신중해야 하는 시기예요.',
  월살: '메마르고 정체되는 기운. 일이 더디게 풀리는 느낌이 들 수 있어요. 인내와 기다림이 필요한 시기예요.',
  망신살: '체면과 이미지의 기운. 뜻하지 않게 구설수에 오르거나 민망할 수 있어요. 언행에 신경 쓰면 좋은 시기예요.',
  장성살: '장군처럼 기운이 강해지는 시기. 리더십과 추진력이 살아나고 통솔력이 빛을 발해요.',
  반안살: '말안장에 올라탄 듯 안정되는 기운. 승진이나 명예운이 따르는 시기예요.',
  역마살: '이동과 역동의 기운. 여행·이사·해외 등 움직임이 많아지고 활동 반경이 넓어지는 시기예요.',
  육해살: '얽히고설키는 기운. 건강이나 인간관계에서 세심하게 신경 쓸 일이 생기는 시기예요.',
  화개살: '예술과 종교의 기운. 감수성과 예술적 재능이 발달하고, 혼자만의 시간에서 힘을 얻는 시기예요.',
};

// ═══ 그 외 귀인/살 — 전부 일간 또는 월지 기준의 단일 표라 학파 차이가 거의 없는 것들만 골랐고,
// 마찬가지로 위 예시로 검증했다. ═══
const TAEGEUK_GWIIN = { 0:[0,6],1:[0,6], 2:[3,9],3:[3,9], 4:[4,10,1,7],5:[4,10,1,7], 6:[2,11],7:[2,11], 8:[5,8],9:[5,8] };
const MUNGOK_GWIIN = [11,0,2,3,2,3,5,6,8,9]; // 일간별 문곡귀인 지지
const AMROK_GWIIN = [11,10,8,7,8,7,5,4,2,1]; // 일간별 암록 지지
const WOLDEOK_GWIIN_TARGET = { 화국:2, 수국:8, 목국:0, 금국:6 }; // 월지 삼합국별 월덕귀인 천간
const GORAN_SAL = [[0,2],[1,5],[3,5],[4,8],[7,11],[7,9],[8,10]]; // 甲寅 乙巳 丁巳 戊申 辛亥 辛酉 壬戌
// ⚠️ 현침살은 출처마다 글자 구성이 조금씩 다르다(甲辛卯午未까지만 쓰는 곳도 있음) — 이 예시의 4기둥이
// 전부 걸리는 걸로 봐서 申까지 포함한 6글자 버전으로 넣었는데, 다른 예시에서 어긋나면 알려달라.
const HYEONCHIM_STEMS = [0, 7]; // 甲, 辛
const HYEONCHIM_BRANCHES = [3, 6, 7, 8]; // 卯, 午, 未, 申

// ═══ 포스텔러 만세력 예시(최정원, 무신일주)로 추가 검증한 귀인/살 7종 ═══
// 문창귀인·천주귀인은 일간 기준 단일 표, 관귀학관은 12운성 표를 재사용해 유도, 천의성·과숙살은
// 월지/년지 기준 계산식, 괴강살·백호대살은 특정 간지 조합 표 — 전부 이 예시로 실측 대조함.
const MUNCHANG_GWIIN = [5, 6, 8, 9, 8, 9, 11, 0, 2, 3]; // 甲巳 乙午 丙申 丁酉 戊申 己酉 庚亥 辛子 壬寅 癸卯
const CHEONJU_GWIIN = [5, 6, 5, 6, 8, 9, 11, 0, 2, 3]; // 甲巳 乙午 丙巳 丁午 戊申 己酉 庚亥 辛子 壬寅 癸卯
// 관귀학관 = "일간을 극하는 오행(관성)"의 대표 양간이 12운성 장생을 맞는 지지 — SIBIUNSEONG_START 재사용
const CONTROLLING_OH = { 목:'금', 화:'수', 토:'목', 금:'화', 수:'토' };
const OH_YANG_STEM_IDX = { 목:0, 화:2, 토:4, 금:6, 수:8 };
// 방합(方合, 계절별 묶음 — 삼합국과는 다른 분류) 기준 과숙살 목표 지지
const BANGHAP_GROUP = { 11:'해자축',0:'해자축',1:'해자축', 2:'인묘진',3:'인묘진',4:'인묘진', 5:'사오미',6:'사오미',7:'사오미', 8:'신유술',9:'신유술',10:'신유술' };
const GWASUK_TARGET = { 해자축:10, 인묘진:1, 사오미:4, 신유술:7 }; // 亥子丑→戌 寅卯辰→丑 巳午未→辰 申酉戌→未
// 괴강살(확장판 — 壬戌까지 포함, 원조 4종만 쓰는 곳도 있음) / 백호대살 — 특정 (천간,지지) 조합
const GOEGANG_SAL = [[6,4],[6,10],[8,4],[4,10],[8,10]]; // 庚辰 庚戌 壬辰 戊戌 壬戌
const BAEKHO_SAL = [[0,4],[1,7],[2,10],[3,1],[4,4],[8,10],[9,1]]; // 甲辰 乙未 丙戌 丁丑 戊辰 壬戌 癸丑

// ═══ gangjungsa.co.kr(강정사) 신살 목록 대조로 2026-08-20 추가한 26종 ═══
// 원문이 성별에 따라 판정 지지를 다르게 주는 항목(의처의부살·천라지망살)은 §2 원칙5(성별은 판정에
// 쓰지 않는다)에 따라 남/여 조합을 하나로 합쳐 성별 무관하게 판정한다. 신뢰도가 낮다고 사이트 스스로
// 인정한 항목(부벽살·십악대패살·태백살)과 성립조건 자체가 불완전한 항목(원진살·상문살·탄함살·
// 월덕합/천덕합)은 이번 배치에서 제외했다. 고과살은 여성 판정 지지가 기존 과숙살(BANGHAP_GROUP)과
// 완전히 동일해 별도 항목으로 추가하면 중복이라 제외했고, 복음살은 "일주=올해 태세" 조건이라 분석
// 시점마다 결과가 달라져 §2 원칙2(재현성)에 위배되므로 이번 배치에서 제외했다.

// -- 일간(day stem) 기준 단일 표 — 기존 MUNCHANG_GWIIN 패턴과 동일 --
const CHEONGWAN_GWIIN = [7, 5, 4, 5, 2, 3, 10, 8, 9, 6]; // 갑미 을사 병진 정사 무인 기묘 경술 신신 임유 계오
const HONGYEOM_SAL = [6, 6, 2, 7, 4, 4, 10, 9, 8, 8]; // 갑을오 병인 정미 무기진 경술 신유 임계신
const YUHA_SAL = [9, 10, 7, 8, 5, 6, 4, 3, 11, 2]; // 갑유 을술 병미 정신 무사 기오 경진 신묘 임해 계인
const BIIN_SAL = [9, 10, 0, 1, 0, 1, 1, 4, 6, 7]; // 갑유 을술 병자 정축 무자 기축 경축 신진 임오 계미
const NAKJEONG_SAL = [5, 0, 8, 10, 3, 5, 0, 8, 10, 3]; // 갑기사 을경자 병신신 정임술 무계묘

// -- 일주(day pillar) 세트 — 기존 GORAN_SAL/GOEGANG_SAL/BAEKHO_SAL과 동일한 [stem,branch] 목록 패턴 --
const HYOSIN_SAL = [[0, 0], [1, 11], [2, 2], [3, 3], [4, 6], [5, 5], [6, 4], [6, 10], [7, 7], [7, 1], [8, 8], [9, 9]];
// 원문은 남(갑오·병술·무진·경진·임술)/여(을사·정해·기해·신사·계해)를 나눠 판정하지만, 성별 무관
// 원칙(§2-5)에 따라 두 목록을 합쳐 누구에게나 동일하게 적용한다.
const EUICHEO_SAL = [[0, 6], [2, 10], [4, 4], [6, 4], [8, 10], [1, 5], [3, 11], [5, 11], [7, 5], [9, 11]];
const YOKMANG_SAL = [[0, 2], [1, 3], [3, 7], [4, 10], [5, 7], [6, 8], [7, 3]];
const OKYEO_SAL = [[0, 4], [1, 5], [6, 10], [7, 11]];
const GUIN_SAL = [[2, 0], [3, 1], [4, 0], [5, 1], [8, 6], [9, 7]];
const GWANGEUM_SAL = [[4, 10], [6, 4], [6, 10], [8, 10]];
const GUCHU_BANGHAE_SAL = [[8, 0], [8, 6], [4, 0], [4, 6], [5, 3], [5, 9], [1, 3], [1, 9], [7, 3], [7, 9]];
const CHEONGONG_SAL = [[0, 8], [1, 9], [2, 0], [3, 11], [4, 0], [5, 11], [6, 2], [7, 3]];
function matchesStemBranchSet(stemIdx, branchIdx, set) {
  return set.some(([s, b]) => s === stemIdx && b === branchIdx);
}
function isHyosinSal(stemIdx, branchIdx) { return matchesStemBranchSet(stemIdx, branchIdx, HYOSIN_SAL); }
function isEuicheoSal(stemIdx, branchIdx) { return matchesStemBranchSet(stemIdx, branchIdx, EUICHEO_SAL); }
function isYokmangSal(stemIdx, branchIdx) { return matchesStemBranchSet(stemIdx, branchIdx, YOKMANG_SAL); }
function isOkyeoSal(stemIdx, branchIdx) { return matchesStemBranchSet(stemIdx, branchIdx, OKYEO_SAL); }
function isGuinSal(stemIdx, branchIdx) { return matchesStemBranchSet(stemIdx, branchIdx, GUIN_SAL); }
function isGwangeumSal(stemIdx, branchIdx) { return matchesStemBranchSet(stemIdx, branchIdx, GWANGEUM_SAL); }
function isGuchuBanghaeSal(stemIdx, branchIdx) { return matchesStemBranchSet(stemIdx, branchIdx, GUCHU_BANGHAE_SAL); }
function isCheongongSal(stemIdx, branchIdx) { return matchesStemBranchSet(stemIdx, branchIdx, CHEONGONG_SAL); }

// -- 지지 두 글자의 관계로 성립 — 기준 기둥 없이 네 지지 중 아무 두 곳이나 짝이면 성립 --
const CHUNG_PAIRS = [[0, 6], [1, 7], [2, 8], [3, 9], [4, 10], [5, 11]]; // 지지충(=상충살): 자오 축미 인신 묘유 진술 사해
const GWIMUNGWAN_PAIRS = [[0, 9], [1, 6], [2, 7], [3, 8], [4, 11], [5, 10]]; // 귀문관살: 자유 축오 인미 묘신 진해 사술
const HYEORIN_PAIRS = [[0, 10], [1, 9], [2, 8], [3, 7], [4, 6], [5, 5]]; // 혈인살: 자술 축유 인신 묘미 진오 사사(같은 지지 중복)
function hasBranchPair(pillars, pairs) {
  const branches = pillars.map(p => p.branch).filter(b => b >= 0);
  return pairs.some(([a, b]) => {
    if (a === b) return branches.filter(x => x === a).length >= 2;
    return branches.includes(a) && branches.includes(b);
  });
}

// -- 나머지: 기준 기둥이 각각 다른 개별 로직 --
// 삼형살: 인사신(3자 모두) · 축술미(2자 이상) · 자묘(둘 다) · 자형(진/오/유/해 중 하나가 중복)
function hasSamhyeongSal(pillars) {
  const branches = pillars.map(p => p.branch).filter(b => b >= 0);
  const count = b => branches.filter(x => x === b).length;
  const insasin = [2, 5, 8].every(b => branches.includes(b));
  const chuksulmi = [1, 10, 7].filter(b => branches.includes(b)).length >= 2;
  const jamyo = branches.includes(0) && branches.includes(3);
  const jahyeong = [4, 6, 9, 11].some(b => count(b) >= 2);
  return insasin || chuksulmi || jamyo || jahyeong;
}
// 천라지망살: 병정일간+술해 있으면 천라, 임계일간+진사 있으면 지망 — 원문의 남녀 구분 대신 §2-5
// 원칙에 따라 일간 기준 조건만 사용한다.
function hasCheonraJimangSal(pillars) {
  const d = pillars[2];
  if (!d || d.stem < 0) return false;
  const branches = pillars.map(p => p.branch).filter(b => b >= 0);
  if ([2, 3].includes(d.stem) && branches.some(b => b === 10 || b === 11)) return true;
  if ([8, 9].includes(d.stem) && branches.some(b => b === 4 || b === 5)) return true;
  return false;
}
// 급각살: 월지가 속한 방합(계절 묶음)별 목표 지지 2개 중 하나가 다른 기둥에 있으면 성립
const GIPGAK_TARGET = { 인묘진: [11, 0], 사오미: [3, 7], 신유술: [2, 10], 해자축: [1, 4] };
function hasGipgakSal(pillars) {
  const m = pillars[1];
  if (!m || m.branch < 0) return false;
  const targets = GIPGAK_TARGET[BANGHAP_GROUP[m.branch]];
  if (!targets) return false;
  return pillars.some(p => targets.includes(p.branch));
}
// 단교관살: 월지 → 목표 지지 1개(기존 WOLDEOK_GWIIN_TARGET류와 동일한 지지→지지 단일 표)
const DANGYO_TARGET = [11, 0, 2, 3, 8, 1, 10, 9, 4, 5, 6, 7]; // 자해 축자 인인 묘묘 진신 사축 오술 미유 신진 유사 술오 해미
function hasDangyoSal(pillars) {
  const m = pillars[1];
  if (!m || m.branch < 0) return false;
  const target = DANGYO_TARGET[m.branch];
  return pillars.some(p => p.branch === target);
}
// 조객살: 년지(띠) 기준 두 칸 앞 지지가 다른 기둥에 있으면 성립
function hasJogaekSal(pillars) {
  const y = pillars[0];
  if (!y || y.branch < 0) return false;
  const target = (y.branch - 2 + 12) % 12;
  return pillars.some(p => p !== y && p.branch === target);
}
// 탕화살: 일지가 인/오/축일 때 각각 정해진 짝 지지가 있으면 성립(사이트 원문 3가지 조합)
const TANGHWA_PARTNER = { 2: [5, 8], 6: [4, 6, 1], 1: [6, 10, 7] }; // 인→사신 오→진오축 축→오술미
function hasTanghwaSal(pillars) {
  const d = pillars[2];
  if (!d || d.branch < 0) return false;
  const partners = TANGHWA_PARTNER[d.branch];
  if (!partners) return false;
  return pillars.some(p => partners.includes(p.branch));
}
// 격각살: 일지-시지가 두 칸 차이(어느 방향이든)면 성립
function hasGyeokgakSal(pillars) {
  const d = pillars[2], h = pillars[3];
  if (!d || !h || d.branch < 0 || h.branch < 0) return false;
  const diff = (h.branch - d.branch + 12) % 12;
  return diff === 2 || diff === 10;
}
// 삼기귀인: 년→월→일 또는 월→일→시 천간이 순서대로 아래 세 조합 중 하나와 일치하면 성립
const SAMGI_SEQUENCES = [[0, 4, 6], [7, 8, 9], [1, 2, 3]]; // 천상(갑무경) 인중(신임계) 지하(을병정)
function hasSamgiGwiin(pillars) {
  const stems = pillars.map(p => p.stem);
  const seqA = [stems[0], stems[1], stems[2]];
  const seqB = [stems[1], stems[2], stems[3]];
  return SAMGI_SEQUENCES.some(seq => seq.every((s, i) => seqA[i] === s) || seq.every((s, i) => seqB[i] === s));
}
// 음양차착살: 일주 또는 시주가 아래 12개 조합 중 하나면 성립
const EUMYANG_CHACHAK_SAL = [[7, 3], [7, 9], [3, 7], [3, 1], [9, 5], [9, 11], [2, 6], [2, 0], [8, 4], [8, 10], [4, 8], [4, 2]];
function hasEumyangChachakSal(pillars) {
  const d = pillars[2], h = pillars[3];
  return matchesStemBranchSet(d.stem, d.branch, EUMYANG_CHACHAK_SAL) || (h && matchesStemBranchSet(h.stem, h.branch, EUMYANG_CHACHAK_SAL));
}

function computeExtraGwiin(pillars) {
  const [y, m, d] = pillars; // 년,월,일 (시주는 신살 판정 기준점으로 안 씀)
  const dStemIdx = d.stem, mBranchIdx = m.branch, yBranchIdx = y.branch;
  const result = {};
  if (dStemIdx >= 0) {
    result.taegeuk = TAEGEUK_GWIIN[dStemIdx] || [];
    result.mungok = MUNGOK_GWIIN[dStemIdx];
    result.amrok = AMROK_GWIIN[dStemIdx];
    result.hakdang = SIBIUNSEONG_START[dStemIdx]; // 학당귀인 = 일간의 12운성 장생지, 계산식 재사용
    result.munchang = MUNCHANG_GWIIN[dStemIdx];
    result.cheonju = CHEONJU_GWIIN[dStemIdx];
    const controlOh = CONTROLLING_OH[CG_OH[dStemIdx]];
    result.gwangwi = SIBIUNSEONG_START[OH_YANG_STEM_IDX[controlOh]];
    result.cheongwan = CHEONGWAN_GWIIN[dStemIdx];
    result.hongyeom = HONGYEOM_SAL[dStemIdx];
    result.yuha = YUHA_SAL[dStemIdx];
    result.biin = BIIN_SAL[dStemIdx];
    result.nakjeong = NAKJEONG_SAL[dStemIdx];
  }
  if (mBranchIdx >= 0 && dStemIdx >= 0) {
    const group = SAMHAP_GROUP[mBranchIdx];
    result.woldeok = group && WOLDEOK_GWIIN_TARGET[group] === dStemIdx;
  }
  if (mBranchIdx >= 0) result.cheonui = (mBranchIdx - 1 + 12) % 12; // 천의성 = 월지 바로 앞 지지
  if (yBranchIdx >= 0) {
    const bg = BANGHAP_GROUP[yBranchIdx];
    result.gwasuk = bg ? GWASUK_TARGET[bg] : null;
  }
  return result;
}
function isGoranSal(stemIdx, branchIdx) {
  return GORAN_SAL.some(([s, b]) => s === stemIdx && b === branchIdx);
}
function isHyeonchimSal(stemIdx, branchIdx) {
  return HYEONCHIM_STEMS.includes(stemIdx) || HYEONCHIM_BRANCHES.includes(branchIdx);
}
function isGoegangSal(stemIdx, branchIdx) {
  return GOEGANG_SAL.some(([s, b]) => s === stemIdx && b === branchIdx);
}
function isBaekhoSal(stemIdx, branchIdx) {
  return BAEKHO_SAL.some(([s, b]) => s === stemIdx && b === branchIdx);
}
function isCheonmunseong(branchIdx) {
  return branchIdx === 10 || branchIdx === 11; // 戌 또는 亥
}
const GWIIN_MEANING = {
  천을귀인: '사주에서 가장 널리 알려진 길신이에요. 어려운 일이 생겨도 뜻밖의 도움을 받거나 위기를 잘 넘기는 복이 있다고 봐요.',
  태극귀인: '하늘의 이치를 깨닫는 길신이에요. 위기 속에서도 중심을 잃지 않고 지혜롭게 해결책을 찾아내는 복이 있다고 봐요.',
  문곡귀인: '학문과 문서 운을 돕는 길신이에요. 공부나 시험, 글 쓰는 일에서 좋은 결과를 얻기 쉬운 기운이에요.',
  암록: '드러나지 않게 도와주는 숨은 복이에요. 어려울 때 뜻밖의 곳에서 도움의 손길이 나타나는 기운이에요.',
  학당귀인: '배움과 재능을 꽃피우는 길신이에요. 총명하고 학구열이 높아 공부로 인정받기 쉬운 기운이에요.',
  월덕귀인: '한 달의 기운을 다스리는 길신이에요. 마음이 너그럽고 덕이 있어 주변에서 신망을 얻기 쉬운 기운이에요.',
  고란살: '외로움을 상징하는 살이에요. 배우자운에서 다소 외로움을 느낄 수 있지만, 그만큼 자립심과 독립심이 강한 편이에요.',
  현침살: '바늘처럼 예리한 기운이에요. 손끝이 야무지고 판단력이 예리해 의료·기술·전문직에서 강점을 보이는 편이에요.',
  문창귀인: '글재주와 표현력을 돕는 길신이에요. 문서·기획·창작 쪽에서 두각을 나타내기 쉬운 기운이에요.',
  천주귀인: '먹을 복을 상징하는 길신이에요. 평생 의식주 걱정이 적고, 베풀어도 다시 채워지는 복이 있다고 봐요.',
  관귀학관: '직장운과 시험운을 돕는 길신이에요. 자격증이나 승진, 공적인 인정을 받기에 유리한 기운이에요.',
  천의성: '치유와 돌봄의 기운이에요. 의료·상담·힐링 분야에 잘 맞고, 아픈 사람을 잘 챙기는 손을 가졌다고 봐요.',
  과숙살: '혼자만의 시간을 편하게 여기는 기운이에요. 독립심이 강한 대신, 의식적으로 관계를 챙기는 노력이 도움이 돼요.',
  천문성: '영적 감각과 직관이 발달한 기운이에요. 종교·철학·심리 등 눈에 안 보이는 걸 다루는 분야에 강점이 있어요.',
  괴강살: '강렬한 카리스마의 기운이에요. 극과 극을 오가는 스케일이 있어서, 잘 쓰면 큰 성취를 이루지만 고집도 세질 수 있어요.',
  백호대살: '한번 힘을 쓰면 확실하게 밀어붙이는 기운이에요. 결단력은 강하지만, 급한 성미는 다스리는 연습이 필요해요.',
  천관귀인: '공적인 인정과 명예를 돕는 길신이에요. 조직 안에서 신뢰받고 정당하게 인정받는 자리로 나아가기 쉬운 기운이에요.',
  삼기귀인: '타고난 재능과 배움에 대한 갈증이 남다른 길신이에요. 한 분야를 깊이 파고들어 전문성으로 인정받기 쉬운 기운이에요.',
  귀문관살: '남다른 몰입력과 독특한 감각을 가진 기운이에요. 한 가지에 깊이 빠져드는 힘이 있어서, 예민한 만큼 스스로를 다독이는 여유도 함께 챙기면 좋아요.',
  효신살: '일찍부터 스스로를 챙기며 독립적으로 자라는 기운이에요. 기댈 곳을 기다리기보다 직접 해결하는 자립심이 강한 편이에요.',
  의처의부살: '관계에 마음을 깊이 쏟는 기운이에요. 그만큼 애정이 크다는 뜻이니, 믿음을 서로 확인하는 대화를 편하게 나누면 관계가 더 단단해져요.',
  조객살: '가족·친지와의 정서적 연결이 깊은 기운이에요. 곁에 있는 사람들의 안녕을 세심하게 챙기는 편이에요.',
  탕화살: '뜨거운 것을 두려워하지 않는 대담한 기운이에요. 위기 상황에서 물러서지 않는 뚝심이 있고, 의료·화학·소방 등 위험을 다루는 분야에서 강점을 보이는 편이에요.',
  격각살: '익숙한 자리를 벗어나 새로운 환경에 잘 적응하는 기운이에요. 낯선 곳에서도 스스로 자리를 잡는 힘이 있는 편이에요.',
  혈인살: '몸과 마음을 세심하게 돌보는 감각이 발달한 기운이에요. 건강 관리에 미리 신경 쓰는 편이라 큰 탈 없이 잘 관리해가는 타입이에요.',
  삼형살: '부딪히는 상황에서도 물러서지 않는 강한 승부근성의 기운이에요. 자기 주장이 뚜렷하고, 원칙과 관련된 일(법·의료 등)에서 두각을 나타내는 편이에요.',
  천라지망살: '스스로에게 엄격한 규율을 세우는 기운이에요. 법·질서·안전과 관련된 일에서 신뢰받는 역할을 맡기 쉬운 편이에요.',
  급각살: '몸을 다치지 않게 미리 조심하는 신중한 기운이에요. 급하게 움직이기보다 안전을 먼저 살피는 편이에요.',
  비인살: '관심사가 빠르게 바뀌는 만큼 새로운 자극에 민첩하게 반응하는 기운이에요. 하나에 오래 머무르기보다 다양한 시도를 즐기는 편이에요.',
  음양차착살: '감정 표현이 풍부하고 매력적인 기운이에요. 마음이 움직이는 대로 솔직한 편이라, 관계에서 신뢰를 쌓는 대화가 중요한 시기예요.',
  홍염살: '사람들 시선을 끄는 매력이 넘치는 길성이에요. 눈에 띄는 자리, 사람 앞에 서는 일에서 특히 빛을 발하는 편이에요.',
  유하살: '여러 가지를 두루 잘하는 팔방미인 기운이에요. 한 곳에 얽매이기보다 다양한 경험을 쌓을 때 더 빛나는 편이에요.',
  구추방해살: '감정이 크고 뚜렷한 기운이에요. 좋고 싫음이 분명한 편이라, 스스로의 감정을 다스리는 여유를 챙기면 도움이 돼요.',
  공망살: '얽매이지 않고 훌훌 털어내는 여유의 기운이에요. 결과에 집착하기보다 과정 자체를 즐기는 편이에요.',
  낙정관살: '위험한 상황을 미리 알아채는 감각이 발달한 기운이에요. 깊은 곳, 낯선 환경에서 특히 조심하는 편이에요.',
  단교관살: '몸을 아끼고 무리하지 않는 기운이에요. 관절이나 이동 관련해서 평소 관리에 신경 쓰면 도움이 돼요.',
  욕망살: '원하는 것을 향해 거침없이 나아가는 기운이에요. 주도적이고 활동적이라, 앞장서는 자리에서 힘을 발휘하는 편이에요.',
  옥여살: '사람들에게 사랑받고 잘 이끌려지는 복 있는 기운이에요. 원만한 성격 덕분에 좋은 기회가 자연스럽게 따라오는 편이에요.',
  구인살: '말솜씨가 좋고 하고 싶은 말을 잘 표현하는 기운이에요. 다만 말이 앞서기 쉬우니, 한 번 더 생각하고 이야기하는 습관이 도움이 돼요.',
  광음살: '강렬한 존재감으로 시선을 끄는 기운이에요. 대중 앞에 서는 자리, 눈에 띄는 역할에서 발탁되기 쉬운 편이에요.',
  천공살: '마음을 담백하게 비워내는 기운이에요. 집착하지 않고 흘려보내는 편이라, 관계에서는 마음을 표현하는 노력을 더하면 좋아요.',
  지지충: '부딪히며 변화를 만들어내는 역동적인 기운이에요. 안정보다 자극이 있을 때 오히려 힘이 나는 편이에요.',
};

// ═══ 공망(空亡) — 60갑자를 10개씩 묶은 "순(旬)" 안에서 짝이 안 맞는 지지 2개. 계산식으로 유도 가능한
// 부분이라 표 없이 구한다(위 예시의 [年]戌亥·[日]辰巳 둘 다 정확히 재현됨). ═══
function getGongmang(stemIdx, branchIdx) {
  if (stemIdx < 0 || branchIdx < 0) return [];
  const b0 = (branchIdx - stemIdx + 12) % 12; // 이 순(旬)에서 갑(甲)과 짝지어지는 지지
  return [(b0 + 10) % 12, (b0 + 11) % 12];
}

// 만세력 계산 — 예전엔 자체 JS 공식(고정 달력월→지지 매핑, 고정 기준일 REF)을 썼는데, 실제 검증 결과
// (1996-11-07 20:17 테스트 케이스) 월주가 절기(입동)를 반영하지 않아 통째로 한 달씩 밀렸고, 일주도
// 기준일이 24일 어긋나 있었다. 지금은 절기·60갑자를 정확히 계산하는 lunar-javascript(전역 Solar/Lunar/
// EightChar, gwansang-saju.html에서 CDN으로 로드)에 위임하고, 결과 한자를 CHEONGAN/JIJI 인덱스로
// 변환해서 기존 렌더링 코드(renderPillarsTable 등)는 그대로 재사용한다.
function computePillars(dateVal, hourVal) {
  const [year, month, day] = dateVal.split('-').map(Number);
  const hv = parseInt(hourVal);
  // 시간을 모르면(-1) 정오로 대입 — 시주만 비워두고 년/월/일주는 그대로 계산(절기 경계에 걸치는 극히
  // 드문 자정 근처 출생이 아닌 한 결과에 영향 없음).
  const solar = Solar.fromYmdHms(year, month, day, hv >= 0 ? hv : 12, 0, 0);
  const ec = solar.getLunar().getEightChar();
  const gi = (ganChar, ziChar) => ({ stem: CHEONGAN.indexOf(ganChar), branch: JIJI.indexOf(ziChar) });
  const y = gi(ec.getYearGan(), ec.getYearZhi());
  const m = gi(ec.getMonthGan(), ec.getMonthZhi());
  const d = gi(ec.getDayGan(), ec.getDayZhi());
  const h = hv >= 0 ? gi(ec.getTimeGan(), ec.getTimeZhi()) : { stem: -1, branch: -1 };
  const hourPillar = { label:'시주', stem:h.stem, branch:h.branch };
  // ⚠️ 설계 원칙(scratch/siju-estimate-notes.md) — 시간 미상이면 원국 표시에서만 쓸 "자시(00:00) 가정"
  // 시주를 estStem/estBranch에 별도로 얹는다. stem/branch 본체는 그대로 -1(미상)로 유지해야
  // hasHour·십성·신강신약·용신·AI 총평·관상×사주 융합 가중치가 계속 시간 미상 경로를 타게 된다 —
  // 하위 로직이 이 추정값을 "진짜 시간을 아는 것"으로 착각해 자동 반영하면 안 된다.
  if (hv < 0) {
    const estSolar = Solar.fromYmdHms(year, month, day, 0, 0, 0);
    const estEc = estSolar.getLunar().getEightChar();
    const est = gi(estEc.getTimeGan(), estEc.getTimeZhi());
    hourPillar.estStem = est.stem;
    hourPillar.estBranch = est.branch;
  }
  return [
    { label:'년주', stem:y.stem, branch:y.branch },
    { label:'월주', stem:m.stem, branch:m.branch },
    { label:'일주', stem:d.stem, branch:d.branch },
    hourPillar,
  ];
}

// ═══ 대운(大運) — lunar-javascript에 이미 내장된 getYun/getDaYun을 그대로 사용 ═══
// 순행/역행 판정, 대운수(첫 대운이 시작하는 나이) 계산, 이후 각 대운의 60갑자까지 전부 라이브러리가
// 계산해준다. 손으로 공식을 유도하지 않고 그대로 가져다 쓰는 이유: 2026-08-13에 포스텔러 만세력
// 실측 예시(최정원, 1996-11-07 20:12, 여자)로 교차검증해서 8자·역행 여부·대운 9개 60갑자가 전부
// 정확히 일치함을 확인했다(무술·정유·병신·을미·갑오·계사·임진·신묘·경인).
function computeDaeun(dateVal, hourVal, genderVal) {
  const [year, month, day] = dateVal.split('-').map(Number);
  const hv = parseInt(hourVal);
  const solar = Solar.fromYmdHms(year, month, day, hv >= 0 ? hv : 12, 0, 0);
  const ec = solar.getLunar().getEightChar();
  const genderNum = genderVal === '여' ? 0 : 1; // 라이브러리 규약: 1=남성, 0=여성
  const yun = ec.getYun(genderNum);
  // index=0은 "대운 이전" 자리표시자(빈 간지)라 제외하고 실제 대운 9개만 취한다.
  const list = yun.getDaYun(9).filter(d => d.getIndex() >= 1).map(d => {
    const gz = d.getGanZhi();
    const stemIdx = CHEONGAN.indexOf(gz[0]);
    const branchIdx = JIJI.indexOf(gz[1]);
    return { startAge: d.getStartAge(), endAge: d.getEndAge(), ganZhi: gz, stemIdx, branchIdx };
  });
  return { isForward: yun.isForward(), list };
}

// 대운 표 렌더링 — renderPillarsTable과 같은 pillar-col 스타일을 재사용해서 시각적으로 통일감 있게.
function renderDaeunTable(daeun, elId) {
  const el = document.getElementById(elId);
  if (!el) return;
  if (!daeun || !daeun.list.length) { el.innerHTML = ''; el.classList.add('hidden'); return; }
  const rows = daeun.list.map(d => {
    const ss = d.stemIdx>=0?CHEONGAN[d.stemIdx]:'?', bs = d.branchIdx>=0?JIJI[d.branchIdx]:'?';
    const sk = d.stemIdx>=0?CG_KO[d.stemIdx]:'?', bk = d.branchIdx>=0?JJ_KO[d.branchIdx]:'?';
    const stemOh = d.stemIdx>=0 ? CG_OH[d.stemIdx] : null;
    const branchOh = d.branchIdx>=0 ? JJ_OH[d.branchIdx] : null;
    return `<div class="pillar-col"><div class="pillar-label">${d.startAge}세~</div><div class="pillar-stem" style="${ohaengCellStyle(stemOh)}">${ss}<div class="pillar-hanja">${sk}</div></div><div class="pillar-branch" style="${ohaengCellStyle(branchOh)}">${bs}<div class="pillar-hanja">${bk}</div></div></div>`;
  }).join('');
  el.innerHTML = `<div style="font-size:11px;color:var(--text2);margin-bottom:6px;">${daeun.isForward ? '순행' : '역행'} · 첫 대운 시작 나이 ${daeun.list[0].startAge}세</div><div class="pillars-table">${rows}</div>`;
  el.classList.remove('hidden');
}

// 생년월일 → 만 나이 — 대운x삼정 타임라인에서 "지금이 어느 대운인지" 찾는 데 쓴다.
function calcAge(birthDateStr) {
  const today = new Date();
  const [y, m, d] = birthDateStr.split('-').map(Number);
  let age = today.getFullYear() - y;
  if (today.getMonth() + 1 < m || (today.getMonth() + 1 === m && today.getDate() < d)) age--;
  return age;
}

// 대운x삼정 인생 타임라인(통합분석 Zone3) — 대운 지지의 12운성을 일간과 비교해 "이 시기가 어떤
// 기운인지" 서사를 만든다(갑자 한자 나열 대신). 삼정(상정/중정/하정)은 별도 그래프 대신 나이 구간
// 경계(초년≤30세·중년31~50세·말년51세~)로 목록을 나눠 구간 제목 안에 녹인다.
const GOOD_UNSEONG = ['장생', '관대', '건록', '제왕'];
function lifelineStage(age) { return age <= 29 ? 'early' : age <= 59 ? 'mid' : 'late'; }
const LIFELINE_STAGE_LABEL = { early: '상정 · 초년', mid: '중정 · 중년', late: '하정 · 말년' };
function renderLifeline(nowElId, listElId, daeun, dayStemIdx, samjeong, age) {
  const listEl = document.getElementById(listElId);
  const nowEl = document.getElementById(nowElId);
  if (!listEl) return;
  if (!daeun || !daeun.list.length || !samjeong) {
    listEl.innerHTML = '';
    if (nowEl) nowEl.innerHTML = '';
    return;
  }
  const pctByStage = { early: samjeong.sangjeong, mid: samjeong.jungjeong, late: samjeong.hajeong };
  let lastStage = null;
  let current = null;
  const html = daeun.list.map((d, i) => {
    const stage = lifelineStage(d.startAge);
    const unseong = d.branchIdx >= 0 ? get12Unseong(dayStemIdx, d.branchIdx) : null;
    const isNow = age >= d.startAge && (i === daeun.list.length - 1 || age < daeun.list[i + 1].startAge);
    if (isNow) current = Object.assign({ unseong }, d);
    const isGood = unseong && GOOD_UNSEONG.includes(unseong);
    // 첫 문장(비유적 표현)은 건너뛰고 두 번째 문장(실질적 의미)만 짧게 붙인다.
    const meaningFull = unseong ? (SIBIUNSEONG_MEANING[unseong] || '') : '';
    const meaning = meaningFull.split('. ')[1] || meaningFull;
    let groupHead = '';
    if (stage !== lastStage) {
      groupHead = `<div class="lifeline-group-head ${stage}"><span class="lifeline-group-name">${LIFELINE_STAGE_LABEL[stage]}</span><span class="lifeline-group-pct">${pctByStage[stage]}%</span></div>`;
      lastStage = stage;
    }
    const tags = (isNow ? '<span class="lifeline-now-tag">지금</span>' : '') + (isGood ? '<span class="lifeline-good-tag">⭐ 좋은 시기</span>' : '');
    return `${groupHead}<div class="lifeline-item ${stage}${isNow ? ' is-now' : ''}"><span class="lifeline-dot"></span><span class="lifeline-unseong"><span class="age">${d.startAge}세 ~ ${d.endAge}세</span>${unseong || ''}${meaning ? ' · ' + meaning : ''}</span>${tags}</div>`;
  }).join('');
  listEl.innerHTML = html;
  if (nowEl) {
    nowEl.innerHTML = current
      ? `지금 만 ${age}세 · 이번 대운(${current.startAge}세~${current.endAge}세)은 <b>${current.unseong}</b> 시기예요.`
      : '';
  }
}

// 다른 만세력 사이트들의 관례(시주-일주-월주-년주, 오른쪽에서 왼쪽으로 시간이 흐르는 배치)에 맞춰
// 표시 순서만 뒤집는다 — pillars 배열 자체(년→월→일→시)는 computeOhaeng 등 다른 곳에서 계속 그 순서로
// 쓰이므로 건드리지 않고, 렌더링 직전에만 [...].reverse()로 뒤집는다.
// 오행 분포 막대(oh-목-bar 등, 아래 renderOhaengBars)와 같은 팔레트를 그대로 재사용 — 사주 원국 표의
// 천간·지지 칸 색이 오행 분포와 같은 색으로 매칭되어야 한 눈에 "이 글자가 무슨 오행인지" 알 수 있다는
// 사용자 피드백(다른 만세력 앱들은 이렇게 색으로 오행을 바로 보여준다는 점 참고).
const OHAENG_COLOR = {
  목: { base:'#4ade80', dark:'#22c55e' },
  화: { base:'#f87171', dark:'#ef4444' },
  토: { base:'#fbbf24', dark:'#f59e0b' },
  // ⚠️ 버그 수정(2026-08-21 사용자 리포트): 금(金)은 배경이 워낙 옅은 회백색이라, 글자색까지 같은
  // base(#e2e8f0)를 쓰면 배경과 거의 구분이 안 돼 글자가 안 보이는 것처럼 보였다. 배경 그라디언트는
  // 그대로 두고 글자색만 실제로 읽히는 톤(#838f9f)으로 따로 지정한다.
  금: { base:'#e2e8f0', dark:'#cbd5e1', text:'#838f9f' },
  수: { base:'#60a5fa', dark:'#3b82f6' },
};
function ohaengCellStyle(oh, dashed) {
  const c = OHAENG_COLOR[oh];
  if (!c) return dashed ? 'border-style:dashed;' : '';
  return `background:linear-gradient(135deg, ${c.base}55, ${c.dark}22);border:1px ${dashed ? 'dashed' : 'solid'} ${c.dark}99;color:${c.text || c.base};`;
}
// 시주/일주/월주/연주 한 기둥의 기본 셀(라벨+천간+지지, 오행 색상) — 근거성 뱃지(12운성·신살·귀인) 없이
// 순수 원국만 보여줄 때(renderGunghamManseryeok) renderPillarsTable과 공유한다.
// opts.allowEstimate가 true이고 p.stem이 미상(-1)인데 p.estStem(자시 가정값, computePillars 참고)이
// 있으면 점선 테두리 + "추정" 배지로 표시한다 — 호출부가 명시적으로 opt-in해야 하므로, 이 옵션을 안
// 넘기는 호출은 그대로 "?"만 보여주는 기존 동작을 유지한다.
function buildPillarColBase(p, opts) {
  const isEst = !!(opts && opts.allowEstimate) && p.stem < 0 && p.estStem >= 0 && p.estBranch >= 0;
  const stemVal = isEst ? p.estStem : p.stem;
  const branchVal = isEst ? p.estBranch : p.branch;
  const ss = stemVal>=0?CHEONGAN[stemVal]:'?', bs = branchVal>=0?JIJI[branchVal]:'?';
  const sk = stemVal>=0?CG_KO[stemVal]:'?', bk = branchVal>=0?JJ_KO[branchVal]:'?';
  const stemOh = stemVal>=0 ? CG_OH[stemVal] : null;
  const branchOh = branchVal>=0 ? JJ_OH[branchVal] : null;
  // 12운성·신살·귀인 뱃지는 붙이지 않는다(scratch/siju-estimate-notes.md의 "추정 위의 추정 금지" 원칙) —
  // p.branch 본체가 여전히 -1이라 renderPillarsTable의 unseong/sinsal/gwiin 계산은 자동으로 건너뛴다.
  // "자시(00:00) 가정 계산" 캡션은 뺐다(2026-08-26 사용자 요청) — "추정" 배지 하나로 충분하고, 궁합보기
  // 8칸 비교표처럼 칸 폭이 좁은 곳에서도 그대로 재사용할 수 있어야 해서.
  const estBadge = isEst ? `<div class="est-tag">추정</div>` : '';
  return `<div class="pillar-label">${p.label}</div><div class="pillar-stem" style="${ohaengCellStyle(stemOh, isEst)}">${ss}<div class="pillar-hanja">${sk}</div></div><div class="pillar-branch" style="${ohaengCellStyle(branchOh, isEst)}">${bs}<div class="pillar-hanja">${bk}</div></div>${estBadge}`;
}

function renderPillarsTable(pillars, elId) {
  const [yP, mP, dP] = pillars; // pillars는 항상 [년,월,일,시] 고정 순서
  const dayStemIdx = dP ? dP.stem : -1;
  const yBranch = yP ? yP.branch : -1, mBranch = mP ? mP.branch : -1, dBranch = dP ? dP.branch : -1;
  const extra = computeExtraGwiin(pillars);
  document.getElementById(elId).innerHTML = [...pillars].reverse().map(p => {
    const isEst = p.stem < 0 && p.estStem >= 0 && p.estBranch >= 0;
    const base = buildPillarColBase(p, { allowEstimate: true });
    const unseong = p.branch>=0 ? get12Unseong(dayStemIdx, p.branch) : null;
    const unseongLine = unseong ? `<div class="pillar-unseong">${unseong}</div>` : '';

    const badges = [];
    if (p.branch >= 0 && isCheonEulGwiin(dayStemIdx, p.branch)) badges.push('천을귀인');
    if (p.branch >= 0 && extra.taegeuk && extra.taegeuk.includes(p.branch)) badges.push('태극귀인');
    if (p.branch >= 0 && p.branch === extra.mungok) badges.push('문곡귀인');
    if (p.branch >= 0 && p.branch === extra.amrok) badges.push('암록');
    if (p.branch >= 0 && p.branch === extra.hakdang) badges.push('학당귀인');
    if (p.label === '일주' && extra.woldeok) badges.push('월덕귀인');
    if (isGoranSal(p.stem, p.branch)) badges.push('고란살');
    if (isHyeonchimSal(p.stem, p.branch)) badges.push('현침살');
    if (p.branch >= 0 && p.branch === extra.munchang) badges.push('문창귀인');
    if (p.branch >= 0 && p.branch === extra.cheonju) badges.push('천주귀인');
    if (p.branch >= 0 && p.branch === extra.gwangwi) badges.push('관귀학관');
    if (p.branch >= 0 && p.branch === extra.cheonui) badges.push('천의성');
    if (p.branch >= 0 && p.branch === extra.gwasuk) badges.push('과숙살');
    if (p.branch >= 0 && isCheonmunseong(p.branch)) badges.push('천문성');
    if (isGoegangSal(p.stem, p.branch)) badges.push('괴강살');
    if (isBaekhoSal(p.stem, p.branch)) badges.push('백호대살');
    if (p.branch >= 0 && p.branch === extra.cheongwan) badges.push('천관귀인');
    if (p.branch >= 0 && p.branch === extra.biin) badges.push('비인살');
    if (p.branch >= 0 && p.branch === extra.hongyeom) badges.push('홍염살');
    if (p.branch >= 0 && p.branch === extra.yuha) badges.push('유하살');
    if (p.branch >= 0 && p.branch === extra.nakjeong) badges.push('낙정관살');
    if (isHyosinSal(p.stem, p.branch)) badges.push('효신살');
    if (isEuicheoSal(p.stem, p.branch)) badges.push('의처의부살');
    if (isYokmangSal(p.stem, p.branch)) badges.push('욕망살');
    if (isOkyeoSal(p.stem, p.branch)) badges.push('옥여살');
    if (isGuinSal(p.stem, p.branch)) badges.push('구인살');
    if (isGwangeumSal(p.stem, p.branch)) badges.push('광음살');
    if (isGuchuBanghaeSal(p.stem, p.branch)) badges.push('구추방해살');
    if (isCheongongSal(p.stem, p.branch)) badges.push('천공살');
    const gwiinBadges = badges.map(b => `<div class="pillar-gwiin">★ ${b}</div>`).join('');

    const sinsalList = get12SinsalForBranch(p.branch, yBranch, mBranch, dBranch);
    const sinsalBadges = sinsalList.map(s => `<div class="pillar-sinsal">${s}</div>`).join('');

    return `<div class="pillar-col${isEst ? ' is-est' : ''}">${base}${unseongLine}${sinsalBadges}${gwiinBadges}</div>`;
  }).join('');
}

// 나/상대방 만세력을 한 화면에 — 이름·생년월일시 헤더 + 8칸(시주~연주 ×2) 원국표(사용자 요청
// 2026-08-19). 근거성 뱃지(12운성·신살·귀인)는 여기서 노출하지 않는다 — buildPillarColBase만 사용.
// 시주가 미상이면 통합분석과 동일하게 자시 가정 추정값을 점선 테두리 + "추정" 배지로 보여준다
// (2026-08-26 사용자 요청) — 8칸 비교표라 폭이 좁으므로 캡션 문구는 붙이지 않는다.
function renderGunghamManseryeok(nameA, dateA, hourA, pillarsA, nameB, dateB, hourB, pillarsB) {
  const el = document.getElementById('ggManseryeokCompare');
  if (!el) return;
  const dstr = d => String(d || '').replace(/-/g, '.');
  const hourLabel = h => (window.Profile && Profile.hourLabel) ? Profile.hourLabel(h) : '';
  const colHTML = p => {
    const isEst = p.stem < 0 && p.estStem >= 0 && p.estBranch >= 0;
    return `<div class="pillar-col${isEst ? ' is-est' : ''}">${buildPillarColBase(p, { allowEstimate: true })}</div>`;
  };
  const colsA = [...pillarsA].reverse().map(colHTML).join('');
  const colsB = [...pillarsB].reverse().map(colHTML).join('');
  el.innerHTML = `
    <div class="gg-manse-head">
      <div class="gg-manse-name">${cmbEsc(nameA)}</div>
      <div class="gg-manse-heart">❤️</div>
      <div class="gg-manse-name">${cmbEsc(nameB)}</div>
      <div class="gg-manse-sub">${dstr(dateA)} · ${hourLabel(hourA)}<span class="gg-manse-cal">(양력)</span></div>
      <div></div>
      <div class="gg-manse-sub">${dstr(dateB)} · ${hourLabel(hourB)}<span class="gg-manse-cal">(양력)</span></div>
    </div>
    <div class="pillars-table pillars-table-compare">${colsA}${colsB}</div>`;
}

// 이 사람 사주에 실제로 등장하는 12운성 단계 + 천을귀인 여부만 골라 설명을 붙인다(12개 전부 나열하지 않음).
function renderUnseongLegend(pillars, elId) {
  const el = document.getElementById(elId);
  if (!el) return;
  const [yP, mP, dP] = pillars;
  const dayStemIdx = dP ? dP.stem : -1;
  const yBranch = yP ? yP.branch : -1, mBranch = mP ? mP.branch : -1, dBranch = dP ? dP.branch : -1;

  const seenUnseong = new Set();
  const unseongRows = [];
  pillars.forEach(p => {
    if (p.branch < 0) return;
    const u = get12Unseong(dayStemIdx, p.branch);
    if (u && !seenUnseong.has(u)) { seenUnseong.add(u); unseongRows.push(u); }
  });

  const seenSinsal = new Set();
  pillars.forEach(p => { get12SinsalForBranch(p.branch, yBranch, mBranch, dBranch).forEach(s => seenSinsal.add(s)); });

  const extra = computeExtraGwiin(pillars);
  const gwiinNames = new Set();
  if (pillars.some(p => p.branch >= 0 && isCheonEulGwiin(dayStemIdx, p.branch))) gwiinNames.add('천을귀인');
  if (pillars.some(p => p.branch >= 0 && extra.taegeuk && extra.taegeuk.includes(p.branch))) gwiinNames.add('태극귀인');
  if (pillars.some(p => p.branch === extra.mungok)) gwiinNames.add('문곡귀인');
  if (pillars.some(p => p.branch === extra.amrok)) gwiinNames.add('암록');
  if (pillars.some(p => p.branch === extra.hakdang)) gwiinNames.add('학당귀인');
  if (extra.woldeok) gwiinNames.add('월덕귀인');
  if (pillars.some(p => isGoranSal(p.stem, p.branch))) gwiinNames.add('고란살');
  if (pillars.some(p => isHyeonchimSal(p.stem, p.branch))) gwiinNames.add('현침살');
  if (pillars.some(p => p.branch === extra.munchang)) gwiinNames.add('문창귀인');
  if (pillars.some(p => p.branch === extra.cheonju)) gwiinNames.add('천주귀인');
  if (pillars.some(p => p.branch === extra.gwangwi)) gwiinNames.add('관귀학관');
  if (pillars.some(p => p.branch === extra.cheonui)) gwiinNames.add('천의성');
  if (pillars.some(p => p.branch === extra.gwasuk)) gwiinNames.add('과숙살');
  if (pillars.some(p => p.branch >= 0 && isCheonmunseong(p.branch))) gwiinNames.add('천문성');
  if (pillars.some(p => isGoegangSal(p.stem, p.branch))) gwiinNames.add('괴강살');
  if (pillars.some(p => isBaekhoSal(p.stem, p.branch))) gwiinNames.add('백호대살');
  if (pillars.some(p => p.branch === extra.cheongwan)) gwiinNames.add('천관귀인');
  if (hasSamgiGwiin(pillars)) gwiinNames.add('삼기귀인');
  if (hasBranchPair(pillars, GWIMUNGWAN_PAIRS)) gwiinNames.add('귀문관살');
  if (pillars.some(p => isHyosinSal(p.stem, p.branch))) gwiinNames.add('효신살');
  if (pillars.some(p => isEuicheoSal(p.stem, p.branch))) gwiinNames.add('의처의부살');
  if (hasJogaekSal(pillars)) gwiinNames.add('조객살');
  if (hasTanghwaSal(pillars)) gwiinNames.add('탕화살');
  if (hasGyeokgakSal(pillars)) gwiinNames.add('격각살');
  if (hasBranchPair(pillars, HYEORIN_PAIRS)) gwiinNames.add('혈인살');
  if (hasSamhyeongSal(pillars)) gwiinNames.add('삼형살');
  if (hasCheonraJimangSal(pillars)) gwiinNames.add('천라지망살');
  if (hasGipgakSal(pillars)) gwiinNames.add('급각살');
  if (pillars.some(p => p.branch === extra.biin)) gwiinNames.add('비인살');
  if (hasEumyangChachakSal(pillars)) gwiinNames.add('음양차착살');
  if (pillars.some(p => p.branch === extra.hongyeom)) gwiinNames.add('홍염살');
  if (pillars.some(p => p.branch === extra.yuha)) gwiinNames.add('유하살');
  if (pillars.some(p => isGuchuBanghaeSal(p.stem, p.branch))) gwiinNames.add('구추방해살');
  if (dayStemIdx >= 0 && dBranch >= 0) {
    const gongmangPair = getGongmang(dayStemIdx, dBranch);
    if (pillars.some(p => p.branch >= 0 && p.branch !== dBranch && gongmangPair.includes(p.branch))) gwiinNames.add('공망살');
  }
  if (pillars.some(p => p.branch === extra.nakjeong)) gwiinNames.add('낙정관살');
  if (hasDangyoSal(pillars)) gwiinNames.add('단교관살');
  if (pillars.some(p => isYokmangSal(p.stem, p.branch))) gwiinNames.add('욕망살');
  if (pillars.some(p => isOkyeoSal(p.stem, p.branch))) gwiinNames.add('옥여살');
  if (pillars.some(p => isGuinSal(p.stem, p.branch))) gwiinNames.add('구인살');
  if (pillars.some(p => isGwangeumSal(p.stem, p.branch))) gwiinNames.add('광음살');
  if (pillars.some(p => isCheongongSal(p.stem, p.branch))) gwiinNames.add('천공살');
  if (hasBranchPair(pillars, CHUNG_PAIRS)) gwiinNames.add('지지충');

  if (!unseongRows.length && !seenSinsal.size && !gwiinNames.size) { el.innerHTML = ''; el.classList.add('hidden'); return; }

  const unseongSection = unseongRows.length
    ? `<div class="card-title" style="margin-top:16px;color:var(--purple-light);">🌱 십이운성으로 본 기운의 흐름</div>`
      + unseongRows.map(u => `<div class="part-tip"><strong style="color:var(--purple-light);">${u}</strong> — ${SIBIUNSEONG_MEANING[u]}</div>`).join('')
    : '';
  const sinsalSection = seenSinsal.size
    ? `<div class="card-title" style="margin-top:16px;color:var(--gold);">🔮 십이신살로 본 기운</div>`
      + Array.from(seenSinsal).map(s => `<div class="part-tip"><strong style="color:var(--gold);">${s}</strong> — ${SIBISINSAL_MEANING[s]}</div>`).join('')
    : '';
  const gwiinSection = gwiinNames.size
    ? `<div class="card-title" style="margin-top:16px;color:var(--gold-light);">✨ 이 사주에 있는 귀인·살</div>`
      + Array.from(gwiinNames).map(g => `<div class="part-tip">★ <strong style="color:var(--gold-light);">${g}</strong> — ${GWIIN_MEANING[g]}</div>`).join('')
    : '';

  el.innerHTML = unseongSection + sinsalSection + gwiinSection;
  el.classList.remove('hidden');
}

// renderUnseongLegend와 동일한 집계 로직을 데이터로만 뽑아낸 버전 — Gemini 프롬프트에 "이미 검증된 사실"로
// 그대로 넘기기 위한 것. Gemini에게 신살/귀인 계산 자체를 맡기면 근거 없이 지어낼 위험이 있어서,
// 계산은 항상 이 앱의 로컬 공식(2026-08-13 기준 실제 만세력 예시로 검증된 값)으로 하고 Gemini는
// 그 결과를 바탕으로 "해석"만 하게 한다.
function collectSajuInsightSummary(pillars) {
  const [yP, mP, dP] = pillars;
  const dayStemIdx = dP ? dP.stem : -1;
  const yBranch = yP ? yP.branch : -1, mBranch = mP ? mP.branch : -1, dBranch = dP ? dP.branch : -1;

  const unseongList = [];
  const seenUnseong = new Set();
  pillars.forEach(p => {
    if (p.branch < 0) return;
    const u = get12Unseong(dayStemIdx, p.branch);
    if (u && !seenUnseong.has(u)) { seenUnseong.add(u); unseongList.push({ name: u, meaning: SIBIUNSEONG_MEANING[u] }); }
  });

  const seenSinsal = new Set();
  pillars.forEach(p => { get12SinsalForBranch(p.branch, yBranch, mBranch, dBranch).forEach(s => seenSinsal.add(s)); });
  const sinsalList = Array.from(seenSinsal).map(s => ({ name: s, meaning: SIBISINSAL_MEANING[s] }));

  const extra = computeExtraGwiin(pillars);
  const gwiinNames = new Set();
  if (pillars.some(p => p.branch >= 0 && isCheonEulGwiin(dayStemIdx, p.branch))) gwiinNames.add('천을귀인');
  if (pillars.some(p => p.branch >= 0 && extra.taegeuk && extra.taegeuk.includes(p.branch))) gwiinNames.add('태극귀인');
  if (pillars.some(p => p.branch === extra.mungok)) gwiinNames.add('문곡귀인');
  if (pillars.some(p => p.branch === extra.amrok)) gwiinNames.add('암록');
  if (pillars.some(p => p.branch === extra.hakdang)) gwiinNames.add('학당귀인');
  if (extra.woldeok) gwiinNames.add('월덕귀인');
  if (pillars.some(p => isGoranSal(p.stem, p.branch))) gwiinNames.add('고란살');
  if (pillars.some(p => isHyeonchimSal(p.stem, p.branch))) gwiinNames.add('현침살');
  if (pillars.some(p => p.branch === extra.munchang)) gwiinNames.add('문창귀인');
  if (pillars.some(p => p.branch === extra.cheonju)) gwiinNames.add('천주귀인');
  if (pillars.some(p => p.branch === extra.gwangwi)) gwiinNames.add('관귀학관');
  if (pillars.some(p => p.branch === extra.cheonui)) gwiinNames.add('천의성');
  if (pillars.some(p => p.branch === extra.gwasuk)) gwiinNames.add('과숙살');
  if (pillars.some(p => p.branch >= 0 && isCheonmunseong(p.branch))) gwiinNames.add('천문성');
  if (pillars.some(p => isGoegangSal(p.stem, p.branch))) gwiinNames.add('괴강살');
  if (pillars.some(p => isBaekhoSal(p.stem, p.branch))) gwiinNames.add('백호대살');
  if (pillars.some(p => p.branch === extra.cheongwan)) gwiinNames.add('천관귀인');
  if (hasSamgiGwiin(pillars)) gwiinNames.add('삼기귀인');
  if (hasBranchPair(pillars, GWIMUNGWAN_PAIRS)) gwiinNames.add('귀문관살');
  if (pillars.some(p => isHyosinSal(p.stem, p.branch))) gwiinNames.add('효신살');
  if (pillars.some(p => isEuicheoSal(p.stem, p.branch))) gwiinNames.add('의처의부살');
  if (hasJogaekSal(pillars)) gwiinNames.add('조객살');
  if (hasTanghwaSal(pillars)) gwiinNames.add('탕화살');
  if (hasGyeokgakSal(pillars)) gwiinNames.add('격각살');
  if (hasBranchPair(pillars, HYEORIN_PAIRS)) gwiinNames.add('혈인살');
  if (hasSamhyeongSal(pillars)) gwiinNames.add('삼형살');
  if (hasCheonraJimangSal(pillars)) gwiinNames.add('천라지망살');
  if (hasGipgakSal(pillars)) gwiinNames.add('급각살');
  if (pillars.some(p => p.branch === extra.biin)) gwiinNames.add('비인살');
  if (hasEumyangChachakSal(pillars)) gwiinNames.add('음양차착살');
  if (pillars.some(p => p.branch === extra.hongyeom)) gwiinNames.add('홍염살');
  if (pillars.some(p => p.branch === extra.yuha)) gwiinNames.add('유하살');
  if (pillars.some(p => isGuchuBanghaeSal(p.stem, p.branch))) gwiinNames.add('구추방해살');
  if (dayStemIdx >= 0 && dBranch >= 0) {
    const gongmangPair = getGongmang(dayStemIdx, dBranch);
    if (pillars.some(p => p.branch >= 0 && p.branch !== dBranch && gongmangPair.includes(p.branch))) gwiinNames.add('공망살');
  }
  if (pillars.some(p => p.branch === extra.nakjeong)) gwiinNames.add('낙정관살');
  if (hasDangyoSal(pillars)) gwiinNames.add('단교관살');
  if (pillars.some(p => isYokmangSal(p.stem, p.branch))) gwiinNames.add('욕망살');
  if (pillars.some(p => isOkyeoSal(p.stem, p.branch))) gwiinNames.add('옥여살');
  if (pillars.some(p => isGuinSal(p.stem, p.branch))) gwiinNames.add('구인살');
  if (pillars.some(p => isGwangeumSal(p.stem, p.branch))) gwiinNames.add('광음살');
  if (pillars.some(p => isCheongongSal(p.stem, p.branch))) gwiinNames.add('천공살');
  if (hasBranchPair(pillars, CHUNG_PAIRS)) gwiinNames.add('지지충');
  const gwiinList = Array.from(gwiinNames).map(g => ({ name: g, meaning: GWIIN_MEANING[g] }));

  return { unseongList, sinsalList, gwiinList };
}

function computeOhaeng(pillars) {
  const c = {목:0,화:0,토:0,금:0,수:0};
  pillars.forEach(p => { if(p.stem>=0) c[CG_OH[p.stem]]++; if(p.branch>=0) c[JJ_OH[p.branch]]++; });
  return c;
}

function renderOhaengBars(count, elId) {
  const total = Object.values(count).reduce((a,b)=>a+b,0);
  const colors = {목:'oh-목-bar',화:'oh-화-bar',토:'oh-토-bar',금:'oh-금-bar',수:'oh-수-bar'};
  const emojis = {목:'🌳',화:'🔥',토:'🟫',금:'⚙️',수:'💧'};
  document.getElementById(elId).innerHTML = Object.entries(count).map(([k,v]) =>
    `<div class="ohaeng-row"><div class="ohaeng-name oh-${k}">${emojis[k]}${k}</div><div class="ohaeng-bar-bg"><div class="ohaeng-bar-fill ${colors[k]}" style="width:${total?(v/total*100):0}%"></div></div><div class="ohaeng-count">${v}</div></div>`
  ).join('');
}

// 오행 100% 스택바 — 목화토금수 다섯 값의 합이 100(%)인 "구성비" 데이터를 그릴 때 공용으로 쓴다.
// ⚠️ 설계 변경(2026-08-24 사용자 지적): calcFaceOhaeng·computeOhaeng 둘 다 5개 값의 합이 100%(또는
// 그 비율)가 되도록 만들어지는데, 예전엔 오행마다 따로 "행 하나 = 100% 바"를 그려서 마치 각 오행이
// 서로 독립적으로 0~100점 채점되는 것처럼 보였다. 실제로는 한 사람(또는 한 지표)의 100%를 다섯
// 조각으로 나눈 것이므로, 긴 바 하나를 다섯 색으로 나눠 채우는 100% 스택바가 데이터 구조에 맞는다.
const OHAENG_ORDER = ['목', '화', '토', '금', '수'];
const OHAENG_EMOJI = { 목:'🌳', 화:'🔥', 토:'🟫', 금:'⚙️', 수:'💧' };
const OHAENG_BAR_CLASS = { 목:'oh-목-bar', 화:'oh-화-bar', 토:'oh-토-bar', 금:'oh-금-bar', 수:'oh-수-bar' };
function ohaengStackHTML(percent, opts) {
  opts = opts || {};
  const segs = OHAENG_ORDER.map(k =>
    `<div class="oh-stack-seg ${OHAENG_BAR_CLASS[k]}" style="width:${Math.max(0, Math.min(100, percent[k] || 0))}%"></div>`
  ).join('');
  const legend = OHAENG_ORDER.map(k =>
    `<span class="oh-${k}">${OHAENG_EMOJI[k]}${Math.round(percent[k] || 0)}%</span>`
  ).join('');
  const name = opts.name ? `<div class="oh-stack-name">${opts.name}</div>` : '';
  return `<div class="oh-stack-block">${name}<div class="oh-stack-track">${segs}</div><div class="oh-stack-legend">${legend}</div></div>`;
}

// Zone3 오행 비교(통합분석) — 관상(%) vs 사주(개) 좌우 대칭 막대로 나란히 보여준다.
// 도넛(2026-08-25)에서 다시 막대로 되돌림(2026-08-27 사용자 요청) — 두 도넛의 조각 각도를 서로
// 대조하는 것보다, 오행별로 한 줄씩 정렬된 막대 길이를 비교하는 쪽이 더 직관적이었고, 사주를
// 8칸 정수로 반올림하면 "0개(편중)"가 도넛에서는 아예 사라져 안 보이는 문제도 있었다.
// 단위는 일부러 안 맞춘다: 관상은 원래 연속 퍼센트라 그대로 두고(억지로 정수 카운트로 반올림하면
// 12%·19%가 똑같이 "1개"로 뭉개짐), 사주는 원래 정수 개수라 그대로 둔다. 각 숫자에 %/개 단위를
// 직접 붙여서 두 지표가 다른 걸 잰다는 걸 바로 알 수 있게 한다. 사주 총합은 시주 미상이면 6으로
// 줄어드는데(feature/saju-siju-estimate), 바 길이 기준(분모)도 그 실제 총합을 따라간다.
function renderOhaengCompareTable(sajuCount, faceCount, headFaceElId, headSajuElId, tableElId) {
  const sajuTotal = Object.values(sajuCount).reduce((a, b) => a + b, 0) || 1;

  const domSaju = Object.entries(sajuCount).sort((a, b) => b[1] - a[1])[0][0];
  const domFace = Object.entries(faceCount).sort((a, b) => b[1] - a[1])[0][0];
  const headFace = document.getElementById(headFaceElId);
  const headSaju = document.getElementById(headSajuElId);
  if (headFace) headFace.innerHTML = ohaengLineBreak(FACE_OHAENG_TITLE[domFace]);
  if (headSaju) headSaju.innerHTML = ohaengLineBreak(OHAENG_TITLE_SHORT[domSaju]);

  const table = document.getElementById(tableElId);
  if (!table) return;
  const rows = OHAENG_ORDER.map(k => {
    const fp = Math.max(0, Math.min(100, faceCount[k] || 0));
    const sc = sajuCount[k] || 0;
    const sw = Math.max(0, Math.min(100, sc / sajuTotal * 100));
    return `
      <div class="gg-ohaeng-row">
        <div class="gg-ohaeng-pct">${Math.round(fp)}<span class="gg-ohaeng-unit">%</span></div>
        <div class="gg-ohaeng-barL"><div class="gg-ohaeng-fill ${OHAENG_BAR_CLASS[k]}" style="width:${fp}%"></div></div>
        <div class="gg-ohaeng-label oh-${k}">${OHAENG_EMOJI[k]}${k}</div>
        <div class="gg-ohaeng-barR"><div class="gg-ohaeng-fill ${OHAENG_BAR_CLASS[k]}" style="width:${sw}%"></div></div>
        <div class="gg-ohaeng-pct right${sc === 0 ? ' zero' : ''}">${sc}<span class="gg-ohaeng-unit">개</span></div>
      </div>`;
  }).join('');
  table.innerHTML = `
    <div class="gg-ohaeng-cols-head">
      <span>🌿 관상 · %</span>
      <span>🀄 사주 · 실제 ${sajuTotal}자</span>
    </div>
    ${rows}`;
}

// ═══ 사주 오행 심층 리포트 — 다른 만세력 앱들처럼 "메타포 제목 + 서사 + 사주분석(근거 수치)/
// 사주원리(원론)/현실조언(행동)" 구조로 작성한다("내 사주 오행 이렇게 상세하게 넣어주는데 너는 너무
// 짧다"는 피드백 반영). 오행 8글자 중 0개(제로)인 오행이 있으면 그걸 우선으로, 없으면 3개 이상
// 몰린 과다 오행을 기준으로 이야기를 짠다.
const OHAENG_HANJA = { 목:'木', 화:'火', 토:'土', 금:'金', 수:'水' };
const OHAENG_MEANING = {
  목: '추진력과 성장, 새로운 시작', 화: '열정과 표현력, 확산하는 에너지',
  토: '재물, 신용, 꾸준함, 안정적인 관계', 금: '결단력, 원칙, 정리하는 힘', 수: '지혜, 융통성, 깊이 있는 사고',
};
const OHAENG_ADVICE = {
  목: '초록색 계열의 옷이나 소품을 가까이 하고, 화분을 키우거나 정기적으로 산책·등산을 하며 목 기운을 보충해보세요.',
  화: '빨강·주황색 계열을 활용하고, 밝은 조명 아래서 사람들과 어울리는 자리를 자주 만들어 화 기운을 북돋아보세요.',
  토: '황토길을 걷거나 도예를 배우고, 노란색·베이지색 계열의 옷과 소품을 활용하며 안정적인 루틴을 만드는 게 큰 도움이 됩니다.',
  금: '흰색·은색 계열을 활용하고, 주변을 정리정돈하며 규칙적인 마감 시간을 정해두면 금 기운을 다스리는 데 도움이 돼요.',
  수: '검정·남색 계열을 활용하고, 독서와 사색의 시간을 늘리거나 물가 산책·목욕으로 마음을 정돈해보세요.',
};
const OHAENG_ZERO_STORY = {
  목: { title:'뿌리내릴 씨앗이 없는 사주', body:(dom,cnt)=>`사주 여덟 글자 중 목(木) 기운이 하나도 없는 '목(木) 제로' 사주입니다. 대신 ${dom}(${OHAENG_HANJA[dom]}) 기운이 ${cnt}개로 가장 강해서, 정작 새로운 걸 밀어붙이고 확장해나가는 추진력이 약해질 수 있는 구조예요. 목은 성장과 새로운 시작을 의미하는데 이 기운이 없으니, 안주하기 쉽고 변화를 미루는 경향이 있을 수 있습니다.` },
  화: { title:'빛이 꺼진 무대, 스스로 불을 켜야 하는 사주', body:(dom,cnt)=>`사주 여덟 글자 중 화(火) 기운이 하나도 없는 '화(火) 제로' 사주입니다. 대신 ${dom}(${OHAENG_HANJA[dom]}) 기운이 ${cnt}개로 가장 강해서, 정작 감정을 표현하고 존재감을 드러내는 열정이 위축될 수 있는 구조예요. 화는 표현력과 확산하는 에너지를 의미하는데 이 기운이 없으니, 속마음을 잘 안 드러내고 조용히 있는 편일 수 있습니다.` },
  토: { title:'흙 한 줌 없는 사주, 안정의 물길을 터야', body:(dom,cnt)=>`사주 여덟 글자 중 흙(土) 기운이 하나도 없는 '토(土) 제로' 사주입니다. 대신 ${dom}(${OHAENG_HANJA[dom]}) 기운이 ${cnt}개로 가장 강해서, 정작 뿌리내리고 결실을 맺을 흙이 없는 구조예요. 마치 단단한 바위산에 위태롭게 서 있는 나무와 같아, 안정감과 결실을 얻기 어려운 구조입니다. 토는 재물과 신용, 꾸준함, 안정적인 관계를 의미하는데 이 기운이 없으니, 노력한 결과물을 차곡차곡 쌓아가거나 관계의 안정성을 유지하는 데 어려움을 느낄 수 있습니다.` },
  금: { title:'날이 무뎌진 칼, 다시 벼려야 하는 사주', body:(dom,cnt)=>`사주 여덟 글자 중 금(金) 기운이 하나도 없는 '금(金) 제로' 사주입니다. 대신 ${dom}(${OHAENG_HANJA[dom]}) 기운이 ${cnt}개로 가장 강해서, 정작 맺고 끊는 결단력과 원칙이 흐려질 수 있는 구조예요. 금은 결단력과 정리하는 힘을 의미하는데 이 기운이 없으니, 우유부단해지거나 마무리를 짓는 데 어려움을 느낄 수 있습니다.` },
  수: { title:'마른 강바닥, 지혜의 물길이 끊긴 사주', body:(dom,cnt)=>`사주 여덟 글자 중 수(水) 기운이 하나도 없는 '수(水) 제로' 사주입니다. 대신 ${dom}(${OHAENG_HANJA[dom]}) 기운이 ${cnt}개로 가장 강해서, 정작 한 걸음 물러서서 깊이 생각하는 여유가 부족해질 수 있는 구조예요. 수는 지혜와 융통성, 깊이 있는 사고를 의미하는데 이 기운이 없으니, 순발력은 있어도 신중하게 돌아보는 여유가 아쉬울 수 있습니다.` },
};
const OHAENG_EXCESS_STORY = {
  목: { title:'무성하게 뻗은 나무, 가지치기가 필요한 사주', body:(cnt)=>`목(木) 기운이 ${cnt}개로 과다한 사주입니다. 추진력과 성장 욕구는 넘치지만, 곁가지를 정리하지 않으면 힘이 분산될 수 있어요. 한 번에 여러 일을 벌이기보다, 우선순위를 정해 하나씩 집중하는 게 도움이 돼요.` },
  화: { title:'활활 타오르는 불꽃, 온도 조절이 필요한 사주', body:(cnt)=>`화(火) 기운이 ${cnt}개로 과다한 사주입니다. 열정과 표현력은 넘치지만, 감정 기복이나 성급함으로 이어지기 쉬워요. 차분한 루틴과 충분한 휴식으로 불기운을 다스리는 게 도움이 돼요.` },
  토: { title:'단단하게 굳은 땅, 변화의 바람이 필요한 사주', body:(cnt)=>`토(土) 기운이 ${cnt}개로 과다한 사주입니다. 안정감과 신용은 확실하지만, 고집이 세지거나 변화를 거부하기 쉬워요. 익숙하지 않은 시도를 의식적으로 늘려보는 게 도움이 돼요.` },
  금: { title:'서슬 퍼런 칼날, 날을 무디게 다스려야 하는 사주', body:(cnt)=>`금(金) 기운이 ${cnt}개로 과다한 사주입니다. 의지와 원칙은 굳건하지만, 융통성이 부족해 관계에서 날카로워지기 쉬워요. 한 박자 쉬고 타협점을 찾는 연습이 도움이 돼요.` },
  수: { title:'깊고 넓은 바다, 넘치지 않게 둑이 필요한 사주', body:(cnt)=>`수(水) 기운이 ${cnt}개로 과다한 사주입니다. 지혜와 융통성은 뛰어나지만, 생각이 너무 많아져 결단이 늦어지기 쉬워요. 생각의 마감 시간을 정해두고 실행을 우선하는 연습이 도움이 돼요.` },
};
function buildOhaengDeepDive(ohaeng, dStem) {
  const entries = Object.entries(ohaeng);
  const zero = entries.find(([, c]) => c === 0);
  const sorted = [...entries].sort((a, b) => b[1] - a[1]);
  const dominant = sorted[0];
  const dOh = dStem >= 0 ? CG_OH[dStem] : null;
  const dayMasterNote = dOh ? `, 일간인 ${dOh}(${OHAENG_HANJA[dOh]})은 ${ohaeng[dOh]}개로 ${ohaeng[dOh] <= 1 ? '외로운 형국' : '무난한 힘을 갖춘 형국'}` : '';

  let title, bodyText, factLine, principleLine, adviceLine;

  if (zero) {
    const story = OHAENG_ZERO_STORY[zero[0]];
    title = story.title;
    bodyText = story.body(dominant[0], dominant[1]);
    factLine = `사주에 ${zero[0]}(${OHAENG_HANJA[zero[0]]}) 오행이 전무하며, ${dominant[0]}이 ${dominant[1]}개로 ${dominant[1] >= 3 ? '과다하고' : '가장 강하며'}${dayMasterNote}입니다.`;
    principleLine = `${zero[0]}는 ${OHAENG_MEANING[zero[0]]}을 상징하는데, 이 기운이 없으면 그 영역에서 어려움을 느끼기 쉽습니다.`;
    adviceLine = OHAENG_ADVICE[zero[0]];
  } else if (dominant[1] >= 3) {
    const story = OHAENG_EXCESS_STORY[dominant[0]];
    title = story.title;
    bodyText = story.body(dominant[1]);
    factLine = `${dominant[0]}(${OHAENG_HANJA[dominant[0]]})이 ${dominant[1]}개로 과다하고${dayMasterNote}입니다.`;
    principleLine = `${dominant[0]}는 ${OHAENG_MEANING[dominant[0]]}을 상징하는데, 이 기운이 지나치면 오히려 균형이 무너지기 쉽습니다.`;
    adviceLine = OHAENG_ADVICE[dominant[0]];
  } else {
    // 균형 케이스 — 예전엔 정렬 후 sorted[0] 하나만 "우세 오행"으로 임의로 집어서 근거로 삼았는데,
    // 실제로는 여러 오행이 동점(예: 2개씩 3종류)인 경우가 흔해서 그 중 하나만 콕 집는 게 부자연스러웠다
    // (버그 리포트: "화 원리라고 나오는데 화가 딱히 우세한 것도 아닌데 왜?"). 최고점 동점 그룹·최저점
    // 동점 그룹을 각각 묶어서 서술하고, 조언은 실제 여백이 있는(가장 적은) 오행 쪽으로 준다.
    const maxCount = sorted[0][1];
    const minCount = sorted[sorted.length - 1][1];
    const topTier = entries.filter(([, c]) => c === maxCount).map(([k]) => k);
    const bottomTier = entries.filter(([, c]) => c === minCount).map(([k]) => k);
    const topLabel = topTier.map(k => `${k}(${OHAENG_HANJA[k]})`).join('·');
    const bottomLabel = bottomTier.map(k => `${k}(${OHAENG_HANJA[k]})`).join('·');
    const topMeaning = topTier.map(k => OHAENG_MEANING[k]).join(', ');

    title = topTier.length > 1 ? '여러 기운이 함께 흐르는 조화형 사주' : `${topTier[0]} 기운이 살짝 앞서가는 균형형 사주`;
    bodyText = `사주 여덟 글자에 오행이 비교적 고르게 분포돼 있어서, 어느 한쪽으로 크게 치우치지 않는 균형 잡힌 사주입니다. 그중에서도 ${topLabel} 기운이 ${maxCount}개로 살짝 앞서 있어서 ${topMeaning} 쪽에 자연스러운 강점이 있고, ${bottomLabel} 기운은 ${minCount}개로 상대적으로 여백이 있는 영역이에요. 특정 기운에 크게 쏠리지 않은 만큼, 상황에 따라 유연하게 대응하는 힘이 있습니다.`;
    factLine = `오행이 ${entries.map(([k,v]) => `${k} ${v}개`).join(', ')}로 고르게 분포돼 있고${dayMasterNote}입니다.`;
    principleLine = `오행은 서로 낳고 도와주는 상생(相生)의 순환으로 이어지는데, 이렇게 고르게 갖춰져 있으면 그 흐름이 어느 한 곳에서도 막히지 않고 두루두루 잘 통합니다.`;
    adviceLine = `${OHAENG_ADVICE[bottomTier[0]]} 지금처럼 여러 기운을 골고루 쓰는 장점을 살리면서, 이 부분을 조금 더 채워두면 훨씬 더 단단해져요.`;
  }

  return {
    title,
    html: `<div style="font-size:13px;color:var(--gold);font-weight:800;margin-bottom:8px;">🌾 ${title}</div>`
      + `<p style="margin-bottom:10px;">${bodyText}</p>`
      + `<p style="margin-bottom:6px;"><strong style="color:var(--gold-light);">사주 분석</strong> — ${factLine}</p>`
      + `<p style="margin-bottom:6px;"><strong style="color:var(--gold-light);">사주 원리</strong> — ${principleLine}</p>`
      + `<p><strong style="color:var(--gold-light);">현실 조언</strong> — ${adviceLine}</p>`,
  };
}
function renderOhaengDeepDive(ohaeng, dStem, elId) {
  const el = document.getElementById(elId);
  if (!el) return;
  el.innerHTML = buildOhaengDeepDive(ohaeng, dStem).html;
  el.classList.remove('hidden');
}

// 관상 오행(얼굴형 기반)의 1위 오행을 헤드라인으로 부각 — 버그 리포트 2번 항목: 단순 나열형 대신
// "화(火) 기운 42% - 열정적인 화형 관상"처럼 메인 칭호를 앞세우는 UI로 개편.
const FACE_OHAENG_TITLE = {
  목: '쭉쭉 뻗은 개척자, 목형(木形) 관상',
  화: '열정 넘치는 리더, 화형(火形) 관상',
  토: '든든하고 안정적인, 토형(土形) 관상',
  금: '칼같이 정리하는, 금형(金形) 관상',
  수: '깊고 지혜로운, 수형(水形) 관상',
};

// 오행능력치 비교(통합분석 Zone2, 2026-08-22 8차 개편으로 Zone3에서 이동)에서만 쓰는 사주 쪽 짧은
// 헤드 — 기존 OHAENG_TITLE(사주보기 탭
// 헤드라인용, 20자 이상)은 FACE_OHAENG_TITLE(관상, 14~16자)보다 훨씬 길어서 두 박스를 나란히 두면
// 높이가 안 맞았다. OHAENG_TITLE 자체는 다른 탭에서 이미 쓰고 있어 못 건드리고, FACE_OHAENG_TITLE과
// 같은 문형("~한, X형 OO")으로 길이를 맞춘 전용 세트를 새로 둔다.
// FACE_OHAENG_TITLE·OHAENG_TITLE_SHORT는 전부 "~한, X형/기운 OO" 문형이라 쉼표 뒤에서 자연스럽게
// 끊긴다. 브라우저 자동 줄바꿈에 맡기면 폭에 따라 엉뚱한 자리에서 끊길 수 있어(2026-08-27 사용자
// 요청), 쉼표 뒤에 <br>을 강제로 넣어 항상 그 지점에서만 줄이 바뀌게 한다.
const ohaengLineBreak = s => s.replace(', ', ',<br>');
const OHAENG_TITLE_SHORT = {
  목: '쭉쭉 뻗어나가는, 목 기운의 사주',
  화: '열정이 넘쳐나는, 화 기운의 사주',
  토: '든든하고 묵직한, 토 기운의 사주',
  금: '칼같이 결단력 있는, 금 기운의 사주',
  수: '깊고 차분한, 수 기운의 사주',
};

// ── Zone 아코디언 — 한 번에 하나만 (사용자 요청 2026-08-18) ─────────────────────
// 리포트가 길어서 Zone을 여러 개 펼쳐두면 지금 어디를 읽고 있는지 놓친다. 하나를 열면 나머지를 닫는다.
// .zone-accordion만 대상으로 잡는다 — Zone4 안에 중첩된 "사주 분석 근거 보기" 같은 하위 아코디언까지
// 닫아버리면 방금 편 걸 스스로 접는 꼴이 된다.
// ⚠️ 버그 수정(2026-08-27 사용자 리포트: "리스트/보관함에서 리포트 보면 아코디언이 다 열려있음") —
// 처음엔 DOMContentLoaded 시점에 한 번만 호출해서 그 순간 문서에 있던 아코디언(통합분석/궁합보기
// 최초 생성 화면의 정적 #cmbZone1~4·#ggHero/ggZone1~3)에만 토글 리스너를 붙였다. 그런데 보관함·내역
// 목록에서 리포트를 열면 archive.js가 그 리포트 HTML을 innerHTML로 통째로 새로 찍어내는데, 그렇게
// 새로 생긴 <details class="zone-accordion">는 페이지 로드 이후에 태어난 요소라 리스너가 하나도
// 안 붙어 "하나 열면 나머지 닫힘" 규칙이 통째로 빠졌다. openCombinedSavedReport·openGunghamSavedReport·
// Archive.renderReport가 리포트 HTML을 새로 그릴 때마다 이 함수를 다시 불러 새 아코디언에도 리스너를
// 붙이게 했다 — data-zac 마커로 이미 붙인 요소는 건너뛰어 중복 바인딩을 막고, 어떤 걸 닫을지는
// 토글이 발생하는 시점에 document 전체를 다시 훑어서(zones를 초기화 시점에 고정하지 않고) 그 사이에
// 새로 생긴 아코디언도 항상 정확히 반영하게 했다.
function initZoneAccordions() {
  const zones = document.querySelectorAll('details.zone-accordion:not([data-zac])');
  zones.forEach((z) => {
    z.setAttribute('data-zac', '1');
    z.addEventListener('toggle', () => {
      if (!z.open) return;
      document.querySelectorAll('details.zone-accordion').forEach((other) => { if (other !== z) other.open = false; });
      // 열었을 때 그 Zone의 최상단이 화면 위로 오게 스크롤한다(사용자 요청 2026-08-19) —
      // 안 그러면 밑에서부터 펼쳐진 내용이 화면 밖에서 늘어나 지금 연 Zone을 놓치기 쉽다.
      z.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });
}
// 브라우저 부트스트랩 코드 — 원본(js/app.js)에서는 모듈 로드 시점에 바로 실행되지만, 이 파일은
// 서버(Node)에서 계산 함수만 갖다 쓰는 용도라 DOM이 없다. typeof 가드로 안전하게 무력화만 하고
// 코드 자체는 diff 비교가 되도록 지우지 않았다.
if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initZoneAccordions);
  else initZoneAccordions();
}

// ── AI 로딩 스켈레톤 (Zone2~4) ───────────────────────────────────────────────
// Zone1은 엔진+DB라 분석 직후 바로 뜨지만 Zone2~4는 Gemini 왕복을 기다려야 한다. 그 사이를
// "사진 분석이 끝나면 표시돼요" 같은 한 줄로 두면, 사용자가 이미 다 뜬 화면으로 착각하고
// "별거 없네" 하고 넘겨버린다(사용자 리포트 2026-08-17). 글줄 모양의 자리를 미리 깔아
// "여기에 내용이 더 들어온다"는 걸 형태로 알린다.
// elId → 로딩 중임을 표시할 상위 Zone(없으면 스켈레톤만 그린다).
// 사주·궁합 탭은 Zone 래퍼가 없어 매핑에서 빠지지만, 스켈레톤 자체는 동일하게 그려진다 —
// 예전엔 이 두 탭만 "🧠 AI 정밀 리포트 생성 중..." 한 줄이라 통합분석과 로딩 경험이 달랐다.
const AI_ZONE_SKELETON = {
  cmbZone2Review: 'cmbZone2', cmbZone2CommonDiff: 'cmbZone2', cmbZone2OhaengReading: 'cmbZone2',
  cmbZone3Reading1: 'cmbZone3', cmbZone3Reading3: 'cmbZone3',
  cmbZone4Card1: 'cmbZone4', cmbZone4Cards: 'cmbZone4',
};
function showAiSkeleton(elId, label) {
  const el = document.getElementById(elId);
  if (!el) return;
  el.innerHTML = `<div class="ai-skeleton">
      <div class="ai-skeleton-note"><span class="ai-skeleton-dot"></span>${label}</div>
      <div class="sk-line"></div><div class="sk-line w90"></div><div class="sk-line w70"></div>
      <div class="sk-line w80"></div><div class="sk-line w50"></div>
    </div>`;
  const zone = document.getElementById(AI_ZONE_SKELETON[elId]);
  if (zone) zone.classList.add('is-loading');
}
// AI 문단이 실제로 채워지면 스켈레톤과 "불러오는 중" 표시를 함께 걷는다.
function clearAiSkeleton(elId) {
  const zone = document.getElementById(AI_ZONE_SKELETON[elId]);
  if (zone) zone.classList.remove('is-loading');
}
function showAllAiSkeletons() {
  showAiSkeleton('cmbZone2CommonDiff', '관상과 사주의 같은 점·다른 점을 찾는 중이에요');
  showAiSkeleton('cmbZone2OhaengReading', '오행을 함께 보는 중이에요');
  showAiSkeleton('cmbZone2Review', '관상과 사주의 케미를 읽는 중이에요');
  showAiSkeleton('cmbZone3Reading1', '만세력과 기질을 함께 보는 중이에요');
  showAiSkeleton('cmbZone3Reading3', '대운과 삼정을 함께 보는 중이에요');
  showAiSkeleton('cmbZone4Card1', '인생의 흐름을 쓰는 중이에요');
  showAiSkeleton('cmbZone4Cards', '관상x사주 스토리를 쓰는 중이에요');
}

function renderFaceOhaengBars(count, elId) {
  const el = document.getElementById(elId);
  if (!el) return;
  const top = Object.entries(count).sort((a, b) => b[1] - a[1])[0];
  const headline = top
    ? `<div style="font-size:13px;color:var(--gold);font-weight:800;margin-bottom:10px;">✨ ${FACE_OHAENG_TITLE[top[0]]} — ${top[0]} 기운 ${top[1]}%</div>`
    : '';
  el.innerHTML = headline + ohaengStackHTML(count);
}
// 궁합보기 Zone1 상단 — 두 사람의 관상오행(calcFaceOhaeng)을 나란히 보여준다.
// 사진이 둘 다 있어야 나오므로 buildFaceOhaengCompare가 null을 반환하면 안내 문구만 그린다.
// 궁합보기 관상오행 비교 — 도넛(2026-08-25)에서 좌우 대칭 막대로 되돌림(2026-08-27 사용자 요청,
// 통합분석 Zone2와 같은 이유: 두 조각의 각도 대조보다 오행별 한 줄 막대 길이 대조가 더 직관적).
// 여기는 나·상대방 둘 다 관상(퍼센트)이라 단위가 같으므로, Zone2 사주 비교와 달리 %/% 그대로 맞대면 된다.
function renderFaceOhaengCompare(compare, elId) {
  const el = document.getElementById(elId);
  if (!el) return;
  if (!compare) {
    el.innerHTML = `<div class="chemi-role" style="color:var(--text2);">📸 두 사람 모두 사진을 업로드하면 관상오행 비교를 볼 수 있어요.</div>`;
    return;
  }
  const topA = Object.entries(compare.a).sort((a, b) => b[1] - a[1])[0];
  const topB = Object.entries(compare.b).sort((a, b) => b[1] - a[1])[0];
  // 대표 오행(1위) 한줄평 — "토형" 세 글자 뱃지 대신, 통합분석 Zone2 헤드라인과 같은 문구
  // (FACE_OHAENG_TITLE)를 그대로 재사용한다(2026-08-27 사용자 요청). 그쪽 헤드라인 박스가 이미
  // 비슷한 폭에서 2줄로 자연스럽게 줄바꿈되는 걸 확인해서, 여기도 같은 wide 박스로 만든다.
  function ohaengBadge(top) {
    return top ? `<span class="gg-ohaeng-badge wide ${OHAENG_BAR_CLASS[top[0]]}">${ohaengLineBreak(FACE_OHAENG_TITLE[top[0]])}</span>` : '';
  }
  const rows = OHAENG_ORDER.map(k => {
    const a = Math.max(0, Math.min(100, compare.a[k] || 0));
    const b = Math.max(0, Math.min(100, compare.b[k] || 0));
    return `
      <div class="gg-ohaeng-row">
        <div class="gg-ohaeng-pct">${Math.round(a)}<span class="gg-ohaeng-unit">%</span></div>
        <div class="gg-ohaeng-barL"><div class="gg-ohaeng-fill ${OHAENG_BAR_CLASS[k]}" style="width:${a}%"></div></div>
        <div class="gg-ohaeng-label oh-${k}">${OHAENG_EMOJI[k]}${k}</div>
        <div class="gg-ohaeng-barR"><div class="gg-ohaeng-fill ${OHAENG_BAR_CLASS[k]}" style="width:${b}%"></div></div>
        <div class="gg-ohaeng-pct right">${Math.round(b)}<span class="gg-ohaeng-unit">%</span></div>
      </div>`;
  }).join('');
  el.innerHTML = `
    <div class="gg-manse-head" style="margin-bottom:12px;">
      <div class="gg-manse-name">나</div>
      <div class="gg-manse-heart">❤</div>
      <div class="gg-manse-name">상대방</div>
    </div>
    ${rows}
    <div style="display:flex;gap:10px;margin-top:12px;">
      ${ohaengBadge(topA)}
      ${ohaengBadge(topB)}
    </div>`;
}
// 재물관상 케미(4-2) 렌더 — buildMoneyChemi가 null(사진 없음)이면 안내 문구만 그린다.
function renderMoneyChemi(money, elId) {
  const el = document.getElementById(elId);
  if (!el) return;
  el.innerHTML = money
    ? `<div class="chemi-card">
        <div class="chemi-title">재물관상 케미</div>
        <div class="chemi-role">${money.text}</div>
        <div class="chemi-role" style="font-size:11px;color:var(--text2);margin-top:6px;">근거: 재백궁(콧볼) 크기 나 ${money.levelA}% · 상대 ${money.levelB}% · 유사도 ${money.similarity}%</div>
      </div>`
    : `<div class="chemi-role" style="color:var(--text2);">📸 두 사람 모두 사진을 업로드하면 재물관상 케미를 볼 수 있어요.</div>`;
}
// 생애주기(초년·중년·말년) 궁합(4-1) 렌더 — 좌우 대칭 diverging bar(gg-ohaeng-row) 대신, 오행
// 스택바(ohaengStackHTML)와 같은 원리로 사람당 가로 막대 1개에 세 구간을 비율대로 쌓아서 보여준다
// (사용자 요청 2026-08-25: 가로 막대그래프 + 구간별로 나눠 표기).
const LIFE_STAGES = [['sangjeong', '초년'], ['jungjeong', '중년'], ['hajeong', '말년']];
const LIFE_STAGE_CLASS = { sangjeong: 'ls-stage-sang', jungjeong: 'ls-stage-jung', hajeong: 'ls-stage-ha' };
function lifeStageStackHTML(ratio, name) {
  // calcSamjeongRatio(landmark-engine.js)는 초년/중년/말년 세 값을 각각 따로 반올림해서 합이 99나
  // 101처럼 100이 아닐 수 있다 — 그 값을 그대로 폭(width%)으로 쓰면 트랙 끝까지 안 채워져서 마지막
  // 구간(말년) 쪽이 둥근 모서리 앞에서 잘려 보인다(사용자 리포트 2026-08-25). 실제 합(total)으로
  // 나눠 항상 트랙 전체(100%)를 채우도록 정규화한다.
  const total = LIFE_STAGES.reduce((s, [k]) => s + Math.max(0, ratio[k] || 0), 0) || 100;
  const segs = LIFE_STAGES.map(([k]) => {
    const pct = Math.max(0, ratio[k] || 0);
    return `<div class="ls-stack-seg ${LIFE_STAGE_CLASS[k]}" style="width:${pct / total * 100}%">${Math.round(pct)}%</div>`;
  }).join('');
  const labels = LIFE_STAGES.map(([k, label]) => {
    const pct = Math.max(0, ratio[k] || 0);
    return `<div style="width:${pct / total * 100}%">${label}</div>`;
  }).join('');
  return `<div class="ls-stack-block"><div class="ls-stack-name">${name}</div><div class="ls-stack-track">${segs}</div><div class="ls-stack-labels">${labels}</div></div>`;
}
function renderLifeStageChemi(life, elId) {
  const el = document.getElementById(elId);
  if (!el) return;
  if (!life) {
    el.innerHTML = `<div class="chemi-role" style="color:var(--text2);">📸 두 사람 모두 사진을 업로드하면 생애주기 궁합을 볼 수 있어요.</div>`;
    return;
  }
  const stacks = lifeStageStackHTML(life.a, '나') + lifeStageStackHTML(life.b, '상대방');
  el.innerHTML = stacks + `<div class="chemi-card" style="margin-top:10px;"><div class="chemi-role">${life.text}</div></div>`;
}


// ── 오행 상생(生)·상극(剋) 관계 — js/app.js에서는 COMBINED 섹션(2773행 부근)에 있던 것을
//    calcSinkangSinyak·calcYongsin이 이 파일 안에서 참조할 수 있도록 그대로 옮겨왔다(값 동일). ──
const OHAENG_GENERATES = { 목:'화', 화:'토', 토:'금', 금:'수', 수:'목' };
const OHAENG_CONTROLS = { 목:'토', 화:'금', 토:'수', 금:'목', 수:'화' };

// ═══ 서버 진입점 — 생년월일시 하나를 넣으면 사주 계산 결과 전체를 돌려준다 ═══
// 클라이언트(js/app.js COMBINED/GUNGHAM 오케스트레이션, 2532행·2632행 부근)가 지금까지
// computePillars → computeOhaeng → computeDaeun → collectSajuInsightSummary → calcSinkangSinyak
// → calcYongsin 순서로 직접 호출해 조립하던 것과 동일한 파이프라인이다. 반환 필드명은 이미 존재하는
// analyzeCharacter 엔드포인트(functions/index.js)가 기대하는 이름(pillars/ohaengCounts/sinsalList/
// gwiinList/hasHour)과 그대로 맞춰뒀다 — 나중에 이 함수의 출력을 그대로 analyzeCharacter 입력으로
// 넘길 수 있게 하기 위함.
//
// ⚠️ 아직 어떤 Cloud Function에서도 호출되지 않는다(마이그레이션 문서 5번 3단계 "동작 동등성 검증"
// 전 단계) — functions/index.js에 endpoint를 추가하는 건 이 파일의 다음 커밋에서 한다.
function computeSajuBundle({ birthDate, birthHour, gender }) {
  const hourVal = (birthHour === null || birthHour === undefined) ? -1 : Number(birthHour);
  const hasHour = hourVal >= 0;

  const pillars = computePillars(birthDate, hourVal);
  const ohaengCounts = computeOhaeng(pillars);
  const daeun = computeDaeun(birthDate, hourVal, gender);
  const { unseongList, sinsalList, gwiinList } = collectSajuInsightSummary(pillars);
  const sinkang = calcSinkangSinyak(pillars);
  const yongsin = calcYongsin(pillars);

  return {
    pillars,
    ohaengCounts,
    daeun,
    unseongList,
    sinsalList,
    gwiinList,
    sinkang,
    yongsin,
    hasHour,
  };
}

module.exports = {
  // 마스터 진입점 — 새 엔드포인트는 원칙적으로 이것만 호출하면 된다.
  computeSajuBundle,
  // 아래는 낱개로도 필요할 수 있어(예: 궁합보기는 두 사람 각각 pillars/ohaeng을 구한 뒤
  // buildSipseongCross·buildYongsinChemi로 "교차" 계산을 한 번 더 해야 한다) 개별로도 내보낸다.
  computePillars,
  computeOhaeng,
  computeDaeun,
  collectSajuInsightSummary,
  calcSinkangSinyak,
  calcYongsin,
  calcSipseongAll,
  buildSipseongCross,
  buildYongsinChemi,
  calcAge,
  getGongmang,
  // 천간/지지 이름 테이블 — prompt-builders.js가 리포트 문구에 "갑자" 같은 한글 간지를 넣을 때 재사용.
  CHEONGAN,
  JIJI,
  CG_KO,
  JJ_KO,
  CG_OH,
  JJ_OH,
  // 해석 문구 테이블 — prompt-builders.js가 "제왕: 기운이 최고조..." 같은 뜻풀이를 리포트 근거로 인용.
  SIBIUNSEONG_MEANING,
  SIPSEONG_MEANING,
  SIBISINSAL_MEANING,
  GWIIN_MEANING,
  get12Unseong,
  LIFELINE_STAGE_LABEL,
};
