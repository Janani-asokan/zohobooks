// Dev helper: regenerate the landing-page product screenshots in public/screens. Run against freshly seeded demo data
// on a server with the AI key set (the AI screens wait for real answers). Usage: BASE=http://localhost:4000 node e2e/tools/screens.mjs
import { chromium } from 'playwright';
const B = process.env.BASE ?? 'http://localhost:5173';
const b = await chromium.launch();
const p = await (await b.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, timezoneId: 'Asia/Kolkata' })).newPage();
await p.goto(B + '/login'); await p.fill('input[type=email]', 'owner@shop.com'); await p.fill('input[type=password]', 'owner123'); await p.keyboard.press('Enter'); await p.waitForURL(/\/app/);
// Hide the setup checklist and help tips so the screens show the product, not onboarding.
await p.evaluate(async () => { const me = await (await fetch('/api/auth/me')).json(); localStorage.setItem(`ledgerly.gs.${me.shop.id}`, '1'); });
const api = (path, body) => p.evaluate(async ([u, b2]) => (await fetch('/api/shop' + u, { method: b2 ? 'POST' : 'GET', headers: { 'content-type': 'application/json', 'x-requested-with': 'ledgerly' }, body: b2 ? JSON.stringify(b2) : undefined })).json(), [path, body]);
// A couple of busy days so Smart Reorder has something to say.
const items = await api('/items'); const cust = (await api('/customers'))[0];
const head = (await api('/branches')).find((x) => x.isPrimary).id;
for (const [re, left] of [[/Dell/, 2], [/M331/, 10]]) {
  const it = items.find((i) => re.test(i.name)); const here = it?.stockByBranch?.[head] ?? 0;
  if (it && here > left) await api('/pos/sale', { customerId: cust.id, branchId: head, withGst: true, mode: 'Cash', lines: [{ itemId: it.id, qty: here - left, tier: 'SP1' }] });
}
const inv = (await api('/invoices')).find((i) => i.status === 'Issued')?.id;
const shot = (name) => p.screenshot({ path: `public/screens/${name}.jpg`, type: 'jpeg', quality: 84 });

await p.goto(B + '/app'); await p.locator('.brief-list li').first().waitFor({ timeout: 90000 }); await p.waitForTimeout(1800); await shot('dashboard');

await p.goto(B + '/app/pos');
await p.locator('textarea[aria-label="Bill in your words"]').fill('do pen drive 64gb aur teen usb c cable, UPI');
await p.keyboard.press('Enter'); await p.locator('.pos-line').nth(1).waitFor({ timeout: 90000 });
await p.locator('textarea[aria-label="Bill in your words"]').fill('2 pen drive aur 3 USB-C cable, UPI se payment');
await p.waitForTimeout(4500); await shot('pos');

await p.goto(B + '/app/inventory/reorder'); await p.getByRole('button', { name: 'Get advice' }).click(); await p.locator('.ai-headline').waitFor({ timeout: 90000 }); await p.waitForTimeout(800); await shot('reorder');

await p.goto(B + '/app'); await p.getByRole('button', { name: 'Ask AI', exact: true }).click();
await p.locator('.ai-input textarea').fill('Who owes me the most, and what should I do about it?'); await p.keyboard.press('Enter');
await p.locator('.ai-msg.assistant:not(.ai-typing)').first().waitFor({ timeout: 90000 }); await p.waitForTimeout(800); await shot('ask');
await p.keyboard.press('Escape');

await p.goto(`${B}/app/sales/invoices/${inv}`); await p.waitForTimeout(2200); await shot('invoice');
await p.goto(B + '/app/reports/profit-loss'); await p.waitForTimeout(2200); await shot('reports');
await b.close();
