// 서비스 워커: 한 번 받은 게임 파일을 저장해 두고 오프라인에서도 실행한다.
const VERSION = '3978d7d95a';
const CACHE = 'demolition-king-' + VERSION;
const ASSETS = ["./","./index.html","./app.3978d7d95a.js","./manifest.webmanifest","./assets/fonts/Galmuri11.woff2","./assets/fonts/Galmuri11-Bold.woff2","./assets/icons/icon-192.png","./assets/icons/icon-512.png","./assets/icons/maskable-512.png","./assets/icons/apple-touch-icon.png"];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith('demolition-king-') && k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  // 페이지는 새 버전을 먼저 시도하고, 안 되면 저장본
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).then((r) => { const copy = r.clone(); caches.open(CACHE).then((c) => c.put('./index.html', copy)); return r; }).catch(() => caches.match('./index.html')));
    return;
  }
  e.respondWith(caches.match(req, { ignoreSearch: true }).then((hit) => hit || fetch(req).then((r) => {
    if (r.ok) { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
    return r;
  })));
});
