// Label studio: the barcode labels page as a shop uses it. Opens on its own (the landing state), picks items, prints
// on a 4 inch roll with 2 across, a 100x50 label turned 90°, a 3-across roll and an A4 sticker sheet, and checks the
// PDF Chrome would send to the printer: page size, page count, and that every barcode on it scans at 203 dpi (a
// thermal label printer's resolution). Also: an item name in Tamil, saving the layout as the shop's default (and a
// layout that doesn't fit being refused), and the 58 mm receipt page width.
// Usage: BASE=http://localhost:4000 node e2e/tools/label-studio.mjs <outDir>
import { chromium } from 'playwright';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import zx from '@zxing/library';
const { BinaryBitmap, DecodeHintType, HybridBinarizer, MultiFormatReader, RGBLuminanceSource, BarcodeFormat } = zx;
const B = process.env.BASE ?? 'http://localhost:4000';
const out = process.argv[2] ?? '.'; fs.mkdirSync(out, { recursive: true });
const ok = (c, m, why = '') => { console.log(`${c ? 'PASS' : 'FAIL'} ${m}${!c && why ? ` (${why})` : ''}`); if (!c) process.exitCode = 1; };
const H = { 'x-requested-with': 'ledgerly' };
const mm = (pt) => Math.round((pt / 72) * 25.4 * 10) / 10;
const near = (a, b) => Math.abs(a - b) < 0.6;
const errs = [];

function pdfInfo(file) {
  const info = execFileSync('pdfinfo', [file]).toString();
  const [, w, h] = info.match(/Page size:\s+([\d.]+) x ([\d.]+)/);
  return { w: mm(Number(w)), h: mm(Number(h)), pages: Number(info.match(/Pages:\s+(\d+)/)[1]) };
}
/** Renders one PDF page at the printer's dpi and reads the barcodes on it (one per label, left to right). */
function scan(file, page, across, turn = 0, dpi = 203) {
  const base = `${file}-p${page}`;
  execFileSync('pdftoppm', ['-gray', '-r', String(dpi), '-f', String(page), '-l', String(page), '-singlefile', file, base]);
  const buf = fs.readFileSync(`${base}.pgm`);
  const head = buf.toString('latin1', 0, 64).match(/^P5\s+(\d+)\s+(\d+)\s+(\d+)\s/);
  let w = Number(head[1]), h = Number(head[2]);
  let px = new Uint8ClampedArray(buf.subarray(head[0].length, head[0].length + w * h));
  if (turn) { // undo the turn so the row reads left to right again
    const r = new Uint8ClampedArray(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const [nx, ny] = turn === 90 ? [y, w - 1 - x] : [h - 1 - y, x];
      r[ny * h + nx] = px[y * w + x];
    }
    px = r; [w, h] = [h, w];
  }
  const hints = new Map([[DecodeHintType.TRY_HARDER, true], [DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.EAN_13, BarcodeFormat.EAN_8, BarcodeFormat.UPC_A, BarcodeFormat.CODE_128]]]);
  const codes = [];
  const cw = Math.floor(w / across);
  for (let i = 0; i < across; i++) {
    const crop = new Uint8ClampedArray(cw * h);
    for (let y = 0; y < h; y++) crop.set(px.subarray(y * w + i * cw, y * w + i * cw + cw), y * cw);
    try {
      const r = new MultiFormatReader(); r.setHints(hints);
      const res = r.decode(new BinaryBitmap(new HybridBinarizer(new RGBLuminanceSource(crop, cw, h))));
      codes.push({ text: res.getText(), format: BarcodeFormat[res.getBarcodeFormat()] });
    } catch { codes.push(null); }
  }
  return codes;
}

/** Leftmost and rightmost printed column of page 1, in mm. */
function inkColumns(file) {
  execFileSync('pdftoppm', ['-gray', '-r', '203', '-f', '1', '-l', '1', '-singlefile', file, `${file}-ink`]);
  const buf = fs.readFileSync(`${file}-ink.pgm`);
  const head = buf.toString('latin1', 0, 64).match(/^P5\s+(\d+)\s+(\d+)\s+(\d+)\s/);
  const w = Number(head[1]), h = Number(head[2]); const px = buf.subarray(head[0].length);
  let l = w, r = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (px[y * w + x] < 128) { if (x < l) l = x; if (x > r) r = x; }
  const toMm = (n) => Math.round((n / 203) * 25.4 * 10) / 10;
  return { left: toMm(l), right: toMm(r + 1) };
}
const eanDigit = (s12) => { let t = 0; for (let i = 0; i < 12; i++) t += Number(s12[i]) * (i % 2 ? 3 : 1); return String((10 - (t % 10)) % 10); };
const b = await chromium.launch();
try {
  const p = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  p.on('pageerror', (e) => errs.push(e.message));
  p.on('response', (r) => { if (r.url().includes('/api/') && r.status() >= 500) errs.push(`${r.status()} ${r.url()}`); });
  // Keep the @page rule the app adds just before window.print(), so the PDF is what the printer would get.
  await p.addInitScript(() => { window.print = () => { document.querySelectorAll('style').forEach((s) => { if (s.textContent.includes('@page')) { const c = s.cloneNode(true); c.dataset.keep = '1'; document.head.appendChild(c); } }); window.__printClass = document.body.className; window.__printed = (window.__printed ?? 0) + 1; }; });
  const asPrinted = async (name) => {
    await p.waitForFunction(() => window.__printed > 0);
    await p.evaluate(() => { if (window.__printClass) document.body.className = window.__printClass; });
    await p.emulateMedia({ media: 'print' });
    const file = `${out}/${name}.pdf`;
    fs.writeFileSync(file, await p.pdf({ preferCSSPageSize: true, printBackground: true }));
    await p.emulateMedia({ media: 'screen' });
    await p.evaluate(() => { document.querySelectorAll('style[data-keep]').forEach((s) => s.remove()); document.getElementById('print-root')?.remove(); document.body.classList.remove('printing', 'print-labels'); window.__printClass = ''; window.__printed = 0; });
    return { file, ...pdfInfo(file) };
  };
  await p.goto(B + '/login'); await p.fill('input[type=email]', 'owner@shop.com'); await p.fill('input[type=password]', 'owner123'); await p.keyboard.press('Enter'); await p.waitForURL(/\/app/);
  const api = async (m, u, d) => { const r = await p.request.fetch(B + '/api' + u, { method: m, data: d, headers: H }); return { status: r.status(), body: await r.json().catch(() => null) }; };
  const before = (await api('GET', '/shop/print-settings')).body;

  // Items: one with a retail EAN-13, one with a letters-and-digits SKU only, one named in Tamil.
  const tag = Date.now().toString().slice(-6);
  const slab = (await api('GET', '/shop/tax-slabs')).body.find((x) => x.rate === 18).id;
  const ean12 = `890${tag}123`; const ean = ean12 + eanDigit(ean12);
  const mk = async (name, extra) => (await api('POST', '/shop/items', { type: 'Goods', name, cost: 50, sp1: 99, sp2: 99, sp3: 99, mrp: 120, taxSlabId: slab, openingStock: 0, ...extra })).body;
  const retail = await mk(`Label Soap ${tag}`, { barcode: ean });
  const coded = await mk(`Label Cable ${tag}`, { sku: `CBL-${tag}-X` });
  const tamil = await mk(`பொன்னி அரிசி 5 கிலோ ${tag}`, { barcode: `TA${tag}` });
  ok(retail?.barcode === ean && coded?.sku === `CBL-${tag}-X` && tamil?.name?.startsWith('பொன்னி'), 'test items made (EAN-13, SKU only, Tamil name)', JSON.stringify([retail, coded, tamil]).slice(0, 200));

  /* Landing: the page on its own, from the sidebar */
  await p.goto(B + '/app'); await p.waitForSelector('nav');
  if (!(await p.getByRole('link', { name: 'Barcode labels' }).first().isVisible())) await p.locator('nav').getByRole('button', { name: /Inventory/ }).first().click();
  await p.getByRole('link', { name: 'Barcode labels' }).first().click();
  await p.waitForURL(/\/app\/items\/labels/);
  await p.waitForTimeout(800);
  const act = await p.locator('nav a.nav-link.active').allInnerTexts();
  ok(await p.getByRole('heading', { name: 'Print barcode labels in three steps' }).isVisible() && act.length === 1, `(sidebar highlights: ${act.join(', ')}) ` + 'sidebar → Barcode labels opens the studio’s start page (three steps, item picker, label stock)');
  await p.screenshot({ path: `${out}/studio-home.png` });

  /* Pick items with the search box */
  const pick = async (q) => { await p.getByPlaceholder('Find items by name, SKU or barcode').fill(q); await p.locator('.ls-results button', { hasText: q }).first().click(); };
  await pick(`Label Soap ${tag}`); await pick(`Label Cable ${tag}`); await pick('பொன்னி அரிசி');
  await p.getByPlaceholder('Find items by name, SKU or barcode').fill('');
  ok(await p.locator('.ls-chosen li').count() === 3, 'three items picked from the search list', String(await p.locator('.ls-chosen li').count()));
  ok(await p.locator('.blabel[data-format=EAN13]').count() > 0 && await p.locator('.blabel[data-format=CODE128]').count() > 0, 'retail code drawn as EAN-13, SKU as Code 128');
  ok((await p.locator('.blabel').allInnerTexts()).some((t) => t.includes('பொன்னி அரிசி')), 'Tamil item name shows on its label');

  // Bars sit on whole printer dots and are not stretched
  const widths = await p.locator('.blabel svg.bl-code').evaluateAll((els) => els.map((e) => ({ css: e.style.width, vb: Number(e.getAttribute('viewBox').split(' ')[2]) })));
  ok(widths.length > 0 && widths.every((x) => { const mmW = parseFloat(x.css); const dot = mmW / x.vb / 0.125; return Math.abs(dot - Math.round(dot)) < 1e-6; }), 'every barcode: narrow bar = a whole number of 0.125 mm dots', JSON.stringify(widths.slice(0, 3)));

  /* A. 50x25, 2 across, 4 inch roll, 2 copies each (one row each) */
  await p.locator('#ls-preset').selectOption({ label: '50x25 · 2 across · 4 inch roll' });
  await p.getByRole('button', { name: 'One row each' }).click();
  await p.getByRole('button', { name: 'Print labels' }).click();
  let r = await asPrinted('roll-50x25x2');
  ok(near(r.w, 104) && near(r.h, 25) && r.pages === 3, `4 inch roll, 2 across: ${r.w} × ${r.h} mm pages, ${r.pages} rows (3 items × 2)`, JSON.stringify(r));
  const rowA = [1, 2, 3].map((pg) => scan(r.file, pg, 2));
  const want = [ean, `CBL-${tag}-X`, `TA${tag}`];
  ok(rowA.every((row, i) => row.every((c) => c?.text === want[i])), 'every label on the roll scans at 203 dpi, with the right code', JSON.stringify(rowA));
  ok(rowA[0][0]?.format === 'EAN_13' && rowA[1][0]?.format === 'CODE_128', 'EAN-13 scans as EAN-13, the SKU as Code 128');
  execFileSync('pdftoppm', ['-png', '-r', '200', '-f', '1', '-l', '1', r.file, `${out}/roll-50x25x2`]);

  /* B. 100x50 turned 90° (labels coming out sideways) */
  await p.locator('#ls-preset').selectOption({ label: '100x50 · 1 across · 4 inch roll' });
  await p.getByRole('radio', { name: 'Turn 90°' }).click();
  await p.getByRole('button', { name: 'Test print' }).click();
  r = await asPrinted('roll-100x50-turned');
  ok(near(r.w, 50) && near(r.h, 104) && r.pages === 1, `turned 90°: page sent as ${r.w} × ${r.h} mm (label 100 × 50 on a 104 mm roll), test print = 1 page`, JSON.stringify(r));
  const turned = scan(r.file, 1, 1, 90);
  ok(turned[0]?.text === ean, 'the turned label still scans (read after turning back)', JSON.stringify(turned));
  await p.getByRole('radio', { name: 'Turn 270°' }).click();
  await p.getByRole('button', { name: 'Test print' }).click();
  r = await asPrinted('roll-100x50-270');
  ok(near(r.w, 50) && near(r.h, 104) && scan(r.file, 1, 1, 270)[0]?.text === ean, 'turned 270° also prints and scans');
  await p.getByRole('radio', { name: 'As shown' }).click();

  /* C. 3 across on a 4 inch roll, custom size typed in */
  await p.locator('#ls-preset').selectOption({ label: '32x25 · 3 across · 4 inch roll' });
  await p.getByRole('button', { name: 'Print labels' }).click();
  r = await asPrinted('roll-32x25x3');
  ok(near(r.w, 102) && near(r.h, 25), `3 across (32 × 3 + 2 gaps of 2 + 1 mm each edge): ${r.w} × ${r.h} mm`, JSON.stringify(r));
  ok(scan(r.file, 1, 3).filter((c) => c).length >= 2, '3-across labels scan (32 mm wide)', JSON.stringify(scan(r.file, 1, 3)));
  await p.locator('#ls-w').fill('60');
  ok(/wider than the 104 mm roll/.test(await p.locator('.ls-panel [role=alert]').innerText()) && await p.getByRole('button', { name: 'Print labels' }).isDisabled(), 'a size that doesn’t fit the roll is flagged and printing waits');
  await p.locator('#ls-w').fill('32');

  /* D. A4 sticker sheet, 65 per sheet */
  await p.getByRole('tab', { name: 'A4 sheet' }).click();
  await p.locator('#ls-preset').selectOption({ label: 'A4 · 65 per sheet (38x21)' });
  await p.getByRole('button', { name: 'One per piece in stock' }).click(); // 0 stock → 1 each
  await p.locator('.ls-chosen li').first().locator('input').fill('70');
  await p.getByRole('button', { name: 'Print labels' }).click();
  r = await asPrinted('a4-65');
  ok(near(r.w, 210) && near(r.h, 297) && r.pages === 2, `A4 sheet: ${r.w} × ${r.h} mm, 72 labels on ${r.pages} sheets`, JSON.stringify(r));
  execFileSync('pdftoppm', ['-png', '-r', '60', '-f', '1', '-l', '1', r.file, `${out}/a4-65`]);
  await p.screenshot({ path: `${out}/studio-a4.png` });

  /* E. Save as the shop's default; a layout that doesn't fit is refused by the server too */
  await p.getByRole('tab', { name: 'Label roll' }).click();
  await p.locator('#ls-preset').selectOption({ label: '38x25 · 2 across · 3 inch roll' });
  await p.getByRole('button', { name: /Save as this shop’s default/ }).click();
  await p.waitForTimeout(600);
  const saved = (await api('GET', '/shop/print-settings')).body.barcode;
  ok(saved.layout?.w === 38 && saved.layout.across === 2 && saved.layout.rollMm === 80 && saved.labelSize === '38x25-2', 'layout saved as default (and the older label size kept in step)', JSON.stringify(saved.layout));
  const badPut = await api('PUT', '/shop/print-settings', { ...before, barcode: { ...before.barcode, layout: { ...saved.layout, across: 3, w: 50 } } });
  ok(badPut.status === 400 && /wider than the 80 mm roll/.test(JSON.stringify(badPut.body)), 'server refuses a layout wider than its roll', JSON.stringify(badPut.body).slice(0, 160));
  await p.goto(`${B}/app/items/labels?ids=${retail.id}`); await p.waitForSelector('.blabel');
  ok(await p.locator('.blabel').count() === 2 && await p.locator('#ls-preset').inputValue() === '38x25-2-across-3-inch-roll', 'opened from an item: starts with one row on the saved layout');

  /* F. 58 mm receipt: full roll vs printed width only */
  const inv = (await api('GET', '/shop/invoices')).body; const one = (Array.isArray(inv) ? inv : inv.rows ?? inv.items).find((i) => i.status !== 'Draft');
  await p.goto(`${B}/invoices/${one.id}/print?paper=thermal&roll=2in`); await p.waitForSelector('.receipt'); await p.waitForTimeout(300);
  await p.evaluate(() => window.dispatchEvent(new Event('beforeprint')));
  await p.emulateMedia({ media: 'print' });
  fs.writeFileSync(`${out}/r58.pdf`, await p.pdf({ preferCSSPageSize: true, printBackground: true }));
  const r58 = pdfInfo(`${out}/r58.pdf`);
  await p.emulateMedia({ media: 'screen' });
  ok(near(r58.w, 58) && r58.pages === 1, `58 mm receipt page: ${r58.w} × ${r58.h} mm, ${r58.pages} page`);
  const ink = inkColumns(`${out}/r58.pdf`);
  ok(ink.left >= 4 && ink.right <= 54 && Math.abs(ink.left - (58 - ink.right)) < 2.5, `receipt text sits in the middle of the 58 mm roll (${ink.left}–${ink.right} mm; the print head covers about 5–53 mm)`);
  const put = await api('PUT', '/shop/print-settings', { ...before, thermal: { ...before.thermal, pageWidth: 'printable' } });
  ok(put.status === 200 && put.body.thermal.pageWidth === 'printable', '“printed width only” saved', JSON.stringify(put.body).slice(0, 200));
  await p.goto(`${B}/invoices/${one.id}/print?paper=thermal&roll=2in`); await p.waitForSelector('.receipt'); await p.waitForTimeout(300);
  await p.evaluate(() => window.dispatchEvent(new Event('beforeprint')));
  await p.emulateMedia({ media: 'print' });
  fs.writeFileSync(`${out}/r48.pdf`, await p.pdf({ preferCSSPageSize: true, printBackground: true }));
  await p.emulateMedia({ media: 'screen' });
  const r48 = pdfInfo(`${out}/r48.pdf`); const ink48 = inkColumns(`${out}/r48.pdf`);
  ok(near(r48.w, 48) && ink48.left >= 0 && ink48.right <= 48 && ink48.right - ink48.left > 40, `“printed width only”: page ${r48.w} mm, text ${ink48.left}–${ink48.right} mm, nothing cut off`);
  execFileSync('pdftoppm', ['-png', '-r', '150', '-f', '1', '-l', '1', `${out}/r58.pdf`, `${out}/r58`]);

  // Put the settings back, remove the test items
  await api('PUT', '/shop/print-settings', { ...before, barcode: { ...before.barcode, layout: before.barcode.layout ?? null } });
  for (const it of [retail, coded, tamil]) if (it?.id) await api('DELETE', `/shop/items/${it.id}`);
} catch (e) {
  ok(false, 'script crashed', e.stack);
} finally {
  ok(errs.length === 0, 'no page errors or server 500s', errs.slice(0, 5).join(' | '));
  await b.close();
}
