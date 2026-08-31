// ═══ GitHub Pages 배포용 dist 빌드 (2026-08-30) ═══
// index.html/images는 그대로 복사하고, js/**/*.js만 주석 제거 + 압축(minify)해서 dist에 낸다.
// 목적: 사용자 리포트 날짜·원인 분석 같은 개발자용 내부 코멘트, 그리고 판별 로직 자체의 가독성을
// 실서비스 응답에서 없앤다 — 원본 소스(js/**)는 그대로 두고 여기서 만든 dist만 배포된다.
// .github/workflows/deploy-pages.yml이 push 때마다 이 스크립트를 돌린다.
const fs = require('fs');
const path = require('path');
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

copyFile(path.join(ROOT, 'index.html'), path.join(DIST, 'index.html'));
walk(path.join(ROOT, 'images'), (file) => {
  copyFile(file, path.join(DIST, path.relative(ROOT, file)));
});

let jsCount = 0;
walk(path.join(ROOT, 'js'), (file) => {
  if (!file.endsWith('.js')) return;
  const rel = path.relative(ROOT, file);
  const src = fs.readFileSync(file, 'utf8');
  // legalComments:'none' — 주석에 @license/@preserve가 있어도 남기지 않는다(원래 없지만 확실히).
  // target: 'es2019' — 현재 서비스가 async/await·optional chaining 없이 짜여 있어 굳이 낮출 이유가
  // 없지만, 너무 최신 문법으로 재작성되어 코드가 달라 보이는 것도 피하려고 보수적으로 고정.
  const { code } = esbuild.transformSync(src, { minify: true, legalComments: 'none', target: 'es2019' });
  const outPath = path.join(DIST, rel);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, code);
  jsCount++;
});

console.log(`[build] dist 준비 완료 — js ${jsCount}개 파일 압축, index.html/images 복사`);
