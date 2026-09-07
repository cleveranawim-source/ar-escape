/* ============================================================
   인쇄용 마커 생성 페이지
   ============================================================ */

import { $, el, toast, download, scoreMarker } from './util.js';
import { drawMarker } from './markers-draw.js';

const state = {
  count: 6,
  seedBase: 20260906,
  labels: [],
};

function labelFor(i) {
  return state.labels[i]?.trim() || `${i + 1}`;
}

/* 한 글자 칠 때마다 마커 12장을 다시 그리고 Sobel 채점까지 돌면 입력이 버벅인다.
   → 렌더는 디바운스하고, 뒤늦게 끝난 채점 결과는 토큰으로 버린다. */
let renderTimer = null;
let renderToken = 0;

function scheduleRender() {
  clearTimeout(renderTimer);
  renderTimer = setTimeout(renderAll, 220);
}

function renderAll() {
  const token = ++renderToken;
  const grid = $('#marker-grid');
  grid.innerHTML = '';

  for (let i = 0; i < state.count; i++) {
    const cv = el('canvas');
    drawMarker(cv, {
      seed: state.seedBase + i * 7919,
      label: labelFor(i),
      sub: $('#f-sub').value.trim(),
      palette: i,
    });

    const scoreSlot = el('span', { class: 'badge gray' }, ['측정 중…']);

    grid.append(el('div', { class: 'marker-item' }, [
      cv,
      el('div', { class: 'cap row spread', style: { marginTop: '9px' } }, [
        el('span', { style: { fontWeight: '700', fontSize: '13px' } }, [`${labelFor(i)}번 마커`]),
        scoreSlot,
      ]),
      el('div', { class: 'row no-print', style: { marginTop: '8px' } }, [
        el('button', { class: 'btn btn-sm grow', onclick: () => downloadOne(cv, i) }, ['PNG 저장']),
      ]),
    ]));

    // 인식 적합도 측정
    scoreMarker(cv.toDataURL('image/png')).then(s => {
      if (token !== renderToken) return;
      scoreSlot.className = `badge ${s.grade === 'good' ? 'ok' : s.grade === 'bad' ? 'danger' : 'gold'}`;
      scoreSlot.textContent = `인식 ${s.score}점 · ${s.label}`;
    }).catch(() => { if (token === renderToken) scoreSlot.textContent = '—'; });
  }
}

function downloadOne(cv, i) {
  cv.toBlob(b => download(`marker-${labelFor(i)}.png`, b, 'image/png'), 'image/png');
}

async function downloadAll() {
  const canvases = [...document.querySelectorAll('#marker-grid canvas')];
  toast(`${canvases.length}장을 저장합니다… 브라우저가 "여러 파일 다운로드"를 물어보면 허용하세요.`, '', 5000);
  for (let i = 0; i < canvases.length; i++) {
    await new Promise(res => {
      canvases[i].toBlob(b => {
        download(`marker-${labelFor(i)}.png`, b, 'image/png');
        setTimeout(res, 400);
      }, 'image/png');
    });
  }
  toast('저장 완료. 제작 스튜디오에서 이 파일들을 업로드하세요.', 'ok', 4200);
}

function boot() {
  $('#f-count').oninput = e => {
    state.count = Math.max(1, Math.min(12, Number(e.target.value) || 1));
    scheduleRender();
  };
  $('#f-sub').oninput = scheduleRender;
  $('#f-labels').oninput = e => {
    state.labels = e.target.value.split(',').map(s => s.trim());
    scheduleRender();
  };
  $('#btn-reroll').onclick = () => {
    state.seedBase = Math.floor(Math.random() * 1e9);
    renderAll();
  };
  $('#btn-all').onclick = downloadAll;
  document.querySelectorAll('[data-print]').forEach(b => { b.onclick = () => window.print(); });
  renderAll();
}

boot();
