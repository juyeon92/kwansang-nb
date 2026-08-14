// ═══ 16개 관상 캐릭터 DB (기획서 §14~16·20) ═══
// id/name/headline/traits/modernRole은 기획서 원문을 그대로 옮겼다. historical_role·strengths·shadow·
// work·relationship·love·growth·compatibleTypes·frictionTypes는 실제 카피(다른 md 파일로 전달 예정)가
// 오기 전까지 TODO 자리표시자로만 채워둔다 — character-engine.js·렌더링 쪽은 이 스키마(키 이름)를
// 기준으로 이미 동작하게 만들어 두었으니, 나중에 값만 갈아끼우면 된다(로직 재작업 불필요).
const CHARACTER_DB = {
  JAESANG: {
    id: 'JAESANG', name: '재상상', traits: ['lead', 'strategy'],
    headline: '사람과 판을 함께 읽는 재상상', modernRole: '전략형 리더',
    historical_role: '', strengths: [], shadow: [],
    work: '', relationship: '', love: '', growth: '',
    compatibleTypes: [], frictionTypes: [],
  },
  JANGGUN: {
    id: 'JANGGUN', name: '장군상', traits: ['lead', 'drive'],
    headline: '결정하면 끝까지 밀어붙이는 장군상', modernRole: '추진형 리더',
    historical_role: '', strengths: [], shadow: [],
    work: '', relationship: '', love: '', growth: '',
    compatibleTypes: [], frictionTypes: [],
  },
  GUNWANG: {
    id: 'GUNWANG', name: '군왕상', traits: ['lead', 'social'],
    headline: '사람을 모아 방향을 만드는 군왕상', modernRole: '사람을 모으는 리더',
    historical_role: '', strengths: [], shadow: [],
    work: '', relationship: '', love: '', growth: '',
    compatibleTypes: [], frictionTypes: [],
  },
  SURYEONG: {
    id: 'SURYEONG', name: '수령상', traits: ['lead', 'stability'],
    headline: '책임질 일에는 끝까지 서는 수령상', modernRole: '책임형 리더',
    historical_role: '', strengths: [], shadow: [],
    work: '', relationship: '', love: '', growth: '',
    compatibleTypes: [], frictionTypes: [],
  },
  GAEHYEOKGA: {
    id: 'GAEHYEOKGA', name: '개혁가상', traits: ['lead', 'sense'],
    headline: '남들이 당연하게 보는 판을 뒤집는 개혁가상', modernRole: '혁신형 리더',
    historical_role: '', strengths: [], shadow: [],
    work: '', relationship: '', love: '', growth: '',
    compatibleTypes: [], frictionTypes: [],
  },
  CHAEKSA: {
    id: 'CHAEKSA', name: '책사상', traits: ['strategy', 'drive'],
    headline: '한발 먼저 읽고 때가 오면 움직이는 책사상', modernRole: '전략 실행가',
    historical_role: '', strengths: [], shadow: [],
    work: '', relationship: '', love: '', growth: '',
    compatibleTypes: [], frictionTypes: [],
  },
  SASIN: {
    id: 'SASIN', name: '사신상', traits: ['strategy', 'social'],
    headline: '사람 사이의 수를 읽는 사신상', modernRole: '협상가·조정자',
    historical_role: '', strengths: [], shadow: [],
    work: '', relationship: '', love: '', growth: '',
    compatibleTypes: [], frictionTypes: [],
  },
  SEONBI: {
    id: 'SEONBI', name: '선비상', traits: ['strategy', 'stability'],
    headline: '자기 기준으로 오래 신뢰받는 선비상', modernRole: '원칙형 전문가',
    historical_role: '', strengths: [], shadow: [],
    work: '', relationship: '', love: '', growth: '',
    compatibleTypes: [], frictionTypes: [],
  },
  HAKJA: {
    id: 'HAKJA', name: '학자상', traits: ['strategy', 'sense'],
    headline: '익숙한 것에서도 새로운 답을 찾는 학자상', modernRole: '연구·아이디어형',
    historical_role: '', strengths: [], shadow: [],
    work: '', relationship: '', love: '', growth: '',
    compatibleTypes: [], frictionTypes: [],
  },
  SANGDANJU: {
    id: 'SANGDANJU', name: '상단주상', traits: ['drive', 'social'],
    headline: '사람과 기회를 움직이는 상단주상', modernRole: '사업·영업형',
    historical_role: '', strengths: [], shadow: [],
    work: '', relationship: '', love: '', growth: '',
    compatibleTypes: [], frictionTypes: [],
  },
  MUGWAN: {
    id: 'MUGWAN', name: '무관상', traits: ['drive', 'stability'],
    headline: '묵묵히 버티고 결국 완수하는 무관상', modernRole: '끈기 있는 실행가',
    historical_role: '', strengths: [], shadow: [],
    work: '', relationship: '', love: '', growth: '',
    compatibleTypes: [], frictionTypes: [],
  },
  GAECHEOKJA: {
    id: 'GAECHEOKJA', name: '개척자상', traits: ['drive', 'sense'],
    headline: '없는 길도 먼저 만들어 보는 개척자상', modernRole: '빠른 혁신가',
    historical_role: '', strengths: [], shadow: [],
    work: '', relationship: '', love: '', growth: '',
    compatibleTypes: [], frictionTypes: [],
  },
  UIWON: {
    id: 'UIWON', name: '의원상', traits: ['social', 'stability'],
    headline: '사람을 살피며 마음을 얻는 의원상', modernRole: '돌봄·신뢰형',
    historical_role: '', strengths: [], shadow: [],
    work: '', relationship: '', love: '', growth: '',
    compatibleTypes: [], frictionTypes: [],
  },
  YEIN: {
    id: 'YEIN', name: '예인상', traits: ['social', 'sense'],
    headline: '분위기와 매력으로 사람을 끌어당기는 예인상', modernRole: '표현·매력형',
    historical_role: '', strengths: [], shadow: [],
    work: '', relationship: '', love: '', growth: '',
    compatibleTypes: [], frictionTypes: [],
  },
  JANGIN: {
    id: 'JANGIN', name: '장인상', traits: ['stability', 'sense'],
    headline: '감각을 오래 다듬어 실력으로 만드는 장인상', modernRole: '섬세한 전문가',
    historical_role: '', strengths: [], shadow: [],
    work: '', relationship: '', love: '', growth: '',
    compatibleTypes: [], frictionTypes: [],
  },
  GUNJA: {
    id: 'GUNJA', name: '군자상', traits: [], // 균형형 — 특정 두 기질이 아니라 6개 전체가 고르게 강함
    headline: '한쪽에 치우치지 않고 균형을 잡는 군자상', modernRole: '올라운더',
    historical_role: '', strengths: [], shadow: [],
    work: '', relationship: '', love: '', growth: '',
    compatibleTypes: [], frictionTypes: [],
  },
};

// 캐릭터 ID → 일러스트 경로. 지금은 images/ 폴더에 있는 예시 4장(고양이 캐릭터 일러스트)만 매칭해뒀고
// (KING=군왕상, STRATEGIST=책사상, ARTIST=예인상, UIWON=의원상 — 파일명이 영문 gloss라 뜻으로 매칭),
// 나머지 12개는 아직 전용 일러스트가 없어서 UI 프로토타입 단계이므로 UIWON 이미지를 임시로 재사용한다
// (사용자 요청 2026-08-14: "일단 UI 준비만 하자" — 최종 일러스트가 들어오면 이 매핑표만 갈아끼우면 됨).
const CHARACTER_ILLUSTRATION_FALLBACK = 'images/UIWON.png';
const CHARACTER_ILLUSTRATION = {
  GUNWANG: 'images/KING.png',
  CHAEKSA: 'images/STRATEGIST.png',
  YEIN: 'images/ARTIST.png',
  UIWON: 'images/UIWON.png',
};
function getCharacterIllustration(characterId) {
  return CHARACTER_ILLUSTRATION[characterId] || CHARACTER_ILLUSTRATION_FALLBACK;
}

// 기질 2개 조합("lead|strategy" 형태, TRAITS 순서로 정렬한 키) → 캐릭터 ID. 6C2 = 15개 전부 채워져 있어야 한다.
function traitPairKey(t1, t2) {
  return TRAITS.indexOf(t1) <= TRAITS.indexOf(t2) ? `${t1}|${t2}` : `${t2}|${t1}`;
}
const TRAIT_PAIR_TO_CHARACTER = {};
Object.values(CHARACTER_DB).forEach(c => {
  if (c.traits.length === 2) TRAIT_PAIR_TO_CHARACTER[traitPairKey(c.traits[0], c.traits[1])] = c.id;
});
