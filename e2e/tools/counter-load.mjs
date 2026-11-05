// A supermarket-sized catalogue at the counter: 3,000 items, 50 scans back to back with no pause, then name search.
// Usage: BASE=http://localhost:4000 node e2e/tools/counter-load.mjs
import { chromium } from 'playwright';
const B = process.env.BASE ?? 'http://localhost:4000';
const ok = (c, m, why = '') => { console.log(`${c ? 'PASS' : 'FAIL'} ${m}${!c && why ? ` (${why})` : ''}`); if (!c) process.exitCode = 1; };
const H = { 'x-requested-with': 'ledgerly' };
const b = await chromium.launch(); const p = await (await b.newContext({ viewport: { width: 1366, height: 860 } })).newPage();
const errs = []; p.on('pageerror', (e) => errs.push(e.message));
const api = async (m, u, d) => { const r = await p.request.fetch(B + '/api' + u, { method: m, data: d, headers: H, timeout: 120000 }); return { status: r.status(), body: await r.json().catch(() => null) }; };
await p.goto(B + '/login'); await p.fill('input[type=email]', 'owner@shop.com'); await p.fill('input[type=password]', 'owner123'); await p.keyboard.press('Enter'); await p.waitForURL(/\/app/);
const tag = Date.now().toString().slice(-4);
const code = (n) => `29${tag}${String(n).padStart(6, '0')}`.slice(0, 13);
const rows = ['Name,Barcode,Category,Cost,MRP,SP1,Tax Rate,Stock'];
const kinds = ['Rice', 'Atta', 'Sugar', 'Dal', 'Oil', 'Soap', 'Biscuit', 'Tea', 'Salt', 'Masala'];
for (let n = 0; n < 3000; n++) rows.push(`${kinds[n % 10]} pack ${tag}-${n},${code(n)},Grocery,${20 + (n % 50)},${40 + (n % 60)},${35 + (n % 55)},5,100`);
const t0 = Date.now();
const imp = await api('POST', '/shop/items/import', { csv: rows.join('\r\n') });
ok(imp.status === 200 && imp.body.created === 3000, `3,000 grocery items imported in ${((Date.now() - t0) / 1000).toFixed(1)} s`, JSON.stringify(imp.body).slice(0, 200));
const t1 = Date.now();
await p.goto(B + '/app/pos'); await p.waitForSelector('.pos-tile');
ok(true, `POS opened with ${(await api('GET', '/shop/items')).body.length} items in ${((Date.now() - t1) / 1000).toFixed(1)} s`);
// 50 scans, no gap between them (scanner fires as fast as it can)
const picks = Array.from({ length: 50 }, (_, i) => (i * 61) % 3000);
const t2 = Date.now();
for (const n of picks) { await p.keyboard.type(code(n), { delay: 0 }); await p.keyboard.press('Enter'); }
await p.waitForFunction((want) => [...document.querySelectorAll('.pos-line input[aria-label=Quantity]')].reduce((a, x) => a + Number(x.value), 0) >= want, 50, { timeout: 20000 }).catch(() => {});
const ms = Date.now() - t2;
const units = await p.locator('.pos-line input[aria-label=Quantity]').evaluateAll((e) => e.reduce((a, x) => a + Number(x.value), 0));
const linesN = await p.locator('.pos-line').count();
ok(units === 50 && linesN === new Set(picks).size, `50 back-to-back scans: all 50 on the bill (${linesN} lines) in ${(ms / 1000).toFixed(1)} s, ${(ms / 50).toFixed(0)} ms per scan`, `units ${units}, lines ${linesN}`);
ok(ms / 50 < 150, 'each scan lands well under the ~150 ms a cashier would notice');
// Name search among 3,000
await p.keyboard.type('dal pack', { delay: 30 });
const t3 = Date.now(); await p.waitForTimeout(50);
const shown = await p.locator('.pos-tile').count();
ok(shown > 0 && shown <= 60, `typing “dal pack” filters 3,000 items to ${shown} tiles instantly (${Date.now() - t3} ms after the last key)`);
await p.keyboard.press('Escape');
await p.keyboard.press('Enter'); await p.keyboard.press('Enter');
await p.locator('[role=dialog] h3', { hasText: 'Sale complete' }).waitFor({ timeout: 15000 });
ok(true, `a 50-line bill charged: ${(await p.locator('[role=dialog]').innerText()).match(/INV-[\\w-]+/)?.[0] ?? 'saved'}`);
ok(errs.length === 0, 'no page errors', errs.slice(0, 3).join(' | '));
await b.close();
