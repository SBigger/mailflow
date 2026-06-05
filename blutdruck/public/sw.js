// Service-Worker für die installierbare App (PWA).
// Bewusst konservativ: NUR statische, gleich-origin Dateien werden gecacht.
// /api/-Aufrufe und fremde Hosts laufen immer übers Netz – damit nie veraltete
// oder geschützte Daten aus dem Cache kommen.
const CACHE = 'blutdruck-v1';
const SHELL = [
  '/',
  '/index.html',
  '/app.js',
  '/styles.css',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // CDN etc.: Browser-Standard
  if (url.pathname.startsWith('/api/')) return;     // API: immer Netzwerk, nie cachen

  // App-Shell: zuerst Netzwerk (frisch), bei Offline aus dem Cache.
  event.respondWith(
    fetch(request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(request, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(request).then((r) => r || caches.match('/')))
  );
});
