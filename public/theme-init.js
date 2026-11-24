// Applies the saved theme before first paint (avoids a light flash in dark mode).
try {
  // Light by default; dark (or following the device) only when the viewer chooses it.
  var t = localStorage.getItem('ledgerly.theme') || 'light';
  if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
  var l = localStorage.getItem('ledgerly.lang');
  if (l) document.documentElement.lang = l;
} catch (e) {}

// Front page only: fetch the first-screen photo in parallel with the app's code. (Here, not inline in index.html:
// the site's security policy blocks inline scripts.)
try {
  if (location.pathname === '/') { var p = document.createElement('link'); p.rel = 'preload'; p.as = 'image'; p.setAttribute('imagesrcset', '/img/hero-480.webp 480w, /img/hero-960.webp 960w'); p.setAttribute('imagesizes', '(max-width: 520px) 92vw, 470px'); p.setAttribute('fetchpriority', 'high'); document.head.appendChild(p); }
} catch (e) {}
