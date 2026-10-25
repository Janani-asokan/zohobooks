/**
 * Browser smoke test. Start the app first (`npm run db:seed && npm run dev`), then: `npm run test:e2e`.
 * Walks the main journeys for each role and fails on any page error.
 */
import { chromium } from 'playwright';

const BASE = process.env.BASE_URL ?? 'http://localhost:5173';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
let failed = 0;

const step = async (name, fn) => {
  try {
    await fn();
    console.log('✓', name);
  } catch (e) {
    failed++;
    console.log('✗', name, '—', e.message.split('\n')[0]);
  }
};
const login = async (email, password) => {
  await page.goto(BASE + '/login');
  await page.fill('input[type=email]', email);
  await page.fill('input[autocomplete=current-password]', password);
  await page.click('button[type=submit]');
  await page.waitForURL(/\/(app|super-admin)/);
};
const logout = async () => {
  await page.click('.profile-btn');
  await page.click('text=Sign out');
  await page.waitForURL('**/login');
};

await step('signed-out users are sent to login', async () => {
  await page.goto(BASE + '/app');
  await page.waitForURL('**/login');
});
await step('wrong password shows an error', async () => {
  await page.fill('input[type=email]', 'owner@shop.com');
  await page.fill('input[autocomplete=current-password]', 'wrong-pass-1');
  await page.click('button[type=submit]');
  await page.waitForSelector('.login-alert');
});
await step('owner signs in and sees the dashboard', async () => {
  await login('owner@shop.com', 'owner123');
  await page.waitForSelector('.stat-card');
});
await step('owner issues an invoice and records a payment', async () => {
  await page.goto(BASE + '/app/sales/invoices/new');
  const select = page.locator('select[aria-label=Customer]');
  await select.locator('option').nth(1).waitFor({ state: 'attached' });
  const value = await select.locator('optgroup option').first().getAttribute('value');
  await select.selectOption(value);
  await page.fill('input[placeholder="Scan barcode / SKU to add"]', 'LOG-M331');
  await page.keyboard.press('Enter');
  await page.click('text=Issue & record payment');
  await page.waitForURL(/invoices\/[0-9a-f-]{36}/);
  await page.waitForSelector('.modal');
  await page.locator('.modal input[type=number]').first().fill('100');
  await page.click('.modal >> text=Save payment');
  await page.waitForSelector('text=Payment recorded');
});
await step('invoice print view and PDF use the same document', async () => {
  const id = page.url().match(/invoices\/([0-9a-f-]{36})/)[1];
  await page.goto(`${BASE}/invoices/${id}/print?paper=a4`);
  await page.waitForFunction('window.__PRINT_READY === true');
  if (!(await page.locator('.ti-items tbody tr').count())) throw new Error('print view has no item rows');
  const pdf = await page.request.get(`${BASE}/api/shop/invoices/${id}/pdf?paper=a4`);
  if (pdf.status() !== 200 || pdf.headers()['content-type'] !== 'application/pdf') throw new Error(`PDF failed: ${pdf.status()}`);
  if (!(await pdf.body()).subarray(0, 5).toString().startsWith('%PDF')) throw new Error('not a PDF');
});
await step('a product PDF fills the new-item form', async () => {
  const { execFileSync } = await import('node:child_process');
  const os = await import('node:os');
  const file = `${os.tmpdir()}/smoke-product.pdf`;
  execFileSync('node', ['e2e/tools/make-pdf.mjs', file, 'Product Name: Smoke Test Router', 'HSN Code: 8517', 'Selling Price: 30k', 'GST 18%']);
  await page.goto(BASE + '/app/items/new');
  await page.locator('.smart-upload input[type=file]').first().setInputFiles(file);
  await page.waitForSelector('text=Check what we read');
  await page.click('button:has-text("Fill the form")');
  if ((await page.inputValue('#item-name')) !== 'Smoke Test Router') throw new Error('name not filled');
  if (!(await page.locator('input[value="30000"]').count())) throw new Error('selling price not filled');
});
await step('POS sale completes', async () => {
  await page.goto(BASE + '/app/pos');
  await page.waitForSelector('text=SanDisk 64GB Pen Drive'); // catalogue loaded, so the scan can match
  await page.fill('input[aria-label="Scan or search items"]', '0619659161323');
  await page.keyboard.press('Enter');
  await page.click('button:has-text("Charge")');
  await page.waitForSelector('text=Sale complete');
  await page.click('.modal >> text=New sale');
});
await step('GST returns load', async () => {
  await page.goto(BASE + '/app/reports');
  await page.click('text=GST Returns');
  await page.waitForSelector('text=GSTR-3B');
});
await step('balance sheet balances and P&L exports', async () => {
  await page.goto(BASE + '/app/reports/balance-sheet');
  await page.waitForSelector('text=Assets equal liabilities plus equity.');
  await page.goto(BASE + '/app/reports/profit-loss');
  await page.waitForSelector('text=Gross profit');
  await page.click('button:has-text("Export")');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('[role=menuitem]:has-text("Excel")')]);
  if (!dl.suggestedFilename().endsWith('.xlsx')) throw new Error('Unexpected export ' + dl.suggestedFilename());
});
await step('sales staff cannot see reports or purchases', async () => {
  await logout();
  await login('sales@shop.com', 'sales123');
  await page.waitForSelector('.sidebar-nav');
  const nav = (await page.locator('.sidebar-nav .nav-text').allTextContents()).join('|');
  if (/Reports|Purchases|Banking/.test(nav)) throw new Error('Restricted menu visible: ' + nav);
});
await step('super admin console loads without shop data', async () => {
  await logout();
  await login('admin@ledgerly.in', 'admin123');
  await page.waitForSelector('.stat-card');
  if (await page.locator('text=INV-20').count()) throw new Error('Invoice data visible in console');
});

await browser.close();
if (errors.length) console.log('Page errors:', errors);
if (failed || errors.length) process.exit(1);
console.log('All smoke steps passed');
