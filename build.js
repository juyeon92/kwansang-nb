// ═══ GitHub Pages 배포용 dist 빌드 (2026-08-30, 2026-09-08 번들링 강화) ═══
// index.html/images는 그대로 복사한다. js/**/*.js는 개별 파일로 내지 않고, index.html의 <script
// src="js/...">  태그 순서 그대로 하나로 이어붙인 뒤 압축해서 "이름이 의미 없는 해시 파일 하나"로
// 낸다(예: js/bundle-3f9a1c2e.js). 목적: 사용자 리포트 날짜·원인 분석 같은 개발자용 내부 코멘트와
// 판별 로직의 가독성뿐 아니라, "js 폴더에 기능을 알 수 있는 이름의 파일이 여러 개 있다"는 사실
// 자체를 없앤다 — 원본 소스(js/**, 파일 하나하나가 무엇을 하는지 그대로 보임)는 그대로 두고 여기서
// 만든 dist만 배포된다.
// ⚠️ 이 프로젝트는 각 js 파일이 ES 모듈이 아니라 <script> 태그 로드 순서에 의존하는 전역 스코프
// 스크립트다(import/export 없음) — 그래서 esbuild의 bundle:true(모듈 그래프 추적)를 쓰지 않고,
// index.html에 실제로 나열된 순서 그대로 텍스트를 이어붙인다. 이는 지금 여러 <script> 태그를 나란히
// 두는 것과 완전히 동일한 전역 스코프 의미론이라(같은 순서로 실행), 이어붙여도 동작이 달라지지
// 않는다 — 순수 배포 형태 변경이다.
// .github/workflows/deploy-pages.yml이 push 때마다 이 스크립트를 돌린다.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const esbuild = require('esbuild');

const ROOT = __dirname;
const DIST = path.join(ROOT, 'dist');

function copyFile(src, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}

function walk(dir, cb) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, cb);
    else cb(full);
  }
}

fs.rmSync(DIST, { recursive: true, force: true });
fs.mkdirSync(DIST, { recursive: true });

walk(path.join(ROOT, 'images'), (file) => {
  copyFile(file, path.join(DIST, path.relative(ROOT, file)));
});

// index.html에 실제로 나열된 순서를 그대로 유일한 근거로 삼는다(하드코딩된 파일 목록을 build.js에
// 따로 두면 나중에 스크립트 태그를 추가·삭제할 때 서로 어긋난다) — 여기 안 걸리는 js/**/*.js
// (예: js/character/verify_compatibility_engine.js처럼 브라우저가 아니라 node로만 돌리는 검증
// 스크립트)는 애초에 배포 대상이 아니므로 자동으로 빠진다.
const indexSrc = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const scriptTagRe = /<script src="(js\/[^"?]+)(?:\?[^"]*)?"><\/script>\n?/g;

let match;
let firstIndex = -1;
let lastEnd = -1;
const localScripts = [];
while ((match = scriptTagRe.exec(indexSrc))) {
  if (firstIndex === -1) firstIndex = match.index;
  lastEnd = match.index + match[0].length;
  localScripts.push(match[1]);
}
if (!localScripts.length) throw new Error('[build] index.html에서 js/ 로컬 <script> 태그를 하나도 못 찾았다 — 정규식이 실제 마크업과 어긋난 것 같다.');

const combined = localScripts
  .map((rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8'))
  .join('\n;\n');
// legalComments:'none' — 주석에 @license/@preserve가 있어도 남기지 않는다(원래 없지만 확실히).
// target: 'es2019' — 현재 서비스가 async/await·optional chaining 없이 짜여 있어 굳이 낮출 이유가
// 없지만, 너무 최신 문법으로 재작성되어 코드가 달라 보이는 것도 피하려고 보수적으로 고정.
const { code } = esbuild.transformSync(combined, { minify: true, legalComments: 'none', target: 'es2019' });
const hash = crypto.createHash('sha1').update(code).digest('hex').slice(0, 10);
const bundleName = `bundle-${hash}.js`;
fs.mkdirSync(path.join(DIST, 'js'), { recursive: true });
fs.writeFileSync(path.join(DIST, 'js', bundleName), code);

const distHtml = indexSrc.slice(0, firstIndex)
  + `<script src="js/${bundleName}"></script>\n`
  + indexSrc.slice(lastEnd);
fs.writeFileSync(path.join(DIST, 'index.html'), distHtml);

console.log(`[build] dist 준비 완료 — js ${localScripts.length}개 파일을 js/${bundleName} 하나로 번들링, index.html/images 복사`);
