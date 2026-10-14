/* ============================================================
   체험용 샘플 — 단서 3개로 흐름만 익힌다
   객관식 · 단답형(| 로 여러 답) · 답이 두 개인 문제(쉼표)를 하나씩 담았다.
   마커 이미지를 즉석에서 그려서 시나리오를 구성한다(바이너리 에셋 없이 바로 체험).

   예전 샘플은 「마음의 방」 이었는데, 실제 수업 방이 그 샘플로 만들어져
   문제·정답이 똑같았다. 홈 화면에서 누구나 샘플을 만들어 연습 모드로 풀거나
   스튜디오에서 열어 보면 수업 방의 답을 알 수 있었다. 그래서 샘플은 어떤 수업
   방과도 겹치지 않는 가벼운 문제로만 둔다. 수업용 방은 scenarios/ 에 따로 있다.
   ============================================================ */

import { newScenario, newTarget, colorHex } from './model.js';
import { drawMarker } from './markers-draw.js';
import { wrapText, roundRect, FONT } from './arcard.js';
import { scoreMarker } from './util.js';

/* 샘플용 "튀어나올 이미지" — 상황 카드를 즉석에서 그린다.
   답을 말해 주지 않고 장면만 던져서, 문제를 열기 전에 한 번 생각하게 만든다. */
function drawSceneCard(cv, o) {
  const W = cv.width = 600;
  const H = cv.height = 840;
  const ctx = cv.getContext('2d');
  const hex = colorHex(o.color);
  ctx.clearRect(0, 0, W, H);

  ctx.save();
  roundRect(ctx, 14, 14, W - 28, H - 28, 46);
  ctx.clip();
  const g = ctx.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, `${hex}cc`);
  g.addColorStop(0.55, '#141a2a');
  g.addColorStop(1, '#0b0f1a');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  const glow = ctx.createRadialGradient(W / 2, H * 0.36, 20, W / 2, H * 0.36, 330);
  glow.addColorStop(0, `${hex}77`);
  glow.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);
  ctx.restore();

  ctx.strokeStyle = hex;
  ctx.lineWidth = 6;
  roundRect(ctx, 14, 14, W - 28, H - 28, 46);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(255,255,255,.16)';
  ctx.lineWidth = 2;
  roundRect(ctx, 30, 30, W - 60, H - 60, 32);
  ctx.stroke();

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `230px ${FONT}`;
  ctx.fillText(o.emoji, W / 2, H * 0.36);

  ctx.fillStyle = '#ffffff';
  ctx.font = `900 46px ${FONT}`;
  ctx.fillText(o.title, W / 2, H * 0.64);

  ctx.fillStyle = 'rgba(220,232,242,.8)';
  ctx.font = `600 27px ${FONT}`;
  let y = H * 0.72;
  for (const line of wrapText(ctx, o.sub, W - 110, 3)) { ctx.fillText(line, W / 2, y); y += 38; }

  ctx.fillStyle = `${hex}33`;
  roundRect(ctx, 40, 40, 78, 78, 22);
  ctx.fill();
  ctx.fillStyle = hex;
  ctx.font = `900 40px ${FONT}`;
  ctx.fillText(String(o.n), 79, 80);
  return cv;
}

const QUIZZES = [
  {
    name: '1번 단서 · 객관식',
    emoji: '🔑',
    color: 'teal',
    reward: '출',
    scene: { title: '첫 번째 열쇠', sub: '사진을 비추면 이렇게 그림이 튀어나옵니다. 아래 「문제 보기」 를 눌러 보세요.' },
    caption: '첫 번째 열쇠를 찾았다.',
    quiz: {
      type: 'choice',
      question: '무지개 일곱 빛깔에서 빨강 바로 다음은 무슨 색일까?',
      choices: ['노랑', '주황', '초록', '파랑'],
      answerIndex: 1,
      hint: '빨·주·노·초·파·남·보',
      explain: '【객관식】 보기를 누르고 「제출」. 틀려도 다시 고를 수 있고, 세 번 틀리면 힌트가 저절로 열립니다(벌점 없음). 「힌트 보기」 를 직접 누르면 시간 벌점이 붙습니다.',
    },
  },
  {
    name: '2번 단서 · 단답형',
    emoji: '🗝️',
    color: 'gold',
    reward: '발',
    scene: { title: '두 번째 열쇠', sub: '이번에는 답을 직접 써서 푸는 문제입니다.' },
    caption: '두 번째 열쇠를 찾았다.',
    quiz: {
      type: 'short',
      question: '1년은 몇 달일까?',
      answer: '12|열두|열두달|12달|12개월',
      hint: '달력을 넘겨 보세요.',
      explain: '【단답형】 띄어쓰기·문장부호는 채점에서 무시합니다. 정답 칸에 「12|열두」 처럼 | 로 여러 답을 인정할 수 있어요 — | 는 「또는」 이라 그중 하나만 맞으면 정답입니다.',
    },
  },
  {
    name: '3번 단서 · 답이 두 개',
    emoji: '🔓',
    color: 'purple',
    reward: '!',
    scene: { title: '세 번째 열쇠', sub: '문제 두 개를 한 단서에 담을 수도 있습니다.' },
    caption: '마지막 열쇠를 찾았다.',
    quiz: {
      type: 'short',
      question: '문제 A  3 + 4 = ?\n문제 B  10 − 6 = ?',
      answer: '7,4',
      hint: 'A 의 답부터 차례로 쓰세요.',
      explain: '【답이 두 개일 때】 정답을 「7,4」 처럼 쉼표로 적으면 둘 다 맞아야 정답이고, 학생 답 칸에 「쉼표로 이어 쓰세요」 가 저절로 나옵니다. 「7|4」 로 적으면 하나만 써도 통과하니 주의하세요.',
    },
  },
];

export async function buildDemoScenario(onProgress = () => {}) {
  const sc = newScenario();
  sc.title = '체험용 샘플 — 열쇠 세 개';
  sc.story = [
    '처음 써 보는 선생님을 위한 3분 체험입니다.',
    '',
    '인쇄한 마커(또는 화면에 띄운 마커)를 카메라로 비추면 그림이 튀어나오고 문제가 열립니다.',
    '세 문제를 풀어 열쇠를 모으면 문이 열립니다.',
  ].join('\n');
  sc.timeLimitMin = 10;
  sc.hintPenaltySec = 10;
  sc.finalLock = {
    mode: 'auto',
    question: '세 개의 열쇠를 모두 모으면 문이 열린다.',
    answer: '',
    hint: '',
  };

  for (let i = 0; i < QUIZZES.length; i++) {
    const q = QUIZZES[i];
    onProgress(Math.round((i / QUIZZES.length) * 100), `${q.name} 준비 중…`);

    const cv = document.createElement('canvas');
    drawMarker(cv, {
      seed: 20260906 + i * 7919,
      label: String(i + 1),
      sub: '체험용 샘플',
      palette: i,
    });
    const thumb = cv.toDataURL('image/jpeg', 0.88);

    // 600×840 으로 그린 뒤 480×672 로 줄인다 — 투명 모서리를 살리려면 PNG 여야 하고,
    // 그 크기면 장당 300KB 안팎이라 내보내기 파일이 크게 불지 않는다.
    const scene = document.createElement('canvas');
    drawSceneCard(scene, { n: i + 1, emoji: q.emoji, color: q.color, ...q.scene });
    const small = document.createElement('canvas');
    small.width = 480; small.height = 672;
    small.getContext('2d').drawImage(scene, 0, 0, 480, 672);

    const t = newTarget(i);
    t.name = q.name;
    t.thumb = thumb;
    t.arImage = small.toDataURL('image/png');
    t.reward = q.reward;
    t.ar = { emoji: q.emoji, color: q.color, caption: q.caption };
    t.quiz = {
      type: q.quiz.type,
      question: q.quiz.question,
      choices: q.quiz.choices || ['', '', '', ''],
      answerIndex: q.quiz.answerIndex ?? 0,
      answer: q.quiz.answer || '',
      hint: q.quiz.hint || '',
      explain: q.quiz.explain || '',
    };
    t.score = (await scoreMarker(thumb)).score;
    sc.targets.push(t);
  }

  onProgress(100, '완료');
  return sc;
}
