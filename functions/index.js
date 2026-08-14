// 프론트(js/kakao-auth.js)에서 카카오 액세스 토큰을 받아 카카오 서버에 직접 검증 요청한 뒤,
// 검증된 카카오 사용자 ID를 기반으로 Firebase 커스텀 토큰을 발급한다.
// Firebase Admin SDK로만 커스텀 토큰을 만들 수 있어(서버 전용 비밀키 필요) 이 단계는 클라이언트에서 할 수 없다.
const { onRequest } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const admin = require('firebase-admin');

admin.initializeApp();

// Gemini API 키는 소스코드/클라이언트에 절대 넣지 않고 Firebase Secret Manager에만 저장한다.
// 무료 키 여러 개를 콤마로 이어붙여 등록해두면, 한 키가 할당량을 초과했을 때 다음 키로 자동 전환된다.
// 값 설정: firebase functions:secrets:set GEMINI_API_KEYS  (예: key1,key2,key3)
const geminiApiKeys = defineSecret('GEMINI_API_KEYS');

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
    const customToken = await admin.auth().createCustomToken(uid);
    res.json({ customToken });
  } catch (e) {
    console.error('kakaoLogin 처리 실패', e);
    res.status(500).json({ error: e.message });
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
