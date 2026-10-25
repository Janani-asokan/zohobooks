// Dev check: use the main features through the screens like a shop owner would, and report each one.
// Usage: node e2e/tools/features.mjs [outDir]
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
const out = process.argv[2];
const B = process.env.BASE ?? 'http://localhost:5173';
const tag = Date.now().toString().slice(-5);
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
const p = await ctx.newPage();
const errs = [];
p.on('pageerror', (e) => errs.push('pageerror ' + e.message));
p.on('response', (r) => r.url().includes('/api/') && r.status() >= 500 && errs.push(`${r.status()} ${r.url()}`));
const results = [];
const step = async (name, fn) => {
  await p.keyboard.press('Escape').catch(() => {});
  try { await fn(); results.push(`✓ ${name}`); }
  catch (e) { results.push(`✗ ${name}: ${e.message.split('\n')[0]}`); if (out) await p.screenshot({ path: `${out}/fail-${results.length}.png` }).catch(() => {}); }
};
const toast = (text) => p.locator('.toast', { hasText: text }).first().waitFor({ timeout: 10000 });
const modal = () => p.locator('.modal').last();

await p.goto(B + '/login');
await p.fill('input[type=email]', 'owner@shop.com');
await p.fill('input[type=password]', 'owner123');
await p.keyboard.press('Enter');
await p.waitForURL(/\/app/);

await step('add a customer', async () => {
  await p.goto(B + '/app/sales/customers?new=1');
  await modal().waitFor();
  await modal().getByText('Business', { exact: true }).click();
  await modal().getByLabel('Company name').fill(`Lakshmi Stores ${tag}`);
  await modal().getByLabel('GST number (GSTIN)').fill('33AAFCL1234M1Z5');
  await modal().getByLabel('Contact person').fill('Lakshmi');
  await modal().getByLabel('Phone').fill('9840012345');
  await modal().getByRole('button', { name: 'Save customer' }).click();
  await toast('');
  await p.getByText(`Lakshmi Stores ${tag}`).first().waitFor();
});

await step('add a product with a photo', async () => {
  const img = `${os.tmpdir()}/feature-photo.png`;
  execFileSync('node', ['e2e/tools/label-image.mjs', img, 'TEST ITEM']);
  await p.goto(B + '/app/items/new');
  await p.locator('.img-drop input[type=file]').setInputFiles(img);
  await p.locator('.img-drop img').waitFor();
  await p.locator('#item-name').fill(`Wireless Keyboard ${tag}`);
  await p.locator('input[placeholder]').filter({ has: p.locator('xpath=.') }).first();
  const cost = p.locator('.field', { hasText: 'Cost price' }).locator('input').first();
  await cost.fill('700');
  await p.getByRole('button', { name: /Auto-fill/ }).click();
  await p.locator('.field', { hasText: 'HSN code' }).locator('input').first().fill('8471');
  await p.getByRole('button', { name: 'Save item', exact: true }).click();
  await p.waitForURL(/\/app\/items(\?|$)/, { timeout: 10000 });
});

await step('invoice the new product to the new customer and take payment', async () => {
  await p.goto(B + '/app/sales/invoices/new');
  const sel = p.locator('select[aria-label=Customer]');
  await sel.locator('option', { hasText: `Lakshmi Stores ${tag}` }).waitFor({ state: 'attached' });
  await sel.selectOption({ label: await sel.locator('option', { hasText: `Lakshmi Stores ${tag}` }).first().textContent() });
  await p.getByRole('combobox', { name: 'Item' }).first().click();
  await p.keyboard.type(`Wireless Keyboard ${tag}`);
  await p.locator('.combo-opt').first().click();
  await p.getByRole('button', { name: 'Issue & record payment' }).click();
  await p.waitForURL(/invoices\/[0-9a-f-]{36}/);
  await modal().waitFor();
  await modal().getByRole('button', { name: 'Save payment' }).click();
  await toast('Payment recorded');
});

await step('attach a file to the invoice', async () => {
  const pdf = `${os.tmpdir()}/feature-attach.pdf`;
  execFileSync('node', ['e2e/tools/make-pdf.mjs', pdf, 'Delivery challan', 'Signed by customer']);
  await p.locator('.attach-drop').first().scrollIntoViewIfNeeded();
  await p.locator('input[type=file][multiple]').first().setInputFiles(pdf);
  await p.locator('.attach-name', { hasText: 'feature-attach.pdf' }).waitFor({ timeout: 15000 });
});

await step('quote → sales order → invoice', async () => {
  await p.goto(B + '/app/sales/quotes?new=1');
  await modal().waitFor();
  const sel = modal().locator('select').first();
  await sel.locator('option').nth(1).waitFor({ state: 'attached' });
  await sel.selectOption({ index: 1 });
  await modal().getByRole('combobox', { name: 'Item' }).first().click();
  await p.keyboard.type('Mouse');
  await p.locator('.combo-opt').first().click();
  await modal().getByRole('button', { name: 'Save & mark Sent' }).click();
  await toast('');
  await p.waitForTimeout(600);
  // Accept the quote, turn it into a sales order, then invoice the order.
  const card = p.locator('.card, div', { hasText: `Lakshmi Stores ${tag}` }).filter({ has: p.getByRole('button', { name: 'Mark Accepted' }) }).last();
  await card.getByRole('button', { name: 'Mark Accepted' }).click();
  await toast('');
  const accepted = p.locator('div', { hasText: `Lakshmi Stores ${tag}` }).filter({ has: p.getByRole('button', { name: 'To order' }) }).last();
  await accepted.getByRole('button', { name: 'To order' }).click();
  await toast('');
  await p.goto(B + '/app/sales/orders');
  const order = p.locator('div', { hasText: `Lakshmi Stores ${tag}` }).filter({ has: p.getByRole('button', { name: /Mark|Convert to invoice/ }) }).last();
  while (await order.getByRole('button', { name: /^Mark / }).count()) { await order.getByRole('button', { name: /^Mark / }).first().click(); await p.waitForTimeout(700); }
  await order.getByRole('button', { name: 'Convert to invoice' }).click();
  await p.waitForURL(/invoices\/new\?fromSO=/);
  await p.getByRole('button', { name: 'Issue invoice' }).click();
  await p.waitForURL(/invoices\/[0-9a-f-]{36}$/);
  if (out) await p.screenshot({ path: `${out}/quote.png` });
});

await step('POS sale by barcode', async () => {
  await p.goto(B + '/app/pos');
  await p.waitForSelector('text=SanDisk 64GB Pen Drive');
  await p.fill('input[aria-label="Scan or search items"]', '0619659161323');
  await p.keyboard.press('Enter');
  await p.getByRole('button', { name: /Charge/ }).click();
  await p.waitForSelector('text=Sale complete');
  await modal().getByRole('button', { name: 'New sale' }).click();
});

await step('purchase bill filled from an uploaded PDF', async () => {
  const pdf = `${os.tmpdir()}/feature-bill.pdf`;
  execFileSync('node', ['e2e/tools/make-pdf.mjs', pdf, 'TAX INVOICE', 'Redington India Ltd.', 'GSTIN 33AABCR1234D1Z8', 'Invoice No: RD-7781', 'Date: 20/10/2026',
    'Logitech M331 Silent Mouse 10 850.00 8500.00', 'Taxable Value 8500.00', 'IGST 18% 1530.00', 'Grand Total 10030.00']);
  await p.goto(B + '/app/purchases/bills?new=1');
  await modal().waitFor();
  await modal().locator('.smart-upload input[type=file]').first().setInputFiles(pdf);
  await p.waitForSelector('text=Check what we read', { timeout: 30000 });
  await p.getByRole('button', { name: 'Fill the form' }).click();
  await p.waitForTimeout(500);
  await modal().getByRole('button', { name: /Save bill|Record bill|Save/ }).last().click();
  await toast('');
});

await step('record an expense', async () => {
  await p.goto(B + '/app/purchases/expenses?new=1');
  await modal().waitFor();
  await modal().getByRole('button', { name: 'Electricity' }).click();
  await modal().locator('.field', { hasText: 'Amount (before GST)' }).locator('input').fill('1500');
  await modal().getByRole('button', { name: 'Save expense' }).click();
  await toast('');
});

await step('stock count adjustment', async () => {
  await p.goto(B + '/app/inventory/adjustments?new=1&mode=count');
  await modal().waitFor();
  await modal().getByRole('combobox', { name: 'Item' }).first().click();
  await p.keyboard.type('USB-C');
  await p.locator('.combo-opt').first().click();
  await modal().getByLabel('Counted').fill('150');
  await modal().getByRole('button', { name: 'Save adjustment' }).click();
  await p.getByText(/ADJ-\d{4}/).first().waitFor();
});

await step('transfer stock to the other branch and receive it', async () => {
  await p.goto(B + '/app/inventory/transfers?new=1');
  await modal().waitFor();
  await modal().getByRole('combobox', { name: 'Item' }).first().click();
  await p.keyboard.type('USB-C');
  await p.locator('.combo-opt').first().click();
  await modal().getByLabel('Qty to send').fill('5');
  await modal().getByRole('button', { name: 'Dispatch' }).click();
  await toast('dispatched');
  await p.getByRole('button', { name: 'Receive', exact: true }).first().click();
  await toast('received');
});

await step('bank transaction', async () => {
  await p.goto(B + '/app/banking');
  await p.getByRole('button', { name: 'Record Transaction' }).click();
  await modal().getByLabel('Description').fill('Owner brought cash');
  await modal().locator('.field', { hasText: 'Amount' }).locator('input').fill('5000');
  await modal().getByRole('button', { name: /Save|Record/ }).last().click();
  await toast('');
});

await step('reports export to PDF, Excel and CSV', async () => {
  await p.goto(B + '/app/reports/profit-loss');
  await p.getByText('Gross profit').first().waitFor();
  for (const kind of ['PDF', 'Excel (.xlsx)', 'CSV']) {
    await p.getByRole('button', { name: /Export/ }).click();
    const [dl] = await Promise.all([p.waitForEvent('download', { timeout: 30000 }), p.getByRole('menuitem', { name: kind }).click()]);
    if (!(await dl.path())) throw new Error(`${kind} download empty`);
  }
});

await step('balance sheet still balances after all of the above', async () => {
  await p.goto(B + '/app/reports/balance-sheet');
  await p.getByText('Assets equal liabilities plus equity.').waitFor();
});

await step('command palette search', async () => {
  await p.goto(B + '/app');
  await p.locator('.stat-card').first().waitFor();
  await p.keyboard.press('Control+k');
  await p.locator('.palette').waitFor();
  await p.keyboard.type('balance');
  await p.keyboard.press('Enter');
  await p.waitForURL(/balance-sheet/);
});

await step('dark mode renders', async () => {
  await p.evaluate(() => { localStorage.setItem('ledgerly.theme', 'dark'); document.documentElement.dataset.theme = 'dark'; });
  await p.goto(B + '/app');
  if (out) await p.screenshot({ path: `${out}/dark-dash.png` });
  await p.evaluate(() => { localStorage.setItem('ledgerly.theme', 'light'); });
});

console.log(results.join('\n'));
console.log(errs.length ? 'ERRORS:\n' + errs.join('\n') : 'no page errors');
await b.close();
