// IMEI scanning with the POS camera, the way phone boxes really look: a box QR code with both IMEIs, the model
// barcode next to the IMEI label, IMEI 1 and IMEI 2 of the same phone, IMEI-only mode, and a 2D USB scanner typing
// the QR text. Every barcode is shown to the browser as a real camera picture.
// Usage: BASE=http://localhost:4000 node e2e/tools/imei-camera.mjs <workDir> <mkbar.py>
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import zx from '@zxing/library';
const { BarcodeFormat, EncodeHintType, QRCodeWriter } = zx;
const B = process.env.BASE ?? 'http://localhost:4000';
const [work = '.', mkbar] = process.argv.slice(2);
fs.mkdirSync(work, { recursive: true });
const ok = (c, m, why = '') => { console.log(`${c ? 'PASS' : 'FAIL'} ${m}${!c && why ? ` (${why})` : ''}`); if (!c) process.exitCode = 1; };
const H = { 'x-requested-with': 'ledgerly' };
const errs = []; const browsers = [];

const luhnDigit = (s) => { let sum = 0; for (let i = 0; i < s.length; i++) { let d = Number(s[s.length - 1 - i]); if (i % 2 === 0) { d *= 2; if (d > 9) d -= 9; } sum += d; } return String((10 - (sum % 10)) % 10); };
const imei = (body14) => body14 + luhnDigit(body14);
const eanDigit = (s12) => { let t = 0; for (let i = 0; i < 12; i++) t += Number(s12[i]) * (i % 2 ? 3 : 1); return String((10 - (t % 10)) % 10); };
const tag = Date.now().toString().slice(-6);
const EAN = `69${tag}0042`.slice(0, 12); const ean = EAN + eanDigit(EAN);
const U = ['1', '2', '3', '4', '5'].map((n) => ({ i1: imei(`35${tag}0000${n}1`.slice(0, 14)), i2: imei(`35${tag}0000${n}2`.slice(0, 14)) }));

const bar = (kind, code, name) => execFileSync('python3', ['-I', mkbar, kind, code, `${work}/${name}.y4m`]).toString().trim();
function qrVideo(text, name) {
  const m = new QRCodeWriter().encode(text, BarcodeFormat.QR_CODE, 420, 420, new Map([[EncodeHintType.MARGIN, 2]]));
  const rows = []; for (let y = 0; y < m.getHeight(); y++) { const r = []; for (let x = 0; x < m.getWidth(); x++) r.push(m.get(x, y) ? 0 : 255); rows.push(r.join(' ')); }
  fs.writeFileSync(`${work}/${name}.pgm`, `P2\n${m.getWidth()} ${m.getHeight()}\n255\n${rows.join('\n')}\n`);
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-loop', '1', '-i', `${work}/${name}.pgm`, '-vf', 'pad=1280:720:(ow-iw)/2:(oh-ih)/2:color=white,format=yuv420p', '-t', '4', '-r', '15', `${work}/${name}.y4m`]);
  return `${work}/${name}.y4m`;
}
const seq = (a, b, name) => { execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', a, '-i', b, '-filter_complex', 'concat=n=2:v=1:a=0', '-pix_fmt', 'yuv420p', `${work}/${name}.y4m`]); return `${work}/${name}.y4m`; };

async function open(cam) {
  const b = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', ...(cam ? [`--use-file-for-fake-video-capture=${cam}`] : [])] });
  browsers.push(b);
  const ctx = await b.newContext({ viewport: { width: 1366, height: 860 }, permissions: ['camera'] });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(B + '/login'); await p.fill('input[type=email]', 'owner@shop.com'); await p.fill('input[type=password]', 'owner123'); await p.keyboard.press('Enter'); await p.waitForURL(/\/app/);
  const api = async (m, u, d) => { const r = await p.request.fetch(B + '/api' + u, { method: m, data: d, headers: H }); return { status: r.status(), body: await r.json().catch(() => null) }; };
  return { b, p, api };
}
const cart = (p) => p.evaluate(() => [...document.querySelectorAll('.pos-line')].map((l) => ({ id: l.getAttribute('data-line'), qty: Number(l.querySelector('input[aria-label=Quantity]')?.value), serials: [...l.querySelectorAll('.serial-chip')].map((c) => c.firstChild?.textContent) })));
const until = async (fn, ms = 20000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return true; await new Promise((r) => setTimeout(r, 250)); } return false; };
const toasts = (p) => p.locator('.toast').allInnerTexts().then((t) => t.join(' | '));
const posWithCamera = async (s, mode) => {
  await s.p.goto(B + '/app/pos'); await s.p.waitForSelector('.pos-tile');
  await s.p.getByRole('button', { name: /^Camera$/ }).click();
  if (mode === 'imei') await s.p.getByRole('radio', { name: 'IMEI only' }).click();
};

try {
  /* Stock: a phone model with its box barcode, five units imported from a sheet with IMEI and IMEI 2 */
  let s = await open(null);
  const csv = ['Name,SKU,Barcode,HSN,Cost,SP1,Tax Rate,IMEI,IMEI 2', ...U.map((u) => `Galaxy M15 ${tag},M15-${tag},${ean},8517,11000,13999,18,${u.i1},${u.i2}`)].join('\r\n');
  const imp = await s.api('POST', '/shop/items/import', { csv });
  ok(imp.status === 200 && imp.body.serials === 5, 'five phones imported with IMEI 1 and IMEI 2 (box barcode on the model)', JSON.stringify(imp.body).slice(0, 160));
  const phone = (await s.api('GET', '/shop/items')).body.find((i) => i.sku === `M15-${tag}`);
  // A 2D USB scanner typing the box QR text into the scan box
  await s.p.goto(B + '/app/pos'); await s.p.waitForSelector('.pos-tile');
  await s.p.getByLabel('Scan or search items').fill(`IMEI1:${U[4].i1} IMEI2:${U[4].i2} SN:R58N${tag}`); await s.p.keyboard.press('Enter');
  ok(await until(async () => (await cart(s.p)).some((l) => l.serials.includes(U[4].i1)), 5000), '2D scanner: the box QR text typed into the scan box puts that phone on the bill');
  await s.p.keyboard.press('Control+Delete'); await s.p.keyboard.press('Enter');
  await s.p.evaluate(() => Object.keys(localStorage).filter((x) => x.startsWith('c360.pos.')).forEach((x) => localStorage.removeItem(x)));
  await s.b.close();

  /* A. Box QR code holding IMEI 1 and IMEI 2 */
  s = await open(qrVideo(`IMEI1:${U[0].i1} IMEI2:${U[0].i2} SN:R58N${tag}`, 'qr'));
  await posWithCamera(s);
  ok(await until(async () => (await cart(s.p)).some((l) => l.serials.includes(U[0].i1))), 'box QR code with both IMEIs: that phone goes on the bill');
  await s.p.waitForTimeout(2500);
  ok((await cart(s.p)).find((l) => l.id === phone.id)?.qty === 1 && !/isn’t in your stock|already on this bill/.test(await toasts(s.p)), 'once, with no false error for its second IMEI', await toasts(s.p));
  await s.p.screenshot({ path: `${work}/imei-qr.png` });
  await s.b.close();

  /* B. The box's model barcode first, then its IMEI label (camera stays visible for the IMEI) */
  s = await open(seq(bar('ean', ean, 'model'), bar('c128', U[1].i1, 'imei-b'), 'model-then-imei'));
  await posWithCamera(s);
  const sawPrompt = await until(async () => (await s.p.locator('.imei-inline').count()) > 0, 8000);
  ok(sawPrompt && await s.p.locator('.cam-scan video').isVisible(), 'model barcode read: “point the camera at its IMEI label” appears under the camera, which stays visible');
  await s.p.screenshot({ path: `${work}/imei-wait.png` });
  ok(await until(async () => (await cart(s.p)).some((l) => l.serials.includes(U[1].i1))), 'then the IMEI label read: that exact phone goes on the bill');
  await s.p.waitForTimeout(2000);
  ok((await cart(s.p)).find((l) => l.id === phone.id)?.qty === 1 && await s.p.locator('.imei-inline').count() === 0, 'one phone, and the IMEI question is closed (the model barcode still in view does not reopen it)');
  await s.b.close();

  /* C. IMEI 1 label then IMEI 2 label of the same phone */
  s = await open(seq(bar('c128', U[2].i1, 'i1'), bar('c128', U[2].i2, 'i2'), 'i1-then-i2'));
  await posWithCamera(s);
  ok(await until(async () => (await cart(s.p)).some((l) => l.serials.includes(U[2].i1))), 'IMEI 1 label: phone on the bill');
  await s.p.waitForTimeout(4500);
  ok((await cart(s.p)).find((l) => l.id === phone.id)?.qty === 1 && !/isn’t in your stock|already on this bill/.test(await toasts(s.p)), 'its IMEI 2 label after it: recognised as the same phone, no second unit, no error', await toasts(s.p));
  await s.b.close();

  /* D. IMEI 2 label alone also finds the phone */
  s = await open(bar('c128', U[3].i2, 'i2-only'));
  await posWithCamera(s);
  ok(await until(async () => (await cart(s.p)).some((l) => l.serials.includes(U[3].i1))), 'IMEI 2 label alone: the phone is found and billed by its IMEI 1');
  await s.b.close();

  /* E. IMEI-only mode ignores model barcodes */
  s = await open(bar('ean', ean, 'model2'));
  await posWithCamera(s, 'imei');
  await s.p.waitForTimeout(4000);
  ok((await cart(s.p)).length === 0 && await s.p.locator('.imei-inline').count() === 0 && !/isn’t in your stock/.test(await toasts(s.p)), 'IMEI-only mode: a model barcode in view is ignored (no item, no question, no error)');
  ok(/IMEI labels only, model barcodes ignored/.test(await s.p.locator('.cam-scan').innerText()), 'IMEI-only mode says what it is reading');
  await s.p.screenshot({ path: `${work}/imei-only.png` });
  await s.b.close();

  /* Nothing was charged: every unit is still in stock */
  s = await open(null);
  const sn = (await s.api('GET', `/shop/items/${phone.id}/serials`)).body;
  ok(sn.length === 5 && sn.every((x) => x.status === 'In stock'), 'nothing was sold by these checks (bills were not charged)');
} catch (e) {
  ok(false, 'script crashed', e.stack);
} finally {
  ok(errs.length === 0, 'no page errors', errs.slice(0, 5).join(' | '));
  for (const b of browsers) await b.close().catch(() => {});
}
