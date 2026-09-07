/* ============================================================
   인쇄용 AR 마커 그리기
   MindAR 은 "특징점이 많고 · 반복되지 않고 · 대비가 높은" 이미지에서 잘 동작한다.
   → 시드 기반으로 비대칭 난수 패턴을 그려 인식률 높은 마커를 만든다.
   ============================================================ */

export const MARKER_W = 1024;
export const MARKER_H = 768;

/* 시드 PRNG (mulberry32) — 같은 시드면 항상 같은 마커 */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PALETTES = [
  ['#12303a', '#1f6f78', '#3fb8af', '#7fd8c8', '#ffd166', '#ef476f'],
  ['#2b1b3d', '#5c2a6e', '#a34fa8', '#e07be0', '#ffd6a5', '#4cc9f0'],
  ['#1d2b1a', '#3a6b35', '#71b340', '#b7e04a', '#ffe066', '#ff7b54'],
  ['#31161c', '#7a2637', '#c0455f', '#f2758c', '#ffd08a', '#4ea8de'],
  ['#12233d', '#1f4e79', '#3d86c6', '#7cb7ea', '#ffd166', '#f4845f'],
  ['#3a2c14', '#7a5a22', '#c08a2e', '#e8bc5a', '#fff0b3', '#5fa8d3'],
];

function roundedRect(ctx, x, y, w, h, r) {
  if (ctx.roundRect) { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); return; }
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/**
 * 마커 한 장을 캔버스에 그린다.
 * @param {HTMLCanvasElement} cv
 * @param {object} o { seed, label, sub, palette }
 */
export function drawMarker(cv, o = {}) {
  const W = cv.width = MARKER_W;
  const H = cv.height = MARKER_H;
  const ctx = cv.getContext('2d');
  const r = rng(o.seed ?? 1);
  const pal = PALETTES[(o.palette ?? 0) % PALETTES.length];
  const pick = () => pal[Math.floor(r() * pal.length)];

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, H);

  const M = 26; // 흰 여백 — 배경과 분리되어 인식이 안정된다
  const x0 = M, y0 = M, w = W - M * 2, h = H - M * 2;

  ctx.save();
  ctx.beginPath();
  ctx.rect(x0, y0, w, h);
  ctx.clip();

  ctx.fillStyle = pal[0];
  ctx.fillRect(x0, y0, w, h);

  // 1) 굵은 사선 스트라이프 (방향 특징)
  ctx.save();
  ctx.translate(x0 + w / 2, y0 + h / 2);
  ctx.rotate((-25 + r() * 50) * Math.PI / 180);
  for (let i = -14; i < 14; i++) {
    ctx.fillStyle = pick();
    ctx.globalAlpha = 0.16 + r() * 0.2;
    ctx.fillRect(i * 78, -h, 20 + r() * 46, h * 2);
  }
  ctx.restore();
  ctx.globalAlpha = 1;

  // 2) 다각형 덩어리
  for (let i = 0; i < 26; i++) {
    const cx = x0 + r() * w;
    const cy = y0 + r() * h;
    const rad = 26 + r() * 92;
    const n = 3 + Math.floor(r() * 5);
    const rot = r() * Math.PI * 2;
    ctx.beginPath();
    for (let k = 0; k < n; k++) {
      const a = rot + (k / n) * Math.PI * 2;
      const rr = rad * (0.55 + r() * 0.65);
      const px = cx + Math.cos(a) * rr;
      const py = cy + Math.sin(a) * rr;
      k ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
    }
    ctx.closePath();
    if (r() < 0.62) {
      ctx.fillStyle = pick();
      ctx.globalAlpha = 0.65 + r() * 0.35;
      ctx.fill();
    } else {
      ctx.strokeStyle = pick();
      ctx.lineWidth = 3 + r() * 9;
      ctx.globalAlpha = 0.9;
      ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;

  // 3) 원 / 링
  for (let i = 0; i < 22; i++) {
    ctx.beginPath();
    ctx.arc(x0 + r() * w, y0 + r() * h, 8 + r() * 54, 0, Math.PI * 2);
    if (r() < 0.5) {
      ctx.fillStyle = pick();
      ctx.globalAlpha = 0.75 + r() * 0.25;
      ctx.fill();
    } else {
      ctx.strokeStyle = pick();
      ctx.lineWidth = 4 + r() * 10;
      ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;

  // 4) 꺾인 선 (모서리 특징점 대량 생성)
  ctx.lineCap = 'round';
  for (let i = 0; i < 46; i++) {
    ctx.beginPath();
    let px = x0 + r() * w;
    let py = y0 + r() * h;
    ctx.moveTo(px, py);
    const segs = 2 + Math.floor(r() * 3);
    for (let s = 0; s < segs; s++) {
      px += (r() - 0.5) * 220;
      py += (r() - 0.5) * 180;
      ctx.lineTo(px, py);
    }
    ctx.strokeStyle = pick();
    ctx.lineWidth = 2 + r() * 7;
    ctx.globalAlpha = 0.55 + r() * 0.45;
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  // 5) 작은 사각 타일 (고주파 특징)
  for (let i = 0; i < 90; i++) {
    const s = 6 + r() * 22;
    ctx.save();
    ctx.translate(x0 + r() * w, y0 + r() * h);
    ctx.rotate(r() * Math.PI);
    ctx.fillStyle = pick();
    ctx.globalAlpha = 0.5 + r() * 0.5;
    ctx.fillRect(-s / 2, -s / 2, s, s * (0.5 + r()));
    ctx.restore();
  }
  ctx.globalAlpha = 1;

  ctx.restore(); // clip 해제

  // 6) 라벨 — 좌상단 고정이라 방향 식별에도 도움이 된다
  const label = String(o.label ?? '1');
  ctx.save();
  const bw = 168, bh = 168, bx = x0 + 22, by = y0 + 22;
  ctx.fillStyle = 'rgba(255,255,255,.94)';
  roundedRect(ctx, bx, by, bw, bh, 26);
  ctx.fill();
  ctx.strokeStyle = pal[1];
  ctx.lineWidth = 7;
  ctx.stroke();
  ctx.fillStyle = pal[0];
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `900 ${label.length > 2 ? 62 : 104}px "Apple SD Gothic Neo","Noto Sans KR",system-ui,sans-serif`;
  ctx.fillText(label, bx + bw / 2, by + bh / 2 + 4);
  ctx.restore();

  const sub = o.sub || '';
  if (sub) {
    ctx.save();
    ctx.font = '800 40px "Apple SD Gothic Neo","Noto Sans KR",system-ui,sans-serif';
    const tw = ctx.measureText(sub).width;
    const px = 24, ph = 66;
    const bx2 = x0 + w - tw - px * 2 - 22;
    const by2 = y0 + h - ph - 22;
    ctx.fillStyle = 'rgba(255,255,255,.94)';
    roundedRect(ctx, bx2, by2, tw + px * 2, ph, 18);
    ctx.fill();
    ctx.strokeStyle = pal[1];
    ctx.lineWidth = 5;
    ctx.stroke();
    ctx.fillStyle = pal[0];
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(sub, bx2 + px, by2 + ph / 2 + 2);
    ctx.restore();
  }

  // 흰 테두리 마감
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = M * 2;
  ctx.strokeRect(0, 0, W, H);
  ctx.strokeStyle = '#dfe4ea';
  ctx.lineWidth = 2;
  ctx.strokeRect(M - 1, M - 1, W - M * 2 + 2, H - M * 2 + 2);

  return cv;
}
