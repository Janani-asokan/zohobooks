// A business that buys two add-ons sees both on its dashboard. Creates a shop with POS + microfinance (platform admin),
// switches microfinance on, sells at the counter, and checks the dashboard; then the demo shop with every add-on.
// Usage: BASE=http://localhost:4000 node e2e/tools/dashboard-addons.mjs <outDir>   (server with DEMO_SUPER_ADMIN=1)
import { chromium } from 'playwright';
import fs from 'node:fs';
const B = process.env.BASE ?? 'http://localhost:4000';
const out = process.argv[2] ?? '.';
fs.mkdirSync(out, { recursive: true });
const stamp = Date.now().toString().slice(-5);
const log = [];
const ok = (c, m, why = '') => { const l = `${c ? 'PASS' : 'FAIL'} ${m}${!c && why ? ` (${why})` : ''}`; console.log(l); log.push(l); if (!c) process.exitCode = 1; };
const H = { 'x-requested-with': 'ledgerly' };
const b = await chromium.launch();
const errs = [];
const page = async (vp = { width: 1366, height: 900 }) => {
  const p = await (await b.newContext({ viewport: vp })).newPage();
  p.on('pageerror', (e) => errs.push(e.message));
  p.on('response', (r) => { if (r.url().includes('/api/') && r.status() >= 500) errs.push(`${r.status()} ${r.url()}`); });
  return p;
};
const apiOf = (p) => async (m, u, d) => { const r = await p.request.fetch(B + '/api' + u, { method: m, data: d, headers: H }); return { status: r.status(), body: await r.json().catch(() => null) }; };
const signIn = async (p, email, pass) => { await p.goto(B + '/login'); await p.fill('input[type=email]', email); await p.fill('input[type=password]', pass); await p.keyboard.press('Enter'); await p.waitForURL(/\/(app|super-admin)/); };
const tiles = (p) => p.getByRole('region', { name: 'Your add-ons' });

try {
  const a = await page(); await signIn(a, 'admin@ledgerly.in', 'admin123');
  const email = `two.addons${stamp}@example.com`;
  const cr = await apiOf(a)('POST', '/platform/shops', { shopName: 'Lakshmi Stores & Finance', ownerName: 'Lakshmi', email, phone: '+91 98790 12345', city: 'Madurai', planId: 'standard', years: 1, password: 'Welcome@2026', businessType: 'kirana', features: ['pos', 'microfinance'] });
  ok(cr.status === 201, 'shop created with two add-ons: POS and microfinance');
  const o = await page(); const api = apiOf(o);
  await signIn(o, email, 'Welcome@2026');
  await o.locator('input[type=password]').nth(0).fill('Welcome@2026'); await o.locator('input[type=password]').nth(1).fill('Lakshmi@2026');
  await o.getByRole('button', { name: 'Save and continue' }).click(); await o.waitForSelector('text=Set your own password', { state: 'detached' });
  await o.goto(B + '/app'); await o.waitForLoadState('networkidle');
  await tiles(o).waitFor({ timeout: 10000 });
  let txt = await tiles(o).innerText();
  ok(/Counter billing \(POS\)/.test(txt) && /Microfinance management/.test(txt) && /not switched on yet/.test(txt), 'before switching microfinance on: both add-ons on the dashboard', txt.slice(0, 300));
  await o.screenshot({ path: `${out}/two-addons-before.png`, fullPage: true });
  await tiles(o).getByRole('link', { name: /Microfinance management/ }).click();
  await o.waitForURL(/microfinance\/settings/);
  ok(true, 'microfinance tile opens Microfinance settings');
  await api('PUT', '/shop/lending/enabled', { enabled: true });
  // A counter sale, then the dashboard again
  const slab = (await api('GET', '/shop/tax-slabs')).body.find((s) => s.rate === 5).id;
  const item = (await api('POST', '/shop/items', { type: 'Goods', name: 'Rice 1 kg', cost: 50, sp1: 70, sp2: 70, sp3: 70, taxSlabId: slab, openingStock: 20 })).body;
  const sale = await api('POST', '/shop/pos/sale', { customerId: null, withGst: false, mode: 'Cash', lines: [{ itemId: item.id, qty: 3, tier: 'SP1' }] });
  ok(sale.status === 200, 'counter sale made');
  await o.goto(B + '/app'); await o.waitForLoadState('networkidle');
  await tiles(o).waitFor();
  const mf = o.getByRole('region', { name: 'Microfinance summary' });
  await mf.waitFor({ timeout: 10000 });
  txt = await tiles(o).innerText();
  ok(/Counter sales today\s*₹210\.00/.test(txt) && /Bills today\s*1/.test(txt), 'POS tile shows today’s counter sale (₹210, 1 bill)', txt.slice(0, 200));
  ok(await mf.count() === 1 && await o.getByText('Sales this month').count() > 0, 'after switching on: POS tile + microfinance section + shop sales, one login');
  await o.screenshot({ path: `${out}/two-addons-after.png`, fullPage: true });

  // Demo shop: every add-on
  const d = await page(); await signIn(d, 'owner@shop.com', 'owner123');
  await d.goto(B + '/app'); await d.waitForLoadState('networkidle'); await tiles(d).waitFor();
  const have = Object.keys((await apiOf(d)('GET', '/auth/me')).body?.shop?.features ?? {});
  const shown = await tiles(d).locator('.addon-tile').count();
  ok(shown === have.filter((k) => k !== 'microfinance').length && await d.getByRole('region', { name: 'Microfinance summary' }).count() === 1, `shop with every add-on: ${shown} tiles + microfinance section`, `${shown} vs ${have.length}`);
  await d.screenshot({ path: `${out}/all-addons.png`, fullPage: true });
  for (const link of await tiles(d).locator('.addon-tile').evaluateAll((els) => els.map((e) => e.getAttribute('href')))) {
    await d.goto(B + link); await d.waitForLoadState('networkidle');
    ok(!/\/app\/?$/.test(new URL(d.url()).pathname) && await d.getByText(/isn’t turned on|Page not found/).count() === 0, `tile link opens ${link}`);
  }
  const m = await page({ width: 390, height: 844 }); await signIn(m, 'owner@shop.com', 'owner123');
  await m.goto(B + '/app'); await m.waitForLoadState('networkidle'); await tiles(m).waitFor();
  ok(await m.evaluate(() => document.documentElement.scrollWidth - window.innerWidth) <= 1, 'add-on tiles fit a phone screen');
  await m.screenshot({ path: `${out}/phone.png`, fullPage: true });
} catch (e) {
  ok(false, 'script crashed', e.stack);
} finally {
  ok(errs.length === 0, 'no page errors or server 500s', errs.slice(0, 5).join(' | '));
  fs.writeFileSync(`${out}/log.txt`, log.join('\n'));
  await b.close();
}
