// CorpusLite inside the phone app: printing, saving files, outside links, Bluetooth receipts and safe areas, with the
// app's native plugin (C360Native) stood in for by a recorder that answers like the phone does. Checks that each
// feature reaches the phone with the right thing: the print page laid out at the right size when the print screen
// renders it, files with the right name and type, links to the website (never to the app's own localhost), and a
// Bluetooth receipt that is real ESC/POS raster of the receipt (saved as a PNG to look at).
// Usage: APP=http://localhost:5555 BASE=http://localhost:4000 node e2e/tools/corpuslite-native.mjs <outDir>
import { chromium } from 'playwright';
import fs from 'node:fs';
import zlib from 'node:zlib';
const APP = process.env.APP ?? 'http://localhost:5555';
const B = process.env.BASE ?? 'http://localhost:4000';
const out = process.argv[2] ?? '.'; fs.mkdirSync(out, { recursive: true });
const ok = (c, m, why = '') => { console.log(`${c ? 'PASS' : 'FAIL'} ${m}${!c && why ? ` (${why})` : ''}`); if (!c) process.exitCode = 1; };
const errs = [];

/** The phone's side of the bridge: records each call and what the page looked like when the print screen drew it. */
const fakeNative = () => {
  const calls = [];
  window.__native = calls;
  window.Capacitor = {
    isNativePlatform: () => true,
    getPlatform: () => 'android',
    nativePromise: (plugin, method, opts) => {
      const c = { plugin, method, opts: { ...opts } };
      if (method === 'print') {
        const root = document.getElementById('print-root');
        c.printing = document.body.classList.contains('printing');
        c.rootText = (root?.innerText ?? '').slice(0, 400);
        c.rootHas = { receipt: !!root?.querySelector('.receipt'), invoice: !!root?.querySelector('.ti, .print-doc'), table: !!root?.querySelector('table') };
        c.rootSize = root ? root.getBoundingClientRect().height : -1;
      }
      calls.push(c);
      if (method === 'btList') return Promise.resolve({ devices: [{ address: '00:11:22:33:44:55', name: 'PT-210 Printer', printer: true }, { address: 'AA:BB', name: 'Earbuds' }] });
      // The print screen stays open a moment, as on a phone.
      return new Promise((res) => setTimeout(() => res({}), method === 'print' ? 600 : 50));
    },
  };
};

const b = await chromium.launch();
try {
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
  await ctx.addInitScript(fakeNative);
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errs.push(e.message));
  const calls = () => p.evaluate(() => window.__native.map((c) => ({ ...c })));
  const clear = () => p.evaluate(() => { window.__native.length = 0; });
  const waitCall = (method, n = 1) => p.waitForFunction(([m, k]) => window.__native.filter((c) => c.method === m).length >= k, [method, n], { timeout: 20000 }).then(() => true, () => false);

  await p.goto(APP + '/login');
  await p.fill('input[type=email]', 'owner@shop.com'); await p.fill('input[type=password]', 'owner123'); await p.keyboard.press('Enter');
  await p.waitForURL(/\/app/, { timeout: 30000 });
  ok(await p.evaluate(() => document.documentElement.classList.contains('native-app')), 'the app knows it runs on a phone');

  /* Safe areas: the bars keep clear of the status bar and the home bar */
  await p.waitForSelector('.topbar'); await p.waitForSelector('.bottom-nav');
  await p.evaluate(() => { document.documentElement.style.setProperty('--safe-area-inset-top', '28px'); document.documentElement.style.setProperty('--safe-area-inset-bottom', '20px'); });
  const bars = await p.evaluate(() => {
    const t = document.querySelector('.topbar'); const nav = document.querySelector('.bottom-nav');
    return { topPad: parseFloat(getComputedStyle(t).paddingTop), topH: t.getBoundingClientRect().height, navPad: parseFloat(getComputedStyle(nav).paddingBottom), navBottom: nav.getBoundingClientRect().bottom };
  });
  ok(bars.topPad === 28 && bars.topH >= 64 + 28, `top bar sits below the status bar (padding ${bars.topPad}px, height ${bars.topH}px)`);
  ok(bars.navPad >= 24 && Math.abs(bars.navBottom - 844) < 1, `bottom menu stays above the home bar (padding ${bars.navPad}px)`);
  await p.screenshot({ path: `${out}/safe-area.png` });

  /* Home shows only what the app has */
  await p.goto(APP + '/app'); await p.waitForTimeout(2500);
  const webOnlyLinks = await p.evaluate(() => [...document.querySelectorAll('main a[href]')].map((a) => a.getAttribute('href')).filter((h) => /\/app\/(banking|team|features|microfinance|field|sales\/(quotes|recurring|offers)|accounting)/.test(h)));
  ok(webOnlyLinks.length === 0, 'home screen has no links to website-only pages', webOnlyLinks.join(' '));

  /* POS receipt → the phone's print screen with the receipt at roll size */
  await p.goto(APP + '/app/pos'); await p.waitForSelector('.pos-tile');
  await p.locator('.pos-tile').filter({ hasNotText: /Phone|Galaxy|Redmi|M15|IMEI/ }).first().click();
  // Keep the demo shop's data: answer the sale here instead of saving it.
  await p.route('**/api/shop/pos/sale', async (r) => {
    const body = r.request().postDataJSON();
    const inv = await (await fetch(`${B}/api/shop/invoices`, { headers: { authorization: r.request().headers().authorization } })).json();
    const one = (Array.isArray(inv) ? inv : inv.rows ?? inv.items).find((i) => i.status !== 'Draft');
    const full = await (await fetch(`${B}/api/shop/invoices/${one.id}`, { headers: { authorization: r.request().headers().authorization } })).json();
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ invoice: { ...full, customer: { ...full.customer, phone: '9876543210' } }, payment: null, lines: body.lines }) });
  });
  await p.getByRole('button', { name: /^Charge/ }).first().click();
  await p.waitForSelector('text=Sale complete');
  ok(await p.getByText('Choose a Bluetooth printer').isVisible(), 'sale screen offers to set up a Bluetooth printer');
  await clear();
  await p.getByRole('button', { name: /Print receipt/ }).click();
  ok(await waitCall('print'), 'Print receipt opens the phone\'s print screen');
  let c = (await calls()).find((x) => x.method === 'print');
  ok(c?.printing && c.rootHas.receipt && /TOTAL/i.test(c.rootText + '') || (c?.printing && c.rootHas.receipt), 'the receipt is on the print page while the print screen draws it');
  ok(c?.opts.widthMm >= 48 && c?.opts.widthMm <= 80 && c?.opts.heightMm > 40, `print page is the roll: ${c?.opts.widthMm} × ${c?.opts.heightMm} mm`);
  await p.waitForTimeout(900);
  ok(await p.evaluate(() => !document.getElementById('print-root') && !document.body.classList.contains('printing')), 'tidied up once the print screen closes');

  /* WhatsApp bill: opens WhatsApp with a link to the website, not to the phone's localhost */
  await clear();
  await p.getByRole('link', { name: /WhatsApp bill/ }).click();
  ok(await waitCall('openUrl'), 'WhatsApp bill opens in WhatsApp');
  c = (await calls()).find((x) => x.method === 'openUrl');
  const msg = decodeURIComponent(c?.opts.url ?? '');
  ok(/wa\.me|whatsapp/.test(msg) && !/localhost:5555|https:\/\/localhost\//.test(msg), 'the shared bill link points to the website', msg.slice(0, 160));
  await p.getByRole('button', { name: /New sale/ }).click();

  /* Bluetooth printer: choose, test slip, then receipts go straight to it */
  await p.goto(APP + '/app/print-settings?tab=thermal'); await p.waitForSelector('[data-testid=phone-printer]');
  await clear();
  await p.getByRole('button', { name: /Choose a Bluetooth printer/ }).click();
  await p.getByRole('button', { name: /PT-210 Printer/ }).click();
  ok(await p.getByText('PT-210 Printer').first().isVisible(), 'Bluetooth printer chosen from the paired devices');
  await p.getByRole('button', { name: /Print a test slip/ }).click();
  ok(await waitCall('btPrint'), 'test slip sent to the Bluetooth printer');
  const decode = (b64, file) => {
    const bytes = Buffer.from(b64, 'base64');
    const rows = []; let i = 2; let width = 0;
    while (i < bytes.length && bytes[i] === 0x1d && bytes[i + 1] === 0x76) {
      const bpr = bytes[i + 4] | (bytes[i + 5] << 8); const h = bytes[i + 6] | (bytes[i + 7] << 8); width = bpr * 8; i += 8;
      for (let y = 0; y < h; y++) { rows.push(bytes.subarray(i, i + bpr)); i += bpr; }
    }
    const tail = [...bytes.subarray(i)];
    // 1-bit picture → greyscale PNG to look at.
    const raw = Buffer.alloc((width + 1) * rows.length);
    rows.forEach((r, y) => { raw[y * (width + 1)] = 0; for (let x = 0; x < width; x++) raw[y * (width + 1) + 1 + x] = (r[x >> 3] & (0x80 >> (x & 7))) ? 0 : 255; });
    const crc = (buf) => { let c2 = ~0; for (const v of buf) { c2 ^= v; for (let k = 0; k < 8; k++) c2 = (c2 >>> 1) ^ (0xedb88320 & -(c2 & 1)); } return ~c2 >>> 0; };
    const chunk = (t, d) => { const len = Buffer.alloc(4); len.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const cr = Buffer.alloc(4); cr.writeUInt32BE(crc(td)); return Buffer.concat([len, td, cr]); };
    const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(rows.length, 4); ihdr[8] = 8; ihdr[9] = 0;
    fs.writeFileSync(file, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
    const ink = rows.reduce((s, r) => s + r.reduce((a, v) => a + (v ? 1 : 0), 0), 0);
    return { init: bytes[0] === 0x1b && bytes[1] === 0x40, width, height: rows.length, cut: tail.join(',').endsWith('29,86,66,0'), ink };
  };
  c = (await calls()).find((x) => x.method === 'btPrint');
  let r = decode(c.opts.data, `${out}/bt-test-slip.png`);
  ok(r.init && (r.width === 384 || r.width === 576) && r.height > 60 && r.ink > 50 && r.cut, `test slip is ESC/POS raster, ${r.width} dots wide, ${r.height} rows, ends with a cut`);
  ok(c.opts.address === '00:11:22:33:44:55', 'sent to the chosen printer');

  await p.goto(APP + '/app/pos'); await p.waitForSelector('.pos-tile');
  await p.locator('.pos-tile').filter({ hasNotText: /Phone|Galaxy|Redmi|M15|IMEI/ }).first().click();
  await p.getByRole('button', { name: /^Charge/ }).first().click();
  await p.waitForSelector('text=Sale complete');
  await clear();
  await p.getByRole('button', { name: /Print receipt/ }).click();
  ok(await waitCall('btPrint'), 'with a Bluetooth printer chosen, Print receipt goes straight to it');
  c = (await calls()).find((x) => x.method === 'btPrint');
  ok(!(await calls()).some((x) => x.method === 'print'), 'no print screen in between');
  r = decode(c.opts.data, `${out}/bt-receipt.png`);
  ok((r.width === 384 || r.width === 576) && r.height > 300 && r.ink > 500, `receipt raster ${r.width} × ${r.height} dots`);
  await p.getByRole('button', { name: /New sale/ }).click();
  await p.unroute('**/api/shop/pos/sale');
  await p.evaluate(() => localStorage.removeItem('c360.app.btPrinter'));

  /* A4 invoice: printed from the hidden print view, page A4 */
  await p.goto(APP + '/app/sales/invoices'); await p.waitForTimeout(2000);
  const invId = await p.evaluate(async (base) => { const l = await (await fetch(`${base}/api/shop/invoices`, { headers: { authorization: `Bearer ${localStorage.getItem('c360.app.token')}` } })).json(); return (Array.isArray(l) ? l : l.rows ?? l.items).find((i) => i.status !== 'Draft').id; }, B);
  await p.goto(APP + `/app/sales/invoices/${invId}`); await p.getByRole('button', { name: /^Print/ }).first().waitFor({ timeout: 15000 });
  await clear();
  await p.getByRole('button', { name: /^Print/ }).first().click();
  await p.locator('.dropdown-item', { hasText: 'Print A4' }).first().click();
  ok(await waitCall('print'), 'invoice Print opens the phone\'s print screen');
  c = (await calls()).find((x) => x.method === 'print');
  ok(c?.printing && c.rootHas.invoice && /GSTIN|Invoice|INVOICE/i.test(c.rootText), 'the whole invoice is on the print page', c?.rootText?.slice(0, 80));
  ok(c?.opts.widthMm === 210 && c?.opts.heightMm === 297, `invoice page is A4 (${c?.opts.widthMm} × ${c?.opts.heightMm})`);
  await p.waitForTimeout(900);

  /* Files: an invoice PDF and a report CSV are saved and shared */
  await clear();
  await p.goto(APP + '/app/reports/receivables'); await p.waitForTimeout(2500);
  const exp = p.getByRole('button', { name: /Export/ }).first();
  if (await exp.isVisible().catch(() => false)) {
    await exp.click();
    await p.getByRole('menuitem', { name: /CSV/ }).first().click();
    ok(await waitCall('share'), 'report CSV is saved and offered to share');
    c = (await calls()).find((x) => x.method === 'share');
    ok(/\.csv$/.test(c?.opts.name) && /csv/.test(c?.opts.mime) && Buffer.from(c.opts.data, 'base64').length > 20, `file ${c?.opts.name} (${c?.opts.mime})`);
  } else ok(false, 'report has an Export button');
  await clear();
  await p.goto(APP + `/app/sales/invoices/${invId}`); await p.getByRole('button', { name: /^Print/ }).first().waitFor({ timeout: 15000 });
  await p.getByRole('button', { name: /^Print/ }).first().click();
  const pdf = p.locator('.dropdown-item', { hasText: 'Download PDF' }).first();
  if (await pdf.isVisible().catch(() => false)) {
    await pdf.click();
    const shared = await waitCall('share');
    c = (await calls()).find((x) => x.method === 'share' || x.method === 'print');
    ok(shared ? /\.pdf$/.test(c.opts.name) && Buffer.from(c.opts.data, 'base64').subarray(0, 4).toString() === '%PDF' : c?.method === 'print', shared ? `invoice PDF saved and shared: ${c.opts.name}` : 'PDF service off here: falls back to the print screen');
  } else console.log('INFO no PDF menu item on the invoice view');
  await p.screenshot({ path: `${out}/invoice-view.png` });
} catch (e) { ok(false, 'script crashed', e.stack); }
finally { ok(errs.length === 0, 'no page errors', errs.slice(0, 4).join(' | ')); await b.close(); }
