// ═══ 69 관상 Feature → 6D 기질 벡터 매핑 (서버 전용) ═══
// js/character/face-trait-map.js를 서버로 이전한 것. 클라이언트에는 남기지 않는다(2026-08-30).
const FACE_TRAIT_MAP = {
  eye_archetype: {
    EYE_DRAGON:       { lead: 1.0, strategy: 0.3, drive: 0.4, social: 0.2, stability: 0.5, sense: 0.1 },
    EYE_PHOENIX:      { lead: 0.2, strategy: 1.0, drive: 0.1, social: 0.2, stability: 0.6, sense: 0.6 },
    EYE_OX:           { lead: 0.1, strategy: 0.2, drive: 0.3, social: 0.5, stability: 1.0, sense: 0.1 },
    EYE_CRANE:        { lead: 0.2, strategy: 1.0, drive: 0.1, social: 0.1, stability: 0.4, sense: 0.5 },
    EYE_LION:         { lead: 1.0, strategy: 0.2, drive: 0.3, social: 0.2, stability: 0.7, sense: 0.1 },
    EYE_SING_PHOENIX: { lead: 0.4, strategy: 1.0, drive: 0.3, social: 0.5, stability: 0.3, sense: 0.3 },
    EYE_TURTLE:       { lead: 0.1, strategy: 0.3, drive: 0.1, social: 0.2, stability: 1.0, sense: 0.1 },
    EYE_GOOSE:        { lead: 0.3, strategy: 0.2, drive: 0.3, social: 0.2, stability: 1.0, sense: 0.5 },
    EYE_TIGER:        { lead: 1.0, strategy: 0.2, drive: 0.9, social: 0.0, stability: 0.2, sense: 0.0 },
    EYE_YINYANG:      { lead: 0.1, strategy: 0.3, drive: 0.1, social: 0.3, stability: 0.1, sense: 1.0 },
    EYE_LUAN:         { lead: 0.1, strategy: 0.1, drive: 0.2, social: 1.0, stability: 0.3, sense: 0.8 },
    EYE_SNAKE:        { lead: 0.2, strategy: 1.0, drive: 0.4, social: 0.0, stability: 0.3, sense: 0.2 },
    EYE_PEACH:        { lead: 0.0, strategy: 0.1, drive: 0.1, social: 1.0, stability: 0.1, sense: 0.8 },
  },

  face_archetype: {
    FACE_DRAGON:   { lead: 1.0, strategy: 0.3, drive: 0.4, social: 0.2, stability: 0.6, sense: 0.1 },
    FACE_PHOENIX:  { lead: 0.2, strategy: 0.8, drive: 0.1, social: 0.5, stability: 0.7, sense: 0.8 },
    FACE_CRANE:    { lead: 0.2, strategy: 1.0, drive: 0.1, social: 0.1, stability: 0.4, sense: 0.5 },
    FACE_LION:     { lead: 1.0, strategy: 0.2, drive: 0.3, social: 0.4, stability: 0.4, sense: 0.1 },
    FACE_KIRIN:    { lead: 0.2, strategy: 0.2, drive: 0.1, social: 0.5, stability: 1.0, sense: 0.1 },
    FACE_TIGER:    { lead: 0.7, strategy: 0.2, drive: 1.0, social: 0.1, stability: 0.2, sense: 0.1 },
    FACE_ELEPHANT: { lead: 0.2, strategy: 0.2, drive: 0.1, social: 0.5, stability: 1.0, sense: 0.1 },
    FACE_OX:       { lead: 0.1, strategy: 0.1, drive: 0.3, social: 0.3, stability: 1.0, sense: 0.0 },
    FACE_HORSE:    { lead: 0.2, strategy: 0.2, drive: 1.0, social: 0.2, stability: 0.1, sense: 0.3 },
  },

  forehead: {
    FH_ANGULAR:     { lead: 0.2, strategy: 0.6, drive: 0.8, social: 0.0, stability: 0.2, sense: 0.1 },
    FH_M_SHAPE:     { lead: 0.1, strategy: 0.5, drive: 0.3, social: 0.0, stability: 0.1, sense: 0.8 },
    FH_NARROW:      { lead: 0.3, strategy: 0.0, drive: 0.7, social: 0.0, stability: 0.0, sense: 0.5 },
    FH_THREE_SHAPE: { lead: 0.1, strategy: 0.5, drive: 0.1, social: 1.0, stability: 0.3, sense: 0.1 },
    FH_ROUND:       { lead: 0.1, strategy: 0.0, drive: 0.2, social: 1.0, stability: 0.1, sense: 0.4 },
    FH_WIDE:        { lead: 0.5, strategy: 0.3, drive: 0.2, social: 0.3, stability: 0.7, sense: 0.0 },
  },

  eyebrow: {
    EB_THICK:    { lead: 0.5, strategy: 0.1, drive: 1.0, social: 0.1, stability: 0.1, sense: 0.0 },
    EB_RAISED:   { lead: 1.0, strategy: 0.3, drive: 0.3, social: 0.1, stability: 0.4, sense: 0.1 },
    EB_TRIANGLE: { lead: 0.8, strategy: 0.5, drive: 0.3, social: 0.0, stability: 0.2, sense: 0.0 },
    EB_DROOPY:   { lead: 0.0, strategy: 0.1, drive: 0.1, social: 1.0, stability: 0.3, sense: 0.2 },
    EB_CRESCENT: { lead: 0.0, strategy: 0.1, drive: 0.1, social: 1.0, stability: 0.3, sense: 0.3 },
    EB_THIN:     { lead: 0.0, strategy: 0.3, drive: 0.0, social: 0.5, stability: 0.6, sense: 0.1 },
  },

  eye_shape: {
    ES_BIG:       { lead: 0.3, strategy: 0.1, drive: 0.7, social: 0.7, stability: 0.1, sense: 0.3 },
    ES_SMALL:     { lead: 0.2, strategy: 0.4, drive: 0.8, social: 0.0, stability: 0.4, sense: 0.2 },
    ES_DROOPY:    { lead: 0.0, strategy: 0.1, drive: 0.0, social: 0.7, stability: 0.3, sense: 0.6 },
    ES_MONOLID:   { lead: 0.1, strategy: 1.0, drive: 0.1, social: 0.0, stability: 0.3, sense: 0.2 },
    ES_UPTURNED:  { lead: 0.8, strategy: 0.2, drive: 0.3, social: 0.0, stability: 0.6, sense: 0.1 },
    ES_DOUBLE:    { lead: 0.2, strategy: 0.1, drive: 0.3, social: 0.6, stability: 0.0, sense: 0.7 },
    ES_WIDE_SET:  { lead: 0.1, strategy: 0.0, drive: 0.0, social: 0.5, stability: 0.6, sense: 0.1 },
    ES_CLOSE_SET: { lead: 0.2, strategy: 0.7, drive: 0.6, social: 0.0, stability: 0.1, sense: 0.1 },
  },

  nose: {
    NS_SMALL_SHORT: { lead: 0.0, strategy: 0.2, drive: 0.5, social: 0.2, stability: 0.0, sense: 0.7 },
    NS_WIDE:        { lead: 0.3, strategy: 0.1, drive: 0.8, social: 0.3, stability: 0.2, sense: 0.0 },
    NS_AQUILINE:    { lead: 0.3, strategy: 0.8, drive: 0.1, social: 0.6, stability: 0.3, sense: 0.1 },
    NS_BENT:        { lead: 0.1, strategy: 0.3, drive: 0.1, social: 0.1, stability: 0.0, sense: 0.8 },
    NS_BIG:         { lead: 0.2, strategy: 0.2, drive: 0.7, social: 0.1, stability: 0.3, sense: 0.0 },
    NS_UPTURNED:    { lead: 0.1, strategy: 0.1, drive: 0.2, social: 0.8, stability: 0.0, sense: 0.4 },
    NS_ALAR_THICK:  { lead: 0.0, strategy: 0.2, drive: 0.1, social: 0.1, stability: 0.7, sense: 0.4 },
    NS_ALAR_THIN:   { lead: 0.2, strategy: 0.0, drive: 0.2, social: 0.6, stability: 0.0, sense: 0.3 },
    NS_BOKGO:       { lead: 0.2, strategy: 0.1, drive: 0.1, social: 0.5, stability: 0.6, sense: 0.1 },
  },

  mouth: {
    MS_THICK:      { lead: 0.0, strategy: 0.0, drive: 0.1, social: 0.5, stability: 0.7, sense: 0.1 },
    MS_BIG:        { lead: 0.5, strategy: 0.1, drive: 1.0, social: 0.2, stability: 0.1, sense: 0.0 },
    MS_SMALL:      { lead: 0.1, strategy: 0.7, drive: 0.1, social: 0.1, stability: 0.1, sense: 0.4 },
    MS_THIN:       { lead: 0.1, strategy: 0.2, drive: 0.4, social: 0.1, stability: 0.0, sense: 0.7 },
    MS_DOWNTURNED: { lead: 0.2, strategy: 0.1, drive: 0.6, social: 0.0, stability: 0.6, sense: 0.0 },
    MS_UPTURNED:   { lead: 0.1, strategy: 0.0, drive: 0.2, social: 0.8, stability: 0.1, sense: 0.3 },
  },

  chin: {
    CS_UNDERBITE: { lead: 0.5, strategy: 0.1, drive: 0.8, social: 0.0, stability: 0.2, sense: 0.1 },
    CS_OVAL:      { lead: 0.0, strategy: 0.6, drive: 0.1, social: 0.1, stability: 0.2, sense: 0.5 },
    CS_ROUND:     { lead: 0.1, strategy: 0.0, drive: 0.1, social: 0.7, stability: 0.5, sense: 0.2 },
    CS_SQUARE:    { lead: 0.2, strategy: 0.2, drive: 0.4, social: 0.0, stability: 0.8, sense: 0.0 },
    CS_LONG:      { lead: 0.0, strategy: 0.1, drive: 0.0, social: 0.4, stability: 0.7, sense: 0.4 },
    CS_POINTED:   { lead: 0.0, strategy: 0.1, drive: 0.0, social: 0.2, stability: 0.0, sense: 1.0 },
  },

  face_shape: {
    FS_RECTANGLE:    { lead: 0.1, strategy: 0.1, drive: 0.5, social: 0.4, stability: 0.5, sense: 0.1 },
    FS_SQUARE:       { lead: 0.2, strategy: 0.2, drive: 0.2, social: 0.1, stability: 1.0, sense: 0.0 },
    FS_TRIANGLE:     { lead: 0.1, strategy: 1.0, drive: 0.1, social: 0.0, stability: 0.3, sense: 0.1 },
    FS_INV_TRIANGLE: { lead: 0.2, strategy: 0.3, drive: 0.1, social: 0.1, stability: 0.0, sense: 1.0 },
    FS_ROUND:        { lead: 0.1, strategy: 0.0, drive: 0.1, social: 1.0, stability: 0.3, sense: 0.2 },
    FS_OVAL:         { lead: 0.1, strategy: 0.6, drive: 0.2, social: 0.6, stability: 0.1, sense: 0.5 },
  },
};

const PART_STATUS_TRAIT_MAP = {
  forehead:   { lead: 0.3, strategy: 0.1, drive: 0.1, social: 0.0, stability: 0.3, sense: 0.0 },
  eyebrow:    { lead: 0.1, strategy: 0.0, drive: 0.1, social: 0.5, stability: 0.2, sense: 0.0 },
  midbrow:    { lead: 0.5, strategy: 0.1, drive: 0.0, social: 0.3, stability: 0.1, sense: 0.0 },
  undereye:   { lead: 0.0, strategy: 0.0, drive: 0.0, social: 0.5, stability: 0.2, sense: 0.1 },
  nosebridge: { lead: 0.4, strategy: 0.1, drive: 0.1, social: 0.0, stability: 0.3, sense: 0.0 },
  nosetip:    { lead: 0.2, strategy: 0.1, drive: 0.1, social: 0.0, stability: 0.4, sense: 0.0 },
  philtrum:   { lead: 0.0, strategy: 0.0, drive: 0.4, social: 0.0, stability: 0.3, sense: 0.0 },
  mouth:      { lead: 0.0, strategy: 0.0, drive: 0.1, social: 0.4, stability: 0.0, sense: 0.2 },
  smilelines: { lead: 0.3, strategy: 0.0, drive: 0.1, social: 0.3, stability: 0.1, sense: 0.0 },
  jaw:        { lead: 0.0, strategy: 0.0, drive: 0.0, social: 0.2, stability: 0.5, sense: 0.0 },
  cheekbone:  { lead: 0.2, strategy: 0.0, drive: 0.5, social: 0.1, stability: 0.0, sense: 0.0 },
};

module.exports = { FACE_TRAIT_MAP, PART_STATUS_TRAIT_MAP };
