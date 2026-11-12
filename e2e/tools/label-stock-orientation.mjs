// Label stock and orientation, website and phone app:
//  - the shop's label stock is chosen in Print settings → Label stock, saved, and every new computer / phone starts
//    with it (2-up standard 50 × 25 shows by name, not "Saved size");
//  - the turn saved with it applies on a new computer;
//  - a row wider than tall (104 × 25, 80 × 25…) is printed with NO page size on the website (a wide size makes Chrome
//    print landscape and the Windows label driver turns it sideways); the paper-size steps are shown instead;
//  - the 3-inch TVS LP 46 Lite with 2-up 38 × 25 labels: picked, shown and sent as SIZE 80 mm,25 mm;
//  - in the app, "Send labels → Wi-Fi" sends TSPL with SIZE 104 mm,25 mm and the rows as bitmaps (saved as a PNG).
// Usage: BASE=http://localhost:4000 APP=http://localhost:5555 node e2e/tools/label-stock-orientation.mjs <outDir>
import { chromium } from 'playwright';
import fs from 'node:fs';
import zlib from 'node:zlib';
import zx from '@zxing/library';
const { MultiFormatReader, BinaryBitmap, HybridBinarizer, RGBLuminanceSource, DecodeHintType, BarcodeFormat } = zx;
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
  await p2.goto(B + `/app/items/labels?ids=${items.join(',')}&qty=2,2`); await p2.waitForSelector('#ls-preset', { state: 'attached' }); await p2.waitForTimeout(1500);
  ok((await selText(p2, '#ls-preset')) === '2-up standard · 50 × 25', 'a new computer opens Barcode & Labels on the shop’s 2-up standard 50 × 25', await selText(p2, '#ls-preset'));
  ok(/4-inch/.test(await selText(p2, '#lb-printer')), 'the 4-inch label printer is picked for it', await selText(p2, '#lb-printer'));
  ok(await p2.getByTestId('paper-hint').isVisible(), 'the label screen reminds which paper size to use');
  await p2.getByRole('button', { name: /^Test print/ }).click();
  await p2.waitForFunction(() => window.__printed.length > 0, null, { timeout: 10000 });
  const css = await p2.evaluate(() => window.__printed[0]);
  const pageRule = (c) => (c.match(/@page\s*\{[^}]*\}/) ?? [''])[0];
  ok(pageRule(css) && !/size/.test(pageRule(css)), 'a wide row (104 × 25 mm) is printed without a page size, so Chrome never turns it landscape', pageRule(css));
  await p2.screenshot({ path: `${out}/workbench.png` });

  /* Big labels on the roll (the photo: 100 × 100 labels, 50 × 25 chosen): pick what is in the printer */
  await p2.evaluate(() => { window.__printed = []; });
  await p2.getByTestId('labels-in-printer').getByRole('radio', { name: /100 × 100/ }).click();
  ok((await selText(p2, '#ls-preset')).includes('100 × 100'), '“Which labels are in the printer?” → 100 × 100 sets the stock');
  await p2.getByRole('button', { name: /^Test print/ }).click();
  await p2.waitForFunction(() => window.__printed.length > 0, null, { timeout: 10000 });
  ok(!/size/.test(pageRule(await p2.evaluate(() => window.__printed[0]))), 'the 104 × 100 mm page (100 × 100 label with the roll margins) is not sent as landscape either');
  const fills = await p2.evaluate(() => { const r = document.querySelector('.ls-sheets .lb-slot'); const bar = r?.querySelector('svg, canvas, img'); return r && bar ? bar.getBoundingClientRect().width / r.getBoundingClientRect().width : 0; });
  ok(fills > 0.6, `the design fills the big label (barcode ${Math.round(fills * 100)}% of its width)`);
  await p2.screenshot({ path: `${out}/workbench-100x100.png` });

  /* The turn saved for the shop applies on a new computer */
  await setStock(p, 'preset:4in-50x25x2', 90);
  const p3 = await fresh(() => { window.__printed = []; window.print = () => { window.__printed.push([...document.querySelectorAll('style')].map((s) => s.textContent).join('\n')); window.dispatchEvent(new Event('afterprint')); }; });
  await login(p3, B);
  await p3.goto(B + `/app/items/labels?ids=${items[0]}&qty=2`); await p3.waitForSelector('#ls-preset', { state: 'attached' }); await p3.waitForTimeout(1500);
  await p3.getByRole('button', { name: 'More settings' }).click();
  ok(await p3.getByRole('radio', { name: 'Turn 90°' }).first().getAttribute('aria-checked') === 'true', 'the shop’s saved turn (90°) is used on a new computer');
  await p3.getByRole('button', { name: /^Test print/ }).click();
  await p3.waitForFunction(() => window.__printed.length > 0, null, { timeout: 10000 });
  ok(/size:\s*25mm 104mm/.test(await p3.evaluate(() => window.__printed[0])), 'turned 90°: the page is sent 25 × 104 mm');
  await setStock(p, 'preset:4in-50x25x2', 0);

  /* A normal user: Print greyed out says why, and one tap fixes it */
  const pu = await fresh();
  await login(pu, B);
  await pu.goto(B + '/app/items/labels'); await pu.waitForSelector('#ls-preset', { state: 'attached' }); await pu.waitForTimeout(1200);
  ok(await pu.getByRole('button', { name: /^Print labels/ }).isDisabled() && /Tap the items/.test(await pu.getByTestId('why-no-print').innerText()), 'with nothing chosen, Print is greyed out and says to choose items');
  ok(!(await pu.locator('#lb-printer').isVisible()) && /Printer:/.test(await pu.locator('.ls-setup-line').innerText()), 'stock, printer, template and layout are folded under “More settings”; the printer shows in one line');
  await pu.getByTestId('why-no-print').getByRole('button', { name: 'Choose items' }).click();
  await pu.locator('.ls-results button').first().click();
  await pu.waitForTimeout(500);
  ok(await pu.getByRole('button', { name: /^Print labels/ }).isEnabled() && await pu.getByTestId('why-no-print').count() === 0, 'after tapping one item Print is ready, with no warning');
  await pu.locator('.lb-lines input[type=number]').first().fill('0'); await pu.waitForTimeout(300);
  ok(/0 labels/.test(await pu.getByTestId('why-no-print').innerText()), 'set to 0 labels: it says so');
  await pu.getByRole('button', { name: 'Print 1 label each' }).click(); await pu.waitForTimeout(300);
  ok(await pu.getByRole('button', { name: /^Print labels/ }).isEnabled(), '“Print 1 label each” makes it printable again');
  await pu.getByRole('button', { name: 'More settings' }).click();
  ok(await pu.locator('#lb-printer').isVisible(), '“More settings” opens the printer and stock choices');
  await pu.screenshot({ path: `${out}/simple-panel.png`, fullPage: true });

  /* The photo: TVS LP 46 Lite with 100 × 100 labels, an item without MRP, "As the printer sees it" */
  const pt = await fresh(() => { localStorage.setItem('c360.labels.device', JSON.stringify({ printerId: 'preset:tvs-lp46-lite' })); });
  await login(pt, B);
  const noMrp = await pt.evaluate(async () => (await (await fetch('/api/shop/items')).json()).find((i) => i.type === 'Goods' && /^\d{13}$/.test(i.barcode ?? '') && !i.mrp && i.sp1));
  await pt.goto(B + `/app/items/labels?ids=${noMrp.id}&qty=1`); await pt.waitForSelector('#ls-preset', { state: 'attached' }); await pt.waitForTimeout(1200);
  await pt.getByTestId('labels-in-printer').getByRole('radio', { name: /100 × 100/ }).click(); await pt.waitForTimeout(400);
  ok(/TVS LP 46 Lite/.test(await selText(pt, '#lb-printer')) && !/prints only|head/.test(await pt.locator('.ls-stage').innerText()), 'TVS LP 46 Lite takes 100 × 100 labels: no “too wide for the head” warning', await selText(pt, '#lb-printer'));
  ok(await pt.getByRole('button', { name: /^Print labels/ }).isEnabled(), 'Print labels is ready');
  const priceBox = await pt.evaluate(() => { const lv = document.querySelector('.ls-sheets .lv'); const pr = [...lv.querySelectorAll('.lv-field')].find((e) => /₹/.test(e.textContent)); const a = lv.getBoundingClientRect(), b = pr.getBoundingClientRect(); return { mid: (b.left + b.right) / 2 - (a.left + a.right) / 2, w: a.width, align: getComputedStyle(pr).textAlign }; });
  ok(priceBox.align === 'center' && Math.abs(priceBox.mid) < priceBox.w * 0.05, 'no MRP: the price is centred on the label, not pushed to the edge', JSON.stringify(priceBox));
  const gaps = await pt.evaluate(() => { const lv = document.querySelector('.ls-sheets .lv'); const a = lv.getBoundingClientRect(); const els = [...lv.querySelectorAll('.lv-el')].map((e) => e.getBoundingClientRect()); return { top: Math.min(...els.map((r) => r.top)) - a.top, bottom: a.bottom - Math.max(...els.map((r) => r.bottom)) }; });
  ok(Math.abs(gaps.top - gaps.bottom) < 6, `the design sits in the middle of the big label (top ${Math.round(gaps.top)} px, bottom ${Math.round(gaps.bottom)} px)`);
  await pt.getByLabel(/As the printer sees it/).check();
  await pt.waitForSelector('.lb-mono-img', { timeout: 15000 });
  const monoPng = await pt.evaluate(() => document.querySelector('.lb-mono-img').src);
  const decoded = await pt.evaluate(async (src) => {
    const im = new Image(); im.src = src; await im.decode();
    const c = document.createElement('canvas'); c.width = im.width; c.height = im.height; const x = c.getContext('2d'); x.drawImage(im, 0, 0);
    return { w: im.width, h: im.height, data: Array.from(x.getImageData(0, 0, im.width, im.height).data.filter((_, i) => i % 4 === 0)) };
  }, monoPng);
  let code = null;
  try { const hints = new Map([[DecodeHintType.TRY_HARDER, true]]); const r = new MultiFormatReader(); r.setHints(hints); code = r.decode(new BinaryBitmap(new HybridBinarizer(new RGBLuminanceSource(Uint8ClampedArray.from(decoded.data), decoded.w, decoded.h)))).getText(); } catch { /* no code */ }
  ok(decoded.w === 832 && decoded.h === 800, `“As the printer sees it” is the printer’s own dots: ${decoded.w} × ${decoded.h} (104 × 100 mm at 203 dpi)`);
  ok(code === noMrp.barcode, `the barcode in that view scans as ${noMrp.barcode}`, String(code));
  await pt.screenshot({ path: `${out}/tvs-100x100-1bit.png`, fullPage: true });
  await pt.getByLabel(/As the printer sees it/).uncheck();
  await pt.screenshot({ path: `${out}/tvs-100x100.png`, fullPage: true });

  /* The 3-inch TVS LP 46 Lite with 2-up 38 × 25 labels */
  await setStock(p, 'preset:3in-38x25x2', 0);
  ok(/80 × 25 mm/.test(await p.getByTestId('paper-size-note').innerText()) && /TVS LP 46 Lite/.test(await p.getByTestId('paper-size-note').innerText()), 'Print settings gives the TVS LP 46 Lite steps for 80 × 25 mm');
  const p4 = await fresh(() => { window.__printed = []; window.print = () => { window.__printed.push([...document.querySelectorAll('style')].map((s) => s.textContent).join('\n')); window.dispatchEvent(new Event('afterprint')); }; });
  await login(p4, B);
  await p4.goto(B + `/app/items/labels?ids=${items.join(',')}&qty=2,2`); await p4.waitForSelector('#ls-preset', { state: 'attached' }); await p4.waitForTimeout(1500);
  ok((await selText(p4, '#ls-preset')) === '3-inch, 2-up · 38 × 25', 'a new computer opens on the shop’s 3-inch 2-up 38 × 25', await selText(p4, '#ls-preset'));
  ok(/TVS LP 46 Lite/.test(await selText(p4, '#lb-printer')), 'the 3-inch TVS LP 46 Lite is the printer picked', await selText(p4, '#lb-printer'));
  ok(await p4.getByRole('radio', { name: /^3-inch roll/ }).getAttribute('aria-checked') === 'true' && await p4.getByTestId('labels-in-printer').getByRole('radio', { name: '38 × 25, 2 across' }).getAttribute('aria-checked') === 'true', '“Which labels are in the printer?” shows the 3-inch roll with 38 × 25, 2 across chosen');
  const hint = await p4.getByTestId('paper-hint').innerText();
  ok(/80 × 25 mm/.test(hint) && /Print using system dialog/.test(hint) && /Page Setup/.test(hint), 'the label screen shows how to reach Page Setup from Chrome (system dialog → Preferences) for 80 × 25 mm');
  await p4.getByRole('button', { name: /^Test print/ }).click();
  await p4.waitForFunction(() => window.__printed.length > 0, null, { timeout: 10000 });
  ok(!/size/.test(pageRule(await p4.evaluate(() => window.__printed[0]))), 'the 80 × 25 mm row is printed portrait onto the printer’s label stock (no landscape page size)');
  await p4.screenshot({ path: `${out}/workbench-3in.png`, fullPage: true });
  await setStock(p, 'preset:4in-50x25x2', 0);

  /* Phone app: straight to a Wi-Fi label printer in TSPL */
  const pa = await fresh(() => {
    window.__native = [];
    window.Capacitor = { isNativePlatform: () => true, getPlatform: () => 'android', nativePromise: (pl, m, o) => { window.__native.push({ m, o }); return new Promise((r) => setTimeout(() => r(m === 'btList' ? { devices: [] } : {}), 30)); } };
  });
  await login(pa, APP);
  await pa.goto(APP + `/app/items/labels?ids=${items.join(',')}&qty=2,2`); await pa.waitForSelector('#ls-preset', { state: 'attached' }); await pa.waitForTimeout(1500);
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
  await pa.evaluate(() => { window.__native.length = 0; });
  await pa.getByTestId('labels-in-printer').getByRole('radio', { name: /100 × 100/ }).click();
  await pa.getByRole('button', { name: /^Test print/ }).click();
  await pa.waitForFunction(() => window.__native.some((c) => c.m === 'netPrint'), null, { timeout: 20000 });
  const big = Buffer.from(await pa.evaluate(() => window.__native.find((c) => c.m === 'netPrint').o.data), 'base64').subarray(0, 60).toString('latin1');
  ok(big.startsWith('SIZE 104 mm,100 mm'), 'on 100 × 100 labels the printer is told SIZE 104 mm,100 mm', big.split('\r\n')[0]);
  await pa.evaluate(() => { window.__native.length = 0; });
  await pa.getByRole('radio', { name: /^3-inch roll/ }).click();
  await pa.getByTestId('labels-in-printer').getByRole('radio', { name: '38 × 25, 2 across' }).click();
  await pa.getByRole('button', { name: /^Test print/ }).click();
  await pa.waitForFunction(() => window.__native.some((c) => c.m === 'netPrint'), null, { timeout: 20000 });
  const tvs = Buffer.from(await pa.evaluate(() => window.__native.find((c) => c.m === 'netPrint').o.data), 'base64');
  const tvsHead = tvs.subarray(0, 120).toString('latin1');
  const th = tvs.subarray(tvs.indexOf('BITMAP 0,0,'), tvs.indexOf('BITMAP 0,0,') + 40).toString('latin1').match(/BITMAP 0,0,(\d+),(\d+),/);
  ok(tvsHead.startsWith('SIZE 80 mm,25 mm\r\nGAP 3 mm,0 mm\r\nDIRECTION 1,0') && th && Number(th[1]) === 80 && Number(th[2]) === 200, '3-inch 2-up 38 × 25: SIZE 80 mm,25 mm, upright, 640 × 200 dots', tvsHead.split('\r\n').slice(0, 3).join(' | '));
  await pa.evaluate(() => { localStorage.removeItem('c360.labels.direct'); });
  // Put the demo shop back as it was.
  await p.evaluate(async (s) => { await fetch('/api/shop/print-settings', { method: 'PUT', headers: { 'content-type': 'application/json', 'x-requested-with': 'ledgerly' }, body: JSON.stringify(s) }); }, before);
} catch (e) { ok(false, 'script crashed', e.stack); }
finally { ok(errs.length === 0, 'no page errors', errs.slice(0, 3).join(' | ')); await b.close(); }
