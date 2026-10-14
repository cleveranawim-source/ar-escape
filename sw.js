/* ============================================================
   AR 방탈출 — 오프라인 캐시
   ------------------------------------------------------------
   학교 와이파이가 느리거나 교육청 방화벽이 CDN 을 막아도
   수업이 멈추지 않도록, 한 번 받은 파일은 기기에 남긴다.

   · vendor/ (A-Frame + MindAR, 약 3MB) → 캐시 우선.
     버전이 고정된 라이브러리라 다시 받을 이유가 없다.
   · 그 밖의 같은 출처 파일           → 네트워크 우선, 끊기거나 3초 넘게 잠잠하면 캐시.
     교사가 문제·CSS 를 고치면 새로고침만으로 바로 반영된다.
   · 외부 출처(CDN 폴백 등)           → 건드리지 않는다.

   파일을 배포한 뒤 캐시를 강제로 비우려면 VERSION 을 올린다.
   ============================================================ */

const VERSION = 'ar-escape-v19';

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

/* 네트워크를 기다려 주는 시간.
   와이파이가 "끊긴" 것보다 "붙어는 있는데 응답이 없는" 상태가 훨씬 고약하다.
   앞의 경우 fetch 는 곧바로 실패해서 캐시로 넘어가지만, 뒤의 경우는 크롬이
   5분 가까이 기다린다 — 그동안 학생 화면은 흰 화면이다. (실측: 300초 넘게 멈춤)
   그래서 캐시에 같은 파일이 있으면 3초만 기다리고 캐시를 내준다.
   기다리다 만 요청은 그대로 두어 캐시를 갱신하므로, 다음 새로고침에는 최신이 온다.

   정상망에서는 절대 걸리지 않는 값이다 — 실측으로 js 260ms,
   시나리오 14MB 도 재검증(304) 40ms 였다. */
const NET_WAIT_MS = 3000;

/* 한 번 3초를 넘겼으면 잠시 동안은 다른 파일도 기다리지 않는다.
   한 화면에 문서·CSS·모듈·시나리오가 줄줄이 달려 있어서, 저마다 3초씩 서면
   합계가 6초를 넘는다. 하나만 재 보고 나머지는 캐시로 바로 내주면 3초에 끝난다.
   요청 하나라도 성공하면 곧바로 해제된다. */
const SICK_MS = 10000;
let sickUntil = 0;

/* 응답이 없는 서버는 연결을 붙잡고 놓지 않는다. 그런 요청이 몇 개만 쌓여도
   브라우저의 호스트당 연결 수(6개)가 차서, 와이파이가 돌아와도 한동안 아무것도
   못 받는다. 그래서 캐시로 넘어간 뒤에도 20초 뒤에는 잘라 낸다. */
const GIVE_UP_MS = 20000;

function revalidate(req) {
  const ac = new AbortController();
  const cut = setTimeout(() => ac.abort(), GIVE_UP_MS);
  return fetch(req, { cache: 'no-cache', signal: ac.signal })
    .finally(() => clearTimeout(cut));
}

async function networkFirst(req) {
  // 화면 주소에는 ?src=...&room=3-1 같은 꼬리표가 붙는다. 반마다 방 코드가 다르니
  // 주소를 통째로 열쇠 삼으면 반이 바뀔 때마다 캐시가 빗나간다 — 문서가 똑같은데도
  // 네트워크를 기다리게 된다. HTML 본문은 어차피 같고 꼬리표는 화면이 읽어 쓰므로,
  // 문서 요청은 물음표 뒤를 빼고 찾는다.
  const cached = await caches.match(req, { ignoreSearch: req.mode === 'navigate' });

  // 캐시에 없으면 기다리는 것 말고 방법이 없다 (그 반의 첫 접속).
  if (!cached) {
    try { return keep(req, await fetch(req, { cache: 'no-cache' })); }
    catch { return offline(); }
  }

  // 망이 아픈 게 방금 확인됐으면 캐시를 바로 내주고, 갱신만 뒤에서 시도한다.
  if (Date.now() < sickUntil) {
    revalidate(req)
      .then(res => { sickUntil = 0; keep(req, res); })
      .catch(() => { /* 아직 아프다 */ });
    return cached.clone();
  }

  return new Promise(resolve => {
    let settled = false;
    const done = res => { if (!settled) { settled = true; resolve(res); } };

    const timer = setTimeout(() => {
      sickUntil = Date.now() + SICK_MS;
      done(cached.clone());
    }, NET_WAIT_MS);

    revalidate(req)
      .then(res => { clearTimeout(timer); sickUntil = 0; keep(req, res); done(res.clone()); })
      .catch(() => { clearTimeout(timer); done(cached.clone()); });
  });
}

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
  e.respondWith(networkFirst(req));
});
