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
  // 프로필은 계정(uid)별 키에 담는다. 예전에는 계정과 무관한 단일 키를 쓰고 로그아웃 때 그 키를
  // 통째로 지웠는데, 그러면 클라우드 조회가 한 번만 어긋나도 로컬 사본까지 없어서 복구할 길이
  // 사라진다("등록했는데 재로그인하면 프로필이 사라지는" 증상). 계정별로 남겨두면 클라우드가
  // 비어 보여도 이 기기의 사본으로 즉시 복원된다.
  function currentUid() {
    return (window.fbAuth && fbAuth.currentUser) ? fbAuth.currentUser.uid : null;
  }
  function storageKey() {
    const uid = currentUid();
    return uid ? STORAGE_KEY + ':' + uid : STORAGE_KEY; // 비로그인 상태는 기존 키(게스트)를 그대로 쓴다
  }
  function readKey(key) {
    try { return JSON.parse(localStorage.getItem(key)) || []; }
    catch (e) { return []; }
  }
  function loadProfiles() {
    const key = storageKey();
    const list = readKey(key);
    if (list.length || key === STORAGE_KEY) return list;
    // 계정별 키로 나누기 전에 저장된 기존 프로필을 한 번 넘겨받는다(마이그레이션).
    const legacy = readKey(STORAGE_KEY);
    if (legacy.length) {
      console.log('[profile] 기존 프로필을 계정별 저장소로 이관', { count: legacy.length });
      localStorage.setItem(key, JSON.stringify(legacy));
      localStorage.removeItem(STORAGE_KEY);
      return legacy;
    }
    return [];
  }
  function saveProfiles(list) {
    localStorage.setItem(storageKey(), JSON.stringify(list));
    syncProfilesToCloud(list);
  }

  // 클라우드본과 로컬본을 합친다 — 어느 한쪽이 비어 보여도 다른 쪽 내용이 사라지지 않도록.
  // 같은 id면 이 기기에서 방금 만진 로컬본을 우선한다.
  function mergeProfiles(localList, cloudList) {
    const merged = localList.slice();
    const seen = {};
    merged.forEach(function (p) { seen[p.id] = true; });
    (cloudList || []).forEach(function (p) { if (p && !seen[p.id]) { merged.push(p); seen[p.id] = true; } });
    // 대표 프로필은 하나만 남긴다(양쪽에서 각각 지정됐을 수 있다).
    let repSeen = false;
    merged.forEach(function (p) {
      if (!p.isDefault) return;
      if (repSeen) p.isDefault = false; else repSeen = true;
    });
    return merged;
  }

  // ── Firebase 동기화 (로그인 상태일 때만 동작 — 비로그인이면 지금처럼 localStorage에만 남는다) ──
  // 진행 중인 쓰기를 붙잡아 둔다 — 저장 직후 로그아웃하면 signOut()이 아직 전송되지 않은 쓰기를
  // 버려서 "등록한 프로필이 다시 로그인하면 사라지는" 문제가 생긴다(flushPending으로 기다린다).
  let pendingCloudWrite = null;
  // ⚠️ 버그 수정(2026-08-20 사용자 리포트: 인연도감 보관함 이름표가 로그인 직후엔 "나"로 저장되고,
  // 나중에 안 고쳐짐). archive.js의 자가복구 저장(paintOwnerView → Archive.save('gwansang'))은
  // kakao-auth.js가 로그인 확정 직후 곧바로(Profile.loadFromCloud()가 끝나기 전에) 실행되는데,
  // 그 시점엔 대표 프로필이 아직 안 실려 있어 이름표가 "나"로 저장돼버린다. 다른 타입(통합분석 등)은
  // 실제 분석을 끝내야 저장되니 그 사이 프로필이 실릴 시간이 있어서 안 걸리는데, 인연도감만 로그인
  // 즉시 저장되다 보니 매번 걸린다. archive.js가 이름표를 계산하기 전에 이 준비 상태를 기다리도록
  // 외부에 노출한다.
  let profileReadyState = { promise: Promise.resolve(), resolve: function () {} };
  function beginProfileReadyGate() {
    let resolveFn;
    const p = new Promise(function (r) { resolveFn = r; });
    profileReadyState = { promise: p, resolve: resolveFn };
  }
  function whenProfileReady() { return profileReadyState.promise; }
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
    // await 전에 동기적으로 게이트를 걸어둔다 — archive.js가 이 Promise가 도는 동안은 대표
    // 프로필 이름표 계산을 미루도록(whenProfileReady) 세트로 동작한다.
    beginProfileReadyGate();
    try {
      const uid = fbAuth.currentUser.uid;
      // ⚠️ 버그 수정(2026-08-20 사용자 재현·직접 검증 — archive.js와 동일한 조치, 그쪽 주석 참고):
      // 로그인 직후 이 세션의 "첫" Firestore 조회가 가끔 있어야 할 필드가 통째로 빠진 스냅샷을
      // 돌려줬다(토큰을 강제로 새로 받아도 마찬가지). 콘솔에서 같은 조회를 한 번 더 수동으로
      // 실행하면 항상 정상이었어서, 문서는 있는데 profiles·archive 둘 다 없어 보이면 짧게
      // 기다렸다가 한 번 더 조회한다.
      let doc = await fbDb.collection('users').doc(uid).get();
      if (doc.exists && !Array.isArray(doc.data().profiles) && !Array.isArray(doc.data().archive)) {
        console.warn('[profile] 첫 조회가 비어 보임 — 700ms 뒤 한 번 더 조회', { uid: uid });
        await new Promise(function (r) { setTimeout(r, 700); });
        doc = await fbDb.collection('users').doc(uid).get();
      }
      const raw = doc.exists ? doc.data().profiles : undefined;
      const cloudProfiles = Array.isArray(raw) ? raw : [];
      const local = loadProfiles();
      // profiles 필드가 아예 없는 것과 빈 배열인 것을 구분해 찍는다 — 둘은 원인이 다르다.
      console.log('[profile] 클라우드 조회 결과', {
        uid: uid, exists: doc.exists,
        field: raw === undefined ? '없음' : (Array.isArray(raw) ? '배열' : typeof raw),
        cloud: cloudProfiles.length, local: local.length,
      });

      const merged = mergeProfiles(local, cloudProfiles);
      localStorage.setItem(storageKey(), JSON.stringify(merged));
      applyRepresentativeEverywhere();
      renderGunghamB(null);
      // 합친 결과가 클라우드본과 다르면(로컬에만 있던 게 있으면) 올려서 양쪽을 맞춘다.
      // 반대로 합친 결과가 비어 있으면 아무것도 올리지 않는다 — 빈 배열 업로드는 클라우드를
      // 지우는 것과 같아서, 조회가 한 번 어긋난 상황에서 멀쩡한 프로필을 날릴 수 있다.
      if (merged.length && merged.length !== cloudProfiles.length) syncProfilesToCloud(merged);
      else if (!merged.length) console.log('[profile] 클라우드·로컬 모두 비어 있음 — 업로드 생략');
      // 클라우드에 프로필이 있었든 없었든, 로그인 상태가 화면(헤더)에는 반드시 반영돼야 한다 —
      // 이전엔 이 호출이 if 분기 안에만 있어서, 클라우드가 비어있으면 로그인해도 헤더가 "로그인하고
      // 프로필을 등록해주세요"에 머물러 마치 로그인이 안 된 것처럼 보이는 버그가 있었다.
      renderHeader();
    } catch (e) {
      console.error('프로필 클라우드 불러오기 실패', e);
    } finally {
      profileReadyState.resolve();
    }
  }
  // 로그아웃 시 kakao-auth.js가 호출 — 계정에 연결된 프로필이 로그아웃 후 화면에 남지 않게 한다.
  // 계정별 저장소(gwansang_profiles_v1:<uid>)는 지우지 않는다. 로그아웃 상태에서는 loadProfiles()가
  // 게스트 키를 보므로 화면에는 어차피 안 나오고, 사본을 남겨둬야 클라우드 조회가 어긋나도 재로그인
  // 시 복원된다. 이전에는 여기서 통째로 지워서 유실되면 되돌릴 방법이 없었다.
  function clearLocalProfiles() {
    localStorage.removeItem(STORAGE_KEY); // 게스트(비로그인) 사본만 정리
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
    // ⚠️ 버그 수정(2026-08-19): 태어난 시간을 입력해둔 프로필도 궁합보기에서는 계속 "시간 미상"으로
    // 계산됐다 — 여기서 값을 못 채워주고 있었을 뿐, app.js의 runGungham은 진작 이 필드를 읽게 고쳐둠.
    const hourEl = document.getElementById('ggBirthHourA');
    if (hourEl) hourEl.value = profile.birthHour || '-1';
    ggGenderA = profile.gender || '남';
  }
  function applyToGunghamB(profile) {
    if (!profile) return;
    const el = document.getElementById('ggBirthB');
    if (el) el.value = profile.solarDate || '';
    const hourEl = document.getElementById('ggBirthHourB');
    if (hourEl) hourEl.value = profile.birthHour || '-1';
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
    const label = document.getElementById('ggLabelA');
    if (label) label.textContent = rep ? rep.name : '나';
    if (state.gunghamA) state.gunghamA.name = rep ? rep.name : null; // AI 리포트·섹션 제목에서 "나" 대신 실제 이름을 쓰기 위해 보관
    const chip = document.getElementById('ggProfileChipA');
    if (!chip) { syncGgAccordion(); return; }
    if (!rep) { chip.innerHTML = `<span class="mini-profile-empty">헤더에서 프로필을 먼저 등록해주세요</span>`; syncGgAccordion(); return; }
    chip.innerHTML = `
      <span class="mini-profile-body">
        <span class="mini-profile-top">
          <span class="mini-profile-name">${esc(rep.name)}</span>
          <span class="mini-profile-badge">${esc(rep.relationDetail || rep.relation)}</span>
        </span>
        <span class="mini-profile-sub">${esc(fmtYmd(...String(rep.solarDate||'').split('-')))} · ${esc(hourShort(rep.birthHour))}</span>
      </span>`;
    syncGgAccordion();
  }

  let gunghamPartnerId = null;
  function renderGunghamB(profile) {
    const label = document.getElementById('ggLabelB');
    if (label) label.textContent = profile ? profile.name : '상대';
    if (state.gunghamB) state.gunghamB.name = profile ? profile.name : null; // AI 리포트·섹션 제목에서 "상대방" 대신 실제 이름을 쓰기 위해 보관
    const chip = document.getElementById('ggProfileChipB');
    if (!chip) { syncGgAccordion(); return; }
    if (!profile) {
      chip.innerHTML = `<span class="mini-profile-placeholder"><span class="material-symbols-outlined" style="font-size:16px;vertical-align:-3px;">add</span> 상대방 프로필 선택</span>`;
      chip.classList.add('select-mode');
      syncGgAccordion();
      return;
    }
    chip.classList.remove('select-mode');
    chip.innerHTML = `
      <span class="mini-profile-body">
        <span class="mini-profile-top">
          <span class="mini-profile-name">${esc(profile.name)}</span>
          <span class="mini-profile-badge">${esc(profile.relationDetail || profile.relation)}</span>
        </span>
        <span class="mini-profile-sub">${esc(fmtYmd(...String(profile.solarDate||'').split('-')))} · ${esc(hourShort(profile.birthHour))}</span>
      </span>
      <span class="mini-profile-chevron material-symbols-outlined">chevron_right</span>`;
    syncGgAccordion();
  }

  // ── 궁합 탭 나/상대 아코디언 ──────────────────────────────────────────
  // 클릭으로는 언제든 열고 닫을 수 있고(toggleGgAcc), "프로필 확정 + 사진 업로드"가 모두 끝나는
  // 순간에만 자동으로 A를 접고 B를 연다. syncGgAccordion은 프로필·사진이 바뀔 때마다 불려서 완료
  // 여부를 다시 계산하는데, 이미 완료된 상태에서 또 불려도(다른 이유로 재렌더될 때마다) 매번
  // 접어버리면 "클릭해서 다시 열기"가 무의미해지므로, false→true로 "막 완료된" 순간에만 접고/연다.
  const ggOpen = { A: true, B: false };
  const ggWasComplete = { A: false, B: false };
  function setGgAccOpen(who, open) {
    ggOpen[who] = open;
    const block = document.getElementById('ggBlock' + who);
    const icon = document.getElementById('ggAccIcon' + who);
    if (block) block.classList.toggle('is-open', open);
    if (icon) icon.textContent = open ? 'remove' : 'add';
  }
  function toggleGgAcc(who) { setGgAccOpen(who, !ggOpen[who]); }
  function syncGgAccordion() {
    const completeA = !!(getRepresentative() && state.gunghamA && state.gunghamA.file);
    if (completeA && !ggWasComplete.A) { setGgAccOpen('A', false); setGgAccOpen('B', true); }
    ggWasComplete.A = completeA;
    ggWasComplete.B = !!(gunghamPartnerId && state.gunghamB && state.gunghamB.file);
  }

  // ── 오버레이(팝업/바텀시트) 루트 ──────────────────────────────────────
  const root = () => document.getElementById('profileOverlayRoot');
  function closeOverlay() { const r = root(); if (r) r.innerHTML = ''; document.body.classList.remove('overlay-open'); }

  // ── 프로필 전환 바텀시트 ─────────────────────────────────────────────
  // opts.onDone: 선택/취소 후 오버레이를 닫는 대신 실행할 콜백 — 마이페이지처럼
  // "프로필 변경 후 원래 팝업으로 돌아가야" 하는 화면이 자기 화면을 다시 그릴 수 있게 해준다.
  // opts.onPick: 실제로 사주를 "고른" 경우에만 실행되는 콜백(닫기·배경 클릭으로 나가면 실행 안 됨).
  //   onDone과 달리 취소와 선택을 구분해야 하는 호출부(통합분석의 "다른 사람으로 통합분석하기")용.
  // opts.title: 바텀시트 제목 문구(기본 '사주 관리').
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
          <span>${forPartner ? '상대방 프로필 선택' : esc(opts.title || '사주 관리')}</span>
          <button class="overlay-close" onclick="Profile._dismissSwitcher()"><span class="material-symbols-outlined">close</span></button>
        </div>
        <div class="profile-row-list">${rows}</div>
        <button class="btn-solid-primary btn-add" onclick="Profile._openAdd(${forPartner})"><span class="material-symbols-outlined" style="font-size:18px;vertical-align:-4px;">add</span> 사주 추가하기</button>
      </div>`;
    document.body.classList.add('overlay-open');
  }

  function pickRow(id, forPartner) {
    const opts = switcherOpts; // finishSwitcher가 switcherOpts를 비우므로, 재오픈에 쓸 옵션도 먼저 잡아둔다
    const onPick = opts.onPick;
    if (forPartner) {
      // 상대방으로 나(대표 프로필)와 같은 프로필을 고르면 궁합 자체가 성립하지 않으니 막고,
      // 같은 옵션으로 시트를 다시 띄워 재선택하게 한다.
      const rep = getRepresentative();
      if (rep && rep.id === id) {
        alert('상대방은 나와 다른 프로필을 선택해주세요.');
        openSwitcher(opts);
        return;
      }
      gunghamPartnerId = id;
      const p = getProfile(id);
      applyToGunghamB(p);
      renderGunghamB(p);
    } else {
      setRepresentative(id);
    }
    finishSwitcher();
    if (onPick) onPick(id);
  }
  // 선택을 끝냈거나(닫기/배경 클릭 포함) 취소했을 때 — 호출자가 돌아갈 화면을 지정했으면 그 화면으로,
  // 아니면 지금처럼 오버레이를 완전히 닫는다.
  function finishSwitcher() {
    const onDone = switcherOpts.onDone;
    switcherOpts = {};
    if (onDone) onDone(); else closeOverlay();
  }
  // 수정/추가로 넘어갈 때도 onPick을 들고 간다 — 바텀시트에서 "사주 추가하기"로 새 사주를 만든 것도
  // 사용자 입장에선 "그 사주를 고른 것"이라, 저장 후 호출부의 다음 단계로 이어져야 한다.
  function editRow(id, forPartner) { openForm(getProfile(id), { forPartner: forPartner, onDone: switcherOpts.onDone, onPick: switcherOpts.onPick }); }
  function openAdd(forPartner) { openForm(null, { forPartner: forPartner, onDone: switcherOpts.onDone, onPick: switcherOpts.onPick }); }

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
    draft._onPick = opts.onPick || null;
    renderForm();
  }

  // 통합분석·사주보기·궁합보기를 프로필 없이 쓰려다 등록 화면으로 넘어온 경우에만 표시하는
  // 문구 — 어떤 기능이 프로필을 필요로 했는지에 따라 다르게 안내한다(사용자 요청 2026-08-18).
  // openForm의 onSavedRun과 값이 같은 키를 그대로 재사용한다: 이 값이 있다는 것 자체가
  // "저장하고 나서 바로 이 분석을 이어서 실행해야 한다"는 뜻이라, 곧 "게이트를 타고 왔다"는
  // 뜻과 같다. 마이페이지·헤더 등 정상적인 프로필 추가 흐름은 onSavedRun을 안 넘기므로
  // 자연히 문구가 안 뜬다.
  const PROFILE_GATE_NOTICE = {
    combined: '사주를 등록해야 관상과 함께 분석이 가능해요',
    saju: '먼저 사주 등록부터 진행해주세요',
    gungham: '사주를 등록해야 궁합 분석이 가능해요',
  };

  function renderForm() {
    const d = draft;
    const dateText = (d.birthYear && d.birthMonth && d.birthDay) ? fmtYmd(d.birthYear, d.birthMonth, d.birthDay) : '';
    const hourText = hourLabel(d.birthHour);
    const gateNotice = PROFILE_GATE_NOTICE[d._onSavedRun];
    root().innerHTML = `
      <div class="overlay-backdrop" onclick="Profile._dismissForm()"></div>
      <div class="form-popup">
        <div class="popup-header">
          <span>${d.id ? '사주 수정' : '사주 등록'}</span>
          <button class="overlay-close" onclick="Profile._dismissForm()"><span class="material-symbols-outlined">close</span></button>
        </div>
        <div class="popup-body">
          ${gateNotice ? `
          <div class="reassure-box">
            <div class="reassure-head">
              <span class="icon material-symbols-outlined">info</span>
              <span class="label">${esc(gateNotice)}</span>
            </div>
          </div>` : ''}
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
    const onPick = draft._onPick;
    delete draft._forPartner;
    delete draft._onSavedRun;
    delete draft._onDone;
    delete draft._onPick;
    const savedId = upsertProfile(draft);
    if (forPartner) { gunghamPartnerId = savedId; renderGunghamB(getProfile(savedId)); }
    if (onDone) onDone(); else closeOverlay();
    if (onPick && !forPartner) {
      setRepresentative(savedId); // 방금 만든/고친 사주로 분석을 이어가는 흐름이라 대표로 세운다
      onPick(savedId);
    }
    if (onSavedRun === 'saju') runSaju();
    else if (onSavedRun === 'combined') runCombinedWrapped();
    // gungham은 저장만으로 끝나지 않는다(상대 프로필도 필요) — 이어서 부르면 기존 안내
    // ("상대방 프로필을 선택해주세요")로 자연스럽게 이어진다.
    else if (onSavedRun === 'gungham') runGunghamWrapped();
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
  // 냥(포인트) 시스템 — 통합분석·궁합보기는 유료(냥 1개) 상품이다(관상냥반_냥시스템_기획서.md v2.0 §3.2).
  // "확인 → 차감 → 실행" 순서를 반드시 지킨다 — 차감 성공(서버가 확인해준 뒤)에만 실제 분석을 시작한다.
  // 차감 실패 이유가 로그인 필요/잔액 부족 둘 다 있을 수 있어 code로 구분해서 안내 문구를 다르게 보여준다.
  // 차감 전 확인 다이얼로그 — 냥은 유료 재화라 "눌렀더니 그냥 빠져나갔다"가 되면 안 된다.
  // kakao-auth.js의 앱 공용 확인 다이얼로그를 그대로 쓰되(브라우저 기본 confirm은 톤이 안 맞음),
  // 콜백 방식이라 await로 쓰기 편하게 Promise로 감싼다. 취소하면 false → 차감도 분석도 하지 않는다.
  // 보유 냥 / 사용 냥을 함께 보여주는 차감 안내 팝업. 잔액이 모자라면 오른쪽 버튼이 "확인" 대신
  // "냥 구매하기"로 바뀌어 구매 페이지로 넘어간다(사용자 요청 2026-08-16).
  // 반환: 'ok'(진행) | 'cancel'(취소·배경 클릭) | 'buy'(구매 페이지로)
  let pendingSpendResolve = null;
  let spendView = null; // 팝업을 다시 그릴 때 필요한 값 — {title, need, balance, pickProfile}
  function spendDialogRoot() {
    let r = document.getElementById('nyangSpendRoot');
    if (!r) { r = document.createElement('div'); r.id = 'nyangSpendRoot'; document.body.appendChild(r); }
    return r;
  }
  function closeSpendDialog(result) {
    spendView = null;
    spendDialogRoot().innerHTML = '';
    if (!document.querySelector('.confirm-dialog, .bottomsheet')) document.body.classList.remove('overlay-open');
    const fn = pendingSpendResolve;
    pendingSpendResolve = null;
    if (fn) fn(result);
  }
  // 분석 대상 사주를 한 번 더 확인시키는 줄 — 사주가 여러 개면 대표 사주가 무엇인지 모른 채
  // 확인을 눌러 엉뚱한 사람으로 분석되는 일이 생긴다(사용자 요청 2026-08-18). 여기서 바로 바꿀 수 있다.
  function spendProfileRowHtml() {
    const d = describeProfile(getRepresentative());
    if (!d) return '';
    return '<p class="nyang-dialog-profile-label">분석할 사주</p>' +
      '<button type="button" class="nyang-dialog-profile" onclick="Profile._changeSpendProfile()">' +
        '<span class="np-body">' +
          '<span class="np-top">' +
            '<span class="np-name">' + esc(d.name) + '</span>' +
            '<span class="np-badge">' + esc(d.relation) + '</span>' +
          '</span>' +
          '<span class="np-sub">' + esc(d.birth) + '</span>' +
        '</span>' +
        '<span class="material-symbols-outlined np-arrow">chevron_right</span>' +
      '</button>' +
      '<p class="nyang-dialog-profile-hint">이 사주로 분석해요. 다른 사주라면 눌러서 바꿔주세요.</p>';
  }

  // 팝업을 그린다(사주를 바꾼 뒤 다시 그릴 때도 이 함수를 쓴다 — 대기 중인 Promise는 그대로 유지).
  function renderSpendDialog() {
    const v = spendView;
    if (!v) return;
    const enough = v.balance >= v.need;
    spendDialogRoot().innerHTML =
      '<div class="overlay-backdrop confirm-backdrop" onclick="Profile._closeSpend(\'cancel\')"></div>' +
      '<div class="nyang-dialog" role="alertdialog">' +
        '<p class="nyang-dialog-title">' + v.title + '</p>' +
        '<p class="nyang-dialog-sub">' + v.need + '냥이 사용됩니다</p>' +
        (v.pickProfile ? spendProfileRowHtml() : '') +
        '<div class="nyang-count-box">' +
          '<div class="nyang-count"><span class="nyang-count-label">보유 냥</span>' +
            '<span class="nyang-count-num' + (enough ? '' : ' is-short') + '">' + v.balance + '</span></div>' +
          '<div class="nyang-count"><span class="nyang-count-label">사용 냥</span>' +
            '<span class="nyang-count-num is-use">' + v.need + '</span></div>' +
        '</div>' +
        (enough ? '' : '<p class="nyang-dialog-short">냥이 부족해요 — 구매 후 이용해주세요.</p>') +
        '<div class="confirm-actions">' +
          '<button class="btn-outline-primary" onclick="Profile._closeSpend(\'cancel\')">취소</button>' +
          (enough
            ? '<button class="btn-solid-primary" onclick="Profile._closeSpend(\'ok\')">확인</button>'
            : '<button class="btn-solid-primary" onclick="Profile._closeSpend(\'buy\')">냥 구매하기</button>') +
        '</div>' +
      '</div>';
    document.body.classList.add('overlay-open');
  }

  // 팝업의 "분석할 사주"를 누른 경우 — 차감은 일어나지 않는다. 사주 선택 시트가 팝업(z-index 103)보다
  // 아래층(101)이라 겹쳐 띄우면 시트가 가려지므로, 고르는 동안만 팝업을 감췄다가 끝나면 다시 그린다.
  // 대기 중인 Promise(pendingSpendResolve)는 건드리지 않으므로 흐름은 그대로 이어진다.
  function changeSpendProfile() {
    if (!spendView) return;
    spendDialogRoot().innerHTML = '';
    openSwitcher({
      title: '분석할 사주 선택',
      onDone: function () { closeOverlay(); renderSpendDialog(); },
      onPick: function () { renderSpendDialog(); }, // 새로 추가한 사주가 대표로 잡히게 하는 역할도 겸한다
    });
  }

  // opts.pickProfile: 팝업 안에서 분석 대상 사주를 보여주고 바꿀 수 있게 한다(통합분석 전용).
  function confirmSpend(title, need, opts) {
    return new Promise(async resolve => {
      // 잔액은 팝업을 띄우기 전에 서버에서 새로 받아온다 — 캐시만 믿으면 다른 기기에서 쓴 뒤
      // "보유 1냥"이라고 잘못 안내하고 확인을 누르게 만들 수 있다.
      const balance = window.Wallet ? await Wallet.fetchBalance() : null;
      if (balance == null) { // 비로그인(지갑 자체가 없음) — 차감 안내 대신 로그인부터
        alert('로그인 후 이용할 수 있어요.');
        if (window.KakaoAuth) KakaoAuth.openLoginPopup();
        resolve('cancel');
        return;
      }
      pendingSpendResolve = resolve;
      spendView = { title: title, need: need, balance: balance, pickProfile: !!(opts && opts.pickProfile) };
      renderSpendDialog();
    });
  }
  // 팝업 결과 처리 — 'buy'면 구매 페이지로 보내고, 진행 여부(boolean)만 호출부에 돌려준다.
  async function askSpend(title, need, opts) {
    const r = await confirmSpend(title, need, opts);
    if (r === 'buy' && window.NyangShop) NyangShop.open();
    return r === 'ok';
  }

  // 토스트 — 차감이 끝난 직후 "구매되었습니다"를 알려주는 용도. 확인 버튼이 필요 없는 통보라
  // 다이얼로그가 아니라 잠깐 떴다 사라지는 형태로 띄운다(분석이 바로 이어서 시작되므로 흐름을 막으면 안 됨).
  let toastTimer = null;
  function showToast(message) {
    let el = document.getElementById('appToast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'appToast';
      el.className = 'app-toast';
      document.body.appendChild(el);
    }
    el.textContent = message;
    el.classList.add('is-on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('is-on'), 2200);
  }

  async function chargeNyangOrAlert(feature) {
    if (!window.Wallet) return true; // wallet.js 로딩 실패 등 — 있을 수 없는 상황이라 막지 않고 통과
    const result = await Wallet.spend(feature);
    if (result.ok) {
      showToast(result.skipped ? '분석을 시작합니다.' : '구매되었습니다.');
      return true;
    }
    if (result.code === 'LOGIN_REQUIRED') {
      alert('로그인 후 이용할 수 있어요.');
      if (window.KakaoAuth) KakaoAuth.openLoginPopup();
    } else if (result.code === 'INSUFFICIENT_BALANCE') {
      alert('냥이 부족해요 — 구매 후 이용해주세요.\n(냥 구매 기능은 준비 중이에요.)');
    } else {
      alert(result.error || '냥 차감에 실패했어요. 잠시 후 다시 시도해주세요.');
    }
    return false;
  }

  // 분석 요청이 왕복하는 동안 "분석하기"를 다시 누르면 그 횟수만큼 냥이 차감된다(기획서 §1 동시성 —
  // 서버 트랜잭션은 각 요청을 정확히 처리할 뿐, "같은 사람이 연타했다"는 건 막아주지 않는다).
  // 그래서 클라이언트에서 진행 중 플래그로 재진입을 막고 버튼도 같이 비활성화한다.
  let analysisInFlight = false;
  // 버튼 라벨이 탭마다 다르므로(통합분석 "분석하기" / 궁합 "궁합 분석하기") 원래 문구를 기억했다가
  // 되돌린다 — 하드코딩하면 궁합 버튼이 "분석하기"로 바뀌어 버린다.
  function setCtaBusy(dockId, busy) {
    const btn = document.querySelector('#' + dockId + ' .submit-btn');
    if (!btn) return;
    if (busy && !btn.dataset.label) btn.dataset.label = btn.textContent;
    btn.disabled = busy;
    btn.textContent = busy ? '분석 중...' : (btn.dataset.label || btn.textContent);
  }

  async function runCombinedWrapped() {
    if (analysisInFlight) return;
    const rep = getRepresentative();
    if (!rep) { openForm(null, { onSavedRun: 'combined' }); return; }

    // 차감보다 먼저 입력값을 채우고 검증한다 — 예전엔 차감 뒤에 applyToContext를 해서, 프로필에
    // 생년월일이 비어 있으면 runCombined가 "생년월일을 입력해주세요"로 바로 빠져나가면서 냥만 사라졌다.
    applyToContext('combined', rep);
    if (!document.getElementById('cmbBirthDate').value) { alert('생년월일을 입력해주세요.'); return; }

    // 확인 다이얼로그는 눌린 직후 바로 띄운다(얼굴 인식 스피너보다 먼저) — 사용자 입장에선
    // "분석하기를 눌렀다 → 차감 안내가 떴다 → 확인했다 → 시작됐다"로 읽혀야 자연스럽다.
    // inFlight는 다이얼로그가 떠 있는 동안에도 걸어둬 다이얼로그가 두 개 겹치는 걸 막는다.
    analysisInFlight = true;
    try {
      // 팝업에서 분석 대상 사주를 확인하고 바꿀 수 있다 — 실제 차감은 "확인"을 누른 뒤부터다.
      if (!(await askSpend('통합분석을 시작할까요?', 1, { pickProfile: true }))) return;
      // 팝업 안에서 사주를 바꿨을 수 있으니, 확인을 누른 시점의 대표 사주로 값을 다시 채운다.
      const target = getRepresentative();
      applyToContext('combined', target);
      if (!document.getElementById('cmbBirthDate').value) { alert('생년월일을 입력해주세요.'); return; }
      setCtaBusy('cmbCtaDock', true);
      // 사진이 있으면 얼굴 인식까지 성공시켜 놓고 차감한다. 인식 실패(정면 아님·흐림 등)는 실제로 자주
      // 나는데, 차감을 먼저 하면 결과는 사주만 나오고 냥은 그대로 빠진다 — 환불(refund)은 기획서 §6
      // 향후 스코프라, 지금은 "차감 전에 실패할 수 있는 걸 미리 확인"하는 쪽으로 막는다(§3.2 확인→차감→실행).
      let lm = null;
      if (state.combined.file) {
        lm = await runFaceAnalysis('combined');
        if (!lm) return; // 실패 안내는 runFaceAnalysis가 이미 화면에 띄움 — 냥 차감 없이 종료
      }
      if (!(await chargeNyangOrAlert('combined'))) return;
      await runCombined(lm); // 위에서 인식한 결과를 넘겨 MediaPipe를 두 번 돌리지 않는다
    } finally {
      analysisInFlight = false;
      setCtaBusy('cmbCtaDock', false);
    }
  }
  async function runGunghamWrapped() {
    if (analysisInFlight) return;
    const rep = getRepresentative();
    if (!rep) { openForm(null, { onSavedRun: 'gungham' }); return; }
    if (!gunghamPartnerId) { alert('상대방 프로필을 선택해주세요.'); return; }
    const partner = getProfile(gunghamPartnerId);
    if (!partner) { alert('상대방 프로필을 다시 선택해주세요.'); return; }

    analysisInFlight = true;
    try {
      if (!(await askSpend('궁합 분석을 시작할까요?', 1))) return;
      setCtaBusy('ggCtaDock', true);
      if (!(await chargeNyangOrAlert('gungham'))) return;
      applyToGunghamA(rep);
      applyToGunghamB(partner);
      await runGungham();
    } finally {
      analysisInFlight = false;
      setCtaBusy('ggCtaDock', false);
    }
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
    getRepresentative, describe: describeProfile, hourShort,
    getGunghamPartner: function () { return gunghamPartnerId ? getProfile(gunghamPartnerId) : null; },
    _dismissSwitcher: finishSwitcher, _dismissForm: dismissForm,
    _closeSpend: closeSpendDialog, _changeSpendProfile: changeSpendProfile,
    runSaju, runCombined: runCombinedWrapped, runGungham: runGunghamWrapped,
    openPartnerPicker: (opts) => openSwitcher(Object.assign({}, opts, { forPartner: true })),
    toggleGgAcc, syncGgAccordion,
    _pickRow: pickRow, _editRow: editRow, _openAdd: openAdd,
    _draftSet: draftSet, _setRelation: setRelation, _setCalendarType: setCalendarType, _setGender: setGender,
    _save: saveDraft, _openCalendar: openCalendar, _closeSub: closeSub,
    _calNav: calNav, _calSetYear: calSetYear, _calSetMonth: calSetMonth, _setLeap: setLeap, _pickDay: pickDay,
    _openHourList: openHourList, _pickHour: pickHour,
    loadFromCloud: loadProfilesFromCloud,
    clearLocal: clearLocalProfiles,
    flushPending: flushPendingSync,
    ready: whenProfileReady,
  };
})();
