// Dev helper: screenshot the item picker open on a search.
import { chromium } from 'playwright';
const B = 'http://localhost:5173';
const b = await chromium.launch(); const p = await (await b.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: process.env.DARK ? 'dark' : 'light' })).newPage();
await p.goto(B + '/login'); if (process.env.DARK) await p.evaluate(() => localStorage.setItem('ledgerly.theme', 'dark'));
await p.fill('input[type=email]', 'owner@shop.com'); await p.fill('input[type=password]', 'owner123'); await p.keyboard.press('Enter'); await p.waitForURL(/app/);
await p.goto(B + '/app/sales/invoices/new'); await p.getByRole('combobox', { name: 'Item' }).first().click(); await p.keyboard.type(process.argv[3] ?? 'ca');
await p.waitForTimeout(300); await p.screenshot({ path: process.argv[2] }); await b.close();
