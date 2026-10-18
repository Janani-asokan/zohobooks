// Dev check: Print menu → hidden iframe → print() is called on the standalone print route.
import { chromium } from 'playwright';
const [id] = process.argv.slice(2);
const B = 'http://localhost:5173';
const b = await chromium.launch(); const p = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
await p.addInitScript(() => { window.print = () => { window.top.__printed = (window.top.__printed ?? []).concat(location.pathname + location.search); }; });
const errs = []; p.on('pageerror', (e) => errs.push(e.message));
await p.goto(B + '/login'); await p.fill('input[type=email]', 'owner@shop.com'); await p.fill('input[type=password]', 'owner123'); await p.keyboard.press('Enter'); await p.waitForURL(/app/);
await p.goto(`${B}/app/sales/invoices/${id}`); await p.waitForSelector('.ti');
for (const label of ['Print A4', 'Print A5', 'Print receipt']) {
  await p.getByRole('button', { name: 'Print', exact: true }).click();
  await p.getByRole('button', { name: new RegExp(label) }).click();
  await p.waitForFunction((n) => (window.__printed ?? []).length >= n, ['Print A4', 'Print A5', 'Print receipt'].indexOf(label) + 1, { timeout: 15000 });
}
console.log(await p.evaluate(() => window.__printed), errs.join('\n') || 'no errors');
await b.close();
