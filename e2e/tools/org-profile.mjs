// Organization / Business profile: the phone must be a real number, and the bank account is entered as separate
// checked fields that print in the invoice's "Pay to" box.
// Usage: BASE=http://localhost:4000 node e2e/tools/org-profile.mjs <outDir>
import { chromium } from 'playwright';
import fs from 'node:fs';
const B = process.env.BASE ?? 'http://localhost:4000';
const out = process.argv[2] ?? '.';
fs.mkdirSync(out, { recursive: true });
const ok = (c, m, why = '') => { console.log(`${c ? 'PASS' : 'FAIL'} ${m}${!c && why ? ` (${why})` : ''}`); if (!c) process.exitCode = 1; };
const H = { 'x-requested-with': 'ledgerly' };
const b = await chromium.launch();
const errs = [];
const p = await (await b.newContext({ viewport: { width: 1366, height: 900 } })).newPage();
p.on('pageerror', (e) => errs.push(e.message));
p.on('response', (r) => { if (r.url().includes('/api/') && r.status() >= 500) errs.push(`${r.status()} ${r.url()}`); });
const api = async (m, u, d) => { const r = await p.request.fetch(B + '/api' + u, { method: m, data: d, headers: H }); return { status: r.status(), body: await r.json().catch(() => null) }; };
const save = () => p.getByRole('button', { name: /Save Changes/ }).click();
const fieldErr = (label) => p.locator('.field', { has: p.getByLabel(label, { exact: true }) }).locator('.field-error').innerText().catch(() => '');

try {
  await p.goto(B + '/login'); await p.fill('input[type=email]', 'owner@shop.com'); await p.fill('input[type=password]', 'owner123'); await p.keyboard.press('Enter'); await p.waitForURL(/\/app/);
  const before = (await api('GET', '/shop/organization')).body;
  await p.goto(B + '/app/organization'); await p.waitForLoadState('networkidle');

  /* Phone */
  for (const ph of ['98400123456', '984001234567890', 'abcd123', '98400']) {
    await p.getByLabel('Phone', { exact: true }).fill(ph);
    await save(); await p.waitForTimeout(300);
    ok(/10-digit mobile or a landline/.test(await p.locator('main').innerText()), `phone “${ph}” is refused with a message`);
  }
  ok((await api('GET', '/shop/organization')).body.phone === before.phone, 'nothing saved while the phone is invalid');
  await p.getByLabel('Phone', { exact: true }).fill('9840012345'); await p.getByLabel('Phone', { exact: true }).blur();
  ok(await p.getByLabel('Phone', { exact: true }).inputValue() === '+91 98400 12345', 'a valid mobile is tidied to +91 98400 12345');

  /* Bank: old text shown split into the fields */
  ok(await p.getByLabel('Account number', { exact: true }).inputValue() === '50200012345678' && await p.getByLabel('IFSC code', { exact: true }).inputValue() === 'HDFC0001234', 'the old bank text appears split into Account number and IFSC');
  ok(await p.locator('textarea[placeholder*="IFSC"]').count() === 0, 'the single bank-details text box is gone');

  /* Bank: wrong values refused */
  await p.getByLabel('Account number', { exact: true }).fill('1234');
  await p.getByLabel('IFSC code', { exact: true }).fill('HDFC1001234');
  await save(); await p.waitForTimeout(300);
  let t = await p.locator('main').innerText();
  ok(/9 to 18 digits/.test(t) && /11-character IFSC/.test(t), 'short account number and wrong IFSC are refused with messages');
  await p.screenshot({ path: `${out}/bank-errors.png`, fullPage: true });

  /* Bank: a new account, typed twice, IFSC fills the bank name */
  await p.getByLabel('Account holder name', { exact: true }).fill('Aravind Computer Store');
  await p.getByLabel('Account number', { exact: true }).fill('3910 1234 5678');
  await p.getByLabel('Bank name', { exact: true }).fill('');
  await p.getByLabel('IFSC code', { exact: true }).fill('sbin0001234');
  ok(await p.getByLabel('IFSC code', { exact: true }).inputValue() === 'SBIN0001234' && await p.getByLabel('Bank name', { exact: true }).inputValue() === 'State Bank of India', 'IFSC is upper-cased and fills the bank name (State Bank of India)');
  await p.getByLabel('Branch', { exact: true }).fill('Anna Salai');
  await p.getByLabel('Re-enter account number', { exact: true }).fill('391012345679');
  await save(); await p.waitForTimeout(300);
  ok(/don’t match/.test(await p.locator('main').innerText()), 'a mistyped second account number is caught');
  await p.getByLabel('Re-enter account number', { exact: true }).fill('391012345678');
  const preview = await p.locator('.pay-to-preview').innerText();
  ok(/A\/c name: Aravind Computer Store/.test(preview) && /State Bank of India · A\/c 391012345678/.test(preview) && /IFSC SBIN0001234 · Anna Salai/.test(preview), 'live “Pay to” preview shows what will print', preview);
  await p.screenshot({ path: `${out}/bank-fields.png`, fullPage: true });
  await save(); await p.waitForTimeout(800);
  const after = (await api('GET', '/shop/organization')).body;
  ok(after.phone === '+91 98400 12345' && after.bankAccountNo === '391012345678' && after.bankIfsc === 'SBIN0001234' && after.bankName === 'State Bank of India', 'saved: phone, account number, IFSC and bank name', JSON.stringify({ ph: after.phone, no: after.bankAccountNo, ifsc: after.bankIfsc }));

  /* A new invoice prints the new bank details */
  const cust = (await api('GET', '/shop/customers')).body[0];
  const item = (await api('GET', '/shop/items')).body.find((i) => i.type === 'Goods' && !i.trackSerials && !i.trackBatches && i.stock > 2 && !i.isGroup);
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
  const inv = (await api('POST', '/shop/invoices', { customerId: cust.id, date: today, dueDate: today, withGst: true, issue: true, lines: [{ itemId: item.id, qty: 1, tier: 'SP1' }] })).body;
  await p.goto(B + `/invoices/${inv.id}/print`); await p.waitForLoadState('networkidle');
  const printed = await p.locator('body').innerText();
  ok(/391012345678/.test(printed) && /SBIN0001234/.test(printed), 'a new invoice prints the account number and IFSC in “Pay to”');
  await p.screenshot({ path: `${out}/invoice-payto.png`, fullPage: true });

  /* Saving the logo elsewhere is not blocked by the profile rules */
  const logo = await api('PUT', '/shop/organization', { ...after, invoiceTemplate: after.invoiceTemplate });
  ok(logo.status === 200, 'saving other settings (logo, template) still works');
  /* Warehouse phone */
  await p.goto(B + '/app/warehouses').catch(() => {});
} catch (e) {
  await p.screenshot({ path: `${out}/crash.png` }).catch(() => {});
  ok(false, 'script crashed', e.stack);
} finally {
  ok(errs.length === 0, 'no page errors or server 500s', errs.slice(0, 5).join(' | '));
  await b.close();
}
