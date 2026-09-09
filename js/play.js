/* ============================================================
   학생 플레이 — AR 방탈출 진행 로직
   ============================================================ */

import {
  $, el, toast, modal, confirmDialog, fmtClock, pickFile, readFileAsText,
  normalizeAnswer, beep, vibrate,
} from './util.js';
import { fromFile, checkAnswer, answerText, computeFinalAnswer, colorHex, mindBuffer } from './model.js';
import {
  getScenario, recallLast, rememberTeam, recallTeam,
  loadProgress, saveProgress, clearProgress, addRecord, listRecords,
} from './store.js';
import { ArEngine, loadArRuntime, normalizeCameraError } from './ar.js';

/* ============================================================
   상태
   ============================================================ */
const S = {
  scenario: null,
  progress: null,     // { team, startedAt, penaltyMs, solved:{}, finished, escaped, elapsedMs }
  engine: null,
  mode: null,         // 'ar' | 'sim'
  mindUrl: null,
  timerId: null,
  openTarget: null,   // 현재 시트에 열린 타겟 index
  finalOpen: false,
  pending: null,      // 인식됐지만 아직 "문제 보기"를 누르지 않은 타겟 index
  pendingTimer: null,
  timeUpHandled: false,
};

const isSolved = t => !!S.progress?.solved[t.id];
/* 보너스 단서는 탈출 조건·진행률·열쇠 보관함에서 뺀다. 덤으로 푸는 별개 문제이므로. */
const requiredTargets = () => (S.scenario?.targets || []).filter(t => !t.bonus);
const totalCount = () => requiredTargets().length;
const solvedCount = () => requiredTargets().filter(isSolved).length;

/* 벌점 포함 경과 시간 */
function elapsedMs() {
  if (!S.progress) return 0;
  if (S.progress.finished) return S.progress.elapsedMs || 0;
  return Date.now() - S.progress.startedAt + (S.progress.penaltyMs || 0);
}

function remainingMs() {
  const limit = (S.scenario?.timeLimitMin || 0) * 60000;
  return limit ? limit - elapsedMs() : Infinity;
}

/* ============================================================
   부트스트랩 — 시나리오 로드
   ============================================================ */

async function boot() {
  const params = new URLSearchParams(location.search);
  const src = params.get('src');
  const id = params.get('id');

  try {
    if (src) {
      setLoad(`시나리오 파일을 내려받는 중…`, 50);
      const res = await fetch(src, { cache: 'no-cache' });
      if (!res.ok) throw new Error(`파일을 찾을 수 없습니다 (${res.status})`);
      S.scenario = fromFile(await res.json());
    } else if (id) {
      setLoad('저장된 시나리오를 여는 중…', 60);
      const sc = await getScenario(id);
      if (!sc) throw new Error('이 기기에 저장된 시나리오가 없습니다.');
      S.scenario = sc;
    } else {
      const last = recallLast();
      const sc = last ? await getScenario(last) : null;
      if (!sc) { showNoScenario(); return; }
      S.scenario = sc;
    }
  } catch (err) {
    showNoScenario(err.message);
    return;
  }

  const bad = unplayableReason(S.scenario);
  if (bad) { showNoScenario(bad); return; }

  setLoad('준비 완료', 100);
  showStart();
}

/** 아예 클리어가 불가능한 시나리오를 학생 기기에서 미리 걸러낸다 */
function unplayableReason(sc) {
  if (!sc.targets?.length) return '이 방탈출에는 단서가 하나도 없습니다. 선생님께 알려 주세요.';
  if (!sc.targets.some(t => !t.bonus)) return '보너스 단서만 있어 탈출 조건이 없습니다. 선생님께 알려 주세요.';
  if (!computeFinalAnswer(sc).trim()) {
    return '최종 암호가 비어 있어 탈출할 수 없습니다. 제작 스튜디오에서 열쇠 조각을 채워야 합니다.';
  }
  return null;
}

function setLoad(msg, pct) {
  $('#load-msg').textContent = msg;
  $('#load-bar').style.width = `${pct}%`;
}

function showNoScenario(reason) {
  setLoad(reason || '플레이할 시나리오가 없습니다.', 100);
  $('#load-bar').parentElement.hidden = true;
  const box = $('#load-actions');
  box.innerHTML = '';
  box.append(
    el('button', {
      class: 'btn btn-primary btn-block',
      onclick: async () => {
        const f = await pickFile('.json,application/json');
        if (!f) return;
        try {
          S.scenario = fromFile(await readFileAsText(f));
          $('#screen-load').hidden = true;
          showStart();
        } catch (e) { toast(e.message, 'err'); }
      },
    }, ['📂 시나리오 파일 열기']),
    el('a', { class: 'btn btn-ghost btn-block', href: 'index.html' }, ['처음 화면으로']),
    el('a', { class: 'btn btn-ghost btn-block', href: 'admin.html' }, ['🛠 문제 만들러 가기']),
  );
}

/* ============================================================
   시작 화면
   ============================================================ */

function showStart() {
  const sc = S.scenario;
  $('#screen-load').hidden = true;
  $('#screen-start').hidden = false;

  $('#s-title').textContent = sc.title;
  $('#s-story').textContent = sc.story || '';
  $('#s-team').value = recallTeam();

  const meta = $('#s-meta');
  meta.innerHTML = '';
  const bonusN = sc.targets.filter(t => t.bonus).length;
  meta.append(
    el('span', { class: 'badge' }, [`🔒 자물쇠 ${sc.targets.length - bonusN}개`]),
    bonusN ? el('span', { class: 'badge' }, [`🎁 보너스 ${bonusN}개`]) : null,
    el('span', { class: 'badge gold' }, [sc.timeLimitMin ? `⏳ 제한 ${sc.timeLimitMin}분` : '⏳ 시간 무제한']),
    sc.mind
      ? el('span', { class: 'badge ok' }, ['📷 AR 준비됨'])
      : el('span', { class: 'badge danger' }, ['📷 AR 타겟 없음']),
  );

  const goBtn = $('#s-go');
  if (!sc.mind) {
    goBtn.disabled = true;
    goBtn.textContent = 'AR 타겟이 컴파일되지 않았습니다';
  }
  goBtn.onclick = () => startGame('ar');
  $('#s-sim').onclick = () => startGame('sim');

  // 이어하기
  const saved = loadProgress(sc.id);
  const resume = $('#s-resume');
  resume.innerHTML = '';
  if (saved && !saved.finished && Object.keys(saved.solved || {}).length) {
    resume.append(el('div', { class: 'card', style: { padding: '14px' } }, [
      el('div', { class: 'row spread' }, [
        el('div', {}, [
          el('div', { class: 'small', style: { fontWeight: '800' } }, [`이어하기: ${saved.team || '이름 없음'}`]),
          el('div', { class: 'tiny dim' }, [`${Object.keys(saved.solved).length}/${sc.targets.length}개 해제됨`]),
        ]),
        el('div', { class: 'row' }, [
          el('button', {
            class: 'btn btn-sm btn-ghost',
            onclick: async () => {
              if (await confirmDialog('진행 초기화', '저장된 진행 상황을 지울까요?', { okLabel: '지우기', danger: true })) {
                clearProgress(sc.id);
                resume.innerHTML = '';
                toast('초기화했습니다.');
              }
            },
          }, ['초기화']),
          el('button', {
            class: 'btn btn-sm btn-primary',
            onclick: () => startGame(sc.mind ? 'ar' : 'sim', saved),
          }, ['이어하기']),
        ]),
      ]),
    ]));
  }
}

/* ============================================================
   게임 시작
   ============================================================ */

async function startGame(mode, resumeProgress = null) {
  const team = $('#s-team').value.trim() || '이름 없는 모둠';
  rememberTeam(team);

  S.mode = mode;
  S.timeUpHandled = false;

  if (resumeProgress) {
    // pausedElapsedMs 는 penaltyMs 를 이미 포함한 '총 경과 시간'이다.
    // 여기에 penaltyMs 를 또 더하면 이어할 때마다 벌점이 이중으로 쌓인다.
    S.progress = {
      ...resumeProgress,
      startedAt: Date.now(),
      penaltyMs: resumeProgress.pausedElapsedMs ?? resumeProgress.penaltyMs ?? 0,
      finished: false,
    };
  } else {
    S.progress = {
      team,
      startedAt: Date.now(),
      penaltyMs: 0,
      solved: {},
      hintsUsed: 0,
      finished: false,
      escaped: false,
    };
  }
  persist();

  $('#screen-start').hidden = true;
  beep('found');

  if (mode === 'sim') {
    startSim();
  } else {
    await startAr();
  }
  startTimer();
}

function persist() {
  if (!S.scenario || !S.progress) return;
  saveProgress(S.scenario.id, {
    ...S.progress,
    pausedElapsedMs: S.progress.finished ? 0 : elapsedMs(),
  });
}

/* ---------------- AR 모드 ---------------- */

async function startAr() {
  const sc = S.scenario;
  $('#screen-load').hidden = false;
  $('#load-actions').innerHTML = '';
  $('#load-bar').parentElement.hidden = false;
  setLoad('AR 엔진을 불러오는 중…', 25);

  try {
    await loadArRuntime();
    setLoad('카메라를 준비하는 중…', 60);

    S.mindUrl = URL.createObjectURL(new Blob([mindBuffer(sc)], { type: 'application/octet-stream' }));

    S.engine = new ArEngine($('#ar-root'), {
      onFound: onTargetFound,
      onLost: onTargetLost,
      onError: err => {
        $('#screen-load').hidden = true;
        showCameraError(normalizeCameraError(err));
      },
    });

    refreshArCards();
    await S.engine.start(S.mindUrl, sc.targets);

    $('#screen-load').hidden = true;
    $('#hud').hidden = false;
    $('#reticle').hidden = false;
    bindHud();
    updateHud();
    toast('단서 사진을 비춰 보세요', '', 3200);
  } catch (err) {
    $('#screen-load').hidden = true;
    showCameraError(normalizeCameraError(err));
  }
}

function showCameraError(err) {
  modal((box, close) => {
    box.append(
      el('h3', {}, ['📷 카메라를 시작할 수 없습니다']),
      el('p', { class: 'muted' }, [err.message]),
      el('div', { class: 'stack', style: { marginTop: '18px' } }, [
        el('button', {
          class: 'btn btn-primary btn-block',
          onclick: () => { close(); location.reload(); },
        }, ['다시 시도']),
        el('button', {
          class: 'btn btn-block',
          onclick: () => { close(); S.mode = 'sim'; startSim(); },
        }, ['연습 모드로 계속하기']),
      ]),
    );
  }, { closeOnBackdrop: false });
}

/** 모든 타겟의 AR 카드 내용을 현재 진행 상황에 맞게 갱신 */
function refreshArCards() {
  if (!S.engine) return;
  S.scenario.targets.forEach((t, i) => {
    S.engine.setCard(i, cardDataFor(t));
  });
}

function cardDataFor(t) {
  const done = isSolved(t);
  return {
    state: done ? 'solved' : 'quiz',
    title: t.name,
    body: done
      ? (t.ar.caption || '봉인이 해제되었다.')
      : (t.quiz.question || ''),
    emoji: t.ar.emoji,
    color: t.ar.color,
    badge: done ? '해제됨' : (t.bonus ? '보너스' : '잠김'),
    reward: done ? (t.bonus ? '🎁 보너스 성공' : t.reward) : '',
    rewardLabel: t.bonus ? '덤 문제' : '',
    footer: done ? '' : '아래 창에서 답을 입력하세요',
  };
}

function onTargetFound(index) {
  const t = S.scenario.targets[index];
  if (!t) return;
  // 이미 문제창이 열려 있으면 건드리지 않는다.
  // (마커를 나란히 붙였을 때, 답을 입력하던 중 카메라가 옆 마커를 잡아
  //  풀던 문제가 통째로 교체되는 것을 막는다)
  if (S.openTarget !== null || S.finalOpen) return;
  $('#reticle').hidden = true;
  $('#scan-hint').hidden = true;
  vibrate(30);
  beep(isSolved(t) ? 'tick' : 'found');
  showFoundBar(index);
}

/* 인식 즉시 문제창을 열지 않는다. 먼저 사진에서 튀어나온 이미지를 보게 하고,
   학생이 "문제 보기"를 눌러야 시트가 열린다. 곧바로 2D 폼이 화면을 덮어 버리면
   카메라를 볼 이유가 없어져 QR 코드와 다를 게 없어진다. */
function showFoundBar(index) {
  const t = S.scenario.targets[index];
  clearTimeout(S.pendingTimer);
  S.pending = index;
  const done = isSolved(t);
  $('#found-name').textContent = `${t.ar.emoji} ${t.name}`;
  $('#found-sub').textContent = done
    ? (t.ar.caption?.trim() || '이미 해제한 단서입니다')
    : (t.bonus ? '🎁 보너스 단서 — 탈출과는 별개인 덤 문제' : '튀어나온 이미지를 살펴본 뒤 문제를 여세요');
  $('#found-open').hidden = done;
  $('#found-bar').hidden = false;
  if (done) S.pendingTimer = setTimeout(hideFoundBar, 3000);
}

function hideFoundBar() {
  clearTimeout(S.pendingTimer);
  S.pending = null;
  $('#found-bar').hidden = true;
  if (S.mode === 'ar' && S.openTarget === null && !S.finalOpen) {
    $('#reticle').hidden = false;
    $('#scan-hint').hidden = false;
  }
}

function onTargetLost(index) {
  // 시트는 일부러 유지한다. 학생이 태블릿을 내려놓고 답을 입력할 수 있어야 하므로.
  // 발견 안내도 몇 초는 남긴다 — 태블릿을 내리면서 "문제 보기"를 누를 수 있게.
  if (S.pending === index && S.openTarget === null && !S.finalOpen) {
    clearTimeout(S.pendingTimer);
    S.pendingTimer = setTimeout(hideFoundBar, 5000);
    return;
  }
  if (!S.engine?.isActive?.(index) && S.openTarget === null && !S.finalOpen && S.pending === null) {
    $('#reticle').hidden = false;
    $('#scan-hint').hidden = false;
  }
}

/* ---------------- 연습(시뮬레이션) 모드 ---------------- */

function startSim() {
  $('#screen-start').hidden = true;
  $('#screen-load').hidden = true;
  $('#screen-sim').hidden = false;
  $('#hud').hidden = true;
  $('#reticle').hidden = true;

  $('#sim-exit').onclick = () => quitGame();
  $('#sim-keys').onclick = openKeyBox;
  $('#sim-final').onclick = openFinalLock;
  renderSim();
}

function renderSim() {
  const grid = $('#sim-grid');
  grid.innerHTML = '';
  S.scenario.targets.forEach((t, i) => {
    const done = isSolved(t);
    grid.append(el('button', {
      class: `sim-card${done ? ' done' : ''}`,
      onclick: () => { beep('found'); openQuiz(i); },
    }, [
      t.thumb
        ? el('img', { src: t.thumb, alt: t.name })
        : el('div', { style: { aspectRatio: '4/3', display: 'grid', placeItems: 'center', fontSize: '34px' } }, [t.ar.emoji]),
      el('div', { class: 'cap' }, [
        el('span', {}, [t.bonus ? `🎁 ${t.name}` : t.name]),
        el('span', {}, [done ? '✅' : (t.bonus ? '🎁' : '🔒')]),
      ]),
    ]));
  });
  updateHud();
}

/* ============================================================
   문제 시트
   ============================================================ */

const sheet = () => $('#sheet');

function closeSheet() {
  sheet().classList.remove('open');
  S.openTarget = null;
  S.finalOpen = false;
  if (S.mode === 'ar') {
    // 마커를 계속 비추고 있으면 targetFound 가 다시 오지 않는다.
    // 그 상태에서 "사진을 비추세요"만 띄우면 학생이 혼란스러우니 발견 바를 되살린다.
    const still = S.engine?.activeIndexes?.() ?? [];
    if (still.length) showFoundBar(still[0]);
    else { $('#reticle').hidden = false; $('#scan-hint').hidden = false; }
  }
  setTimeout(() => { if (!sheet().classList.contains('open')) sheet().innerHTML = ''; }, 400);
}

function openSheet(build) {
  const s = sheet();
  s.innerHTML = '';
  build(s);
  s.scrollTop = 0;
  requestAnimationFrame(() => s.classList.add('open'));
}

function openQuiz(index) {
  const t = S.scenario.targets[index];
  if (!t) return;
  S.openTarget = index;
  S.finalOpen = false;

  const state = { selected: null, tries: 0, hintShown: false, answered: false };

  openSheet(box => {
    const hex = colorHex(t.ar.color);

    box.append(el('div', { class: 'sheet-hd' }, [
      el('div', {
        class: 'sheet-emoji',
        style: { background: `${hex}1a`, borderColor: `${hex}47` },
      }, [t.ar.emoji]),
      el('div', { class: 'grow' }, [
        el('h3', { class: 'sheet-title' }, [t.name]),
        el('div', { class: 'tiny dim' }, [`단서 ${index + 1} / ${totalCount()}`]),
      ]),
      el('button', { class: 'icon-btn', onclick: closeSheet, 'aria-label': '닫기' }, ['✕']),
    ]));

    box.append(el('p', { class: 'question' }, [t.quiz.question]));

    const body = el('div', {});
    box.append(body);

    /* ---- 입력 영역 ---- */
    let getInput;
    if (t.quiz.type === 'choice') {
      const choices = t.quiz.choices.map((c, i) => ({ text: c, i })).filter(c => c.text.trim());
      const wrap = el('div', { class: 'choices' });
      const btns = choices.map(c => {
        const b = el('button', {
          class: 'choice',
          onclick: () => {
            if (state.answered) return;
            state.selected = c.i;
            btns.forEach(x => x.classList.remove('sel'));
            b.classList.add('sel');
            submitBtn.disabled = false;
          },
        }, [
          el('span', { class: 'num' }, [String(c.i + 1)]),
          el('span', { class: 'grow' }, [c.text]),
        ]);
        b.dataset.idx = c.i;
        wrap.append(b);
        return b;
      });
      body.append(wrap);
      getInput = () => state.selected;
      state.btns = btns;
    } else {
      const input = el('input', {
        type: 'text',
        inputmode: t.quiz.type === 'number' ? 'decimal' : 'text',
        placeholder: t.quiz.type === 'number' ? '숫자로 답을 입력하세요' : '정답을 입력하세요',
        autocomplete: 'off',
        onkeydown: e => { if (e.key === 'Enter') submit(); },
        oninput: () => { submitBtn.disabled = !input.value.trim(); },
      });
      body.append(el('div', { style: { marginBottom: '14px' } }, [input]));
      getInput = () => input.value;
      state.input = input;
      setTimeout(() => { if (S.mode === 'sim') input.focus(); }, 420);
    }

    /* ---- 힌트 / 제출 ---- */
    const hintSlot = el('div', {});
    body.append(hintSlot);

    const hintBtn = el('button', {
      class: 'btn btn-sm btn-ghost',
      onclick: () => showHint(),
    }, [`💡 힌트 보기${S.scenario.hintPenaltySec ? ` (+${S.scenario.hintPenaltySec}초)` : ''}`]);

    const submitBtn = el('button', {
      class: 'btn btn-primary grow',
      disabled: true,
      onclick: () => submit(),
    }, ['제출']);

    const actions = el('div', { class: 'row', style: { marginTop: '6px' } }, [hintBtn, submitBtn]);
    box.append(actions);

    function showHint(auto = false) {
      if (state.hintShown) return;
      state.hintShown = true;
      hintBtn.remove();
      const text = t.quiz.hint?.trim() || '이 문제에는 준비된 힌트가 없습니다. 단서 이미지를 다시 살펴보세요.';
      hintSlot.append(el('div', { class: 'hintbox' }, [
        el('b', {}, [auto ? '💡 자동 힌트 ' : '💡 힌트 ']), text,
      ]));
      state.hintAuto = auto;
      if (auto) {
        // 3회 오답 시 자동 공개 — 벌점도 없고, 학생이 '쓴' 힌트로도 세지 않는다
        S.progress.autoHints = (S.progress.autoHints || 0) + 1;
      } else {
        if (S.scenario.hintPenaltySec) {
          S.progress.penaltyMs += S.scenario.hintPenaltySec * 1000;
          toast(`힌트 사용 — ${S.scenario.hintPenaltySec}초 추가`, 'err', 1800);
        }
        S.progress.hintsUsed = (S.progress.hintsUsed || 0) + 1;
      }
      persist();
      sheet().scrollTo({ top: sheet().scrollHeight, behavior: 'smooth' });
    }

    function submit() {
      if (state.answered) return;
      const value = getInput();
      if (value === null || value === undefined || String(value).trim() === '') return;

      state.tries++;
      if (checkAnswer(t, value)) {
        state.answered = true;
        onCorrect(t, index, state, { body, actions, box });
      } else {
        beep('fail');
        vibrate([40, 60, 40]);
        box.classList.add('shake');
        setTimeout(() => box.classList.remove('shake'), 420);
        if (state.btns && state.selected !== null) {
          const b = state.btns.find(x => Number(x.dataset.idx) === state.selected);
          b?.classList.add('wrong');
          setTimeout(() => b?.classList.remove('wrong'), 700);
        }
        toast(state.tries >= 3 ? '아직 아니에요. 힌트를 확인해 보세요.' : '틀렸습니다. 다시 생각해 보세요.', 'err');
        if (state.tries >= 3) showHint(true);
      }
    }
  });
}

function onCorrect(t, index, state, ui) {
  beep('ok');
  vibrate([25, 40, 25, 40, 60]);

  S.progress.solved[t.id] = {
    at: Date.now(),
    tries: state.tries,
    hintUsed: state.hintShown && !state.hintAuto,
  };
  persist();

  // 보기 정답 표시
  if (state.btns) {
    state.btns.forEach(b => {
      b.disabled = true;
      b.classList.remove('sel');
      if (Number(b.dataset.idx) === t.quiz.answerIndex) b.classList.add('right');
    });
  } else if (state.input) {
    state.input.disabled = true;
    state.input.value = answerText(t);
  }

  ui.actions.remove();

  const after = el('div', {});
  if (t.bonus) {
    after.append(el('div', { class: 'reward-pop' }, [
      el('div', { class: 'cap' }, ['보너스 문제 성공']),
      el('div', { class: 'val' }, ['🎁']),
      el('div', { class: 'small', style: { marginTop: '6px', color: 'var(--txt-2)' } }, ['탈출과는 별개인 덤 문제예요. 선생님께 보여 주세요!']),
    ]));
  } else if (t.reward?.trim()) {
    after.append(el('div', { class: 'reward-pop' }, [
      el('div', { class: 'cap' }, ['열쇠 조각 획득']),
      el('div', { class: 'val' }, [t.reward]),
    ]));
  } else {
    after.append(el('div', { class: 'reward-pop' }, [
      el('div', { class: 'val', style: { fontSize: '40px', color: 'var(--ok)' } }, ['✅ 해제!']),
    ]));
  }

  if (t.quiz.explain?.trim()) {
    after.append(el('div', { class: 'explainbox' }, [el('b', {}, ['📖 해설 ']), t.quiz.explain]));
  }

  const allDone = solvedCount() >= totalCount();
  after.append(el('div', { class: 'row', style: { marginTop: '8px' } }, [
    allDone
      ? el('button', { class: 'btn btn-gold btn-block btn-lg', onclick: () => { closeSheet(); setTimeout(openFinalLock, 380); } },
          ['🔓 최종 자물쇠 열기'])
      : el('button', { class: 'btn btn-primary btn-block btn-lg', onclick: closeSheet },
          ['다음 단서 찾으러 가기']),
  ]));

  ui.box.append(after);
  sheet().scrollTo({ top: sheet().scrollHeight, behavior: 'smooth' });

  refreshArCards();
  updateHud();
  if (S.mode === 'sim') renderSim();

  if (allDone && !t.bonus) toast('모든 자물쇠를 해제했습니다! 최종 암호를 입력하세요.', 'ok', 4000);
}

/* ============================================================
   열쇠 보관함 / 최종 자물쇠
   ============================================================ */

function keyFragments() {
  return requiredTargets().map(t => ({
    name: t.name,
    reward: t.reward || '',
    got: isSolved(t),
  }));
}

function openKeyBox() {
  const frags = keyFragments();
  modal((box, close) => {
    box.append(
      el('h3', {}, ['🗝️ 열쇠 보관함']),
      el('p', { class: 'muted small' }, ['해제한 단서에서 얻은 조각입니다. 단서 번호 순서대로 배열되어 있습니다.']),
      el('div', { class: 'keyslots' }, frags.map(f =>
        el('div', { class: `slot${f.got ? ' filled' : ''}`, title: f.name }, [f.got ? (f.reward || '✔') : '?']),
      )),
      el('p', { class: 'tiny dim center', style: { marginTop: '10px' } },
        [`${frags.filter(f => f.got).length} / ${frags.length} 조각 수집`]),
      el('button', { class: 'btn btn-block', style: { marginTop: '16px' }, onclick: close }, ['닫기']),
    );
  });
}

function openFinalLock() {
  const sc = S.scenario;
  const expected = computeFinalAnswer(sc);
  const frags = keyFragments();
  const gotAll = frags.every(f => f.got);
  S.finalOpen = true;
  S.openTarget = null;

  openSheet(box => {
    box.append(el('div', { class: 'sheet-hd' }, [
      el('div', { class: 'sheet-emoji', style: { background: 'rgba(255,201,77,.12)', borderColor: 'rgba(255,201,77,.4)' } }, ['🔓']),
      el('div', { class: 'grow' }, [
        el('h3', { class: 'sheet-title' }, ['최종 자물쇠']),
        el('div', { class: 'tiny dim' }, [`${frags.filter(f => f.got).length} / ${frags.length} 조각 수집됨`]),
      ]),
      el('button', { class: 'icon-btn', onclick: closeSheet, 'aria-label': '닫기' }, ['✕']),
    ]));

    if (sc.finalLock.question?.trim()) {
      box.append(el('p', { class: 'question' }, [sc.finalLock.question]));
    }

    box.append(el('div', { class: 'keyslots' }, frags.map(f =>
      el('div', { class: `slot${f.got ? ' filled' : ''}`, title: f.name }, [f.got ? (f.reward || '✔') : '?']),
    )));

    if (!gotAll) {
      box.append(el('p', { class: 'muted small center', style: { margin: '14px 0' } },
        ['아직 모으지 못한 조각이 있습니다. 그래도 암호를 알아냈다면 입력해 보세요.']));
    }

    const input = el('input', {
      type: 'text',
      placeholder: '최종 암호 입력',
      autocomplete: 'off',
      style: { textAlign: 'center', fontSize: '22px', fontWeight: '800', letterSpacing: '.12em' },
      onkeydown: e => { if (e.key === 'Enter') tryUnlock(); },
      oninput: () => { btn.disabled = !input.value.trim(); },
    });
    box.append(el('div', { style: { margin: '16px 0 12px' } }, [input]));

    const hintSlot = el('div', {});
    box.append(hintSlot);

    const hintBtn = el('button', {
      class: 'btn btn-sm btn-ghost',
      onclick: () => {
        hintBtn.remove();
        hintSlot.append(el('div', { class: 'hintbox' }, [
          el('b', {}, ['💡 힌트 ']),
          sc.finalLock.hint?.trim() || '수집한 조각을 단서 번호 순서대로 이어 붙여 보세요.',
        ]));
      },
    }, ['💡 힌트']);

    const btn = el('button', { class: 'btn btn-gold grow btn-lg', disabled: true, onclick: () => tryUnlock() }, ['자물쇠 열기']);
    box.append(el('div', { class: 'row' }, [hintBtn, btn]));

    setTimeout(() => { if (S.mode === 'sim') input.focus(); }, 420);

    let fails = 0;
    function tryUnlock() {
      const v = input.value;
      if (!v.trim()) return;
      if (normalizeAnswer(v) === normalizeAnswer(expected)) {
        finishGame(true);
      } else {
        fails++;
        beep('fail');
        vibrate([50, 70, 50]);
        box.classList.add('shake');
        setTimeout(() => box.classList.remove('shake'), 420);
        toast(fails >= 2 ? '암호가 다릅니다. 조각의 순서를 확인하세요.' : '암호가 맞지 않습니다.', 'err');
        input.select();
      }
    }
  });
}

/* ============================================================
   타이머 / HUD
   ============================================================ */

function startTimer() {
  stopTimer();
  let lastPersistAt = Date.now();
  S.timerId = setInterval(() => {
    updateHud();
    if (Date.now() - lastPersistAt >= 15000) { lastPersistAt = Date.now(); persist(); }
    const rem = remainingMs();
    if (rem !== Infinity && rem <= 0 && !S.timeUpHandled) {
      S.timeUpHandled = true;
      onTimeUp();
    }
  }, 500);
  updateHud();
}

function stopTimer() {
  if (S.timerId) clearInterval(S.timerId);
  S.timerId = null;
}

function updateHud() {
  if (!S.scenario || !S.progress) return;
  const done = solvedCount();
  const total = totalCount();
  const pct = total ? (done / total) * 100 : 0;

  const limit = S.scenario.timeLimitMin * 60000;
  const rem = remainingMs();
  const label = limit ? fmtClock(Math.max(0, rem)) : fmtClock(elapsedMs());

  const timerEl = $('#timer');
  if (timerEl) {
    timerEl.textContent = label;
    timerEl.classList.toggle('warn', limit > 0 && rem <= 180000 && rem > 60000);
    timerEl.classList.toggle('crit', limit > 0 && rem <= 60000);
  }
  const pl = $('#progress-label');
  if (pl) pl.textContent = `${done} / ${total} 해제`;
  const pb = $('#progress-bar');
  if (pb) pb.style.width = `${pct}%`;

  const st = $('#sim-timer');
  if (st) st.textContent = label;
  const sb = $('#sim-bar');
  if (sb) sb.style.width = `${pct}%`;

  const finalBtn = $('#btn-final');
  if (finalBtn) finalBtn.classList.toggle('hot', done >= total && total > 0);
  const simFinal = $('#sim-final');
  if (simFinal) simFinal.classList.toggle('btn-gold', done >= total);
}

let hudBound = false;
function bindHud() {
  if (hudBound) return;
  hudBound = true;
  $('#btn-keys').onclick = openKeyBox;
  $('#btn-final').onclick = () => { closeSheet(); setTimeout(openFinalLock, 260); };
  $('#btn-menu').onclick = openMenu;
  $('#found-open').onclick = () => {
    const i = S.pending;
    if (i === null) return;
    clearTimeout(S.pendingTimer);
    S.pending = null;
    $('#found-bar').hidden = true;
    openQuiz(i);
  };
}

function openMenu() {
  modal((box, close) => {
    box.append(
      el('h3', {}, ['메뉴']),
      el('div', { class: 'stack' }, [
        el('button', {
          class: 'btn btn-block', onclick: () => { close(); openKeyBox(); },
        }, ['🗝️ 열쇠 보관함']),
        el('button', {
          class: 'btn btn-block', onclick: () => { close(); toast('단서 이미지 전체가 화면에 들어오게, 밝은 곳에서 비춰 보세요.', '', 4200); },
        }, ['❓ 인식이 안 될 때']),
        el('button', {
          class: 'btn btn-block btn-danger',
          onclick: async () => {
            close();
            if (await confirmDialog('게임 종료', '지금 종료하면 결과 화면으로 이동합니다.', { okLabel: '종료', danger: true })) {
              finishGame(false, 'quit');
            }
          },
        }, ['⏹ 게임 종료']),
        el('button', { class: 'btn btn-ghost btn-block', onclick: close }, ['닫기']),
      ]),
    );
  });
}

function onTimeUp() {
  beep('fail');
  toast('시간이 다 되었습니다!', 'err', 4000);
  modal((box, close) => {
    box.append(
      el('h3', {}, ['⏰ 시간 종료']),
      el('p', { class: 'muted' }, ['제한 시간이 끝났습니다. 결과를 확인하거나, 연장해서 계속 도전할 수 있습니다.']),
      el('div', { class: 'stack', style: { marginTop: '16px' } }, [
        el('button', {
          class: 'btn btn-primary btn-block',
          onclick: () => { close(); finishGame(false, 'timeup'); },
        }, ['결과 보기']),
        el('button', {
          class: 'btn btn-block',
          onclick: () => {
            close();
            S.progress.penaltyMs -= 5 * 60000; // 5분 연장
            S.timeUpHandled = false;
            persist();
            toast('5분 연장되었습니다.', 'ok');
          },
        }, ['5분 연장하고 계속하기']),
      ]),
    );
  }, { closeOnBackdrop: false });
}

function quitGame() {
  finishGame(false, 'quit');
}

/* ============================================================
   결과
   ============================================================ */

function finishGame(escaped, reason = '') {
  if (S.progress.finished) return;
  S.progress.elapsedMs = elapsedMs();
  S.progress.finished = true;
  S.progress.escaped = escaped;
  S.progress.reason = reason;
  persist();
  stopTimer();
  closeSheet();

  if (escaped) {
    beep('win');
    vibrate([60, 40, 60, 40, 120]);
    addRecord(S.scenario.id, {
      team: S.progress.team,
      elapsedMs: S.progress.elapsedMs,
      solved: solvedCount(),
      total: totalCount(),
      hints: S.progress.hintsUsed || 0,
      at: new Date().toISOString(),
    });
    confetti();
  }

  S.engine?.destroy();
  S.engine = null;
  if (S.mindUrl) { URL.revokeObjectURL(S.mindUrl); S.mindUrl = null; }

  $('#hud').hidden = true;
  $('#reticle').hidden = true;
  $('#screen-sim').hidden = true;
  renderResult(escaped, reason);
}

function renderResult(escaped, reason) {
  const p = S.progress;
  const body = $('#result-body');
  body.innerHTML = '';

  const title = escaped ? '탈출 성공!' : (reason === 'timeup' ? '시간 초과' : '게임 종료');
  const icon = escaped ? '🎉' : (reason === 'timeup' ? '⏰' : '🚪');

  body.append(
    el('div', { class: 'result-icon' }, [icon]),
    el('h1', { class: 'hero-title center', style: { marginBottom: '4px' } }, [title]),
    el('p', { class: 'muted center' }, [`${p.team} · ${S.scenario.title}`]),

    el('div', { class: 'stat-grid' }, [
      el('div', { class: 'stat' }, [
        el('div', { class: 'v' }, [fmtClock(p.elapsedMs)]),
        el('div', { class: 'k' }, ['소요 시간']),
      ]),
      el('div', { class: 'stat' }, [
        el('div', { class: 'v' }, [`${solvedCount()}/${totalCount()}`]),
        el('div', { class: 'k' }, ['해제한 자물쇠']),
      ]),
      el('div', { class: 'stat' }, [
        el('div', { class: 'v' }, [String(p.hintsUsed || 0)]),
        el('div', { class: 'k' }, [p.autoHints ? `사용한 힌트 (자동 ${p.autoHints})` : '사용한 힌트']),
      ]),
    ]),
  );

  // 문제별 요약
  const detail = el('div', { class: 'card' }, [el('h3', { style: { fontSize: '15px' } }, ['풀이 요약'])]);
  S.scenario.targets.forEach((t, i) => {
    const rec = p.solved[t.id];
    detail.append(el('div', {
      class: 'row spread',
      style: { padding: '9px 0', borderTop: i ? '1px solid var(--line-soft)' : 'none', fontSize: '14px' },
    }, [
      el('div', { class: 'grow' }, [
        el('div', { style: { fontWeight: '700' } }, [`${rec ? '✅' : (t.bonus ? '🎁' : '❌')} ${t.name}${t.bonus ? ' (보너스)' : ''}`]),
        el('div', { class: 'tiny dim' }, [`정답: ${answerText(t)}`]),
      ]),
      el('div', { class: 'tiny dim nowrap' }, [rec ? `${rec.tries}회 시도${rec.hintUsed ? ' · 힌트' : ''}` : (t.bonus ? '미도전' : '미해결')]),
    ]));
  });
  body.append(detail);

  // 기록
  const records = listRecords(S.scenario.id);
  if (records.length) {
    const list = el('div', { class: 'rank-list' });
    records.slice(0, 8).forEach((r, i) => {
      const me = r.team === p.team && Math.abs(r.elapsedMs - p.elapsedMs) < 1500;
      list.append(el('div', { class: `rank-row${me ? ' me' : ''}` }, [
        el('span', { class: 'no' }, [String(i + 1)]),
        el('span', { class: 'grow', style: { fontWeight: '700' } }, [r.team]),
        el('span', { class: 'tiny dim' }, [`힌트 ${r.hints}`]),
        el('span', { class: 'mono', style: { fontWeight: '800' } }, [fmtClock(r.elapsedMs)]),
      ]));
    });
    body.append(el('div', { class: 'card' }, [
      el('h3', { style: { fontSize: '15px' } }, ['🏆 이 기기의 기록']),
      list,
    ]));
  }

  body.append(el('div', { class: 'stack', style: { marginTop: '18px' } }, [
    el('button', {
      class: 'btn btn-primary btn-block btn-lg',
      onclick: () => { clearProgress(S.scenario.id); location.reload(); },
    }, ['다시 도전하기']),
    el('button', {
      class: 'btn btn-block',
      onclick: () => {
        const text = [
          `[${S.scenario.title}] ${p.team}`,
          `${escaped ? '탈출 성공' : '미탈출'} · ${fmtClock(p.elapsedMs)}`,
          `해제 ${solvedCount()}/${totalCount()} · 힌트 ${p.hintsUsed || 0}회`,
        ].join('\n');
        navigator.clipboard?.writeText(text)
          .then(() => toast('결과를 복사했습니다.', 'ok'))
          .catch(() => toast('복사에 실패했습니다.', 'err'));
      },
    }, ['📋 결과 복사']),
    el('a', { class: 'btn btn-ghost btn-block', href: 'index.html' }, ['처음 화면으로']),
  ]));

  $('#screen-result').hidden = false;
}

/* ---------------- 색종이 ---------------- */
function confetti() {
  const cv = $('#confetti');
  cv.hidden = false;
  const ctx = cv.getContext('2d');
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  cv.width = innerWidth * dpr;
  cv.height = innerHeight * dpr;
  ctx.scale(dpr, dpr);

  const colors = ['#43e8d8', '#ffc94d', '#a78bfa', '#ff6b8a', '#84e04b', '#4dabff'];
  const parts = Array.from({ length: 140 }, () => ({
    x: Math.random() * innerWidth,
    y: -20 - Math.random() * innerHeight * 0.6,
    w: 6 + Math.random() * 7,
    h: 9 + Math.random() * 10,
    vy: 2 + Math.random() * 3.4,
    vx: -1.2 + Math.random() * 2.4,
    rot: Math.random() * Math.PI,
    vr: -0.14 + Math.random() * 0.28,
    c: colors[Math.floor(Math.random() * colors.length)],
  }));

  const t0 = performance.now();
  (function frame(now) {
    const age = now - t0;
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    for (const p of parts) {
      p.x += p.vx; p.y += p.vy; p.rot += p.vr;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.globalAlpha = Math.max(0, 1 - age / 5200);
      ctx.fillStyle = p.c;
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      ctx.restore();
    }
    if (age < 5200) requestAnimationFrame(frame);
    else { ctx.clearRect(0, 0, innerWidth, innerHeight); cv.hidden = true; }
  })(t0);
}

/* ---------------- 생명주기 ---------------- */
window.addEventListener('beforeunload', () => { persist(); S.engine?.stop(); });
document.addEventListener('visibilitychange', () => { if (document.hidden) persist(); });

boot();
