// CorpusLite phone app, as a phone runs it: the app build served from its own origin (like the phone's web view)
// talking to the server with a bearer token. Sign in, register the phone, bill with this phone's own GST series,
// lose the internet (server unreachable), reopen the app, bill offline with the next final number and the stock
// going down, get the internet back and see the bill saved with that number; a reused number is refused; web-only
// pages say "on the website".
// Usage: APP=http://localhost:5555 BASE=http://localhost:4000 node e2e/tools/corpuslite-app.mjs <outDir>
//   (build: VITE_API_BASE=$BASE vite build --mode app --outDir X; serve X with SPA fallback on APP; server APP_ORIGINS must include APP)
import { chromium } from 'playwright';
import fs from 'node:fs';
const APP = process.env.APP ?? 'http://localhost:5555';
const B = process.env.BASE ?? 'http://localhost:4000';
const out = process.argv[2] ?? '.'; fs.mkdirSync(out, { recursive: true });
const ok = (c, m, why = '') => { console.log(`${c ? 'PASS' : 'FAIL'} ${m}${!c && why ? ` (${why})` : ''}`); if (!c) process.exitCode = 1; };
const NUM = /^[A-Z][1-9]\/\d{4}-\d{2}\/\d{4}$/;
const errs = [];
const b = await chromium.launch();
try {
  const ctx = await b.newContext({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errs.push(e.message));
  await p.addInitScript(() => { window.print = () => {}; });
  const apiCalls = [];
  p.on('request', (r) => { if (r.url().startsWith(B + '/api/')) apiCalls.push({ url: r.url(), auth: r.headers().authorization ?? '', cookie: r.headers().cookie ?? '' }); });

  await p.goto(APP + '/');
  await p.waitForURL(/\/login/);
  ok(true, 'the app opens on sign-in (no website landing page)');
  await p.fill('input[type=email]', 'owner@shop.com'); await p.fill('input[type=password]', 'owner123'); await p.keyboard.press('Enter');
  await p.waitForURL(/\/app/, { timeout: 30000 });
  const token = await p.evaluate(() => localStorage.getItem('c360.app.token'));
  ok(!!token && token.length > 20, 'signed in: the session is a token kept on the phone');
  await p.waitForTimeout(5500); // OfflineSync preloads data and registers the phone after 4 s
  const loginAt = apiCalls.findIndex((c) => /auth\/login/.test(c.url));
  const after = apiCalls.slice(loginAt + 1);
  ok(after.length > 3 && after.every((c) => c.auth.startsWith('Bearer ') && !c.cookie), `every call carries the bearer token and no cookie (${after.length} calls)`);
  const shopId = await p.evaluate(async () => (await (await fetch('http://localhost:4000/api/auth/me', { headers: { authorization: `Bearer ${localStorage.getItem('c360.app.token')}` } })).json()).shop.id);
  const series = await p.evaluate((id) => JSON.parse(localStorage.getItem(`c360.app.series.${id}`) ?? 'null'), shopId);
  ok(series && /^[A-Z][1-9]$/.test(series.code) && series.next >= 1, `phone registered with its own series: ${series?.code}, next ${series?.next}`);

  /* Online sale: the phone's own number */
  await p.goto(APP + '/app/pos'); await p.waitForSelector('.pos-tile');
  const tile = p.locator('.pos-tile').filter({ hasNotText: /Phone|Galaxy|Redmi|M15|IMEI/ }).first();
  const tileName = (await tile.locator('.n').innerText()).trim();
  await tile.click();
  await p.getByRole('button', { name: /^Charge/ }).first().click();
  await p.waitForSelector('text=Sale complete');
  const sub1 = await p.locator('[role=dialog]').first().innerText();
  const n1 = sub1.match(/[A-Z][1-9]\/\d{4}-\d{2}\/\d{4}/)?.[0];
  ok(n1 && NUM.test(n1) && n1.startsWith(series.code + '/'), `online bill numbered in this phone's series: ${n1}`);
  await p.getByRole('button', { name: /New sale/ }).click();

  /* No internet: the server can't be reached */
  await p.route(B + '/**', (r) => r.abort('internetdisconnected'));
  await p.reload(); await p.waitForSelector('.pos-tile', { timeout: 20000 });
  ok(true, 'the app reopens with no internet: POS and its items come from the phone');
  const stockBefore = await p.locator('.pos-tile', { hasText: tileName }).first().innerText();
  await p.locator('.pos-tile', { hasText: tileName }).first().click();
  await p.getByRole('button', { name: /^Charge/ }).first().click();
  await p.waitForSelector('text=Sale saved offline', { timeout: 15000 });
  const offText = await p.locator('[role=dialog]').first().innerText();
  const n2 = offText.match(/[A-Z][1-9]\/\d{4}-\d{2}\/\d{4}/)?.[0];
  const seq = (n) => Number(n.split('/')[2]);
  ok(n2 && seq(n2) === seq(n1) + 1, `offline bill gets the next final GST number at the counter: ${n2}`);
  await p.screenshot({ path: `${out}/offline-receipt.png` });
  await p.getByRole('button', { name: /New sale/ }).click();
  const stockAfter = await p.locator('.pos-tile', { hasText: tileName }).first().innerText();
  const num = (t) => Number((t.match(/(-?[\d.]+)\s+\w+\s+in stock/) ?? [])[1]);
  ok(num(stockAfter) === num(stockBefore) - 1, `the phone's stock went down offline: ${num(stockBefore)} → ${num(stockAfter)}`);
  for (const [path, sel, what] of [['/app/items', 'table, .item-card, .empty-state', 'items'], ['/app/sales/customers', 'table, .empty-state', 'customers'], ['/app/sales/invoices', 'table, .empty-state', 'invoices']]) {
    await p.goto(APP + path); const shown = await p.waitForSelector(sel, { timeout: 15000 }).then(() => true, () => false);
    ok(shown, `${what} open offline`);
  }

  /* Internet back: the bill goes to the server with its number */
  await p.unroute(B + '/**');
  await p.goto(APP + '/app/pos'); await p.waitForSelector('.pos-tile');
  const saved = await p.waitForFunction(async ([base, n]) => {
    const r = await fetch(`${base}/api/shop/invoices`, { headers: { authorization: `Bearer ${localStorage.getItem('c360.app.token')}` } });
    const list = await r.json(); return (Array.isArray(list) ? list : list.rows ?? list.items).some((i) => i.number === n);
  }, [B, n2], { timeout: 40000, polling: 2000 }).then(() => true, () => false);
  ok(saved, `back online: ${n2} is saved on the server with the number the phone gave it`);

  /* The server refuses a number used twice */
  const dup = await p.evaluate(async ([base, clientId, s, itemId]) => {
    const r = await fetch(`${base}/api/shop/pos/sale`, { method: 'POST', headers: { authorization: `Bearer ${localStorage.getItem('c360.app.token')}`, 'content-type': 'application/json', 'x-requested-with': 'ledgerly', 'x-client': 'corpuslite' },
      body: JSON.stringify({ customerId: null, withGst: true, mode: 'Cash', lines: [{ itemId, qty: 1, tier: 'SP1', discount: 0 }], clientRef: `dupcheck${Date.now()}`, deviceNumber: { clientId, seq: s } }) });
    return { status: r.status, body: await r.json() };
  }, [B, await p.evaluate(() => localStorage.getItem('c360.app.deviceId')), seq(n2), await p.evaluate(async (base) => (await (await fetch(`${base}/api/shop/items`, { headers: { authorization: `Bearer ${localStorage.getItem('c360.app.token')}` } })).json()).find((i) => i.type === 'Goods' && !i.trackSerials && i.stock > 1).id, B)]);
  ok(dup.status === 409 && /already used/.test(dup.body.error), 'a number used twice is refused (each number once)', JSON.stringify(dup.body).slice(0, 120));

  /* Web-only parts */
  await p.goto(APP + '/app/accounting/accounts');
  ok(await p.getByRole('heading', { name: 'This is on the website' }).waitFor({ timeout: 10000 }).then(() => true, () => false), 'web-only pages (accounting) point to the website');
  const navText = await p.locator('nav').first().innerText().catch(() => '');
  ok(!/Microfinance|Chart of Accounts|Field Team/.test(navText), 'the menu shows only the shop essentials');
  await p.screenshot({ path: `${out}/app-menu.png` });
  await p.evaluate(() => { Object.keys(localStorage).filter((x) => x.startsWith('c360.pos.')).forEach((x) => localStorage.removeItem(x)); });
} catch (e) { ok(false, 'script crashed', e.stack); }
finally { ok(errs.length === 0, 'no page errors', errs.slice(0, 4).join(' | ')); await b.close(); }
