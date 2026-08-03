const CACHE_NAME = 'vp-pruebas-v6.1.0';
const APP_SHELL = [
  './',
  './index.html',
  './admin.html',
  './config.js',
  './manifest.webmanifest',
  './assets/shared.js',
  './assets/public.js',
  './assets/admin.js',
  './assets/public.css',
  './assets/admin.css',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

function networkFirst(request, fallbackUrl) {
  return fetch(request, { cache: 'no-store' })
    .then(response => {
      if (response && response.ok) {
        const copy = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(request, copy));
      }
      return response;
    })
    .catch(() => caches.match(request).then(match => match || (fallbackUrl ? caches.match(fallbackUrl) : undefined)));
}

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  const isCodeOrDocument = request.mode === 'navigate' || /\.(?:html|js|css|webmanifest)$/.test(url.pathname);
  if (isCodeOrDocument) {
    event.respondWith(networkFirst(request, request.mode === 'navigate' ? './index.html' : null));
    return;
  }

  event.respondWith(
    caches.match(request).then(cached => cached || fetch(request).then(response => {
      if (response && response.ok) {
        const copy = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(request, copy));
      }
      return response;
    }))
  );
});
