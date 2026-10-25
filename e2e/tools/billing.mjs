// Dev check for billing extras: MRP billing + bill discount on an invoice, POS split payment,
// delivery challan from packing to invoice, bill-wise profit. Usage: BASE=http://localhost:4000 node e2e/tools/billing.mjs [outDir]
import { chromium } from 'playwright';
const out = process.argv[2];
const B = process.env.BASE ?? 'http://localhost:5173';
const b = await chromium.launch();
const p = await (await b.newContext({ viewport: { width: 1440, height: 1000 } })).newPage();
const errs = [];
p.on('pageerror', (e) => errs.push('pageerror ' + e.message));
p.on('response', (r) => r.url().includes('/api/') && r.status() >= 500 && errs.push(`${r.status()} ${r.url()}`));
const results = [];
const step = async (name, fn) => {
  await p.keyboard.press('Escape').catch(() => {});
  try { await fn(); results.push(`✓ ${name}`); }
  catch (e) { results.push(`✗ ${name}: ${e.message.split('\n')[0]}`); if (out) await p.screenshot({ path: `${out}/billing-fail-${results.length}.png` }).catch(() => {}); }
};
const modal = () => p.locator('.modal').last();
const toast = (t) => p.locator('.toast', { hasText: t }).first().waitFor({ timeout: 15000 });

await p.goto(B + '/login');
await p.fill('input[type=email]', 'owner@shop.com');
await p.fill('input[type=password]', 'owner123');
await p.keyboard.press('Enter');
await p.waitForURL(/\/app/);

await step('invoice with MRP billing and a 10% bill discount', async () => {
  await p.goto(B + '/app/sales/invoices/new');
  const sel = p.locator('select[aria-label=Customer]');
  await sel.locator('option').nth(1).waitFor({ state: 'attached' });
  await sel.selectOption({ index: 1 });
  await p.getByRole('combobox', { name: 'Item' }).first().click();
  await p.locator('.combo-opt').first().click();
  await p.getByLabel('Prices include GST').check();
  await p.locator('th', { hasText: 'Rate incl. GST' }).waitFor();
  await p.locator('input[aria-label="Bill discount"]').fill('10');
  await p.getByText(/Bill discount 10%/).waitFor();
  const shown = await p.locator('.card', { hasText: 'Total (₹)' }).last().innerText();
  if (out) await p.screenshot({ path: `${out}/billing-invoice.png` });
  await p.getByRole('button', { name: 'Issue invoice' }).click();
  await p.waitForURL(/invoices\/[0-9a-f-]{36}$/);
  await p.getByText('Profit on this bill').waitFor();
  const total = shown.match(/Total \(₹\)\s*₹?([\d,.]+)/)?.[1];
  if (total && !(await p.locator('body').innerText()).includes(total)) throw new Error(`issued total differs from form total ${total}`);
  if (out) await p.screenshot({ path: `${out}/billing-invoice-view.png` });
});

await step('POS split payment: part cash, part UPI', async () => {
  await p.goto(B + '/app/pos');
  await p.locator('.pos-tile').first().click();
  await p.getByRole('button', { name: 'Split' }).click();
  await p.locator('input[aria-label="Cash amount"]').fill('100');
  await p.locator('.split-row', { hasText: 'UPI' }).getByRole('button', { name: 'Rest' }).click();
  await p.getByText('Fully paid').waitFor();
  if (out) await p.screenshot({ path: `${out}/billing-pos-split.png` });
  await p.getByRole('button', { name: /^Charge/ }).click();
  await p.waitForSelector('text=Sale complete');
  if (!/Paid/.test(await modal().innerText())) throw new Error('sale not paid');
  await modal().getByRole('button', { name: 'New sale' }).click();
});

await step('delivery challan: pack, dispatch, deliver, invoice', async () => {
  await p.goto(B + '/app/sales/challans?new=1');
  await modal().waitFor();
  await modal().locator('select[aria-label=Customer]').selectOption({ index: 1 });
  await modal().locator('table').getByRole('combobox').first().click();
  await p.locator('.combo-opt').first().click();
  await modal().locator('table input[type=number]').first().fill('2');
  await modal().getByPlaceholder('TN 09 AB 1234').fill('tn09ab1234');
  await modal().getByRole('button', { name: 'Save challan' }).click();
  await toast('packed');
  const row = p.locator('tbody tr').first();
  await row.getByRole('button', { name: 'Dispatch' }).click();
  await toast('dispatched');
  await row.getByRole('button', { name: 'Delivered' }).click();
  await modal().getByPlaceholder(/Name of the person/).fill('Ramesh');
  await modal().getByRole('button', { name: 'Mark delivered' }).click();
  await toast('delivered');
  if (out) await p.screenshot({ path: `${out}/billing-challans.png` });
  await row.getByRole('button', { name: 'Create invoice' }).click();
  await p.waitForURL(/invoices\/[0-9a-f-]{36}\/edit/);
  if (!/Against delivery challan DC-/.test(await p.locator('textarea').first().inputValue())) throw new Error('invoice not linked to challan');
});

await step('bill-wise profit report', async () => {
  await p.goto(B + '/app/reports/bill-profit');
  await p.getByText('Loss-making bills').waitFor();
  await p.locator('tbody tr').first().waitFor();
  if (out) await p.screenshot({ path: `${out}/billing-profit.png` });
});

console.log(results.join('\n'));
console.log(errs.length ? 'ERRORS:\n' + errs.join('\n') : 'no page errors');
await b.close();
