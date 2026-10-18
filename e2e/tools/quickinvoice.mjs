// Dev check: create an invoice by keyboard only — customer, search item, Enter, quantity, issue.
import { chromium } from 'playwright';
const B = 'http://localhost:5173';
const b = await chromium.launch(); const p = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
const errs = []; p.on('pageerror', (e) => errs.push(e.message));
await p.goto(B + '/login'); await p.fill('input[type=email]', 'owner@shop.com'); await p.fill('input[type=password]', 'owner123'); await p.keyboard.press('Enter'); await p.waitForURL(/app/);
await p.waitForTimeout(800);
const t0 = Date.now();
await p.keyboard.press('n');
await p.waitForURL(/invoices\/new/);
const sel = p.locator('select[aria-label=Customer]');
await sel.locator('optgroup option').first().waitFor({ state: 'attached' });
await sel.selectOption(await sel.locator('optgroup option').first().getAttribute('value'));
await p.getByRole('combobox', { name: 'Item' }).first().click();
await p.keyboard.type('8471');            // HSN
await p.waitForSelector('.combo-opt');
const first = await p.locator('.combo-opt .combo-name').first().textContent();
await p.keyboard.press('Enter');
await p.waitForTimeout(100);
const focused = await p.evaluate(() => document.activeElement?.getAttribute('aria-label'));
await p.keyboard.type('3');
await p.keyboard.press('Control+Enter');
await p.waitForURL(/invoices\/[0-9a-f-]{36}$/);
console.log({ picked: first, focusAfterPick: focused, seconds: (Date.now() - t0) / 1000, url: p.url().split('/').pop() }, errs.join('\n') || 'no errors');
await p.screenshot({ path: process.argv[2] });
await b.close();
