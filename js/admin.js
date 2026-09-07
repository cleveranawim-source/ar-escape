/* ============================================================
   교사용 제작 스튜디오
   ============================================================ */

import {
  $, el, toast, modal, confirmDialog, pickFile, readFileAsText, readFileAsDataURL,
  download, resizeImage, scoreMarker, loadImage, fmtBytes, uid,
} from './util.js';
import {
  newScenario, newTarget, newQuiz, toFile, fromFile, validate,
  computeFinalAnswer, mindBytes, AR_COLORS, AR_EMOJIS, QUIZ_TYPES,
} from './model.js';
import {
  listScenarios, getScenario, saveScenario, deleteScenario, rememberLast,
} from './store.js';
import { compileTargets, loadCompiler } from './ar.js';
import { drawCard } from './arcard.js';

const A = {
  scenarios: [],
  current: null,
  openTargets: new Set(),
  dirty: false,
  saveTimer: null,
};

/* ============================================================
   부트
   ============================================================ */

async function boot() {
  $('#btn-new').onclick = createNew;
  $('#btn-import').onclick = importFile;
  await refreshList();

  const params = new URLSearchParams(location.search);
  const wanted = params.get('id') || A.scenarios[0]?.id;
  if (wanted) await open(wanted);
  else renderEmpty();
}

async function refreshList() {
  A.scenarios = await listScenarios();
  const list = $('#sc-list');
  list.innerHTML = '';
  $('#sc-count').textContent = A.scenarios.length ? `${A.scenarios.length}개` : '';

  if (!A.scenarios.length) {
    list.append(el('p', { class: 'tiny dim', style: { margin: '4px 0' } }, ['아직 만든 방탈출이 없습니다.']));
    return;
  }
  for (const sc of A.scenarios) {
    list.append(el('button', {
      class: `sc-item${A.current?.id === sc.id ? ' active' : ''}`,
      onclick: () => open(sc.id),
    }, [
      el('div', { class: 'grow' }, [
        el('div', { class: 't' }, [sc.title || '(제목 없음)']),
        el('div', { class: 's' }, [`단서 ${sc.targets.length}개 · ${sc.mind ? 'AR 준비됨' : '미컴파일'}`]),
      ]),
    ]));
  }
}

async function createNew() {
  const sc = newScenario();
  await saveScenario(sc);
  await refreshList();
  await open(sc.id);
  toast('새 방탈출을 만들었습니다.', 'ok');
}

async function open(id) {
  // 디바운스 대기 중인 저장을 먼저 확정한다.
  // (제목·문제를 고친 직후 600ms 안에 다른 시나리오를 누르면 수정이 통째로 사라졌다)
  clearTimeout(A.saveTimer);
  if (A.dirty) await flush();
  const sc = await getScenario(id);
  if (!sc) { toast('시나리오를 찾을 수 없습니다.', 'err'); return; }
  A.current = sc;
  A.openTargets.clear();
  rememberLast(id);
  history.replaceState(null, '', `admin.html?id=${id}`);
  await refreshList();
  render();
}

async function importFile() {
  const f = await pickFile('.json,application/json');
  if (!f) return;
  try {
    const sc = fromFile(await readFileAsText(f));
    sc.id = uid('sc');           // 충돌 방지를 위해 새 ID 부여
    sc.title = `${sc.title} (가져옴)`;
    await saveScenario(sc);
    await refreshList();
    await open(sc.id);
    toast('시나리오를 가져왔습니다.', 'ok');
  } catch (e) {
    toast(e.message, 'err');
  }
}

/* ============================================================
   저장
   ============================================================ */

function touch({ immediate = false } = {}) {
  A.dirty = true;
  updateSaveBadge('저장 중…');
  clearTimeout(A.saveTimer);
  A.saveTimer = setTimeout(flush, immediate ? 0 : 600);
}

async function flush() {
  if (!A.current) return;
  await saveScenario(A.current);
  A.dirty = false;
  updateSaveBadge('저장됨');
  const item = $('#sc-list .sc-item.active .t');
  if (item) item.textContent = A.current.title || '(제목 없음)';
}

function updateSaveBadge(text) {
  const b = $('#save-badge');
  if (b) { b.textContent = text; b.className = `badge ${text === '저장됨' ? 'ok' : 'gray'}`; }
}

/* ============================================================
   렌더링
   ============================================================ */

function renderEmpty() {
  $('#editor').innerHTML = '';
  $('#editor').append(el('div', { class: 'card center', style: { padding: '54px 24px' } }, [
    el('div', { style: { fontSize: '48px', marginBottom: '10px' } }, ['🗝️']),
    el('h2', {}, ['첫 방탈출을 만들어 보세요']),
    el('p', { class: 'muted' }, ['이미지를 등록하고 문제를 붙이면, 학생들이 그 이미지를 비출 때 AR 카드가 나타납니다.']),
    el('div', { class: 'row', style: { justifyContent: 'center', marginTop: '18px' } }, [
      el('button', { class: 'btn btn-primary btn-lg', onclick: createNew }, ['+ 새 방탈출 만들기']),
      el('a', { class: 'btn btn-lg', href: 'markers.html' }, ['🖨 마커부터 만들기']),
    ]),
  ]));
}

function render() {
  const sc = A.current;
  const root = $('#editor');
  root.innerHTML = '';
  root.append(headerCard(sc), basicsCard(sc), targetsCard(sc), compileCard(sc), publishCard(sc));
}

/* ---------------- 헤더 ---------------- */

function headerCard(sc) {
  return el('div', { class: 'card' }, [
    el('div', { class: 'row spread row-wrap', style: { gap: '12px' } }, [
      el('div', { class: 'grow', style: { minWidth: '220px' } }, [
        el('input', {
          type: 'text', value: sc.title, placeholder: '방탈출 제목',
          style: { fontSize: '20px', fontWeight: '800', border: 'none', background: 'transparent', padding: '4px 0' },
          oninput: e => { sc.title = e.target.value; touch(); },
        }),
        el('div', { class: 'row', style: { marginTop: '4px' } }, [
          el('span', { class: 'badge ok', id: 'save-badge' }, ['저장됨']),
          el('span', { class: 'tiny dim' }, [`단서 ${sc.targets.length}개`]),
        ]),
      ]),
      el('div', { class: 'row row-wrap' }, [
        el('a', {
          class: 'btn btn-sm', href: `play.html?id=${sc.id}`, target: '_blank',
          onclick: () => { clearTimeout(A.saveTimer); flush(); },
        }, ['▶ 미리보기']),
        el('button', { class: 'btn btn-sm', onclick: exportScenario }, ['📤 내보내기']),
        el('button', {
          class: 'btn btn-sm btn-danger',
          onclick: async () => {
            if (!await confirmDialog('삭제', `"${sc.title}"을(를) 삭제할까요? 되돌릴 수 없습니다.`, { okLabel: '삭제', danger: true })) return;
            clearTimeout(A.saveTimer);
            await deleteScenario(sc.id);
            A.current = null;
            A.dirty = false;
            await refreshList();
            if (A.scenarios[0]) await open(A.scenarios[0].id); else renderEmpty();
            toast('삭제했습니다.');
          },
        }, ['삭제']),
      ]),
    ]),
  ]);
}

/* ---------------- 기본 설정 ---------------- */

function basicsCard(sc) {
  const finalPreview = el('div', {
    class: 'mono',
    style: { fontSize: '22px', fontWeight: '900', letterSpacing: '.12em', color: 'var(--gold)' },
  }, [computeFinalAnswer(sc) || '(열쇠 조각을 입력하세요)']);

  const manualWrap = el('div', { hidden: sc.finalLock.mode !== 'manual' }, [
    el('label', { class: 'field' }, [
      el('span', { class: 'lb' }, ['최종 암호 (직접 지정)']),
      el('input', {
        type: 'text', value: sc.finalLock.answer,
        placeholder: '예: 1847',
        oninput: e => { sc.finalLock.answer = e.target.value; finalPreview.textContent = computeFinalAnswer(sc) || '(비어 있음)'; touch(); },
      }),
    ]),
  ]);

  A._refreshFinalPreview = () => {
    finalPreview.textContent = computeFinalAnswer(sc) || '(열쇠 조각을 입력하세요)';
  };

  return el('div', { class: 'card' }, [
    el('div', { class: 'card-hd' }, [el('h3', {}, ['⚙️ 기본 설정'])]),

    el('label', { class: 'field' }, [
      el('span', { class: 'lb' }, ['시작 이야기 (학생에게 보여줄 상황 설명)']),
      el('textarea', {
        rows: 4, placeholder: '예: 실험실이 봉인되었다. 흩어진 기록을 찾아 봉인을 풀어라.',
        oninput: e => { sc.story = e.target.value; touch(); },
      }, [sc.story]),
    ]),

    el('div', { class: 'grid-2' }, [
      el('label', { class: 'field' }, [
        el('span', { class: 'lb' }, ['제한 시간 (분, 0이면 무제한)']),
        el('input', {
          type: 'number', min: '0', max: '180', value: String(sc.timeLimitMin),
          oninput: e => { sc.timeLimitMin = Math.max(0, Number(e.target.value) || 0); touch(); },
        }),
      ]),
      el('label', { class: 'field' }, [
        el('span', { class: 'lb' }, ['힌트 사용 시 시간 벌점 (초)']),
        el('input', {
          type: 'number', min: '0', max: '600', value: String(sc.hintPenaltySec),
          oninput: e => { sc.hintPenaltySec = Math.max(0, Number(e.target.value) || 0); touch(); },
        }),
      ]),
    ]),

    el('hr', { class: 'hr' }),
    el('h4', { style: { fontSize: '14px' } }, ['🔓 최종 자물쇠']),

    el('label', { class: 'field' }, [
      el('span', { class: 'lb' }, ['최종 암호 만드는 방식']),
      el('select', {
        onchange: e => {
          sc.finalLock.mode = e.target.value;
          manualWrap.hidden = e.target.value !== 'manual';
          A._refreshFinalPreview();
          touch();
        },
      }, [
        el('option', { value: 'auto', selected: sc.finalLock.mode === 'auto' }, ['자동 — 각 단서의 열쇠 조각을 순서대로 조합']),
        el('option', { value: 'manual', selected: sc.finalLock.mode === 'manual' }, ['직접 입력']),
      ]),
    ]),

    manualWrap,

    el('label', { class: 'field' }, [
      el('span', { class: 'lb' }, ['최종 자물쇠 안내문']),
      el('input', {
        type: 'text', value: sc.finalLock.question, placeholder: '예: 모은 조각을 순서대로 합치면 암호가 된다.',
        oninput: e => { sc.finalLock.question = e.target.value; touch(); },
      }),
    ]),
    el('label', { class: 'field' }, [
      el('span', { class: 'lb' }, ['최종 자물쇠 힌트']),
      el('input', {
        type: 'text', value: sc.finalLock.hint, placeholder: '예: 단서 번호 순서대로 배열하라.',
        oninput: e => { sc.finalLock.hint = e.target.value; touch(); },
      }),
    ]),

    el('div', {
      style: {
        background: 'var(--bg-2)', border: '1px solid var(--line)',
        borderRadius: 'var(--r)', padding: '12px 14px', textAlign: 'center',
      },
    }, [
      el('div', { class: 'tiny dim', style: { fontWeight: '800', marginBottom: '4px' } }, ['현재 최종 암호']),
      finalPreview,
    ]),
  ]);
}

/* ---------------- 단서 목록 ---------------- */

function targetsCard(sc) {
  const list = el('div', { class: 'tgt-list', id: 'tgt-list' });
  sc.targets.forEach((t, i) => list.append(targetRow(sc, t, i)));

  const drop = el('div', {
    class: 'drop',
    onclick: () => addTargets(),
    ondragover: e => { e.preventDefault(); drop.classList.add('over'); },
    ondragleave: () => drop.classList.remove('over'),
    ondrop: e => {
      e.preventDefault();
      drop.classList.remove('over');
      const files = [...e.dataTransfer.files].filter(f => f.type.startsWith('image/'));
      if (files.length) addTargets(files);
    },
  }, [
    el('div', { style: { fontSize: '26px', marginBottom: '4px' } }, ['🖼️']),
    el('div', { style: { fontWeight: '700' } }, ['단서 이미지 추가']),
    el('div', { class: 'tiny dim', style: { marginTop: '3px' } }, ['클릭하거나 이미지를 끌어다 놓으세요 · 여러 장 한 번에 가능']),
  ]);

  return el('div', { class: 'card' }, [
    el('div', { class: 'card-hd' }, [
      el('h3', {}, ['🔒 단서 (자물쇠)']),
      el('span', { class: 'tiny dim' }, ['학생이 이 이미지를 비추면 AR 카드가 뜹니다']),
    ]),
    sc.targets.length ? list : el('p', { class: 'muted small' }, ['아직 단서가 없습니다. 아래에서 이미지를 추가하세요.']),
    el('div', { style: { marginTop: sc.targets.length ? '14px' : '0' } }, [drop]),
  ]);
}

async function addTargets(files = null) {
  const sc = A.current;
  const picked = files || await pickFile('image/*', true);
  if (!picked?.length) return;

  const closing = toast(`이미지 ${picked.length}장 처리 중…`, '', 60000);
  for (const f of picked) {
    try {
      const raw = await readFileAsDataURL(f);
      // 1024px 로 통일 — 인식 품질과 저장 용량의 절충점
      const image = await resizeImage(raw, 1024, 'image/jpeg', 0.88);
      const t = newTarget(sc.targets.length);
      t.thumb = image;
      t.name = `${sc.targets.length + 1}번 단서`;
      const s = await scoreMarker(image);
      t.score = s.score;
      sc.targets.push(t);
    } catch (e) {
      toast(`${f.name}: ${e.message}`, 'err');
    }
  }
  closing.remove();

  // 자동 조합 모드에서 열쇠 조각 기본값 채우기
  autoFillRewards(sc);
  sc.mind = null; // 이미지가 바뀌었으니 재컴파일 필요
  touch({ immediate: true });
  render();
  toast(`단서 ${picked.length}개를 추가했습니다. 문제를 입력하세요.`, 'ok');
}

function autoFillRewards(sc) {
  const pool = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  sc.targets.forEach((t, i) => {
    if (!t.reward?.trim()) t.reward = pool[i % pool.length];
  });
}

function targetRow(sc, t, i) {
  const open = A.openTargets.has(t.id);
  const body = el('div', { class: 'tgt-body', hidden: !open });
  if (open) buildTargetEditor(body, sc, t, i);

  const wrap = el('div', { class: `tgt${open ? ' open' : ''}` });

  const toggle = () => {
    if (A.openTargets.has(t.id)) {
      A.openTargets.delete(t.id);
      body.hidden = true;
      body.innerHTML = '';
      wrap.classList.remove('open');
    } else {
      A.openTargets.add(t.id);
      buildTargetEditor(body, sc, t, i);
      body.hidden = false;
      wrap.classList.add('open');
    }
  };

  const scoreCls = t.score >= 72 ? 'good' : t.score >= 52 ? 'ok' : t.score >= 34 ? 'weak' : 'bad';

  wrap.append(
    el('div', { class: 'tgt-hd', onclick: toggle }, [
      t.thumb
        ? el('img', { class: 'tgt-thumb', src: t.thumb, alt: '' })
        : el('div', { class: 'tgt-thumb empty' }, ['?']),
      el('div', { class: 'tgt-info' }, [
        el('div', { class: 'tgt-name' }, [`${t.ar.emoji} ${t.name}`]),
        el('div', { class: 'tgt-sub' }, [t.quiz.question?.trim() || '문제가 비어 있습니다']),
        el('div', { class: 'row', style: { marginTop: '5px', gap: '6px' } }, [
          t.thumb ? el('span', { class: `score-pill ${scoreCls}` }, [`인식 ${t.score}점`]) : null,
          t.reward?.trim() ? el('span', { class: 'badge gold' }, [`열쇠 ${t.reward}`]) : null,
        ]),
      ]),
      el('div', { class: 'tgt-actions' }, [
        el('button', {
          class: 'icon-btn', title: '위로', 'aria-label': '위로',
          onclick: e => { e.stopPropagation(); move(sc, i, -1); },
        }, ['↑']),
        el('button', {
          class: 'icon-btn', title: '아래로', 'aria-label': '아래로',
          onclick: e => { e.stopPropagation(); move(sc, i, 1); },
        }, ['↓']),
      ]),
    ]),
    body,
  );
  return wrap;
}

function move(sc, i, dir) {
  const j = i + dir;
  if (j < 0 || j >= sc.targets.length) return;
  [sc.targets[i], sc.targets[j]] = [sc.targets[j], sc.targets[i]];
  sc.mind = null; // 순서가 곧 타겟 인덱스이므로 재컴파일 필요
  touch({ immediate: true });
  render();
}

/* ---------------- 단서 편집기 ---------------- */

function buildTargetEditor(box, sc, t, i) {
  box.innerHTML = '';

  const preview = el('canvas', { class: 'card-preview' });
  const redraw = () => drawCard(preview, {
    state: 'quiz',
    title: t.name,
    body: t.quiz.question || '(문제를 입력하세요)',
    emoji: t.ar.emoji,
    color: t.ar.color,
    badge: '잠김',
    footer: '아래 창에서 답을 입력하세요',
  });
  redraw();

  /* --- 이름 / 열쇠 조각 --- */
  box.append(el('div', { class: 'grid-2' }, [
    el('label', { class: 'field' }, [
      el('span', { class: 'lb' }, ['단서 이름']),
      el('input', {
        type: 'text', value: t.name,
        oninput: e => { t.name = e.target.value; redraw(); touch(); syncHead(); },
      }),
    ]),
    el('label', { class: 'field' }, [
      el('span', { class: 'lb' }, ['열쇠 조각 (정답 시 획득 · 보통 한 글자)']),
      el('input', {
        type: 'text', value: t.reward, maxlength: '6', placeholder: '예: A',
        oninput: e => { t.reward = e.target.value; A._refreshFinalPreview?.(); touch(); syncHead(); },
      }),
    ]),
  ]));

  /* --- 문제 --- */
  const quizBox = el('div', {});
  const rebuildQuiz = () => {
    quizBox.innerHTML = '';
    quizBox.append(quizEditor(t, redraw, syncHead));
  };
  rebuildQuiz();

  box.append(
    el('label', { class: 'field' }, [
      el('span', { class: 'lb' }, ['문제 형식']),
      el('select', {
        onchange: e => {
          const keep = { question: t.quiz.question, hint: t.quiz.hint, explain: t.quiz.explain };
          t.quiz = { ...newQuiz(e.target.value), ...keep, type: e.target.value };
          rebuildQuiz();
          touch();
        },
      }, QUIZ_TYPES.map(q => el('option', { value: q.key, selected: t.quiz.type === q.key }, [q.label]))),
    ]),
    quizBox,
  );

  /* --- AR 모양 --- */
  box.append(el('hr', { class: 'hr' }));
  box.append(el('h4', { style: { fontSize: '13px', color: 'var(--txt-2)' } }, ['AR 카드 모양']));

  const emojiPicker = el('div', { class: 'picker' }, AR_EMOJIS.map(e2 =>
    el('button', {
      class: `pick${t.ar.emoji === e2 ? ' on' : ''}`,
      onclick: () => {
        t.ar.emoji = e2;
        [...emojiPicker.children].forEach(c => c.classList.remove('on'));
        emojiPicker.querySelector(`[data-e="${e2}"]`)?.classList.add('on');
        redraw(); touch(); syncHead();
      },
      dataset: { e: e2 },
    }, [e2]),
  ));

  const colorPicker = el('div', { class: 'picker' }, AR_COLORS.map(c =>
    el('button', {
      class: `pick color${t.ar.color === c.key ? ' on' : ''}`,
      style: { background: c.hex, borderColor: c.hex },
      title: c.label,
      onclick: () => {
        t.ar.color = c.key;
        [...colorPicker.children].forEach(x => x.classList.remove('on'));
        colorPicker.querySelector(`[data-c="${c.key}"]`)?.classList.add('on');
        redraw(); touch();
      },
      dataset: { c: c.key },
    }, ['']),
  ));

  box.append(
    el('label', { class: 'field' }, [el('span', { class: 'lb' }, ['아이콘']), emojiPicker]),
    el('label', { class: 'field' }, [el('span', { class: 'lb' }, ['테마 색']), colorPicker]),
    el('label', { class: 'field' }, [
      el('span', { class: 'lb' }, ['해제 후 나타날 문구']),
      el('input', {
        type: 'text', value: t.ar.caption, placeholder: '예: 봉인이 풀렸다. 다음 방으로.',
        oninput: e => { t.ar.caption = e.target.value; touch(); },
      }),
    ]),
  );

  /* --- 미리보기 + 이미지 --- */
  box.append(el('div', { class: 'grid-2', style: { marginTop: '6px' } }, [
    el('div', {}, [
      el('div', { class: 'lb', style: { fontSize: '12.5px', fontWeight: '700', color: 'var(--txt-2)', marginBottom: '6px' } },
        ['AR 카드 미리보기']),
      preview,
    ]),
    el('div', {}, [
      el('div', { class: 'lb', style: { fontSize: '12.5px', fontWeight: '700', color: 'var(--txt-2)', marginBottom: '6px' } },
        ['인식할 이미지']),
      t.thumb
        ? el('img', { src: t.thumb, style: { width: '100%', borderRadius: 'var(--r)', border: '1px solid var(--line)', display: 'block' } })
        : el('div', { class: 'muted small' }, ['이미지가 없습니다']),
      el('div', { class: 'row', style: { marginTop: '8px' } }, [
        el('button', {
          class: 'btn btn-sm grow',
          onclick: async () => {
            const f = await pickFile('image/*');
            if (!f) return;
            const image = await resizeImage(await readFileAsDataURL(f), 1024, 'image/jpeg', 0.88);
            t.thumb = image;
            t.score = (await scoreMarker(image)).score;
            sc.mind = null;
            touch({ immediate: true });
            render();
            toast('이미지를 교체했습니다. 다시 컴파일하세요.', 'ok');
          },
        }, ['이미지 교체']),
        el('button', {
          class: 'btn btn-sm btn-danger',
          onclick: async () => {
            if (!await confirmDialog('단서 삭제', `"${t.name}"을(를) 삭제할까요?`, { okLabel: '삭제', danger: true })) return;
            sc.targets.splice(i, 1);
            sc.mind = null;
            touch({ immediate: true });
            render();
          },
        }, ['단서 삭제']),
      ]),
    ]),
  ]));

  /* --- AR 이미지(선택) --- */
  const arImgSlot = el('div', {});
  const renderArImg = () => {
    arImgSlot.innerHTML = '';
    if (t.arImage) {
      arImgSlot.append(
        el('img', { src: t.arImage, style: { maxWidth: '160px', borderRadius: '10px', display: 'block', marginBottom: '8px' } }),
        el('button', {
          class: 'btn btn-sm btn-danger',
          onclick: () => { t.arImage = null; renderArImg(); touch(); },
        }, ['AR 이미지 제거']),
      );
    } else {
      arImgSlot.append(el('button', {
        class: 'btn btn-sm',
        onclick: async () => {
          const f = await pickFile('image/*');
          if (!f) return;
          t.arImage = await resizeImage(await readFileAsDataURL(f), 720, 'image/png');
          renderArImg();
          touch();
          toast('AR 이미지를 추가했습니다.', 'ok');
        },
      }, ['+ AR 이미지 올리기']));
    }
  };
  renderArImg();

  box.append(
    el('hr', { class: 'hr' }),
    el('label', { class: 'field' }, [
      el('span', { class: 'lb' }, ['함께 띄울 AR 이미지 (선택) — 지도·사진·도표 등']),
      arImgSlot,
    ]),
  );

  function syncHead() {
    const head = box.parentElement?.querySelector('.tgt-hd');
    if (!head) return;
    head.querySelector('.tgt-name').textContent = `${t.ar.emoji} ${t.name}`;
    head.querySelector('.tgt-sub').textContent = t.quiz.question?.trim() || '문제가 비어 있습니다';
  }
}

function quizEditor(t, redraw, syncHead) {
  const q = t.quiz;
  const frag = el('div', {});

  frag.append(el('label', { class: 'field' }, [
    el('span', { class: 'lb' }, ['문제']),
    el('textarea', {
      rows: 3, placeholder: '학생에게 보여줄 문제를 입력하세요.',
      oninput: e => { q.question = e.target.value; redraw(); touch(); syncHead(); },
    }, [q.question]),
  ]));

  if (q.type === 'choice') {
    const wrap = el('div', { class: 'field' }, [
      el('span', { class: 'lb' }, ['보기 (왼쪽 동그라미가 정답)']),
    ]);
    const name = `ans_${t.id}`;
    q.choices.forEach((c, ci) => {
      wrap.append(el('div', { class: 'choice-edit' }, [
        el('input', {
          type: 'radio', name, checked: q.answerIndex === ci,
          onchange: () => { q.answerIndex = ci; touch(); },
        }),
        el('span', { class: 'idx' }, [String(ci + 1)]),
        el('input', {
          type: 'text', value: c, placeholder: `보기 ${ci + 1}`,
          oninput: e => { q.choices[ci] = e.target.value; touch(); },
        }),
        q.choices.length > 2
          ? el('button', {
              class: 'icon-btn', 'aria-label': '보기 삭제',
              onclick: () => {
                q.choices.splice(ci, 1);
                if (q.answerIndex >= q.choices.length) q.answerIndex = 0;
                else if (q.answerIndex > ci) q.answerIndex--;
                touch();
                frag.replaceWith(quizEditor(t, redraw, syncHead));
              },
            }, ['✕'])
          : null,
      ]));
    });
    if (q.choices.length < 6) {
      wrap.append(el('button', {
        class: 'btn btn-sm btn-ghost',
        onclick: () => {
          q.choices.push('');
          touch();
          frag.replaceWith(quizEditor(t, redraw, syncHead));
        },
      }, ['+ 보기 추가']));
    }
    frag.append(wrap);
  } else {
    frag.append(el('label', { class: 'field' }, [
      el('span', { class: 'lb' }, [
        q.type === 'number' ? '정답 (숫자)' : '정답 — 여러 개면 | 로 구분 (예: 광합성|photosynthesis)',
      ]),
      el('input', {
        type: 'text', value: q.answer,
        placeholder: q.type === 'number' ? '예: 42' : '예: 광합성',
        oninput: e => { q.answer = e.target.value; touch(); },
      }),
    ]));
    if (q.type === 'short') {
      frag.append(el('p', { class: 'tiny dim', style: { marginTop: '-8px' } },
        ['채점 시 공백·대소문자·문장부호는 무시됩니다.']));
    }
  }

  frag.append(el('div', { class: 'grid-2' }, [
    el('label', { class: 'field' }, [
      el('span', { class: 'lb' }, ['힌트']),
      el('input', {
        type: 'text', value: q.hint, placeholder: '3회 틀리면 자동으로 공개됩니다',
        oninput: e => { q.hint = e.target.value; touch(); },
      }),
    ]),
    el('label', { class: 'field' }, [
      el('span', { class: 'lb' }, ['해설 (정답 후 표시)']),
      el('input', {
        type: 'text', value: q.explain, placeholder: '선택 사항',
        oninput: e => { q.explain = e.target.value; touch(); },
      }),
    ]),
  ]));

  return frag;
}

/* ---------------- 컴파일 ---------------- */

function compileCard(sc) {
  const ready = sc.targets.length > 0 && sc.targets.every(t => t.thumb);
  const upToDate = sc.mind && sc.mind.count === sc.targets.length;

  return el('div', { class: 'card' }, [
    el('div', { class: 'card-hd' }, [
      el('h3', {}, ['📷 AR 타겟 컴파일']),
      upToDate
        ? el('span', { class: 'badge ok' }, ['준비됨'])
        : el('span', { class: 'badge danger' }, ['필요함']),
    ]),
    el('p', { class: 'muted small' }, [
      '등록한 이미지를 카메라가 알아볼 수 있는 형태로 변환합니다. 이미지를 추가·교체·삭제하거나 순서를 바꾸면 다시 실행하세요.',
    ]),
    sc.mind
      ? el('p', { class: 'tiny dim' }, [
          `마지막 컴파일: ${new Date(sc.mind.compiledAt).toLocaleString('ko-KR')} · 타겟 ${sc.mind.count}개 · ${fmtBytes(mindBytes(sc))}`,
        ])
      : null,
    el('button', {
      class: 'btn btn-primary btn-block btn-lg',
      disabled: !ready,
      style: { marginTop: '8px' },
      onclick: () => runCompile(sc),
    }, [ready ? (upToDate ? '🔄 다시 컴파일' : '⚡ 지금 컴파일하기') : '먼저 단서 이미지를 추가하세요']),
    el('p', { class: 'tiny dim center', style: { marginTop: '8px', marginBottom: '0' } },
      ['보통 몇 초면 끝납니다. 다만 브라우저를 연 뒤 첫 컴파일은 AR 엔진 준비 때문에 1~2분까지 걸릴 수 있습니다. 창을 닫지 마세요.']),
  ]);
}

async function runCompile(sc) {
  let cancelled = false;
  let started = false;
  const pctEl = el('div', { class: 'compile-pct' }, ['준비 중']);
  const barI = el('i', { style: { width: '0%' } });
  const msgEl = el('p', { class: 'muted small center' }, ['컴파일러를 불러오는 중…']);
  const elapsedEl = el('p', { class: 'tiny dim center' }, ['0초 경과']);

  const t0 = Date.now();
  const tick = setInterval(() => {
    elapsedEl.textContent = `${Math.round((Date.now() - t0) / 1000)}초 경과`;
  }, 500);

  const close = modal((box, closeFn) => {
    box.append(
      el('h3', { class: 'center' }, ['AR 타겟 컴파일 중']),
      el('div', { class: 'compile-box' }, [pctEl]),
      el('div', { class: 'bar' }, [barI]),
      msgEl,
      elapsedEl,
      el('button', {
        class: 'btn btn-ghost btn-block', style: { marginTop: '10px' },
        onclick: () => { cancelled = true; closeFn(); },
      }, ['취소']),
    );
  }, { closeOnBackdrop: false });

  const setPct = p => {
    if (!started) {
      started = true;
      msgEl.textContent = '이미지에서 특징점을 찾는 중…';
    }
    pctEl.textContent = `${Math.round(p)}%`;
    barI.style.width = `${p}%`;
  };

  try {
    await loadCompiler();

    // 브라우저를 연 뒤 첫 컴파일은 특징점 계산이 아니라 AR 엔진(WebGL 셰이더) 준비에
    // 대부분의 시간을 쓴다. 그동안 진행률이 0 에 머무르므로 멈춘 것처럼 보이지 않게 알린다.
    // (워밍업이 끝나면 이미지 5장이 2~5초면 끝난다)
    msgEl.textContent = 'AR 엔진을 준비하는 중… 브라우저를 연 뒤 첫 컴파일은 오래 걸립니다';

    const images = [];
    for (const t of sc.targets) images.push(await loadImage(t.thumb));
    if (cancelled) return;

    const buffer = await compileTargets(images, setPct);
    if (cancelled) return;

    sc.mind = {
      data: buffer,
      count: sc.targets.length,
      compiledAt: new Date().toISOString(),
    };
    await flush();
    close();
    render();
    toast('컴파일 완료! 이제 카메라로 인식할 수 있습니다.', 'ok', 3500);
  } catch (err) {
    close();
    toast(`컴파일 실패: ${err.message}`, 'err', 5000);
  } finally {
    clearInterval(tick);
  }
}

/* ---------------- 배포 ---------------- */

function publishCard(sc) {
  const v = validate(sc);
  const playUrl = new URL(`play.html?id=${sc.id}`, location.href).href;

  const checks = el('div', { class: 'check-list' });
  if (v.ok && !v.warns.length) {
    checks.append(el('div', { class: 'check-item ok' }, ['✅ 모든 준비가 끝났습니다. 배포할 수 있습니다.']));
  }
  v.errors.forEach(e2 => checks.append(el('div', { class: 'check-item err' }, [el('span', {}, ['⛔']), el('span', {}, [e2])])));
  v.warns.forEach(w => checks.append(el('div', { class: 'check-item warn' }, [el('span', {}, ['⚠️']), el('span', {}, [w])])));

  return el('div', { class: 'card' }, [
    el('div', { class: 'card-hd' }, [
      el('h3', {}, ['🚀 검사 & 배포']),
      v.ok ? el('span', { class: 'badge ok' }, ['통과']) : el('span', { class: 'badge danger' }, [`오류 ${v.errors.length}`]),
    ]),
    checks,

    el('hr', { class: 'hr' }),

    el('h4', { style: { fontSize: '14px' } }, ['① 이 기기에서 바로 해보기']),
    el('div', { class: 'link-box' }, [
      el('code', {}, [playUrl]),
      el('button', {
        class: 'btn btn-sm',
        onclick: () => navigator.clipboard?.writeText(playUrl)
          .then(() => toast('링크를 복사했습니다.', 'ok'))
          .catch(() => toast('복사에 실패했습니다.', 'err')),
      }, ['복사']),
    ]),
    el('p', { class: 'tiny dim', style: { marginTop: '6px' } },
      ['같은 브라우저에 저장된 시나리오를 엽니다. 다른 기기에서는 열리지 않습니다.']),

    el('h4', { style: { fontSize: '14px', marginTop: '18px' } }, ['② 학생 기기에 배포하기']),
    el('div', { class: 'stack' }, [
      el('button', { class: 'btn btn-primary btn-block', onclick: exportScenario }, ['📤 시나리오 파일 내보내기 (.json)']),
      el('div', { class: 'tiny dim', style: { lineHeight: '1.7' } }, [
        el('div', {}, ['1. 내려받은 파일을 이 프로젝트의 ']),
        el('code', { style: { color: 'var(--neon)' } }, ['scenarios/']),
        el('span', {}, [' 폴더에 넣습니다.']),
        el('div', {}, ['2. 학생에게 아래 주소를 알려줍니다.']),
        el('div', { class: 'mono', style: { color: 'var(--txt-2)', marginTop: '4px' } },
          [`play.html?src=scenarios/${safeName(sc.title)}.json`]),
        el('div', { style: { marginTop: '6px' } },
          ['※ 학생 기기 카메라를 쓰려면 HTTPS 주소여야 합니다 (GitHub Pages, ngrok 등).']),
      ]),
    ]),
  ]);
}

function safeName(s) {
  return String(s || 'scenario').trim().replace(/[\\/:*?"<>|\s]+/g, '-').slice(0, 40) || 'scenario';
}

async function exportScenario() {
  await flush();
  const sc = A.current;
  const json = JSON.stringify(toFile(sc), null, 2);
  download(`${safeName(sc.title)}.json`, json);
  toast(`내보냈습니다 (${fmtBytes(new Blob([json]).size)})`, 'ok');
}

/* ---------------- 이탈 경고 ---------------- */
window.addEventListener('beforeunload', e => {
  if (A.dirty) { e.preventDefault(); e.returnValue = ''; }
});

boot();
