// Two client reports: (1) the New Vendor form saved random text as phone and email; (2) with a whole-bill discount the
// invoice totals showed the discounted amount as "Sub total". Checked through the screens.
// Usage: BASE=http://localhost:4000 node e2e/tools/vendor-totals.mjs <outDir>
import { chromium } from 'playwright';
import fs from 'node:fs';
const B = process.env.BASE ?? 'http://localhost:4000';
const out = process.argv[2] ?? '.';
fs.mkdirSync(out, { recursive: true });
const tag = Date.now().toString().slice(-5);
const ok = (c, m, why = '') => { console.log(`${c ? 'PASS' : 'FAIL'} ${m}${!c && why ? ` (${why})` : ''}`); if (!c) process.exitCode = 1; };
const H = { 'x-requested-with': 'ledgerly' };
const b = await chromium.launch();
const errs = [];
const p = await (await b.newContext({ viewport: { width: 1366, height: 900 } })).newPage();
p.on('pageerror', (e) => errs.push(e.message));
p.on('response', (r) => { if (r.url().includes('/api/') && r.status() >= 500) errs.push(`${r.status()} ${r.url()}`); });
const api = async (m, u, d) => { const r = await p.request.fetch(B + '/api' + u, { method: m, data: d, headers: H }); return { status: r.status(), body: await r.json().catch(() => null) }; };
const dialog = (t) => p.locator('[role=dialog]').filter({ has: p.locator('h3', { hasText: t }) });
const num = (s) => Number(String(s).replace(/[^\d.-]/g, ''));

try {
  await p.goto(B + '/login'); await p.fill('input[type=email]', 'owner@shop.com'); await p.fill('input[type=password]', 'owner123'); await p.keyboard.press('Enter'); await p.waitForURL(/\/app/);

  /* 1. New Vendor form */
  const vendorsBefore = (await api('GET', '/shop/vendors')).body.length;
  await p.goto(B + '/app/purchases/vendors?new=1');
  let d = dialog('New vendor'); await d.waitFor();
  await d.getByLabel('Vendor name', { exact: false }).first().fill(`Junk Contact ${tag}`);
  await d.getByLabel('Phone').fill('abc123xyz');
  await d.getByLabel('Email').fill('randomtext123');
  await d.getByRole('button', { name: 'Save vendor' }).click(); await p.waitForTimeout(500);
  const txt = await d.innerText();
  ok(/10-digit mobile or a landline/.test(txt) && /valid email address/.test(txt), 'random phone and email are refused on the form, with messages', txt.slice(0, 300));
  ok((await api('GET', '/shop/vendors')).body.length === vendorsBefore, 'nothing saved');
  await p.screenshot({ path: `${out}/vendor-errors.png` });
  for (const [ph, em] of [['12345', 'abc@'], ['98765abcde', 'a@b'], ['+1 415 555 0100', 'x@y.c']]) {
    await d.getByLabel('Phone').fill(ph); await d.getByLabel('Email').fill(em);
    await d.getByRole('button', { name: 'Save vendor' }).click(); await p.waitForTimeout(300);
    ok(/10-digit mobile or a landline/.test(await d.innerText()) && /valid email address/.test(await d.innerText()), `“${ph}” / “${em}” refused`);
  }
  ok((await api('GET', '/shop/vendors')).body.length === vendorsBefore, 'still nothing saved');
  await d.getByLabel('Phone').fill('0422-2345678'); await d.getByLabel('Phone').blur();
  await d.getByLabel('Email').fill('Accounts@Supplier.IN'); await d.getByLabel('Email').blur();
  ok(await d.getByLabel('Phone').inputValue() === '04222345678' && await d.getByLabel('Email').inputValue() === 'accounts@supplier.in', 'valid landline and email are tidied when leaving the box');
  await d.getByRole('button', { name: 'Save vendor' }).click(); await d.waitFor({ state: 'detached', timeout: 5000 });
  ok((await api('GET', '/shop/vendors')).body.some((v) => v.name === `Junk Contact ${tag}` && v.phone === '04222345678' && v.email === 'accounts@supplier.in'), 'vendor saved with the valid landline and email');
  // The same rules on the "+" vendor pop-up of a bill
  await p.goto(B + '/app/purchases/bills?new=1');
  const bill = dialog('New bill'); await bill.waitFor();
  await bill.getByRole('button', { name: 'New vendor' }).click();
  d = dialog('New vendor'); await d.waitFor();
  await d.locator('#qv-name').fill(`Quick Junk ${tag}`); await d.locator('#qv-phone').fill('phone123'); await d.locator('#qv-email').fill('mail');
  await d.getByRole('button', { name: 'Save vendor' }).click(); await p.waitForTimeout(400);
  ok(/10-digit mobile or a landline/.test(await d.innerText()) && /valid email address/.test(await d.innerText()), 'bill’s “+” vendor pop-up refuses them too');
  await d.locator('#qv-phone').fill(''); await d.locator('#qv-email').fill('');
  await d.getByRole('button', { name: 'Save vendor' }).click(); await d.waitFor({ state: 'detached', timeout: 5000 });
  ok(true, 'pop-up saves once phone and email are cleared (both optional)');
  await p.keyboard.press('Escape');

  /* 2. Invoice totals with a whole-bill discount */
  await p.goto(B + '/app/sales/invoices/new'); await p.waitForLoadState('networkidle');
  const cust = await p.getByLabel('Customer', { exact: true }).locator('option').nth(1).getAttribute('value');
  await p.getByLabel('Customer', { exact: true }).selectOption(cust);
  const items = (await api('GET', '/shop/items')).body.filter((i) => i.type === 'Goods' && !i.isGroup && !i.trackSerials && !i.trackBatches && i.stock > 3 && i.taxRate === 18);
  const it = items[0];
  await p.getByLabel('Item', { exact: true }).first().fill(it.name);
  await p.locator('[role=option]').filter({ hasText: it.name }).first().click();
  await p.getByLabel('Bill discount', { exact: true }).fill('7');
  await p.waitForTimeout(400);
  const panel = p.locator('.card', { hasText: 'Sub total' }).filter({ hasText: 'Total' }).last();
  const rows = await panel.locator('.row.between').evaluateAll((els) => els.map((e) => [e.children[0]?.textContent?.trim() ?? '', e.children[1]?.textContent?.trim() ?? '']));
  const val = (re) => { const r = rows.find(([l]) => re.test(l)); return r ? num(r[1]) : NaN; };
  const sub = val(/^Sub total/), disc = val(/^Bill discount 7%/), taxable = val(/^Taxable value/), cg = val(/^CGST/), sg = val(/^SGST/), ro = rows.find(([l]) => /^Round off/.test(l)) ? val(/^Round off/) : 0, tot = val(/^Total/);
  // The line's own rate (the customer's price tier), qty 1
  const gross = num(await p.getByLabel('Rate').first().inputValue());
  ok(Math.abs(sub - gross) < 0.01, `Sub total is the gross amount before the bill discount (₹${sub} = line amount ₹${gross})`, JSON.stringify(rows));
  ok(Math.abs(disc - Math.round(gross * 0.07 * 100) / 100) < 0.011, `Bill discount 7% shown as its own deduction (₹${disc})`);
  ok(Math.abs(sub - disc - taxable) < 0.011, `Sub total − discount = Taxable value (${sub} − ${disc} = ${taxable})`);
  ok(Math.abs(taxable + cg + sg + ro - tot) < 0.005, `Taxable + CGST + SGST + round off = Total to the paisa (${taxable} + ${cg} + ${sg} + ${ro} = ${tot})`);
  ok(!rows.some(([l]) => /incl\. above/.test(l)), 'no “(incl. above)” lines any more');
  await panel.screenshot({ path: `${out}/totals-7pct.png` });
  // Issue it: the saved invoice has the same total
  await p.getByRole('button', { name: /Issue invoice/ }).click();
  await p.waitForURL(/\/app\/sales\/invoices\/(?!new)[^/]+$/, { timeout: 10000 });
  const id = p.url().split('/').pop();
  const inv = (await api('GET', `/shop/invoices/${id}`)).body;
  ok(Math.abs(inv.total - tot) < 0.005 && Math.abs(inv.subTotal - taxable) < 0.005 && Math.abs(inv.cgst - cg) < 0.005 && Math.abs(inv.sgst - sg) < 0.005, `saved invoice matches the panel (total ₹${inv.total}, taxable ₹${inv.subTotal}, CGST ${inv.cgst}, SGST ${inv.sgst})`);

  /* Thermal receipt of a discounted POS sale reads the same way */
  await p.goto(B + '/app/pos'); await p.waitForLoadState('networkidle');
  await p.locator('.pos-tile', { hasText: it.name }).first().click();
  await p.getByLabel('Bill discount', { exact: true }).fill('7');
  await p.waitForTimeout(300);
  await p.getByRole('button', { name: /^Charge/ }).click();
  const done = dialog('Sale complete'); await done.waitFor({ timeout: 10000 });
  const rr = await done.locator('.rc-totals .rr').evaluateAll((els) => els.map((e) => [e.children[0]?.textContent?.trim() ?? '', e.children[1]?.textContent?.trim() ?? '']));
  const rv = (re) => { const r = rr.find(([l]) => re.test(l)); return r ? Math.abs(num(r[1])) : NaN; };
  const rSub = rv(/^Sub total/), rDisc = rv(/^Discount/), rTax = rv(/^Taxable value/), rTot = rv(/^TOTAL/), rC = rv(/^CGST/), rS = rv(/^SGST/), rR = rr.some(([l]) => /^Round off/.test(l)) ? num(rr.find(([l]) => /^Round off/.test(l))[1]) : 0;
  ok(rDisc > 0 && Math.abs(rSub - rDisc - rTax) < 0.011, `receipt: Sub total ${rSub} − Discount ${rDisc} = Taxable value ${rTax}`, JSON.stringify(rr));
  ok(Math.abs(rTax + rC + rS + rR - rTot) < 0.005, `receipt: Taxable + CGST + SGST + round off = TOTAL (${rTax} + ${rC} + ${rS} + ${rR} = ${rTot})`);
  await done.screenshot({ path: `${out}/receipt-7pct.png` });
} catch (e) {
  await p.screenshot({ path: `${out}/crash.png` }).catch(() => {});
  ok(false, 'script crashed', e.stack);
} finally {
  ok(errs.length === 0, 'no page errors or server 500s', errs.slice(0, 5).join(' | '));
  await b.close();
}
