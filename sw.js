/* ============================================================
   AR 방탈출 — 오프라인 캐시
   ------------------------------------------------------------
   학교 와이파이가 느리거나 교육청 방화벽이 CDN 을 막아도
   수업이 멈추지 않도록, 한 번 받은 파일은 기기에 남긴다.

   · vendor/ (A-Frame + MindAR, 약 3MB) → 캐시 우선.
     버전이 고정된 라이브러리라 다시 받을 이유가 없다.
   · 그 밖의 같은 출처 파일           → 네트워크 우선, 끊기면 캐시.
     교사가 문제·CSS 를 고치면 새로고침만으로 바로 반영된다.
   · 외부 출처(CDN 폴백 등)           → 건드리지 않는다.

   파일을 배포한 뒤 캐시를 강제로 비우려면 VERSION 을 올린다.
   ============================================================ */

const VERSION = 'ar-escape-v13';

const SHELL = [
  './',
  './index.html', './play.html', './admin.html', './markers.html', './lab.html', './board.html',
  './css/base.css', './css/play.css', './css/admin.css',
  './js/util.js', './js/store.js', './js/model.js',
  './js/ar.js', './js/arcard.js', './js/demo.js',
  './js/play.js', './js/admin.js',
  './js/markers.js', './js/markers-draw.js', './js/lab.js',
  './js/live.js', './js/board.js',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(VERSION)
      .then(c => c.addAll(SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
      .then(async () => {
        // 새 버전이 올라왔다고 알린다. 열려 있는 화면이 스스로 최신 코드로 바꿔 달게.
        for (const c of await self.clients.matchAll({ type: 'window' })) {
          c.postMessage({ type: 'sw-updated', version: VERSION });
        }
      }),
  );
});

self.addEventListener('message', e => {
  if (e.data?.type === 'version') e.source?.postMessage({ type: 'version', version: VERSION });
});

function keep(req, res) {
  if (res && res.ok && res.type === 'basic') {
    const copy = res.clone();
    caches.open(VERSION).then(c => c.put(req, copy));
  }
  return res;
}

const offline = () => new Response('오프라인 상태입니다. 네트워크에 한 번 연결한 뒤 다시 시도하세요.', {
  status: 503,
  headers: { 'Content-Type': 'text/plain;charset=utf-8' },
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== location.origin) return; // CDN 폴백 등 외부는 그대로 통과

  if (url.pathname.includes('/vendor/')) {
    e.respondWith(
      caches.match(req).then(hit => hit || fetch(req).then(res => keep(req, res)).catch(offline)),
    );
    return;
  }

  // GitHub Pages 는 max-age=600 을 붙인다. 배포 직후 브라우저 HTTP 캐시에 옛 모듈과
  // 새 모듈이 섞이면 import 가 깨진다(예: 새 demo.js 가 옛 arcard.js 의 export 를 찾음).
  // 서버에 재검증(no-cache)해서 앱 파일은 항상 한 세트로 맞춘다.
  e.respondWith(
    fetch(req, { cache: 'no-cache' })
      .then(res => keep(req, res))
      .catch(() => caches.match(req).then(hit => hit || offline())),
  );
});
