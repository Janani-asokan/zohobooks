// Applies the saved theme before first paint (avoids a light flash in dark mode).
try {
  // Light by default; dark (or following the device) only when the viewer chooses it.
  var t = localStorage.getItem('ledgerly.theme') || 'light';
  if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
  var l = localStorage.getItem('ledgerly.lang');
  if (l) document.documentElement.lang = l;
} catch (e) {}
