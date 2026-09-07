/* ============================================================
   저장소 — IndexedDB (시나리오 본체) + localStorage (플레이 진행상황)
   .mind 바이너리와 이미지 dataURL 때문에 용량이 커서 IndexedDB 를 쓴다.
   ============================================================ */

import { migrate } from './model.js';

const DB_NAME = 'ar-escape';
const DB_VER = 1;
const STORE = 'scenarios';

let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((res, rej) => {
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
  return dbPromise;
}

function tx(mode, fn) {
  return openDB().then(db => new Promise((res, rej) => {
    const t = db.transaction(STORE, mode);
    const store = t.objectStore(STORE);
    let result;
    try { result = fn(store); } catch (e) { rej(e); return; }
    t.oncomplete = () => res(result?.result ?? result);
    t.onerror = () => rej(t.error);
    t.onabort = () => rej(t.error);
  }));
}

export async function listScenarios() {
  const all = await tx('readonly', s => s.getAll());
  return (all || [])
    .map(migrate)
    .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
}

export async function getScenario(id) {
  const raw = await tx('readonly', s => s.get(id));
  return raw ? migrate(raw) : null;
}

export async function saveScenario(scenario) {
  const rec = { ...scenario, updatedAt: new Date().toISOString() };
  // IndexedDB 는 구조화 복제를 하므로 JSON 왕복 딥카피가 필요 없다.
  // (수 MB 짜리 .mind 를 문자열로 두 번 오가는 비용이 컸다)
  await tx('readwrite', s => s.put(rec));
  return rec;
}

export async function deleteScenario(id) {
  await tx('readwrite', s => s.delete(id));
}

/* ---------------- 플레이 진행상황 (localStorage) ---------------- */

const PROGRESS_KEY = id => `ar-escape:progress:${id}`;
const LAST_KEY = 'ar-escape:last-scenario';
const TEAM_KEY = 'ar-escape:team';

export function loadProgress(scenarioId) {
  try {
    const raw = localStorage.getItem(PROGRESS_KEY(scenarioId));
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

export function saveProgress(scenarioId, progress) {
  try {
    localStorage.setItem(PROGRESS_KEY(scenarioId), JSON.stringify(progress));
  } catch { /* 용량 초과 무시 */ }
}

export function clearProgress(scenarioId) {
  try { localStorage.removeItem(PROGRESS_KEY(scenarioId)); } catch { /* 무시 */ }
}

export function rememberLast(id) {
  try { localStorage.setItem(LAST_KEY, id); } catch { /* 무시 */ }
}

export function recallLast() {
  try { return localStorage.getItem(LAST_KEY); } catch { return null; }
}

export function rememberTeam(name) {
  try { localStorage.setItem(TEAM_KEY, name); } catch { /* 무시 */ }
}

export function recallTeam() {
  try { return localStorage.getItem(TEAM_KEY) || ''; } catch { return ''; }
}

/* ---------------- 기록(리더보드) ---------------- */

const RECORDS_KEY = id => `ar-escape:records:${id}`;

export function addRecord(scenarioId, record) {
  try {
    const list = listRecords(scenarioId);
    list.push(record);
    list.sort((a, b) => a.elapsedMs - b.elapsedMs);
    localStorage.setItem(RECORDS_KEY(scenarioId), JSON.stringify(list.slice(0, 50)));
  } catch { /* 무시 */ }
}

export function listRecords(scenarioId) {
  try {
    const raw = localStorage.getItem(RECORDS_KEY(scenarioId));
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

