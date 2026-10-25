// Dev helper: regenerate the landing-page product screenshots in public/screens. Run against freshly seeded demo data.
import { chromium } from 'playwright';
const B = process.env.BASE ?? 'http://localhost:5173';
const b = await chromium.launch(); const p = await (await b.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })).newPage();
await p.goto(B + '/login'); await p.fill('input[type=email]', 'owner@shop.com'); await p.fill('input[type=password]', 'owner123'); await p.keyboard.press('Enter'); await p.waitForURL(/\/app/);
await p.evaluate(() => localStorage.setItem(`ledgerly.gs.${'x'}`, '1'));
const inv = await p.evaluate(async () => (await (await fetch('/api/shop/invoices')).json()).find((i) => i.status === 'Issued')?.id);
for (const [name, route] of [['dashboard', '/app'], ['invoice', `/app/sales/invoices/${inv}`], ['items', '/app/items'], ['reports', '/app/reports/profit-loss']]) {
  await p.goto(B + route); await p.waitForTimeout(2200);
  await p.screenshot({ path: `public/screens/${name}.jpg`, type: 'jpeg', quality: 82 });
}
await b.close();
