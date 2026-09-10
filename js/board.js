/* ============================================================
   교사용 실시간 현황판
   ------------------------------------------------------------
   방을 SSE 로 구독해 모둠별 진행 상황을 보여준다.
   교실 앞 화면에 띄워 두고 쓸 수 있게 큼직하게 그린다.
   ============================================================ */

import { $, el, toast, fmtClock, confirmDialog } from './util.js';
import { DB_URL, liveEnabled, watchRoom, clearRoom } from './live.js';

const ROOM_KEY = 'ar-escape:board-room';
const SRC_KEY = 'ar-escape:board-src';

/* 막힘 판정 — 한 문제에서 3번 넘게 틀렸거나 3분 넘게 붙어 있으면 */
const STUCK_TRIES = 3;
const STUCK_MS = 180000;
/* 이 시간 넘게 소식이 없으면 태블릿이 꺼졌거나 자리를 뜬 것 */
const STALE_MS = 90000;

const B = {
  room: null,
  watcher: null,
  state: {},
  /** 팀별로 값을 받은 로컬 시각 — 기기 간 시계 차이를 피하려고 여기서부터 이어 센다 */
  seenAt: new Map(),
  tickId: null,
};

/* ============================================================
   구독
   ============================================================ */

function connect(room) {
  B.watcher?.close();
  B.state = {};
  B.seenAt.clear();
  B.room = room;
  render();

  if (!liveEnabled() || !room) { setConn('off', liveEnabled() ? '방 코드를 입력하세요' : '설정 필요'); return; }

  setConn('', '연결 중…');
  B.watcher = watchRoom(room, state => {
    const now = Date.now();
    for (const name of Object.keys(state.teams || {})) {
      const prev = B.state.teams?.[name];
      const cur = state.teams[name];
      if (!prev || prev.at !== cur.at) B.seenAt.set(name, now);
    }
    B.state = state;
    setConn('on', '연결됨');
    render();
  }, err => {
    if (err) setConn('off', err);
    else setConn('on', '연결됨');
  });
}

function setConn(cls, text) {
  const c = $('#conn');
  c.className = `conn ${cls}`;
  $('#conn-text').textContent = text;
}

/* ============================================================
   그리기
   ============================================================ */

function teamRows() {
  const teams = B.state.teams || {};
  const now = Date.now();
  return Object.entries(teams).map(([key, t]) => {
    const seen = B.seenAt.get(key) || now;
    const running = !t.finished;
    // 보낸 시점의 경과 + 그 값을 받은 뒤 흐른 시간
    const elapsed = running ? (t.elapsedMs || 0) + (now - seen) : (t.elapsedMs || 0);
    const stuck = running && ((t.tries || 0) >= STUCK_TRIES || (t.since && now - t.since > STUCK_MS));
    return {
      key,
      name: t.name || key,
      solved: t.solved || 0,
      total: t.total || 0,
      bonus: t.bonus || 0,
      bonusTotal: t.bonusTotal || 0,
      hints: t.hints || 0,
      current: t.current || null,
      currentBonus: !!t.currentBonus,
      tries: t.tries || 0,
      finished: !!t.finished,
      escaped: !!t.escaped,
      mode: t.mode,
      elapsed,
      stuck,
      stale: running && now - seen > STALE_MS,
    };
  }).sort((a, b) => {
    if (a.escaped !== b.escaped) return a.escaped ? -1 : 1;       // 탈출한 팀 먼저
    if (a.escaped && b.escaped) return a.elapsed - b.elapsed;      // 빠른 순
    if (a.solved !== b.solved) return b.solved - a.solved;         // 많이 푼 순
    return a.elapsed - b.elapsed;
  });
}

function render() {
  const rows = teamRows();
  const box = $('#teams');
  box.innerHTML = '';
  $('#empty').hidden = rows.length > 0;

  $('#t-teams').textContent = String(rows.length);
  $('#t-escaped').textContent = String(rows.filter(r => r.escaped).length);
  $('#t-bonus').textContent = String(rows.filter(r => r.bonus > 0).length);
  $('#t-stuck').textContent = String(rows.filter(r => r.stuck).length);

  let rank = 0;
  for (const r of rows) {
    if (r.escaped) rank++;
    const pct = r.total ? Math.round((r.solved / r.total) * 100) : 0;

    const status = r.escaped
      ? el('span', { class: 'badge gold' }, ['🎉 탈출 성공'])
      : r.finished
        ? el('span', { class: 'badge' }, ['종료'])
        : r.stale
          ? el('span', { class: 'badge gray' }, ['신호 없음'])
          : r.stuck
            ? el('span', { class: 'badge danger' }, ['막힘'])
            : el('span', { class: 'badge ok' }, ['진행 중']);

    box.append(el('div', {
      class: `team${r.escaped ? ' escaped' : ''}${r.stuck ? ' stuck' : ''}${r.stale ? ' stale' : ''}`,
    }, [
      el('div', { class: 'team-hd' }, [
        r.escaped ? el('span', { class: 'rank' }, [`${rank}위`]) : null,
        el('span', { class: 'team-name' }, [r.name]),
        el('span', { class: 'team-time' }, [fmtClock(r.elapsed)]),
      ]),

      el('div', { class: 'bar' }, [el('i', { style: { width: `${pct}%` } })]),

      el('div', { class: 'team-row' }, [
        status,
        el('span', { class: 'mono', style: { fontWeight: '800' } }, [`${r.solved} / ${r.total}`]),
        r.bonusTotal ? el('span', { class: r.bonus ? 'badge gold' : 'badge gray' },
          [r.bonus ? '🎁 보너스 성공' : '🎁 미도전']) : null,
        r.hints ? el('span', { class: 'tiny dim' }, [`힌트 ${r.hints}회`]) : null,
        r.mode === 'sim' ? el('span', { class: 'tiny dim' }, ['연습 모드']) : null,
      ]),

      r.current && !r.finished
        ? el('div', { class: 'team-row', style: { marginTop: '8px' } }, [
            el('span', { class: 'now' }, [
              `${r.currentBonus ? '🎁 ' : '📍 '}${r.current}`,
              r.tries ? ` · ${r.tries}번째 시도` : ' · 여는 중',
            ]),
          ])
        : null,
    ]));
  }
}

/* 경과 시간을 1초마다 다시 그린다 (진행 중인 팀이 있을 때만) */
function startTick() {
  clearInterval(B.tickId);
  B.tickId = setInterval(() => {
    if (Object.keys(B.state.teams || {}).length) render();
  }, 1000);
}

/* ============================================================
   방 설정
   ============================================================ */

function studentLink() {
  const room = $('#f-room').value.trim();
  const src = $('#f-src').value.trim() || 'scenarios/maum-room.json';
  if (!room) return null;
  const u = new URL('play.html', location.href);
  u.searchParams.set('src', src);
  u.searchParams.set('room', room);
  return u.href;
}

function refreshLink() {
  const link = studentLink();
  $('#student-link').textContent = link || '방 코드를 입력하세요';
  $('#btn-copy').disabled = !link;
}

function boot() {
  $('#setup-card').hidden = liveEnabled();

  const params = new URLSearchParams(location.search);
  $('#f-room').value = params.get('room') || localStorage.getItem(ROOM_KEY) || '';
  $('#f-src').value = params.get('src') || localStorage.getItem(SRC_KEY) || 'scenarios/maum-room.json';
  refreshLink();

  let debounce = null;
  const onRoomChange = () => {
    refreshLink();
    localStorage.setItem(ROOM_KEY, $('#f-room').value.trim());
    clearTimeout(debounce);
    debounce = setTimeout(() => connect($('#f-room').value.trim()), 400);
  };
  $('#f-room').oninput = onRoomChange;
  $('#f-src').oninput = () => { refreshLink(); localStorage.setItem(SRC_KEY, $('#f-src').value.trim()); };

  $('#btn-copy').onclick = () => {
    const link = studentLink();
    if (!link) return;
    navigator.clipboard?.writeText(link)
      .then(() => toast('학생용 주소를 복사했습니다.', 'ok'))
      .catch(() => toast('복사에 실패했습니다.', 'err'));
  };

  $('#btn-clear').onclick = async () => {
    const room = $('#f-room').value.trim();
    if (!room) return;
    if (!await confirmDialog('기록 지우기', `"${room}" 방의 모둠 기록을 모두 지울까요? 되돌릴 수 없습니다.`,
      { okLabel: '지우기', danger: true })) return;
    try {
      await clearRoom(room);
      B.state = {};
      B.seenAt.clear();
      render();
      toast('지웠습니다. 다음 반을 시작하세요.', 'ok');
    } catch (e) {
      toast(e.message, 'err');
    }
  };

  connect($('#f-room').value.trim());
  startTick();
}

boot();
