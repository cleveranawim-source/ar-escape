/* 모든 ES 모듈의 문법을 검사한다. (실행하지 않고 파싱만)
   사용법: node tools/check.mjs                                 */
import { readdirSync, copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const jsDir = fileURLToPath(new URL('../js/', import.meta.url));
const tmp = mkdtempSync(join(tmpdir(), 'arescape-check-'));
let failed = 0;

for (const f of readdirSync(jsDir).filter(n => n.endsWith('.js')).sort()) {
  const copy = join(tmp, `${f.replace(/\.js$/, '')}.mjs`);
  copyFileSync(join(jsDir, f), copy);
  try {
    execFileSync(process.execPath, ['--check', copy], { stdio: 'pipe' });
    console.log(`OK   js/${f}`);
  } catch (e) {
    failed++;
    console.log(`FAIL js/${f}\n${String(e.stderr || e.message).trim()}\n`);
  }
}

rmSync(tmp, { recursive: true, force: true });
console.log(failed ? `\n${failed}개 파일에 문법 오류가 있습니다.` : '\n모든 모듈 문법 검사 통과.');
process.exit(failed ? 1 : 0);
