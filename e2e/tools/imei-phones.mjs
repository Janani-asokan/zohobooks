// The client's requests on customers, billing and purchases, done through the real screens like a shop owner:
//  1-2 customer mobile number optional, and only a real 10-digit number is saved
//  3   new customer from the invoice stays on the invoice
//  4   "+" to add a vendor from a bill or purchase order; IMEI / serial number per unit on itemised bills (typed and scanned)
//  5   Excel (.xlsx) import keeps IMEI numbers, on the Items page and in "Import from any software"
//  6   a shop with microfinance as well sees both on one dashboard
// Usage: BASE=http://localhost:4000 node e2e/tools/imei-phones.mjs <outDir> <items.xlsx> <vyapar.xlsx> <tag>
import { chromium } from 'playwright';
import fs from 'node:fs';
const B = process.env.BASE ?? 'http://localhost:4000';
const [out = '.', itemsXlsx, vyaparXlsx, tag] = process.argv.slice(2);
fs.mkdirSync(out, { recursive: true });
const log = [];
const ok = (c, m, why = '') => { const l = `${c ? 'PASS' : 'FAIL'} ${m}${!c && why ? ` (${why})` : ''}`; console.log(l); log.push(l); if (!c) process.exitCode = 1; };
const H = { 'x-requested-with': 'ledgerly' };
const b = await chromium.launch();
const errs = [];
const page = async (vp = { width: 1366, height: 860 }) => {
  const p = await (await b.newContext({ viewport: vp })).newPage();
  p.on('pageerror', (e) => errs.push(e.message));
  p.on('response', (r) => { if (r.url().includes('/api/') && r.status() >= 500) errs.push(`${r.status()} ${r.url()}`); });
  return p;
};
const apiOf = (p) => async (m, u, d) => { const r = await p.request.fetch(B + '/api' + u, { method: m, data: d, headers: H }); return { status: r.status(), body: await r.json().catch(() => null) }; };
const signIn = async (p, email, pass) => { await p.goto(B + '/login'); await p.fill('input[type=email]', email); await p.fill('input[type=password]', pass); await p.keyboard.press('Enter'); await p.waitForURL(/\/(app|super-admin)/); };
const dialog = (p, title) => p.locator('[role=dialog]').filter({ has: p.locator('h3', { hasText: title }) });

try {
  const o = await page(); const api = apiOf(o);
  await signIn(o, 'owner@shop.com', 'owner123');

  /* 1-2. Customers page: mobile optional and strict */
  await o.goto(B + '/app/sales/customers?new=1'); await o.waitForLoadState('networkidle');
  let d = dialog(o, 'New customer');
  await d.waitFor();
  const custName = `Walk-in Kavya ${tag}`;
  await d.getByLabel('Name', { exact: false }).first().fill(custName);
  await d.getByRole('button', { name: 'Save customer' }).click();
  await d.waitFor({ state: 'detached', timeout: 5000 }).catch(() => {});
  let list = (await api('GET', '/shop/customers')).body;
  ok(list.some((c) => c.name === custName && c.phone === ''), 'customer saved with no mobile number (optional)');

  for (const bad of ['98765', '98765432101', '1234567890', '98765abcde']) {
    await o.goto(B + '/app/sales/customers?new=1'); d = dialog(o, 'New customer'); await d.waitFor();
    await d.getByLabel('Name', { exact: false }).first().fill(`Bad Phone ${bad} ${tag}`);
    await d.getByLabel('Mobile number').fill(bad);
    await d.getByRole('button', { name: 'Save customer' }).click(); await o.waitForTimeout(400);
    const shown = await d.getByText(/10-digit mobile number/).count();
    list = (await api('GET', '/shop/customers')).body;
    ok(shown > 0 && !list.some((c) => c.name === `Bad Phone ${bad} ${tag}`), `“${bad}” is refused with a message and nothing is saved`, `message ${shown}`);
  }
  await o.goto(B + '/app/sales/customers?new=1'); d = dialog(o, 'New customer'); await d.waitFor();
  await d.getByLabel('Name', { exact: false }).first().fill(`Good Phone ${tag}`);
  await d.getByLabel('Mobile number').fill('098401-23456');
  await d.getByLabel('Mobile number').blur();
  ok(await d.getByLabel('Mobile number').inputValue() === '+91 98401 23456', 'typed “098401-23456” is tidied to +91 98401 23456 on leaving the box');
  await d.getByRole('button', { name: 'Save customer' }).click(); await d.waitFor({ state: 'detached', timeout: 5000 }).catch(() => {});
  list = (await api('GET', '/shop/customers')).body;
  ok(list.some((c) => c.name === `Good Phone ${tag}` && c.phone === '+91 98401 23456'), 'valid mobile saved as +91 98401 23456');

  /* 3. Invoice: new customer from the invoice, page stays on the invoice */
  await o.goto(B + '/app/sales/invoices/new'); await o.waitForLoadState('networkidle');
  const before = o.url();
  await o.getByRole('button', { name: 'New customer' }).click();
  d = dialog(o, 'New customer'); await d.waitFor();
  await d.locator('#qc-name').fill(`Invoice Quick ${tag}`);
  await d.locator('#qc-phone').fill('12345');
  await d.getByRole('button', { name: 'Save customer' }).click(); await o.waitForTimeout(300);
  ok(await d.getByText(/10-digit mobile number/).count() > 0, 'quick customer on the invoice: bad mobile refused');
  await d.locator('#qc-phone').fill('');
  await d.getByRole('button', { name: 'Save customer' }).click();
  await d.waitFor({ state: 'detached', timeout: 5000 });
  await o.waitForTimeout(400);
  ok(o.url() === before, 'after saving the customer the page is still the new invoice (no jump to Customers)', o.url());
  const selText = await o.getByLabel('Customer', { exact: true }).evaluate((s) => s.options[s.selectedIndex]?.text ?? '');
  ok(selText.startsWith(`Invoice Quick ${tag}`), 'the new customer is picked on the invoice', selText);
  // Finish the bill: item, issue
  const goods = (await api('GET', '/shop/items')).body.find((i) => i.type === 'Goods' && !i.isGroup && i.stock > 3 && !i.trackSerials && !i.trackBatches);
  await o.getByLabel('Item', { exact: true }).first().fill(goods.name);
  await o.locator('[role=option]').filter({ hasText: goods.name }).first().click();
  await o.getByRole('button', { name: /Issue invoice/ }).click();
  await o.waitForURL(/\/app\/sales\/invoices\/(?!new)[^/]+/, { timeout: 10000 }).catch(() => {});
  const invs = (await api('GET', '/shop/invoices')).body;
  ok(invs.some((i) => (i.customer?.name ?? '') === `Invoice Quick ${tag}`), 'invoice issued to the customer added from the invoice');

  /* 4a. Bill: "+" adds a vendor without leaving the bill; Escape closes only the top dialog */
  const phone = (await api('POST', '/shop/items', { type: 'Goods', name: `Vivo T3 ${tag}`, barcode: `89${tag}000017`.slice(0, 13), cost: 15000, sp1: 18999, sp2: 18999, sp3: 18999, taxSlabId: (await api('GET', '/shop/tax-slabs')).body.find((s) => s.rate === 18).id, trackSerials: true, openingStock: 0 })).body;
  ok(!!phone.id && phone.trackSerials, 'phone item with IMEI tracking ready', JSON.stringify(phone).slice(0, 200));
  await o.goto(B + '/app/purchases/bills?new=1'); await o.waitForLoadState('networkidle');
  const billD = dialog(o, 'New bill'); await billD.waitFor();
  await billD.getByRole('button', { name: 'New vendor' }).click();
  let vd = dialog(o, 'New vendor'); await vd.waitFor();
  await o.keyboard.press('Escape'); await o.waitForTimeout(300);
  ok(await vd.count() === 0 && await billD.count() === 1, 'Escape closes the vendor pop-up only; the bill stays open');
  await billD.getByRole('button', { name: 'New vendor' }).click(); vd = dialog(o, 'New vendor'); await vd.waitFor();
  await vd.getByRole('button', { name: 'Save vendor' }).click(); await o.waitForTimeout(200);
  ok(await vd.getByText('Vendor name is required').count() === 1, 'vendor pop-up needs a name');
  const vendorName = `Sri Balaji Mobiles ${tag}`;
  await vd.locator('#qv-name').fill(vendorName);
  await vd.locator('#qv-gstin').fill('24AAKFB1234M1Z8');
  await vd.getByRole('button', { name: 'Save vendor' }).click();
  await vd.waitFor({ state: 'detached', timeout: 5000 });
  const vSel = await billD.getByLabel('Vendor', { exact: true }).evaluate((s) => s.options[s.selectedIndex]?.text ?? '');
  ok(vSel.startsWith(vendorName) && await billD.count() === 1, 'new vendor saved, picked on the bill, bill still open', vSel);

  /* 4b. IMEI per unit on the itemised bill: scan the box, then its IMEI */
  const scan = billD.getByLabel('Scan to add to the bill');
  const imeis = [`35${tag}11111111`, `35${tag}22222222`];
  await scan.fill(phone.barcode); await scan.press('Enter');
  ok(await billD.getByText(/Now scan its IMEI/).count() === 1, 'scanning the box asks for its IMEI');
  await scan.fill(imeis[0]); await scan.press('Enter');
  await scan.fill(phone.barcode); await scan.press('Enter');
  await scan.fill(imeis[1]); await scan.press('Enter');
  await scan.fill(imeis[1]); await scan.press('Enter');
  ok(await billD.getByText(`${imeis[1]} is already on this bill`).count() === 1, 'the same IMEI scanned twice is refused');
  const box = billD.getByLabel(`IMEI / serial numbers for ${phone.name}`);
  ok((await box.inputValue()).split('\n').length === 2 && await billD.getByLabel('Quantity').first().inputValue() === '2', 'two units, two IMEIs on the line');
  // A third unit without its IMEI must not save
  await billD.getByLabel('Quantity').first().fill('3');
  await billD.getByRole('button', { name: 'Save bill' }).click(); await o.waitForTimeout(400);
  ok(await billD.getByText(/2 of 3 entered/).count() > 0, 'bill with 3 phones and 2 IMEIs is stopped with “2 of 3 entered”');
  await billD.getByRole('button', { name: 'Make quantity 2' }).click();
  await billD.getByRole('button', { name: 'Save bill' }).click();
  await billD.waitFor({ state: 'detached', timeout: 8000 }).catch(() => {});
  const sn = (await api('GET', `/shop/items/${phone.id}/serials`)).body;
  ok(sn.length === 2 && sn.every((s) => s.status === 'In stock' && s.vendorName === vendorName && /^BILL-/.test(s.billNumber)), 'bill saved: 2 IMEIs in stock, linked to the vendor and bill', JSON.stringify(sn).slice(0, 300));
  await o.goto(B + `/app/items/${phone.id}/edit`); await o.waitForLoadState('networkidle');
  ok(await o.getByText(imeis[0]).count() > 0 && await o.getByText(new RegExp(`From ${vendorName}`)).count() > 0, 'item page shows each IMEI and where it came from');
  await o.screenshot({ path: `${out}/item-imeis.png`, fullPage: true });

  /* 4c. Purchase order: "+" vendor and IMEIs when receiving */
  await o.goto(B + '/app/purchases/orders?new=1'); await o.waitForLoadState('networkidle');
  const poNew = o.locator('[role=dialog]').first();
  if (await o.getByRole('button', { name: 'New vendor' }).count() === 0) await o.getByRole('button', { name: /New purchase order|New order|New/ }).first().click();
  await o.getByRole('button', { name: 'New vendor' }).click();
  vd = dialog(o, 'New vendor'); await vd.waitFor();
  await vd.locator('#qv-name').fill(`PO Vendor ${tag}`);
  await vd.getByRole('button', { name: 'Save vendor' }).click(); await vd.waitFor({ state: 'detached' });
  const poSel = await poNew.getByLabel('Vendor', { exact: true }).evaluate((s) => s.options[s.selectedIndex]?.text ?? '');
  ok(poSel === `PO Vendor ${tag}`, 'purchase order: “+” vendor saved and picked', poSel);
  await o.keyboard.press('Escape');
  const vendors = (await api('GET', '/shop/vendors')).body;
  const po = (await api('POST', '/shop/purchase-orders', { vendorId: vendors.find((v) => v.name === `PO Vendor ${tag}`).id, date: new Date().toISOString().slice(0, 10), lines: [{ itemId: phone.id, qty: 1, rate: 15000 }] })).body;
  const noImei = await api('POST', `/shop/purchase-orders/${po.id}/receive`, { lines: [{ lineId: po.lines[0].id, qty: 1 }] });
  const withImei = await api('POST', `/shop/purchase-orders/${po.id}/receive`, { lines: [{ lineId: po.lines[0].id, qty: 1, serials: [`35${tag}33333333`] }] });
  ok(noImei.status === 400 && withImei.body?.status === 'Received', 'receiving a phone on a PO needs its IMEI; with it, stock is added');

  /* 5a. Items page: Excel file with IMEI column */
  await o.goto(B + '/app/items'); await o.waitForLoadState('networkidle');
  await o.getByRole('button', { name: /^Import$/ }).click();
  await o.locator('input[type=file][accept*=xlsx]').setInputFiles(itemsXlsx);
  await o.getByRole('button', { name: 'Import', exact: true }).last().click();
  await o.getByText(/created/).first().waitFor({ timeout: 10000 });
  const resText = await o.locator('[role=dialog]').innerText();
  ok(/2 created/.test(resText) && /3 IMEI \/ serial numbers saved/.test(resText), 'Excel import: 2 items created, 3 IMEIs saved', resText.slice(0, 300));
  await o.screenshot({ path: `${out}/items-xlsx-result.png` });
  let items = (await api('GET', '/shop/items')).body;
  const a15 = items.find((i) => i.sku === `A15-${tag}`);
  const a15sn = a15 ? (await api('GET', `/shop/items/${a15.id}/serials`)).body : [];
  ok(a15?.trackSerials && a15.stock === 3 && a15sn.map((s) => s.serial).sort().join() === [`35${tag}00000001`, `35${tag}00000027`, `35${tag}00000043`].join(), 'Galaxy A15: one item, stock 3, all 15 digits of every IMEI kept', JSON.stringify(a15sn.map((s) => s.serial)));
  ok(a15sn.some((s) => s.note.includes(`IMEI 2: 35${tag}00000019`)), 'IMEI 2 (dual SIM) saved with the unit');
  ok(items.find((i) => i.sku === `CAB-${tag}`)?.stock === 40, 'cable without IMEI imported with its stock column (40)');

  /* 5b. Import from any software: different column names, Sl No column ignored */
  await o.goto(B + '/app/accounting/tally'); await o.waitForLoadState('networkidle');
  await o.locator('input[type=file][accept*=xlsx]').setInputFiles(vyaparXlsx);
  await o.getByLabel('Column for IMEI / serial no.').waitFor({ timeout: 15000 });
  ok(await o.getByLabel('Column for IMEI / serial no.').inputValue() === 'IMEI No.', '“IMEI No.” column matched to IMEI automatically');
  await o.screenshot({ path: `${out}/mapping.png`, fullPage: true });
  await o.getByRole('button', { name: /^Import \d+/ }).click();
  await o.getByText(/IMEI \/ serial numbers? saved/).waitFor({ timeout: 10000 });
  items = (await api('GET', '/shop/items')).body;
  const r13 = items.find((i) => i.name === `Redmi 13C ${tag}`);
  ok(r13?.trackSerials && r13.stock === 2, 'Redmi 13C from the other software: one item, 2 IMEIs = stock 2', JSON.stringify(r13 ?? {}).slice(0, 200));

  /* Sell a phone by IMEI from the imported stock (POS / invoice checks the IMEI) */
  const cust = (await api('GET', '/shop/customers')).body[0];
  const sold = await api('POST', '/shop/invoices', { customerId: cust.id, date: new Date().toISOString().slice(0, 10), dueDate: new Date().toISOString().slice(0, 10), withGst: true, issue: true, lines: [{ itemId: a15.id, qty: 1, tier: 'SP1', serials: [`35${tag}00000027`] }] });
  const look = (await api('GET', `/shop/serials/lookup?q=${tag}00000027`)).body[0];
  ok(sold.status === 200 && look?.status === 'Sold' && look.invoiceNumber === sold.body.number, 'imported IMEI sold once and traceable to the invoice');

  /* 6. Shop with microfinance too: both on the dashboard */
  await o.goto(B + '/app'); await o.waitForLoadState('networkidle');
  const sec = o.getByRole('region', { name: 'Microfinance summary' });
  await sec.waitFor({ timeout: 10000 }).catch(() => {});
  ok(await sec.count() === 1 && await o.getByText('Sales this month').count() > 0, 'dashboard shows shop sales and the microfinance summary together');
  ok(await sec.getByText('Active loans').count() === 1 && !(await sec.innerText()).includes('—'), 'microfinance figures loaded', (await sec.innerText().catch(() => '')).slice(0, 200));
  await o.screenshot({ path: `${out}/dashboard.png`, fullPage: true });
  // A collector (loans only) still lands on the lending screen; a salesperson without lending access sees no lending card
  const s = await page(); await signIn(s, 'sales@shop.com', 'sales123'); await s.goto(B + '/app'); await s.waitForLoadState('networkidle');
  ok(await s.getByRole('region', { name: 'Microfinance summary' }).count() === 0, 'staff without microfinance access don’t see loan figures');
  const col = await page(); await signIn(col, 'collector@shop.com', 'collector123'); await col.goto(B + '/app'); await col.waitForURL(/microfinance/, { timeout: 8000 }).catch(() => {});
  ok(/\/app\/microfinance/.test(col.url()), 'collector still opens straight on microfinance');

  /* Phone width: bill form with IMEI box */
  const m = await page({ width: 390, height: 844 }); await signIn(m, 'owner@shop.com', 'owner123');
  await m.goto(B + '/app/purchases/bills?new=1'); await dialog(m, 'New bill').waitFor();
  const over = await m.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  ok(over <= 1, 'bill form fits a phone screen', `${over}px wider`);
} catch (e) {
  ok(false, 'script crashed', e.stack);
} finally {
  ok(errs.length === 0, 'no page errors or server 500s', errs.slice(0, 5).join(' | '));
  fs.writeFileSync(`${out}/log.txt`, log.join('\n'));
  await b.close();
}
