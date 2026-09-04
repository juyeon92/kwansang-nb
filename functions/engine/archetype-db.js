// ═══ 관상 유형 DB (서버 전용, 2026-08-30 DB 이원화 2단계) ═══
// js/archetype-db.js를 서버로 이전한 것 — 원문·고전 관상학 참고자료·강점/약점 문구가 브라우저 소스에
// 그대로 노출되던 문제를 막는다. 클라이언트는 이제 이 내용을 담은 파일을 아예 갖고 있지 않고,
// getArchetypeCatalog 함수(functions/index.js)를 통해 로그인 세션으로만 받아온다.
const EYE_ARCHETYPE_DB = {
  EYE_DRAGON:   { nameKo:'용안', hanja:'龍眼', easyName:'용의 눈을 닮은 또렷한 눈', glance:'눈동자가 또렷하고 존재감이 크며, 눈 전체가 단정하고 힘 있게 느껴지는 눈매예요.', features:['눈동자가 비교적 크고 또렷해 보여요','검은자와 흰자의 구분이 선명한 편이에요','눈빛에 힘이 있으면서도 흐트러진 느낌이 적어요'], traditional:'용안은 귀하게 보는 눈의 형상 중 하나예요. 눈빛이 맑고 형상이 단정할수록 큰 그릇과 명예, 리더십을 가진 형상으로 해석해요.', keywords:['리더십','존재감','명예','균형'] },
  EYE_PHOENIX:  { nameKo:'봉안', hanja:'鳳眼', easyName:'봉황처럼 길고 맑은 눈', glance:'눈매가 옆으로 길게 뻗으면서 섬세하고 우아한 느낌을 주는 눈이에요.', features:['눈의 가로 길이가 긴 편이에요','눈 앞머리와 눈꼬리가 섬세하게 빠져요','눈빛이 맑고 정돈된 느낌을 줘요'], traditional:'봉안은 총명하고 기품 있는 눈으로 높게 평가해요. 눈이 길고 맑으며 전체적인 조화가 좋을수록 지혜와 명예를 가진 형상으로 풀이해요.', keywords:['총명함','품격','지혜','명예'] },
  EYE_OX:       { nameKo:'우안', hanja:'牛眼', easyName:'소처럼 크고 순한 눈', glance:'눈이 크고 둥글며 강렬하기보다 편안하고 순한 느낌을 주는 눈이에요.', features:['눈 자체가 큰 편이에요','눈동자가 둥글고 크게 보여요','눈빛이 부드럽고 안정적이에요'], traditional:'우안은 성실함과 넉넉한 재복을 상징하는 길한 눈으로 풀이하는 경우가 많아요. 우직하고 솔직하며 다른 사람에게 신뢰감을 주는 인상으로 보기도 해요.', keywords:['신뢰','성실','재복','온화함'] },
  EYE_CRANE:    { nameKo:'학안', hanja:'鶴眼', easyName:'학처럼 맑고 가느다란 눈', glance:'선이 가늘고 깨끗하며 차분하고 고고한 분위기를 주는 눈이에요.', features:['눈매가 비교적 가늘고 길어요','흑백의 구분이 깨끗해 보여요','눈빛이 산만하기보다 차분해요'], traditional:'학의 형상은 청수함과 고결함, 지적인 기품을 상징해요. 눈뿐 아니라 갸름한 얼굴과 긴 목, 정돈된 전체적인 인상이 함께 나타날 때 학의 형상에 가깝다고 보기도 해요.', keywords:['지성','청수함','기품','고고함'] },
  EYE_LION:     { nameKo:'사자안', hanja:'獅子眼', easyName:'사자처럼 당당하고 힘 있는 눈', glance:'눈매에 힘과 안정감이 있어 쉽게 위축되지 않을 것 같은 인상을 주는 눈이에요.', features:['눈의 존재감이 뚜렷해요','시선에 힘이 있어요','날카롭기보다는 당당하고 안정적인 힘이 느껴져요'], traditional:'사자안은 부귀와 위엄, 절제된 힘을 상징하는 눈으로 풀이해요.', keywords:['위엄','리더십','절제','안정감'] },
  EYE_SING_PHOENIX: { nameKo:'명봉안', hanja:'鳴鳳眼', easyName:'봉황처럼 길고 또렷한 눈', glance:'길게 뻗은 봉안의 특징에 조금 더 선명하고 힘 있는 느낌이 더해진 눈이에요.', features:['눈 앞머리와 눈꼬리가 비교적 섬세해요','눈매가 가로로 길게 뻗어요','눈빛이 맑으면서도 힘이 느껴져요'], traditional:'명봉안은 현명함과 결단력, 사회적인 두각과 연결해 풀이하는 경우가 있어요. 봉안의 우아함에 보다 또렷한 추진력이 더해진 형태로 이해하면 쉬워요.', keywords:['지혜','결단력','두각','명예'] },
  EYE_TURTLE:   { nameKo:'구안', hanja:'龜眼', easyName:'거북처럼 깊고 차분한 눈', glance:'감정을 크게 드러내기보다 깊고 안정적인 느낌을 주는 눈이에요.', features:['눈빛이 조용하고 안정적이에요','눈매의 기울기가 과하지 않아요','전체적으로 느긋하고 차분한 분위기예요'], traditional:'거북은 장수와 안정, 복을 상징해요. 구안 역시 오래도록 안정적으로 복을 누리는 형상과 연결해 설명하는 경우가 많아요.', keywords:['안정','차분함','장수','복'] },
  EYE_GOOSE:    { nameKo:'안안', hanja:'雁眼', easyName:'기러기처럼 또렷하고 의연한 눈', glance:'화려하거나 강렬하기보다 또렷하면서 단정한 느낌을 주는 눈이에요.', features:['눈매가 정돈되어 보여요','시선이 또렷해요','좌우 균형감이 좋은 인상을 줘요'], traditional:'안안은 굳은 의지와 의연함, 부귀와 사회적인 평판과 연결해 풀이하기도 해요.', keywords:['의지','의연함','품격','신뢰'] },
  EYE_TIGER:    { nameKo:'호안', hanja:'虎眼', easyName:'호랑이처럼 강하고 위엄 있는 눈', glance:'눈빛이 강하고 집중력이 느껴져 한번 보면 쉽게 잊히지 않는 눈이에요.', features:['눈동자와 시선이 또렷해요','눈에 힘이 있어요','집중된 느낌이 강해요'], traditional:'호안은 위엄과 기세, 강한 추진력을 상징하는 눈으로 해석해요. 다만 기세가 지나치게 강할 경우 강압적인 인상을 경계하는 해석도 있어요.', keywords:['위엄','추진력','집중력','기세'] },
  EYE_YINYANG:  { nameKo:'음양안', hanja:'陰陽眼', easyName:'좌우의 느낌이 조금 다른 눈', glance:'두 눈의 크기나 높이, 눈꼬리 등이 조금 달라 한 얼굴에서 두 가지 분위기가 느껴지는 눈이에요.', features:['좌우 눈의 크기가 조금 다를 수 있어요','한쪽 눈꼬리가 조금 더 높거나 낮을 수 있어요','심한 비대칭보다는 미묘한 차이가 핵심이에요'], traditional:'음양안은 자료마다 해석의 차이가 큰 편이에요. 현대적으로는 독특한 개성과 매력을 가진 눈으로 해석할 수 있어요.', keywords:['개성','복합적매력','비대칭','신비감'] },
  EYE_LUAN:     { nameKo:'난안', hanja:'鸞眼', easyName:'난새처럼 화사하고 아름다운 눈', glance:'눈매가 깨끗하고 생기가 있어 전체적으로 밝고 화사한 느낌을 주는 눈이에요.', features:['눈매가 깨끗하고 수려해 보여요','눈빛에 생기가 느껴져요','다른 이목구비와 자연스럽게 조화를 이뤄요'], traditional:'난(鸞)은 봉황과 함께 길한 상상의 새로 여겨져요. 난안 역시 아름다움과 좋은 기운, 넉넉한 복과 연결해 풀이하는 경우가 있어요.', keywords:['화사함','복','생기','조화'] },
  EYE_SNAKE:    { nameKo:'사안', hanja:'蛇眼', easyName:'뱀처럼 가늘고 예리한 눈', glance:'눈의 세로 폭이 좁고 옆으로 길게 뻗어 예리하고 경계심 있는 느낌을 주는 눈이에요.', features:['눈이 비교적 가늘고 길어요','시선이 날카롭게 느껴질 수 있어요','좁고 집중된 인상을 줘요'], traditional:'현대적으로는 예리함과 관찰력, 신중함이 돋보이는 인상으로 해석하는 것이 자연스러워요.', keywords:['예리함','관찰력','신중함','경계심'] },
  EYE_PEACH:    { nameKo:'도화안', hanja:'桃花眼', easyName:'복숭아꽃처럼 촉촉하고 매력적인 눈', glance:'눈에 수분감이 느껴지고 웃지 않아도 살짝 웃는 듯한 느낌을 주는 눈이에요.', features:['눈동자가 촉촉해 보여요','눈매에 부드러운 곡선이 있어요','전체적으로 감성적이고 부드러운 분위기예요'], traditional:'도화안은 이성적인 매력과 사교성을 상징하는 눈으로 많이 알려져 있어요. 현대적으로는 매력과 감수성, 사교성과 감정 표현이 풍부한 눈으로 풀이하는 것이 좋아요.', keywords:['매력','감수성','사교성','표현력'] },
};
const FACE_ARCHETYPE_DB = {
  FACE_DRAGON:  { nameKo:'용상', hanja:'龍相', easyName:'용처럼 중심이 잡힌 리더형 인상', glance:'이목구비가 뚜렷하고 전체적인 균형과 기세가 안정돼 있어 자연스럽게 중심 인물처럼 느껴지는 형상이에요.', features:['코가 얼굴 중심에서 또렷해요','눈에 힘이 있어요','강하기만 하기보다 절제된 힘이 느껴져요'], traditional:'용상은 매우 귀한 물형 가운데 하나로 보며 권위와 큰 그릇, 리더십을 상징해요.', keywords:['리더십','중심','권위','절제'] },
  FACE_PHOENIX: { nameKo:'봉상', hanja:'鳳相', easyName:'봉황처럼 단정하고 우아한 인상', glance:'어느 한 부위가 과하게 튀기보다 이목구비가 정갈하게 조화를 이루는 형상이에요.', features:['눈과 눈썹이 길고 섬세한 편이에요','코가 단정해 보여요','얼굴선이 깨끗해요'], traditional:'봉황은 귀한 상징으로 여겨져 봉상 역시 품격과 총명함, 명예와 연결해 해석해요.', keywords:['품격','조화','총명함','우아함'] },
  FACE_CRANE:   { nameKo:'학상', hanja:'鶴相', easyName:'학처럼 맑고 고고한 인상', glance:'얼굴과 몸의 선이 가늘고 깨끗하며 차분하고 지적인 분위기가 느껴지는 형상이에요.', features:['맑고 깨끗한 얼굴 인상','비교적 갸름한 얼굴','차분한 분위기'], traditional:'학상은 청수함과 고결함, 지성과 명예를 상징하는 길한 형상으로 풀이해요.', keywords:['지성','고고함','청수함','명예'] },
  FACE_LION:    { nameKo:'사자상', hanja:'獅子相', easyName:'사자처럼 풍채와 존재감이 큰 인상', glance:'얼굴에 힘과 볼륨이 있고 자세가 당당해 가만히 있어도 존재감이 느껴지는 형상이에요.', features:['얼굴 골격이 안정적이에요','넓고 힘 있는 얼굴선','당당한 눈빛'], traditional:'사자의 형상은 위엄과 부귀, 리더십과 절제된 힘을 상징해요.', keywords:['카리스마','위엄','리더십','풍채'] },
  FACE_KIRIN:   { nameKo:'기린상', hanja:'麒麟相', easyName:'기린처럼 온화하고 품격 있는 인상', glance:'강하게 압도하기보다 편안하고 안정적인 분위기로 신뢰를 주는 형상이에요.', features:['얼굴에 과도한 날카로움이 적어요','표정과 몸가짐이 편안해요','이목구비가 자연스럽게 조화를 이뤄요'], traditional:'기린은 대표적인 길한 상징 중 하나예요. 기린상 역시 온화함과 덕, 안정적인 복과 연결해 풀이해요.', keywords:['온화함','덕','안정감','신뢰'] },
  FACE_TIGER:   { nameKo:'호상', hanja:'虎相', easyName:'호랑이처럼 힘과 추진력이 느껴지는 인상', glance:'눈빛과 표정에서 에너지가 느껴지고 행동이 빠를 것 같은 인상을 주는 형상이에요.', features:['눈이 또렷하고 힘이 있어요','시선이 집중되어 보여요','표정과 자세가 당당해요'], traditional:'호랑이의 형상은 위엄과 활동성, 추진력과 결단력을 상징해요.', keywords:['추진력','활동성','위엄','결단력'] },
  FACE_ELEPHANT:{ nameKo:'상상', hanja:'象相', easyName:'코끼리처럼 넉넉하고 포용력 있는 인상', glance:'얼굴 중심과 전체적인 분위기에 안정감이 있고 급하거나 날카롭기보다 묵직하고 여유로운 형상이에요.', features:['코가 비교적 크고 길게 느껴져요','얼굴에 적당한 볼륨감이 있어요','조급한 느낌이 적어요'], traditional:'코끼리의 형상은 넉넉함과 포용력, 안정적인 재복과 연결해 풀이해요.', keywords:['포용력','여유','안정감','재복'] },
  FACE_OX:      { nameKo:'우상', hanja:'牛相', easyName:'소처럼 우직하고 편안한 인상', glance:'급한 느낌이 적고 묵묵하며 쉽게 흔들리지 않을 것 같은 신뢰감을 주는 형상이에요.', features:['눈매가 크고 순한 편이에요','표정이 안정적이에요','행동과 분위기가 느긋해 보여요'], traditional:'소의 형상은 성실함과 우직함, 재복과 신뢰를 상징해요.', keywords:['성실','신뢰','우직함','안정'] },
  FACE_HORSE:   { nameKo:'마상', hanja:'馬相', easyName:'말처럼 빠르고 활동적인 인상', glance:'얼굴선이 비교적 길고 표정과 분위기에서 빠른 에너지가 느껴지는 형상이에요.', features:['얼굴이 비교적 길게 느껴질 수 있어요','코가 길게 뻗은 형태로 묘사되기도 해요','정적인 느낌보다 활동적인 이미지가 강해요'], traditional:'말의 형상은 민첩함과 부지런함, 이동성과 활동성을 상징해요. 전통 자료에서는 성격이 다소 급할 수 있다는 해석이 함께 등장하기도 해요.', keywords:['민첩함','부지런함','활동성','속도'] },
};
const FACE_ARCHETYPE_EMOJI = { FACE_DRAGON:'🐉', FACE_PHOENIX:'🦅', FACE_CRANE:'🕊️', FACE_LION:'🦁', FACE_KIRIN:'🦌', FACE_TIGER:'🐯', FACE_ELEPHANT:'🐘', FACE_OX:'🐂', FACE_HORSE:'🐴' };

const EYE_ICON_PARAMS = {
  EYE_DRAGON:{ rx:25,ry:16,tilt:0,pupil:9 }, EYE_PHOENIX:{ rx:32,ry:9,tilt:-4,pupil:6 }, EYE_OX:{ rx:27,ry:18,tilt:0,pupil:10 },
  EYE_CRANE:{ rx:30,ry:7,tilt:0,pupil:5 }, EYE_LION:{ rx:26,ry:15,tilt:-2,pupil:9,brow:true }, EYE_SING_PHOENIX:{ rx:33,ry:8,tilt:-6,pupil:6 },
  EYE_TURTLE:{ rx:23,ry:13,tilt:4,pupil:8 }, EYE_GOOSE:{ rx:28,ry:11,tilt:0,pupil:7 }, EYE_TIGER:{ rx:27,ry:15,tilt:-8,pupil:9,brow:true },
  EYE_YINYANG:{ rx:26,ry:13,tilt:0,pupil:8,asym:true }, EYE_LUAN:{ rx:28,ry:13,tilt:-3,pupil:8,glow:true }, EYE_SNAKE:{ rx:34,ry:6,tilt:2,pupil:5 },
  EYE_PEACH:{ rx:27,ry:14,tilt:-5,pupil:8,glow:true },
};
function eyeIconSVG(id) {
  const p = EYE_ICON_PARAMS[id]; if (!p) return '';
  const cx=50, cy=38;
  const brow = p.brow ? `<path d="M${cx-p.rx-6} ${cy-p.ry-9} Q${cx} ${cy-p.ry-16} ${cx+p.rx+6} ${cy-p.ry-9}" stroke="#a855f7" stroke-width="3" fill="none" stroke-linecap="round"/>` : '';
  const glow = p.glow ? `<circle cx="${cx-p.pupil*0.35}" cy="${cy-p.pupil*0.35}" r="${Math.max(1.5,p.pupil*0.28)}" fill="#fff"/>` : '';
  return `<svg viewBox="0 0 100 70" width="60" height="42">${brow}<ellipse cx="${cx}" cy="${cy}" rx="${p.rx}" ry="${p.ry}" fill="#fff" stroke="#c9a84c" stroke-width="2" transform="rotate(${p.tilt} ${cx} ${cy})"/><circle cx="${cx}" cy="${cy}" r="${p.pupil}" fill="#2a1a3a"/>${glow}${p.asym ? `<ellipse cx="${cx}" cy="${cy}" rx="${p.rx*0.6}" ry="${p.ry*1.3}" fill="none" stroke="rgba(124,58,237,0.5)" stroke-width="1.5"/>` : ''}</svg>`;
}

const FOREHEAD_TYPE_DB = {
  FH_ANGULAR: { nameKo:'각진 이마', strength:'추진력이 좋고 논리적이에요.', weakness:'마무리가 약할 수 있어요.' },
  FH_M_SHAPE: { nameKo:'M자·혼합형 이마', strength:'독창적이고 집중력이 좋아요.', weakness:'생각이 부정적으로 흐를 때가 있어요.', detail:'발제(이마와 머리카락의 경계선)가 들쭉날쭉하거나 이마 라인이 파고든 편이라, 어린 시절엔 다소 분주하게 이것저것 겪었을 수 있어요. 다만 이건 스스로 길을 개척하는 부지런한 기질로도 읽혀서, 나쁘게만 볼 일은 아니에요.' },
  FH_NARROW: { nameKo:'폭 좁은 이마', strength:'투쟁적이고 본능적인 감각이 좋아요.', weakness:'충동적으로 행동할 수 있어요.', detail:'전통 관상에서는 이마 폭이 얼굴을 셋으로 나눴을 때 3분의 1 정도로 적당한 걸 길상으로 봐요. 그보다 확연히 좁거나 이마 선이 크게 꺼진 듯 보이면 초년에 좋은 기회를 만나기까지 시간이 걸리고 조직 안에서 큰 자리에 오르기까지도 노력이 더 필요한 편이라고 풀이해요. 여자라면 배우자의 일이나 사업운에도 살짝 영향을 줄 수 있다고 보는 해석도 있어요 — 다만 이건 참고할 만한 전통적 풀이일 뿐, 노력과 표정·태도로 얼마든지 채워갈 수 있는 부분이에요.' },
  FH_THREE_SHAPE: { nameKo:'3자형·돌출형 이마', strength:'친화력이 좋고 중재를 잘해요.', weakness:'이간질처럼 비칠 수 있어요.' },
  FH_ROUND: { nameKo:'원형 이마', strength:'사교적이고 표현력이 좋아요.', weakness:'쉽게 흥분할 수 있어요.' },
  FH_WIDE: { nameKo:'넓은 이마', strength:'의리가 있고 조직적이에요.', weakness:'성격이 급할 수 있어요.', detail:'이마 양쪽 위, 눈썹 끝에서 위로 이어지는 일월각(부모덕·윗사람 도움을 보는 자리)까지 도톰하고 좌우가 고르면 어린 시절 부모의 그늘이 든든하고 윗사람의 이끌어줌이 있었다고 봐요.' },
};
const EYEBROW_TYPE_DB = {
  EB_THICK: { nameKo:'두꺼운 눈썹·미간 좁은 눈썹', strength:'적극적이고 승부욕이 좋아요.', weakness:'고집이 셀 수 있어요.', detail:'두 눈썹 사이(인당)가 좁아서 집중력은 좋지만, 마음이 조급해지기 쉬운 편이에요. 미간을 펴고 밝은 표정을 지으면 그 기색이 한결 좋아져요.' },
  EB_RAISED: { nameKo:'올라간 눈썹·짧고 두꺼운 눈썹', strength:'대범하고 능력자 기질이 있어요.', weakness:'한 가지에 몰두하는 외골수 성향이 있을 수 있어요.' },
  EB_TRIANGLE: { nameKo:'삼각 눈썹·일자 눈썹', strength:'결단력이 있고 독립적이에요.', weakness:'이기적으로 비칠 수 있어요.' },
  EB_DROOPY: { nameKo:'처진 눈썹·미간 넓은 눈썹', strength:'협조적이고 유쾌해요.', weakness:'오지랖이 넓을 수 있어요.', detail:'인당(두 눈썹 사이 공간)이 넓고 맑은 편이라 마음이 트이고 사람을 너그럽게 품어서 인연이 순탄한 편이에요.' },
  EB_CRESCENT: { nameKo:'반달 눈썹', strength:'친절하고 인기가 많아요.', weakness:'요령을 피울 수 있어요.', detail:'눈썹꼬리가 흐트러짐 없이 가지런히 모여 끝나는 편이라, 일의 마무리가 야무지고 인연을 소중히 하는 성정으로 봐요.' },
  EB_THIN: { nameKo:'가는 눈썹', strength:'조심성이 있고 상냥해요.', weakness:'우유부단할 수 있어요.', detail:'숱이 옅고 성긴 편이면 형제·친구의 도움이 다소 적은 편으로 풀이하기도 하지만, 이는 성향의 결일 뿐이라 스스로 베푸는 정으로 얼마든지 채워지는 부분이에요.' },
};
const EYE_SHAPE_DB = {
  ES_BIG: { nameKo:'큰 눈', comboTrait:'적극적이고 화끈하게 몰입하는 마음', strength:'적극적이고 개방적이에요. 감정 몰입도가 커서 사랑이든 일이든 화끈하게 빠져드는 편이에요.', weakness:'마음이 떠나면 미련 없이 돌아서기도 하고, 호언장담할 때가 있어요.', detail:'내 사람과 아닌 사람을 직감적으로 빠르게 구분해서 사람 보는 기준이 꽤 까다로운 편이에요. 새로운 사람을 만나도 처음엔 여럿이 함께하며 시간을 두다가, 한번 마음을 열면 급격히 가까워져요. 지시받기보다 스스로 판단해 움직이는 환경에서 리더십이 더 빛나는 타입이에요.' },
  ES_SMALL: { nameKo:'작은 눈', comboTrait:'서두르지 않고 꾸준히 밀고 가는 근성', strength:'의지력과 근성이 좋아요. 서두르지 않고 꾸준히 매달려 결과를 만들어내는 타입이에요.', weakness:'자기주장이 강할 수 있고, 처음엔 매력이 확 드러나지 않아 알아가는 데 시간이 걸리는 편이에요.', detail:'인기를 서둘러 좇기보다 때를 기다리는 편이라 오히려 늦게 빛나요. 특히 눈이 작고 길게 뻗은 편이라면 세상을 보는 통찰력이 좋아서, 남들과 다른 독특한 발상으로 자기 영역을 만들어가는 힘이 있어요.' },
  ES_DROOPY: { nameKo:'처진 눈', comboTrait:'정 많고 다정하게 챙기는 마음', strength:'인자하고 감수성이 풍부해요.', weakness:'잔머리를 쓸 수 있어요.', detail:'눈꼬리가 아래로 살짝 내려간 편이라 온화하고 정이 많은 성정으로 봐요. 남의 마음을 잘 헤아려 편하게 해주어 대인관계와 연애에서 호감을 사기 쉽지만, 마음이 여려 거절을 어려워하는 면이 있어 스스로를 지키는 지혜도 함께 지니면 좋아요.' },
  ES_MONOLID: { nameKo:'외꺼풀 눈', comboTrait:'속으로 깊이 담아두는 진중함', strength:'관찰력이 좋고 이론적이에요.', weakness:'질투심이 있을 수 있어요.', detail:'감정을 안으로 다스리는 성정이라 속이 깊은 편이에요. 마음을 여는 데는 시간이 걸리지만, 한번 마음을 열면 그 정이 오래가는 편이라고 봐요.' },
  ES_UPTURNED: { nameKo:'올라간 눈', comboTrait:'자신감 있고 굽히지 않는 기상', strength:'자신감 있고 강직해요.', weakness:'차갑게 보일 수 있어요.', detail:'눈꼬리가 위로 향한 이른바 치켜뜬 눈이라, 기상이 뚜렷하고 자존심이 강한 성정으로 봐요. 승부욕과 추진력이 있어 뜻한 바를 밀고 나가는 힘이 있지만, 기가 세 보이는 인상을 줄 수 있어서 부드러운 표정을 곁들이면 매력이 한결 살아나요.' },
  ES_DOUBLE: { nameKo:'쌍꺼풀 눈', comboTrait:'감정 표현이 솔직하고 화려한 매력', strength:'화려하고 임기응변이 좋아요.', weakness:'과시적으로 비칠 수 있어요.', detail:'감정 표현이 솔직하고 정이 겉으로 잘 드러나는 편이라, 연애에서도 애정을 아끼지 않는 스타일로 봐요.' },
  ES_WIDE_SET: { nameKo:'눈 사이가 넓은 눈(원거리안)', comboTrait:'느긋하고 너그럽게 품는 여유', strength:'도량이 넓고 마음이 느긋해요. 사람을 너그럽게 품는 편이에요.', weakness:'긴장감이 필요한 순간에도 여유를 부릴 수 있어요.', detail:'⚠️ 이 유형은 판단 기준값이 실측 데이터가 아니라 통상적인 얼굴 비례론(오안비율) 벤치마크를 참고한 초안이에요. 다만 이런 얼굴형인 상대는 사람을 두루 품는 편이라 편하게 다가가도 좋아요.' },
  ES_CLOSE_SET: { nameKo:'눈 사이가 좁은 눈(근거리안)', comboTrait:'한 가지에 몰두하는 집중력', strength:'집중력이 뛰어나고 한 가지에 몰두하는 힘이 좋아요.', weakness:'조급해지기 쉬우니 마음의 여유를 곁들이면 좋아요.', detail:'⚠️ 이 유형도 마찬가지로 실측 데이터가 아닌 통상적인 벤치마크 기준의 초안이에요.' },
};
const NOSE_SHAPE_DB = {
  NS_SMALL_SHORT: { nameKo:'작은 코·짧은 코', comboTrait:'재치 있고 순발력 있는 감각', strength:'재치 있고 순발력이 좋아요.', weakness:'즉흥적으로 행동할 수 있어요.', detail:'코가 짧고 아담한 편이면 융통성과 특유의 낙천성이 돋보인다고 봐요. 자존심을 앞세우기보다 상대와 적당히 타협하며 결과를 이끌어내는 수완이 좋아서, 전통적으로는 장사나 사업 쪽 감각이 좋은 상으로 풀이해요.' },
  NS_WIDE: { nameKo:'넓은 코', comboTrait:'대외 활동력과 생활력', strength:'대외 활동력과 생활력이 좋아요.', weakness:'지배욕이 있을 수 있어요.' },
  NS_AQUILINE: { nameKo:'매부리코', comboTrait:'신중하고 처세에 능한 면', strength:'신중하고 처세술이 좋아요.', weakness:'인색해 보일 수 있어요.' },
  NS_BENT: { nameKo:'꺾인 코', comboTrait:'개성 있고 직감이 발달한 면', strength:'개성 있고 직감력이 좋아요.', weakness:'계산적으로 비칠 수 있어요.' },
  NS_BIG: { nameKo:'큰 코', comboTrait:'활동적이고 현실적인 추진력', strength:'활동적이고 현실적이에요.', weakness:'융통성이 부족할 수 있어요.', detail:'코끝(준두)까지 크고 길게 뻗은 코는 자존심이 강하고 보수적인 성향과 연결해 풀이해요. 그때그때 빠르게 치고 빠지는 장사보다는, 한 우물을 진득하게 파는 전문 분야나 기술직에서 천천히 자기 영역을 다지는 쪽이 더 잘 맞는다고 봐요.' },
  NS_UPTURNED: { nameKo:'올라간 코', comboTrait:'사교적이고 다재다능한 매력', strength:'사교적이고 다재다능해요.', weakness:'잘난 척으로 비칠 수 있어요.' },
  NS_ALAR_THICK: { nameKo:'도톰한 콧방울', comboTrait:'알뜰하게 지키는 재물 감각', strength:'들어온 재물을 잘 지키는 알뜰한 성정이에요. 씀씀이를 헤프게 하지 않아요.', weakness:'지나치게 아끼는 데 신경 쓰다 보면 재미가 덜할 수 있어요.' },
  NS_ALAR_THIN: { nameKo:'얇은 콧방울·콧구멍이 드러나는 코', comboTrait:'통 크게 나누는 씀씀이', strength:'통이 크고 나누는 데 아낌이 없어요.', weakness:'씀씀이가 큰 편이라 지출 관리가 필요해요.' },
  NS_BOKGO: { nameKo:'복코(콧대는 완만하고 준두·콧방울이 도톰한 코)', comboTrait:'후덕하고 원만한 재물복', strength:'재물복과 원만한 성정을 함께 갖춘 후덕한 상이에요. 사람들과 두루 잘 어울려요.', weakness:'특별히 두드러지는 약점보다는, 콧대가 도드라지지 않아 존재감이 은근한 편이에요.' },
};
const MOUTH_SHAPE_DB = {
  MS_THICK: { nameKo:'두꺼운 입', comboTrait:'정 많고 애정 표현에 성실한 마음', strength:'정이 많고 성실해요.', weakness:'지출이 많을 수 있어요.' },
  MS_BIG: { nameKo:'큰 입', comboTrait:'화끈하게 밀어붙이는 행동력', strength:'행동력과 결단력이 좋아요.', weakness:'잘 속을 수 있어요.' },
  MS_SMALL: { nameKo:'작은 입·윗입술 얇은 입', comboTrait:'아이디어 넘치는 기획력', strength:'기획력이 있고 호기심이 많아요.', weakness:'지구력이 부족할 수 있어요.' },
  MS_THIN: { nameKo:'얇은 입·아랫입술 얇은 입', comboTrait:'센스 있고 민첩한 감각', strength:'센스 있고 민첩해요.', weakness:'냉정하게 비칠 수 있어요.' },
  MS_DOWNTURNED: { nameKo:'양끝 처진 입·아랫입술 나온 입', comboTrait:'한번 정한 건 끝까지 지키는 신의', strength:'투지력이 있고 신의를 지켜요.', weakness:'반항적일 수 있어요.', detail:'입꼬리가 처진 인상을 줄 수 있지만 이는 고정된 운이 아니라 그때그때의 기색에 가까워요. 성정 자체는 진중하고 신중한 편이라, 말을 아끼고 실속을 챙기는 기질로도 볼 수 있어요.' },
  MS_UPTURNED: { nameKo:'양끝 올라간 입·보통 입', comboTrait:'명랑하고 긍정적인 기운', strength:'명랑하고 긍정적이에요.', weakness:'마음이 약할 수 있어요.', detail:'입꼬리가 살짝 위로 향한 입은 관상에서 매우 길하게 여겨요. 늘 웃는 인상을 주어 사람을 끌어당기고, 대인관계와 애정운이 두루 좋다고 봐요.' },
};
const CHIN_SHAPE_DB = {
  CS_UNDERBITE: { nameKo:'주걱턱·갈라진 턱', comboTrait:'정력적이고 대담하게 밀어붙이는 힘', strength:'정력적이고 대담해요.', weakness:'독불장군처럼 보일 수 있어요.', detail:'턱 가운데가 살짝 갈라진 편이면 개성이 강하고 매력 있는 상으로 여기며, 의지가 굳은 성정으로 풀이해요.' },
  CS_OVAL: { nameKo:'타원형 턱', comboTrait:'꼼꼼하고 직감이 발달한 섬세함', strength:'꼼꼼하고 직감력이 좋아요.', weakness:'우울해질 때가 있어요.' },
  CS_ROUND: { nameKo:'둥근 턱', comboTrait:'포용력 있고 낙천적인 여유', strength:'포용력이 있고 낙천적이에요.', weakness:'결단성이 부족할 수 있어요.', detail:'턱과 볼 아래쪽(노복궁)이 도톰하면 아랫사람·후배의 도움을 받는 복이 있고 따르는 사람이 많다고 봐요. 귀 아래에서 턱으로 이어지는 볼살이 도톰하면 말년에 재물과 사람이 곁에 머무르는 상으로도 풀이해요.' },
  CS_SQUARE: { nameKo:'사각턱', comboTrait:'집념 있고 청렴한 뚝심', strength:'집념이 있고 청렴해요.', weakness:'아집이 있을 수 있어요.' },
  CS_LONG: { nameKo:'긴 턱', comboTrait:'원만하고 온후한 성정', strength:'원만하고 온후해요.', weakness:'자기 주관이 부족할 수 있어요.' },
  CS_POINTED: { nameKo:'뾰족한 턱', comboTrait:'예술적이고 감각적인 면', strength:'예술적이고 감각적이에요.', weakness:'자존심이 강할 수 있어요.' },
};
const FACE_SHAPE_TYPE_DB = {
  FS_RECTANGLE: { nameKo:'직사각형', comboTrait:'착하고 온화하며 희망적인 추진력', strength:'착하고 부드러우며 온화하고 인자해요. 희망적이고 추진력도 있어요.', weakness:'결단력이 부족하고 마무리가 약할 수 있어요.', coaching:'시간을 두고 대하는 게 좋아요. 인간적으로 대하되 논리적인 설명을 충분히 곁들여 보세요.' },
  FS_SQUARE: { nameKo:'정사각형', comboTrait:'규칙적이고 책임감 있는 신뢰', strength:'규칙적이고 모범적이며 책임감이 강해요. 신뢰를 잘 지켜요.', weakness:'융통성이 부족하고 배려가 더 필요할 수 있어요.', coaching:'"거북이를 상대한다"는 마음으로 느긋하게 신뢰를 쌓아보세요. 한번 친해지면 오래가는 관계가 돼요.' },
  FS_TRIANGLE: { nameKo:'삼각형', comboTrait:'냉철하고 분석적인 인내심', strength:'냉철하고 이성적이며 분석적이고 인내심이 좋아요.', weakness:'차갑게 보이거나 저항적일 수 있어요.', coaching:'존경을 표현하고, 충고보다는 논리적·수치적으로 조목조목 설명해보세요.' },
  FS_INV_TRIANGLE: { nameKo:'역삼각형', comboTrait:'창조적이고 아이디어 넘치는 감각', strength:'창조적이고 예술적이며 아이디어가 좋아요.', weakness:'이기적이거나 비현실적으로 비칠 수 있어요.', coaching:'감정을 이해하고 공감해주는 게 중요해요. 솔직하게 있는 그대로 표현하면 잘 통해요.' },
  FS_ROUND: { nameKo:'원형', comboTrait:'외향적이고 사람 좋아하는 따뜻함', strength:'외향적이고 사교적이며 사람을 좋아하고 따뜻해요.', weakness:'오지랖이 넓거나 다혈질일 수 있어요.', coaching:'인간적 교류를 우선하고, 맞장구쳐주며 칭찬해주면 좋아요. 무관심은 참지 못해요.' },
  FS_OVAL: { nameKo:'타원형', comboTrait:'다재다능하고 적응력 있는 순발력', strength:'다재다능하고 순발력·적응력이 좋아요. 중재를 잘해요.', weakness:'잘난 척하거나 예민할 수 있어요.', coaching:'다양한 접근이 필요해요. 인간적 관계와 감성을 자극하는 아이디어로 다가가 보세요.' },
};

// 서버 API가 반환하는 카탈로그 전체 — js/character-api.js가 클라이언트 캐시(js/archetype-db.js)에
// 그대로 병합한다. eyeIconSVG는 함수가 아니라 미리 계산한 문자열 맵(EYE_ICON_SVG)으로 내려서,
// 클라이언트는 EYE_ICON_PARAMS(순수 아이콘 좌표 데이터)를 아예 받을 필요가 없게 한다.
function buildCatalog() {
  const EYE_ICON_SVG = {};
  Object.keys(EYE_ICON_PARAMS).forEach(id => { EYE_ICON_SVG[id] = eyeIconSVG(id); });
  return {
    EYE_ARCHETYPE_DB, FACE_ARCHETYPE_DB, FOREHEAD_TYPE_DB, EYEBROW_TYPE_DB,
    EYE_SHAPE_DB, NOSE_SHAPE_DB, MOUTH_SHAPE_DB, CHIN_SHAPE_DB, FACE_SHAPE_TYPE_DB,
    FACE_ARCHETYPE_EMOJI, EYE_ICON_SVG,
  };
}

module.exports = {
  EYE_ARCHETYPE_DB, FACE_ARCHETYPE_DB, FOREHEAD_TYPE_DB, EYEBROW_TYPE_DB,
  EYE_SHAPE_DB, NOSE_SHAPE_DB, MOUTH_SHAPE_DB, CHIN_SHAPE_DB, FACE_SHAPE_TYPE_DB,
  FACE_ARCHETYPE_EMOJI, eyeIconSVG, buildCatalog,
};
