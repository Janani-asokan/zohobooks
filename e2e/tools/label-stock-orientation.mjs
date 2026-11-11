// Label stock and orientation, website and phone app:
//  - the shop's label stock is chosen in Print settings → Label stock, saved, and every new computer / phone starts
//    with it (2-up standard 50 × 25 shows by name, not "Saved size");
//  - the turn saved with it applies on a new computer;
//  - the print page is the real row (104 × 25 mm) and the paper-size reminder is shown;
//  - in the app, "Send labels → Wi-Fi" sends TSPL with SIZE 104 mm,25 mm and the rows as bitmaps (saved as a PNG).
// Usage: BASE=http://localhost:4000 APP=http://localhost:5555 node e2e/tools/label-stock-orientation.mjs <outDir>
import { chromium } from 'playwright';
import fs from 'node:fs';
import zlib from 'node:zlib';
const B = process.env.BASE ?? 'http://localhost:4000';
const APP = process.env.APP ?? 'http://localhost:5555';
const out = process.argv[2] ?? '.'; fs.mkdirSync(out, { recursive: true });
const ok = (c, m, why = '') => { console.log(`${c ? 'PASS' : 'FAIL'} ${m}${!c && why ? ` (${why})` : ''}`); if (!c) process.exitCode = 1; };
const errs = [];
const b = await chromium.launch();
const login = async (p, base) => {
  await p.goto(base + '/login'); await p.fill('input[type=email]', 'owner@shop.com'); await p.fill('input[type=password]', 'owner123'); await p.keyboard.press('Enter');
  await p.waitForURL(/\/app/, { timeout: 30000 });
};
const fresh = async (init) => { const c = await b.newContext({ viewport: { width: 1366, height: 900 } }); if (init) await c.addInitScript(init); const p = await c.newPage(); p.on('pageerror', (e) => errs.push(e.message)); return p; };
const selText = (p, sel) => p.evaluate((s) => { const e = document.querySelector(s); return e ? e.options[e.selectedIndex]?.text ?? '' : null; }, sel);
const setStock = async (p, id, turn) => {
  await p.goto(B + '/app/print-settings?tab=barcode'); await p.waitForSelector('#ps-stock');
  await p.selectOption('#ps-stock', id);
  if (turn != null) await p.getByRole('tab', { name: turn === 0 ? 'As shown' : `Turn ${turn}°`, exact: true }).first().click();
  const save = p.getByRole('button', { name: /^Save$/ });
  if (await save.isEnabled()) { await save.click(); await p.waitForSelector('text=Print settings saved'); }
};

try {
  /* Website: choose the stock in Print settings, it sticks, and a new computer starts with it */
  const p = await fresh();
  await login(p, B);
  const before = await p.evaluate(async () => (await (await fetch('/api/shop/print-settings')).json()));
  await setStock(p, 'preset:4in-100x50');
  await p.reload(); await p.waitForSelector('#ps-stock');
  ok((await selText(p, '#ps-stock')).includes('100 × 50'), 'Print settings keeps the chosen stock after saving and reloading', await selText(p, '#ps-stock'));
  await setStock(p, 'preset:4in-50x25x2', 0);
  ok((await selText(p, '#ps-stock')) === '2-up standard · 50 × 25', '2-up standard · 50 × 25 can be chosen and saved in the label stock area', await selText(p, '#ps-stock'));
  ok(await p.getByTestId('paper-size-note').isVisible() && /104 × 25 mm/.test(await p.getByTestId('paper-size-note').innerText()), 'Print settings says which paper size the print window needs (104 × 25 mm)');
  await p.screenshot({ path: `${out}/print-settings-stock.png`, fullPage: true });

  const items = await p.evaluate(async () => (await (await fetch('/api/shop/items')).json()).filter((i) => i.type === 'Goods' && (i.barcode || i.sku)).slice(0, 2).map((i) => i.id));
  const p2 = await fresh(() => { window.__printed = []; window.print = () => { window.__printed.push([...document.querySelectorAll('style')].map((s) => s.textContent).join('\n')); window.dispatchEvent(new Event('afterprint')); }; });
  await login(p2, B);
  await p2.goto(B + `/app/items/labels?ids=${items.join(',')}&qty=2,2`); await p2.waitForSelector('#ls-preset'); await p2.waitForTimeout(1500);
  ok((await selText(p2, '#ls-preset')) === '2-up standard · 50 × 25', 'a new computer opens Barcode & Labels on the shop’s 2-up standard 50 × 25', await selText(p2, '#ls-preset'));
  ok(/4-inch/.test(await selText(p2, '#lb-printer')), 'the 4-inch label printer is picked for it', await selText(p2, '#lb-printer'));
  ok(await p2.getByTestId('paper-hint').isVisible(), 'the label screen reminds which paper size to use');
  await p2.getByRole('button', { name: /^Test print/ }).click();
  await p2.waitForFunction(() => window.__printed.length > 0, null, { timeout: 10000 });
  const css = await p2.evaluate(() => window.__printed[0]);
  ok(/size:\s*104mm 25mm/.test(css), 'the print page is the real row: 104 × 25 mm', (css.match(/size:[^;]+/) ?? [''])[0]);
  await p2.screenshot({ path: `${out}/workbench.png` });

  /* The turn saved for the shop applies on a new computer */
  await setStock(p, 'preset:4in-50x25x2', 90);
  const p3 = await fresh(() => { window.__printed = []; window.print = () => { window.__printed.push([...document.querySelectorAll('style')].map((s) => s.textContent).join('\n')); window.dispatchEvent(new Event('afterprint')); }; });
  await login(p3, B);
  await p3.goto(B + `/app/items/labels?ids=${items[0]}&qty=2`); await p3.waitForSelector('#ls-preset'); await p3.waitForTimeout(1500);
  ok(await p3.getByRole('radio', { name: 'Turn 90°' }).first().getAttribute('aria-checked') === 'true', 'the shop’s saved turn (90°) is used on a new computer');
  await p3.getByRole('button', { name: /^Test print/ }).click();
  await p3.waitForFunction(() => window.__printed.length > 0, null, { timeout: 10000 });
  ok(/size:\s*25mm 104mm/.test(await p3.evaluate(() => window.__printed[0])), 'turned 90°: the page is sent 25 × 104 mm');
  await setStock(p, 'preset:4in-50x25x2', 0);

  /* Phone app: straight to a Wi-Fi label printer in TSPL */
  const pa = await fresh(() => {
    window.__native = [];
    window.Capacitor = { isNativePlatform: () => true, getPlatform: () => 'android', nativePromise: (pl, m, o) => { window.__native.push({ m, o }); return new Promise((r) => setTimeout(() => r(m === 'btList' ? { devices: [] } : {}), 30)); } };
  });
  await login(pa, APP);
  await pa.goto(APP + `/app/items/labels?ids=${items.join(',')}&qty=2,2`); await pa.waitForSelector('#ls-preset'); await pa.waitForTimeout(1500);
  ok((await selText(pa, '#ls-preset')) === '2-up standard · 50 × 25', 'the phone app opens on the shop’s 2-up standard 50 × 25 too');
  await pa.getByRole('radio', { name: /Wi-Fi/ }).click();
  await pa.getByLabel('Printer IP address').fill('192.168.1.50');
  await pa.getByRole('button', { name: /^Use$/ }).click();
  ok(!(await pa.getByTestId('paper-hint').isVisible().catch(() => false)), 'with a direct printer there is no paper size to set');
  await pa.getByRole('button', { name: /^Test print/ }).click();
  await pa.waitForFunction(() => window.__native.some((c) => c.m === 'netPrint'), null, { timeout: 20000 });
  const call = await pa.evaluate(() => window.__native.find((c) => c.m === 'netPrint').o);
  ok(call.host === '192.168.1.50' && call.port === 9100, 'sent to the Wi-Fi printer on port 9100');
  const bytes = Buffer.from(call.data, 'base64');
  const head = bytes.subarray(0, 200).toString('latin1');
  ok(head.startsWith('SIZE 104 mm,25 mm\r\nGAP 3 mm,0 mm'), 'the printer is told the exact label: SIZE 104 mm,25 mm, GAP 3 mm', head.split('\r\n').slice(0, 2).join(' | '));
  const at = bytes.indexOf('BITMAP 0,0,'); const hdr = bytes.subarray(at, at + 40).toString('latin1').match(/BITMAP 0,0,(\d+),(\d+),0,/);
  ok(hdr && Number(hdr[1]) === 104 && Number(hdr[2]) === 200, `one row is 832 × 200 dots (104 × 25 mm at 203 dpi), upright: ${hdr?.[1]} bytes × ${hdr?.[2]}`);
  // Bitmap → PNG (TSPL: 0 bit = black) to look at.
  const start = at + hdr[0].length, bpr = Number(hdr[1]), h = Number(hdr[2]), w = bpr * 8;
  const raw = Buffer.alloc((w + 1) * h); let ink = 0;
  for (let y = 0; y < h; y++) { raw[y * (w + 1)] = 0; for (let x = 0; x < w; x++) { const black = !(bytes[start + y * bpr + (x >> 3)] & (0x80 >> (x & 7))); if (black) ink++; raw[y * (w + 1) + 1 + x] = black ? 0 : 255; } }
  const crc = (buf) => { let c = ~0; for (const v of buf) { c ^= v; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); } return ~c >>> 0; };
  const chunk = (t, d) => { const len = Buffer.alloc(4); len.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const cr = Buffer.alloc(4); cr.writeUInt32BE(crc(td)); return Buffer.concat([len, td, cr]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 0;
  fs.writeFileSync(`${out}/tspl-row.png`, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
  ok(ink > 2000, `the row has the labels on it (${ink} black dots)`);
  await pa.evaluate(() => { localStorage.removeItem('c360.labels.direct'); });
  // Put the demo shop back as it was.
  await p.evaluate(async (s) => { await fetch('/api/shop/print-settings', { method: 'PUT', headers: { 'content-type': 'application/json', 'x-requested-with': 'ledgerly' }, body: JSON.stringify(s) }); }, before);
} catch (e) { ok(false, 'script crashed', e.stack); }
finally { ok(errs.length === 0, 'no page errors', errs.slice(0, 3).join(' | ')); await b.close(); }
