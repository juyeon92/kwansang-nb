// ═══ pre-commit 체크: js/*.js를 고쳤으면 index.html의 ?v= 캐시 버전도 같이 올렸는지 확인 ═══
// CLAUDE.md 규칙("js/ 파일을 고친 뒤에는 그 파일을 불러오는 <script> 태그의 ?v= 값도 같이
// 올려야 한다")이 문서로만 있어서 2026-09-12·2026-09-14 두 번이나 실수로 빠뜨렸다 — 커밋을
// 막아서 강제하도록 githooks/pre-commit에서 이 스크립트를 호출한다.
const { execSync } = require('child_process');

function sh(cmd) {
  return execSync(cmd, { encoding: 'utf8' });
}

const stagedFiles = sh('git diff --cached --name-only --diff-filter=M')
  .split('\n')
  .map((s) => s.trim())
  .filter(Boolean);

const changedJsFiles = stagedFiles.filter((f) => /^js\/.*\.js$/.test(f));
if (changedJsFiles.length === 0) process.exit(0);

const indexStagedNow = stagedFiles.includes('index.html')
  ? sh('git show :index.html')
  : sh('git show HEAD:index.html'); // index.html 자체는 안 건드렸으면 그대로 HEAD 내용
const indexAtHead = sh('git show HEAD:index.html');

function versionOf(html, jsPath) {
  const re = new RegExp('src="' + jsPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\?v=([^"]+)"');
  const m = html.match(re);
  return m ? m[1] : null;
}

const missing = [];
for (const f of changedJsFiles) {
  const before = versionOf(indexAtHead, f);
  const now = versionOf(indexStagedNow, f);
  if (before === null || now === null) continue; // index.html에서 안 불러오는 파일(번들 전용 등)은 스킵
  if (before === now) missing.push({ file: f, version: before });
}

if (missing.length > 0) {
  console.error('\n✖ 캐시 버스팅(?v=) 누락 — 아래 js 파일을 고쳤는데 index.html의 ?v= 값이 그대로예요:\n');
  for (const m of missing) console.error('  - ' + m.file + '  (현재 ?v=' + m.version + ')');
  console.error('\n  index.html에서 해당 <script src="' + missing[0].file + '?v=...">의 버전을 올려서');
  console.error('  같이 스테이징(git add)한 뒤 다시 커밋해주세요. (진짜 예외라면 --no-verify)\n');
  process.exit(1);
}

process.exit(0);
