/* ============================================================
   실물 인식 테스트
   ------------------------------------------------------------
   "학교에 원래 있는 물건을 그대로 AR 단서로 쓸 수 있는가?"
   를 교사가 현장에서 직접 재 보는 도구.

   MindAR 은 평면 이미지 매칭이라 입체물·반사면에서는 실패한다.
   되는지 안 되는지는 그 물건 앞에서 재 보는 수밖에 없어서,
   자세별 인식 유지율을 기록해 판정까지 내려 준다.
   ============================================================ */

import {
  $, el, toast, pickFile, readFileAsDataURL, resizeImage, scoreMarker, loadImage, uid,
} from './util.js';
import { ArEngine, loadArRuntime, loadCompiler, compileTargets, normalizeCameraError } from './ar.js';
import { AR_COLORS } from './model.js';

const POSES = [
  { name: '정면 · 50cm', desc: '대상 정면에서 팔 길이만큼 떨어져, 화면을 꽉 채우세요.' },
  { name: '정면 · 2m',   desc: '두세 걸음 물러나세요. 학생이 멀리서도 찾을 수 있는지 봅니다.' },
  { name: '왼쪽 45°',    desc: '왼쪽으로 비스듬히 서서 비추세요. 입체물은 보통 여기서 무너집니다.' },
  { name: '오른쪽 45°',  desc: '반대쪽에서도 같은 방식으로.' },
  { name: '움직이며',    desc: '천천히 걸으며, 손을 살짝 흔들며 비추세요. 실제 수업에 가장 가까운 조건입니다.' },
];

const L = {
  photos: [],        // { id, name, src, score, grade, label }
  mind: null,        // ArrayBuffer
  engine: null,
  mindUrl: null,
  stats: new Map(),  // photoId -> { found, lost, firstMs, activeSince, steps: [{test, held}] }
  active: null,      // 지금 재고 있는 사진 index
  step: 0,
  tickId: null,
  lastTick: 0,
};

/* ============================================================
   후보 사진
   ============================================================ */

function statFor(id) {
  if (!L.stats.has(id)) {
    L.stats.set(id, {
      found: 0, lost: 0, firstMs: null, activeSince: 0,
      steps: POSES.map(() => ({ test: 0, held: 0 })),
    });
  }
  return L.stats.get(id);
}

function renderShots() {
  const box = $('#shots');
  box.innerHTML = '';
  $('#shot-count').textContent = L.photos.length ? `${L.photos.length}장` : '';

  L.photos.forEach((p, i) => {
    box.append(el('div', { class: 'shot' }, [
      el('img', { src: p.src, alt: p.name }),
      el('div', { class: 'meta' }, [
        el('div', { class: 'nm', title: p.name }, [p.name]),
        el('div', { class: 'row spread' }, [
          el('span', { class: `score-pill ${p.grade}` }, [`예상 ${p.score}점`]),
          el('button', {
            class: 'icon-btn', 'aria-label': '삭제',
            onclick: () => { L.photos.splice(i, 1); L.mind = null; refresh(); },
          }, ['✕']),
        ]),
      ]),
    ]));
  });

  if (!L.photos.length) {
    box.append(el('p', { class: 'muted small', style: { margin: '0' } },
      ['아직 후보가 없습니다. 아래에서 사진을 올리세요.']));
  }
}

async function addShots(files = null) {
  const picked = files || await pickFile('image/*', true);
  if (!picked?.length) return;

  const busy = toast(`사진 ${picked.length}장 처리 중…`, '', 60000);
  for (const f of picked) {
    try {
      const src = await resizeImage(await readFileAsDataURL(f), 1024, 'image/jpeg', 0.88);
      const s = await scoreMarker(src);
      L.photos.push({
        id: uid('p'),
        name: f.name?.replace(/\.[^.]+$/, '') || `후보 ${L.photos.length + 1}`,
        src, score: s.score, grade: s.grade, label: s.label,
      });
    } catch (e) {
      toast(`${f.name}: ${e.message}`, 'err');
    }
  }
  busy.remove();
  L.mind = null;              // 사진이 바뀌었으니 재컴파일 필요
  L.stats.clear();
  refresh();
}

/* ============================================================
   컴파일
   ============================================================ */

async function runCompile() {
  const btn = $('#btn-compile');
  const bar = $('#compile-bar');
  const msg = $('#compile-msg');
  btn.disabled = true;

  const t0 = Date.now();
  let started = false;
  const tick = setInterval(() => {
    if (!started) msg.textContent = `AR 엔진을 준비하는 중… ${Math.round((Date.now() - t0) / 1000)}초 (첫 실행은 1~2분 걸립니다)`;
  }, 500);

  try {
    msg.textContent = '컴파일러를 불러오는 중…';
    await loadCompiler();

    const images = [];
    for (const p of L.photos) images.push(await loadImage(p.src));

    L.mind = await compileTargets(images, pct => {
      started = true;
      bar.style.width = `${pct}%`;
      msg.textContent = `특징점을 찾는 중… ${Math.round(pct)}%`;
    });

    bar.style.width = '100%';
    $('#compile-badge').className = 'badge ok';
    $('#compile-badge').textContent = '준비됨';
    msg.textContent = `완료 · 타겟 ${L.photos.length}개 · ${(L.mind.byteLength / 1048576).toFixed(1)}MB`;
    toast('컴파일 완료. 이제 그 물건 앞으로 가세요.', 'ok', 3500);
  } catch (err) {
    msg.textContent = `실패: ${err.message}`;
    toast(`컴파일 실패: ${err.message}`, 'err', 5000);
  } finally {
    clearInterval(tick);
    refresh();
  }
}

/* ============================================================
   현장 측정
   ============================================================ */

async function startProbe() {
  if (!L.mind) return;
  $('#btn-probe').disabled = true;

  try {
    await loadArRuntime();

    L.mindUrl = URL.createObjectURL(new Blob([L.mind], { type: 'application/octet-stream' }));

    const targets = L.photos.map((p, i) => ({
      id: p.id,
      name: p.name,
      ar: { emoji: '🎯', color: AR_COLORS[i % AR_COLORS.length].key, caption: '' },
      arImage: null,
    }));

    L.engine = new ArEngine($('#ar-root'), {
      onFound: i => {
        if (i !== L.active) {
          toast(`⚠️ 다른 후보 "${L.photos[i]?.name}" 가 인식되었습니다 — 두 사진이 서로 헷갈립니다`, 'err', 3000);
          return;
        }
        const s = statFor(L.photos[i].id);
        s.found++;
        if (s.firstMs === null) s.firstMs = performance.now() - s.activeSince;
      },
      onLost: i => { if (i === L.active) statFor(L.photos[i].id).lost++; },
      onError: err => { stopProbe(); toast(normalizeCameraError(err).message, 'err', 6000); },
    });

    targets.forEach((t, i) => L.engine.setCard(i, {
      state: 'quiz', title: t.name, body: '인식되고 있습니다.',
      emoji: '🎯', color: t.ar.color, badge: '추적 중', footer: '',
    }));

    await L.engine.start(L.mindUrl, targets);

    // 측정 UI
    const sel = $('#probe-target');
    sel.innerHTML = '';
    L.photos.forEach((p, i) => sel.append(el('option', { value: String(i) }, [p.name])));
    sel.onchange = () => setActive(Number(sel.value));

    $('#probe').hidden = false;
    setActive(0);

    L.lastTick = performance.now();
    L.tickId = setInterval(tick, 200);
    toast('사진을 찍은 그 물건을 비추세요', '', 3500);
  } catch (err) {
    toast(normalizeCameraError(err).message, 'err', 6000);
  } finally {
    $('#btn-probe').disabled = false;
  }
}

function setActive(i) {
  L.active = i;
  L.step = 0;
  const s = statFor(L.photos[i].id);
  s.activeSince = performance.now();
  $('#probe-target').value = String(i);
  renderPose();
}

function renderPose() {
  const p = POSES[L.step];
  $('#pose-step').textContent = `자세 ${L.step + 1} / ${POSES.length}`;
  $('#pose-name').textContent = p.name;
  $('#pose-desc').textContent = p.desc;
  $('#pose-next').textContent = L.step === POSES.length - 1
    ? '측정 끝내기 · 판정 보기'
    : '이 자세 완료 · 다음 →';
}

function nextPose() {
  if (L.step < POSES.length - 1) {
    L.step++;
    renderPose();
    return;
  }
  stopProbe();
}

function tick() {
  const now = performance.now();
  const dt = now - L.lastTick;
  L.lastTick = now;
  if (L.active === null || !L.engine) return;

  const s = statFor(L.photos[L.active].id);
  const cell = s.steps[L.step];
  cell.test += dt;

  const on = L.engine.isActive(L.active);
  if (on) cell.held += dt;

  $('#live-dot').classList.toggle('on', on);
  $('#g-ratio').textContent = cell.test > 800 ? `${Math.round((cell.held / cell.test) * 100)}%` : '—';
  $('#g-lost').textContent = String(s.lost);
  $('#g-first').textContent = s.firstMs === null ? '—' : `${(s.firstMs / 1000).toFixed(1)}초`;
}

function stopProbe() {
  clearInterval(L.tickId);
  L.tickId = null;
  L.engine?.destroy();
  L.engine = null;
  if (L.mindUrl) { URL.revokeObjectURL(L.mindUrl); L.mindUrl = null; }
  L.active = null;
  $('#probe').hidden = true;
  renderVerdict();
  $('#result-card')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/* ============================================================
   판정
   ============================================================ */

function summarize(p) {
  const s = L.stats.get(p.id);
  if (!s) return null;
  const test = s.steps.reduce((a, c) => a + c.test, 0);
  const held = s.steps.reduce((a, c) => a + c.held, 0);
  if (test < 8000) return { grade: 'none', label: '미측정', test, held, ratio: 0, s };

  const ratio = held / test;
  const lostPerMin = s.lost / (test / 60000);
  let grade = 'bad', label = '부적합';
  if (ratio >= 0.85 && lostPerMin <= 6) { grade = 'good'; label = '안정'; }
  else if (ratio >= 0.6) { grade = 'mid'; label = '보통'; }
  return { grade, label, test, held, ratio, lostPerMin, s };
}

function renderVerdict() {
  const rows = L.photos.map(p => ({ p, v: summarize(p) })).filter(r => r.v);
  if (!rows.length) return;

  $('#result-card').hidden = false;
  const t = $('#verdict');
  t.innerHTML = '';

  t.append(el('thead', {}, [
    el('tr', {}, [
      el('th', { style: { textAlign: 'left' } }, ['후보']),
      ...POSES.map(p => el('th', {}, [p.name])),
      el('th', {}, ['종합']),
    ]),
  ]));

  const body = el('tbody');
  for (const { p, v } of rows) {
    const cells = v.s.steps.map(c => {
      if (c.test < 3000) return el('td', { class: 'dim' }, ['—']);
      const pct = Math.round((c.held / c.test) * 100);
      const cls = pct >= 85 ? 'v-good' : pct >= 60 ? 'v-mid' : 'v-bad';
      return el('td', { class: cls }, [`${pct}%`]);
    });
    body.append(el('tr', {}, [
      el('td', { class: 'nm' }, [p.name]),
      ...cells,
      el('td', { class: v.grade === 'good' ? 'v-good' : v.grade === 'mid' ? 'v-mid' : 'v-bad' }, [v.label]),
    ]));
  }
  t.append(body);

  /* ---- 패턴을 읽어 조언 ---- */
  const notes = $('#verdict-notes');
  notes.innerHTML = '';
  const add = (kind, text) => notes.append(el('div', { class: `check-item ${kind}` }, [el('span', {}, [text])]));

  for (const { p, v } of rows) {
    if (v.grade === 'none') continue;
    const st = v.s.steps;
    const r = i => (st[i].test >= 3000 ? st[i].held / st[i].test : null);
    const front = r(0), far = r(1), left = r(2), right = r(3), move = r(4);

    const facing = Math.max(front ?? 0, far ?? 0);
    const angled = Math.min(left ?? 1, right ?? 1);

    if (v.grade === 'good') {
      add('ok', `"${p.name}" — 수업에 그대로 쓸 수 있습니다.`);
    } else if (facing >= 0.75 && angled < 0.5) {
      add('warn', `"${p.name}" — 정면에서만 인식됩니다. 입체물이거나 반사면일 가능성이 높습니다. 학생이 정면에 서도록 바닥에 표시를 하거나, 더 평평한 대상으로 바꾸세요.`);
    } else if (far !== null && far < 0.5 && front !== null && front >= 0.7) {
      add('warn', `"${p.name}" — 가까이서만 됩니다. 대상이 작거나 무늬가 잘아서 그렇습니다. 더 큰 대상을 고르거나 "50cm까지 다가가세요" 안내를 넣으세요.`);
    } else if (move !== null && move < 0.5) {
      add('warn', `"${p.name}" — 멈춰 있으면 되는데 움직이면 놓칩니다. 실제 수업에서는 불안정할 수 있습니다.`);
    } else if (v.grade === 'bad') {
      add('err', `"${p.name}" — 단서로 쓰기 어렵습니다. 더 평평하고 무늬가 빽빽한 대상(포스터·시간표·안내도)으로 바꾸세요.`);
    } else {
      add('warn', `"${p.name}" — 될 때도 있고 안 될 때도 있습니다. 조명을 밝게 하거나 더 나은 대상을 찾아보세요.`);
    }
  }

  const good = rows.filter(r => r.v.grade === 'good').length;
  add(good ? 'ok' : 'warn', good
    ? `${rows.length}개 중 ${good}개가 실물 단서로 쓸 만합니다. 제작 스튜디오에서 같은 사진을 올려 방탈출을 만드세요.`
    : '쓸 만한 후보가 아직 없습니다. 위 체크리스트를 참고해 더 평평하고 무늬가 많은 대상을 찍어 보세요.');
}

function resultText() {
  const lines = ['[AR 방탈출 · 실물 인식 테스트]', ''];
  for (const p of L.photos) {
    const v = summarize(p);
    if (!v) continue;
    lines.push(`${p.name} — ${v.label} (예상 ${p.score}점 / 실측 ${Math.round(v.ratio * 100)}%)`);
    v.s.steps.forEach((c, i) => {
      lines.push(`   ${POSES[i].name}: ${c.test < 3000 ? '미측정' : `${Math.round((c.held / c.test) * 100)}%`}`);
    });
    lines.push(`   놓친 횟수 ${v.s.lost}회 · 첫 인식 ${v.s.firstMs === null ? '실패' : `${(v.s.firstMs / 1000).toFixed(1)}초`}`);
    lines.push('');
  }
  return lines.join('\n');
}

/* ============================================================
   화면 갱신 / 부트
   ============================================================ */

function refresh() {
  renderShots();
  const ready = L.photos.length > 0;
  $('#btn-compile').disabled = !ready;
  $('#btn-probe').disabled = !L.mind;

  if (!ready) {
    $('#compile-msg').textContent = '사진을 먼저 올리세요.';
  } else if (!L.mind) {
    $('#compile-badge').className = 'badge danger';
    $('#compile-badge').textContent = '필요함';
    $('#compile-bar').style.width = '0%';
    $('#compile-msg').textContent = `후보 ${L.photos.length}장을 컴파일하세요.`;
  }
}

function boot() {
  const drop = $('#drop');
  drop.onclick = () => addShots();
  drop.ondragover = e => { e.preventDefault(); drop.classList.add('over'); };
  drop.ondragleave = () => drop.classList.remove('over');
  drop.ondrop = e => {
    e.preventDefault();
    drop.classList.remove('over');
    const files = [...e.dataTransfer.files].filter(f => f.type.startsWith('image/'));
    if (files.length) addShots(files);
  };

  $('#btn-compile').onclick = runCompile;
  $('#btn-probe').onclick = startProbe;
  $('#pose-next').onclick = nextPose;
  $('#probe-exit').onclick = stopProbe;

  $('#btn-copy').onclick = () => navigator.clipboard?.writeText(resultText())
    .then(() => toast('결과를 복사했습니다.', 'ok'))
    .catch(() => toast('복사에 실패했습니다.', 'err'));

  $('#btn-reset').onclick = () => {
    L.stats.clear();
    $('#result-card').hidden = true;
    toast('측정 기록을 지웠습니다.');
  };

  refresh();
}

boot();
