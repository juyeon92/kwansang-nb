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
function toggleMirror(ctx, btn) {
  state[ctx].mirrored = !state[ctx].mirrored;
  if (btn) btn.classList.toggle('on', state[ctx].mirrored);
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
// R1~R5 각각을 자체 범위 안에서 0~100으로 정규화한 뒤 저/중/고 3단계로 나눠 오행 가중치를 합산.
// ⚠️ 이 범위·가중치는 문서에 명시된 대로 "초안"이며 실측 데이터로 보정이 필요함(마이그레이션으로 스케일이
// 바뀌어 scratchpad 검증 사진 실측값 기준으로 재조정함 — 여전히 초안).
// R2/R4, R3/R5는 검증된 턱·이마 랜드마크 쌍이 각 하나뿐이라 같은 값을 재사용한다(068점 시절엔 이 구분 자체가
// 근사치였던 부분 — 정밀 구분이 필요해지면 추가 랜드마크를 다시 검증해서 늘리면 됨).
const FACE_OHAENG_RANGE = { R1:[0.9,1.5], R2:[0.55,0.95], R3:[0.45,0.85], R4:[0.55,0.95], R5:[0.45,0.85] };
const FACE_OHAENG_WEIGHT = {
  R1: { 목:1.0, 화:0.5, 토:0.1, 금:0.5, 수:0.1 }, // 높음: 얼굴이 길다 → 목형
  R2: { 목:0.1, 화:0.1, 토:1.0, 금:0.5, 수:1.0 }, // 높음: 턱이 넓다 → 토/수형
  R3: { 목:1.0, 화:1.0, 토:0.1, 금:0.5, 수:0.1 }, // 높음: 이마가 넓다(역삼각) → 목/화형
  R4: { 목:0.1, 화:0.5, 토:0.1, 금:1.0, 수:0.1 }, // 높음: 턱선이 각지다 → 금형
  R5: { 목:0.1, 화:1.0, 토:0.5, 금:0.5, 수:0.1 }, // 높음: 광대가 돌출 → 화형
};
function calcFaceOhaeng(lm) {
  const faceH = Math.abs(lm[IDX.chin].y - lm[IDX.hairline].y);
  const cheekW = Math.abs(lm[IDX.cheekR].x - lm[IDX.cheekL].x);
  const jawTaperW = Math.abs(lm[IDX.jawTaperR].x - lm[IDX.jawTaperL].x);
  const foreheadW = Math.abs(lm[IDX.browPeakR].x - lm[IDX.browPeakL].x);
  const raw = {
    R1: faceH / cheekW,
    R2: jawTaperW / cheekW,
    R3: foreheadW / cheekW,
    R4: jawTaperW / cheekW,
    R5: foreheadW / cheekW,
  };
  // 각 R값을 자체 범위 안에서 0~100 레벨로 정규화 → 저(0.1)/중(0.5)/고(1.0) 가중치를 오행별로 합산
  const totals = { 목:0, 화:0, 토:0, 금:0, 수:0 };
  Object.entries(raw).forEach(([key, value]) => {
    const [min, max] = FACE_OHAENG_RANGE[key];
    const level = Math.max(0, Math.min(100, (value - min) / (max - min) * 100));
    const bandMul = level >= 66 ? 1.0 : level >= 33 ? 0.5 : 0.1;
    Object.entries(FACE_OHAENG_WEIGHT[key]).forEach(([oh, w]) => { totals[oh] += w * bandMul; });
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
function nearestSignatureMatch(ratios, signatures) {
  let best = null, bestScore = -Infinity;
  for (const [id, sig] of Object.entries(signatures)) {
    let score = 0, n = 0;
    for (const dim of Object.keys(sig)) {
      if (ratios[dim] == null || !sig[dim]) continue;
      // 분모(sig[dim])가 음수인 지표(예: 눈꼬리 기울기 tilt)가 있어 Math.abs(sig[dim])로 나눠야 한다.
      // 부호 그대로 나누면 시그니처 값이 음수일 때 오차가 클수록 점수가 더 높아지는(부호가 뒤집히는) 버그가 생긴다.
      score += -Math.abs(ratios[dim] - sig[dim]) / Math.abs(sig[dim]); // 상대오차(작을수록=가까울수록 좋음)
      n++;
    }
    if (n === 0) continue;
    score /= n; // 유형마다 사용하는 지표 개수가 달라도 공정하게 비교되도록 정규화
    if (score > bestScore) { bestScore = score; best = id; }
  }
  return best;
}

const EYE_SIGNATURES = {
  // aspect: 눈 가로/세로 비율(클수록 가늘고 김) · tilt: 눈꼬리 기울기(px, 음수=치켜올라감·양수=처짐) · waJ: 눈 두께(interocular 대비)
  EYE_DRAGON:       { aspect:2.8, tilt:0,  waJ:0.24 },  // 용안: 균형 잡힌 표준형
  EYE_PHOENIX:      { aspect:3.6, tilt:-3, waJ:0.20 },  // 봉안: 가로로 길고 살짝 올라감
  EYE_OX:           { aspect:2.1, tilt:1,  waJ:0.30 },  // 우안: 크고 둥긂
  EYE_CRANE:        { aspect:4.4, tilt:0,  waJ:0.16 },  // 학안: 가늘고 길다
  EYE_LION:         { aspect:2.6, tilt:-3, waJ:0.28 },  // 사자안: 힘 있고 안정적
  EYE_SING_PHOENIX: { aspect:4.0, tilt:-5, waJ:0.19 },  // 명봉안: 봉안보다 더 선명하고 길다
  EYE_TURTLE:       { aspect:2.4, tilt:3,  waJ:0.22 },  // 구안: 깊고 차분
  EYE_GOOSE:        { aspect:3.4, tilt:0,  waJ:0.21 },  // 안안: 정돈된 긴 눈, 균형
  EYE_TIGER:        { aspect:2.7, tilt:-5, waJ:0.27 },  // 호안: 강렬하고 집중된 시선
  EYE_YINYANG:      { aspect:2.9, tilt:0,  waJ:0.24 },  // 음양안: 좌우 미세 비대칭(스칼라 시그니처로는 표준형에 가깝게 둠)
  EYE_LUAN:         { aspect:3.0, tilt:1,  waJ:0.25 },  // 난안: 화사한 곡선형
  EYE_SNAKE:        { aspect:4.6, tilt:-2, waJ:0.14 },  // 사안: 세로 좁고 옆으로 길게, 날카로움
  EYE_PEACH:        { aspect:2.9, tilt:2,  waJ:0.26 },  // 도화안: 촉촉하고 살짝 처진 곡선
};
function classifyEyeArchetypeRuleBased(lm) {
  const r = getGwansangRatios(lm);
  const wL = Math.hypot(lm[IDX.eyeOuterL].x-lm[IDX.eyeInnerL].x, lm[IDX.eyeOuterL].y-lm[IDX.eyeInnerL].y);
  const wR = Math.hypot(lm[IDX.eyeInnerR].x-lm[IDX.eyeOuterR].x, lm[IDX.eyeInnerR].y-lm[IDX.eyeOuterR].y);
  const hL = Math.abs(lm[IDX.eyeLidBotL].y-lm[IDX.eyeLidTopL].y) || 1;
  const hR = Math.abs(lm[IDX.eyeLidBotR].y-lm[IDX.eyeLidTopR].y) || 1;
  const aspect = ((wL/hL)+(wR/hR))/2; // 클수록 가늘고 긴 눈, 작을수록 크고 둥근 눈
  // 양수 = 바깥꼬리가 안쪽꼬리보다 아래(처진 눈), 음수 = 바깥꼬리가 올라감(치켜올라간 눈)
  const tilt = ((lm[IDX.eyeOuterL].y - lm[IDX.eyeInnerL].y) + (lm[IDX.eyeOuterR].y - lm[IDX.eyeInnerR].y)) / 2;
  return nearestSignatureMatch({ aspect, tilt, waJ: r.waJ }, EYE_SIGNATURES) || 'EYE_DRAGON';
}

const FACE_SIGNATURES = {
  FACE_CRANE:    { lenR: 1.55, jigakR: 0.55, gwanR: 1.00 },                  // 학상: 갸름 + 좁은 턱
  FACE_HORSE:    { lenR: 1.42, noseLenR: 0.95, jigakR: 0.75 },               // 마상: 얼굴 길고 코 길다
  FACE_PHOENIX:  { lenR: 1.25, browLenR: 1.30, junduR: 0.72 },               // 봉상: 눈썹 길고 단정
  FACE_TIGER:    { jigakR: 0.90, browGapR: 0.32, lenR: 1.15 },               // 호상: 턱 발달 + 눈썹-눈 가까움(강렬)
  FACE_LION:     { lenR: 1.00, cheekR: 1.70, jigakR: 0.85 },                 // 사자상: 짧고 넓은 풍채
  FACE_KIRIN:    { lenR: 1.15, mgW: 1.15, jigakR: 0.72 },                    // 기린상: 미간 넓고 온화
  FACE_ELEPHANT: { noseLenR: 1.05, cheekR: 1.75, jigakR: 0.68 },             // 상상: 코 길고 볼륨감
  FACE_OX:       { waJ: 0.34, lenR: 1.05, mouthR: 1.35 },                    // 우상: 눈 크고 입 큼
  FACE_DRAGON:   { lenR: 1.18, jigakR: 0.75, browGapR: 0.40, junduR: 0.62 }, // 용상: 균형/표준형(더 이상 디폴트 아님 — 다른 8종과 동등한 후보)
};
function classifyFaceArchetypeRuleBased(lm) {
  const r = getGwansangRatios(lm); // lenR·noseLenR·browLenR 포함(1단계에서 추가됨)
  return nearestSignatureMatch(r, FACE_SIGNATURES) || 'FACE_DRAGON';
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
  let best = null, bestScore = -Infinity, second = -Infinity;
  for (const [id, sig] of Object.entries(signatures)) {
    let score = 0, n = 0;
    for (const dim of Object.keys(sig)) {
      if (ratios[dim] == null || !sig[dim]) continue;
      score += -Math.abs(ratios[dim] - sig[dim]) / Math.abs(sig[dim]);
      n++;
    }
    if (n === 0) continue;
    score /= n;
    if (score > bestScore) { second = bestScore; bestScore = score; best = id; }
    else if (score > second) { second = score; }
  }
  if (best == null) return { id: null, confidence: 0 };
  // score는 항상 0 이하(0=시그니처와 완전히 일치). margin(1위-2위 격차)이 클수록 "다른 유형과 뚜렷이
  // 구분된다"는 뜻이라 이를 confidence로 쓴다. 상대오차 기반이라 유형마다 스케일이 달라 4배 스케일링 후
  // 0~1로 clamp하는 "초안" 변환이며, 실측 분포가 쌓이면 재보정이 필요하다.
  const margin = second === -Infinity ? 1 : (bestScore - second);
  const confidence = Math.max(0, Math.min(1, margin * 4));
  return { id: best, confidence };
}

// 기존 눈모양/동물상 분류기도 confidence가 필요한 곳(character-engine.js)을 위해 margin 버전을 별도로 둔다.
// 기존 classifyEyeArchetypeRuleBased/classifyFaceArchetypeRuleBased(문자열만 반환)는 호출부가 많아 그대로 둔다.
function classifyEyeArchetypeRuleBasedWithConfidence(lm) {
  const r = getGwansangRatios(lm);
  const wL = Math.hypot(lm[IDX.eyeOuterL].x-lm[IDX.eyeInnerL].x, lm[IDX.eyeOuterL].y-lm[IDX.eyeInnerL].y);
  const wR = Math.hypot(lm[IDX.eyeInnerR].x-lm[IDX.eyeOuterR].x, lm[IDX.eyeInnerR].y-lm[IDX.eyeOuterR].y);
  const hL = Math.abs(lm[IDX.eyeLidBotL].y-lm[IDX.eyeLidTopL].y) || 1;
  const hR = Math.abs(lm[IDX.eyeLidBotR].y-lm[IDX.eyeLidTopR].y) || 1;
  const aspect = ((wL/hL)+(wR/hR))/2;
  const tilt = r.eyeTiltR * r.__interocularDist; // classifyEyeArchetypeRuleBased와 동일 스케일(정규화 전 px)로 환산
  return nearestSignatureMatchWithConfidence({ aspect, tilt, waJ: r.waJ }, EYE_SIGNATURES);
}
function classifyFaceArchetypeRuleBasedWithConfidence(lm) {
  const r = getGwansangRatios(lm);
  return nearestSignatureMatchWithConfidence(r, FACE_SIGNATURES);
}

// ── 이마 6종 — 폭(foreheadWR)·높이(gwanR)만으로 구분. M자형/3자형/각진형은 실제로는 헤어라인 "윤곽"이
// 필요해 이 지표로는 서로 잘 구분되지 않는다(위 한계 설명 참고) — WIDE/NARROW만 상대적으로 신뢰도가 높다.
const FOREHEAD_SIGNATURES = {
  FH_NARROW:      { foreheadWR: 0.65, gwanR: 0.50 },
  FH_WIDE:        { foreheadWR: 0.90, gwanR: 0.55 },
  FH_ANGULAR:     { foreheadWR: 0.80, gwanR: 0.58 },
  FH_ROUND:       { foreheadWR: 0.78, gwanR: 0.50 },
  FH_M_SHAPE:     { foreheadWR: 0.75, gwanR: 0.45 },
  FH_THREE_SHAPE: { foreheadWR: 0.82, gwanR: 0.52 },
};
function classifyForeheadTypeRuleBased(lm) {
  return nearestSignatureMatchWithConfidence(getGwansangRatios(lm), FOREHEAD_SIGNATURES);
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
const EYEBROW_SIGNATURES = {
  EB_CRESCENT:  { browTiltR: -0.14 },                                // 반달 — 정점이 매끄럽게 솟은 아치만으로 판별
  EB_RAISED:    { browSlopeR: -0.10, browLenR: 1.05 },               // 올라간·짧고 두꺼움 — 바깥쪽이 확 올라간 대각선
  EB_DROOPY:    { browSlopeR:  0.08, mgW: 1.15 },                    // 처진·미간 넓음
  EB_TRIANGLE:  { browSlopeR: -0.02, mgW: 1.00 },                    // 삼각·일자 — 기울기 거의 없음, 미간은 표준
  EB_THICK:     { browSlopeR: -0.02, mgW: 0.75 },                    // 두꺼운·미간 좁음
  EB_THIN:      { browSlopeR:  0.02, mgW: 0.95, browLenR: 1.10 },    // 가는 눈썹
};
function classifyEyebrowTypeRuleBased(lm) {
  return nearestSignatureMatchWithConfidence(getGwansangRatios(lm), EYEBROW_SIGNATURES);
}

// ── 눈 크기·모양 8종 — waJ(눈 두께=크기 근사)·eyeTiltR(치켜/처짐)·innerEyeGapR(원거리/근거리안).
// ES_WIDE_SET/ES_CLOSE_SET은 archetype-db.js 자체에 "⚠️ 벤치마크 추정" 경고가 이미 있는 항목.
const EYE_SHAPE_SIGNATURES = {
  ES_BIG:       { waJ: 0.30 },
  ES_SMALL:     { waJ: 0.16 },
  ES_DROOPY:    { eyeTiltR: 0.04, waJ: 0.22 },
  ES_MONOLID:   { waJ: 0.15, eyeTiltR: 0.00 },
  ES_UPTURNED:  { eyeTiltR: -0.05, waJ: 0.24 },
  ES_DOUBLE:    { waJ: 0.28, eyeTiltR: 0.00 },
  ES_WIDE_SET:  { innerEyeGapR: 1.15 },
  ES_CLOSE_SET: { innerEyeGapR: 0.75 },
};
function classifyEyeShapeRuleBased(lm) {
  return nearestSignatureMatchWithConfidence(getGwansangRatios(lm), EYE_SHAPE_SIGNATURES);
}

// ── 코 9종 — junduR(콧볼 폭)·noseLenR(코 길이)·sanR(산근~콧대 세로 낙차, 콧대 융기 근사).
// 매부리코/꺾인코처럼 콧대 "곡률"이 필요한 유형은 sanR 하나로는 정밀하게 구분되지 않는다.
const NOSE_SIGNATURES = {
  NS_SMALL_SHORT: { junduR: 0.75, noseLenR: 0.75 },
  NS_WIDE:        { junduR: 1.05 },
  NS_AQUILINE:    { sanR: 0.16, noseLenR: 1.05 },
  NS_BENT:        { sanR: 0.18, junduR: 0.85 },
  NS_BIG:         { junduR: 1.00, noseLenR: 1.05 },
  NS_UPTURNED:    { sanR: 0.08, noseLenR: 0.80 },
  NS_ALAR_THICK:  { junduR: 0.95 },
  NS_ALAR_THIN:   { junduR: 0.70 },
  NS_BOKGO:       { junduR: 0.88, sanR: 0.10 },
};
function classifyNoseShapeRuleBased(lm) {
  return nearestSignatureMatchWithConfidence(getGwansangRatios(lm), NOSE_SIGNATURES);
}

// ── 입 6종 — mouthR(입 폭)·lipThickR(입술 두께)·mouthTiltR(입꼬리 기울기).
// ⚠️ mouthTiltR도 눈썹과 같은 종류의 스케일 오차가 있었다(±0.04로 가정했는데 실측값은 -0.105) — 눈썹
// 재보정과 같은 시점에 실측 1건 기준으로 ±0.10대로 넓혔다.
const MOUTH_SIGNATURES = {
  MS_THICK:      { lipThickR: 0.30 },
  MS_BIG:        { mouthR: 1.00 },
  MS_SMALL:      { mouthR: 0.78 },
  MS_THIN:       { lipThickR: 0.16 },
  MS_DOWNTURNED: { mouthTiltR: 0.10 },
  MS_UPTURNED:   { mouthTiltR: -0.10 },
};
function classifyMouthShapeRuleBased(lm) {
  return nearestSignatureMatchWithConfidence(getGwansangRatios(lm), MOUTH_SIGNATURES);
}

// ── 턱 6종 — jigakR(턱선폭/광대폭, GWANSANG_3TIER_THRESHOLDS와 동일 기준값 0.65/0.80 재사용)·
// chinHeightR(턱 세로 길이). 주걱턱(CS_UNDERBITE)처럼 옆모습이 필요한 유형은 정면 랜드마크만으로
// 원리적으로 판별이 어려워 다른 유형과 시그니처가 가깝게 겹친다.
// ⚠️ 최초 버전은 chinHeightR을 0.28~0.40으로 가정했는데 실측값은 0.54였다(사용자 리포트: 표준 턱선
// jigakR=0.75인 사진이 계속 CS_POINTED로 잘못 나옴, 2026-08-14) — chinHeightR 값이 시그니처 범위
// 밖에 있으니 모든 유형에 대해 오차가 크고, 그중 우연히 가장 값이 큰 CS_LONG/CS_POINTED 쪽으로
// 쏠린 것. 아래는 그 실측 1건 기준으로 0.45~0.62 범위로 다시 잡았다(여전히 표본 1건짜리 초안).
const CHIN_SIGNATURES = {
  CS_SQUARE:    { jigakR: 0.85, chinHeightR: 0.45 },
  CS_UNDERBITE: { jigakR: 0.80, chinHeightR: 0.50 },
  CS_ROUND:     { jigakR: 0.72, chinHeightR: 0.48 },
  CS_OVAL:      { jigakR: 0.68, chinHeightR: 0.52 },
  CS_LONG:      { jigakR: 0.65, chinHeightR: 0.62 }, // 길다=chinHeightR이 가장 큰 게 핵심 차별점
  CS_POINTED:   { jigakR: 0.55, chinHeightR: 0.55 }, // 좁다=jigakR이 가장 작은 게 핵심 차별점
};
function classifyChinShapeRuleBased(lm) {
  return nearestSignatureMatchWithConfidence(getGwansangRatios(lm), CHIN_SIGNATURES);
}

// ── 얼굴형 6종(직사각형/정사각형/삼각형/역삼각형/원형/타원형) — classifyFaceShape3(3분류, 문자열 반환)과는
// 별개 축. lenR(얼굴 길이)·jigakR(턱폭/광대폭)·foreheadWR(이마폭/광대폭) 3축 조합으로 6종을 구분한다.
// jigakR·lenR 범위는 이미 실측으로 검증된 FACE_SHAPE3_THRESHOLDS(lenLow1.05/lenHigh1.30,
// jigakLow0.65/jigakHigh0.80)를 그대로 앵커로 재사용했다(새로 지어낸 값이 아님) — 삼각형=턱이
// 넓고 이마가 좁음(역삼각형의 반대), 역삼각형=이마가 넓고 턱이 좁음 축으로 foreheadWR을 갈랐다.
const FACE_SHAPE_TYPE_SIGNATURES = {
  FS_SQUARE:       { lenR: 0.95, jigakR: 0.85, foreheadWR: 0.80 },
  FS_RECTANGLE:    { lenR: 1.35, jigakR: 0.82, foreheadWR: 0.78 },
  FS_TRIANGLE:     { lenR: 1.15, jigakR: 0.85, foreheadWR: 0.60 },
  FS_INV_TRIANGLE: { lenR: 1.15, jigakR: 0.55, foreheadWR: 0.90 },
  FS_ROUND:        { lenR: 0.98, jigakR: 0.70, foreheadWR: 0.72 },
  FS_OVAL:         { lenR: 1.28, jigakR: 0.68, foreheadWR: 0.75 },
};
function classifyFaceShapeTypeRuleBased(lm) {
  return nearestSignatureMatchWithConfidence(getGwansangRatios(lm), FACE_SHAPE_TYPE_SIGNATURES);
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
