# 관상냥반(kwansang-nb) 스타일 가이드

> 대상: https://kwansang-nb.com (이 저장소 `index.html` 단일 페이지 앱)
> 작성일: 2026-09-07 / 작성자: 클로드(코드 실측 기반)
> 2026-09-11 업데이트: 7~10번(버튼/인풋/배지·라벨/안내박스 컴포넌트화) 추가 — 피그마
> [인연도감 화면 레퍼런스](https://www.figma.com/design/db1VP9BKUPFb09qBa6hBLu/Untitled?node-id=32-7886)의
> **구조(사이즈 단계, padding, radius, 상태 분기)만** 참고했다. 이 피그마 파일은 롯데렌탈
> 차방정 공통 컴포넌트 라이브러리(Primary 컬러 `#e60012` 롯데레드) 위에 만들어져 있어서,
> 색상은 절대 그대로 가져오지 않고 전부 kwansang-nb 기존 토큰(민트 계열)으로 매핑했다 —
> 실제 코드에 이미 있는 값과 대조해서 일치하는 것만 표로 확정했다(아래 각 섹션에 실측 근거 명시).
> 목적: 새 페이지·섹션을 추가하거나 기존 화면을 고칠 때마다 컬러·간격·레이어 규칙이 매번
> 조금씩 어긋나는 문제를 막는다. **이 문서 + `CLAUDE.md`를 먼저 읽고 작업한다.**



---

## 0. "노드구조로 만들어야 하니?" — 결론: 아니오


실제로 지금 스타일이 깨지는 원인은 두 가지였다(아래에서 실측):
1. **간격 값이 토큰화되어 있지 않다** — `padding`/`margin`/`gap`에 4px 배수 값과 5·7·9·13·15·18px 같은
   임의 값이 섞여 있다(예: `12px`가 81번, `13px`가 6번, `15px`가 9번 등). 새 섹션을 만들 때 기준이 없으니
   작업할 때마다 감으로 값을 정하게 된다.
2. **z-index가 그때그때 주석으로만 관리된다** — `100, 101, 102, 103, 120, 200, 300` 같은 값이 스타일시트
   여기저기 흩어져 있고, "마이페이지 팝업(101) 위에 떠야 하니 102" 식으로 이전 값을 찾아가며 다음 값을
   정해왔다. 정해진 스케일이 없어 새 오버레이를 추가할 때마다 헤맨다.

아래 1~6은 "지금 코드에 실제로 쓰이는 값"을 기준으로 계층을 정리한 것이고, 7~10은 버튼/인풋/배지·라벨/
안내박스를 컴포넌트 단위로 표로 정리한 것, 11은 새로 추가한 CSS 변수(값 변경 없이 additive)다.

---

## 1. Color

### 1.1 Base
| 이름 | HEX | 비고 |
|------|-----|------|
| White | `#FFFFFF` | `--bg`, `--surface` |
| html 배경 | `#E5E5E5` | 데스크톱에서 390px 프레임 밖 여백 |

### 1.2 브랜드 컬러 — Primary (Mint)
| CSS 토큰 | HEX | 용도 |
|----------|-----|------|
| `--mint` | `#55CCBB` | Primary CTA 배경, 강조 아이콘/텍스트 배경 |
| `--mint-05` | `rgba(85,204,187,.05)` | 아주 옅은 배경 tint |
| `--mint-10` / `--mint-tint-10` | `rgba(85,204,187,.10)` | 배지·행 선택 배경(동일 값, 별칭 중복 — 8번 참고) |
| `--mint-soft` | `#EDF9F6` | 카드 배경(오행 기둥 등) |
| `--mint-border` | `#CBEDE6` | mint-soft 카드 테두리 |

### 1.3 브랜드 컬러 — Secondary (Beige)
| CSS 토큰 | HEX | 용도 |
|----------|-----|------|
| `--beige` | `#E6D1A7` | 보조 강조 테두리(지지 기둥 카드 등) |
| `--beige-bg` | `#F8F4EC` | 보조 강조 배경 |
| `--beige-chip-bg` | `#F3E8D3` | 칩 배경 |
| `--beige-chip-text` | `#675536` | 칩 텍스트 |

### 1.4 리포트 다크 톤 (Ink/Jade)
사주·궁합 리포트 안에서 텍스트/강조에 쓰는 어두운 민트 계열. Primary(`--mint`)보다 어둡고 채도 낮음 — 배경 위 텍스트 대비용으로 분리되어 있다.
| CSS 토큰 | HEX |
|----------|-----|
| `--ink` | `#163B38` |
| `--jade` | `#2F6F68` |

### 1.5 경고/추정 톤 (Est — 앰버)
시간 미상 등 "추정값" 배지 전용. 오행 5색 팔레트와 겹치지 않게 의도적으로 분리한 색.
| CSS 토큰 | HEX |
|----------|-----|
| `--est` | `#E68A2E` |
| `--est-bg` | `#FDF1E3` |
| `--est-border` | `#F3D6AC` |

### 1.6 Grayscale — Text
| CSS 토큰 | HEX | 용도 |
|----------|-----|------|
| `--text-heading` | `#040404` | 팝업/앱바 타이틀 |
| `--text-title` | `#111111` | 섹션 라벨 ("관상 정보" 등) |
| `--text-strong` | `#333333` | 이름, 폼 라벨 |
| `--text-strong2` | `#3b3b3b` | "안심하세요" 등 강조 서브텍스트 |
| `--text-sub` | `#666666` | 일반 서브텍스트, 아이콘 |
| `--text-sub2` | `#5b5b5b` | 헬퍼텍스트, 안내 문구 |
| `--text-caption` | `#706a72` | 업로드 캡션 등 옅은 문구 |
| `--text` | `#17201F` | 리포트 전용 본문색(1.7 참고) |
| `--text2` | `#68716F` | 리포트 전용 서브 |
| `--text3` | `#9AA3A1` | 리포트 전용 캡션 |

> ⚠️ `--text-*`(헤더/폼용)와 `--text`, `--text2`, `--text3`(리포트 카드용) 두 세트가 병존한다. 실수로 섞어 쓰지 않도록 주의 — **폼/헤더/팝업 화면**에는 `--text-heading/-title/-strong/-sub` 계열을, **사주·궁합 리포트 카드 내부**에는 `--text/--text2/--text3`를 쓴다.

### 1.7 Grayscale — Border / Background (리포트 카드 전용)
| CSS 토큰 | HEX | 용도 |
|----------|-----|------|
| `--border-gray` | `#d9d9d9` | 인풋/뱃지 테두리 |
| `--border-gray2` | `#dddddd` | 업로드 드롭존 테두리 |
| `--border-lavender` | `#e8e2e8` | 팝업/헤더 구분선, 미선택 칩 테두리 |
| `--border` | `#E3E9E7` | 리포트 카드 테두리 |
| `--bg-soft` | `#f3f6f8` | 안심 안내 박스 배경 |
| `--bg-soft2` | `#f3f3f3` | 배너 영역 배경 |
| `--bg-info-yellow` | `#fffaef` | 사진 팁 안내 박스 배경 |
| `--card2` | `#F0F4F3` | 리포트 카드 배경(hover 등) |

### 1.8 Icon
| CSS 토큰 | HEX |
|----------|-----|
| `--icon-orange` | `#ff9533` |
| `--icon-purple-gray` | `#504250` |

### 1.9 관상 캐릭터 카드 톤 (Char Navy) — 이번에 새로 토큰화

> 실측 근거: 피그마 실제 화면(`공유인(오너)` 섹션, 라이브러리 컴포넌트 아님)에서 색상 사용 빈도를 스캔한 결과 `#26375a`가 59회, `#1c2942`가 18회로 민트·베이지 다음으로 많이 쓰이는 색이었다. `index.html`을 대조해보니 **이미 코드에도 16회 / 4회 하드코딩**돼 있었다 — 토큰만 없었을 뿐 이미 실제로 쓰이고 있는 색이라 바로 표로 확정한다(1.9 규칙에 따라 새 의미 색상은 확인 후 추가해야 하지만, 이건 "새로 추가하는 색"이 아니라 "이미 쓰고 있는데 토큰이 없던 색"이라 실측 기반으로 바로 반영).

| CSS 토큰 | HEX | 용도 | 코드 근거 |
|----------|-----|------|----------|
| `--char-navy` | `#26375a` | 관상 캐릭터 카드(`char-card`) 테두리·배지·리본 배경, 상세 섹션 타이틀 | `.char-card`, `.char-card-badge`, `.char-detail-sec-title` 등 16곳 |
| `--char-navy-deep` | `#1c2942` | 캐릭터 이름(`char-card-name`), 캐릭터 상세 헤드라인 — `--char-navy`보다 더 어두운 강조 | `.char-card-name`, `.char-detail-headline` 등 4곳 |

- 이 두 톤은 관상 캐릭터(학자상·선봉장상 등 아키타입) 카드 전용이다 — 리포트 카드에 쓰는 `--ink`/`--jade`(1.4)와 헷갈리지 않는다. `--ink`/`--jade`는 민트 계열 다크톤, `--char-navy`/`--char-navy-deep`는 네이비 계열로 색 축 자체가 다르다.
- `.char-card` 배경 그라디언트(`linear-gradient(160deg, #f6fdfb, #e6f6f1)`)처럼 그라디언트로 쓰이는 값은 이번에 토큰화하지 않았다 — 단색 HEX만 우선 정리했다.

### 1.10 경고 태그 톤 (Char Tag) — 이번에 새로 토큰화

> 같은 방식으로 스캔한 결과, `.char-tag`(관상 캐릭터 특징 태그)에 이미 2색 체계가 하드코딩돼 있었다 — `is-spark`(주황, 강점 강조) / `is-clash`(레드, 상충·주의). `--icon-orange`(1.8)와 짝을 이루는 텍스트 색이라 여기 같이 정리한다.

| CSS 토큰 | HEX | 용도 | 코드 근거 |
|----------|-----|------|----------|
| `--char-tag-spark` | `#a15c12` | 강점/스파크 태그 텍스트(배경은 `rgba(255,149,51,.14~.16)` = `--icon-orange` 계열) | `.char-tag.is-spark`, `.z3-measure-badge.is-fill`, `.nh-badge.is-minus` 등 5곳 |
| `--char-tag-clash` | `#a63d3d` | 상충/주의 태그 텍스트(배경 `rgba(196,80,80,.13)`) | `.char-tag.is-clash` |

- ⚠️ `--char-tag-spark`(주황 계열)는 1.5의 `--est`(추정값 경고, `#E68A2E`)와 색 톤이 비슷해서 헷갈릴 수 있다 — **`--est`는 "시간 미상 등 추정값" 전용, `--char-tag-spark`는 "관상 캐릭터 강점 태그" 전용**으로 용도가 다르다. 두 개의 별도 주황 계열이 생긴 건 레거시라, 언젠가 하나로 합칠지는 12번(다음 단계 제안)에 남겨뒀다.

### 1.11 피그마에서 발견했지만 아직 코드에 없는 색상 (미확정 — 추가 전 확인)

같은 스캔에서 아래 색상들도 눈에 띄었지만, **코드에는 아직 하드코딩된 사례가 없다** — 순수 피그마 목업 단계라 판단해 토큰으로 바로 확정하지 않았다. 실제로 그 화면(궁합 CompatChip, 캐릭터 아바타 플레이스홀더 등)을 구현할 때 이 색을 쓸지 다른 기존 토큰으로 대체할지 먼저 확인받는다.

| HEX | 피그마 추정 용도 |
|-----|------------------|
| `#d2f0ea`, `#f2e5dc`, `#f6edd0` | 궁합 호환성 칩(`CompatChip`)의 tint 배경 3종 — 이미 있는 `--mint-tint-10`/`--beige-chip-bg`/`--est-bg`로 대체 가능한지부터 확인 |
| `#fbeddd` | 아바타 플레이스홀더 배경 |
| `#eaf7f3` | `TaglinePill` 배경(민트 계열 tint, `--mint-tint-10`과 유사하지만 다른 값) |
| `#6b7789`, `#2d3c52`, `#33455f` | 캐릭터 성향 설명 텍스트("주도"/"실행"/"관계" 등)의 추가 톤 |

### 1.12 컬러 사용 규칙
- 새 화면·섹션을 만들 때 **위 토큰 중 하나를 반드시 사용**한다. HEX를 새로 하드코딩하지 않는다.
- 정말 새로운 의미(색상)가 필요하면(예: 새 기능의 강조색) 이 표에 새 항목을 추가하고 나서 쓴다 — 그 자리에서 즉흥적으로 HEX를 넣지 않는다. 단, 1.9~1.10처럼 **이미 코드에 반복 사용 중인데 토큰만 없던 색**은 실측만 확인되면 바로 표로 올린다.
- Primary 액션(제출 버튼, 핵심 CTA)은 항상 `--mint`. 두 번째로 강조가 필요한 요소(부제, 보조 정보 카드)에 `--beige` 계열.

---

## 2. Typography

폰트: `-apple-system, BlinkMacSystemFont, 'Pretendard', 'Malgun Gothic', '맑은 고딕', sans-serif`
(웹폰트 `@font-face`로 Pretendard를 직접 로드하지 않고 시스템 폰트 우선 스택에 끼워 넣는 방식 — 차방정처럼 Pretendard CDN을 강제 로드하지 않는다. 그대로 유지)

실측 결과 별도의 typography 토큰(`--typography_*`)은 없고 컴포넌트마다 `font-size`/`font-weight`를 개별 지정한다. 기존 코드에는 12.5px·13.5px·11.5px 같은 0.5px 단위 값이 섞여 있지만(과거에 감으로 잡은 값들), **새 텍스트를 추가할 때는 아래 표의 정수 값만 쓴다** — 범위(`~`)나 소수점 값을 새로 만들지 않는다. 표에 없는 크기가 필요하면 가장 가까운 줄을 그대로 쓸지, 새 줄을 추가할지 먼저 확인받는다.

| 용도 | font-size | font-weight | 실제 클래스(근거) |
|------|-----------|-------------|------------------|
| 페이지 타이틀 | 20px | 700 | `.shop-head h2` |
| 팝업/바텀시트 타이틀 | 20px | 500 | `.popup-header`, `.bottomsheet-header` |
| 리포트 핵심 숫자(오행 기둥) | 20px | 900 | `.pillar-stem`, `.pillar-branch` |
| 섹션·카드 타이틀(리포트·궁합 카드류) | 15px | 800 | `.card-title`, `.zone-label`, `.zone-basis-title` |
| 섹션·카드 타이틀(인연도감 카드류) | 16px | 800 | `.dogam-title`, `.dogam-share-card-head` |
| 카드 내부 소제목(L3 안에서 중첩) | 13px | 800 | `.chemi-title`, `.moment-title`, `.z3-pair-title` |
| 이름 · 프로필명(강조 본문) | 16px | 500 | `.profile-name` |
| 리스트 행 본문 | 14px | 500 | `.profile-row-name` |
| 일반 본문 | 13px | 400 | 리포트 본문 문단 다수 |
| 서브텍스트 · 헬퍼 | 12px | 400 | `.gg-manse-sub`, `.saju-char-counter` |
| 캡션 | 10px | 400 | `.pillar-hanja` |
| 배지 · 뱃지 텍스트 | 10px | 800 | `.est-tag` (9번 참고) |

- 이 표는 2.1(타이틀 계층)의 결정값과 완전히 같은 숫자를 쓴다 — 타이틀류는 여기서 다시 고민하지 말고 2.1을 본다.
- 위 표에 없는 13.5px·14px·14.5px·11.5px·12.5px 등은 리포트 화면에 이미 남아있는 **레거시 값**이다 — 손대는 김에 위 표 값으로 바꿀 필요는 없지만(3번 Spacing과 같은 원칙), **새로 텍스트를 추가할 때 이 소수점 값들을 새로 따라 쓰지 않는다.**

line-height는 차방정처럼 전역 고정값(140%)을 쓰지 않고 요소별로 다르다(1.4~1.9 등 리포트 텍스트는 더 넉넉하게). 새 텍스트 블록은 **본문류 1.4~1.5, 표/약관류 1.6~1.9** 정도로 맞춘다.

### 2.1 타이틀 계층 — 중첩 깊이 기준 5레벨

이전 버전은 4레벨로 뭉뚱그렸는데, 실제로 화면을 열어보면 **"화면 → 카드(섹션) → 카드 안의 소제목"** 3단 중첩 구조가 있고 그 위/옆에 오버레이 계열(팝업·바텀시트)이 따로 있다. 아래 표는 이 중첩 깊이를 기준으로 다시 잡은 것 — 새 타이틀을 넣을 때 **"지금 만드는 게 화면 전체 제목인지 / 카드 하나의 제목인지 / 그 카드 안에서 또 나뉘는 소제목인지"**부터 판단하고 레벨을 고른다.

```
화면(Page)
└─ L1 페이지 타이틀 ("인연도감")
    └─ 카드/섹션(하나의 정보·액션 단위)
        └─ L3 섹션·카드 타이틀 ("내 인연 등록하기")
            └─ L4 카드 내부 소제목(그 카드 안에서 다시 나뉘는 항목 제목)

오버레이(Page 흐름 밖)
└─ L2 팝업/바텀시트 헤더 타이틀 (오버레이 상단바)
    └─ L5 바텀시트 안내 타이틀(본문 첫 줄, 질문형 안내 문구)
```

| 레벨 | 용도 | font-size | font-weight | 색상 토큰 | 실제 예시 |
|------|------|-----------|-------------|----------|----------|
| L1. 페이지 타이틀 | 화면 최상단 대제목, 화면당 1개만 | 20px | 700 | `--text-title` | `.shop-head h2` |
| L2. 팝업/바텀시트 헤더 타이틀 | 오버레이 상단바(페이지 흐름과 무관, 열릴 때만 존재) | 20px | 500 | `--text-heading` | `.popup-header`, `.bottomsheet-header` |
| L3. 섹션·카드 타이틀 | 카드 하나(= 하나의 정보·액션 단위)를 대표하는 제목 | **16px**(인연도감 카드류) 또는 **15px**(리포트·궁합 카드류) | 800 | `--text-title`(인연도감) 또는 `--jade`(리포트 카드) | `.dogam-title`("내 인연 등록하기"), `.card-title`, `.zone-label` |
| L4. 카드 내부 소제목 | L3 카드 **안에서** 다시 나뉘는 하위 항목 제목(그 카드를 벗어나면 안 쓰는 제목) | 13px | 800 | `--jade` | `.chemi-title`, `.moment-title`, `.z3-pair-title` |
| L5. 바텀시트 안내 타이틀 | 바텀시트 본문 첫 줄, 질문형 안내 문구(L2 헤더와 별개로 본문 안에 한 번 더 있는 타이틀) | 16px | 800(ExtraBold) | `--text-title` | "인연도감을 계정에 보관할까요?" 류 |

- **L3는 화면 영역에 따라 16px과 15px 두 값이 실제로 다 쓰인다** — 범위(15~16)가 아니라 두 개의 구체적 컨텍스트다: 인연도감처럼 "카드 = 하나의 완결된 액션 블록"이면 16px, 사주·궁합 리포트처럼 "카드 = 분석 항목 하나"면 15px. 새로 만들 때 둘 중 자기 화면이 어느 쪽에 더 가까운지 보고 고른다 — 애매하면 15px(더 일반적인 리포트 카드 기본값)을 쓴다.
- L3와 L4는 둘 다 **weight 800**으로 통일한다. 코드에 `mypage-section-title`(14px/700), `dogam-detail-subhead`(14px/700), `saju-q-title`(16px/700)처럼 700을 쓴 타이틀도 있지만 소수(전체 타이틀류 중 약 1/4)이고, 새 화면에 지금 이 표대로 800을 쓰지 않으면 기존 다수 화면과 어긋난다 — 700 계열은 손대지 않고 그대로 두되, 새로 추가할 때 따라 쓰지 않는다.
- L4보다 한 단계 더 안쪽(카드 안의 카드)에 타이틀이 또 필요하면, 13px보다 작은 새 크기를 즉흥적으로 만들지 않고 먼저 확인받는다 — 지금 코드에 그런 4단 중첩 타이틀 사례가 없다.
- 서브타이틀(타이틀 바로 아래 보조 설명)은 타이틀 대비 **font-size 12px, font-weight 400, 색상 `--text-sub`**가 기본 조합이다. 실측: L5 타이틀(16px/800) + 서브텍스트(12px/400, `--text-sub`) — 인연도감 보관 안내 바텀시트.
- 타이틀에 색을 줄 때 `--jade`(짙은 민트)와 `--text-title`(거의 검정) 두 가지가 섞여 쓰인다 — **리포트 카드 내부(L3~L4)는 `--jade`, 그 외 화면(L1 페이지/L3 인연도감류/L5 바텀시트)은 `--text-title`**을 기본으로 한다.

### 2.2 레거시 타이틀 전체 목록 (실측)

위 5레벨 표에 들어가지 않은 "타이틀/헤드/헤드라인" 이름의 클래스를 전부 실측했다. **새로 만들 때는 이 표의 값을 따라 쓰지 않는다** — 이미 화면에 있는 값을 찾아볼 때만 참고한다(예: "이 화면 기존 타이틀이 몇 px였지?"). 각 행에 지금 5레벨 표 기준으로 가장 가까운 레벨을 붙여놨다 — 다음에 그 화면을 손댈 때 어느 레벨로 수렴시킬지 판단하는 근거로 쓴다.

| 클래스 | font-size | font-weight | 색상 | 쓰는 화면 | 가장 가까운 표준 레벨 |
|--------|-----------|-------------|------|----------|---------------------|
| `.cmb-hero-title` | 21px | 900 | `--ink` | 통합분석 히어로 | L1에 근접(더 큼 — 히어로 전용 예외로 유지) |
| `.compat-grade` | 20px | 800 | `--jade` | 궁합 등급 숫자 | 리포트 핵심 숫자(20px/900)에 근접하지만 900이 아니라 800 |
| `.arc-page-head h2` | 20px | 500 | `--text-heading` | 아카이브 페이지 헤더 | L1(페이지 타이틀) — weight만 700이 아니라 500 |
| `.nyang-dialog-title` | 17px | 700 | `--text-heading` | 냥 결제 다이얼로그 | L2(팝업 타이틀)에 근접 — 20px가 아니라 17px |
| `.mypage-account-title` | 15px | 700 | `--text-strong` | 마이페이지 계정 영역 | L3(섹션·카드 타이틀)에 근접 — 800이 아니라 700 |
| `.arc-acc-title` | 15px | 700 | `--jade` | 아카이브 계정 영역 | L3에 근접 — 800이 아니라 700 |
| `.headline-quote` | 15px | 800 | `--ink` | 궁합 헤드라인 인용구 | L3와 동일(15px/800) |
| `.char-detail-headline` | 15px | 800 | `#1c2942` | 관상 상세 헤드라인 | L3와 동일하지만 색상이 토큰이 아니라 하드코딩 `#1c2942` |
| `.z3-ai-title` | 14.5px | 800 | `--jade` | 관상 AI 코멘트 | L3(15px)와 L4(13px) 사이 |
| `.z3-card-head` | 14px | 800 | `--text-title` | 관상 3존 카드 헤드 | L4(13px)에 근접 |
| `.archetype-title` | 14px | 800 | `--text` | 궁합 아키타입 | L4에 근접 |
| `.dogam-cta-title` | 14px | 800 | `--text-title` | 인연도감 CTA 카드 | L4에 근접 |
| `.mypage-section-title` | 14px | 700 | `--text-strong` | 마이페이지 섹션 | L4에 근접 — 800이 아니라 700 |
| `.dogam-detail-subhead` | 14px | 700 | `--text-title` | 인연도감 상세 | L4에 근접 — 800이 아니라 700 |
| `.saju-q-title` | 16px | 700 | `--text-title` | 사주 질문 타이틀 | L3(16px)와 동일 크기지만 800이 아니라 700 |
| `.char-detail-sec-title` | 13.5px | 800 | `#1c2942` | 관상 상세 섹션 | L4(13px)와 거의 동일, 색상만 하드코딩 |
| `.gg-item-head` | 13.5px | 800 | `--jade` | 궁합 항목 헤드 | L4와 거의 동일 |
| `.shop-menu-title` | 13px | 800 | `--jade` | 샵 메뉴 타이틀 | L4와 동일(13px/800), `letter-spacing: 3px` 추가 |
| `.char-detail-row-head` | 12.5px | 800 | `#26375a` | 관상 상세 행 헤드 | L4보다 한 단계 작음, 색상 하드코딩 |
| `.z3-shape-head` | 12.5px | 400(미지정) | `--text-sub` | 관상 3존 모양 설명 | 타이틀이라기보다 라벨에 가까움 |
| `.shape-detail-head` | 12.5px | 400(미지정) | `--text` | 궁합 모양 상세 | 위와 동일하게 라벨에 가까움 |
| `.gg-ohaeng-cols-head` | 11px | 700 | `--text-sub` | 궁합 오행 컬럼 헤드 | 캡션(10px)보다 한 단계 큼 |
| `.zone-head-area` | 11.5px | 400(미지정) | `--text-sub` | 관상 존 헤드 상단 라벨 | 캡션에 근접 |
| `.oh-headline-box` | 11.5px | 800 | 상황별 | 오행 헤드라인 박스 | 타이틀보다 배지/라벨 성격 — 9번(배지) 참고 |

- 색상이 `#1c2942`, `#26375a`처럼 토큰이 아니라 **하드코딩된 HEX**로 박혀있는 타이틀이 5곳 있다(`char-detail-headline`, `char-detail-sec-title`, `char-detail-row-head` 등) — 1.9 컬러 규칙 위반 사례다. 지금 당장 고치지 않지만, 해당 화면을 손댈 일이 생기면 `--text-title`(거의 동일한 검정 계열)로 바꿀지 확인받는다.
- weight가 700인 타이틀(`mypage-*`, `dogam-detail-subhead`, `saju-q-title`, `nyang-dialog-title`, `arc-acc-title`, `arc-page-head h2`)은 전부 **마이페이지·아카이브·사주질문·결제 다이얼로그** 쪽에 몰려 있다 — 인연도감·궁합·관상 리포트 계열은 거의 800이다. 이 두 그룹을 하나로 합칠지는 12번(다음 단계 제안)에 남겨뒀다.

---

## 3. Spacing

> ⚠️ 지금까지 정의된 토큰이 없다 — 아래는 **이번에 새로 도입하는 스케일**이다(1번 문제 해결). `--space-*` 로 `index.html` `:root`에 실제로 추가해뒀다(11번 참고).

| CSS 토큰 | 값 |
|----------|-----|
| `--space-1` | 4px |
| `--space-2` | 8px |
| `--space-3` | 12px |
| `--space-4` | 16px |
| `--space-5` | 20px |
| `--space-6` | 24px |
| `--space-7` | 28px |
| `--space-8` | 32px |
| `--space-9` | 40px |

### 규칙
- **새로 쓰는 padding/margin/gap은 반드시 이 토큰만 사용한다.** 5, 7, 9, 13, 15, 18, 22px 같은 임의 값을 새로 만들지 않는다.
- 화면 좌우 기본 여백: `--space-4`(16px) — `.wrap { padding: 0 16px 24px }` 실측 기준. 차방정(20px)과 다르니 섞지 않는다.
- 카드/섹션 내부 padding: 리스트·업로드 영역은 `--space-4`(16px), 팝업 바디는 `--space-5`(20px).
- 기존 코드에 남아있는 임의 px 값(5·7·9·13·15·18·22px 등)은 지금 당장 일괄 치환하지 않았다 — 손대는 화면을 수정할 때 그 부분만 점진적으로 토큰으로 교체한다. (전체 일괄 치환은 리스크가 커서 별도 작업으로 확인 후 진행 — 아래 "다음 단계 제안" 참고)

---

## 4. Layout

- **프레임 폭 고정**: `--frame-w: 390px` — 데스크톱 브라우저에서도 항상 이 폭으로 렌더링(모바일 전용 서비스, 반응형 아님). 새 화면도 이 폭 기준으로 그린다.
- `body`는 프레임 자체, `.wrap`은 좌우 16px 패딩이 있는 콘텐츠 영역.
- **Full-bleed 섹션**(업로드 영역처럼 프레임 가장자리까지 꽉 채우는 섹션): `.upload-section { margin: 0 -16px; }` 패턴으로 `.wrap`의 16px을 상쇄한다. 새 full-bleed 섹션도 이 패턴을 그대로 따른다(임의로 `.wrap` 밖에 새 컨테이너를 만들지 않는다).
- 하단 고정 영역 높이: `--nav-h: 69px`(하단 탭바), `--cta-h: 96px`(하단 CTA 독). `body`의 `padding-bottom`이 이 두 값 + 12px로 계산되어 있으니, 새 하단 고정 요소를 추가하면 이 계산식도 같이 확인한다.

---

## 5. Elevation — z-index 계층

실측한 현재 값을 그대로 "정본 스케일"로 승격한다(값은 안 바꿈 — 이미 쓰고 있는 값들이 서로 관계가 맞게 짜여 있어서, 숫자를 새로 매기면 기존 화면과 어긋난다). **새 오버레이를 만들 때 아래 표에서 역할이 가장 가까운 계층의 값을 그대로 쓴다. 표에 없는 새로운 역할이면 상위 계층 값 + 1~9 사이로 끼워 넣고 이 표에 줄을 추가한다.**

| 계층 | z-index | 실제 클래스 | 설명 |
|------|---------|------------|------|
| 1. 콘텐츠 기본층 | `1` | `.wrap`, `.cmb-hero-text` | 페이지 기본 콘텐츠 |
| 2. 하단 CTA 독 | `30` | (bottom cta dock) | 탭바보다 아래층, 콘텐츠보다 위 |
| 3. 하단 탭바 | `40` | `.bottom-nav` | 화면 전체에서 항상 보이는 네비 |
| 4. 팝업 배경(Dim) | `100` | `.overlay-backdrop` | 바텀시트/폼팝업의 딤 배경 |
| 5. 바텀시트/폼팝업 | `101` | `.bottomsheet`, `.form-popup` | 마이페이지·프로필 등록 등 |
| 6. 중첩 팝업 배경 | `102` | `.confirm-backdrop` | 바텀시트 **위에 겹쳐 뜨는** 확인 다이얼로그의 딤 |
| 7. 중첩 시스템 팝업 | `103` | `.confirm-dialog` | 로그아웃 확인 등 중앙 확인창 (재사용됨, 3곳) |
| 8. 저장 완료 토스트 | `120` | `.dogam-toast` | 도감 링크 복사 등 |
| 9. 앱 토스트 | `200` | `.app-toast` | 냥 차감 등 구매 완료 알림 |
| 10. 인증 전환 오버레이 | `300` | `.auth-loading-overlay` | 카카오 로그인 전환 중 전체 화면 로딩 — 최상단 |

### 중첩 규칙
- 페이지 → 바텀시트/폼팝업(100~101)은 기본 흐름.
- 바텀시트/폼팝업 위에 **한 번 더** 확인창을 띄워야 하면(예: "정말 나가시겠어요?") 102~103을 쓴다 — 101보다 반드시 위.
- 토스트(120, 200)는 팝업이 열려 있어도 그 위에 뜨는 게 자연스러운 경우에만 팝업보다 높은 값을 쓴다. 팝업 안에서만 완결되는 알림이면 팝업 내부 요소로 처리하고 별도 z-index를 새로 만들지 않는다.
- 인증 전환처럼 **다른 모든 상호작용을 막아야 하는** 화면 전체 로딩만 300(최상단)을 쓴다. 새로 "무조건 제일 위" 오버레이가 필요할 때만 300을 쓰고, 애매하면 여기에 묻고 정한다 — 임의로 999 같은 값을 넣지 않는다.
- ⚠️ **주의**: 8번(`.dogam-toast`, z:120)과 9번(`.app-toast`, z:200)은 사실상 같은 역할(하단 토스트)인데 z-index·padding·transition이 서로 다르게 두 벌 존재한다. 지금 당장 통합하진 않았지만, 다음에 세 번째 토스트가 필요해지면 새로 만들지 말고 **먼저 이 둘을 하나의 공통 토스트 컴포넌트로 합칠지 확인**한다.

---

## 6. 팝업 / 바텀시트 규칙

관상냥반에는 두 종류의 오버레이만 있다(차방정처럼 풀페이지·스낵바까지 세분화되어 있지 않음 — 단일 페이지 앱이라 "풀페이지 전환"이 없다).

### 6.1 바텀시트 / 폼팝업 (`.overlay-backdrop` + `.bottomsheet` / `.form-popup`)
- 언제: 목록에서 항목 선택(프로필 선택), 정보 입력(프로필 등록/수정) 등 **플로우 연속성이 있는 작업**.
- 구조: `overlay-backdrop`(딤) → `bottomsheet`/`form-popup`(본체: header + 스크롤 body + 필요시 footer).
- `.form-popup`은 위쪽 `top: 8vh`로 더 큰 폼(등록/수정)에, `.bottomsheet`는 리스트 선택처럼 더 낮은 높이에 쓴다. 새 팝업을 만들 때 콘텐츠 양을 보고 둘 중 하나를 고른다 — 새 클래스를 또 만들지 않는다.
- 헤더: `.popup-header` (20px/500, 하단 `--border-lavender` 구분선). 푸터가 필요하면 `.popup-footer`(outline 100px 고정 + solid flex:1 — 차방정 Popup.md의 "보조 좌 / 주 우" 원칙과 동일하게 이미 짜여 있다).
- 닫기: `.overlay-close` 버튼 + 딤 탭. 입력값이 있는 상태에서 이탈하면 확인창(6.2)을 띄운다.

### 6.2 중앙 확인 팝업 (`.confirm-backdrop` + `.confirm-dialog`)
- 언제: 예/아니오로 끝나는 단순 확인(로그아웃, 삭제 확인 등). **목록이나 입력 폼이 필요 없는 경우에만.**
- 구조: 중앙 고정, `border-radius:16px`, 메시지(`.confirm-msg`) + 버튼 2개(`.confirm-actions` — outline/solid 각 flex:1, 동등 배치).
- 바텀시트/폼팝업 위에 겹쳐 뜰 수 있어 z-index가 102/103으로 그 위층에 있다(5번 참고). 페이지 위에 단독으로 뜰 때도 같은 클래스를 그대로 쓴다.
- 버튼이 3개 이상 필요하거나 리스트를 보여줘야 하면 이 컴포넌트를 억지로 쓰지 말고 바텀시트(6.1)로 바꾼다.

### 6.3 새 오버레이가 필요할 때 판단 순서
```
1. 예/아니오 확인만 필요한가? → 있음: confirm-dialog(6.2) 재사용
2. 목록 선택 / 폼 입력이 필요한가? → 있음: bottomsheet 또는 form-popup(6.1) 재사용
3. 위 둘 다 아니고 새로운 형태가 필요한가?
   → 기존 두 컴포넌트를 못 쓰는 이유를 먼저 확인받는다. 임의로 세 번째 오버레이 클래스를 새로 만들지 않는다.
```

### 6.4 바텀시트/폼팝업 내부 구조 — 3단 분해

바텀시트·폼팝업 본문을 새로 짤 때는 아래 3단 구조를 그대로 채운다(피그마 `Header/Popup` 컴포넌트 구조와 대조해 확인한 패턴 — 실제로 이미 이렇게 짜여 있다).

```
overlay-backdrop (z:100, 딤)
└─ bottomsheet / form-popup (z:101)
    ├─ popup-header / bottomsheet-header   — 20px/500, 좌우 패딩 20px, 하단 1px --border-lavender
    ├─ popup-body                          — 패딩 20px, flex-column, gap 20px, 스크롤 영역
    │   ├─ (선택) L4 타이틀 + 서브텍스트     — 4번 타이틀 계층 참고, gap 8px
    │   ├─ (선택) info-box / tip-box        — 10번 안내 박스 참고
    │   └─ 폼 필드들(field-group)           — 8번 인풋 참고, gap 8px
    └─ popup-footer                        — 상단 1px --border-lavender, 좌우 패딩 20px, 상하 16px, 버튼 gap 8px
        ├─ btn-outline-primary  flex: 0 0 100px   ← 보조(취소 등), 항상 좌측 고정폭
        └─ btn-solid-primary    flex: 1           ← 주 액션, 남는 공간 전부
```

- 푸터 버튼이 **1개**뿐이면 `btn-solid-primary`만 두고 `width: 100%`(기존 `.submit-btn` 기본값)로 채운다 — 억지로 outline 버튼을 만들어 짝을 맞추지 않는다.
- 확인 다이얼로그(`.confirm-dialog`)는 footer 개념 없이 본문(`confirm-msg`) 바로 아래 `confirm-actions`(outline/solid 각 `flex: 1`, **동등 배치** — popup-footer의 100px 고정과 다름)를 쓴다. 두 버튼의 무게가 같을 때만 confirm-actions 패턴, 하나가 주 액션이고 하나가 보조면 popup-footer 패턴(100px 고정) — 이 차이를 섞지 않는다.

---

## 7. 버튼 컴포넌트 (Button)

> 실측 근거: `index.html`의 `.submit-btn`/`.btn-solid-primary`/`.btn-outline-primary`/`.btn-md`/`.btn-sm` +
> `--btn-h-lg/md/sm` 변수. 사이즈 3단 체계와 outline 스트로크 구조는 피그마 `Button/Solid/Primary`,
> `Button/Outline/Primary` 컴포넌트셋과 대조해 확인 — **radius 8px는 코드(`--r-btn`)와 피그마가 정확히 일치**한다.

### 7.1 종류 — 2가지만 쓴다

| 종류 | 클래스 | 배경 | 텍스트 | 언제 |
|------|--------|------|--------|------|
| Solid Primary | `.btn-solid-primary` (`.submit-btn`과 동일) | `var(--mint)` | `#ffffff` | 화면의 **핵심 액션** 1개(제출, 저장, CTA) |
| Outline Primary | `.btn-outline-primary` | `var(--surface)` | `var(--text-sub)`, 테두리 `var(--border-lavender)` | 보조 액션(취소, 나중에, 뒤로) |

- 둘 다 `border-radius: var(--r-btn)`(8px), `font-family: inherit`, `cursor: pointer`.
- 새로운 3번째 버튼 스타일(예: 텍스트만 있는 링크 버튼)이 필요하면, 기존 두 종류로 안 되는 이유를 먼저 확인받는다 — 6.3의 "새 오버레이 판단 순서"와 같은 원칙.

### 7.2 사이즈 3단

| 사이즈 | 클래스 | height | padding | font-size | 쓰는 곳 |
|--------|--------|--------|---------|-----------|---------|
| Large(기본값) | 클래스 없이 `.btn-solid-primary` 기본 | `--btn-h-lg`(54px 상당, 실제로는 `padding: 16px`로 구현) | `16px`(상하좌우 동일) | 18px | 하단 CTA 독, 폼팝업 주 제출 버튼 |
| Medium | `.btn-md` | `--btn-h-md`(44px) | `0 18px` | 15px | 팝업 푸터, 리스트 내 인라인 액션 |
| Small | `.btn-sm` | `--btn-h-sm`(32px) | `0 14px` | 12px | 카드 안 보조 버튼, 태그형 액션 |

- 피그마 레퍼런스는 Large/Medium/Small/xsmall 4단(56·48·40·32px)이지만, **코드에는 xsmall이 없다** — 지금 당장 4단으로 늘리지 않는다. xsmall이 필요한 화면이 생기면 그때 `--btn-h-xs` 추가 여부를 확인받는다.
- `.btn-md`/`.btn-sm`은 `margin-top: 0`이 같이 지정되어 있다 — `.submit-btn` 기본값(`margin-top: 8px`, 이전 요소와의 간격용)을 상쇄하는 용도이므로, 두 클래스를 쓸 때 별도로 margin을 또 건드리지 않는다.

### 7.3 상태

| 상태 | Solid | Outline |
|------|-------|---------|
| Default | `background: var(--mint)` | `border: 1.5px solid var(--border-lavender)` |
| Hover | `opacity: 0.9`(전체 트랜지션 `.15s`) | 별도 정의 없음 — 필요하면 Solid와 동일하게 `opacity` 방식 사용 |
| Disabled | `background: var(--border-gray)`, `color: var(--text-sub)`, `cursor: not-allowed` | 별도 정의 없음 |
| Pressed | 별도 정의 없음(피그마엔 있음 — `#a3000d` 톤다운) | 별도 정의 없음 |

- ⚠️ **Outline 버튼에는 disabled/pressed 상태가 코드에 없다.** 보조 버튼을 비활성화해야 하는 화면이 생기면, 새로 만들기 전에 Solid의 disabled 패턴(배경 `--border-gray` + 텍스트 `--text-sub`)을 그대로 따를지 확인받는다.
- Pressed(눌림) 피드백이 필요하면 `:active { opacity: .7 }` 정도를 새로 추가할 수 있지만, 이 역시 기존에 없는 상태이므로 먼저 확인 후 추가한다.

### 7.4 popup-footer / confirm-actions 안에서의 폭 규칙

버튼 자체 사이즈(7.2)와 별개로, **오버레이 안에서는 부모가 폭을 강제로 재정의**한다 — 6.4의 3단 구조 표 참고.

```css
.popup-footer .btn-outline-primary { flex: 0 0 100px; }  /* 보조: 항상 100px 고정 */
.popup-footer .btn-solid-primary   { flex: 1; margin-top: 0; } /* 주 액션: 나머지 전부 */
.confirm-actions .btn-outline-primary,
.confirm-actions .btn-solid-primary { flex: 1; } /* 확인 다이얼로그: 둘 다 동등 */
```

새 팝업 푸터를 만들 때 버튼에 직접 `width`를 지정하지 않는다 — 항상 부모 flex 컨테이너(`popup-footer` 또는 `confirm-actions`)로 폭을 제어한다.

---

## 8. 인풋 컴포넌트 (Input / Field)

> 실측 근거: `.field-input`, `.field-label`, `.field-group`, `.req-dot`(`index.html` 738~746행).
> 구조(라벨 → 인풋 → 보조텍스트, 포커스 시 테두리 색만 바뀌는 방식)는 피그마 `Input/TextField`
> 컴포넌트셋과 대조 — **radius 8px(`--r-input`)는 코드·피그마 일치**, 포커스 시 "테두리 색만 전환"하는
> 상호작용 방식도 동일하다(피그마는 포커스 시 `#151515`, 코드는 `var(--mint)`로 색만 다름).

### 8.1 기본 구조 — `field-group`

```
.field-group (flex-column, gap: 8px)
├─ .field-label            — 14px/500, var(--text-strong). 필수 항목이면 뒤에 .req-dot(4px 원, var(--mint)) 붙임
└─ .field-input             — 실제 입력 필드
```

### 8.2 `.field-input` 스펙

| 속성 | 값 |
|------|-----|
| 배경 | `var(--surface)` |
| 테두리(기본) | `1px solid var(--border-gray)` |
| 테두리(포커스) | `1px solid var(--mint)` |
| radius | `var(--r-input)`(8px) |
| padding | `13px 14px` |
| font-size | 16px |
| 텍스트 색 | `var(--text-strong)` |

- 새 입력 필드(이름, 닉네임, 커스텀 텍스트 등)는 모두 `.field-input` 하나로 통일해서 쓴다 — 화면마다 새 인풋 스타일을 만들지 않는다. 실제로 `pfName`(프로필 이름), `dogamGuestName`(게스트 이름), `gwansangOwnerName`(도감 표시 이름), `nhSearchInput`/`adminSearchInput`(검색창) 전부 이 클래스 하나를 공유한다.
- 검색창처럼 아이콘이 붙는 경우도 `.field-input`에 `padding-left`만 조정해서 쓰고, 새 클래스를 만들지 않는다.

### 8.3 상태 — 지금 코드에 있는 것 / 없는 것

| 상태 | 코드에 있음? | 처리 |
|------|-------------|------|
| Default | ✅ | `border-gray` |
| Focus | ✅ | `:focus { border-color: var(--mint); }` |
| Disabled | ❌ 없음 | 새로 만들기 전에 필요한 화면에서 어떤 처리(회색 배경? opacity?)를 원하는지 먼저 확인 |
| Error(유효성 실패) | ❌ 없음 | 피그마엔 `#eb3341`(레드) 테두리로 정의돼 있지만, kwansang-nb에는 아직 red/error 계열 토큰이 없다. **에러 상태가 필요한 화면이 생기면 색상 토큰(`--error` 등)을 새로 추가할지 먼저 확인받는다** — 컬러 규칙(1.9) 위반하지 않기 위함. |

- ⚠️ 위 Disabled·Error 두 상태는 이번 작업에서 임의로 추가하지 않았다. 12번(다음 단계 제안)에 체크 항목으로 남겨둔다.

### 8.4 여러 줄 입력 — textarea

`saju-textarea`처럼 여러 줄 입력이 필요하면 `.field-input`과 별개 클래스를 만들되, `border`/`radius`/`padding`/포커스 색 규칙은 8.2와 동일하게 맞춘다(`min-height`와 `resize`만 추가). 실측: `.saju-textarea { min-height: 88px; resize: vertical; line-height: 1.5; }` — 이 값 자체를 재사용한다.

---

## 9. 배지 · 라벨 (Badge / Label)

> 실측 근거: `.status-badge`(+`.strength`/`.complement`), `.est-tag`, `.profile-badge`,
> `.ai-badge`, `.gg-ohaeng-badge`(index.html). 알약형(pill) 구조와 "Filled(배경 있음) vs
> Outline(테두리만)" 2갈래 분기는 피그마 `Label/Status` 컴포넌트셋(SM/MD 2사이즈 × Filled On/Off)과
> 대조해 확인한 패턴 — **색상은 피그마 값(초록/파랑/레드 등)을 가져오지 않고 기존 kwansang-nb
> 토큰으로만 매핑했다.**

### 9.1 공통 구조

모든 배지는 아래 골격을 공유한다 — 새 배지를 만들 때 이 4가지만 정하면 된다.

```css
/* 공통 골격 */
border-radius: 999px;      /* 알약형 고정 */
font-weight: 800;          /* 700이 아니라 800 */
font-size: 10~11px;        /* 상황에 따라 최대 12px */
padding: 3px 8~9px;        /* 세로 3px 고정, 가로 8~9px */
```

### 9.2 색상 Variant — 지금 코드에 있는 것

| Variant | 배경 | 텍스트 | 의미 | 실제 클래스 |
|---------|------|--------|------|------------|
| Primary(Filled) | `var(--mint)` | `var(--ink)` | 강조/AI 태그 | `.ai-badge` |
| Strength(Tint) | `rgba(85,204,187,.18)` | `var(--jade)` | 긍정/강점 | `.status-badge.strength` |
| Complement(Tint) | `var(--beige-chip-bg)` | `var(--beige-chip-text)` | 보완/참고 | `.status-badge.complement` |
| Est(Warning, Outline+Tint) | `var(--est-bg)` | `var(--est)`, 테두리 `var(--est-border)` | 추정값 경고 | `.est-tag` |
| Neutral(Outline) | `var(--surface)` | `var(--text-sub)`, 테두리 `var(--border-gray)` | 개수/상태 표시(비강조) | `.profile-badge`, `.profile-row-badge` |

- 피그마 레퍼런스엔 Good(초록)/Progress(파랑)/Alert(레드)/Done(검정) 4가지가 더 있지만, **kwansang-nb 코드엔 아직 없다.** 오행(목·화·토·금·수)처럼 이미 자체 컬러 시스템이 있는 곳(`.oh-*`)과 겹치지 않게, 새 의미의 배지 색이 필요하면 위 5개로 표현이 안 되는지 먼저 확인하고, 안 되면 어떤 색을 새로 추가할지 확인받는다 — 임의로 초록/파랑/레드를 새로 섞지 않는다.
- 사이즈는 지금 1단(10~11px)만 쓴다. 피그마처럼 SM/MD 2단이 필요해지면(예: 리스트 요약 vs 상세 화면) 그때 두 번째 사이즈를 정의할지 확인받는다.

---

## 10. 안내 박스 · 배너 (InfoBox)

> 실측 근거: `.tip-box`, `.reassure-box`(index.html). 아이콘+텍스트 한 줄 구조는 피그마
> 화면(인연도감 바텀시트)의 `Message/InfoBox` 프레임과 대조 — **배경색(`--bg-info-yellow`)과
> 텍스트 색(`--text-sub2`)이 코드·피그마 완전히 일치**해서 그대로 표로 확정했다.

### 10.1 종류 2가지

| 종류 | 클래스 | 배경 | radius | padding | 아이콘 색 | 텍스트 |
|------|--------|------|--------|---------|-----------|--------|
| Tip(주의 환기) | `.tip-box` | `var(--bg-info-yellow)` | 8px | `12px` | `var(--icon-orange)`, 16px | 12px/500, `var(--text-sub2)` |
| Reassure(안심 안내) | `.reassure-box` | `var(--bg-soft)` | 8px | `16px` | 아이콘 없음(텍스트만) | 내부 텍스트 스타일 자유(강조 문구 포함 가능) |

- 구조: `display: flex; align-items: flex-start; gap: 8px;` — 아이콘이 있으면 아이콘을 텍스트보다 먼저 두고, 텍스트가 길어져 줄바꿈돼도 아이콘 위치가 위쪽에 고정되도록 `align-items: flex-start`를 유지한다(`center`로 바꾸지 않는다 — 긴 문구에서 아이콘이 어색하게 중앙 정렬되는 걸 막기 위함).
- **언제 Tip, 언제 Reassure인가**
  - Tip: "이렇게 하면 더 잘 나와요" 같은 사용 팁, 주의사항 — 노란 배경으로 시선을 끈다.
  - Reassure: "언제든 다시 보관할 수 있어요" 같은 안심시키는 안내 — 중립 배경(`--bg-soft`)으로 톤을 낮춘다.
  - 둘 다 아니고 "경고"(예: 삭제하면 복구 불가)가 필요하면 지금 코드엔 대응 클래스가 없다 — 새로 만들기 전에 확인받는다(12번 참고).
- 바텀시트 안에서 쓸 때는 6.4의 3단 구조에 맞춰 `popup-body` 안, 타이틀/서브텍스트 바로 아래에 배치한다(실측: 인연도감 보관 안내 바텀시트).

---

## 11. 이번에 추가한 CSS 변수 (index.html `:root`)

기존 변수는 하나도 바꾸지 않았다. 3번(Spacing)과 5번(z-index) 토큰, 그리고 1.9~1.10(관상 캐릭터 카드 톤)
색상 토큰을 새 변수로 추가했다 — 값 변경이 없는 순수 추가라 기존 화면 렌더링에 영향 없음. **앞으로 새 코드에서는 하드코딩 대신 이 변수를 쓴다.**

```css
/* Spacing scale */
--space-1: 4px;
--space-2: 8px;
--space-3: 12px;
--space-4: 16px;
--space-5: 20px;
--space-6: 24px;
--space-7: 28px;
--space-8: 32px;
--space-9: 40px;

/* Elevation scale — 기존 하드코딩 값과 동일, 이름만 붙임 */
--z-content: 1;
--z-cta-dock: 30;
--z-bottom-nav: 40;
--z-popup-backdrop: 100;
--z-popup: 101;
--z-popup-nested-backdrop: 102;
--z-popup-nested: 103;
--z-toast-dogam: 120;
--z-toast-app: 200;
--z-auth-loading: 300;

/* 관상 캐릭터 카드 톤 — 기존 하드코딩 값(char-card 등)과 동일, 이름만 붙임 (1.9~1.10) */
--char-navy: #26375a;
--char-navy-deep: #1c2942;
--char-tag-spark: #a15c12;
--char-tag-clash: #a63d3d;
```

> 기존 z-index CSS 규칙(`.bottom-nav { z-index: 40 }` 등)은 그대로 숫자를 쓰고 있다 — 지금 당장 `var(--z-bottom-nav)`로 바꾸지 않았다(동작 변경 없는 순수 리네이밍이라 안전하지만, 1400줄 스타일시트 전체를 훑어야 해서 범위가 크다). `--char-navy`/`--char-navy-deep`/`--char-tag-spark`/`--char-tag-clash` 4개는 범위가 작아(24곳) 이번에 바로 `var()`로 전체 치환했다 — 12번 참고.

---

## 12. 다음 단계 제안 (지금은 안 함 — 확인 후 진행)

- [ ] 기존 z-index 숫자(40, 100, 101 등)를 위 `var(--z-*)` 토큰으로 전체 치환
- [ ] 임의 px 값(5·7·9·13·15·18·22px 등)을 `--space-*` 토큰으로 점진 치환
- [ ] `.dogam-toast` / `.app-toast` 두 토스트 컴포넌트 통합
- [ ] `--text-*`(폼용) / `--text, --text2, --text3`(리포트용) 이름 체계 통일 여부 검토
- [ ] `.field-input`에 Disabled / Error(유효성 실패) 상태 CSS 추가 — Error는 새 색상 토큰(`--error` 등) 필요, 추가 전 확인
- [ ] `.btn-outline-primary`에 Disabled / Pressed(`:active`) 상태 추가
- [ ] 배지·라벨에 Alert(경고/실패)·Progress(진행중) variant 추가 — 새 색상(레드/블루 계열) 필요, 추가 전 확인
- [ ] "경고"(복구 불가 등) 톤의 InfoBox variant 추가 — 지금은 Tip(주의 환기)/Reassure(안심) 2종뿐, 더 강한 경고색 필요 여부 확인
- [ ] 타이틀 레거시 소수점 값(13.5px·14px·14.5px·11.5px·12.5px 등)을 2번 표의 정수 값으로 점진 치환
- [x] `#26375a`/`#1c2942`/`#a15c12`/`#a63d3d` 하드코딩 24곳을 `var(--char-navy)`/`var(--char-navy-deep)`/`var(--char-tag-spark)`/`var(--char-tag-clash)`로 전체 치환 완료(2026-09-11)
- [ ] `--char-tag-spark`(#a15c12)와 `--est`(#E68A2E) — 둘 다 "주황 계열 경고/강조" 역할인데 별도 토큰으로 존재. 하나로 합칠지, 역할이 명확히 다르니 유지할지 검토
- [ ] 1.11에 정리한 피그마 전용 색상(CompatChip tint 3종, 아바타 배경, TaglinePill 등) — 실제 화면 구현 시점에 기존 토큰으로 대체 가능한지 먼저 확인, 안 되면 정식 토큰화

이 항목들은 전부 기존 화면 다수에 영향을 주거나 새 색상 토큰 추가가 걸린 범위라, 하나씩 먼저 확인받고 진행한다.
