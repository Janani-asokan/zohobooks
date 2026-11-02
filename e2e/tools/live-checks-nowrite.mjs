// Live check of the customer / purchase / IMEI / import / dashboard changes WITHOUT saving anything in the demo shop:
// every step stops at a validation, a cancel, or a preview. (The saving flows are covered by imei-phones.mjs locally.)
// Usage: BASE=https://… node e2e/tools/live-checks-nowrite.mjs <outDir> <items.xlsx> <vyapar.xlsx>
import { chromium } from 'playwright';
import fs from 'node:fs';
const B = process.env.BASE ?? 'http://localhost:4000';
const [out = '.', itemsXlsx, vyaparXlsx] = process.argv.slice(2);
fs.mkdirSync(out, { recursive: true });
const log = [];
const ok = (c, m, why = '') => { const l = `${c ? 'PASS' : 'FAIL'} ${m}${!c && why ? ` (${why})` : ''}`; console.log(l); log.push(l); if (!c) process.exitCode = 1; };
const H = { 'x-requested-with': 'ledgerly' };
const b = await chromium.launch({ proxy: process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY } : undefined });
const errs = [];
const page = async (vp = { width: 1366, height: 860 }) => {
  const p = await (await b.newContext({ viewport: vp, ignoreHTTPSErrors: true })).newPage();
  p.on('pageerror', (e) => errs.push(e.message));
  p.on('response', (r) => { if (r.url().includes('/api/') && r.status() >= 500) errs.push(`${r.status()} ${r.url()}`); });
  return p;
};
const apiOf = (p) => async (m, u, d) => { const r = await p.request.fetch(B + '/api' + u, { method: m, data: d, headers: H }); return { status: r.status(), body: await r.json().catch(() => null) }; };
const signIn = async (p, email, pass) => { await p.goto(B + '/login'); await p.fill('input[type=email]', email); await p.fill('input[type=password]', pass); await p.keyboard.press('Enter'); await p.waitForURL(/\/(app|super-admin)/, { timeout: 60000 }); };
const dialog = (p, title) => p.locator('[role=dialog]').filter({ has: p.locator('h3', { hasText: title }) });
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());

try {
  const o = await page(); const api = apiOf(o);
  await signIn(o, 'owner@shop.com', 'owner123');
  const counts = async () => { const [c, v, i, bl, inv] = await Promise.all(['/shop/customers', '/shop/vendors', '/shop/items', '/shop/bills', '/shop/invoices'].map((u) => api('GET', u))); return [c, v, i, bl, inv].map((x) => x.body.length).join('/'); };
  const before = await counts();

  // 1-2 mobile numbers: refused by the live API and the live form
  for (const bad of ['98765', '98765432101', '1234567890', '98765abcde']) {
    const r = await api('POST', '/shop/customers', { type: 'Individual', name: `zz live check ${bad}`, phone: bad });
    ok(r.status === 400 && /10-digit mobile/.test(JSON.stringify(r.body)), `live API refuses mobile “${bad}”`, `${r.status}`);
  }
  await o.goto(B + '/app/sales/customers?new=1');
  let d = dialog(o, 'New customer'); await d.waitFor({ timeout: 30000 });
  ok(/Optional/.test(await d.innerText()), 'customer form marks the mobile number Optional');
  await d.getByLabel('Mobile number').fill('098401-23456'); await d.getByLabel('Mobile number').blur();
  ok(await d.getByLabel('Mobile number').inputValue() === '+91 98401 23456', 'mobile typed as 098401-23456 is tidied to +91 98401 23456');
  await d.getByLabel('Mobile number').fill('12345');
  await d.getByLabel('Name', { exact: false }).first().fill('zz live check form');
  await d.getByRole('button', { name: 'Save customer' }).click(); await o.waitForTimeout(500);
  ok(await d.getByText(/10-digit mobile number/).count() > 0, 'form refuses 12345 with the message');
  await d.getByRole('button', { name: 'Cancel' }).click();

  // 3 invoice: "+" is a pop-up on the invoice, not a jump to Customers
  await o.goto(B + '/app/sales/invoices/new'); await o.waitForLoadState('networkidle');
  const url = o.url();
  await o.getByRole('button', { name: 'New customer' }).click();
  d = dialog(o, 'New customer'); await d.waitFor();
  ok(o.url() === url && await d.locator('#qc-name').count() === 1, 'invoice “+” opens the new-customer pop-up on the invoice page');
  await d.getByRole('button', { name: 'Save customer' }).click(); await o.waitForTimeout(300);
  ok(await d.getByText('Name is required').count() === 1, 'pop-up checks the name');
  await d.getByRole('button', { name: 'Cancel' }).click();
  ok(o.url() === url, 'still on the new invoice after closing the pop-up');

  // 4 bill: vendor "+", Escape closes only the pop-up, IMEI rules
  await o.goto(B + '/app/purchases/bills?new=1');
  const billD = dialog(o, 'New bill'); await billD.waitFor({ timeout: 30000 });
  await billD.getByRole('button', { name: 'New vendor' }).click();
  const vd = dialog(o, 'New vendor'); await vd.waitFor();
  await vd.getByRole('button', { name: 'Save vendor' }).click(); await o.waitForTimeout(200);
  ok(await vd.getByText('Vendor name is required').count() === 1, 'bill: “+” vendor pop-up opens and checks the name');
  await o.keyboard.press('Escape'); await o.waitForTimeout(300);
  ok(await vd.count() === 0 && await billD.count() === 1, 'Escape closes the vendor pop-up only; the bill stays open');
  await o.keyboard.press('Escape');
  await o.goto(B + '/app/purchases/orders?new=1'); await o.waitForLoadState('networkidle');
  if (await o.getByRole('button', { name: 'New vendor' }).count() === 0) await o.getByRole('button', { name: /New purchase order|New order|New/ }).first().click();
  ok(await o.getByRole('button', { name: 'New vendor' }).count() >= 1, 'purchase order form has the “+” vendor button');
  await o.keyboard.press('Escape');

  const items = (await api('GET', '/shop/items')).body;
  const vendorId = (await api('GET', '/shop/vendors')).body[0].id;
  const serialItem = items.find((i) => i.trackSerials && !i.isGroup);
  const plain = items.find((i) => i.type === 'Goods' && !i.trackSerials && !i.isGroup);
  if (serialItem) {
    const r = await api('POST', '/shop/bills', { vendorId, date: today, dueDate: today, lines: [{ itemId: serialItem.id, qty: 2, rate: 1, serials: ['ZZ-LIVE-1'] }] });
    ok(r.status === 400 && /needs 2 serial \/ IMEI numbers/.test(r.body?.error ?? ''), `bill for 2 × ${serialItem.name} with 1 IMEI is refused`, JSON.stringify(r.body));
    const dup = await api('POST', '/shop/bills', { vendorId, date: today, dueDate: today, lines: [{ itemId: serialItem.id, qty: 2, rate: 1, serials: ['ZZ-LIVE-1', 'ZZ-LIVE-1'] }] });
    ok(dup.status === 400 && /twice/.test(dup.body?.error ?? ''), 'same IMEI twice on a bill is refused');
    const taken = (await api('GET', `/shop/items/${serialItem.id}/serials`)).body[0];
    if (taken) {
      const t = await api('POST', '/shop/bills', { vendorId, date: today, dueDate: today, lines: [{ itemId: serialItem.id, qty: 1, rate: 1, serials: [taken.serial] }] });
      ok(t.status === 400 && /Already in your stock records/.test(t.body?.error ?? ''), `an IMEI already in stock (${taken.serial}) is refused`);
    }
    // Bill form shows the IMEI box for that item
    await o.goto(B + '/app/purchases/bills?new=1'); await billD.waitFor();
    await billD.getByLabel('Item').first().selectOption(serialItem.id);
    ok(await billD.getByLabel(`IMEI / serial numbers for ${serialItem.name}`).count() === 1, 'bill form shows the IMEI box under a serial-tracked item');
    await billD.getByRole('button', { name: 'Save bill' }).click(); await o.waitForTimeout(400);
    ok(await billD.getByText(/0 of 1 entered/).count() > 0, 'bill form stops saving without the IMEI');
    await billD.getByRole('button', { name: 'Cancel' }).click();
  } else ok(false, 'demo shop has a serial-tracked item to check with');
  if (plain) {
    const r = await api('POST', '/shop/bills', { vendorId, date: today, dueDate: today, lines: [{ itemId: plain.id, qty: 1, rate: 1, serials: ['ZZ'] }] });
    ok(r.status === 400 && /doesn’t keep serial/.test(r.body?.error ?? ''), 'IMEIs for an item that doesn’t track them are refused');
  }
  ok((await api('GET', '/shop/serials/lookup?q=zzz-none')).status === 200, 'serial lookup works (with purchase source fields)');

  // 5 Excel: the live import screen reads .xlsx and finds the IMEI column (preview only, nothing imported)
  await o.goto(B + '/app/accounting/tally'); await o.waitForLoadState('networkidle');
  await o.locator('input[type=file][accept*=xlsx]').setInputFiles(vyaparXlsx);
  await o.getByLabel('Column for IMEI / serial no.').waitFor({ timeout: 30000 });
  ok(await o.getByLabel('Column for IMEI / serial no.').inputValue() === 'IMEI No.', 'live: .xlsx read in the browser and “IMEI No.” matched to IMEI');
  const preview = await o.locator('.table-wrap table').last().innerText();
  ok(/86\d{13}/.test(preview), 'preview shows the full 15-digit IMEI from Excel', preview.slice(0, 200));
  await o.screenshot({ path: `${out}/live-mapping.png`, fullPage: true });
  await o.goto(B + '/app/items'); await o.waitForLoadState('networkidle');
  await o.getByRole('button', { name: /^Import$/ }).click();
  const imp = o.locator('[role=dialog]');
  ok(/Excel/.test(await imp.innerText()) && await o.locator('input[type=file][accept*=xlsx]').count() === 1, 'Items import accepts Excel (.xlsx) files');
  await o.locator('input[type=file][accept*=xlsx]').setInputFiles(itemsXlsx);
  ok(/items-.*\.xlsx/.test(await imp.innerText()), 'Excel file picked, ready to import (not imported on live)');
  await imp.getByRole('button', { name: 'Cancel' }).click();

  // 6 dashboard: shop + microfinance together
  await o.goto(B + '/app'); await o.waitForLoadState('networkidle');
  const sec = o.getByRole('region', { name: 'Microfinance summary' });
  await sec.waitFor({ timeout: 30000 }).catch(() => {});
  ok(await sec.count() === 1 && await o.getByText('Sales this month').count() > 0, 'live dashboard: shop sales and microfinance summary together');
  ok(await sec.count() === 1 && !(await sec.innerText()).includes('—'), 'microfinance figures loaded', (await sec.innerText().catch(() => '')).slice(0, 160));
  await o.screenshot({ path: `${out}/live-dashboard.png`, fullPage: true });
  const s = await page(); await signIn(s, 'sales@shop.com', 'sales123'); await s.goto(B + '/app'); await s.waitForLoadState('networkidle');
  ok(await s.getByRole('region', { name: 'Microfinance summary' }).count() === 0, 'salesperson does not see loan figures');

  ok(await counts() === before, 'nothing was saved in the demo shop by this check', `${before} → ${await counts()}`);
} catch (e) {
  ok(false, 'script crashed', e.stack);
} finally {
  ok(errs.length === 0, 'no page errors or server 500s', errs.slice(0, 5).join(' | '));
  fs.writeFileSync(`${out}/log.txt`, log.join('\n'));
  await b.close();
}
