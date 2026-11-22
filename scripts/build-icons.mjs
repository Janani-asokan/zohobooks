// Renders every app icon from one design: the Corpus360 check-mark in peach on oxblood.
// Website: public/icon.svg, favicon.svg, PNG install icons. Phone app (Android): launcher icons in every density
// (square, round and the adaptive-icon foreground), the adaptive background colour, and the splash screens.
// Run from the repository root:  node scripts/build-icons.mjs
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const OXBLOOD = '#330000';
const OXBLOOD_2 = '#5A1611';
const PEACH = '#D19783';
const MARK = (stroke) => `<path d="M20.21 9.80 A8.5 8.5 0 1 1 14.20 3.79" fill="none" stroke="${PEACH}" stroke-width="${stroke}" stroke-linecap="butt" stroke-linejoin="miter"/><path d="M7.6 11.6 11.4 15.4 21 5.8" fill="none" stroke="${PEACH}" stroke-width="${stroke}" stroke-linecap="butt" stroke-linejoin="miter"/>`;
const GRAD = `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${OXBLOOD}"/><stop offset="1" stop-color="${OXBLOOD_2}"/></linearGradient></defs>`;

// Vector icons for the website.
const iconSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">${GRAD}<rect width="24" height="24" rx="4.5" fill="url(#g)"/><g transform="translate(3.6 3.6) scale(.7)">${MARK(3.2)}</g></svg>`;
const faviconSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect width="24" height="24" rx="5" fill="${OXBLOOD}"/>${MARK(3)}</svg>`;
fs.writeFileSync('public/icon.svg', iconSvg);
fs.writeFileSync('public/favicon.svg', faviconSvg);
// Brand files used on light backgrounds: the mark in oxblood.
for (const f of ['corpus360-mark.svg', 'corpus360-lockup.svg', 'corpus360-wordmark.svg']) {
  const p = path.join('public/brand', f);
  if (fs.existsSync(p)) fs.writeFileSync(p, fs.readFileSync(p, 'utf8').replace(/#A9475A/gi, OXBLOOD));
}

/** A square picture: full-bleed or rounded oxblood, with the mark taking `mark` of the width. */
const square = (size, { radius = 0, circle = false, mark = 0.62, transparent = false } = {}) => {
  const m = Math.round(size * mark);
  const bg = transparent ? '' : `<div style="position:absolute;inset:0;border-radius:${circle ? '50%' : radius + 'px'};background:linear-gradient(135deg, ${OXBLOOD}, ${OXBLOOD_2})"></div>`;
  return `<body style="margin:0;width:${size}px;height:${size}px;position:relative;background:transparent">${bg}
    <svg style="position:absolute;left:${(size - m) / 2}px;top:${(size - m) / 2}px" width="${m}" height="${m}" viewBox="0 0 24 24">${MARK(2.9)}</svg></body>`;
};

// PW_CHROMIUM: use an already-installed Chromium when the project's Playwright has no browser downloaded.
const b = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
const p = await b.newPage();
const shot = async (html, w, h, file, transparent) => {
  await p.setViewportSize({ width: w, height: h });
  await p.setContent(html);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  await p.screenshot({ path: file, omitBackground: !!transparent });
};

// Website install icons.
await shot(square(192, { radius: 36 }), 192, 192, 'public/icon-192.png', true);
await shot(square(512, { radius: 96 }), 512, 512, 'public/icon-512.png', true);
await shot(square(180, { mark: 0.6 }), 180, 180, 'public/apple-touch-icon.png'); // iOS rounds it; must be opaque
await shot(square(512, { mark: 0.5 }), 512, 512, 'public/icon-512-maskable.png'); // mark inside the safe zone

// Android launcher icons. Legacy square and round icons, and the adaptive foreground (108dp canvas, with the mark
// inside the 66dp safe circle; Android draws the oxblood background colour behind it).
const RES = 'mobile/android/app/src/main/res';
const DENSITY = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
for (const [d, k] of Object.entries(DENSITY)) {
  const icon = Math.round(48 * k), fg = Math.round(108 * k);
  await shot(square(icon, { radius: Math.round(icon * 0.2), mark: 0.6 }), icon, icon, `${RES}/mipmap-${d}/ic_launcher.png`, true);
  await shot(square(icon, { circle: true, mark: 0.56 }), icon, icon, `${RES}/mipmap-${d}/ic_launcher_round.png`, true);
  await shot(square(fg, { transparent: true, mark: 0.42 }), fg, fg, `${RES}/mipmap-${d}/ic_launcher_foreground.png`, true);
}
fs.writeFileSync(`${RES}/values/ic_launcher_background.xml`,
  `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">${OXBLOOD}</color>\n</resources>`);

// Splash screens: oxblood with the peach mark in the middle, at the size each existing file already has.
for (const dir of fs.readdirSync(RES).filter((x) => x.startsWith('drawable'))) {
  const file = path.join(RES, dir, 'splash.png');
  if (!fs.existsSync(file)) continue;
  const buf = fs.readFileSync(file);
  const w = buf.readUInt32BE(16), h = buf.readUInt32BE(20); // PNG header
  const m = Math.round(Math.min(w, h) * 0.24);
  await shot(`<body style="margin:0;width:${w}px;height:${h}px;background:radial-gradient(circle at 50% 50%, ${OXBLOOD_2} 0%, ${OXBLOOD} 55%);display:grid;place-items:center">
    <svg width="${m}" height="${m}" viewBox="0 0 24 24">${MARK(2.9)}</svg></body>`, w, h, file);
}
await b.close();
console.log('icons written');
