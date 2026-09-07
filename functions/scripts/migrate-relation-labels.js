// 인연도감 관계 라벨 마이그레이션 — 기획서/인연도감 관계 라벨 개편안.md "반영 필요 사항" 참고.
//
// 배경: dogam/{slug}/entries/{uid}.relation은 등록 시점에 문자열로 그대로 저장돼, 점수 계산
// 로직(js/inyeon-dogam.js relationLabel)을 5단계로 바꿔도 기존에 저장된 문서는 자동으로 안 바뀐다.
// 이 스크립트는 모든 entries 문서를 훑어 "새 로직으로 다시 계산하면 어떤 라벨이 나올지"와 지금
// 저장된 값을 비교해서 바뀌어야 할 문서를 찾는다. 기본은 dry-run — 실제 쓰기는 --apply를 줘야 실행된다.
//
// 실행 전 준비 (둘 중 하나):
//   A) Firebase 콘솔 → 프로젝트 설정 → 서비스 계정 → "새 비공개 키 생성"으로 받은 json을
//      functions/serviceAccountKey.json 으로 저장(.gitignore에 이미 등록돼 있어 커밋 안 됨).
//   B) GOOGLE_APPLICATION_CREDENTIALS 환경변수에 그 키 파일 경로를 직접 지정
//      (또는 `gcloud auth application-default login`으로 ADC 설정 — 이 경우도 projectId는
//      아래에서 코드로 명시하니 추가 설정 없이 됨)
//
// functions/ 디렉터리에서 실행 (firebase-admin이 여기 node_modules에 설치돼 있음):
//   node scripts/migrate-relation-labels.js            → dry-run, 콘솔에 통계만 출력(개인정보 미노출)
//   node scripts/migrate-relation-labels.js --apply     → 실제로 바뀌는 문서만 batch update

const admin = require('firebase-admin');
const path = require('path');
const fs = require('fs');
const { CHARACTER_DB } = require('../engine/character-db.js');

const PROJECT_ID = 'kwansang-nb'; // .firebaserc의 default 프로젝트
const APPLY = process.argv.includes('--apply');

function buildCredential() {
  const explicitKeyPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  const defaultKeyPath = path.join(__dirname, '..', 'serviceAccountKey.json');
  const keyPath = explicitKeyPath && fs.existsSync(explicitKeyPath) ? explicitKeyPath
    : (fs.existsSync(defaultKeyPath) ? defaultKeyPath : null);
  if (keyPath) {
    console.log(`[migrate] 서비스 계정 키 사용: ${keyPath}`);
    return admin.credential.cert(require(keyPath));
  }
  console.log('[migrate] 서비스 계정 키 파일을 못 찾아서 ADC(gcloud auth application-default login)로 시도합니다.');
  return admin.credential.applicationDefault();
}

function relationLabel(idA, idB) {
  const a = CHARACTER_DB[idA];
  const b = CHARACTER_DB[idB];
  if (!a || !b) return null; // 유형이 삭제(GUNJA)됐거나 알 수 없는 id — 수동 확인 필요
  if (a.compatibleTypes && a.compatibleTypes.includes(idB)) return '찰떡';
  if (a.sparkTypes && a.sparkTypes.includes(idB)) return '횡재';
  if (a.frictionTypes && a.frictionTypes.includes(idB)) return '불협화음';
  const shared = (a.traits || []).filter(t => (b.traits || []).includes(t)).length;
  return shared >= 1 ? '벗' : '물음표';
}

async function main() {
  admin.initializeApp({ credential: buildCredential(), projectId: PROJECT_ID });
  const db = admin.firestore();

  const dogamSnap = await db.collection('dogam').get();
  console.log(`[migrate] dogam 문서 ${dogamSnap.size}개 확인`);

  let totalEntries = 0;
  let toUpdate = 0;
  let unresolved = 0; // characterId가 CHARACTER_DB에 없는 경우(GUNJA 등) — 자동 판단 불가
  const byOldLabel = {};      // 지금 저장된 값 기준 분포
  const transitions = {};     // "옛값→새값" 조합별 건수
  const pendingWrites = [];   // { ref, newRelation }

  for (const dogamDoc of dogamSnap.docs) {
    const owner = dogamDoc.data();
    const ownerCharacterId = owner.ownerCharacterId;
    const entriesSnap = await dogamDoc.ref.collection('entries').get();
    for (const entryDoc of entriesSnap.docs) {
      totalEntries++;
      const entry = entryDoc.data();
      const oldRelation = entry.relation || '(없음)';
      byOldLabel[oldRelation] = (byOldLabel[oldRelation] || 0) + 1;

      const newRelation = relationLabel(ownerCharacterId, entry.characterId);
      if (newRelation == null) {
        unresolved++;
        continue;
      }
      if (newRelation !== entry.relation) {
        toUpdate++;
        const key = `${oldRelation} → ${newRelation}`;
        transitions[key] = (transitions[key] || 0) + 1;
        pendingWrites.push({ ref: entryDoc.ref, newRelation });
      }
    }
  }

  console.log(`[migrate] entries 총 ${totalEntries}건 확인`);
  console.log('[migrate] 현재 저장된 relation 값 분포:', byOldLabel);
  console.log(`[migrate] 새 로직으로 재계산 시 값이 바뀌는 문서: ${toUpdate}건`);
  console.log('[migrate] 전환 내역(옛값→새값별 건수):', transitions);
  if (unresolved > 0) {
    console.log(`[migrate] ⚠️ characterId를 CHARACTER_DB에서 못 찾아 판단 못 한 문서: ${unresolved}건 — GUNJA(삭제된 유형)로 등록된 옛 데이터일 가능성, 수동 확인 필요`);
  }

  if (!APPLY) {
    console.log('\n[migrate] dry-run 모드라 실제로는 아무것도 안 바꿨어요. 위 내용 확인 후 --apply로 다시 실행하세요.');
    return;
  }

  console.log(`\n[migrate] --apply 지정됨 — ${pendingWrites.length}건 실제 업데이트 시작`);
  const BATCH_SIZE = 400; // Firestore batch 최대 500 한도 아래로 여유
  for (let i = 0; i < pendingWrites.length; i += BATCH_SIZE) {
    const batch = db.batch();
    pendingWrites.slice(i, i + BATCH_SIZE).forEach(({ ref, newRelation }) => {
      batch.update(ref, { relation: newRelation });
    });
    await batch.commit();
    console.log(`[migrate] ${Math.min(i + BATCH_SIZE, pendingWrites.length)}/${pendingWrites.length}건 커밋 완료`);
  }
  console.log('[migrate] 완료');
}

main().catch(e => {
  console.error('[migrate] 실패:', e);
  process.exit(1);
});
