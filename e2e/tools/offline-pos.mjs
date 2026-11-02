// Offline counter billing, the way an outage happens at a shop counter:
//  internet drops → keep billing (receipts print with an offline reference) → app reloaded while still offline →
//  internet back → bills saved with GST invoice numbers, each exactly once. Plus: the internet dropping in the middle
//  of a charge, a reply lost after the server saved the bill (resent, still one invoice), and a bill the server refuses.
// Usage: BASE=http://localhost:4000 node e2e/tools/offline-pos.mjs <outDir>
import { chromium } from 'playwright';
import fs from 'node:fs';
const B = process.env.BASE ?? 'http://localhost:4000';
const out = process.argv[2] ?? '.';
fs.mkdirSync(out, { recursive: true });
const log = [];
const ok = (c, m, why = '') => { const l = `${c ? 'PASS' : 'FAIL'} ${m}${!c && why ? ` (${why})` : ''}`; console.log(l); log.push(l); if (!c) process.exitCode = 1; };
const H = { 'x-requested-with': 'ledgerly' };
const b = await chromium.launch();
const errs = [];
const ctx = await b.newContext({ viewport: { width: 1366, height: 860 } });
const p = await ctx.newPage();
p.on('pageerror', (e) => errs.push(e.message));
p.on('response', (r) => { if (r.url().includes('/api/') && r.status() >= 500 && r.status() !== 503) errs.push(`${r.status()} ${r.url()}`); });
const api = async (m, u, d) => { const r = await p.request.fetch(B + '/api' + u, { method: m, data: d, headers: H }); return { status: r.status(), body: await r.json().catch(() => null) }; };
const invoices = async () => (await api('GET', '/shop/invoices')).body;
const queue = () => p.evaluate(() => new Promise((res) => { const r = indexedDB.open('c360-offline', 1); r.onupgradeneeded = () => r.result.createObjectStore('pos-bills', { keyPath: 'clientRef' }); r.onsuccess = () => { const t = r.result.transaction('pos-bills', 'readonly').objectStore('pos-bills').getAll(); t.onsuccess = () => res(t.result); }; }));
const waitFor = async (fn, ms = 30000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return true; await p.waitForTimeout(500); } return false; };

try {
  await p.goto(B + '/login'); await p.fill('input[type=email]', 'owner@shop.com'); await p.fill('input[type=password]', 'owner123'); await p.keyboard.press('Enter'); await p.waitForURL(/\/app/);
  const items = (await api('GET', '/shop/items')).body.filter((i) => i.type === 'Goods' && !i.isGroup && !i.trackSerials && !i.trackBatches && i.stock > 10);
  const [A, Bi] = items;
  // Online once: the app keeps the billing screen and its data ready (service worker)
  await p.goto(B + '/app'); await p.waitForTimeout(6000);
  await p.goto(B + '/app/pos'); await p.waitForLoadState('networkidle');
  await p.waitForFunction(() => navigator.serviceWorker?.controller, null, { timeout: 15000 }).catch(() => {});
  ok(await p.evaluate(() => !!navigator.serviceWorker?.controller), 'app installed for offline use (service worker active)');
  const before = (await invoices()).length;
  const stockA = A.stock;

  const scan = () => p.getByLabel('Scan or search items');
  const addItem = async (it) => { await scan().fill(it.barcode || it.sku || it.name); await scan().press('Enter'); if (!(it.barcode || it.sku)) { await p.locator('.pos-tile', { hasText: it.name }).first().click(); await scan().fill(''); } };
  const charge = () => p.getByRole('button', { name: /^Charge/ }).click();
  const offModal = () => p.locator('[role=dialog]').filter({ has: p.locator('h3', { hasText: 'Sale saved offline' }) });

  /* 1. The internet drops. Keep billing. */
  await ctx.setOffline(true);
  await p.waitForTimeout(500);
  ok(await p.locator('.pos-offline').first().isVisible(), 'POS shows “No internet. Keep billing”');
  await addItem(A); await addItem(A);
  await p.getByLabel(/Cash tendered|Tendered/i).first().fill('5000').catch(() => {});
  await charge();
  await offModal().waitFor({ timeout: 8000 });
  const rec1 = await offModal().innerText();
  ok(/OFF-[A-Z0-9]{6}/.test(rec1) && /Saved offline/.test(rec1), 'bill 1 saved offline; receipt shows OFF- reference and the note', rec1.slice(0, 200));
  ok(/Give change/.test(rec1), 'change to give is shown offline too');
  await p.screenshot({ path: `${out}/offline-receipt.png` });
  await offModal().getByRole('button', { name: 'New sale' }).click();
  await addItem(Bi);
  await p.getByRole('button', { name: /^UPI$/ }).click().catch(() => {});
  await charge(); await offModal().waitFor({ timeout: 8000 }); await offModal().getByRole('button', { name: 'New sale' }).click();
  let q = await queue();
  ok(q.length === 2 && q.every((x) => x.status === 'waiting'), 'two bills waiting on this device', JSON.stringify(q.map((x) => x.status)));
  ok(await p.getByRole('button', { name: /2 bills saved on this device/ }).count() === 1, 'top bar shows “2 bills saved on this device”');

  /* 2. The app is reloaded while still offline (power cut, browser restarted). */
  await p.reload(); await p.waitForTimeout(1500);
  ok(/\/app\/pos/.test(p.url()) && await p.getByLabel('Scan or search items').count() === 1, 'reloaded offline: still signed in, billing screen opens');
  q = await queue();
  ok(q.length === 2, 'the two bills are still on the device after the reload');
  await addItem(A);
  await charge(); await offModal().waitFor({ timeout: 8000 }); await offModal().getByRole('button', { name: 'New sale' }).click();
  ok((await queue()).length === 3, 'third bill made after the reload');

  /* 3. Internet back: bills go out on their own, each once, with GST invoice numbers. */
  await ctx.setOffline(false);
  const sent = await waitFor(async () => (await queue()).filter((x) => x.status === 'saved').length === 3);
  ok(sent, 'internet back: all 3 sent automatically');
  q = await queue();
  ok(q.every((x) => /^INV-/.test(x.invoiceNumber ?? '')), 'each got its GST invoice number', q.map((x) => x.invoiceNumber).join());
  const after = await invoices();
  ok(after.length === before + 3, `exactly 3 new invoices (no duplicates)`, `${before} → ${after.length}`);
  const mine = after.filter((i) => q.some((x) => x.invoiceId === i.id));
  ok(mine.length === 3 && mine.every((i) => i.source === 'pos' && i.status === 'Issued'), 'saved as paid counter sales');
  ok(await p.getByText(/3 offline bills saved/).count() > 0, 'toast: “3 offline bills saved”');
  const stockNow = (await api('GET', '/shop/items')).body.find((i) => i.id === A.id).stock;
  ok(stockNow === stockA - 3, `stock taken for the offline bills (${stockA} → ${stockNow})`);
  ok(await p.getByRole('button', { name: /bills? (saved on this device|sending)/ }).count() === 0, 'top-bar pill gone once everything is sent');
  const inv1 = (await api('GET', `/shop/invoices/${q[0].invoiceId}`)).body;
  ok(!!inv1.madeOfflineAt, 'invoice remembers when it was made at the counter');
  await p.goto(B + `/app/sales/invoices/${q[0].invoiceId}`); await p.waitForLoadState('networkidle');
  ok(await p.getByText(/Made offline/).count() > 0, 'invoice page shows “Made offline”');

  /* 4. The internet drops in the middle of charging (request never reaches the server). */
  await p.goto(B + '/app/pos'); await p.waitForLoadState('networkidle');
  const n4 = (await invoices()).length;
  await p.route('**/api/shop/pos/sale', (r) => r.abort('internetdisconnected'));
  await addItem(A); await charge();
  await offModal().waitFor({ timeout: 8000 });
  ok(true, 'charge failed on the network: bill kept offline instead of lost');
  await offModal().getByRole('button', { name: 'New sale' }).click();
  await p.unroute('**/api/shop/pos/sale');
  await p.evaluate(() => window.dispatchEvent(new Event('online')));
  ok(await waitFor(async () => (await queue()).filter((x) => x.status !== 'saved').length === 0), 'sent once the network works');
  ok((await invoices()).length === n4 + 1, 'one invoice for it');

  /* 5. A reply lost after the server saved the bill: the device sends it again; still one invoice. */
  const n5 = (await invoices()).length;
  let lost = 0;
  await p.route('**/api/shop/pos/sale', async (r) => { if (lost++ === 0) { await r.fetch(); return r.abort('connectionreset'); } return r.continue(); });
  await addItem(Bi); await charge();
  await offModal().waitFor({ timeout: 8000 });
  await offModal().getByRole('button', { name: 'New sale' }).click();
  ok((await invoices()).length === n5 + 1, 'server saved it, but the counter never heard back (kept on device)');
  await p.evaluate(() => window.dispatchEvent(new Event('online')));
  ok(await waitFor(async () => (await queue()).filter((x) => x.status !== 'saved').length === 0), 'resent automatically');
  ok((await invoices()).length === n5 + 1, 'still exactly one invoice after the resend (unique bill ID)');
  await p.unroute('**/api/shop/pos/sale');

  /* 6. A bill the server refuses (device clock days ahead): shown for attention, can be discarded. */
  const shopId = (await api('GET', '/auth/me')).body.shop.id;
  await p.evaluate(({ shopId, itemId }) => new Promise((res) => {
    const r = indexedDB.open('c360-offline', 1);
    r.onsuccess = () => { const t = r.result.transaction('pos-bills', 'readwrite'); t.objectStore('pos-bills').put({ clientRef: 'pos-clockahead-test01', shopId, userId: 'x', madeAt: new Date(Date.now() + 5 * 86400000).toISOString(), body: { customerId: null, withGst: false, mode: 'Cash', lines: [{ itemId, qty: 1, tier: 'SP1' }] }, expectedTotal: 100, summary: { customer: 'Walk-in customer', items: 1, mode: 'Cash' }, status: 'waiting', attempts: 0 }); t.oncomplete = () => res(true); };
  }), { shopId, itemId: A.id });
  await p.reload(); await p.waitForLoadState('networkidle');
  const pill = p.getByRole('button', { name: /needs attention/ });
  ok(await waitFor(async () => (await pill.count()) === 1, 15000), 'refused bill: top bar shows “1 offline bill needs attention”');
  await pill.click();
  const dlg = p.locator('[role=dialog]').filter({ has: p.locator('h3', { hasText: 'Offline bills' }) });
  ok(/dated in the future/.test(await dlg.innerText()), 'the list says why: dated in the future, check the device clock');
  await p.screenshot({ path: `${out}/offline-list.png` });
  await dlg.getByRole('button', { name: 'Discard bill' }).click();
  await p.getByRole('button', { name: 'Discard bill' }).last().click();
  ok(await waitFor(async () => !(await queue()).some((x) => x.clientRef === 'pos-clockahead-test01'), 5000), 'discarded after confirming');
} catch (e) {
  await p.screenshot({ path: `${out}/crash.png` }).catch(() => {});
  ok(false, 'script crashed', e.stack);
} finally {
  ok(errs.length === 0, 'no page errors or server 500s', errs.slice(0, 5).join(' | '));
  fs.writeFileSync(`${out}/log.txt`, log.join('\n'));
  await b.close();
}
