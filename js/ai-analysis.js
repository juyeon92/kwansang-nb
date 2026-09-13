// ═══ Gemini AI 정밀 해석 (선택 기능) ═══
// ANALYSIS_LOGIC_SERVER_MIGRATION.md "아직 남은 작업 3번" — 시스템 프롬프트 조립·스키마·Gemini 실제
// 호출(모델 선택 포함)은 이제 서버(js/ai-report-api.js → generateDeepReport 등)로 옮겼다. 여기 남은
// isGeminiConfigured()는 GEMINI_PROXY_URL(옛 geminiProxy 설정) 유무로 "AI 기능이 배포됐는지"만 게이트한다
// — geminiProxy 자체가 폐기되기 전까지는 같은 배포 묶음이라 이 값으로도 여전히 정확하다.
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

// ═══ 궁합보기 AI 리포트 v2 (히어로 + Zone1 관상궁합 + Zone2 사주궁합, 2026-08-19 사용자 스펙) ═══
// 점수(총합/관상만/사주만)는 항상 로컬 계산값(calcCompatScore·calcGwansangCompat, runGungham의 heroScores)을
// 그대로 쓴다 — AI에게 숫자를 맡기면 화면에 이미 떠 있는 참고용 점수(ggHeroTotalNum)와 어긋날 수 있어서,
// AI는 "그 점수가 왜 나왔는지"를 설명하는 글만 쓰고 숫자 자체는 만들지 않는다.
// 2026-08-22 재편 — overall_relationship은 목록에서 빼서 Zone2 맨 위 "한줄 총평"으로 독립 렌더링한다
// (renderGunghapResult 참고, 목록에는 그대로 남겨 스키마 required는 유지). after_marriage·children·
// complement_needed는 Zone3 "그래서 우리는 이렇게 만나요"(연인/배우자 전용, GUNGHAP_ZONE3_*)로
// 이사했다 — 그 대신 attraction_reason·weak_point를 새로 추가해 목록을 10개로 채운다.
const GUNGHAP_ZONE2_ORDER = [
  'overall_relationship', 'attraction_reason', 'sinsal_combo', 'strengths', 'weak_point',
  'perceived_by_partner', 'perceived_by_me', 'mind_hacking', 'family_background', 'expectation_vs_reality',
];
const GUNGHAP_ZONE2_META = {
  overall_relationship:  { emoji: '🌡️', title: '우리 관계, 한 줄로 말하면' },
  attraction_reason:     { emoji: '💘', title: '우리가 끌리는 이유' },
  sinsal_combo:          { emoji: '🔮', title: '신살·귀인이 만드는 케미' },
  strengths:             { emoji: '✨', title: '특히 잘 맞는 부분' },
  weak_point:            { emoji: '⚠️', title: '관계에서 부족한 부분' },
  perceived_by_partner:  { emoji: '🪞', title: '상대가 보는 나' },
  perceived_by_me:       { emoji: '🔍', title: '내가 보는 상대' },
  mind_hacking:          { emoji: '🔑', title: '상대 마음 사로잡는 법' },
  family_background:     { emoji: '🌳', title: '서로 다르게 자라온 환경' },
  expectation_vs_reality:{ emoji: '🎭', title: '내가 바라는 모습 vs 실제' },
};

// Zone3 "그래서 우리는 이렇게 만나요"(2026-08-22 신규) — 연인/배우자 관계일 때만 요청·노출한다
// (친구·가족·지인 관계엔 "아이를 낳는다면" 같은 항목이 어색하다는 사용자 판단). 오래 만났을 때/
// 결혼했을 때 카드는 실제 연애 기간·혼인 여부를 입력받지 않으므로 둘 다 항상 함께 보여준다.
const GUNGHAP_ZONE3_ORDER = [
  'dating', 'communication', 'money', 'fighting', 'long_term_dating', 'married_life', 'children', 'improvement',
];
const GUNGHAP_ZONE3_META = {
  dating:           { emoji: '❤️', title: '연애할 때' },
  communication:    { emoji: '💬', title: '대화할 때' },
  money:            { emoji: '💰', title: '돈을 다룰 때' },
  fighting:         { emoji: '🚨', title: '싸울 때' },
  long_term_dating: { emoji: '🏠', title: '오래 만났을 때' },
  married_life:     { emoji: '🏠', title: '결혼했을 때' },
  children:         { emoji: '👶', title: '아이를 낳는다면' },
  improvement:      { emoji: '💡', title: '우리 관계를 더 좋게 만드는 방법' },
};

// "OO님의 질문, 냥반이 답해드려요" — 제목 형식 자체는 항상 등장하는 구조라 AI가 짓지 않고 코드가
// 강제한다(§2 판단기준 1번과 동일 원칙, 고정 카드 제목들과 같은 이유). AI가 title에 뭘 써서 보내든
// 이 값으로 덮어쓴다.
function buildQ3CardTitle(name) {
  return `${name ? cmbEsc(name) + '님' : '회원님'}의 질문, 냥반이 답해드려요`;
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
// "눈이 작다·코가 좋다 같은 실측 데이터 때문에 이렇게 해석된다는 상세 풀이가 있었으면 좋겠다").
// (2026-09-13 Zone3 "🔮 관상 정보" Figma(72:3282) 재실측) — 관상 탭과 같은 partDeepDiveCardHtml을
// 그대로 재사용하면 그 카드가 다크 톤(반투명 흰 배경·보라 라벨)이라 Zone3의 흰 배경·네이비/재이드
// 톤과 완전히 충돌한다. 데이터(section_key/title/interpretation/analysis_basis/principle)는 관상
// 탭과 똑같이 재사용하되, 마크업은 Zone4(renderZone4FixedCard)와 같은 .gg-item 패턴으로 새로 그린다
// — Figma GgItem이 라벨(10px/600/gray)+헤드라인(12px/800/navy) 두 줄을 먼저 보여주는 것까지 반영.
function renderPartDeepDive(elId, data) {
  const el = document.getElementById(elId);
  if (!el) return;
  el.innerHTML = (data.part_deep_dive || []).map(p => {
    const label = getDeepSectionLabel(p.section_key);
    const basis = [p.analysis_basis, p.principle].filter(Boolean).join('<br><br>');
    return `
      <div class="gg-item">
        <div class="cmb-part-label">${label}</div>
        <div class="gg-item-head" style="color:var(--char-navy-deep);margin-top:2px;">${p.title || ''}</div>
        <div class="gg-item-reading">${p.interpretation || ''}</div>
        <details class="gg-basis-acc"><summary>왜 이렇게 풀이했나요?</summary><div class="gg-basis-content">${basis}</div></details>
      </div>`;
  }).join('');
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
// 2026-09-12(Figma node 72:2838 재실측) — "같은 점"/"다른 점"이 하나의 박스에 같이 들어있던 걸
// Figma의 두 OriginBox(흰 배경+네이비 테두리, 각자 제목+구분선을 자기 안에 가짐)에 맞춰 완전히
// 분리된 두 개의 .cmb-origin-box로 나눴다. 박스 사이 간격(12px)은 Figma Z3PairCard itemSpacing=12.
function renderZone2CommonDiff(elId, common, different) {
  const commonHtml = (common && common.length)
    ? `<div class="cmb-origin-box">
         <div class="cmb-cd-label">✅ 둘이 같은 점</div>
         <div class="cmb-z2-hr"></div>
         <ul class="char-detail-list is-strength">${common.map(s => `<li>${s}</li>`).join('')}</ul>
       </div>`
    : '';
  const diffHtml = (different && different.length)
    ? `<div class="cmb-origin-box" style="margin-top:12px;">
         <div class="cmb-cd-label">⚖️ 둘이 다른 점</div>
         <div class="cmb-z2-hr"></div>
         ${different.map(d => `
           <div class="cmb-diff-row">
             <div class="face">🙂 관상 → ${d.face}</div>
             <div class="saju">☯ 사주 → ${d.saju}</div>
           </div>`).join('')}
       </div>`
    : '';
  setHtmlIfExists(elId, commonHtml + diffHtml);
}

// Zone4 카드1(고정) — "OO의 인생의 흐름을 살펴본다면". early_life/mid_life/late_life는 combined
// 컨텍스트에서 이미 관상+사주를 함께 근거로 생성되는 필드라 새로 만들지 않고 재사용한다.
// 나이대 경계(~29세/30~59세/60세~)는 Zone3 라이프라인(app.js의 lifelineStage)과 동일하게 맞춘다.
// (2026-09-13 Figma 72:4069 재실측) — 예전엔 .chemi-card(회색 카드+굵은 타이틀)였는데, Figma의
// GgItem(라벨10px/600/gray + 헤드라인12px/800/navy 두 줄 + 풀이, fill #eef2f8)과 완전히 다른
// 컴포넌트였다. Zone3 "관상 정보"(renderPartDeepDive)와 같은 gg-item+cmb-part-label 패턴으로
// 다시 그리고, #eef2f8 배경만 Zone4 전용 클래스(.cmb-zone4-highlight)로 얹는다. 섹션 제목은
// index.html에 정적 .z3-pair-title로 옮겨져 있어 여기서는 그리지 않는다.
function renderZone4Card1(elId, data) {
  const stage = (label, headline, reading) => `
    <div class="gg-item cmb-zone4-highlight">
      <div class="cmb-part-label">${label}</div>
      <div class="gg-item-head" style="color:var(--char-navy-deep);margin-top:2px;">${headline || ''}</div>
      <div class="gg-item-reading">${reading || ''}</div>
    </div>`;
  setHtmlIfExists(elId, [
    stage('🌱 초년운 (~29세)', data.early_life_headline, data.early_life),
    stage('🌳 중년운 (30세~59세)', data.mid_life_headline, data.mid_life),
    stage('🍂 말년운 (60세~)', data.late_life_headline, data.late_life)
  ].join(''));
}

// Zone4 고정카드 2~4(2026-08-21 4차 개편) — "나의 기질"/"남이 모르는 내 모습"/"조언". 제목은
// 룰베이스 고정 문구(§2 판단기준 1번 — 항상 등장하는 구조라 AI가 짓지 않음), reading/basis만 AI.
// 가변 카드(renderZone4Cards)와 같은 gg-item 레이아웃을 재사용해 시각적으로 통일한다.
// extraClass(옵션) — "이제는 이렇게 해보세요" 조언 카드만 Figma상 #eef2f8 배경(GgItem)이라
// .cmb-zone4-highlight를 추가로 얹는다(호출부 참고). 헤드라인 색은 Figma(72:4069) 실측대로
// jade가 아니라 navy(--char-navy-deep) — Zone3 renderPartDeepDive와 같은 관행으로 인라인 지정.
function renderZone4FixedCard(elId, emoji, title, reading, basis, extraClass) {
  setHtmlIfExists(elId, `
    <div class="gg-item${extraClass ? ' ' + extraClass : ''}">
      <div class="gg-item-head" style="color:var(--char-navy-deep);">${emoji} ${title}</div>
      <div class="gg-item-reading">${reading || ''}</div>
      <details class="gg-basis-acc"><summary>왜 이렇게 풀이했나요?</summary><div class="gg-basis-content">${basis || ''}</div></details>
    </div>`);
}

// Zone4 카드2~N(가변) — topic_key별 고정 이모지(궁합보기 GUNGHAP_ZONE2_META와 같은 패턴).
const CMB_ZONE4_TOPIC_EMOJI = { family: '🌳', work: '💼', money: '💰', love: '💘', relationships: '🤝', rest: '🌿', user_question: '🔮' };
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
      <div class="gg-item-head" style="color:var(--char-navy-deep);">${CMB_ZONE4_TOPIC_EMOJI[c.topic_key] || '✨'} ${c.title}</div>
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
          imageDataUrl
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

    // Zone1 결과를 넣어 AI가 다른 유형명을 만들지 못하게 한다.
    const zone1Character = state[ctx] && state[ctx].characterResult;

    // 통합분석 Zone2/3/4 전용 근거 — 사주(pillars)와 관상(zone1Character.faceRaw)이 둘 다 있을 때만
    // 의미가 있다(스키마도 hasSaju&&hasFace일 때만 이 필드들을 요청한다).
    const zone3Extra = (cfg.pillars && zone1Character && zone1Character.faceRaw)
      ? {
          chemiScore: zone1Character.chemiScore,
          // 2026-08-30: computeTraitScoresFromRaw+FACE_TRAIT_BASELINE을 여기서 직접 호출했었는데,
          // 그 baseline이 서버 전용 상수가 돼서 이제 analyzeCharacter 응답에 이미 계산돼 들어있다.
          faceTraitScores: zone1Character.faceTraitScores,
          // Zone2 "같은 점/다른 점"(2026-08-22 추가) — 관상 6기질만 넘기고 있어 AI가 사주 쪽 기질
          // 순위를 추측해야 했다. 같은 baseline 변환을 사주 raw에도 적용해 같은 스케일(0~100)로 맞춰
          // 넘기면, 두 도메인 모두에서 높은 기질(같은 점)·서로 엇갈리는 기질(다른 점)을 AI가 숫자로
          // 직접 비교해서 짚을 수 있다 — 새로 추정하지 않고 그대로 인용만 하면 되게.
          sajuTraitScores: zone1Character.sajuTraitScores,
          // classifyAndBuildCharacter가 이미 받아둔 gwansangBundle을 재사용 — lm을 다시 서버로
          // 보내지 않는다(ANALYSIS_LOGIC_SERVER_MIGRATION.md 2026-09-08 확장).
          faceOhaeng: state[ctx].gwansangBundle.faceOhaeng,
          samjeong: state[ctx].gwansangBundle.samjeong,
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

    // ANALYSIS_LOGIC_SERVER_MIGRATION.md "아직 남은 작업 3번" — 시스템 프롬프트·스키마 조립과 Gemini
    // 호출(온도 0.3 등 세부 설정 포함)뿐 아니라 ratios/statusMap/sajuInsight 계산까지 서버가 lm/pillars로
    // 부터 직접 한다. 클라이언트는 원재료(lm/pillars)만 보내고 완성된 리포트 객체만 받는다.
    const data =
      await AiReportAPI.generateDeepReport({
        lm, pillars: cfg.pillars, ohaeng: cfg.ohaeng, relVal: cfg.relVal,
        archetypeAnalysis, sewoonInfo, zone1Character, zone3Extra, situation,
        hasSaju: !!cfg.pillars, hasFace: true, q1: situation.q1, q2: situation.q2, q3: situation.q3,
        imageDataUrl,
      });


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
      if (cfg.zone2OhaengReadingId) { setHtmlIfExists(cfg.zone2OhaengReadingId, data.zone3_ohaeng_reading || ''); clearAiSkeleton(cfg.zone2OhaengReadingId); }
      if (cfg.zone3Reading3Id) { renderReadingBasis(cfg.zone3Reading3Id, data.zone3_daeun_reading); clearAiSkeleton(cfg.zone3Reading3Id); }
      if (cfg.zone4Card1Id) { renderZone4Card1(cfg.zone4Card1Id, data); clearAiSkeleton(cfg.zone4Card1Id); }
      if (cfg.zone4TemperamentId) { renderZone4FixedCard(cfg.zone4TemperamentId, '⚖️', '나의 기질과 에너지 밸런스', data.zone4_temperament_reading, data.zone4_temperament_basis); clearAiSkeleton(cfg.zone4TemperamentId); }
      if (cfg.zone4HiddenSelfId) { renderZone4FixedCard(cfg.zone4HiddenSelfId, '🎭', '남이 모르는 내 모습', data.zone4_hidden_self_reading, data.zone4_hidden_self_basis); clearAiSkeleton(cfg.zone4HiddenSelfId); }
      if (cfg.zone4AdviceId) { renderZone4FixedCard(cfg.zone4AdviceId, '🧭', '이제는 이렇게 해보세요', data.growth_guidance, data.zone4_advice_basis, 'cmb-zone4-highlight'); clearAiSkeleton(cfg.zone4AdviceId); }
      if (cfg.zone4CardsId) {
        // "고민 해결" 카드 마무리(통합분석 리포트 구성.md §10) — q3 미답변인데 AI가 실수로 카드를
        // 만들었으면 안전하게 걸러내고(가짜 고민 지어내기 방지), q3가 있으면 AI가 뭘 보냈든 제목은
        // 고정 형식으로 덮어쓴다(§2 판단기준 1번 — 구조를 이루는 값은 룰베이스).
        let zone4Cards = data.zone4_cards;
        if (zone4Cards) {
          zone4Cards = zone4Cards.filter(c => c.topic_key !== 'user_question' || situation.q3);
          const uq = zone4Cards.find(c => c.topic_key === 'user_question');
          if (uq) uq.title = buildQ3CardTitle(state[ctx].name);
        }
        renderZone4Cards(cfg.zone4CardsId, zone4Cards);
        clearAiSkeleton(cfg.zone4CardsId);
      }
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
// gg-item 카드 1개(제목+풀이+근거 아코디언) HTML — Zone2 목록과 Zone3 목록이 같은 모양을 쓴다.
function gunghapItemCardHtml(meta, it) {
  return `
    <div class="gg-item">
      <div class="gg-item-head">${meta.emoji} ${meta.title}</div>
      <div class="gg-item-reading">${it.reading}</div>
      <details class="gg-basis-acc"><summary>왜 이렇게 풀이했나요?</summary><div class="gg-basis-content">${it.basis}</div></details>
    </div>`;
}

function renderGunghapResult(data) {
  const setHtml = (id, html) => { const el = document.getElementById(id); if (el) el.innerHTML = html; };

  setHtml('ggHeroReason', data.hero_reason);

  setHtml('ggZone1AiShape', `
    <div class="gg-item-reading">${data.zone1_shape_reading}</div>
    <details class="gg-basis-acc"><summary>왜 이렇게 풀이했나요?</summary><div class="gg-basis-content">${data.zone1_shape_basis}</div></details>`);

  const itemsByKey = {};
  (data.zone2_items || []).forEach(it => { itemsByKey[it.key] = it; });

  // ① 사주 궁합 한줄 총평 — overall_relationship만 목록에서 떼어내 Zone2 맨 위에 단독 노출(2026-08-22).
  const overall = itemsByKey.overall_relationship;
  setHtml('ggOverallRelationship', overall ? gunghapItemCardHtml(GUNGHAP_ZONE2_META.overall_relationship, overall) : '');

  // ④ 사주 관계 풀이 — overall_relationship을 뺀 나머지 9개.
  const zone2Html = GUNGHAP_ZONE2_ORDER
    .filter(key => key !== 'overall_relationship')
    .map(key => (itemsByKey[key] ? gunghapItemCardHtml(GUNGHAP_ZONE2_META[key], itemsByKey[key]) : ''))
    .join('');
  setHtml('ggZone2AiItems', zone2Html);

  // Zone3 "그래서 우리는 이렇게 만나요"(연인/배우자 관계일 때만 요청됨 — data.zone3_practical_items가
  // 아예 없는 응답이면 조용히 비운다. 섹션 자체의 노출 여부는 runGungham()이 relation으로 결정한다).
  const practicalByKey = {};
  (data.zone3_practical_items || []).forEach(it => { practicalByKey[it.key] = it; });
  const zone3Html = GUNGHAP_ZONE3_ORDER
    .map(key => (practicalByKey[key] ? gunghapItemCardHtml(GUNGHAP_ZONE3_META[key], practicalByKey[key]) : ''))
    .join('');
  setHtml('ggPracticalItems', zone3Html);
}

// Gemini 키가 없거나 호출이 실패한 경우 — AI 텍스트 슬롯만 안내 문구로 채운다. 히어로 점수·원국표·
// 오행바·관상 형상 카드 등 로컬 계산 정보는 이 함수와 무관하게 이미 채워져 있으므로 그대로 보인다.
function fillGunghapAiFallback() {
  const note = '<div style="color:var(--text2);font-size:13px;">이번엔 AI 해설을 불러오지 못했어요. 다시 분석하면 채워집니다.</div>';
  ['ggHeroReason', 'ggZone1AiShape', 'ggOverallRelationship', 'ggZone2AiItems', 'ggPracticalItems'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = note;
  });
}

// AI 보완(부위별 코멘트 + 관상 형상 분류) — 사용자 조작 없이 로컬 분석 뒤에 자동으로만 실행됨(재시도 버튼 없음).
// 키가 없거나 API 호출이 실패하면 조용히 스킵 — 로컬 결과만 있는 상태로 남을 뿐, 에러 UI를 사용자에게 노출하지 않음.
// Gemini가 없거나 실패하면 서버 룰베이스 분류(classifyGwansang)로 눈모양·동물형상을 약식 추정한다.
// 정밀도는 떨어지지만, 키가 없다는 이유로 이 카드 자체가 통째로 안 보이는 것보다는 낫다는 판단.
// ANALYSIS_LOGIC_SERVER_MIGRATION.md 2026-09-08 확장 — landmark-engine.js의 룰베이스 분류기를
// 클라이언트에서 제거하면서 async로 바뀜(호출부는 이미 async 안에서 부른다).
async function renderArchetypesFallback(archetypeId, lm, fallbackReason, genderVal, personLabel) {
  const { featureIds } = await CharacterAPI.classifyGwansang(lm);
  renderArchetypes(archetypeId, featureIds.eye_archetype_id, featureIds.face_archetype_id, true, null, fallbackReason, genderVal, null, personLabel);
}

// 컨텍스트별 설정 — 궁합 탭의 두 사람(gunghamA/B)도 관상 탭·통합분석 탭과 동일하게 관상 형상(눈모양·
// 동물상) AI/약식 분류를 받도록 여기에 추가함(사용자 피드백: "관상이 들어가는 모든곳에 반영돼야").
// cardsId는 궁합 탭엔 부위별 카드 그리드가 없어서 실제로 안 쓰이지만(renderPartAdditions가 컨테이너를
//못 찾으면 조용히 스킵), 나머지 컨텍스트와 동일한 형태를 유지하기 위해 값만 채워둔다.
const CTX_CONFIG = {
  // feature: 'gwansang'은 NYANG_GATED_FEATURES(functions/index.js)에 없는 값이라 analyzeCharacter가
  // 티켓 없이도 통과시킨다 — 관상보기 최초 1회 무료 판정은 원래부터 냥 차감 대상이 아니었다.
  gwansang: () => ({ canvasId:'gwansangCanvas', cardsId:'gwansangCards', archetypeId:'gwansangArchetype', shapeDetailId:'gwansangShapeDetails', deepReportId:'gwansangDeepReport', relVal:state.gwansang.relation, pillars:null, ohaeng:null, genderVal:gender, feature:'gwansang' }),
  // shapeDetailId를 안 보이는 그릇으로 돌려, "부위별 생김새 유형" 블록이 전통 형상 카드(cmbArchetype)에
  // 붙지 않게 한다 — 그 내용은 이제 부위별 병합 카드(#cmbPartCards) 안에서만 보인다.
  // zone4TemperamentId/zone4HiddenSelfId/zone4AdviceId(2026-08-21 4차 개편) — index.html에 아직
  // 담을 컨테이너 div가 없어서 지금은 조용히 no-op(setHtmlIfExists가 null-safe)이다. 컨테이너
  // div를 추가하는 순간 바로 렌더링되니, 그때 이 id들과 이름을 맞추면 된다.
  // partDeepDiveId/sinsalReadingId(2026-08-21 추가) — 관상 부위별 상세해설·신살종합풀이는 관상탭·
  // 사주탭에서 이미 AI에게 요청하고 있었지만 통합분석에는 담을 그릇이 없어 매번 버려지고 있었다.
  // feature/ticketId — analyzeCharacter가 냥 결제를 확인하는 데 쓴다(profile.js chargeNyangOrAlert가
  // 차감 직후 state.combined.nyangTicketId에 써둔 값을 그대로 읽는다). 없으면(=결제를 안 거쳤으면)
  // 서버가 402로 거절한다.
  combined: () => ({ canvasId:'combinedCanvas', cardsId:'cmbGwansangCards', archetypeId:'cmbArchetype', shapeDetailId:'cmbShapeDetailsSink', partCardsId:'cmbPartCards', partDeepDiveId:'cmbPartDeepDive', deepReportId:null, zone2ReviewId:'cmbZone2Review', zone2CommonDiffId:'cmbZone2CommonDiff', sinsalReadingId:'cmbSinsalReading', zone3Reading1Id:'cmbZone3Reading1', zone2OhaengReadingId:'cmbZone2OhaengReading', zone3Reading3Id:'cmbZone3Reading3', zone4Card1Id:'cmbZone4Card1', zone4TemperamentId:'cmbZone4Temperament', zone4HiddenSelfId:'cmbZone4HiddenSelf', zone4AdviceId:'cmbZone4Advice', zone4CardsId:'cmbZone4Cards', relVal:state.combined.relation, pillars:state.combined.pillars, ohaeng:state.combined.ohaeng, genderVal:cmbGender, feature:'combined', ticketId:state.combined.nyangTicketId }),
  // personLabel: "당신" 대신 실제 이름 사용. hideShapeDetails: 궁합 탭 Zone1에선 "🧩 부위별 생김새
  // 유형"을 아예 안 보여주기로 함(사용자 요청 2026-08-20) — shapeDetailId 싱크도 안 주고 shapeIds 자체를
  // 호출부에서 null로 넘기게 하는 플래그.
  // 궁합보기는 냥 1회 차감으로 나/상대방 두 사람을 판정해야 해서, 티켓은 state.gungham(전용 state.gunghamA/B가
  // 아니라)에 걸린 것 하나를 A·B 호출이 함께 쓴다(nyangSpend가 feature='gungham'엔 remainingUses:2를 준다).
  gunghamA: () => ({ canvasId:'gunghamCanvasA', cardsId:'ggPersonAGwansang', archetypeId:'ggArchetypeA', deepReportId:null, hideShapeDetails:true, personLabel: state.gunghamA.name ? state.gunghamA.name+'님' : '당신', relVal:'연인/배우자', pillars:state.gunghamA.pillars, ohaeng:state.gunghamA.ohaeng, genderVal:ggGenderA, feature:'gungham', ticketId:state.gungham.nyangTicketId }),
  gunghamB: () => ({ canvasId:'gunghamCanvasB', cardsId:'ggPersonBGwansang', archetypeId:'ggArchetypeB', deepReportId:null, hideShapeDetails:true, personLabel: state.gunghamB.name ? state.gunghamB.name+'님' : '당신', relVal:'연인/배우자', pillars:state.gunghamB.pillars, ohaeng:state.gunghamB.ohaeng, genderVal:ggGenderB, feature:'gungham', ticketId:state.gungham.nyangTicketId }),
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
  imageDataUrl
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


  // ANALYSIS_LOGIC_SERVER_MIGRATION.md "아직 남은 작업 3번" — 시스템 프롬프트·스키마·온도(0.25) 설정뿐
  // 아니라 ratios/statusMap 계산(getGwansangRatios/judgePartStatus)까지 서버(generateAiEnhancement)가
  // lm으로부터 직접 한다 — 클라이언트는 원본 랜드마크만 보낸다.
  const promise = AiReportAPI.generateAiEnhancement({
    lm, pillars: cfg.pillars, ohaeng: cfg.ohaeng, imageDataUrl,
  });


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
  const { primaryTrait, secondaryTrait } = characterResult;
  const confidenceLine = characterConfidenceLine(characterResult);
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
        ${top2.length === 2 ? `<div class="char-trait-caption">${TRAIT_FACE_LINK[top2[0]]} ${TRAIT_FACE_PHRASE[top2[1]]}이 느껴지는 관상으로, <b>${character.name}</b>이 됐어요</div>` : ''}
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

// 사용자 요청(2026-09-05, 14차 피드백) — 인연도감 캐릭터 상세 전용 후처리: 헤드라인
// ("분위기와 매력으로 사람을 끌어당기는 예인상" 등)은 항상 보이게 남기고, 그 뒤에 오는 형제
// 요소(6가지 힘 바·조선시대의 나·지금의 나·강점/그림자·상황별·궁합 섹션)만 접이식 wrapper로 모아
// 기본 닫힘 상태로 만든다. renderCharacterDetail() 자체(통합분석 등 다른 탭도 같이 씀)는 안 건드리고
// 결과 DOM만 후처리하므로, 그 함수를 호출하는 곳마다 렌더링 직후 이 함수를 불러야 한다. 이미 처리된
// 경우 data-toggle-wired로 중복 실행을 막는다(재렌더 시 헤드라인이 통째로 다시 그려지므로 실제로는
// 항상 새 DOM이라 이 가드가 실질적으로 필요하진 않지만, 방어적으로 남겨둔다).
// 2026-09-05(17차 피드백) — A 본인 화면(#gwansangCharacterDetail)에서 B 화면에 고정 노출되는
// "A의 결과" 카드(#dogamOwnerDetail, js/inyeon-dogam.js showGuestView·renderGuestMergedResult)로
// 재사용하면서 elId를 인자로 받게 일반화했다(정책 문서 2-3 "⚠️ 표준 규칙" 참고 — 두 화면은 항상
// 동일해야 한다).
// 2026-09-05(18차 피드백, 목업 Option 2 채택) — 위 캐릭터 카드의 리본과 이 헤드라인이 똑같은 문장을
// 반복해서 겹쳐 보인다는 지적으로, 이 헤드라인 텍스트 자체를 "{이름}, 어떤 사람일까요?"로 바꾼다(원래
// character.headline 그대로 쓰던 걸 대체). 캐릭터 이름은 renderCharacterDetail이 안 넘겨주므로
// cardElId로 지정한 카드 쪽 .char-card-name에서 읽어온다 — 두 렌더 결과물을 나중에 이어붙이는 구조라
// 어쩔 수 없이 DOM에서 다시 읽는다.
// 정책 문서 5장 — A 결과 화면(오너 본인)은 상세 설명이 기본으로 펼쳐진 상태, B 화면(게스트뷰·결과
// 화면 모두)은 기본으로 닫힌 상태여야 한다. elId가 A 전용 DOM(gwansangCharacterDetail)이면 호출부가
// defaultOpen=true를 넘긴다 — B 화면이 쓰는 dogamOwnerDetail 쪽은 안 넘기므로 그대로 기본 닫힘 유지.
function wireGwansangCharDetailToggle(elId, cardElId, defaultOpen) {
  const root = document.querySelector('#' + elId + ' .char-detail');
  if (!root) return;
  const headline = root.querySelector(':scope > .char-detail-headline');
  if (!headline || headline.dataset.toggleWired) return;
  headline.dataset.toggleWired = '1';

  const nameEl = cardElId && document.querySelector('#' + cardElId + ' .char-card-name');
  if (nameEl) headline.textContent = nameEl.textContent.trim() + ', 어떤 사람일까요?';

  const rest = [];
  let node = headline.nextElementSibling;
  while (node) { const next = node.nextElementSibling; rest.push(node); node = next; }
  if (!rest.length) return; // 헤드라인뿐이면 접을 것도 없다

  const wrap = document.createElement('div');
  wrap.className = defaultOpen ? 'char-detail-collapse' : 'char-detail-collapse hidden';
  rest.forEach(function (n) { wrap.appendChild(n); });
  root.appendChild(wrap);

  const toggleBtn = document.createElement('button');
  toggleBtn.type = 'button';
  toggleBtn.className = defaultOpen ? 'char-detail-toggle open' : 'char-detail-toggle';
  toggleBtn.setAttribute('aria-label', '캐릭터 상세 설명 열고 닫기');
  toggleBtn.innerHTML = '<span class="material-symbols-outlined">expand_more</span>';
  if (defaultOpen) root.classList.add('detail-open');
  // 사용자 요청(2026-09-05) — 새 버튼을 추가하는 게 아니라, 펼쳤을 때 이 헤드라인(닫기 트리거) 자체가
  // 펼친 내용("다른 관상과의 궁합" 등) 아래로 내려가 있어야 다 읽은 자리에서 바로 닫기 편하다는 요청.
  // DOM을 옮기면 위치가 바뀔 때마다 레이아웃이 튀고 이벤트도 다시 신경 써야 해서, 대신 root를 펼쳤을
  // 때만 flex column으로 바꾸고 order로 순서만 시각적으로 뒤집는다(.char-detail.detail-open) — 접으면
  // 자동으로 원래 자리(맨 위)로 돌아온다.
  const toggle = function () {
    const nowHidden = wrap.classList.toggle('hidden');
    toggleBtn.classList.toggle('open', !nowHidden);
    root.classList.toggle('detail-open', !nowHidden);
    if (nowHidden) headline.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  };
  // 목업(Option 2)처럼 좁은 화살표만이 아니라 문구를 포함한 줄 전체를 눌러도 열리게 한다(터치 영역
  // 확보). toggleBtn은 headline의 자식이라 버튼을 눌러도 이 handler로 버블링되므로 따로 안 붙인다.
  headline.onclick = toggle;
  headline.classList.add('char-detail-headline-row');
  headline.appendChild(toggleBtn);
}

// 2026-09-05(20차 피드백, 목업 Option 2 최종 채택) — 처음엔 character.headline 끝의 캐릭터 이름만
// 기계적으로 잘라 썼는데("분위기와 매력으로 사람을 끌어당기는"), 사용자가 목업에서 본 더 짧고 리드미컬한
// "✦ {핵심 두세 단어}로 {동작}는 타입" 태그 스타일을 마음에 들어해서 16개 전부 손으로 다듬어 이 맵으로
// 바꿨다. character.headline/character-db.js 원본 필드는 건드리지 않고(통합분석 등 다른 화면은 원본
// headline을 그대로 씀), 이 칩 표시에만 쓰는 별도 문구다. 맵에 없는 characterId가 들어오면(신규 캐릭터
// 추가 등) 예전처럼 headline 끝 이름만 잘라내는 방식으로 안전하게 대체한다.
const GWANSANG_CARD_TAG = {
  JAESANG: '판을 짜고 사람을 움직이는 타입',
  JANGGUN: '결정하면 끝까지 밀어붙이는 타입',
  GUNWANG: '사람을 모아 방향을 만드는 타입',
  SURYEONG: '책임질 일에는 끝까지 서는 타입',
  GAEHYEOKGA: '낡은 질서를 파헤쳐 뒤집는 타입',
  CHAEKSA: '판을 읽고 망설임 없이 움직이는 타입',
  SASIN: '마음과 마음 사이를 잇는 타입',
  SEONBI: '한번 세운 기준을 지키는 타입',
  HAKJA: '익숙한 데서 새 답을 찾는 타입',
  SANGDANJU: '봇짐 메고 어디든 뛰어드는 타입',
  MUGWAN: '묵묵히 버티고 완수하는 타입',
  GAECHEOKJA: '없는 길도 먼저 뚫는 타입',
  UIWON: '사람 마음을 살펴 얻는 타입',
  YEIN: '분위기로 좌중을 들었다 놨다 하는 타입',
  JANGIN: '감각을 실력으로 만드는 타입',
};
function wireGwansangCharCardChip(elId, characterId) {
  const root = document.getElementById(elId);
  if (!root) return;
  const nameEl = root.querySelector('.char-card-name');
  const ribbon = root.querySelector('.char-card-ribbon');
  if (!nameEl || !ribbon || ribbon.dataset.chipWired) return;
  ribbon.dataset.chipWired = '1';
  const tag = characterId && GWANSANG_CARD_TAG[characterId];
  if (tag) { ribbon.textContent = '✦ ' + tag + ' ✦'; return; }
  // 맵에 없는 경우의 안전장치 — headline 끝의 캐릭터 이름만 잘라낸다.
  const name = nameEl.textContent.trim();
  const text = ribbon.textContent.trim();
  if (name && text.endsWith(name)) {
    ribbon.textContent = text.slice(0, text.length - name.length).trim();
  }
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
// 2026-08-30 DB 이원화 2단계 — 페이지 로드 직후(스크립트 최상단)에 곧바로 불릴 수 있어(아래
// 모듈 로드 시점 호출 참고), 이 함수가 이번 세션에서 캐릭터 카탈로그를 처음 쓰는 경로일 수 있다.
async function renderGwansangRevisitCard() {
  const card = document.getElementById('gwansangRevisitCard');
  const body = document.getElementById('gwansangRevisitBody');
  const label = document.getElementById('gwansangRevisitLabel');
  if (!card || !body) return;
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(inyeonCharacterKey()) || 'null'); } catch (e) { saved = null; }
  if (!saved || !saved.characterId) { card.style.display = 'none'; if (label) label.style.display = 'none'; return; }
  try { await CharacterAPI.ensureCharacterCatalog(); }
  catch (e) { card.style.display = 'none'; if (label) label.style.display = 'none'; return; } // 로그인 세션이 아직 없는 등 — 조용히 숨김(다음 호출에서 재시도됨)
  const character = CHARACTER_DB[saved.characterId];
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
// 2026-08-30 DB 이원화 2단계 — 사진 재분석 없이 저장된 characterId만으로 CHARACTER_DB를 읽으므로,
// 이 함수가 이번 세션에서 캐릭터 카탈로그를 처음 쓰는 경로일 수 있다(예: 새로고침 직후 복원). 그래서
// 방어적으로 await한다 — 캐시가 있으면 즉시 반환된다.
async function populateGwansangReportFromSaved(characterId) {
  try { await CharacterAPI.ensureCharacterCatalog(); }
  catch (e) { console.warn('[populateGwansangReportFromSaved] 카탈로그를 아직 못 받아왔어요', e); return; }
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
  wireGwansangCharCardChip('gwansangCharacterCard', characterId);
  renderCharacterDetail('gwansangCharacterDetail', fake);
  wireGwansangCharDetailToggle('gwansangCharacterDetail', 'gwansangCharacterCard', true);
  document.getElementById('canvasCard').classList.remove('hidden');
  document.getElementById('gwansangResult').classList.remove('hidden');
  markAnalyzed('gwansang');
}
async function reopenSavedCharacter(characterId) {
  await populateGwansangReportFromSaved(characterId);
  try { localStorage.setItem(GWANSANG_REPORT_OPEN_KEY, '1'); } catch (e) {} // 새로고침해도 이 화면 유지
  if (window.Dogam) Dogam.render();
  document.getElementById('canvasCard').scrollIntoView({ behavior: 'smooth' });
}
renderGwansangRevisitCard();

// 룰베이스 분류 → 16캐릭터 판정까지. 관상보기(사주 없음)와 통합분석(사주 포함)이 같은 엔진을 쓰도록
// 공용으로 뺐다. cfg.pillars가 있으면 그대로 융합되므로 통합분석은 "관상70 + 사주30" 캐릭터가 나온다
// (통합분석 화면_콘텐츠_스펙_260817.md Zone1).
// 2026-08-30 DB 이원화 1단계 — 판단 자체(computeCharacterResult)는 서버(functions/engine/character-engine.js)
// 로 옮겼다. 이 함수는 이제 feature 분류까지는 그대로 로컬에서 하고, 판정만 CharacterAPI.analyzeCharacter로
// 서버에 물어본 뒤 기다린다 — 그래서 async가 됐고, 호출부는 전부 await로 바꿔야 한다.
async function classifyAndBuildCharacter(ctx, cfg, lm) {
  // ANALYSIS_LOGIC_SERVER_MIGRATION.md "아직 남은 작업 1번" — 판정 임계값·시그니처 테이블이 정적
  // 파일로 노출되지 않도록, 이 세 단계(classifyAllFeaturesRuleBased→getGwansangRatios→judgePartStatus)를
  // 서버(functions/engine/gwansang-classify.js, classifyGwansang 엔드포인트) 호출로 대체한다.
  const gwansangBundle = await CharacterAPI.classifyGwansang(lm);
  const { featureIds: ids, confidences, partStatusMap } = gwansangBundle;
  state[ctx].archetypeAnalysis = extractArchetypeAnalysis(ids);
  state[ctx].ruleBasedConfidences = confidences;
  // renderPersonalReportV2·renderExtendedAnalysis·buildPersonNarrative 등이 lm을 다시 서버에 보내지
  // 않고 이 응답을 그대로 재사용할 수 있게 저장해둔다(ANALYSIS_LOGIC_SERVER_MIGRATION.md 2026-09-08 확장).
  state[ctx].gwansangBundle = gwansangBundle;

  // 2026-08-30 DB 이원화 2단계 — EYE_ARCHETYPE_DB 등은 이제 빈 캐시라, renderArchetypes가 실제
  // 콘텐츠를 읽으려면 그 전에 서버 카탈로그를 받아 채워둬야 한다(archetype-db.js 주석 참고).
  await CharacterAPI.ensureArchetypeCatalog();
  renderArchetypes(cfg.archetypeId, ids.eye_archetype_id, ids.face_archetype_id, 'rule', cfg.hideShapeDetails ? null : ids, null, cfg.genderVal, cfg.shapeDetailId, cfg.personLabel);

  // §2-A 비교 카드("관상만 봤을 때 → 관상+사주 유형")용 얼굴 단독 판정(faceOnlyCharacterId)은
  // 서버(analyzeCharacter)가 같은 원칙(사주가 섞였을 때만 얼굴만 다시 판정)으로 계산해 함께 내려준다.
  const characterResult = await CharacterAPI.analyzeCharacter({
    featureIds: ids,
    confidences,
    partStatusMap,
    pillars: cfg.pillars || null,
    ohaengCounts: cfg.pillars ? computeOhaeng(cfg.pillars) : null,
    sinsalList: cfg.pillars ? collectSajuInsightSummary(cfg.pillars).sinsalList : null,
    gwiinList: cfg.pillars ? collectSajuInsightSummary(cfg.pillars).gwiinList : null,
    hasHour: cfg.pillars ? cfg.pillars[3].stem >= 0 : false,
    // 유료 기능(combined/gungham)인지, 결제 티켓이 있는지 — 서버가 이걸로 무료 우회를 막는다
    // (functions/index.js analyzeCharacter의 NYANG_GATED_FEATURES 참고).
    feature: cfg.feature || null,
    ticketId: cfg.ticketId || null,
  });
  // CHARACTER_DB도 마찬가지로 빈 캐시라, 호출부가 renderCharacterCard/renderCharacterDetail 등을
  // 곧바로 부를 수 있도록 반환하기 전에 채워둔다.
  await CharacterAPI.ensureCharacterCatalog();
  state[ctx].characterResult = characterResult;
  // 이 시점부터 형상 분류는 확정이다 — 뒤이어 도는 Gemini 호출이 자기 분류로 덮어쓰지 못하게 막는다.
  // (getOrRequestPersonalAiData가 이 플래그를 보고 archetypeAnalysis 갱신을 건너뛴다)
  state[ctx].archetypeIsRuleBased = true;
  if (characterResult) console.log(`[16캐릭터] ${ctx}:`, characterResult);
  return { ids, confidences, characterResult, gwansangBundle };
}

async function requestPersonalAiRuleBased(ctx, cfg, lm) {
  const { characterResult } = await classifyAndBuildCharacter(ctx, cfg, lm);

  // #canvasCard 자리를 캐릭터 일러스트 카드로 쓰기로 함(사용자 요청 2026-08-14) — 관상보기 탭 한정.
  // 그 아래 리포트 안에는 같은 캐릭터의 상세 설명을 펼친다(사용자 요청 2026-08-15).
  if (ctx === 'gwansang') {
    renderCharacterCard('gwansangCharacterCard', characterResult);
    wireGwansangCharCardChip('gwansangCharacterCard', characterResult.characterId);
    renderCharacterDetail('gwansangCharacterDetail', characterResult);
    wireGwansangCharDetailToggle('gwansangCharacterDetail', 'gwansangCharacterCard', true);
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
    await requestPersonalAiRuleBased(ctx, cfg, lm);
    return;
  }

  // ── 통합분석: 형상 분류와 캐릭터 판정은 룰베이스로 통일한다 (스펙 §8-1) ──
  // 예전엔 Gemini가 9종을 분류했는데, 그 결과는 재현되지 않아 같은 사진을 다시 분석하면 유형이
  // 바뀔 수 있었다(§38 QA 기준 "동일 사진 재분석 시 캐릭터 ID 동일률 ≥95%" 미충족 위험).
  // Zone1 캐릭터가 그 위에 서는 순간 캐릭터까지 흔들리므로 관상보기 탭과 같은 룰베이스로 맞췄다.
  // Gemini는 아래에서 계속 호출하되 "부위별 한 문장 보완"만 담당하고 분류는 덮어쓰지 않는다.
  let ruleBased = null;
  if (ctx === 'combined') {
    ruleBased = await classifyAndBuildCharacter(ctx, cfg, lm);
    renderCharacterCard('cmbCharacterCard', ruleBased.characterResult);
    // Figma node 75:1361(통합분석 Zone1) 실측 — TaglinePill이 character.headline 원문이 아니라
    // gwansang/dogam 카드와 같은 짧은 "✦ ~하는 타입 ✦" 문구(GWANSANG_CARD_TAG)다. 이 호출이 빠져
    // 있어서 지금까지 통합분석 카드만 리본에 긴 headline 문장이 그대로 나가고 있었다.
    wireGwansangCharCardChip('cmbCharacterCard', ruleBased.characterResult.characterId);
    renderCharacterBasis('cmbCharacterBasis', ruleBased.characterResult);
    // 기질 바는 바로 위 renderCharacterBasis가 이미 그린다 — 중복 노출 방지
    renderCharacterDetail('cmbCharacterDetail', ruleBased.characterResult, { skipTraitBars: true });
  }

  // Gemini가 없으면 기존 룰베이스 fallback 유지.
  if (!isGeminiConfigured()) {
    if (ruleBased) return; // 통합분석은 이미 룰베이스로 그렸다
    await renderArchetypesFallback(
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

  try {
    // requestDeepReport와 동일한 AI 분류 결과를 공유한다.
    const data =
      await getOrRequestPersonalAiData(
        ctx,
        cfg,
        lm,
        imageDataUrl
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
      await renderArchetypesFallback(
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
    await renderArchetypesFallback(
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
    const isRomantic = !!cache.isRomantic;
    // ANALYSIS_LOGIC_SERVER_MIGRATION.md "아직 남은 작업 3번" — 시스템 프롬프트·스키마 조립과 Gemini
    // 호출을 서버(generateGunghapReport)가 그대로 맡는다.
    const data = await AiReportAPI.generateGunghapReport({
      cache, isRomantic, nameA: cache.nameA || '나', nameB: cache.nameB || '상대방', images,
    });
    renderGunghapResult(data);
  } catch (e) {
    console.error('[Gemini 커플 해석 실패]', e);
    fillGunghapAiFallback();
  }
}
