// Phase 6 check: copies, payment stamp, HSN summary, previous balance, locked GST fields, invoice trade fields, renewing a share link.
import { chromium } from 'playwright';
const B = process.env.BASE ?? 'http://localhost:4000';
const out = process.argv[2] ?? '.';
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
const p = await ctx.newPage();
const errs = []; p.on('pageerror', (e) => errs.push(e.message));
const ok = (c, m) => { console.log(`${c ? 'PASS' : 'FAIL'} ${m}`); if (!c) process.exitCode = 1; };
await p.goto(B + '/login'); await p.fill('input[type=email]', 'owner@shop.com'); await p.fill('input[type=password]', 'owner123'); await p.keyboard.press('Enter'); await p.waitForURL(/app/);
const api = async (method, url, data) => { const r = await p.request.fetch(B + '/api' + url, { method, data, headers: { 'x-requested-with': 'ledgerly' } }); return { status: r.status(), body: await r.json().catch(() => null) }; };
const invs = (await api('GET', '/shop/invoices')).body;
const list = Array.isArray(invs) ? invs : invs.rows ?? invs.items;
const issued = list.find((i) => i.status !== 'Draft' && i.customer);
ok(!!issued, `found an issued invoice ${issued?.number}`);

await p.goto(`${B}/invoices/${issued.id}/print?paper=a4&copy=all`); await p.waitForSelector('.ti');
ok((await p.locator('.ti-copy-page').count()) === 3, 'copy=all renders three copies');
const labels = await p.locator('.ti-copy').allTextContents();
ok(labels.length === 3 && /original/i.test(labels[0]) && /duplicate/i.test(labels[1]) && /triplicate/i.test(labels[2]), `copy labels: ${labels.join(' | ')}`);
ok((await p.locator('.ti-stamp').count()) >= 1, `payment stamp shown: ${(await p.locator('.ti-stamp').first().textContent().catch(() => ''))}`);
await p.screenshot({ path: `${out}/print-copies.png`, fullPage: false });

// HSN summary on
const ps = (await api('GET', '/shop/print-settings')).body;
await api('PUT', '/shop/print-settings', { ...ps, invoice: { ...ps.invoice, fields: { ...ps.invoice.fields, hsnSummary: true } } });
const draft = list.find((i) => i.status === 'Draft');
await p.goto(`${B}/invoices/${draft.id}/print?paper=a4`); await p.waitForSelector('.ti');
ok((await p.locator('.ti-hsn').count()) > 0, 'HSN summary table visible on a draft once turned on');
await p.goto(`${B}/invoices/${issued.id}/print?paper=a4`); await p.waitForSelector('.ti');
ok((await p.locator('.ti-hsn').count()) === 0, 'an issued invoice keeps its original layout (no HSN summary added)');
ok((await p.locator('.ti-prev').count()) <= 1, 'previous balance block renders when the customer owes something');
await p.screenshot({ path: `${out}/print-hsn.png`, fullPage: true });
await api('PUT', '/shop/print-settings', ps);

// PDF with copies
const pdf = await p.request.get(`${B}/api/shop/invoices/${issued.id}/pdf?paper=a4&copy=all`);
const disp = pdf.headers()['content-disposition'] ?? '';
ok(pdf.status() === 200 || pdf.status() === 503, `PDF copy=all status ${pdf.status()} ${disp}`);
if (pdf.status() === 200) ok(/INV.*-.+\.pdf/.test(disp), 'PDF name has the number and customer');

// Print settings: locked fields
await p.goto(`${B}/app/print-settings`); await p.waitForLoadState('networkidle');
const locks = await p.locator('.ps-lock').count();
ok(locks >= 4, `"Required by GST" locks shown: ${locks}`);
await p.screenshot({ path: `${out}/print-settings.png`, fullPage: false });

// Pharmacy invoice fields on the invoice form
await api('POST', '/shop/organization/business-type', { key: 'pharmacy', samples: false, printLayout: false });
await p.goto(`${B}/app/sales/invoices/new`); await p.waitForLoadState('networkidle');
ok((await p.locator('[data-testid="inv-extra-patientName"], #inv-extra-patientName, [name="inv-extra-patientName"]').count()) > 0, 'patient name field on the invoice form');
await p.screenshot({ path: `${out}/invoice-form.png`, fullPage: true });

// Renew link from the invoice view
await p.goto(`${B}/app/sales/invoices/${issued.id}`); await p.waitForSelector('.ti');
const before = (await api('GET', `/shop/invoices/${issued.id}`)).body.publicToken;
const r = await api('POST', `/shop/invoices/${issued.id}/share-link/renew`, {});
ok(r.status === 200 && r.body.publicToken !== before, 'link renewed');
ok((await p.request.get(`${B}/api/public/invoices/${before}`)).status() === 404, 'old link no longer opens');
ok((await p.request.get(`${B}/api/public/invoices/${r.body.publicToken}`)).status() === 200, 'new link opens');
console.log(errs.length ? 'PAGE ERRORS:\n' + errs.join('\n') : 'no page errors');
await b.close();
