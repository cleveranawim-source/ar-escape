/* ============================================================
   공용 유틸 — 토스트, DOM, 포맷, 파일 I/O
   ============================================================ */

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of [].concat(children)) {
    if (c === null || c === undefined || c === false) continue;
    node.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return node;
}

/* ---------------- 토스트 ---------------- */
let toastHost = null;
export function toast(msg, kind = '', ms = 2600) {
  if (!toastHost) {
    toastHost = document.getElementById('toast-host')
      || document.body.appendChild(el('div', { id: 'toast-host' }));
  }
  const t = el('div', { class: `toast ${kind}`, text: msg });
  toastHost.append(t);
  setTimeout(() => {
    t.classList.add('out');
    setTimeout(() => t.remove(), 260);
  }, ms);
  return t;
}

/* ---------------- 모달 ---------------- */
export function modal(builder, { closeOnBackdrop = true, onClose } = {}) {
  const back = el('div', { class: 'modal-back' });
  const box = el('div', { class: 'modal' });
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    back.remove();
    document.removeEventListener('keydown', onKey);
    onClose?.();
  };
  const onKey = e => { if (e.key === 'Escape') close(); };
  back.append(box);
  if (closeOnBackdrop) back.addEventListener('click', e => { if (e.target === back) close(); });
  document.addEventListener('keydown', onKey);
  builder(box, close);
  document.body.append(back);
  return close;
}

export function confirmDialog(title, message, { okLabel = '확인', danger = false } = {}) {
  return new Promise(resolve => {
    let answer = false;
    modal((box, close) => {
      box.append(
        el('h3', { text: title }),
        el('p', { class: 'muted', text: message }),
        el('div', { class: 'row spread', style: { marginTop: '18px' } }, [
          el('button', { class: 'btn btn-ghost', onclick: close }, ['취소']),
          el('button', {
            class: danger ? 'btn btn-danger' : 'btn btn-primary',
            onclick: () => { answer = true; close(); },
          }, [okLabel]),
        ]),
      );
    }, { onClose: () => resolve(answer) });
  });
}

/* ---------------- 포맷 ---------------- */
export const pad2 = n => String(n).padStart(2, '0');

export function fmtClock(ms) {
  const total = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0 ? `${h}:${pad2(m)}:${pad2(s)}` : `${pad2(m)}:${pad2(s)}`;
}

export function fmtBytes(n) {
  if (!n) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(u.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  return `${(n / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${u[i]}`;
}

export const uid = (p = 'id') =>
  `${p}_${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36).slice(-4)}`;

/* 정답 비교용 정규화: 공백/대소문자/문장부호 무시 */
export function normalizeAnswer(s) {
  return String(s ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[.,!?~"'`·\-_/\\()[\]{}]/g, '');
}

/* ---------------- 파일 I/O ---------------- */
export function readFileAsDataURL(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = () => rej(r.error);
    r.readAsDataURL(file);
  });
}

export function readFileAsText(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = () => rej(r.error);
    r.readAsText(file);
  });
}

export function loadImage(src) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => res(img);
    img.onerror = () => rej(new Error('이미지를 불러오지 못했습니다.'));
    img.src = src;
  });
}

export function download(filename, blobOrString, mime = 'application/json') {
  const blob = blobOrString instanceof Blob
    ? blobOrString
    : new Blob([blobOrString], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = el('a', { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

export function pickFile(accept = '', multiple = false) {
  return new Promise(res => {
    // display:none 이면 iOS Safari 가 프로그램 click() 을 무시한다 → 화면 밖에 두되 레이아웃에는 남긴다
    const input = el('input', {
      type: 'file', accept, multiple,
      style: { position: 'fixed', left: '-9999px', top: '0', width: '1px', height: '1px', opacity: '0' },
    });
    input.addEventListener('change', () => {
      res(multiple ? [...input.files] : input.files[0] || null);
      input.remove();
    });
    document.body.append(input);
    input.click();
  });
}

/* base64 <-> ArrayBuffer (mind 파일 직렬화용) */
export function bufToBase64(buf) {
  const bytes = new Uint8Array(buf);
  let bin = '';
  const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
  }
  return btoa(bin);
}

export function base64ToBuf(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

/* ---------------- 이미지 처리 ---------------- */

/** 긴 변을 max 로 리사이즈한 dataURL 반환 */
export async function resizeImage(src, max = 640, mime = 'image/jpeg', quality = 0.86) {
  const img = await loadImage(src);
  const scale = Math.min(1, max / Math.max(img.width, img.height));
  const w = Math.round(img.width * scale);
  const h = Math.round(img.height * scale);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);
  return c.toDataURL(mime, quality);
}

/**
 * 마커 적합도 점수 (0~100).
 * 그레이스케일 그라디언트 밀도 + 밝기 분포 균일도로 특징점 풍부함을 근사한다.
 * MindAR 은 특징점이 많고 반복 패턴이 적은 이미지에서 잘 동작한다.
 */
export async function scoreMarker(src) {
  const img = await loadImage(src);
  const S = 240;
  const c = document.createElement('canvas');
  c.width = S; c.height = S;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, S, S);
  const d = ctx.getImageData(0, 0, S, S).data;

  const gray = new Float32Array(S * S);
  for (let i = 0; i < S * S; i++) {
    gray[i] = (d[i * 4] * 0.299 + d[i * 4 + 1] * 0.587 + d[i * 4 + 2] * 0.114) / 255;
  }

  // Sobel 기반 엣지 강도
  let strong = 0;
  const cellHits = new Array(64).fill(0); // 8x8 셀별 엣지 분포
  for (let y = 1; y < S - 1; y++) {
    for (let x = 1; x < S - 1; x++) {
      const i = y * S + x;
      const gx = -gray[i - S - 1] - 2 * gray[i - 1] - gray[i + S - 1]
                 + gray[i - S + 1] + 2 * gray[i + 1] + gray[i + S + 1];
      const gy = -gray[i - S - 1] - 2 * gray[i - S] - gray[i - S + 1]
                 + gray[i + S - 1] + 2 * gray[i + S] + gray[i + S + 1];
      const mag = Math.hypot(gx, gy);
      if (mag > 0.35) {
        strong++;
        cellHits[Math.floor(y / (S / 8)) * 8 + Math.floor(x / (S / 8))]++;
      }
    }
  }

  const density = strong / (S * S);                    // 0 ~ 0.4 정도
  const covered = cellHits.filter(v => v > 12).length / 64; // 화면 전체에 고르게 퍼졌는가

  // 대비(표준편차)
  let mean = 0;
  for (let i = 0; i < gray.length; i++) mean += gray[i];
  mean /= gray.length;
  let varr = 0;
  for (let i = 0; i < gray.length; i++) varr += (gray[i] - mean) ** 2;
  const sd = Math.sqrt(varr / gray.length);

  const densityScore = Math.min(1, density / 0.14);
  const contrastScore = Math.min(1, sd / 0.24);
  const score = Math.round((densityScore * 0.5 + covered * 0.3 + contrastScore * 0.2) * 100);

  let grade = 'bad', label = '인식 어려움';
  if (score >= 72) { grade = 'good'; label = '아주 좋음'; }
  else if (score >= 52) { grade = 'ok'; label = '괜찮음'; }
  else if (score >= 34) { grade = 'weak'; label = '보통 (조명 주의)'; }

  return { score, grade, label, density, covered, contrast: sd };
}

/* ---------------- 기타 ---------------- */
export function vibrate(pattern) {
  try { navigator.vibrate?.(pattern); } catch { /* 무시 */ }
}

/** 간단한 효과음 (WebAudio, 에셋 없이) */
let audioCtx = null;
export function beep(kind = 'ok') {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const now = audioCtx.currentTime;
    const seq = {
      ok: [[660, 0], [880, .09], [1180, .18]],
      fail: [[300, 0], [200, .12]],
      found: [[520, 0], [780, .07]],
      win: [[523, 0], [659, .11], [784, .22], [1047, .33]],
      tick: [[900, 0]],
    }[kind] || [[600, 0]];
    for (const [freq, at] of seq) {
      const o = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      o.type = kind === 'fail' ? 'sawtooth' : 'triangle';
      o.frequency.value = freq;
      g.gain.setValueAtTime(0.0001, now + at);
      g.gain.exponentialRampToValueAtTime(0.16, now + at + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, now + at + 0.22);
      o.connect(g).connect(audioCtx.destination);
      o.start(now + at);
      o.stop(now + at + 0.26);
    }
  } catch { /* 오디오 미지원 무시 */ }
}
