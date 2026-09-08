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
    // ANALYSIS_LOGIC_SERVER_MIGRATION.md 2026-09-08 확장 — 오버레이 라벨에 찍는 실측값은 서버
    // (classifyGwansang)가 계산해준 값을 쓴다. 이 결과는 state[ctx].gwansangBundle에도 저장해둬서,
    // 뒤이어 도는 classifyAndBuildCharacter 등이 같은 사진이면 다시 서버에 묻지 않고 재사용한다.
    const gwansangBundle = await CharacterAPI.classifyGwansang(lm);
    state[ctx].gwansangBundle = gwansangBundle;
    drawRegions(c, lm, w, h, gwansangBundle);
    hideSpinner(m.spinner);
    return lm;
  } catch (e) {
    hideSpinner(m.spinner);
    showErr(m.err, '분석 중 오류: ' + e.message);
    return null;
  }
}

// ═══ DRAW REGIONS ═══
// gwansangBundle: CharacterAPI.classifyGwansang(lm)의 응답 — 라벨에 찍는 실측값은 서버가 이미
// 계산한 partDetails[key].rawValue를 그대로 쓴다(ANALYSIS_LOGIC_SERVER_MIGRATION.md 2026-09-08 확장).
function drawRegions(ctx, lm, w, h, gwansangBundle) {
  const faceW = Math.abs(lm[IDX.cheekR].x - lm[IDX.cheekL].x);
  const faceH = Math.abs(lm[IDX.chin].y - lm[IDX.hairline].y);
  const pd = gwansangBundle.partDetails;
  const r = {
    gwanR: pd.forehead.rawValue, mgW: pd.midbrow.rawValue, sanR: pd.nosebridge.rawValue,
    junduR: pd.nosetip.rawValue, injR: pd.philtrum.rawValue, jigakR: pd.jaw.rawValue,
    mouthR: pd.mouth.rawValue, cheekR: pd.cheekbone.rawValue,
  };
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
  const interocularDist = gwansangBundle.interocularDist;
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

