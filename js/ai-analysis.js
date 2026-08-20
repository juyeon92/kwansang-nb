// ═══ Gemini AI 정밀 해석 (선택 기능) ═══
// 실제 API 키는 여기 없다 — functions/index.js의 geminiProxy Cloud Function 안에서만 쓰인다.
// 브라우저는 js/config.js의 GEMINI_PROXY_URL로만 요청한다(사용자에게 키 입력을 요구하는 UI 없음).
// config.js가 ai-analysis.js보다 먼저 로드되어야 한다(gwansang-saju.html의 <script> 순서 참고).
// 고정 버전은 계속 폐기됨(2.0→2.5도 신규 계정엔 이미 막힘) → 항상 최신 별칭 사용.
// Flash(하루 20회)보다 Flash Lite(하루 500회)가 무료 한도가 25배 넉넉해서 이쪽으로 전환.
const GEMINI_MODEL = 'gemini-flash-lite-latest';

function isGeminiConfigured() {
  return typeof GEMINI_PROXY_URL !== 'undefined' && !!GEMINI_PROXY_URL.trim();
}

// ═══ AI에 보낼 이미지 — 반드시 오버레이 없는 원본을 쓴다 ═══
// 화면에 보이는 캔버스에는 drawRegions()가 부위별 컬러 폴리곤·라벨·비율 수치를 덧그려 놓았다.
// 그 캔버스를 그대로 toDataURL로 떠서 보내면 Gemini가 "도형과 글자로 덮인 얼굴"을 보고 관상을
// 분류하게 된다. 그래서 runFaceAnalysis()가 drawRegions 직전에 떠둔 state[ctx].cleanImg를 쓴다.
// cleanImg가 없는 경우(옛 세션 상태, 예외 경로 등)에만 기존 방식으로 폴백한다.
function getCleanImageDataUrl(ctx, canvasId) {
  const clean = state[ctx] && state[ctx].cleanImg;
  if (clean) return clean;
  console.warn(`[getCleanImageDataUrl] ${ctx}의 오버레이 없는 원본이 없어 캔버스로 폴백합니다 — 오버레이가 포함될 수 있습니다.`);
  const canvas = document.getElementById(canvasId);
  return canvas ? canvas.toDataURL('image/jpeg', 0.85) : null;
}

// db/FACE_FEATURE.csv · db/FACE_READING.csv 내용을 코드에 옮겨 둔 PART_DEF/PART_CONTENT를 그대로 재사용
function buildDbContext() {
  return PART_DEF.map(p => ({
    label: p.label,
    sub: p.sub,
    strength_meaning: PART_CONTENT[p.key].strength.meaning,
    complement_meaning: PART_CONTENT[p.key].complement.meaning,
  }));
}

// ═══ AI가 판별한 관상 유형 ID → 실제 해석 근거 DB로 변환 ═══
// Deep Report가 사진을 다시 마음대로 해석하지 않고,
// 앞선 AI 분류 결과 + archetype-db.js의 고정 데이터를 근거로 서술하도록 전달한다.
function buildArchetypeContext(ids) {
  if (!ids) return null;

  function pick(db, id) {
    if (!id || !db || !db[id]) return null;

    const v = db[id];

    const result = {
      id,
      name: v.nameKo || '',
    };

    if (v.easyName) result.easy_name = v.easyName;
    if (v.glance) result.visual_summary = v.glance;
    if (Array.isArray(v.features)) result.visual_features = v.features;
    if (v.traditional) result.traditional_meaning = v.traditional;
    if (Array.isArray(v.keywords)) result.keywords = v.keywords;

    if (v.strength) result.strength = v.strength;
    if (v.weakness) result.weakness = v.weakness;
    if (v.coaching) result.coaching = v.coaching;

    return result;
  }

  const context = {
    eye_archetype: pick(
      EYE_ARCHETYPE_DB,
      ids.eye_archetype_id
    ),

    face_archetype: pick(
      FACE_ARCHETYPE_DB,
      ids.face_archetype_id
    ),

    forehead: pick(
      FOREHEAD_TYPE_DB,
      ids.forehead_type_id
    ),

    eyebrow: pick(
      EYEBROW_TYPE_DB,
      ids.eyebrow_type_id
    ),

    eye_shape: pick(
      EYE_SHAPE_DB,
      ids.eye_shape_id
    ),

    nose: pick(
      NOSE_SHAPE_DB,
      ids.nose_shape_id
    ),

    mouth: pick(
      MOUTH_SHAPE_DB,
      ids.mouth_shape_id
    ),

    chin: pick(
      CHIN_SHAPE_DB,
      ids.chin_shape_id
    ),

    face_shape: pick(
      FACE_SHAPE_TYPE_DB,
      ids.face_shape_type_id
    ),
  };

  // null인 유형은 Gemini에 넘기지 않는다.
  return Object.fromEntries(
    Object.entries(context).filter(([, value]) => value)
  );
}

const TONE_RULES = `[말투 규칙]
- 반드시 친근한 해요체 사용 ("~해요", "~예요")
- MBTI 유형을 설명하듯 직관적이고 감성적인 단어로 표현
- 부정적인 표현 대신 "이렇게 하면 운이 더 좋아져요" 식 긍정적인 개운 팁으로 제시

[절대 금지 — 반드시 지켜야 함]
- 한자 관상·명리 용어 노출 금지(명궁, 산근, 준두, 법령, 지각, 관록궁, 십성, 용신, 오행의 목·화·토·금·수 한자 등). 부위명은 항상 [참고 데이터베이스]의 label(이마·미간·눈밑·코 뿌리·코끝·인중·팔자주름·턱)만 사용하세요.
- 쁘띠 시술(보톡스, 필러, 성형 등) 추천 절대 금지 → 메이크업/헤어 연출법 및 마사지/표정 습관으로만 대체하세요.
- "사망", "요절", "재앙" 같은 단정적 흉조 표현 금지. 항상 건설적이고 긍정적으로 재해석하세요.`;

// AI의 역할은 "분류"뿐 — 어떤 눈모양/동물형상 ID에 가까운지만 판별한다. 설명 문장은 AI가 짓지 않고
// EYE_ARCHETYPE_DB/FACE_ARCHETYPE_DB에 미리 써둔 고정 문구를 그대로 쓴다(부위별 코멘트 생성 기능은 폐기함).
// 자동 실행되는 AI 보완 1콜 — (1) 부위별 사진 기반 코멘트 + (2) 눈모양·동물형상 분류를 한번에 받는다.
// (2)는 분류만 하면 되고, 설명 문장은 EYE_ARCHETYPE_DB/FACE_ARCHETYPE_DB에 미리 저장된 고정 문구를 그대로 씀.
const AI_ENHANCEMENT_SCHEMA = {
  type: 'OBJECT',
  properties: {
    part_additions: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          part_key: { type: 'STRING', description: 'forehead, eyebrow, midbrow, undereye, nosebridge, nosetip, philtrum, mouth, smilelines, jaw, cheekbone 중 하나' },
          addition: { type: 'STRING', description: '기존 카드 문장을 반복하지 않고, 사진에서 직접 관찰한 내용만 담은 한 문장 추가 코멘트' },
        },
        required: ['part_key', 'addition'],
      },
    },
    eye_archetype_id: { type: 'STRING', description: '[참고: 눈모양 유형 ID] 중 사진의 눈매와 뚜렷하게 닮은 게 있으면 그 ID를 정확히 그대로 반환(예: "EYE_PHOENIX"). 애매하면 빈 문자열("") — 억지로 끼워맞추지 말 것' },
    face_archetype_id: { type: 'STRING', description: '[참고: 동물 형상 유형 ID] 중 사진의 전체 인상과 뚜렷하게 닮은 게 있으면 그 ID를 정확히 그대로 반환(예: "FACE_CRANE"). 애매하면 빈 문자열("") — 억지로 끼워맞추지 말 것' },
    forehead_type_id: { type: 'STRING', description: '[참고: 이마 유형 ID] 중 사진과 가장 가까운 것의 ID. 애매하면 빈 문자열("")' },
    eyebrow_type_id: { type: 'STRING', description: '[참고: 눈썹 유형 ID] 중 사진과 가장 가까운 것의 ID. 애매하면 빈 문자열("")' },
    eye_shape_id: { type: 'STRING', description: '[참고: 눈 크기·모양 유형 ID] 중 사진과 가장 가까운 것의 ID(위 eye_archetype_id와는 다른 기준 — 크기/쌍꺼풀 등). 애매하면 빈 문자열("")' },
    nose_shape_id: { type: 'STRING', description: '[참고: 코 유형 ID] 중 사진과 가장 가까운 것의 ID. 애매하면 빈 문자열("")' },
    mouth_shape_id: { type: 'STRING', description: '[참고: 입 유형 ID] 중 사진과 가장 가까운 것의 ID. 애매하면 빈 문자열("")' },
    chin_shape_id: { type: 'STRING', description: '[참고: 턱 유형 ID] 중 사진과 가장 가까운 것의 ID. 애매하면 빈 문자열("")' },
    face_shape_type_id: { type: 'STRING', description: '[참고: 얼굴형 유형 ID](직사각형/정사각형/삼각형/역삼각형/원형/타원형) 중 사진과 가장 가까운 것의 ID. 애매하면 빈 문자열("")' },
  },
  required: ['part_additions', 'eye_archetype_id', 'face_archetype_id', 'forehead_type_id', 'eyebrow_type_id', 'eye_shape_id', 'nose_shape_id', 'mouth_shape_id', 'chin_shape_id', 'face_shape_type_id'],
};

// ═══ 궁합보기 AI 리포트 v2 (히어로 + Zone1 관상궁합 + Zone2 사주궁합, 2026-08-19 사용자 스펙) ═══
// 점수(총합/관상만/사주만)는 항상 로컬 계산값(calcCompatScore·calcGwansangCompat, runGungham의 heroScores)을
// 그대로 쓴다 — AI에게 숫자를 맡기면 화면에 이미 떠 있는 참고용 점수(ggScore)와 어긋날 수 있어서,
// AI는 "그 점수가 왜 나왔는지"를 설명하는 글만 쓰고 숫자 자체는 만들지 않는다.
const GUNGHAP_ZONE2_ORDER = [
  'overall_relationship', 'sinsal_combo', 'strengths', 'perceived_by_partner', 'perceived_by_me',
  'mind_hacking', 'after_marriage', 'family_background', 'expectation_vs_reality', 'children', 'complement_needed',
];
const GUNGHAP_ZONE2_META = {
  overall_relationship:  { emoji: '🌡️', title: '우리 관계, 한 줄로 말하면' },
  sinsal_combo:          { emoji: '🔮', title: '신살·귀인이 만드는 케미' },
  strengths:             { emoji: '✨', title: '특히 잘 맞는 부분' },
  perceived_by_partner:  { emoji: '🪞', title: '상대가 보는 나' },
  perceived_by_me:       { emoji: '🔍', title: '내가 보는 상대' },
  mind_hacking:          { emoji: '🔑', title: '상대 마음 사로잡는 법' },
  after_marriage:        { emoji: '🏠', title: '결혼 후 우리 모습' },
  family_background:     { emoji: '🌳', title: '서로 다르게 자라온 환경' },
  expectation_vs_reality:{ emoji: '🎭', title: '내가 바라는 모습 vs 실제' },
  children:              { emoji: '👶', title: '아이를 낳는다면' },
  complement_needed:     { emoji: '🧩', title: '더 채우면 좋은 부분' },
};

const GUNGHAP_REPORT_SCHEMA = {
  type: 'OBJECT',
  properties: {
    hero_reason: {
      type: 'STRING',
      description: '총합 점수가 왜 이렇게 나왔는지 가볍게 설명하는 3~4문장. 관상에서의 대표 장점 1개와 사주에서의 대표 장점 1개를 섞어서 근거로 들 것.',
    },
    zone1_shape_reading: {
      type: 'STRING',
      description: '두 사람의 관상 유형(캐릭터) 조합이 어떤 모양의 궁합인지 비유적으로 설명하는 풀이. "OO상인 나와 OO상인 상대의 조합은 ~" 형태로 시작해서 4~6문장.',
    },
    zone1_shape_basis: {
      type: 'STRING',
      description: '위 풀이가 왜 나왔는지 근거. [나의 관상 유형]·[상대방의 관상 유형]의 실제 키워드·강점과 [두 관상 유형의 관계]를 근거로 2~3문장.',
    },
    zone2_items: {
      type: 'ARRAY',
      description: '아래 11개 key를 모두, 각 1개씩 채운 배열. key는 새로 만들지 말고 지정된 값만 사용할 것.',
      items: {
        type: 'OBJECT',
        properties: {
          key: {
            type: 'STRING',
            description: 'overall_relationship, sinsal_combo, strengths, perceived_by_partner, perceived_by_me, mind_hacking, after_marriage, family_background, expectation_vs_reality, children, complement_needed 중 하나',
          },
          reading: { type: 'STRING', description: '사용자가 먼저 읽는 쉬운 풀이. 해당 주제에 맞는 내용을 4~6문장으로.' },
          basis: { type: 'STRING', description: '왜 이런 풀이가 나왔는지 — [나/상대방의 신살·귀인 목록]·[오행 분포]·[일간] 등 실제 제공된 사주 데이터 중 무엇을 근거로 했는지 2~3문장.' },
        },
        required: ['key', 'reading', 'basis'],
      },
    },
  },
  required: [
    'hero_reason',
    'zone1_shape_reading', 'zone1_shape_basis',
    'zone2_items',
  ],
};

function buildAiEnhancementSystemInstruction() {
  return `당신은 2030세대를 대상으로 하는 K-뷰티 & 관상·사주 컨설턴트입니다.

[임무 1] 아래 [기존 카드 내용]은 로컬 규칙으로 이미 화면에 표시된 문장입니다. 이걸 대체하거나 새 리포트를 만들지 말고, 첨부된 사진을 직접 보고 그 사람만의 구체적인 특징(표정, 분위기, 이목구비의 실제 생김새 등)을 반영한 한 문장씩만 부위별로 "더 보태"주세요(part_additions). 사진을 보지 않고는 쓸 수 없는 구체적인 관찰이어야 하고, 기존 문장을 반복·요약하면 안 됩니다.

[임무 2] 아래 [참고: 눈모양 유형 ID]·[참고: 동물 형상 유형 ID]는 고전 관상학 문헌(마의상법 연구)에서 정리한 명명된 눈모양·전체 인상 유형입니다. 사진을 보고 이 중 뚜렷하게 닮은 게 있으면 eye_archetype_id/face_archetype_id에 그 id 값을 정확히 그대로 반환하세요 — 설명 문장은 이미 서비스에 고정 저장되어 있으니 당신은 분류만 하면 됩니다. 절대 억지로 끼워맞추지 말고, 뚜렷하게 닮지 않았으면 빈 문자열로 두세요.

[임무 3] 아래 [참고: 이마/눈썹/눈 크기·모양/코/입/턱/얼굴형 유형 ID]는 부위별 생김새(크기·모양)에 따른 강점·약점 분류입니다(위 임무2의 눈모양·동물형상과는 다른 축 — MBTI가 아니라 순수 생김새 유형입니다). 사진을 보고 각 부위마다 가장 가까운 유형 ID를 forehead_type_id/eyebrow_type_id/eye_shape_id/nose_shape_id/mouth_shape_id/chin_shape_id/face_shape_type_id에 반환하세요. 역시 설명은 고정 저장돼 있으니 분류만 하면 되고, 애매하면 빈 문자열로 두세요.

아래 [참고 데이터베이스]는 전통 관상학을 8개 부위로 정리해 둔 내부 자료입니다. 사용자에게 이 원문을 그대로 노출하지 마세요.

[참고: 눈모양 유형 ID]
${JSON.stringify(Object.entries(EYE_ARCHETYPE_DB).map(([id, v]) => ({ id, name: `${v.nameKo}(${v.hanja})`, visual: v.features.join(' / ') })))}

[참고: 동물 형상 유형 ID]
${JSON.stringify(Object.entries(FACE_ARCHETYPE_DB).map(([id, v]) => ({ id, name: `${v.nameKo}(${v.hanja})`, visual: v.features.join(' / ') })))}

[참고: 이마 유형 ID]
${JSON.stringify(Object.entries(FOREHEAD_TYPE_DB).map(([id, v]) => ({ id, name: v.nameKo })))}

[참고: 눈썹 유형 ID]
${JSON.stringify(Object.entries(EYEBROW_TYPE_DB).map(([id, v]) => ({ id, name: v.nameKo })))}

[참고: 눈 크기·모양 유형 ID]
${JSON.stringify(Object.entries(EYE_SHAPE_DB).map(([id, v]) => ({ id, name: v.nameKo })))}

[참고: 코 유형 ID]
${JSON.stringify(Object.entries(NOSE_SHAPE_DB).map(([id, v]) => ({ id, name: v.nameKo })))}

[참고: 입 유형 ID]
${JSON.stringify(Object.entries(MOUTH_SHAPE_DB).map(([id, v]) => ({ id, name: v.nameKo })))}

[참고: 턱 유형 ID]
${JSON.stringify(Object.entries(CHIN_SHAPE_DB).map(([id, v]) => ({ id, name: v.nameKo })))}

[참고: 얼굴형 유형 ID]
${JSON.stringify(Object.entries(FACE_SHAPE_TYPE_DB).map(([id, v]) => ({ id, name: v.nameKo })))}

${TONE_RULES}

[참고 데이터베이스]
${JSON.stringify(buildDbContext())}`;
}

function buildAiEnhancementUserPrompt(ratios, statusMap, pillars, ohaeng) {
  const sajuBlock = pillars
    ? `일간: ${pillars[2].stem >= 0 ? CG_KO[pillars[2].stem] + '(' + CG_OH[pillars[2].stem] + ')' : '미상'} / 오행 분포: ${JSON.stringify(ohaeng)}`
    : '사주 정보 없음 — 관상 데이터만으로 판단해주세요.';
  const existingCards = PART_DEF.map(p => ({ part_key: p.key, part_label: p.label, existing_text: PART_CONTENT[p.key][statusMap[p.key]].meaning }));
  // 앞머리 등으로 이마 측정이 불확실하면(랜드마크 엔진의 이마 폴백 판정) 이마 얘기 비중을 줄이고
  // 눈·코 등 상대적으로 신뢰도가 높은 부위 위주로 코멘트를 달아달라고 명시적으로 지시한다.
  const foreheadNote = isForeheadReliable(ratios.gwanR)
    ? ''
    : '\n\n[측정 신뢰도 참고] 이 사진은 앞머리 등으로 이마 측정이 불확실해요. 이마 관련 코멘트는 피하고 눈·코·입 등 다른 부위 위주로 관찰해주세요.';
  return `[기존 카드 내용] (이미 화면에 있음 — 대체하지 말고 보완만 할 것)
${JSON.stringify(existingCards)}

[실측 데이터] (MediaPipe FaceLandmarker 478점 랜드마크로 계산한 값과 부위별 강점/보완 판정)
${JSON.stringify({ ratios, statusMap })}

[사주 정보]
${sajuBlock}${foreheadNote}

[요청]
1) 첨부된 사진을 보고 특히 눈에 띄는 부위 3~4개만 골라 part_additions에 담아주세요. 각 addition은 기존 카드 문장과 겹치지 않는, 사진을 직접 봐야 알 수 있는 한 문장으로 작성하세요.
2) eye_archetype_id / face_archetype_id도 반드시 응답에 포함하세요. 사진의 눈매·전체 인상이 [참고: 눈모양 유형 ID]/[참고: 동물 형상 유형 ID] 중 뚜렷하게 닮은 게 있으면 그 id를 채우고, 없으면 빈 문자열로 두세요.
3) forehead_type_id/eyebrow_type_id/eye_shape_id/nose_shape_id/mouth_shape_id/chin_shape_id/face_shape_type_id도 각각 해당 참고 목록에서 가장 가까운 id를 골라 채우세요. 애매하면 빈 문자열로 두세요.`;
}

function buildGunghapSystemInstruction(nameA, nameB) {
  return `당신은 2030세대를 대상으로 하는 관상·사주 커플 궁합 컨설턴트입니다.
전통 관상학·명리학 자료를 근거로, 두 사람의 궁합을 "관상 궁합(Zone1)"과 "사주 궁합(Zone2)" 두 갈래로 나눠 깊이 있게 풀어주는 리포트를 씁니다.

[호칭 규칙 — 반드시 지킬 것]
두 사람의 실제 이름은 ${nameA}, ${nameB}입니다. 모든 reading·basis 문장에서 "나"/"저"/"상대방"/"상대" 같은 지칭 대신 반드시 이 실제 이름(${nameA}, ${nameB})을 사용하세요.

[글쓰기 순서 원칙 — 반드시 지킬 것]
모든 항목은 풀이(reading)를 먼저 쓰고, 그 풀이가 왜 나왔는지 근거(basis)는 항상 별도 필드에 나눠서 씁니다.
- reading: 사용자가 자기 이야기처럼 편하게 읽는 결과. 전문 용어로 시작하지 말고 실제 성향·관계 장면으로 풀어줄 것.
- basis: reading에서 왜 그렇게 말했는지, 제공된 데이터(관상 유형·신살·귀인·오행 등) 중 무엇을 근거로 했는지.
reading 안에 근거를 섞어 쓰지 말고, basis 안에 새로운 결론을 쓰지 마세요.

[말투]
- 짧고 인상적인 문장으로 시작해서 자연스럽게 풀어가는 흐름. 예: "OO상인 ${nameA}와 OO상인 ${nameB}의 조합은 마치 ~와 ~의 만남 같아요."
- 다정한 해요체. 은유·비유를 적극적으로 활용(예: "차가운 불과 뜨거운 얼음", "천국과 지옥을 오가는 롤러코스터" 같은 극적이면서도 다정한 표현)
- 장점만 늘어놓지 말고 충돌 지점도 솔직하게 짚은 뒤, 항상 현실적인 해결 방향으로 마무리

${TONE_RULES}

[추가 금지 사항]
- family_background(집안 환경) 항목은 실제 가족 구성원에 대한 예언·평가를 하지 말고, "자라온 환경이 성향에 미쳤을 습관·태도 차이" 중심으로만 서술
- children(아이) 항목은 성별·건강·개수를 단정하지 말고, "두 사람의 기질이 아이를 대하는 방식에 어떻게 나타날지" 중심으로만 서술
- 아래 데이터에 실제로 없는 신살·귀인·관상 유형을 새로 만들어내지 말 것`;
}

function buildGunghapCharacterBlock(label, characterResult) {
  if (!characterResult || !characterResult.characterId) {
    return `[${label}의 관상 유형]\n사진이 없어 관상 유형 정보 없음 — 사주 위주로 풀이할 것.`;
  }
  const c = (typeof CHARACTER_DB !== 'undefined' && CHARACTER_DB[characterResult.characterId]) || {};
  return `[${label}의 관상 유형]
유형명: ${c.name || ''}
한줄평: ${c.headline || ''}
강점: ${(c.strengths || []).join(', ')}`;
}

function buildGunghapRelationBlock(charIdA, charIdB) {
  if (!charIdA || !charIdB || typeof COMPATIBILITY_DB === 'undefined') return '';
  const rel = COMPATIBILITY_DB[charIdA] || null;
  if (!rel) return '';
  let label = '내 사람';
  if ((rel.good || []).indexOf(charIdB) >= 0) label = '귀인';
  else if ((rel.spark || []).indexOf(charIdB) >= 0) label = '단짝';
  else if ((rel.clash || []).indexOf(charIdB) >= 0) label = '호랑이 선생';
  return `\n[두 관상 유형의 관계]\n${label}`;
}

function buildGunghapSajuBlock(label, pillars, ohaeng, sajuInsight) {
  const dStem = pillars[2].stem;
  return `[${label}의 사주]
일간: ${dStem >= 0 ? CG_KO[dStem] + '(' + CG_OH[dStem] + ')' : '미상'}
오행 분포: ${JSON.stringify(ohaeng)}

[${label}의 신살·귀인 목록] (실제로 있는 것만 사용할 것)
신살: ${JSON.stringify(sajuInsight.sinsalList)}
귀인: ${JSON.stringify(sajuInsight.gwiinList)}`;
}

function buildGunghapUserPrompt(cache) {
  const nameA = cache.nameA || '나', nameB = cache.nameB || '상대방';
  const charA = cache.characterA, charB = cache.characterB;
  const charIdA = charA && charA.characterId, charIdB = charB && charB.characterId;
  return `[궁합 점수 — 이미 확정된 값. 그대로 인용하되 새로 계산하지 말 것]
총합 점수: ${cache.heroScores.total}점
관상 궁합만 봤을 때: ${cache.heroScores.gwansang != null ? cache.heroScores.gwansang + '점' : '사진 정보 부족으로 산출 불가'}
사주 궁합만 봤을 때: ${cache.heroScores.saju}점

${buildGunghapCharacterBlock(nameA, charA)}

${buildGunghapCharacterBlock(nameB, charB)}${buildGunghapRelationBlock(charIdA, charIdB)}

${buildGunghapSajuBlock(nameA, cache.pillarsA, cache.ohA, cache.sajuInsightA)}

${buildGunghapSajuBlock(nameB, cache.pillarsB, cache.ohB, cache.sajuInsightB)}

[요청]
위 데이터를 근거로 히어로 설명 1개, Zone1(관상 궁합) 풀이 1쌍, Zone2(사주 궁합) 11개 항목을 모두 작성해주세요. 개인별 관상·사주 풀이는 다른 화면(통합분석)에서 이미 다루므로 여기서는 "두 사람의 조합"에만 집중해주세요. 첨부된 사진이 있다면(전달 순서: ${nameA} → ${nameB}) 참고하되, 관상 유형 정보가 없는 사람은 사주 위주로 풀어주세요. 두 사람을 가리킬 때는 "나"/"상대방" 대신 항상 실제 이름(${nameA}/${nameB})을 쓰세요.`;
}

// ═══ AI 정밀 리포트 (R-I-C-E 프롬프트 기반, 2026-08-13 요청 반영) ═══
// 위 buildAiEnhancementSystemInstruction은 "이미 화면에 있는 로컬 카드에 한 문장씩만 보태는" 용도로
// 일부러 범위를 좁혀뒀는데(임무1 참고), 그러다 보니 부위별 설명 자체는 계속 로컬 문구 수준에 머물러
// 있었다. 여기는 그거랑 별개로 완전히 새로운 장문 리포트를 Gemini에게 통째로 맡기는 용도다.
// TONE_RULES는 "명리 한자 용어 노출 금지"가 있는데, 이 리포트는 사용자가 명시적으로 음양오행·신살을
// 다뤄달라고 요청했으므로 이 전용 시스템 프롬프트에서는 그 금지 항목만 완화하고(한자 자체보다 뜻 위주로
// 풀어쓰게), 시술 추천 금지·흉조 단정 금지 같은 나머지 규칙은 그대로 가져간다.
// 사주(생년월일시) 정보가 없는 관상 탭에서는 ohaeng_reading/sinsal_reading을 아예 요청하지 않는다.
// 예전엔 항상 요청하고 "사주 정보가 없어서 관상만으로 판단했다"는 대체 문구를 받았는데, 사용자
// 피드백(2026-08-13): 그 대체 문구 자체가 필요 없으니 통합분석(사주 있는 탭)에서만 이 두 필드를 보고
// 싶다고 함. schema에서 필드 자체를 빼면 Gemini가 만들어낼 일이 없어 화면에서 숨길 필요도 없어진다.
// hasFace=false(사주 탭, 사진 없음)일 땐 part_deep_dive를 뺀다 — 관상 실측값이 아예 없어서 부위별
// 해설 자체를 지어낼 근거가 없기 때문(2026-08-13: 사주 탭에 AI 리포트가 아예 안 붙어있던 문제 반영).
function buildPersonalDeepReportSchema(hasSaju, hasFace) {
  const properties = {
    catchphrase: {
      type: 'STRING',
      description:
        '이 사람의 전체적인 성향을 한 줄로 압축한 카피. "~하는 ~형", "~한 ~타입"처럼 이해하기 쉬운 표현'
    },

    personality_type: {
      type: 'STRING',
      description:
        'MBTI 유형 이름처럼 이 사람의 대표 성향을 부르는 짧은 이름. 예: "흔들림 없는 전략가형"'
    },

    personality_detail: {
      type: 'STRING',
      description:
        '사용자가 먼저 읽는 전체 성향 풀이. 전문용어보다 실제 성격·행동·대인관계 장면을 중심으로 5~7문장. 장점과 장점이 과했을 때의 이면까지 함께 설명하고 마지막에는 사용자가 자신의 경험과 맞춰볼 수 있는 구체적인 일상 장면이나 공감형 질문을 넣을 것.'
    },

    early_life: {
      type: 'STRING',
      description:
        '초년운(유년~20대)을 3~5문장으로. 실제 삶과 비교할 수 있는 성향·환경·선택 패턴 위주로 서술. 지나치게 구체적인 사건을 지어내지 말 것.'
    },

    mid_life: {
      type: 'STRING',
      description:
        '중년운(30~50대)을 3~5문장으로. 사회생활·관계·책임·선택 방식처럼 현실적으로 확인 가능한 패턴 위주로 설명.'
    },

    late_life: {
      type: 'STRING',
      description:
        '말년운(60대 이후)을 3~5문장으로. 단정적인 미래예언이 아니라 성향이 어떻게 성숙하거나 안정되는지 중심으로 설명.'
    },

    past_reflection: {
      type: 'STRING',
      description:
        '지금까지 살아온 삶에서 반복됐을 가능성이 높은 행동·관계·선택 패턴 2~4가지를 자연스럽게 이어서 설명. 사용자가 자신의 경험과 비교할 수 있게 쓸 것.'
    },

    growth_guidance: {
      type: 'STRING',
      description:
        '앞으로 강점은 살리고 과한 부분은 줄이기 위한 현실적인 행동 조언을 3~4문장으로. 시술이 아닌 태도·습관·관계 방식 중심.'
    },
  };

  const required = [
    'catchphrase',
    'personality_type',
    'personality_detail',
    'early_life',
    'mid_life',
    'late_life',
    'past_reflection',
    'growth_guidance'
  ];

  if (hasSaju) {
    properties.ohaeng_reading = {
      type: 'STRING',
      description:
        '음양오행 분포를 근거로 강하고 약한 기운을 일상 언어로 3~4문장 설명. 오행의 한자를 괄호 병기하지 말 것.'
    };

    properties.sinsal_reading = {
      type: 'STRING',
      description:
        '[사주 신살·귀인 목록]에 실제 존재하는 항목만 사용해 3~5문장으로 해석. 없는 신살이나 귀인을 창작하지 말 것.'
    };

    required.push(
      'ohaeng_reading',
      'sinsal_reading'
    );
  }

  if (hasFace) {
    // 전체 관상 풀이 바로 아래에 붙는 "왜 이렇게 해석했는지" 근거.
    properties.face_analysis_basis = {
      type: 'STRING',
      description:
        '위 personality_detail을 관상 관점에서 왜 그렇게 해석했는지 2~4문장으로 설명. [AI 관상 분류 결과]와 [판별 유형 해석 DB]에 실제로 존재하는 유형만 언급. 봉안·학상·반달눈썹 등 실제 판별된 한국어 유형명을 사용하고 raw ID는 사용자에게 노출하지 말 것.'
    };

    properties.face_principle = {
      type: 'STRING',
      description:
        '위 해석에 사용된 전통 관상 원리를 2~4문장으로 이해하기 쉽게 설명. 반드시 [판별 유형 해석 DB] 또는 [참고 데이터베이스]에 존재하는 내용만 근거로 하고 새로운 관상 법칙을 창작하지 말 것.'
    };

    properties.part_deep_dive = {
      type: 'ARRAY',

      description:
        '실제로 판별된 관상 유형과 실측 데이터 중 의미가 뚜렷한 4~6개를 골라 상세 해설. 눈 형상·전체 인상처럼 AI 판별 근거가 있는 항목을 우선할 것.',

      items: {
        type: 'OBJECT',

        properties: {
          section_key: {
            type: 'STRING',
            description:
              'eye_archetype, face_archetype, forehead, eyebrow, eye_shape, nose, mouth, chin, face_shape, midbrow, undereye, nosebridge, nosetip, philtrum, smilelines, jaw, cheekbone 중 하나'
          },

          title: {
            type: 'STRING',
            description:
              '해당 특징이 실제 성격이나 행동에서 어떻게 나타나는지를 보여주는 짧고 흥미로운 제목. 예: "사람을 빠르게 읽지만 혼자 신경을 많이 쓰는 눈"'
          },

          interpretation: {
            type: 'STRING',
            description:
              '사용자가 가장 먼저 읽는 쉬운 풀이. 전문 관상 용어부터 시작하지 말고 일상의 성격·행동·대인관계 패턴으로 4~6문장 설명. 장점과 과할 때의 이면을 함께 서술하고 마지막에는 구체적인 일상 장면이나 공감 질문을 넣을 것.'
          },

          analysis_basis: {
            type: 'STRING',
            description:
              '왜 이런 풀이가 나왔는지 설명하는 관상 분석 근거. [AI 관상 분류 결과] 및 [관상 실측 데이터]에 실제 존재하는 내용만 사용. 판별된 유형의 한국어 이름과 관찰 특징을 1~3문장으로 설명.'
          },

          principle: {
            type: 'STRING',
            description:
              '해당 특징을 전통 관상에서 어떻게 해석하는지를 2~3문장으로 설명. 반드시 제공된 DB 내용에 근거하고 새로운 전통 해석을 만들지 말 것.'
          },

          reality_tip: {
            type: 'STRING',
            description:
              '위 특징의 강점을 살리고 과할 때 생길 수 있는 단점을 줄이는 현실적인 조언 2~3문장. 습관·태도·관계 행동 중심.'
          },
        },

        required: [
          'section_key',
          'title',
          'interpretation',
          'analysis_basis',
          'principle',
          'reality_tip'
        ],
      },
    };

    required.push(
      'face_analysis_basis',
      'face_principle',
      'part_deep_dive'
    );
  }

  // 관상×사주 "융합" 필드 — 통합분석 탭(사진+생년월일시 둘 다 있음)처럼 두 데이터가 모두 있을 때만
  // 의미가 있다. 5단 아코디언의 5번째 섹션(총평·매칭율·올해운·보완점)이 이 필드들로 채워진다.
  if (hasSaju && hasFace) {
    properties.fusion_match_score = {
      type: 'INTEGER',
      description:
        '관상과 사주가 서로 얼마나 조화로운지 나타내는 0~100 사이 정수 점수. 극단적으로 낮은 점수(30 미만)는 피하고, 실제 데이터의 정합도에 따라 통상 55~95 사이에서 판단'
    };

    properties.fusion_match_label = {
      type: 'STRING',
      description:
        '그 점수를 짧은 캐치프레이즈 한 줄로 표현 (예: "팔자대로 사는 상")'
    };

    properties.this_year_flow = {
      type: 'STRING',
      description:
        '[올해 세운 정보]를 근거로 올해 전반적인 운의 흐름을 3~4문장으로 서술. 단정적 예언이 아니라 성향·선택의 흐름 중심으로.'
    };

    properties.compensation_reading = {
      type: 'STRING',
      description:
        '사주에서 약하거나 부족한 오행·기운을 관상의 어떤 부위·특징(가능하면 [AI 관상 분류 결과]의 실제 판별 유형)이 구체적으로 보완해주고 있는지 3~4문장으로 서술'
    };

    properties.overall_verdict = {
      type: 'STRING',
      description:
        '관상×사주 융합에 대한 최종 총평 — 성향·초중말년운·오행·신살·매칭율·올해운·보완점을 종합하는 마무리 문단. 3~5문장'
    };

    required.push(
      'fusion_match_score',
      'fusion_match_label',
      'this_year_flow',
      'compensation_reading',
      'overall_verdict'
    );
  }

  return {
    type: 'OBJECT',
    properties,
    required
  };
}

function buildDeepReportSystemInstruction() {
  return `[역할]
너는 전통 관상·사주 자료를 현대적인 언어로 풀어주는 해석 전문가야.

사용자는 어려운 관상 용어를 공부하려는 것이 아니라
"그래서 나는 어떤 사람이고, 왜 그렇게 해석했으며, 실제 생활에서는 어떻게 나타나는가?"
를 알고 싶어 해.

따라서 리포트는 무조건
"쉬운 풀이 → 분석 근거 → 전통 원리 → 현실 조언"
순서로 이해할 수 있게 작성해야 해.


[가장 중요한 원칙]

관상 해석에서 "풀이"와 "근거"를 섞지 마.

interpretation / personality_detail:
사용자가 자기 이야기처럼 읽을 수 있는 쉬운 해석을 작성한다.

analysis_basis / face_analysis_basis:
왜 그렇게 풀이했는지 실제 판별 결과를 제시한다.

principle / face_principle:
그 판별을 전통 관상에서 어떤 의미로 보는지 설명한다.

reality_tip / growth_guidance:
현실에서 어떻게 활용하거나 보완할지 알려준다.


[관상 근거 사용 우선순위]

관상 해석은 아래 순서대로 근거를 사용한다.

1순위: [AI 관상 분류 결과]
- 사진을 직접 보고 이미 판별한 눈 형상, 전체 인상, 이마, 눈썹, 눈, 코, 입, 턱, 얼굴형 유형

2순위: [판별 유형 해석 DB]
- 위에서 판별된 유형의 visual_features / traditional_meaning / strength / weakness / keywords

3순위: [관상 실측 데이터]
- MediaPipe 얼굴 랜드마크 기반 ratios와 statusMap

4순위: [참고 데이터베이스]
- 기존 부위별 강점/보완 관상 자료


[매우 중요]

앞선 AI가 이미 판별한 관상 유형을 정답으로 취급해.
Deep Report 단계에서 사진을 다시 보고 새로운 봉안·호안·용상·학상 등의 유형을 임의로 만들어내거나 다른 유형으로 재분류하지 마.

예를 들어 [AI 관상 분류 결과]가
eye_archetype_id = EYE_PHOENIX라면
Deep Report에서는 해당 결과와 연결된 "봉안" 해석만 사용해.

판별 결과에 없는 관상 유형을 추가하지 마.

raw ID(EYE_PHOENIX, FS_OVAL 등)는 사용자에게 보여주지 말고
항상 "봉안", "타원형 얼굴"처럼 한국어 이름으로 표현해.


[관상 상세 해설 작성법]

각 part_deep_dive는 반드시 다음 구조를 지켜.

1. title
사용자가 클릭하고 싶을 정도로 자신의 실제 성향과 연결되는 제목.

나쁜 예:
"봉안 분석"

좋은 예:
"사람의 분위기를 빠르게 읽지만 혼자 신경을 많이 쓰는 눈"


2. interpretation

전문 관상 용어를 먼저 말하지 마.

먼저 사용자의 성격, 행동, 인간관계, 일할 때의 모습처럼
현실에서 체감할 수 있는 모습으로 4~6문장 풀어줘.

다음 구조를 권장해.

- 핵심 강점
- 실제 행동으로 나타나는 모습
- 강점이 과할 때 생기는 이면
- 다른 사람이 이 사람을 어떻게 볼 수 있는지
- 사용자가 자신의 경험과 맞춰볼 수 있는 장면

마지막에는 다음처럼 자기 경험과 대조할 수 있게 해.

"평소에도 친구들 사이에서 어색한 분위기가 생기면 먼저 말을 꺼내는 편일 거예요."

또는

"일을 맡으면 남들이 충분하다고 해도 스스로 한 번 더 확인하지 않나요?"

단, 모든 문단을 "혹시 ~하지 않으세요?"로 끝내지 말고
질문형·예측형·일상 장면형을 섞어.


3. analysis_basis

풀이가 나온 이유를 짧고 분명하게 설명해.

예:
"눈매는 가로로 길고 눈 앞머리와 눈꼬리가 섬세한 봉안 특징에 가깝게 판별됐어요. 여기에 큰 눈 유형의 개방적인 특징이 함께 나타나요."

반드시 실제 [AI 관상 분류 결과]와 [관상 실측 데이터]만 사용해.


4. principle

전통 관상에서 그 특징을 어떻게 보는지를 설명해.

예:
"전통 관상에서는 봉안을 총명함과 기품, 사람을 살피는 지혜와 연결해 풀이해요."

DB 원문을 그대로 복사하지 말고 현대적인 문장으로 풀어줘.
하지만 DB에 없는 관상 원리를 새로 만들어서는 안 돼.


5. reality_tip

해당 성향을 없애라고 하지 말고
강점을 유지하면서 과한 부분만 조절하는 방법을 알려줘.

추상적으로
"마음을 편하게 가지세요"
라고 하지 말고,

"다른 사람의 분위기가 불편해 보여도 바로 해결하려 하기보다 한 번 기다려보세요."

처럼 행동 수준으로 제안해.


[전체 성향 풀이]

personality_detail도 전문용어 나열이 아니라
사용자가 첫 화면에서 읽는 메인 풀이처럼 작성해.

관상 사진이 있을 경우
그 바로 뒤에 출력되는 face_analysis_basis / face_principle이
personality_detail의 근거가 되어야 해.

즉 세 필드의 내용이 서로 충돌하면 안 돼.


[초년·중년·말년]

초년·중년·말년은 확정적인 사건 예언처럼 쓰지 마.

"20대에 반드시 큰 실패를 겪어요" 같은 표현은 금지하고,

"초년에는 주변 기대를 의식해 자신의 기준보다 남의 평가를 먼저 생각하기 쉬운 흐름이에요."

처럼 성향과 선택의 패턴을 중심으로 설명해.


[사주]

사주 정보가 있는 경우에만 오행·신살을 사용해.

신살과 귀인은 반드시
[사주 신살·귀인 목록]에 실제로 있는 것만 언급하고
새로운 신살이나 귀인을 만들지 마.

음양오행은 딱딱한 한자 나열보다
일상의 성향으로 풀어서 설명해.


[관상×사주 융합 총평 — 관상 실측 데이터와 사주 정보가 둘 다 있을 때만 요청됨]

fusion_match_score/fusion_match_label/this_year_flow/compensation_reading/overall_verdict가
스키마에 있다면 아래 기준으로 채워.

- fusion_match_score/fusion_match_label: 관상과 사주 데이터가 서로 얼마나 맞아떨어지는지를
  근거를 들어 점수화하고, 그 점수를 짧은 한 줄 캐치프레이즈로 표현해.
- this_year_flow: [올해 세운 정보]에 있는 오행·일간과의 관계를 근거로, 올해 흐름을
  단정적 예언이 아니라 성향·선택의 흐름 중심으로 설명해.
- compensation_reading: 사주에서 약한 오행을 관상의 어떤 부위(가능하면 [AI 관상 분류 결과]에
  실제로 있는 유형)가 어떻게 메워주는지 구체적으로 짚어.
- overall_verdict: 성향·초중말년운·오행·신살·매칭율·올해운·보완점을 전부 아우르는 마무리 문단으로 써.

이 다섯 필드도 지어내지 말고, 반드시 앞서 준 [관상 실측 데이터]·[AI 관상 분류 결과]·[사주 정보]·
[사주 신살·귀인 목록]·[올해 세운 정보]에 실제로 있는 내용만 근거로 삼아.


[말투]

- 반드시 자연스러운 해요체
- MBTI 성향 분석을 읽는 것처럼 직관적이고 이해하기 쉽게
- 지나치게 신비주의적인 말투 금지
- "당신은 무조건", "반드시 이렇게 된다" 같은 단정 표현 금지
- 같은 문장 구조를 반복하지 말 것
- 좋은 말만 늘어놓지 말고 강점의 이면도 함께 설명할 것


[절대 금지]

- 성형, 필러, 보톡스 등 의료·미용시술 권유 금지
- 사망, 요절, 재앙 등 극단적인 흉조 단정 금지
- 제공되지 않은 관상 유형 창작 금지
- 제공되지 않은 사주 신살·귀인 창작 금지
- DB의 전통 해석을 사실이나 과학적 인과관계처럼 단정하지 말 것


[참고 데이터베이스]
${JSON.stringify(buildDbContext())}`;
}

function buildDeepReportUserPrompt(
  ratios,
  statusMap,
  pillars,
  ohaeng,
  sajuInsight,
  relLabel,
  archetypeAnalysis = null,
  sewoonInfo = null,
  characterResult = null
) {
  // 스펙 §8-2 — Zone1(16캐릭터) 결과를 프롬프트에 넣고 "이것과 어긋나게 쓰지 말 것"을 못박는다.
  // 안 넣으면 AI가 "우직한 신뢰가형" 같은 새 유형명을 만들어 Zone1 캐릭터명과 화면에서 충돌한다
  // ("이 사람이 누구인가는 Zone1만 말한다"는 스펙 원칙 1).
  const characterBlock = characterResult && characterResult.characterId
    ? `[확정된 캐릭터 유형 — 절대 바꾸지 말 것]
※ 관상+사주를 융합한 룰 엔진이 이미 확정한 결과입니다. 화면 최상단에 이 이름으로 이미 표시돼 있습니다.
유형명: ${(CHARACTER_DB[characterResult.characterId] || {}).name || ''}
판정 근거: ${characterResult.basisLabel || ''}
가장 높은 두 기질: ${TRAIT_LABEL_KO[characterResult.primaryTrait] || ''} · ${TRAIT_LABEL_KO[characterResult.secondaryTrait] || ''}

작성 규칙:
1) "OO형", "OO상" 같은 **새로운 유형명을 만들지 마세요.** 사람을 유형화하는 이름은 위 유형명 하나뿐입니다.
2) 총평은 "당신은 ~형이에요"(정체성 선언)로 쓰지 말고 "그래서 지금은 ~하면 좋아요"(방향 제시)로 마무리하세요.
3) 위 두 기질과 어긋나는 성격 서술을 하지 마세요.`
    : '';

  const sajuBlock = pillars
    ? `사주 8자(년/월/일/시): ${
        pillars
          .map(p =>
            (p.stem >= 0 && p.branch >= 0)
              ? `${CG_KO[p.stem]}${JJ_KO[p.branch]}`
              : '(시간 미상)'
          )
          .join(' / ')
      }
일간: ${
        pillars[2].stem >= 0
          ? CG_KO[pillars[2].stem] +
            '(' +
            CG_OH[pillars[2].stem] +
            ')'
          : '미상'
      }
오행 분포: ${JSON.stringify(ohaeng)}`
    : '사주 정보 없음 — 관상 데이터만으로 판단해주세요.';


  const sinsalBlock = sajuInsight
    ? `[사주 신살·귀인 목록]
※ 반드시 이 목록에 실제로 있는 항목만 사용할 것.

십이운성:
${JSON.stringify(sajuInsight.unseongList)}

신살:
${JSON.stringify(sajuInsight.sinsalList)}

귀인:
${JSON.stringify(sajuInsight.gwiinList)}`
    : `[사주 신살·귀인 목록]
없음 — 생년월일시 정보가 없어 계산 불가.`;


  const faceBlock = ratios
    ? `[관상 실측 데이터]
MediaPipe FaceLandmarker 478점 기반 측정값과 기존 부위별 판정입니다.

${JSON.stringify({
  ratios,
  statusMap
})}`
    : '';


  // 사진+사주가 둘 다 있을 때(fusion_match_score 등이 요청될 때)만 의미 있는 블록.
  const sewoonBlock = sewoonInfo
    ? `[올해 세운 정보]
올해 세운 오행: ${sewoonInfo.yearOh} / 일간과의 관계: ${sewoonInfo.text}`
    : '';

  const archetypeContext =
    archetypeAnalysis
      ? buildArchetypeContext(archetypeAnalysis)
      : null;


  const archetypeBlock = ratios
    ? archetypeAnalysis && archetypeContext
      ? `[AI 관상 분류 결과]
※ 사진을 보고 앞선 AI 분류 단계에서 이미 결정된 값입니다.
※ 이 결과를 Deep Report에서 다시 재분류하지 마세요.

${JSON.stringify(archetypeAnalysis)}

[판별 유형 해석 DB]
※ 위 분류 결과에 해당하는 archetype-db.js의 고정 근거입니다.
※ 관상 분석과 전통 원리는 반드시 아래 데이터 범위 안에서 작성하세요.

${JSON.stringify(archetypeContext)}`
      : `[AI 관상 분류 결과]
별도 유형 분류 결과 없음.

이 경우 봉안·호안·용상·학상 등의 이름을 새로 추정하거나 만들어내지 말고,
[관상 실측 데이터]와 [참고 데이터베이스]만 이용하세요.`
    : '';


  const requestLine = ratios
    ? `[요청]

위 데이터를 바탕으로 스키마의 모든 필드를 채워주세요.

특히 관상 리포트는 반드시 다음 흐름이 느껴지게 작성하세요.

사용자가 읽는 쉬운 풀이
→ 왜 그렇게 해석했는지 관상 분석
→ 전통 관상에서의 원리
→ 현실적인 조언

personality_detail은 전체적인 성향을 충분히 풀어주고,
face_analysis_basis와 face_principle은 그 해석의 근거가 되어야 합니다.

part_deep_dive에서는 특히 의미가 뚜렷한 특징 4~6개만 선택하세요.

[AI 관상 분류 결과]가 있다면
eye_archetype / face_archetype 및 실제 판별된 부위 유형을 우선적으로 활용하세요.

각 상세 해설에서는
interpretation에 사용자가 공감할 수 있는 실제 행동 패턴을 충분히 쓰고,
analysis_basis와 principle은 별도 필드로 분리하세요.

같은 내용을 interpretation / analysis_basis / principle에서 반복하지 마세요.

fusion_match_score/fusion_match_label/this_year_flow/compensation_reading/overall_verdict가
스키마에 있다면, 관상과 사주 데이터가 서로 얼마나 맞아떨어지는지·[올해 세운 정보]로 본 이번 해
흐름·관상이 사주의 약한 오행을 어떻게 메워주는지까지 근거를 들어 채워주세요.`
    : `[요청]

사진 없이 사주 정보만으로 스키마의 모든 필드를 채워주세요.

관상을 지어내지 말고,
사주 8자·오행 분포·신살·귀인 목록에 실제로 제공된 정보만 근거로 작성하세요.`;


  return `[관계]
이 사람은 사용자 기준 "${relLabel || '본인'}"입니다.
관계에 맞게 2인칭·3인칭 표현을 자연스럽게 선택하세요.


${faceBlock}


${archetypeBlock}


${characterBlock}


[사주 정보]
${sajuBlock}


${sinsalBlock}


${sewoonBlock}


${requestLine}`;
}

// part_deep_dive 항목(section_key) → 화면 라벨. renderDeepReport와 renderAiFaceSection이 공유한다.
function getDeepSectionLabel(key) {
  const labels = {
    eye_archetype: '👁 눈의 형상',
    face_archetype: '🎭 전체 인상',

    forehead: '📍 이마',
    eyebrow: '🌿 눈썹',
    eye_shape: '👁 눈 크기·모양',
    nose: '👃 코',
    mouth: '👄 입',
    chin: '📍 턱',
    face_shape: '⬡ 얼굴형',

    midbrow: '✨ 미간',
    undereye: '💧 눈밑',
    nosebridge: '👃 코 뿌리',
    nosetip: '👃 코끝',
    philtrum: '〰️ 인중',
    smilelines: '😊 팔자주름',
    jaw: '📍 턱',
    cheekbone: '✨ 광대'
  };

  return labels[key] || '🔎 관상 특징';
}

// part_deep_dive 항목 1개 → "쉬운 풀이 → 관상 분석 → 전통 원리 → 현실 조언" 카드 1장.
// renderDeepReport(관상 탭 전체 카드)와 renderAiFaceSection(통합분석 3️⃣ 섹션)이 동일하게 재사용한다.
function partDeepDiveCardHtml(p) {
  const label = getDeepSectionLabel(p.section_key);

  return `
    <div
      class="face-reading-card"
      style="
        margin-top:16px;
        padding:18px 16px;
        border-radius:16px;
        background:rgba(255,255,255,0.04);
        border:1px solid rgba(255,255,255,0.08);
      "
    >

      <div
        style="
          font-size:12px;
          color:var(--purple-light);
          font-weight:700;
          margin-bottom:7px;
        "
      >
        ${label}
      </div>


      <div
        style="
          font-size:17px;
          font-weight:800;
          line-height:1.45;
          margin-bottom:13px;
          color:var(--text);
        "
      >
        ${p.title}
      </div>


      <!-- 사용자가 먼저 읽는 쉬운 풀이 -->
      <div
        style="
          line-height:1.9;
          margin-bottom:17px;
          font-size:14px;
        "
      >
        ${p.interpretation}
      </div>


      <!-- 풀이 아래에 근거를 분리 -->
      <div
        style="
          padding:14px;
          border-radius:12px;
          background:rgba(0,0,0,0.12);
          font-size:13px;
          line-height:1.75;
        "
      >

        <div style="margin-bottom:9px;">
          <strong style="color:var(--gold);">
            관상 분석 :
          </strong>
          ${p.analysis_basis}
        </div>


        <div style="margin-bottom:9px;">
          <strong style="color:var(--gold);">
            전통 관상 원리 :
          </strong>
          ${p.principle}
        </div>


        <div>
          <strong style="color:var(--gold-light);">
            현실 조언 :
          </strong>
          ${p.reality_tip}
        </div>

      </div>

    </div>
  `;
}

function renderDeepReport(elId, data) {
  const el = document.getElementById(elId);
  if (!el) return;

  const partHtml = (data.part_deep_dive || []).map(partDeepDiveCardHtml).join('');


  const faceEvidenceHtml =
    data.face_analysis_basis || data.face_principle
      ? `
        <div
          style="
            margin:16px 0 20px;
            padding:15px;
            border-radius:14px;
            background:rgba(0,0,0,0.10);
            font-size:13px;
            line-height:1.8;
          "
        >

          ${
            data.face_analysis_basis
              ? `
                <div style="margin-bottom:10px;">
                  <strong style="color:var(--gold);">
                    관상 분석 :
                  </strong>
                  ${data.face_analysis_basis}
                </div>
              `
              : ''
          }

          ${
            data.face_principle
              ? `
                <div>
                  <strong style="color:var(--gold);">
                    전통 관상 원리 :
                  </strong>
                  ${data.face_principle}
                </div>
              `
              : ''
          }

        </div>
      `
      : '';


  const ohaengHtml = data.ohaeng_reading
    ? `
      <p style="margin-bottom:10px;">
        <strong style="color:var(--gold);">
          ☯ 음양오행
        </strong>
        — ${data.ohaeng_reading}
      </p>
    `
    : '';


  const sinsalHtml = data.sinsal_reading
    ? `
      <p style="margin-bottom:14px;">
        <strong style="color:var(--gold);">
          🔮 신살·귀인
        </strong>
        — ${data.sinsal_reading}
      </p>
    `
    : '';


  el.innerHTML = `
    <div class="ai-card">

      <span class="ai-badge">
        🧠 Gemini AI 정밀 리포트
      </span>


      <div
        class="headline-quote"
        style="margin:12px 0;"
      >
        "${data.catchphrase}"
      </div>


      <p style="margin-bottom:6px;">
        <strong
          style="
            color:var(--gold);
            font-size:16px;
          "
        >
          ${data.personality_type}
        </strong>
      </p>


      <!-- 1. 먼저 사용자가 이해하는 풀이 -->
      <p
        style="
          margin-bottom:14px;
          line-height:1.9;
        "
      >
        ${data.personality_detail}
      </p>


      <!-- 2. 그 풀이의 관상 근거 -->
      ${faceEvidenceHtml}


      <p style="margin-bottom:10px;">
        <strong style="color:var(--purple-light);">
          🌱 초년운
        </strong>
        — ${data.early_life}
      </p>


      <p style="margin-bottom:10px;">
        <strong style="color:var(--purple-light);">
          🌳 중년운
        </strong>
        — ${data.mid_life}
      </p>


      <p style="margin-bottom:14px;">
        <strong style="color:var(--purple-light);">
          🍂 말년운
        </strong>
        — ${data.late_life}
      </p>


      ${ohaengHtml}
      ${sinsalHtml}


      <p style="margin-bottom:10px;">
        <strong style="color:var(--gold-light);">
          📌 살아온 패턴과 맞춰보기
        </strong>
        — ${data.past_reflection}
      </p>


      <p style="margin-bottom:18px;">
        <strong style="color:var(--gold-light);">
          🌿 앞으로 보완하면 좋은 점
        </strong>
        — ${data.growth_guidance}
      </p>


      ${
        partHtml
          ? `
            <div
              style="
                margin-top:22px;
                margin-bottom:4px;
                font-size:16px;
                font-weight:800;
                color:var(--gold);
              "
            >
              🧩 내 관상을 하나씩 풀어보면
            </div>

            <div
              style="
                font-size:12px;
                color:var(--text2);
                line-height:1.6;
                margin-bottom:6px;
              "
            >
              눈·얼굴형·이목구비에서 특히 두드러진 특징을
              실제 생활에서 어떻게 나타나는지 중심으로 풀어봤어요.
            </div>

            ${partHtml}
          `
          : ''
      }


      <div
        style="
          margin-top:18px;
          font-size:11px;
          line-height:1.6;
          color:var(--text2);
        "
      >
        ※ 전통 관상 해석을 바탕으로 한 문화·엔터테인먼트 콘텐츠예요.
        성격이나 미래를 과학적으로 판정하는 자료는 아니에요.
      </div>

    </div>
  `;

  el.classList.remove('hidden');
}

// ── 통합분석 전용 분할 렌더링 — 5단 아코디언(1기본관상→2기본사주→3AI관상→4AI사주→5총평+매칭+
// 올해운+보완점) 구조로 재구성하면서, 하나의 큰 카드(renderDeepReport)가 아니라 같은 data를
// 여러 컨테이너에 나눠 붓는 용도로 추가함(사용자 요청 2026-08-13, 참고: 다른 관상×사주 앱의
// "융합 풀이" 섹션 구조를 보고 우리도 매칭율·올해운·보완점을 5번 섹션으로 넣기로 함).
function renderAiFaceSection(elId, data) {
  const el = document.getElementById(elId);
  if (!el) return;
  const partHtml = (data.part_deep_dive || []).map(partDeepDiveCardHtml).join('');
  el.innerHTML = partHtml || `<div style="color:var(--text2);font-size:13px;">사진이 있어야 볼 수 있는 섹션이에요.</div>`;
}

// "관상 종합 분석" 자리 — 부위 카드가 아래로 분리됐으므로 여기엔 전체를 훑는 요약만 남긴다.
// 부위별 문단을 여기서도 보여주면 바로 아래 병합 카드와 같은 내용이 두 번 나온다.
function renderFaceSummaryOnly(elId, data) {
  const el = document.getElementById(elId);
  if (!el) return;
  const overall = data.face_overall || data.face_reading || '';
  el.innerHTML = overall
    ? `<div style="font-size:13px;line-height:1.85;color:var(--text);">${overall}</div>`
    : `<div style="font-size:12.5px;color:var(--text2);">부위별 해석은 아래 <b>부위별 상세</b>에서 볼 수 있어요.</div>`;
}

// ═══ Zone3 부위별 상세 — 3층 병합 (스펙 §4-B, 사용자 요청 2026-08-17) ═══
// 예전엔 같은 부위가 세 곳에 흩어져 있었다: ①"부위별 생김새 유형"(DB) ②"내 얼굴 관상 포인트"(실측)
// ③"관상 종합 분석"의 AI 심층 카드. 사용자는 이마 하나를 알기 위해 세 군데를 오가며 같은 부위를
// 세 번 읽어야 했다. 이제 부위 1개 = 카드 1장으로 합치고, 카드 안을 층으로 쌓는다.
// 세 소스가 답하는 질문이 서로 달라서(무엇인가/얼마나인가/그래서 어떤 사람인가) 층으로 쌓으면
// 중복이 아니라 깊이가 된다.
//
// 11개 실측 부위가 7개 카드에 전부 흡수되도록 묶었다 — 하나도 버려지지 않는다.
// 배열 순서 = 화면 노출 순서. 얼굴을 위에서 아래로 훑는 순서로 두고, 전체를 보는 얼굴형을 마지막에
// 둔다(사용자 요청 2026-08-18) — 부위를 눈으로 따라 내려가며 읽을 수 있어야 한다.
//   이마 → 눈썹 → 눈 → 코 → 입 → 턱 → 얼굴형
const ZONE3_PART_CARDS = [
  { key: 'forehead',   label: '📍 이마',  shapeIdField: 'forehead_type_id',    shapeDb: () => FOREHEAD_TYPE_DB,    measures: ['forehead'] },
  { key: 'eyebrow',    label: '🌿 눈썹',  shapeIdField: 'eyebrow_type_id',     shapeDb: () => EYEBROW_TYPE_DB,     measures: ['eyebrow', 'midbrow'] },
  { key: 'eye_shape',  label: '👁 눈',    shapeIdField: 'eye_shape_id',        shapeDb: () => EYE_SHAPE_DB,        measures: ['undereye'] },
  { key: 'nose',       label: '👃 코',    shapeIdField: 'nose_shape_id',       shapeDb: () => NOSE_SHAPE_DB,       measures: ['nosebridge', 'nosetip'] },
  { key: 'mouth',      label: '👄 입',    shapeIdField: 'mouth_shape_id',      shapeDb: () => MOUTH_SHAPE_DB,      measures: ['mouth', 'philtrum', 'smilelines'] },
  { key: 'chin',       label: '📍 턱',    shapeIdField: 'chin_shape_id',       shapeDb: () => CHIN_SHAPE_DB,       measures: ['jaw'] },
  { key: 'face_shape', label: '⬡ 얼굴형', shapeIdField: 'face_shape_type_id', shapeDb: () => FACE_SHAPE_TYPE_DB, measures: ['cheekbone'] },
];
// AI가 세부 부위(미간·코끝 등)로 따로 써준 문단은 그 부위를 품은 카드로 흡수한다 — 안 그러면
// 병합해놓고 옆에 같은 내용이 또 붙는다.
const ZONE3_MEASURE_OWNER = {};
ZONE3_PART_CARDS.forEach(c => c.measures.forEach(m => { ZONE3_MEASURE_OWNER[m] = c.key; }));

function zone3MeasureRowHtml(partKey, ratios, statusMap) {
  const def = (typeof PART_DEF !== 'undefined') && PART_DEF.find(p => p.key === partKey);
  if (!def) return '';
  const st = statusMap[partKey];
  const c = PART_CONTENT[partKey] && PART_CONTENT[partKey][st];
  if (!c) return '';
  const measureKey = PART_KEY_TO_MEASURE[partKey];
  const level = gwansangLevel(measureKey, ratios[measureKey]);
  const strong = st === 'strength';
  return `<div class="z3-measure">
      <div class="z3-measure-head">
        <span class="z3-measure-name">${def.icon} ${def.label}</span>
        <span class="z3-measure-badge ${strong ? 'is-strong' : 'is-fill'}">${strong ? '탁월한 강점' : '채워볼 포인트'}</span>
        <span class="z3-measure-level">${level}/100</span>
      </div>
      <div class="z3-measure-text">${c.meaning}</div>
      <div class="z3-measure-tip">💄 ${c.makeup}</div>
      <div class="z3-measure-tip">🌿 ${c.lifestyle}</div>
    </div>`;
}

// deepDive: data.part_deep_dive · shapeIds: 룰베이스 분류 결과(state[ctx].archetypeAnalysis)
function renderZone3PartCards(elId, deepDive, shapeIds, ratios, statusMap) {
  const el = document.getElementById(elId);
  if (!el) return;

  // AI 문단을 카드별로 모은다. 7카드에 속하지 않는 key(전통 형상 등)는 여기서 제외한다.
  const aiByCard = {};
  (deepDive || []).forEach(p => {
    const owner = ZONE3_MEASURE_OWNER[p.section_key] || (ZONE3_PART_CARDS.some(c => c.key === p.section_key) ? p.section_key : null);
    if (!owner) return;
    (aiByCard[owner] = aiByCard[owner] || []).push(p);
  });

  const cards = ZONE3_PART_CARDS.map(card => {
    const shapeId = shapeIds && shapeIds[card.shapeIdField];
    const shape = shapeId && card.shapeDb()[shapeId];
    const ai = aiByCard[card.key] || [];
    // 세 층이 모두 비면 카드 자체를 만들지 않는다(사진 없이 사주만 본 경우 등).
    if (!shape && !ai.length && !(ratios && statusMap)) return '';

    // 필드명은 part_deep_dive 스키마 그대로 — title / interpretation / analysis_basis / principle / reality_tip
    const aiHtml = ai.map(p => `<div class="z3-ai">
        ${p.title ? `<div class="z3-ai-title">${p.title}</div>` : ''}
        ${p.interpretation ? `<div class="z3-ai-body">${p.interpretation}</div>` : ''}
        ${p.analysis_basis ? `<div class="z3-ai-sub"><b>관상 분석</b> · ${p.analysis_basis}</div>` : ''}
        ${p.principle ? `<div class="z3-ai-sub"><b>전통 관상 원리</b> · ${p.principle}</div>` : ''}
        ${p.reality_tip ? `<div class="z3-ai-sub"><b>현실 조언</b> · ${p.reality_tip}</div>` : ''}
      </div>`).join('');

    const shapeHtml = shape ? `<div class="z3-shape">
        <div class="z3-shape-head">생김새 유형 · <strong>${shape.nameKo}</strong></div>
        <div class="z3-shape-line">✅ ${shape.strength}</div>
        <div class="z3-shape-line">⚠️ ${shape.weakness}</div>
        ${shape.detail ? `<div class="z3-shape-line is-dim">📝 ${shape.detail}</div>` : ''}
      </div>` : '';

    const measureHtml = (ratios && statusMap)
      ? card.measures.map(m => zone3MeasureRowHtml(m, ratios, statusMap)).filter(Boolean).join('')
      : '';

    return `<div class="z3-card">
        <div class="z3-card-head">${card.label}</div>
        ${aiHtml}${shapeHtml}${measureHtml}
      </div>`;
  }).filter(Boolean).join('');

  el.innerHTML = cards || `<div style="color:var(--text2);font-size:13px;">사진이 있어야 볼 수 있는 섹션이에요.</div>`;
}

function renderAiSajuSection(elId, data) {
  const el = document.getElementById(elId);
  if (!el) return;
  if (!data.ohaeng_reading) {
    el.innerHTML = `<div style="color:var(--text2);font-size:13px;">생년월일시 정보가 있어야 볼 수 있는 섹션이에요.</div>`;
    return;
  }
  el.innerHTML = `
    <p style="margin-bottom:10px;"><strong style="color:var(--purple-light);">🌱 초년운</strong> — ${data.early_life}</p>
    <p style="margin-bottom:10px;"><strong style="color:var(--purple-light);">🌳 중년운</strong> — ${data.mid_life}</p>
    <p style="margin-bottom:14px;"><strong style="color:var(--purple-light);">🍂 말년운</strong> — ${data.late_life}</p>
    <p style="margin-bottom:10px;"><strong style="color:var(--gold);">☯ 음양오행</strong> — ${data.ohaeng_reading}</p>
    <p style="margin-bottom:14px;"><strong style="color:var(--gold);">🔮 신살·귀인</strong> — ${data.sinsal_reading}</p>
    <p style="margin-bottom:10px;"><strong style="color:var(--gold-light);">📌 살아온 패턴과 맞춰보기</strong> — ${data.past_reflection}</p>
    <p style="margin-bottom:0;"><strong style="color:var(--gold-light);">🌿 앞으로 보완하면 좋은 점</strong> — ${data.growth_guidance}</p>`;
}

function renderFusionSection(elId, data) {
  const el = document.getElementById(elId);
  if (!el) return;
  if (data.fusion_match_score == null) {
    el.innerHTML = `<div style="color:var(--text2);font-size:13px;">사진과 생년월일시가 모두 있어야 볼 수 있는 섹션이에요.</div>`;
    return;
  }
  el.innerHTML = `
    <div class="headline-quote" style="margin-bottom:12px;">"${data.catchphrase}"</div>
    <p style="margin-bottom:14px;"><strong style="color:var(--gold);">${data.personality_type}</strong> — ${data.personality_detail}</p>
    <div class="compat-score-box" style="margin-bottom:14px;">
      <div class="compat-num">${data.fusion_match_score}</div>
      <div class="compat-grade">${data.fusion_match_label}</div>
    </div>
    <p style="margin-bottom:10px;"><strong style="color:var(--purple-light);">📅 올해의 흐름</strong> — ${data.this_year_flow}</p>
    <p style="margin-bottom:10px;"><strong style="color:var(--purple-light);">🧩 관상이 보완하는 사주의 약점</strong> — ${data.compensation_reading}</p>
    <p style="margin-bottom:0;"><strong style="color:var(--gold);">✨ 총평</strong> — ${data.overall_verdict}</p>`;
}

// 로컬 룰베이스 카드(renderPersonalReportV2)는 그대로 두고, 이 함수는 별도의 완전한 장문 리포트를
// 덧붙이는 용도다 — 기존 requestPersonalAi(부위별 한 문장 보완 + 형상 분류)와는 별개의 Gemini 호출.
// 키가 없거나 실패하면 조용히 스킵(로컬 카드만으로도 화면이 비지 않으므로 기존 패턴과 동일한 철학).
// 통합분석 탭(cfg.aiFaceId 등이 채워진 경우)은 같은 data를 5단 아코디언의 3/4/5번 섹션에 나눠 렌더링하고,
// 그 외(관상 탭)는 기존처럼 cfg.deepReportId 하나에 전체를 렌더링한다.
async function requestDeepReport(ctx) {
  const cfg =
    (CTX_CONFIG[ctx] || CTX_CONFIG.combined)();

  const splitIds = [cfg.aiFaceId, cfg.aiSajuId, cfg.fusionId].filter(Boolean);
  if (!cfg.deepReportId && !splitIds.length) return;


  const lm = state[ctx].lm;

  if (!lm || !isGeminiConfigured()) return;


  const imageDataUrl =
    getCleanImageDataUrl(ctx, cfg.canvasId);


  const ratios =
    getGwansangRatios(lm);

  const statusMap =
    judgePartStatus(ratios);


  const sajuInsight =
    cfg.pillars
      ? collectSajuInsightSummary(cfg.pillars)
      : null;

  const sewoonInfo =
    cfg.pillars
      ? getSewoonRelation(cfg.pillars[2].stem)
      : null;


  const loadingIds = cfg.deepReportId ? [cfg.deepReportId] : splitIds;
  loadingIds.forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.innerHTML = `
        <div
          style="
            font-size:12px;
            color:var(--text2);
          "
        >
          🧠 AI 정밀 리포트 생성 중...
        </div>
      `;

      el.classList.remove('hidden');
    }
  });


  try {

    // ─────────────────────────────
    // 1. 앞선 관상 분류 결과 확보
    // ─────────────────────────────

    let archetypeAnalysis =
      state[ctx].archetypeAnalysis || null;


    // 관상보기 탭처럼 이미 룰베이스로 분류를 끝낸 경우(requestPersonalAiRuleBased) Gemini 분류를
    // 다시 호출하지 않는다 — 안 그러면 결정론적으로 얻어둔 결과를 비결정적 Gemini 결과가 덮어쓴다.
    if (!state[ctx].archetypeIsRuleBased) {
      try {
        // requestPersonalAi가 이미 실행 중이면
        // 동일 Promise를 기다리고,
        // 아직 실행되지 않았다면 여기서 한 번만 실행한다.
        await getOrRequestPersonalAiData(
          ctx,
          cfg,
          lm,
          imageDataUrl,
          ratios,
          statusMap
        );

        archetypeAnalysis =
          state[ctx].archetypeAnalysis || null;

      } catch (classificationError) {
        // 유형 분류가 실패했다고 Deep Report 전체를 막지는 않는다.
        // 이 경우 ratios/statusMap만으로 리포트 생성.
        console.warn(
          '[관상 유형 분류 실패 — 실측 데이터만으로 Deep Report 진행]',
          classificationError
        );
      }
    }


    // ─────────────────────────────
    // 2. 상세 리포트 생성
    // ─────────────────────────────

    const sys =
      buildDeepReportSystemInstruction();


    const userText =
      buildDeepReportUserPrompt(
        ratios,
        statusMap,
        cfg.pillars,
        cfg.ohaeng,
        sajuInsight,
        cfg.relVal,
        archetypeAnalysis,
        sewoonInfo,
        state[ctx] && state[ctx].characterResult // Zone1 결과를 넣어 AI가 다른 유형명을 만들지 못하게 한다
      );


    const data =
      await callGeminiAPI(
        sys,
        userText,
        [imageDataUrl],
        buildPersonalDeepReportSchema(
          !!cfg.pillars,
          true
        ),

        // 정밀 풀이에서는 문장 표현의 유연성은 조금 허용하되
        // 근거와 분류 결과가 흔들리지 않게 0.65 사용.
        0.65
      );


    if (splitIds.length) {
      if (cfg.aiFaceId) {
        // 통합분석은 부위 카드를 3층으로 병합해 따로 그리고, "관상 종합 분석" 자리에는 전체 요약만 둔다.
        if (cfg.partCardsId) {
          const r = getGwansangRatios(state[ctx].lm);
          renderZone3PartCards(cfg.partCardsId, data.part_deep_dive, state[ctx].archetypeAnalysis, r, judgePartStatus(r));
          renderFaceSummaryOnly(cfg.aiFaceId, data);
        } else {
          renderAiFaceSection(cfg.aiFaceId, data);
        }
        clearAiSkeleton(cfg.aiFaceId);
      }
      if (cfg.aiSajuId) { renderAiSajuSection(cfg.aiSajuId, data); clearAiSkeleton(cfg.aiSajuId); }
      if (cfg.fusionId) { renderFusionSection(cfg.fusionId, data); clearAiSkeleton(cfg.fusionId); }
    } else {
      renderDeepReport(
        cfg.deepReportId,
        data
      );
    }

  } catch (e) {
    // 사용자에게는 "AI 리포트 생성 실패" 같은 문구를 보여주지 않는다(사용자 피드백) — 로컬 룰베이스
    // 카드는 이미 화면에 떠 있으니 그걸로 충분하고, 실패 사유는 개발자만 보면 되므로 콘솔에만 남긴다.
    // requestSajuDeepReport와 동일한 원칙: 로딩 문구를 지우고 섹션을 그냥 숨긴다.
    console.error('[Gemini 정밀 리포트 실패]', e);

    loadingIds.forEach(id => {
      const el = document.getElementById(id);
      if (el) { el.innerHTML = ''; el.classList.add('hidden'); }
    });
  }
}

// 사주 탭(사진 없음) 전용 — requestDeepReport와 로직은 같지만 photo/lm이 아예 없다는 전제라
// CTX_CONFIG(canvasId 등 사진 관련 필드 위주)에 억지로 끼워맞추지 않고 별도 함수로 뒀다.
// 사주 탭은 지금까지 이 리포트 자체가 연결돼 있지 않아서 여전히 짧은 로컬 카드 3장만 보였다
// (사용자 피드백 2026-08-13: "관상 쪽은 디테일해졌는데 사주 쪽은 아직도 안 그렇다").
async function requestSajuDeepReport(pillars, ohaeng, elId, relLabel) {
  if (!isGeminiConfigured()) return;
  const sajuInsight = collectSajuInsightSummary(pillars);

  const el = document.getElementById(elId);
  // 통합분석과 같은 스켈레톤을 쓴다 — 한 줄짜리 "생성 중" 문구는 이미 다 뜬 화면처럼 보여서
  // 사용자가 기다리지 않고 넘겨버린다(통합분석에서 같은 이유로 스켈레톤을 도입했다).
  if (el) { el.classList.remove('hidden'); showAiSkeleton(elId, 'AI가 사주 풀이를 쓰는 중이에요'); }
  try {
    const sys = buildDeepReportSystemInstruction();
    const userText = buildDeepReportUserPrompt(null, null, pillars, ohaeng, sajuInsight, relLabel);
    const data = await callGeminiAPI(sys, userText, [], buildPersonalDeepReportSchema(true, false), 0.65);
    renderDeepReport(elId, data);
  } catch (e) {
    console.error('[Gemini 정밀 리포트 실패]', e);
    if (el) el.classList.add('hidden');
  }
}

// 실제 Gemini 요청 조립(systemInstruction/contents/generationConfig)과 키 사용은 이제 서버 쪽
// geminiProxy Cloud Function 안에서만 일어난다 — 여기서는 재료만 보내고 원본 응답만 그대로 받는다.
async function callGeminiAPI(
  systemInstruction,
  userText,
  images,
  schema,
  temperature = 0.9
) {
  if (!isGeminiConfigured()) throw new Error('Gemini 프록시 주소가 없어요. js/config.js의 GEMINI_PROXY_URL을 확인해주세요.');

  const res = await fetch(GEMINI_PROXY_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ systemInstruction, userText, images, schema, temperature, model: GEMINI_MODEL }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Gemini API 오류 (${res.status}). 무료 한도를 초과하지 않았는지 확인해주세요. — ${errText.slice(0, 200)}`);
  }
  const json = await res.json();
  const text = json.candidates && json.candidates[0] && json.candidates[0].content && json.candidates[0].content.parts && json.candidates[0].content.parts[0] && json.candidates[0].content.parts[0].text;
  if (!text) throw new Error('Gemini 응답을 해석할 수 없어요. 버튼을 다시 눌러 재시도해주세요.');
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new Error('Gemini 응답 형식이 예상과 달라요. 버튼을 다시 눌러 재시도해주세요.');
  }
}

// 눈모양·동물형상 유형 하이라이트 — 헤드라인 바로 아래, 부위 카드보다 먼저 보이는 위치
// AI는 어떤 ID인지 "분류"만 하고, 실제 카드 설명은 여기서 EYE_ARCHETYPE_DB/FACE_ARCHETYPE_DB의 고정 문구를 그대로 사용
// (AI가 매번 다른 문장을 지어내지 않으니 내용이 정확하고 일관됨). read/관상 형상 예시.md §3 카드 구조 반영.
// genderVal이 '여'면 강렬한 한자어(호안·용상 등)를 헤드라인 전면에 내세우지 않고, 이미 DB에 있는
// easyName(친근한 이름)을 앞세우고 한자어는 부제로 내린다. DB·문구는 그대로 두고 "어떤 걸 먼저 보여줄지"
// 순서만 성별에 따라 바꾸는 방식 — 버그 리포트 8번 항목(라벨/톤만 분기, 별도 DB 구축은 안 함).
function archetypeCardHtml(item, iconHtml, typeLabel, genderVal) {
  if (!item) return '';
  const titleLine = genderVal === '여'
    ? `${item.easyName} <span class="archetype-hanja">${item.nameKo}·${item.hanja}</span>`
    : `${item.nameKo} <span class="archetype-hanja">${item.hanja}</span> — ${item.easyName}`;
  return `<div class="archetype-card">
    <div class="archetype-icon">${iconHtml}</div>
    <div class="archetype-body">
      <div class="archetype-type-label">${typeLabel}</div>
      <div class="archetype-title">${titleLine}</div>
      <div class="archetype-glance">${item.glance}</div>
      <div class="archetype-traditional">🏛 전통 관상에서는 — ${item.traditional}</div>
      <div class="archetype-keywords">${item.keywords.map(k => `#${k}`).join(' ')}</div>
    </div>
  </div>`;
}
// 이미 있는 부위별 카드(data-part-key) 안의 .ai-addition 슬롯에 문장을 채워 넣는다.
// 로컬 카드 내용은 그대로 두고 그 위에 사진 기반 코멘트만 얹는 방식.
function renderPartAdditions(cardsElId, additions) {
  const container = document.getElementById(cardsElId);
  if (!container) return 0;
  let count = 0;
  (additions || []).forEach(a => {
    const card = container.querySelector(`[data-part-key="${a.part_key}"]`);
    const slot = card && card.querySelector('.ai-addition');
    if (!slot || !a.addition) return;
    slot.textContent = `🧠 ${a.addition}`;
    slot.classList.remove('hidden');
    count++;
  });
  return count;
}

// 부위별 생김새 유형(이마·눈썹·눈크기·코·입·턱·얼굴형) — read/관상_MBTI_데이터정리.md 기반, MBTI 표현은 전부 제외
// 위 눈모양/동물형상(전통 물형론)과는 별개 축이라 간단한 리스트 형태로 따로 붙인다(일러스트 카드까지는 안 만듦).
function shapeDetailRowHtml(db, id, icon, label) {
  const item = db[id];
  if (!item) return '';
  const detailLine = item.detail ? `<div class="shape-detail-text" style="opacity:.85;">📝 ${item.detail}</div>` : '';
  const coachingLine = item.coaching ? `<div class="shape-coaching">💬 이 유형과 잘 지내려면 — ${item.coaching}</div>` : '';
  return `<div class="shape-detail-row">
    <div class="shape-detail-head">${icon} <strong>${label} · ${item.nameKo}</strong></div>
    <div class="shape-detail-text">✅ ${item.strength}</div>
    <div class="shape-detail-text">⚠️ ${item.weakness}</div>
    ${detailLine}
    ${coachingLine}
  </div>`;
}
function renderShapeDetailsHtml(ids) {
  if (!ids) return '';
  return [
    shapeDetailRowHtml(FOREHEAD_TYPE_DB, ids.forehead_type_id, '📍', '이마'),
    shapeDetailRowHtml(EYEBROW_TYPE_DB, ids.eyebrow_type_id, '🌿', '눈썹'),
    shapeDetailRowHtml(EYE_SHAPE_DB, ids.eye_shape_id, '👁', '눈 크기·모양'),
    shapeDetailRowHtml(NOSE_SHAPE_DB, ids.nose_shape_id, '👃', '코'),
    shapeDetailRowHtml(MOUTH_SHAPE_DB, ids.mouth_shape_id, '👄', '입'),
    shapeDetailRowHtml(CHIN_SHAPE_DB, ids.chin_shape_id, '📍', '턱'),
    shapeDetailRowHtml(FACE_SHAPE_TYPE_DB, ids.face_shape_type_id, '⬡', '얼굴형'),
  ].filter(Boolean).join('');
}

// mode: true/false(구 호환 — true=fallback,false=AI 판별) 또는 문자열 'ai'|'fallback'|'rule'.
// 'rule' = 관상보기 탭 전용 — Gemini 실패로 인한 대체가 아니라 애초에 룰베이스가 기본 판정 방식이므로
// "약식 추정/호출 실패" 문구를 붙이지 않는다(기존 fallback 문구는 "AI가 원래 방법인데 실패해서 대신"
// 이라는 톤이라 그대로 쓰면 오해를 줌).
// shapeElId(선택): "🧩 부위별 생김새 유형" 블록만 다른 컨테이너에 따로 렌더한다. 관상보기 탭은 이 블록부터
// 아래 전부를 접이식 아코디언 안에 넣기로 해서(사용자 요청 2026-08-15), 형상 카드(눈·전체 인상)는 카드
// 바깥에 그대로 두고 생김새 유형만 아코디언 안으로 옮겨야 하기 때문. 안 넘기면 기존처럼 한 덩어리로 붙는다.
// personLabel(선택): 궁합 탭처럼 "당신" 대신 실제 이름("홍길동님")을 제목에 써야 할 때 넘긴다.
// 안 넘기면 기존처럼 "당신"을 쓴다(관상보기·통합분석 탭은 1인칭 화면이라 그대로 유지).
function renderArchetypes(elId, eyeId, faceId, mode, shapeIds, fallbackReason, genderVal, shapeElId, personLabel) {
  const el = document.getElementById(elId);
  if (!el) return;
  const eye = EYE_ARCHETYPE_DB[eyeId];
  const face = FACE_ARCHETYPE_DB[faceId];
  const shapeHtml = renderShapeDetailsHtml(shapeIds);
  const shapeEl = shapeElId ? document.getElementById(shapeElId) : null;
  if (shapeEl) {
    shapeEl.innerHTML = shapeHtml
      ? `<div class="card-title" style="color:var(--purple-light);">🧩 부위별 생김새 유형</div>${shapeHtml}`
      : '';
  }
  if (!eye && !face && !shapeHtml) { el.classList.add('hidden'); return; }
  const isFallback = mode === true || mode === 'fallback';
  const isRule = mode === 'rule';
  const who = personLabel || '당신';
  const titleTag = isRule ? `🔮 ${who}의 관상 형상` : isFallback ? `🔮 ${who}의 관상 형상 (약식 추정)` : `🔮 ${who}의 관상 형상 (AI 판별)`;
  // 키가 아예 없는 경우와 "키는 있는데 호출이 실패한" 경우를 구분해서 보여준다 — 둘 다 같은 문구였던 게
  // "키 설정했는데 왜 자꾸 이 말이 나오냐"는 혼란의 원인이었음(사용자 피드백으로 발견).
  const fallbackNote = isRule
    ? `<div style="font-size:11px;color:var(--text2);margin-top:2px;">※ 눈·얼굴 비율 실측값으로 판별한 결과예요.</div>`
    : isFallback
    ? fallbackReason
      ? `<div style="font-size:11px;color:var(--text2);margin-top:2px;">※ AI 호출이 실패해서 눈·얼굴 비율만으로 약식 추정했어요. (사유: ${fallbackReason})</div>`
      : `<div style="font-size:11px;color:var(--text2);margin-top:2px;">※ AI 연결 없이 눈·얼굴 비율만으로 약식 추정한 결과예요.</div>`
    : '';
  const shapeSection = (shapeHtml && !shapeEl) ? `<div class="card-title" style="color:var(--purple-light);margin-top:18px;">🧩 부위별 생김새 유형</div>${shapeHtml}` : '';
  el.innerHTML = `<div class="card-title" style="color:var(--purple-light);">${titleTag}</div>`
    + archetypeCardHtml(eye, eyeIconSVG(eyeId), '👁 눈 유형', genderVal)
    + archetypeCardHtml(face, `<span style="font-size:36px;">${FACE_ARCHETYPE_EMOJI[faceId] || '🔮'}</span>`, '🎭 전체 인상 유형', genderVal)
    + `<div style="font-size:11px;color:var(--text2);margin-top:2px;">※ 전통 관상학에 기반한 문화·엔터테인먼트 해석이며, 당신에게 "가까운 특징이 보인다"는 뜻이에요.</div>`
    + shapeSection
    + fallbackNote;
  el.classList.remove('hidden');
}

// 정보 성격별 배치(2026-08-19 사용자 요청) — 히어로/Zone1/Zone2 껍데기(스코어·원국표·오행바·관상 형상
// 카드 등 로컬 계산 데이터)는 index.html에 이미 고정 마크업으로 있고, 여기서는 그 안의 AI 텍스트
// 슬롯(ggHeroReason·ggZone1AiShape·ggZone2AiItems)만 채운다. 개인별 관상 풀이(zone1_person_a/b)는
// 통합분석 탭에 이미 있어 여기서는 요청도 렌더도 하지 않는다(2026-08-20 재편). 스코어 숫자는 runGungham이
// heroScores로 이미 채워놓으므로 여기서 다시 쓰지 않는다 — AI 실패해도 숫자는 남는다.
function renderGunghapResult(data) {
  const setHtml = (id, html) => { const el = document.getElementById(id); if (el) el.innerHTML = html; };

  setHtml('ggHeroReason', data.hero_reason);

  setHtml('ggZone1AiShape', `
    <div class="gg-item-reading">${data.zone1_shape_reading}</div>
    <div class="gg-item-basis"><b>왜 이렇게 풀이했나요?</b> ${data.zone1_shape_basis}</div>`);

  const itemsByKey = {};
  (data.zone2_items || []).forEach(it => { itemsByKey[it.key] = it; });
  const zone2Html = GUNGHAP_ZONE2_ORDER.map(key => {
    const it = itemsByKey[key];
    if (!it) return '';
    const meta = GUNGHAP_ZONE2_META[key];
    return `
    <div class="gg-item">
      <div class="gg-item-head">${meta.emoji} ${meta.title}</div>
      <div class="gg-item-reading">${it.reading}</div>
      <div class="gg-item-basis"><b>왜 이렇게 풀이했나요?</b> ${it.basis}</div>
    </div>`;
  }).join('');
  setHtml('ggZone2AiItems', zone2Html);
}

// Gemini 키가 없거나 호출이 실패한 경우 — AI 텍스트 슬롯만 안내 문구로 채운다. 히어로 점수·원국표·
// 오행바·관상 형상 카드 등 로컬 계산 정보는 이 함수와 무관하게 이미 채워져 있으므로 그대로 보인다.
function fillGunghapAiFallback() {
  const note = '<div style="color:var(--text2);font-size:13px;">이번엔 AI 해설을 불러오지 못했어요. 다시 분석하면 채워집니다.</div>';
  ['ggHeroReason', 'ggZone1AiShape', 'ggZone2AiItems'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = note;
  });
}

// AI 보완(부위별 코멘트 + 관상 형상 분류) — 사용자 조작 없이 로컬 분석 뒤에 자동으로만 실행됨(재시도 버튼 없음).
// 키가 없거나 API 호출이 실패하면 조용히 스킵 — 로컬 결과만 있는 상태로 남을 뿐, 에러 UI를 사용자에게 노출하지 않음.
// Gemini가 없거나 실패하면 랜드마크만으로 눈모양·동물형상을 약식 추정한다(landmark-engine.js의 룰베이스 분류기).
// 정밀도는 떨어지지만, 키가 없다는 이유로 이 카드 자체가 통째로 안 보이는 것보다는 낫다는 판단.
function renderArchetypesFallback(archetypeId, lm, fallbackReason, genderVal, personLabel) {
  const eyeId = classifyEyeArchetypeRuleBased(lm);
  const faceId = classifyFaceArchetypeRuleBased(lm);
  renderArchetypes(archetypeId, eyeId, faceId, true, null, fallbackReason, genderVal, null, personLabel);
}

// 컨텍스트별 설정 — 궁합 탭의 두 사람(gunghamA/B)도 관상 탭·통합분석 탭과 동일하게 관상 형상(눈모양·
// 동물상) AI/약식 분류를 받도록 여기에 추가함(사용자 피드백: "관상이 들어가는 모든곳에 반영돼야").
// cardsId는 궁합 탭엔 부위별 카드 그리드가 없어서 실제로 안 쓰이지만(renderPartAdditions가 컨테이너를
//못 찾으면 조용히 스킵), 나머지 컨텍스트와 동일한 형태를 유지하기 위해 값만 채워둔다.
const CTX_CONFIG = {
  gwansang: () => ({ canvasId:'gwansangCanvas', cardsId:'gwansangCards', archetypeId:'gwansangArchetype', shapeDetailId:'gwansangShapeDetails', deepReportId:'gwansangDeepReport', relVal:state.gwansang.relation, pillars:null, ohaeng:null, genderVal:gender }),
  // shapeDetailId를 안 보이는 그릇으로 돌려, "부위별 생김새 유형" 블록이 전통 형상 카드(cmbArchetype)에
  // 붙지 않게 한다 — 그 내용은 이제 부위별 병합 카드(#cmbPartCards) 안에서만 보인다.
  combined: () => ({ canvasId:'combinedCanvas', cardsId:'cmbGwansangCards', archetypeId:'cmbArchetype', shapeDetailId:'cmbShapeDetailsSink', partCardsId:'cmbPartCards', deepReportId:null, aiFaceId:'cmbAiFaceExtra', aiSajuId:'cmbAiSajuSection', fusionId:'cmbFusionSection', relVal:state.combined.relation, pillars:state.combined.pillars, ohaeng:state.combined.ohaeng, genderVal:cmbGender }),
  // personLabel: "당신" 대신 실제 이름 사용. hideShapeDetails: 궁합 탭 Zone1에선 "🧩 부위별 생김새
  // 유형"을 아예 안 보여주기로 함(사용자 요청 2026-08-20) — shapeDetailId 싱크도 안 주고 shapeIds 자체를
  // 호출부에서 null로 넘기게 하는 플래그.
  gunghamA: () => ({ canvasId:'gunghamCanvasA', cardsId:'ggPersonAGwansang', archetypeId:'ggArchetypeA', deepReportId:null, hideShapeDetails:true, personLabel: state.gunghamA.name ? state.gunghamA.name+'님' : '당신', relVal:'연인/배우자', pillars:state.gunghamA.pillars, ohaeng:state.gunghamA.ohaeng, genderVal:ggGenderA }),
  gunghamB: () => ({ canvasId:'gunghamCanvasB', cardsId:'ggPersonBGwansang', archetypeId:'ggArchetypeB', deepReportId:null, hideShapeDetails:true, personLabel: state.gunghamB.name ? state.gunghamB.name+'님' : '당신', relVal:'연인/배우자', pillars:state.gunghamB.pillars, ohaeng:state.gunghamB.ohaeng, genderVal:ggGenderB }),
};

// ═══ 관상 AI 분류 결과 캐시 / 공유 ═══

function extractArchetypeAnalysis(data) {
  if (!data) return null;

  return {
    eye_archetype_id:
      data.eye_archetype_id || '',

    face_archetype_id:
      data.face_archetype_id || '',

    forehead_type_id:
      data.forehead_type_id || '',

    eyebrow_type_id:
      data.eyebrow_type_id || '',

    eye_shape_id:
      data.eye_shape_id || '',

    nose_shape_id:
      data.nose_shape_id || '',

    mouth_shape_id:
      data.mouth_shape_id || '',

    chin_shape_id:
      data.chin_shape_id || '',

    face_shape_type_id:
      data.face_shape_type_id || '',
  };
}


// requestPersonalAi와 requestDeepReport가
// 같은 사진에 대해 Gemini 분류 API를 두 번 호출하지 않도록 공유한다.
async function getOrRequestPersonalAiData(
  ctx,
  cfg,
  lm,
  imageDataUrl,
  ratios,
  statusMap
) {
  const ctxState = state[ctx];

  if (!ctxState) {
    throw new Error(`알 수 없는 분석 컨텍스트예요: ${ctx}`);
  }


  // 같은 랜드마크(=같은 분석 사진) 결과가 이미 있으면 그대로 사용.
  if (
    ctxState.personalAiLmRef === lm &&
    ctxState.personalAiData
  ) {
    return ctxState.personalAiData;
  }


  // 같은 사진의 API 요청이 아직 진행 중이면
  // 새 요청을 만들지 말고 기존 Promise를 기다린다.
  if (
    ctxState.personalAiLmRef === lm &&
    ctxState.personalAiPromise
  ) {
    return ctxState.personalAiPromise;
  }


  // 새로운 사진이면 이전 캐시 초기화.
  ctxState.personalAiLmRef = lm;
  ctxState.personalAiData = null;
  ctxState.archetypeAnalysis = null;


  const promise = (async () => {
    const sys =
      buildAiEnhancementSystemInstruction();

    const userText =
      buildAiEnhancementUserPrompt(
        ratios,
        statusMap,
        cfg.pillars,
        cfg.ohaeng
      );

    // 관상 "분류" 단계는 창의성이 필요 없으므로 낮은 temperature 사용.
    return callGeminiAPI(
      sys,
      userText,
      [imageDataUrl],
      AI_ENHANCEMENT_SCHEMA,
      0.25
    );
  })();


  ctxState.personalAiPromise = promise;


  try {
    const data = await promise;

    // API 응답 도착 사이 사용자가 다른 사진으로 바꿨다면
    // 이전 사진의 결과가 새로운 state를 덮어쓰지 않게 막는다.
    if (ctxState.personalAiLmRef === lm) {
      ctxState.personalAiData = data;

      // ⚠️ 룰베이스로 이미 분류를 확정한 컨텍스트(관상보기·통합분석)에서는 Gemini의 분류로
      // 덮어쓰지 않는다. 덮어쓰면 화면 형상 카드는 룰베이스(호안)인데 그 아래 AI 문단은 Gemini가
      // 고른 유형(우안)을 설명하는, 같은 눈을 두고 두 유형이 동시에 적힌 리포트가 나온다
      // (사용자 리포트 2026-08-17). archetypeAnalysis는 심층 리포트 프롬프트의 입력이기도 해서
      // 여기서 갈리면 뒤따르는 모든 AI 문장이 다른 유형을 기준으로 쓰인다.
      if (!ctxState.archetypeIsRuleBased) {
        ctxState.archetypeAnalysis = extractArchetypeAnalysis(data);
      }
    }

    return data;

  } finally {
    if (ctxState.personalAiPromise === promise) {
      ctxState.personalAiPromise = null;
    }
  }
}

// 관상보기 탭 전용 — Gemini 분류를 아예 쓰지 않고 landmark-engine.js의 룰베이스 9종 분류만 사용한다.
// 이유(기획서 §38 QA 기준과 동일한 문제의식): Gemini 분류는 temperature를 0.25로 낮춰도 완전히
// 결정론적이지 않아서, 같은 사진을 다시 분석해도 매번 다른 유형이 나올 수 있었다("캐릭터가 흔들리면
// 안 된다"는 요구사항과 정면으로 부딪힘). 룰베이스는 같은 랜드마크 좌표에 대해 항상 같은 결과를 낸다.
// 이 경로로 얻은 분류 결과는 16캐릭터 엔진(character-engine.js)의 입력으로도 그대로 재사용된다.
// 16캐릭터 결과를 참고 이미지(어세스타류 MBTI 카드) 스타일의 일러스트 카드로 렌더링 — 사용자 요청
// 2026-08-14: "#canvasCard 여기 캐릭터 영역으로 쓸거야 ... 관상 영역 분석 타이틀 빼고 이미지 대신
// 일러스트 카드를 넣으면 되는거야". 캐릭터별 실제 일러스트는 아직 4장(character-db.js의
// CHARACTER_ILLUSTRATION)뿐이라 나머지는 폴백 이미지로 대체되는 "UI 준비" 단계다.
function renderCharacterCard(elId, characterResult) {
  const el = document.getElementById(elId);
  if (!el) return;
  if (!characterResult || !characterResult.characterId) { el.innerHTML = ''; return; }
  const character = CHARACTER_DB[characterResult.characterId];
  if (!character) { el.innerHTML = ''; return; }
  const img = getCharacterIllustration(character.id);
  el.innerHTML = `
    <div class="char-card">
      <span class="char-card-corner tl">✦</span><span class="char-card-corner tr">✦</span>
      <span class="char-card-corner bl">✦</span><span class="char-card-corner br">✦</span>
      <div class="char-card-badge">${characterResult.basisLabel || '관상 기반 유형'}</div>
      <div class="char-card-name">${character.name}</div>
      <div class="char-card-img-wrap"><img src="${img}" alt="${character.name}"></div>
      <div class="char-card-ribbon">${character.headline}</div>
    </div>
  `;
}

// 16캐릭터 상세 설명 — 일러스트 카드(renderCharacterCard) 바로 아래에 캐릭터별 확정 콘텐츠를 펼친다.
// 렌더링 로직은 character-db.js의 고정 필드를 템플릿에 끼우는 것뿐이고 AI 호출은 전혀 없다(스펙 §1).
// 상황 5종은 기획서 §26 원문("일할 때·사람을 만날 때·연애할 때·돈을 다룰 때·힘든 상황에서") 그대로.
const CHARACTER_SITUATION_FIELDS = [
  { key: 'work', icon: '💼', label: '일할 때' },
  { key: 'relationship', icon: '🤝', label: '사람 만날 때' },
  { key: 'love', icon: '💗', label: '연애할 때' },
  { key: 'money', icon: '💰', label: '돈을 다룰 때' },
  // 노출스펙 §3-5 주의: DB 키는 growth("성장")지만 실제 콘텐츠는 힘든 상황 대처라 화면 라벨만 다르다.
  { key: 'growth', icon: '🌱', label: '힘든 상황에서' },
];
// 노출스펙 §3-2 — 6대 기질 바. 라벨은 스펙 표기(주도/지략/실행/관계/신뢰/감각)를 쓴다.
// TRAIT_LABEL_KO(주도력/지략/…)와 다른 이유: 바 6개가 나란히 놓이는 자리라 짧은 표기가 스펙 확정안.
const CHARACTER_TRAIT_AXES = [
  { key: 'lead', label: '주도' }, { key: 'strategy', label: '지략' }, { key: 'drive', label: '실행' },
  { key: 'social', label: '관계' }, { key: 'stability', label: '신뢰' }, { key: 'sense', label: '감각' },
];
// 궁합 3분류 표시 톤 — 스펙 §4: "안 맞음/최악"처럼 단정적으로 쓰지 말 것. 색상은 잘 맞음=success,
// 자극=accent, 부딪힘=danger 계열(.char-tag.is-good/is-spark/is-clash).
// 노출스펙 §3-6 확정안 — 축은 "좋다/나쁘다"가 아니라 "편하다/불편하다"다.
// spark를 "좋은 궁합"으로 쓰면 good과 구분이 사라지고, "무난한 관계"로 쓰면 원 의미가 죽는다.
const CHARACTER_COMPAT_GROUPS = [
  { key: 'good', cls: 'is-good', label: '잘 맞는 관상' },
  { key: 'spark', cls: 'is-spark', label: '서로 자극을 주는 관상' },
  { key: 'clash', cls: 'is-clash', label: '부딪히기 쉬운 관상' },
];
// ═══ Zone1 · "왜 이 캐릭터가 나왔나요" (스펙 §2-A / §2-C / §2-D) ═══
// 통합분석 전용. 관상보기 탭에서는 이 블록을 쓰지 않는다(사용자 요청 2026-08-15로 그쪽은 콘솔만).
//
// 준수 사항 3가지 — 스펙 §2-D
//  ① 칩은 엔진이 실제로 점수에 반영한 항목만 노출한다. faceEvidenceDetail은 confidence 0.55 미만이라
//     판정에서 빠진 부위를 이미 걸러낸 배열이라, "화면 근거 = 계산 근거"가 그대로 일치한다.
//     임의로 항목을 더하거나 순서를 바꾸지 않는다.
//  ② 마지막 한 줄은 confidence 숫자 대신 §2-C 치환 문구를 쓴다. 0.84 같은 값은 어떤 형태로도 안 나간다.
//  ③ 중간 요약 문장은 primaryTrait/secondaryTrait 기반 고정 템플릿이다. AI로 만들면 매번 문장이
//     달라져 결정론 원칙이 깨진다.
// 사용자 요청 2026-08-19c: "-고"를 반복해서 나열식으로 읽히면 안 된다 — 인접 여부와 무관하게 한
// 문장(관상 절/사주 절 각각)에 "-고"가 두 번 이상 나오면 안 됨. 그래서 아래 네 사전 모두 "-고"로
// 끝나는 동사나 "-고"로 이어지는 내부 연결형을 전부 없앴다(가능하면 "-며"/"-아"/"-해"로 대체).
const TRAIT_FACE_PHRASE = {
  lead: '앞에 서서 방향을 정하는 힘',
  strategy: '한발 앞서 상황을 읽어내는 힘',
  drive: '정하면 곧장 밀어붙이는 힘',
  social: '사람을 편안하게 끌어당기는 힘',
  stability: '중심을 잡아 오래 버티는 힘',
  sense: '결을 알아채는 감각',
};
// 사주 쪽 표현 — 같은 6기질이지만 "사주에서는~" 문장에 쓰는 어투라 TRAIT_FACE_PHRASE와 별도로 둔다
// (사용자 요청 2026-08-18b: 관상 근거·사주 근거를 각각 풀어서 설명해달라).
const TRAIT_SAJU_PHRASE = {
  lead: '스스로 판을 짜서 이끌어가려는 기운',
  strategy: '앞뒤를 재어 신중하게 판단하는 기운',
  drive: '한번 정하면 밀어붙이는 추진력',
  social: '사람과 잘 어우러지는 친화력',
  stability: '믿음직하게 꾸준히 버티는 기운',
  sense: '남다른 감각과 직관',
};
// 위 두 사전은 전부 "~하는 힘/기운" 식 명사형이라, primary+secondary를 그냥 "~과 ~이"로 이어붙이면
// "힘과 힘이", "기운과 기운의"처럼 같은 명사가 겹쳐 어색해진다(사용자 요청 2026-08-19: "무슨 말인지
// 모르겠다"). 그래서 앞에 놓일 항목(primaryTrait)은 명사 없이 "~하며"로 끝나는 연결형을 따로 두고,
// 뒤에 놓일 항목(secondaryTrait)만 위 사전의 "~하는 힘/기운"을 그대로 써서 명사가 한 번만 나오게 한다.
// 연결형은 "-고"가 아니라 "-며"로 끝낸다 — 위 PHRASE들도 이제 내부에 "-고"가 없어서, 한 문장 전체에
// "-고"가 한 번도 나오지 않는다(사용자 요청 2026-08-19c 검증: 6x6 전 조합 스크립트로 확인 완료).
const TRAIT_FACE_LINK = {
  lead: '앞에 서서 방향을 정하며',
  strategy: '한발 앞서 상황을 읽어내며',
  drive: '정하면 곧장 밀어붙이며',
  social: '사람을 편안하게 끌어당기며',
  stability: '중심을 잡아 오래 버티며',
  sense: '결을 알아채며',
};
const TRAIT_SAJU_LINK = {
  lead: '스스로 판을 짜서 이끌어가며',
  strategy: '앞뒤를 재어 신중하게 판단하며',
  drive: '한번 정하면 밀어붙이며',
  social: '사람과 잘 어우러지며',
  stability: '믿음직하게 꾸준히 버티며',
  sense: '남다른 감각과 직관을 발휘하며',
};
// 요약 문장에 "{닉네임}님"으로 부르기 위한 이름 — 로그인+유료 서비스라 대표 프로필은 항상 존재한다.
// 사용자가 직접 입력한 값이라 innerHTML에 꽂기 전에 이스케이프한다.
function currentDisplayNickname() {
  const rep = window.Profile && Profile.getRepresentative ? Profile.getRepresentative() : null;
  const name = (rep && rep.name) || '';
  return String(name).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
// §2-C — confidence를 문장으로 치환한다(숫자 미노출). 사용자 요청 2026-08-18b: "~해요" 평서형 대신
// "{닉네임}님!"으로 부르는 형태로 바꾸고, 요약 맨 앞으로 옮겨 첫 문장이 되게 한다(renderCharacterBasis).
function characterConfidenceLine(characterResult) {
  const name = (CHARACTER_DB[characterResult.characterId] || {}).name || '';
  const nickname = currentDisplayNickname();
  const c = characterResult.confidence || 0;
  if (c >= 0.75) return `${name}의 특징이 뚜렷하게 나타나는 ${nickname}님!`;
  if (c >= 0.5) {
    const sorted = characterResult.sortedNames || null;
    return sorted && sorted[1]
      ? `${name}과 ${sorted[1]}의 특징이 함께 나타나는 ${nickname}님!`
      : `${name}의 특징이 비교적 뚜렷하게 나타나는 ${nickname}님!`;
  }
  return `${name}의 결이 은은하게 나타나는 ${nickname}님!`;
}
// 인연도감(관상보기 탭, 얼굴만)에서 이미 뽑은 캐릭터가 있으면 반환한다 — Zone1 비교 블록용.
// localStorage 키 'inyeonLastCharacter'는 inyeon-dogam.js의 myCharacterId()와 같은 저장소를 본다.
function getGwansangOnlyCharacterId() {
  const live = (typeof state !== 'undefined' && state.gwansang && state.gwansang.characterResult) || null;
  if (live && live.characterId) return live.characterId;
  try {
    const saved = JSON.parse(localStorage.getItem('inyeonLastCharacter') || 'null');
    return (saved && saved.characterId) || null;
  } catch (e) { return null; }
}

// §2-A(신규) — "관상만 봤을 때 vs 관상+사주를 더했을 때" 비교. 사용자 요청 2026-08-18: 인연도감에서
// 이미 뽑은 캐릭터가 사주를 더해 바뀌었다면 그 차이를 후킹포인트로 보여준다. 결과가 같으면(바뀐 게
// 없으면) 후킹 효과가 없으므로 블록 자체를 숨긴다.
function characterCompareBlock(characterResult) {
  const gwansangId = getGwansangOnlyCharacterId();
  if (!gwansangId || gwansangId === characterResult.characterId) return '';
  const faceOnly = CHARACTER_DB[gwansangId];
  const combined = CHARACTER_DB[characterResult.characterId];
  if (!faceOnly || !combined) return '';
  return `
    <div class="zbasis-compare">
      <div class="zbasis-compare-item">
        <span class="zbasis-compare-tag">관상 유형</span>
        <span class="zbasis-compare-name">${faceOnly.name}</span>
      </div>
      <span class="zbasis-compare-arrow material-symbols-outlined">arrow_forward</span>
      <div class="zbasis-compare-item is-final">
        <span class="zbasis-compare-tag">관상+사주 유형</span>
        <span class="zbasis-compare-name">${combined.name}</span>
      </div>
    </div>`;
}

// 헤드 타이틀 3분기(사용자 요청 2026-08-18b) — 인연도감(관상만)에서 이미 뽑은 캐릭터가 있는지,
// 있다면 이번 관상+사주 결과와 같은지에 따라 문구가 달라진다.
//  · 관상 캐릭터 없음            → "왜 OOO이 나왔을까요?"
//  · 관상 캐릭터 있음 + 같은 결과 → "사주를 더해도 여전히 OOO이에요!"
//  · 관상 캐릭터 있음 + 다른 결과 → "사주를 더하니 OOO이 되었어요!"
function characterBasisTitle(characterResult, gwansangId) {
  const name = (CHARACTER_DB[characterResult.characterId] || {}).name || '';
  if (!gwansangId) return `왜 ${name}이 나왔을까요?`;
  return gwansangId === characterResult.characterId
    ? `사주를 더해도 여전히 ${name}이에요!`
    : `사주를 더하니 ${name}이 되었어요!`;
}

// §2-A — 관상 근거와 사주 근거를 각각 풀어서 설명한다(사용자 요청 2026-08-18b: "관상의 어떤 특징과
// 사주의 어떤 특징 때문에 이 캐릭터가 됐는지 설명이 부족하다"). confidence 줄을 맨 앞 문장으로 옮긴다.
// 구체적인 DB 근거 라벨(용안·귀인성 등)은 여전히 노출하지 않고, TRAIT_FACE_PHRASE/TRAIT_SAJU_PHRASE로
// 풀어쓴 문장만 쓴다 — 결정론 원칙(고정 템플릿, AI 미사용)은 그대로 유지.
function characterBasisSummary(characterResult, character) {
  const { primaryTrait, secondaryTrait, balanced } = characterResult;
  const confidenceLine = characterConfidenceLine(characterResult);
  if (balanced) {
    return `${confidenceLine}<br>` +
      `얼굴과 사주 어느 한쪽으로 치우치지 않고 여섯 가지 힘이 고르게 나타났어요. 그래서 균형형인 <b>${character.name}</b>이 됐어요.`;
  }
  const fusionLine = `${TRAIT_FACE_LINK[primaryTrait]} ${TRAIT_FACE_PHRASE[secondaryTrait]}이 느껴지는 관상과, ` +
    `${TRAIT_SAJU_LINK[primaryTrait]} ${TRAIT_SAJU_PHRASE[secondaryTrait]}의 사주가 만나 <b>${character.name}</b>이 되었어요!`;
  return `${confidenceLine}<br>${fusionLine}`;
}

function renderCharacterBasis(elId, characterResult) {
  const el = document.getElementById(elId);
  if (!el) return;
  const character = characterResult && CHARACTER_DB[characterResult.characterId];
  if (!character) { el.innerHTML = ''; return; }

  const { traitScores, primaryTrait, secondaryTrait } = characterResult;
  const gwansangId = getGwansangOnlyCharacterId();

  // §2-A — 6대 기질은 바만, 숫자는 노출하지 않는다.
  // 이유: traitScores의 기준선(FACE_TRAIT_BASELINE 등)이 아직 실사용자 분포가 아닌 근사치라
  // "관계 38" 같은 숫자가 백분위처럼 읽히는 해상도를 보장할 수 없고, 낮은 숫자는 결함으로 읽혀
  // "약점은 shadow로만 표현한다"는 원칙과도 부딪힌다.
  // 사용자 요청 2026-08-18: 점수 높은 순으로 정렬한다 — 어차피 가장 진한(top2) 두 줄이 그대로 위로
  // 올라오니 "진하게 표시된 두 가지가 위에 있다"는 게 화면에서도 바로 보인다.
  const top = [primaryTrait, secondaryTrait];
  const sortedTraits = TRAITS.slice().sort((a, b) => (traitScores[b] || 0) - (traitScores[a] || 0));
  const bars = sortedTraits.map(t => `<div class="ztrait-row${top.includes(t) ? ' is-top' : ''}">
        <span class="ztrait-name">${TRAIT_LABEL_KO[t].slice(0, 2)}</span>
        <span class="ztrait-track"><span class="ztrait-fill" style="width:${Math.max(4, Math.min(100, traitScores[t]))}%;"></span></span>
      </div>`).join('');

  el.innerHTML = `
    <div class="zone-basis">
      <div class="zone-basis-title">${characterBasisTitle(characterResult, gwansangId)}</div>
      ${characterCompareBlock(characterResult)}

      <div class="ztrait-bars">${bars}</div>

      <div class="zone-basis-summary">${characterBasisSummary(characterResult, character)}</div>
    </div>`;
}

// 판정 근거(6대 기질 점수·Top2·신뢰도)는 화면에 노출하지 않는다 — 사용자 요청 2026-08-15:
// "판정 근거는 필요 없어, 그냥 콘솔로만 찍어". 값 자체는 requestPersonalAiRuleBased의 console.log
// ([16캐릭터] …)로 계속 확인할 수 있고, characterResult로도 state에 그대로 남아 있다.
function renderCharacterDetail(elId, characterResult, opts) {
  const el = document.getElementById(elId);
  if (!el) return;
  const character = characterResult && CHARACTER_DB[characterResult.characterId];
  if (!character) { el.innerHTML = ''; return; }

  const listHtml = (items, cls) => `<ul class="char-detail-list ${cls}">${items.map(s => `<li>${s}</li>`).join('')}</ul>`;
  const tags = getCompatibilityTags(character.id);
  const compatHtml = tags ? CHARACTER_COMPAT_GROUPS.map(g => {
    if (!tags[g.key] || !tags[g.key].length) return '';
    return `<div class="char-tag-group">
        <span class="char-tag-label">${g.label}</span>
        ${tags[g.key].map(t => `<span class="char-tag ${g.cls}">${t.name}</span>`).join('')}
      </div>`;
  }).join('') : '';

  // 노출스펙 §3-2 — 6대 기질 바. 숫자는 화면에 쓰지 않는다(T-score라 백분위로 오독되고,
  // 낮은 값이 결함으로 읽혀 "약점은 shadow로만 표현" 원칙과 충돌한다). Top2만 색으로 강조한다.
  // 통합분석은 판정 근거 영역(renderCharacterBasis)에서 같은 바를 이미 그리므로 여기선 생략한다 —
  // 안 그러면 한 화면에 기질 바가 두 번 나온다(opts.skipTraitBars).
  const scores = (opts && opts.skipTraitBars) ? null : (characterResult.traitScores || null);
  const top2 = [characterResult.primaryTrait, characterResult.secondaryTrait].filter(Boolean);
  const traitHtml = scores ? `
      <div class="char-detail-sec">
        <div class="char-detail-sec-title">당신을 만든 6가지 힘</div>
        <div class="char-trait-bars">
          ${CHARACTER_TRAIT_AXES.map(a => {
            const on = top2.indexOf(a.key) >= 0;
            const pct = Math.max(6, Math.min(100, Number(scores[a.key]) || 0));
            return `<div class="char-trait-row${on ? ' is-top' : ''}">
              <span class="char-trait-label">${a.label}</span>
              <span class="char-trait-track"><span class="char-trait-fill" style="width:${pct}%"></span></span>
            </div>`;
          }).join('')}
        </div>
        ${top2.length === 2 ? `<div class="char-trait-caption">이 두 가지가 만나 ${character.name}이 돼요</div>` : ''}
      </div>` : '';

  el.innerHTML = `
    <div class="char-detail">
      <div class="char-detail-headline">${character.headline}</div>
      ${traitHtml}

      <div class="char-detail-sec">
        <div class="char-detail-sec-title">조선시대의 나</div>
        <div class="char-detail-origin">${character.historical_role}</div>
      </div>
      <div class="char-detail-sec">
        <div class="char-detail-sec-title">지금의 나</div>
        <div class="char-detail-origin">${character.modernRole}</div>
      </div>

      <div class="char-detail-sec">
        <div class="char-detail-sec-title">이런 점이 강해요</div>
        ${listHtml(character.strengths, 'is-strength')}
      </div>
      <div class="char-detail-sec">
        <div class="char-detail-sec-title">이 힘이 너무 강해지면</div>
        ${listHtml(character.shadow, 'is-shadow')}
      </div>

      <div class="char-detail-sec">
        <div class="char-detail-sec-title">상황별로 보면</div>
        ${CHARACTER_SITUATION_FIELDS.filter(f => character[f.key]).map(f => `
          <details class="char-detail-acc">
            <summary>${f.icon} ${f.label}</summary>
            <div class="char-detail-row-text">${character[f.key]}</div>
          </details>`).join('')}
      </div>

      ${compatHtml ? `<div class="char-detail-sec">
        <div class="char-detail-sec-title">다른 관상과의 궁합</div>
        ${compatHtml}
      </div>` : ''}
    </div>`;
}

// ═══ 인연도감 "재방문 시 기존 도감 카드" (정책명세서 §3) ═══
// 이 프로젝트엔 서버·계정이 없어서 명세서가 말하는 "친구 N명 등록" 진행 상황은 실제로 추적할 수 없다.
// 대신 이 브라우저에 남은 마지막 결과만 localStorage로 가볍게 기억해뒀다가 "다시 보기"로 보여준다 —
// 사진·생년월일 등 원본 개인정보는 저장하지 않고 캐릭터 ID/이름/시각만 남긴다(명세서의 "최소 보관" 원칙).
const INYEON_LAST_CHARACTER_KEY = 'inyeonLastCharacter';
function saveLastCharacterToStorage(characterResult) {
  if (!characterResult || !characterResult.characterId) return;
  try {
    localStorage.setItem(INYEON_LAST_CHARACTER_KEY, JSON.stringify({
      characterId: characterResult.characterId,
      characterName: characterResult.characterName,
      // 6대 기질 바(노출스펙 §3-2)를 "다시 보기"에서도 그리려면 점수까지 남겨야 한다 —
      // 캐릭터 ID만 저장하던 때는 재방문 화면에서 기질 바 섹션이 통째로 빠졌다.
      // 얼굴 실측값이 아니라 계산된 지표라 사진·랜드마크를 저장하지 않는 원칙과 어긋나지 않는다.
      traitScores: characterResult.traitScores || null,
      primaryTrait: characterResult.primaryTrait || null,
      secondaryTrait: characterResult.secondaryTrait || null,
      basisLabel: characterResult.basisLabel || null,
      ts: Date.now(),
    }));
  } catch (e) { /* 프라이빗 브라우징 등으로 localStorage를 못 쓰면 조용히 스킵 */ }
}
function renderGwansangRevisitCard() {
  const card = document.getElementById('gwansangRevisitCard');
  const body = document.getElementById('gwansangRevisitBody');
  const label = document.getElementById('gwansangRevisitLabel');
  if (!card || !body) return;
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(INYEON_LAST_CHARACTER_KEY) || 'null'); } catch (e) { saved = null; }
  const character = saved && CHARACTER_DB[saved.characterId];
  if (!character) {
    card.style.display = 'none';
    if (label) label.style.display = 'none';
    return;
  }

  // "다시 보기" 버튼 대신 행 전체를 눌러 이동한다 — 오른쪽 화살표로만 이동 가능함을 알린다.
  body.innerHTML = `
    <div class="revisit-row" role="button" tabindex="0" onclick="reopenSavedCharacter('${character.id}')">
      <img class="revisit-thumb" src="${getCharacterIllustration(character.id)}" alt="${character.name}">
      <div class="revisit-body">
        <div class="revisit-name">${character.name}</div>
        <div class="revisit-desc">${character.headline}</div>
      </div>
      <button type="button" class="revisit-del" aria-label="도감 삭제" title="도감 삭제"
              onclick="event.stopPropagation();Dogam.deleteMyDogam()">
        <span class="material-symbols-outlined">delete</span>
      </button>
      <span class="revisit-arrow material-symbols-outlined">chevron_right</span>
    </div>
  `;
  card.style.display = '';
  if (label) label.style.display = '';
}
// localStorage에 저장된 캐릭터 ID만으로 카드·상세 설명을 다시 그린다 — 원본 사진/랜드마크가 없어도
// character-db.js 데이터만으로 완성되는 화면이라 재분석 없이 그대로 재현 가능하다.
// DOM을 채우는 부분만 별도 함수로 뺐다 — Dogam.render()가 이미 진행 중인 곳(인연도감의
// paintOwnerView, 공유 링크 재방문 등)에서도 안전하게 쓸 수 있어야 하는데, reopenSavedCharacter를
// 그대로 부르면 그 안의 Dogam.render() 호출과 서로가 서로를 부르는 무한 재귀가 된다.
function populateGwansangReportFromSaved(characterId) {
  // 저장해둔 기질 점수까지 함께 복원한다 — 없으면 6대 기질 바가 빠져 최초 결과 화면과 구조가 달라진다.
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(INYEON_LAST_CHARACTER_KEY) || 'null'); } catch (e) { saved = null; }
  const restored = (saved && saved.characterId === characterId) ? saved : {};
  const fake = {
    characterId: characterId,
    characterName: restored.characterName || null,
    traitScores: restored.traitScores || null,
    primaryTrait: restored.primaryTrait || null,
    secondaryTrait: restored.secondaryTrait || null,
    basisLabel: restored.basisLabel || null,
  };
  renderCharacterCard('gwansangCharacterCard', fake);
  renderCharacterDetail('gwansangCharacterDetail', fake);
  document.getElementById('canvasCard').classList.remove('hidden');
  document.getElementById('gwansangResult').classList.remove('hidden');
  markAnalyzed('gwansang');
}
function reopenSavedCharacter(characterId) {
  populateGwansangReportFromSaved(characterId);
  try { localStorage.setItem(GWANSANG_REPORT_OPEN_KEY, '1'); } catch (e) {} // 새로고침해도 이 화면 유지
  if (window.Dogam) Dogam.render();
  document.getElementById('canvasCard').scrollIntoView({ behavior: 'smooth' });
}
renderGwansangRevisitCard();

// 룰베이스 분류 → 16캐릭터 판정까지. 관상보기(사주 없음)와 통합분석(사주 포함)이 같은 엔진을 쓰도록
// 공용으로 뺐다. cfg.pillars가 있으면 그대로 융합되므로 통합분석은 "관상70 + 사주30" 캐릭터가 나온다
// (통합분석 화면_콘텐츠_스펙_260817.md Zone1).
function classifyAndBuildCharacter(ctx, cfg, lm) {
  const { ids, confidences } = classifyAllFeaturesRuleBased(lm);
  state[ctx].archetypeAnalysis = extractArchetypeAnalysis(ids);
  state[ctx].ruleBasedConfidences = confidences;

  renderArchetypes(cfg.archetypeId, ids.eye_archetype_id, ids.face_archetype_id, 'rule', cfg.hideShapeDetails ? null : ids, null, cfg.genderVal, cfg.shapeDetailId, cfg.personLabel);

  const ratios = getGwansangRatios(lm);
  const partStatusMap = judgePartStatus(ratios);
  const characterResult = computeCharacterResult({
    featureIds: ids,
    confidences,
    partStatusMap,
    pillars: cfg.pillars || null,
    ohaengCounts: cfg.pillars ? computeOhaeng(cfg.pillars) : null,
    sinsalList: cfg.pillars ? collectSajuInsightSummary(cfg.pillars).sinsalList : null,
    gwiinList: cfg.pillars ? collectSajuInsightSummary(cfg.pillars).gwiinList : null,
    hasHour: cfg.pillars ? cfg.pillars[3].stem >= 0 : false,
  });
  state[ctx].characterResult = characterResult;
  // 이 시점부터 형상 분류는 확정이다 — 뒤이어 도는 Gemini 호출이 자기 분류로 덮어쓰지 못하게 막는다.
  // (getOrRequestPersonalAiData가 이 플래그를 보고 archetypeAnalysis 갱신을 건너뛴다)
  state[ctx].archetypeIsRuleBased = true;
  if (characterResult) console.log(`[16캐릭터] ${ctx}:`, characterResult);
  return { ids, confidences, characterResult };
}

function requestPersonalAiRuleBased(ctx, cfg, lm) {
  const { characterResult } = classifyAndBuildCharacter(ctx, cfg, lm);

  // #canvasCard 자리를 캐릭터 일러스트 카드로 쓰기로 함(사용자 요청 2026-08-14) — 관상보기 탭 한정.
  // 그 아래 리포트 안에는 같은 캐릭터의 상세 설명을 펼친다(사용자 요청 2026-08-15).
  if (ctx === 'gwansang') {
    renderCharacterCard('gwansangCharacterCard', characterResult);
    renderCharacterDetail('gwansangCharacterDetail', characterResult);
    saveLastCharacterToStorage(characterResult);
  }

  // requestDeepReport가 뒤이어 getOrRequestPersonalAiData(Gemini 분류 호출)로 이 값을 덮어쓰지
  // 못하게 막는 플래그 — 안 막으면 방금 만든 룰베이스 결과가 Gemini 재호출로 다시 흔들린다.
  state[ctx].archetypeIsRuleBased = true;
}

async function requestPersonalAi(ctx) {
  const lm = state[ctx].lm;
  if (!lm) return;


  const cfg =
    (CTX_CONFIG[ctx] || CTX_CONFIG.combined)();

  if (ctx === 'gwansang') {
    requestPersonalAiRuleBased(ctx, cfg, lm);
    return;
  }

  // ── 통합분석: 형상 분류와 캐릭터 판정은 룰베이스로 통일한다 (스펙 §8-1) ──
  // 예전엔 Gemini가 9종을 분류했는데, 그 결과는 재현되지 않아 같은 사진을 다시 분석하면 유형이
  // 바뀔 수 있었다(§38 QA 기준 "동일 사진 재분석 시 캐릭터 ID 동일률 ≥95%" 미충족 위험).
  // Zone1 캐릭터가 그 위에 서는 순간 캐릭터까지 흔들리므로 관상보기 탭과 같은 룰베이스로 맞췄다.
  // Gemini는 아래에서 계속 호출하되 "부위별 한 문장 보완"만 담당하고 분류는 덮어쓰지 않는다.
  let ruleBased = null;
  if (ctx === 'combined') {
    ruleBased = classifyAndBuildCharacter(ctx, cfg, lm);
    renderCharacterCard('cmbCharacterCard', ruleBased.characterResult);
    renderCharacterBasis('cmbCharacterBasis', ruleBased.characterResult);
    // 기질 바는 바로 위 renderCharacterBasis가 이미 그린다 — 중복 노출 방지
    renderCharacterDetail('cmbCharacterDetail', ruleBased.characterResult, { skipTraitBars: true });
  }

  // Gemini가 없으면 기존 룰베이스 fallback 유지.
  if (!isGeminiConfigured()) {
    if (ruleBased) return; // 통합분석은 이미 룰베이스로 그렸다
    renderArchetypesFallback(
      cfg.archetypeId,
      lm,
      null,
      cfg.genderVal,
      cfg.personLabel
    );

    return;
  }


  const imageDataUrl =
    getCleanImageDataUrl(ctx, cfg.canvasId);

  const ratios =
    getGwansangRatios(lm);

  const statusMap =
    judgePartStatus(ratios);


  try {
    // requestDeepReport와 동일한 AI 분류 결과를 공유한다.
    const data =
      await getOrRequestPersonalAiData(
        ctx,
        cfg,
        lm,
        imageDataUrl,
        ratios,
        statusMap
      );


    renderPartAdditions(
      cfg.cardsId,
      data.part_additions
    );


    const hasAnyArchetype =
      data.eye_archetype_id ||
      data.face_archetype_id ||
      data.forehead_type_id ||
      data.eyebrow_type_id ||
      data.eye_shape_id ||
      data.nose_shape_id ||
      data.mouth_shape_id ||
      data.chin_shape_id ||
      data.face_shape_type_id;


    // 통합분석은 위에서 룰베이스로 이미 그렸다 — Gemini 분류로 덮어쓰면 Zone1 캐릭터의 근거와
    // Zone3 형상 카드가 서로 다른 유형을 가리키게 된다(스펙 원칙 1 위반).
    if (ruleBased) return;

    if (hasAnyArchetype) {
      renderArchetypes(
        cfg.archetypeId,
        data.eye_archetype_id,
        data.face_archetype_id,
        false,
        cfg.hideShapeDetails ? null : data,
        null,
        cfg.genderVal,
        cfg.shapeDetailId,
        cfg.personLabel
      );
    } else {
      renderArchetypesFallback(
        cfg.archetypeId,
        lm,
        null,
        cfg.genderVal,
        cfg.personLabel
      );
    }

  } catch (e) {
    console.error(
      '[Gemini 호출 실패]',
      e
    );

    if (ruleBased) return; // 분류는 이미 룰베이스로 확보돼 있어 fallback 문구가 필요 없다
    renderArchetypesFallback(
      cfg.archetypeId,
      lm,
      e.message,
      cfg.genderVal,
      cfg.personLabel
    );
  }
}

// runGungham() 로컬 궁합 분석이 끝난 직후 자동으로만 호출됨(수동 버튼 없음 — requestPersonalAi와 동일한 원칙).
// 키가 없으면 조용히 스킵(기본 궁합 리포트만으로도 충분한 볼거리가 있어 에러를 띄우지 않음). 키가 있는데
// 호출이 실패해도 실패 사유를 화면에 보여주지 않는다(사용자 피드백) — 로컬 궁합 리포트로 화면이 비지
// 않으니 그걸로 충분하고, 실패 사유는 콘솔에만 남겨 개발자가 확인한다.
// 히어로/Zone1/Zone2의 AI 텍스트 슬롯만 채운다 — 이 함수가 도는 동안 화면 전체는 #ggAnalyzing
// 로딩 카드에 가려져 있으므로(runGungham 참고), 슬롯 단위 스켈레톤은 따로 두지 않는다.
async function requestCoupleAi() {
  const cache = state.gungham.cache;
  if (!cache || !isGeminiConfigured()) { fillGunghapAiFallback(); return; }

  const images = [];
  const canvasA = document.getElementById('gunghamCanvasA'), canvasB = document.getElementById('gunghamCanvasB');
  if (state.gunghamA.lm && canvasA.width) images.push(getCleanImageDataUrl('gunghamA', 'gunghamCanvasA'));
  if (state.gunghamB.lm && canvasB.width) images.push(getCleanImageDataUrl('gunghamB', 'gunghamCanvasB'));

  try {
    const sys = buildGunghapSystemInstruction(cache.nameA || '나', cache.nameB || '상대방');
    const userText = buildGunghapUserPrompt(cache);
    const data = await callGeminiAPI(sys, userText, images, GUNGHAP_REPORT_SCHEMA);
    renderGunghapResult(data);
  } catch (e) {
    console.error('[Gemini 커플 해석 실패]', e);
    fillGunghapAiFallback();
  }
}
