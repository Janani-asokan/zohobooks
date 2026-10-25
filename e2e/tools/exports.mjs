// Dev check: every PDF / Excel / CSV export, every document PDF and every file upload in the app, page by page.
// Usage: BASE=http://localhost:4000 node e2e/tools/exports.mjs [outDir]
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
const out = process.argv[2];
const B = process.env.BASE ?? 'http://localhost:5173';
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
const p = await ctx.newPage();
const errs = [];
p.on('pageerror', (e) => errs.push('pageerror ' + e.message));
p.on('response', (r) => r.url().includes('/api/') && r.status() >= 500 && errs.push(`${r.status()} ${r.url()}`));
const results = [];
let failures = 0;
const step = async (name, fn) => {
  await p.keyboard.press('Escape').catch(() => {});
  try { await fn(); results.push(`✓ ${name}`); }
  catch (e) { failures++; results.push(`✗ ${name}: ${e.message.split('\n')[0]}`); if (out) await p.screenshot({ path: `${out}/fail-${failures}.png` }).catch(() => {}); }
};
const download = async (trigger) => {
  const [dl] = await Promise.all([p.waitForEvent('download', { timeout: 45000 }), trigger()]);
  const path = await dl.path();
  if (!path) throw new Error('empty download');
  return dl.suggestedFilename();
};
const exportVia = async (kind, scope = p) => {
  await scope.getByRole('button', { name: /^Export/ }).first().click();
  return download(() => p.getByRole('menuitem', { name: kind, exact: true }).click());
};
const pdf = `${os.tmpdir()}/exports-check.pdf`;
execFileSync('node', ['e2e/tools/make-pdf.mjs', pdf, 'Delivery challan DC-101', 'Received in good condition']);
const img = `${os.tmpdir()}/exports-check.png`;
execFileSync('node', ['e2e/tools/label-image.mjs', img, 'PHOTO']);

await p.goto(B + '/login');
await p.fill('input[type=email]', 'owner@shop.com');
await p.fill('input[type=password]', 'owner123');
await p.keyboard.press('Enter');
await p.waitForURL(/\/app/);

// A journal so the journals list has something to export.
await p.evaluate(async () => {
  const h = { 'Content-Type': 'application/json', 'X-Requested-With': 'ledgerly' };
  const j = await (await fetch('/api/shop/accounting/journals')).json();
  if (!j.length) await fetch('/api/shop/accounting/journals', { method: 'POST', headers: h, body: JSON.stringify({ date: new Date().toISOString().slice(0, 10), notes: 'Owner capital', lines: [{ account: 'drawings', debit: 500 }, { account: 'capital', credit: 500 }] }) });
});

// 1. Every list and report exports to PDF, Excel and CSV.
const PAGES = [
  ['/app/sales/invoices', 'Invoices'], ['/app/sales/customers', 'Customers'], ['/app/sales/quotes', 'Quotes'], ['/app/sales/orders', 'Sales orders'],
  ['/app/sales/payments', 'Payments received'], ['/app/sales/credit-notes', 'Credit notes'], ['/app/items', 'Items'],
  ['/app/purchases/vendors', 'Vendors'], ['/app/purchases/orders', 'Purchase orders'], ['/app/purchases/bills', 'Bills'], ['/app/purchases/payments', 'Payments made'],
  ['/app/purchases/expenses', 'Expenses'], ['/app/inventory/adjustments', 'Stock adjustments'], ['/app/inventory/transfers', 'Transfers'], ['/app/inventory/stock-summary', 'Stock summary'],
  ['/app/banking', 'Banking'], ['/app/accounting/accounts', 'Chart of accounts'], ['/app/accounting/journals', 'Journals'], ['/app/accounting/ledger?account=ar', 'General ledger'],
  ['/app/reports/profit-loss', 'Profit & Loss'], ['/app/reports/balance-sheet', 'Balance sheet'], ['/app/reports/cash-flow', 'Cash flow'], ['/app/reports/trial-balance', 'Trial balance'],
  ['/app/reports/sales-by-customer', 'Sales by customer'], ['/app/reports/sales-by-item', 'Sales by item'], ['/app/reports/receivables', 'Receivables ageing'], ['/app/reports/payables', 'Payables ageing'],
  ['/app/audit', 'Audit log'],
];
for (const [route, name] of PAGES) {
  await step(`${name}: PDF, Excel and CSV`, async () => {
    await p.goto(B + route);
    await p.getByRole('button', { name: /^Export/ }).first().waitFor();
    // An empty list keeps Export disabled on purpose; that's the correct state, not a failure.
    await p.waitForFunction(() => { const e = [...document.querySelectorAll('button')].find((x) => /^\s*Export/.test(x.textContent ?? '')); return (!!e && !e.disabled) || !!document.querySelector('.empty'); }, null, { timeout: 15000 });
    if (await p.evaluate(() => !!document.querySelector('.empty') && [...document.querySelectorAll('button')].find((x) => /^\s*Export/.test(x.textContent ?? ''))?.disabled)) return;
    for (const kind of ['PDF', 'Excel (.xlsx)', 'CSV']) {
      const f = await exportVia(kind);
      if (!f.endsWith(kind === 'PDF' ? '.pdf' : kind === 'CSV' ? '.csv' : '.xlsx')) throw new Error(`${kind} gave ${f}`);
    }
  });
}

// 2. Document PDFs.
await step('invoice PDF (server render of the print view)', async () => {
  const id = await p.evaluate(async () => (await (await fetch('/api/shop/invoices')).json()).find((i) => i.status === 'Issued').id);
  await p.goto(`${B}/app/sales/invoices/${id}`);
  await p.getByRole('button', { name: /^Print/ }).click();
  const f = await download(() => p.getByRole('button', { name: 'Download PDF' }).click());
  if (!f.endsWith('.pdf')) throw new Error(f);
});
await step('quote PDF', async () => { await p.goto(B + '/app/sales/quotes'); await download(() => p.getByRole('button', { name: 'Download PDF' }).first().click()); });
await step('sales order PDF', async () => { await p.goto(B + '/app/sales/orders'); await p.getByRole('button', { name: 'Download PDF' }).first().waitFor({ timeout: 8000 }).catch(() => { throw new Error('no sales orders in demo data'); }); await download(() => p.getByRole('button', { name: 'Download PDF' }).first().click()); });
await step('purchase order PDF', async () => { await p.goto(B + '/app/purchases/orders'); await p.locator('table tbody tr').first().click(); await download(() => p.locator('.drawer').getByRole('button', { name: 'PDF', exact: true }).click()); });
await step('bill PDF', async () => { await p.goto(B + '/app/purchases/bills'); await p.locator('table tbody tr').first().click(); await download(() => p.locator('.drawer').getByRole('button', { name: 'PDF', exact: true }).click()); });
await step('credit note PDF', async () => { await p.goto(B + '/app/sales/credit-notes'); await download(() => p.getByRole('button', { name: 'Download PDF' }).first().click()); });
await step('stock adjustment PDF', async () => {
  await p.goto(B + '/app/inventory/adjustments');
  const rows = await p.locator('table tbody tr').count();
  if (!rows) {
    await p.goto(B + '/app/inventory/adjustments?new=1');
    await p.locator('.modal').getByRole('combobox', { name: 'Item' }).first().click(); await p.keyboard.type('USB'); await p.locator('.combo-opt').first().click();
    await p.locator('.modal').getByLabel(/Change/).fill('-1');
    await p.locator('.modal').getByRole('button', { name: 'Save adjustment' }).click();
  } else await p.locator('table tbody tr').first().click();
  await download(() => p.locator('.modal').getByRole('button', { name: 'Download PDF', exact: true }).click());
});
await step('transfer PDF', async () => {
  await p.goto(B + '/app/inventory/transfers');
  if (!(await p.getByRole('button', { name: 'Download PDF' }).count())) {
    await p.goto(B + '/app/inventory/transfers?new=1');
    await p.locator('.modal').getByRole('combobox', { name: 'Item' }).first().click(); await p.keyboard.type('USB'); await p.locator('.combo-opt').first().click();
    await p.locator('.modal').getByLabel('Qty to send').fill('1');
    await p.locator('.modal').getByRole('button', { name: 'Dispatch' }).click();
    await p.getByRole('button', { name: 'Download PDF' }).first().waitFor();
  }
  await download(() => p.getByRole('button', { name: 'Download PDF' }).first().click());
});
await step('journal PDF', async () => {
  await p.goto(B + '/app/accounting/journals');
  if (!(await p.locator('table tbody tr').count())) {
    await p.goto(B + '/app/accounting/journals?new=1');
    const sel = p.locator('.modal select[aria-label="Account"]');
    await sel.nth(0).selectOption({ label: '3100 · Owner’s capital' });
    await p.locator('.modal input[aria-label="Credit"]').nth(0).fill('1000');
    await sel.nth(1).selectOption({ label: '1011 · HDFC Current A/c' });
    await p.locator('.modal input[aria-label="Debit"]').nth(1).fill('1000');
    await p.getByRole('button', { name: 'Post journal' }).click();
    await p.locator('table tbody tr').first().waitFor();
  }
  await p.locator('table tbody tr').first().click();
  await download(() => p.locator('.modal').getByRole('button', { name: 'Download PDF', exact: true }).click());
});
await step('customer statement PDF', async () => {
  await p.goto(B + '/app/sales/customers');
  await p.locator('table tbody tr').first().click();
  await p.getByText('Statement', { exact: true }).click();
  await exportVia('PDF', p.locator('.split-panel'));
});

// 3. When the PDF service is down, the print window takes over.
await step('PDF falls back to the print window if the server can’t make it', async () => {
  await p.route('**/api/shop/reports/pdf', (r) => r.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'busy', code: 'pdf_unavailable' }) }));
  await p.goto(B + '/app/reports/profit-loss');
  await p.getByRole('button', { name: /^Export/ }).click();
  await p.getByRole('menuitem', { name: 'PDF' }).click();
  await p.locator('#c360-print-frame').waitFor({ state: 'attached', timeout: 10000 });
  await p.locator('.toast', { hasText: 'Print window opened' }).waitFor();
  await p.unroute('**/api/shop/reports/pdf');
});

// 4. Uploads on every kind of record.
const attachVia = async (name, open) => {
  await step(`${name}: attach a PDF and a photo`, async () => {
    await open();
    const scope = p.locator('.modal').last();
    await scope.locator('input[type=file][multiple]').setInputFiles([pdf, img]);
    await scope.locator('.attach-name', { hasText: 'exports-check.png' }).waitFor({ timeout: 20000 });
    await scope.locator('.attach-name', { hasText: 'exports-check.pdf' }).waitFor({ timeout: 20000 });
  });
};
await attachVia('credit note', async () => { await p.goto(B + '/app/sales/credit-notes'); await p.getByRole('button', { name: /^Files for/ }).first().click(); });
await attachVia('stock transfer', async () => { await p.goto(B + '/app/inventory/transfers'); await p.getByRole('button', { name: /^Files for/ }).first().click(); });
await attachVia('payment received', async () => { await p.goto(B + '/app/sales/payments'); await p.getByRole('button', { name: /^Files for/ }).first().click(); });
await attachVia('payment made', async () => { await p.goto(B + '/app/purchases/payments'); await p.getByRole('button', { name: /^Files for/ }).first().click(); });
await attachVia('bank transaction', async () => { await p.goto(B + '/app/banking'); await p.getByRole('button', { name: /^Files for/ }).first().click(); });
await attachVia('stock adjustment', async () => { await p.goto(B + '/app/inventory/adjustments'); await p.locator('table tbody tr').first().click(); });
await attachVia('journal', async () => { await p.goto(B + '/app/accounting/journals'); await p.locator('table tbody tr').first().click(); });

await step('organisation logo upload', async () => {
  await p.goto(B + '/app/organization');
  await p.locator('input[type=file][accept="image/*"]').first().setInputFiles(img);
  await p.locator('.logo-drop img').waitFor();
});
await step('print settings logo and signature upload', async () => {
  await p.goto(B + '/app/print-settings');
  const inputs = p.locator('input[type=file]');
  await inputs.nth(0).setInputFiles(img);
  await inputs.nth(1).setInputFiles(img);
  await p.waitForTimeout(600);
});
await step('bank transaction filled from an uploaded receipt', async () => {
  const r = `${os.tmpdir()}/exports-receipt.pdf`;
  execFileSync('node', ['e2e/tools/make-pdf.mjs', r, 'Tata Power Receipt', 'Receipt No: TP-99812', 'Date: 21/10/2026', 'Total Amount 2,450.00']);
  await p.goto(B + '/app/banking');
  await p.getByRole('button', { name: 'Record Transaction' }).click();
  await p.locator('.modal .smart-upload input[type=file]').first().setInputFiles(r);
  await p.getByText('Check what we read').waitFor({ timeout: 30000 });
  await p.getByRole('button', { name: 'Fill the form' }).click();
  const amount = await p.locator('.modal .field', { hasText: 'Amount' }).locator('input').inputValue();
  if (amount !== '2450') throw new Error(`amount filled as “${amount}”`);
  await p.locator('.modal').getByText('Money out').click();
  await p.locator('.modal').getByRole('button', { name: 'Save' }).click();
  await p.locator('.toast', { hasText: 'Receipt attached' }).waitFor({ timeout: 15000 });
});

console.log(results.join('\n'));
console.log(`${results.length - failures}/${results.length} passed`);
console.log(errs.length ? 'ERRORS:\n' + errs.join('\n') : 'no page errors');
await b.close();
