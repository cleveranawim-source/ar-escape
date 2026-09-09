/* ============================================================
   시나리오 데이터 모델
   ============================================================

   Scenario {
     id, title, story, theme,
     timeLimitMin: number   // 0 이면 무제한
     hintPenaltySec: number
     finalLock: { mode: 'auto'|'manual', answer: string, question: string, hint: string }
     mind: { data: ArrayBuffer, count: number, compiledAt: ISO } | null
                            // 내보내기 파일과 예전 기록에서는 base64 문자열이다.
                            // 읽는 쪽은 mindBytes() / mindBuffer() 로 두 형태를 함께 다룬다.
     targets: [ Target ]
     createdAt, updatedAt, version
   }

   Target {
     id, name,
     thumb: dataURL      // 인식용 원본 축소본 (교사 확인 + 시뮬레이션 모드용)
     score: number       // 마커 적합도 0~100
     ar: { emoji, color, caption }   // 인식 시 공중에 뜨는 AR 카드
     arImage: dataURL|null           // 직접 올린 AR 이미지 (있으면 카드 대신 표시)
     quiz: {
       type: 'choice' | 'short' | 'number',
       question, choices: string[], answerIndex: number,
       answer: string, hint: string, explain: string
     }
     reward: string      // 정답 시 얻는 열쇠 조각 (보통 한 글자)
     bonus: boolean      // 보너스 단서 — 최종 암호·진행률·열쇠 보관함에서 제외되는 덤 문제
   }
   ============================================================ */

import { uid, normalizeAnswer, base64ToBuf, bufToBase64 } from './util.js';

export const SCHEMA_VERSION = 1;
export const FILE_KIND = 'ar-escape-room';

export const AR_COLORS = [
  { key: 'teal',   label: '청록', hex: '#43e8d8' },
  { key: 'gold',   label: '황금', hex: '#ffc94d' },
  { key: 'purple', label: '보라', hex: '#a78bfa' },
  { key: 'rose',   label: '장미', hex: '#ff6b8a' },
  { key: 'lime',   label: '라임', hex: '#84e04b' },
  { key: 'sky',    label: '하늘', hex: '#4dabff' },
];

export const AR_EMOJIS = ['🔑', '🗝️', '🔒', '💎', '📜', '🧭', '🕯️', '⚗️', '🧩', '⏳', '🪞', '🗺️', '📖', '⚙️', '🔮', '🦴'];

export const QUIZ_TYPES = [
  { key: 'choice', label: '객관식' },
  { key: 'short',  label: '단답형' },
  { key: 'number', label: '숫자' },
];

export function newQuiz(type = 'choice') {
  return {
    type,
    question: '',
    choices: ['', '', '', ''],
    answerIndex: 0,
    answer: '',
    hint: '',
    explain: '',
  };
}

export function newTarget(idx = 0) {
  return {
    id: uid('t'),
    name: `${idx + 1}번 단서`,
    thumb: null,
    score: 0,
    ar: {
      emoji: AR_EMOJIS[idx % AR_EMOJIS.length],
      color: AR_COLORS[idx % AR_COLORS.length].key,
      caption: '',
    },
    arImage: null,
    quiz: newQuiz('choice'),
    reward: '',
    bonus: false,
  };
}

export function newScenario() {
  return {
    id: uid('sc'),
    version: SCHEMA_VERSION,
    title: '이름 없는 방탈출',
    story: '교실 곳곳에 숨겨진 단서를 태블릿으로 비추면 봉인된 기록이 나타난다.\n모든 자물쇠를 풀고 최종 암호를 완성하라.',
    theme: 'lab',
    timeLimitMin: 20,
    hintPenaltySec: 30,
    finalLock: {
      mode: 'auto',
      question: '모은 열쇠 조각을 순서대로 합치면 최종 암호가 된다.',
      answer: '',
      hint: '획득한 순서가 아니라 단서 번호 순서대로 배열하라.',
    },
    mind: null,
    targets: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

/** 열쇠 조각을 단서 순서대로 이어붙인 최종 암호 */
export function computeFinalAnswer(scenario) {
  if (scenario.finalLock?.mode === 'manual') return scenario.finalLock.answer || '';
  return (scenario.targets || []).filter(t => !t.bonus).map(t => (t.reward || '').trim()).join('');
}

/** 특정 문제의 정답 판정 */
export function checkAnswer(target, input) {
  const q = target.quiz;
  if (q.type === 'choice') return Number(input) === Number(q.answerIndex);
  if (q.type === 'number') {
    const a = parseFloat(String(input).replace(/[^\d.\-]/g, ''));
    const b = parseFloat(String(q.answer).replace(/[^\d.\-]/g, ''));
    return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) < 1e-9;
  }
  // 단답형: | 로 구분된 복수 정답 허용
  const accepted = String(q.answer || '').split('|').map(normalizeAnswer).filter(Boolean);
  return accepted.includes(normalizeAnswer(input));
}

/** 정답 텍스트 (해설 화면용) */
export function answerText(target) {
  const q = target.quiz;
  if (q.type === 'choice') return q.choices?.[q.answerIndex] ?? '';
  return String(q.answer || '').split('|')[0];
}

export function colorHex(key) {
  return (AR_COLORS.find(c => c.key === key) || AR_COLORS[0]).hex;
}

/** 배포/플레이 전 무결성 검사 → 문제 목록 반환 */
export function validate(scenario) {
  const errors = [];
  const warns = [];

  if (!scenario.title?.trim()) errors.push('시나리오 제목이 비어 있습니다.');
  if (!scenario.targets?.length) errors.push('단서(타겟)를 하나 이상 추가하세요.');
  else if (!scenario.targets.some(t => !t.bonus)) errors.push('보너스가 아닌 단서가 하나 이상 있어야 탈출할 수 있습니다.');

  scenario.targets?.forEach((t, i) => {
    const tag = `${i + 1}번 단서`;
    if (!t.thumb) errors.push(`${tag}: 인식할 이미지가 없습니다.`);
    if (!t.quiz.question?.trim()) errors.push(`${tag}: 문제 내용이 비어 있습니다.`);
    if (t.quiz.type === 'choice') {
      const filled = t.quiz.choices.filter(c => c.trim()).length;
      if (filled < 2) errors.push(`${tag}: 객관식 보기를 2개 이상 입력하세요.`);
      if (!t.quiz.choices[t.quiz.answerIndex]?.trim()) errors.push(`${tag}: 정답으로 지정된 보기가 비어 있습니다.`);
    } else if (!String(t.quiz.answer).trim()) {
      errors.push(`${tag}: 정답을 입력하세요.`);
    }
    if (!t.bonus && !t.reward?.trim() && scenario.finalLock.mode === 'auto') {
      errors.push(`${tag}: 열쇠 조각이 비어 있습니다. (최종 암호 자동 조합에 필요)`);
    }
    if (t.score && t.score < 34) warns.push(`${tag}: 이미지 인식 점수가 낮습니다(${t.score}점). 무늬가 많은 이미지를 권장합니다.`);
    if (!t.quiz.hint?.trim()) warns.push(`${tag}: 힌트가 없습니다.`);
  });

  if (!scenario.mind) {
    warns.push('AR 타겟이 아직 컴파일되지 않았습니다. 카메라 없이 시뮬레이션 모드로만 플레이됩니다.');
  } else if (scenario.mind.count !== scenario.targets.length) {
    errors.push(`컴파일된 타겟 수(${scenario.mind.count})와 단서 수(${scenario.targets.length})가 다릅니다. 다시 컴파일하세요.`);
  }

  if (!computeFinalAnswer(scenario).trim()) errors.push('최종 암호가 비어 있습니다.');

  return { ok: errors.length === 0, errors, warns };
}

/** 컴파일된 .mind 의 실제 바이트 수 */
export function mindBytes(scenario) {
  const d = scenario?.mind?.data;
  if (!d) return 0;
  return typeof d === 'string' ? Math.floor(d.length * 0.75) : d.byteLength;
}

/** .mind 를 항상 ArrayBuffer 로 — 예전 기록의 base64 도 받아 준다 */
export function mindBuffer(scenario) {
  const d = scenario?.mind?.data;
  if (!d) return null;
  return typeof d === 'string' ? base64ToBuf(d) : d;
}

/** 알 수 없는 버전/누락 필드 보정 */
export function migrate(raw) {
  const base = newScenario();
  const s = { ...base, ...raw };
  s.finalLock = { ...base.finalLock, ...(raw.finalLock || {}) };
  s.targets = (raw.targets || []).map((t, i) => {
    const bt = newTarget(i);
    const merged = { ...bt, ...t };
    merged.ar = { ...bt.ar, ...(t.ar || {}) };
    merged.quiz = { ...newQuiz(), ...(t.quiz || {}) };
    if (!Array.isArray(merged.quiz.choices)) merged.quiz.choices = ['', '', '', ''];
    while (merged.quiz.choices.length < 2) merged.quiz.choices.push('');
    merged.bonus = !!merged.bonus;
    return merged;
  });
  s.version = SCHEMA_VERSION;
  return s;
}

/** 내보내기용 봉투 — JSON 으로 나가야 하므로 mind 만 base64 로 되돌린다 */
export function toFile(scenario) {
  const sc = { ...scenario };
  if (sc.mind?.data && typeof sc.mind.data !== 'string') {
    sc.mind = { ...sc.mind, data: bufToBase64(sc.mind.data) };
  }
  return {
    kind: FILE_KIND,
    version: SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    scenario: sc,
  };
}

export function fromFile(json) {
  const obj = typeof json === 'string' ? JSON.parse(json) : json;
  const raw = obj?.kind === FILE_KIND ? obj.scenario : obj;
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.targets)) {
    throw new Error('AR 방탈출 시나리오 파일이 아닙니다.');
  }
  return migrate(raw);
}
