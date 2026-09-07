/* ============================================================
   샘플 방탈출 — "봉인된 과학실"
   마커 이미지를 즉석에서 그려서 시나리오를 구성한다.
   (바이너리 에셋 없이 바로 체험할 수 있게)
   ============================================================ */

import { newScenario, newTarget } from './model.js';
import { drawMarker } from './markers-draw.js';
import { scoreMarker } from './util.js';

const QUIZZES = [
  {
    name: '1번 단서 · 시약장',
    emoji: '⚗️',
    color: 'teal',
    reward: 'S',
    caption: '시약장의 잠금이 풀렸다.',
    quiz: {
      type: 'choice',
      question: '얼음이 녹아 물이 되고, 물이 끓어 수증기가 되었다.\n이 두 변화의 공통점은?',
      choices: [
        '물질의 종류가 바뀐다',
        '상태만 바뀌고 물질의 종류는 그대로다',
        '질량이 줄어든다',
        '새로운 물질이 만들어진다',
      ],
      answerIndex: 1,
      hint: '설탕이 물에 녹아도 여전히 설탕인 것처럼, 겉모습만 달라진 변화를 무엇이라 부를까?',
      explain: '상태 변화는 물리 변화입니다. 분자의 배열만 달라질 뿐 물질 자체는 그대로 H₂O 입니다.',
    },
  },
  {
    name: '2번 단서 · 화분',
    emoji: '🌿',
    color: 'lime',
    reward: 'P',
    caption: '잎맥 속에 다음 좌표가 숨어 있었다.',
    quiz: {
      type: 'short',
      question: '식물이 빛에너지를 이용해 이산화 탄소와 물로 양분을 만드는 과정을\n무엇이라고 하는가?',
      answer: '광합성|photosynthesis',
      hint: '엽록체에서 일어나며, 부산물로 산소가 나옵니다.',
      explain: '광합성: 6CO₂ + 6H₂O + 빛에너지 → C₆H₁₂O₆ + 6O₂',
    },
  },
  {
    name: '3번 단서 · 벽시계',
    emoji: '⏳',
    color: 'gold',
    reward: 'A',
    caption: '멈춰 있던 시계가 다시 움직인다.',
    quiz: {
      type: 'number',
      question: '실험실 수조에 1분에 12L씩 물이 채워진다.\n180L를 채우려면 몇 분이 걸리는가?',
      answer: '15',
      hint: '180 ÷ 12 을 계산해 보세요.',
      explain: '180 ÷ 12 = 15분입니다.',
    },
  },
  {
    name: '4번 단서 · 지도',
    emoji: '🧭',
    color: 'sky',
    reward: 'R',
    caption: '지도 위에 붉은 점이 떠올랐다.',
    quiz: {
      type: 'choice',
      question: '나침반의 N극이 가리키는 방향은 지구의 어느 쪽인가?',
      choices: ['지리상 북극 근처', '지리상 남극 근처', '적도', '방향과 무관하다'],
      answerIndex: 0,
      hint: '지구는 거대한 자석이며, 자석의 N극은 상대 자석의 S극에 끌립니다.',
      explain: '나침반 N극은 지리상 북극 쪽을 가리킵니다. 그곳에는 지구 자기장의 S극이 있습니다.',
    },
  },
  {
    name: '5번 단서 · 낡은 수첩',
    emoji: '📜',
    color: 'purple',
    reward: 'K',
    caption: '마지막 봉인이 풀렸다. 문으로 향하라.',
    quiz: {
      type: 'short',
      question: '수첩에 이런 글이 있다.\n"ㄱ→ㄴ, ㄴ→ㄷ 처럼 자음을 하나씩 미뤘다."\n암호 "ㅁㅜㄴ" 을 원래대로 되돌리면?',
      answer: '문|ㄹㅜㄱ|룩',
      hint: 'ㅁ의 바로 앞 자음은 ㄹ… 이 아니라, 규칙을 거꾸로 적용하면 ㅁ→ㄹ, ㄴ→ㄱ 입니다.',
      explain: '자음을 하나씩 앞으로 되돌리면 "룩"이 됩니다. 정답으로 "문"도 인정했습니다.',
    },
  },
];

export async function buildDemoScenario(onProgress = () => {}) {
  const sc = newScenario();
  sc.title = '봉인된 과학실';
  sc.story = [
    '방과 후 과학실에 남은 너희는 문이 잠긴 것을 알아차렸다.',
    '칠판에는 한 줄이 적혀 있다. — "다섯 개의 봉인을 풀어라."',
    '',
    '태블릿 카메라로 교실 곳곳의 단서를 비추면,',
    '봉인된 기록이 증강현실로 되살아난다.',
  ].join('\n');
  sc.timeLimitMin = 20;
  sc.hintPenaltySec = 30;
  sc.finalLock = {
    mode: 'auto',
    question: '문 옆 전자 자물쇠에 다섯 글자를 입력하라.',
    answer: '',
    hint: '단서 1번부터 5번까지, 얻은 글자를 순서대로 이어 붙여라.',
  };

  for (let i = 0; i < QUIZZES.length; i++) {
    const q = QUIZZES[i];
    onProgress(Math.round((i / QUIZZES.length) * 100), `${q.name} 준비 중…`);

    const cv = document.createElement('canvas');
    drawMarker(cv, {
      seed: 20260906 + i * 7919,
      label: String(i + 1),
      sub: '봉인된 과학실',
      palette: i,
    });
    const thumb = cv.toDataURL('image/jpeg', 0.88);

    const t = newTarget(i);
    t.name = q.name;
    t.thumb = thumb;
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
