# ═══════════════════════════════════════════════════════════════════════
# Netlify 배포용 폴더(dist) 만들기
#
# Netlify 수동 배포(드래그 앤 드롭 / CLI)는 "올린 폴더 안의 모든 파일"을 그대로 공개한다.
# 프로젝트 루트를 통째로 올리면 기획서/·functions/ 같은 내부 자료까지 URL로 접근 가능해지므로,
# 웹에서 실제로 필요한 것(index.html · js · images)만 dist로 복사해서 그 폴더만 올린다.
#
# 사용법
#   .\deploy.ps1                                  ← dist 폴더 준비
#   npx netlify-cli deploy --prod --dir=dist      ← 준비된 폴더 업로드(빌드 시간 차감 없음)
# ═══════════════════════════════════════════════════════════════════════

$root = $PSScriptRoot
$dist = Join-Path $root 'dist'

# 지난 배포 잔재가 섞이지 않게 매번 새로 만든다(지운 파일이 dist에만 남는 걸 방지)
if (Test-Path $dist) { Remove-Item $dist -Recurse -Force }
New-Item -ItemType Directory -Path $dist | Out-Null

# 웹에 올라가야 하는 것만 복사 — 여기 없는 건 배포되지 않는다.
# functions/·firestore.rules 등은 Firebase에 배포되는 것이라 Netlify에는 올리지 않는다.
Copy-Item (Join-Path $root 'index.html') $dist
Copy-Item (Join-Path $root 'js')     $dist -Recurse
Copy-Item (Join-Path $root 'images') $dist -Recurse

Write-Host ""
Write-Host "dist 준비 완료 — 아래 항목만 배포됩니다"
Get-ChildItem $dist | ForEach-Object { Write-Host ("  - " + $_.Name) }

$fileCount = (Get-ChildItem $dist -Recurse -File | Measure-Object).Count
Write-Host ("  (파일 " + $fileCount + "개)")
Write-Host ""
Write-Host "배포 명령: npx netlify-cli deploy --prod --dir=dist"
Write-Host ""
