// ═══════════════════════════════════════════════════════════════════════
// 보관함 — 결제한 사용자의 분석 리포트가 쌓이는 페이지(팝업 아님).
// 결제 모듈 연동 전이라, 지금은 "리포트가 완성되면 로그인한 아이디(uid) 기준으로 저장"한다.
// 결제 모듈이 붙으면 저장 시점(Archive.save 호출 지점)에 결제 여부만 확인하면 된다.
//
// app.js의 계산/렌더 로직은 건드리지 않는다. 각 분석이 완전히 끝나는 지점에서
// Archive.save(type)를 한 줄 호출하는 것이 유일한 연결점이다.
//
// 저장 구조
//   목록  localStorage `gwansang_archive_v1:<uid>`      + Firestore users/{uid}.archive
//   본문  localStorage `gwansang_report_v1:<uid>:<id>`  + Firestore users/{uid}/reports/{id}
// 본문을 별도 문서로 나눈 이유 — Firestore 문서 1개당 1MB 제한이라 리포트를 한 문서에 몰면 금방 넘친다.
// ═══════════════════════════════════════════════════════════════════════
(function () {
  const IDX_PREFIX = 'gwansang_archive_v1:';
  const REPORT_PREFIX = 'gwansang_report_v1:';

  const SECTIONS = [
    { type: 'combined', label: '통합분석' },
    { type: 'gungham',  label: '궁합보기' },
    { type: 'gwansang', label: '관상보기' },
    { type: 'saju',     label: '사주보기' },
  ];
  // 각 분석 결과가 그려지는 컨테이너 — 이 DOM을 그대로 떠서 보관한다.
  const CONTAINERS = {
    combined: ['cmbResult'],
    gwansang: ['gwansangResult'],
    saju: ['sajuResult', 'sajuComplement'],
    gungham: ['ggResult'],
  };

  let sortDesc = true;   // 최신순이 기본
  let openState = null;  // 아코디언 펼침 상태 (첫 렌더 때 기록 유무로 초기화)
  let viewingId = null;  // 리포트 상세를 보고 있으면 그 기록 id
  let prevTab = 'combined';

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
  }
  function currentUid() {
    return (window.fbAuth && fbAuth.currentUser) ? fbAuth.currentUser.uid : null;
  }

  // ── 목록 저장소 ──────────────────────────────────────────────────────
  function loadIndex() {
    const uid = currentUid();
    if (!uid) return [];
    try { return JSON.parse(localStorage.getItem(IDX_PREFIX + uid)) || []; }
    catch (e) { return []; }
  }
  function saveIndex(list) {
    const uid = currentUid();
    if (!uid) return;
    localStorage.setItem(IDX_PREFIX + uid, JSON.stringify(list));
    if (window.fbDb) {
      fbDb.collection('users').doc(uid).set({ archive: list }, { merge: true })
        .catch(e => console.error('[archive] 목록 클라우드 저장 실패', e));
    }
  }

  // ── 리포트 본문 저장소 ───────────────────────────────────────────────
  function saveReportHtml(uid, id, html) {
    try { localStorage.setItem(REPORT_PREFIX + uid + ':' + id, html); }
    catch (e) { console.warn('[archive] 로컬 저장 용량 초과 — 클라우드에만 저장한다', e); }
    if (!window.fbDb) return;
    fbDb.collection('users').doc(uid).collection('reports').doc(id)
      .set({ html: html, createdAt: new Date().toISOString() })
      .catch(e => console.error('[archive] 리포트 클라우드 저장 실패', e));
  }
  async function loadReportHtml(id) {
    const uid = currentUid();
    if (!uid) return null;
    const local = localStorage.getItem(REPORT_PREFIX + uid + ':' + id);
    if (local) return local;
    if (!window.fbDb) return null;
    try {
      const doc = await fbDb.collection('users').doc(uid).collection('reports').doc(id).get();
      if (!doc.exists) return null;
      const html = doc.data().html || null;
      // 다음 열람부터는 네트워크 없이 뜨도록 로컬에도 채워둔다.
      if (html) { try { localStorage.setItem(REPORT_PREFIX + uid + ':' + id, html); } catch (e) {} }
      return html;
    } catch (e) {
      console.error('[archive] 리포트 불러오기 실패', e);
      return null;
    }
  }
  function removeReportHtml(uid, id) {
    localStorage.removeItem(REPORT_PREFIX + uid + ':' + id);
    if (!window.fbDb) return;
    fbDb.collection('users').doc(uid).collection('reports').doc(id).delete()
      .catch(e => console.error('[archive] 리포트 삭제 실패', e));
  }

  // 로그인 직후 — 다른 기기에서 만든 목록을 이 기기로 가져온다(본문은 열람할 때 개별로 받는다).
  async function loadFromCloud() {
    const uid = currentUid();
    if (!uid || !window.fbDb) return;
    try {
      const doc = await fbDb.collection('users').doc(uid).get();
      const cloud = doc.exists ? doc.data().archive : null;
      if (Array.isArray(cloud) && cloud.length) {
        localStorage.setItem(IDX_PREFIX + uid, JSON.stringify(cloud));
      } else {
        saveIndex(loadIndex()); // 클라우드가 비어 있으면(첫 로그인) 이 기기 기록을 올려둔다
      }
      if (isOpen()) renderPage();
    } catch (e) {
      console.error('[archive] 목록 불러오기 실패', e);
    }
  }

  // ── 리포트 스냅샷 ────────────────────────────────────────────────────
  // 화면에 그려진 결과 카드를 그대로 복제해 보관한다. 다시 열었을 때 앱의 살아있는 DOM과
  // 충돌하지 않도록 id/onclick을 떼고, 직렬화되지 않는 canvas와 script는 제거한다.
  function snapshot(type) {
    const wrap = document.createElement('div');
    (CONTAINERS[type] || []).forEach(function (id) {
      const el = document.getElementById(id);
      if (!el || el.classList.contains('hidden')) return;
      wrap.appendChild(el.cloneNode(true));
    });
    if (!wrap.children.length) return null;
    wrap.querySelectorAll('canvas, script').forEach(n => n.remove());
    wrap.querySelectorAll('[id]').forEach(n => n.removeAttribute('id'));
    wrap.querySelectorAll('[onclick]').forEach(n => n.removeAttribute('onclick'));
    // 저장 시점에 접혀 있던 상세(details)는 그대로 두되, 카드 자체가 숨겨지진 않게 한다.
    Array.from(wrap.children).forEach(n => n.classList.remove('hidden'));
    return wrap.innerHTML;
  }

  // 분석 대상이 누구였는지 — 각 탭이 쓰는 프로필/관계에서 가져온다.
  function buildLabel(type) {
    const rep = window.Profile ? Profile.getRepresentative() : null;
    const repName = rep ? rep.name : '나';
    // app.js의 state는 const 전역이라 window에 붙지 않는다 — 전역 렉시컬 스코프로 직접 참조한다.
    const st = (typeof state !== 'undefined') ? state : null;
    if (type === 'gungham') {
      const partner = window.Profile && Profile.getGunghamPartner ? Profile.getGunghamPartner() : null;
      return {
        title: repName + ' ✕ ' + (partner ? partner.name : '상대방'),
        sub: (st && st.gungham && st.gungham.relation) || '',
      };
    }
    const rel = (st && st[type] && st[type].relation) || (rep && (rep.relationDetail || rep.relation)) || '';
    return { title: repName, sub: rel };
  }

  // ── 결제 게이트 ──────────────────────────────────────────────────────
  // 통합분석·사주보기는 AI를 돌리는 유료 상품이다. 결제 모듈 연동 전이라 지금은 "결제했다"고 전제하고
  // 무조건 통과시킨다. 결제 모듈이 붙으면 이 함수 하나만 실제 결제 여부 조회로 바꾸면 된다.
  const PAID_TYPES = ['combined', 'saju'];
  function hasPaidFor(type) {
    if (PAID_TYPES.indexOf(type) < 0) return true; // 무료 분석은 게이트 없음
    return true; // TODO(결제 연동): 해당 분석 건의 결제 완료 여부로 교체
  }

  // 분석이 완전히 끝난 지점에서 app.js가 호출한다.
  // 보관에 실패해도 분석 화면 자체는 영향을 받으면 안 되므로 모든 실패를 여기서 흡수하고 로그만 남긴다.
  function save(type) {
    try {
      if (!CONTAINERS[type]) { console.warn('[archive] 저장 대상이 아닌 분석', type); return; }
      const uid = currentUid();
      if (!uid) { console.warn('[archive] 비로그인 상태 — 리포트를 보관하지 않는다', type); return; }
      if (!hasPaidFor(type)) { console.warn('[archive] 미결제 — 리포트를 보관하지 않는다', type); return; }

      const html = snapshot(type);
      if (!html) {
        // 결과 카드가 아직 화면에 없거나(hidden) 비어 있으면 스냅샷할 게 없다.
        console.warn('[archive] 스냅샷할 결과 카드가 없다', {
          type: type,
          containers: (CONTAINERS[type] || []).map(function (cid) {
            const el = document.getElementById(cid);
            return cid + (!el ? '(없음)' : el.classList.contains('hidden') ? '(hidden)' : '(ok)');
          }),
        });
        return;
      }

      const label = buildLabel(type);
      const id = 'a_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
      saveReportHtml(uid, id, html);
      const list = loadIndex();
      list.push({
        id: id, type: type, title: label.title, sub: label.sub,
        paid: PAID_TYPES.indexOf(type) >= 0, // 결제 상품 여부 — 결제내역 화면에서 재사용할 수 있게 남긴다
        createdAt: new Date().toISOString(),
      });
      saveIndex(list);
      console.log('[archive] 리포트 보관 완료', { type: type, id: id, bytes: html.length, uid: uid });
      if (isOpen()) renderPage();
    } catch (e) {
      console.error('[archive] 리포트 보관 실패', type, e);
    }
  }

  // 콘솔에서 상태를 바로 확인하기 위한 진단용 — Archive.debug()
  function debug() {
    const uid = currentUid();
    const info = {
      uid: uid,
      indexCount: loadIndex().length,
      byType: {},
      containers: {},
    };
    SECTIONS.forEach(function (s) {
      info.byType[s.type] = loadIndex().filter(r => r.type === s.type).length;
      info.containers[s.type] = (CONTAINERS[s.type] || []).map(function (cid) {
        const el = document.getElementById(cid);
        return cid + (!el ? '(없음)' : el.classList.contains('hidden') ? '(hidden)' : '(ok)');
      }).join(', ');
    });
    console.log('[archive] 진단', info);
    return info;
  }

  function remove(id) {
    const uid = currentUid();
    if (!uid) return;
    const rec = loadIndex().find(r => r.id === id);
    if (!confirm('이 리포트를 삭제할까요?\n' + (rec ? rec.title + ' · ' + fmtWhen(rec.createdAt) : '') + '\n삭제하면 되돌릴 수 없습니다.')) return;
    removeReportHtml(uid, id);
    saveIndex(loadIndex().filter(r => r.id !== id));
    if (viewingId === id) viewingId = null;
    renderPage();
  }

  // 로그아웃 시 화면만 정리한다. 저장소는 계정(uid)별로 나뉘어 있어 로그아웃 상태에서는 어차피
  // 조회되지 않고, 사본을 남겨둬야 클라우드 조회가 어긋나도 재로그인 시 그대로 복원된다.
  function clearLocal() {
    if (isOpen()) renderPage();
  }

  function fmtWhen(iso) {
    const d = new Date(iso);
    if (isNaN(d)) return '';
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }

  // ── 페이지 ───────────────────────────────────────────────────────────
  function host() { return document.getElementById('panel-archive'); }
  function isOpen() { const h = host(); return !!(h && h.classList.contains('active')); }

  function openPage() {
    if (window.KakaoAuth) KakaoAuth.closePopup(); // 마이페이지 오버레이에서 넘어온 경우
    const active = document.querySelector('.panel.active');
    if (active && active.id !== 'panel-archive') prevTab = active.id.replace('panel-', '');
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    host().classList.add('active');
    viewingId = null;
    renderPage();
    window.scrollTo(0, 0);
  }

  // 보관함에서 나가기 — 들어오기 전 보던 탭으로 되돌린다.
  function closePage() {
    const btns = Array.from(document.querySelectorAll('.tab-btn'));
    const btn = btns.find(b => (b.getAttribute('onclick') || '').indexOf("'" + prevTab + "'") >= 0) || btns[0];
    if (btn) btn.click();
    window.scrollTo(0, 0);
  }

  function toggle(type) {
    ensureOpenState();
    openState[type] = !openState[type];
    renderPage();
  }
  function toggleSort() { sortDesc = !sortDesc; renderPage(); }

  function ensureOpenState() {
    if (openState) return;
    const all = loadIndex();
    openState = {};
    // 기록이 있는 섹션만 펼친 채로 시작한다 — 빈 섹션까지 열려 있으면 화면만 길어진다.
    SECTIONS.forEach(s => { openState[s.type] = all.some(r => r.type === s.type); });
  }

  function rowsFor(type, all) {
    return all
      .filter(r => r.type === type)
      .sort((a, b) => sortDesc ? (a.createdAt < b.createdAt ? 1 : -1) : (a.createdAt > b.createdAt ? 1 : -1));
  }

  function renderPage() {
    const h = host();
    if (!h) return;
    if (viewingId) { renderReport(h); return; }

    if (!currentUid()) {
      h.innerHTML = pageHeader() +
        '<div class="arc-guest">로그인하면 분석한 리포트가 이곳에 보관됩니다.</div>';
      return;
    }

    ensureOpenState();
    const all = loadIndex();

    const sections = SECTIONS.map(function (s) {
      const rows = rowsFor(s.type, all);
      const isOpenSec = !!openState[s.type];
      const body = rows.length
        ? rows.map(rec =>
            '<div class="arc-row" onclick="Archive.openReport(\'' + rec.id + '\')">' +
              '<span class="arc-row-mark material-symbols-outlined">description</span>' +
              '<span class="arc-row-body">' +
                '<span class="arc-row-name">' + esc(rec.title) + '</span>' +
                (rec.sub ? '<span class="arc-row-sub">' + esc(rec.sub) + '</span>' : '') +
              '</span>' +
              '<span class="arc-row-when">' + esc(fmtWhen(rec.createdAt)) + '</span>' +
              '<button class="arc-row-del" aria-label="삭제" title="삭제" ' +
                'onclick="event.stopPropagation();Archive.remove(\'' + rec.id + '\')">' +
                '<span class="material-symbols-outlined">delete</span></button>' +
            '</div>').join('')
        : '<div class="arc-empty">아직 분석 내용이 없어요</div>';

      return '<section class="arc-acc' + (isOpenSec ? ' is-open' : '') + '">' +
               '<button class="arc-acc-head" onclick="Archive.toggle(\'' + s.type + '\')">' +
                 '<span class="arc-acc-title">' + s.label + '</span>' +
                 (rows.length ? '<span class="arc-acc-count">' + rows.length + '</span>' : '') +
                 '<span class="arc-acc-icon material-symbols-outlined">' + (isOpenSec ? 'remove' : 'add') + '</span>' +
               '</button>' +
               (isOpenSec ? '<div class="arc-acc-body">' + body + '</div>' : '') +
             '</section>';
    }).join('');

    h.innerHTML = pageHeader() +
      '<div class="arc-sort">' +
        '<button class="arc-sort-btn" onclick="Archive.toggleSort()">' +
          (sortDesc ? '최신순' : '오래된순') +
          '<span class="material-symbols-outlined">swap_vert</span></button>' +
      '</div>' +
      sections;
  }

  function pageHeader() {
    return '<div class="arc-page-head">' +
             '<button class="arc-back" aria-label="뒤로" onclick="Archive.closePage()">' +
               '<span class="material-symbols-outlined">arrow_back</span></button>' +
             '<h2>보관함</h2>' +
           '</div>';
  }

  function openReport(id) {
    viewingId = id;
    renderPage();
    window.scrollTo(0, 0);
  }
  function backToList() { viewingId = null; renderPage(); window.scrollTo(0, 0); }

  async function renderReport(h) {
    const rec = loadIndex().find(r => r.id === viewingId);
    const section = SECTIONS.find(s => rec && s.type === rec.type);
    h.innerHTML =
      '<div class="arc-page-head">' +
        '<button class="arc-back" aria-label="목록으로" onclick="Archive.backToList()">' +
          '<span class="material-symbols-outlined">arrow_back</span></button>' +
        '<h2>' + esc(section ? section.label : '리포트') + '</h2>' +
      '</div>' +
      (rec ? '<div class="arc-report-meta">' + esc(rec.title) +
               (rec.sub ? ' · ' + esc(rec.sub) : '') + ' · ' + esc(fmtWhen(rec.createdAt)) + '</div>' : '') +
      '<div class="arc-report" id="arcReportBody"><div class="arc-empty">리포트를 불러오는 중…</div></div>';

    const html = await loadReportHtml(viewingId);
    const body = document.getElementById('arcReportBody');
    if (!body) return; // 불러오는 사이에 화면을 떠난 경우
    body.innerHTML = html || '<div class="arc-empty">저장된 리포트를 찾을 수 없습니다. 분석을 다시 실행해주세요.</div>';
  }

  window.Archive = {
    openPage: openPage, closePage: closePage,
    save: save, remove: remove, debug: debug,
    toggle: toggle, toggleSort: toggleSort,
    openReport: openReport, backToList: backToList,
    loadFromCloud: loadFromCloud, clearLocal: clearLocal,
  };
})();
