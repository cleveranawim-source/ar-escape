/* ============================================================
   샘플 방탈출 — "마음의 방" (사회정서학습 / SEL)
   CASEL 5역량을 자물쇠 하나씩에 배치했다.
     1 자기 인식 · 2 자기 관리 · 3 사회적 인식
     4 관계 기술 · 5 책임 있는 의사결정
   마커 이미지를 즉석에서 그려서 시나리오를 구성한다.
   (바이너리 에셋 없이 바로 체험할 수 있게)
   ============================================================ */

import { newScenario, newTarget } from './model.js';
import { drawMarker } from './markers-draw.js';
import { scoreMarker } from './util.js';

const QUIZZES = [
  {
    name: '1번 단서 · 거울',
    emoji: '🪞',
    color: 'teal',
    reward: '마',
    caption: '거울 속 내 표정에 이름이 붙었다.',
    quiz: {
      type: 'choice',
      question: '성적표를 받은 뒤 가슴이 답답하고 얼굴이 화끈거린다.\n친구가 말을 걸어도 대답하기가 싫다.\n지금 내 상태를 가장 잘 설명한 것은?',
      choices: [
        '나는 원래 이런 사람이다',
        '실망과 부끄러움이 몸으로 나타나고 있다',
        '몸이 아픈 것이니 쉬면 낫는다',
        '아무 감정도 느끼지 않는다',
      ],
      answerIndex: 1,
      hint: '감정은 생각보다 먼저 몸에 나타납니다. 지금 가슴·얼굴·어깨에서 무엇이 느껴지나요?',
      explain: '【자기 인식】 감정에 이름을 붙이는 것만으로도 흥분이 가라앉습니다. "짜증나"에서 멈추지 말고 실망인지, 부끄러움인지, 서운함인지까지 찾아보세요.',
    },
  },
  {
    name: '2번 단서 · 모래시계',
    emoji: '⏳',
    color: 'sky',
    reward: '음',
    caption: '모래가 멈추고, 숨이 돌아왔다.',
    quiz: {
      type: 'choice',
      question: '단톡방에서 나를 저격하는 것 같은 글을 봤다.\n손이 떨리고 당장 받아치고 싶다.\n지금 나에게 가장 도움이 되는 행동은?',
      choices: [
        '더 세게 받아쳐서 기선을 제압한다',
        '휴대폰을 내려놓고 열까지 세며 숨을 고른 뒤 다시 본다',
        '아무렇지 않은 척 계속 스크롤한다',
        '단톡방을 나가고 아무에게도 말하지 않은 채 혼자 삭인다',
      ],
      answerIndex: 1,
      hint: '화가 난 순간의 몸은 "싸울 준비" 상태입니다. 그 상태에서 보낸 말은 대개 되돌리고 싶어집니다.',
      explain: '【자기 관리】 감정이 솟구쳐도 6초만 지나면 충동은 크게 줄어듭니다. 참는 것이 아니라 반응 속도를 늦추는 것입니다. 멈춤 → 호흡 → 다시 보기.',
    },
  },
  {
    name: '3번 단서 · 나침반',
    emoji: '🧭',
    color: 'lime',
    reward: '의',
    caption: '나침반이 상대방 쪽으로 돌아섰다.',
    quiz: {
      type: 'choice',
      question: '늘 밝게 인사하던 친구가 요즘 나를 못 본 척 지나간다.\n나를 싫어하게 된 걸까?',
      choices: [
        '나를 싫어하는 게 확실하니 나도 인사하지 않는다',
        '다른 친구들에게 그 아이가 왜 그러는지 먼저 물어본다',
        '아직 이유를 모른다고 생각하고, 직접 안부를 묻는다',
        '신경 쓰지 않고 없는 사람처럼 지낸다',
      ],
      answerIndex: 2,
      hint: '내가 실제로 아는 것은 "인사하지 않았다"는 행동 하나뿐입니다. 나머지는 아직 추측입니다.',
      explain: '【사회적 인식】 상대의 행동을 곧바로 나에 대한 감정으로 해석하는 것을 개인화라고 합니다. 사실과 추측을 나누는 순간 공감이 시작됩니다.',
    },
  },
  {
    name: '4번 단서 · 퍼즐 조각',
    emoji: '🧩',
    color: 'rose',
    reward: '열',
    caption: '흩어져 있던 조각이 맞물렸다.',
    quiz: {
      type: 'short',
      question: '모둠 과제에서 한 친구가 계속 늦는다.\n"너는 왜 맨날 늦어?" 대신,\n내 감정과 상황을 주어로 말하는 대화법을 무엇이라 할까?',
      answer: '나전달법|나 전달법|나를 주어로 말하기|아이메시지|i-message',
      hint: '문장을 "너는…"이 아니라 "나는…"으로 시작해 보세요.',
      explain: '【관계 기술】 "나는 발표 준비가 늦어질까 봐 걱정돼"라고 말하면 상대가 방어하지 않고 듣습니다. 비난이 부탁으로 바뀌는 말하기입니다.',
    },
  },
  {
    name: '5번 단서 · 수정 구슬',
    emoji: '🔮',
    color: 'purple',
    reward: '쇠',
    caption: '구슬 속에 내일의 내가 비쳤다. 문으로 향하라.',
    quiz: {
      type: 'choice',
      question: '친구가 시험 답을 알려 달라고 한다.\n거절하면 사이가 나빠질 것 같다.\n결정을 내리기 전에 가장 먼저 확인해야 할 것은?',
      choices: [
        '다른 친구들은 이럴 때 어떻게 하는지',
        '선생님이 알아챌 가능성이 얼마나 되는지',
        '이 선택이 나와 친구에게 어떤 결과를 남기는지',
        '거절했을 때 내가 얼마나 욕을 먹을지',
      ],
      answerIndex: 2,
      hint: '"들키느냐"가 아니라 "무엇을 남기느냐"를 묻는 질문입니다.',
      explain: '【책임 있는 의사결정】 결과·상대·나의 기준을 함께 봅니다. 거절도 관계를 지키는 방법이 될 수 있습니다 — "그건 못 해. 대신 같이 공부하자."',
    },
  },
];

export async function buildDemoScenario(onProgress = () => {}) {
  const sc = newScenario();
  sc.title = '마음의 방';
  sc.story = [
    '방과 후 교실. 문이 잠겼고 칠판에 한 줄이 적혀 있다.',
    '— "이 문은 열쇠가 아니라 마음으로 열린다."',
    '',
    '태블릿 카메라로 교실 곳곳의 단서를 비추면,',
    '누군가 두고 간 마음의 기록이 증강현실로 떠오른다.',
    '다섯 개의 자물쇠를 풀고 마음의 열쇠를 완성하라.',
  ].join('\n');
  sc.timeLimitMin = 25;
  sc.hintPenaltySec = 20;
  sc.finalLock = {
    mode: 'auto',
    question: '문 옆 자물쇠에 다섯 글자를 입력하라.',
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
      sub: '마음의 방',
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
