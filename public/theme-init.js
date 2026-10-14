// Applies the saved theme before first paint (avoids a light flash in dark mode).
try {
  var t = localStorage.getItem('ledgerly.theme');
  if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
  var l = localStorage.getItem('ledgerly.lang');
  if (l) document.documentElement.lang = l;
} catch (e) {}
