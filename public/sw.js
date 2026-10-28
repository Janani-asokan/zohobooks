/* Corpus360 service worker — installable app + read-only offline mode.
 * - App shell & static assets: stale-while-revalidate.
 * - GET /api/shop/* : network-first, falling back to the last cached response when offline.
 * - Auth, platform, public links and all writes: never cached.
 */
const VERSION = 'v23';
const SHELL = `ledgerly-shell-${VERSION}`;
const DATA = `ledgerly-data-${VERSION}`;

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(['/', '/manifest.webmanifest', '/icon-192.png'])).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => ![SHELL, DATA].includes(k)).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

self.addEventListener('message', (e) => {
  // Sent on sign-out so another person on this device can't read cached shop data offline.
  if (e.data === 'clear-data') caches.delete(DATA);
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;

  if (url.pathname.startsWith('/api/')) {
    // Downloads (PDFs, attachments, exports) always go straight to the network and are never stored.
    if (!url.pathname.startsWith('/api/shop/') || /\/(pdf|download|export|attachments)\b/.test(url.pathname) || url.search.includes('download=') || url.pathname.endsWith('.csv') || url.pathname.endsWith('.json')) return;
    e.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok && (res.headers.get('content-type') || '').includes('application/json')) {
            const copy = res.clone();
            caches.open(DATA).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => caches.match(req).then((hit) => hit || new Response(JSON.stringify({ error: 'You’re offline', code: 'network' }), { status: 503, headers: { 'Content-Type': 'application/json' } }))),
    );
    return;
  }

  // SPA navigations → cached index.html when offline.
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).then((res) => { caches.open(SHELL).then((c) => c.put('/', res.clone())); return res; }).catch(() => caches.match('/')));
    return;
  }

  e.respondWith(
    caches.match(req).then((hit) => {
      const net = fetch(req).then((res) => {
        if (res.ok && (url.pathname.startsWith('/assets/') || /\.(png|svg|webmanifest|woff2?)$/.test(url.pathname))) {
          const copy = res.clone();
          caches.open(SHELL).then((c) => c.put(req, copy));
        }
        return res;
      }).catch(() => hit);
      return hit || net;
    }),
  );
});
