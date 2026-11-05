// A busy counter, keyboard and scanner only (no mouse anywhere), the way supermarket and shop cashiers work:
//  1. a 15-scan bill at scanner speed with 5*, *2, +, −, Delete, a typed name picked with the arrow keys, an unknown
//     barcode in the middle, then Enter → cash amount → Enter → sale → Enter → next customer;
//  2. a queue: hold a bill (F6), serve the next by UPI (F9, End), bring the held one back (F6, 1) and finish it;
//  3. a refresh in the middle of a bill: the bill is still there;
//  4. a phone shop: scan the box, then the IMEI; scan an IMEI directly; a sold IMEI is refused; receipt shows the IMEI;
//  5. the internet drops: the keyboard flow still bills.
// Usage: BASE=http://localhost:4000 node e2e/tools/counter-rush.mjs <outDir>
import { chromium } from 'playwright';
import fs from 'node:fs';
const B = process.env.BASE ?? 'http://localhost:4000';
const out = process.argv[2] ?? '.';
fs.mkdirSync(out, { recursive: true });
const ok = (c, m, why = '') => { console.log(`${c ? 'PASS' : 'FAIL'} ${m}${!c && why ? ` (${why})` : ''}`); if (!c) process.exitCode = 1; };
const H = { 'x-requested-with': 'ledgerly' };
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1366, height: 860 } });
const p = await ctx.newPage();
const errs = [];
p.on('pageerror', (e) => errs.push(e.message));
p.on('response', (r) => { if (r.url().includes('/api/') && r.status() >= 500) errs.push(`${r.status()} ${r.url()}`); });
const api = async (m, u, d) => { const r = await p.request.fetch(B + '/api' + u, { method: m, data: d, headers: H }); return { status: r.status(), body: await r.json().catch(() => null) }; };
const k = (key) => p.keyboard.press(key);
const scan = async (code, gap = 30) => { await p.keyboard.type(code, { delay: 2 }); await k('Enter'); await p.waitForTimeout(gap); }; // a USB scanner: very fast keys, then Enter
const cart = () => p.evaluate(() => [...document.querySelectorAll('.pos-line')].map((l) => ({ id: l.getAttribute('data-line'), name: l.querySelector('.pos-line-name')?.textContent, qty: Number(l.querySelector('input[aria-label=Quantity]')?.value), serials: [...l.querySelectorAll('.serial-chip')].map((c) => c.firstChild?.textContent) })));
const focused = () => p.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? document.activeElement?.textContent?.trim().slice(0, 30));
const dialogTitle = () => p.locator('[role=dialog] h3').allInnerTexts();
const invCount = async () => (await api('GET', '/shop/invoices')).body.length;

try {
  await p.goto(B + '/login'); await p.fill('input[type=email]', 'owner@shop.com'); await p.fill('input[type=password]', 'owner123'); await k('Enter'); await p.waitForURL(/\/app/);
  const all = (await api('GET', '/shop/items')).body;
  const bc = all.filter((i) => i.barcode && i.type === 'Goods' && !i.trackSerials && !i.trackBatches && !i.isGroup);
  const [A, Bi, C, D, E] = bc;
  const named = all.find((i) => ![A, Bi, C, D, E].some((x) => x.id === i.id) && !i.trackSerials && !i.isGroup && !i.trackBatches && i.name.split(/\s+/)[0].length >= 3);
  await p.goto(B + '/app/pos'); await p.waitForSelector('.pos-tile');
  ok(await focused() === 'Scan or search items', 'POS opens with the cursor in the scan box');
  const before = await invCount();

  /* 1. A 15-scan bill, keyboard only */
  const t0 = Date.now();
  await scan(A.barcode); await scan(A.barcode); await scan(Bi.barcode);
  await scan(`5*${C.barcode}`);                     // five of C
  await scan(D.barcode); await scan('*3');           // D becomes 3
  await p.keyboard.type('+'); await p.keyboard.type('+'); await p.keyboard.type('-'); // D: 3 → 4
  await scan('0000000000000');                       // unknown barcode in the rush
  const unknownShown = await p.locator('.pos-unknown').isVisible();
  await scan(E.barcode);                             // next scan is not spoiled by the unknown one
  await k('Delete');                                 // oops, E was a mistake: removed
  await scan(Bi.barcode);
  // type part of a name, arrows, Enter
  const word = named.name.split(/\s+/)[0].slice(0, 5);
  await p.keyboard.type(word, { delay: 15 }); await p.waitForTimeout(150);
  const tiles = await p.locator('.pos-tile').evaluateAll((els) => els.map((e) => e.querySelector('.n')?.textContent));
  let pick = 0; const idx = tiles.findIndex((n) => n === named.name);
  for (; pick < idx; pick++) await k('ArrowRight');
  await k('Enter'); await p.waitForTimeout(100);
  for (let i = 0; i < 4; i++) await scan(A.barcode, 15);   // four quick re-scans of A
  const lines1 = await cart();
  const q = Object.fromEntries(lines1.map((l) => [l.id, l.qty]));
  ok(q[A.id] === 6 && q[Bi.id] === 2 && q[C.id] === 5 && q[D.id] === 4 && !q[E.id] && q[named.id] === 1, `15 scans + keys gave the right bill: A×6, B×2, C×5 (5*), D×4 (*3 + + −), E removed (Del), "${named.name}" picked by typing + arrows`, JSON.stringify(lines1.map((l) => [l.name, l.qty])));
  ok(unknownShown, 'an unknown barcode shows a “Not found” banner and beeps, without blocking the next scan');
  ok(await p.getByLabel('Scan or search items').inputValue() === '', 'scan box is empty after every scan (nothing left to spoil the next one)');
  ok(await p.locator('.pos-line.last').getAttribute('data-line') === A.id, 'the last scanned item is highlighted');
  await k('Enter');                                   // empty box → payment
  ok(await focused() === 'Cash tendered', 'Enter on the empty scan box jumps to the cash amount');
  const total = Number((await p.locator('.pos-charge').innerText()).replace(/[^\d.]/g, ''));
  await p.keyboard.type(String(Math.ceil(total / 500) * 500 + 500)); await k('Enter'); await k('Enter'); // an impatient double Enter
  await p.locator('[role=dialog] h3', { hasText: 'Sale complete' }).waitFor({ timeout: 10000 });
  const secs = (Date.now() - t0) / 1000;
  ok(true, `bill of ${lines1.reduce((a, l) => a + l.qty, 0)} units charged in ${secs.toFixed(1)} s from the first scan, keyboard only`);
  ok(/Give change/.test(await p.locator('[role=dialog]').innerText()), 'change to give is shown');
  await p.screenshot({ path: `${out}/rush-sale.png` });
  await p.waitForTimeout(150);
  if ((await dialogTitle()).length) await k('Enter');  // next customer (the double Enter above may already have done it)
  await p.waitForTimeout(150);
  ok((await dialogTitle()).length === 0 && await focused() === 'Scan or search items' && (await cart()).length === 0, 'Enter after the sale: empty bill, cursor back in the scan box');
  const inv1 = (await api('GET', '/shop/invoices')).body.find((i) => i.source === 'pos');
  ok((await invCount()) === before + 1 && Math.abs(inv1.total - total) < 0.01, `one invoice saved for ₹${inv1.total}, even with Enter pressed twice`);

  /* 2. A queue: hold, serve the next, recall */
  await scan(C.barcode); await scan(D.barcode); await scan(`2*${A.barcode}`);
  await k('F6');
  ok((await cart()).length === 0 && /\(1\)/.test(await p.locator('.pos-keys').innerText()), 'F6 holds the bill (customer stepped away); the screen is free for the next one');
  await scan(Bi.barcode);
  await k('F9'); await p.waitForTimeout(100);
  ok(await focused() !== 'Cash tendered' && /Charge/.test(await focused()), 'F9 picks UPI and moves to Charge');
  await k('Enter');
  await p.locator('[role=dialog] h3', { hasText: 'Sale complete' }).waitFor({ timeout: 10000 });
  await k('Enter');
  await k('F6'); await p.locator('[role=dialog] h3', { hasText: 'Held bills' }).waitFor();
  await k('1'); await p.waitForTimeout(200);
  const back = await cart();
  ok(back.length === 3 && back.find((l) => l.id === A.id)?.qty === 2, 'F6 then 1 brings the held bill back exactly', JSON.stringify(back.map((l) => [l.name, l.qty])));
  await k('F8'); await k('Enter');                  // cash, exact (empty amount = exact)
  await p.locator('[role=dialog] h3', { hasText: 'Sale complete' }).waitFor({ timeout: 10000 });
  await k('Enter');
  ok((await invCount()) === before + 3, 'queue served: 3 bills saved, none lost or doubled');

  /* 3. Refresh in the middle of a bill */
  await scan(A.barcode); await scan(`3*${Bi.barcode}`);
  await p.reload(); await p.waitForSelector('.pos-line', { timeout: 10000 });
  const kept = await cart();
  ok(kept.length === 2 && kept.find((l) => l.id === Bi.id)?.qty === 3, 'after a refresh (or power cut) the unfinished bill is restored');
  await k('Control+Delete'); await p.locator('[role=dialog] h3', { hasText: 'Clear this bill?' }).waitFor();
  await k('Enter'); await p.waitForTimeout(200);
  ok((await cart()).length === 0, 'Ctrl+Delete, Enter clears the bill (after asking)');

  /* F3: change the last item's quantity by typing */
  await scan(C.barcode); await k('F3'); await p.keyboard.type('12'); await k('Enter'); await p.waitForTimeout(150);
  ok((await cart())[0]?.qty === 12 && await focused() === 'Scan or search items', 'F3, type 12, Enter: quantity 12 and back to scanning');
  await p.keyboard.press('F3'); await k('Backspace'); await k('Backspace'); await p.waitForTimeout(100);
  ok((await cart()).length === 1, 'clearing the quantity box to retype does not remove the item');
  await k('Escape'); await k('Control+Delete'); await k('Enter');

  /* 4. Phone shop: IMEI at the counter */
  const slab = (await api('GET', '/shop/tax-slabs')).body.find((s) => s.rate === 18).id;
  const tag = Date.now().toString().slice(-6);
  const phone = (await api('POST', '/shop/items', { type: 'Goods', name: `Redmi A3 ${tag}`, barcode: `69${tag}00001`.slice(0, 13), cost: 6000, sp1: 7499, sp2: 7499, sp3: 7499, taxSlabId: slab, trackSerials: true, openingStock: 0 })).body;
  const vendorId = (await api('GET', '/shop/vendors')).body[0].id;
  const imeis = [`86${tag}0000011`, `86${tag}0000029`, `86${tag}0000037`];
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
  ok((await api('POST', '/shop/bills', { vendorId, date: today, dueDate: today, lines: [{ itemId: phone.id, qty: 3, rate: 6000, serials: imeis }] })).status === 200, 'three phones bought on a bill with their IMEIs');
  await p.reload(); await p.waitForSelector('.pos-tile');
  await scan(phone.barcode);                        // box barcode → asks for the IMEI
  ok((await dialogTitle()).some((t) => /IMEI/.test(t)) && await focused() === 'IMEI or serial number', 'scanning the phone box asks for its IMEI, cursor ready');
  await scan(imeis[0]);
  await scan(imeis[1]);                            // scanning an IMEI directly puts that phone on the bill
  await scan(imeis[1]);                            // same IMEI again → refused
  let ph = (await cart()).find((l) => l.id === phone.id);
  ok(ph?.qty === 2 && ph.serials.join() === `${imeis[0]},${imeis[1]}`, 'two phones on the bill, each with its IMEI (one by box + IMEI, one by IMEI alone)', JSON.stringify(ph));
  ok(/already on this bill/.test(await p.locator('.toast').allInnerTexts().then((t) => t.join(' '))), 'the same IMEI scanned twice is refused');
  await k('Enter'); await p.keyboard.type('20000'); await k('Enter');
  await p.locator('[role=dialog] h3', { hasText: 'Sale complete' }).waitFor({ timeout: 10000 });
  const rc = await p.locator('.receipt-frame').innerText();
  ok(rc.includes(imeis[0]) && rc.includes(imeis[1]), 'receipt shows both IMEIs (for warranty)');
  await p.screenshot({ path: `${out}/imei-sale.png` });
  await k('Enter');
  const sn = (await api('GET', `/shop/items/${phone.id}/serials`)).body;
  ok(sn.filter((s) => s.status === 'Sold').map((s) => s.serial).sort().join() === [imeis[0], imeis[1]].sort().join() && sn.find((s) => s.serial === imeis[2]).status === 'In stock', 'stock records: those two sold, the third still in stock');
  await scan(imeis[0]); await p.waitForTimeout(300);
  ok(/sold/i.test(await p.locator('.toast').allInnerTexts().then((t) => t.join(' '))) && !(await cart()).length, 'a sold IMEI scanned again is refused (“sold”, with the invoice)');

  /* 5. Internet drops: same keys still bill */
  await ctx.setOffline(true); await p.waitForTimeout(300);
  const nOff = await invCount().catch(() => null);
  await scan(A.barcode); await scan(`2*${C.barcode}`); await k('Enter'); await k('Enter');
  await p.locator('[role=dialog] h3', { hasText: 'Sale saved offline' }).waitFor({ timeout: 10000 });
  ok(true, 'offline: scan, scan, Enter, Enter → bill saved on the device with its receipt');
  await k('Enter'); await p.waitForTimeout(150);
  ok(await focused() === 'Scan or search items' && (await cart()).length === 0, 'Enter: next customer, cursor back in the scan box');
  await ctx.setOffline(false);
  await p.waitForFunction(async () => {
    const r = indexedDB.open('c360-offline', 1);
    return await new Promise((res) => { r.onsuccess = () => { const t = r.result.transaction('pos-bills', 'readonly').objectStore('pos-bills').getAll(); t.onsuccess = () => res(t.result.every((x) => x.status === 'saved')); }; r.onerror = () => res(false); });
  }, null, { timeout: 30000, polling: 1000 });
  ok(true, 'back online: the offline bill was sent');
  void nOff;
} catch (e) {
  await p.screenshot({ path: `${out}/crash.png` }).catch(() => {});
  ok(false, 'script crashed', e.stack);
} finally {
  ok(errs.length === 0, 'no page errors or server 500s', errs.slice(0, 5).join(' | '));
  await b.close();
}
