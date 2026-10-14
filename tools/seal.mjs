#!/usr/bin/env node
/* 방 파일의 정답·해설을 봉인한다 — 배포 전에 꼭 거친다.
 *
 *   node tools/seal.mjs <스튜디오에서 내보낸 원본.json> <scenarios/올릴이름.json>
 *
 * 원본은 공개 저장소 밖에 두고, 봉인한 것만 scenarios/ 에 올린다.
 * 봉인한 뒤 모든 정답이 열리는지, 틀린 답은 안 열리는지, 파일에 정답·해설 글자가
 * 남지 않았는지 스스로 확인하고, 하나라도 어긋나면 파일을 쓰지 않는다. */
import { readFile, writeFile } from 'node:fs/promises';
import { sealQuiz, openSealed } from '../js/seal.js';

const [src, out] = process.argv.slice(2);
if (!src || !out) { console.error('사용법: node tools/seal.mjs <원본.json> <봉인본.json>'); process.exit(1); }

const env = JSON.parse(await readFile(src, 'utf8'));
const sc = env.scenario ?? env;
if (sc.targets.some(t => t.quiz?.sealed)) { console.error('이미 봉인된 파일입니다.'); process.exit(1); }

const plain = structuredClone(sc.targets.map(t => t.quiz));
for (const t of sc.targets) t.quiz = await sealQuiz(t.quiz);

// ── 스스로 확인
const text = JSON.stringify(env);
let bad = 0;
const fail = m => { console.error('  ✗', m); bad++; };
for (const [i, t] of sc.targets.entries()) {
  const q = plain[i], tag = `${i + 1}번 ${t.name}`;
  const rights = q.type === 'choice' ? [q.answerIndex]
    : q.type === 'number' ? [q.answer] : String(q.answer).split('|').map(s => s.trim()).filter(Boolean);
  for (const r of rights) if (!(await openSealed(t.quiz, r))) fail(`${tag}: 정답 「${r}」 로 열리지 않음`);
  const wrongs = q.type === 'choice' ? q.choices.map((_, k) => k).filter(k => k !== q.answerIndex) : ['', '0', '틀린답'];
  for (const w of wrongs) if (await openSealed(t.quiz, w)) fail(`${tag}: 틀린 답 「${w}」 로 열림`);
  const box = await openSealed(t.quiz, rights[0]);
  if (box && box.explain !== (q.explain || '')) fail(`${tag}: 해설이 원본과 다름`);
  // 파일에 정답·해설 글자가 남았나 (객관식 보기는 원래 보여 주는 것이라 제외)
  if (q.explain?.trim() && text.includes(JSON.stringify(q.explain).slice(1, -1))) fail(`${tag}: 해설이 파일에 남음`);
  if (q.type !== 'choice') {
    for (const r of rights) {
      if (text.includes(`"answer":"${r}"`) || text.includes(`"answer": "${r}"`)) fail(`${tag}: 정답 「${r}」 가 파일에 남음`);
    }
  }
  if (t.quiz.answerIndex !== -1) fail(`${tag}: 정답 번호가 남음`);
  console.log(`  ✓ ${tag} — 정답 ${rights.length}개 · 열쇠 ${t.quiz.sealed.keys.length}개`);
}
if (bad) { console.error(`봉인 확인 실패 ${bad}건 — 파일을 쓰지 않았습니다.`); process.exit(1); }
await writeFile(out, JSON.stringify(env, null, 2));
console.log(`봉인 완료 → ${out}`);
