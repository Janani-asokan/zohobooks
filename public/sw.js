/* Corpus360 service worker — installable app + read-only offline mode.
 * - App shell & static assets: stale-while-revalidate.
 * - GET /api/shop/* : network-first, falling back to the last cached response when offline, or after 5 s on a
 *   very slow connection (the network reply still refreshes the copy). Fallbacks carry "x-offline" so the page
 *   knows the connection is down.
 * - Auth, platform, public links and all writes: never cached.
 */
const VERSION = 'v61';
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

  // Downloads (the Windows print helper) go straight to the network and are never kept as the offline page.
  if (url.pathname.startsWith('/downloads/')) return;
  if (url.pathname.startsWith('/api/')) {
    // Downloads (PDFs, attachments, exports) always go straight to the network and are never stored.
    if (!url.pathname.startsWith('/api/shop/') || /\/(pdf|download|export|attachments)\b/.test(url.pathname) || url.search.includes('download=') || url.pathname.endsWith('.csv') || url.pathname.endsWith('.json')) return;
    const marked = (hit) => {
      const h = new Headers(hit.headers); h.set('x-offline', 'cache');
      return new Response(hit.body, { status: hit.status, statusText: hit.statusText, headers: h });
    };
    const offline = () => new Response(JSON.stringify({ error: 'You’re offline', code: 'network' }), { status: 503, headers: { 'Content-Type': 'application/json', 'x-offline': '1' } });
    const net = fetch(req).then((res) => {
      if (res.ok && (res.headers.get('content-type') || '').includes('application/json')) {
        const copy = res.clone();
        caches.open(DATA).then((c) => c.put(req, copy));
      }
      return res;
    });
    e.respondWith(new Promise((resolve) => {
      let done = false;
      const finish = (r) => { if (!done) { done = true; resolve(r); } };
      // Slow connection: after 5 s answer with the last copy if there is one; the network keeps going in the background.
      const slow = setTimeout(() => caches.match(req).then((hit) => { if (hit) finish(marked(hit)); }), 5000);
      net.then((res) => { clearTimeout(slow); finish(res); })
        .catch(() => { clearTimeout(slow); caches.match(req).then((hit) => finish(hit ? marked(hit) : offline())); });
    }));
    return;
  }

  // SPA navigations → cached index.html when offline.
  if (req.mode === 'navigate') {
    // On a very slow connection the app opens from its saved copy after 6 s instead of a blank page.
    e.respondWith(new Promise((resolve) => {
      let done = false;
      const finish = (r) => { if (!done && r) { done = true; resolve(r); } };
      const slow = setTimeout(() => caches.match('/').then(finish), 6000);
      fetch(req).then((res) => { clearTimeout(slow); if (res.ok) { const copy = res.clone(); caches.open(SHELL).then((c) => c.put('/', copy)); } finish(res); })
        .catch(() => { clearTimeout(slow); caches.match('/').then((hit) => { if (hit) finish(hit); else { done = true; resolve(Response.error()); } }); });
    }));
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
