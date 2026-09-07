/* ============================================================
   AR 카드 텍스처 렌더러
   A-Frame 의 text 컴포넌트는 MSDF 폰트 기반이라 한글을 못 쓴다.
   → 캔버스 2D 로 카드를 그려서 THREE.CanvasTexture 로 붙인다.
   ============================================================ */

import { colorHex } from './model.js';

export const CARD_W = 1024;
export const CARD_H = 640;

/* ---------- 텍스트 줄바꿈 (한글: 글자 단위 폴백) ---------- */
export function wrapText(ctx, text, maxWidth, maxLines = 99) {
  const lines = [];
  for (const paragraph of String(text).split('\n')) {
    if (!paragraph.trim()) { lines.push(''); continue; }
    let line = '';
    const tokens = paragraph.split(/(\s+)/); // 공백 유지
    for (const tok of tokens) {
      if (ctx.measureText(line + tok).width <= maxWidth) { line += tok; continue; }
      // 토큰 자체가 넘치면 글자 단위로 쪼갠다 (한글/긴 단어)
      if (ctx.measureText(tok).width > maxWidth) {
        for (const ch of tok) {
          if (ctx.measureText(line + ch).width > maxWidth) { lines.push(line.trimEnd()); line = ''; }
          line += ch;
        }
      } else {
        lines.push(line.trimEnd());
        line = tok.trimStart();
      }
    }
    lines.push(line.trimEnd());
  }
  const out = lines.slice(0, maxLines);
  if (lines.length > maxLines && out.length) out[out.length - 1] = `${out[out.length - 1].slice(0, -1)}…`;
  return out;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

const FONT = '"Apple SD Gothic Neo", "Noto Sans KR", "Malgun Gothic", system-ui, sans-serif';

/** 모서리 장식 (방탈출 느낌의 프레임) */
function corners(ctx, x, y, w, h, hex, len = 46, lw = 6) {
  ctx.strokeStyle = hex;
  ctx.lineWidth = lw;
  ctx.lineCap = 'round';
  const pts = [
    [[x, y + len], [x, y], [x + len, y]],
    [[x + w - len, y], [x + w, y], [x + w, y + len]],
    [[x + w, y + h - len], [x + w, y + h], [x + w - len, y + h]],
    [[x + len, y + h], [x, y + h], [x, y + h - len]],
  ];
  for (const p of pts) {
    ctx.beginPath();
    ctx.moveTo(p[0][0], p[0][1]);
    ctx.lineTo(p[1][0], p[1][1]);
    ctx.lineTo(p[2][0], p[2][1]);
    ctx.stroke();
  }
}

/**
 * 카드 렌더링.
 * @param {HTMLCanvasElement} canvas
 * @param {object} o
 *   state: 'quiz' | 'solved' | 'intro'
 *   title, body, emoji, color(key), badge, reward
 */
export function drawCard(canvas, o = {}) {
  const W = canvas.width = CARD_W;
  const H = canvas.height = CARD_H;
  const ctx = canvas.getContext('2d');
  const hex = colorHex(o.color);
  const state = o.state || 'quiz';

  ctx.clearRect(0, 0, W, H);

  // ---- 배경 (반투명 어두운 유리) ----
  const pad = 26;
  const g = ctx.createLinearGradient(0, 0, W, H);
  if (state === 'solved') {
    g.addColorStop(0, 'rgba(10, 34, 26, .93)');
    g.addColorStop(1, 'rgba(6, 20, 18, .93)');
  } else {
    g.addColorStop(0, 'rgba(14, 18, 30, .93)');
    g.addColorStop(1, 'rgba(8, 11, 20, .95)');
  }
  ctx.fillStyle = g;
  roundRect(ctx, pad, pad, W - pad * 2, H - pad * 2, 42);
  ctx.fill();

  // 테두리 글로우
  ctx.save();
  ctx.shadowColor = hex;
  ctx.shadowBlur = 34;
  ctx.strokeStyle = hex;
  ctx.lineWidth = 3;
  roundRect(ctx, pad, pad, W - pad * 2, H - pad * 2, 42);
  ctx.stroke();
  ctx.restore();

  corners(ctx, pad + 22, pad + 22, W - pad * 2 - 44, H - pad * 2 - 44, `${hex}bb`);

  // ---- 상단: 이모지 + 제목 ----
  const left = pad + 62;
  let y = pad + 96;

  ctx.textBaseline = 'middle';
  ctx.font = `72px ${FONT}`;
  ctx.fillText(state === 'solved' ? '✅' : (o.emoji || '🔒'), left, y);

  ctx.font = `800 46px ${FONT}`;
  ctx.fillStyle = '#ffffff';
  const titleLines = wrapText(ctx, o.title || '', W - left - 120 - 90, 1);
  ctx.fillText(titleLines[0] || '', left + 96, y - 8);

  // 상태 배지
  if (o.badge) {
    ctx.font = `700 24px ${FONT}`;
    const bw = ctx.measureText(o.badge).width + 34;
    const bx = W - pad - 40 - bw;
    ctx.fillStyle = `${hex}2e`;
    roundRect(ctx, bx, y - 44, bw, 44, 22);
    ctx.fill();
    ctx.strokeStyle = `${hex}88`;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = hex;
    ctx.textAlign = 'center';
    ctx.fillText(o.badge, bx + bw / 2, y - 21);
    ctx.textAlign = 'left';
  }

  // 구분선
  y += 62;
  ctx.strokeStyle = 'rgba(255,255,255,.13)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(left, y);
  ctx.lineTo(W - pad - 62, y);
  ctx.stroke();

  // ---- 본문 ----
  y += 52;
  const bodyMax = W - left - 110;
  ctx.fillStyle = '#dce4f2';
  ctx.font = `600 38px ${FONT}`;
  const bodyLines = wrapText(ctx, o.body || '', bodyMax, 5);
  for (const line of bodyLines) {
    ctx.fillText(line, left, y);
    y += 52;
  }

  // ---- 하단: 보상 / 안내 ----
  if (state === 'solved' && o.reward) {
    const ry = H - pad - 88;
    ctx.font = `700 26px ${FONT}`;
    ctx.fillStyle = 'rgba(220,232,242,.7)';
    ctx.fillText('획득한 열쇠 조각', left, ry - 4);

    ctx.font = `900 62px ${FONT}`;
    ctx.fillStyle = hex;
    ctx.save();
    ctx.shadowColor = hex;
    ctx.shadowBlur = 26;
    ctx.fillText(o.reward, left, ry + 48);
    ctx.restore();
  } else if (o.footer) {
    ctx.font = `600 26px ${FONT}`;
    ctx.fillStyle = 'rgba(200,212,230,.55)';
    ctx.fillText(o.footer, left, H - pad - 52);
  }

  return canvas;
}

