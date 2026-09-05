// ═══ 랜드마크 엔진 — MediaPipe FaceLandmarker(478점) ═══
// face-api.js(68점, dlib)에서 교체함. 이유: 68점에는 이마 위쪽(헤어라인)·광대 전용 포인트가 없어서
// 관록궁/상정 비율이 눈썹 y좌표를 이마 상단으로 착각해 0%에 가깝게 왜곡되는 버그가 있었음.
// MediaPipe는 브라우저 안에서 WASM으로 도는 온디바이스 모델이라 API 키·비용이 전혀 없음(Google Cloud API 아님).
//
// 인덱스는 scratchpad/landmark-check.html로 실제 사진에 찍어서 확인한 값이다(추측 아님).
// L/R은 "화면 기준 좌/우"(작은 x = 화면 좌측) — 기존 calcAsymmetry의 "이미지 기준 좌측=내면" 관례를 그대로 유지.
const IDX = {
  hairline: 10,      // 이마 최상단(헤어라인 근처) — 68점에는 없던 포인트, 이번 마이그레이션의 핵심
  chin: 152,          // 턱끝
  cheekL: 234, cheekR: 454,          // 광대~관자놀이(얼굴 최대폭에 가까운 지점)
  jawTaperL: 172, jawTaperR: 397,    // 턱선이 좁아지는 지점(관골보다 아래, 턱끝보다 위)
  eyeOuterL: 33, eyeInnerL: 133,     // 화면-좌 눈(바깥/안쪽 꼬리)
  eyeInnerR: 362, eyeOuterR: 263,    // 화면-우 눈(안쪽/바깥 꼬리)
  eyeLidTopL: 159, eyeLidBotL: 145,  // 화면-좌 눈꺼풀 위/아래
  eyeLidTopR: 386, eyeLidBotR: 374,  // 화면-우 눈꺼풀 위/아래
  // 눈 높이를 한 쌍(159/145)으로만 재면 그 점 하나가 흔들릴 때 aspect(가로÷세로)가 통째로 출렁이고,
  // 눈 유형이 우안↔학안처럼 반대편으로 뒤집힌다. MediaPipe EAR(eye aspect ratio) 계산에 표준적으로
  // 쓰이는 눈꺼풀 3쌍을 함께 재서 평균 내면 단일 점 노이즈가 크게 줄어든다(2026-08-17 추가).
  eyeLidPairsL: [[159, 145], [158, 153], [160, 144]], // 화면-좌 눈 위/아래 3쌍
  eyeLidPairsR: [[386, 374], [385, 380], [387, 373]], // 화면-우 눈 위/아래 3쌍
  browPeakL: 105, browPeakR: 334,    // 눈썹 정점(가장 높은 점)
  browInnerL: 55, browInnerR: 285,   // 눈썹 안쪽(미간 쪽)
  // ⚠️ MediaPipe 468포인트 표준 토폴로지상 눈썹 바깥쪽 끝으로 알려진 인덱스 — 이번 세션에서 실제 사진으로
  // 재검증은 못 했음(scratchpad/landmark-check.html이 현재 없음). 실제 얼굴 사진이 생기면 drawRegions로
  // 이 두 점을 찍어 눈썹 바깥쪽 끝에 오는지 먼저 확인할 것(관상_동물상_분류_버그_수정_디렉션_프롬프트.md 1단계).
  browOuterL: 46, browOuterR: 276,
  nasion: 168,        // 산근(콧대 상단, 눈 사이)
  noseBridgeLower: 6, // 산근보다 살짝 아래쪽 콧대
  noseTip: 1,          // 코끝(준두)
  alarL: 129, alarR: 358,            // 콧볼 바깥쪽(콧볼 폭)
  mouthCornerL: 61, mouthCornerR: 291, // 입꼬리
  lipTopOuter: 0,      // 윗입술 윤곽 상단(인중 하단 경계)
  lipCenterline: 13,   // 입술이 맞물리는 중심선
  lipBotOuter: 17,     // 아랫입술 하단

  // ── 홍채(468~477) — 모델이 이미 478점을 주고 있었는데 여태 쓰지 않던 부분 (2026-08-18 추가) ──
  // 관상 자료가 눈을 설명할 때 가장 많이 쓰는 표현이 "눈동자가 또렷하다 / 검은자와 흰자의 구분이
  // 선명하다 / 눈에 힘이 있다"인데, 이건 인상 묘사가 아니라 실제로는 홍채의 크기·노출 정도다.
  // 눈꼬리 4점만으로는 못 재던 항목이라 눈 물형 13종이 서로 구분되지 않던 주된 이유이기도 하다.
  irisCenterL: 468, irisL: [469, 470, 471, 472], // 좌: 중심 + 상/우/하/좌 가장자리
  irisCenterR: 473, irisR: [474, 475, 476, 477],
  // ── 눈 윤곽 조밀점 — 눈꺼풀 곡률을 제대로 재기 위한 것. 기존 3쌍(eyeLidPairs)은 서로 너무 붙어
  //    있어 곡률 측정값이 1.100~1.135에 몰렸다(69장 실측). 위/아래 윤곽을 넓게 훑으면 형태가 잡힌다.
  eyeUpperL: [246, 161, 160, 159, 158, 157, 173],
  eyeLowerL: [33, 7, 163, 144, 145, 153, 154, 155],
  eyeUpperR: [466, 388, 387, 386, 385, 384, 398],
  eyeLowerR: [263, 249, 390, 373, 374, 380, 381, 382],
};

let faceLandmarker = null;
let landmarkerLoading = null;

// ═══ MODELS — MediaPipe Tasks Vision (동적 import, CDN 절대경로라 file://에서도 CORS 문제 없음) ═══
async function loadModels(spinnerMsgId) {
  if (faceLandmarker) return true;
  if (landmarkerLoading) return landmarkerLoading;
  landmarkerLoading = (async () => {
    try {
      setSpinner(spinnerMsgId, '얼굴 인식 모델 로딩 중... (첫 실행 시 수초 소요, API 키 불필요)');
      const mod = await import('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14');
      const filesetResolver = await mod.FilesetResolver.forVisionTasks(
        'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm'
      );
      faceLandmarker = await mod.FaceLandmarker.createFromOptions(filesetResolver, {
        baseOptions: {
          modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/latest/face_landmarker.task',
          delegate: 'CPU', // GPU 델리게이트는 환경에 따라 실패하는 경우가 있어 호환성 우선으로 CPU 고정
        },
        runningMode: 'IMAGE',
        numFaces: 1,
      });
      return true;
    } catch (e) {
      faceLandmarker = null;
      return false;
    }
  })();
  const ok = await landmarkerLoading;
  landmarkerLoading = null;
  return ok;
}

// ═══ 좌우 반전 토글 — EXIF에 안 잡히는 "픽셀 자체가 이미 뒤집힌 셀카"를 사용자가 직접 보정 ═══
// 분석 전 상태에서만 노출되는 버튼이라 여기서 분석을 실행하지 않는다 — 플래그만 세팅해두면
// 실제 분석(분석하기 버튼)이 시작될 때 runFaceAnalysis가 이 값을 읽어 반영한다.
// ⚠️ 버그 수정(2026-09-05 사용자 리포트: "눌러도 미리보기에서 반전이 안 보여서 실제로 되는 게 맞는지
// 알 수가 없다") — 분석엔 이미 정상 반영되고 있었지만(runFaceAnalysis의 mirrored 분기), 화면에
// 보이는 썸네일(#thumbImg 등)은 그대로라 사용자가 확인할 방법이 없었다. CSS 좌우 반전(.mirrored)을
// 썸네일에도 같이 토글해서 버튼과 미리보기가 항상 같은 상태를 보여주게 한다.
function toggleMirror(ctx, btn) {
  state[ctx].mirrored = !state[ctx].mirrored;
  if (btn) btn.classList.toggle('on', state[ctx].mirrored);
  const m = ctxMap[ctx];
  const img = m && m.thumbImg && document.getElementById(m.thumbImg);
  if (img) img.classList.toggle('mirrored', state[ctx].mirrored);
}

// ═══ FACE ANALYSIS (Promise 기반 — await 가능) ═══
async function runFaceAnalysis(ctx, canvasIdOverride) {
  const m = ctxMap[ctx] || { spinner: null, err: 'ggErr' };
  const ok = await loadModels(m.spinner);
  if (!ok) { showErr(m.err, '모델 로딩 실패. 인터넷 연결 확인 후 새로고침해주세요.'); hideSpinner(m.spinner); return null; }

  setSpinner(m.spinner, '얼굴 랜드마크 분석 중...');

  const canvasId = canvasIdOverride || (ctx === 'gwansang' ? 'gwansangCanvas' : ctx === 'combined' ? 'combinedCanvas' : ctx === 'gunghamA' ? 'gunghamCanvasA' : 'gunghamCanvasB');
  const canvas = document.getElementById(canvasId);
  if (!canvas) { hideSpinner(m.spinner); return null; }

  try {
    // createImageBitmap(..., {imageOrientation:'from-image'})는 EXIF 회전·좌우반전 플래그가 있는 사진을
    // 브라우저가 자동으로 바로잡아준다 — 전면 카메라 셀카의 좌우반전 문제 1차 방어선.
    // EXIF 플래그 없이 픽셀 자체가 뒤집힌 경우는 못 잡으므로, 그 몫은 toggleMirror() 수동 토글로 보완한다.
    const bitmap = await createImageBitmap(state[ctx].file, { imageOrientation: 'from-image' });
    const MAX_W = 600;
    let w = bitmap.width, h = bitmap.height;
    if (w > MAX_W) { h = Math.round(h * MAX_W / w); w = MAX_W; }
    canvas.width = w; canvas.height = h;
    const c = canvas.getContext('2d');
    c.save();
    if (state[ctx].mirrored) { c.translate(w, 0); c.scale(-1, 1); }
    c.drawImage(bitmap, 0, 0, w, h);
    c.restore();

    setSpinner(m.spinner, '관상 분석 중...');
    const result = faceLandmarker.detect(canvas);
    if (!result.faceLandmarks || !result.faceLandmarks.length) {
      hideSpinner(m.spinner);
      showErr(m.err, '얼굴을 감지하지 못했습니다. 정면을 바라보는 선명한 사진을 사용해주세요.');
      return null;
    }

    // 정규화 좌표(0~1) → 픽셀 좌표로 변환. 이렇게 하면 이후 코드는 예전 face-api.js의 lm[N].x/.y와
    // 동일한 형태(픽셀 {x,y} 배열)로 다룰 수 있어 인덱스 값만 바뀌고 나머지 구조는 그대로 유지된다.
    const lm = result.faceLandmarks[0].map(p => ({ x: p.x * w, y: p.y * h }));
    state[ctx].lm = lm; state[ctx].w = w; state[ctx].h = h;
    // AI로 보낼 이미지는 반드시 drawRegions "이전"에 떠둔다. 이 캔버스는 화면 표시용이라 바로 아래에서
    // 부위별 컬러 폴리곤·한글 라벨·비율 수치가 덧그려지는데, 예전엔 ai-analysis.js가 그 오버레이까지
    // 그려진 캔버스를 toDataURL로 떠서 Gemini에 보냈다. 즉 눈·코·입·턱이 도형과 글자로 덮인 얼굴을
    // 보고 관상을 분류하던 셈이라, 분류가 흔들리는 원인이 됐다(같은 사진 반복 분석 시 9개 항목 중
    // 3개가 회차마다 바뀜). 오버레이 없는 원본을 여기서 따로 보관해 AI 호출에 사용한다.
    state[ctx].cleanImg = canvas.toDataURL('image/jpeg', 0.85);
    drawRegions(c, lm, w, h);
    hideSpinner(m.spinner);
    return lm;
  } catch (e) {
    hideSpinner(m.spinner);
    showErr(m.err, '분석 중 오류: ' + e.message);
    return null;
  }
}

// ═══ 이마 측정 신뢰도 폴백 — 앞머리 등으로 이마 비율이 비정상 범주면 안내하고 대체 분석 유도 ═══
// 범주는 scratchpad 검증 사진(성인 남성, 정상 헤어라인) 실측값(gwanR≈0.38) 기준으로 여유를 둔 초안이며,
// 다른 초안 임계값들과 동일하게 실측 데이터가 쌓이면 보정이 필요하다.
const FOREHEAD_RELIABLE_RANGE = [0.15, 0.65];
function isForeheadReliable(gwanR) {
  return gwanR >= FOREHEAD_RELIABLE_RANGE[0] && gwanR <= FOREHEAD_RELIABLE_RANGE[1];
}

// ═══ DRAW REGIONS ═══
function drawRegions(ctx, lm, w, h) {
  const faceW = Math.abs(lm[IDX.cheekR].x - lm[IDX.cheekL].x);
  const faceH = Math.abs(lm[IDX.chin].y - lm[IDX.hairline].y);
  const r = getGwansangRatios(lm); // 판단 기준으로 실제 쓰이는 값과 동일한 계산 — 라벨에 그대로 표기해 검증 가능하게 함
  const fmt = v => v.toFixed(3);

  function poly(pts, color, label, ratioVal) {
    if (!pts || !pts.length) return;
    ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y);
    pts.forEach(pt => ctx.lineTo(pt.x, pt.y));
    ctx.closePath();
    ctx.fillStyle = color; ctx.fill();
    ctx.strokeStyle = color.replace('0.25','0.7').replace('0.3','0.7').replace('0.35','0.75');
    ctx.lineWidth = 1.5; ctx.stroke();
    const cx = pts.reduce((s,p) => s+p.x, 0)/pts.length;
    const cy = pts.reduce((s,p) => s+p.y, 0)/pts.length;
    const fullLabel = ratioVal != null ? `${label} ${fmt(ratioVal)}` : label;
    ctx.font = 'bold 11px sans-serif';
    const tw = ctx.measureText(fullLabel).width;
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(cx-tw/2-4, cy-9, tw+8, 18);
    ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(fullLabel, cx, cy);
  }

  // 곡선형 부위(눈썹, 눈밑)를 사각형 근사 대신 실제 랜드마크 점들을 따라가는 띠 모양으로 그림.
  // pts는 아치를 따라 순서대로 나열된 점들(내→외 또는 외→내 어느 방향이든 무방, 단조 순서만 유지).
  function ribbon(pts, topOff, botOff) {
    const top = pts.map(p => ({ x: p.x, y: p.y - topOff }));
    const bot = pts.map(p => ({ x: p.x, y: p.y + botOff })).reverse();
    return top.concat(bot);
  }

  const browY = (lm[IDX.browPeakL].y + lm[IDX.browPeakR].y) / 2;
  // 관록궁: 이마 전체 (눈썹 위 ~ 헤어라인), 라벨이 이마 중앙에 위치
  poly([
    {x: lm[IDX.cheekL].x, y: browY},
    {x: lm[IDX.cheekR].x, y: browY},
    {x: lm[IDX.cheekR].x, y: lm[IDX.hairline].y + (browY-lm[IDX.hairline].y)*0.05},
    {x: lm[IDX.cheekL].x, y: lm[IDX.hairline].y + (browY-lm[IDX.hairline].y)*0.05},
  ], 'rgba(255,182,193,0.25)', '관록궁', r.gwanR);

  const mgTopY = Math.min(lm[IDX.browInnerL].y, lm[IDX.browInnerR].y) - faceH*.03;
  const mgBotY = Math.max(lm[IDX.browInnerL].y, lm[IDX.browInnerR].y) + faceH*.02;
  poly([{x:lm[IDX.browInnerL].x-faceW*.02,y:mgTopY},{x:lm[IDX.browInnerR].x+faceW*.02,y:mgTopY},{x:lm[IDX.browInnerR].x+faceW*.02,y:mgBotY},{x:lm[IDX.browInnerL].x-faceW*.02,y:mgBotY}], 'rgba(255,215,0,0.3)', '명궁', r.mgW);

  // 와잠은 좌우 각 눈의 실측값을 그 폴리곤 자리에 각각 표기(평균값인 r.waJ와는 별개로 좌우 검증용)
  const interocularDist = r.__interocularDist;
  const waJRight = Math.abs(lm[IDX.eyeLidBotL].y-lm[IDX.eyeLidTopL].y)/interocularDist, waJLeft = Math.abs(lm[IDX.eyeLidBotR].y-lm[IDX.eyeLidTopR].y)/interocularDist;
  // 이전엔 바깥쪽 꼬리에 아래눈꺼풀 y, 안쪽 꼬리에 위눈꺼풀 y를 섞어 써서(오타성 버그) 윗변이 실제 눈 밑
  // 곡선과 무관하게 대각선으로 기울어졌었다. 지금은 바깥꼬리-아래중앙-안쪽꼬리 3점의 실제 y값을 그대로 이어
  // 아래 눈꺼풀 곡선을 따라가게 하고, 그 라인에서 아래쪽으로만 faceH*.035만큼 두께를 준다.
  poly(ribbon([lm[IDX.eyeOuterL], lm[IDX.eyeLidBotL], lm[IDX.eyeInnerL]], 0, faceH*.035), 'rgba(147,112,219,0.35)', '와잠(우)', waJRight);
  poly(ribbon([lm[IDX.eyeInnerR], lm[IDX.eyeLidBotR], lm[IDX.eyeOuterR]], 0, faceH*.035), 'rgba(147,112,219,0.35)', '와잠(좌)', waJLeft);

  poly([{x:lm[IDX.nasion].x-faceW*.04,y:lm[IDX.nasion].y-faceH*.02},{x:lm[IDX.nasion].x+faceW*.04,y:lm[IDX.nasion].y-faceH*.02},{x:lm[IDX.noseBridgeLower].x+faceW*.04,y:lm[IDX.noseBridgeLower].y+faceH*.02},{x:lm[IDX.noseBridgeLower].x-faceW*.04,y:lm[IDX.noseBridgeLower].y+faceH*.02}], 'rgba(100,200,255,0.35)', '산근', r.sanR);
  poly([{x:lm[IDX.alarL].x,y:lm[IDX.noseTip].y-faceH*.02},{x:lm[IDX.alarR].x,y:lm[IDX.noseTip].y-faceH*.02},{x:lm[IDX.alarR].x,y:lm[IDX.noseTip].y+faceH*.02},{x:lm[IDX.alarL].x,y:lm[IDX.noseTip].y+faceH*.02}], 'rgba(255,140,0,0.3)', '준두', r.junduR);
  poly([{x:lm[IDX.noseTip].x-faceW*.04,y:lm[IDX.noseTip].y},{x:lm[IDX.noseTip].x+faceW*.04,y:lm[IDX.noseTip].y},{x:lm[IDX.lipTopOuter].x+faceW*.04,y:lm[IDX.lipTopOuter].y},{x:lm[IDX.lipTopOuter].x-faceW*.04,y:lm[IDX.lipTopOuter].y}], 'rgba(50,205,50,0.3)', '인중', r.injR);
  // 법령도 좌우 각 실측값을 표기(평균값 r.beomR와는 별개) — 콧볼~입꼬리 선으로 근사(68점 시절과 마찬가지로 근사치)
  const beomRight = Math.hypot(lm[IDX.alarL].x-lm[IDX.mouthCornerL].x, lm[IDX.alarL].y-lm[IDX.mouthCornerL].y)/interocularDist;
  const beomLeft  = Math.hypot(lm[IDX.alarR].x-lm[IDX.mouthCornerR].x, lm[IDX.alarR].y-lm[IDX.mouthCornerR].y)/interocularDist;
  poly([lm[IDX.alarL],lm[IDX.mouthCornerL]], 'rgba(255,99,132,0.3)', '법령(우)', beomRight);
  poly([lm[IDX.alarR],lm[IDX.mouthCornerR]], 'rgba(255,99,132,0.3)', '법령(좌)', beomLeft);
  poly([{x:lm[IDX.jawTaperL].x,y:lm[IDX.jawTaperL].y},{x:lm[IDX.jawTaperR].x,y:lm[IDX.jawTaperR].y},{x:lm[IDX.chin].x,y:lm[IDX.chin].y+faceH*.02}], 'rgba(64,224,208,0.3)', '지각', r.jigakR);

  // 눈썹: 기존엔 양쪽 눈썹의 정점(browPeak) 2개와 안쪽 끝(browInner) 2개만으로 사다리꼴 하나를 그려서,
  // 바깥쪽 끝(browOuter)이 전혀 반영되지 않고 아래변이 미간 쪽 한 점으로 좁아지는 쐐기 모양이 됐다
  // (실제 사진으로 확인해보니 눈썹 바깥 절반이 폴리곤 밖으로 빠짐 — 버그 리포트 2026-08-13).
  // 지금은 눈썹마다 안쪽 끝-정점-바깥쪽 끝 3점을 이어 아치를 따라가는 띠로 좌우 각각 그린다.
  const browGapRight = (lm[IDX.eyeLidTopL].y - lm[IDX.browPeakL].y) / interocularDist;
  const browGapLeft  = (lm[IDX.eyeLidTopR].y - lm[IDX.browPeakR].y) / interocularDist;
  poly(ribbon([lm[IDX.browInnerL], lm[IDX.browPeakL], lm[IDX.browOuterL]], faceH*.025, faceH*.015), 'rgba(120,200,120,0.3)', '눈썹(우)', browGapRight);
  poly(ribbon([lm[IDX.browInnerR], lm[IDX.browPeakR], lm[IDX.browOuterR]], faceH*.025, faceH*.015), 'rgba(120,200,120,0.3)', '눈썹(좌)', browGapLeft);
  // 입: 입술 바깥 라인 전체
  poly([lm[IDX.mouthCornerL],lm[IDX.lipTopOuter],lm[IDX.mouthCornerR],lm[IDX.lipBotOuter]], 'rgba(255,160,220,0.3)', '입', r.mouthR);
  // 광대 — cheekL~jawTaper까지 이어지는 큰 사다리꼴로 그렸더니 poly()의 라벨이 그 사각형의 중심(무게중심)에
  // 찍혀서, 얼굴 폭 전체의 세로 중간 지점 즉 인중·준두 부근에 "광대" 글자가 얹히는 문제가 있었다(사용자
  // 스크린샷으로 확인, 2026-08-13). cheekW는 원래 좌우 폭(cheekL~cheekR 거리) 하나뿐인 값이라 좌우를
  // 다른 수치로 나눌 순 없지만, 대신 실제 광대뼈 랜드마크(cheekL·cheekR) 위치 각각에 작은 사각형을 그려
  // 라벨이 진짜 광대 위치(얼굴 양옆)에 찍히게 한다.
  const cheekBoxHalfW = faceW*.045, cheekBoxHalfH = faceH*.03;
  poly([
    {x:lm[IDX.cheekL].x-cheekBoxHalfW,y:lm[IDX.cheekL].y-cheekBoxHalfH},
    {x:lm[IDX.cheekL].x+cheekBoxHalfW,y:lm[IDX.cheekL].y-cheekBoxHalfH},
    {x:lm[IDX.cheekL].x+cheekBoxHalfW,y:lm[IDX.cheekL].y+cheekBoxHalfH},
    {x:lm[IDX.cheekL].x-cheekBoxHalfW,y:lm[IDX.cheekL].y+cheekBoxHalfH},
  ], 'rgba(255,210,120,0.3)', '광대', r.cheekR);
  poly([
    {x:lm[IDX.cheekR].x-cheekBoxHalfW,y:lm[IDX.cheekR].y-cheekBoxHalfH},
    {x:lm[IDX.cheekR].x+cheekBoxHalfW,y:lm[IDX.cheekR].y-cheekBoxHalfH},
    {x:lm[IDX.cheekR].x+cheekBoxHalfW,y:lm[IDX.cheekR].y+cheekBoxHalfH},
    {x:lm[IDX.cheekR].x-cheekBoxHalfW,y:lm[IDX.cheekR].y+cheekBoxHalfH},
  ], 'rgba(255,210,120,0.3)', '광대', r.cheekR);

  // 얼굴 크기 배지 — 캔버스 대비 얼굴폭 비율로 촬영 거리를 간단 체크(기존과 동일한 취지)
  const faceRatio = faceW / w;
  const ratioTag = faceRatio < 0.20 ? '⚠ 얼굴 너무 작음' : faceRatio > 0.85 ? '⚠ 얼굴 너무 가까움' : '✓ 비율 적정 (' + Math.round(faceRatio*100) + '%)';
  const badgeColor = (faceRatio < 0.20 || faceRatio > 0.85) ? 'rgba(220,60,60,0.85)' : 'rgba(20,180,100,0.85)';
  ctx.save();
  ctx.font = 'bold 12px sans-serif';
  const bw = ctx.measureText(ratioTag).width + 16;
  ctx.fillStyle = badgeColor;
  ctx.beginPath(); ctx.roundRect(8, 8, bw, 26, 6); ctx.fill();
  ctx.fillStyle = '#fff'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.fillText(ratioTag, 16, 21);
  ctx.restore();
}

// ── 관상 비율 추출 헬퍼 ──
// 판단기준 원칙(read/AI_관상_사진분석_판단기준_설계.md §0): 모든 비율은 "같은 얼굴 안의
// 두 지점 간 거리"로만 계산 — 절대 픽셀값이나 타인과의 비교를 쓰지 않는다.
// 분모를 faceW/faceH(바운딩박스 기반, 촬영 각도에 따라 흔들림) 대신 interocularDist(두 눈동자 중심 간
// 거리)·eyeToChinH(눈썹선~턱끝) 같은 "얼굴 내부의 안정적인 기준 단위"로 통일함 — 정면이 아니어도,
// 사진 해상도가 달라져도 비율이 크게 흔들리지 않는다.
function getGwansangRatios(lm) {
  const eyeCenterL = { x:(lm[IDX.eyeOuterL].x+lm[IDX.eyeInnerL].x)/2, y:(lm[IDX.eyeOuterL].y+lm[IDX.eyeInnerL].y)/2 };
  const eyeCenterR = { x:(lm[IDX.eyeInnerR].x+lm[IDX.eyeOuterR].x)/2, y:(lm[IDX.eyeInnerR].y+lm[IDX.eyeOuterR].y)/2 };
  const interocularDist = Math.hypot(eyeCenterR.x-eyeCenterL.x, eyeCenterR.y-eyeCenterL.y);
  const eyeWidthL = Math.hypot(lm[IDX.eyeOuterL].x-lm[IDX.eyeInnerL].x, lm[IDX.eyeOuterL].y-lm[IDX.eyeInnerL].y);
  const eyeWidthR = Math.hypot(lm[IDX.eyeInnerR].x-lm[IDX.eyeOuterR].x, lm[IDX.eyeInnerR].y-lm[IDX.eyeOuterR].y);
  const oneEyeWidth = (eyeWidthL+eyeWidthR)/2;
  const eyeHeightL = Math.abs(lm[IDX.eyeLidBotL].y-lm[IDX.eyeLidTopL].y);
  const eyeHeightR = Math.abs(lm[IDX.eyeLidBotR].y-lm[IDX.eyeLidTopR].y);
  const eyeH = (eyeHeightL+eyeHeightR)/2;

  const browY = (lm[IDX.browPeakL].y + lm[IDX.browPeakR].y) / 2;
  const eyeToChinH = Math.abs(lm[IDX.chin].y - browY);
  const foreheadH = Math.abs(browY - lm[IDX.hairline].y);

  const cheekW = Math.abs(lm[IDX.cheekR].x - lm[IDX.cheekL].x);
  const jawTaperW = Math.abs(lm[IDX.jawTaperR].x - lm[IDX.jawTaperL].x);
  const nostrilW = Math.abs(lm[IDX.alarR].x - lm[IDX.alarL].x);
  const mouthW = Math.abs(lm[IDX.mouthCornerR].x - lm[IDX.mouthCornerL].x);
  const browGapX = Math.abs(lm[IDX.browInnerR].x - lm[IDX.browInnerL].x);

  const browGapY = ((lm[IDX.eyeLidTopL].y - lm[IDX.browPeakL].y) + (lm[IDX.eyeLidTopR].y - lm[IDX.browPeakR].y)) / 2;
  const beomLenR = Math.hypot(lm[IDX.alarL].x-lm[IDX.mouthCornerL].x, lm[IDX.alarL].y-lm[IDX.mouthCornerL].y);
  const beomLenL = Math.hypot(lm[IDX.alarR].x-lm[IDX.mouthCornerR].x, lm[IDX.alarR].y-lm[IDX.mouthCornerR].y);

  // 관상_동물상_분류_버그_수정_디렉션_프롬프트.md 1단계 — 동물상(9종) 시그니처 매칭에 필요한 지표 추가
  const faceH = Math.abs(lm[IDX.chin].y - lm[IDX.hairline].y); // 얼굴 세로길이(헤어라인~턱끝) — lenR 계산용, classify 함수 밖으로 옮겨 한 곳에서만 계산
  const browLenL = Math.hypot(lm[IDX.browOuterL].x-lm[IDX.browInnerL].x, lm[IDX.browOuterL].y-lm[IDX.browInnerL].y);
  const browLenR_ = Math.hypot(lm[IDX.browOuterR].x-lm[IDX.browInnerR].x, lm[IDX.browOuterR].y-lm[IDX.browInnerR].y);

  // ── 부위별 생김새(이마·눈썹·눈크기·코·입·턱·얼굴형) 룰베이스 분류 전용 — 기존 5개 지표만으로는
  // 구분 못 하는 "모양" 축을 위해 추가한 지표. 16캐릭터 시스템(character/*.js)이 Gemini 분류 없이도
  // archetype-db.js의 7개 세부 DB를 채우기 위한 최소 세트이며, 전부 "이 지표가 크면 이런 모양 쪽으로
  // 치우쳤다"는 근사치다(정밀한 형태 인식이 아니라 랜드마크 좌표만으로 낸 값 — classifyForeheadTypeRuleBased 등 주석 참고).
  const foreheadW = Math.abs(lm[IDX.browPeakR].x - lm[IDX.browPeakL].x); // 이마 폭(눈썹 정점 간 거리로 근사)
  const foreheadWR = cheekW ? foreheadW / cheekW : 0;                     // 이마 폭 ÷ 광대 폭 — 넓은/좁은 이마 판별용
  const browTiltY = ((lm[IDX.browPeakL].y - (lm[IDX.browInnerL].y+lm[IDX.browOuterL].y)/2) + (lm[IDX.browPeakR].y - (lm[IDX.browInnerR].y+lm[IDX.browOuterR].y)/2)) / 2;
  const browTiltR = interocularDist ? browTiltY / interocularDist : 0;   // 아치 정도(정점이 안쪽·바깥쪽 평균보다 얼마나 솟았는지) — 음수=아치형(반달), 0에 가까움=평평/삼각형
  // 참고자료(관상 MBTI 이마·눈썹·눈·코·입·턱 슬라이드)의 "올라간 눈썹" 아이콘은 아치가 아니라 안쪽→바깥쪽으로
  // 이어지는 대각선(전체 기울기)이었다 — browTiltR(아치)과는 다른 축이라 별도로 둔다.
  const browSlopeY = ((lm[IDX.browOuterL].y - lm[IDX.browInnerL].y) + (lm[IDX.browOuterR].y - lm[IDX.browInnerR].y)) / 2;
  const browSlopeR = interocularDist ? browSlopeY / interocularDist : 0; // 음수=바깥쪽이 안쪽보다 높음(올라간 눈썹), 양수=바깥쪽이 낮음(처진 눈썹)
  const innerEyeGapR = oneEyeWidth ? Math.abs(lm[IDX.eyeInnerR].x-lm[IDX.eyeInnerL].x) / oneEyeWidth : 0; // 미간이 아니라 "두 눈 사이"(원거리안/근거리안) 판별용
  const eyeTiltY = ((lm[IDX.eyeOuterL].y - lm[IDX.eyeInnerL].y) + (lm[IDX.eyeOuterR].y - lm[IDX.eyeInnerR].y)) / 2;
  const eyeTiltR = interocularDist ? eyeTiltY / interocularDist : 0;     // 음수=치켜올라간 눈, 양수=처진 눈
  const lipThickR = interocularDist ? (Math.abs(lm[IDX.lipTopOuter].y-lm[IDX.lipCenterline].y) + Math.abs(lm[IDX.lipCenterline].y-lm[IDX.lipBotOuter].y)) / interocularDist : 0;
  const mouthTiltY = ((lm[IDX.mouthCornerL].y + lm[IDX.mouthCornerR].y)/2) - lm[IDX.lipCenterline].y;
  const mouthTiltR = interocularDist ? mouthTiltY / interocularDist : 0; // 음수=입꼬리가 중심보다 위(올라간 입), 양수=처진 입
  const chinHeightR = interocularDist ? Math.abs(lm[IDX.chin].y - (lm[IDX.jawTaperL].y+lm[IDX.jawTaperR].y)/2) / interocularDist : 0; // 턱 끝~턱선 세로 길이(긴 턱/짧은 턱)

  return {
    // 사용자 제시 3단계 정규화 표와 동일한 5개 지표(이마·미간·코끝·입·턱선)
    gwanR:  foreheadH / eyeToChinH,                 // 이마(관록궁) = 이마 세로높이 ÷ 눈-턱 세로거리
    mgW:    browGapX / oneEyeWidth,                 // 미간(명궁) = 양 눈썹 사이 거리 ÷ 한쪽 눈 가로길이
    junduR: nostrilW / interocularDist,              // 코끝(재백궁) = 콧볼 가로폭 ÷ 양 눈 사이 거리
    mouthR: mouthW / interocularDist,                // 입(출납관) = 입 가로폭 ÷ 양 눈동자 중심간 거리
    jigakR: jawTaperW / cheekW,                      // 턱선(지각) = 턱선 가로폭 ÷ 광대뼈 가로폭
    // 그 외 기존 부위 — 같은 원칙(같은 얼굴 안 거리 비율)으로 재계산
    waJ:      eyeH / interocularDist,                        // 와잠(눈 밑 두께)
    sanR:     Math.abs(lm[IDX.noseBridgeLower].y-lm[IDX.nasion].y) / interocularDist, // 산근
    injR:     Math.abs(lm[IDX.lipTopOuter].y-lm[IDX.noseTip].y) / interocularDist,    // 인중
    beomR:    (beomLenR+beomLenL)/2 / interocularDist,        // 법령(콧볼~입꼬리 선 근사, 68점 시절과 동일한 근사 방식)
    browGapR: eyeH ? browGapY / eyeH : 0,                     // 눈썹-눈 간격 ÷ 눈높이(이미 部/部 비율이라 분모 교체 불필요)
    cheekR:   cheekW / interocularDist,                       // 광대 — "얼굴이 눈 사이 거리 대비 얼마나 넓은지"
    // 동물상(9종/13종) 시그니처 매칭 전용 — classifyFaceArchetypeRuleBased에서 중복 계산하던 lenR을 여기로 통합
    lenR:     cheekW ? faceH / cheekW : 0,                     // 얼굴 세로/가로 비율 (마상·학상 판별용)
    noseLenR: Math.abs(lm[IDX.noseTip].y-lm[IDX.nasion].y) / interocularDist, // 코 길이(산근~코끝) — 마상/상상/봉상 판별용
    browLenR: oneEyeWidth ? ((browLenL+browLenR_)/2) / oneEyeWidth : 0,       // 눈썹 길이 ÷ 눈 가로길이 — 봉상 판별용(1보다 크면 "눈썹이 눈보다 길다")
    // 부위별 생김새(이마/눈썹/눈크기/코/입/턱/얼굴형) 룰베이스 분류 전용 지표
    foreheadWR, browTiltR, browSlopeR, innerEyeGapR, eyeTiltR, lipThickR, mouthTiltR, chinHeightR,
    __interocularDist: interocularDist, // drawRegions에서 좌우 실측 라벨을 그릴 때 재사용(외부에서 직접 쓰지 않는 내부용 값)
  };
}

// ── 부위별 3단계(Narrow/Standard/Wide) 정규화 — 사용자 제시 기준표 그대로 구현 ──
// ⚠️ 임계값은 전통 관상학 삼정 기준 + 미용성형 황금비율을 참고한 "초안"이며, FACE_OHAENG_RANGE와
// 마찬가지로 실측 데이터가 쌓이면 보정이 필요하다(자체 판단으로 확정한 기준 아님).
const GWANSANG_3TIER_THRESHOLDS = {
  이마:  { key:'gwanR',  low:0.45, high:0.58, labels:['신중형','황금비율','리더형'] },
  미간:  { key:'mgW',    low:0.80, high:1.20, labels:['집중형','포용형','여유형'] },
  코끝:  { key:'junduR', low:0.85, high:1.10, labels:['절약형','실속형','대범형'] },
  입:    { key:'mouthR', low:0.80, high:1.05, labels:['절제형','균형형','표현형'] },
  턱선:  { key:'jigakR', low:0.65, high:0.80, labels:['감성형','안정형','지구력형'] },
};
function classifyGwansang3Tier(ratios) {
  const result = {};
  Object.entries(GWANSANG_3TIER_THRESHOLDS).forEach(([part, cfg]) => {
    const v = ratios[cfg.key];
    const tier = v < cfg.low ? 0 : v > cfg.high ? 2 : 1;
    result[part] = { value: v, tierLabel: ['좁음/낮음','표준','넓음/높음'][tier], typeLabel: cfg.labels[tier] };
  });
  return result;
}

// ── 삼정(三停) 비율 — 상정(초년/이마)·중정(중년/코)·하정(말년/턱)을 얼굴 세로길이 대비 %로 (설계문서 §3) ──
// 상정의 시작점을 예전엔 얼굴 박스 상단(≈눈썹 y좌표, 버그)으로 썼는데 이제 실제 헤어라인(idx10)으로 계산한다.
function calcSamjeongRatio(lm) {
  const browY = (lm[IDX.browPeakL].y + lm[IDX.browPeakR].y) / 2;
  const noseTipY = lm[IDX.noseTip].y;
  const chinY = lm[IDX.chin].y;
  const sang = browY - lm[IDX.hairline].y;
  const jung = noseTipY - browY;
  const ha = chinY - noseTipY;
  const total = sang + jung + ha;
  return {
    sangjeong: Math.round(sang / total * 100),
    jungjeong: Math.round(jung / total * 100),
    hajeong: Math.round(ha / total * 100),
  };
}

// ── 좌우 비대칭 — 왼쪽(화면 기준 좌측)=내면, 오른쪽=사회적 모습으로 대비 (설계문서 §4) ──
// 셀카 좌우반전 이슈로 "실제 신체 좌/우"가 아닌 "화면에 보이는 좌/우"로 통일 정의함(문서의 주의사항 반영).
// EXIF 자동보정(createImageBitmap) + 수동 반전 토글(toggleMirror)을 거친 뒤의 화면 기준이라는 점은 동일.
function calcAsymmetry(lm) {
  const eyeCenterL = { y:(lm[IDX.eyeOuterL].y+lm[IDX.eyeInnerL].y)/2 };
  const eyeCenterR = { y:(lm[IDX.eyeInnerR].y+lm[IDX.eyeOuterR].y)/2 };
  const interocularDist = Math.hypot(
    (lm[IDX.eyeInnerR].x+lm[IDX.eyeOuterR].x)/2 - (lm[IDX.eyeOuterL].x+lm[IDX.eyeInnerL].x)/2,
    (lm[IDX.eyeInnerR].y+lm[IDX.eyeOuterR].y)/2 - (lm[IDX.eyeOuterL].y+lm[IDX.eyeInnerL].y)/2
  );
  const pairs = [
    { label:'눈 높이', leftY: eyeCenterL.y, rightY: eyeCenterR.y },
    { label:'눈썹 높이', leftY: lm[IDX.browPeakL].y, rightY: lm[IDX.browPeakR].y },
    { label:'입꼬리 높이', leftY: lm[IDX.mouthCornerL].y, rightY: lm[IDX.mouthCornerR].y },
  ];
  return pairs.map(p => ({
    label: p.label,
    leftHigher: p.leftY < p.rightY, // y가 작을수록(위쪽) 더 올라간 것
    diffRatio: Math.round(Math.abs(p.leftY - p.rightY) / interocularDist * 1000) / 1000,
  }));
}

// ── 관상 오행(얼굴형 기반 목화토금수 %) — 사주오행과는 별개의 지표 (설계문서 §5, 초안 가중치) ──
// R1~R4 각각을 자체 범위 안에서 0~100으로 정규화한 뒤 7단계 밴드로 나눠 오행 가중치를 합산.
// ⚠️ 2026-08-24 전면 재설계(사용자 리포트: "다들 화가 많고 수는 적고 금은 많게 나온다") — 원인 2가지를
// 실측·시뮬레이션으로 확인 후 고쳤다.
// [원인1] 예전엔 R2/R4, R3/R5가 완전히 같은 값(턱폭 비율, 이마폭 비율)을 재사용해서 실질 독립
// 측정치가 3개뿐이었다. → AI_Face_Read 폴더 실제 사진 5장으로 MediaPipe 좌표를 직접 찍어 확인한 결과,
// jawTaperL/R(172/397)를 꼭짓점으로 cheekL/R↔chin 사이 각도(턱선이 완만하게 이어지는지 뾰족하게
// 꺾이는지)가 얼굴마다 126~142도로 실제 차이가 났다 — 이걸 4번째 독립 신호(R4, 각짐 정도)로 신설해
// 토/금/수를 서로 다른 원본 데이터로 구분한다(예전엔 이 셋이 사실상 하나의 값을 나눠 썼음).
// [원인2] 가중치 총합 자체가 화(3.1)·금(3.0) vs 토(1.8)·수(1.4)로 처음부터 불균형해서, "완전 평균적인"
// 얼굴을 넣어도 항상 화>금>목>토>수 순서가 고정적으로 나왔다(무작위 2000명 시뮬레이션에서 토·수가
// 1위인 경우가 0건). 아래 가중치는 오행별 총합이 2.0~2.2로 균등해지도록 재분배했고, 화형 방향도
// 전통 관상론(마의상법 계열, "이마 좁고 턱 뾰족한 역삼각·다이아몬드형") 기준으로 이마폭이 넓을수록가
// 아니라 좁을수록 화에 가깝게 뒤집었다. 재분배 후 5000명 무작위 시뮬레이션 평균 %는 19~21.5%로
// 고르게 나옴을 확인함(예전엔 7~34%로 3배 이상 벌어져 있었음).
// direction: 'high'=범위 안에서 값이 클수록 그 오행에 유리, 'low'=작을수록 유리.
const FACE_OHAENG_RANGE = { R1:[0.9,1.5], R2:[0.55,0.95], R3:[0.45,0.85], R4:[115,155] };
const FACE_OHAENG_WEIGHT = {
  // R1(세로/가로 비) 높음=얼굴이 길다 → 목형. 낮음(짧고 넓적)은 토형 보조 신호.
  R1: { 목:[1.5,'high'], 토:[0.8,'low'] },
  // R2(턱폭/볼폭 비) 낮음=턱이 급격히 좁아짐(뾰족) → 화형. 높음(안 좁아짐, 넓적 유지)은 토/금/수
  // 공통 후보 신호 — 이 셋은 R4(각짐)로 다시 갈린다.
  R2: { 화:[1.2,'low'], 토:[0.8,'high'], 금:[0.8,'high'], 수:[0.8,'high'] },
  // R3(이마폭/볼폭 비) 낮음=이마가 좁다 → 화형(상협하첨). 높음은 목형 보조 신호.
  R3: { 화:[1.0,'low'], 목:[0.5,'high'] },
  // R4(jawTaper 각도, cheek-jawTaper-chin) 낮음=꺾임이 뚜렷(각짐) → 금형. 높음=완만한 곡선(둥긂/두터움)
  // → 수형·토형. 실측 검증(AI_Face_Read 5장): 갸름한 얼굴 141~142도, 각진/넓적한 얼굴 127도.
  R4: { 금:[1.2,'low'], 수:[1.2,'high'], 토:[0.6,'high'] },
};
// ⚠️ 버그 수정(2026-08-20 사용자 리포트: 궁합보기 "관상오행 비교"에서 나/상대방 %가 완전히 똑같게
// 나옴) — 저/중/고 3단계뿐이면 조합이 3×3×3=27가지밖에 안 나오고, 대부분의 "평범한" 얼굴 비율이
// 중간 밴드에 몰려서 서로 다른 두 사람이 자주 똑같은 결과를 받았다. 7단계로 세분화해 충돌 확률을
// 낮춘다 — 순위(우열)를 정하는 방식 자체는 그대로 두고 구간만 촘촘하게 나눈다.
const OHAENG_BAND_MULS = [0.1, 0.25, 0.4, 0.55, 0.7, 0.85, 1.0];
function ohaengBandMul(level) {
  const idx = Math.min(OHAENG_BAND_MULS.length - 1, Math.floor(level / (100 / OHAENG_BAND_MULS.length)));
  return OHAENG_BAND_MULS[idx];
}
// jawTaper를 꼭짓점으로 cheek↔chin 두 점이 이루는 각도(도) — 180도에 가까울수록 세 점이 일직선(매끈하게
// 좁아지는 갸름한 턱), 각도가 작을수록 그 지점에서 뚜렷하게 꺾인다(각지거나 두꺼운 턱).
function jawCornerAngleDeg(vertex, a, b) {
  const v1 = { x: a.x - vertex.x, y: a.y - vertex.y };
  const v2 = { x: b.x - vertex.x, y: b.y - vertex.y };
  const dot = v1.x * v2.x + v1.y * v2.y;
  const m1 = Math.hypot(v1.x, v1.y), m2 = Math.hypot(v2.x, v2.y);
  if (!m1 || !m2) return 140; // 좌표가 겹치는 등 예외 상황엔 중간값(대략 평균 각도)으로 폴백
  return Math.acos(Math.max(-1, Math.min(1, dot / (m1 * m2)))) * 180 / Math.PI;
}
function calcFaceOhaeng(lm) {
  const faceH = Math.abs(lm[IDX.chin].y - lm[IDX.hairline].y);
  const cheekW = Math.abs(lm[IDX.cheekR].x - lm[IDX.cheekL].x);
  const jawTaperW = Math.abs(lm[IDX.jawTaperR].x - lm[IDX.jawTaperL].x);
  const foreheadW = Math.abs(lm[IDX.browPeakR].x - lm[IDX.browPeakL].x);
  const angleL = jawCornerAngleDeg(lm[IDX.jawTaperL], lm[IDX.cheekL], lm[IDX.chin]);
  const angleR = jawCornerAngleDeg(lm[IDX.jawTaperR], lm[IDX.cheekR], lm[IDX.chin]);
  const raw = {
    R1: faceH / cheekW,
    R2: jawTaperW / cheekW,
    R3: foreheadW / cheekW,
    R4: (angleL + angleR) / 2,
  };
  // 각 R값을 자체 범위 안에서 0~100 레벨로 정규화(direction:'low'면 레벨을 뒤집음) → 7단계 밴드
  // 가중치를 오행별로 합산.
  const totals = { 목:0, 화:0, 토:0, 금:0, 수:0 };
  Object.entries(raw).forEach(([key, value]) => {
    const [min, max] = FACE_OHAENG_RANGE[key];
    const level = Math.max(0, Math.min(100, (value - min) / (max - min) * 100));
    Object.entries(FACE_OHAENG_WEIGHT[key]).forEach(([oh, [w, dir]]) => {
      const usedLevel = dir === 'low' ? (100 - level) : level;
      totals[oh] += w * ohaengBandMul(usedLevel);
    });
  });
  const sum = Object.values(totals).reduce((a, b) => a + b, 0) || 1;
  const percent = {};
  Object.entries(totals).forEach(([oh, v]) => { percent[oh] = v / sum * 100; });

  // 대비 강조(Contrast Boost) — 실측 기반 순위는 그대로 두되, 1위를 더 도드라지게·꼴찌를 더 낮게 보정한다.
  // 원래 계산만으로는 실제 얼굴 대부분이 15~28% 사이로 몰려서 "이 사람은 확실히 화형이다" 같은 뚜렷한
  // 인상을 주지 못했다(버그 리포트 2번 항목, 2026-08-13). 순위(상대적 우열)는 실측값 그대로 보존하고
  // 크기 차이만 키우는 방식이라 판단 자체를 왜곡하지 않는다.
  const RANK_BOOST = [1.35, 1.15, 1.0, 0.85, 0.65];
  const ranked = Object.entries(percent).sort((a, b) => b[1] - a[1]);
  const boosted = {};
  ranked.forEach(([oh, v], i) => { boosted[oh] = v * RANK_BOOST[i]; });
  const boostedSum = Object.values(boosted).reduce((a, b) => a + b, 0) || 1;
  const finalPercent = {};
  Object.entries(boosted).forEach(([oh, v]) => { finalPercent[oh] = Math.round(v / boostedSum * 100); });
  return finalPercent;
}

// ═══ Gemini 미연동/실패 시 룰베이스 약식 분류 — read/관상 형상 예시.md의 13종 눈/9종 동물형상 중 근접한 ID 추정 ═══
// 사진을 직접 "보는" 게 아니라 좌표만으로 판별하는 약식 추정이라 정밀하지 않다. ai-analysis.js에서
// 이 함수의 결과에는 항상 "약식 추정" 배지를 붙여 AI 판별과 구분한다(과신 방지, 관상 형상 예시.md §5 원칙).
// ═══ 룰베이스 동물상/눈모양 분류 — "최근접 시그니처 매칭" 방식 ═══
// (관상_동물상_분류_버그_수정_디렉션_프롬프트.md 2단계) 예전엔 순차 if문 + 캐치올 디폴트라 9종/13종 중
// 일부(FACE_DRAGON·FACE_TIGER, EYE_DRAGON 등)로만 결과가 쏠리고 나머지는 코드상 도달 불가능이었다.
// 지금은 각 유형에 "이 유형이면 각 비율이 대략 이 값"이라는 시그니처(비율 벡터)를 정의해두고,
// 실제 비율과 상대오차가 가장 작은 유형 하나를 고른다 — 항상 전체 유형이 후보이고 죽은 분기가 없다.
// ⚠️ 아래 시그니처 수치는 archetype-db.js의 텍스트 설명(easyName/features/traditional)을 근거로 추론한
// "초안"이다. 실제 사진 없이 만든 값이라 정확하지 않을 수 있음 — 동의 얻은 샘플 사진들의 실측 평균값으로
// 재보정이 필요하다(디렉션 문서 3단계). 지금은 샘플이 전혀 없어 초안 그대로다.
// 지표별 "스케일" — 그 시그니처 표 안에서 유형들이 퍼져 있는 폭(max-min).
// 예전엔 오차를 기준값(sig[dim])으로 나눴는데 두 가지 문제가 있었다(2026-08-17 수정):
//  ① 기준값이 0이면 나눌 수 없어 `if (!sig[dim]) continue`로 그 축을 통째로 건너뛰었다 —
//     EYE_SIGNATURES의 tilt:0인 용안·학안·안안·음양안은 눈꼬리 기울기를 아예 안 보고,
//     tilt가 0이 아닌 우안·구안 등만 3개 축으로 평가돼 애초에 같은 기준의 비교가 아니었다.
//  ② 기준값이 작은 지표(tilt:1)는 조금만 어긋나도 상대오차가 폭발하고, 큰 지표(aspect:4.4)는
//     같은 크기로 어긋나도 페널티가 작았다 — 지표마다 영향력이 제멋대로였다.
// 유형 간 퍼짐폭으로 나누면 두 문제가 함께 풀린다. 모든 유형이 같은 값인 지표는 애초에 유형을
// 구분해주지 못하므로(폭 0) 계산에서 뺀다.
const __sigScaleCache = new WeakMap();
function signatureScales(signatures) {
  let cached = __sigScaleCache.get(signatures);
  if (cached) return cached;
  const minMax = {};
  for (const sig of Object.values(signatures)) {
    for (const [dim, v] of Object.entries(sig)) {
      if (v == null) continue;
      if (!minMax[dim]) minMax[dim] = { min: v, max: v };
      else { minMax[dim].min = Math.min(minMax[dim].min, v); minMax[dim].max = Math.max(minMax[dim].max, v); }
    }
  }
  const scales = {};
  for (const [dim, mm] of Object.entries(minMax)) {
    const span = mm.max - mm.min;
    // 퍼짐폭이 0인 경우 = 그 지표를 유형 하나만 쓰거나(예: EYEBROW의 browTiltR은 EB_CRESCENT 전용)
    // 모든 유형이 같은 값인 경우. 앞쪽은 "그 유형만의 결정적 근거"라 절대 버리면 안 된다 —
    // 버렸더니 EB_CRESCENT(반달 눈썹)가 쓸 지표를 다 잃어 아예 선택 불가능해졌다(검증 중 발견).
    // 그래서 폭이 없으면 기준값 크기를 스케일로 쓰고(예전 방식과 동일), 그마저 0이면 1로 둔다.
    scales[dim] = span > 0 ? span : (Math.abs(mm.max) || 1);
  }
  __sigScaleCache.set(signatures, scales);
  return scales;
}
function scoreAgainstSignature(ratios, sig, scales) {
  let score = 0, n = 0;
  for (const dim of Object.keys(sig)) {
    if (ratios[dim] == null || sig[dim] == null || !scales[dim]) continue; // 값 0도 정상 기준값으로 취급
    score += -Math.abs(ratios[dim] - sig[dim]) / scales[dim];
    n++;
  }
  return n === 0 ? null : score / n; // 유형마다 지표 개수가 달라도 공정하게 비교되도록 정규화
}
function nearestSignatureMatch(ratios, signatures) {
  const scales = signatureScales(signatures);
  let best = null, bestScore = -Infinity;
  for (const [id, sig] of Object.entries(signatures)) {
    const score = scoreAgainstSignature(ratios, sig, scales);
    if (score == null) continue;
    if (score > bestScore) { bestScore = score; best = id; }
  }
  return best;
}

// ⚠️ 2026-08-17 축 중심 재보정 — 기획서/ 폴더의 실제 사진 3장(jungwon·juyeon·yg)을 MediaPipe로
// 측정해보니 두 축이 통째로 어긋나 있었다.
//   tilt: 초안은 "0이 중립"으로 뒀는데 실측은 -10.1 ~ -2.4(평균 -6.6)였다. 눈 바깥꼬리가 안쪽보다
//         살짝 높은 게 대다수 사람의 기본값이라, 0을 중립으로 두면 실측이 전부 시그니처 범위 밖
//         (가장 음수인 호안·명봉안 -5)으로 밀려 그쪽으로만 판정됐다. → 전 유형 -5.8 이동.
//   waJ:  초안 평균 0.228 vs 실측 평균 0.146. 실측이 전부 하단(사안 0.14·학안 0.16)에 붙어 그쪽으로
//         쏠렸다. → 전 유형 -0.082 이동.
//   aspect: 초안 평균 3.19 vs 실측 평균 3.18 — 이미 맞아서 건드리지 않았다.
// 유형 간 상대 순서·간격(= 관상학적 의미)은 그대로 두고 축 중심만 옮겼다.
// ⚠️ 표본이 3장뿐이라 "축이 통째로 치우친 것"만 교정한 것이고, 유형별 값의 정확도는 여전히 초안이다.
// 동의받은 샘플이 수십 장 쌓이면 유형별 실측 평균으로 다시 잡아야 한다(퍼짐폭도 그때 재산정).
// ⚠️ 2026-08-18 재작성 — 이전 값은 "실측 사진 없이 만든 초안"이라 실제 분포와 어긋나 있었다.
// 사진 69장을 측정한 결과 tilt는 대부분 -0.2~-3.8에 몰려 있는데 시그니처는 -2.8~-10.8에 퍼져 있어
// 이 축으로는 사실상 구분이 안 됐고, 그래서 눈 물형 판별 신뢰도가 평균 0.149(통과 0/69)였다.
// 아래 값은 실측 사분위수 위에 archetype-db.js의 형태 묘사를 배치한 것이다.
//   실측 분포(n=69):  aspect 2.47~9.75(중앙 3.28) · tilt -11.6~-0.2(중앙 -2.33)
//                     waJ 0.049~0.189(중앙 0.138) · size 0.63~0.85(중앙 0.729) · asym 0.001~0.377(중앙 0.066)
// size(눈 자체의 크기)와 asym(좌우 비대칭)을 새로 넣었다 — 특히 asym이 없으면 음양안은 원리상
// 절대 뽑히지 않는다("좌우 눈의 크기가 조금 다를 수 있어요"가 유일한 판별 근거이므로).
// curve(눈꺼풀 곡률)는 측정해봤지만 69장 전체가 1.100~1.135에 몰려 변별력이 없어 쓰지 않는다.
const EYE_SIGNATURES = {
  // aspect 가로/세로 · tilt 꼬리기울기(음수=치켜) · waJ 두께 · size 눈폭/눈사이거리
  // asym 좌우차 · iris 눈동자크기/눈폭 · expo 눈꺼풀높이/홍채세로(클수록 크게 뜬 눈) · peak 윗꺼풀 최고점 쏠림
  // 실측 p10/중앙/p90 (n=69):
  //   aspect 2.65/3.28/4.68 · tilt -5.5/-2.33/-1.06 · waJ 0.094/0.138/0.173 · size 0.663/0.729/0.786
  //   asym 0.009/0.066/0.189 · iris 0.406/0.437/0.467 · expo 0.441/0.636/0.765 · peak 0.072/0.090/0.157
  EYE_OX:           { aspect:2.65, tilt:-1.5, waJ:0.173, size:0.786, asym:0.05,  iris:0.494, expo:0.80, peak:0.075 }, // 우안: 눈 자체가 크고 눈동자가 둥글고 크다
  EYE_PEACH:        { aspect:2.90, tilt:-1.1, waJ:0.160, size:0.740, asym:0.05,  iris:0.470, expo:0.70, peak:0.072 }, // 도화안: 부드러운 곡선, 살짝 처짐
  EYE_DRAGON:       { aspect:3.00, tilt:-2.3, waJ:0.150, size:0.770, asym:0.03,  iris:0.467, expo:0.68, peak:0.085 }, // 용안: 눈동자 크고 또렷, 흐트러짐 적음
  EYE_LION:         { aspect:3.00, tilt:-3.5, waJ:0.165, size:0.786, asym:0.05,  iris:0.460, expo:0.70, peak:0.090 }, // 사자안: 존재감 뚜렷, 당당한 힘
  EYE_TIGER:        { aspect:3.10, tilt:-5.5, waJ:0.155, size:0.750, asym:0.05,  iris:0.450, expo:0.72, peak:0.100 }, // 호안: 치켜올라가고 부릅뜬 집중
  EYE_TURTLE:       { aspect:3.20, tilt:-1.2, waJ:0.135, size:0.700, asym:0.05,  iris:0.445, expo:0.60, peak:0.080 }, // 구안: 기울기가 과하지 않고 차분
  EYE_LUAN:         { aspect:3.30, tilt:-2.0, waJ:0.145, size:0.740, asym:0.04,  iris:0.440, expo:0.64, peak:0.090 }, // 난안: 깨끗하고 수려한 곡선
  EYE_YINYANG:      { aspect:3.30, tilt:-2.5, waJ:0.138, size:0.720, asym:0.30,  iris:0.437, expo:0.636, peak:0.090 }, // 음양안: 좌우 차이가 유일한 판별점
  EYE_GOOSE:        { aspect:3.50, tilt:-2.3, waJ:0.125, size:0.730, asym:0.008, iris:0.430, expo:0.60, peak:0.090 }, // 안안: 좌우 균형이 특히 좋다
  EYE_PHOENIX:      { aspect:4.00, tilt:-3.0, waJ:0.110, size:0.720, asym:0.05,  iris:0.415, expo:0.50, peak:0.150 }, // 봉안: 가로로 길고 꼬리가 섬세하게 빠짐
  EYE_SING_PHOENIX: { aspect:4.40, tilt:-4.0, waJ:0.100, size:0.710, asym:0.05,  iris:0.405, expo:0.46, peak:0.160 }, // 명봉안: 봉안보다 더 길고 또렷
  EYE_CRANE:        { aspect:4.70, tilt:-2.0, waJ:0.094, size:0.680, asym:0.05,  iris:0.400, expo:0.42, peak:0.120 }, // 학안: 가늘고 길며 차분
  EYE_SNAKE:        { aspect:5.50, tilt:-3.0, waJ:0.070, size:0.663, asym:0.05,  iris:0.383, expo:0.30, peak:0.130 }, // 사안: 가장 가늘고 길며 날카로움
};
// 눈 높이(위/아래 눈꺼풀 간격) — 눈꺼풀 3쌍의 평균. 한 쌍(159/145)만 쓰면 그 점 하나의 오차가
// aspect 전체를 좌우해 눈 유형이 반대편으로 뒤집힌다(우안 aspect 2.1 ↔ 학안 4.4).
// 3쌍은 눈 안쪽·가운데·바깥쪽에 걸쳐 있어 평균을 내면 국소 노이즈가 상쇄된다.
// ⚠️ 사진 찍는 순간 눈을 크게 떴는지 가늘게 떴는지에 따라 값이 달라지는 것 자체는 이걸로도 못 없앤다 —
// 그건 시그니처를 실측 평균으로 재보정해야 줄어든다(EYE_SIGNATURES 상단 주석 참고).
function eyeLidHeight(lm, pairs) {
  let sum = 0, n = 0;
  for (const [top, bot] of pairs) {
    if (!lm[top] || !lm[bot]) continue;
    sum += Math.abs(lm[bot].y - lm[top].y); n++;
  }
  return n ? (sum / n) || 1 : 1;
}
function eyeAspect(lm) {
  const wL = Math.hypot(lm[IDX.eyeOuterL].x-lm[IDX.eyeInnerL].x, lm[IDX.eyeOuterL].y-lm[IDX.eyeInnerL].y);
  const wR = Math.hypot(lm[IDX.eyeInnerR].x-lm[IDX.eyeOuterR].x, lm[IDX.eyeInnerR].y-lm[IDX.eyeOuterR].y);
  const hL = eyeLidHeight(lm, IDX.eyeLidPairsL);
  const hR = eyeLidHeight(lm, IDX.eyeLidPairsR);
  return ((wL/hL)+(wR/hR))/2; // 클수록 가늘고 긴 눈, 작을수록 크고 둥근 눈
}
function classifyEyeArchetypeRuleBased(lm) {
  const r = getGwansangRatios(lm);
  const aspect = eyeAspect(lm);
  // 양수 = 바깥꼬리가 안쪽꼬리보다 아래(처진 눈), 음수 = 바깥꼬리가 올라감(치켜올라간 눈)
  const tilt = ((lm[IDX.eyeOuterL].y - lm[IDX.eyeInnerL].y) + (lm[IDX.eyeOuterR].y - lm[IDX.eyeInnerR].y)) / 2;
  return nearestSignatureMatch({ aspect, tilt, waJ: r.waJ }, EYE_SIGNATURES) || 'EYE_DRAGON';
}

// ⚠️ 2026-08-18 재작성 — 이전 값 상당수가 실측 범위를 완전히 벗어나 있었다(사진 69장 측정 결과).
//   gwanR 1.00 vs 실측 0.17~0.22(5배) · browGapR 0.32~0.40 vs 1.85~3.43(1/8)
//   waJ 0.34 vs 0.09~0.17 · mouthR 1.35 vs 0.70~0.97 · noseLenR 0.95~1.05 vs 0.65~0.81
//   cheekR 1.70~1.75 vs 2.07~2.45
// 범위 밖 기준값을 쓰면 그 지표를 가진 유형은 어떤 얼굴에도 큰 페널티를 받아 사실상 후보에서 빠진다.
//
// 값은 실측 p10/중앙/p90 위에 물형관상 자료의 형태 서술을 배치해 다시 잡았다. 한 부위만 보던 것을
// 여러 부위 조합으로 넓힌 것도 그 자료를 따른 것이다(예: 사자상 = 넓은 얼굴 + 먼 눈 사이 + 넓은
// 콧방울 + 큰 입, 호상 = 큰 눈 + 굵은 인중 + 큰 입 + 눈썹-눈 가까움).
// 실측 기준선(p10/중앙/p90):
//   lenR 1.12/1.18/1.23 · cheekR 2.07/2.28/2.45 · jigakR 0.75/0.79/0.82 · mgW 0.96/1.03/1.10
//   junduR 0.60/0.66/0.72 · mouthR 0.70/0.82/0.97 · waJ 0.09/0.14/0.17 · injR 0.27/0.33/0.40
//   noseLenR 0.65/0.73/0.81 · browLenR 1.46/1.57/1.66 · browGapR 1.85/2.56/3.43 · gwanR 0.17/0.19/0.22
// ⚠️ 2026-08-18 실험 후 원복 — 위 실측 기준선에 맞춰 값을 다시 잡고 부위 조합을 넓혀봤으나
// 오히려 나빠져서 되돌렸다(통과율 74%→46%, 캐릭터 15종→12종, FACE_DRAGON이 69장 중 32장 차지).
// 원인: 용상을 전 지표 중앙값으로 두면 "평균에 가장 가까운 얼굴"이 전부 용상으로 흡수된다.
// 균형형 후보는 다른 유형과 같은 방식으로 중앙에 두면 안 되고, 별도 판정(예: 분산이 작을 때만
// 후보로 올리는 규칙)이 필요하다. 아래 값은 실측 범위를 벗어난 지표가 섞여 있지만(gwanR·browGapR 등)
// 그 페널티가 결과적으로 유형 간 균형을 잡아주고 있어, 근거를 갖추기 전까지는 건드리지 않는다.
// ⚠️ 2026-09-03: 백분위(0~1) 표현으로 재작성 — "분류 방식 전면 개편" 주석 참고. 2026-08-18에 "균형형
// FACE_DRAGON을 중앙값에 두면 평균에 가까운 얼굴이 전부 흡수된다"는 이유로 실측 재보정을 포기하고
// 원복했던 적이 있는데(바로 위 2026-08-18 주석), 그건 "실측값 자체"가 문제가 아니라 FACE_DRAGON을
// 다른 8종과 같은 방식(중앙 근처)으로 배치한 게 문제였다. 백분위 축에서 9종을 lenR 기준 완전히
// 고르게(0.03~0.97, 약 12%씩) 늘어놓고 FACE_DRAGON도 "그중 하나"로만 취급하니 73장 시뮬레이션에서
// 최대 쏠림 21%로 흡수 현상이 재발하지 않았다 — 회피 규칙(분산 기반 별도 판정) 없이도 해결됨.
const FACE_SIGNATURES = {
  FACE_LION:     { lenR: 0.03, jigakR: 0.85, cheekR: 0.55 },   // 사자상: 짧고 넓은 풍채
  FACE_OX:       { lenR: 0.15, waJ: 0.90, mouthR: 0.90 },      // 우상: 눈 크고 입 큼
  FACE_KIRIN:    { lenR: 0.27, jigakR: 0.15, mgW: 0.90 },      // 기린상: 미간 넓고 온화
  FACE_TIGER:    { lenR: 0.39, jigakR: 0.97, browGapR: 0.10 }, // 호상: 턱 발달 + 눈썹-눈 가까움(강렬)
  FACE_DRAGON:   { lenR: 0.51, jigakR: 0.65, browGapR: 0.55, junduR: 0.35 }, // 용상: 균형형(다른 8종과 동등한 후보)
  FACE_ELEPHANT: { lenR: 0.63, noseLenR: 0.80, cheekR: 0.90 }, // 상상: 코 길고 볼륨감
  FACE_PHOENIX:  { lenR: 0.75, browLenR: 0.85, junduR: 0.75 }, // 봉상: 눈썹 길고 단정
  FACE_HORSE:    { lenR: 0.87, noseLenR: 0.30, jigakR: 0.40 }, // 마상: 얼굴 길고 코 길다
  FACE_CRANE:    { lenR: 0.97, jigakR: 0.03, gwanR: 0.85 },    // 학상: 갸름 + 좁은 턱
};
function classifyFaceArchetypeRuleBased(lm) {
  const r = getGwansangRatios(lm); // lenR·noseLenR·browLenR 포함(1단계에서 추가됨)
  return nearestSignatureMatchPct(r, FACE_SIGNATURES) || 'FACE_DRAGON';
}

// ═══ 얼굴형 3분류(원형/사각형/역삼각형) — 궁합 탭의 "얼굴형 조합" 서술에 쓰는 단순 분류 ═══
// 9종 동물상(FACE_SIGNATURES)과는 목적이 다르다 — 동물상은 "가장 가까운 시그니처 하나"를 고르는
// 최근접 매칭이고, 이건 통속적으로 많이 쓰는 원형/사각형/역삼각형 3분류를 바로 쓰기 위한 것.
// lenR(세로/가로)로 얼굴이 갸름한지 짧은지, jigakR(턱선폭/광대폭)로 턱이 좁은지(브이라인) 넓은지를 봐서
// 나눈다 — 임계값은 FACE_OHAENG_RANGE(R1)·GWANSANG_3TIER_THRESHOLDS(턱선)에 이미 쓰인 앵커값을
// 그대로 재사용한 것이며, 다른 임계값들과 마찬가지로 실측 데이터가 쌓이면 보정이 필요한 "초안"이다.
const FACE_SHAPE3_THRESHOLDS = { lenLow: 1.05, lenHigh: 1.30, jigakLow: 0.65, jigakHigh: 0.80 };
function classifyFaceShape3(ratios) {
  const { lenLow, lenHigh, jigakLow, jigakHigh } = FACE_SHAPE3_THRESHOLDS;
  const { lenR, jigakR } = ratios;
  if (jigakR < jigakLow) return '역삼각형';           // 턱선이 광대보다 확연히 좁음 — 브이라인
  if (jigakR > jigakHigh && lenR < lenHigh) return '사각형'; // 턱선이 넓고 발달, 얼굴이 많이 길지도 않음
  return lenR < lenLow ? '원형' : (jigakR > jigakHigh ? '사각형' : '원형');
}

// ═══ 부위별 생김새 7종(이마/눈썹/눈크기/코/입/턱/얼굴형) 룰베이스 분류 — Gemini 분류 제거 대응 ═══
// 관상보기 탭에서 Gemini API 분류를 걷어내고 이 룰베이스만으로 archetype-db.js의 7개 DB(FOREHEAD_TYPE_DB
// 등)를 채우기 위해 신설. EYE_SIGNATURES/FACE_SIGNATURES와 같은 "최근접 시그니처 매칭" 패턴을 그대로 쓴다.
//
// ⚠️ 중요한 한계: 지금 랜드마크 세트(IDX)는 이마 헤어라인 1점·눈썹 3점(안쪽/정점/바깥쪽)·코 3점(산근/콧대/코끝)
// 정도만 갖고 있어서, "M자 이마 vs 3자형 이마"·"매부리코 vs 꺾인 코"처럼 실제 윤곽(다수 점의 곡률)이
// 필요한 유형은 이 지표만으로 정확히 구분할 수 없다. 그래서 아래 시그니처들은 실측 사진 없이 만든
// "초안"이며(EYE_SIGNATURES 상단 주석과 동일한 처지), 구분이 애매한 유형끼리는 시그니처 값도 서로
// 가깝게 둬서 nearestSignatureMatchWithConfidence()의 margin(=confidence)이 자연히 낮게 나오도록 했다.
// character-engine.js는 그 confidence가 0.55 미만이면 해당 카테고리를 아예 제외하고 남은 가중치를
// 재정규화하므로(기획서 §7·§41 규칙5), "억지로 틀린 값을 확신 있게 내미는" 상황은 만들지 않는다.
function nearestSignatureMatchWithConfidence(ratios, signatures) {
  const scales = signatureScales(signatures);
  let best = null, bestScore = -Infinity, second = -Infinity;
  for (const [id, sig] of Object.entries(signatures)) {
    const score = scoreAgainstSignature(ratios, sig, scales);
    if (score == null) continue;
    if (score > bestScore) { second = bestScore; bestScore = score; best = id; }
    else if (score > second) { second = score; }
  }
  if (best == null) return { id: null, confidence: 0 };
  // score는 항상 0 이하(0=시그니처와 완전히 일치). margin(1위-2위 격차)이 클수록 "다른 유형과 뚜렷이
  // 구분된다"는 뜻이라 이를 confidence로 쓴다. 상대오차 기반이라 유형마다 스케일이 달라 4배 스케일링 후
  // 0~1로 clamp하는 "초안" 변환이며, 실측 분포가 쌓이면 재보정이 필요하다.
  const margin = second === -Infinity ? 1 : (bestScore - second);
  // ⚠️ 2026-08-18: ×4 고정 스케일은 후보 개수를 고려하지 않아 카테고리마다 의미가 달랐다.
  // 후보가 많을수록 1위–2위가 붙는 건 당연한데(13종 눈 물형 vs 6종 이마), 같은 상수를 쓰면
  // 후보가 많은 카테고리만 일방적으로 탈락한다 — 실제로 눈 물형은 69장 전부 탈락(평균 0.149)했다.
  // 후보 수에 비례해 스케일을 키워 "이 카테고리 안에서 얼마나 뚜렷이 1등인가"를 공정하게 재도록 바꾼다.
  const n = Object.keys(signatures).length;
  const confidence = Math.max(0, Math.min(1, margin * n * 0.6));
  return { id: best, confidence, margin };
}

// 기존 눈모양/동물상 분류기도 confidence가 필요한 곳(character-engine.js)을 위해 margin 버전을 별도로 둔다.
// 기존 classifyEyeArchetypeRuleBased/classifyFaceArchetypeRuleBased(문자열만 반환)는 호출부가 많아 그대로 둔다.
// ── 눈 물형 판별용 보조 지표 (2026-08-18 추가) ──────────────────────────────
// 배경: 69장 전수 점검에서 눈 물형의 판별 신뢰도가 평균 0.149로, character-engine의 기준(0.55)을
// 단 한 번도 넘지 못했다(통과 0/69). 13종을 aspect·tilt·waJ 3개 지표로만 가르다 보니 후보들이
// 서로 붙어 1위–2위 격차(=confidence)가 벌어지지 않은 것이 원인이다. 랜드마크에서 더 뽑을 수
// 있는 형태 지표를 더해 차원을 넓힌다.
//
// ⚠️ 한계: archetype-db.js의 묘사 중 "눈빛에 힘이 있다"(용안·사자안·호안), "생기"(난안),
// "눈빛이 조용하다"(구안) 같은 항목은 기하학적으로 측정할 수 없다. 아래 지표로 갈리는 것은
// 크기·길이·기울기·곡률·좌우차이까지이고, 눈빛 계열은 여전히 서로 가깝게 남는다.

// 눈 가로폭 자체의 크기(두 눈 사이 거리 대비) — "눈 자체가 큰" 우안과 "좁고 집중된" 사안을 가른다.
// aspect(가로÷세로)만으로는 큰 눈과 가는 눈이 같은 값을 가질 수 있어 크기 정보가 따로 필요하다.
function eyeSizeRatio(lm) {
  const wL = Math.hypot(lm[IDX.eyeOuterL].x - lm[IDX.eyeInnerL].x, lm[IDX.eyeOuterL].y - lm[IDX.eyeInnerL].y);
  const wR = Math.hypot(lm[IDX.eyeInnerR].x - lm[IDX.eyeOuterR].x, lm[IDX.eyeInnerR].y - lm[IDX.eyeOuterR].y);
  const inter = Math.hypot(lm[IDX.eyeInnerR].x - lm[IDX.eyeInnerL].x, lm[IDX.eyeInnerR].y - lm[IDX.eyeInnerL].y);
  return inter > 0 ? ((wL + wR) / 2) / inter : null;
}
// 좌우 눈의 가로세로비 차이 — 음양안("좌우 눈의 크기가 조금 다를 수 있어요")을 판별하는 유일한 지표.
// 지금까지는 이 값이 없어서 음양안 시그니처를 "표준형에 가깝게" 둘 수밖에 없었고, 그래서 절대 뽑히지 않았다.
function eyeAsymmetry(lm) {
  const aL = Math.hypot(lm[IDX.eyeOuterL].x - lm[IDX.eyeInnerL].x, lm[IDX.eyeOuterL].y - lm[IDX.eyeInnerL].y) / eyeLidHeight(lm, IDX.eyeLidPairsL);
  const aR = Math.hypot(lm[IDX.eyeInnerR].x - lm[IDX.eyeOuterR].x, lm[IDX.eyeInnerR].y - lm[IDX.eyeOuterR].y) / eyeLidHeight(lm, IDX.eyeLidPairsR);
  const m = (aL + aR) / 2;
  return m > 0 ? Math.abs(aL - aR) / m : null;
}
// 눈꺼풀 곡률 — 눈 가운데 높이 ÷ 양옆 높이 평균.
// ⚠️ 미사용: 69장 실측에서 1.100~1.135로만 나와 변별력이 없었다(눈꺼풀 3쌍이 서로 너무 가깝다).
// 랜드마크를 더 촘촘히 잡게 되면 다시 쓸 수 있어 함수는 남겨둔다. 값이 크면 가운데가 볼록한 곡선형(도화안·우안),
// 1에 가까우면 위아래가 나란한 가늘고 긴 형(학안·사안). "눈매에 부드러운 곡선"을 이걸로 잡는다.
function eyeLidCurvature(lm) {
  const one = (pairs) => {
    const h = pairs.map(([a, b]) => Math.hypot(lm[a].x - lm[b].x, lm[a].y - lm[b].y));
    const side = (h[1] + h[2]) / 2;
    return side > 0 ? h[0] / side : null; // pairs[0]이 눈 가운데(159/145, 386/374)
  };
  const l = one(IDX.eyeLidPairsL), r = one(IDX.eyeLidPairsR);
  return (l == null || r == null) ? null : (l + r) / 2;
}

// 눈동자 크기 — 홍채 가로지름 ÷ 눈 가로폭. "눈동자가 비교적 크고 또렷"(용안)·"눈동자가 둥글고
// 크게 보여요"(우안) vs "좁고 집중된"(사안)을 가르는 지표. 홍채 없이는 잴 수 없던 값이다.
function irisSizeRatio(lm) {
  if (lm.length < 478) return null;
  const d = (a, b) => Math.hypot(lm[a].x - lm[b].x, lm[a].y - lm[b].y);
  const iL = d(IDX.irisL[1], IDX.irisL[3]), iR = d(IDX.irisR[1], IDX.irisR[3]); // 좌↔우 가장자리
  const wL = d(IDX.eyeOuterL, IDX.eyeInnerL), wR = d(IDX.eyeInnerR, IDX.eyeOuterR);
  return (wL > 0 && wR > 0) ? ((iL / wL) + (iR / wR)) / 2 : null;
}
// 홍채 노출도 — 눈꺼풀이 열린 높이 ÷ 홍채 세로지름. 1에 가까우면 홍채가 눈꺼풀에 딱 차서 "검은자가
// 꽉 찬" 느낌이고, 크면 홍채 위아래로 흰자가 보인다(삼백안 계열). "흑백의 구분이 깨끗"(학안)이나
// "눈빛에 힘"(호안·사자안) 같은 서술이 실제로 갈리는 지점이다.
function irisExposureRatio(lm) {
  if (lm.length < 478) return null;
  const d = (a, b) => Math.hypot(lm[a].x - lm[b].x, lm[a].y - lm[b].y);
  const hL = eyeLidHeight(lm, IDX.eyeLidPairsL), hR = eyeLidHeight(lm, IDX.eyeLidPairsR);
  const vL = d(IDX.irisL[0], IDX.irisL[2]), vR = d(IDX.irisR[0], IDX.irisR[2]); // 상↔하 가장자리
  return (vL > 0 && vR > 0) ? ((hL / vL) + (hR / vR)) / 2 : null;
}
// 눈꺼풀 곡률(조밀점 기반) — 윗눈꺼풀 최고점이 눈 중앙에서 얼마나 벗어나 있는지(0=중앙, 양수=꼬리쪽).
// "눈매에 부드러운 곡선"(도화안)과 "가로로 길게 뻗어"(봉안)를 가른다. 3쌍만 쓰던 이전 방식은
// 점들이 붙어 있어 변별력이 없었다.
function eyeLidPeakOffset(lm) {
  const one = (upper, inner, outer) => {
    const ax = lm[inner].x, bx = lm[outer].x;
    const span = bx - ax;
    if (!span) return null;
    let peak = upper[0], peakY = lm[upper[0]].y;
    upper.forEach((i) => { if (lm[i].y < peakY) { peakY = lm[i].y; peak = i; } }); // y가 작을수록 위
    return (lm[peak].x - ax) / span; // 0=눈머리, 1=눈꼬리
  };
  const l = one(IDX.eyeUpperL, IDX.eyeInnerL, IDX.eyeOuterL);
  const r = one(IDX.eyeUpperR, IDX.eyeInnerR, IDX.eyeOuterR);
  return (l == null || r == null) ? null : (Math.abs(l - 0.5) + Math.abs(r - 0.5)) / 2;
}

function classifyEyeArchetypeRuleBasedWithConfidence(lm) {
  const r = getGwansangRatios(lm);
  const aspect = eyeAspect(lm); // 두 분류기가 같은 측정을 쓰도록 공용 함수로 통일
  const tilt = r.eyeTiltR * r.__interocularDist; // classifyEyeArchetypeRuleBased와 동일 스케일(정규화 전 px)로 환산
  return nearestSignatureMatchWithConfidence({
    aspect, tilt, waJ: r.waJ,
    size: eyeSizeRatio(lm), asym: eyeAsymmetry(lm),
    iris: irisSizeRatio(lm), expo: irisExposureRatio(lm), peak: eyeLidPeakOffset(lm),
  }, EYE_SIGNATURES);
}
function classifyFaceArchetypeRuleBasedWithConfidence(lm) {
  const r = getGwansangRatios(lm);
  return nearestSignatureMatchWithConfidencePct(r, FACE_SIGNATURES);
}

// ═══ 2026-09-03 분류 방식 전면 개편 — "목표값 하나에 최근접" → "실측 백분위 순위 매칭" ═══
// 배경: 이마·눈썹·눈크기·코·입·턱·얼굴형·동물상 8개 카테고리가 전부 같은 병을 앓고 있었다 —
// 시그니처 목표값을 원본 비율 단위(raw value)로 손으로 정해뒀는데, 그 값이 실측 분포 밖에 있으면
// 그 유형은 구조적으로 절대 뽑히지 않는다(위 EYEBROW_SIGNATURES 2026-09-02 주석에서 처음 발견,
// 73장 중 79%가 EB_TRIANGLE 하나로 쏠림). 눈썹만 실측 백분위로 재보정해서 고쳤지만, 이 방식은
// "값 하나가 틀렸을 때마다 손으로 다시 잰다"는 땜질이라 카테고리가 8개나 더 있으면 언젠가 또
// 재발한다. 그래서 아예 구조적으로 재발이 불가능한 방식으로 바꾼다.
//
// 방식: 시그니처 목표값을 원본 단위 대신 "실측 73장 중 몇 번째 백분위인가"(0~1)로 정의하고,
// 실제 사진의 비율값도 매칭 직전에 같은 73장 기준 백분위로 변환한 뒤 그 백분위끼리 비교한다.
// 백분위는 정의상 항상 0~1 안에 있으므로 "목표값이 도달 불가능한 범위"라는 문제 자체가 생길 수
// 없고, 유형들을 백분위 축에 고르게 배치하면(예: 6종이면 대략 0.08~0.92 사이 6등분) 결과도
// 자연히 고르게 갈린다 — 이번 세션에서 8개 카테고리 전부에 적용해 시뮬레이션한 결과 전 유형이
// 최소 1회 이상 등장했고(기존엔 여러 카테고리에서 특정 유형이 0회), 16캐릭터 분포 최대 쏠림도
// 15.1%까지 낮아졌다(재도출된 FACE_TRAIT_BASELINE과 함께 검증 — trait-config.js 주석 참고).
//
// ⚠️ 아래 EMPIRICAL_PERCENTILE_SAMPLES는 기획서/ 폴더 실사진 73장(2026-09-03 기준)의 실측값이다.
// 표본이 늘어나면 이 배열을 다시 뽑아 교체해야 더 정확해진다 — 지금은 "73장 기준"이라는 한계가
// 있는 초안이지만, 최소한 예전처럼 사진 한 장 없이 지어낸 값보다는 훨씬 근거가 있다.
// 눈 물형(EYE_SIGNATURES, 13종)은 이번 개편에 포함되지 않았다 — 홍채·눈꺼풀 곡률 등 이 표본에
// 캐시돼 있지 않은 별도 지표가 필요해서, 기존 원본 단위 방식(nearestSignatureMatch)을 그대로 쓴다.
const EMPIRICAL_PERCENTILE_SAMPLES = {
  gwanR: [0.1594,0.1621,0.1635,0.1661,0.1667,0.1676,0.1678,0.1714,0.1729,0.1733,0.174,0.1742,0.1747,0.1748,0.1776,0.1777,0.1792,0.1794,0.1797,0.18,0.1805,0.1816,0.1824,0.183,0.1834,0.1843,0.1848,0.1853,0.1863,0.1864,0.1882,0.1884,0.189,0.1898,0.1901,0.1902,0.1904,0.1906,0.1935,0.1936,0.194,0.1949,0.1957,0.1969,0.1971,0.1983,0.1986,0.2004,0.2007,0.2013,0.2017,0.2022,0.2036,0.205,0.2051,0.2059,0.2075,0.2076,0.208,0.208,0.2094,0.212,0.2124,0.2144,0.2151,0.2155,0.2178,0.2193,0.2199,0.2205,0.2215,0.2239,0.2492],
  mgW: [0.8806,0.9154,0.9207,0.9265,0.931,0.9519,0.9632,0.9674,0.9775,0.9782,0.9791,0.9795,0.9825,0.9837,0.9857,0.9857,0.9893,0.9899,0.991,1.004,1.0068,1.0069,1.0085,1.0096,1.0101,1.0115,1.0127,1.0129,1.0135,1.0139,1.017,1.0178,1.0181,1.0208,1.023,1.0246,1.0252,1.027,1.0295,1.0302,1.0338,1.0374,1.0406,1.0476,1.0499,1.0506,1.0525,1.0533,1.0564,1.0566,1.0583,1.0591,1.0594,1.0597,1.06,1.0619,1.0645,1.068,1.0695,1.0834,1.0837,1.0889,1.0932,1.0945,1.0986,1.0992,1.1014,1.1074,1.109,1.1165,1.1265,1.1354,1.1973],
  junduR: [0.5498,0.5641,0.5841,0.5842,0.5901,0.5912,0.5959,0.5961,0.5963,0.5999,0.6012,0.6019,0.6051,0.6052,0.6069,0.6195,0.6224,0.6228,0.6243,0.6289,0.6315,0.6335,0.6356,0.6356,0.6381,0.6393,0.6396,0.6405,0.6406,0.6446,0.6512,0.6513,0.653,0.6557,0.6584,0.6586,0.6586,0.6586,0.6591,0.6609,0.6629,0.665,0.6652,0.6676,0.6686,0.6721,0.6746,0.6748,0.6797,0.68,0.6805,0.6811,0.6827,0.6839,0.6866,0.6904,0.6946,0.6989,0.7078,0.7085,0.7099,0.7128,0.7144,0.7179,0.7193,0.7239,0.7247,0.7252,0.7262,0.7264,0.7279,0.7317,0.7704],
  mouthR: [0.6589,0.6609,0.6759,0.683,0.6955,0.6974,0.6988,0.7038,0.7089,0.721,0.7324,0.7391,0.7419,0.7437,0.7488,0.7531,0.7597,0.7609,0.7619,0.7633,0.7643,0.7712,0.7826,0.7867,0.7889,0.789,0.79,0.7912,0.7922,0.8027,0.8156,0.8196,0.8205,0.8205,0.8213,0.8246,0.8255,0.828,0.8302,0.8303,0.8306,0.8323,0.8331,0.8339,0.843,0.8461,0.8468,0.8519,0.8714,0.8717,0.8814,0.8858,0.8912,0.892,0.8925,0.8954,0.896,0.9156,0.9172,0.9546,0.9571,0.9665,0.9668,0.9668,0.973,0.9823,0.9863,1.0098,1.0117,1.0139,1.027,1.0283,1.0442],
  jigakR: [0.7262,0.7408,0.7411,0.7418,0.7438,0.7458,0.7467,0.7542,0.7542,0.7551,0.7551,0.7573,0.7612,0.765,0.7663,0.7697,0.7706,0.7735,0.7738,0.7772,0.778,0.7781,0.7788,0.7817,0.7819,0.7832,0.7836,0.7837,0.7846,0.7857,0.7864,0.7867,0.7871,0.7876,0.7889,0.7906,0.7907,0.792,0.7924,0.7929,0.795,0.795,0.7966,0.7971,0.7973,0.7993,0.7999,0.8009,0.8024,0.8027,0.8048,0.805,0.8056,0.8076,0.8116,0.8116,0.8146,0.8155,0.8163,0.8166,0.8175,0.8177,0.8184,0.8187,0.8189,0.8197,0.8219,0.8266,0.8271,0.8282,0.8283,0.8305,0.8327],
  waJ: [0.0492,0.086,0.0877,0.0877,0.0892,0.0921,0.0943,0.0949,0.0991,0.104,0.1065,0.1111,0.1113,0.1122,0.1133,0.1145,0.1145,0.1147,0.1151,0.1154,0.1189,0.119,0.1199,0.1201,0.1212,0.1226,0.1235,0.1237,0.1237,0.1253,0.1264,0.1278,0.129,0.1294,0.1307,0.1357,0.1357,0.1362,0.1376,0.1376,0.1396,0.1407,0.1445,0.1454,0.1469,0.1471,0.1471,0.1512,0.1519,0.152,0.1528,0.1536,0.1539,0.1541,0.1547,0.1557,0.156,0.1569,0.1597,0.1599,0.1624,0.1657,0.1672,0.1693,0.1703,0.173,0.1731,0.1746,0.1812,0.1816,0.1818,0.1858,0.1888],
  sanR: [0.1112,0.1146,0.1177,0.1206,0.1223,0.1257,0.1289,0.1297,0.1305,0.1306,0.1319,0.1321,0.1329,0.1334,0.1338,0.1343,0.1344,0.1347,0.1357,0.1369,0.1382,0.1391,0.1392,0.14,0.1401,0.1402,0.1402,0.1409,0.1411,0.1412,0.1413,0.1415,0.1425,0.1427,0.143,0.1431,0.1436,0.144,0.1442,0.1443,0.1447,0.1456,0.1465,0.1466,0.1468,0.1471,0.1474,0.1476,0.1479,0.148,0.1509,0.1518,0.1522,0.1527,0.1528,0.1529,0.1534,0.1546,0.1555,0.1561,0.1564,0.1579,0.1592,0.1619,0.162,0.1632,0.1657,0.1667,0.1697,0.1703,0.1717,0.1724,0.1753],
  injR: [0.2243,0.2378,0.2443,0.2517,0.2651,0.2679,0.2698,0.2729,0.2759,0.2777,0.2777,0.286,0.2879,0.2891,0.291,0.2935,0.2973,0.2975,0.3006,0.3031,0.3037,0.3064,0.31,0.3114,0.3134,0.3141,0.3182,0.3185,0.3189,0.3203,0.3226,0.3236,0.3246,0.3257,0.3283,0.331,0.3312,0.3338,0.3341,0.3344,0.3349,0.3391,0.3398,0.3399,0.3418,0.3447,0.346,0.3461,0.3462,0.3471,0.3482,0.3484,0.3485,0.3498,0.3513,0.3534,0.3544,0.3557,0.3598,0.364,0.3686,0.3772,0.3864,0.3931,0.3954,0.3969,0.397,0.4114,0.4124,0.4186,0.4302,0.4494,0.45],
  beomR: [0.3547,0.4067,0.4267,0.4289,0.4348,0.4369,0.4421,0.4424,0.4464,0.4468,0.4486,0.4492,0.45,0.4512,0.4514,0.4544,0.4564,0.4579,0.4588,0.4593,0.463,0.4645,0.4647,0.4714,0.4725,0.4728,0.4739,0.4747,0.4748,0.4764,0.4807,0.4816,0.4821,0.4829,0.4835,0.4836,0.4845,0.4855,0.4857,0.486,0.4897,0.4905,0.4927,0.4934,0.4934,0.4946,0.4948,0.4992,0.5012,0.5019,0.5044,0.5065,0.5072,0.5073,0.5079,0.5088,0.5092,0.5099,0.5148,0.5164,0.5175,0.5203,0.526,0.5287,0.5312,0.538,0.5389,0.5419,0.5608,0.5655,0.5657,0.5717,0.573],
  browGapR: [1.5887,1.69,1.757,1.7974,1.8168,1.845,1.8486,1.908,1.9111,1.9221,1.9319,1.9484,1.9504,1.9581,1.9962,2.0004,2.0588,2.1071,2.1222,2.1274,2.149,2.1851,2.2091,2.2887,2.3249,2.3353,2.3382,2.3456,2.3692,2.3703,2.3912,2.4014,2.4613,2.4828,2.5586,2.56,2.5614,2.5865,2.5951,2.5965,2.6373,2.6726,2.7744,2.7958,2.8037,2.8043,2.8175,2.8255,2.828,2.8592,2.8883,2.8967,2.914,2.9472,3.029,3.1261,3.1408,3.1971,3.2016,3.2387,3.2714,3.2908,3.314,3.3158,3.3463,3.4259,3.4941,3.5719,4.0671,4.7266,4.9915,5.8855,8.9823],
  cheekR: [1.925,1.9538,2.0255,2.0357,2.039,2.0541,2.0672,2.0788,2.0925,2.098,2.1139,2.1279,2.1487,2.1541,2.1678,2.1912,2.2117,2.2226,2.2266,2.2301,2.2372,2.2377,2.2378,2.2413,2.2483,2.2489,2.2536,2.2588,2.2647,2.275,2.2754,2.2757,2.2786,2.2793,2.2863,2.2885,2.2931,2.295,2.3059,2.3095,2.3157,2.3169,2.3184,2.3274,2.335,2.3378,2.3396,2.3406,2.3511,2.3614,2.3725,2.3732,2.3807,2.3817,2.3867,2.3886,2.3933,2.3956,2.396,2.4098,2.4153,2.4185,2.4203,2.4285,2.4328,2.4511,2.4745,2.4808,2.4834,2.4901,2.4922,2.5066,2.6009],
  lenR: [1.0652,1.0866,1.1021,1.1056,1.1147,1.1204,1.1237,1.1248,1.1394,1.1399,1.1418,1.1447,1.1491,1.1495,1.1541,1.1557,1.1566,1.1567,1.1611,1.1619,1.1634,1.165,1.1676,1.1682,1.1688,1.1695,1.1697,1.1711,1.1718,1.1725,1.1736,1.1777,1.1782,1.1791,1.1813,1.1819,1.1821,1.1826,1.1836,1.1839,1.185,1.1864,1.1891,1.1901,1.1902,1.1904,1.1922,1.195,1.1959,1.1965,1.198,1.198,1.1984,1.1991,1.2035,1.209,1.2168,1.2169,1.2189,1.2189,1.2194,1.2265,1.229,1.2318,1.2347,1.2383,1.2406,1.2409,1.2507,1.2554,1.2578,1.2599,1.2654],
  noseLenR: [0.5946,0.6196,0.6208,0.6335,0.6377,0.6438,0.6533,0.6558,0.6579,0.6629,0.6642,0.6667,0.6706,0.6707,0.6707,0.674,0.6756,0.6825,0.6833,0.6855,0.6878,0.6948,0.7002,0.7019,0.7048,0.7051,0.7094,0.7097,0.713,0.714,0.7152,0.7176,0.7197,0.7219,0.7261,0.7265,0.73,0.7311,0.7319,0.7325,0.7331,0.7378,0.7381,0.739,0.7428,0.7436,0.7484,0.7497,0.7505,0.7507,0.7624,0.7628,0.7717,0.7721,0.7746,0.7776,0.7805,0.7873,0.7878,0.7885,0.7892,0.7918,0.794,0.7963,0.7967,0.8091,0.8127,0.8163,0.8251,0.8374,0.8394,0.8413,0.8625],
  browLenR: [1.4313,1.4358,1.4388,1.4452,1.4476,1.4539,1.4627,1.4649,1.48,1.4832,1.4939,1.5103,1.5103,1.5115,1.5154,1.5163,1.5184,1.525,1.5252,1.5261,1.5343,1.5417,1.5424,1.5475,1.5486,1.5523,1.5536,1.5557,1.5574,1.5602,1.5657,1.5672,1.5676,1.5716,1.5738,1.5762,1.5765,1.5794,1.5795,1.5827,1.5838,1.5937,1.5968,1.5971,1.5978,1.5982,1.6011,1.6036,1.6042,1.6113,1.6128,1.6229,1.6231,1.6296,1.6306,1.6319,1.6332,1.6358,1.642,1.6441,1.6508,1.6522,1.6528,1.6543,1.6597,1.6613,1.6647,1.6754,1.6819,1.6871,1.6946,1.7099,1.7122],
  foreheadWR: [0.5351,0.5482,0.5497,0.55,0.5617,0.5643,0.5675,0.5679,0.5709,0.5716,0.5729,0.5753,0.5756,0.5792,0.5812,0.5817,0.5831,0.5839,0.584,0.5841,0.5849,0.5856,0.5865,0.587,0.5872,0.5889,0.5896,0.5903,0.592,0.5922,0.5928,0.5929,0.5942,0.5954,0.5955,0.5957,0.5978,0.5982,0.5986,0.5989,0.5997,0.6025,0.6025,0.6026,0.605,0.6114,0.6125,0.6127,0.6173,0.6179,0.6195,0.6213,0.6216,0.6229,0.6272,0.6297,0.6308,0.6315,0.6354,0.636,0.6364,0.6391,0.6412,0.6447,0.6449,0.6516,0.6519,0.6598,0.6649,0.6664,0.6787,0.6903,0.6972],
  browTiltR: [-0.2333,-0.232,-0.2226,-0.2222,-0.2168,-0.2146,-0.213,-0.2126,-0.2124,-0.2109,-0.2076,-0.2076,-0.2056,-0.2047,-0.2043,-0.2028,-0.2009,-0.2007,-0.1991,-0.1988,-0.1985,-0.1982,-0.1975,-0.1974,-0.1969,-0.1966,-0.1951,-0.1951,-0.1946,-0.1941,-0.1939,-0.1936,-0.1931,-0.1912,-0.1911,-0.1904,-0.19,-0.19,-0.1899,-0.1898,-0.1889,-0.1888,-0.1886,-0.1885,-0.1884,-0.1876,-0.1876,-0.1869,-0.1861,-0.1855,-0.1851,-0.1849,-0.1842,-0.1841,-0.1841,-0.184,-0.1838,-0.1837,-0.1828,-0.1824,-0.181,-0.1799,-0.1795,-0.1792,-0.179,-0.1756,-0.1755,-0.1746,-0.1744,-0.172,-0.1656,-0.1645,-0.1509],
  browSlopeR: [-0.1041,-0.0667,-0.0648,-0.0444,-0.04,-0.036,-0.0256,-0.0229,-0.022,-0.0205,-0.0153,-0.0142,-0.0086,-0.0076,-0.0072,-0.0057,-0.0054,-0.0035,-0.0015,-0.0009,-0.0005,-0.0002,0.0012,0.0024,0.0027,0.0032,0.0038,0.0042,0.0044,0.0044,0.0046,0.0054,0.0063,0.0066,0.0073,0.0076,0.0088,0.0089,0.0102,0.0122,0.0126,0.0136,0.0143,0.0148,0.0152,0.0155,0.0161,0.0187,0.0194,0.021,0.0218,0.0222,0.0224,0.0226,0.0228,0.0243,0.026,0.029,0.0303,0.0311,0.0331,0.037,0.0373,0.043,0.0461,0.055,0.0569,0.0585,0.0621,0.0689,0.0714,0.0754,0.1074],
  innerEyeGapR: [1.0835,1.1743,1.1843,1.203,1.2171,1.2184,1.2582,1.2609,1.273,1.2771,1.2784,1.2861,1.2938,1.2958,1.2959,1.3009,1.3055,1.3059,1.3083,1.3128,1.315,1.3157,1.3175,1.3202,1.3228,1.3304,1.3333,1.3338,1.3439,1.3507,1.3525,1.3609,1.3621,1.3645,1.3656,1.3666,1.3669,1.37,1.3717,1.3725,1.3753,1.3814,1.3836,1.387,1.3944,1.4015,1.4056,1.4087,1.4169,1.4189,1.4219,1.4258,1.4386,1.4392,1.4397,1.4417,1.4469,1.4522,1.4536,1.4561,1.4576,1.4639,1.4998,1.5052,1.506,1.5088,1.5105,1.5389,1.539,1.5468,1.5474,1.5672,1.5839],
  eyeTiltR: [-0.1144,-0.0766,-0.0761,-0.0754,-0.0727,-0.0714,-0.0707,-0.0702,-0.0698,-0.0694,-0.0668,-0.0668,-0.0663,-0.0663,-0.0651,-0.0637,-0.0622,-0.0607,-0.06,-0.06,-0.0593,-0.0568,-0.0565,-0.0547,-0.0535,-0.0533,-0.0528,-0.0527,-0.0521,-0.0502,-0.0497,-0.0488,-0.0483,-0.0482,-0.0477,-0.0471,-0.0454,-0.0441,-0.0439,-0.0438,-0.0435,-0.0435,-0.0424,-0.0415,-0.0406,-0.04,-0.0399,-0.0396,-0.0382,-0.0382,-0.0346,-0.034,-0.0339,-0.0337,-0.0331,-0.0324,-0.0323,-0.0316,-0.0314,-0.0308,-0.0306,-0.0292,-0.0288,-0.0276,-0.0259,-0.0237,-0.0233,-0.0228,-0.0155,-0.014,-0.0098,-0.0078,-0.0076],
  lipThickR: [0.0782,0.1545,0.177,0.1836,0.1857,0.1919,0.194,0.1976,0.1989,0.2262,0.2322,0.2363,0.2382,0.2402,0.2435,0.2441,0.2498,0.2543,0.2549,0.2551,0.2569,0.2601,0.2615,0.2651,0.2662,0.2698,0.2703,0.2712,0.2722,0.2773,0.2804,0.281,0.2814,0.2826,0.2849,0.2877,0.2877,0.2899,0.2942,0.3007,0.306,0.3066,0.3075,0.3089,0.3092,0.3119,0.3152,0.3217,0.3302,0.3303,0.3335,0.3348,0.3373,0.3479,0.3496,0.3516,0.356,0.3681,0.3717,0.3873,0.3977,0.4044,0.4046,0.4118,0.4151,0.4325,0.4344,0.4349,0.4373,0.4389,0.4491,0.455,0.5322],
  mouthTiltR: [-0.1154,-0.1051,-0.1018,-0.0802,-0.0762,-0.0727,-0.0697,-0.0687,-0.0673,-0.0625,-0.0603,-0.0575,-0.0514,-0.048,-0.0444,-0.043,-0.0428,-0.0417,-0.0411,-0.04,-0.0395,-0.0367,-0.0348,-0.0299,-0.0198,-0.0189,-0.0183,-0.0177,-0.0175,-0.0162,-0.0147,-0.012,-0.011,-0.009,-0.0089,-0.0087,-0.0072,-0.0068,-0.0055,-0.0051,-0.0044,-0.0034,-0.0029,-0.0027,-0.0015,-0.0012,-0.0005,0.0004,0.0008,0.0025,0.0028,0.0034,0.0055,0.0083,0.0145,0.0164,0.0189,0.0215,0.0242,0.0249,0.0324,0.0361,0.0373,0.0376,0.0376,0.0427,0.0435,0.0477,0.049,0.0614,0.0614,0.0665,0.1112],
  chinHeightR: [0.375,0.4198,0.4307,0.4383,0.4417,0.4573,0.4698,0.4758,0.4857,0.4861,0.487,0.4876,0.4896,0.4924,0.4964,0.5099,0.5123,0.5146,0.517,0.5189,0.5226,0.5268,0.5306,0.5307,0.5319,0.5377,0.5409,0.5429,0.5441,0.5455,0.5467,0.5478,0.5506,0.5534,0.5537,0.5549,0.5564,0.5565,0.5566,0.5605,0.5628,0.5636,0.5683,0.569,0.5707,0.5708,0.5723,0.5738,0.5844,0.5864,0.5954,0.5965,0.5996,0.6007,0.6012,0.6014,0.6065,0.608,0.6127,0.6138,0.6146,0.6154,0.6196,0.6203,0.621,0.6237,0.634,0.6493,0.6598,0.6609,0.6711,0.6859,0.6903],
};
const __pctFnCache = {};
// 실측 표본에서 이 원본값이 대략 몇 백분위(0~1)인지 선형보간으로 역산. 표본 범위 밖이면 0 또는 1로 clamp.
function toPercentile(dim, value) {
  const sorted = EMPIRICAL_PERCENTILE_SAMPLES[dim];
  if (!sorted || value == null) return null;
  const n = sorted.length;
  if (value <= sorted[0]) return 0;
  if (value >= sorted[n - 1]) return 1;
  let i = 0;
  while (i < n && sorted[i] < value) i++;
  const x0 = sorted[i - 1], x1 = sorted[i];
  const frac = x1 === x0 ? 0 : (value - x0) / (x1 - x0);
  return ((i - 1) + frac) / (n - 1);
}
// 백분위 공간 채점 — 모든 축이 이미 [0,1]이라 raw-value 방식의 signatureScales(축별 퍼짐폭 스케일링)가
// 필요 없다. 단순 절대오차 평균이 그대로 공정한 비교가 된다.
function scoreAgainstSignaturePct(ratios, sig) {
  let score = 0, n = 0;
  for (const dim of Object.keys(sig)) {
    if (ratios[dim] == null || sig[dim] == null) continue;
    const actualPct = toPercentile(dim, ratios[dim]);
    if (actualPct == null) continue;
    score += -Math.abs(actualPct - sig[dim]);
    n++;
  }
  return n === 0 ? null : score / n;
}
function nearestSignatureMatchPct(ratios, signatures) {
  let best = null, bestScore = -Infinity;
  for (const [id, sig] of Object.entries(signatures)) {
    const score = scoreAgainstSignaturePct(ratios, sig);
    if (score == null) continue;
    if (score > bestScore) { bestScore = score; best = id; }
  }
  return best;
}
// confidence 공식(margin×후보수×배율)은 nearestSignatureMatchWithConfidence와 같은 형태이지만 배율은
// 0.6이 아니라 1.0을 쓴다 — margin이 이제 raw-value 오차 대신 백분위 오차(항상 [0,1] 안)라서 절대
// 크기가 raw-value 시절보다 작고, 옛 상수(0.6)를 그대로 쓰면 카테고리 9개 전부가 confidence 0.55
// 미달로 빠지는 사진이 73장 중 11장(15%)까지 늘었다(기존 눈썹만 고친 상태는 1장=1.4%였음 — 실측
// 검증으로 발견한 회귀). 1.0으로 올리니 73장 시뮬레이션에서 전체-미달이 다시 1장으로 돌아왔고,
// 16캐릭터 분포도 그대로 건강했다(전부 등장, 최대 쏠림 15.1%) — trait-config.js의 재도출된
// FACE_TRAIT_BASELINE과 함께 검증됨.
function nearestSignatureMatchWithConfidencePct(ratios, signatures) {
  let best = null, bestScore = -Infinity, second = -Infinity;
  for (const [id, sig] of Object.entries(signatures)) {
    const score = scoreAgainstSignaturePct(ratios, sig);
    if (score == null) continue;
    if (score > bestScore) { second = bestScore; bestScore = score; best = id; }
    else if (score > second) { second = score; }
  }
  if (best == null) return { id: null, confidence: 0 };
  const margin = second === -Infinity ? 1 : (bestScore - second);
  const n = Object.keys(signatures).length;
  const confidence = Math.max(0, Math.min(1, margin * n * 1.0));
  return { id: best, confidence, margin };
}

// ── 이마 6종 — 폭(foreheadWR)·높이(gwanR)만으로 구분. M자형/3자형/각진형은 실제로는 헤어라인 "윤곽"이
// 필요해 이 지표로는 서로 잘 구분되지 않는다(위 한계 설명 참고) — WIDE/NARROW만 상대적으로 신뢰도가 높다.
// 값은 실측 백분위(0~1) — 위 "분류 방식 전면 개편" 주석 참고.
const FOREHEAD_SIGNATURES = {
  FH_NARROW:      { foreheadWR: 0.08 },
  FH_M_SHAPE:     { foreheadWR: 0.25, gwanR: 0.30 },
  FH_ROUND:       { foreheadWR: 0.42, gwanR: 0.50 },
  FH_ANGULAR:     { foreheadWR: 0.58, gwanR: 0.70 },
  FH_THREE_SHAPE: { foreheadWR: 0.75, gwanR: 0.50 },
  FH_WIDE:        { foreheadWR: 0.92 },
};
function classifyForeheadTypeRuleBased(lm) {
  return nearestSignatureMatchWithConfidencePct(getGwansangRatios(lm), FOREHEAD_SIGNATURES);
}

// ── 눈썹 6종 — 눈썹 두께 자체는 랜드마크로 측정 불가(윗줄 점이 없음).
// 참고자료(관상 MBTI 이마·눈썹·눈·코·입·턱 슬라이드, 2026-08-14 전달)의 눈썹 아이콘을 보면 실제로는 두 개의
// 서로 다른 모양 축이 있다 — "올라간/처진"은 안쪽→바깥쪽 전체 기울기(browSlopeR)이고, "반달"은 정점이
// 매끄럽게 솟은 아치(browTiltR)다. 삼각/일자는 두 축 다 0에 가깝고, 두꺼운/미간넓은은 눈썹 모양이
// 아니라 미간 폭(mgW, 이미 검증된 기존 지표)으로 갈린다(DB 자체가 "두꺼운·미간 좁은"/"처진·미간 넓은"
// 처럼 두 특징을 한 항목으로 묶어놓음 — archetype-db.js EYEBROW_TYPE_DB 참고).
// ⚠️ 최초 버전은 browTiltR(당시엔 이 하나로 올라간/처진까지 다 표현하려 했음)을 ±0.01~0.06으로
// 가정했는데 실측값은 -0.19였다(3~5배 차이) — 모든 사진이 극단값 하나로만 수렴하는 버그가 있었다
// (사용자 리포트 2026-08-14). browSlopeR 신설 + mgW 도입으로 다시 짰고, 여전히 실측 표본이 적어
// 추가 보정이 필요한 "초안"이다.
// ⚠️ nearestSignatureMatchWithConfidence는 상대오차(측정값-기준값 ÷ |기준값|)로 채점한다 — 기울기·아치처럼
// "0 근처가 정상"인 축은 기준값 자체가 작아서, 실제로 거의 0인 값도 상대오차가 크게 튀는 한계가 있다
// (browSlopeR 기준값을 전부 ±0.02~0.10로 작게 잡아둔 이유가 그 때문 — 0을 그대로 쓰면 "이 축은 무시"로
// 해석돼 버려 아예 안 쓰인다, EYE_SIGNATURES의 tilt:0 항목들과 동일한 기존 관례). 그래서 EB_CRESCENT는
// browTiltR 단일 축만 써서 이 오차의 영향을 최소화했다 — 실측 사진(아치가 뚜렷한 눈썹)으로 확인한 결과
// 이 구성이 다른 5종보다 확실히 낮은 오차로 반달을 골라냈다(2026-08-14 재검증).
// ⚠️ 2026-09-02 재보정 — 기획서/ 폴더 실사진 73장을 실측해보니 EYEBROW_SIGNATURES가 EYE_SHAPE/
// NOSE_SIGNATURES(8/27 재보정)와 똑같은 문제를 갖고 있었다: EB_RAISED·EB_THIN의 browLenR 기준값
// (1.05/1.10)이 실측 범위(1.43~1.71) 밖에 있었고, EB_THICK의 mgW(0.75)도 실측 범위(0.88~1.20) 밖이라
// 사실상 뽑힐 수 없었다 — 73장 중 58장(79%)이 EB_TRIANGLE 하나로만 쏠렸다(인연도감 캐릭터 분포 점검
// 중 발견: "지략+관계력" 조합 캐릭터가 73장 중 단 한 번도 안 나옴). EB_CRESCENT는 실측해보니 이미
// 적당한 위치라 그대로 뒀고, 나머지 5종만 실측 백분위(browSlopeR/mgW/browLenR 각각 p10~p90)로
// 재배치했다 — 상대 순서는 그대로 유지.
// ⚠️ 2026-09-03: 위 "분류 방식 전면 개편"에 맞춰 원본 단위(raw value) 대신 실측 백분위(0~1)로 재작성.
// 2026-09-02에 raw value로 한 번 재보정했던 값(주석은 그 경위 그대로 남겨둠)을 이번에 백분위 표현으로 옮긴 것 —
// 상대 순서·조합 의도는 동일하다.
const EYEBROW_SIGNATURES = {
  EB_CRESCENT:  { browTiltR: 0.50 },                        // 반달 — 정점이 매끄럽게 솟은 아치만으로 판별(실측이 이미 적당해 중앙 유지)
  EB_RAISED:    { browSlopeR: 0.90, browLenR: 0.75 },       // 올라간·짧고 두꺼움 — 바깥쪽이 확 올라간 대각선
  EB_DROOPY:    { browSlopeR: 0.10, mgW: 0.25 },            // 처진·미간 넓음
  EB_TRIANGLE:  { browSlopeR: 0.55, mgW: 0.55 },            // 삼각·일자 — 기울기 거의 없음, 미간은 표준
  EB_THICK:     { browSlopeR: 0.55, mgW: 0.85 },            // 두꺼운·미간 좁음
  EB_THIN:      { browSlopeR: 0.35, mgW: 0.65, browLenR: 0.15 }, // 가는 눈썹
};
function classifyEyebrowTypeRuleBased(lm) {
  return nearestSignatureMatchWithConfidencePct(getGwansangRatios(lm), EYEBROW_SIGNATURES);
}

// ── 눈 크기·모양 8종 — waJ(눈 두께=크기 근사)·eyeTiltR(치켜/처짐)·innerEyeGapR(원거리/근거리안).
// ES_WIDE_SET/ES_CLOSE_SET은 archetype-db.js 자체에 "⚠️ 벤치마크 추정" 경고가 이미 있는 항목.
// ⚠️ 2026-08-27 재보정 — 궁합보기 사용자 리포트("외꺼풀 아닌데 외꺼풀로 나온다", "다들 작은눈으로만
// 나온다")로 기획서/ 폴더 실사진 30장을 실측해보니 waJ가 전부 0.049~0.189(중앙 ~0.14)에 몰려 있는데
// ES_BIG(0.30)·ES_UPTURNED(0.24)·ES_DROOPY(0.22)는 전부 이 범위 밖이라 사실상 뽑힐 수 없었다 —
// 30장 전부 ES_SMALL 아니면 ES_MONOLID로만 판정됨. EYE_SIGNATURES(13종 물형) 테이블은 위 주석
// (2026-08-17/18)에서 이미 같은 문제로 실측 p10/중앙/p90(0.094/0.138/0.173)에 맞춰 재보정됐는데,
// 나중에 추가된 이 8종 테이블은 그 보정이 반영되지 않은 채 남아 있었다. 상대 순서는 그대로 두고
// 실측 범위 안에 균등 재배치했다. eyeTiltR도 실측이 전부 음수(-0.008~-0.076, "치켜"가 기본값)인데
// 목표를 0으로 잡고 있어 함께 조정 — 이 축은 표본이 30장뿐이라 waJ보다 신뢰도가 낮은 초안이다.
// ⚠️ 2026-08-27 ES_MONOLID/ES_DOUBLE(외꺼풀/쌍꺼풀) 후보 제외 — 위 재보정 직후 실제 외꺼풀·쌍꺼풀
// 여부를 아는 사진 4장(외꺼풀 3장·쌍꺼풀 1장)으로 검증해보니, waJ·eyeTiltR로는 둘을 구분 못 했다
// (외꺼풀 3장 중 ES_MONOLID가 1등으로 나온 건 0장 — 최고 성적이 8개 중 2위, 나머지는 6위/꼴찌권).
// 재보정으로 살릴 수 있는 문제가 아니라 애초에 waJ(눈꺼풀 위/아래 간격 = "눈이 사진에서 얼마나
// 크게 떠져 있나")가 쌍꺼풀 주름의 유무와 상관관계가 없다는 뜻 — MediaPipe 478점에는 애초에 주름선을
// 짚는 포인트가 없어 기하학적으로 잴 방법이 없다. 잘못된 확신을 주느니 후보에서 아예 빼는 게 낫다고
// 판단해 제거했다. archetype-db.js의 ES_MONOLID/ES_DOUBLE 설명 자체는 지우지 않았다 — 나중에 실제로
// 주름을 인식할 방법(예: 별도 이미지 분류 모델)이 생기면 여기 후보로 다시 넣으면 된다.
// ⚠️ 2026-09-03: 백분위(0~1) 표현으로 재작성 — "분류 방식 전면 개편" 주석 참고.
const EYE_SHAPE_SIGNATURES = {
  ES_BIG:       { waJ: 0.92 },
  ES_UPTURNED:  { waJ: 0.65, eyeTiltR: 0.15 },
  ES_DROOPY:    { waJ: 0.35, eyeTiltR: 0.85 },
  ES_SMALL:     { waJ: 0.08 },
  ES_WIDE_SET:  { innerEyeGapR: 0.90 },
  ES_CLOSE_SET: { innerEyeGapR: 0.10 },
};
function classifyEyeShapeRuleBased(lm) {
  return nearestSignatureMatchWithConfidencePct(getGwansangRatios(lm), EYE_SHAPE_SIGNATURES);
}

// ── 코 9종 — junduR(콧볼 폭)·noseLenR(코 길이)·sanR(산근~콧대 세로 낙차, 콧대 융기 근사).
// 매부리코/꺾인코처럼 콧대 "곡률"이 필요한 유형은 sanR 하나로는 정밀하게 구분되지 않는다.
// ⚠️ 2026-08-27 재보정 — 위 EYE_SHAPE_SIGNATURES와 같은 사용자 리포트로 실사진 30장을 재보니
// NS_WIDE(junduR 1.05)·NS_BIG(1.00/1.05)·NS_ALAR_THICK(0.95)·NS_BENT(junduR 0.85)·
// NS_AQUILINE(noseLenR 1.05)이 전부 실측 범위(junduR 0.55~0.73, noseLenR 0.62~0.84 — 625줄
// FACE_SIGNATURES 재보정 주석의 p10/중앙/p90과 동일: junduR 0.60/0.66/0.72, noseLenR
// 0.65/0.73/0.81) 밖이라 사실상 뽑히지 않았다 — 30장 전부 NS_ALAR_THIN 아니면 NS_SMALL_SHORT로만
// 판정됨. sanR 기준 유형(AQUILINE·BENT·UPTURNED·BOKGO의 sanR 축, 실측 0.11~0.18과 이미 맞음)은
// 그대로 두고, junduR·noseLenR만 원래 순서·간격 비율을 유지한 채 실측 범위 안으로 선형 압축했다.
// ⚠️ 2026-09-03: 백분위(0~1) 표현으로 재작성 — "분류 방식 전면 개편" 주석 참고.
const NOSE_SIGNATURES = {
  NS_SMALL_SHORT: { junduR: 0.10, noseLenR: 0.15 },
  NS_ALAR_THIN:   { junduR: 0.25 },
  NS_BOKGO:       { junduR: 0.45, sanR: 0.35 },
  NS_BENT:        { sanR: 0.65, junduR: 0.35 },
  NS_ALAR_THICK:  { junduR: 0.70 },
  NS_WIDE:        { junduR: 0.85 },
  NS_BIG:         { junduR: 0.75, noseLenR: 0.80 },
  NS_UPTURNED:    { sanR: 0.15, noseLenR: 0.25 },
  NS_AQUILINE:    { sanR: 0.85, noseLenR: 0.90 },
};
function classifyNoseShapeRuleBased(lm) {
  return nearestSignatureMatchWithConfidencePct(getGwansangRatios(lm), NOSE_SIGNATURES);
}

// ── 입 6종 — mouthR(입 폭)·lipThickR(입술 두께)·mouthTiltR(입꼬리 기울기).
// ⚠️ mouthTiltR도 눈썹과 같은 종류의 스케일 오차가 있었다(±0.04로 가정했는데 실측값은 -0.105) — 눈썹
// 재보정과 같은 시점에 실측 1건 기준으로 ±0.10대로 넓혔다.
// ⚠️ 2026-09-03: 백분위(0~1) 표현으로 재작성 — "분류 방식 전면 개편" 주석 참고. 이전엔 검증 없이
// 지어낸 원본 단위 초안이었는데, 실측해보니 mouthTiltR·lipThickR 목표값이 이미 실측 범위 안쪽이라
// (걱정했던 만큼 심하게 어긋나 있진 않았음) 상대 순서만 유지한 채 백분위로 옮겼다.
const MOUTH_SIGNATURES = {
  MS_THIN:       { lipThickR: 0.10 },
  MS_SMALL:      { mouthR: 0.15 },
  MS_UPTURNED:   { mouthTiltR: 0.08 },
  MS_DOWNTURNED: { mouthTiltR: 0.92 },
  MS_BIG:        { mouthR: 0.85 },
  MS_THICK:      { lipThickR: 0.90 },
};
function classifyMouthShapeRuleBased(lm) {
  return nearestSignatureMatchWithConfidencePct(getGwansangRatios(lm), MOUTH_SIGNATURES);
}

// ── 턱 6종 — jigakR(턱선폭/광대폭, GWANSANG_3TIER_THRESHOLDS와 동일 기준값 0.65/0.80 재사용)·
// chinHeightR(턱 세로 길이). 주걱턱(CS_UNDERBITE)처럼 옆모습이 필요한 유형은 정면 랜드마크만으로
// 원리적으로 판별이 어려워 다른 유형과 시그니처가 가깝게 겹친다.
// ⚠️ 최초 버전은 chinHeightR을 0.28~0.40으로 가정했는데 실측값은 0.54였다(사용자 리포트: 표준 턱선
// jigakR=0.75인 사진이 계속 CS_POINTED로 잘못 나옴, 2026-08-14) — chinHeightR 값이 시그니처 범위
// 밖에 있으니 모든 유형에 대해 오차가 크고, 그중 우연히 가장 값이 큰 CS_LONG/CS_POINTED 쪽으로
// 쏠린 것. 아래는 그 실측 1건 기준으로 0.45~0.62 범위로 다시 잡았다(여전히 표본 1건짜리 초안).
// ⚠️ 2026-09-03: 백분위(0~1) 표현으로 재작성 — "분류 방식 전면 개편" 주석 참고. jigakR의 실측 범위가
// 0.726~0.833으로 매우 좁은데(개인차가 작은 지표) 옛 목표값은 0.55~0.85로 그보다 훨씬 넓게 퍼져 있어
// CS_POINTED(0.55)·CS_SQUARE(0.85) 둘 다 사실상 도달 불가능했다.
const CHIN_SIGNATURES = {
  CS_POINTED:   { jigakR: 0.08 },                       // 좁다=jigakR이 가장 작은 게 핵심 차별점
  CS_LONG:      { jigakR: 0.30, chinHeightR: 0.90 },     // 길다=chinHeightR이 가장 큰 게 핵심 차별점
  CS_OVAL:      { jigakR: 0.45, chinHeightR: 0.55 },
  CS_ROUND:     { jigakR: 0.60, chinHeightR: 0.35 },
  CS_UNDERBITE: { jigakR: 0.80, chinHeightR: 0.65 },
  CS_SQUARE:    { jigakR: 0.92, chinHeightR: 0.15 },
};
function classifyChinShapeRuleBased(lm) {
  return nearestSignatureMatchWithConfidencePct(getGwansangRatios(lm), CHIN_SIGNATURES);
}

// ── 얼굴형 6종(직사각형/정사각형/삼각형/역삼각형/원형/타원형) — classifyFaceShape3(3분류, 문자열 반환)과는
// 별개 축. lenR(얼굴 길이)·jigakR(턱폭/광대폭)·foreheadWR(이마폭/광대폭) 3축 조합으로 6종을 구분한다.
// jigakR·lenR 범위는 이미 실측으로 검증된 FACE_SHAPE3_THRESHOLDS(lenLow1.05/lenHigh1.30,
// jigakLow0.65/jigakHigh0.80)를 그대로 앵커로 재사용했다(새로 지어낸 값이 아님) — 삼각형=턱이
// 넓고 이마가 좁음(역삼각형의 반대), 역삼각형=이마가 넓고 턱이 좁음 축으로 foreheadWR을 갈랐다.
// ⚠️ 2026-09-03: 백분위(0~1) 표현으로 재작성 — "분류 방식 전면 개편" 주석 참고. 옛 값은 FACE_SHAPE3_THRESHOLDS
// 등 다른 초안 임계값을 앵커로 재사용했을 뿐 실측 검증이 없었다(73장 실측 시 FS_TRIANGLE 하나로 95% 쏠림 확인).
const FACE_SHAPE_TYPE_SIGNATURES = {
  FS_TRIANGLE:     { lenR: 0.45, jigakR: 0.85, foreheadWR: 0.10 },
  FS_ROUND:        { lenR: 0.25, jigakR: 0.45, foreheadWR: 0.25 },
  FS_SQUARE:       { lenR: 0.10, jigakR: 0.75, foreheadWR: 0.75 },
  FS_OVAL:         { lenR: 0.75, jigakR: 0.25, foreheadWR: 0.45 },
  FS_RECTANGLE:    { lenR: 0.90, jigakR: 0.65, foreheadWR: 0.60 },
  FS_INV_TRIANGLE: { lenR: 0.60, jigakR: 0.15, foreheadWR: 0.90 },
};
function classifyFaceShapeTypeRuleBased(lm) {
  return nearestSignatureMatchWithConfidencePct(getGwansangRatios(lm), FACE_SHAPE_TYPE_SIGNATURES);
}

// ═══ 9개 카테고리 전체를 한 번에 — 관상보기 탭의 Gemini 분류(AI_ENHANCEMENT_SCHEMA) 대체용 ═══
// 같은 lm(=같은 사진)에 대해서는 항상 같은 결과를 반환한다(순수 함수, 외부 상태 없음) — 기획서 §38
// "동일 사진 재분석 시 결과 동일" 요구를 이 계층에서부터 만족시킨다.
function classifyAllFeaturesRuleBased(lm) {
  const eye = classifyEyeArchetypeRuleBasedWithConfidence(lm);
  const face = classifyFaceArchetypeRuleBasedWithConfidence(lm);
  const forehead = classifyForeheadTypeRuleBased(lm);
  const eyebrow = classifyEyebrowTypeRuleBased(lm);
  const eyeShape = classifyEyeShapeRuleBased(lm);
  const nose = classifyNoseShapeRuleBased(lm);
  const mouth = classifyMouthShapeRuleBased(lm);
  const chin = classifyChinShapeRuleBased(lm);
  const faceShapeType = classifyFaceShapeTypeRuleBased(lm);
  return {
    ids: {
      eye_archetype_id: eye.id || '',
      face_archetype_id: face.id || '',
      forehead_type_id: forehead.id || '',
      eyebrow_type_id: eyebrow.id || '',
      eye_shape_id: eyeShape.id || '',
      nose_shape_id: nose.id || '',
      mouth_shape_id: mouth.id || '',
      chin_shape_id: chin.id || '',
      face_shape_type_id: faceShapeType.id || '',
    },
    confidences: {
      eye_archetype_id: eye.confidence,
      face_archetype_id: face.confidence,
      forehead_type_id: forehead.confidence,
      eyebrow_type_id: eyebrow.confidence,
      eye_shape_id: eyeShape.confidence,
      nose_shape_id: nose.confidence,
      mouth_shape_id: mouth.confidence,
      chin_shape_id: chin.confidence,
      face_shape_type_id: faceShapeType.confidence,
    },
  };
}
