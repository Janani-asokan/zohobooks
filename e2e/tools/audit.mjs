// Dev helper: for every role, open every page in that role's sidebar (plus key detail pages) and report
// page errors, 4xx/5xx API calls (a 403 on a page the role can open is a bug), slow API calls, slow pages
// and horizontal scroll. Usage: BASE=http://localhost:4000 [W=390] node e2e/tools/audit.mjs [outDir]
import { chromium } from 'playwright';
const B = process.env.BASE ?? 'http://localhost:5173';
const W = Number(process.env.W ?? 1440);
const out = process.argv[2];
const SLOW_API = Number(process.env.SLOW_API ?? 400);
const SLOW_PAGE = Number(process.env.SLOW_PAGE ?? 1500);
const ROLES = [
  ['owner@shop.com', 'owner123'], ['manager@shop.com', 'manager123'], ['accounts@shop.com', 'accounts123'],
  ['sales@shop.com', 'sales123'], ['warehouse@shop.com', 'warehouse123'], ['admin@ledgerly.in', 'admin123'],
];
const b = await chromium.launch();
const report = [];
for (const [email, pass] of ROLES) {
  const ctx = await b.newContext({ viewport: { width: W, height: 900 }, serviceWorkers: 'block' });
  const p = await ctx.newPage();
  const issues = []; let route = ''; const started = new Map();
  p.on('pageerror', (e) => issues.push(`${route} pageerror ${e.message}`));
  p.on('console', (m) => m.type() === 'error' && !/401|Failed to load resource/.test(m.text()) && issues.push(`${route} console ${m.text().slice(0, 160)}`));
  p.on('request', (r) => r.url().includes('/api/') && started.set(r, Date.now()));
  p.on('requestfinished', (r) => { const t0 = started.get(r); if (t0 && Date.now() - t0 > SLOW_API) issues.push(`${route} slow ${Date.now() - t0}ms ${r.method()} ${r.url().replace(B, '')}`); });
  p.on('response', (r) => r.url().includes('/api/') && r.status() >= 400 && r.status() !== 401 && issues.push(`${route} ${r.status()} ${r.request().method()} ${r.url().replace(B, '')}`));
  await p.goto(B + '/login'); await p.fill('input[type=email]', email); await p.fill('input[type=password]', pass); await p.keyboard.press('Enter');
  await p.waitForURL(/\/(app|super-admin)/); await p.waitForTimeout(800);
  const home = new URL(p.url()).pathname.startsWith('/super') ? '/super-admin' : '/app';
  // Every link the sidebar offers this role (expand collapsed groups first).
  for (const g of await p.locator('aside button[aria-expanded="false"]').all()) await g.click().catch(() => {});
  const links = [...new Set(await p.locator('aside a[href^="/"]').evaluateAll((as) => as.map((a) => a.getAttribute('href'))))];
  const extra = [];
  if (home === '/app') {
    const ids = await p.evaluate(async () => {
      const j = async (u) => { const r = await fetch(u); return r.ok ? r.json() : []; };
      const inv = (await j('/api/shop/invoices')).find?.((i) => i.status === 'Issued')?.id;
      const item = (await j('/api/shop/items'))[0]?.id; const cust = (await j('/api/shop/customers'))[0]?.id;
      return { inv, item, cust };
    });
    if (ids.inv) extra.push(`/app/sales/invoices/${ids.inv}`, `/invoices/${ids.inv}/print`);
    if (ids.item) extra.push(`/app/items/${ids.item}`);
    if (ids.cust) extra.push(`/app/sales/customers/${ids.cust}`);
  }
  const routes = [...new Set([home, ...links, ...extra])];
  const times = [];
  for (const r of routes) {
    route = r;
    const t0 = Date.now();
    await p.goto(B + r, { waitUntil: 'domcontentloaded' });
    await p.waitForLoadState('networkidle').catch(() => {});
    // Wait for skeletons/spinners to clear: that's when the page is usable.
    await p.waitForFunction(() => !document.querySelector('.skeleton, .spin, .page-loading'), null, { timeout: 15000 }).catch(() => issues.push(`${r} still loading after 15s`));
    const ms = Date.now() - t0; times.push([r, ms]);
    if (ms > SLOW_PAGE) issues.push(`${r} slow page ${ms}ms`);
    const denied = await p.locator('text=/don.t have (access|permission)|not allowed|Access denied/i').count();
    if (denied) issues.push(`${r} shows an access-denied message although it is in the menu`);
    if (await p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)) issues.push(`${r} horizontal scroll`);
    if (out) await p.screenshot({ path: `${out}/${email.split('@')[0]}${r.replace(/[^a-z0-9]+/gi, '_')}.png` });
  }
  const avg = Math.round(times.reduce((s, [, ms]) => s + ms, 0) / times.length);
  const worst = [...times].sort((a, x) => x[1] - a[1]).slice(0, 3).map(([r, ms]) => `${r} ${ms}ms`).join(', ');
  report.push(`== ${email}: ${routes.length} pages, avg ${avg}ms, slowest ${worst}\n${issues.length ? issues.map((i) => '  ' + i).join('\n') : '  no issues'}`);
  await ctx.close();
}
console.log(report.join('\n'));
await b.close();
