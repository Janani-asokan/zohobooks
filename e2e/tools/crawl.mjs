// Dev helper: visit every app route, report page errors, console errors and failed API calls, and screenshot each.
// Usage: node e2e/tools/crawl.mjs <outDir> [email] [password]
import { chromium } from 'playwright';
const [out, email = 'owner@shop.com', pass = 'owner123'] = process.argv.slice(2);
const B = process.env.BASE ?? 'http://localhost:5173';
const W = Number(process.env.W ?? 1440);
const ROUTES = ['/app', '/app/pos', '/app/items', '/app/items/new', '/app/items/labels', '/app/sales/customers', '/app/sales/quotes', '/app/sales/orders', '/app/sales/challans', '/app/field', '/app/field/team', '/app/sales/invoices',
  '/app/sales/invoices/new', '/app/sales/payments', '/app/sales/credit-notes', '/app/sales/recurring', '/app/purchases/vendors', '/app/purchases/orders', '/app/purchases/bills',
  '/app/purchases/payments', '/app/purchases/expenses', '/app/inventory/warehouses', '/app/inventory/adjustments', '/app/inventory/transfers', '/app/inventory/reorder', '/app/accounting/tally', '/app/inventory/stock-summary',
  '/app/banking', '/app/accounting/accounts', '/app/accounting/journals', '/app/accounting/ledger?account=ar', '/app/reports', '/app/reports/gst', '/app/reports/profit-loss',
  '/app/reports/balance-sheet', '/app/reports/cash-flow', '/app/reports/trial-balance', '/app/reports/sales-by-customer', '/app/reports/sales-by-item', '/app/reports/bill-profit', '/app/reports/receivables',
  '/app/reports/payables', '/app/organization', '/app/team', '/app/print-settings', '/app/billing', '/app/audit',
  '/app/microfinance', '/app/microfinance/borrowers', '/app/microfinance/loans', '/app/microfinance/loans/new', '/app/microfinance/collections', '/app/microfinance/planner', '/app/microfinance/reports', '/app/microfinance/settings'];
const b = await chromium.launch();
const p = await (await b.newContext({ viewport: { width: W, height: 900 } })).newPage();
let issues = [];
let route = '';
p.on('pageerror', (e) => issues.push(`${route} pageerror ${e.message}`));
p.on('console', (m) => m.type() === 'error' && !/401|Failed to load resource/.test(m.text()) && issues.push(`${route} console ${m.text().slice(0, 200)}`));
p.on('response', (r) => r.url().includes('/api/') && r.status() >= 400 && r.status() !== 401 && issues.push(`${route} ${r.status()} ${r.request().method()} ${r.url().replace(B, '')}`));
await p.goto(B + '/login'); await p.fill('input[type=email]', email); await p.fill('input[type=password]', pass); await p.keyboard.press('Enter');
await p.waitForURL(/\/app/); await p.waitForTimeout(800);
// Invoice detail too
const inv = await p.evaluate(async () => (await (await fetch('/api/shop/invoices')).json()).find((i) => i.status === 'Issued')?.id);
if (inv) ROUTES.push(`/app/sales/invoices/${inv}`, `/invoices/${inv}/print`);
for (const r of ROUTES) {
  route = r;
  await p.goto(B + r); await p.waitForTimeout(1300);
  const name = r.replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '') || 'root';
  if (out) await p.screenshot({ path: `${out}/${name}.png` });
  const hs = await p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  if (hs) issues.push(`${r} horizontal scroll`);
}
console.log(issues.length ? issues.join('\n') : `ok · ${ROUTES.length} routes, no errors`);
await b.close();
