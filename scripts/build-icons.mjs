// Renders the PWA PNG icons from public/icon.svg and public/favicon.svg. Run: node scripts/build-icons.mjs
import fs from 'node:fs';
import { chromium } from 'playwright';
const icon = fs.readFileSync('public/icon.svg', 'utf8');
const b = await chromium.launch();
const p = await b.newPage();
for (const [file, size, pad] of [['icon-192.png', 192, 0], ['icon-512.png', 512, 0], ['apple-touch-icon.png', 180, 0], ['icon-512-maskable.png', 512, 0.1]]) {
  await p.setViewportSize({ width: size, height: size });
  const inner = Math.round(size * (1 - pad * 2));
  // Maskable icons keep the mark inside the safe zone on a full-bleed background.
  await p.setContent(`<body style="margin:0;background:${pad ? '#A9475A' : 'transparent'};display:grid;place-items:center;width:${size}px;height:${size}px">${icon.replace('<svg', `<svg width="${inner}" height="${inner}"`)}</body>`);
  await p.screenshot({ path: `public/${file}`, omitBackground: !pad });
}
await b.close();
