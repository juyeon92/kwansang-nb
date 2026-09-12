# 분석 로직 서버 이관 설계서

> 작성일: 2026-09-07 / 작성자: 클로드(코드 실측 기반, 구현 전 설계 단계)
> 대상: https://kwansang-nb.com — 인연도감 / 통합분석 / 궁합보기 / 사주보기
> 목적: 개발팀 핸드오프용. 이 문서 자체는 설계서이며, 실제 이관 코드 구현은 별도 작업이다.
>
> **업데이트 (2026-09-08)**: 아래 2번 표 중 "js/character/*.js"와 "js/archetype-db.js"
> 항목은 이 설계서 작성 시점(9/7) 이전인 2026-08-30 커밋에서 이미 서버로 이관되어 있었다
> (`functions/engine/*.js` + `analyzeCharacter`/`getCompatibility`/`getArchetypeCatalog`/
> `getCharacterCatalog` 엔드포인트). 이 문서와 무관하게 독립적으로 이미 진행 중이던 작업이다.
> **업데이트 (2026-09-08, 계속)**: 아래 3개 전부 서버 코드 준비 + 로컬 검증까지 끝났다(배포·클라이언트
> 연결은 아직) — 진행 상황 섹션(아래) 참고.
> 1. ✅ `js/landmark-engine.js`의 판정 로직 → `functions/engine/gwansang-classify.js` + `classifyGwansang` 엔드포인트.
> 2. ✅ `js/app.js`의 사주 계산 엔진 → `functions/engine/saju-calc.js` + `computeSaju` 엔드포인트.
> 3. ✅ AI 프롬프트 3종 + Gemini 호출 → `functions/engine/prompt-builders.js` + `generateDeepReport`/
>    `generateAiEnhancement`/`generateGunghapReport` 엔드포인트(`geminiProxy`는 대조 검증 끝날 때까지 유지).
>
> **업데이트 (2026-09-12)**: 위 "미배포·미연결" 상태는 더 이상 사실이 아니다 — 커밋 `8d6bb53`("관상
> 판정 로직을 landmark-engine.js에서 완전히 제거 — js/app.js 렌더링 함수까지 전부 서버 이관")에서
> 클라이언트가 이미 `classifyGwansang`을 직접 호출하도록 바뀌었고(`js/character-api.js`
> `classifyGwansang()` → `js/app.js` `startAnalysis()`가 그 결과로 렌더링), 실제 Firebase 프로젝트에도
> 배포까지 끝나 있다(curl로 4개 엔드포인트 전부 직접 호출해 401 응답 확인 — 함수 자체는 살아있고
> 인증 토큰만 없어서 거부된 것). 이 섹션과 아래 "진행 상황"의 "아직 미배포·미연결" 문구들은 이제
> 스테일 상태다 — 실제 배포/연결 여부를 다시 확인하지 않고 이 문서 문구만 믿지 말 것.
> 아래 본문(1~7)은 작성 당시 전체 스코프 기준으로 쓴 원문이다 — 이미 끝난 부분도 포함해 그대로
> 남겨둔다(무엇이 왜 필요했는지 맥락 보존 목적). **실제 작업은 위 "아직 남은 작업" 3개 기준으로
> 진행한다.**

---

## 진행 상황 (2026-09-08)

### ✅ 2단계 — 사주 계산 엔진 순수 이관 (서버 코드 준비 완료, 아직 미배포·미연결)

- `js/app.js` 1173~2461행(═══ SAJU ═══ 전체)을 그대로 복사해 `functions/engine/saju-calc.js`로 옮겼다.
  로직은 한 글자도 바꾸지 않았다 — 마이그레이션 원칙(5번 2단계 "순수 이관") 그대로.
  - render*로 시작하는 DOM 렌더링 함수(17개)와 그 안에서만 쓰는 헬퍼는 지우지 않고 그대로 남겨뒀다
    (Node에서 호출되지 않으므로 죽은 코드일 뿐 위험 없음 — diff 비교가 쉽도록 일부러 남긴 것).
  - `OHAENG_GENERATES`/`OHAENG_CONTROLS`(원래 app.js 2773~2774행, COMBINED 섹션에 있던 것)는
    `calcSinkangSinyak`/`calcYongsin`이 참조하길래 같이 옮겼다 — 전수 의존성 검사(모든 대문자 상수·
    모든 함수 호출을 원본 파일과 대조)로 확인, 이 두 개 외에는 범위 밖 의존성이 없었다.
  - 브라우저 부트스트랩 코드 한 줄(`if (document.readyState==='loading') ...`)만 `typeof document
    !== 'undefined'` 가드로 무력화했다 — 이것도 로직 변경이 아니라 Node에 DOM이 없어서 나는
    `ReferenceError`를 막는 것뿐.
  - 새 진입점 `computeSajuBundle({ birthDate, birthHour, gender })`를 추가해 클라이언트가 지금까지
    `computePillars → computeOhaeng → computeDaeun → collectSajuInsightSummary → calcSinkangSinyak
    → calcYongsin` 순서로 조립하던 것과 동일한 파이프라인을 한 번에 실행하고, 이미 존재하는
    `analyzeCharacter` 엔드포인트가 기대하는 필드명(pillars/ohaengCounts/sinsalList/gwiinList/
    hasHour)에 맞춰 반환한다.
- `functions/package.json`에 `lunar-javascript`(브라우저에서 CDN으로 쓰던 것과 같은 라이브러리의
  npm 버전, `require('lunar-javascript')` → `{ Solar, Lunar, EightChar, ... }` 확인 완료) 의존성 추가.
- 새 Cloud Function `computeSaju`(`functions/index.js`)를 추가했다 — 인증(idToken)만 확인하고
  `computeSajuBundle`을 호출해 그대로 반환한다. `getCompatibility`와 같은 인증 패턴을 따랐다.
- **검증**: 로컬 Node에서 `computeSajuBundle` 직접 호출 테스트 — app.js 코드 주석에 이미 적혀 있던
  검증 사례("포스텔러 만세력, 1996-11-07 20:12 여자")로 대운을 계산해보니 무술·정유·병신·을미·
  갑오·계사·임진·신묘까지 8개가 정확히 일치했다. 시간 미상(-1) 경로도 크래시 없이 정상 동작 확인.
  - ⚠️ **발견한 기존 이슈(이번 이관과 무관, 원본 코드에 이미 있던 것)**: 주석은 "대운 9개"라고
    적혀 있는데 실제 코드(`yun.getDaYun(9)`)는 index 0(placeholder)을 걸러내고 나면 8개만 반환한다.
    로직을 그대로 옮겼을 뿐 고치지 않았다 — 원래 그런 동작이었는지, 주석이 오래돼 안 맞는 건지는
    확인이 필요하지만 이번 이관 범위 밖이라 그대로 뒀다.

**아직 안 한 것 (다음 단계)**:
1. `js/app.js`/`js/config.js`를 고쳐 클라이언트가 `computeSaju`를 호출하도록 바꾸기 — 지금은
   클라이언트가 여전히 로컬로 계산한다(서버 엔드포인트는 준비만 됐고 아무도 안 쓴다). 이 단계는
   실제 Firebase 프로젝트에 `computeSaju`를 배포한 뒤(`firebase deploy --only functions:computeSaju`),
   여러 실제 생년월일로 "로컬 계산 결과 vs 서버 응답"을 나란히 찍어봐서 완전히 같은지 확인하고
   나서 진행해야 한다 — 이 대조 검증은 로컬 Node 테스트만으론 부족하고 실제 배포·호출이 필요하다.
2. 검증 끝나면 `js/app.js`에서 이번에 옮긴 계산 함수들을 삭제(render* 함수는 그대로 둔다 —
   서버가 돌려준 데이터를 그 함수들이 계속 그려야 하므로).

### ✅ 1단계 — 관상 판정 로직 순수 이관 (서버 코드 준비 완료, 아직 미배포·미연결)

- `js/landmark-engine.js` 전체(1123행 — IDX 랜드마크 인덱스맵, `getGwansangRatios`, 눈/얼굴/이마/
  눈썹/눈모양/코/입/턱/얼굴형 9종 `classify*RuleBased*` 판정 함수, 시그니처·임계값 테이블 전부)를
  그대로 `functions/engine/gwansang-classify.js`로 옮겼다. `loadModels`(MediaPipe 모델 로딩)·
  `runFaceAnalysis`(캔버스 호출)·`toggleMirror`·`drawRegions`(디버그 오버레이)는 브라우저 전용이라
  Node에서 절대 호출되지 않지만 diff 비교를 위해 지우지 않고 그대로 남겨뒀다(saju-calc.js와 같은
  방식) — 이 파일에 모듈 스코프(함수 밖) DOM 참조가 있는지 전수 검사해서 없음을 확인했다.
- `js/app.js`의 `judgePartStatus`·`getPartLevelsSorted`·`gwansangLevel`·`GWANSANG_FEATURE_RANGE`·
  `PART_KEY_TO_MEASURE`(952~966행, 3347~3353행)도 같이 옮겼다 — `getGwansangRatios`가 반환한
  비율값을 받아 "부위별 강점/보완"을 판정하는, 바로 다음 단계라 분리하지 않았다.
- 새 진입점 `classifyGwansangBundle(lm)` 추가 — `classifyAllFeaturesRuleBased(lm)` →
  `getGwansangRatios(lm)` → `judgePartStatus(ratios)` 순서로 실행하고, `js/ai-analysis.js`의
  `classifyAndBuildCharacter`(3063~3084행)가 조립하던 것과 동일한 모양(`featureIds`/`confidences`/
  `partStatusMap`)으로 반환한다 — 이미 있는 `analyzeCharacter` 엔드포인트가 그대로 받아 쓸 수 있다.
- 새 Cloud Function `classifyGwansang`(`functions/index.js`) 추가 — 인증만 확인하고 `lm` 배열을
  받아 `classifyGwansangBundle`을 호출해 그대로 반환한다. `computeSaju`와 같은 패턴.
- **검증**: 합성 랜드마크(478점, 대략적인 좌표)로 로컬 Node에서 전체 파이프라인(9종 분류 + 부위별
  강점/보완 판정)을 실행 — 크래시 없이 끝까지 돌고 `analyzeCharacter`가 기대하는 모양 그대로
  나오는 것을 확인했다. ⚠️ 이건 "함수가 안 깨지고 끝까지 도는지"만 검증한 것이고, 판정 값 자체가
  실제 사진 기준으로 원본과 100% 같은지는 real 사진으로 배포 후 대조해야 확인된다(아래 "다음 단계"
  1번과 동일한 이유).

**이번엔 안 옮기고 남겨둔 것 (범위 밖, 다음 후보)**:
- `gwansangFeatureCompat`/`calcGwansangCompat`(js/app.js:3356~) — 궁합보기의 "관상 궁합" 두 사람
  비교 점수. `getGwansangRatios`를 그대로 재사용하지만 사람이 두 명이라 별도 엔드포인트 설계가
  필요해 이번 1인 기준 판정과 분리했다.
- `PART_CONTENT`/`PART_DEF`(js/app.js:886~952 부근)와 `renderSnapshotHighlights` — "가장 발달한
  부위" 스냅샷 카드에 쓰이는 해석 문구 콘텐츠 DB. 이미 서버로 옮긴 `archetype-db.js`/
  `character-db.js`와 같은 성격(콘텐츠 카탈로그)이라 같은 방식(`getArchetypeCatalog` 패턴)으로
  옮기면 되지만, 이번 패스에서는 "판정 로직" 이관에 집중하느라 남겨뒀다.

**아직 안 한 것 (다음 단계, 관상 판정 공통)**:
1. `classifyGwansang` 배포 후 실제 사진 여러 장으로 "클라이언트 로컬 판정 vs 서버 응답" 대조 검증.
2. 검증 끝나면 `js/ai-analysis.js`의 `classifyAndBuildCharacter`가 `classifyGwansang`을 호출하도록
   바꾸고, `js/landmark-engine.js`에서 판정 함수(classify*, 시그니처 테이블)만 삭제 — `loadModels`/
   `runFaceAnalysis`(MediaPipe 랜드마크 추출)는 계속 클라이언트에 남는다(4.2 결정 사항).
3. 남은 마지막 영역(AI 프롬프트 3종 + `geminiProxy`)은 그다음 — `computeSaju`/`classifyGwansang`이
   반환하는 값들을 그대로 재료 삼아 서버가 프롬프트를 조립하도록 바꾸는 작업이라, 이 두 단계가
   먼저 끝나 있어야 자연스럽게 이어진다.

### ✅ 3단계 — AI 프롬프트 3종 + Gemini 호출 순수 이관 (서버 코드 준비 완료, 아직 미배포·미연결)

- `js/ai-analysis.js` 전체(3270줄)를 그대로 `functions/engine/prompt-builders.js`로 옮겼다.
  render*/wire*/save* 등 DOM 조작 함수·카드 HTML 빌더는 Node에서 호출되지 않는 죽은 코드로 남겨뒀다
  (saju-calc.js·gwansang-classify.js와 같은 방식) — 모듈 스코프(함수 밖)에서 즉시 실행되던
  `renderGwansangRevisitCard();` 한 줄만 `typeof document !== 'undefined'` 가드로 무력화했다.
- **딱 4곳만 실제로 로직에 손을 댔다** — 전부 "2026-08-30 DB 이원화" 때 생긴 클라이언트 캐시 패턴
  (`await CharacterAPI.ensureXXXCatalog()`)을 서버가 이미 `require()`로 갖고 있는 것으로 대체한
  것뿐, 프롬프트 문구나 순서는 전혀 안 바꿨다:
  - `buildAiEnhancementSystemInstruction`: 캐시 재요청 줄 제거
  - `buildGunghapRelationBlock`: `CharacterAPI.getRelation()` → `classifyCompatibility()` 직접 호출
  - `buildDeepReportUserPrompt`: 캐시 재요청 줄 2곳 제거
- 새 파일 `functions/engine/part-content-db.js` 추가 — `js/app.js`의 `PART_DEF`/`PART_CONTENT`(관상
  부위별 해석 문구)를 복제(원본은 클라이언트에도 유지 — archetype-db.js처럼 클라이언트 원본을
  비우는 건 별도 작업).
- 새 함수 `callGeminiDirect`(prompt-builders.js) 추가 — `geminiProxy`의 키 순환·재시도 로직을 그대로
  가져오고, 클라이언트의 옛 `callGeminiAPI`가 하던 "응답에서 text 뽑아 JSON.parse" 단계까지 합쳐서
  최종 파싱된 리포트 객체를 바로 반환한다.
- 새 진입점 3개 추가 — `generateDeepReport`(통합분석/사주보기 딥리포트), `generateAiEnhancement`
  (관상 부위별 보완 + 눈모양·동물형상 재확인), `generateGunghapReport`(궁합 커플 해석). 클라이언트가
  지금까지 `build*SystemInstruction`/`build*UserPrompt`/`build*Schema`로 직접 조립해 `geminiProxy`에
  보내던 것과 같은 재료(ratios/statusMap/pillars/ohaeng/sajuInsight/characterResult/cache 등)를
  입력으로 받고, 최종 리포트만 반환한다.
- 새 Cloud Function 3개(`functions/index.js`) 추가 — `generateDeepReport`/`generateAiEnhancement`/
  `generateGunghapReport`. 인증(idToken) 확인 후 `geminiApiKeys` 시크릿에서 키를 뽑아 위 함수들에
  `apiKeys`로 넘긴다. **`geminiProxy`는 아직 그대로 둔다** — 대조 검증 끝나기 전까지는 폐기하지 않는다.
- **검증**: 다른 두 모듈보다 의존성이 훨씬 얽혀 있어서(이미 서버로 간 캐릭터/원형 DB, 사주 계산
  엔진, 트레이트 설정 등을 전부 참조) 자동 대조 스크립트로 "이 파일이 참조하는 이름 중 다른
  `functions/engine/*.js`에는 있는데 여기 없는 것"을 전수 검사했다 — 그 결과로 saju-calc.js·
  gwansang-classify.js에 원래 없던 export 몇 개(천간/지지 한글 테이블, 해석 문구 테이블,
  `get12Unseong`, `calcSinkangSinyak` 등)를 추가로 내보내야 했다. 그 다음 로컬 Node에서 더미
  데이터로 `generateDeepReport`/`generateAiEnhancement`/`generateGunghapReport` 3개 전부 시스템
  프롬프트 조립 → 사용자 프롬프트 조립 → 스키마 조립까지 크래시 없이 실행되는 것을 확인했다
  (Gemini 실제 호출 직전, "API 키가 없다" 에러에서 의도대로 멈춤 — 실제 키가 없는 로컬 환경이라
  정상적인 멈춤 지점).

**아직 안 한 것 (다음 단계)**:
1. 배포 후 실제 요청으로 "클라이언트가 지금 받는 리포트 vs 새 엔드포인트가 돌려주는 리포트"가
   완전히 같은지 대조 검증 — 프롬프트·스키마·이미지가 전부 실제 Gemini 호출로 이어지는 부분이라
   로컬 테스트만으론 부족하고, 실제 배포·여러 케이스 비교가 필요하다.
2. 검증 끝나면 `js/app.js`/`js/ai-analysis.js`의 호출부를 새 엔드포인트 fetch로 교체하고,
   `build*SystemInstruction`/`build*UserPrompt`/`build*Schema`/`callGeminiAPI`를 클라이언트에서 삭제.
3. `geminiProxy` 폐기(또는 접근 제한) — 4.4 참고.
4. 인연도감 개인정보 고지 문구를 4.1에서 정한 대로 수정.

이로써 설계서 2번 표의 4개 영역(캐릭터/궁합 DB, 관상 판정, 사주 계산, AI 프롬프트) **전부 서버 코드
준비가 끝났다.** 남은 건 전부 "배포 → 실제 대조 검증 → 클라이언트 전환 → 클라이언트 코드 삭제"
단계이고, 이건 로컬에서 대신 해줄 수 없는 부분이라 실제 배포 환경에서 진행해야 한다.

---

## 1. 배경

관상·사주·궁합을 판정하는 기준(임계값, 점수 계산식, 해석 DB, AI 프롬프트)이 전부 `index.html`이
로드하는 정적 JS 파일 안에 있다. 로그인·인증 없이 브라우저 개발자 도구(Sources 탭)만 열어도,
심지어 `curl https://kwansang-nb.com/js/파일명.js`로 다운로드만 받아도 그대로 읽힌다.
난독화·압축도 되어 있지 않고 한글 주석까지 그대로 남아 있어, 판정 기준·프롬프트·해석 DB를 그대로
복사해 유사 서비스를 만들 수 있는 수준으로 노출되어 있다.

**목표**: 인연도감·통합분석·궁합보기·사주보기가 결과를 "어떻게 도출하는지"의 과정 전체 —
판정 임계값, 점수 계산식, 해석 콘텐츠 DB, AI 시스템 프롬프트 — 를 클라이언트 소스에서 완전히
제거하고 서버(Firebase Cloud Functions)로 옮긴다. 클라이언트에는 최종 결과 텍스트만 남는다.

이미 안전한 부분(그대로 유지): Gemini API 키는 Firebase Secret Manager에만 있고, 실제 키 사용은
`functions/index.js`의 `geminiProxy`(Cloud Function) 안에서만 일어난다. **API 키 유출 위험은 없다.**
이번 작업 대상은 "판정 기준 자체"의 노출이다 — 성격이 다른 문제.

---

## 2. 현황 분석 (AS-IS) — 무엇이 어디에 있는가

전부 정적 파일로 서빙되는 `js/` 아래에 있다. 서버는 `functions/index.js` 하나뿐이고, 지금은
클라이언트가 조립한 프롬프트를 그대로 Gemini에 전달만 하는 "얇은 프록시" 역할만 한다.

| 파일 | 대략 규모 | 담고 있는 것 |
|------|----------|------------|
| `js/landmark-engine.js` | 986줄 | MediaPipe FaceLandmarker(478점) 로딩 + 랜드마크→비율 계산 + **규칙기반 관상 분류**(`classifyEyeArchetypeRuleBased`, `classifyFaceArchetypeRuleBased`, `classifyGwansang3Tier`, `scoreAgainstSignature`) + 실제 사진으로 튜닝한 시그니처/임계값 테이블 |
| ~~`js/archetype-db.js`~~ | ~~119줄~~ | ✅ **2026-08-30 이관 완료** — 눈 14종·얼굴 9종 원형(archetype)의 이름·전통 해석 문구·키워드 DB. 현재 클라이언트 버전은 20줄로 축소, 서버 `functions/engine/archetype-db.js` + `getArchetypeCatalog` 엔드포인트로 대체됨 |
| ~~`js/character/*.js`~~ (7개 파일) | ~~1,394줄~~ | ✅ **2026-08-30 이관 완료** — 인연도감 16캐릭터 DB, 캐릭터 판정 엔진, 궁합 점수 엔진(good/spark/clash 보정), 관상·사주 특성→캐릭터 매핑. `functions/engine/*.js` + `analyzeCharacter`/`getCompatibility`/`getCharacterCatalog` 엔드포인트로 대체, 클라이언트는 `js/character-api.js`(서버 호출용, 107줄)만 남음 |
| `js/ai-analysis.js` | 3,133줄 | Gemini에 보낼 시스템 프롬프트 3종 — `buildDeepReportSystemInstruction`(통합분석/사주 딥리포트, `js/ai-analysis.js:900`), `buildGunghapSystemInstruction`(궁합, `js/ai-analysis.js:331`), `buildAiEnhancementSystemInstruction`(관상 부위별 보완, `js/ai-analysis.js:262`) + 각 리포트 JSON 스키마 빌더 + `callGeminiAPI`(현재는 서버로 그대로 포워딩만 함, `js/ai-analysis.js:2167`) |
| `js/app.js` (일부) | 약 2,700줄 (682~3371행) | 사주(四柱) 계산 엔진 전체 — 십이운성(1181), 십성(1209 부근), 지장간/통근, 신강신약/용신, 천을귀인, 12신살, 기타 귀인/살, 공망, 대운, 사주 심층 리포트 조립 — **총 1,000줄 이상의 사주 계산 로직**. 그 외 "2030 MBTI 콘텐츠 엔진"(관상 부위별 성향 카드), 통합분석 오케스트레이션, 궁합보기 로직 |
| `functions/index.js` | 546줄 → 900줄대 | (서버, 안전) Gemini 프록시, 카카오 로그인/페이, 냥 지갑, 관리자 기능, **그리고 2026-08-30에 추가된** `analyzeCharacter`/`getCompatibility`/`getArchetypeCatalog`/`getCharacterCatalog`. **`geminiProxy`는 여전히 클라이언트가 보낸 systemInstruction을 검증 없이 그대로 Gemini에 전달** — 이 부분이 아직 남은 이관의 핵심 대상 |

### 현재 데이터 흐름 (AS-IS, 2026-09-08 기준 갱신)

```
[브라우저]
  사진 업로드 → MediaPipe(브라우저 WASM)로 478점 랜드마크 추출
    → 비율 계산 → 규칙기반 분류(landmark-engine.js, 아직 클라이언트)
    → 생년월일로 사주 계산(app.js 사주엔진, 아직 클라이언트) → pillars/ohaengCounts/sinsalList/gwiinList 산출
    → featureIds/confidences + 위 사주 값들을 실어 서버 analyzeCharacter 호출 ✅(이관 완료 구간)
        ↓
  [서버] functions/engine/*.js — 캐릭터 매핑, 궁합 점수, 원형 해석 문구 조회 → 결과 반환 ✅
        ↓
  [브라우저] ai-analysis.js가 위 결과 + 사주 계산값 등을 모아
      systemInstruction(프롬프트 원문 그대로, 아직 클라이언트) 조립
    → callGeminiAPI가 systemInstruction·userText·images·schema를 그대로 POST (아직 그대로)
        ↓
[서버: functions/index.js의 geminiProxy]
  받은 걸 그대로 Gemini API에 전달(키만 서버가 붙임) → 응답을 그대로 반환 (아직 그대로)
        ↓
[브라우저] 응답을 화면에 렌더링
```

**남은 문제**: 캐릭터/궁합 DB 조회 한 구간만 서버로 넘어갔을 뿐, "판정 임계값 계산"과 "사주
계산"과 "AI 프롬프트 조립"은 여전히 브라우저 안에서 끝난다. 이 세 곳만 읽어도 여전히 전체 판정
기준이 다 드러난다.

---

## 3. 목표 아키텍처 (TO-BE)

### 3.1 원칙

1. **클라이언트 = 입력 수집 + 결과 렌더링만.** 사진, 생년월일, 성별, 관계 유형, 사전 질문 답변 같은
   "원재료"만 서버로 보내고, 서버가 돌려준 "최종 리포트 텍스트"만 그대로 화면에 그린다.
2. **서버 = 판정·계산·해석·프롬프트·DB를 전부 소유.** 캐릭터/궁합 DB는 이미 이관됐으니, 남은
   세 항목(landmark-engine 판정부, ai-analysis 프롬프트 빌더, app.js 사주엔진)을 마저 Cloud
   Functions 내부 모듈로 옮긴다.
3. **API 응답에 내부 식별자·중간 수치를 담지 않는다.** `eye_archetype_id`, 원본 비율 수치, 임계값,
   캐릭터 벡터 점수 같은 "왜 그렇게 판정했는지 역산 가능한 값"은 응답에 넣지 않는다. 화면 렌더링에
   정말 필요한 값(예: 캐릭터 아이콘을 그리기 위한 캐릭터 ID 정도)만 예외적으로 허용한다.
4. **기존 `geminiProxy`처럼 "클라이언트가 프롬프트를 골라 보내는" 방식은 폐기한다.** 신규 엔드포인트는
   기능별로 고정된 프롬프트를 서버가 스스로 조립하고, 클라이언트는 프롬프트에 관여할 수 없다.

### 3.2 신규 Cloud Functions 엔드포인트 (안)

| 엔드포인트 | 대응 기능 | 클라이언트가 보내는 것 | 서버가 돌려주는 것 | 상태 |
|-----------|----------|----------------------|-------------------|------|
| `analyzeCharacter` | 인연도감 캐릭터 매칭 | 판정된 featureIds/confidences, (있으면) 사주 계산값 | 캐릭터 결과, 궁합 관련 문구 | ✅ 이미 존재 |
| `getCompatibility` / `getArchetypeCatalog` / `getCharacterCatalog` | 궁합 점수·원형/캐릭터 콘텐츠 | characterId 등 | 점수·콘텐츠 | ✅ 이미 존재 |
| `analyzeGwansangFeatures` (신규) | 인연도감·통합분석 공통 — 관상 판정 그 자체 | 사진(base64) 또는 랜드마크 좌표(4.1·4.2 결정에 따름) | featureIds·confidences(판정 임계값 로직은 서버 내부에 숨김) | ❌ 신규 필요 |
| `analyzeSaju` (신규) | 사주보기·통합분석 공통 — 사주 계산 그 자체 | 생년월일시, 성별 | pillars/ohaengCounts/sinsalList/gwiinList + 사주 리포트 텍스트 | ❌ 신규 필요 |
| `generateReport` (신규, 또는 기존 `geminiProxy` 대체) | 통합분석/궁합보기/사주보기 최종 리포트 | `analyzeCharacter`·`analyzeSaju` 결과 + 사전질문 답변 | 최종 리포트 텍스트(프롬프트는 서버가 고정 조립) | ❌ 신규 필요 |

즉 지금 필요한 건 "①관상 판정을 서버가 직접 하게 만드는 `analyzeGwansangFeatures`"와
"②사주 계산을 서버가 직접 하게 만드는 `analyzeSaju`"를 새로 만들어서, 클라이언트가 지금처럼
"이미 계산된 값"을 보내는 게 아니라 "원재료(사진/생년월일)"만 보내도록 순서를 한 단계 앞으로
당기는 것, 그리고 "③AI 프롬프트 조립을 서버로 옮긴 `generateReport`로 `geminiProxy`를 대체"하는
것이다.

### 3.3 이관 대상 파일 매핑 (남은 작업만)

| 클라이언트 파일(AS-IS) | 이관 대상 | TO-BE 위치 |
|---|---|---|
| `js/landmark-engine.js` 중 classify*/scoreAgainstSignature/시그니처 테이블 | 관상 판정 엔진 | `functions/engine/gwansang-classify.js` (신규) |
| `js/app.js` 중 사주 계산 엔진(대략 1181~2044행) | 사주 계산 엔진 | `functions/engine/saju-calc.js` (신규 — `functions/engine/saju-tables.js`는 이미 있으니 계산 로직만 추가) |
| `js/ai-analysis.js` 중 build*SystemInstruction, build*Schema, 관상 실측→텍스트 변환 | 프롬프트 빌더 | `functions/prompts/*.js` (신규) |
| `js/ai-analysis.js` 중 callGeminiAPI | Gemini 호출 클라이언트 | `functions/gemini-client.js` (내부 모듈화, HTTP 재노출 안 함) |

### 3.4 클라이언트 쪽 변경 (요약)

- `js/landmark-engine.js` — 판정 함수·시그니처 테이블 삭제. MediaPipe 랜드마크 추출 자체는
  일단 유지(4.2 참고). 추출한 좌표(또는 사진)를 `analyzeGwansangFeatures`로 보내는 부분만 추가.
- `js/ai-analysis.js` — `build*SystemInstruction`, `build*Schema`, `callGeminiAPI` 삭제. 대신
  `generateReport` 호출로 교체. 렌더링 함수(결과를 HTML로 그리는 부분)는 유지.
- `js/app.js` — 사주 계산 함수들(1181~2044행) 삭제. 대신 `analyzeSaju` 응답을 그대로 렌더링.
  화면 상태 관리·탭 전환·업로드 UX 등 순수 UI 로직은 그대로 둔다.
- `js/config.js` — `GEMINI_PROXY_URL`을 신규 엔드포인트 URL로 교체(이관 완료 시 제거).

---

## 4. 핵심 결정사항 — 착수 전 확인 필요

### 4.1 인연도감 "서버로 안 보낸다" 문구와의 충돌 ⚠️

지금 인연도감은 사용자에게 **"사진은 브라우저에서만 분석하고 서버로 보내지 않으며 저장하지도
않아요"**라고 명시하고 있다(`js/inyeon-dogam.js:41`). 그런데 판정 로직(`analyzeGwansangFeatures`)을
서버로 옮기면 최소한 랜드마크 좌표나 사진 자체를 서버에 전송해야 하므로 이 문구와 정면으로 충돌한다.

**아래 중 하나를 정책적으로 확인받아야 한다** (개발 착수 전 필수):
- **(a)** 문구를 통합분석과 동일하게 *"AI 분석을 위해 사용 후 서버에 저장 없이 즉시 삭제됩니다"*로
  변경한다. 사진 자체가 서버를 거치는 걸 사용자에게 명확히 알리는 방식.
- **(b)** 절충안 — 원본 사진은 계속 브라우저에서만 다루고(서버 전송 안 함), MediaPipe로 뽑은
  **좌표 숫자 배열(478개 점의 x,y,z)만** 서버로 보낸다. 좌표만으로는 원본 사진을 복원할 수 없으므로
  "사진 자체는 서버로 전송되지 않는다"는 문구를 유지할 근거가 될 수 있다. 다만 좌표도 넓게 보면
  개인 식별 가능 정보로 볼 여지가 있어, 법무/운영 쪽 확인이 필요하다.

이 결정에 따라 `analyzeGwansangFeatures`의 요청 바디가 "사진(base64)"이 될지 "좌표 배열"이 될지가
갈린다.

### 4.2 랜드마크 추출(478점 좌표 계산) 자체를 어디서 할지

- **1차 권장안**: 지금처럼 **클라이언트(브라우저 MediaPipe WASM)에 유지**. 판정 임계값·점수식·
  프롬프트는 서버로 옮기므로, 남는 건 "MediaPipe라는 공개 모델을 브라우저에서 돌린다"는 사실뿐이다
  — 이건 구글이 공개한 범용 얼굴 인식 기술이라 이 서비스만의 "판정 기준"은 아니다. 작업 범위가
  가장 작고 리스크도 낮다.
- **2차 옵션(더 강한 보안, 별도 작업)**: 랜드마크 추출까지 서버로 옮기려면 Node Cloud Functions에서
  브라우저용 MediaPipe Tasks Vision(WASM)을 그대로 못 돌리므로, Python 기반 별도 서비스(Cloud Run
  + 공식 `mediapipe` 파이썬 패키지)를 새로 구축해야 한다. 인프라가 하나 늘고 Node↔Python 통신
  구조가 필요해 작업 범위가 크다. **1차 이관 완료 후 필요하면 별도로 검토한다.**

### 4.3 궁합보기의 상대방 사진

궁합보기는 나뿐 아니라 상대방 사진도 함께 서버로 보내야 하므로, 4.1의 개인정보 문구 정합성이
상대방 몫에도 동일하게 적용된다. 기존에 상대방 동의를 받는 흐름이 있다면 그대로 따르되, 이번에
"사진이 서버를 거치는 방식으로 바뀐다"는 사실만 반영한다.

### 4.4 기존 `geminiProxy` 처리

`generateReport`가 생기면 기존 `geminiProxy`(클라이언트가 임의 systemInstruction을 보내 호출하는
방식)는 더 이상 필요 없다. **폐기(삭제)하거나, 최소한 인증된 관리자만 호출 가능하도록 잠가야 한다.**
지금 그대로 두면 로그인한 사용자가 브라우저 콘솔에서 직접 `fetch(GEMINI_PROXY_URL, {...})`를 호출해
임의 프롬프트로 Gemini를 무제한 소비할 수 있다(냥 차감 로직이 걸려있지 않은 경로라 더 위험).

---

## 5. 마이그레이션 단계 (권장 순서, 남은 작업 기준)

1. **정책 확인** — 4.1(개인정보 문구), 4.2(랜드마크 추출 위치)를 먼저 확정한다. 이 두 개가 정해져야
   `analyzeGwansangFeatures`의 API 계약(요청 바디 모양)이 확정된다.
2. **순수 이관(로직 변경 없이 복사)** — `landmark-engine.js` 판정부, `app.js` 사주엔진, `ai-analysis.js`
   프롬프트 빌더를 그대로 Cloud Functions 내부 모듈로 옮긴다. 로직은 한 글자도 안 바꾼다(이번
   목적은 "숨기는 것"이지 "개선하는 것"이 아니므로, 옮기며 버그를 만들지 않도록 순수 이동만 한다).
3. **동작 동등성 검증** — 같은 입력(테스트용 사진·생년월일 세트)으로 이관 전/후 결과가 완전히
   같은지 비교한다(리포트 텍스트, 캐릭터 판정, 궁합 점수 전부).
4. **신규 엔드포인트 구현** — `analyzeGwansangFeatures`, `analyzeSaju`, `generateReport`를 만들고,
   냥 차감(`nyangSpend`)과 분석 실행을 하나의 흐름으로 묶는다(현재는 별도 호출이라, 냥 차감 성공
   후 분석 API를 별도로 direct 호출해 우회하는 경로가 없는지 점검 필요).
5. **클라이언트 교체** — `js/app.js`, `js/ai-analysis.js`의 호출부를 신규 엔드포인트 fetch로 교체.
6. **클라이언트 코드 삭제** — `js/landmark-engine.js`, `js/ai-analysis.js`, `js/app.js`에서 판정·
   계산·프롬프트 관련 함수 삭제(렌더링 함수만 남김).
7. **재검증** — 배포 후 개발자 도구로 다시 확인한다: `js/` 아래 파일들을 전부 열어봐도 판정 기준·
   프롬프트가 안 보이는지, Network 탭에서 요청 바디에 원재료 외의 값(중간 점수, 내부 ID 등)이
   섞여 나가지 않는지 확인.
8. **`geminiProxy` 정리** — 4.4에 따라 폐기 또는 접근 제한.
9. **개인정보 고지 반영** — 4.1에서 정한 문구로 인연도감 안내 문구 수정.

---

## 6. 서버 이관 후에도 남는 위험 (체크리스트)

- [ ] **App Check** 적용 여부 — 지금 Cloud Functions는 `cors: true`만 걸려 있어 브라우저가 아니어도
      `curl`로 직접 호출 가능하다. Firebase App Check을 붙이면 "정식 앱에서 온 요청"만 통과시킬 수 있다.
- [ ] **요청 바디 크기 제한** — 사진 base64 업로드가 원재료로 들어오므로, 과도하게 큰 파일로 인한
      비용·부하 공격을 막기 위해 사이즈 캡을 건다.
- [ ] **응답 필드 검수** — 신규 엔드포인트 응답에 내부 식별자·원본 수치·임계값이 섞여 나가지 않는지
      릴리스 전 별도 리뷰.
- [ ] **Rate limit** — 냥 차감이 걸려 있지 않은 무료 플로우(예: 관상 부위별 보완 문장)가 있다면
      호출 횟수 제한 검토.
- [ ] **`geminiProxy` 폐기 확인** — 배포 후 실제로 그 URL을 호출했을 때 거부되는지 확인.

---

## 7. 결론 및 요청사항

- 이번 이관은 API 키 문제(이미 안전)가 아니라 **"판정 기준·해석 DB·AI 프롬프트가 정적 파일로
  그대로 노출된다"**는 문제다. 캐릭터/궁합 DB 이관은 이미 완료됐고, **남은 대상은
  `js/landmark-engine.js`(판정부), `js/ai-analysis.js`(프롬프트·스키마 빌더), `js/app.js`의 사주
  계산 엔진(약 1,000줄) — 총 4,000줄 이상의 로직이다.**
- **개발 착수 전 반드시 확인 필요**: 4.1(인연도감 개인정보 문구를 어느 쪽으로 바꿀지) — 이게 정해져야
  `analyzeGwansangFeatures`의 요청 바디 설계가 확정된다.
- 4.2(랜드마크 추출 위치)는 1차로는 클라이언트 유지를 권장하며, 필요시 이관 완료 후 별도 검토로 미룬다.
- 5번 마이그레이션 단계는 "로직 변경 없는 순수 이관 → 검증 → 엔드포인트 구현 → 클라이언트 교체 →
  삭제 → 재검증" 순서를 지켜야 이관 중 실제 서비스 결과가 달라지는 사고를 막을 수 있다.
- 이 문서는 설계 단계 산출물이다. 실제 코드 이관은 위 순서대로 별도 작업으로 진행하며, 규모가 크므로
  한 번에 다 하기보다 기능별(관상 판정 → 사주 계산 → AI 프롬프트 순 등)로 나눠 진행하는 것을
  권장한다.
