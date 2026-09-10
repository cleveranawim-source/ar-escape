/* ============================================================
   교사용 실시간 현황판
   ------------------------------------------------------------
   방을 SSE 로 구독해 모둠별 진행 상황을 보여준다.
   교실 앞 화면에 띄워 두고 쓸 수 있게 큼직하게 그린다.
   ============================================================ */

import { $, el, toast, fmtClock, confirmDialog } from './util.js';
import { DB_URL, liveEnabled, watchRoom, clearRoom, checkAccess } from './live.js';

const ROOM_KEY = 'ar-escape:board-room';
const SRC_KEY = 'ar-escape:board-src';

/* 막힘 판정 — 한 문제에서 3번 넘게 틀렸거나 3분 넘게 붙어 있으면 */
const STUCK_TRIES = 3;
const STUCK_MS = 180000;
/* 이 시간 넘게 소식이 없으면 정말 끊긴 것.
   학생 기기가 25초마다 신호를 보내므로 네 번 넘게 빠진 셈이다.
   야외에서 와이파이가 오락가락하는 걸 감안해 넉넉히 잡는다. */
const STALE_MS = 120000;

const B = {
  room: null,
  watcher: null,
  state: {},
  tickId: null,
};

/* ============================================================
   구독
   ============================================================ */

async function connect(room) {
  B.watcher?.close();
  B.state = {};
  B.room = room;
  render();

  if (!liveEnabled() || !room) { setConn('off', liveEnabled() ? '방 코드를 입력하세요' : '설정 필요'); return; }

  setConn('', '연결 중…');

  // 규칙이 잠겨 있으면 EventSource 는 그냥 실패만 알려준다 → 먼저 짚어 준다
  const problem = await checkAccess(room);
  $('#rules-card').hidden = problem !== 'rules';
  if (problem === 'rules') {
    setConn('off', '데이터베이스 규칙이 잠겨 있습니다');
    return;
  }
  if (problem === 'network') { setConn('off', '네트워크에 연결할 수 없습니다'); return; }
  if (problem) { setConn('off', problem); return; }
  B.watcher = watchRoom(room, state => {
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
    const running = !t.finished;
    // 값을 "받은 시각" 이 아니라 학생이 "보낸 시각(at)" 을 기준으로 센다.
    // 받은 시각을 쓰면 현황판을 새로고침할 때마다 기준이 지금으로 초기화되어,
    // 한동안 조용했던 조의 시간이 그만큼 뒤로 감긴다.
    const sentAgo = Math.min(Math.max(0, now - (t.at || now)), 6 * 3600000);
    const elapsed = running ? (t.elapsedMs || 0) + sentAgo : (t.elapsedMs || 0);
    // 문제를 열어 둔 상태에서만 "오래 붙잡고 있음" 을 따진다.
    // 닫고 마커를 찾아 돌아다니는 중까지 막힘으로 잡으면 야외 활동에서는 거의 다 빨개진다.
    const stuck = running && !!t.current
      && ((t.tries || 0) >= STUCK_TRIES || (t.since && now - t.since > STUCK_MS));
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
      stale: running && sentAgo > STALE_MS,
      quietMin: Math.max(1, Math.floor(sentAgo / 60000)),
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
          ? el('span', { class: 'badge gray' }, [`신호 끊김 · ${r.quietMin}분째`])
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

const RULES = `{
  "rules": {
    "rooms": {
      "$room": {
        ".read": "$room.length <= 24",
        ".write": "$room.length <= 24",
        "meta": {
          "title": { ".validate": "newData.isString() && newData.val().length <= 60" },
          "$f": { ".validate": "newData.isNumber()" }
        },
        "teams": {
          "$team": {
            ".validate": "$team.length <= 24 && newData.hasChildren(['name'])",
            "name":       { ".validate": "newData.isString() && newData.val().length <= 24" },
            "current":    { ".validate": "newData.isString() && newData.val().length <= 40" },
            "lastSolved": { ".validate": "newData.isString() && newData.val().length <= 40" },
            "mode":       { ".validate": "newData.isString() && newData.val().length <= 8" },
            "reason":     { ".validate": "newData.isString() && newData.val().length <= 16" },
            "$f":         { ".validate": "newData.isNumber() || newData.isBoolean()" }
          }
        }
      }
    }
  }
}`;

function boot() {
  $('#setup-card').hidden = liveEnabled();
  $('#rules-json').textContent = RULES;
  $('#btn-copy-rules').onclick = () => navigator.clipboard?.writeText(RULES)
    .then(() => toast('규칙을 복사했습니다. Firebase 콘솔 → 규칙 탭에 붙여넣고 게시하세요.', 'ok', 4500))
    .catch(() => toast('복사에 실패했습니다.', 'err'));

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
    B.state = {};
    if (!await confirmDialog('기록 지우기', `"${room}" 방의 모둠 기록을 모두 지울까요? 되돌릴 수 없습니다.`,
      { okLabel: '지우기', danger: true })) return;
    try {
      await clearRoom(room);
      B.state = {};
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
