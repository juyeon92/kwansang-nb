// ═══ 64(실제로는 69) 관상 Feature → 6D 기질 벡터 매핑 ═══
// 기획서 §5 방식 그대로: 각 Feature ID가 lead/strategy/drive/social/stability/sense 6개 값(0~1,
// 합이 1일 필요 없음)을 갖는다. 값은 새로 지어낸 것이 아니라 archetype-db.js에 이미 있는 keywords·
// strength 문구를 "키워드→기질" 방식으로 그대로 옮긴 것 — EYE_TIGER/EYE_PHOENIX/EYE_PEACH 3개는
// 기획서 §5에 명시된 값을 그대로 썼고, 나머지는 같은 스케일 감각으로 이어서 도출했다.
//
// ⚠️ 실제 DB 개수는 기획서가 가정한 "7부위×6종=42, 총 64개"와 다르다 — EYE_SHAPE_DB가 8종,
// NOSE_SHAPE_DB가 9종이라 부위별 세부 Feature는 42가 아니라 47개, 전체는 64가 아니라 69개다.
// (13 눈모양 + 9 동물상 + 6 이마 + 6 눈썹 + 8 눈크기 + 9 코 + 6 입 + 6 턱 + 6 얼굴형 = 69)
// 카운트가 달라도 매핑 방식·엔진 로직에는 영향 없음 — 그저 기획서의 "64개" 표현을 실제 DB 그대로
// 반영하면 69개가 된다는 사실만 기록해둔다(코드가 아니라 기획서 쪽의 가정 오차).
const FACE_TRAIT_MAP = {
  eye_archetype: {
    // 용안: 리더십·존재감·명예·균형
    EYE_DRAGON:       { lead: 1.0, strategy: 0.3, drive: 0.4, social: 0.2, stability: 0.5, sense: 0.1 },
    // 봉안: 총명함·품격·지혜·명예 — 기획서 §5 원문 값
    EYE_PHOENIX:      { lead: 0.2, strategy: 1.0, drive: 0.1, social: 0.2, stability: 0.6, sense: 0.6 },
    // 우안: 신뢰·성실·재복·온화함
    EYE_OX:           { lead: 0.1, strategy: 0.2, drive: 0.3, social: 0.5, stability: 1.0, sense: 0.1 },
    // 학안: 지성·청수함·기품·고고함
    EYE_CRANE:        { lead: 0.2, strategy: 1.0, drive: 0.1, social: 0.1, stability: 0.4, sense: 0.5 },
    // 사자안: 위엄·리더십·절제·안정감
    EYE_LION:         { lead: 1.0, strategy: 0.2, drive: 0.3, social: 0.2, stability: 0.7, sense: 0.1 },
    // 명봉안: 지혜·결단력·두각·명예
    EYE_SING_PHOENIX: { lead: 0.4, strategy: 1.0, drive: 0.3, social: 0.5, stability: 0.3, sense: 0.3 },
    // 구안: 안정·차분함·장수·복
    EYE_TURTLE:       { lead: 0.1, strategy: 0.3, drive: 0.1, social: 0.2, stability: 1.0, sense: 0.1 },
    // 안안: 의지·의연함·품격·신뢰
    EYE_GOOSE:        { lead: 0.3, strategy: 0.2, drive: 0.3, social: 0.2, stability: 1.0, sense: 0.5 },
    // 호안: 위엄·추진력·집중력·기세 — 기획서 §5 원문 값
    EYE_TIGER:        { lead: 1.0, strategy: 0.2, drive: 0.9, social: 0.0, stability: 0.2, sense: 0.0 },
    // 음양안: 개성·복합적매력·비대칭·신비감
    EYE_YINYANG:      { lead: 0.1, strategy: 0.3, drive: 0.1, social: 0.3, stability: 0.1, sense: 1.0 },
    // 난안: 화사함·복·생기·조화
    EYE_LUAN:         { lead: 0.1, strategy: 0.1, drive: 0.2, social: 1.0, stability: 0.3, sense: 0.8 },
    // 사안: 예리함·관찰력·신중함·경계심
    EYE_SNAKE:        { lead: 0.2, strategy: 1.0, drive: 0.4, social: 0.0, stability: 0.3, sense: 0.2 },
    // 도화안: 매력·감수성·사교성·표현력 — 기획서 §5 원문 값
    EYE_PEACH:        { lead: 0.0, strategy: 0.1, drive: 0.1, social: 1.0, stability: 0.1, sense: 0.8 },
  },

  face_archetype: {
    // 용상: 리더십·중심·권위·절제
    FACE_DRAGON:   { lead: 1.0, strategy: 0.3, drive: 0.4, social: 0.2, stability: 0.6, sense: 0.1 },
    // 봉상: 품격·조화·총명함·우아함
    FACE_PHOENIX:  { lead: 0.2, strategy: 0.8, drive: 0.1, social: 0.5, stability: 0.7, sense: 0.8 },
    // 학상: 지성·고고함·청수함·명예
    FACE_CRANE:    { lead: 0.2, strategy: 1.0, drive: 0.1, social: 0.1, stability: 0.4, sense: 0.5 },
    // 사자상: 카리스마·위엄·리더십·풍채
    FACE_LION:     { lead: 1.0, strategy: 0.2, drive: 0.3, social: 0.4, stability: 0.4, sense: 0.1 },
    // 기린상: 온화함·덕·안정감·신뢰
    FACE_KIRIN:    { lead: 0.2, strategy: 0.2, drive: 0.1, social: 0.5, stability: 1.0, sense: 0.1 },
    // 호상: 추진력·활동성·위엄·결단력
    FACE_TIGER:    { lead: 0.7, strategy: 0.2, drive: 1.0, social: 0.1, stability: 0.2, sense: 0.1 },
    // 상상: 포용력·여유·안정감·재복
    FACE_ELEPHANT: { lead: 0.2, strategy: 0.2, drive: 0.1, social: 0.5, stability: 1.0, sense: 0.1 },
    // 우상: 성실·신뢰·우직함·안정
    FACE_OX:       { lead: 0.1, strategy: 0.1, drive: 0.3, social: 0.3, stability: 1.0, sense: 0.0 },
    // 마상: 민첩함·부지런함·활동성·속도
    FACE_HORSE:    { lead: 0.2, strategy: 0.2, drive: 1.0, social: 0.2, stability: 0.1, sense: 0.3 },
  },

  forehead: {
    FH_ANGULAR:     { lead: 0.2, strategy: 0.6, drive: 0.8, social: 0.0, stability: 0.2, sense: 0.1 }, // 추진력·논리적
    FH_M_SHAPE:     { lead: 0.1, strategy: 0.5, drive: 0.3, social: 0.0, stability: 0.1, sense: 0.8 }, // 독창적·집중력
    FH_NARROW:      { lead: 0.3, strategy: 0.0, drive: 0.7, social: 0.0, stability: 0.0, sense: 0.5 }, // 투쟁적·본능적 감각
    FH_THREE_SHAPE: { lead: 0.1, strategy: 0.5, drive: 0.1, social: 1.0, stability: 0.3, sense: 0.1 }, // 친화력·중재
    FH_ROUND:       { lead: 0.1, strategy: 0.0, drive: 0.2, social: 1.0, stability: 0.1, sense: 0.4 }, // 사교적·표현력
    FH_WIDE:        { lead: 0.5, strategy: 0.3, drive: 0.2, social: 0.3, stability: 0.7, sense: 0.0 }, // 의리·조직적
  },

  eyebrow: {
    EB_THICK:    { lead: 0.5, strategy: 0.1, drive: 1.0, social: 0.1, stability: 0.1, sense: 0.0 }, // 적극적·승부욕
    EB_RAISED:   { lead: 1.0, strategy: 0.3, drive: 0.3, social: 0.1, stability: 0.4, sense: 0.1 }, // 대범·능력자 기질
    EB_TRIANGLE: { lead: 0.8, strategy: 0.5, drive: 0.3, social: 0.0, stability: 0.2, sense: 0.0 }, // 결단력·독립적
    EB_DROOPY:   { lead: 0.0, strategy: 0.1, drive: 0.1, social: 1.0, stability: 0.3, sense: 0.2 }, // 협조적·유쾌
    EB_CRESCENT: { lead: 0.0, strategy: 0.1, drive: 0.1, social: 1.0, stability: 0.3, sense: 0.3 }, // 친절·인기
    EB_THIN:     { lead: 0.0, strategy: 0.3, drive: 0.0, social: 0.5, stability: 0.6, sense: 0.1 }, // 조심성·상냥
  },

  eye_shape: {
    ES_BIG:       { lead: 0.3, strategy: 0.1, drive: 0.7, social: 0.7, stability: 0.1, sense: 0.3 }, // 적극적·개방적
    ES_SMALL:     { lead: 0.2, strategy: 0.4, drive: 0.8, social: 0.0, stability: 0.4, sense: 0.2 }, // 의지력·근성
    ES_DROOPY:    { lead: 0.0, strategy: 0.1, drive: 0.0, social: 0.7, stability: 0.3, sense: 0.6 }, // 인자·감수성
    ES_MONOLID:   { lead: 0.1, strategy: 1.0, drive: 0.1, social: 0.0, stability: 0.3, sense: 0.2 }, // 관찰력·이론적
    ES_UPTURNED:  { lead: 0.8, strategy: 0.2, drive: 0.3, social: 0.0, stability: 0.6, sense: 0.1 }, // 자신감·강직
    ES_DOUBLE:    { lead: 0.2, strategy: 0.1, drive: 0.3, social: 0.6, stability: 0.0, sense: 0.7 }, // 화려·임기응변
    ES_WIDE_SET:  { lead: 0.1, strategy: 0.0, drive: 0.0, social: 0.5, stability: 0.6, sense: 0.1 }, // 도량·여유 (⚠️ DB 자체가 "벤치마크 추정" 경고)
    ES_CLOSE_SET: { lead: 0.2, strategy: 0.7, drive: 0.6, social: 0.0, stability: 0.1, sense: 0.1 }, // 집중력·몰두 (⚠️ 위와 동일)
  },

  nose: {
    NS_SMALL_SHORT: { lead: 0.0, strategy: 0.2, drive: 0.5, social: 0.2, stability: 0.0, sense: 0.7 }, // 재치·순발력
    NS_WIDE:        { lead: 0.3, strategy: 0.1, drive: 0.8, social: 0.3, stability: 0.2, sense: 0.0 }, // 대외 활동력·생활력
    NS_AQUILINE:    { lead: 0.3, strategy: 0.8, drive: 0.1, social: 0.6, stability: 0.3, sense: 0.1 }, // 신중·처세술
    NS_BENT:        { lead: 0.1, strategy: 0.3, drive: 0.1, social: 0.1, stability: 0.0, sense: 0.8 }, // 개성·직감력
    NS_BIG:         { lead: 0.2, strategy: 0.2, drive: 0.7, social: 0.1, stability: 0.3, sense: 0.0 }, // 활동적·현실적
    NS_UPTURNED:    { lead: 0.1, strategy: 0.1, drive: 0.2, social: 0.8, stability: 0.0, sense: 0.4 }, // 사교적·다재다능
    NS_ALAR_THICK:  { lead: 0.0, strategy: 0.2, drive: 0.1, social: 0.1, stability: 0.7, sense: 0.4 }, // 재물을 지키는 알뜰함
    NS_ALAR_THIN:   { lead: 0.2, strategy: 0.0, drive: 0.2, social: 0.6, stability: 0.0, sense: 0.3 }, // 통 큼·나눔에 아낌없음
    NS_BOKGO:       { lead: 0.2, strategy: 0.1, drive: 0.1, social: 0.5, stability: 0.6, sense: 0.1 }, // 재물복·원만함
  },

  mouth: {
    MS_THICK:      { lead: 0.0, strategy: 0.0, drive: 0.1, social: 0.5, stability: 0.7, sense: 0.1 }, // 정 많고 성실
    MS_BIG:        { lead: 0.5, strategy: 0.1, drive: 1.0, social: 0.2, stability: 0.1, sense: 0.0 }, // 행동력·결단력
    MS_SMALL:      { lead: 0.1, strategy: 0.7, drive: 0.1, social: 0.1, stability: 0.1, sense: 0.4 }, // 기획력·호기심
    MS_THIN:       { lead: 0.1, strategy: 0.2, drive: 0.4, social: 0.1, stability: 0.0, sense: 0.7 }, // 센스·민첩
    MS_DOWNTURNED: { lead: 0.2, strategy: 0.1, drive: 0.6, social: 0.0, stability: 0.6, sense: 0.0 }, // 투지력·신의
    MS_UPTURNED:   { lead: 0.1, strategy: 0.0, drive: 0.2, social: 0.8, stability: 0.1, sense: 0.3 }, // 명랑·긍정적
  },

  chin: {
    CS_UNDERBITE: { lead: 0.5, strategy: 0.1, drive: 0.8, social: 0.0, stability: 0.2, sense: 0.1 }, // 정력적·대담
    CS_OVAL:      { lead: 0.0, strategy: 0.6, drive: 0.1, social: 0.1, stability: 0.2, sense: 0.5 }, // 꼼꼼함·직감력
    CS_ROUND:     { lead: 0.1, strategy: 0.0, drive: 0.1, social: 0.7, stability: 0.5, sense: 0.2 }, // 포용력·낙천적
    CS_SQUARE:    { lead: 0.2, strategy: 0.2, drive: 0.4, social: 0.0, stability: 0.8, sense: 0.0 }, // 집념·청렴
    CS_LONG:      { lead: 0.0, strategy: 0.1, drive: 0.0, social: 0.4, stability: 0.7, sense: 0.4 }, // 원만·온후
    CS_POINTED:   { lead: 0.0, strategy: 0.1, drive: 0.0, social: 0.2, stability: 0.0, sense: 1.0 }, // 예술적·감각적
  },

  face_shape: {
    FS_RECTANGLE:    { lead: 0.1, strategy: 0.1, drive: 0.5, social: 0.4, stability: 0.5, sense: 0.1 }, // 온화·인자·희망적·추진력
    FS_SQUARE:       { lead: 0.2, strategy: 0.2, drive: 0.2, social: 0.1, stability: 1.0, sense: 0.0 }, // 규칙적·책임감·신뢰
    FS_TRIANGLE:     { lead: 0.1, strategy: 1.0, drive: 0.1, social: 0.0, stability: 0.3, sense: 0.1 }, // 냉철·이성적·분석적
    FS_INV_TRIANGLE: { lead: 0.2, strategy: 0.3, drive: 0.1, social: 0.1, stability: 0.0, sense: 1.0 }, // 창조적·예술적·아이디어
    FS_ROUND:        { lead: 0.1, strategy: 0.0, drive: 0.1, social: 1.0, stability: 0.3, sense: 0.2 }, // 외향적·사교적·따뜻함
    FS_OVAL:         { lead: 0.1, strategy: 0.6, drive: 0.2, social: 0.6, stability: 0.1, sense: 0.5 }, // 다재다능·순발력·중재
  },
};

// 기획서 §6 "랜드마크 기반 부위 강점" 10점 — judgePartStatus(app.js)가 11부위(forehead/eyebrow/midbrow/
// undereye/nosebridge/nosetip/philtrum/mouth/smilelines/jaw/cheekbone) 각각을 자기 안에서 상대적으로
// strength/complement로 나눈 결과를 보조 근거로 쓴다. complement(약점 쪽)는 캐릭터 점수에 반영하지 않고
// (기획서 §8, 약점은 shadowTrait 전용) strength로 판정된 부위만 여기 정의된 방향으로 소폭 가산한다.
const PART_STATUS_TRAIT_MAP = {
  forehead:   { lead: 0.3, strategy: 0.1, drive: 0.1, social: 0.0, stability: 0.3, sense: 0.0 }, // 일 운·명예운
  eyebrow:    { lead: 0.1, strategy: 0.0, drive: 0.1, social: 0.5, stability: 0.2, sense: 0.0 }, // 대인관계·형제운
  midbrow:    { lead: 0.5, strategy: 0.1, drive: 0.0, social: 0.3, stability: 0.1, sense: 0.0 }, // 주관·리더십·대인관계
  undereye:   { lead: 0.0, strategy: 0.0, drive: 0.0, social: 0.5, stability: 0.2, sense: 0.1 }, // 정·인복·자녀운
  nosebridge: { lead: 0.4, strategy: 0.1, drive: 0.1, social: 0.0, stability: 0.3, sense: 0.0 }, // 자존심·중년운
  nosetip:    { lead: 0.2, strategy: 0.1, drive: 0.1, social: 0.0, stability: 0.4, sense: 0.0 }, // 재물운·자존감
  philtrum:   { lead: 0.0, strategy: 0.0, drive: 0.4, social: 0.0, stability: 0.3, sense: 0.0 }, // 건강·수명·의지력
  mouth:      { lead: 0.0, strategy: 0.0, drive: 0.1, social: 0.4, stability: 0.0, sense: 0.2 }, // 표현력·재물 씀씀이
  smilelines: { lead: 0.3, strategy: 0.0, drive: 0.1, social: 0.3, stability: 0.1, sense: 0.0 }, // 사회성·카리스마
  jaw:        { lead: 0.0, strategy: 0.0, drive: 0.0, social: 0.2, stability: 0.5, sense: 0.0 }, // 말년운·조력자 운
  cheekbone:  { lead: 0.2, strategy: 0.0, drive: 0.5, social: 0.1, stability: 0.0, sense: 0.0 }, // 대외활동력·추진력
};
