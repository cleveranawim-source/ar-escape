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
    try {
      const res = await fetch(url, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        keepalive: true,
      });
      if (!res.ok) throw new Error(String(res.status));
      fails = 0;
    } catch {
      fails++;
    }
    sending = false;
    if (pending) flush();
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
