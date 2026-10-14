/* ============================================================
   정답 봉인 — 배포하는 방 파일에 정답·해설을 그대로 두지 않는다
   ------------------------------------------------------------
   방 파일(scenarios/*.json)은 공개 주소라 누구나 열어 볼 수 있다.
   그래서 올리기 전에 각 문제의 정답과 해설을 이렇게 바꿔 둔다.

     정답(정규화) ─ PBKDF2(소금, 반복 N) ─┬─ 앞 32바이트 → 확인값 (파일에 남김)
                                          └─ 뒤 32바이트 → 열쇠  → 해설·정답 표시를 AES-GCM 으로 잠금

   학생이 맞는 답을 쓰면 같은 열쇠가 만들어져 확인값이 맞고 잠긴 해설이 열린다.
   파일만 봐서는 답을 알 수 없고, 답을 하나씩 넣어 보는 데 한 번에 0.1초쯤 든다.
   (채점이 학생 기기에서 일어나는 한 완전히 막을 수는 없다 — 문을 높이는 것)

   힌트는 풀기 전에 보라고 있는 것이라 봉인하지 않는다.
   이 파일은 브라우저와 Node(tools/seal.mjs) 양쪽에서 쓴다 — DOM 을 쓰지 않는다.
   ============================================================ */

import { normalizeAnswer, bufToBase64, base64ToBuf } from './util.js';

export const SEAL_ITERATIONS = 100000;
const enc = new TextEncoder();
const dec = new TextDecoder();

/** 학생 입력(또는 정답)을 열쇠 재료로 — 채점 규칙과 똑같이 정규화한다 */
export function secretOf(quiz, input) {
  if (quiz.type === 'choice') return Number.isInteger(Number(input)) && String(input) !== '' ? `#${Number(input)}` : '';
  if (quiz.type === 'number') {
    const n = parseFloat(String(input).replace(/[^\d.\-]/g, ''));
    return Number.isFinite(n) ? `=${n}` : '';
  }
  return normalizeAnswer(input);
}

async function derive(secret, saltB64, iterations) {
  const base = await crypto.subtle.importKey('raw', enc.encode(secret), 'PBKDF2', false, ['deriveBits']);
  const bits = new Uint8Array(await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: new Uint8Array(base64ToBuf(saltB64)), iterations }, base, 512));
  return { check: bufToBase64(bits.slice(0, 32)), key: bits.slice(32) };
}

/** 문제 하나를 봉인한 사본을 돌려준다 (정답·정답번호·해설은 지운다) */
export async function sealQuiz(quiz, iterations = SEAL_ITERATIONS) {
  let secrets, shown;
  if (quiz.type === 'choice') {
    secrets = [secretOf(quiz, quiz.answerIndex)];
    shown = quiz.choices?.[quiz.answerIndex] ?? '';
  } else if (quiz.type === 'number') {
    secrets = [secretOf(quiz, quiz.answer)];
    shown = String(quiz.answer ?? '').trim();
  } else {
    const raw = String(quiz.answer ?? '').split('|').map(s => s.trim()).filter(Boolean);
    secrets = [...new Set(raw.map(normalizeAnswer).filter(Boolean))];
    shown = raw[0] ?? '';
  }
  if (!secrets.length || secrets.some(s => !s)) throw new Error('정답이 비어 있는 문제는 봉인할 수 없습니다.');

  const salt = bufToBase64(crypto.getRandomValues(new Uint8Array(16)));
  const box = enc.encode(JSON.stringify({ answer: shown, explain: quiz.explain || '' }));
  const keys = [];
  for (const secret of secrets) {
    const { check, key } = await derive(secret, salt, iterations);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const k = await crypto.subtle.importKey('raw', key, 'AES-GCM', false, ['encrypt']);
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, k, box);
    keys.push({ c: check, iv: bufToBase64(iv), ct: bufToBase64(ct) });
  }
  // 몇 번째가 대표 정답인지도 드러나지 않게 섞는다
  for (let i = keys.length - 1; i > 0; i--) {
    const j = crypto.getRandomValues(new Uint32Array(1))[0] % (i + 1);
    [keys[i], keys[j]] = [keys[j], keys[i]];
  }
  // 답의 생김새만 남긴다 — 「숫자 2개를 쉼표로」 같은 답 칸 안내용. 문제에 이미 「문제 A·B」 로 드러나 있는 정도다.
  const parts = quiz.type === 'short' ? (raw => raw.split(/[,，]/).map(x => x.trim()).filter(Boolean))(String(quiz.answer ?? '').split('|')[0]) : [];
  const form = parts.length >= 2 ? { parts: parts.length, numeric: parts.every(x => /^-?[\d.]+$/.test(x)) } : null;
  return { ...quiz, answer: '', answerIndex: -1, explain: '', sealed: { v: 1, it: iterations, salt, keys, ...(form ? { form } : {}) } };
}

/** 맞으면 { answer, explain } (정답 표시·해설), 틀리면 null */
export async function openSealed(quiz, input) {
  const s = quiz.sealed;
  const secret = secretOf(quiz, input);
  if (!s || !secret) return null;
  const { check, key } = await derive(secret, s.salt, s.it);
  const hit = s.keys.find(k => k.c === check);
  if (!hit) return null;
  const k = await crypto.subtle.importKey('raw', key, 'AES-GCM', false, ['decrypt']);
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: new Uint8Array(base64ToBuf(hit.iv)) }, k, base64ToBuf(hit.ct));
  return JSON.parse(dec.decode(pt));
}
