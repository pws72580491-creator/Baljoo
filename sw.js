const CACHE_NAME = '발주관리-cache-v3.3.20';
const APP_SHELL = [
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './icon-512-maskable.png',
  './js/storage.js',
  './js/helpers.js',
  './js/ui.js',
  './js/modal.js',
  './js/gemini.js',
  './js/firebase.js',
  './js/analyzer.js',
  './js/delivery.js',
  './js/app.js'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;

  const url = e.request.url;
  // JS / HTML 파일: 네트워크 우선 — 버전업 시 캐시 지연 없이 즉시 최신 코드 반영
  const isCodeFile = url.endsWith('.js') || url.endsWith('.html') || url.endsWith('/');
  if (isCodeFile) {
    e.respondWith(
      fetch(e.request)
        .then((networkResp) => {
          if (networkResp && networkResp.ok) {
            const respClone = networkResp.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(e.request, respClone));
          }
          return networkResp;
        })
        .catch(() => caches.match(e.request))
    );
    return;
  }

  // 그 외 정적 자원(아이콘 등): 기존 stale-while-revalidate 유지
  e.respondWith(
    caches.match(e.request).then((cached) => {
      const fetchPromise = fetch(e.request)
        .then((networkResp) => {
          if (networkResp && networkResp.ok) {
            const respClone = networkResp.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(e.request, respClone));
          }
          return networkResp;
        })
        .catch(() => cached);
      return cached || fetchPromise;
    })
  );
});
