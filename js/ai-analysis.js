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
- "사망", "요절", "재앙" 같은 단정적 흉조 표현 금지. 항상 건설적이고 긍정적으로 재해석하세요.
- growth_guidance, zone3_ohaeng_reading처럼 snake_case로 된 내부 필드명·변수명을 문장에 그대로 쓰지 마세요. "위 조언", "앞서 설명한 성향"처럼 사람이 읽는 말로 풀어서 가리키세요(사용자 리포트: "growth_guidance에서 강조한..."이라고 쓰면 사용자는 무슨 말인지 모른다).`;

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
// 그대로 쓴다 — AI에게 숫자를 맡기면 화면에 이미 떠 있는 참고용 점수(ggHeroTotalNum)와 어긋날 수 있어서,
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
- 아래 데이터에 실제로 없는 신살·귀인·관상 유형을 새로 만들어내지 말 것

[Zone2 11개 항목 — 중복 방지, 반드시 지킬 것]
같은 문장·결론·비유를 여러 항목에서 반복하지 마세요. 11개는 서로 다른 각도에서 써야 합니다.
- hero_reason은 "대표 장점 1개씩"만 가볍게 언급하는 자리이니, zone1_shape_reading에서 그 장점을
  다시 풀어쓰지 말고 관상 유형 "조합" 자체(비유·시너지)에 집중하세요.
- overall_relationship은 관계 전체를 요약하는 큰 그림만 다루고, sinsal_combo나 strengths에서 다룰
  구체적인 신살·귀인 조합이나 개별 강점을 여기서 먼저 설명하지 마세요.
- perceived_by_partner와 perceived_by_me는 반드시 서로 다른 시선이어야 합니다(상대가 나를 보는 인상
  vs 내가 상대를 보는 인상) — 같은 성향 묘사를 주어만 바꿔서 반복하면 안 됩니다.
- strengths·mind_hacking·after_marriage·complement_needed는 전부 "관계가 좋다/보완된다"는 결론으로
  흐르기 쉬운 항목들입니다 — 매번 다른 데이터(신살, 귀인, 십성, 오행, 관상 실측 등 [나/상대방의
  신살·귀인 목록]·[오행 분포] 중 아직 안 쓴 것)를 근거로 삼아 서로 다른 장면을 그리세요. 이미 다른
  항목에서 근거로 쓴 신살·귀인 이름을 또 써도 되지만, 그 항목과 같은 해석·결론을 복사하듯 반복하면
  안 됩니다.
- 항목을 쓰기 전에 "바로 앞 항목에서 이미 한 말인가?"를 스스로 점검하고, 겹치면 다른 데이터나 다른
  관점으로 바꿔 쓰세요.`;
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
// 통합분석 Zone4 카드 제목 — ⚠️ 2026-08-21 수정: "후보뱅크에서 골라 쓰거나 살짝 변형"하는 하이브리드로
// 만들었었는데, AI가 이 예시 문장을 그대로(또는 단어만 살짝 바꿔) 베껴 쓰는 문제가 실제로 나왔다
// (사용자 리포트). "고를 수 있는 후보"로 제시하면 그대로 골라버리니, 톤/형식만 참고하고 반드시 새로
// 쓰게 "말투 참고용"으로만 프롬프트에 넣는다 — 아래는 후보가 아니라 참고 예시일 뿐이다.
const CMB_ZONE4_TITLE_STYLE_EXAMPLES = [
  '누가 뭐래도 당신은 모두가 기댈 수 있는 든든한 산',
  '재물 바다를 품은 거대한 태산, 스케일이 다른 K-여사장님 재질',
  '알잘딱깔센 재테크의 신, 근데 통제는 살짝 힘들어함',
  '사장님 할 거 아니면 답답해서 어찌 사시나? 팩폭 들어갑니다',
  '돈 복은 타고났네, 머니 파이프라인 심는 재능 만렙',
  '연애는 프리스타일, 결혼은 비혼주의? No, 숨은 인연 찾기',
  '아버지는 태평양, 어머니는 등대... 나는 그 사이의 섬',
  '서울보다는 강릉, 해외는 캐나다? 따스한 햇살과 숲이 필요해',
  '애증의 K-가족, 그래도 내 편인 거 알지?',
  '인싸인 듯 아싸, 아싸인 듯 인싸',
];

// Zone4 사랑/일 카드 각도 — 통합분석 리포트 구성.md §4(2026-08-20). "어떤 상황이면 어떤 각도로
// 풀지"는 q1/q2 값을 보고 여기서 룰베이스로 정하고, 그 각도 안의 실제 문장은 AI가 자유 생성한다.
// q1/q2가 아래 표에 없으면(미답변·"직접 입력할게요"로 커스텀 텍스트를 쓴 경우 등) 기존 기본 각도로 폴백.
function buildLoveCardGuidance(q1) {
  if (q1 === '결혼했어요') {
    return '- love(사랑): 이 사람은 기혼입니다 — "연애·결혼 스타일" 카드 대신 반드시 3개 카드로 순서대로 구성: 카드1 "매력·인기"(기존과 동일 — [사주 신살·귀인 목록]의 홍염살·년살 + [AI 관상 분류 결과]의 매력 계열 눈 유형), 카드2 "결혼 생활 스타일"(배우자와 함께 살아가는 방식), 카드3 "아이가 생기면"(자녀와의 관계·육아 성향 — 실제 자녀 유무·성별을 단정하지 말고 "이런 기질이 아이를 대하는 방식에 어떻게 나타날지" 중심으로). 이 경우 love만 3개라 zone4_cards 전체 카드 수는 최소 9개.';
  }
  if (q1 === '새로운 출발 (돌싱/기타)') {
    return '- love(사랑): 이 사람은 새로운 출발(돌싱/기타)을 앞두고 있습니다 — 순서대로 카드1 "매력·인기"(기존과 동일), 카드2 "다시 시작하는 인연"("연애·결혼 스타일" 대신 — 새로운 사람을 만날 때 달라진 점, 지금 시점에서의 연애관).';
  }
  return '- love(사랑): ⚠️ 순서대로 카드1 "매력·인기"(신규, 먼저), 카드2 "연애·결혼 스타일"(기존, 나중) — 이 순서를 반드시 지킬 것(가볍게 시작해서 구체적인 스타일로 들어가는 흐름). 카드1은 [사주 신살·귀인 목록]의 홍염살·년살 같은 매력 계열 신살과, [AI 관상 분류 결과]의 눈 유형(도화안·난안처럼 매력·사교성 계열)을 엮어서 "주변에 인기가 많은지"를 풀이할 것 — 둘 다 없으면 이 카드는 억지로 만들지 말고 love를 다른 세부 카드(예: 연애할 때의 진심 표현 방식)로 채울 것. 카드2는 연애·결혼에서 추구하는 스타일.';
}
function buildWorkCardGuidance(q2) {
  const sipseongNote = '[십성 목록] 조합(상관=말재주·표현력, 편관=카리스마·결단력, 편인=독창성, 정관=책임감·조직 적응 등)을 근거로 쓸 것.';
  const map = {
    '학생': `- work(일): 이 사람은 학생입니다 — 조직 생활 대신 진로로 방향을 바꿔서, ${sipseongNote} 이 성향과 어울리는 전공·직업 적성을 제시할 것.`,
    '취업 준비중': `- work(일): 이 사람은 취업 준비 중입니다 — ${sipseongNote} ⚠️ 성향만 설명하고 끝내지 말 것("체계적으로 계획을 세우고 꼼꼼해요" 같은 서술만으로 마무리 금지). reading 앞부분에 실제 직무·직군명을 최소 1개 이상 구체적으로 명시할 것(예: 기획, 마케팅, 영업, 연구개발(R&D), 디자인, 인사(HR), 재무·회계, 생산·품질관리, CS/고객대응, 콘텐츠·PD 등 중 이 성향과 맞는 것을 골라서) — "당신은 OO 직무/직군이 잘 맞아요, 이런 성향이 있어서예요"의 흐름으로 쓰고, 그 다음에 성향 설명을 이어갈 것.`,
    '주부': `- work(일): 이 사람은 주부입니다 — ${sipseongNote} 가정을 이끌어가는 스타일을 중심으로 쓰고, 이 성향이 사회활동·부업으로 이어진다면 어떤 방향이 잘 맞을지도 함께 짚을 것.`,
    '자영업/프리랜서': `- work(일): 이 사람은 자영업/프리랜서입니다 — ${sipseongNote} 조직 소속이 아니라 혼자 일을 이끌 때의 강점·주의할 점(사업가 기질)을 전면에 다룰 것.`,
    '은퇴함': `- work(일): 이 사람은 은퇴했습니다 — ${sipseongNote} ⚠️ "여유로운 일상 속 소일거리" 같은 뭉뚱그린 표현만 쓰고 끝내지 말 것 — 구체적으로 어떤 종류의 활동인지 최소 1개 이상 명시할 것(예: 정관·편인 조합이면 강의·멘토링·재능기부처럼 경험을 전수하는 활동, 편관·편재면 작게라도 다시 사업을 벌이거나 투자·재테크를 주도하는 활동, 식신·정인이면 공방·원예·요리 같은 손으로 만드는 창작 활동이나 봉사, 상관이면 글쓰기·강연·SNS처럼 표현하는 활동 — [십성 목록]에 실제로 있는 조합에 맞는 방향을 골라서). reading 앞부분에 "OO 같은 활동이 잘 맞아요, 이런 성향이 있어서예요"의 흐름으로 쓰고, 그 다음에 지금까지 쌓아온 경험과 어떻게 이어지는지를 설명할 것.`,
  };
  return map[q2] || `- work(일): ${sipseongNote} 구체적인 직업 성향을 풀이할 것. Zone1 캐릭터 카드의 work 문구를 그대로 반복하지 말고, 십성 근거로 더 구체적인 스타일을 추가할 것.`;
}

function buildPersonalDeepReportSchema(hasSaju, hasFace, q1, q2) {
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

    early_life_headline: {
      type: 'STRING',
      description:
        '초년운(~29세) 문단 바로 위에 붙는 짧은 헤드 카피. 반드시 한 줄(줄바꿈 없이)로 끝낼 것 — "주변의 기대를 품고 스스로의 기준을 단단하게 다져가던 시기" 정도 길이를 넘지 말 것. 이 시기의 핵심을 한 문장으로 압축.'
    },

    early_life: {
      type: 'STRING',
      description:
        '초년운(~29세)을 3~5문장으로. [관상 실측 데이터]와 [사주 정보]가 둘 다 있으면 반드시 둘 다 근거로 섞어서 쓸 것(관상만 또는 사주만으로 쓰지 말 것). 실제 삶과 비교할 수 있는 성향·환경·선택 패턴 위주로 서술. 지나치게 구체적인 사건을 지어내지 말 것. ⚠️ [화면에 이미 표시된 대운 시기 흐름]이 주어졌다면, 이 구간(~29세)에 해당하는 항목의 십이운성·뜻을 반드시 그대로 따를 것 — 거기 없는 다른 십이운성 명칭이나 뜻을 새로 끌어오거나 어긋나는 서술을 하지 말 것. [사주 신살·귀인 목록]의 십이운성(사주 원국 자체 십이운성)은 나이 흐름과 무관한 별개 데이터이므로 초년/중년/말년 서사에 쓰지 말 것.'
    },

    mid_life_headline: {
      type: 'STRING',
      description:
        '중년운(30~59세) 문단 바로 위에 붙는 짧은 헤드 카피. 반드시 한 줄(줄바꿈 없이)로 끝낼 것 — "주변의 기대를 품고 스스로의 기준을 단단하게 다져가던 시기" 정도 길이를 넘지 말 것.'
    },

    mid_life: {
      type: 'STRING',
      description:
        '중년운(30~59세)을 3~5문장으로. [관상 실측 데이터]와 [사주 정보]가 둘 다 있으면 반드시 둘 다 근거로 섞어서 쓸 것. 사회생활·관계·책임·선택 방식처럼 현실적으로 확인 가능한 패턴 위주로 설명. ⚠️ [화면에 이미 표시된 대운 시기 흐름]이 주어졌다면, 이 구간(30~59세)에 해당하는 항목의 십이운성·뜻을 반드시 그대로 따를 것 — 거기 없는 다른 십이운성 명칭이나 뜻을 새로 끌어오거나 어긋나는 서술을 하지 말 것. [사주 신살·귀인 목록]의 십이운성(사주 원국 자체 십이운성)은 나이 흐름과 무관한 별개 데이터이므로 초년/중년/말년 서사에 쓰지 말 것.'
    },

    late_life_headline: {
      type: 'STRING',
      description:
        '말년운(60세~) 문단 바로 위에 붙는 짧은 헤드 카피. 반드시 한 줄(줄바꿈 없이)로 끝낼 것 — "주변의 기대를 품고 스스로의 기준을 단단하게 다져가던 시기" 정도 길이를 넘지 말 것.'
    },

    late_life: {
      type: 'STRING',
      description:
        '말년운(60세~)을 3~5문장으로. [관상 실측 데이터]와 [사주 정보]가 둘 다 있으면 반드시 둘 다 근거로 섞어서 쓸 것. 단정적인 미래예언이 아니라 성향이 어떻게 성숙하거나 안정되는지 중심으로 설명. ⚠️ [화면에 이미 표시된 대운 시기 흐름]이 주어졌다면, 이 구간(60세~)에 해당하는 항목의 십이운성·뜻을 반드시 그대로 따를 것 — 거기 없는 다른 십이운성 명칭이나 뜻을 새로 끌어오거나 어긋나는 서술을 하지 말 것. [사주 신살·귀인 목록]의 십이운성(사주 원국 자체 십이운성)은 나이 흐름과 무관한 별개 데이터이므로 초년/중년/말년 서사에 쓰지 말 것. ⚠️ 마지막 1문장은 지금까지의 풀이 전체를 관통하는 이 사람의 애씀·강점을 따뜻하게 알아주는 위로 한마디로 마무리할 것(예: "스스로를 태워 여기까지 온 만큼, 이제는 잠시 내려놓아도 괜찮아요" 같은 톤 — 그대로 베끼지 말고 이 사람의 실제 풀이 내용에서 나온 표현으로 새로 쓸 것).'
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
    'early_life_headline',
    'early_life',
    'mid_life_headline',
    'mid_life',
    'late_life_headline',
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
        '[사주 신살·귀인 목록]에 실제 존재하는 항목만 사용해 4~6문장으로 해석. 없는 신살이나 귀인을 창작하지 말 것. ⚠️ 목록을 그냥 나열하지 말 것 — 먼저 이 사람이 가진 신살·귀인의 개수·다양성 자체가 무슨 의미인지 한 문장으로 짚고(예: 여러 개면 "인생에 굴곡이나 전환점이 잦은 편", 적으면 "무난하고 평탄한 흐름"), 그 다음 같은 방향을 가리키는 항목들을 조합해서(예: 홍염살+년살 → "매력") 1~2개 이야기로 묶어서 풀이할 것. 신살은 전부 나쁜 게 아니라 길신(귀인)·흉살이 섞여 있다는 것도 자연스럽게 짚을 것. ⚠️ "다양한 기운들이 조화롭게 섞여 있다" 같은 뭉뚱그린 문장으로 때우지 말고, 이 문장 안에서도 실제로 근거로 쓴 신살·귀인 이름을 최소 2개 이상 그대로 언급할 것(예: "홍염살과 문곡귀인이 있어서").'
    };

    properties.sinsal_basis = {
      type: 'STRING',
      description:
        '위 신살·귀인 풀이가 어떤 데이터를 근거로 나왔는지 2~4문장으로 밝히는 "왜 이렇게 풀이했나요?" 영역. ⚠️ 반드시 구체적으로 인용할 것 — 일간 오행(예: "일간 갑목(甲木)"), 어느 기둥(년주/월주/일주/시주)에 있는지, 신살·귀인의 실제 명칭을 그대로 쓸 것. "다양한 기운" "여러 살" 같은 추상적 표현만 쓰는 것은 금지 — 반드시 [사주 신살·귀인 목록]에 실제로 있는 이름을 문장에 그대로 적을 것.'
    };

    required.push(
      'ohaeng_reading',
      'sinsal_reading',
      'sinsal_basis'
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
        },

        required: [
          'section_key',
          'title',
          'interpretation',
          'analysis_basis',
          'principle'
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
  // 의미가 있다. 통합분석 리포트 구성.md §1·§2 개편(2026-08-21) — Zone2 히어로(헤드/케미점수)는
  // 이미 룰베이스(computeGwansangSajuChemi)로 계산되므로 AI는 그 숫자를 설명만 하고 새로 짓지
  // 않는다(궁합보기 hero_reason과 동일 원칙). Zone3 데이터 페어 3개의 융합풀이, Zone4 스토리
  // 카드(고정 1 + 가변 1~3)가 이 블록으로 채워진다.
  if (hasSaju && hasFace) {
    // 통합분석 리포트 구성.md §4(2026-08-21 4차 개편) — "개인 기질"·"남이 모르는 내 모습"은
    // 처음엔 각각 zone3_ohaeng_reading 보강/personality_detail 조건부 강화로 흡수했었는데, 실제
    // 개인 서술이 화면에 안 보인다는 피드백으로 Zone4 전용 고정 카드(zone4_temperament_*/
    // zone4_hidden_self_*)로 독립시켰다. growth_guidance도 이번에 Zone4 고정카드4("조언")로
    // 재활용한다 — 근거만 아래에서 hasSaju&&hasFace 전용으로 보강.
    properties.growth_guidance.description +=
      ' 통합분석 화면에서는 이 필드가 Zone4 마지막 고정 카드("조언")로도 노출된다 — [십성 목록]·[신강/신약]·[용신]·[사주 신살·귀인 목록]·[관상 실측 데이터] 중 이 리포트 전체에서 이미 다룬 근거를 종합해서, "당신은 ~형이에요"(정체성 선언)가 아니라 "그래서 지금은 ~하면 좋아요"(방향 제시)로 마무리할 것.';

    properties.zone2_review = {
      type: 'STRING',
      description:
        '[관상x사주 케미 점수]가 왜 그렇게 나왔는지 설명하는 총평 3~5문장. 점수는 이미 계산되어 주어지므로 새로운 숫자를 만들지 말고, 관상에서의 근거 1개와 사주에서의 근거 1개를 섞어 그 점수를 뒷받침할 것.'
    };

    // Zone2 "둘이 같은 점 / 다른 점"(2026-08-22 추가) — 케미 점수·총평만으로는 "그래서 구체적으로
    // 뭐가 같고 뭐가 다른지"가 안 보인다는 사용자 요청으로, [관상 6기질 점수]와 [사주 6기질 점수]를
    // 직접 대조해서 뽑는 짧은 불릿을 추가한다. 두 블록 모두 이미 같은 baseline(0~100)으로 계산돼
    // 있으므로 AI는 그 값을 비교만 하고 새로 점수를 만들지 않는다(§2 판단기준 1번과 동일 원칙).
    properties.zone2_common_points = {
      type: 'ARRAY',
      minItems: 2,
      maxItems: 3,
      items: { type: 'STRING' },
      description:
        '[관상 6기질 점수]와 [사주 6기질 점수] 모두에서 상대적으로 높게 나온 기질 2~3개를 골라, 각각 "실행력이 강함"·"책임감/완수력이 강함"처럼 8~14자 내외의 짧은 구문으로 표현. 기질 원어(lead/strategy/drive/social/stability/sense)나 숫자를 그대로 노출하지 말고 자연스러운 한국어 표현으로 바꿀 것.'
    };

    properties.zone2_different_points = {
      type: 'ARRAY',
      minItems: 1,
      maxItems: 2,
      items: {
        type: 'OBJECT',
        properties: {
          face: {
            type: 'STRING',
            description: '이 기질이 관상 쪽에서 드러나는 모습 — 8~16자 내외 짧은 구문. 예: "밖으로 밀어붙이는 힘"'
          },
          saju: {
            type: 'STRING',
            description: '같은 기질(또는 대비되는 기질)이 사주 쪽에서 드러나는 모습 — face와 대비되게, 8~16자 내외. 예: "안에서 신중하게 판단하는 힘"'
          }
        },
        required: ['face', 'saju']
      },
      description:
        '[관상 6기질 점수]와 [사주 6기질 점수]의 순위가 서로 엇갈리는 지점 1~2개를 골라, 관상 쪽 표현(face)과 사주 쪽 표현(saju)을 대비해서 서술. 같은 기질이 한쪽은 높고 한쪽은 낮을 때, 혹은 1순위 기질 자체가 서로 다를 때를 근거로 쓸 것 — 지어내지 말고 실제 점수 차이가 있는 기질만 쓸 것.'
    };

    properties.zone3_manseryeok_reading = {
      type: 'STRING',
      description:
        '[사주 원국]과 [관상 6기질 점수]를 함께 근거로 들어, 타고난 사주 구조와 얼굴에 드러난 기질이 어떻게 이어지는지 3~4문장으로 설명. ⚠️ 순수 비교만 할 것 — 신강/신약·용신 판단은 Zone4 고정카드("나의 기질")에서 별도로 다루니 여기서는 언급하지 말 것(중복 방지). ⚠️ "차분하고 신중한 에너지" 같은 뭉뚱그린 표현만 쓰지 말고, 문장 안에 일간 오행(예: "일간 갑목")과 관상 6기질 중 실제로 높게 나온 기질 이름을 최소 하나씩 그대로 언급할 것.'
    };

    properties.zone3_manseryeok_basis = {
      type: 'STRING',
      description:
        '위 만세력x기질 풀이가 어떤 데이터를 근거로 나왔는지 1~3문장으로 밝히는 "왜 이렇게 풀이했나요?" 영역. ⚠️ 반드시 구체적으로 인용할 것 — 일간 오행(예: "일간 갑목(甲木)")과 [관상 6기질 점수]에서 실제로 높게/낮게 나온 기질명·점수를 그대로 쓸 것. "두 데이터 모두에서 드러나요" 같은 추상적 마무리만 쓰는 것은 금지.'
    };

    properties.zone3_ohaeng_reading = {
      type: 'STRING',
      description:
        '[사주 오행 분포]와 [관상 오행 분포]를 비교해서 두 오행이 서로 겹치는 부분과 다른 부분을 3~4문장으로 설명. 오행의 한자를 괄호 병기하지 말 것. ⚠️ 어느 쪽이 더 높은지는 [오행 비교표]에 오행별로 이미 계산돼 있다 — 그 표의 "더높은쪽"·"차이_관상마이너스사주" 값을 그대로 따르고, [사주 오행 분포]·[관상 오행 분포] 원본 숫자로 직접 다시 비교·계산하지 말 것(두 블록은 스케일이 달라 — 사주는 8글자 중 개수, 관상은 0~100 퍼센트 — 직접 비교하면 방향이 틀리기 쉬움). [오행 비교표]에서 차이가 큰(5%p 이상) 오행만 "다른 부분"으로 짚을 것. "관상이 사주의 부족한 기운을 보완/받쳐준다" 같은 표현은 더높은쪽이 "관상"인 오행에만 쓸 것 — 반대는 금지. 차이가 5%p 미만(더높은쪽 "동일" 포함)인 오행은 "겹친다/비슷하다"고만 쓰고 보완 서사를 만들지 말 것. ⚠️ 오행 zero(0개)나 과다(3개 이상)에 대한 개인 서사, 용신(필요 오행) 언급은 여기서 하지 말 것 — Zone4 고정카드("나의 기질")에서 전담한다(중복 방지).'
    };

    properties.zone3_daeun_reading = {
      type: 'STRING',
      description:
        '[대운 정보]와 [삼정 비율(상정/중정/하정 = 초년/중년/말년)]을 함께 근거로 들어, 인생 시기별 흐름이 사주와 얼굴 양쪽에서 어떻게 나타나는지 3~4문장으로 설명. ⚠️ [화면에 이미 표시된 대운 시기 흐름]이 주어졌다면 그 목록의 십이운성·뜻과 어긋나는 명칭·서술을 새로 만들지 말 것 — 바로 위 "대운x삼정 타임라인" 위젯에 같은 계산 결과가 이미 노출되어 있어 모순되면 바로 눈에 띔.'
    };

    // Zone4 고정카드 2~4(2026-08-21 4차 개편) — "나는 누구인가"를 다루는 순수 개인 서술. 제목은
    // 룰베이스 고정 문구(renderZone4FixedExtra)로 붙이고, 여기서는 reading/basis만 받는다.
    properties.zone4_temperament_reading = {
      type: 'STRING',
      description:
        'Zone4 고정카드2("나의 기질") 본문 3~5문장. [사주 오행 분포]의 zero(0개)·과다(3개 이상) 오행을 먼저 짚고, [신강/신약]·[용신(필요 오행)]을 이어서 근거로 엮을 것 — 셋을 따로따로 나열하지 말고 "이 사람의 에너지 밸런스"라는 하나의 이야기로 묶을 것. [관상 오행 분포]·[관상 6기질 점수]도 함께 근거로 섞을 것. 오행 zero가 있으면 비유적으로 표현해도 좋음(예: "뿌리내릴 흙이 없는 나무").'
    };
    properties.zone4_temperament_basis = {
      type: 'STRING',
      description:
        '위 풀이의 근거를 1~3문장으로 — 실제 사용한 오행 개수·[신강/신약]·[용신] 값을 구체적으로 짚을 것.'
    };

    properties.zone4_hidden_self_reading = {
      type: 'STRING',
      description:
        'Zone4 고정카드3("남이 모르는 내 모습") 본문 3~5문장. 관상에서 보이는 겉인상(예: 강해 보이는 얼굴형, 날카로운 눈매)과 사주(오행·십성 — 예: 편인·정인 같은 섬세한 십성, 감성적인 오행)에서 드러나는 실제 성향이 서로 다른 얘기를 하고 있다면 그 반전을 중심으로 쓸 것. 관상과 사주가 같은 얘기만 하면 억지로 반전을 만들지 말고 "겉과 속이 같은 사람"이라는 방향으로 풀어도 됨.'
    };
    properties.zone4_hidden_self_basis = {
      type: 'STRING',
      description:
        '위 풀이의 근거를 1~3문장으로 — 관상 쪽 근거와 사주 쪽 근거를 각각 짚을 것.'
    };

    properties.zone4_advice_basis = {
      type: 'STRING',
      description:
        'Zone4 고정카드4("조언")의 근거를 1~3문장으로 — 위 조언이 이 리포트의 어떤 사주x관상 데이터(십성·신살조합·용신 등)를 근거로 나왔는지 설명. 조언 본문과 내용이 겹치지 않게, "왜 그런 조언이 나왔는지"만 쓸 것.'
    };

    properties.zone4_cards = {
      type: 'ARRAY',
      minItems: 8,
      maxItems: 18,
      description:
        '⚠️ 이 필드를 쓰기 전에, 지금까지 이 응답에서 이미 쓴 zone2_review·zone3_manseryeok_reading· zone3_ohaeng_reading·zone3_daeun_reading·zone4_temperament_reading·zone4_hidden_self_reading을 되짚어, 거기서 이미 근거로 쓴 십성·신살·귀인·관상 부위가 무엇인지 확인할 것. zone4_cards의 각 카드는 그 목록과 다른 데이터 포인트를 근거로 써야 한다 — 예를 들어 zone4_temperament_reading에서 이미 용신(yongsinOh)을 언급했다면 rest 카드에서 같은 용신을 근거로 또 쓰지 말고, 위에서 안 쓴 다른 데이터로 풀이할 것. 같은 근거를 다른 카드에서 표현만 바꿔 반복하면 리포트 전체가 같은 얘기의 재탕처럼 느껴진다.\n\n' +
        '[Zone4 후보 주제 목록](family/work/money/love/relationships/rest, 6개) 전부를 반드시 다룰 것 — 이 사람에게 안 맞는다고 주제를 아예 빼면 안 됨. ⚠️ family와 love는 반드시 각각 2개 이상의 카드로 나눠 쓸 것(아래 [주제별 근거 가이드] 참고 — 자라온 환경 카드와 부모님과의 관계 카드를 분리, love는 아래 안내에 따름). 나머지 4개 주제(work/money/relationships/rest)는 기본 1개 카드, 할 말이 특히 많으면 최대 3개까지 세부 카드로 나눠도 된다. 전체 카드 수는 반드시 최소 8개 이상. "전체에서 최대 3개를 고르는" 게 아니라 "주제마다 1~3개씩(단, family·love는 2개 이상), 총합은 8~18개"가 규칙.\n\n' +
        '[주제별 근거 가이드 — 카드 순서 포함, 사용자 현재 상황(q1/q2)에 따라 사랑·일 카드는 아래처럼 각도가 달라짐]\n' +
        '- family(가족): 순서대로 카드1 "자라온 환경"(전반), 카드2 "부모님과의 관계"(신규) — 카드2는 반드시 [십성 목록]에 편재·정재(재성)가 있는지로 아버지와의 인연을, 편인·정인(인성)이 있는지로 어머니와의 인연을 풀이할 것 — 있으면 그 인연이 뚜렷함을, 3개 자리(year/month/hour) 중 전혀 없으면 그 인연이 약하거나 독립적으로 형성됐음을 풀이. 실제 가족 구성원을 예언·평가하지 말고 "성향에 미쳤을 습관·태도 차이" 중심으로.\n' +
        buildLoveCardGuidance(q1) + '\n' +
        '- money(돈): [십성 목록]의 재성(편재=통 큰 씀씀이·사업감각, 정재=성실한 축적) 유무·종류를 우선 근거로 쓰고, [관상 실측 데이터]의 코끝(nosetip)·입(mouth) 관련 수치가 있으면 함께 엮을 것.\n' +
        buildWorkCardGuidance(q2) + '\n' +
        '- relationships(대인관계): [사주 신살·귀인 목록] 중 화개살(혼자만의 시간 선호)·귀문관살(몰입력)·겁살·재살(관계 마찰) 같은 항목과, [관상 실측 데이터]의 눈썹·미간(대인관계·형제운 부위) 특징을 엮어서 풀이.\n' +
        '- rest(쉼/힐링): [용신(필요 오행)]의 yongsinOh(그 사람에게 부족해서 필요한 오행)를 반드시 근거로 써서, 그 기운을 채워주는 활동·공간·색·환경을 제안할 것.',
      items: {
        type: 'OBJECT',
        properties: {
          topic_key: {
            type: 'STRING',
            description: 'family(가족), work(일), money(돈), love(사랑), relationships(대인관계), rest(쉼/힐링) 중 하나. 세부 분리 시에도 가장 가까운 키를 쓸 것. family·love는 반드시 2개 이상의 카드가 이 키를 가져야 함.'
          },
          title: {
            type: 'STRING',
            description:
              '[Zone4 제목 말투 참고 예시]와 같은 2030 타깃 위트 있는 톤으로, 이 사람 데이터에 맞는 완전히 새로운 제목을 지어 쓸 것. ⚠️ 참고 예시 문장을 그대로 쓰거나 단어 몇 개만 바꿔 쓰는 것은 금지 — 반드시 이 카드의 실제 풀이 내용에서 나온 표현으로 새로 지을 것. 화면 두 줄을 넘지 않게. 전문용어·자음 표현 금지(시스템 지침 참고).'
          },
          reading: {
            type: 'STRING',
            description:
              '사주x관상 데이터를 근거로 한 실제 풀이. [주제별 근거 가이드]에서 이 topic_key에 해당하는 근거를 반드시 활용할 것. MBTI 풀이처럼 2030이 이해하기 쉽게 3~4문장. 전문용어·자음 표현 금지.'
          },
          basis: {
            type: 'STRING',
            description:
              '위 풀이가 어떤 사주x관상 데이터 근거로 나왔는지 1~3문장으로 설명("왜 이렇게 풀이했나요?" 영역에 노출됨). [주제별 근거 가이드]에서 실제로 사용한 데이터(신살명·십성명·관상 부위 등)를 구체적으로 짚을 것.'
          },
        },
        required: ['topic_key', 'title', 'reading', 'basis'],
      },
    };

    required.push(
      'zone2_review',
      'zone2_common_points',
      'zone2_different_points',
      'zone3_manseryeok_reading',
      'zone3_manseryeok_basis',
      'zone3_ohaeng_reading',
      'zone3_daeun_reading',
      'zone4_temperament_reading',
      'zone4_temperament_basis',
      'zone4_hidden_self_reading',
      'zone4_hidden_self_basis',
      'zone4_advice_basis',
      'zone4_cards'
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

관상 해석에서 "풀이"와 "근거"를 섞지 마. ⚠️ 아래 각 역할을 설명할 때도, 실제 응답에 내부 필드명(snake_case
영문 식별자)을 그대로 옮겨 쓰지 마 — 여기서는 어떤 내용이 어디에 들어가는지 구분하는 용도로만 쓰인다.

[풀이] 역할 — 사용자가 자기 이야기처럼 읽을 수 있는 쉬운 해석을 작성한다.

[근거] 역할("왜 이렇게 풀이했나요?" 영역) — 왜 그렇게 풀이했는지 실제 판별 결과를 제시한다.

[전통 원리] 역할 — 그 판별을 전통 관상에서 어떤 의미로 보는지 설명한다.

[조언] 역할("이제는 이렇게 해보세요" 카드) — 현실에서 어떻게 활용하거나 보완할지 알려준다.


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

같은 이유로 [관상 실측 데이터]의 원본 변수명이나 수치(foreheadWR, browGapR, 0.638, 1.82 같은 것)를
analysis_basis/face_analysis_basis에 그대로 옮겨 쓰지 마. 그 값이 "넓다/좁다/균형 잡혀 있다"처럼
어떤 판정으로 이어졌는지만 한국어 문장으로 풀어서 설명해 — 변수명·소수점 수치 자체는 사용자에게
아무 의미가 없는 내부 계산값이야.


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

[신살·귀인 조합 해석 — 2026-08-21 강화]

[사주 신살·귀인 목록]에 항목이 2개 이상 있으면
각각을 따로따로 나열하지 말고, 그 조합이 만들어내는 "하나의 이야기"로 묶어서 풀이해.

나쁜 예(따로 나열):
"홍염살이 있어 매력이 있고, 년살도 있어 사교성이 좋아요."

좋은 예(조합으로 묶기):
"홍염살과 년살이 함께 있어서, 가만히 있어도 시선을 끄는 그런 사람이에요."

가진 신살·귀인 중 서로 같은 방향(둘 다 매력/둘 다 예민함 등)을 가리키는 조합을 우선 찾아서 쓰고,
그런 조합이 없으면 가장 뚜렷한 신살·귀인 1개만 골라서 써도 돼.
목록에 없는 신살·귀인을 조합해서 지어내지는 마.


[관상×사주 데이터 풀이·스토리 — 관상 실측 데이터와 사주 정보가 둘 다 있을 때만 요청됨]

zone2_review/zone3_manseryeok_reading/zone3_manseryeok_basis/zone3_ohaeng_reading/zone3_daeun_reading/
zone4_temperament_reading/zone4_temperament_basis/zone4_hidden_self_reading/zone4_hidden_self_basis/
zone4_advice_basis/zone4_cards가 스키마에 있다면 아래 기준으로 채워.

- zone2_review: [관상x사주 케미 점수]는 이미 계산되어 주어진다. 새 숫자를 만들지 말고, 그
  점수가 왜 나왔는지만 관상 근거 1개 + 사주 근거 1개로 설명해.
- zone3_manseryeok_reading/zone3_ohaeng_reading/zone3_daeun_reading: 각각 [사주 원국]↔[관상
  6기질 점수], [사주 오행 분포]↔[관상 오행 분포], [대운 정보]↔[삼정 비율]을 짝지어, 두 데이터가
  같은 이야기를 하는지 다른 이야기를 하는지 구체적으로 짚어. ⚠️ zone3_manseryeok_reading·
  zone3_manseryeok_basis는 "다양한 기운" "차분한 에너지" 같은 뭉뚱그린 표현 대신 일간 오행·관상
  기질명을 실제로 언급해(스키마 설명 참고). ⚠️ zone3_ohaeng_reading에서 어느
  쪽이 더 높은지는 [오행 비교표]에 이미 계산돼 있다 — [사주 오행 분포]·[관상 오행 분포] 원본으로
  직접 다시 비교하지 말고(스케일이 달라 방향이 틀리기 쉬움) [오행 비교표]의 방향을 그대로 따라.
  ⚠️ [신강/신약]·[용신(필요 오행)]과 오행 zero/과다 개인 서사는 여기서 쓰지 마 — Zone4 고정카드
  (zone4_temperament_reading)가 전담해.
- zone4_temperament_reading("나의 기질"): 오행 zero·과다를 먼저 짚고 [신강/신약]·[용신]을 하나의
  이야기로 엮어서 이 사람의 에너지 밸런스를 설명해. Zone3에서 이미 언급 안 한 내용이니 여기서
  처음 등장시켜.
- zone4_hidden_self_reading("남이 모르는 내 모습"): 관상 겉인상과 사주(오행·십성)가 서로 다른
  얘기를 할 때만 반전 포인트로 써. 같은 얘기면 "겉과 속이 같다"는 방향으로 풀어도 돼.
- zone4_advice_basis: 조언(마지막 고정카드)이 이 리포트의 어떤 데이터(십성·신살조합·용신 등)를
  근거로 나왔는지만 짧게 짚어(조언 내용 자체는 이미 다른 필드에 있으니 반복하지 마).
- zone4_cards: ⚠️ 쓰기 전에 반드시 zone2_review·zone3_manseryeok_reading·zone3_ohaeng_reading·
  zone3_daeun_reading·zone4_temperament_reading·zone4_hidden_self_reading에서 이미 근거로 쓴
  십성·신살·귀인·관상 부위·용신을 되짚어보고, zone4_cards의 카드들은 거기 없던 다른 데이터
  포인트를 근거로 써 — 같은 근거를 표현만 바꿔 다시 쓰면 리포트 전체가 같은 얘기의 재탕처럼
  느껴져. [Zone4 후보 주제 목록] 6개(가족/일/돈/사랑/대인관계/쉼힐링)를 전부 다뤄 — 하나도
  빼면 안 돼. family(가족)와 love(사랑)는 반드시 각각 2개 이상의 카드로 나눠(스키마의 [주제별
  근거 가이드]에 각 카드가 어떤 데이터를 근거로 써야 하는지, 그리고 카드 순서가 어떻게 되는지
  적혀 있어 — family는 카드1 "자라온 환경" → 카드2 "부모님과의 관계"([십성 목록]의 재성·인성
  유무), love는 카드1 "매력·인기"([사주 신살·귀인 목록]의 홍염살·년살 + [AI 관상 분류 결과]의
  매력 계열 눈 유형) → 카드2 "연애·결혼 스타일" 순서를 반드시 지켜). 나머지 주제(work/money/
  relationships/rest)도 [주제별 근거 가이드]에 지정된 데이터(십성 조합, 신살·귀인, 관상 부위,
  용신)를 반드시 활용해 — 전체 카드 수는 최소 8개 이상. 각 카드 제목은 [Zone4 제목 말투 참고
  예시]와 같은 톤으로 이 카드의 실제 풀이 내용에 맞게 새로 지어. 참고 예시 문장을 그대로 쓰거나
  단어만 바꿔 쓰는 것은 절대 금지.

이 필드들도 지어내지 말고, 반드시 앞서 준 [관상 실측 데이터]·[AI 관상 분류 결과]·[사주 정보]·
[사주 신살·귀인 목록]·[십성 목록]·[신강/신약]·[용신(필요 오행)]·[관상x사주 케미 점수]·[대운 정보]·
[삼정 비율]에 실제로 있는 내용만 근거로 삼아.

[Zone4 제목·풀이 말투 — 통합분석 리포트 구성.md §3]
- 2030 타깃, MBTI 풀이처럼 이해가 쉽게. 사주·관상 전문용어(현침살, 자충수, 천정이 밝다, 재백궁 등)를
  그대로 노출하지 말고 풀어서 표현해.
- 자음 표현(ㄴㄴ, ㄱㄱ 등) 사용을 금지해.


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
- growth_guidance, zone3_ohaeng_reading처럼 snake_case로 된 내부 필드명·변수명을 문장에 그대로 쓰지 말 것.
  "위 조언", "앞서 짚은 오행 조합"처럼 사람이 읽는 말로 풀어서 가리킬 것(사용자 리포트: "growth_guidance에서
  강조한..."이라고 써서 사용자가 무슨 말인지 못 알아들었음).


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
  characterResult = null,
  zone3Extra = null, // {chemiScore, faceTraitScores, faceOhaeng, samjeong, daeunList} — 통합분석 Zone2/3/4 전용
  situation = null // {q1, q2, q3} — 통합분석 진입 질문(지금의 상황/일상/자유입력). 통합분석 리포트 구성.md §4
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


  // 십성/신강신약/용신(2026-08-21 추가) — 궁합보기(buildSipseongCross/buildYongsinChemi)에서만 쓰던
  // 엔진을 개인 리포트에도 연결한다. year/month/hour는 일간 대비 년간·월간·시간의 십성이고, 일간 본인은
  // "일원"이라 비교 대상에서 제외된다(calcSipseongAll 주석 참고) — 시간 미상이면 hour는 null.
  const sipseongAll = pillars ? calcSipseongAll(pillars) : null;
  const sipseongBlock = sipseongAll
    ? `[십성 목록 — 일간 기준 년주/월주/시주. 일간 자신은 비교 대상에서 빠짐]
${JSON.stringify(sipseongAll)}

[십성 의미 참고 — 반드시 이 뜻풀이 범위 안에서만 서술할 것]
${JSON.stringify(SIPSEONG_MEANING)}`
    : `[십성 목록]
없음 — 일간 정보가 없어 계산 불가.`;

  const sinkangSinyak = pillars ? calcSinkangSinyak(pillars) : null;
  const sinkangSinyakBlock = sinkangSinyak
    ? `[신강/신약]
${JSON.stringify(sinkangSinyak)}
※ isStrong=true면 신강(스스로 밀고 나가는 힘이 강함), false면 신약(주변 도움·기운이 필요함). help/drain 숫자는 근거 계산값일 뿐이니 그대로 노출하지 말 것.`
    : '';

  const yongsin = pillars ? calcYongsin(pillars) : null;
  const yongsinBlock = yongsin
    ? `[용신(필요 오행)]
${JSON.stringify(yongsin)}
※ yongsinOh가 이 사람에게 부족해서 채우면 좋은 오행. ohCount에서 그 오행의 실제 개수도 함께 확인할 것.`
    : '';


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


  // 통합분석 Zone2/3/4 전용 근거 블록 — chemiScore가 없으면(사진 없거나 사주 없어 hasSaju&&hasFace가
  // 애초에 false인 경우) 스키마에 해당 필드가 없으므로 빈 문자열이어도 무방하다.
  const zone2ChemiBlock = zone3Extra && zone3Extra.chemiScore != null
    ? `[관상x사주 케미 점수]\n${zone3Extra.chemiScore} (0~100, 이미 계산됨 — 새로 만들지 말 것)`
    : '';

  const faceTraitBlock = zone3Extra && zone3Extra.faceTraitScores
    ? `[관상 6기질 점수]\n${JSON.stringify(zone3Extra.faceTraitScores)}`
    : '';

  const sajuTraitBlock = zone3Extra && zone3Extra.sajuTraitScores
    ? `[사주 6기질 점수]\n${JSON.stringify(zone3Extra.sajuTraitScores)}`
    : '';

  const faceOhaengBlock = zone3Extra && zone3Extra.faceOhaeng
    ? `[관상 오행 분포]\n${JSON.stringify(zone3Extra.faceOhaeng)}`
    : '';

  // 오행 비교표(2026-08-21 버그 수정) — [사주 오행 분포]는 사주 8글자 중 개수(0~8, 예: 목:1)이고
  // [관상 오행 분포](calcFaceOhaeng)는 이미 0~100 퍼센트라, 두 블록을 그대로 나란히 주면 AI가 서로
  // 다른 스케일의 숫자를 직접 비교하다가 방향을 헷갈린다(실사용 리포트에서 "관상 쪽 목 기운이 낮다"고
  // 썼는데 실제 화면 그래프는 관상이 더 높았던 버그로 발견). 사주도 퍼센트로 미리 정규화해서 화면에
  // 실제로 보이는 값과 똑같은 스케일로 맞추고, 오행별로 어느 쪽이 더 높은지까지 코드로 미리 계산해서
  // 넘긴다 — AI는 이 표의 방향을 그대로 따르기만 하면 된다.
  const ohaengCompareBlock = (ohaeng && zone3Extra && zone3Extra.faceOhaeng)
    ? (() => {
        const sajuTotal = Object.values(ohaeng).reduce((a, b) => a + b, 0) || 1;
        const rows = Object.keys(ohaeng).map(oh => {
          const sajuPct = Math.round((ohaeng[oh] / sajuTotal) * 100);
          const facePct = Math.round(zone3Extra.faceOhaeng[oh] || 0);
          const diff = facePct - sajuPct;
          return {
            오행: oh,
            사주퍼센트: sajuPct,
            관상퍼센트: facePct,
            차이_관상마이너스사주: diff,
            더높은쪽: diff > 0 ? '관상' : diff < 0 ? '사주' : '동일',
          };
        });
        return `[오행 비교표 — 이미 계산됨. 직접 다시 비교·계산하지 말고 이 표의 "더높은쪽"과 "차이_관상마이너스사주" 값을 그대로 따를 것]
${JSON.stringify(rows)}`;
      })()
    : '';

  const samjeongBlock = zone3Extra && zone3Extra.samjeong
    ? `[삼정 비율]\n${JSON.stringify(zone3Extra.samjeong)}`
    : '';

  const daeunBlock = zone3Extra && zone3Extra.daeunList
    ? `[대운 정보]\n${JSON.stringify(zone3Extra.daeunList)}`
    : '';

  const daeunStagesBlock = zone3Extra && zone3Extra.daeunStages
    ? `[화면에 이미 표시된 대운 시기 흐름 — "대운x삼정 타임라인" 위젯과 100% 동일한 계산 결과]
※ early_life/mid_life/late_life을 쓸 때는 반드시 이 목록의 십이운성·뜻만 근거로 쓸 것. [사주 신살·귀인 목록]에 있는 십이운성(사주 원국 자체 십이운성, 나이 흐름과 무관)을 가져다 쓰지 말 것.
${JSON.stringify(zone3Extra.daeunStages)}`
    : '';

  const zone4TitleBankBlock = zone3Extra && zone3Extra.chemiScore != null
    ? `[Zone4 후보 주제 목록]\nfamily(가족) / work(일) / money(돈) / love(사랑) / relationships(대인관계) / rest(쉼·힐링)\n\n[Zone4 제목 말투 참고 예시 — 그대로 쓰거나 단어만 바꿔 쓰지 말고 톤만 참고할 것]\n${JSON.stringify(CMB_ZONE4_TITLE_STYLE_EXAMPLES)}`
    : '';

  // 통합분석 리포트 구성.md §4(2026-08-20) — q1(지금의 상황)/q2(일상)에 따라 zone4_cards의
  // love/work 카드 각도가 스키마 설명(buildLoveCardGuidance/buildWorkCardGuidance)에서 바뀐다.
  // 여기서는 AI가 실제 값을 참고할 수 있게 원본 데이터만 넘긴다.
  const situationBlock = (situation && (situation.q1 || situation.q2 || situation.q3))
    ? `[사용자 현재 상황]\n지금의 상황: ${situation.q1 || '미답변'}\n주로 보내는 일상: ${situation.q2 || '미답변'}\n${situation.q3 ? '추가로 궁금한 것: ' + situation.q3 : ''}\n※ love(사랑)·work(일) 카드는 이 상황에 맞는 각도로 써야 함 — 자세한 규칙은 zone4_cards 스키마 설명 참고.`
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

zone2_review/zone2_common_points/zone2_different_points/zone3_manseryeok_reading/zone3_ohaeng_reading/zone3_daeun_reading/
zone4_temperament_reading/zone4_hidden_self_reading/zone4_advice_basis/zone4_cards가 스키마에
있다면, [관상x사주 케미 점수]·[관상 6기질 점수]·[사주 6기질 점수]·[관상 오행 분포]·[오행 비교표]·[삼정 비율]·[대운 정보]·
[십성 목록]·[신강/신약]·[용신(필요 오행)]·[Zone4 후보 주제 목록]·[Zone4 제목 말투 참고 예시]를 근거로
채워주세요. 오행 중 어느 쪽이 더 높은지는 [오행 비교표]에 이미 계산돼 있으니 그 표만 따르고 원본
분포로 직접 다시 비교하지 마세요. 오행 zero/과다·신강신약·용신은 zone3_* 필드가 아니라
zone4_temperament_reading에만 쓰세요(중복 금지). zone4_cards는 [주제별 근거 가이드](스키마 설명
참고)에 따라 family는 "자라온 환경"→"부모님과의
관계", love는 "매력·인기"→"연애·결혼 스타일" 순서로 각각 2개 이상의 카드를 나누고, 나머지 주제도
지정된 근거(십성·신살귀인·관상 부위)를 반드시 활용하세요. 제목 말투 참고 예시는 절대 그대로 베끼지
마세요.`
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


${sipseongBlock}


${sinkangSinyakBlock}


${yongsinBlock}


${sewoonBlock}


${zone2ChemiBlock}


${faceTraitBlock}


${sajuTraitBlock}


${faceOhaengBlock}


${ohaengCompareBlock}


${samjeongBlock}


${daeunBlock}


${daeunStagesBlock}


${zone4TitleBankBlock}


${situationBlock}


${requestLine}`;
}

// part_deep_dive 항목(section_key) → 화면 라벨. renderDeepReport(관상보기 탭)가 사용한다.
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
// renderDeepReport(관상보기 탭 전체 카드)가 사용한다.
function partDeepDiveCardHtml(p) {
  const label = getDeepSectionLabel(p.section_key);

  return `
    <div
      class="face-reading-card"
      style="
        margin-top:16px;
        padding:18px 0;
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


      <!-- 풀이 아래에 근거를 분리 — 기본 접힘, 버튼 클릭 시에만 펼침(2026-08-22 사용자 요청) -->
      <details class="gg-basis-acc">
        <summary>왜 이렇게 풀이했나요?</summary>
        <div
          class="gg-basis-content"
          style="
            padding:14px;
            border-radius:12px;
            background:#fff;
            font-size:13px;
            line-height:1.75;
            border-left:none;
          "
        >

          <div style="margin-bottom:9px;">
            <strong style="color:var(--gold);">
              관상 분석 :
            </strong>
            ${p.analysis_basis}
          </div>


          <div>
            <strong style="color:var(--gold);">
              전통 관상 원리 :
            </strong>
            ${p.principle}
          </div>

        </div>
      </details>

    </div>
  `;
}

// 통합분석 Zone1 전용(2026-08-21 추가) — part_deep_dive(관상 부위별 상세해설)는 이미 관상 탭에서
// AI에게 요청·생성되고 있었는데 통합분석 화면엔 담을 곳이 없어 계속 버려지고 있었다(사용자 피드백:
// "눈이 작다·코가 좋다 같은 실측 데이터 때문에 이렇게 해석된다는 상세 풀이가 있었으면 좋겠다"). 카드
// HTML은 관상 탭과 완전히 같은 partDeepDiveCardHtml을 그대로 재사용해 톤·구조를 통일한다.
function renderPartDeepDive(elId, data) {
  const el = document.getElementById(elId);
  if (!el) return;
  el.innerHTML = (data.part_deep_dive || []).map(partDeepDiveCardHtml).join('');
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
// 통합분석 리포트 구성.md §1 개편(2026-08-21) — 아래는 새 Zone2/3/4 렌더 함수.

function setHtmlIfExists(elId, html) {
  const el = document.getElementById(elId);
  if (el) el.innerHTML = html || '';
}

// 신살 종합 풀이·원국x관상 융합 풀이(2026-08-21 추가) — 풀이만 있고 "왜 이렇게 풀이했나요?" 근거가
// 없어서 뭉뚱그린 서술을 걸러낼 방법이 없다는 사용자 피드백으로 basis를 추가했다. Zone4 가변카드의
// gg-item-reading/gg-item-basis와 같은 스타일을 재사용해 톤을 통일한다(2026-08-21 — 컨테이너도
// z3-pair-card 흰 배경으로 옮겨졌으므로, 텍스트도 그 카드 안에서 읽히는 gg-item 타이포를 그대로 쓴다).
// basis가 없는 필드(zone3_ohaeng_reading·zone3_daeun_reading — 스키마에 대응 basis가 없음)는
// 두 번째 인자를 생략하면 풀이만 렌더링된다.
function renderReadingBasis(elId, reading, basis) {
  setHtmlIfExists(elId, `<div class="gg-item-reading">${reading || ''}</div>${basis ? `<details class="gg-basis-acc"><summary>왜 이렇게 풀이했나요?</summary><div class="gg-basis-content">${basis}</div></details>` : ''}`);
}

// Zone2 총평 — 헤드/케미점수는 이미 룰베이스로 채워져 있으므로(buildChemiHeadline, computeGwansangSajuChemi)
// 여기서는 총평 텍스트만 채운다.
function renderZone2Review(elId, data) {
  setHtmlIfExists(elId, `<div style="font-size:13px;line-height:1.85;color:var(--text);">${data.zone2_review || ''}</div>`);
}

// Zone2 "둘이 같은 점 / 다른 점"(2026-08-22 추가) — 같은 점은 char-detail-list(✓ 아이콘)를 재사용,
// 다른 점은 관상/사주 색 구분(dom-bar-labels·oh-headline-split과 같은 jade/beige 배색)을 그대로 써서
// 관상=관상색, 사주=사주색이라는 화면 전체 색 규칙을 유지한다.
function renderZone2CommonDiff(elId, common, different) {
  const commonHtml = (common && common.length)
    ? `<div class="cmb-cd-label">✅ 둘이 같은 점</div>
       <ul class="char-detail-list is-strength">${common.map(s => `<li>${s}</li>`).join('')}</ul>`
    : '';
  const diffHtml = (different && different.length)
    ? `<div class="cmb-cd-label" style="margin-top:14px;">⚖️ 둘이 다른 점</div>
       ${different.map(d => `
         <div class="cmb-diff-row">
           <div class="face">🙂 관상 → ${d.face}</div>
           <div class="saju">☯ 사주 → ${d.saju}</div>
         </div>`).join('')}`
    : '';
  setHtmlIfExists(elId, commonHtml + diffHtml);
}

// Zone4 카드1(고정) — "OO의 인생의 흐름을 살펴본다면". early_life/mid_life/late_life는 combined
// 컨텍스트에서 이미 관상+사주를 함께 근거로 생성되는 필드라 새로 만들지 않고 재사용한다.
// 나이대 경계(~29세/30~59세/60세~)는 Zone3 라이프라인(app.js의 lifelineStage)과 동일하게 맞춘다.
function renderZone4Card1(elId, data) {
  setHtmlIfExists(elId, `
    <div class="card-title" style="margin-top:0;">📖 인생의 흐름을 살펴본다면</div>
    <div class="chemi-card">
      <div style="font-size:11px;color:var(--text2);font-weight:700;margin-bottom:4px;">🌱 초년운 (~29세)</div>
      <div class="chemi-title">${data.early_life_headline || ''}</div>
      <div class="chemi-role">${data.early_life}</div>
    </div>
    <div class="chemi-card">
      <div style="font-size:11px;color:var(--text2);font-weight:700;margin-bottom:4px;">🌳 중년운 (30세~59세)</div>
      <div class="chemi-title">${data.mid_life_headline || ''}</div>
      <div class="chemi-role">${data.mid_life}</div>
    </div>
    <div class="chemi-card" style="margin-bottom:0;">
      <div style="font-size:11px;color:var(--text2);font-weight:700;margin-bottom:4px;">🍂 말년운 (60세~)</div>
      <div class="chemi-title">${data.late_life_headline || ''}</div>
      <div class="chemi-role">${data.late_life}</div>
    </div>`);
}

// Zone4 고정카드 2~4(2026-08-21 4차 개편) — "나의 기질"/"남이 모르는 내 모습"/"조언". 제목은
// 룰베이스 고정 문구(§2 판단기준 1번 — 항상 등장하는 구조라 AI가 짓지 않음), reading/basis만 AI.
// 가변 카드(renderZone4Cards)와 같은 gg-item 레이아웃을 재사용해 시각적으로 통일한다.
function renderZone4FixedCard(elId, emoji, title, reading, basis) {
  setHtmlIfExists(elId, `
    <div class="gg-item">
      <div class="gg-item-head">${emoji} ${title}</div>
      <div class="gg-item-reading">${reading || ''}</div>
      <details class="gg-basis-acc"><summary>왜 이렇게 풀이했나요?</summary><div class="gg-basis-content">${basis || ''}</div></details>
    </div>`);
}

// Zone4 카드2~N(가변) — topic_key별 고정 이모지(궁합보기 GUNGHAP_ZONE2_META와 같은 패턴).
const CMB_ZONE4_TOPIC_EMOJI = { family: '🌳', work: '💼', money: '💰', love: '💘', relationships: '🤝', rest: '🌿' };
// 카드 노출 순서는 AI 응답 배열 순서에 맡기지 않고 여기서 고정한다(통합분석 리포트 구성.md §4) —
// "어디서 왔는지(가족) → 사람을 어떻게 대하는지(대인관계·사랑) → 무얼 하며 사는지(일·돈) → 어떻게
// 쉬는지(쉼/힐링)"로 읽히는 순서. Array.sort는 안정 정렬이라 같은 topic_key 카드들의 상대 순서는
// AI가 준 순서 그대로 유지된다. 목록에 없는 topic_key는 맨 뒤로 보낸다.
const ZONE4_TOPIC_ORDER = ['family', 'relationships', 'love', 'work', 'money', 'rest'];
function renderZone4Cards(elId, cards) {
  const el = document.getElementById(elId);
  if (!el) return;
  if (!cards || !cards.length) { el.innerHTML = ''; return; }
  const ordered = [...cards].sort((a, b) => {
    const ia = ZONE4_TOPIC_ORDER.indexOf(a.topic_key), ib = ZONE4_TOPIC_ORDER.indexOf(b.topic_key);
    return (ia < 0 ? ZONE4_TOPIC_ORDER.length : ia) - (ib < 0 ? ZONE4_TOPIC_ORDER.length : ib);
  });
  el.innerHTML = ordered.map(c => `
    <div class="gg-item">
      <div class="gg-item-head">${CMB_ZONE4_TOPIC_EMOJI[c.topic_key] || '✨'} ${c.title}</div>
      <div class="gg-item-reading">${c.reading}</div>
      <details class="gg-basis-acc"><summary>왜 이렇게 풀이했나요?</summary><div class="gg-basis-content">${c.basis}</div></details>
    </div>`).join('');
}

// 로컬 룰베이스 카드(renderPersonalReportV2)는 그대로 두고, 이 함수는 별도의 완전한 장문 리포트를
// 덧붙이는 용도다 — 기존 requestPersonalAi(부위별 한 문장 보완 + 형상 분류)와는 별개의 Gemini 호출.
// 키가 없거나 실패하면 조용히 스킵(로컬 카드만으로도 화면이 비지 않으므로 기존 패턴과 동일한 철학).
// 통합분석 탭(cfg.zone2ReviewId 등이 채워진 경우)은 같은 data를 Zone2/3/4로 나눠 렌더링하고,
// 그 외(관상 탭)는 기존처럼 cfg.deepReportId 하나에 전체를 렌더링한다.
async function requestDeepReport(ctx) {
  const cfg =
    (CTX_CONFIG[ctx] || CTX_CONFIG.combined)();

  const splitIds = [cfg.partDeepDiveId, cfg.zone2ReviewId, cfg.zone2CommonDiffId, cfg.sinsalReadingId, cfg.zone3Reading1Id, cfg.zone2OhaengReadingId, cfg.zone3Reading3Id, cfg.zone4Card1Id, cfg.zone4TemperamentId, cfg.zone4HiddenSelfId, cfg.zone4AdviceId, cfg.zone4CardsId].filter(Boolean);
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


    // Zone1 결과를 넣어 AI가 다른 유형명을 만들지 못하게 한다.
    const zone1Character = state[ctx] && state[ctx].characterResult;

    // 통합분석 Zone2/3/4 전용 근거 — 사주(pillars)와 관상(zone1Character.faceRaw)이 둘 다 있을 때만
    // 의미가 있다(스키마도 hasSaju&&hasFace일 때만 이 필드들을 요청한다).
    const zone3Extra = (cfg.pillars && zone1Character && zone1Character.faceRaw)
      ? {
          chemiScore: zone1Character.chemiScore,
          faceTraitScores: computeTraitScoresFromRaw(zone1Character.faceRaw, FACE_TRAIT_BASELINE),
          // Zone2 "같은 점/다른 점"(2026-08-22 추가) — 관상 6기질만 넘기고 있어 AI가 사주 쪽 기질
          // 순위를 추측해야 했다. 같은 baseline 변환을 사주 raw에도 적용해 같은 스케일(0~100)로 맞춰
          // 넘기면, 두 도메인 모두에서 높은 기질(같은 점)·서로 엇갈리는 기질(다른 점)을 AI가 숫자로
          // 직접 비교해서 짚을 수 있다 — 새로 추정하지 않고 그대로 인용만 하면 되게.
          sajuTraitScores: zone1Character.sajuRaw ? computeTraitScoresFromRaw(zone1Character.sajuRaw, SAJU_TRAIT_BASELINE) : null,
          faceOhaeng: calcFaceOhaeng(lm),
          samjeong: calcSamjeongRatio(lm),
          daeunList: state[ctx].daeun || null,
          // "대운x삼정 타임라인" 위젯(renderLifeline)이 계산하는 것과 완전히 같은 방식으로 미리
          // 12운성·뜻을 계산해서 넘긴다 — AI가 원국 자체 십이운성([사주 신살·귀인 목록])과 헷갈리거나
          // 자기 나름대로 재계산해서 화면 위젯과 다른 시기 서사를 지어내는 것을 막기 위함.
          daeunStages: (state[ctx].daeun && state[ctx].daeun.list && cfg.pillars && cfg.pillars[2] && cfg.pillars[2].stem >= 0)
            ? state[ctx].daeun.list.map(d => {
                const unseong = d.branchIdx >= 0 ? get12Unseong(cfg.pillars[2].stem, d.branchIdx) : null;
                return {
                  ageRange: `${d.startAge}~${d.endAge}세`,
                  삼정구간: LIFELINE_STAGE_LABEL[lifelineStage(d.startAge)],
                  십이운성: unseong,
                  뜻: unseong ? SIBIUNSEONG_MEANING[unseong] : null,
                };
              })
            : null,
        }
      : null;

    // 통합분석 리포트 구성.md §4(2026-08-20) — 진입 시 받은 상황 질문(q1/q2/q3)을 이제 실제로 프롬프트에
    // 넘긴다. state[ctx]는 'combined'일 때만 q1/q2/q3를 채우므로(사주보기는 이 함수를 안 씀), 다른
    // 컨텍스트에서는 자연히 undefined → situationBlock/카드 각도 분기 모두 기존 기본값으로 폴백된다.
    const situation = { q1: state[ctx].q1, q2: state[ctx].q2, q3: state[ctx].q3 };

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
        zone1Character,
        zone3Extra,
        situation
      );


    const data =
      await callGeminiAPI(
        sys,
        userText,
        [imageDataUrl],
        buildPersonalDeepReportSchema(
          !!cfg.pillars,
          true,
          situation.q1,
          situation.q2
        ),

        // ⚠️ 사용자 리포트(2026-08-20): 같은 사주+사진으로 두 번 돌렸는데 analysis_basis/principle
        // ("왜 이렇게 풀이했나요?") 문장이 눈에 띄게 달라짐 — 그 자리는 "이 숫자가 왜 이 결론으로
        // 이어지는지"를 설명하는 근거라, 매번 다르게 설명되면 지어내는 것처럼 보여 신뢰를 깎는다.
        // interpretation/제목처럼 표현이 매번 새로워야 하는 자리(문서에도 명시)와는 성격이 다르다.
        // 0.65에서도 이 문제가 실제로 재현돼 0.3으로 더 낮춘다 — 스키마의 모든 필드가 한 호출을
        // 공유해서 필드별로 온도를 나눠 줄 수는 없다.
        0.3
      );


    if (splitIds.length) {
      if (cfg.partDeepDiveId) { renderPartDeepDive(cfg.partDeepDiveId, data); clearAiSkeleton(cfg.partDeepDiveId); }
      if (cfg.zone2ReviewId) {
        renderZone2Review(cfg.zone2ReviewId, data);
        clearAiSkeleton(cfg.zone2ReviewId);
      }
      if (cfg.zone2CommonDiffId) {
        renderZone2CommonDiff(cfg.zone2CommonDiffId, data.zone2_common_points, data.zone2_different_points);
        clearAiSkeleton(cfg.zone2CommonDiffId);
      }
      if (cfg.sinsalReadingId) { renderReadingBasis(cfg.sinsalReadingId, data.sinsal_reading, data.sinsal_basis); clearAiSkeleton(cfg.sinsalReadingId); }
      if (cfg.zone3Reading1Id) { renderReadingBasis(cfg.zone3Reading1Id, data.zone3_manseryeok_reading, data.zone3_manseryeok_basis); clearAiSkeleton(cfg.zone3Reading1Id); }
      if (cfg.zone2OhaengReadingId) { renderReadingBasis(cfg.zone2OhaengReadingId, data.zone3_ohaeng_reading); clearAiSkeleton(cfg.zone2OhaengReadingId); }
      if (cfg.zone3Reading3Id) { renderReadingBasis(cfg.zone3Reading3Id, data.zone3_daeun_reading); clearAiSkeleton(cfg.zone3Reading3Id); }
      if (cfg.zone4Card1Id) { renderZone4Card1(cfg.zone4Card1Id, data); clearAiSkeleton(cfg.zone4Card1Id); }
      if (cfg.zone4TemperamentId) { renderZone4FixedCard(cfg.zone4TemperamentId, '⚖️', '나의 기질과 에너지 밸런스', data.zone4_temperament_reading, data.zone4_temperament_basis); clearAiSkeleton(cfg.zone4TemperamentId); }
      if (cfg.zone4HiddenSelfId) { renderZone4FixedCard(cfg.zone4HiddenSelfId, '🎭', '남이 모르는 내 모습', data.zone4_hidden_self_reading, data.zone4_hidden_self_basis); clearAiSkeleton(cfg.zone4HiddenSelfId); }
      if (cfg.zone4AdviceId) { renderZone4FixedCard(cfg.zone4AdviceId, '🧭', '이제는 이렇게 해보세요', data.growth_guidance, data.zone4_advice_basis); clearAiSkeleton(cfg.zone4AdviceId); }
      if (cfg.zone4CardsId) { renderZone4Cards(cfg.zone4CardsId, data.zone4_cards); clearAiSkeleton(cfg.zone4CardsId); }
    } else {
      renderDeepReport(
        cfg.deepReportId,
        data
      );
    }

  } catch (e) {
    // 사용자에게는 "AI 리포트 생성 실패" 같은 문구를 보여주지 않는다(사용자 피드백) — 로컬 룰베이스
    // 카드는 이미 화면에 떠 있으니 그걸로 충분하고, 실패 사유는 개발자만 보면 되므로 콘솔에만 남긴다.
    // 다른 탭의 AI 정밀 리포트 실패 처리와 동일한 원칙: 로딩 문구를 지우고 섹션을 그냥 숨긴다.
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
  // zone4TemperamentId/zone4HiddenSelfId/zone4AdviceId(2026-08-21 4차 개편) — index.html에 아직
  // 담을 컨테이너 div가 없어서 지금은 조용히 no-op(setHtmlIfExists가 null-safe)이다. 컨테이너
  // div를 추가하는 순간 바로 렌더링되니, 그때 이 id들과 이름을 맞추면 된다.
  // partDeepDiveId/sinsalReadingId(2026-08-21 추가) — 관상 부위별 상세해설·신살종합풀이는 관상탭·
  // 사주탭에서 이미 AI에게 요청하고 있었지만 통합분석에는 담을 그릇이 없어 매번 버려지고 있었다.
  combined: () => ({ canvasId:'combinedCanvas', cardsId:'cmbGwansangCards', archetypeId:'cmbArchetype', shapeDetailId:'cmbShapeDetailsSink', partCardsId:'cmbPartCards', partDeepDiveId:'cmbPartDeepDive', deepReportId:null, zone2ReviewId:'cmbZone2Review', zone2CommonDiffId:'cmbZone2CommonDiff', sinsalReadingId:'cmbSinsalReading', zone3Reading1Id:'cmbZone3Reading1', zone2OhaengReadingId:'cmbZone2OhaengReading', zone3Reading3Id:'cmbZone3Reading3', zone4Card1Id:'cmbZone4Card1', zone4TemperamentId:'cmbZone4Temperament', zone4HiddenSelfId:'cmbZone4HiddenSelf', zone4AdviceId:'cmbZone4Advice', zone4CardsId:'cmbZone4Cards', relVal:state.combined.relation, pillars:state.combined.pillars, ohaeng:state.combined.ohaeng, genderVal:cmbGender }),
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
// §2-A(신규) — "관상만 봤을 때 vs 관상+사주를 더했을 때" 비교. 사용자 요청 2026-08-18: 사주를 더해
// 캐릭터가 바뀌었다면 그 차이를 후킹포인트로 보여준다. 결과가 같으면(바뀐 게 없으면) 블록을 숨긴다.
//
// ⚠️ 버그 수정(2026-08-21 사용자 리포트: "관상 유형이 무관상인데 나는 그런 적이 없다") — 원래는
// 여기 비교 기준을 인연도감(관상보기 탭)에서 "이미 뽑아본 적 있는" 캐릭터로 썼다(localStorage
// 'inyeonLastCharacter'). 그런데 그건 몇 주 전에 다른 사진으로 만든 결과이거나, 로그인 직후
// Dogam.render()의 자가복구(inyeon-dogam.js paintOwnerView)가 계정에 저장된 예전 도감 값을
// 그대로 되살려 넣은 것일 수 있어 — 계정 스코프를 나눠도(095952c) 지금 업로드한 사진과 무관한
// 값이 "관상 유형"으로 표시되는 문제가 그대로 남아 있었다. "관상만 봤을 때"가 참이려면 반드시
// 지금 이 사진을 얼굴만으로(사주 없이) 다시 판정한 값이어야 한다 — classifyAndBuildCharacter가
// characterResult.faceOnlyCharacterId로 항상 "이 사진"의 값만 넘겨준다.
function characterCompareBlock(characterResult) {
  const gwansangId = characterResult.faceOnlyCharacterId;
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

// 헤드 타이틀 3분기(사용자 요청 2026-08-18b) — 지금 이 사진을 관상만으로 판정한 결과(gwansangId,
// characterResult.faceOnlyCharacterId)가 이번 관상+사주 결과와 같은지에 따라 문구가 달라진다.
//  · 얼굴 단독 판정 실패           → "왜 OOO이 나왔을까요?"
//  · 얼굴 단독 결과 == 최종 결과  → "사주를 더해도 여전히 OOO이에요!"
//  · 얼굴 단독 결과 != 최종 결과  → "사주를 더하니 OOO이 되었어요!"
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
  const gwansangId = characterResult.faceOnlyCharacterId;

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
// ⚠️ 버그 수정(2026-08-21 사용자 리포트: "통합분석 관상 유형이 무관상으로 나왔는데 한 번도 무관상이
// 나온 적이 없다") — 이 키가 계정(uid) 구분 없이 기기 전체가 공유하는 bare key였다. 같은 기기/브라우저를
// 다른 카카오 계정으로 재로그인하면(또는 계정을 넘겨받으면) 이전 계정이 인연도감에서 뽑은 캐릭터가
// 그대로 남아있다가 새 계정의 통합분석 "관상 유형 → 관상+사주 유형" 비교 카드에 새어 들어갔다 —
// 실측 재현(다른 사진으로 이전 값을 심어두고 실제 사진을 분석) 결과 정확히 이 증상이 나왔다.
// 로그인 상태면 uid로 키를 분리해 다른 계정의 값을 읽거나 덮어쓰지 못하게 막는다. 비로그인(게스트)은
// 애초에 계정이 없어 기존처럼 기기 전체가 공유하는 bare key를 그대로 쓴다(인연도감의 "로그인 전
// 이 기기에 저장 → 로그인 시 계정으로 편입" 정책과 같은 전제 — migrateLocalOnLogin이 그 편입을 맡는다).
function inyeonCharacterKey() {
  const u = window.fbAuth && fbAuth.currentUser;
  return (u && !u.isAnonymous) ? (INYEON_LAST_CHARACTER_KEY + ':' + u.uid) : INYEON_LAST_CHARACTER_KEY;
}
function saveLastCharacterToStorage(characterResult) {
  if (!characterResult || !characterResult.characterId) return;
  try {
    localStorage.setItem(inyeonCharacterKey(), JSON.stringify({
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
  try { saved = JSON.parse(localStorage.getItem(inyeonCharacterKey()) || 'null'); } catch (e) { saved = null; }
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
  try { saved = JSON.parse(localStorage.getItem(inyeonCharacterKey()) || 'null'); } catch (e) { saved = null; }
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
  // §2-A 비교 카드("관상만 봤을 때 → 관상+사주 유형")용 — 반드시 지금 이 사진의 얼굴 단독 판정이어야
  // 한다(위 버그 수정 주석 참고). 사주가 실제로 섞인 경우에만 같은 ids/confidences/partStatusMap으로
  // 얼굴만 다시 판정한다 — 사주가 없으면 characterResult 자체가 이미 얼굴 단독 결과다.
  if (characterResult) {
    characterResult.faceOnlyCharacterId = cfg.pillars
      ? (computeCharacterResult({ featureIds: ids, confidences, partStatusMap }) || {}).characterId || null
      : characterResult.characterId;
  }
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
