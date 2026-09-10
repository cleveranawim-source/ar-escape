/* ============================================================
   실시간 진행 공유 — Firebase Realtime Database
   ------------------------------------------------------------
   Firebase JS SDK 를 쓰지 않는다. 쓰기는 fetch(PATCH) 한 번,
   읽기는 EventSource(SSE) 하나면 끝나는데, SDK 를 붙이면
   학생 기기 30대가 100KB 를 더 내려받아야 하기 때문이다.

   설정: 아래 DB_URL 에 Realtime Database 주소를 넣으면 켜진다.
   비워 두면 전송 코드가 아예 돌지 않고 게임은 지금과 똑같이 동작한다.
   ============================================================ */

export const DB_URL = 'https://ar-roomescape-default-rtdb.asia-southeast1.firebasedatabase.app';

export const liveEnabled = () => !!DB_URL;

/** Firebase 키에 쓸 수 없는 문자를 없앤다 (.$#[]/ 와 공백) */
export function safeKey(s) {
  return String(s ?? '').trim().replace(/[.$#[\]/\s]+/g, '-').slice(0, 24) || '무명';
}

const roomBase = room => `${DB_URL.replace(/\/+$/, '')}/rooms/${safeKey(room)}`;

/**
 * 학생 기기용 전송기. 방 코드나 모둠 이름이 없으면 null → 아무것도 보내지 않는다.
 * @param {object} o { room, team, meta }
 */
export function createReporter({ room, team, meta } = {}) {
  if (!DB_URL || !room || !team) return null;

  const url = `${roomBase(room)}/teams/${safeKey(team)}.json`;
  let pending = null;
  let sending = false;
  let fails = 0;
  let retryTimer = null;

  // 방 정보는 한 번만 (대시보드 제목용)
  if (meta) {
    fetch(`${roomBase(room)}/meta.json`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...meta, at: Date.now() }),
    }).catch(() => { /* 전송 실패가 게임을 막으면 안 된다 */ });
  }

  async function flush() {
    if (sending || !pending) return;
    sending = true;
    const body = pending;
    pending = null;
    let ok = false;
    try {
      const res = await fetch(url, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        keepalive: true,
      });
      if (!res.ok) throw new Error(String(res.status));
      fails = 0;
      ok = true;
    } catch {
      // 야외에서 와이파이가 오락가락한다. 실패한 내용을 버리면 그 팀은
      // 다음에 뭔가 풀 때까지 현황판에 멈춰 있으므로, 되돌려 넣고 다시 시도한다.
      // 그 사이 들어온 새 값이 우선이다.
      fails++;
      pending = { ...body, ...(pending || {}) };
      clearTimeout(retryTimer);
      retryTimer = setTimeout(flush, Math.min(15000, 1000 * 2 ** Math.min(fails, 4)));
    }
    sending = false;
    // 성공했을 때만 곧바로 이어서 보낸다. 실패한 경우까지 여기서 다시 부르면
    // 오프라인처럼 fetch 가 즉시 거절될 때 지연 없는 무한 재귀가 되어 화면이 멈춘다.
    if (ok && pending) flush();
  }

  return {
    /** 부분 갱신. 연달아 부르면 합쳐서 한 번만 나간다. */
    push(patch) {
      pending = { ...(pending || {}), ...patch, at: Date.now() };
      flush();
    },
    get failCount() { return fails; },
  };
}

/* ============================================================
   교사용 구독 — SSE 로 방 전체를 실시간으로 받는다
   ============================================================ */

function setPath(root, path, value) {
  const parts = path.split('/').filter(Boolean);
  if (!parts.length) return value ?? {};
  let node = root;
  for (const p of parts.slice(0, -1)) {
    if (typeof node[p] !== 'object' || node[p] === null) node[p] = {};
    node = node[p];
  }
  const last = parts[parts.length - 1];
  if (value === null || value === undefined) delete node[last];
  else node[last] = value;
  return root;
}

function mergePath(root, path, value) {
  const parts = path.split('/').filter(Boolean);
  let node = root;
  for (const p of parts) {
    if (typeof node[p] !== 'object' || node[p] === null) node[p] = {};
    node = node[p];
  }
  for (const [k, v] of Object.entries(value || {})) {
    if (v === null) delete node[k];
    else node[k] = v;
  }
  return root;
}

/**
 * 방을 구독한다. 새 값이 올 때마다 onState 로 방 전체를 넘긴다.
 * @returns {{close:()=>void}}
 */
export function watchRoom(room, onState, onStatus = () => {}) {
  let state = {};
  const src = new EventSource(`${roomBase(room)}.json`);

  src.addEventListener('open', () => onStatus(null));
  src.addEventListener('error', () => onStatus('연결이 끊겼습니다. 자동으로 다시 시도합니다…'));

  const apply = (fn) => e => {
    const { path, data } = JSON.parse(e.data);
    state = fn(state, path, data);
    onStatus(null);
    onState(state);
  };
  src.addEventListener('put', apply(setPath));
  src.addEventListener('patch', apply(mergePath));

  return { close: () => src.close() };
}

/* ============================================================
   복귀 시각 — 야외 활동에서 "언제 교실로 돌아오나"
   ------------------------------------------------------------
   경과 시간이 아니라 절대 시각을 공유한다. 그래야 튕겨서 다시 들어와도,
   늦게 시작해도, 새로고침해도 모두 같은 시각에 돌아온다.
   ============================================================ */

/* 기기 시계가 틀어져 있어도 복귀 시각이 어긋나지 않도록 서버 시계와의 차이를 재 둔다.
   Firebase 응답의 Date 헤더는 CORS 기본 허용이라 그냥 읽을 수 있다. (초 단위면 충분) */
let clockOffset = 0;
export const serverNow = () => Date.now() + clockOffset;

/** 방 설정을 한 번 읽는다. 학생 기기가 주기적으로 불러 복귀 시각을 받아 간다. */
export async function fetchRoomMeta(room) {
  if (!DB_URL || !room) return null;
  const res = await fetch(`${roomBase(room)}/meta.json`, { cache: 'no-store' });
  const at = Date.parse(res.headers.get('Date') || '');
  if (Number.isFinite(at)) clockOffset = at - Date.now();
  if (!res.ok) throw new Error(String(res.status));
  return await res.json();
}

/** 복귀 시각을 정한다. null 이면 해제. */
export async function setReturnAt(room, ts) {
  const res = await fetch(`${roomBase(room)}/meta.json`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ returnAt: ts ?? null }),
  });
  if (!res.ok) throw new Error(`복귀 시각을 저장하지 못했습니다 (${res.status})`);
}

/**
 * 접속 가능한지 미리 확인한다. EventSource 는 HTTP 상태를 알려주지 않아서,
 * 규칙이 잠겨 있을 때 "연결이 끊겼습니다" 로만 보이면 원인을 알 수 없다.
 * @returns {Promise<null|'rules'|'network'|string>}
 */
export async function checkAccess(room) {
  if (!DB_URL) return 'setup';
  try {
    const res = await fetch(`${roomBase(room || '_probe')}.json?shallow=true`);
    if (res.status === 401 || res.status === 403) return 'rules';
    if (!res.ok) return `서버가 ${res.status} 를 돌려주었습니다.`;
    return null;
  } catch {
    return 'network';
  }
}

/** 방 기록을 통째로 지운다 (다음 반 시작 전) */
export async function clearRoom(room) {
  const res = await fetch(`${roomBase(room)}.json`, { method: 'DELETE' });
  if (!res.ok) throw new Error(`삭제 실패 (${res.status})`);
}
