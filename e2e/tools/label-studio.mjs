// Barcode & Labels hub, as a shop uses it, against the spec's acceptance tests: the start page; picking items; a
// 4-inch roll 2-up, a 100x50 label turned 90°, 4-up with QR codes, an A4 sheet; a job from a bill with the received
// quantities; a paper jam resumed from a chosen label; a line with no barcode skipped while the rest print; a
// published template chosen in the Workbench. Every PDF is checked for page size and count, and every printed barcode
// / QR is decoded at 203 dpi (a thermal printer's resolution). Plus the 58 mm receipt page width.
// Usage: BASE=http://localhost:4000 node e2e/tools/label-studio.mjs <outDir>
import { chromium } from 'playwright';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
// The label screen folds stock / printer / template under “More settings”.
const openMore = async (pg) => { const m = pg.getByRole('button', { name: 'More settings' }); if (await m.isVisible().catch(() => false)) await m.click(); };
import zx from '@zxing/library';
const { BinaryBitmap, DecodeHintType, HybridBinarizer, MultiFormatReader, RGBLuminanceSource, BarcodeFormat } = zx;
const B = process.env.BASE ?? 'http://localhost:4000';
const out = process.argv[2] ?? '.'; fs.mkdirSync(out, { recursive: true });
const ok = (c, m, why = '') => { console.log(`${c ? 'PASS' : 'FAIL'} ${m}${!c && why ? ` (${why})` : ''}`); if (!c) process.exitCode = 1; };
const mm = (pt) => Math.round((pt / 72) * 25.4 * 10) / 10;
const near = (a, b) => Math.abs(a - b) < 0.6;
const errs = [];
function pdfInfo(file) {
  const info = execFileSync('pdfinfo', [file]).toString();
  const [, w, h] = info.match(/Page size:\s+([\d.]+) x ([\d.]+)/);
  return { w: mm(Number(w)), h: mm(Number(h)), pages: Number(info.match(/Pages:\s+(\d+)/)[1]) };
}
/** Renders one PDF page at the printer's dpi and reads the code on each label (left to right). */
function scan(file, page, across, turn = 0, dpi = 203) {
  const base = `${file}-p${page}`;
  execFileSync('pdftoppm', ['-gray', '-r', String(dpi), '-f', String(page), '-l', String(page), '-singlefile', file, base]);
  const buf = fs.readFileSync(`${base}.pgm`);
  const head = buf.toString('latin1', 0, 64).match(/^P5\s+(\d+)\s+(\d+)\s+(\d+)\s/);
  let w = Number(head[1]), h = Number(head[2]);
  let px = new Uint8ClampedArray(buf.subarray(head[0].length, head[0].length + w * h));
  if (turn) { const r = new Uint8ClampedArray(w * h); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const [nx, ny] = turn === 90 ? [y, w - 1 - x] : [h - 1 - y, x]; r[ny * h + nx] = px[y * w + x]; } px = r; [w, h] = [h, w]; }
  const hints = new Map([[DecodeHintType.TRY_HARDER, true], [DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.EAN_13, BarcodeFormat.EAN_8, BarcodeFormat.UPC_A, BarcodeFormat.CODE_128, BarcodeFormat.QR_CODE]]]);
  const codes = []; const cw = Math.floor(w / across);
  for (let i = 0; i < across; i++) {
    const crop = new Uint8ClampedArray(cw * h);
    for (let y = 0; y < h; y++) crop.set(px.subarray(y * w + i * cw, y * w + i * cw + cw), y * cw);
    try { const r = new MultiFormatReader(); r.setHints(hints); const res = r.decode(new BinaryBitmap(new HybridBinarizer(new RGBLuminanceSource(crop, cw, h)))); codes.push({ text: res.getText(), format: BarcodeFormat[res.getBarcodeFormat()] }); } catch { codes.push(null); }
  }
  return codes;
}
const eanDigit = (s12) => { let t = 0; for (let i = 0; i < 12; i++) t += Number(s12[i]) * (i % 2 ? 3 : 1); return String((10 - (t % 10)) % 10); };
const b = await chromium.launch();
const created = [];
let call;
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
    // A wide roll row gets no CSS page size on the website (Chrome would print it landscape and the label driver
    // would turn it): the paper is the label stock set in the printer driver. Print onto that paper: one row.
    await p.evaluate(() => {
      const kept = [...document.querySelectorAll('style[data-keep]')].map((x) => x.textContent).join('');
      if (/size\s*:/.test(kept)) return;
      const r = document.querySelector('#print-root .label-row')?.getBoundingClientRect();
      if (!r || !r.width) return;
      const st = document.createElement('style'); st.dataset.keep = '1';
      st.textContent = `@page { size: ${(r.width * 25.4 / 96).toFixed(2)}mm ${(r.height * 25.4 / 96).toFixed(2)}mm; }`;
      document.head.appendChild(st);
    });
    fs.writeFileSync(file, await p.pdf({ preferCSSPageSize: true, printBackground: true }));
    await p.emulateMedia({ media: 'screen' });
    await p.evaluate(() => { document.querySelectorAll('style[data-keep]').forEach((s) => s.remove()); document.getElementById('print-root')?.remove(); document.body.classList.remove('printing', 'print-labels'); window.__printed = 0; });
    return { file, ...pdfInfo(file) };
  };
  const closeCards = async () => { for (const n of ['Quick check, only once for this label size', 'Did every label print?']) { const c = p.getByRole('region', { name: n }); if (await c.count()) { const x = c.getByRole('button', { name: /All printed|Close/ }).first(); if (await x.count()) await x.click().catch(() => {}); } } };
  await p.goto(B + '/login'); await p.fill('input[type=email]', 'owner@shop.com'); await p.fill('input[type=password]', 'owner123'); await p.keyboard.press('Enter'); await p.waitForURL(/\/app/);
  call = (m, u, d) => p.evaluate(async ([m, u, d]) => { const r = await fetch('/api' + u, { method: m, headers: { 'x-requested-with': 'ledgerly', 'content-type': 'application/json' }, body: d ? JSON.stringify(d) : undefined }); return { status: r.status, body: await r.json().catch(() => null) }; }, [m, u, d]);
  // This computer: labels come out right way up (so the one-time question doesn't cover the screen).
  await p.evaluate(() => localStorage.setItem('c360.printer', JSON.stringify({ labels: Object.fromEntries(['50x25', '100x50', '25x25', '38.1x21.2'].map((k) => [k, { turn: 0, ok: true }])) })));

  const tag = Date.now().toString().slice(-6);
  const slab = (await call('GET', '/shop/tax-slabs')).body.find((x) => x.rate === 18).id;
  const ean12 = `890${tag}123`; const ean = ean12 + eanDigit(ean12);
  const mk = async (name, extra) => { const r = (await call('POST', '/shop/items', { type: 'Goods', name, cost: 50, sp1: 99, sp2: 99, sp3: 99, mrp: 120, taxSlabId: slab, openingStock: 0, ...extra })).body; created.push(r?.id); return r; };
  const retail = await mk(`Label Soap ${tag}`, { barcode: ean });
  const coded = await mk(`Label Cable ${tag}`, { sku: `CB${tag}` });
  const tamil = await mk(`பொன்னி அரிசி 5 கிலோ ${tag}`, { barcode: `TA${tag}` });
  ok(retail?.barcode === ean && tamil?.name?.startsWith('பொன்னி'), 'test items made (EAN-13, SKU only, Tamil name)');

  /* Start page from the sidebar */
  await p.goto(B + '/app'); await p.waitForSelector('nav');
  if (!(await p.getByRole('link', { name: 'Barcode labels' }).first().isVisible())) await p.locator('nav').getByRole('button', { name: /Inventory/ }).first().click();
  await p.getByRole('link', { name: 'Barcode labels' }).first().click();
  await p.waitForURL(/\/app\/items\/labels/); await p.waitForTimeout(800);
  ok(await p.getByRole('heading', { name: 'Print barcode labels in three steps' }).isVisible() && (await p.getByRole('tab').allInnerTexts()).join('|').includes('Stock & Printers'), 'Inventory → Barcode labels: the hub with Workbench, Barcodes, Templates, Stock & Printers, History');

  /* Pick items */
  const pick = async (q) => { await p.getByPlaceholder('Find items by name, SKU or barcode').fill(q); await p.locator('.ls-results button', { hasText: q }).first().click(); };
  await pick(`Label Soap ${tag}`); await pick(`Label Cable ${tag}`); await pick('பொன்னி அரிசி');
  await p.getByPlaceholder('Find items by name, SKU or barcode').fill('');
  ok(await p.locator('.lb-lines li').count() === 3, 'three items picked');
  ok((await p.locator('.lv').allInnerTexts()).some((t) => t.includes('பொன்னி அரிசி')), 'Tamil item name on its label');
  const mods = await p.locator('.ls-sheets .lv-barcode svg').evaluateAll((els) => els.map((e) => Number(e.dataset.moduleMm)));
  ok(mods.length > 0 && mods.every((m) => Math.abs(m * 8 - Math.round(m * 8)) < 1e-6 && m >= 0.25), `every barcode on whole 0.125 mm dots (${[...new Set(mods)].join(', ')} mm)`);

  /* A. 2-up standard, one row each */
  await openMore(p); await p.locator('#ls-preset').selectOption({ label: '2-up standard · 50 × 25' });
  await p.getByRole('button', { name: 'One row each' }).click();
  await p.getByRole('button', { name: /^Print labels/ }).click();
  let r = await asPrinted('roll-2up'); await closeCards();
  ok(near(r.w, 104) && near(r.h, 25) && r.pages === 3, `2-up on a 4-inch roll: ${r.w} × ${r.h} mm, ${r.pages} rows`, JSON.stringify(r));
  const rows = [1, 2, 3].map((pg) => scan(r.file, pg, 2));
  const want = [ean, `CB${tag}`, `TA${tag}`];
  ok(rows.every((row, i) => row.every((c) => c?.text === want[i])), 'every label scans at 203 dpi with the right code', JSON.stringify(rows));
  ok(rows[0][0]?.format === 'EAN_13' && rows[1][0]?.format === 'CODE_128', 'EAN-13 prints as EAN-13, the SKU as Code 128');
  execFileSync('pdftoppm', ['-png', '-r', '200', '-f', '1', '-l', '1', r.file, `${out}/roll-2up`]);

  /* B. 100x50 turned 90° */
  await openMore(p); await p.locator('#ls-preset').selectOption({ label: '4-inch, single · 100 × 50' });
  await p.getByRole('radio', { name: 'Turn 90°' }).click();
  await p.getByRole('button', { name: 'Test print' }).click();
  r = await asPrinted('turned'); await closeCards();
  ok(near(r.w, 50) && near(r.h, 104) && r.pages === 1, `turned 90°: page ${r.w} × ${r.h} mm, test print = 1 page`);
  ok(scan(r.file, 1, 1, 90)[0]?.text === ean, 'the turned label still scans');
  await p.getByRole('radio', { name: 'As shown' }).click();

  /* C. 4-up 25 × 25: QR codes (Code 128 can’t fit 23 mm) */
  await openMore(p); await p.locator('#ls-preset').selectOption({ label: '4-up · 25 × 25' });
  ok(await p.locator('.ls-sheets .lv-qr').count() > 0, '4-up uses QR codes (spec 5: Code 128 holds only 3 characters at 25 mm)');
  await p.getByRole('button', { name: 'One row each' }).click();
  await p.getByRole('button', { name: /^Print labels/ }).click();
  r = await asPrinted('4up'); await closeCards();
  ok(near(r.w, 104) && near(r.h, 25), `4-up row: ${r.w} × ${r.h} mm`);
  const q = scan(r.file, 1, 4);
  ok(q.every((c) => c?.text === ean && c.format === 'QR_CODE'), '4-up QR codes scan at 203 dpi', JSON.stringify(q));

  /* D. A4 65 per sheet */
  await openMore(p); await p.locator('#ls-preset').selectOption({ label: 'A4 · 65 per sheet (38.1 × 21.2)' });
  await p.locator('.lb-lines li').first().locator('input[type=number]').fill('70');
  await p.getByRole('button', { name: /^Print labels/ }).click();
  r = await asPrinted('a4'); await closeCards();
  ok(near(r.w, 210) && near(r.h, 297) && r.pages === 2, `A4 sheet: ${r.w} × ${r.h} mm, ${r.pages} sheets for 74 labels`);
  await p.screenshot({ path: `${out}/workbench.png` });

  /* E. A bill: received quantities, a jam, resume */
  const vendorId = (await call('GET', '/shop/vendors')).body[0].id;
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
  const bill = (await call('POST', '/shop/bills', { vendorId, date: today, dueDate: today, lines: [{ itemId: retail.id, qty: 10, rate: 50 }, { itemId: coded.id, qty: 4, rate: 50 }] })).body;
  await p.goto(`${B}/app/items/labels?source=bill&id=${bill.id}`); await p.waitForSelector('.lb-lines li');
  const qtys = await p.locator('.lb-lines li input[type=number]').evaluateAll((els) => els.map((e) => Number(e.value)));
  ok(qtys.join(',') === '10,4', `a bill opens with what arrived: ${qtys.join(', ')} labels`);
  await openMore(p); await p.locator('#ls-preset').selectOption({ label: '2-up standard · 50 × 25' });
  await p.getByRole('button', { name: /^Print labels/ }).click();
  r = await asPrinted('bill');
  ok(r.pages === 7, `14 labels, 2-up: ${r.pages} rows`);
  const done = p.getByRole('region', { name: 'Did every label print?' });
  await done.waitFor({ timeout: 5000 });
  await done.getByLabel('Last label that printed').fill('6'); await done.getByRole('button', { name: 'Resume after it' }).click();
  await p.waitForTimeout(600);
  ok(/Resuming from label 7/.test(await p.locator('.ls-summary').innerText()), 'paper jam after label 6: ready to resume from label 7 (BP-10)');
  await p.getByRole('button', { name: /^Print labels/ }).click();
  r = await asPrinted('bill-resume');
  ok(r.pages === 4, `the resume prints only the 8 labels left: ${r.pages} rows`, JSON.stringify(r));
  await done.waitFor({ timeout: 5000 }); await done.getByRole('button', { name: 'All printed' }).click(); await p.waitForTimeout(500);
  const jobs = (await call('GET', '/shop/label/jobs')).body;
  const bj = jobs.find((j) => j.source.type === 'bill' && j.source.id === bill.id);
  ok(bj && bj.status === 'printed' && bj.total === 14 && bj.printed === 14, 'the job is in History as printed, 14 of 14', JSON.stringify(bj).slice(0, 160));
  const src = (await call('GET', `/shop/label/sources/bill/${bill.id}`)).body;
  ok(src.lines.every((l) => l.printed === l.qty), 'the bill remembers its labels were printed (no accidental duplicates)');

  /* F. A line that can't print is skipped; the rest print */
  const nocode = await mk(`No Code ${tag}`, { sku: '' });
  await call('PATCH', `/shop/items/${nocode.id}`, { sku: '' });
  await p.goto(`${B}/app/items/labels?ids=${retail.id},${nocode.id}`); await p.waitForSelector('.lb-lines li');
  ok(/skipped/.test(await p.locator('.lb-lines li.bad').innerText().catch(() => '')) || await p.locator('.lb-lines li.bad').count() === 1 || /no barcode/i.test(await p.locator('.lb-lines').innerText()), 'the item with no barcode is flagged and skipped');
  ok(await p.getByRole('button', { name: /^Print labels/ }).isEnabled(), 'the rest can still print');

  /* G. A published template, chosen in the Workbench */
  const tpl = { w: 50, h: 25, elements: [
    { id: 'q', type: 'qr', field: 'barcode', x: 1, y: 1, w: 18, h: 18 },
    { id: 'n', type: 'field', field: 'name', x: 21, y: 2, w: 28, h: 8, size: 2.8, bold: true, maxLines: 2, overflow: 'shrink', minSize: 1.6, align: 'left' },
    { id: 'p', type: 'field', field: 'price', x: 21, y: 13, w: 28, h: 5, size: 4, bold: true, align: 'left' },
  ] };
  const t = (await call('POST', '/shop/label/templates', { name: `QR tag ${tag}`, draft: tpl })).body;
  await call('POST', `/shop/label/templates/${t.id}/publish`);
  await p.goto(`${B}/app/items/labels?ids=${retail.id}`); await p.waitForSelector('.lb-lines li');
  await openMore(p); await p.locator('#ls-preset').selectOption({ label: '2-up standard · 50 × 25' });
  await openMore(p); await p.locator('#lb-template').selectOption({ label: `QR tag ${tag} · v1` });
  ok(await p.locator('.ls-sheets .lv-qr').count() > 0, 'a published template is chosen and drawn in the preview');
  await p.getByRole('button', { name: /^Print labels/ }).click();
  r = await asPrinted('template'); await closeCards();
  ok(scan(r.file, 1, 2).every((c) => c?.text === ean), 'labels from the template scan');
  const tj = (await call('GET', '/shop/label/jobs')).body[0];
  ok(tj.templateId === t.id && tj.templateVersion === 1, 'the job records the template version it printed (BL-13)');
  await call('DELETE', `/shop/label/templates/${t.id}`);

  /* H. Calibration print: the ruler is 100 mm across on a 4-inch roll */
  await p.getByRole('tab', { name: 'Stock & Printers' }).click();
  await p.getByRole('button', { name: 'Calibrate with 4-inch, single · 100 × 50' }).click();
  await p.getByRole('button', { name: 'Print calibration' }).click();
  r = await asPrinted('calibration');
  ok(near(r.w, 104) && near(r.h, 50), `calibration print on the 4-inch stock: ${r.w} × ${r.h} mm`);
  await p.getByRole('button', { name: 'Close' }).first().click();
} catch (e) { ok(false, 'script crashed', e.stack); }
finally {
  if (call) for (const id of created) if (id) await call('DELETE', `/shop/items/${id}`).catch(() => {});
  ok(errs.length === 0, 'no page errors or server 500s', errs.slice(0, 5).join(' | '));
  await b.close();
}
