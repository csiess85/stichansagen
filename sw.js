/* Einfacher Offline-Cache. Bei jedem Deploy CACHE hochzählen. */
const CACHE = 'stichansagen-v9';
const ASSETS = [
  './',
  './index.html',
  './styles.css?v=9',
  './app.js?v=9',
  './manifest.webmanifest',
  './icon.svg',
  './icon-maskable.svg'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;

  // Netz zuerst, damit ein neues Deploy sofort ankommt; Cache als Rückfallebene.
  // Für das HTML am HTTP-Cache vorbei (GitHub Pages liefert max-age=600), sonst
  // kann eine alte index.html neue Assets referenzieren – oder umgekehrt.
  const opts = req.mode === 'navigate' || req.destination === 'document'
    ? { cache: 'reload' } : undefined;
  event.respondWith(
    fetch(req, opts)
      .then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(req, copy));
        return res;
      })
      .catch(() => caches.match(req).then(hit => hit || caches.match('./index.html')))
  );
});
