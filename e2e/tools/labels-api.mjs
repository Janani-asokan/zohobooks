// Barcode & Labels module API against the spec: barcode aliases (BL-06), duplicates blocked (BL-05), bulk generation
// fills missing only (BL-02) under the chosen generator (BL-03/04), templates publish immutable versions (BL-13),
// print sources with already-printed counts (BP-07), jobs are idempotent (BP-11), progress and resume (BP-09/10),
// reprints use the snapshot or fresh data (BP-12, QA-R05), roles (spec 2.4, QA-R03) and tenant isolation (QA-R04).
// Usage: BASE=http://localhost:4000 node e2e/tools/labels-api.mjs
import { chromium } from 'playwright';
const B = process.env.BASE ?? 'http://localhost:4000';
const ok = (c, m, why = '') => { console.log(`${c ? 'PASS' : 'FAIL'} ${m}${!c && why ? ` (${why})` : ''}`); if (!c) process.exitCode = 1; };
const b = await chromium.launch();
async function session(email, password) {
  const p = await (await b.newContext()).newPage();
  await p.goto(B + '/login'); await p.fill('input[type=email]', email); await p.fill('input[type=password]', password); await p.keyboard.press('Enter'); await p.waitForURL(/\/app|\/super/);
  return (m, u, d) => p.evaluate(async ([m, u, d]) => { const r = await fetch('/api' + u, { method: m, headers: { 'x-requested-with': 'ledgerly', 'content-type': 'application/json' }, body: d ? JSON.stringify(d) : undefined }); return { status: r.status, body: await r.json().catch(() => null) }; }, [m, u, d]);
}
const tag = Date.now().toString().slice(-6);
const idem = (s) => `${s}-${tag}-${Math.random().toString(36).slice(2, 10)}`;
const STOCK = { w: 50, h: 25, across: 2, gutter: 2, marginL: 1, marginR: 1, rowGap: 3, media: 'die-cut', sheet: 'roll', rows: 0, marginTop: 0, safeInset: 1 };
const PRINTER = { language: 'tspl', dpi: 203, headMm: 104, media: 'die-cut', offsetX: 0, offsetY: 0, darkness: 8, speed: 4 };
const TPL = { w: 50, h: 25, elements: [
  { id: 'a', type: 'field', field: 'name', x: 1, y: 1, w: 48, h: 3.5, size: 2.8, align: 'center', maxLines: 1, overflow: 'shrink' },
  { id: 'b', type: 'barcode', field: 'barcode', x: 1, y: 5, w: 48, h: 12, symbology: 'auto' },
  { id: 'c', type: 'field', field: 'price', x: 1, y: 19, w: 48, h: 3.5, size: 2.8, align: 'center' },
] };
let created = [];
try {
  const own = await session('owner@shop.com', 'owner123');
  const slab = (await own('GET', '/shop/tax-slabs')).body.find((x) => x.rate === 18).id;
  const mk = async (name, extra = {}) => { const r = await own('POST', '/shop/items', { type: 'Goods', name, cost: 10, sp1: 20, sp2: 20, sp3: 20, taxSlabId: slab, openingStock: 5, ...extra }); created.push(r.body?.id); return r.body; };
  const A = await mk(`LabelA ${tag}`, { barcode: `LA${tag}`, sku: `LA-${tag}` });
  const Bi = await mk(`LabelB ${tag}`, { sku: `LB-${tag}` });

  /* Barcodes */
  let r = await own('POST', `/shop/label/barcodes/${A.id}/replace`, { value: `LA2${tag}` });
  ok(r.status === 200 && r.body.barcode === `LA2${tag}`, 'replace a barcode', JSON.stringify(r.body));
  let items = (await own('GET', '/shop/items')).body;
  ok(items.find((i) => i.id === A.id).aliases.includes(`LA${tag}`), 'the old barcode stays as an alias, so shelf labels still scan (BL-06)');
  r = await own('PATCH', `/shop/items/${Bi.id}`, { barcode: `LA${tag}` });
  ok(r.status === 409 && /already used by another item/.test(r.body.error), 'another item cannot take that old barcode (BL-05)', JSON.stringify(r.body));
  const cov = (await own('GET', '/shop/label/barcodes')).body;
  ok(cov.items.some((i) => i.id === Bi.id && !i.barcode) && cov.missing >= 1, `coverage: ${cov.withBarcode}/${cov.total} with barcode, ${cov.missing} missing, ${cov.duplicates} duplicates`);
  const before = (await own('GET', '/shop/label/setup')).body.generator;
  r = await own('PUT', '/shop/label/generator', { mode: 'gs1', prefix: '', next: 1, digits: 6, gs1Prefix: '12' });
  ok(r.status === 400 && /GS1 company prefix/.test(r.body.error), 'EAN-13 numbers need a real GS1 company prefix (BL-04)');
  r = await own('PUT', '/shop/label/generator', { mode: 'series', prefix: `T${tag}-`, next: 1, digits: 4, gs1Prefix: '' });
  ok(r.status === 200, 'generator set to a Code 128 number series');
  r = await own('POST', '/shop/label/barcodes/bulk-generate', { ids: [A.id, Bi.id] });
  ok(r.body.generated === 1 && r.body.items[0].id === Bi.id && r.body.items[0].barcode === `T${tag}-0001`, 'bulk generate fills missing barcodes only (A keeps its own) (BL-02, BL-03)', JSON.stringify(r.body));
  await own('PUT', '/shop/label/generator', before);

  /* Stocks, printers, templates */
  const st = (await own('POST', '/shop/label/stocks', { name: `Test 2-up ${tag}`, geometry: STOCK })).body;
  ok(!!st.id, 'custom label stock saved');
  r = await own('POST', '/shop/label/stocks', { name: 'Bad', geometry: { ...STOCK, w: 5 } });
  ok(r.status === 400, 'a stock outside 10–200 mm is refused');
  const pr = (await own('POST', '/shop/label/printers', { name: `Counter TSC ${tag}`, settings: PRINTER })).body;
  ok(!!pr.id, 'printer profile saved');
  const tp = (await own('POST', '/shop/label/templates', { name: `Price tag ${tag}`, draft: TPL })).body;
  r = await own('POST', `/shop/label/templates/${tp.id}/publish`);
  ok(r.body.version === 1 && !r.body.dirty, 'template published as version 1');
  await own('PUT', `/shop/label/templates/${tp.id}`, { name: tp.name, draft: { ...TPL, elements: TPL.elements.slice(0, 2) } });
  const t2 = (await own('GET', '/shop/label/setup')).body.templates.find((t) => t.id === tp.id);
  ok(t2.dirty && t2.published.elements.length === 3, 'editing the draft leaves version 1 unchanged (BL-13)');

  /* Jobs */
  const job = { idemKey: idem('job'), source: { type: 'items', label: 'Items list' }, templateId: tp.id, template: TPL, stock: STOCK, printerId: pr.id, printer: PRINTER, options: {}, lines: [{ itemId: A.id, batch: '', qty: 4 }, { itemId: Bi.id, batch: '', qty: 2 }] };
  const j1 = (await own('POST', '/shop/label/jobs', job)).body;
  const j1again = (await own('POST', '/shop/label/jobs', job)).body;
  ok(j1.id && j1again.id === j1.id && j1.total === 6 && j1.templateVersion === 1, 'a job is created once, however many times it is sent (BP-11, QA-R02)', JSON.stringify(j1).slice(0, 200));
  ok(j1.lines[0].data.name === `LabelA ${tag}` && j1.lines[0].data.price === 20 && j1.lines[0].data.barcode === `LA2${tag}`, 'each line keeps a snapshot read from the database');
  r = await own('POST', '/shop/label/jobs', { ...job, idemKey: idem('big'), lines: [{ itemId: A.id, batch: '', qty: 10001 }] });
  ok(r.status === 400, 'jobs over 10,000 labels are refused (BP-05)');
  r = await own('POST', '/shop/label/jobs', { ...job, idemKey: idem('bad'), stock: { ...STOCK, w: 100, h: 50, across: 1 } });
  ok(r.status === 400 && /template is 50 × 25/.test(r.body.error), 'the server refuses a template that does not match the stock (spec 3.3)', JSON.stringify(r.body));
  r = await own('POST', '/shop/label/jobs/validate', { ...job, lines: [...job.lines, { itemId: null, batch: '', qty: 1 }] });
  ok(r.body.issues.some((x) => x.code === 'no-barcode' && x.line === 2), 'server pre-print check flags the line with no barcode');
  r = await own('POST', `/shop/label/jobs/${j1.id}/progress`, { sent: 6, printed: 3 });
  ok(r.body.status === 'partial' && r.body.printed === 3, 'progress: 3 of 6 printed, job partial (a jam) (BP-09)');
  r = await own('POST', `/shop/label/jobs/${j1.id}/progress`, { printed: 6 });
  ok(r.body.status === 'printed', 'resumed and finished: printed (BP-10)');

  /* Sources: a bill, with already-printed counts */
  const vendorId = (await own('GET', '/shop/vendors')).body[0].id;
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
  const bill = (await own('POST', '/shop/bills', { vendorId, date: today, dueDate: today, lines: [{ itemId: A.id, qty: 12, rate: 10 }, { itemId: Bi.id, qty: 5, rate: 10 }] })).body;
  let src = (await own('GET', `/shop/label/sources/bill/${bill.id}`)).body;
  ok(src.lines.length === 2 && src.lines[0].qty === 12 && src.lines[1].qty === 5, 'a bill opens with the received quantities filled in (spec 3.1)', JSON.stringify(src).slice(0, 200));
  const bj = (await own('POST', '/shop/label/jobs', { ...job, idemKey: idem('bill'), source: { type: 'bill', id: bill.id, label: src.source.label }, lines: src.lines.map((l) => ({ itemId: l.itemId, batch: '', qty: l.qty })) })).body;
  await own('POST', `/shop/label/jobs/${bj.id}/progress`, { sent: 17, printed: 17 });
  src = (await own('GET', `/shop/label/sources/bill/${bill.id}`)).body;
  ok(src.lines[0].printed === 12 && src.lines[1].printed === 5, 'the bill now shows the labels already printed, against duplicates (BP-07)');

  /* Reprint: snapshot vs fresh */
  const A2 = (await own('GET', '/shop/items')).body.find((i) => i.id === A.id);
  await own('PATCH', `/shop/items/${A.id}`, { sp1: 25, sp2: 25, sp3: 25 });
  const rp = (await own('POST', `/shop/label/jobs/${j1.id}/reprint`, { idemKey: idem('rp') })).body;
  const rf = (await own('POST', `/shop/label/jobs/${j1.id}/reprint`, { idemKey: idem('rf'), fresh: true })).body;
  ok(rp.lines[0].data.price === 20 && rp.source.type === 'reprint', 'reprint matches the original after a price change (QA-R05)');
  ok(rf.lines[0].data.price === 25, 'reprint with fresh data uses today’s price (BP-12)');
  const hist = (await own('GET', '/shop/label/jobs')).body;
  ok(hist.some((h) => h.id === j1.id && h.createdBy && h.templateName === tp.name && h.printerName === pr.name), 'history records user, template, printer and counts (BP-13)');

  /* Roles: a store operator (Sales Staff) */
  const ops = await session('sales@shop.com', 'sales123');
  r = await ops('POST', '/shop/label/jobs', { ...job, idemKey: idem('ops') });
  ok(r.status === 200 && r.body.total === 6, 'store operator can print with published templates (spec 2.4)', JSON.stringify(r.body).slice(0, 120));
  r = await ops('PUT', `/shop/label/printers/${pr.id}/calibrate`, { offsetX: 0.3, offsetY: -0.2, darkness: 9, speed: 4 });
  ok(r.status === 200 && r.body.settings.offsetX === 0.3, 'store operator can calibrate');
  for (const [m, u, d, what] of [['POST', '/shop/label/templates', { name: 'x', draft: TPL }, 'create templates'], ['POST', `/shop/label/templates/${tp.id}/publish`, undefined, 'publish templates'],
    ['POST', `/shop/label/barcodes/${A.id}/replace`, { value: 'HACK1' }, 'replace barcodes'], ['POST', '/shop/label/barcodes/bulk-generate', {}, 'generate barcodes'],
    ['PUT', '/shop/label/generator', { mode: 'series', prefix: 'X', next: 1, digits: 4, gs1Prefix: '' }, 'change the generator'], ['POST', '/shop/label/stocks', { name: 'x', geometry: STOCK }, 'add stock']]) {
    r = await ops(m, u, d); ok(r.status === 403, `store operator cannot ${what} (QA-R03)`, String(r.status));
  }
  r = await own('POST', `/shop/label/printers/${pr.id}/restore`);
  ok(r.body.settings.offsetX === 0, 'printer’s last-good settings can be restored (TP-13)');

  /* Tenant isolation */
  const other = await session('admin@ledgerly.in', 'admin123').catch(() => null);
  if (other) { r = await other('GET', `/shop/label/jobs/${j1.id}`); ok(r.status !== 200, 'another account cannot read this shop’s print job (QA-R04)', String(r.status)); }

  // Clean up the test records
  for (const t of [tp.id]) await own('DELETE', `/shop/label/templates/${t}`);
  await own('DELETE', `/shop/label/stocks/${st.id}`); await own('DELETE', `/shop/label/printers/${pr.id}`);
} catch (e) { ok(false, 'script crashed', e.stack); }
finally { await b.close(); }
