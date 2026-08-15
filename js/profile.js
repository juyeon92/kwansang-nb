// ═══════════════════════════════════════════════════════════════════════
// PROFILE SYSTEM — 신규 기능 모듈
// 이름·관계·생년월일·시간을 프로필로 저장/관리하고, 대표 프로필을 선택하면
// 기존 app.js의 DOM(input)·전역 변수(state, gender 등)에 값만 주입한다.
// app.js/ai-analysis.js의 계산 로직(computePillars, calcCompatScore 등)은
// 이 파일에서 절대 수정하지 않는다 — 값을 채워 넣고 기존 함수를 그대로 호출할 뿐이다.
// ═══════════════════════════════════════════════════════════════════════
(function () {
  const STORAGE_KEY = 'gwansang_profiles_v1';
  const RELATIONS = ['본인', '연인/배우자', '가족', '친구', '지인'];

  const BIRTH_HOUR_OPTIONS = [
    { value: '-1', label: '모름' },
    { value: '23', label: '자시(子時)', range: '23:00–00:59' },
    { value: '1',  label: '축시(丑時)', range: '01:00–02:59' },
    { value: '3',  label: '인시(寅時)', range: '03:00–04:59' },
    { value: '5',  label: '묘시(卯時)', range: '05:00–06:59' },
    { value: '7',  label: '진시(辰時)', range: '07:00–08:59' },
    { value: '9',  label: '사시(巳時)', range: '09:00–10:59' },
    { value: '11', label: '오시(午時)', range: '11:00–12:59' },
    { value: '13', label: '미시(未時)', range: '13:00–14:59' },
    { value: '15', label: '신시(申時)', range: '15:00–16:59' },
    { value: '17', label: '유시(酉時)', range: '17:00–18:59' },
    { value: '19', label: '술시(戌時)', range: '19:00–20:59' },
    { value: '21', label: '해시(亥時)', range: '21:00–22:59' },
  ];

  function hourLabel(v) {
    const o = BIRTH_HOUR_OPTIONS.find(x => x.value === String(v));
    if (!o) return '모름';
    return o.range ? `${o.label} ${o.range}` : o.label;
  }
  function hourShort(v) {
    const o = BIRTH_HOUR_OPTIONS.find(x => x.value === String(v));
    return o ? o.label : '모름';
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
  }

  // ── STORAGE ──────────────────────────────────────────────────────────
  function loadProfiles() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || []; }
    catch (e) { return []; }
  }
  function saveProfiles(list) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
    syncProfilesToCloud(list);
  }

  // ── Firebase 동기화 (로그인 상태일 때만 동작 — 비로그인이면 지금처럼 localStorage에만 남는다) ──
  // 진행 중인 쓰기를 붙잡아 둔다 — 저장 직후 로그아웃하면 signOut()이 아직 전송되지 않은 쓰기를
  // 버려서 "등록한 프로필이 다시 로그인하면 사라지는" 문제가 생긴다(flushPending으로 기다린다).
  let pendingCloudWrite = null;
  function syncProfilesToCloud(list) {
    if (!window.fbAuth || !fbAuth.currentUser || !window.fbDb) return Promise.resolve();
    const uid = fbAuth.currentUser.uid;
    console.log('[profile] 클라우드 저장 시도', { uid: uid, count: list.length });
    pendingCloudWrite = fbDb.collection('users').doc(uid).set({
      profiles: list,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    }, { merge: true })
      .then(function () { console.log('[profile] 클라우드 저장 완료', { uid: uid, count: list.length }); })
      .catch(function (e) { console.error('프로필 클라우드 저장 실패', e); });
    return pendingCloudWrite;
  }
  // 로그아웃 전에 kakao-auth.js가 호출 — 저장 중이던 동기화가 끝날 때까지 기다린다.
  function flushPendingSync() { return pendingCloudWrite || Promise.resolve(); }
  // 로그인 직후 kakao-auth.js가 호출 — 클라우드에 저장된 프로필을 이 기기로 가져온다.
  async function loadProfilesFromCloud() {
    if (!window.fbAuth || !fbAuth.currentUser || !window.fbDb) {
      console.warn('[profile] loadFromCloud 건너뜀 — 로그인 상태 아님', { fbAuth: !!window.fbAuth, currentUser: window.fbAuth && !!fbAuth.currentUser });
      return;
    }
    try {
      const doc = await fbDb.collection('users').doc(fbAuth.currentUser.uid).get();
      const cloudProfiles = doc.exists ? doc.data().profiles : null;
      console.log('[profile] 클라우드 조회 결과', { uid: fbAuth.currentUser.uid, exists: doc.exists, count: Array.isArray(cloudProfiles) ? cloudProfiles.length : 0 });
      if (Array.isArray(cloudProfiles) && cloudProfiles.length) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(cloudProfiles));
        applyRepresentativeEverywhere();
        renderGunghamB(null);
      } else {
        // 클라우드에 저장된 게 없으면(첫 로그인) 지금 로컬에 있는 프로필을 그대로 올려둔다.
        // 단, 로컬까지 비어 있으면 아무것도 올리지 않는다 — 빈 배열을 올리는 건 클라우드를 지우는
        // 것과 같아서, 조회가 잠깐 어긋난 상황에서 멀쩡한 프로필을 날려버릴 수 있다.
        const local = loadProfiles();
        if (local.length) syncProfilesToCloud(local);
        else console.log('[profile] 클라우드·로컬 모두 비어 있음 — 업로드 생략');
      }
      // 클라우드에 프로필이 있었든 없었든, 로그인 상태가 화면(헤더)에는 반드시 반영돼야 한다 —
      // 이전엔 이 호출이 if 분기 안에만 있어서, 클라우드가 비어있으면 로그인해도 헤더가 "로그인하고
      // 프로필을 등록해주세요"에 머물러 마치 로그인이 안 된 것처럼 보이는 버그가 있었다.
      renderHeader();
    } catch (e) {
      console.error('프로필 클라우드 불러오기 실패', e);
    }
  }
  // 로그아웃 시 kakao-auth.js가 호출 — 계정에 연결된 프로필이 로그아웃 후에도 화면에 남지 않도록 지운다.
  function clearLocalProfiles() {
    localStorage.removeItem(STORAGE_KEY);
    renderHeader();
    renderGunghamB(null);
  }
  function uid() { return 'p_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
  function getProfile(id) { return loadProfiles().find(p => p.id === id) || null; }
  function getRepresentative() {
    const list = loadProfiles();
    return list.find(p => p.isDefault) || list[0] || null;
  }
  function setRepresentative(id) {
    const list = loadProfiles();
    list.forEach(p => { p.isDefault = (p.id === id); });
    saveProfiles(list);
    applyRepresentativeEverywhere();
    renderHeader();
  }
  function upsertProfile(data) {
    const list = loadProfiles();
    if (data.id) {
      const idx = list.findIndex(p => p.id === data.id);
      if (idx >= 0) list[idx] = Object.assign({}, list[idx], data);
      else list.push(data);
    } else {
      data.id = uid();
      if (list.length === 0) data.isDefault = true;
      list.push(data);
    }
    saveProfiles(list);
    applyRepresentativeEverywhere();
    renderHeader();
    return data.id;
  }
  function deleteProfile(id) {
    let list = loadProfiles();
    const wasDefault = !!(list.find(p => p.id === id) || {}).isDefault;
    list = list.filter(p => p.id !== id);
    if (wasDefault && list.length) list[0].isDefault = true;
    saveProfiles(list);
    applyRepresentativeEverywhere();
    renderHeader();
  }

  // ── 음력 → 양력 변환 (lunar-javascript) ─────────────────────────────
  // API: Lunar.fromYmd(년, 월, 일) — 윤달은 월을 음수로(예: 윤2월 = -2). lunar.getSolar()로 양력 변환.
  function lunarToSolar(y, m, d, isLeap) {
    if (typeof Lunar === 'undefined') return null;
    try {
      const lunar = Lunar.fromYmd(y, isLeap ? -Math.abs(m) : m, d);
      const solar = lunar.getSolar();
      let sy, sm, sd;
      if (typeof solar.getYear === 'function') {
        sy = solar.getYear(); sm = solar.getMonth(); sd = solar.getDay();
      } else {
        const parts = String(solar.toString()).match(/\d+/g).map(Number);
        [sy, sm, sd] = parts;
      }
      return `${sy}-${String(sm).padStart(2, '0')}-${String(sd).padStart(2, '0')}`;
    } catch (e) {
      console.error('음력→양력 변환 실패', e);
      return null;
    }
  }
  function resolveSolarDate(d) {
    if (!d.birthYear || !d.birthMonth || !d.birthDay) return null;
    if (d.calendarType === '음력') return lunarToSolar(d.birthYear, d.birthMonth, d.birthDay, d.isLeapMonth);
    return `${d.birthYear}-${String(d.birthMonth).padStart(2, '0')}-${String(d.birthDay).padStart(2, '0')}`;
  }
  function fmtYmd(y, m, d) { return `${y}.${String(m).padStart(2,'0')}.${String(d).padStart(2,'0')}`; }

  // ── 기존 app.js DOM/전역에 값 주입 (계산 로직 무수정, 값만 채움) ─────
  function applyToContext(ctx, profile) {
    if (!profile) return;
    const relLabel = profile.relationDetail || profile.relation;
    if (ctx === 'gwansang' || ctx === 'combined') state[ctx].relation = relLabel;
    if (ctx === 'saju') state.saju.relation = relLabel;

    const dateFieldMap = { saju: 'birthDate', combined: 'cmbBirthDate' };
    const hourFieldMap = { saju: 'birthHour', combined: 'cmbBirthHour' };
    if (dateFieldMap[ctx]) { const el = document.getElementById(dateFieldMap[ctx]); if (el) el.value = profile.solarDate || ''; }
    if (hourFieldMap[ctx]) { const el = document.getElementById(hourFieldMap[ctx]); if (el) el.value = profile.birthHour || '-1'; }
    if (ctx === 'saju') gender = profile.gender || '남';
    if (ctx === 'combined') cmbGender = profile.gender || '남';
  }
  function applyToGunghamA(profile) {
    if (!profile) return;
    const el = document.getElementById('ggBirthA');
    if (el) el.value = profile.solarDate || '';
    ggGenderA = profile.gender || '남';
  }
  function applyToGunghamB(profile) {
    if (!profile) return;
    const el = document.getElementById('ggBirthB');
    if (el) el.value = profile.solarDate || '';
    ggGenderB = profile.gender || '여';
    state.gungham.relation = profile.relationDetail || profile.relation;
  }
  function applyRepresentativeEverywhere() {
    const rep = getRepresentative();
    if (!rep) return;
    applyToContext('gwansang', rep);
    applyToContext('saju', rep);
    applyToContext('combined', rep);
    applyToGunghamA(rep);
    renderGunghamA(rep);
  }

  // ── 헤더 Info box 렌더 ────────────────────────────────────────────────
  // 비로그인 상태에서는 프로필 등록으로 보내지 않고 로그인부터 유도한다 —
  // 헤더 아이콘과 동일하게 로그인 팝업(KakaoAuth.openLoginPopup)을 띄운다.
  function renderHeader() {
    const box = document.getElementById('profileInfoBox');
    if (!box) return;
    const loggedIn = !!(window.fbAuth && fbAuth.currentUser);
    if (!loggedIn) {
      box.innerHTML = `
        <span class="profile-name profile-empty">로그인하고 프로필을 등록해주세요</span>
        <span class="profile-edit-icon material-symbols-outlined">edit</span>`;
      box.onclick = function () { if (window.KakaoAuth) KakaoAuth.openLoginPopup(); };
      return;
    }
    const rep = getRepresentative();
    if (!rep) {
      box.innerHTML = `
        <span class="profile-name profile-empty">프로필을 등록해주세요</span>
        <span class="profile-edit-icon material-symbols-outlined">edit</span>`;
      box.onclick = function () { openSwitcher(); };
      return;
    }
    box.innerHTML = `
      <span class="profile-name">${esc(rep.name)}</span>
      <span class="profile-badge">${esc(rep.relationDetail || rep.relation)}</span>
      <span class="profile-edit-icon material-symbols-outlined">edit</span>`;
    box.onclick = function () { openSwitcher(); };
  }

  function renderGunghamA(rep) {
    const chip = document.getElementById('ggProfileChipA');
    if (!chip) return;
    if (!rep) { chip.innerHTML = `<span class="mini-profile-empty">헤더에서 프로필을 먼저 등록해주세요</span>`; return; }
    chip.innerHTML = `
      <span class="mini-profile-name">${esc(rep.name)}</span>
      <span class="mini-profile-badge">${esc(rep.relationDetail || rep.relation)}</span>
      <span class="mini-profile-sub">${esc(fmtYmd(...String(rep.solarDate||'').split('-')))} · ${esc(hourShort(rep.birthHour))}</span>`;
  }

  let gunghamPartnerId = null;
  function renderGunghamB(profile) {
    const chip = document.getElementById('ggProfileChipB');
    if (!chip) return;
    if (!profile) {
      chip.innerHTML = `<span class="mini-profile-placeholder"><span class="material-symbols-outlined" style="font-size:16px;vertical-align:-3px;">add</span> 상대방 프로필 선택</span>`;
      chip.classList.add('select-mode');
      return;
    }
    chip.classList.remove('select-mode');
    chip.innerHTML = `
      <span class="mini-profile-name">${esc(profile.name)}</span>
      <span class="mini-profile-badge">${esc(profile.relationDetail || profile.relation)}</span>
      <span class="mini-profile-sub">${esc(fmtYmd(...String(profile.solarDate||'').split('-')))} · ${esc(hourShort(profile.birthHour))}</span>`;
  }

  // ── 오버레이(팝업/바텀시트) 루트 ──────────────────────────────────────
  const root = () => document.getElementById('profileOverlayRoot');
  function closeOverlay() { const r = root(); if (r) r.innerHTML = ''; document.body.classList.remove('overlay-open'); }

  // ── 프로필 전환 바텀시트 ─────────────────────────────────────────────
  // opts.onDone: 선택/취소 후 오버레이를 닫는 대신 실행할 콜백 — 마이페이지처럼
  // "프로필 변경 후 원래 팝업으로 돌아가야" 하는 화면이 자기 화면을 다시 그릴 수 있게 해준다.
  let switcherOpts = {};
  function openSwitcher(opts) {
    opts = opts || {};
    switcherOpts = opts;
    const list = loadProfiles();
    if (list.length === 0) { openForm(null, opts); return; }
    const rep = getRepresentative();
    const forPartner = !!opts.forPartner;
    const rows = list.map(p => {
      const selected = forPartner ? (p.id === gunghamPartnerId) : (p.id === (rep && rep.id));
      return `
        <div class="profile-row ${selected ? 'is-selected' : ''}" onclick="Profile._pickRow('${p.id}', ${forPartner})">
          <span class="profile-row-check">${selected ? '<span class="material-symbols-outlined" style="font-size:16px;color:var(--mint);">check_circle</span>' : ''}</span>
          <div class="profile-row-body">
            <div class="profile-row-top">
              <span class="profile-row-name">${esc(p.name)}</span>
              <span class="profile-row-badge">${esc(p.relationDetail || p.relation)}</span>
            </div>
            <div class="profile-row-sub">${esc(fmtYmd(...String(p.solarDate||'').split('-')))} · ${esc(hourShort(p.birthHour))}</div>
          </div>
          <button class="profile-row-edit" onclick="event.stopPropagation();Profile._editRow('${p.id}', ${forPartner})"><span class="material-symbols-outlined" style="font-size:16px;">edit</span></button>
        </div>`;
    }).join('');

    root().innerHTML = `
      <div class="overlay-backdrop" onclick="Profile._dismissSwitcher()"></div>
      <div class="bottomsheet">
        <div class="bottomsheet-header">
          <span>${forPartner ? '상대방 프로필 선택' : '사주 관리'}</span>
          <button class="overlay-close" onclick="Profile._dismissSwitcher()"><span class="material-symbols-outlined">close</span></button>
        </div>
        <div class="profile-row-list">${rows}</div>
        <button class="btn-solid-primary btn-add" onclick="Profile._openAdd(${forPartner})"><span class="material-symbols-outlined" style="font-size:18px;vertical-align:-4px;">add</span> 사주 추가하기</button>
      </div>`;
    document.body.classList.add('overlay-open');
  }

  function pickRow(id, forPartner) {
    if (forPartner) {
      gunghamPartnerId = id;
      const p = getProfile(id);
      applyToGunghamB(p);
      renderGunghamB(p);
    } else {
      setRepresentative(id);
    }
    finishSwitcher();
  }
  // 선택을 끝냈거나(닫기/배경 클릭 포함) 취소했을 때 — 호출자가 돌아갈 화면을 지정했으면 그 화면으로,
  // 아니면 지금처럼 오버레이를 완전히 닫는다.
  function finishSwitcher() {
    const onDone = switcherOpts.onDone;
    switcherOpts = {};
    if (onDone) onDone(); else closeOverlay();
  }
  function editRow(id, forPartner) { openForm(getProfile(id), { forPartner: forPartner, onDone: switcherOpts.onDone }); }
  function openAdd(forPartner) { openForm(null, { forPartner: forPartner, onDone: switcherOpts.onDone }); }

  // ── 등록/수정 폼 팝업 ────────────────────────────────────────────────
  let draft = null;
  function openForm(profile, opts) {
    opts = opts || {};
    draft = profile ? Object.assign({}, profile) : {
      id: null, name: '', relation: '본인', relationDetail: '',
      calendarType: '양력', birthYear: null, birthMonth: null, birthDay: null, isLeapMonth: false,
      birthHour: '-1', gender: '남', solarDate: null,
    };
    draft._forPartner = !!opts.forPartner;
    draft._onSavedRun = opts.onSavedRun || null;
    draft._onDone = opts.onDone || null;
    renderForm();
  }

  function renderForm() {
    const d = draft;
    const dateText = (d.birthYear && d.birthMonth && d.birthDay) ? fmtYmd(d.birthYear, d.birthMonth, d.birthDay) : '';
    const hourText = hourLabel(d.birthHour);
    root().innerHTML = `
      <div class="overlay-backdrop" onclick="Profile._dismissForm()"></div>
      <div class="form-popup">
        <div class="popup-header">
          <span>${d.id ? '사주 수정' : '사주 등록'}</span>
          <button class="overlay-close" onclick="Profile._dismissForm()"><span class="material-symbols-outlined">close</span></button>
        </div>
        <div class="popup-body">
          <div class="field-group">
            <label class="field-label">이름 <i class="req-dot"></i></label>
            <input type="text" class="field-input" id="pfName" placeholder="이름을 입력해주세요" value="${esc(d.name)}" oninput="Profile._draftSet('name', this.value)">
          </div>

          <div class="field-group">
            <label class="field-label">관계 <i class="req-dot"></i></label>
            <div class="chip-row">
              ${RELATIONS.map(r => `<button class="rel-chip ${d.relation===r?'on':''}" onclick="Profile._setRelation('${r}')">${r}</button>`).join('')}
            </div>
            ${d.relation === '지인' ? `
              <input type="text" class="field-input" style="margin-top:8px;" placeholder="관계를 입력해주세요 (예: 직장 동료)"
                value="${esc(d.relationDetail)}" oninput="Profile._draftSet('relationDetail', this.value)">` : ''}
          </div>

          <div class="field-group">
            <label class="field-label">사주 정보</label>
          </div>

          <div class="field-group">
            <label class="field-label">생년월일 <i class="req-dot"></i></label>
            <button class="field-input field-input-btn" onclick="Profile._openCalendar()">${dateText || 'YYYY.MM.DD 선택'}</button>
            <div class="radio-row">
              <label class="radio-option"><input type="radio" name="calendarType" value="양력" ${d.calendarType==='양력'?'checked':''} onchange="Profile._setCalendarType('양력')"> 양력</label>
              <label class="radio-option"><input type="radio" name="calendarType" value="음력" ${d.calendarType==='음력'?'checked':''} onchange="Profile._setCalendarType('음력')"> 음력</label>
            </div>
          </div>

          <div class="field-group">
            <label class="field-label">출생시간</label>
            <button class="field-input field-input-btn" onclick="Profile._openHourList()">${hourText}</button>
          </div>

          <div class="field-group">
            <label class="field-label">성별</label>
            <div class="chip-row two-col">
              <button class="rel-chip wide ${d.gender==='여'?'on':''}" onclick="Profile._setGender('여')">여성</button>
              <button class="rel-chip wide ${d.gender==='남'?'on':''}" onclick="Profile._setGender('남')">남성</button>
            </div>
          </div>
        </div>
        <div class="popup-footer">
          <button class="btn-outline-primary" onclick="Profile._dismissForm()">취소</button>
          <button class="btn-solid-primary" onclick="Profile._save()">저장하기</button>
        </div>
      </div>`;
    document.body.classList.add('overlay-open');
  }

  function draftSet(key, val) { draft[key] = val; }
  function setRelation(r) { draft.relation = r; if (r !== '지인') draft.relationDetail = ''; renderForm(); }
  function setCalendarType(t) { draft.calendarType = t; renderForm(); }
  function setGender(g) { draft.gender = g; renderForm(); }

  // 폼을 저장하지 않고 닫을 때 — 호출자가 돌아갈 화면(onDone)을 지정했으면 그 화면으로 되돌린다.
  function dismissForm() {
    const onDone = draft && draft._onDone;
    draft = null;
    if (onDone) onDone(); else closeOverlay();
  }

  function saveDraft() {
    if (!draft.name || !draft.name.trim()) { alert('이름을 입력해주세요.'); return; }
    if (!draft.birthYear) { alert('생년월일을 선택해주세요.'); return; }
    const solar = resolveSolarDate(draft);
    if (!solar) { alert('생년월일 변환에 실패했습니다. 날짜를 다시 선택해주세요.'); return; }
    draft.solarDate = solar;
    const forPartner = draft._forPartner;
    const onSavedRun = draft._onSavedRun;
    const onDone = draft._onDone;
    delete draft._forPartner;
    delete draft._onSavedRun;
    delete draft._onDone;
    const savedId = upsertProfile(draft);
    if (forPartner) { gunghamPartnerId = savedId; renderGunghamB(getProfile(savedId)); }
    if (onDone) onDone(); else closeOverlay();
    if (onSavedRun === 'saju') runSaju();
    else if (onSavedRun === 'combined') runCombinedWrapped();
  }

  // ── 커스텀 날짜 피커 ─────────────────────────────────────────────────
  let calView = { y: 1990, m: 1 };
  function openCalendar() {
    calView.y = draft.birthYear || 1990;
    calView.m = draft.birthMonth || 1;
    renderCalendar();
  }
  function renderCalendar() {
    const { y, m } = calView;
    const yearOptions = [];
    const nowY = new Date().getFullYear();
    for (let yy = nowY; yy >= 1920; yy--) yearOptions.push(yy);
    const first = new Date(y, m - 1, 1);
    const startWeekday = first.getDay();
    const daysInMonth = new Date(y, m, 0).getDate();
    let cells = '';
    for (let i = 0; i < startWeekday; i++) cells += `<div class="cal-cell empty"></div>`;
    for (let day = 1; day <= daysInMonth; day++) {
      const isSel = draft.birthYear === y && draft.birthMonth === m && draft.birthDay === day;
      cells += `<button class="cal-cell ${isSel ? 'is-selected' : ''}" onclick="Profile._pickDay(${day})">${day}</button>`;
    }
    root().innerHTML = `
      <div class="overlay-backdrop" onclick="Profile._closeSub()"></div>
      <div class="form-popup small">
        <div class="popup-header">
          <span>생년월일 선택 (${esc(draft.calendarType)})</span>
          <button class="overlay-close" onclick="Profile._closeSub()"><span class="material-symbols-outlined">close</span></button>
        </div>
        <div class="popup-body">
          <div class="cal-nav">
            <button class="cal-arrow" onclick="Profile._calNav(-1)"><span class="material-symbols-outlined">chevron_left</span></button>
            <select class="cal-select" onchange="Profile._calSetYear(this.value)">
              ${yearOptions.map(yy => `<option value="${yy}" ${yy===y?'selected':''}>${yy}년</option>`).join('')}
            </select>
            <select class="cal-select" onchange="Profile._calSetMonth(this.value)">
              ${Array.from({length:12},(_,i)=>i+1).map(mm => `<option value="${mm}" ${mm===m?'selected':''}>${mm}월</option>`).join('')}
            </select>
            <button class="cal-arrow" onclick="Profile._calNav(1)"><span class="material-symbols-outlined">chevron_right</span></button>
          </div>
          <div class="cal-weekdays">${['일','월','화','수','목','금','토'].map(w=>`<div>${w}</div>`).join('')}</div>
          <div class="cal-grid">${cells}</div>
          ${draft.calendarType === '음력' ? `
            <label class="leap-check"><input type="checkbox" ${draft.isLeapMonth?'checked':''} onchange="Profile._setLeap(this.checked)"> 윤달입니다</label>
          ` : ''}
        </div>
      </div>`;
    document.body.classList.add('overlay-open');
  }
  function calNav(delta) {
    let { y, m } = calView;
    m += delta;
    if (m < 1) { m = 12; y--; } else if (m > 12) { m = 1; y++; }
    calView = { y, m };
    renderCalendar();
  }
  function calSetYear(v) { calView.y = Number(v); renderCalendar(); }
  function calSetMonth(v) { calView.m = Number(v); renderCalendar(); }
  function setLeap(v) { draft.isLeapMonth = v; }
  function pickDay(day) {
    draft.birthYear = calView.y; draft.birthMonth = calView.m; draft.birthDay = day;
    renderForm();
  }

  // ── 출생시간 선택 리스트 ─────────────────────────────────────────────
  function openHourList() {
    const rows = BIRTH_HOUR_OPTIONS.map(o => `
      <div class="profile-row hour-row ${draft.birthHour===o.value?'is-selected':''}" onclick="Profile._pickHour('${o.value}')">
        <span class="profile-row-check">${draft.birthHour===o.value?'<span class="material-symbols-outlined" style="font-size:16px;color:var(--mint);">check_circle</span>':''}</span>
        <div class="profile-row-body"><div class="profile-row-top"><span class="profile-row-name">${o.label}</span></div>
        ${o.range?`<div class="profile-row-sub">${o.range}</div>`:''}</div>
      </div>`).join('');
    root().innerHTML = `
      <div class="overlay-backdrop" onclick="Profile._closeSub()"></div>
      <div class="bottomsheet">
        <div class="bottomsheet-header"><span>출생시간 선택</span><button class="overlay-close" onclick="Profile._closeSub()"><span class="material-symbols-outlined">close</span></button></div>
        <div class="profile-row-list">${rows}</div>
      </div>`;
    document.body.classList.add('overlay-open');
  }
  function pickHour(v) { draft.birthHour = v; renderForm(); }

  function closeSub() { renderForm(); }

  // ── 궁합 탭 진입 버튼 ────────────────────────────────────────────────
  function runSaju() {
    const rep = getRepresentative();
    if (!rep) { openForm(null, { onSavedRun: 'saju' }); return; }
    applyToContext('saju', rep);
    calcSaju('saju');
  }
  function runCombinedWrapped() {
    const rep = getRepresentative();
    if (!rep) { openForm(null, { onSavedRun: 'combined' }); return; }
    applyToContext('combined', rep);
    runCombined();
  }
  function runGunghamWrapped() {
    const rep = getRepresentative();
    if (!rep) { alert('헤더에서 나의 프로필을 먼저 등록해주세요.'); openForm(null); return; }
    if (!gunghamPartnerId) { alert('상대방 프로필을 선택해주세요.'); return; }
    const partner = getProfile(gunghamPartnerId);
    if (!partner) { alert('상대방 프로필을 다시 선택해주세요.'); return; }
    applyToGunghamA(rep);
    applyToGunghamB(partner);
    runGungham();
  }

  // ── 초기화 ───────────────────────────────────────────────────────────
  function init() {
    renderHeader();
    applyRepresentativeEverywhere();
    renderGunghamB(null);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  // ── 외부 노출 ────────────────────────────────────────────────────────
  // 마이페이지 등 외부 화면이 대표 프로필을 표시할 때 쓰는 요약 정보
  function describeProfile(p) {
    if (!p) return null;
    return {
      name: p.name,
      relation: p.relationDetail || p.relation,
      birth: `${fmtYmd(...String(p.solarDate || '').split('-'))} · ${hourShort(p.birthHour)}`,
    };
  }

  window.Profile = {
    openSwitcher, close: closeOverlay,
    getRepresentative, describe: describeProfile,
    getGunghamPartner: function () { return gunghamPartnerId ? getProfile(gunghamPartnerId) : null; },
    _dismissSwitcher: finishSwitcher, _dismissForm: dismissForm,
    runSaju, runCombined: runCombinedWrapped, runGungham: runGunghamWrapped,
    openPartnerPicker: () => openSwitcher({ forPartner: true }),
    _pickRow: pickRow, _editRow: editRow, _openAdd: openAdd,
    _draftSet: draftSet, _setRelation: setRelation, _setCalendarType: setCalendarType, _setGender: setGender,
    _save: saveDraft, _openCalendar: openCalendar, _closeSub: closeSub,
    _calNav: calNav, _calSetYear: calSetYear, _calSetMonth: calSetMonth, _setLeap: setLeap, _pickDay: pickDay,
    _openHourList: openHourList, _pickHour: pickHour,
    loadFromCloud: loadProfilesFromCloud,
    clearLocal: clearLocalProfiles,
    flushPending: flushPendingSync,
  };
})();
