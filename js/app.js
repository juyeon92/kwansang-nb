// ═══ GLOBALS ═══
let modelsLoaded = false;
let gender = '남', cmbGender = '남', ggGenderA = '남', ggGenderB = '여';
const MODEL_URL = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api/model';

// Stored state per context
const state = {
  gwansang: { relation: '본인', file: null, lm: null, w: 0, h: 0 },
  combined: { relation: '본인', name: '', file: null, lm: null, q1: '', q2: '', q3: '' },
  gunghamA: { file: null, lm: null },
  gunghamB: { file: null, lm: null },
  gungham: { relation: '연인/배우자' },
};

// 인쇄 시 접힌 상세 리포트(.report-accordion)를 전부 강제로 펼쳤다가, 인쇄가 끝나면 원래 상태로 되돌림.
// 화면에서는 접어서 정보 과부하를 줄이되(버그 리포트 6번 항목), 인쇄/PDF에는 내용이 빠지지 않아야 하므로.
let __openedForPrint = [];
window.addEventListener('beforeprint', () => {
  __openedForPrint = Array.from(document.querySelectorAll('.report-accordion:not([open])'));
  __openedForPrint.forEach(d => { d.open = true; });
});
window.addEventListener('afterprint', () => {
  __openedForPrint.forEach(d => { d.open = false; });
  __openedForPrint = [];
});

// ═══ TABS ═══
// 마지막으로 보던 탭을 기억한다 — 새로고침할 때마다 첫 탭(통합분석)으로 튕기면
// 인연도감에서 사진 올리고 작업하던 흐름이 그대로 끊긴다.
const LAST_TAB_KEY = 'gwansangLastTab';
// 인연도감 리포트를 보고 있었는지 — 탭만 복원하면 새로고침 시 리포트가 닫혀 업로드 화면으로 돌아간다.
// "인연도감 메인으로"로 직접 닫은 경우와 구분해야 해서 별도 플래그로 남긴다.
const GWANSANG_REPORT_OPEN_KEY = 'gwansangReportOpen';

// 통합분석·궁합보기·보관함은 로그인해야만 들어올 수 있다(사용자 요청 2026-08-18) — 인연도감만
// 비로그인(익명)으로도 계속 열 수 있다. 익명 인증은 로그인이 아니라 그대로 막는다.
const TAB_LOGIN_REQUIRED = { combined: 1, gungham: 1, archive: 1 };
function isRealLoggedIn() {
  return !!(window.fbAuth && fbAuth.currentUser && !fbAuth.currentUser.isAnonymous);
}
function switchTab(tab, btn) {
  // ⚠️ 버그 수정(2026-08-19 사용자 리포트: 로그인했는데도 로그인 팝업이 뜸) — 새로고침 직후
  // restoreLastTab()이 로그인 필요 탭을 클릭으로 복원할 때, fbAuth.onAuthStateChanged가 아직 한
  // 번도 안 불려서 isRealLoggedIn()이 무조건 false다. "아직 확인 전"에는 팝업을 띄우지 않고 일단
  // 넘어가고, 확인이 끝난 뒤 enforceTabLoginGate()가 정말 로그아웃 상태면 조용히 돌려보낸다.
  const authResolved = !!(window.KakaoAuth && KakaoAuth.isAuthResolved && KakaoAuth.isAuthResolved());
  if (TAB_LOGIN_REQUIRED[tab] && authResolved && !isRealLoggedIn()) {
    if (window.KakaoAuth) KakaoAuth.openLoginPopup('로그인 후 이용하실 수 있는 서비스입니다.');
    return; // 로그인 팝업만 띄우고 탭은 전환하지 않는다
  }
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('panel-' + tab).classList.add('active');
  btn.classList.add('active');
  try { localStorage.setItem(LAST_TAB_KEY, tab); } catch (e) { /* 프라이빗 브라우징 등 */ }
  // 인연도감은 캐릭터 결과·도감 생성 여부에 따라 내용이 달라지는데, 탭을 옮기는 것만으로는 다시
  // 그려지지 않아 "캐릭터를 뽑고 인연도감으로 돌아왔는데 새로 만든 도감이 안 보이고 새로고침해야
  // 뜨는" 상태가 됐다(사용자 리포트 2026-08-17). 들어올 때마다 최신 상태로 다시 그린다.
  if (tab === 'gwansang' && window.Dogam) Dogam.render();
  // 보관함도 인연도감과 같은 이유로 들어올 때마다 다시 그린다 — 방금 분석한 리포트가 목록에
  // 바로 보여야 새로고침 없이도 최신 상태로 보인다.
  if (tab === 'archive' && window.Archive && Archive.enterTab) Archive.enterTab();
  // ⚠️ 버그 수정(2026-08-25 사용자 리포트: "상세보기·다른 사람으로 분석하기 상태로 다른 탭 갔다
  // 통합분석으로 돌아오면 그 화면 그대로 멈춰있음") — renderCombinedSavedReport는 Archive.save 등
  // 같은 탭 안에서의 재호출에서 "보던 화면"을 지켜주려고 만든 함수라(cmbViewingReportId/
  // cmbWantsNewAnalysis 가드), 이 탭을 나갔다 들어오는 경우에도 똑같이 그 화면을 그대로 지켜버렸다.
  // 다른 탭에 갔다 이 탭으로 "돌아오는" 시점에는 그 가드를 먼저 풀어 목록/업로드 화면 중 맞는 걸
  // 새로 고른다.
  if (tab === 'combined' && typeof renderCombinedSavedReport === 'function') {
    const cmbAnalyzingEl = document.getElementById('cmbAnalyzing');
    const cmbResultEl = document.getElementById('cmbResult');
    const cmbAnalyzing = cmbAnalyzingEl && !cmbAnalyzingEl.classList.contains('hidden');
    const cmbHasLiveResult = cmbResultEl && !cmbResultEl.classList.contains('hidden');
    // ⚠️ 버그 수정(2026-08-25 사용자 리포트: "리포트 보고 궁합보기 갔다가 통합분석 오니 아직도
    // 리포트") — 처음 버전은 state.combined.file이 있으면 무조건 "업로드 중"으로 보고 손대지
    // 않았는데, 분석이 끝나 방금 만든 리포트(#cmbResult)가 떠 있는 상태도 file은 그대로 남아있어
    // 똑같이 걸러졌다. 진짜 손대면 안 되는 경우는 "분석이 진행 중"이거나 "사진은 골랐는데 아직
    // 결과가 없는(분석 시작 전 입력 중)" 경우뿐 — 리포트가 이미 떠 있다면 Archive.save로 보관까지
    // 끝난 뒤라 목록으로 돌려도 안전하다.
    if (!cmbAnalyzing && (cmbHasLiveResult || !state.combined.file)) {
      if (cmbHasLiveResult) {
        cmbResultEl.classList.add('hidden');
        const cmbCanvasCardEl = document.getElementById('cmbCanvasCard');
        if (cmbCanvasCardEl) cmbCanvasCardEl.classList.add('hidden');
        state.combined.file = null;
        state.combined.lm = null;
        // ⚠️ 버그 수정(2026-08-27 사용자 리포트: "통합분석에서 리포트 보고 궁합보기 갔다오면
        // 텅 빔") — markAnalyzed('combined')가 분석 시작 시 #cmbUploadSection(사진 등록/내역
        // 목록/저장된 리포트를 담는 바깥 컨테이너) 자체를 숨기는데, 여기서는 안쪽 #cmbResult만
        // 다시 숨기고 그 바깥 컨테이너는 열어주지 않았다. renderCombinedSavedReport()가 안쪽
        // 자식(#cmbSavedStep 등)은 제대로 노출시켜도 부모가 여전히 hidden이라 화면엔 아무것도
        // 안 보였다. resetUpload('combined')는 "새 분석 시작" 모드로 강제 진입해버려 여기선 쓸
        // 수 없으니, 섹션만 직접 열어준다.
        const cmbUploadSectionEl = document.getElementById('cmbUploadSection');
        if (cmbUploadSectionEl) cmbUploadSectionEl.classList.remove('hidden');
      }
      cmbViewingReportId = null;
      const cmbSavedReportEl = document.getElementById('cmbSavedReport');
      if (cmbSavedReportEl) cmbSavedReportEl.classList.add('hidden');
      cmbWantsNewAnalysis = false;
    }
    renderCombinedSavedReport();
  }
  // 궁합보기도 통합분석과 완전히 같은 구조(ggViewingReportId/ggWantsNewAnalysis, #ggResult 완료 후에도
  // state.gunghamA/B.file이 안 지워지는 것까지)라 같은 문제를 그대로 갖고 있었다(사용자 요청
  // 2026-08-25: "궁합보기도 같이 적용해줘").
  if (tab === 'gungham' && typeof renderGunghamSavedReport === 'function') {
    const ggAnalyzingEl = document.getElementById('ggAnalyzing');
    const ggResultEl = document.getElementById('ggResult');
    const ggAnalyzing = ggAnalyzingEl && !ggAnalyzingEl.classList.contains('hidden');
    const ggHasLiveResult = ggResultEl && !ggResultEl.classList.contains('hidden');
    if (!ggAnalyzing && (ggHasLiveResult || (!state.gunghamA.file && !state.gunghamB.file))) {
      if (ggHasLiveResult) {
        ggResultEl.classList.add('hidden');
        const ggCanvasCardEl = document.getElementById('ggCanvasCard');
        if (ggCanvasCardEl) ggCanvasCardEl.classList.add('hidden');
        const gunghamBackBtnEl = document.getElementById('gunghamBackBtn');
        if (gunghamBackBtnEl) gunghamBackBtnEl.classList.add('hidden');
        resetUpload('gunghamA');
        resetUpload('gunghamB');
      }
      ggViewingReportId = null;
      const ggSavedReportEl = document.getElementById('ggSavedReport');
      if (ggSavedReportEl) ggSavedReportEl.classList.add('hidden');
      ggWantsNewAnalysis = false;
    }
    renderGunghamSavedReport();
  }
  // 비로그인 사용자가 이미 만든 도감(캐릭터)이 있으면, 요약 카드+업로드 폼만 보여주고 클릭해야
  // 상세를 보여주는 대신 상세 리포트를 바로 펼쳐서 보여준다(사용자 요청 2026-08-18) — 로그인
  // 사용자는 인연도감 카드로 바로 이어지는 다른 흐름이라 대상이 아니다.
  // 공유 링크(?dogam=)로 들어온 경우엔 초대 화면(내 인연 등록하기)이 우선이라 여기서 내 옛 리포트를
  // 덮어 보여주면 안 된다 — restoreGwansangReport()와 같은 가드.
  if (tab === 'gwansang' && !new URLSearchParams(location.search).get('dogam')) {
    const loggedIn = !!(window.fbAuth && fbAuth.currentUser && !fbAuth.currentUser.isAnonymous);
    if (!loggedIn) {
      let saved = null;
      try { saved = JSON.parse(localStorage.getItem('inyeonLastCharacter') || 'null'); } catch (e) {}
      if (saved && saved.characterId && typeof reopenSavedCharacter === 'function') {
        reopenSavedCharacter(saved.characterId);
      }
    }
  }
}

// 이용약관/개인정보처리방침 — 새 탭이나 외부 페이지가 아니라 앱 안 화면 전환으로 보여준다(사용자 요청
// 2026-08-24: "같은 서비스 안에 있는거야 별도 사이트가 아니라"). 내용은 legal/*.html과 똑같이
// index.html에 그대로 인라인돼 있어(.legal-doc, 사용자 요청 2026-08-25: iframe으로 넣었더니 다른
// 탭과 달리 안쪽만 따로 스크롤돼 이질감이 있었다) 다른 탭처럼 페이지 자체가 스크롤된다 — 그래서
// switchTab()과 달리 로그인 게이트나 iframe 높이 계산 같은 처리 없이, 패널만 그대로 바꿔치기하면 된다.
let __legalReturnPanelId = null;
function openLegalPanel(which) {
  const current = document.querySelector('.panel.active');
  __legalReturnPanelId = current ? current.id : 'panel-gwansang';
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  document.getElementById('panel-legal-' + which).classList.add('active');
  window.scrollTo(0, 0);
}
function closeLegalPanel() {
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  document.getElementById(__legalReturnPanelId || 'panel-gwansang').classList.add('active');
}

// 기본 활성 탭(통합분석)이나 새로고침 복원(restoreLastTab)은 정적 HTML의 active 클래스나 switchTab을
// 거치지 않고 그려질 수 있어서, 로그인 상태가 확정되는 시점(kakao-auth의 onAuthStateChanged)에
// 따로 한 번 더 확인해서 "로그인 안 한 채 로그인 필요 탭에 그려져 있는" 상태를 정리한다.
function enforceTabLoginGate() {
  const active = document.querySelector('.panel.active');
  if (!active) return;
  const tab = active.id.replace('panel-', '');
  if (!TAB_LOGIN_REQUIRED[tab] || isRealLoggedIn()) return;
  const btn = Array.prototype.slice.call(document.querySelectorAll('.tab-btn'))
    .filter(b => (b.getAttribute('onclick') || '').indexOf("'gwansang'") >= 0)[0];
  if (btn) btn.click(); // 로그인 안 해도 볼 수 있는 인연도감으로 돌려보낸다(팝업은 띄우지 않음)
}

function restoreLastTab() {
  // 공유 링크(?dogam=)로 들어온 경우엔 인연도감으로 가야 하므로 복원하지 않는다
  // (js/inyeon-dogam.js의 initFromShareLink가 그 탭을 연다).
  if (new URLSearchParams(location.search).get('dogam')) return;
  let last = null;
  try { last = localStorage.getItem(LAST_TAB_KEY); } catch (e) { return; }
  if (!last || last === 'combined') return; // 통합분석은 이미 기본으로 열려 있다
  const panel = document.getElementById('panel-' + last);
  if (!panel) return; // 탭 구성이 바뀐 뒤 남은 옛 값
  const btn = Array.prototype.slice.call(document.querySelectorAll('.tab-btn'))
    .filter(b => (b.getAttribute('onclick') || '').indexOf("'" + last + "'") >= 0)[0];
  if (btn) btn.click();
}

// 인연도감 리포트를 보던 중이었다면 그 화면까지 되살린다 — 탭만 돌아오고 리포트가 닫혀 있으면
// 사용자 입장에선 "새로고침했더니 처음으로 돌아갔다"와 똑같다.
// 저장해둔 캐릭터로 다시 그리는 것이라 사진을 다시 올리거나 재분석하지 않는다.
function restoreGwansangReport() {
  if (new URLSearchParams(location.search).get('dogam')) return; // 공유 링크는 초대 화면이 우선
  let open = null, saved = null;
  try {
    open = localStorage.getItem(GWANSANG_REPORT_OPEN_KEY);
    saved = JSON.parse(localStorage.getItem('inyeonLastCharacter') || 'null');
  } catch (e) { return; }
  if (!open || !saved || !saved.characterId) return;
  if (typeof reopenSavedCharacter !== 'function') return;
  reopenSavedCharacter(saved.characterId);
  window.scrollTo(0, 0); // reopenSavedCharacter는 스크롤을 옮기지만, 복원은 맨 위에서 시작하는 게 자연스럽다
}

function restoreOnLoad() {
  restoreLastTab();
  if (document.querySelector('.panel.active') && document.querySelector('.panel.active').id === 'panel-gwansang') {
    restoreGwansangReport();
  }
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', restoreOnLoad);
else restoreOnLoad();

// ═══ RELATION ═══
function setRelation(ctx, rel, btn) {
  state[ctx].relation = rel;
  const container = btn.parentElement;
  container.querySelectorAll('.rel-btn').forEach(b => b.classList.remove('on'));
  btn.classList.add('on');
}

// ═══ SAJU 사전 질문 (사주보기에서는 진입 즉시, 통합분석에서는 사진 등록 후 노출) ═══
// ctx: 'saju' | 'combined' — 커스텀 입력창 id는 saju는 'sajuQ1Custom', combined는 'cmbQ1Custom' 식으로 구분
function sajuQCustomId(ctx, q) {
  return (ctx === 'combined' ? 'cmb' : 'saju') + q.toUpperCase() + 'Custom';
}
function setSajuAnswer(ctx, q, value, btn) {
  const container = btn.parentElement;
  container.querySelectorAll('.rel-chip').forEach(b => b.classList.remove('on'));
  btn.classList.add('on');
  const custom = document.getElementById(sajuQCustomId(ctx, q));
  if (value === '직접 입력할게요') {
    custom.classList.remove('hidden');
    custom.focus();
    state[ctx][q] = custom.value.trim();
  } else {
    custom.classList.add('hidden');
    custom.value = '';
    state[ctx][q] = value;
  }
  updateSajuGate(ctx);
}
function setSajuCustom(ctx, q, value) {
  state[ctx][q] = value.trim();
  updateSajuGate(ctx);
}
// combined는 사진 업로드 여부까지 같이 보는 updateCtaDock으로 게이트를 건다(사주보기 탭 삭제로
// 이 함수가 다루던 다른 분기는 없어졌다).
function updateSajuGate(ctx) {
  if (ctx === 'combined') updateCtaDock('combined');
}
function onSajuQ3Input(ctx, el) {
  state[ctx].q3 = el.value;
  document.getElementById(ctx === 'combined' ? 'cmbQ3Counter' : 'sajuQ3Counter').textContent = el.value.length + '/100';
}

// ═══ GENDER ═══
function setGender(g) {
  gender = g;
  document.getElementById('gMale').classList.toggle('on', g === '남');
  document.getElementById('gFemale').classList.toggle('on', g === '여');
}
function setCmbGender(g) {
  cmbGender = g;
  document.getElementById('cmbGMale').classList.toggle('on', g === '남');
  document.getElementById('cmbGFemale').classList.toggle('on', g === '여');
}
function setGgGender(who, g) {
  if (who === 'A') { ggGenderA = g; document.getElementById('ggGMaleA').classList.toggle('on', g==='남'); document.getElementById('ggGFemaleA').classList.toggle('on', g==='여'); }
  else { ggGenderB = g; document.getElementById('ggGMaleB').classList.toggle('on', g==='남'); document.getElementById('ggGFemaleB').classList.toggle('on', g==='여'); }
}

// ═══ UPLOAD / THUMBNAIL LOGIC ═══
const ctxMap = {
  gwansang: { uploadArea: 'uploadArea', thumbArea: 'thumbArea', thumbImg: 'thumbImg', thumbSub: 'thumbSub', spinner: 'gwansangSpinner', err: 'gwansangErr' },
  combined: { uploadArea: 'cmbUploadArea', thumbArea: 'cmbThumbArea', thumbImg: 'cmbThumbImg', thumbSub: 'cmbThumbSub', spinner: 'cmbSpinner', err: 'cmbErr' },
  gunghamA: { uploadArea: 'ggUploadA', thumbArea: 'ggThumbA', thumbImg: 'ggImgA', spinner: null, err: 'ggErr' },
  gunghamB: { uploadArea: 'ggUploadB', thumbArea: 'ggThumbB', thumbImg: 'ggImgB', spinner: null, err: 'ggErr' },
};

function handleDragOver(e) { e.preventDefault(); e.currentTarget.classList.add('drag'); }
function handleDragLeave(e) { e.currentTarget.classList.remove('drag'); }
function handleDrop(ctx, e) {
  e.preventDefault();
  e.currentTarget.classList.remove('drag');
  const file = e.dataTransfer.files[0];
  if (file && file.type.startsWith('image/')) loadThumb(ctx, file);
}
function handleFile(ctx, e) {
  if (e.target.files[0]) loadThumb(ctx, e.target.files[0]);
}

// 사진 업로드에 따라 나타나는 CTA(관상보기/통합분석/궁합보기)
const ctaDockMap = { gwansang: 'gwansangCtaDock', combined: 'cmbCtaDock', gunghamA: 'ggCtaDock', gunghamB: 'ggCtaDock', gungham: 'ggCtaDock' };
function updateCtaDock(ctx) {
  const id = ctaDockMap[ctx];
  if (!id) return;
  const show = (ctx === 'gunghamA' || ctx === 'gunghamB')
    ? !!(state.gunghamA.file && state.gunghamB.file)
    : ctx === 'combined'
      ? !!(state.combined.file && state.combined.q1 && state.combined.q2) // 사주보기처럼 상황·일상 질문까지 필수
      : !!state[ctx].file;
  const el = document.getElementById(id);
  if (el) el.classList.toggle('hidden', !show);
  if (ctx === 'gunghamA' || ctx === 'gunghamB') {
    if (window.Profile && Profile.syncGgAccordion) Profile.syncGgAccordion();
  }
}

// 사진 등록 영역(라벨·안심 안내·업로드 드롭존·썸네일·좌우 반전) 전체 — 분석 전까지만 필요하고,
// 분석이 끝나면 "다른 OOO 분석하기" 버튼(resetUpload)을 눌러야 다시 나타난다. 궁합보기는 나/상대방
// 두 사람분 섹션(ggUploadSectionA/B)이 따로 있어 gunghamA/gunghamB 키로 등록해둔다.
const uploadSectionMap = { gwansang: 'gwansangUploadSection', combined: 'cmbUploadSection', gunghamA: 'ggUploadSectionA', gunghamB: 'ggUploadSectionB' };

// 통합분석 전용 — 사진을 올리기 전까지는 숨겨뒀다가, 업로드되는 순간 사주보기와 같은 상황 질문을 노출한다.
const sajuQBlockMap = { combined: 'cmbSajuQBlock' };

// 분석하기 → 고정 CTA 바와 사진 등록 영역을 숨기고, 결과 콘텐츠 맨 아래의 "다른 OOO 분석하기" 버튼으로 전환
function markAnalyzed(ctx) {
  const dock = ctaDockMap[ctx] && document.getElementById(ctaDockMap[ctx]);
  if (dock) dock.classList.add('hidden');
  if (ctx === 'gungham') { // 나/상대방 프로필 블록 전체(#ggBlockA·B)를 접어 리포트가 바로 보이게 한다
    ['ggBlockA', 'ggBlockB'].forEach(id => {
      const b = document.getElementById(id);
      if (b) b.classList.add('hidden');
    });
    return;
  }
  const section = uploadSectionMap[ctx] && document.getElementById(uploadSectionMap[ctx]);
  if (section) section.classList.add('hidden');
}

function loadThumb(ctx, file) {
  state[ctx].file = file;
  state[ctx].cleanImg = null; // 사진을 바꾸면 이전 사진의 AI 전송용 원본은 즉시 버린다
  const m = ctxMap[ctx];
  const reader = new FileReader();
  reader.onload = (e) => {
    document.getElementById(m.thumbImg).src = e.target.result;
    if (m.thumbSub) document.getElementById(m.thumbSub).textContent = state[ctx].relation ? state[ctx].relation + ' · ' + file.name : file.name;
  };
  reader.readAsDataURL(file);
  document.getElementById(m.uploadArea).style.display = 'none';
  document.getElementById(m.thumbArea).classList.add('show');
  const qBlock = sajuQBlockMap[ctx] && document.getElementById(sajuQBlockMap[ctx]);
  if (qBlock) qBlock.classList.remove('hidden');
  updateCtaDock(ctx);
}

function resetUpload(ctx) {
  state[ctx].file = null;
  state[ctx].lm = null;
  state[ctx].cleanImg = null;
  const m = ctxMap[ctx];
  document.getElementById(m.uploadArea).style.display = '';
  document.getElementById(m.thumbArea).classList.remove('show');
  const section = uploadSectionMap[ctx] && document.getElementById(uploadSectionMap[ctx]);
  if (section) section.classList.remove('hidden'); // 다른 OOO 분석하기 → 사진 등록 영역 재노출
  const qBlock = sajuQBlockMap[ctx] && document.getElementById(sajuQBlockMap[ctx]);
  if (qBlock) qBlock.classList.add('hidden'); // 사진 없을 땐 다시 숨김 — 다음 업로드 때 새로 답하도록
  if (ctx === 'gwansang') {
    document.getElementById('canvasCard').classList.add('hidden');
    document.getElementById('gwansangResult').classList.add('hidden');
    // 리포트를 닫고 메인으로 돌아온 상태 — 새로고침해도 리포트를 다시 열지 않는다.
    try { localStorage.removeItem(GWANSANG_REPORT_OPEN_KEY); } catch (e) {}
    // ⚠️ 버그 수정(2026-09-01 사용자 리포트: "인연도감 메인으로 돌아가서 다른 사람 사진 넣으면
    // 캐릭터가 꼬임") — 바로 위(360행)에서 모든 ctx 공통으로 업로드 섹션의 hidden 클래스를 무조건
    // 없애 다시 보여주는데, 인연도감은 계정당 1개 원칙이라 이미 도감이 있으면 이 입구 자체가 없어야
    // 한다(Dogam.render()가 그 조건을 판단해 인라인 style로 다시 숨긴다). 여기서 클래스만 지우고
    // 끝내면 이미 도감이 있는 사람한테도 "뒤로가기" 한 번으로 업로드 입구가 되살아났다. render()를
    // 다시 불러 도감 존재 여부에 맞게 섹션 노출을 재확정한다.
    if (window.Dogam && Dogam.render) Dogam.render();
  } else if (ctx === 'combined') {
    document.getElementById('cmbCanvasCard').classList.add('hidden');
    document.getElementById('cmbResult').classList.add('hidden');
    // "다른 (사람으로) 통합분석하기"로 들어온 자리 — 보관된 리포트 대신 사진 등록 단계부터 다시 시작한다.
    cmbWantsNewAnalysis = true;
    showCombinedPhotoStep();
    state.combined.q1 = ''; state.combined.q2 = ''; state.combined.q3 = '';
    document.querySelectorAll('#panel-combined .rel-chip').forEach(b => b.classList.remove('on'));
    ['cmbQ1Custom', 'cmbQ2Custom'].forEach(id => {
      const el = document.getElementById(id);
      if (el) { el.classList.add('hidden'); el.value = ''; }
    });
    const cmbQ3 = document.getElementById('cmbQ3');
    if (cmbQ3) cmbQ3.value = '';
    const cmbQ3Counter = document.getElementById('cmbQ3Counter');
    if (cmbQ3Counter) cmbQ3Counter.textContent = '0/100';
  }
  updateCtaDock(ctx);
}

// ═══ 통합분석 첫 화면 — 보관함에 쌓인 분석 내역 재노출 ═══
// 로그인 상태에서 통합분석 기록이 있으면(보관함 = js/archive.js), 사진 등록 단계
// (#cmbPhotoStep: "관상 정보" 라벨·안심 안내·업로드 드롭존)를 감추고 그 자리에 보관된 내역 목록
// (#cmbSavedStep)을 보여준다. 기록이 몇 개든 전부 나열한다(사용자 요청 2026-08-18).
// 행을 누르면 그 리포트를 #cmbSavedReport에 펼친다 — 보관함 스냅샷을 그대로 끼워 넣을 뿐이라
// 재분석·AI 호출·냥 차감이 일어나지 않는다.
// 최초 진입(비로그인이거나 기록 없음)은 지금까지처럼 사진 등록 화면 그대로다.
// 호출 시점: 보관 목록이 바뀔 때마다 archive.js가 부른다(저장·삭제·로그인·로그아웃).
let cmbWantsNewAnalysis = false; // "다른 사람으로 통합분석하기"를 눌러 새 분석을 진행 중인지
let cmbViewingReportId = null;   // 내역에서 펼쳐 본 리포트 id

// 진입 배너(#cmbHero)는 "사진 올려보세요"를 권하는 후킹 카드라, 저장된 리포트를 펼쳐 읽는 화면에서는
// 맥락에 맞지 않아 감춘다(사용자 요청 2026-08-18). 목록·사진 등록 화면에서는 그대로 보인다.
function setCmbHeroVisible(on) {
  const hero = document.getElementById('cmbHero');
  if (hero) hero.classList.toggle('hidden', !on);
}

function showCombinedPhotoStep() {
  const photo = document.getElementById('cmbPhotoStep');
  if (photo) photo.classList.remove('hidden');
  ['cmbSavedStep', 'cmbSavedReport'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.add('hidden');
  });
  setCmbHeroVisible(true);
}

function cmbEsc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}

function renderCombinedSavedReport() {
  const photo = document.getElementById('cmbPhotoStep');
  const saved = document.getElementById('cmbSavedStep');
  const list = document.getElementById('cmbSavedList');
  if (!photo || !saved || !list) return;
  if (cmbWantsNewAnalysis) { showCombinedPhotoStep(); return; }
  if (state.combined.file) return; // 사진을 올리는 중이면 화면을 갈아끼우지 않는다
  const rows = (window.Archive && Archive.listOf) ? Archive.listOf('combined') : [];
  if (!rows.length) { showCombinedPhotoStep(); return; }

  list.innerHTML = rows.map(rec =>
    '<div class="revisit-row" role="button" tabindex="0" onclick="openCombinedSavedReport(\'' + rec.id + '\')">' +
      '<span class="revisit-mark material-symbols-outlined">description</span>' +
      '<div class="revisit-body">' +
        '<div class="revisit-name">' + cmbEsc(rec.title) + '</div>' +
        '<div class="revisit-desc">' + [rec.sub, rec.when].filter(Boolean).map(cmbEsc).join(' · ') + '</div>' +
      '</div>' +
      '<button type="button" class="revisit-del" aria-label="삭제" title="삭제" ' +
        'onclick="event.stopPropagation();Archive.remove(\'' + rec.id + '\')">' +
        '<span class="material-symbols-outlined">delete</span></button>' +
      '<span class="revisit-arrow material-symbols-outlined">chevron_right</span>' +
    '</div>').join('');

  // 리포트를 펼쳐 보던 중에 목록이 갱신된 경우(삭제 등) — 그 기록이 남아 있으면 보던 화면을 유지한다.
  const report = document.getElementById('cmbSavedReport');
  const viewingGone = cmbViewingReportId && !rows.some(r => r.id === cmbViewingReportId);
  if (report && !report.classList.contains('hidden') && !viewingGone) {
    photo.classList.add('hidden');
    setCmbHeroVisible(false);
    return;
  }
  cmbViewingReportId = null;
  if (report) report.classList.add('hidden');
  photo.classList.add('hidden');
  saved.classList.remove('hidden');
  setCmbHeroVisible(true);
}

// 내역 행 클릭 — 보관된 스냅샷을 그대로 펼친다.
async function openCombinedSavedReport(id) {
  const body = document.getElementById('cmbSavedBody');
  const meta = document.getElementById('cmbSavedMeta');
  const rec = (window.Archive && Archive.listOf) ? Archive.listOf('combined').find(r => r.id === id) : null;
  if (!body || !rec) return;
  if (meta) meta.textContent = [rec.title, rec.sub, rec.when].filter(Boolean).join(' · ');
  body.innerHTML = '<div class="arc-empty">리포트를 불러오는 중…</div>';
  document.getElementById('cmbSavedStep').classList.add('hidden');
  document.getElementById('cmbSavedReport').classList.remove('hidden');
  setCmbHeroVisible(false); // 상세 리포트에는 진입 배너를 띄우지 않는다
  cmbViewingReportId = id;
  window.scrollTo(0, 0);
  // 본문은 로컬에 없으면 클라우드에서 받아온다 — 못 찾으면 보관함 상세와 같은 문구를 보여준다.
  const ok = await Archive.renderInto(body, id);
  if (!ok) body.innerHTML = '<div class="arc-empty">저장된 리포트를 찾을 수 없습니다. 분석을 다시 실행해주세요.</div>';
  else if (typeof initZoneAccordions === 'function') initZoneAccordions(); // 새로 찍힌 아코디언에 리스너 연결
}

// ⚠️ 버그 수정(2026-08-21 사용자 리포트: "리포트 보다가 통합분석으로 나오면 내역이 안 보인다") —
// 예전엔 여기서 목록(cmbSavedStep)을 그냥 다시 보여주기만 했다. 보고 있던 사이 다른 기기에서
// 삭제했거나 새로 저장된 기록이 있어도 cmbSavedList의 innerHTML은 리포트를 열기 전 상태 그대로라
// 반영이 안 됐다. cmbSavedReport를 먼저 숨긴 뒤 renderCombinedSavedReport()를 불러 목록을 최신
// Archive.listOf('combined') 기준으로 다시 그린다 — 그 함수가 빈 목록이면 업로드 화면으로 보내는
// 것까지 함께 처리해준다.
function closeCombinedSavedReport() {
  cmbViewingReportId = null;
  document.getElementById('cmbSavedReport').classList.add('hidden');
  renderCombinedSavedReport();
  window.scrollTo(0, 0);
}

// "다른 사람으로 통합분석하기" — 사주(프로필)를 먼저 고르게 하고, 고른 뒤에 사진 등록부터 다시 시작한다.
// 닫기·배경 클릭으로 나가면(onPick 미호출) 보고 있던 리포트 화면이 그대로 남는다.
// ⚠️ 프로필이 하나뿐이거나 이미 분석한 사람을 또 고르면, 사진 등록 화면만 새로 뜨는 게 마치 다른
// 사람 분석이 시작된 것처럼 보였다(사용자 요청 2026-08-19). 고른 프로필로 이미 완료된 통합분석
// 기록이 있으면 진행하지 않고 안내한다 — 다시 하려면 그 기록을 지우고 오라는 뜻.
function startCombinedForOther() {
  if (!window.Profile || !Profile.openSwitcher) return;
  Profile.openSwitcher({
    title: '분석할 사주 선택',
    onPick: function (id) {
      const already = window.Archive && Archive.listOf && Archive.listOf('combined').some(function (r) { return r.profileId === id; });
      if (already) {
        alert('이미 분석한 내용이 있습니다.\n동일 사주로 다른 분석을 원하시면 삭제 후 이용해주세요.');
        startCombinedForOther(); // 다른 프로필을 고르도록 시트를 다시 띄운다
        return;
      }
      resetUpload('combined'); // 안에서 cmbWantsNewAnalysis를 세우고 사진 등록 단계를 되살린다
      window.scrollTo(0, 0);
    },
  });
}

// ═══ 궁합보기 재입력 — "다른 궁합 분석하기" ═══
function resetGunghamResult() {
  resetUpload('gunghamA');
  resetUpload('gunghamB');
  ggWantsNewAnalysis = true; // 보관된 내역이 있어도 지금은 새 분석을 하려는 것 — 내역 목록으로 되돌리지 않는다
  showGunghamInputStep();
  document.getElementById('ggResult').classList.add('hidden');
  document.getElementById('ggCanvasCard').classList.add('hidden');
  document.getElementById('gunghamBackBtn').classList.add('hidden'); // #ggCanvasCard 밖으로 옮겨서 따로 챙긴다
  document.getElementById('panel-gungham').scrollIntoView({ behavior: 'smooth' });
}

// ═══ 궁합보기 리포트 화면의 "궁합보기 메인으로" — 새 분석이 아니라 이 탭의 기본 화면으로 돌아간다 ═══
// ⚠️ 버그 수정(2026-08-20 사용자 리포트: 눌러도 빈 화면만 남음) — 예전엔 이 버튼도 resetGunghamResult를
// 그대로 썼는데, 그 함수는 ggWantsNewAnalysis=true를 세워 "보관 내역이 있어도 무시하고 입력 단계부터"로
// 보내버린다. "메인으로"는 다른 궁합을 분석하겠다는 뜻이 아니라 그냥 되돌아가겠다는 뜻이라, 대신
// renderGunghamSavedReport()를 불러 보관 내역이 있으면 그 목록을, 없으면 입력 단계를 그 판단 그대로 보여준다.
function backToGunghamMain() {
  resetUpload('gunghamA');
  resetUpload('gunghamB');
  ggWantsNewAnalysis = false;
  document.getElementById('ggResult').classList.add('hidden');
  document.getElementById('ggCanvasCard').classList.add('hidden');
  document.getElementById('gunghamBackBtn').classList.add('hidden');
  renderGunghamSavedReport();
  document.getElementById('panel-gungham').scrollIntoView({ behavior: 'smooth' });
}

// ═══ 궁합보기 첫 화면 — 보관함에 쌓인 궁합 내역 재노출 ═══
// 통합분석 첫 화면(renderCombinedSavedReport)과 같은 원칙(사용자 요청 2026-08-19) — 로그인 상태에서
// 궁합 기록이 있으면 나/상대방 선택 단계(#ggInputStep) 대신 보관된 내역 목록(#ggSavedStep)을 보여준다.
// 호출 시점: 보관 목록이 바뀔 때마다 archive.js가 부른다(저장·삭제·로그인·로그아웃).
let ggWantsNewAnalysis = false; // "다른 상대와 궁합보기"를 눌러 새 분석을 진행 중인지
let ggViewingReportId = null;   // 내역에서 펼쳐 본 리포트 id

// 진입 배너(#ggHeroBanner)는 setCmbHeroVisible()과 같은 원칙 — 목록·입력 단계에서는 보이고,
// 상세 리포트를 펼쳐 읽는 화면에서는 맥락에 맞지 않아 감춘다(사용자 요청 2026-08-20).
function setGgHeroVisible(on) {
  const hero = document.getElementById('ggHeroBanner');
  if (hero) hero.classList.toggle('hidden', !on);
}

function showGunghamInputStep() {
  const input = document.getElementById('ggInputStep');
  if (input) input.classList.remove('hidden');
  ['ggSavedStep', 'ggSavedReport'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.add('hidden');
  });
  setGgHeroVisible(true);
}

function renderGunghamSavedReport() {
  const input = document.getElementById('ggInputStep');
  const saved = document.getElementById('ggSavedStep');
  const list = document.getElementById('ggSavedList');
  if (!input || !saved || !list) return;
  if (ggWantsNewAnalysis) { showGunghamInputStep(); return; }
  if (state.gunghamA.file || state.gunghamB.file) return; // 사진을 올리는 중이면 화면을 갈아끼우지 않는다
  // ⚠️ 버그 수정(2026-08-21 사용자 리포트: "궁합을 처음 볼 때 진입 배너가 같이 뜬다") — runGungham()이
  // 분석을 끝내면 #ggResult를 연 다음 Archive.save('gungham')을 부르는데, 그 저장이 notifyChanged()로
  // 이 함수를 다시 불러서 아래 로직이 "저장 목록으로 돌아가기"로 오해해 #ggSavedStep을 켜고 진입
  // 배너(setGgHeroVisible(true))까지 되살렸다. 방금 만든 리포트가 떠 있는 중이면 여기서 화면을
  // 건드리지 않고 그대로 둔다.
  const liveResult = document.getElementById('ggResult');
  if (liveResult && !liveResult.classList.contains('hidden')) return;
  const rows = (window.Archive && Archive.listOf) ? Archive.listOf('gungham') : [];
  if (!rows.length) { showGunghamInputStep(); return; }

  list.innerHTML = rows.map(rec =>
    '<div class="revisit-row" role="button" tabindex="0" onclick="openGunghamSavedReport(\'' + rec.id + '\')">' +
      '<span class="revisit-mark material-symbols-outlined">favorite</span>' +
      '<div class="revisit-body">' +
        '<div class="revisit-name">' + cmbEsc(rec.title) + '</div>' +
        '<div class="revisit-desc">' + [rec.sub, rec.when].filter(Boolean).map(cmbEsc).join(' · ') + '</div>' +
      '</div>' +
      '<button type="button" class="revisit-del" aria-label="삭제" title="삭제" ' +
        'onclick="event.stopPropagation();Archive.remove(\'' + rec.id + '\')">' +
        '<span class="material-symbols-outlined">delete</span></button>' +
      '<span class="revisit-arrow material-symbols-outlined">chevron_right</span>' +
    '</div>').join('');

  // 리포트를 펼쳐 보던 중에 목록이 갱신된 경우(삭제 등) — 그 기록이 남아 있으면 보던 화면을 유지한다.
  const report = document.getElementById('ggSavedReport');
  const viewingGone = ggViewingReportId && !rows.some(r => r.id === ggViewingReportId);
  if (report && !report.classList.contains('hidden') && !viewingGone) {
    input.classList.add('hidden');
    setGgHeroVisible(false);
    return;
  }
  ggViewingReportId = null;
  if (report) report.classList.add('hidden');
  input.classList.add('hidden');
  saved.classList.remove('hidden');
  setGgHeroVisible(true);
}

// 내역 행 클릭 — 보관된 스냅샷을 그대로 펼친다.
async function openGunghamSavedReport(id) {
  const body = document.getElementById('ggSavedBody');
  const meta = document.getElementById('ggSavedMeta');
  const rec = (window.Archive && Archive.listOf) ? Archive.listOf('gungham').find(r => r.id === id) : null;
  if (!body || !rec) return;
  if (meta) meta.textContent = [rec.title, rec.sub, rec.when].filter(Boolean).join(' · ');
  body.innerHTML = '<div class="arc-empty">리포트를 불러오는 중…</div>';
  document.getElementById('ggSavedStep').classList.add('hidden');
  document.getElementById('ggSavedReport').classList.remove('hidden');
  setGgHeroVisible(false); // 상세 리포트에는 진입 배너를 띄우지 않는다
  ggViewingReportId = id;
  window.scrollTo(0, 0);
  const ok = await Archive.renderInto(body, id);
  if (!ok) body.innerHTML = '<div class="arc-empty">저장된 리포트를 찾을 수 없습니다. 분석을 다시 실행해주세요.</div>';
  else if (typeof initZoneAccordions === 'function') initZoneAccordions(); // 새로 찍힌 아코디언에 리스너 연결
}

// ⚠️ 버그 수정(2026-08-25 사용자 리포트: "페이지 이동했는데 새로고침 안 된 것 같다") — 여기가
// closeCombinedSavedReport의 궁합보기 쌍둥이 함수인데, 그쪽만 2026-08-21에 "목록을 stale한 채로
// 그냥 다시 보여주기만 한다"는 버그를 고쳤고 이 함수는 그대로 남아있었다. #ggSavedList를 다시 그리지
// 않고 classList만 토글하니, 리포트를 보고 있는 사이 다른 기기에서 삭제했거나 새로 저장된 기록이
// 있어도 반영이 안 됐다. renderGunghamSavedReport()로 Archive.listOf('gungham') 기준 최신 목록을
// 다시 그린다 — 그 함수가 빈 목록이면 입력 단계로 보내는 것까지 함께 처리해준다.
function closeGunghamSavedReport() {
  ggViewingReportId = null;
  document.getElementById('ggSavedReport').classList.add('hidden');
  renderGunghamSavedReport();
  window.scrollTo(0, 0);
}

// "다른 상대와 궁합보기" — 상대방만 다시 고르면 된다(나는 대표 프로필로 고정). 고른 뒤에 선택
// 단계(#ggInputStep)로 돌아가 사진 등록부터 새로 진행한다.
// ⚠️ 버그 수정(2026-08-25) — startCombinedForOther는 onPick 안에서 resetUpload('combined')를 불러
// 이전 사진·상태를 지우는데, 이 함수는 showGunghamInputStep()만 부르고 state.gunghamB(사진·랜드마크)를
// 지우지 않았다. applyToGunghamB가 생년월일·성별은 새로 고른 상대 걸로 채워주지만 사진은 그대로 남아,
// "새 상대의 생년월일 + 예전 상대의 사진"이 섞인 채로 입력 단계가 열렸다. 나(A)는 대표 프로필 고정이라
// 의도적으로 안 건드리고, 상대(B)만 resetUpload로 사진·랜드마크를 비운다.
function startGunghamForOther() {
  if (!window.Profile || !Profile.openPartnerPicker) return;
  Profile.openPartnerPicker({
    onPick: function () {
      resetUpload('gunghamB');
      ggWantsNewAnalysis = true;
      showGunghamInputStep();
      window.scrollTo(0, 0);
    },
  });
}

// ═══ SPINNER / ERROR HELPERS ═══
function setSpinner(id, msg) {
  if (!id) return;
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.add('show'); el.style.display = 'block';
  const msgEl = el.querySelector('p');
  if (msgEl && msg) msgEl.textContent = msg;
}
function hideSpinner(id) {
  if (!id) return;
  const el = document.getElementById(id);
  if (el) { el.classList.remove('show'); el.style.display = 'none'; }
}
function showErr(id, msg) {
  const el = document.getElementById(id);
  if (el) { el.innerHTML = msg; el.classList.add('show'); }
}
function hideErr(id) {
  const el = document.getElementById(id);
  if (el) el.classList.remove('show');
}

// ═══ FACE ANALYSIS (Promise 기반 — await 가능) ═══
// ═══ ANALYZE (관상 탭 버튼용) ═══
async function startAnalysis(ctx) {
  if (!state[ctx].file) { alert('사진을 먼저 업로드해주세요.'); return; }
  const m = ctxMap[ctx];
  hideErr(m.err);

  const lm = await runFaceAnalysis(ctx);
  if (!lm) return;

  if (ctx === 'gwansang') {
    document.getElementById('canvasCard').classList.remove('hidden');
    const rel = state.gwansang.relation;
    document.getElementById('gwansangResultTitle').textContent = `🔮 AI 관상 개운 리포트 (${rel})`;
    renderPersonalReportV2(lm, { headline:'gwansangHeadline', cards:'gwansangCards', summary:'gwansangSummary', result:'gwansangResult' }, null);
    renderExtendedAnalysis(lm, { asymmetry:'gwansangAsymmetry', faceOhaeng:'gwansangFaceOhaeng', tier3:'gwansangTier3', foreheadNotice:'gwansangForeheadNotice' });
    renderSnapshotHighlights(getGwansangRatios(lm), 'gwansangSnapshot');
    // 관상보기 탭은 Gemini를 아예 호출하지 않는다(사용자 요청) — 분류(requestPersonalAi)는 이미
    // 룰베이스로만 도는데, 여기서 이어서 부르던 requestDeepReport(장문 해설)는 여전히 Gemini API를
    // 쳐서 503 등 API 장애가 그대로 사용자에게 "AI 리포트 생성 실패" 문구로 노출되는 문제가 있었다.
    // 장문 해설은 고정 템플릿 하네스(별도 전달 예정)로 교체될 때까지 이 탭에서는 아예 호출하지 않는다.
    setSpinner(m.spinner, '관상 분석중~');
    await requestPersonalAi('gwansang');
    hideSpinner(m.spinner);
    document.getElementById('gwansangResult').classList.remove('hidden');
    markAnalyzed('gwansang');
    try { localStorage.setItem(GWANSANG_REPORT_OPEN_KEY, '1'); } catch (e) {} // 새로고침해도 이 화면에 머무르도록
    // 2026-08-31 정책(사용자 확정: "원본은 하나여야 해") — 인연도감은 더 이상 보관함에 스냅샷을 찍지
    // 않는다(보관함이 Dogam.ensureMyDogam()으로 실물을 직접 보여준다, archive.js 참고). 여기서는
    // 방금 만든 도감이 화면(#dogamSection)에 반영되도록 Dogam.render()만 부르면 된다.
    if (window.Dogam) Dogam.render().catch(function (e) { console.error('[dogam] render 실패', e); });
  } else if (ctx === 'combined') {
    document.getElementById('cmbCanvasCard').classList.remove('hidden');
  }
}

// ═══ 2030 MBTI 콘텐츠 엔진 (db/FACE_READING·COMPLEMENT·SAJU_LINK 기반, 상세 매핑은 CONTENT_SPEC.md) ═══
function getRelLabel(rel) {
  const map = { '본인': '당신은', '엄마': '어머니는', '아빠': '아버지는', '자녀': '자녀분은', '형제/자매': '형제/자매분은', '친구': '친구분은', '연인/배우자': '파트너분은', '기타': '이분은', '가족': '가족분은' };
  return map[rel] || '이분은';
}

// 오행(내부 판단용, 화면에는 절대 노출하지 않음) → 은유 표현 (CONTENT_SPEC.md §4)
const OHAENG_VIBE = {
  목: { season:'봄', line:'새싹처럼 쭉쭉 뻗어나가는 개척자 기운' },
  화: { season:'여름', line:'태양처럼 확 타오르는 인싱 리더 기운' },
  토: { season:'늦여름', line:'든든하고 넓은 산 같은, 흔들림 없는 능력자 기운' },
  금: { season:'가을', line:'서리처럼 칼같이 정리하는 카리스마 기운' },
  수: { season:'겨울', line:'강물처럼 깊고 조용히 다 계산 끝낸 지략가 기운' },
};
// 종합 운세 리포트용 상세 문단 (신년운세 톤, 한자 노출 없음)
const OHAENG_DETAIL = {
  목: '봄의 새싹처럼 쭉쭉 뻗어나가는 개척자 기운을 타고났어요. 남이 안 가본 길이라도 일단 발을 들이는 추진력이 있고, 새로운 걸 배우거나 시작하는 데 두려움이 없는 편이에요.',
  화: '여름 태양처럼 확 타오르는 인싱 리더 기운을 타고났어요. 사람을 끌어모으는 매력이 있고, 하고 싶은 걸 숨기지 않고 바로 표현하는 솔직함이 매력 포인트예요.',
  토: '든든하고 넓은 산 같은, 흔들림 없는 능력자 기운을 타고났어요. 웬만한 일에는 잘 흔들리지 않고, 주변 사람들이 자연스럽게 의지하게 되는 믿음직한 존재예요.',
  금: '가을 서리처럼 칼같이 정리하는 카리스마 기운을 타고났어요. 맺고 끊는 게 분명하고, 원칙과 기준이 확실해서 한번 정한 건 끝까지 지켜내는 타입이에요.',
  수: '겨울 강물처럼 깊고 조용히 다 계산 끝낸 지략가 기운을 타고났어요. 말은 적어도 이미 여러 수를 내다보고 있고, 위기 상황에서 오히려 차분해지는 스타일이에요.',
};
const OHAENG_TITLE = {
  목: '일단 해보고 본다! 새싹처럼 뻗어나가는 개척자상',
  화: '밝히고 본다! 주변까지 다 데우는 인싱 리더상',
  토: '하면 된다! 흔들림 없이 내 길을 개척하는 능력자상',
  금: '칼같이 정리한다! 결단력으로 승부 보는 카리스마상',
  수: '다 계산 끝났다! 조용히 다 아는 지략가상',
};

// 8대 관상 부위 정의 (db/FACE_FEATURE.csv 중 detectable_by_ai=TRUE 8개 그대로 유지 → CONTENT_SPEC.md §1)
const PART_DEF = [
  { key:'forehead',    icon:'📍', label:'이마',      sub:'일 운 · 명예운' },
  { key:'eyebrow',     icon:'🌿', label:'눈썹',      sub:'대인관계 · 형제운' },
  { key:'midbrow',     icon:'🌟', label:'미간',      sub:'주관 · 리더십 · 대인관계' },
  { key:'undereye',    icon:'👁', label:'눈밑',      sub:'정 · 인복 · 자녀운' },
  { key:'nosebridge',  icon:'🏔', label:'코 뿌리',   sub:'자존심 · 중년운' },
  { key:'nosetip',     icon:'💎', label:'코끝',      sub:'재물운 · 자존감' },
  { key:'philtrum',    icon:'💧', label:'인중',      sub:'건강 · 수명 · 의지력' },
  { key:'mouth',       icon:'👄', label:'입',        sub:'표현력 · 재물 씀씀이' },
  { key:'smilelines',  icon:'〰', label:'팔자주름',  sub:'사회성 · 카리스마' },
  { key:'jaw',         icon:'📍', label:'턱',        sub:'말년운 · 조력자 운' },
  { key:'cheekbone',   icon:'⛰️', label:'광대',      sub:'대외활동력 · 추진력' },
];
// 부위별 문장 (db/FACE_READING.csv → CONTENT_SPEC.md §2, 팁은 db/COMPLEMENT.csv → §3, 시술 문구 없음)
const PART_CONTENT = {
  forehead: {
    strength: { meaning:'이마 비율이 시원하게 딱 떨어져요. 일이든 관계든 스스로 방향을 잡고 나아가는 타입이라 명예운이 알아서 따라와요.', makeup:'이마 중앙에 은은한 펄 하이라이터나 톤업 베이스를 터치해서 빛을 받게 연출해보세요.', lifestyle:'세안 후 양손으로 이마 중앙에서 관자놀이 쪽으로 쓸어 넘기며 지압해주세요. 이마를 드러내는 헤어 연출도 잘 맞아요.' },
    complement: { meaning:'이마 중앙 볼륨감이 살짝 아쉬워서, 한 일에 비해 평가를 조금 늦게 받는 편일 수 있어요.', makeup:'이마 중앙에 하이라이터로 볼륨감을 살려주면 훨씬 또렷한 인상을 줄 수 있어요.', lifestyle:'세안 후 이마 중앙 지압을 해주고, 시스루 뱅처럼 이마를 살짝 드러내는 헤어 연출을 함께 해보세요.' },
  },
  midbrow: {
    strength: { meaning:'미간이 시원하게 넓어서 여유 있고 포용력 있는 인상이에요. 웬만한 건 다 받아주는 그릇이 큰 타입이라 대인관계가 편안해요.', makeup:'눈썹 숱을 자연스럽게 살려주면 포용력 있는 인상이 한층 살아나요.', lifestyle:'부드러운 웨이브 헤어스타일을 더하면 신뢰감이 훨씬 올라가요.' },
    complement: { meaning:'미간이 살짝 좁아서 집중력은 최고인데, 가끔 내 세계에만 빠져있단 얘기를 들을 수 있어요.', makeup:'눈썹 사이를 살짝 정리하고 눈동자를 감싸는 아치형으로 그려주면 답답한 인상이 확 풀려요.', lifestyle:'대화할 때 상대 눈을 3초만 더 바라봐 주세요. 인복 기운이 훨씬 잘 통해요.' },
  },
  undereye: {
    strength: { meaning:'눈 밑이 도톰해서 정이 많고 다정한 타입이에요. 사람이 잘 따르고 인복도 두둑해요.', makeup:'언더라인에 밝은 섀도우로 살짝 강조해주면 다정한 인상이 더 살아나요.', lifestyle:'웃을 때 눈웃음을 짓는 연습을 해보세요. 인복이 몰릴수록 운도 같이 몰려요.' },
    complement: { meaning:'눈 밑이 매끈해서 독립적이고 자립심이 강한 타입이에요. 다만 혼자 다 짊어지려는 습관은 살짝 내려놔도 돼요.', makeup:'언더라인에 살짝 하이라이트를 더해 생기 있는 인상을 만들어보세요.', lifestyle:'화면을 오래 본 날은 온열 안대로 눈 피로를 풀어주세요.' },
  },
  nosebridge: {
    strength: { meaning:'코 뿌리가 시원하게 뻗어 있어서 자존심 있고 리더십 있는 타입이에요. 중년으로 갈수록 입지가 더 단단해져요.', makeup:'콧대에 살짝 음영을 넣어 곧은 라인을 살려보세요.', lifestyle:'세안할 때 눈 앞머리부터 콧대 시작점까지 꾹꾹 쓸어내리는 셀프 마사지를 해보세요.' },
    complement: { meaning:'코 뿌리가 부드러워서 유연하고 협동심 좋은 타입이에요. 다만 중요한 순간엔 내 의견도 확실히 챙기는 연습이 도움이 돼요.', makeup:'콧대에 하이라이터로 라인을 살짝 세워주세요.', lifestyle:'중요한 결정 앞에서는 "내가 원하는 건 뭐지"를 먼저 물어보는 연습을 해보세요.' },
  },
  nosetip: {
    strength: { meaning:'콧대가 곧게 뻗어 있고 코끝에 힘이 딱 들어간 상이에요. 남한테 안 흔들리는 자존감과 차곡차곡 모으는 실속형 재물운을 함께 가졌어요.', makeup:'콧망울 옆 유분기는 파우더로 보송하게 잡아주고, 콧대에 살짝 음영을 넣어보세요.', lifestyle:'세안할 때 콧대에서 코끝까지 꾹꾹 눌러주는 셀프 마사지를 해보세요.' },
    complement: { meaning:'코끝이 살짝 여려서, 있는 돈 없는 돈 다 쓰기 전에 잠깐 멈추는 습관이 필요해요.', makeup:'코 하이라이터로 콧대에서 코끝까지 이어서 세워주면 훨씬 실속 있는 인상이 돼요.', lifestyle:'큰 지출 전엔 하루만 미뤄보는 습관을 만들어보세요. 재물운이 훨씬 안정적으로 쌓여요.' },
  },
  philtrum: {
    strength: { meaning:'인중이 또렷해서 건강한 생명력과 의지력을 가진 타입이에요. 웬만한 고비는 다 버텨내는 힘이 있어요.', makeup:'립 프라이머로 인중과 입술 경계를 또렷하게 정리해보세요.', lifestyle:'충분한 수분 섭취와 규칙적인 수면이 지금의 좋은 기운을 오래 유지해줘요.' },
    complement: { meaning:'인중이 짧고 산뜻해서 빠릿빠릿하고 민첩한 타입이에요. 다만 중요한 결정 앞에서는 한 번 더 생각하는 여유가 도움이 돼요.', makeup:'립라인을 살짝 또렷하게 그려 안정감 있는 인상을 더해보세요.', lifestyle:'중요한 결정은 하루만 미뤄서 다시 한 번 살펴보는 습관을 만들어보세요.' },
  },
  smilelines: {
    strength: { meaning:'팔자주름이 뚜렷해서 사회성과 카리스마가 넘치는 타입이에요. 조직 안에서 자연스럽게 중심이 돼요.', makeup:'너무 진하지 않은 자연스러운 톤의 메이크업으로 부드러움을 더하면 편안한 인상도 함께 챙길 수 있어요.', lifestyle:'평소보다 살짝 더 자신감 있는 표정을 지어보세요. 이미 갖춘 카리스마가 훨씬 잘 드러나요.' },
    complement: { meaning:'팔자주름이 얕아서 자유로운 기질이 강한 편이에요. 다만 표현력은 살짝 약해 보일 수 있어요.', makeup:'입 주변을 또렷하게 연출하는 립 메이크업을 더해보세요.', lifestyle:'하루 10분 입꼬리 올리기 운동으로 표정 근육을 풀어주세요.' },
  },
  jaw: {
    strength: { meaning:'턱선이 둥글고 안정적이라 한번 곁에 둔 사람은 오래가는 타입이에요. 말년운과 조력자 운이 빵빵해요.', makeup:'립 라이너로 입술 산과 입꼬리 끝을 살짝 위로 연장하듯 그려서 스마일 립을 만들어보세요.', lifestyle:'턱 밑 괄사 마사지로 라인을 정돈해보세요. 사람이 몰릴수록 운도 같이 몰려요.' },
    complement: { meaning:'턱선이 갸름해서 감수성은 풍부하지만 안정감은 살짝 약해 보일 수 있어요.', makeup:'턱선 컨투어링으로 윤곽을 살려주면 훨씬 신뢰감 있는 인상이 돼요.', lifestyle:'하루 10분 턱 밑 괄사 마사지와 함께 장기 계획을 정기적으로 점검하는 습관을 만들어보세요.' },
  },
  eyebrow: {
    strength: { meaning:'눈썹이 눈보다 여유 있게 위치해서 대인관계가 편안하고 형제·동료 운이 좋은 타입이에요.', makeup:'눈썹 앞머리는 자연스럽게 두고 꼬리만 살짝 정리해서 여유로운 인상을 살려보세요.', lifestyle:'주변 사람들과 함께하는 모임을 늘려보세요. 인복이 잘 몰리는 시기예요.' },
    complement: { meaning:'눈썹이 눈에 가까이 있어서 예리하고 집중력 있는 타입이에요. 다만 날카로운 인상으로 비칠 수 있어요.', makeup:'눈썹 산 부분을 살짝 부드럽게 그려주면 날카로운 인상이 한결 편안해져요.', lifestyle:'대화할 때 미소를 조금 더 자주 지어보세요. 관계 운이 훨씬 부드러워져요.' },
  },
  mouth: {
    strength: { meaning:'입이 시원하게 크고 또렷해서 표현력이 좋고 대인관계에 적극적인 타입이에요.', makeup:'입술 산 라인을 또렷하게 살려서 표현력 있는 인상을 강조해보세요.', lifestyle:'하고 싶은 말은 미루지 말고 바로 표현하는 습관이 운을 더 키워요.' },
    complement: { meaning:'입이 아담해서 신중하고 절약형인 타입이에요. 다만 속마음을 잘 안 드러낼 수 있어요.', makeup:'립 라이너로 입술 윤곽을 살짝 키워 그리면 표현력이 살아나요.', lifestyle:'중요한 마음은 참지 말고 말로 표현하는 연습을 해보세요.' },
  },
  cheekbone: {
    strength: { meaning:'광대가 시원하게 발달해서 대외활동력과 추진력이 좋은 타입이에요.', makeup:'광대 위쪽에 살짝 블러셔를 얹으면 생기 있고 활동적인 인상이 살아나요.', lifestyle:'새로운 사람을 만나는 자리를 피하지 말고 적극적으로 나서보세요.' },
    complement: { meaning:'광대가 부드럽게 자리 잡아서 온화하고 편안한 인상인 타입이에요. 다만 대외적 추진력은 조금 아쉬울 수 있어요.', makeup:'광대 위치에 자연스러운 하이라이터로 볼륨감을 살짝 더해보세요.', lifestyle:'중요한 자리에서는 한 번 더 목소리를 내는 연습을 해보세요.' },
  },
};

// 랜드마크 비율 → 부위별 강점/보완 판정 (판단기준 정립 인터뷰로 11개 부위 확정 — read/AI_관상_사진분석_판단기준_설계.md §6)
// 절대 기준(모집단 대비 "넓다/좁다")은 실측 분포 데이터가 없어 검증할 수 없으므로 채택하지 않음.
// 대신 "이 사람 자신의 부위들 중 상대적으로 어디가 더 발달했는가"로 판단 — 부위별 레벨(0~100)을 구해
// 본인 안에서 순위를 매기고 상위 절반을 강점, 나머지를 보완으로 분류. 이렇게 하면 사람마다 반드시
// 강점·보완이 섞여 나오고, 외부 레퍼런스 사진이나 모집단 통계 없이도 사진별로 결과가 달라진다.
const PART_KEY_TO_MEASURE = { forehead:'gwanR', eyebrow:'browGapR', midbrow:'mgW', undereye:'waJ', nosebridge:'sanR', nosetip:'junduR', philtrum:'injR', mouth:'mouthR', smilelines:'beomR', jaw:'jigakR', cheekbone:'cheekR' };
function judgePartStatus(r) {
  const levels = Object.entries(PART_KEY_TO_MEASURE).map(([key, measure]) => [key, gwansangLevel(measure, r[measure])]);
  const strongCount = Math.ceil(levels.length / 2);
  const strongKeys = new Set([...levels].sort((a, b) => b[1] - a[1]).slice(0, strongCount).map(([key]) => key));
  const status = {};
  levels.forEach(([key]) => { status[key] = strongKeys.has(key) ? 'strength' : 'complement'; });
  return status;
}
// judgePartStatus와 같은 레벨 계산을 재사용하되, 정렬된 순위 그대로 반환 — "가장 발달한 부위 Top" 같은
// 스냅샷 하이라이트에 쓰기 위함(버그 리포트 6번 항목: 1페이지 핵심 요약 카드).
function getPartLevelsSorted(r) {
  return Object.entries(PART_KEY_TO_MEASURE).map(([key, measure]) => [key, gwansangLevel(measure, r[measure])]).sort((a, b) => b[1] - a[1]);
}
// 1페이지 핵심 스냅샷 — 전체 리포트를 다 안 봐도 "가장 발달한 부위 2개 + 채워볼 포인트 1개"만 바로 보이게.
function renderSnapshotHighlights(r, elId) {
  const el = document.getElementById(elId);
  if (!el) return;
  const sorted = getPartLevelsSorted(r);
  const top2 = sorted.slice(0, 2).map(([key]) => PART_DEF.find(p => p.key === key));
  const bottom = PART_DEF.find(p => p.key === sorted[sorted.length - 1][0]);
  el.innerHTML = `
    <div class="snapshot-row">✨ <strong style="color:var(--gold);">가장 발달한 부위</strong> — ${top2.map(p => `${p.icon} ${p.label}`).join(' · ')}</div>
    <div class="snapshot-row">🌱 <strong style="color:var(--purple-light);">채워볼 포인트</strong> — ${bottom.icon} ${bottom.label}</div>
  `;
  el.classList.remove('hidden');
}

function buildHeadline(dStem) {
  const oh = dStem >= 0 ? CG_OH[dStem] : '토';
  return OHAENG_TITLE[oh] || OHAENG_TITLE['토'];
}

// 통합분석 Zone2 히어로 헤드 — buildCoupleHeadline(궁합보기)과 같은 원칙: 점수 구간별 고정 문구,
// AI 호출 없음(통합분석 리포트 구성.md §1·§2 — "제목/헤드"급은 룰베이스로 고정). chemiScore가
// null이면(사진 없어 케미 계산 불가) 호출하지 않고 buildHeadline(dStem)을 그대로 쓴다.
function buildChemiHeadline(chemiScore) {
  if (chemiScore >= 80) return '찰떡 케미! 관상과 사주가 한 목소리를 내는, 타고난 그대로 사는 상';
  if (chemiScore >= 60) return '합이 좋은 케미! 생김새와 타고난 기운이 대체로 같은 곳을 보는 상';
  if (chemiScore >= 40) return '밸런스 케미! 얼굴과 사주가 서로 다른 색을 내며 균형을 잡는 상';
  return '반전 매력 케미! 겉모습과 타고난 기운이 정반대 매력으로 채워주는 상';
}

// 통합분석 Zone2 "기운 줄다리기" 문구 — computeChemiDominance(character-engine.js)의 facePct/sajuPct
// 기반 3케이스, 룰베이스(AI 호출 없음). chemiScore(방향 일치도)와 독립된 축이라 별도 함수로 분리.
function buildDominanceLine(dominance) {
  if (!dominance) return '';
  const { facePct, sajuPct } = dominance;
  if (facePct >= 45 && facePct <= 55) return '관상과 사주, 어느 한쪽에 기대지 않고 비슷한 크기로 목소리를 내는 밸런스형이에요';
  if (sajuPct > facePct) return '타고난 사주 기운이 더 진하게 자리 잡고 있어서, 관상은 그 위에 살짝 덧입혀진 인상에 가까워요';
  return '얼굴에 드러난 인상이 더 뚜렷한 편이라, 보이는 모습이 곧 진짜 나에 가까운 타입이에요';
}

// 사주 × 관상 시너지 문장 — 한자 노출 없이 은유로 (db/SAJU_LINK.csv 규칙 재사용)
function buildSajuSynergy(dStem, statusMap) {
  const oh = dStem >= 0 ? CG_OH[dStem] : '토';
  const v = OHAENG_VIBE[oh] || OHAENG_VIBE['토'];
  const strongLabels = PART_DEF.filter(p => statusMap[p.key] === 'strength').map(p => p.label);
  const nature = `${v.season}의 ${v.line}. 신중하지만 "내가 해야겠다" 싶은 일은 남 눈치 안 보고 끝까지 밀어붙이는 타입이에요.`;
  const synergy = strongLabels.length
    ? `${strongLabels.join(' · ')}에서도 그 기운이 그대로 드러나요. 남에게 의존하기보다 내 실력으로 운을 끌어당기는 스타일이에요.`
    : `관상에서는 아직 뚜렷하게 드러나지 않지만, 타고난 기운만으로도 충분히 밀어붙이는 힘이 있어요.`;
  return { nature, synergy };
}

// Daily 개운 루틴 3가지 — '보완' 부위의 팁을 아침/낮/밤 루틴으로 재구성
function buildDailyRoutines(statusMap) {
  const routineBank = {
    forehead:   '아침: 메이크업할 때 이마 중앙에 은은한 하이라이터 터치하기',
    eyebrow:    '낮: 대화할 때 미소를 조금 더 자주 지어보기',
    midbrow:    '낮: 대화할 때 상대 눈을 3초만 더 바라보기',
    undereye:   '낮: 거울 볼 때마다 눈웃음 3초 지어보기',
    nosebridge: '밤: 세안 후 눈 앞머리부터 콧대까지 지압 마사지하기',
    nosetip:    '밤: 세안 후 콧대~코끝 지압 마사지하기',
    philtrum:   '아침: 충분한 수분 섭취로 하루 시작하기',
    mouth:      '낮: 하고 싶은 말은 미루지 않고 바로 표현해보기',
    smilelines: '낮: 자신감 있는 표정 3초 연습하기',
    jaw:        '낮: 거울 볼 때마다 입꼬리 3초 동안 활짝 올려주기',
    cheekbone:  '낮: 중요한 자리에서 목소리를 한 번 더 내보기',
  };
  // 11개 부위 중 "낮:" 태그가 7개로 몰려 있어서, 보완 부위가 우연히 겹치면 아침/밤 없이 "낮:" 팁
  // 3개만 뽑히는 문제가 있었다(버그 리포트 3번 항목 — "부위별 팁과 Daily 루틴 중복"). 시간대별로
  // 정확히 하나씩만 뽑아서 진짜 "아침→낮→밤" 3단계 실행 플랜이 되도록 고침.
  const compKeys = PART_DEF.filter(p => statusMap[p.key] === 'complement').map(p => p.key);
  const fallback = {
    아침: '아침: 오늘의 컨디션을 살피며 가벼운 스트레칭으로 하루 시작하기',
    낮:   '낮: 거울 볼 때마다 표정을 한 번 더 살펴보기',
    밤:   '밤: 오늘 하루 애썼던 나를 떠올리며 가벼운 셀프 마사지로 마무리하기',
  };
  const bySlot = { 아침: null, 낮: null, 밤: null };
  compKeys.forEach(key => {
    const tip = routineBank[key];
    const slot = tip.split(':')[0];
    if (!bySlot[slot]) bySlot[slot] = tip;
  });
  return ['아침', '낮', '밤'].map(slot => bySlot[slot] || fallback[slot]);
}

// ═══ "타고난 기운 & 성향" 타입 카드 — 11개 부위 중 가장 발달한 부위 하나를 기준으로 MBTI 감성의
// 타입 이름을 붙이고, 2위 부위까지 자연스럽게 엮어서 문장 하나에 녹인다("단순 사주 정보 나열처럼
// 보인다"는 피드백 반영 — 부위 카드 아래에 이미 있는 문장을 또 나열하지 않고, 완전히 새로 쓴 문장으로
// 구성). 마지막엔 실제 makeup/lifestyle 팁 하나를 자연스럽게 이어 붙인다.
const PERSONALITY_TYPE = {
  forehead:   { title:'🌟 탁 트인 전략가 타입', tagline:'미리 보는 설계자',
    text:(p2)=>`시원하게 뻗은 이마가 먼저 눈에 들어오는 타입이에요. 남들이 코앞만 볼 때 몇 수 앞을 미리 그려두는 능력자라서, 일이든 관계든 방향을 잃지 않고 밀고 나가는 스타일이에요${p2?`, 여기에 ${p2}까지 더해져서 그 그림을 실제로 밀어붙이는 힘까지 갖췄어요`:''}. 이마 중앙을 살짝 밝혀주는 하이라이터 메이크업을 더하면, 그동안 쌓아온 성과가 훨씬 빠르게 인정받게 돼요.` },
  eyebrow:    { title:'🤝 관계의 연결자 타입', tagline:'인복 부자',
    text:(p2)=>`눈썹이 여유 있게 자리 잡아서 사람이 자연스럽게 몰리는 타입이에요. 형제·동료 운이 좋아서 혼자보다 함께할 때 시너지가 더 커지는 스타일이에요${p2?`, ${p2}까지 받쳐줘서 그 관계를 실제 성과로 잘 연결해요`:''}. 눈썹 꼬리만 살짝 정리해주는 메이크업으로 여유로운 인상을 한층 살려보세요.` },
  midbrow:    { title:'👁 흔들림 없는 주관러 타입', tagline:'마이웨이 리더',
    text:(p2)=>`미간이 시원하게 넓어서 웬만한 건 다 받아주는 그릇 큰 타입이에요. 내 기준이 확실해서 흔들리지 않고 밀고 나가는 리더십이 있어요${p2?`, ${p2}이 더해져서 그 뚝심이 더 단단해 보여요`:''}. 부드러운 웨이브 헤어스타일을 더하면 신뢰감이 한층 살아나요.` },
  undereye:   { title:'💕 정 많은 케어러 타입', tagline:'인복 마그넷',
    text:(p2)=>`눈 밑이 도톰해서 정이 많고 다정한 타입이에요. 사람이 잘 따르고 인복이 두둑해서, 챙겨주는 만큼 돌아오는 스타일이에요${p2?`, ${p2}까지 있어서 그 다정함이 훨씬 매력적으로 보여요`:''}. 눈웃음을 살짝 지어보세요 — 인복이 몰릴수록 운도 같이 몰려요.` },
  nosebridge: { title:'🏔 자존심 강한 개척자 타입', tagline:'내 힘으로 간다',
    text:(p2)=>`콧대가 시원하게 뻗어 있어서 자존심 있고 리더십 있는 타입이에요. 남에게 기대기보다 내 실력으로 판을 만들어가는 능력자 스타일이에요${p2?`, ${p2}까지 겸비해서 그 뚝심이 결과로 잘 이어져요`:''}. 콧대에 살짝 음영을 넣는 메이크업으로 곧은 인상을 더 살려보세요.` },
  nosetip:    { title:'💎 실속형 승부사 타입', tagline:'알짜 재테커',
    text:(p2)=>`코끝에 힘이 딱 들어간 상이라 자존감과 실속을 동시에 챙기는 타입이에요. 남한테 안 흔들리는 자존감으로 차곡차곡 모으는 재물운을 가졌어요${p2?`, ${p2}까지 더해져서 그 실속이 진짜 결과로 쌓여요`:''}. 콧대에서 코끝까지 이어지는 하이라이터로 실속 있는 인상을 완성해보세요.` },
  philtrum:   { title:'💧 뚝심의 완주자 타입', tagline:'버티는 의지왕',
    text:(p2)=>`인중이 또렷해서 건강한 생명력과 의지력을 가진 타입이에요. 웬만한 고비는 다 버텨내는 뚝심이 있어서, 끝까지 가는 힘이 남달라요${p2?`, ${p2}까지 있어서 그 뚝심이 더 빛나요`:''}. 충분한 수분 섭취와 규칙적인 수면으로 지금의 좋은 기운을 오래 유지해보세요.` },
  mouth:      { title:'🎤 표현력 갑 타입', tagline:'할 말은 하는 스타일',
    text:(p2)=>`입이 시원하게 크고 또렷해서 표현력이 좋고 대인관계에 적극적인 타입이에요. 하고 싶은 말은 참지 않고 바로 표현하는 솔직함이 매력이에요${p2?`, ${p2}까지 더해져서 그 표현력이 훨씬 인상 깊게 전달돼요`:''}. 입술 산 라인을 또렷하게 살리는 메이크업으로 표현력 있는 인상을 강조해보세요.` },
  smilelines: { title:'👑 자연스러운 카리스마 타입', tagline:'있는 존재감',
    text:(p2)=>`팔자주름이 뚜렷해서 사회성과 카리스마가 넘치는 타입이에요. 조직 안에서 자연스럽게 중심이 되는, 있는 듯 없는 듯 존재감을 뽐내는 스타일이에요${p2?`, ${p2}까지 받쳐줘서 그 카리스마가 더 단단해 보여요`:''}. 평소보다 살짝 더 자신감 있는 표정을 지어보세요 — 이미 갖춘 카리스마가 훨씬 잘 드러나요.` },
  jaw:        { title:'🏡 든든한 조력자 타입', tagline:'한번 곁에 두면 오래가는',
    text:(p2)=>`턱선이 둥글고 안정적이라 한번 곁에 둔 사람은 오래가는 타입이에요. 말년운과 조력자 운이 빵빵해서, 오래 갈수록 더 빛나는 스타일이에요${p2?`, ${p2}까지 있어서 그 든든함이 배가 돼요`:''}. 턱 밑 괄사 마사지로 라인을 정돈해보세요 — 사람이 몰릴수록 운도 같이 몰려요.` },
  cheekbone:  { title:'🚀 추진력 만렙 타입', tagline:'일단 저지르는 행동파',
    text:(p2)=>`광대가 시원하게 발달해서 대외활동력과 추진력이 좋은 타입이에요. 생각보다 행동이 먼저 나가는, 일단 저지르고 보는 실행력이 강점이에요${p2?`, ${p2}까지 더해져서 그 추진력이 훨씬 힘 있게 발휘돼요`:''}. 광대 위쪽에 살짝 블러셔를 얹어 생기 있고 활동적인 인상을 살려보세요.` },
};
function buildTypeCard(r) {
  const sorted = getPartLevelsSorted(r);
  const topKey = sorted[0][0], secondKey = sorted[1] ? sorted[1][0] : null;
  const type = PERSONALITY_TYPE[topKey];
  if (!type) return null;
  const secondLabel = secondKey ? PART_DEF.find(p => p.key === secondKey).label : null;
  return `<strong style="color:var(--gold);font-size:14px;">${type.title} (${type.tagline})</strong><br><br>${type.text(secondLabel)}`;
}

// 종합 운세 리포트 — 관상 8부위 + 사주 오행을 엮은 여러 문단 (신년운세 톤, 한자 노출 없음)
function buildFullNarrative(dStem, ohaeng, statusMap, r) {
  const oh = dStem >= 0 ? CG_OH[dStem] : '토';
  const sortedOh = Object.entries(ohaeng).sort((a,b) => b[1] - a[1]);
  const second = sortedOh.find(([k]) => k !== oh);

  const natureP = OHAENG_DETAIL[oh] + (second && ohaeng[second[0]] >= 2
    ? ` 거기에 ${OHAENG_VIBE[second[0]].line}도 함께 있어서, 상황에 따라 다른 얼굴을 보여줄 수 있는 타입이에요.`
    : '');

  const strongParts = PART_DEF.filter(p => statusMap[p.key] === 'strength');
  const compParts = PART_DEF.filter(p => statusMap[p.key] === 'complement');

  // 강점/보완 부위가 5~6개씩 걸리는 경우(11개 중 절반) 문장을 전부 이어 붙이면 단순 나열처럼 읽힌다
  // (버그 리포트 3번 항목). 이름은 전체 다 보여주되, 실제 설명 문장은 1~2개만 뽑아 붙인다.
  const strongP = strongParts.length
    ? `관상에서는 ${strongParts.map(p => p.label).join(' · ')} 쪽이 특히 눈에 띄어요. ` + strongParts.slice(0, 2).map(p => PART_CONTENT[p.key].strength.meaning).join(' ')
    : `관상에서는 유독 튀는 부위 없이 전체적으로 무난하고 안정적인 인상이에요.`;

  const compP = compParts.length
    ? `반대로 ${compParts.map(p => p.label).join(' · ')} 쪽은 살짝 채워볼 포인트예요. ` + compParts.slice(0, 2).map(p => PART_CONTENT[p.key].complement.meaning).join(' ')
    : `딱히 채워볼 포인트가 없어요. 지금 상태를 잘 유지하는 게 핵심이에요.`;

  const synergyP = strongParts.length >= 4
    ? `타고난 기운과 관상이 서로 같은 방향을 보고 있어요. 마음먹은 걸 얼굴에서도 그대로 밀어붙이는 힘이 보이니, 망설이지 말고 밀고 나가도 좋은 시기예요.`
    : strongParts.length >= 1
    ? `타고난 기운의 일부는 관상에서도 그대로 드러나고, 일부는 아직 표면적으로 드러나지 않았어요. 마음속 확신을 조금 더 겉으로 드러내는 연습을 하면 주변에서도 더 잘 알아봐줄 거예요.`
    : `타고난 기운은 확실히 있는데, 관상에서는 아직 조용히 숨어 있는 편이에요. 실력은 있는데 티가 잘 안 나는 스타일이니, 작은 성과라도 표현하고 알리는 습관이 도움이 돼요.`;

  const closingP = `종합적으로 보면, ${OHAENG_VIBE[oh].line}을 바탕으로 ${strongParts[0] ? strongParts[0].label : '전체적인 인상'}에서 그 힘이 잘 드러나는 사람이에요. 지금 강점은 그대로 밀고 나가고, 채워볼 포인트는 하루 5분 루틴으로 천천히 다져가면 전체적인 기운이 훨씬 안정적으로 자리 잡을 거예요.`;

  const typeCardP = r ? buildTypeCard(r) : null;
  return typeCardP ? [typeCardP, natureP, strongP, compP, synergyP, closingP] : [natureP, strongP, compP, synergyP, closingP];
}

// 사진이 없는 경우엔 사주만으로 짧게, 있으면 관상까지 더한 종합 운세로
function buildPersonNarrative(lm, pillars, ohaeng) {
  const dStem = pillars && pillars[2] ? pillars[2].stem : -1;
  if (lm) {
    const r = getGwansangRatios(lm);
    const statusMap = judgePartStatus(r);
    return { paragraphs: buildFullNarrative(dStem, ohaeng, statusMap, r), statusMap };
  }
  const oh = dStem >= 0 ? CG_OH[dStem] : '토';
  return { paragraphs: [OHAENG_DETAIL[oh], '사진을 추가하면 관상까지 더해진 훨씬 상세한 리포트를 볼 수 있어요.'], statusMap: null };
}

// 개인 리포트 렌더링 — 관상 탭 · 통합분석 탭 공용 (지침서 예시① 구조)
function renderPersonalReportV2(lm, ids, pillars, ohaeng) {
  const r = getGwansangRatios(lm);
  const statusMap = judgePartStatus(r);
  const dStem = pillars && pillars[2] ? pillars[2].stem : -1;

  if (ids.headline) {
    document.getElementById(ids.headline).innerHTML = `"${buildHeadline(dStem)}"`;
  }

  document.getElementById(ids.cards).innerHTML = PART_DEF.map(p => {
    const st = statusMap[p.key];
    const c = PART_CONTENT[p.key][st];
    const badge = st === 'strength' ? { label:'탁월한 강점', cls:'strength' } : { label:'채워볼 포인트', cls:'complement' };
    const measureKey = PART_KEY_TO_MEASURE[p.key];
    const rawValue = r[measureKey];
    const level = gwansangLevel(measureKey, rawValue);
    const rankNote = st === 'strength' ? '본인 11개 부위 중 상대적으로 발달한 편' : '본인 11개 부위 중 상대적으로 채워볼 편';
    return `<div class="part-card" data-part-key="${p.key}">
      <div class="part-head"><span class="part-icon">${p.icon}</span><span class="part-name">${p.label}</span><span class="status-badge ${badge.cls}">${badge.label}</span></div>
      <div class="part-sub">${p.sub}</div>
      <div class="part-value">📐 실측 비율 <strong>${rawValue.toFixed(3)}</strong> (정규화 지표 ${level}/100) — ${rankNote}</div>
      <div class="part-meaning">${c.meaning}</div>
      <div class="part-tip">💄 ${c.makeup}</div>
      <div class="part-tip">🌿 ${c.lifestyle}</div>
      <div class="part-tip ai-addition hidden"></div>
    </div>`;
  }).join('');

  if (ids.summary) {
    const routines = buildDailyRoutines(statusMap);
    document.getElementById(ids.summary).innerHTML = `<strong style="color:var(--gold);">📌 Daily 개운 루틴 3가지</strong><ol class="routine-list">${routines.map(rt => `<li>${rt}</li>`).join('')}</ol>`;
    document.getElementById(ids.summary).classList.remove('hidden');
  }

  // 결과 카드 자체는 여기서 공개하지 않음 — 호출자가 (AI 보완까지 끝난 뒤) 한번에 공개하도록 제어
  return statusMap;
}

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
  const hourLabel = h => (window.Profile && Profile.hourShort) ? Profile.hourShort(h) : '';
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
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initZoneAccordions);
else initZoneAccordions();

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

// ═══ COMBINED ═══
// preloadedLm: 냥 차감 전에 이미 얼굴 인식을 끝내둔 경우 그 결과를 그대로 받아 재사용한다
// (profile.js의 runCombinedWrapped 참고). MediaPipe detect를 두 번 돌리지 않기 위한 것이고,
// 안 넘기면 예전처럼 여기서 직접 runFaceAnalysis를 호출한다.
// 리포트는 "다 만들어진 뒤" 한 번에 공개한다(사용자 요청 2026-08-18). 예전엔 사주 계산이 끝나는
// 즉시 결과 카드를 열고 Zone2~4를 "불러오는 중"으로 채워서, 완성되지 않은 리포트가 먼저 보였다.
// 진행 상황은 리포트 대신 #cmbAnalyzing(스피너 + 단계 문구)으로 알린다.
function showCmbAnalyzing(msg) {
  const box = document.getElementById('cmbAnalyzing');
  if (box) box.classList.remove('hidden');
  setCmbAnalyzingMsg(msg);
}
function setCmbAnalyzingMsg(msg) {
  const el = document.getElementById('cmbAnalyzingMsg');
  if (el && msg) el.textContent = msg;
}
function hideCmbAnalyzing() {
  const box = document.getElementById('cmbAnalyzing');
  if (box) box.classList.add('hidden');
}

// AI가 끝내 못 채운 영역이 "불러오는 중"·스켈레톤 상태로 완성 리포트에 섞이지 않게 정리한다.
function finalizeAiSections() {
  ['cmbZone2CommonDiff', 'cmbZone2OhaengReading', 'cmbZone2Review', 'cmbZone3Reading1', 'cmbZone3Reading3', 'cmbZone4Card1', 'cmbZone4Cards'].forEach(id => {
    clearAiSkeleton(id);
    const el = document.getElementById(id);
    if (!el) return;
    if (el.querySelector('.ai-skeleton') || !el.textContent.trim()) {
      el.innerHTML = '<div style="color:var(--text2);font-size:13px;">이번엔 AI 해설을 불러오지 못했어요. 다시 분석하면 채워집니다.</div>';
    }
  });
}

async function runCombined(preloadedLm) {
  const dateVal = document.getElementById('cmbBirthDate').value;
  if (!dateVal) { alert('생년월일을 입력해주세요.'); return; }

  hideErr('cmbErr');
  document.getElementById('cmbResult').classList.add('hidden');
  document.getElementById('cmbCanvasCard').classList.add('hidden');
  markAnalyzed('combined');                  // 사진 등록 화면·CTA를 먼저 접고
  showCmbAnalyzing('사주를 뽑는 중이에요');    // 진행 화면만 남긴다

  let lm = null;
  try {
    lm = await buildCombinedReport(dateVal, preloadedLm);
  } catch (e) {
    // 리포트가 완성되지 않았으므로 열지 않는다 — 입력 화면을 되살려 에러 안내가 보이게 한다.
    console.error('[combined] 분석 실패 — 리포트를 열지 않는다', e);
    hideCmbAnalyzing();
    const sec = document.getElementById('cmbUploadSection');
    if (sec) sec.classList.remove('hidden');
    showErr('cmbErr', '분석 중 오류가 발생했어요. 잠시 후 다시 시도해주세요.');
    return;
  }

  hideCmbAnalyzing();
  if (lm) document.getElementById('cmbCanvasCard').classList.remove('hidden');
  document.getElementById('cmbResult').classList.remove('hidden');
  window.scrollTo(0, 0);
  if (window.Archive) Archive.save('combined'); // 보관함 — 리포트가 완성된 이 지점에서 스냅샷
}

// 리포트 본문을 만든다(화면 공개는 하지 않는다). 반환값은 얼굴 랜드마크(사진이 없거나 인식 실패면 null).
async function buildCombinedReport(dateVal, preloadedLm) {
  const rel = state.combined.relation;
  document.getElementById('cmbResultTitle').textContent = `🔮 AI 관상 X 사주 개운 리포트 (${rel})`;

  // ① 사주 먼저 계산 (사진 없어도 항상 실행) — Zone3 데이터 페어(만세력·오행·대운)의 사주 쪽 절반.
  const hourVal = document.getElementById('cmbBirthHour').value;
  const pillars = computePillars(dateVal, hourVal);
  const ohaeng = computeOhaeng(pillars);
  const daeun = computeDaeun(dateVal, hourVal, cmbGender);
  state.combined.pillars = pillars;
  state.combined.ohaeng = ohaeng;
  state.combined.daeun = daeun; // requestDeepReport의 zone3Extra + renderLifeline이 재사용
  renderPillarsTable(pillars, 'cmbPillarsTable');

  // ② 관상 섹션 초기화 — 사진 관련 부분은 AI 보완까지 끝난 뒤 한번에 공개
  document.getElementById('cmbPhotoLoading').classList.add('hidden');
  // 사진 없으면 케미 점수 계산이 불가하므로(computeGwansangSajuChemi는 관상+사주 둘 다 필요) 사주만의
  // 룰베이스 헤드로 대체 — 궁합보기 heroScores.gwansang:null과 같은 처리 원칙.
  if (!state.combined.file) {
    document.getElementById('cmbZone2Headline').innerHTML = `"${buildHeadline(pillars[2].stem)}"`;
  } else {
    document.getElementById('cmbPhotoLoading').classList.remove('hidden'); // 사진 분석이 끝날 때까지 "관상 분석중~"만 노출
  }

  if (state.combined.file) showAllAiSkeletons(); // 리포트 안 AI 영역의 자리(공개 전이라 화면엔 아직 안 보인다)

  // ③ 사진이 있으면 관상 분석 + Zone2 케미 점수/헤드 + Zone3/4 AI까지 한번에 렌더링
  let lm = null;
  if (state.combined.file) {
    setCmbAnalyzingMsg('얼굴을 살펴보는 중이에요');
    lm = preloadedLm || await runFaceAnalysis('combined');
    if (lm) {
      const ext = renderExtendedAnalysis(lm, {});
      renderOhaengCompareTable(ohaeng, ext.faceOh, 'cmbOhaengFaceHead', 'cmbOhaengSajuHead', 'cmbOhaengCompareTable');
      renderLifeline('cmbLifelineNow', 'cmbLifeline', daeun, pillars[2].stem, ext.samjeong, calcAge(dateVal));
      // AI가 실패해도 사주·관상 로컬 분석 결과는 이미 완성돼 있다 — 예외로 함수가 중단되면 아래
      // 보관함 저장까지 통째로 건너뛰므로, 여기서 흡수하고 진행한다.
      try {
        setCmbAnalyzingMsg('관상과 사주를 함께 읽는 중이에요');
        await requestPersonalAi('combined'); // classifyAndBuildCharacter가 characterResult.chemiScore까지 확정
        // Zone2 헤드/케미점수 — 룰베이스, characterResult 확정 직후 바로 노출(AI 응답을 기다리지 않는다).
        const chemi = state.combined.characterResult && state.combined.characterResult.chemiScore;
        const dominance = state.combined.characterResult && state.combined.characterResult.dominance;
        document.getElementById('cmbZone2Headline').innerHTML = `"${chemi != null ? buildChemiHeadline(chemi) : buildHeadline(pillars[2].stem)}"`;
        document.getElementById('cmbChemiScore').textContent = chemi != null ? chemi : '-';
        if (dominance) {
          document.getElementById('cmbDomBar').classList.remove('hidden');
          document.getElementById('cmbDomBarFace').style.width = dominance.facePct + '%';
          document.getElementById('cmbDomBarSaju').style.width = dominance.sajuPct + '%';
          document.getElementById('cmbDomFacePct').textContent = dominance.facePct;
          document.getElementById('cmbDomSajuPct').textContent = dominance.sajuPct;
          document.getElementById('cmbDomLine').textContent = buildDominanceLine(dominance);
        }
        setCmbAnalyzingMsg('관상x사주 스토리를 쓰는 중이에요');
        await requestDeepReport('combined');
      } catch (e) {
        console.error('[combined] AI 해설 실패 — 나머지 렌더와 보관은 계속 진행', e);
      }
      finalizeAiSections();
      document.getElementById('cmbPhotoLoading').classList.add('hidden');
    } else {
      document.getElementById('cmbPhotoLoading').classList.add('hidden');
      // 얼굴 인식 실패 — 에러 메시지(#cmbErr)는 사진 등록 영역 안에 있어서, 접어둔 채로 두면 보이지 않는다.
      const sec = document.getElementById('cmbUploadSection');
      if (sec) sec.classList.remove('hidden');
    }
  }

  return lm;
}

// ═══ GUNGHAM ═══
// 통합분석 탭과 동일한 원칙(사용자 요청 2026-08-19) — 리포트(#ggResult)는 AI 정밀 해석까지 전부 끝난
// 뒤에 한 번에 공개한다. 그 전까지는 #ggAnalyzing(스피너 + 단계 문구)만 보여준다.
function showGgAnalyzing(msg) {
  const box = document.getElementById('ggAnalyzing');
  if (box) box.classList.remove('hidden');
  setGgAnalyzingMsg(msg);
}
function setGgAnalyzingMsg(msg) {
  const el = document.getElementById('ggAnalyzingMsg');
  if (el && msg) el.textContent = msg;
}
function hideGgAnalyzing() {
  const box = document.getElementById('ggAnalyzing');
  if (box) box.classList.add('hidden');
}

async function runGungham() {
  const dateA = document.getElementById('ggBirthA').value;
  const dateB = document.getElementById('ggBirthB').value;
  if (!dateA || !dateB) { showErr('ggErr', '두 사람의 생년월일을 모두 입력해주세요.'); return; }
  hideErr('ggErr');
  document.getElementById('ggResult').classList.add('hidden');
  document.getElementById('ggCanvasCard').classList.add('hidden');
  document.getElementById('gunghamBackBtn').classList.add('hidden');
  markAnalyzed('gungham');                     // 고정 CTA를 먼저 접고
  setGgHeroVisible(false); // 분석 진행 화면부터는 진입 배너를 감춘다(사용자 요청 2026-08-20)
  showGgAnalyzing('사주 궁합을 계산하는 중이에요'); // 진행 화면만 남긴다

  try {
    // ⚠️ 버그 수정(2026-08-19 사용자 리포트: "사주 다 넣었는데 시주가 빠졌다") — applyToGunghamA/B
    // (profile.js)는 대표/상대 프로필의 태어난 시간(birthHour)을 ggBirthHourA/B에 채워두는데, 여기서
    // 계속 '-1'(시간 미상)을 하드코딩해 넘기고 있어서 프로필에 시간을 입력해도 시주가 항상 빠졌다.
    const hourA = (document.getElementById('ggBirthHourA') || {}).value || '-1';
    const hourB = (document.getElementById('ggBirthHourB') || {}).value || '-1';
    const pillarsA = computePillars(dateA, hourA);
    const pillarsB = computePillars(dateB, hourB);
    const ohA = computeOhaeng(pillarsA);
    const ohB = computeOhaeng(pillarsB);
    const rel = state.gungham.relation;

    // 리포트 전체에서 "나"/"상대방" 대신 실제 이름 + "님"을 쓴다(사용자 요청 2026-08-19) — AI가 쓰는
    // 본문 문장은 requestCoupleAi가 이 이름을 프롬프트에 넘겨 반영한다. 관상/사주 Zone 제목은 이제
    // 개인 서술이 없어 이름을 넣을 자리가 없으므로(2026-08-20 재편) 캔버스 라벨만 갱신한다.
    const nameA = state.gunghamA.name ? state.gunghamA.name + '님' : '나';
    const nameB = state.gunghamB.name ? state.gunghamB.name + '님' : '상대방';
    const setText = (id, text) => { const el = document.getElementById(id); if (el) el.textContent = text; };
    setText('ggCanvasLabelA', `${nameA}의 관상`);
    setText('ggCanvasLabelB', `${nameB} 관상`);

    // 사주가 들어가는 다른 탭(사주 탭·통합분석 탭)과 동일하게 오행 분포를 계산해둔다 — 개인별 오행바·
    // 딥다이브 렌더는 통합분석 탭에 이미 있으므로 여기서는 그리지 않는다(2026-08-20 재편). 원국(만세력)은
    // 두 사람을 한 화면에 비교하는 renderGunghamManseryeok 하나로 통일하고(사용자 요청 2026-08-19),
    // 근거성 정보(12운성·신살·귀인)인 renderUnseongLegend는 이 탭에서 노출하지 않는다.
    state.gunghamA.pillars = pillarsA; state.gunghamA.ohaeng = ohA;
    state.gunghamB.pillars = pillarsB; state.gunghamB.ohaeng = ohB;
    renderGunghamManseryeok(nameA, dateA, hourA, pillarsA, nameB, dateB, hourB, pillarsB);
    renderSipseongCross(buildSipseongCross(pillarsA, pillarsB), 'ggSipseongCross');

    // ① 참고용 궁합 점수(접힌 상세 영역에만 노출)
    function renderCompatScore(compat) {
      document.getElementById('ggBars').innerHTML = compat.bars.map(b =>
        `<div class="compat-bar-row"><div class="compat-bar-label">${b.label}</div><div class="compat-bar-bg"><div class="compat-bar-fill" style="width:${b.pct}%"></div></div><div class="compat-bar-pct">${b.pct}%</div></div>`
      ).join('');
    }
    // 궁합보기 히어로(총합/관상만/사주만 점수) — AI가 점수를 새로 지어내지 않도록, 항상 이 로컬 계산값을
    // 그대로 근거 데이터로 넘긴다(requestCoupleAi 참고). 사진이 없으면 관상만 점수는 null로 둔다.
    const sajuOnlyCompat = calcCompatScore(pillarsA, pillarsB, ohA, ohB, rel);
    renderCompatScore(sajuOnlyCompat);
    let heroScores = { total: sajuOnlyCompat.score, saju: sajuOnlyCompat.score, gwansang: null };

    // ② 사진 있으면 관상 분석 (병렬 실행)
    let lmA = null, lmB = null;
    const tasks = [];
    if (state.gunghamA.file) { setGgAnalyzingMsg('얼굴을 분석하는 중이에요'); tasks.push(runFaceAnalysis('gunghamA', 'gunghamCanvasA').then(lm => { lmA = lm; })); }
    if (state.gunghamB.file) tasks.push(runFaceAnalysis('gunghamB', 'gunghamCanvasB').then(lm => { lmB = lm; }));
    if (tasks.length > 0) await Promise.all(tasks);

    // ②-1 두 사람 사진이 모두 있으면 관상 궁합(db/MATCHING.csv 기반)을 사주 궁합과 블렌드해 재계산
    if (lmA && lmB) {
      setGgAnalyzingMsg('관상 궁합을 계산하는 중이에요');
      const gwansangCompat = calcGwansangCompat(lmA, lmB);
      const blended = calcCompatScore(pillarsA, pillarsB, ohA, ohB, rel, gwansangCompat);
      renderCompatScore(blended);
      const gVals = Object.values(gwansangCompat);
      heroScores = { total: blended.score, saju: sajuOnlyCompat.score, gwansang: Math.round(gVals.reduce((s, v) => s + v, 0) / gVals.length) };
    }

    // ②-2 관상 캐릭터 판정 — 개인별 관상 형상(눈모양·동물상) 카드·골든타임은 통합분석 탭에 이미 있어
    // 여기서는 그리지 않는다(2026-08-20 재편). 궁합보기 Zone1(관상 궁합)이 15캐릭터 이름(무관상·책사상
    // 등)을 인용할 수 있도록 캐릭터 판정만 확정해둔다 — 통합분석 탭과 같은 룰베이스 엔진
    // (classifyAndBuildCharacter)을 그대로 재사용.
    if (lmA) await classifyAndBuildCharacter('gunghamA', CTX_CONFIG.gunghamA(), lmA);
    if (lmB) await classifyAndBuildCharacter('gunghamB', CTX_CONFIG.gunghamB(), lmB);

    // ③ 나 / 상대방 각각의 관상 X 사주 상태맵 — 화면에 개인 서술로 그리진 않지만, statusMap은
    // buildRoleChemi(역할분담 케미)와 아래 캐시(AI 프롬프트 근거)가 그대로 참조한다.
    const narrativeA = buildPersonNarrative(lmA, pillarsA, ohA);
    const narrativeB = buildPersonNarrative(lmB, pillarsB, ohB);

    const sajuInsightA = collectSajuInsightSummary(pillarsA);
    const sajuInsightB = collectSajuInsightSummary(pillarsB);

    // Gemini "AI 정밀 해석" 버튼이 재사용할 수 있도록 계산 결과 캐시
    // isRomantic(2026-08-22 추가) — 연인/배우자 관계일 때만 Zone3 "그래서 우리는 이렇게 만나요"를
    // 요청·노출한다(친구·가족·지인 관계에 "아이를 낳는다면" 같은 항목은 어색하다는 사용자 판단).
    state.gungham.cache = {
      nameA, nameB,
      pillarsA, pillarsB, ohA, ohB,
      statusMapA: narrativeA.statusMap, statusMapB: narrativeB.statusMap,
      heroScores,
      sajuInsightA, sajuInsightB,
      characterA: state.gunghamA.characterResult || null,
      characterB: state.gunghamB.characterResult || null,
      isRomantic: rel === '연인/배우자',
    };

    // Zone3 실전 가이드 섹션은 연인/배우자 관계일 때만 보인다 — AI 성공 여부와 무관하게 relation만으로
    // 즉시 결정(로딩 중에도 스켈레톤 대신 아예 숨어 있어야 자연스러움).
    const practicalSection = document.getElementById('ggPracticalSection');
    if (practicalSection) practicalSection.classList.toggle('hidden', rel !== '연인/배우자');

    // ④ 지침서 예시② 구조의 4섹션 비교 리포트 (STEP3에 해당, 관상 없어도 사주만으로 생성)
    const chemi = buildRoleChemi(pillarsA[2].stem, narrativeA.statusMap, pillarsB[2].stem, narrativeB.statusMap);
    const faceCombo = buildFaceComboChemi(lmA, lmB, ggGenderA, ggGenderB, rel, nameA, nameB);
    const faceOhaengCompare = buildFaceOhaengCompare(lmA, lmB);
    const moneyChemi = buildMoneyChemi(lmA, lmB, ggGenderA, ggGenderB, rel);
    const lifeStage = buildLifeStageChemi(lmA, lmB, nameA, nameB);
    const energy = buildEnergyChemi(ohA, ohB);
    const yongsinChemi = buildYongsinChemi(pillarsA, pillarsB, ohA, ohB);
    const moments = buildMoments(ohA, ohB, narrativeA.statusMap, narrativeB.statusMap);
    renderCoupleReport(chemi, faceCombo, faceOhaengCompare, moneyChemi, lifeStage, energy, yongsinChemi, moments);

    // ⑤ Gemini 정밀 해석 자동 요청(수동 버튼 없음) — 키가 없으면 requestCoupleAi 내부에서 조용히 스킵된다.
    setGgAnalyzingMsg('AI가 두 사람의 궁합을 읽는 중이에요');
    await requestCoupleAi();

    // 히어로 점수는 AI 성공 여부와 무관하게 항상 로컬 계산값으로 채운다(requestCoupleAi가 스킵되거나
    // 실패해도 점수만큼은 항상 보여야 한다).
    document.getElementById('ggHeroTotalNum').textContent = heroScores.total;
    document.getElementById('ggHeroGwansangNum').textContent = heroScores.gwansang != null ? heroScores.gwansang : '-';
    document.getElementById('ggHeroSajuNum').textContent = heroScores.saju;

    hideGgAnalyzing();
    if (lmA || lmB) document.getElementById('ggCanvasCard').classList.remove('hidden');
    document.getElementById('ggResult').classList.remove('hidden');
    document.getElementById('gunghamBackBtn').classList.remove('hidden');
    // ⚠️ 버그 수정(2026-08-24 사용자 리포트: "다른 상대와 궁합보기"로 새로 분석한 직후 진입 배너가
    // 리포트와 같이 떠 있음) — startGunghamForOther()가 세워둔 ggWantsNewAnalysis=true가 여기서
    // 안 꺼지면, 곧바로 이어지는 Archive.save → notifyChanged → renderGunghamSavedReport()의 맨 첫
    // 줄(`if (ggWantsNewAnalysis) showGunghamInputStep()`)이 "리포트가 떠 있으면 건드리지 않는다"
    // 가드보다 먼저 걸려서 입력 단계로 되돌리며 배너를 다시 켰다. 새 분석이 끝나 리포트가 화면에
    // 떴으면 "새 분석을 하려던" 상태는 이미 끝난 것이므로 여기서 꺼준다.
    ggWantsNewAnalysis = false;
    setGgHeroVisible(false); // 리포트가 뜨는 순간엔 항상 배너를 꺼둔다(사용자 리포트 2026-08-20:
    // 관상 캔버스·리포트와 진입 배너가 같이 떠 있었음) — Archive.save가 곧바로 notifyChanged →
    // renderGunghamSavedReport()를 동기 호출하는데, 그 경로가 다시 배너를 켜는 일이 없도록 마지막에 한 번 더 확정한다.
    window.scrollTo(0, 0);
    if (window.Archive) Archive.save('gungham'); // 보관함 — AI 해석까지 끝난 뒤에 스냅샷
  } catch (e) {
    // 리포트가 완성되지 않았으므로 열지 않는다 — CTA를 되살려 에러 안내가 보이게 한다.
    console.error('[gungham] 분석 실패 — 리포트를 열지 않는다', e);
    hideGgAnalyzing();
    const dock = document.getElementById('ggCtaDock');
    if (dock) dock.classList.remove('hidden');
    ['ggBlockA', 'ggBlockB'].forEach(id => {
      const b = document.getElementById(id);
      if (b) b.classList.remove('hidden');
    });
    setGgHeroVisible(true); // 다시 입력 단계로 돌아가므로 배너도 되살린다
    showErr('ggErr', '분석 중 오류가 발생했어요. 잠시 후 다시 시도해주세요.');
  }
}

// 오행 상생상극 — 사주 세운(올해의 간지) 판정용. 목생화, 화생토... 순서로 서로를 살려주는 관계(상생),
// 목극토, 토극수... 순서로 서로를 억누르는 관계(상극).
const OHAENG_GENERATES = { 목:'화', 화:'토', 토:'금', 금:'수', 수:'목' };
const OHAENG_CONTROLS = { 목:'토', 화:'금', 토:'수', 금:'목', 수:'화' };
// 골든타임 3중 판정의 세 번째 축 — 올해(세운) 간지 오행과 일간(나) 오행의 관계로 "올해가 나에게 어떤
// 해인지"를 더한다. 버그 리포트 4번 항목: 나이 구간(초년/중년/말년) 하나만으로는 20대 전원이 같은
// 문구를 받는 문제가 있었는데, 세운까지 더하면 같은 나이·같은 삼정이라도 해마다 문구가 달라진다.
function getSewoonRelation(dStem) {
  if (dStem == null || dStem < 0 || typeof Solar === 'undefined') return null;
  const dOh = CG_OH[dStem];
  const now = new Date();
  const solar = Solar.fromYmdHms(now.getFullYear(), now.getMonth() + 1, now.getDate(), 12, 0, 0);
  const yearGanChar = solar.getLunar().getEightChar().getYearGan();
  const yStemIdx = CHEONGAN.indexOf(yearGanChar);
  const yearOh = CG_OH[yStemIdx];
  if (yearOh === dOh) return { yearOh, text: `올해는 ${yearOh} 기운이 나와 똑같이 겹치는 해라, 원래 성향이 더 뚜렷하게 강해지는 시기예요.` };
  if (OHAENG_GENERATES[yearOh] === dOh) return { yearOh, text: `올해는 ${yearOh} 기운이 나를 채워주는 해라, 배우고 회복하기 좋은 시기예요.` };
  if (OHAENG_GENERATES[dOh] === yearOh) return { yearOh, text: `올해는 내 기운이 ${yearOh} 기운을 밀어주는 해라, 표현하고 확장하기 좋은 시기예요.` };
  if (OHAENG_CONTROLS[dOh] === yearOh) return { yearOh, text: `올해는 내가 ${yearOh} 기운을 다스리는 해라, 결과물이나 재물로 연결하기 좋은 시기예요.` };
  return { yearOh, text: `올해는 ${yearOh} 기운이 나를 다잡아주는 해라, 책임감 있게 도전해보기 좋은 시기예요.` };
}
// 좌우 비대칭 + 관상오행 렌더링 — 관상 탭·통합분석 탭 공용 (나이가 없어도 항상 표시 가능한 부분만)
function renderExtendedAnalysis(lm, ids) {
  const asym = calcAsymmetry(lm);
  const asymEl = document.getElementById(ids.asymmetry);
  if (asymEl) {
    const leftCount = asym.filter(a => a.leftHigher).length;
    const conclusion = leftCount >= 2
      ? '내면의 성향이 겉으로도 잘 드러나는 솔직한 얼굴이에요.'
      : '평소 내면과는 조금 다른 모습을 사회적으로 연출하고 있을 수 있어요.';
    // 스펙 §6 삭제 — 눈/눈썹/입꼬리 %차이 3줄은 사용자 효용이 낮아 결론 한 줄만 남긴다.
    // 통합분석(ids.asymmetryDetail 미지정)에서만 걷어내고, 관상보기 탭은 기존대로 상세까지 보여준다.
    const detail = ids.asymmetryDetail === false ? '' : asym.map(a => {
      const side = a.leftHigher ? '왼쪽(내면의 나)' : '오른쪽(사회적으로 보이는 나)';
      return `<div class="part-tip">〔${a.label}〕 ${side} 쪽이 살짝 더 올라가 있어요. (차이 ${(a.diffRatio*100).toFixed(1)}%)</div>`;
    }).join('');
    asymEl.innerHTML = detail + `<div class="part-tip"${detail ? ' style="margin-top:6px;"' : ''}>✨ ${conclusion}</div>`;
  }
  const faceOh = calcFaceOhaeng(lm);
  if (ids.faceOhaeng) renderFaceOhaengBars(faceOh, ids.faceOhaeng);

  const ratios = getGwansangRatios(lm);
  if (ids.tier3) {
    const tier3 = classifyGwansang3Tier(ratios);
    const el = document.getElementById(ids.tier3);
    if (el) {
      el.innerHTML = Object.entries(tier3).map(([part, t]) =>
        `<div class="part-tip">〔${part}〕 ${t.typeLabel} · ${t.tierLabel} (실측값 ${t.value.toFixed(2)})</div>`
      ).join('') + `<div class="part-tip" style="margin-top:6px;font-size:11px;color:var(--text2);">※ 전통 관상 삼정 기준과 미용성형 황금비율을 참고한 초안 기준이에요.</div>`;
    }
  }
  if (ids.foreheadNotice) {
    const el = document.getElementById(ids.foreheadNotice);
    if (el) {
      if (!isForeheadReliable(ratios.gwanR)) {
        el.textContent = '⚠ 앞머리 등으로 이마 측정이 제한되어 눈·코 중심 관상으로 대체 분석했어요.';
        el.classList.remove('hidden'); el.classList.add('show');
      } else {
        el.classList.add('hidden'); el.classList.remove('show');
      }
    }
  }
  return { asym, faceOh, samjeong: calcSamjeongRatio(lm), ratios };
}

// ── 커플 케미 콘텐츠 엔진 (지침서 예시② 구조, CONTENT_SPEC.md §5 — db/MATCHING·SAJU_LINK 재사용) ──
const sangSaeng = {목:['수','화'],화:['목','토'],토:['화','금'],금:['토','수'],수:['금','목']};
const sangGeuk  = {목:['금','토'],화:['수','금'],토:['목','수'],금:['화','목'],수:['토','화']};

const PART_ROLE = {
  forehead:   '방향을 설정하는 리더 · 전략가',
  eyebrow:    '관계를 편안하게 만드는 분위기 메이커',
  midbrow:    '판단하고 지켜내는 수호자',
  undereye:   '분위기를 다정하게 만드는 무드메이커',
  nosebridge: '중심을 잡아주는 기둥',
  nosetip:    '실속을 챙기는 승부사',
  philtrum:   '끝까지 버텨내는 지구력파',
  mouth:      '마음을 솔직하게 표현하는 소통가',
  smilelines: '주변을 이끄는 카리스마형',
  jaw:        '분위기를 지키는 조력자',
  cheekbone:  '앞장서서 판을 벌리는 행동파',
};
const OHAENG_ROLE = { 목:PART_ROLE.forehead, 화:PART_ROLE.smilelines, 토:PART_ROLE.jaw, 금:PART_ROLE.nosetip, 수:PART_ROLE.midbrow };

function getRoleLabel(statusMap, dStem) {
  if (statusMap) {
    const strong = PART_DEF.find(p => statusMap[p.key] === 'strength');
    if (strong) return PART_ROLE[strong.key];
  }
  const oh = dStem >= 0 ? CG_OH[dStem] : '토';
  return OHAENG_ROLE[oh] || PART_ROLE.midbrow;
}

// 1) 관상 케미 — 역할 분담 + 총평 (MATCH_0002 패턴)
function buildRoleChemi(dStemA, statusMapA, dStemB, statusMapB) {
  const roleA = getRoleLabel(statusMapA, dStemA);
  const roleB = getRoleLabel(statusMapB, dStemB);
  const sameRole = roleA === roleB;
  const total = sameRole
    ? `두 사람 모두 "${roleA}" 쪽에 가까워요. 같은 역할을 서로 하려다 부딪힐 수 있는데, 상황별로 역할을 미리 나눠두면 훨씬 편해져요.`
    : `한 사람이 이끄는데 다른 한 사람이 반발하는 구조가 아니에요. 한쪽이 방향을 정하면 다른 쪽이 그걸 현실로 만드는, 역할 분담이 깔끔한 궁합이에요.`;
  return { roleA, roleB, total, sameRole };
}

// ── 얼굴형·눈·입·광대 "조합"으로 보는 궁합 — 부위별 강점/보완 비교와는 별개로,
// 두 사람의 유형 조합 자체에 의미를 두는 통속 관상 궁합론을 반영한 것(참고 자료 정리, 2026-08-13).
// 연인/배우자 관계 + 성별이 서로 다를 때만 남녀 역할 서술을 쓰고, 그 외(친구·형제자매·동성 등)에는
// 성별을 언급하지 않는 일반 서술로 대체한다 — 관계 유형이 다양한 이 탭의 특성상 이성 커플에만
// 해당하는 서술을 모든 관계에 강제하지 않기 위함.
// 눈 크기 / 입 크기 — gwansangLevel(0~100)로 "큼(>=60)/작음(<=40)/보통"을 나눠 조합 서술을 고른다.
// 성별·관계와 무관하게 통하는 일반 서술을 기본으로 하고, 연인/배우자 + 남녀가 다를 때만 방향성 있는
// 서술을 덧붙인다(참고 자료가 이 조합에서만 남녀를 구분해서 설명하고 있어서).
function describeSizeCombo(levelA, levelB, genderA, genderB, rel, opts) {
  const bigA = levelA >= 60, smallA = levelA <= 40;
  const bigB = levelB >= 60, smallB = levelB <= 40;
  if (bigA && bigB) return opts.bothBig;
  if (smallA && smallB) return opts.bothSmall;
  if (rel === '연인/배우자' && genderA && genderB && genderA !== genderB) {
    const maleBig = genderA === '남' ? bigA : bigB;
    const maleSmall = genderA === '남' ? smallA : smallB;
    if (maleBig) return opts.maleBig;
    if (maleSmall) return opts.maleSmall;
  }
  return opts.mixed;
}

// 궁합보기 Zone1 상단용 — 두 사람의 관상오행(목화토금수 %)을 나란히 비교할 수 있도록 묶어서 반환.
function buildFaceOhaengCompare(lmA, lmB) {
  if (!lmA || !lmB) return null;
  return { a: calcFaceOhaeng(lmA), b: calcFaceOhaeng(lmB) };
}
// 재물관상 케미(궁합 리포트 구성.md 4-2) — 재백궁(콧볼, junduR)만으로 "돈을 대하는 방식이 맞물리는가"를 본다.
// 히어로의 "금전 궁합" %(calcGwansangCompat)와 같은 원료(junduR)를 문장으로 풀어낸 상세 근거 카드.
function buildMoneyChemi(lmA, lmB, genderA, genderB, rel) {
  if (!lmA || !lmB) return null;
  const rA = getGwansangRatios(lmA), rB = getGwansangRatios(lmB);
  const levelA = gwansangLevel('junduR', rA.junduR), levelB = gwansangLevel('junduR', rB.junduR);
  const text = describeSizeCombo(levelA, levelB, genderA, genderB, rel, {
    bothBig: '둘 다 콧볼이 도톰한 편이에요. 씀씀이도 크고 돈 버는 것에도 자신 있어 하는 타입이라, 같이 있으면 통 크게 쓰는 지출이 늘어나기 쉬워요. 큰 지출만 미리 상의하는 규칙을 하나 정해두면 좋아요.',
    bothSmall: '둘 다 콧볼이 아담한 편이에요. 알뜰하게 모으는 성향이 비슷해서 재정 마찰은 적지만, 필요한 순간에도 서로 지갑 열기를 미루기 쉬워요. 가끔은 의식적으로 함께 소비해보는 것도 좋아요.',
    maleBig: '한쪽은 화통하게 벌고 쓰는 타입이고, 다른 한쪽은 차분하게 관리하는 타입이에요. 한쪽이 벌어오면 다른 한쪽이 잘 굴려주는 역할 분담이 자연스러운 조합이에요.',
    maleSmall: '알뜰한 한쪽을, 통 큰 다른 한쪽이 이끌어주는 조합이에요. 서로 다른 재무 스타일이 균형을 맞춰줘요.',
    mixed: '돈을 대하는 방식이 서로 다른 편이에요. 한쪽은 크게, 한쪽은 꼼꼼하게 보는 타입이라 씀씀이 기준을 미리 맞춰두면 다툴 일이 줄어들어요.',
  });
  const similarity = 100 - Math.abs(levelA - levelB);
  return { text, levelA, levelB, similarity };
}
// 생애주기(초년·중년·말년) 궁합(궁합 리포트 구성.md 4-1) — 개인 삼정 해석과 달리 두 사람의
// 삼정 값을 겹쳐서 "관계가 어느 시기에 강한가"만 본다.
// ⚠️ 설계 변경(2026-08-27 사용자 요청) — 예전엔 "차이가 제일 큰 시기가 몇 %p 차이 난다"는 진단
// 한 줄뿐이라 정보값이 낮았다("그래서 뭐 어쩌라고" 수준). 관상 궁합 카드로서 더 유의미해지려면
// 사주(대운)를 끌어와 신호를 섞기보다(다른 신호가 다른 결론을 내면 "삼각형 vs 역삼각형"처럼 모순으로
// 읽힐 위험, 오행 비교 카드와 톤도 겹침), 이미 있는 관상 삼정만으로 더 깊게 파는 쪽을 택했다 — 각자의
// 1위 시기(어느 구간에서 가장 힘을 받는 상인지)를 조합해서, "차이 %p" 대신 "이 조합이 관계에서
// 어떤 의미인지"를 3×3(대칭이라 실질 6가지) 매트릭스로 해석한다.
const LIFESTAGE_LABEL = { sangjeong: '초년', jungjeong: '중년', hajeong: '말년' };
// 다른 시기 조합(3가지)의 해석은 이름이 필요한 절만 실제 이름(nameA/nameB)을 쓰고, "누가 어떻게"에
// 해당하는 절은 "한 사람"/"다른 한 사람"으로 일반화한다 — 은/는(eunNeun)은 이미 있지만 이/가 조사
// 헬퍼가 없어서, 안 쓰는 쪽이 "님이"/"님가" 같은 조사 오류 위험이 없다.
const LIFESTAGE_COMBO_TEXT = {
  sangjeong_sangjeong: () => '두 사람 다 초년기에 유독 힘을 받는 상이에요 — 둘 다 일찍부터 스스로 기반을 단단하게 다져온 편이라, 서로의 그 단단함을 알아보고 믿음직하게 기댈 수 있는 조합이에요.',
  jungjeong_jungjeong: () => '두 사람 다 중년기에 가장 힘을 받는 상이에요 — 지금처럼 한창 사회생활하고 관계를 다져가는 시기에 제일 잘 맞아서, 함께 커리어나 살림을 꾸려가기 좋은 조합이에요.',
  hajeong_hajeong: () => '두 사람 다 말년기에 가장 힘을 받는 상이에요 — 당장보다는 시간이 쌓일수록 더 단단해지는 궁합이라, 오래 갈수록 진가가 드러나는 조합이에요.',
  sangjeong_jungjeong: (nA, nB) => `${nA}${eunNeun(nA)} 초년에, ${nB}${eunNeun(nB)} 중년에 힘을 받는 상이에요 — 한 사람이 일찍 다져둔 기반 위에서 다른 한 사람이 한창 힘을 내는 시기가 이어지는, 흐름이 자연스럽게 맞물리는 조합이에요.`,
  jungjeong_hajeong: (nA, nB) => `${nA}${eunNeun(nA)} 중년에, ${nB}${eunNeun(nB)} 말년에 힘을 받는 상이에요 — 한 사람이 한창 앞서갈 때 다른 한 사람이 그 뒤를 든든하게 받쳐주다가, 시간이 갈수록 함께 안정을 찾아가는 조합이에요.`,
  sangjeong_hajeong: (nA, nB) => `${nA}${eunNeun(nA)} 일찍 기반을 다지는 힘이 강하고, ${nB}${eunNeun(nB)} 시간이 쌓일수록 진가를 발휘하는 상이에요 — 전성기가 한 번에 겹치진 않지만, 한쪽이 쉬어갈 때 다른 한쪽이 앞장서 주는, 인생 전체로 보면 균형 잡힌 조합이에요.`,
};
function buildLifeStageChemi(lmA, lmB, nameA, nameB) {
  if (!lmA || !lmB) return null;
  const a = calcSamjeongRatio(lmA), b = calcSamjeongRatio(lmB);
  const domA = Object.entries(a).sort((x, y) => y[1] - x[1])[0][0];
  const domB = Object.entries(b).sort((x, y) => y[1] - x[1])[0][0];
  const nA = nameA || '나', nB = nameB || '상대방';
  const entry = LIFESTAGE_COMBO_TEXT[`${domA}_${domB}`]
    ? LIFESTAGE_COMBO_TEXT[`${domA}_${domB}`](nA, nB)
    : LIFESTAGE_COMBO_TEXT[`${domB}_${domA}`](nB, nA); // 반대 순서로만 등록돼 있으면 이름도 맞바꿔 넘긴다
  return { a, b, text: entry, domA: LIFESTAGE_LABEL[domA], domB: LIFESTAGE_LABEL[domB] };
}
// 한국어 조사(은/는, 이/가, 이라/라, 과/와)는 앞말의 받침 유무에 따라 형태가 갈린다. 아래 함수들은
// combineAxisCombo/describeTypeCombo가 DB에서 가져온 명사(nameKo, comboTrait 등)를 문장에 동적으로
// 끼워 넣을 때 항상 맞는 조사를 고르게 한다 — 문자열을 하드코딩하면 "삼각형라서"처럼 틀린 조합이 나옴.
function hasBatchim(word) {
  const s = String(word || '');
  for (let i = s.length - 1; i >= 0; i--) {
    const code = s.charCodeAt(i);
    if (code >= 0xAC00 && code <= 0xD7A3) return (code - 0xAC00) % 28 !== 0;
  }
  return true; // 한글이 아예 없으면(예: 괄호로 끝나는 문자열) 안전하게 받침 있음으로 취급
}
function eunNeun(word) { return hasBatchim(word) ? '은' : '는'; }
function gwaWa(word) { return hasBatchim(word) ? '과' : '와'; }
function ira(word) { return hasBatchim(word) ? '이라' : '라'; }
function stripTrailingDot(s) { return String(s || '').replace(/\.\s*$/, ''); }

// 얼굴형 세부 유형(눈/코/입/턱/얼굴형 6종 룰베이스 분류) 조합 — 크기 비교(describeSizeCombo)와는 별개
// 축이다. entryA.comboTrait/strength만으로 "같음/다름" 여부와 그 근거를 반환한다 — 최종 문장 조립은
// combineAxisCombo가 크기 축과 합쳐서 한다(바로 아래 주석 참고). 여기서 "잘 통해요" 같은 자체 결론을
// 내리지 않는 이유도 같다 — 두 축의 결론이 어긋날 수 있어서, 결론은 반드시 combineAxisCombo에서
// 두 축을 같이 보고 나서 내려야 앞뒤가 맞는다.
// nameA/nameB — "나"/"상대" 대신 실제 이름+"님"을 쓴다(사용자 요청 2026-08-19 정책, 얼굴형·눈·코·입·턱
// 조합 카드에는 그동안 반영이 안 돼 있었다 — 사용자 리포트 2026-08-24: "한쪽은~ 이러지 말고 누군지
// 제대로 설명해줘"). 이름이 없으면(비로그인 등) 기존처럼 "나"/"상대방"으로 자연스럽게 대체된다.
//
// explainerPrefix — 얼굴형 세부 6종(직사각형/정사각형/삼각형/역삼각형/원형/타원형, FACE_SHAPE_TYPE_DB)은
// 바로 위에서 이미 보여준 얼굴형 큰 틀 3종(원형/사각형/역삼각형, FACE_SHAPE_AXIS_TEXT)과 이름이
// 겹치는 다른 축이라, 아무 설명 없이 "모양 자체는 둘 다 삼각형이라서"만 나오면 "방금 원형·사각형이라며,
// 근데 왜 또 삼각형이야?"처럼 모순으로 읽힌다(사용자 리포트 2026-08-24). 얼굴형 조합 카드 호출부에서만
// 이 축이 실제로 재는 기준(이마·턱 폭 비율)을 짧게 밝혀준다 — 눈/코/입/턱은 겹치는 축이 없어 그대로 둔다.
function describeTypeCombo(entryA, entryB, nameA, nameB, explainerPrefix) {
  if (!entryA || !entryB) return null;
  const same = entryA.nameKo === entryB.nameKo;
  const traitA = entryA.comboTrait || stripTrailingDot(entryA.strength);
  const prefix = explainerPrefix || '';
  const nA = nameA || '나', nB = nameB || '상대방';
  if (same) {
    return { same, conclusion: traitA, reason: `${prefix}모양 자체는 둘 다 ${entryA.nameKo}${ira(entryA.nameKo)}서 ${stripTrailingDot(entryA.strength)}` };
  }
  const traitB = entryB.comboTrait || stripTrailingDot(entryB.strength);
  return {
    same,
    // "서로 다른 매력"이라는 결론은 여기서 안 붙인다 — combineAxisCombo가 문맥(크기 축과 같은지
    // 다른지)에 맞춰 "다르다"는 표현을 직접 고르게 해야, "서로 다른 매력은 서로 다른 조합이에요"
    // 처럼 같은 말이 중복되지 않는다.
    conclusion: `${traitA}${gwaWa(traitA)} ${traitB}`,
    reason: `${prefix}모양을 보면 ${nA}${eunNeun(nA)} ${entryA.nameKo}${ira(entryA.nameKo)} ${stripTrailingDot(entryA.strength)}. ${nB}${eunNeun(nB)} ${entryB.nameKo}${ira(entryB.nameKo)} ${stripTrailingDot(entryB.strength)}`,
  };
}
// ⚠️ 2026-08-24 사용자 리포트 — 예전엔 "크기 축"(describeSizeCombo, 예: 입 크기가 달라 "온도차
// 있음")과 "유형 축"(describeTypeCombo, 예: 입 모양이 같아 "닮아서 잘 통해요")을 각자 따로 결론
// 내려서 그냥 이어붙였다. 두 축은 완전히 다른 걸 재는 별개 지표라 결론이 어긋나는 게 당연한데,
// 어긋났을 때 아무 연결 없이 나란히 붙여놓으니 "다르다"고 해놓고 바로 "같다"고 말하는 것처럼
// 읽혔다(사용자가 정확히 이 모순을 지적함). 그래서 이 함수가 두 축의 같음/다름 여부를 직접 비교해서
// "다르지만"/"게다가" 같은 연결어를 명시적으로 골라 붙인다 — 두 결론이 서로 왜 같이 성립하는지
// 항상 말로 설명되게 하는 게 핵심. body(카드 본문)는 짧은 종합 결론, basis("왜 이렇게 풀이했나요?")는
// 원인(크기가 왜 그런지·모양이 왜 그런지) → 결과 순서로 푼 설명이다. sizeAxis/typeAxis.conclusion은
// 명사구라 은/는·과/와 조사가 매번 달라지므로 eunNeun/gwaWa로 동적으로 고른다(하드코딩 금지).
function combineAxisCombo(sizeAxis, typeAxis, tip) {
  if (!sizeAxis || !typeAxis) return null;
  const sc = sizeAxis.conclusion, tc = typeAxis.conclusion;
  let body, basis;
  if (sizeAxis.same && typeAxis.same) {
    body = `${sc}${gwaWa(sc)} ${tc}까지 닮은 조합이에요.`;
    basis = `${sizeAxis.reason}. 게다가 ${typeAxis.reason}.`;
  } else if (sizeAxis.same && !typeAxis.same) {
    body = `${sc}${eunNeun(sc)} 닮았지만, ${tc}${eunNeun(tc)} 서로 다른 매력인 조합이에요.`;
    basis = `${sizeAxis.reason}. 그런데 ${typeAxis.reason}.`;
  } else if (!sizeAxis.same && typeAxis.same) {
    body = `${sc}${eunNeun(sc)} 있지만, ${tc}${eunNeun(tc)} 같은 조합이에요.`;
    basis = `${sizeAxis.reason} 하지만 ${typeAxis.reason}.`;
  } else {
    body = `${sc}도, ${tc}도 서로 달라 여러모로 대조적인 조합이에요.`;
    basis = `${sizeAxis.reason}. 거기에 ${typeAxis.reason}.`;
  }
  return { body: tip ? `${body} ${tip}` : body, basis };
}
// 크기(gwansangLevel) 축의 같음/다름 버킷을 고른다 — describeSizeCombo(buildMoneyChemi 등 다른
// 카드가 여전히 쓰는 원본 함수)와 같은 판정 기준(60/40)을 쓴다.
// aIsPrimary — maleBig/maleSmall 버킷일 때 "그 특징을 가진 쪽"이 A인지 B인지(성별로 결정되므로
// 이 함수가 이미 알고 있다). 실제 이름을 붙이려면(resolveAxisEntry) 어느 이름이 주어(primary)로
// 가는지 알아야 해서 버킷 키 하나만으로는 부족하다 — 그래서 문자열 대신 객체로 반환한다
// (사용자 리포트 2026-08-24: "한쪽은~ 말고 누군지 제대로 설명해줘").
function sizeBucketKey(levelA, levelB, genderA, genderB, rel) {
  const bigA = levelA >= 60, smallA = levelA <= 40;
  const bigB = levelB >= 60, smallB = levelB <= 40;
  if (bigA && bigB) return { key: 'bothBig' };
  if (smallA && smallB) return { key: 'bothSmall' };
  if (rel === '연인/배우자' && genderA && genderB && genderA !== genderB) {
    const aIsMale = genderA === '남';
    if (aIsMale ? bigA : bigB) return { key: 'maleBig', aIsPrimary: aIsMale };
    if (aIsMale ? smallA : smallB) return { key: 'maleSmall', aIsPrimary: aIsMale };
  }
  return { key: 'mixed' };
}
// entry.reason이 함수면 (주어 이름, 상대 이름) 순으로 호출해 문장을 만들고, 문자열이면(같음 버킷·
// mixed처럼 누구인지 밝힐 필요 없는 경우) 그대로 쓴다. 항상 이 헬퍼를 거치게 해서 SIZE_AXIS_TEXT·
// FACE_SHAPE_AXIS_TEXT 양쪽이 같은 규칙을 쓰게 한다.
function resolveAxisEntry(entry, primaryName, otherName) {
  if (!entry) return null;
  return {
    same: entry.same,
    conclusion: entry.conclusion,
    tip: entry.tip,
    reason: typeof entry.reason === 'function' ? entry.reason(primaryName, otherName) : entry.reason,
  };
}
// 크기 축 원인(reason)·짧은 결론(conclusion)·조언(tip) — bothBig/bothSmall=같음, 나머지=다름.
// maleBig/maleSmall의 reason은 함수다 — 실제 이름(사용자 요청 2026-08-19 정책)을 넣어야 "한쪽은
// ~, 다른 한쪽은 ~"처럼 누가 누군지 안 보이는 문제가 안 생긴다(resolveAxisEntry가 호출).
const SIZE_AXIS_TEXT = {
  eye: {
    bothBig: { same: true, reason: '눈이 둘 다 큰 편이라 감정 표현이 풍부해요', conclusion: '감정 표현이 풍부한 점', tip: '큰 지출 전엔 서로 한 번씩 물어보는 습관을 들이면 좋아요.' },
    bothSmall: { same: true, reason: '눈이 둘 다 작은 편이라 표현엔 무던해도 알뜰한 편이에요', conclusion: '표현엔 무던하고 알뜰한 점', tip: '기념일만큼은 의식적으로 챙겨보세요.' },
    maleBig: { same: false, reason: (big, small) => `${big}${eunNeun(big)} 눈이 커서 화려하고 감성적이고, ${small}${eunNeun(small)} 눈이 작아 차분하고 소극적이에요`, conclusion: '감정 표현의 결', tip: '취향 차이를 존중하면서 번갈아 리드해보면 균형이 맞아요.' },
    maleSmall: { same: false, reason: (small, big) => `${small}${eunNeun(small)} 눈이 작아 내성적이고, ${big}${eunNeun(big)} 눈이 커서 밝게 이끄는 편이에요`, conclusion: '이끄는 쪽과 따라가는 쪽', tip: '서로에게 좋은 자극이 되는 편이에요.' },
    mixed: { same: false, reason: '눈 크기가 서로 달라 감정 표현 방식에 차이가 있어요', conclusion: '감정 표현 방식의 차이', tip: '서로 다른 방식을 이해해주면 좋아요.' },
  },
  nose: {
    bothBig: { same: true, reason: '코가 둘 다 시원시원한 편이라 재물운과 자존심이 강해요', conclusion: '재물운과 자존심이 강한 점', tip: '큰 지출은 미리 상의하는 습관을 들이면 좋아요.' },
    bothSmall: { same: true, reason: '코가 둘 다 아담하고 야무진 편이라 알뜰하게 모아요', conclusion: '알뜰하게 모으는 점', tip: '가끔은 자신에게 투자하는 여유도 가져보세요.' },
    maleBig: { same: false, reason: (big, small) => `${big}${eunNeun(big)} 코가 커서 배포 크게 쓰고, ${small}${eunNeun(small)} 코가 작아 알뜰하게 관리해요`, conclusion: '벌고 쓰는 역할', tip: '벌고 쓰는 역할을 자연스럽게 나누면 재물운이 잘 굴러가요.' },
    maleSmall: { same: false, reason: (small, big) => `${small}${eunNeun(small)} 코가 작아 야무지게 살림을 챙기고, ${big}${eunNeun(big)} 코가 커서 배포 크게 일을 벌여요`, conclusion: '관리와 확장의 역할', tip: '서로 재물 관리 방식을 존중해주면 좋아요.' },
    mixed: { same: false, reason: '코의 재물 기운 크기가 서로 달라요', conclusion: '돈 쓰는 스타일의 차이', tip: '가계부나 공동 목표를 함께 세워보면 도움이 돼요.' },
  },
  mouth: {
    bothBig: { same: true, reason: '입이 둘 다 큰 편이라 애정 표현이 솔직하고 정열적이에요', conclusion: '애정 표현이 솔직한 점', tip: '감정을 숨기지 않고 잘 주고받는 편이에요.' },
    bothSmall: { same: true, reason: '입이 둘 다 작은 편이라 마음은 깊어도 말이나 스킨십 표현엔 서툴 수 있어요', conclusion: '표현이 서툰 점', tip: '가끔은 마음을 직접 말로 꺼내보세요.' },
    maleBig: { same: false, reason: (big, small) => `${big}${eunNeun(big)} 입이 커서 애정 표현에 적극적이고, ${small}${eunNeun(small)} 입이 작아 그걸 받아주는 편이에요`, conclusion: '표현하는 쪽과 받아주는 쪽', tip: '표현하는 쪽이 너무 앞서가지 않게 속도를 맞춰주면 좋아요.' },
    maleSmall: { same: false, reason: (small, big) => `${small}${eunNeun(small)} 입이 작아 소극적이고, ${big}${eunNeun(big)} 입이 커서 리드하는 편이에요`, conclusion: '이끄는 쪽과 따라가는 쪽', tip: '받는 쪽도 원하는 걸 표현하는 연습을 해보면 더 좋아져요.' },
    mixed: { same: false, reason: '입 크기가 서로 달라 애정 표현의 온도차가 있을 수 있어요', conclusion: '애정 표현 방식의 온도차', tip: '서로 원하는 표현 방식을 한 번쯤 이야기해보면 좋아요.' },
  },
  chin: {
    bothBig: { same: true, reason: '턱이 둘 다 발달한 편이라 생활력과 추진력이 강해요', conclusion: '뜻을 밀어붙이는 힘이 강한 점', tip: '큰 결정 앞에서는 번갈아 양보하는 습관이 필요해요.' },
    bothSmall: { same: true, reason: '턱이 둘 다 갸름하고 섬세한 편이라 감성적이고 예민해요', conclusion: '큰 결정 앞에서 둘 다 망설이는 점', tip: '한쪽이 먼저 방향을 정해주는 역할을 맡으면 좋아요.' },
    maleBig: { same: false, reason: (big, small) => `${big}${eunNeun(big)} 턱이 발달해 뚝심 있게 밀어붙이고, ${small}${eunNeun(small)} 턱이 갸름해 섬세하게 마음을 챙겨요`, conclusion: '미는 역할과 챙기는 역할', tip: '서로의 속도를 존중하면 안정적인 조합이 돼요.' },
    maleSmall: { same: false, reason: (small, big) => `${small}${eunNeun(small)} 턱이 갸름해 섬세하고, ${big}${eunNeun(big)} 턱이 발달해 든든하게 받쳐줘요`, conclusion: '받쳐주는 관계', tip: '말년까지 안정적으로 함께할 수 있는 궁합이에요.' },
    mixed: { same: false, reason: '턱선 굵기가 서로 달라요', conclusion: '삶을 꾸려가는 속도의 차이', tip: '서로의 리듬을 맞춰가는 대화가 도움이 돼요.' },
  },
};
// 얼굴형 큰 틀(classifyFaceShape3의 원형/사각형/역삼각형 3분류) 축 — mouth/eye/nose/chin과 달리
// "크다/작다"가 아니라 3개 카테고리라 같음/다름만 판정한다. 원인·결론·조언은 기존 FACE_SHAPE_COMBO를
// 그대로 3조각으로 쪼갠 것(성별 방향성 서술은 이번 개편에서 정리 — 큰틀×세부유형 두 축을 합치는
// 로직이 새로 생겨서, 성별 전용 문구까지 얹으면 조합이 과하게 늘어난다).
// 다름 조합(원형_사각형 등)의 reason은 함수다 — 키 순서(첫 번째 자리 = 앞쪽 얼굴형)와 실제 이름을
// 맞춰 붙여야 해서(resolveAxisEntry), faceShapeAxis가 키가 정방향인지 역방향인지에 따라 이름
// 순서를 맞춰 넘긴다(사용자 리포트 2026-08-24: "한쪽은~ 말고 누군지 제대로 설명해줘").
const FACE_SHAPE_AXIS_TEXT = {
  '원형_원형': { same: true, reason: '얼굴형이 둘 다 둥근 원형이라 편안하고 다정한 분위기예요', conclusion: '편안하고 다정한 점', tip: '감정이 격해지면 크게 부딪히기 쉬우니, 서로 진정할 시간을 주는 습관이 필요해요.' },
  '사각형_사각형': { same: true, reason: '얼굴형이 둘 다 각진 사각형이라 생활력과 실행력이 확실해요', conclusion: '생활력과 실행력이 확실한 점', tip: '집안일이든 바깥일이든 한쪽에 쏠리지 않게 의식적으로 나누는 게 좋아요.' },
  '역삼각형_역삼각형': { same: true, reason: '얼굴형이 둘 다 갸름한 역삼각형이라 마음은 잘 통해요', conclusion: '마음이 잘 통하는 점', tip: '감정 표현이 서로 서툴 수 있으니, 걸리는 게 있으면 그때그때 말로 확인해보세요.' },
  '원형_사각형': { same: false, reason: (n1, n2) => `${n1}${eunNeun(n1)} 여유로운 원형, ${n2}${eunNeun(n2)} 부지런한 사각형이에요`, conclusion: '여유와 부지런함의 차이', tip: '역할이 한쪽에 쏠리기 쉬우니 의식적으로 나눠보세요.' },
  '원형_역삼각형': { same: false, reason: (n1, n2) => `${n1}${eunNeun(n1)} 털털한 원형, ${n2}${eunNeun(n2)} 섬세한 역삼각형이에요`, conclusion: '대범함과 섬세함의 차이', tip: '한쪽이 대범하게 이끌고 다른 한쪽이 세심하게 챙겨주는, 편안하게 잘 맞는 조합이에요.' },
  '사각형_역삼각형': { same: false, reason: (n1, n2) => `${n1}${eunNeun(n1)} 바깥일에 강한 사각형, ${n2}${eunNeun(n2)} 안팎을 챙기는 역삼각형이에요`, conclusion: '역할의 차이', tip: '역할이 자연스럽게 나뉘어서 좋아요.' },
};
function faceShapeAxis(shapeA, shapeB, nameA, nameB) {
  const direct = FACE_SHAPE_AXIS_TEXT[`${shapeA}_${shapeB}`];
  if (direct) return resolveAxisEntry(direct, nameA, nameB);
  const reversed = FACE_SHAPE_AXIS_TEXT[`${shapeB}_${shapeA}`];
  if (reversed) return resolveAxisEntry(reversed, nameB, nameA);
  return null;
}
// 크기 축 버킷을 실제 이름과 묶는다 — sizeBucketKey가 반환하는 aIsPrimary(그 특징을 가진 쪽이 A인지)에
// 맞춰 주어 순서를 맞춰 resolveAxisEntry에 넘긴다. bothBig/bothSmall/mixed는 aIsPrimary가 없고
// reason도 문자열 그대로라 순서가 의미 없다.
function resolveSizeAxis(category, levelA, levelB, genderA, genderB, rel, nameA, nameB) {
  const bucket = sizeBucketKey(levelA, levelB, genderA, genderB, rel);
  const entry = SIZE_AXIS_TEXT[category][bucket.key];
  return bucket.aIsPrimary === false ? resolveAxisEntry(entry, nameB, nameA) : resolveAxisEntry(entry, nameA, nameB);
}
// nameA/nameB — 실제 이름+"님"(없으면 "나"/"상대방", 사용자 요청 2026-08-19 정책). 호출부(궁합보기
// 리포트 조립 함수)가 이미 계산해둔 nameA/nameB를 그대로 넘겨받는다.
function buildFaceComboChemi(lmA, lmB, genderA, genderB, rel, nameA, nameB) {
  if (!lmA || !lmB) return null;
  const rA = getGwansangRatios(lmA), rB = getGwansangRatios(lmB);
  const shapeA = classifyFaceShape3(rA), shapeB = classifyFaceShape3(rB);
  const eyeLevelA = gwansangLevel('waJ', rA.waJ), eyeLevelB = gwansangLevel('waJ', rB.waJ);
  const noseLevelA = gwansangLevel('junduR', rA.junduR), noseLevelB = gwansangLevel('junduR', rB.junduR);
  const mouthLevelA = gwansangLevel('mouthR', rA.mouthR), mouthLevelB = gwansangLevel('mouthR', rB.mouthR);
  const cheekLevelA = gwansangLevel('cheekR', rA.cheekR), cheekLevelB = gwansangLevel('cheekR', rB.cheekR);
  const chinLevelA = gwansangLevel('jigakR', rA.jigakR), chinLevelB = gwansangLevel('jigakR', rB.jigakR);
  const idsA = classifyAllFeaturesRuleBased(lmA).ids, idsB = classifyAllFeaturesRuleBased(lmB).ids;

  const eyeSize = resolveSizeAxis('eye', eyeLevelA, eyeLevelB, genderA, genderB, rel, nameA, nameB);
  const noseSize = resolveSizeAxis('nose', noseLevelA, noseLevelB, genderA, genderB, rel, nameA, nameB);
  const mouthSize = resolveSizeAxis('mouth', mouthLevelA, mouthLevelB, genderA, genderB, rel, nameA, nameB);
  const chinSize = resolveSizeAxis('chin', chinLevelA, chinLevelB, genderA, genderB, rel, nameA, nameB);
  const faceShapeSize = faceShapeAxis(shapeA, shapeB, nameA, nameB);

  const eyeType = describeTypeCombo(EYE_SHAPE_DB[idsA.eye_shape_id], EYE_SHAPE_DB[idsB.eye_shape_id], nameA, nameB);
  const noseType = describeTypeCombo(NOSE_SHAPE_DB[idsA.nose_shape_id], NOSE_SHAPE_DB[idsB.nose_shape_id], nameA, nameB);
  const mouthType = describeTypeCombo(MOUTH_SHAPE_DB[idsA.mouth_shape_id], MOUTH_SHAPE_DB[idsB.mouth_shape_id], nameA, nameB);
  const chinType = describeTypeCombo(CHIN_SHAPE_DB[idsA.chin_shape_id], CHIN_SHAPE_DB[idsB.chin_shape_id], nameA, nameB);
  // 얼굴형 세부 6종은 방금 위(faceShapeSize)에서 본 큰 틀 3종과 이름이 겹치는 별개 축이라(예: 삼각형
  // vs 역삼각형) 설명 없이 바로 나오면 모순처럼 읽힌다(사용자 리포트 2026-08-24) — 실제로 재는 기준을
  // 짧게 밝혀준다.
  // ⚠️ 버그 수정(2026-08-24 사용자 리포트: "역삼각형이라는 단어 자체가 처음 나왔는데 뭔 소린지 모르겠다")
  // — 세 가지 큰 틀(원형/사각형/역삼각형)을 항상 다 나열하는 문구였는데, 이 둘이 실제로 무엇이었는지와
  // 무관하게 고정 텍스트라 방금 안 나온 카테고리까지 언급해 혼란을 줬다. shapeA/shapeB(바로 위
  // faceShapeSize가 실제로 쓴 값)만 골라서 넣는다.
  const coarseShapeNames = Array.from(new Set([shapeA, shapeB])).join('·');
  // ⚠️ 버그 수정(2026-08-24 사용자 리포트: "무슨 모양이 삼각형이라는 거야?") — "모양 자체는 둘 다
  // 삼각형이라서..."처럼 라벨만 나오고, FACE_SHAPE_TYPE_SIGNATURES(landmark-engine.js)가 실제로
  // 재는 기준(이마폭/턱폭/얼굴길이 비율)은 어디에도 안 보여서 본인 얼굴 어디를 보고 그렇게 판단했는지
  // 알 길이 없었다. describeTypeCombo는 entry.nameKo를 그대로 문장에 꽂는 범용 함수라 그 함수 자체는
  // 안 건드리고, 얼굴형 세부 6종 호출 여기서만 nameKo 앞에 실측 기준 문구를 붙인 사본을 만들어 넘긴다
  // (전역 FACE_SHAPE_TYPE_DB는 부위별 상세 리포트 등 다른 화면에서도 원래 이름 그대로 써야 해서 그대로 둔다).
  const FACE_SHAPE_TYPE_HINT = {
    FS_SQUARE: '이마와 턱이 비슷하게 넓고 얼굴이 짧은',
    FS_RECTANGLE: '이마와 턱 폭은 비슷하고 얼굴이 긴',
    FS_TRIANGLE: '이마보다 턱이 넓은',
    FS_INV_TRIANGLE: '턱보다 이마가 넓은',
    FS_ROUND: '얼굴이 짧고 턱선이 둥근',
    FS_OVAL: '얼굴이 길고 턱선이 갸름한',
  };
  const withShapeHint = (id, entry) => {
    const hint = FACE_SHAPE_TYPE_HINT[id];
    return (entry && hint) ? Object.assign({}, entry, { nameKo: `${hint} ${entry.nameKo}` }) : entry;
  };
  const faceShapeType = describeTypeCombo(
    withShapeHint(idsA.face_shape_type_id, FACE_SHAPE_TYPE_DB[idsA.face_shape_type_id]),
    withShapeHint(idsB.face_shape_type_id, FACE_SHAPE_TYPE_DB[idsB.face_shape_type_id]),
    nameA, nameB,
    `방금 본 ${coarseShapeNames}${eunNeun(coarseShapeNames)} 얼굴 윤곽의 큰 틀이고, 이건 이마와 턱의 폭 비율로 얼굴형을 한 번 더 세밀하게 나눈 것이에요. `
  );

  const eyeCombo = combineAxisCombo(eyeSize, eyeType, eyeSize.tip);
  const noseCombo = combineAxisCombo(noseSize, noseType, noseSize.tip);
  const mouthCombo = combineAxisCombo(mouthSize, mouthType, mouthSize.tip);
  const chinCombo = combineAxisCombo(chinSize, chinType, chinSize.tip);
  const faceShapeCombo = combineAxisCombo(faceShapeSize, faceShapeType, faceShapeSize.tip);

  const cheekText = (cheekLevelA >= 60 && cheekLevelB >= 60)
    ? '둘 다 광대가 발달한 편이에요. 각자 자기 주장이 뚜렷하고 드센 편이라, 양보 없이 매일 사소하게 부딪히거나 반대로 무심한 사이가 되기 쉬워요. 이기고 지는 문제가 아니라는 걸 서로 확인하는 대화가 필요해요.'
    : '광대 발달 정도가 서로 달라서, 자기 주장을 내는 정도에 차이가 있는 조합이에요. 결정할 때 목소리가 큰 쪽만 따라가지 않도록 신경 써보세요.';

  return {
    faceShape: { a: shapeA, b: shapeB, text: faceShapeCombo.body, basis: faceShapeCombo.basis },
    eye: { text: eyeCombo.body, basis: eyeCombo.basis },
    nose: { text: noseCombo.body, basis: noseCombo.basis },
    mouth: { text: mouthCombo.body, basis: mouthCombo.basis },
    cheek: { text: cheekText },
    chin: { text: chinCombo.body, basis: chinCombo.basis },
  };
}

// 2) 사주 기운 케미 — 각자의 기운을 먼저 밝히고(사주 대 사주), 시너지 + 마음의 안식처로 종합
function buildEnergyChemi(ohA, ohB) {
  const domA = Object.entries(ohA).sort((a,b)=>b[1]-a[1])[0][0];
  const domB = Object.entries(ohB).sort((a,b)=>b[1]-a[1])[0][0];
  const weakA = Object.entries(ohA).sort((a,b)=>a[1]-b[1])[0][0];
  const vA = OHAENG_VIBE[domA], vB = OHAENG_VIBE[domB];
  const compare = `나는 "${vA.line}"에 가깝고, 상대는 "${vB.line}"에 가까워요.`;
  let synergy;
  if (sangSaeng[domA].includes(domB) || sangSaeng[domB].includes(domA)) {
    synergy = `${compare} 두 사람 모두 주관이 명확하고 현실 감각이 뛰어나요. 서로를 키워주는 조합이라, 함께 있을수록 서로의 장점이 더 잘 드러나요.`;
  } else if (sangGeuk[domA].includes(domB) || sangGeuk[domB].includes(domA)) {
    synergy = `${compare} 서로 다른 결이 부딪히는 조합이라 초반엔 의견 차이가 생기기 쉬워요. 대신 그 다름을 역할로 나누면 웬만한 팀보다 강력한 파트너십이 돼요.`;
  } else {
    synergy = `${compare} 결이 비슷해서 안정적이고 예측 가능한 관계를 만들어요. 큰 충돌 없이 꾸준하게 이어갈 수 있는 궁합이에요.`;
  }
  const haven = (sangSaeng[domB].includes(weakA) || domB === weakA)
    ? `한쪽의 추진력이 과열될 때 상대방의 기운이 브레이크 역할을 해줘요. 각자 자기 할 일을 잘하면서도, 함께 있을 때 제일 안정감을 느끼는 관계예요.`
    : `서로 다른 결을 가졌지만, 집에 오면 가장 편안해지는 사이예요. 굳이 애쓰지 않아도 옆에 있는 것만으로 채워지는 부분이 있어요.`;
  return { synergy, haven };
}

// 오행별 "속으로 파고드는 정도" 순위 — 이 파일의 관상오행 칭호(화형="열정 넘치는 리더"=표현이
// 바깥으로, 수형="깊고 지혜로운"=생각이 안으로)와 같은 전통 오행 성격 배속을 그대로 따른다.
// 값이 높을수록 속으로 파고드는(내향) 편, 낮을수록 답답함을 느끼기 쉬운(표현이 빠른) 편.
const OHAENG_INTROVERT_RANK = { 수: 4, 금: 3, 목: 2, 토: 1, 화: 0 };
// 3) 티격태격 모먼트 & 극복 전략 — 오행 상극 여부 + 같은 강점이 겹칠 때
function buildMoments(ohA, ohB, statusMapA, statusMapB) {
  const domA = Object.entries(ohA).sort((a,b)=>b[1]-a[1])[0][0];
  const domB = Object.entries(ohB).sort((a,b)=>b[1]-a[1])[0][0];
  const moments = [];
  if (sangGeuk[domA].includes(domB) || sangGeuk[domB].includes(domA)) {
    // ⚠️ 버그 수정(2026-08-20 사용자 리포트: "한쪽은 ~, 다른 한쪽은 ~"이라 누가 누군지 안 보임) —
    // 둘이 다른 오행이니(상극 관계는 항상 서로 다른 오행끼리) 위 순위로 실제 누가 파고드는 쪽인지
    // 밝힌다. 이미 buildLifeStageChemi가 "내가"/"상대방이"로 구분하는 것과 같은 방식.
    const introvertIsA = OHAENG_INTROVERT_RANK[domA] > OHAENG_INTROVERT_RANK[domB];
    const introvertWho = introvertIsA ? '내가' : '상대방이';
    const stuffyWho = introvertIsA ? '상대방이' : '내가';
    moments.push({ title:'속마음 표현의 속도 차이', desc:`${introvertWho} 고민이 생기면 속으로 파고드는 편이라, ${stuffyWho} 답답하게 느낄 수 있어요.`, tip:'"천천히 생각하고 말해줘도 돼"라는 여유를 건네주는 대화법을 써보세요.' });
  }
  if (statusMapA && statusMapB && statusMapA.midbrow === 'strength' && statusMapB.midbrow === 'strength') {
    moments.push({ title:'주관 대 주관의 충돌', desc:'두 사람 모두 자기 주관이 뚜렷해서, 소소한 선택(데이트 코스, 물건 고르기 등)에서 의견이 엇갈릴 수 있어요.', tip:'분야를 나눠서 한쪽 결정을 믿어주는 "전담 영역"을 미리 정해두세요.' });
  }
  if (!moments.length) {
    moments.push({ title:'무난해서 오히려 심심할 때', desc:'큰 갈등은 없지만, 그만큼 특별한 자극도 적게 느껴질 수 있어요.', tip:'가끔은 평소와 다른 데이트나 새로운 활동으로 리듬을 깨뜨려보세요.' });
  }
  return moments.slice(0, 2);
}

function buildCoupleHeadline(sameRole) {
  return sameRole
    ? '같은 곳을 보는 케미! 티키타카가 척척 맞는 "평행 성장형" 궁합'
    : '누가 이끄냐로 다투지 않는다! 서로의 영역을 확실히 나누는 "전략적 파트너" 궁합';
}

// 헤드라인 아래 "근거" 서브카피로 두 사람의 15캐릭터 조합을 표기(궁합 리포트 구성.md 4-6). 사진이
// 없어 캐릭터 판정이 없으면 조용히 비워둔다.
// 2026-08-30 DB 이원화 1단계 이후 — characterResult.characterName은 서버(analyzeCharacter)가 더 이상
// 내려주지 않는다(CHARACTER_DB가 클라이언트에 없어 서버 쪽 계산 함수가 이름을 몰라서 characterId만
// 반환). 이름은 이제 캐릭터 콘텐츠 카탈로그(js/character/character-db.js, 2단계)에서 characterId로
// 직접 찾는다 — classifyAndBuildCharacter가 이미 CharacterAPI.ensureCharacterCatalog()로 채워뒀다.
function renderHeadlineSub() {
  const el = document.getElementById('ggHeadlineSub');
  if (!el) return;
  const idA = state.gunghamA.characterResult && state.gunghamA.characterResult.characterId;
  const idB = state.gunghamB.characterResult && state.gunghamB.characterResult.characterId;
  const nameA = idA && CHARACTER_DB[idA] && CHARACTER_DB[idA].name;
  const nameB = idB && CHARACTER_DB[idB] && CHARACTER_DB[idB].name;
  el.textContent = (nameA && nameB) ? `근거: ${nameA} × ${nameB}` : '';
}
// "왜 이렇게 풀이했나요?" 아코디언(gg-basis-acc, 2026-08-22 도입) — 이제는 유형 축만 따로 보여주는
// 게 아니라 combineAxisCombo가 크기 축+유형 축을 합쳐 원인→결과 순으로 만든 basis 전체를 보여준다
// (2026-08-24 개편, 위 combineAxisCombo 주석 참고).
function basisAccordion(emoji, basis) {
  return basis ? `<details class="gg-basis-acc"><summary>왜 이렇게 풀이했나요?</summary><div class="gg-basis-content">${emoji} ${basis}</div></details>` : '';
}

// 개인별 관상/사주 서술은 통합분석 탭에 이미 있으므로 여기서는 그리지 않는다(2026-08-20 재편) —
// narrativeA/B는 이제 이 함수 밖(buildRoleChemi의 statusMap 등)에서만 쓰인다.
function renderCoupleReport(chemi, faceCombo, faceOhaengCompare, moneyChemi, lifeStage, energy, yongsinChemi, moments) {
  document.getElementById('ggHeadline').innerHTML = `"${buildCoupleHeadline(chemi.sameRole)}"`;
  renderHeadlineSub();
  renderFaceOhaengCompare(faceOhaengCompare, 'ggFaceOhaengCompare');

  // STEP3 — 관상 케미 (한줄 총평 + 역할 분담) — 2026-08-22 재편으로 총평을 Zone1 맨 위로 독립시켰다.
  document.getElementById('ggRoleTotal').innerHTML =
    `<div class="chemi-card"><div class="chemi-title">🎭 관상 케미 한줄 총평</div><div class="chemi-role">${chemi.total}</div></div>`;
  document.getElementById('ggRoleCards').innerHTML = `
    <div class="chemi-card">
      <div class="chemi-title">역할 분담 케미</div>
      <div class="chemi-role">👤 나 → <strong>${chemi.roleA}</strong></div>
      <div class="chemi-role">👤 상대 → <strong>${chemi.roleB}</strong></div>
    </div>`;

  renderMoneyChemi(moneyChemi, 'ggMoneyChemiCard');

  // 얼굴형·눈·입·광대 "조합"으로 보는 궁합 — 부위별 강점/보완 비교와 달리 두 사람 유형의 조합 자체를 본다.
  // 노출 순서: 눈 > 코 > 광대뼈 > 입 > 턱 > 얼굴형(사용자 요청 2026-08-20). 크기 비교 문장 아래에
  // 유형(눈/코/입/턱/얼굴형 6종 룰베이스 분류) 조합 보조 줄을 덧붙인다(4-5, 광대는 유형 ID가 없어 제외).
  document.getElementById('ggFaceComboCards').innerHTML = faceCombo
    ? `
    <div class="chemi-card"><div class="chemi-title">눈 크기 조합</div><div class="chemi-role">${faceCombo.eye.text}</div>${basisAccordion('👁️', faceCombo.eye.basis)}</div>
    <div class="chemi-card"><div class="chemi-title">코 조합</div><div class="chemi-role">${faceCombo.nose.text}</div>${basisAccordion('👃', faceCombo.nose.basis)}</div>
    <div class="chemi-card"><div class="chemi-title">광대뼈 조합</div><div class="chemi-role">${faceCombo.cheek.text}</div></div>
    <div class="chemi-card"><div class="chemi-title">입 크기 조합</div><div class="chemi-role">${faceCombo.mouth.text}</div>${basisAccordion('👄', faceCombo.mouth.basis)}</div>
    <div class="chemi-card"><div class="chemi-title">턱 조합</div><div class="chemi-role">${faceCombo.chin.text}</div>${basisAccordion('🦴', faceCombo.chin.basis)}</div>
    <div class="chemi-card"><div class="chemi-title">얼굴형 조합 (${faceCombo.faceShape.a} × ${faceCombo.faceShape.b})</div><div class="chemi-role">${faceCombo.faceShape.text}</div>${basisAccordion('🙂', faceCombo.faceShape.basis)}</div>`
    : `<div class="chemi-role" style="color:var(--text2);">📸 두 사람 모두 사진을 업로드하면 얼굴형·눈·입·광대 조합으로 보는 궁합을 볼 수 있어요.</div>`;

  renderLifeStageChemi(lifeStage, 'ggLifeStageCard');

  // STEP3 — 사주 기운 케미
  document.getElementById('ggEnergyCards').innerHTML = `
    <div class="chemi-card"><div class="chemi-title">에너지 시너지 (사주 대 사주)</div><div class="chemi-role">${energy.synergy}</div></div>
    <div class="chemi-card"><div class="chemi-title">마음의 안식처 케미</div><div class="chemi-role">${energy.haven}</div></div>`;

  renderYongsinChemi(yongsinChemi, 'ggYongsinCard');

  document.getElementById('ggMomentCards').innerHTML = moments.map((m, i) => `
    <div class="moment-card">
      <div class="moment-title">${i+1}. ${m.title}</div>
      <div class="part-tip">${m.desc}</div>
      <div class="moment-tip">💡 해결책 — ${m.tip}</div>
    </div>`).join('');
}

// 두 지지(地支) 간 관계 점수 — 삼합/육합/충 여부로 판단 (일지·월지 공용)
function branchRelationScore(bA, bB) {
  const diff = Math.abs(bA - bB);
  if ([4,8].includes(diff)) return 90;   // 삼합
  if (diff === 6) return 70;             // 충
  if ([1,11].includes(diff)) return 85;  // 육합/인접
  return 60;
}

// 두 사람 오행 분포의 유사도 — 차이가 적을수록 생활 습관·리듬이 비슷하다고 봄
function ohBalanceScore(ohA, ohB) {
  const totalDiff = Object.keys(ohA).reduce((s, k) => s + Math.abs(ohA[k] - ohB[k]), 0);
  return Math.max(30, Math.round(100 - totalDiff * 8));
}

// ── 관상학적 궁합 스코어링 (db/MATCHING.csv 설계를 실제 점수 공식으로 구현) ──
// MediaPipe 마이그레이션으로 landmark-engine.js의 비율 계산식(분모가 interocularDist 등으로 통일)이
// 바뀌면서 값의 스케일도 바뀌었다. 아래 range는 scratchpad 검증 사진 실측값을 anchor로 재조정한
// 것이며, 여전히 "초안"이다(문서 §0 원칙과 동일하게 실측 데이터가 쌓이면 추후 보정 필요).
// ⚠️ 2026-08-27 junduR 재보정 — 궁합보기 "코 조합" 카드가 실제로는 매번 "작은 코"로만 나온다는
// 사용자 리포트로 32장을 실측해보니 junduR 레벨(gwansangLevel)이 6~28(평균 17.7)에 몰려 있는데
// "크다" 기준이 60이라 사실상 도달 불가능했다 — landmark-engine.js의 NOSE_SIGNATURES 재보정과
// 같은 문제지만, 이 파일의 gwansangLevel/gwansangFeatureCompat는 그 테이블을 전혀 안 쓰고 이
// GWANSANG_FEATURE_RANGE를 따로 참조해서 그때 안 고쳐졌다(코 조합 텍스트뿐 아니라 "재물 궁합"
// 점수 계산에도 junduR가 쓰여 같이 낮게 쏠려 있었다). 실측 p10/중앙/p90(0.60/0.66/0.72, 이미
// FACE_SIGNATURES 재보정 주석과 동일한 값)을 25/50/75%에 맞춰 [0.54, 0.78]로 다시 잡았다. waJ·
// mouthR·jigakR은 같은 32장으로 확인했을 때 60/40 양쪽 다 실제로 나와서 건드리지 않았다.
const GWANSANG_FEATURE_RANGE = { waJ:[0.05,0.20], mgW:[0.4,1.7], beomR:[0.25,0.75], junduR:[0.54,0.78], jigakR:[0.4,1.0], gwanR:[0.10,0.55], injR:[0.25,0.65], sanR:[0.05,0.20], browGapR:[1.0,4.0], mouthR:[0.5,1.3], cheekR:[1.8,3.0] };

// 부위별 실측값을 해당 부위의 FACE_FEATURE.csv 범위 안에서 0~100으로 정규화한 "상대적 위치"
function gwansangLevel(key, v) {
  const [min, max] = GWANSANG_FEATURE_RANGE[key];
  return Math.max(0, Math.min(100, Math.round((v - min) / (max - min) * 100)));
}

// 같은 부위를 가진 두 사람의 궁합 = "둘 다 발달했는지(수준)" + "값이 서로 비슷한지(유사도)"를 절반씩 반영
function gwansangFeatureCompat(key, vA, vB) {
  const [min, max] = GWANSANG_FEATURE_RANGE[key];
  const range = max - min;
  const avgLevel = (gwansangLevel(key, vA) + gwansangLevel(key, vB)) / 2;
  const similarity = Math.max(30, Math.min(100, Math.round(100 - (Math.abs(vA - vB) / range) * 120)));
  return Math.round(avgLevel * 0.5 + similarity * 0.5);
}

// MATCHING.csv의 8개 관계차원 ↔ 부위쌍 매핑을 그대로 구현 (db/README.md 매핑표 참고)
// 생활 궁합은 README에 명시된 대로 얼굴 부위쌍이 없어(순수 오행 유사도) 제외
function calcGwansangCompat(lmA, lmB) {
  const rA = getGwansangRatios(lmA), rB = getGwansangRatios(lmB);
  const emo    = gwansangFeatureCompat('waJ', rA.waJ, rB.waJ);                                                                        // MATCH_0001 와잠
  const comm   = Math.round((gwansangFeatureCompat('beomR', rA.beomR, rB.beomR) + gwansangFeatureCompat('mgW', rA.mgW, rB.mgW)) / 2); // MATCH_0003+0004 법령+명궁
  const love   = Math.round((gwansangFeatureCompat('waJ', rA.waJ, rB.waJ) + gwansangFeatureCompat('injR', rA.injR, rB.injR)) / 2);     // MATCH_0007 와잠+인중
  const money  = gwansangFeatureCompat('junduR', rA.junduR, rB.junduR);                                                               // MATCH_0005 준두
  const jaw    = gwansangFeatureCompat('jigakR', rA.jigakR, rB.jigakR);                                                               // MATCH_0006 지각
  const growth = gwansangFeatureCompat('gwanR', rA.gwanR, rB.gwanR);                                                                  // MATCH_0008 관록궁
  return {
    '정서적 궁합': emo,
    '대화·소통 궁합': comm,
    '연애 궁합': love,
    '금전 궁합': money,
    '갈등 궁합': jaw,
    '성장 궁합': growth,
    '장기적인 관계 궁합': jaw, // MATCH_0006 지각 유사도 — 갈등해결과 공유(README 명시)
  };
}

function calcCompatScore(pillarsA, pillarsB, ohA, ohB, rel, gwansangCompat) {
  // 오행 궁합표 (상생/상극)
  const ohCompat = { 목: {목:60,화:85,토:40,금:30,수:90}, 화: {목:85,화:60,토:80,금:35,수:25}, 토: {목:40,화:80,토:60,금:85,수:30}, 금: {목:30,화:35,토:85,금:60,수:80}, 수: {목:90,화:25,토:30,금:80,수:60} };

  const domA = Object.entries(ohA).sort((a,b)=>b[1]-a[1])[0][0];
  const domB = Object.entries(ohB).sort((a,b)=>b[1]-a[1])[0][0];
  const ohScore = ohCompat[domA]?.[domB] || 60;

  // 일간 궁합 (천간 합)
  const stemDiff = Math.abs(pillarsA[2].stem - pillarsB[2].stem);
  const stemScore = [0,5,4,2,6,10].includes(stemDiff) ? 85 : stemDiff===1||stemDiff===9 ? 75 : 60;

  // 일지 궁합 (삼합/육합) · 월지 궁합(사회적 관계) · 오행 분포 유사도(생활 리듬)
  const branchScore = branchRelationScore(pillarsA[2].branch, pillarsB[2].branch);
  const monthScore = branchRelationScore(pillarsA[1].branch, pillarsB[1].branch);
  const balanceScore = ohBalanceScore(ohA, ohB);

  // 8개 궁합 영역 — 각기 다른 지표 조합에 가중치를 둬 영역별 특성을 반영
  const areaDefs = [
    { label:'정서적 궁합',     pct: Math.round(branchScore*0.5 + ohScore*0.3 + balanceScore*0.2) },
    { label:'대화·소통 궁합',   pct: Math.round(monthScore*0.5 + ohScore*0.3 + stemScore*0.2) },
    { label:'연애 궁합',       pct: Math.round(stemScore*0.5 + branchScore*0.3 + ohScore*0.2) },
    { label:'생활 궁합',       pct: Math.round(balanceScore*0.5 + branchScore*0.3 + monthScore*0.2) },
    { label:'금전 궁합',       pct: Math.round(ohScore*0.4 + stemScore*0.3 + balanceScore*0.3) },
    { label:'갈등 궁합',       pct: Math.round(ohScore*0.3 + stemScore*0.3 + monthScore*0.4) },
    { label:'성장 궁합',       pct: Math.round(ohScore*0.5 + monthScore*0.3 + stemScore*0.2) },
    { label:'장기적인 관계 궁합', pct: Math.round(branchScore*0.4 + balanceScore*0.3 + ohScore*0.3) },
  ].map(a => {
    let pct = Math.max(0, Math.min(100, a.pct));
    // 두 사람 사진이 모두 있으면 해당 관계차원의 관상 궁합(calcGwansangCompat)과 절반씩 블렌드
    if (gwansangCompat && gwansangCompat[a.label] != null) pct = Math.round(pct*0.5 + gwansangCompat[a.label]*0.5);
    return { label: a.label, pct: Math.max(0, Math.min(100, pct)) };
  });

  const totalScore = Math.round(areaDefs.reduce((s,a) => s+a.pct, 0) / areaDefs.length);

  const grade = totalScore>=85?'천생연분 ✨':totalScore>=75?'좋은 궁합 💫':totalScore>=60?'무난한 궁합 🌙':totalScore>=45?'노력이 필요한 궁합 ⚡':'주의가 필요한 궁합 ⚠️';
  const gradeDesc = {
    '천생연분 ✨': `${rel === '연인/배우자' ? '연인으로서 최고의 궁합입니다.' : '최고의 궁합입니다.'} 두 사람의 에너지가 완벽하게 조화를 이룹니다.`,
    '좋은 궁합 💫': '서로의 장점이 잘 어우러지는 좋은 궁합입니다. 함께할수록 더 빛납니다.',
    '무난한 궁합 🌙': '평균적인 궁합입니다. 서로 이해하고 노력한다면 좋은 관계를 유지할 수 있습니다.',
    '노력이 필요한 궁합 ⚡': '에너지가 다소 충돌하는 면이 있습니다. 상호 이해와 배려가 중요합니다.',
    '주의가 필요한 궁합 ⚠️': '기운이 많이 충돌합니다. 서로의 차이를 존중하는 노력이 필요합니다.',
  };

  const sortedAreas = [...areaDefs].sort((a,b) => b.pct - a.pct);
  const bestArea = sortedAreas[0], worstArea = sortedAreas[sortedAreas.length-1];

  const ohName = {목:'목',화:'화',토:'토',금:'금',수:'수'};
  const summary = `<strong style="color:var(--gold);">💕 궁합 종합 분석 (${rel})</strong><br><br>` +
    `첫 번째 분의 주 오행은 <strong>${ohName[domA]}</strong>, 두 번째 분의 주 오행은 <strong>${ohName[domB]}</strong>입니다. ` +
    `${gradeDesc[grade]} 8개 영역 중에서는 <strong>${bestArea.label}</strong>(${bestArea.pct}%)이 가장 두드러지고, <strong>${worstArea.label}</strong>(${worstArea.pct}%)에 조금 더 신경 쓰면 관계가 한층 좋아질 수 있습니다. ` +
    (gwansangCompat ? '이 점수에는 두 사람의 관상 비교 결과도 함께 반영되어 있습니다. ' : '') +
    `사주 궁합은 두 사람의 에너지와 기질의 조화를 보여줍니다. 좋은 관계는 타고난 궁합보다 서로에 대한 이해와 노력으로 만들어집니다. 🌟`;

  return {
    score: totalScore,
    grade,
    desc: gradeDesc[grade],
    bars: areaDefs,
    summary,
  };
}

// ═══ STEP 4. 우리를 보완하다 ═══
const COMPLEMENT_STYLE = {
  오행보완: { bg:'rgba(74,222,128,0.1)',  border:'rgba(74,222,128,0.4)',  badge:'rgba(74,222,128,0.2)',  text:'#4ade80', label:'오행 보완' },
  행동보완: { bg:'rgba(251,191,36,0.1)',  border:'rgba(251,191,36,0.4)',  badge:'rgba(251,191,36,0.2)',  text:'#fbbf24', label:'행동 보완' },
  관계보완: { bg:'rgba(167,139,250,0.1)', border:'rgba(167,139,250,0.4)', badge:'rgba(167,139,250,0.2)', text:'#a78bfa', label:'관계 보완' },
};

function renderComplementCards(items, cardsElId, sectionElId) {
  const cardsEl = document.getElementById(cardsElId);
  if (!cardsEl || !items || !items.length) return;
  cardsEl.innerHTML = items.map(it => {
    const s = COMPLEMENT_STYLE[it.type] || COMPLEMENT_STYLE['오행보완'];
    return `<div style="background:${s.bg};border:1px solid ${s.border};border-radius:10px;padding:14px 16px;">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
        <strong style="font-size:13px;color:${s.text};">${it.title}</strong>
        <span style="font-size:10px;font-weight:700;background:${s.badge};color:${s.text};padding:2px 7px;border-radius:999px;">${s.label}</span>
      </div>
      <div style="font-size:12px;color:var(--text2);line-height:1.7;margin-bottom:6px;">${it.issue || ''}</div>
      <div style="font-size:12px;color:var(--text);line-height:1.7;">💡 ${it.suggestion}</div>
    </div>`;
  }).join('');
  if (sectionElId) {
    const sec = document.getElementById(sectionElId);
    if (sec) sec.classList.remove('hidden');
  }
}

// 관상 기반 메이크업·생활습관 팁은 PART_CONTENT(§3, 시술 문구 없음)로 대체되어
// generateStylingTips / generateBeautyTips 는 제거했습니다 (지침서: 시술 추천 금지).

// 3) 사주 · 오행 보완 — 색상/공간/취미/생활 패턴을 현대적 행동 언어로
function generateOhaengLifestyle(ohaeng) {
  const weakOh = Object.entries(ohaeng).sort((a,b)=>a[1]-b[1])[0][0];
  const lifestyleMap = {
    목: { issue:'새싹 같은 성장 · 추진 기운이 부족해 새로운 시도 앞에서 망설이는 경향이 있을 수 있어요.', suggestion:'초록색 계열의 소품이나 식물을 가까이 두고, 새로운 취미나 배움을 시작하는 활동을 늘려보세요. 계획을 오래 세우기보다 일단 작게 시작해보는 경험이 도움이 돼요.' },
    화: { issue:'태양 같은 표현 · 적극성 기운이 부족해 감정을 드러내는 데 소극적일 수 있어요.', suggestion:'운동, 새로운 사람과의 교류, 감정을 적극적으로 표현하는 활동을 생활 속에 늘려보세요. 밝은 조명이나 붉은 계열 소품도 활력을 더하는 데 도움이 돼요.' },
    토: { issue:'산처럼 든든한 안정 · 신뢰 기운이 부족해 생활 리듬이 불규칙해지기 쉬워요.', suggestion:'규칙적인 취침 · 기상 시간과 공간 정리를 습관화해보세요. 흙색 · 베이지 계열 인테리어와 반려식물 키우기도 안정감을 더하는 데 도움이 돼요.' },
    금: { issue:'서리처럼 칼같은 결단 · 원칙 기운이 부족해 중요한 결정을 미루는 경향이 있을 수 있어요.', suggestion:'스스로 마감 기한을 정해 실행하는 연습과 정리정돈된 미니멀한 공간이 도움이 돼요. 흰색 · 메탈릭 계열 소품도 명료함을 더할 수 있어요.' },
    수: { issue:'강물처럼 깊은 지혜 · 유연성 기운이 부족해 생각을 오래 담아두는 경향이 있을 수 있어요.', suggestion:'독서, 사색의 시간, 물이 보이는 곳으로의 여행을 늘려보세요. 파란색 · 검정 계열 소품과 조용한 공간 배치도 도움이 돼요.' },
  };
  const info = lifestyleMap[weakOh];
  return [{ type:'오행보완', title:`${OHAENG_VIBE[weakOh].line}이 필요해요`, issue: info.issue, suggestion: info.suggestion }];
}

// 4) 개인 행동 보완 — 일간 성격 기준, 인간관계/연애/직장/돈관리/의사결정/감정표현/갈등관리
function generatePersonalBehavior(pillars, ohaeng) {
  const dStem = pillars[2].stem;
  const behaviorMap = [
    { area:'의사결정', issue:'생각을 오래 한 뒤 말하는 성향이 강해 상대에게 무관심하게 느껴질 수 있습니다.', suggestion:'결론이 나지 않았더라도 지금 느끼는 감정을 먼저 표현하는 연습이 도움이 됩니다.' },
    { area:'감정 표현', issue:'유연한 성향이 때로는 우유부단함으로 비칠 수 있습니다.', suggestion:'중요한 순간에는 자신의 의견을 명확히 밝히는 연습을 해보세요.' },
    { area:'인간관계', issue:'밝은 에너지가 앞서 깊이 있는 관계를 쌓는 데는 시간이 걸릴 수 있습니다.', suggestion:'소수의 사람과 깊은 대화를 나누는 시간을 의식적으로 만들어보세요.' },
    { area:'갈등 관리', issue:'통찰력이 뛰어나지만 갈등 상황에서는 감정 표현을 아끼는 편입니다.', suggestion:'갈등이 생기면 상대의 의도를 추측하기보다 먼저 감정을 말로 표현해보세요.' },
    { area:'돈 관리', issue:'포용력이 크지만 그만큼 지출에도 관대한 편일 수 있습니다.', suggestion:'월별 지출 계획을 세우고 정기적으로 점검하는 습관을 만들어보세요.' },
    { area:'직장생활', issue:'세밀한 처리 능력이 강해 완벽을 추구하다 스스로를 지치게 할 수 있습니다.', suggestion:'우선순위를 정해 일부는 과감히 위임하는 연습이 필요합니다.' },
    { area:'연애', issue:'의리를 중시하지만 표현이 서툴러 오해를 살 수 있습니다.', suggestion:'마음을 말과 행동으로 함께 표현하는 습관을 들여보세요.' },
    { area:'의사결정', issue:'날카로운 판단력이 때로는 완벽주의로 이어져 결정이 늦어질 수 있습니다.', suggestion:'80% 확신이 서면 실행에 옮기는 결단이 도움이 됩니다.' },
    { area:'인간관계', issue:'포용력이 크지만 자기 주장을 뒤로 미루는 경향이 있습니다.', suggestion:'거절해야 할 상황에서는 명확하게 의사를 전달하는 연습을 해보세요.' },
    { area:'감정 표현', issue:'깊은 감수성을 가졌지만 속마음을 잘 드러내지 않는 편입니다.', suggestion:'신뢰하는 사람에게는 감정을 먼저 나누는 시도를 해보세요.' },
  ];
  const b = behaviorMap[dStem >= 0 ? dStem : 0];
  return [{ type:'행동보완', title:`${b.area} 보완`, issue: b.issue, suggestion: b.suggestion }];
}

