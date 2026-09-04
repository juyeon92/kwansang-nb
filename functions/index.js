// 프론트(js/kakao-auth.js)에서 카카오 액세스 토큰을 받아 카카오 서버에 직접 검증 요청한 뒤,
// 검증된 카카오 사용자 ID를 기반으로 Firebase 커스텀 토큰을 발급한다.
// Firebase Admin SDK로만 커스텀 토큰을 만들 수 있어(서버 전용 비밀키 필요) 이 단계는 클라이언트에서 할 수 없다.
const { onRequest } = require('firebase-functions/v2/https');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { defineSecret } = require('firebase-functions/params');
const admin = require('firebase-admin');
const { computeCharacterResult } = require('./engine/character-engine');
const { classifyCompatibility, compatScore } = require('./engine/compatibility-engine');
const archetypeDb = require('./engine/archetype-db');
const characterDb = require('./engine/character-db');

admin.initializeApp();
const db = admin.firestore();

// Gemini API 키는 소스코드/클라이언트에 절대 넣지 않고 Firebase Secret Manager에만 저장한다.
// 무료 키 여러 개를 콤마로 이어붙여 등록해두면, 한 키가 할당량을 초과했을 때 다음 키로 자동 전환된다.
// 값 설정: firebase functions:secrets:set GEMINI_API_KEYS  (예: key1,key2,key3)
const geminiApiKeys = defineSecret('GEMINI_API_KEYS');

// 서비스 커스텀 도메인 — 카카오톡 등에 공유됐을 때 미리보기 카드가 실제로 이동시킬 주소의 기준이 된다.
const SITE_URL = 'https://kwansang-nb.com';

// ═══ 인연도감 공유 미리보기 (2026-09-04) ═══
// index.html은 정적 SPA라 <meta og:*> 태그가 고정돼 있어서, 누가 공유하든 카카오톡 미리보기가 항상
// "관상냥반"이라는 똑같은 제목으로만 떴다(사용자 리포트: "다른 서비스는 공유자 이름이 같이 나가는데
// 우리는 그냥 관상냥반이라고만 나간다"). 카카오톡의 링크 미리보기 크롤러는 자바스크립트를 실행하지
// 않고 응답 HTML의 <meta> 태그만 그대로 읽기 때문에, 클라이언트 스크립트로 제목을 바꾸는 방식으론
// 원천적으로 해결이 안 된다 — 사람마다 다른 og 태그를 내려주는 서버 응답이 별도로 있어야 한다.
//
// 그래서 공유 링크 자체를 이 함수 주소로 바꾼다. 이 함수는 slug로 dogam 문서를 찾아 그 사람의
// ownerName·ownerCharacterId로 og:title/og:description/og:image를 채운 HTML을 돌려주고,
// 실제 사람이 그 링크를 클릭하면(크롤러가 아니라) 곧바로 진짜 서비스 페이지(index.html?dogam=slug)로
// 넘겨준다(meta refresh + JS redirect 이중 처리 — 리다이렉트를 안 따라가는 크롤러도 있어서 meta 태그는
// 항상 정확한 값으로 응답 본문에 있어야 한다).
// ownerName은 js/inyeon-dogam.js share()가 이미 "로그인이면 대표 프로필 이름, 비로그인이면 공유
// 시점에 물어보는 닉네임"으로 정확히 채워서 저장해둔 값이라(dogam.ownerName), 이 함수는 그 값을
// 그대로 읽기만 하면 된다 — 이름을 결정하는 로직 자체는 새로 만들 필요가 없었다.
exports.dogamSharePreview = onRequest({ cors: true }, async (req, res) => {
  const slug = (req.query && req.query.slug) || '';
  const redirectUrl = slug ? `${SITE_URL}/?dogam=${encodeURIComponent(slug)}` : SITE_URL;

  let ownerName = '';
  let ownerCharacterId = '';
  if (slug) {
    try {
      const snap = await db.collection('dogam').doc(slug).get();
      if (snap.exists) {
        ownerName = snap.data().ownerName || '';
        ownerCharacterId = snap.data().ownerCharacterId || '';
      }
    } catch (e) {
      console.error('[dogamSharePreview] 조회 실패', e);
    }
  }

  const title = ownerName ? `${ownerName}님의 인연도감` : '관상냥반 인연도감';
  const description = '내 사진 한 장으로 나만의 관상 캐릭터를 만나보세요. 인연도감에서 나와 주변 사람들의 인연도 확인할 수 있어요.';
  // 캐릭터 일러스트가 있으면 그 사람 전용 이미지로, 없으면 기본 로고로 — images/{characterId}.png는
  // character-db.js의 16개 캐릭터 ID와 1:1로 이미 존재하는 파일들이다.
  const image = `${SITE_URL}/images/${ownerCharacterId ? encodeURIComponent(ownerCharacterId) : 'Logo'}.png`;

  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  res.set('Content-Type', 'text/html; charset=utf-8');
  res.send(`<!DOCTYPE html>
<html lang="ko"><head>
<meta charset="utf-8">
<title>${esc(title)}</title>
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:image" content="${esc(image)}">
<meta property="og:url" content="${esc(redirectUrl)}">
<meta name="twitter:card" content="summary_large_image">
<meta http-equiv="refresh" content="0; url=${esc(redirectUrl)}">
<script>location.replace(${JSON.stringify(redirectUrl)});</script>
</head><body>이동 중이에요...</body></html>`);
});

exports.kakaoLogin = onRequest({ cors: true }, async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'POST만 허용됩니다.' });
    return;
  }

  const kakaoAccessToken = req.body && req.body.kakaoAccessToken;
  if (!kakaoAccessToken) {
    res.status(400).json({ error: 'kakaoAccessToken이 필요합니다.' });
    return;
  }

  try {
    const kakaoRes = await fetch('https://kapi.kakao.com/v2/user/me', {
      headers: { Authorization: `Bearer ${kakaoAccessToken}` },
    });
    const kakaoUser = await kakaoRes.json();
    if (!kakaoUser || !kakaoUser.id) {
      res.status(401).json({ error: '카카오 토큰 검증 실패', detail: kakaoUser });
      return;
    }

    // Firebase uid는 콜론(:)을 못 쓰므로 언더스코어로 구분한다.
    const uid = `kakao_${kakaoUser.id}`;

    // settleDogamForUid(아래)가 "이 계정이 로그인 시도 전부터 이미 갖고 있던 도감"과 "이번 로그인이
    // 만들어낸 도감"을 구분해야 해서, ensureUserAndWallet/migrateAnonymousData가 건드리기 전의
    // dogamSlug를 미리 찍어둔다. 계정이 아예 처음이면(문서 없음) preExistingDogamSlug는 null이고,
    // 그 경우 "최초 로그인 시점" 규칙이 적용된다.
    const preSnap = await db.collection('users').doc(uid).get();
    const preExistingDogamSlug = (preSnap.exists && preSnap.data().dogamSlug) || null;

    // 냥 시스템 기획서 §3.1 — "User 생성"과 "Wallet 생성"은 반드시 하나의 트랜잭션으로 묶여야 한다.
    // 여기가 사실상의 회원가입 지점(카카오 로그인 최초 성공 = 가입)이라 이 자리에서 함께 만든다.
    await ensureUserAndWallet(uid, kakaoUser);

    // 비로그인(익명) 상태에서 만든 인연도감·참여 기록을 이 계정으로 옮긴다.
    // 클라이언트가 익명 세션의 ID 토큰을 함께 보내면, 서버가 그 토큰을 검증해 "정말 그 익명 사용자
    // 본인"임을 확인한 뒤에만 옮긴다 — 남의 uid를 적어 보내 데이터를 가로챌 수 없다.
    // 보안 규칙으로는 불가능한 작업이라(새 계정이 옛 uid 소유 문서를 수정하는 꼴) Admin SDK로 처리한다.
    const anonIdToken = req.body && req.body.anonIdToken;
    let migrated = null;
    if (anonIdToken) {
      try {
        const anon = await admin.auth().verifyIdToken(anonIdToken);
        if (anon.uid && anon.uid !== uid) migrated = await migrateAnonymousData(anon.uid, uid);
      } catch (e) {
        // 이관 실패가 로그인 자체를 막아선 안 된다 — 로그인은 그대로 진행하고 로그만 남긴다.
        console.error('[kakaoLogin] 익명 데이터 이관 실패', e);
      }
    }

    // 사용자 정책(2026-08-31 확정): "참여 인원이 많은 쪽"이 아니라, 이 계정이 **최초로 로그인을
    // 시도하던 시점에 갖고 있던 도감**이 그 계정의 도감으로 영구 고정된다. migrateAnonymousData가
    // 계정에 이미 도감이 있는지 확인 없이 dogamSlug를 매번 덮어써서, 비로그인↔로그인을 반복
    // 테스트하면 계정 밑에 도감이 여러 개 쌓이는 사고가 있었다(settleDogamForUid 주석 참고).
    // 익명 이관 여부와 무관하게 매 로그인마다 검사한다 — 이미 중복이 쌓인 기존 계정도 다음
    // 로그인에서 저절로 정리된다.
    let settled = null;
    try { settled = await settleDogamForUid(uid, preExistingDogamSlug); }
    catch (e) { console.error('[kakaoLogin] 도감 중복 정리 실패', e); }

    const customToken = await admin.auth().createCustomToken(uid);
    // dogamConflicts: 캐릭터가 서로 달라 자동 병합하지 못하고 그대로 남겨둔 도감 목록 — 클라이언트가
    // "어느 걸 대표로 둘까요?" 선택 UI를 띄우는 신호로 쓴다(settleDogamForUid 주석 참고).
    const dogamConflicts = (settled && settled.conflicts && settled.conflicts.length) ? settled.conflicts : undefined;
    const dogamMerged = (settled && settled.merged) ? settled.merged : undefined;
    res.json({ customToken, migrated, dogamConflicts, dogamMerged });
  } catch (e) {
    console.error('kakaoLogin 처리 실패', e);
    res.status(500).json({ error: e.message });
  }
});

// User 문서(없으면 생성)와 Wallet(balance=0, 없으면 생성)을 한 트랜잭션으로 묶는다 — 가입 시 자동
// 지급 로직은 없음(기획서 v2.0 §3.1, v1.0의 "가입 시 1냥 지급" 완전 제거). 이미 있는 사용자는 그대로 둔다
// (merge 없이 exists 체크 후 없을 때만 생성 — 기존 프로필/닉네임 등 필드를 덮어쓰지 않기 위함).
//
// kakaoUser: 카카오 /v2/user/me 응답. 식별 정보를 여기(서버)에서 함께 저장한다 — 예전엔 uid만 만들고
// 닉네임·이메일은 클라이언트(kakao-auth.js backupAccountToCloud)가 로그인 후에 따로 올리는 구조라,
// 그 호출이 실패하거나 동의를 안 받으면 users 문서에 식별 정보가 아예 안 남아 관리자 화면에서
// "누구인지 구분이 안 되는" 상태가 됐다. 서버는 이미 카카오 응답을 손에 쥐고 있으므로 여기서 남기는 게 확실하다.
// kakaoUserId는 카카오가 보장하는 고유 회원번호라, 닉네임이 겹치거나 이메일 동의를 못 받아도 유일 식별자가 된다.
// ⚠️ 개인정보라 필요한 최소 항목(회원번호·닉네임·이메일)만 저장하고, 기존 값은 덮어쓰되 프로필 등
// 다른 필드는 건드리지 않도록 merge로 쓴다.
async function ensureUserAndWallet(uid, kakaoUser) {
  const userRef = db.collection('users').doc(uid);
  const walletRef = db.collection('wallets').doc(uid);
  const acc = (kakaoUser && kakaoUser.kakao_account) || {};
  // 닉네임은 kakao_account.profile.nickname 또는 properties.nickname 중 한쪽에만 오는 경우가 있다
  // (동의항목 구성에 따라 다름) — 한 자리만 보면 닉네임이 있는데도 못 찾는다.
  const nickname = (acc.profile && acc.profile.nickname) || (kakaoUser && kakaoUser.properties && kakaoUser.properties.nickname) || '';
  const email = acc.email || '';
  // 어떤 항목이 실제로 내려왔는지 진단용 — 값이 아니라 존재 여부만 남긴다(개인정보를 로그에 남기지 않음).
  console.log('[kakaoLogin] 카카오 응답 항목', {
    profileNickname: !!(acc.profile && acc.profile.nickname),
    propertiesNickname: !!(kakaoUser && kakaoUser.properties && kakaoUser.properties.nickname),
    email: !!acc.email,
  });
  await db.runTransaction(async (tx) => {
    const [userSnap, walletSnap] = await Promise.all([tx.get(userRef), tx.get(walletRef)]);
    const profile = { kakaoUserId: kakaoUser ? String(kakaoUser.id) : '', lastLoginAt: admin.firestore.FieldValue.serverTimestamp() };
    // 카카오가 안 내려준 항목으로 기존 값을 빈 문자열로 덮어쓰지 않도록 있을 때만 넣는다.
    if (nickname) profile.kakaoNickname = nickname;
    if (email) profile.kakaoAccount = email;
    if (!userSnap.exists) profile.createdAt = admin.firestore.FieldValue.serverTimestamp();
    tx.set(userRef, profile, { merge: true });
    if (!walletSnap.exists) {
      tx.set(walletRef, { balance: 0, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
    }
  });
}

function getBearerToken(req) {
  const m = /^Bearer (.+)$/.exec(req.get('Authorization') || '');
  return m ? m[1] : null;
}

// roles/{uid} 문서가 있고 role === 'admin'이어야 관리자 — users/{uid}에 role을 뒀다면 클라이언트가
// 자기 문서를 자유롭게 쓸 수 있는 규칙 때문에 스스로 admin을 자칭할 수 있어 별도 컬렉션으로 분리했다
// (firestore.rules 참고). 이 문서는 Firebase 콘솔에서 수동으로만 만든다(이번 스코프엔 지정 UI 없음).
async function isAdmin(uid) {
  const snap = await db.collection('roles').doc(uid).get();
  return snap.exists && snap.data().role === 'admin';
}

// ═══ 카카오페이 결제 연동 (2026-09-03) ═══
// 단건결제(카카오 디벨로퍼스 REST API, kapi.kakao.com) 방식 — ready에서 결제를 준비하고 tid를 받아
// kakaoPayOrders에 저장해두면, 사용자가 카카오페이 결제창에서 승인한 뒤 우리 사이트로 돌아왔을 때
// approve가 그 tid로 최종 승인을 확정하고 냥을 지급한다. 결제 승인은 반드시 서버(Admin SDK)에서만
// 하고, 클라이언트가 "결제됐다"고 주장하는 값만으로는 냥을 주지 않는다(위조 방지).
//
// ⚠️ CID(가맹점 코드)는 아직 카카오페이 가맹점 심사를 신청하기 전이라 카카오가 공식 제공하는
// 테스트 코드(TC0ONETIME)를 쓴다 — 실제 결제 없이 카카오페이 결제창 흐름 전체를 테스트할 수 있다.
// 가맹점 승인을 받으면 카카오페이 비즈니스 파트너센터에서 발급되는 실제 CID로 이 값만 바꾸면 된다.
// ADMIN_KEY는 카카오 디벨로퍼스 앱 설정 → 앱 키 → Admin 키(REST API 키와 다름, 절대 노출 금지)이며,
// 값 설정: firebase functions:secrets:set KAKAO_ADMIN_KEY
const kakaoAdminKey = defineSecret('KAKAO_ADMIN_KEY');
const KAKAO_PAY_CID = 'TC0ONETIME';
// 서비스 커스텀 도메인(2026-09-03부터 kwansang-nb.com — 카카오 로그인 플랫폼 등록 도메인과도
// 일치해야 함) — 결제 승인/취소/실패 후 카카오페이가 사용자를 돌려보낼 주소의 기준이 된다.
const NYANG_SHOP_SITE_URL = 'https://kwansang-nb.com';
// js/nyang-shop.js의 PRODUCTS와 반드시 같은 값을 유지해야 한다(가격 위조 방지를 위해 서버가 최종
// 가격을 여기서 다시 결정하고, 클라이언트는 productId만 보낸다).
const NYANG_PRODUCTS = { nyang1: { name: '냥 1개', amount: 1, price: 990 } };

exports.kakaoPayReady = onRequest({ cors: true, secrets: [kakaoAdminKey] }, async (req, res) => {
  if (req.method !== 'POST') { res.status(405).json({ error: 'POST만 허용됩니다.' }); return; }
  const idToken = getBearerToken(req);
  if (!idToken) { res.status(401).json({ error: '로그인이 필요합니다.' }); return; }
  let uid;
  try { uid = (await admin.auth().verifyIdToken(idToken)).uid; }
  catch (e) { res.status(401).json({ error: '인증 토큰이 유효하지 않습니다.' }); return; }

  const productId = (req.body && req.body.productId) || '';
  const product = NYANG_PRODUCTS[productId];
  if (!product) { res.status(400).json({ error: '존재하지 않는 상품입니다.' }); return; }

  const orderRef = db.collection('kakaoPayOrders').doc();
  try {
    const params = new URLSearchParams({
      cid: KAKAO_PAY_CID,
      partner_order_id: orderRef.id,
      partner_user_id: uid,
      item_name: product.name,
      quantity: '1',
      total_amount: String(product.price),
      tax_free_amount: '0',
      approval_url: `${NYANG_SHOP_SITE_URL}/?kakaopay=success&orderId=${orderRef.id}`,
      cancel_url: `${NYANG_SHOP_SITE_URL}/?kakaopay=cancel`,
      fail_url: `${NYANG_SHOP_SITE_URL}/?kakaopay=fail`,
    });
    const kakaoRes = await fetch('https://kapi.kakao.com/v1/payment/ready', {
      method: 'POST',
      headers: { Authorization: `KakaoAK ${kakaoAdminKey.value()}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params,
    });
    const data = await kakaoRes.json();
    if (!kakaoRes.ok || !data.tid) {
      console.error('[kakaoPayReady] 결제 준비 실패', data);
      res.status(502).json({ error: '결제 준비에 실패했어요.', detail: data });
      return;
    }
    await orderRef.set({
      uid, productId, amount: product.amount, price: product.price,
      tid: data.tid, status: 'ready', createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    res.json({
      ok: true, orderId: orderRef.id,
      next_redirect_pc_url: data.next_redirect_pc_url,
      next_redirect_mobile_web_url: data.next_redirect_mobile_web_url,
    });
  } catch (e) {
    console.error('kakaoPayReady 실패', e);
    res.status(500).json({ error: e.message });
  }
});

exports.kakaoPayApprove = onRequest({ cors: true, secrets: [kakaoAdminKey] }, async (req, res) => {
  if (req.method !== 'POST') { res.status(405).json({ error: 'POST만 허용됩니다.' }); return; }
  const idToken = getBearerToken(req);
  if (!idToken) { res.status(401).json({ error: '로그인이 필요합니다.' }); return; }
  let uid;
  try { uid = (await admin.auth().verifyIdToken(idToken)).uid; }
  catch (e) { res.status(401).json({ error: '인증 토큰이 유효하지 않습니다.' }); return; }

  const orderId = (req.body && req.body.orderId) || '';
  const pgToken = (req.body && req.body.pgToken) || '';
  if (!orderId || !pgToken) { res.status(400).json({ error: 'orderId, pgToken이 필요합니다.' }); return; }

  const orderRef = db.collection('kakaoPayOrders').doc(orderId);
  try {
    const orderSnap = await orderRef.get();
    if (!orderSnap.exists) { res.status(404).json({ error: '주문을 찾을 수 없어요.' }); return; }
    const order = orderSnap.data();
    if (order.uid !== uid) { res.status(403).json({ error: '본인 주문만 승인할 수 있어요.' }); return; }
    // 새로고침 등으로 승인 요청이 중복 도착해도 냥을 두 번 주지 않도록 먼저 상태를 확인한다
    // (아래 트랜잭션 안에서 한 번 더 확인 — 동시 요청까지 막는 최종 방어선).
    if (order.status === 'completed') {
      const wDoc = await db.collection('wallets').doc(uid).get();
      res.json({ ok: true, balance: wDoc.exists ? (wDoc.data().balance || 0) : 0, alreadyCompleted: true });
      return;
    }

    const params = new URLSearchParams({
      cid: KAKAO_PAY_CID, tid: order.tid, partner_order_id: orderId, partner_user_id: uid, pg_token: pgToken,
    });
    const kakaoRes = await fetch('https://kapi.kakao.com/v1/payment/approve', {
      method: 'POST',
      headers: { Authorization: `KakaoAK ${kakaoAdminKey.value()}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params,
    });
    const data = await kakaoRes.json();
    if (!kakaoRes.ok) {
      console.error('[kakaoPayApprove] 승인 실패', data);
      res.status(502).json({ error: '결제 승인에 실패했어요.', detail: data });
      return;
    }

    const walletRef = db.collection('wallets').doc(uid);
    const ledgerRef = db.collection('nyangLedger').doc();
    const balance = await db.runTransaction(async (tx) => {
      const orderNow = (await tx.get(orderRef)).data();
      if (orderNow.status === 'completed') return null; // 트랜잭션 안에서 재확인(동시 요청 최종 방어)
      const snap = await tx.get(walletRef);
      const current = snap.exists ? (snap.data().balance || 0) : 0;
      const next = current + order.amount;
      tx.set(walletRef, { balance: next, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
      tx.set(ledgerRef, {
        userId: uid, type: 'purchase', amount: order.amount, balanceAfter: next,
        relatedId: orderId, note: order.productId + ' 카카오페이 결제', createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      tx.set(orderRef, { status: 'completed', completedAt: admin.firestore.FieldValue.serverTimestamp(), ledgerId: ledgerRef.id }, { merge: true });
      return next;
    });
    if (balance == null) {
      const wDoc = await walletRef.get();
      res.json({ ok: true, balance: wDoc.exists ? (wDoc.data().balance || 0) : 0, alreadyCompleted: true });
      return;
    }
    res.json({ ok: true, balance });
  } catch (e) {
    console.error('kakaoPayApprove 실패', e);
    res.status(500).json({ error: e.message });
  }
});

// feature별로 이 요청 하나가 최종적으로 몇 번의 analyzeCharacter 호출을 정당하게 커버하는지 —
// 궁합보기는 나/상대방 두 사람 얼굴을 각각 판정해야 해서(js/app.js runGungham) 1회 차감으로 2번까지 허용한다.
const NYANG_FEATURE_ANALYSIS_USES = { combined: 1, gungham: 2 };

// ═══ 통합분석/궁합보기 1회 사용 = 냥 1 차감 (기획서 §3.2) ═══
// ⚠️ 2026-09-03 보안 수정 — 예전엔 이 함수가 잔액만 깎고, 그 뒤에 프론트가 "알아서" analyzeCharacter를
// 불러주는 걸 신뢰하는 구조였다. 즉 로그인만 돼 있으면(비로그인도 익명 로그인으로 무료) 개발자 도구로
// analyzeCharacter Cloud Function URL에 직접 POST하는 사람은 nyangSpend를 아예 건너뛰고 무제한
// 공짜로 캐릭터 판정을 받을 수 있었다 — 두 함수가 서로 독립적이라 클라이언트가 순서를 지킨다는
// 보장이 전혀 없었기 때문. 이제 이 함수는 잔액을 깎는 동시에 1회용 티켓(analysisTickets)을 발급하고,
// analyzeCharacter는 그 티켓이 없거나 이미 소진됐으면 결과를 계산하지 않고 거절한다(아래 analyzeCharacter
// 참고) — "결제 없이 엔드포인트만 직접 호출"하는 우회 경로 자체를 없앤다.
exports.nyangSpend = onRequest({ cors: true }, async (req, res) => {
  if (req.method !== 'POST') { res.status(405).json({ error: 'POST만 허용됩니다.' }); return; }

  const idToken = getBearerToken(req);
  if (!idToken) { res.status(401).json({ error: '로그인이 필요합니다.' }); return; }
  let uid;
  try { uid = (await admin.auth().verifyIdToken(idToken)).uid; }
  catch (e) { res.status(401).json({ error: '인증 토큰이 유효하지 않습니다.' }); return; }

  const feature = (req.body && req.body.feature) || '';
  const relatedId = (req.body && req.body.relatedId) || null;
  if (!feature) { res.status(400).json({ error: 'feature가 필요합니다.' }); return; }

  const walletRef = db.collection('wallets').doc(uid);
  const ledgerRef = db.collection('nyangLedger').doc();
  const ticketRef = db.collection('analysisTickets').doc();
  try {
    const balance = await db.runTransaction(async (tx) => {
      const snap = await tx.get(walletRef);
      const current = snap.exists ? (snap.data().balance || 0) : 0;
      if (current < 1) {
        const err = new Error('냥이 부족해요 — 구매 후 이용해주세요.');
        err.code = 'INSUFFICIENT_BALANCE';
        throw err;
      }
      const next = current - 1;
      tx.set(walletRef, { balance: next, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
      tx.set(ledgerRef, {
        userId: uid, type: 'spend', amount: -1, balanceAfter: next,
        relatedId, note: feature, createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      tx.set(ticketRef, {
        uid, feature, remainingUses: NYANG_FEATURE_ANALYSIS_USES[feature] || 1,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      return next;
    });
    res.json({ ok: true, balance, ticketId: ticketRef.id });
  } catch (e) {
    if (e.code === 'INSUFFICIENT_BALANCE') {
      res.status(402).json({ ok: false, error: e.message, code: e.code });
      return;
    }
    console.error('nyangSpend 실패', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// feature가 이 목록에 있으면 유료 기능 — nyangSpend가 발급한 유효한 티켓 없이는 절대 계산해주지 않는다.
// 목록에 없는 feature(예: 'gwansang' 관상보기 최초 1회 무료 판정)는 지금까지처럼 티켓 없이 통과시킨다.
const NYANG_GATED_FEATURES = new Set(['combined', 'gungham']);

// ═══ 16캐릭터 판정 (2026-08-30 DB 이원화 1단계) ═══
// 관상×사주 판단 가중치·공식(engine/character-engine.js)이 브라우저 소스에 그대로 노출되던 문제를
// 막기 위해, 판정 자체를 서버로 옮겼다 — 클라이언트(js/ai-analysis.js classifyAndBuildCharacter)는
// 분류된 feature id·confidence·사주 정보만 보내고, 계산된 결과만 돌려받는다.
// ⚠️ 2026-09-03 보안 수정 — "로그인만 하면(익명 포함) 통과"였던 인증만으로는, 개발자 도구로 이
// 함수 URL에 직접 요청을 보내 nyangSpend를 건너뛰고 무제한 공짜 판정을 받는 걸 막을 수 없었다
// (nyangSpend 주석 참고). combined/gungham처럼 유료인 feature는 이제 nyangSpend가 발급한 1회용
// 티켓(analysisTickets)을 요청에 함께 보내야 하고, 서버가 그 티켓을 트랜잭션으로 검증·소진한 뒤에만
// 계산을 시작한다 — 티켓이 없거나 이미 다 썼으면 계산 자체를 하지 않고 거절한다.
exports.analyzeCharacter = onRequest({ cors: true }, async (req, res) => {
  if (req.method !== 'POST') { res.status(405).json({ error: 'POST만 허용됩니다.' }); return; }

  const idToken = getBearerToken(req);
  if (!idToken) { res.status(401).json({ error: '로그인이 필요합니다.' }); return; }
  let uid;
  try { uid = (await admin.auth().verifyIdToken(idToken)).uid; }
  catch (e) { res.status(401).json({ error: '인증 토큰이 유효하지 않습니다.' }); return; }

  const { featureIds, confidences, partStatusMap, pillars, ohaengCounts, sinsalList, gwiinList, hasHour, feature, ticketId } = req.body || {};

  if (NYANG_GATED_FEATURES.has(feature)) {
    if (!ticketId) { res.status(402).json({ ok: false, error: '결제가 필요합니다.', code: 'PAYMENT_REQUIRED' }); return; }
    const ticketRef = db.collection('analysisTickets').doc(ticketId);
    try {
      await db.runTransaction(async (tx) => {
        const snap = await tx.get(ticketRef);
        if (!snap.exists) { const err = new Error('유효하지 않은 결제 정보예요.'); err.code = 'PAYMENT_REQUIRED'; throw err; }
        const t = snap.data();
        if (t.uid !== uid || t.feature !== feature || !(t.remainingUses > 0)) {
          const err = new Error('결제가 필요합니다.'); err.code = 'PAYMENT_REQUIRED'; throw err;
        }
        tx.update(ticketRef, { remainingUses: t.remainingUses - 1, lastUsedAt: admin.firestore.FieldValue.serverTimestamp() });
      });
    } catch (e) {
      res.status(402).json({ ok: false, error: e.message, code: e.code || 'PAYMENT_REQUIRED' });
      return;
    }
  }

  try {
    const characterResult = computeCharacterResult({
      featureIds: featureIds || null,
      confidences: confidences || null,
      partStatusMap: partStatusMap || null,
      pillars: pillars || null,
      ohaengCounts: ohaengCounts || null,
      sinsalList: sinsalList || null,
      gwiinList: gwiinList || null,
      hasHour: !!hasHour,
    });
    // §2-A 비교 카드("관상만 봤을 때 → 관상+사주 유형")용 얼굴 단독 재판정 —
    // js/ai-analysis.js classifyAndBuildCharacter의 원래 로직을 그대로 서버에 옮긴 것.
    let faceOnlyCharacterId = null;
    if (characterResult) {
      faceOnlyCharacterId = pillars
        ? (computeCharacterResult({ featureIds, confidences, partStatusMap }) || {}).characterId || null
        : characterResult.characterId;
    }
    res.json({ ok: true, characterResult: characterResult ? { ...characterResult, faceOnlyCharacterId } : null });
  } catch (e) {
    console.error('analyzeCharacter 실패', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ═══ 캐릭터 궁합 조회 (compatibility-engine.js 서버 이전) ═══
// characterId 하나의 good/spark/clash 관계(js/ai-analysis.js buildGunghapRelationBlock이 쓰던
// COMPATIBILITY_DB[charId] 조회)와, 두 캐릭터 사이의 궁합 점수(js/inyeon-dogam.js compatScore)를
// 같은 엔드포인트에서 처리한다 — 요청에 있는 필드에 따라 필요한 것만 계산해 돌려준다.
exports.getCompatibility = onRequest({ cors: true }, async (req, res) => {
  if (req.method !== 'POST') { res.status(405).json({ error: 'POST만 허용됩니다.' }); return; }

  const idToken = getBearerToken(req);
  if (!idToken) { res.status(401).json({ error: '로그인이 필요합니다.' }); return; }
  try { await admin.auth().verifyIdToken(idToken); }
  catch (e) { res.status(401).json({ error: '인증 토큰이 유효하지 않습니다.' }); return; }

  const { characterId, idA, idB } = req.body || {};
  try {
    const result = {};
    if (characterId) result.relation = classifyCompatibility(characterId);
    if (idA && idB) result.score = compatScore(idA, idB);
    res.json({ ok: true, ...result });
  } catch (e) {
    console.error('getCompatibility 실패', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ═══ 관상 유형 / 캐릭터 콘텐츠 카탈로그 (2026-08-30 DB 이원화 2단계) ═══
// js/archetype-db.js·js/character/character-db.js(카피 콘텐츠 — 눈모양/동물형상 설명, 16캐릭터
// 이름·강점·약점·상황별 서술 등)가 정적 스크립트로 그대로 노출되던 문제를 막기 위해 서버로 옮겼다.
// 카탈로그 크기가 작아(관상 9종 합쳐 69개 항목, 캐릭터 16개) 매번 전체를 내려주고 클라이언트가
// 한 번만 받아 캐시한다 — 판정 결과에 따라 골라 내려주는 것보다 구조가 단순하고, 어차피 로그인
// 사용자에게는 결과 화면에서 실질적으로 노출되는 내용이라 부분 공개로 얻는 이득이 크지 않다.
exports.getArchetypeCatalog = onRequest({ cors: true }, async (req, res) => {
  if (req.method !== 'POST') { res.status(405).json({ error: 'POST만 허용됩니다.' }); return; }
  const idToken = getBearerToken(req);
  if (!idToken) { res.status(401).json({ error: '로그인이 필요합니다.' }); return; }
  try { await admin.auth().verifyIdToken(idToken); }
  catch (e) { res.status(401).json({ error: '인증 토큰이 유효하지 않습니다.' }); return; }
  res.json({ ok: true, catalog: archetypeDb.buildCatalog() });
});

exports.getCharacterCatalog = onRequest({ cors: true }, async (req, res) => {
  if (req.method !== 'POST') { res.status(405).json({ error: 'POST만 허용됩니다.' }); return; }
  const idToken = getBearerToken(req);
  if (!idToken) { res.status(401).json({ error: '로그인이 필요합니다.' }); return; }
  try { await admin.auth().verifyIdToken(idToken); }
  catch (e) { res.status(401).json({ error: '인증 토큰이 유효하지 않습니다.' }); return; }
  res.json({ ok: true, catalog: characterDb.buildCatalog() });
});

// ═══ 관리자 — 유저 검색 (기획서 §3.3) ═══
// Firestore는 부분 문자열 검색을 기본 지원하지 않는다. 로컬 테스트/소수 베타 유저 전제인 이번
// 스코프에서는 users 컬렉션을 통째로 훑어 닉네임·이메일·uid에 부분 일치하는 것만 추리는 방식으로
// 충분하다고 판단함 — 유저가 많아지면 Algolia/Typesense 같은 검색 인덱스로 교체가 필요하다.
exports.adminSearchUsers = onRequest({ cors: true }, async (req, res) => {
  if (req.method !== 'POST') { res.status(405).json({ error: 'POST만 허용됩니다.' }); return; }

  const idToken = getBearerToken(req);
  if (!idToken) { res.status(401).json({ error: '로그인이 필요합니다.' }); return; }
  let uid;
  try { uid = (await admin.auth().verifyIdToken(idToken)).uid; }
  catch (e) { res.status(401).json({ error: '인증 토큰이 유효하지 않습니다.' }); return; }
  if (!(await isAdmin(uid))) { res.status(403).json({ error: '관리자만 사용할 수 있습니다.' }); return; }

  const q = String((req.body && req.body.q) || '').trim().toLowerCase();
  if (!q) { res.json({ users: [] }); return; }

  const snap = await db.collection('users').limit(500).get();
  const matched = [];
  snap.forEach(doc => {
    const d = doc.data() || {};
    const haystack = [doc.id, d.kakaoNickname, d.kakaoAccount].filter(Boolean).join(' ').toLowerCase();
    if (haystack.includes(q)) matched.push({ uid: doc.id, nickname: d.kakaoNickname || '', account: d.kakaoAccount || '' });
  });

  const top = matched.slice(0, 20);
  const withBalance = await Promise.all(top.map(async u => {
    const w = await db.collection('wallets').doc(u.uid).get();
    return Object.assign({}, u, { balance: w.exists ? (w.data().balance || 0) : 0 });
  }));
  res.json({ users: withBalance });
});

// ═══ 관리자 — 냥 수동 지급 (기획서 §3.3) ═══
exports.adminGrantNyang = onRequest({ cors: true }, async (req, res) => {
  if (req.method !== 'POST') { res.status(405).json({ error: 'POST만 허용됩니다.' }); return; }

  const idToken = getBearerToken(req);
  if (!idToken) { res.status(401).json({ error: '로그인이 필요합니다.' }); return; }
  let adminUid;
  try { adminUid = (await admin.auth().verifyIdToken(idToken)).uid; }
  catch (e) { res.status(401).json({ error: '인증 토큰이 유효하지 않습니다.' }); return; }
  if (!(await isAdmin(adminUid))) { res.status(403).json({ error: '관리자만 사용할 수 있습니다.' }); return; }

  const targetUserId = (req.body && req.body.targetUserId) || '';
  const amount = Number(req.body && req.body.amount);
  const reason = String((req.body && req.body.reason) || '').trim();
  if (!targetUserId) { res.status(400).json({ error: 'targetUserId가 필요합니다.' }); return; }
  // 회수 기능은 이번 스코프 제외라 음수 입력은 아예 막는다(기획서 §3.3 검증 사항).
  if (!Number.isInteger(amount) || amount < 1) { res.status(400).json({ error: 'amount는 1 이상의 정수여야 합니다.' }); return; }
  if (!reason) { res.status(400).json({ error: 'reason(지급 사유)이 필요합니다.' }); return; }

  const walletRef = db.collection('wallets').doc(targetUserId);
  const ledgerRef = db.collection('nyangLedger').doc();
  const grantRef = db.collection('adminGrants').doc();
  try {
    const balance = await db.runTransaction(async (tx) => {
      const snap = await tx.get(walletRef);
      const current = snap.exists ? (snap.data().balance || 0) : 0;
      const next = current + amount;
      tx.set(walletRef, { balance: next, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
      tx.set(ledgerRef, {
        userId: targetUserId, type: 'grant_admin', amount, balanceAfter: next,
        relatedId: grantRef.id, note: reason, createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      tx.set(grantRef, {
        adminUserId: adminUid, targetUserId, amount, reason,
        ledgerId: ledgerRef.id, createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      return next;
    });
    res.json({ ok: true, balance });
  } catch (e) {
    console.error('adminGrantNyang 실패', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ═══ 관리자 — 냥 내역 조회 (CS 대응용) ═══
// nyangLedger는 firestore.rules에서 "본인 것만 read"로 막혀 있어(다른 사람 거래를 클라이언트가 보면 안 됨)
// 관리자 전체 조회는 이 함수(Admin SDK, 규칙 우회)를 거쳐야 한다.
// 원장 한 줄이 곧 "왜 이렇게 됐는지"의 근거라(기획서 §1), 취소·환불 문의가 오면 이 목록에서
// 해당 거래를 찾아 balanceAfter로 당시 잔액까지 확인할 수 있다.
exports.adminNyangHistory = onRequest({ cors: true }, async (req, res) => {
  if (req.method !== 'POST') { res.status(405).json({ error: 'POST만 허용됩니다.' }); return; }

  const idToken = getBearerToken(req);
  if (!idToken) { res.status(401).json({ error: '로그인이 필요합니다.' }); return; }
  let uid;
  try { uid = (await admin.auth().verifyIdToken(idToken)).uid; }
  catch (e) { res.status(401).json({ error: '인증 토큰이 유효하지 않습니다.' }); return; }
  if (!(await isAdmin(uid))) { res.status(403).json({ error: '관리자만 사용할 수 있습니다.' }); return; }

  // type 필터: 'all' | 'grant_admin' | 'spend' | 'purchase'. 기본은 전체.
  const type = String((req.body && req.body.type) || 'all');
  const targetUserId = String((req.body && req.body.userId) || '');
  const limit = Math.min(Number((req.body && req.body.limit) || 100), 300);

  try {
    // 특정 사용자만 보기(CS에서 "이 사람 내역만") — userId + createdAt 복합 인덱스를 쓴다.
    // type까지 동시에 걸면 3필드 인덱스가 또 필요해지는데, 한 사람의 거래는 많아야 수십 건이라
    // 타입은 메모리에서 거르는 편이 인덱스를 늘리는 것보다 낫다.
    if (targetUserId) {
      const s = await db.collection('nyangLedger')
        .where('userId', '==', targetUserId).orderBy('createdAt', 'desc').limit(limit).get();
      const picked = s.docs.filter(d => type === 'all' || (d.data() || {}).type === type);
      const out = picked.map(doc => {
        const d = doc.data() || {};
        return {
          ledgerId: doc.id, userId: d.userId, type: d.type, amount: d.amount,
          balanceAfter: d.balanceAfter, note: d.note || '', relatedId: d.relatedId || null,
          createdAt: d.createdAt ? d.createdAt.toMillis() : null,
        };
      });
      const us = await db.collection('users').doc(targetUserId).get();
      const ud = us.exists ? (us.data() || {}) : {};
      out.forEach(r => { r.nickname = ud.kakaoNickname || ''; r.account = ud.kakaoAccount || ''; });
      res.json({ ok: true, rows: out });
      return;
    }

    // where(type) + orderBy(createdAt)은 복합 인덱스가 있어야 한다(firestore.indexes.json 참고).
    // 인덱스가 아직 빌드 중이면 FAILED_PRECONDITION이 떨어지는데, 그때 화면 전체가 에러로 죽는 것보다
    // "최근 N건을 받아 메모리에서 걸러 보여주는" 쪽이 CS 도구로서 낫다. 인덱스가 준비되면 자동으로
    // 위쪽(정상 경로)만 타게 되므로 이 폴백은 평소엔 실행되지 않는다.
    let snap;
    if (type === 'all') {
      snap = await db.collection('nyangLedger').orderBy('createdAt', 'desc').limit(limit).get();
    } else {
      try {
        snap = await db.collection('nyangLedger')
          .where('type', '==', type).orderBy('createdAt', 'desc').limit(limit).get();
      } catch (e) {
        if (e.code !== 9 && e.code !== 'failed-precondition') throw e;
        console.warn('adminNyangHistory: 복합 인덱스 미생성 — 메모리 필터로 폴백', type);
        const all = await db.collection('nyangLedger')
          .orderBy('createdAt', 'desc').limit(Math.max(limit, 300)).get();
        snap = { forEach: cb => all.docs.filter(d => (d.data() || {}).type === type).slice(0, limit).forEach(cb) };
      }
    }

    const rows = [];
    const uids = new Set();
    snap.forEach(doc => {
      const d = doc.data() || {};
      uids.add(d.userId);
      rows.push({
        ledgerId: doc.id, userId: d.userId, type: d.type, amount: d.amount,
        balanceAfter: d.balanceAfter, note: d.note || '', relatedId: d.relatedId || null,
        createdAt: d.createdAt ? d.createdAt.toMillis() : null,
      });
    });

    // 사용자 표시 이름을 한 번에 붙인다 — 행마다 개별 조회하면 100건에 100번 읽게 된다.
    const userMap = {};
    await Promise.all(Array.from(uids).map(async u => {
      if (!u) return;
      const s = await db.collection('users').doc(u).get();
      const d = s.exists ? (s.data() || {}) : {};
      userMap[u] = { nickname: d.kakaoNickname || '', account: d.kakaoAccount || '' };
    }));
    rows.forEach(r => {
      const u = userMap[r.userId] || {};
      r.nickname = u.nickname || '';
      r.account = u.account || '';
    });

    // 관리자 지급 건은 "누가 줬는지"까지 있어야 CS에서 쓸 수 있다(기획서 §3.3 AdminGrant).
    const grantIds = rows.filter(r => r.type === 'grant_admin' && r.relatedId).map(r => r.relatedId);
    const grantMap = {};
    await Promise.all(grantIds.map(async gid => {
      const s = await db.collection('adminGrants').doc(gid).get();
      if (s.exists) grantMap[gid] = s.data().adminUserId || '';
    }));
    rows.forEach(r => { if (r.type === 'grant_admin') r.grantedBy = grantMap[r.relatedId] || ''; });

    res.json({ ok: true, rows });
  } catch (e) {
    console.error('adminNyangHistory 실패', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// 프론트(js/ai-analysis.js)가 Gemini에 보낼 내용(시스템 지시문·사용자 텍스트·이미지·스키마)만 보내면
// 여기서 실제 Gemini 요청 형식으로 조립해 키와 함께 호출한다 — 브라우저는 진짜 키를 절대 볼 수 없다.
// timeoutSeconds를 기본값(60초)보다 늘려둔다 — 사진 분석은 요청이 무겁고, 키 할당량 초과로 여러 키를
// 순서대로 재시도하면 누적 시간이 60초를 넘어 CORS 헤더도 못 붙인 채 504로 끊기는 문제가 있었다.
exports.geminiProxy = onRequest({ cors: true, secrets: [geminiApiKeys], timeoutSeconds: 180 }, async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'POST만 허용됩니다.' });
    return;
  }

  const keys = (geminiApiKeys.value() || '').split(',').map(k => k.trim()).filter(Boolean);
  if (!keys.length) {
    res.status(500).json({ error: 'Gemini API 키가 서버에 설정되지 않았습니다.' });
    return;
  }

  const { systemInstruction, userText, images, schema, temperature, model } = req.body || {};
  if (!userText) {
    res.status(400).json({ error: 'userText가 필요합니다.' });
    return;
  }
  const geminiModel = model || 'gemini-flash-latest';

  const parts = [{ text: userText }];
  (images || []).forEach(dataUrl => {
    const match = /^data:(.*?);base64,(.*)$/.exec(dataUrl);
    if (match) parts.push({ inlineData: { mimeType: match[1], data: match[2] } });
  });

  const body = {
    systemInstruction: { parts: [{ text: systemInstruction || '' }] },
    contents: [{ role: 'user', parts }],
    generationConfig: { responseMimeType: 'application/json', responseSchema: schema, temperature: temperature != null ? temperature : 0.9 },
  };

  // 키를 순서대로 시도하다가 할당량 초과(429/RESOURCE_EXHAUSTED)일 때만 다음 키로 넘어간다.
  // 그 외 에러(잘못된 요청 등)는 재시도해도 똑같이 실패하니 즉시 반환한다.
  // 키 하나가 응답 없이 오래 걸리는 경우까지 대비해 시도당 50초로 끊고 다음 키로 넘어간다
  // (전체 timeoutSeconds=180 안에서 3개 키를 다 시도해도 여유가 남도록).
  let lastError;
  for (let i = 0; i < keys.length; i++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 50000);
    try {
      const geminiRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent?key=${encodeURIComponent(keys[i])}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const data = await geminiRes.json();
      if (geminiRes.ok) {
        res.json(data);
        return;
      }
      // 429/RESOURCE_EXHAUSTED(할당량 초과)뿐 아니라 503/UNAVAILABLE(모델 일시 과부하)도
      // "지금 이 키 탓이 아니라 잠시 후 다시 하면 되는" 일시적 상태라 다음 키로 넘어가 재시도한다.
      // 그 외(400 등 요청 자체가 잘못된 경우)는 재시도해도 똑같이 실패하니 즉시 반환한다.
      const isRetryable = geminiRes.status === 429 || geminiRes.status === 503
        || (data.error && (data.error.status === 'RESOURCE_EXHAUSTED' || data.error.status === 'UNAVAILABLE'));
      if (!isRetryable) {
        res.status(geminiRes.status).json(data);
        return;
      }
      console.warn(`[geminiProxy] 키 ${i + 1}/${keys.length} 실패(${geminiRes.status}) — 다음 키로 재시도`);
      lastError = data;
    } catch (e) {
      console.warn(`[geminiProxy] 키 ${i + 1}/${keys.length} 호출 실패(${e.name}) — 다음 키로 재시도`);
      lastError = { error: e.message };
    } finally {
      clearTimeout(timeout);
    }
  }
  res.status(503).json({ error: '등록된 모든 키로 시도했지만 실패했습니다(할당량 초과 또는 모델 일시 과부하).', detail: lastError });
});

// ═══════════════════════════════════════════════════════════════════════
// 인연도감 만료 정리 (TTL) — 화면에 고지한 "30일 보관" 정책을 실제로 집행하는 배치.
// 이게 없으면 정책 문구만 30일이고 데이터는 영구히 남아, 고지와 실제가 어긋난다.
//
// 보관 기간의 기준 시각(expiresAt)은 클라이언트(js/inyeon-dogam.js)가 도감을 만들 때와
// 주인이 도감을 열 때마다 갱신한다. 여기서는 그 시각이 지난 도감만 지운다.
//
// 주의: Firestore는 상위 문서를 지워도 하위 컬렉션이 함께 사라지지 않는다.
//       entries를 먼저 지우지 않으면 접근할 수 없는 고아 데이터로 남는다.
// ═══════════════════════════════════════════════════════════════════════
const DOGAM_SWEEP_LIMIT = 200;   // 한 번 실행에 처리할 도감 수 (타임아웃 안에 끝나도록 제한)
const BATCH_LIMIT = 400;         // Firestore 배치 쓰기 상한(500)보다 여유 있게
const DELETION_LOG_KEEP_DAYS = 90; // 삭제 로그 보관 — 개인정보는 담지 않고 이벤트만 남긴다

async function deleteRefsInChunks(refs) {
  for (let i = 0; i < refs.length; i += BATCH_LIMIT) {
    const batch = db.batch();
    refs.slice(i, i + BATCH_LIMIT).forEach((ref) => batch.delete(ref));
    await batch.commit();
  }
}

// 도감 1건 삭제: entries 전부 → 도감 문서 → 주인 계정의 역인덱스(dogamSlug) 정리 → 삭제 로그
async function purgeDogam(doc, reason) {
  const entriesSnap = await doc.ref.collection('entries').get();
  await deleteRefsInChunks(entriesSnap.docs.map((d) => d.ref));
  await doc.ref.delete();

  const ownerUid = (doc.data() || {}).ownerUid;
  if (ownerUid) {
    // 남겨두면 클라이언트가 이미 사라진 slug를 계속 조회한다.
    await db.collection('users').doc(ownerUid)
      .set({ dogamSlug: admin.firestore.FieldValue.delete() }, { merge: true })
      .catch((e) => console.warn(`[dogamCleanup] dogamSlug 정리 실패 uid=${ownerUid}`, e.message));
  }

  // 분쟁 대비 최소 로그 — 누구인지 알 수 있는 값(이름·uid)은 담지 않는다.
  await db.collection('deletionLogs').add({
    entityType: 'dogam',
    entityId: doc.id,
    entryCount: entriesSnap.size,
    deletedBy: reason,
    deletedAt: new Date().toISOString(),
  });
  return entriesSnap.size;
}

// ═══ "로그인 계정당 도감 1개" 불변식 강제 (2026-08-31 사용자 리포트: 삭제해도 도감이 계속 생김) ═══
// migrateAnonymousData(아래)는 계정에 이미 도감이 있는지 확인하지 않고 dogamSlug를 매번 덮어써서,
// 비로그인↔로그인을 반복 테스트하면 같은 계정 밑에 도감이 여러 개 쌓였다(과거 "11개까지 쌓인 사고"
// 주석 참고). dogamSlug는 그중 하나만 가리키므로 나머지는 숨어 있다가, 클라이언트의 복구 로직
// (js/inyeon-dogam.js recoverDogamByOwner — 참여 인원이 가장 많은 도감을 되살리는 안전망)이 그걸
// 찾아내면서 "분명히 삭제했는데 다시 생긴다"처럼 보였다.
// 정책(사용자 확정 2026-08-31): 참여 인원 수가 아니라 — 이 계정이 **최초로 로그인을 시도하던
// 시점에 갖고 있던 도감**이 그 계정의 도감으로 영구 고정된다. 이미 그 시점이 지나 dogamSlug가
// 한 번이라도 정해진 계정은, 이후 로그인에서 다른 익명 도감이 새로 이관되어 와도 원래 것을 그대로
// 지키고 새로 온 건 버린다. 아직 한 번도 도감이 없었던(진짜 첫 로그인) 계정만 이번 이관 결과를
// 그대로 받아들인다. 비로그인 상태로만 남아있는 도감(이 함수가 손대지 않는 것)은 기존 30일
// 유예기간(cleanupExpiredDogam)을 그대로 따른다 — 이 함수는 "로그인 계정"에만 적용된다.
//
// preferredSlug: kakaoLogin이 이번 요청에서 ensureUserAndWallet/migrateAnonymousData를 부르기
// 전에 미리 읽어둔 users/{uid}.dogamSlug — "로그인 시도 시점"의 스냅샷이라 여기서 다시 조회하면
// 이미 migrateAnonymousData가 덮어쓴 뒤라 늦다.
// 순수 함수로 분리 — Firestore 없이도 "어떤 걸 남길지" 결정만 단독으로 검증할 수 있게 한다.
// docs: [{id, createdAt}]. preferredSlug가 그 안에 실제로 있으면 그게 keeper id, 없으면(진짜 첫
// 로그인이라 이전 dogamSlug가 없었거나 그 도감이 이미 삭제된 경우) 가장 오래된 것의 id.
function pickKeeperId(docs, preferredSlug) {
  if (preferredSlug && docs.some((d) => d.id === preferredSlug)) return preferredSlug;
  return docs.slice().sort((a, b) => (a.createdAt || '') < (b.createdAt || '') ? -1 : 1)[0].id;
}

// ⚠️ 사용자 리포트(2026-09-04): "비로그인으로 만든 도감이 로그인된 도감에 머지되면서 사라진 것
// 같다" — 예전엔 keeper가 아닌 도감을 캐릭터(관상)가 같든 다르든 무조건 purgeDogam으로 완전히
// 지워버렸다. 캐릭터가 같으면(같은 사람이 다시 분석해서 생긴 중복일 가능성이 커) "같은 나"로 보고
// 참여 기록을 keeper 쪽으로 합쳐서 유실 없이 정리하지만, 캐릭터가 다르면 같은 사람인지 확신할 수
// 없으므로 자동으로 지우지 않고 그대로 남겨서(conflicts) 호출부(kakaoLogin)가 클라이언트에 알리고
// 사용자가 직접 대표 도감을 고르게 한다(정책 §3).
async function settleDogamForUid(uid, preferredSlug) {
  const snap = await db.collection('dogam').where('ownerUid', '==', uid).get();
  if (snap.size <= 1) return { kept: snap.empty ? null : snap.docs[0].id, purged: 0, merged: 0, conflicts: [] };

  const keeperId = pickKeeperId(
    snap.docs.map((d) => ({ id: d.id, createdAt: (d.data() || {}).createdAt || '' })),
    preferredSlug
  );
  const keeperDoc = snap.docs.find((d) => d.id === keeperId);
  const keeperCharacterId = (keeperDoc.data() || {}).ownerCharacterId;
  const others = snap.docs.filter((d) => d.id !== keeperDoc.id);

  let merged = 0;
  const conflicts = [];
  for (const other of others) {
    const otherData = other.data() || {};
    if (otherData.ownerCharacterId === keeperCharacterId) {
      const entriesSnap = await other.ref.collection('entries').get();
      for (const d of entriesSnap.docs) {
        const data = d.data();
        const keeperEntryRef = keeperDoc.ref.collection('entries').doc(d.id);
        const keeperEntrySnap = await keeperEntryRef.get();
        if (!keeperEntrySnap.exists || (data.score || 0) > (keeperEntrySnap.data().score || 0)) {
          await keeperEntryRef.set(data, { merge: true });
        }
      }
      await purgeDogam(other, 'login_merge');
      merged++;
    } else {
      conflicts.push({
        slug: other.id,
        ownerCharacterId: otherData.ownerCharacterId || null,
        ownerName: otherData.ownerName || '',
        entryCount: (await other.ref.collection('entries').get()).size,
      });
    }
  }

  // 진짜 삭제(purgeDogam)가 먼저 끝나야 한다 — 병합 중 dogamSlug가 계속 지워지는데, 마지막에
  // keeper로 다시 지정해야 최종 상태가 맞는다(순서를 바꾸면 keeper 참조가 날아갈 수 있다).
  await db.collection('users').doc(uid).set({ dogamSlug: keeperDoc.id }, { merge: true });

  if (merged || conflicts.length) {
    console.warn(`[dogam] uid=${uid} 밑에 도감 ${snap.size}개 발견 — ${keeperDoc.id} 유지, 병합 ${merged}개, 대기중 충돌 ${conflicts.length}개`);
  }
  return { kept: keeperDoc.id, purged: merged, merged, conflicts };
}

exports.cleanupExpiredDogam = onSchedule(
  { schedule: 'every day 04:00', timeZone: 'Asia/Seoul', timeoutSeconds: 540, memory: '256MiB' },
  async () => {
    const nowIso = new Date().toISOString();

    const expired = await db.collection('dogam')
      .where('expiresAt', '<', nowIso)
      .limit(DOGAM_SWEEP_LIMIT)
      .get();

    let dogamCount = 0;
    let entryCount = 0;
    for (const doc of expired.docs) {
      try {
        entryCount += await purgeDogam(doc, 'ttl');
        dogamCount++;
      } catch (e) {
        // 한 건이 실패해도 나머지는 계속 처리한다 — 다음 실행에서 재시도된다.
        console.error(`[dogamCleanup] 도감 삭제 실패 slug=${doc.id}`, e);
      }
    }

    // 오래된 삭제 로그도 함께 정리 — 로그가 무한히 쌓이는 걸 막는다.
    const logCutoff = new Date(Date.now() - DELETION_LOG_KEEP_DAYS * 86400000).toISOString();
    const oldLogs = await db.collection('deletionLogs')
      .where('deletedAt', '<', logCutoff)
      .limit(BATCH_LIMIT)
      .get();
    await deleteRefsInChunks(oldLogs.docs.map((d) => d.ref));

    console.log(`[dogamCleanup] 도감 ${dogamCount}건 / 참여기록 ${entryCount}건 삭제, 만료로그 ${oldLogs.size}건 정리`);
    if (expired.size === DOGAM_SWEEP_LIMIT) {
      // 상한까지 꽉 찼다면 아직 남아 있다는 뜻 — 다음 날 실행에서 이어서 처리된다.
      console.warn(`[dogamCleanup] 처리 상한(${DOGAM_SWEEP_LIMIT})에 도달 — 만료 도감이 더 남아 있다`);
    }
  }
);

// ═══════════════════════════════════════════════════════════════════════
// 익명 세션 → 카카오 계정 데이터 이관
// 로그인 없이 인연도감을 만들고 친구 도감에 등록한 사람이, 나중에 카카오로 로그인하면
// 그동안 쌓인 게 그대로 계정에 붙어야 한다(로그인은 "보관"을 위한 후킹이므로).
//
// 옮기는 것
//   ① 내가 주인인 도감      dogam.ownerUid: anon → kakao,  users/{kakao}.dogamSlug 연결
//   ② 내가 남긴 참여 기록    dogam/*/entries/{anon} → entries/{kakao} (문서 id가 uid라 새로 쓰고 지운다)
// 참여 기록은 collectionGroup으로 한 번에 찾는다(firestore.indexes.json에 entries.uid 인덱스 필요).
// ═══════════════════════════════════════════════════════════════════════
async function migrateAnonymousData(anonUid, newUid) {
  const result = { dogam: 0, entries: 0 };

  // ① 내가 주인인 도감
  const owned = await db.collection('dogam').where('ownerUid', '==', anonUid).get();
  for (const doc of owned.docs) {
    await doc.ref.update({ ownerUid: newUid });
    await db.collection('users').doc(newUid).set({ dogamSlug: doc.id }, { merge: true });
    result.dogam++;
  }

  // ② 내가 남의 도감에 남긴 참여 기록 — 문서 id가 uid라 이동(새로 쓰고 지우기)이 필요하다.
  const entries = await db.collectionGroup('entries').where('uid', '==', anonUid).get();
  for (const doc of entries.docs) {
    const data = doc.data();
    const parent = doc.ref.parent; // dogam/{slug}/entries
    await parent.doc(newUid).set(Object.assign({}, data, { uid: newUid }));
    await doc.ref.delete();
    result.entries++;
  }

  console.log(`[migrate] ${anonUid} → ${newUid}: 도감 ${result.dogam}건, 참여기록 ${result.entries}건 이관`);
  return result;
}
