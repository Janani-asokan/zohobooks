// Every way to put items on a POS bill, not only the keyboard:
//  camera (a real barcode in front of the camera), a phone's IMEI by camera, voice, tapping tiles by category,
//  frequently sold items first, the on-screen number pad (touch counters), and a phone-sized screen.
// Usage: BASE=http://localhost:4000 node e2e/tools/counter-options.mjs <workDir> <mkbar.py>
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
const B = process.env.BASE ?? 'http://localhost:4000';
const [work = '.', mkbar] = process.argv.slice(2);
fs.mkdirSync(work, { recursive: true });
const ok = (c, m, why = '') => { console.log(`${c ? 'PASS' : 'FAIL'} ${m}${!c && why ? ` (${why})` : ''}`); if (!c) process.exitCode = 1; };
const H = { 'x-requested-with': 'ledgerly' };
const errs = [];
const browsers = [];
const video = (kind, code, name) => execFileSync('python3', ['-I', mkbar, kind, code, `${work}/${name}.y4m`]).toString().trim();
async function open(camFile, vp = { width: 1366, height: 860 }) {
  const args = ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', ...(camFile ? [`--use-file-for-fake-video-capture=${camFile}`] : [])];
  const b = await chromium.launch({ args });
  browsers.push(b);
  const ctx = await b.newContext({ viewport: vp, permissions: ['camera'] });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errs.push(e.message));
  p.on('response', (r) => { if (r.url().includes('/api/') && r.status() >= 500) errs.push(`${r.status()} ${r.url()}`); });
  await p.goto(B + '/login'); await p.fill('input[type=email]', 'owner@shop.com'); await p.fill('input[type=password]', 'owner123'); await p.keyboard.press('Enter'); await p.waitForURL(/\/app/);
  const api = async (m, u, d) => { const r = await p.request.fetch(B + '/api' + u, { method: m, data: d, headers: H }); return { status: r.status(), body: await r.json().catch(() => null) }; };
  return { b, p, api };
}
const cart = (p) => p.evaluate(() => [...document.querySelectorAll('.pos-line')].map((l) => ({ id: l.getAttribute('data-line'), name: l.querySelector('.pos-line-name')?.textContent, qty: Number(l.querySelector('input[aria-label=Quantity]')?.value), serials: [...l.querySelectorAll('.serial-chip')].map((c) => c.firstChild?.textContent) })));
const waitCart = async (p, fn, ms = 20000) => { const end = Date.now() + ms; while (Date.now() < end) { if (fn(await cart(p))) return true; await p.waitForTimeout(250); } return false; };

try {
  /* 1. Camera: a barcode in front of the camera goes on the bill, once */
  let s = await open(video('ean', '5099206066861', 'mouse'));
  const mouse = (await s.api('GET', '/shop/items')).body.find((i) => i.barcode === '5099206066861');
  await s.p.goto(B + '/app/pos'); await s.p.waitForSelector('.pos-tile');
  await s.p.getByRole('button', { name: /^Camera$/ }).click();
  ok(await waitCart(s.p, (c) => c.some((l) => l.id === mouse.id)), 'camera: the barcode in view is read and the item goes on the bill (built-in reader on this browser)');
  await s.p.waitForTimeout(3000);
  const q1 = (await cart(s.p)).find((l) => l.id === mouse.id)?.qty;
  ok(q1 === 1, 'camera: the same barcode held in view is added once, not over and over', `qty ${q1}`);
  ok(/Read 5099206066861/.test(await s.p.locator('.cam-scan').innerText()), 'camera panel shows what it read');
  await s.p.screenshot({ path: `${work}/camera.png` });
  // keyboard still works with the camera open
  const usb = (await s.api('GET', '/shop/items')).body.find((i) => i.barcode && i.id !== mouse.id && !i.trackSerials);
  await s.p.getByLabel('Scan or search items').focus(); await s.p.keyboard.type(usb.barcode, { delay: 3 }); await s.p.keyboard.press('Enter');
  ok(await waitCart(s.p, (c) => c.some((l) => l.id === usb.id), 3000), 'a USB scan still works while the camera is open');
  await s.p.getByRole('button', { name: 'Close camera' }).click();
  ok(await s.p.locator('.cam-scan').count() === 0, 'camera closes (and the camera light goes off)');
  await s.b.close();

  /* 2. Camera reads a phone's IMEI label */
  s = await open(null);
  const slab = (await s.api('GET', '/shop/tax-slabs')).body.find((x) => x.rate === 18).id;
  const tag = Date.now().toString().slice(-6);
  const imei = `8612${tag}000011`.slice(0, 16);
  const phone = (await s.api('POST', '/shop/items', { type: 'Goods', name: `Camera Phone ${tag}`, cost: 6000, sp1: 7999, sp2: 7999, sp3: 7999, taxSlabId: slab, trackSerials: true, openingStock: 0 })).body;
  const vendorId = (await s.api('GET', '/shop/vendors')).body[0].id;
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
  await s.api('POST', '/shop/bills', { vendorId, date: today, dueDate: today, lines: [{ itemId: phone.id, qty: 1, rate: 6000, serials: [imei] }] });
  await s.b.close();
  s = await open(video('c128', imei, 'imei'));
  await s.p.goto(B + '/app/pos'); await s.p.waitForSelector('.pos-tile');
  await s.p.getByRole('button', { name: /^Camera$/ }).click();
  ok(await waitCart(s.p, (c) => c.some((l) => l.id === phone.id && l.serials.includes(imei))), 'camera: pointing at the IMEI label puts that exact phone on the bill');
  await s.p.waitForTimeout(2500);
  ok((await cart(s.p)).find((l) => l.id === phone.id)?.qty === 1, 'and only once');
  await s.b.close();

  /* 3. Voice, categories, frequently sold, touch pad */
  s = await open(null);
  const { p, api } = s;
  await p.addInitScript(() => {
    // Stand-in for the browser's speech recognition: "hears" what the test sets in window.__say.
    class FakeSR { start() { setTimeout(() => { this.onresult?.({ results: [[{ transcript: window.__say }]] }); this.onend?.(); }, 50); } }
    window.webkitSpeechRecognition = FakeSR; window.SpeechRecognition = FakeSR;
  });
  const items = (await api('GET', '/shop/items')).body;
  const cable = items.find((i) => /USB-C Charging Cable/.test(i.name));
  const ink = items.find((i) => /HP 680/.test(i.name));
  await p.goto(B + '/app/pos'); await p.waitForSelector('.pos-tile');
  await p.evaluate(() => { window.__say = 'two USB-C charging cable'; });
  await p.getByRole('button', { name: /Voice/ }).click();
  ok(await waitCart(p, (c) => c.find((l) => l.id === cable.id)?.qty === 2, 3000), 'voice: saying “two USB-C charging cable” adds 2 cables');
  await p.evaluate(() => { window.__say = 'cartridge'; });
  await p.getByRole('button', { name: /Voice/ }).click();
  ok(await waitCart(p, (c) => c.some((l) => l.id === ink.id), 3000), 'voice: saying a word of the name (“cartridge”) adds the one item that matches');
  // categories
  const chips = await p.locator('.pos-cats button').allInnerTexts();
  const someCat = chips.find((c) => c !== 'All' && !c.startsWith('★'));
  await p.locator('.pos-cats button', { hasText: someCat }).click(); await p.waitForTimeout(150);
  const tileNames = await p.locator('.pos-tile .n').allInnerTexts();
  const inCat = items.filter((i) => (i.category || 'Other') === someCat).map((i) => i.name);
  ok(tileNames.length > 0 && tileNames.every((n) => inCat.includes(n)), `category chips: “${someCat}” shows only its ${tileNames.length} items`, tileNames.join(', '));
  await p.locator('.pos-cats button', { hasText: 'All' }).click();
  // touch pad
  await p.getByRole('button', { name: /Touch pad off/ }).click();
  await p.locator(`[data-line="${cable.id}"] input[aria-label=Quantity]`).click();
  await p.locator('[role=dialog] h3', { hasText: 'Quantity' }).waitFor();
  await p.getByRole('button', { name: '7', exact: true }).click(); await p.getByRole('button', { name: 'OK', exact: true }).click();
  ok(await waitCart(p, (c) => c.find((l) => l.id === cable.id)?.qty === 7, 2000), 'touch pad: tap the quantity, press 7, OK → 7 cables');
  await p.getByLabel('Bill discount', { exact: true }).click();
  await p.getByRole('button', { name: '5', exact: true }).click(); await p.getByRole('button', { name: 'OK', exact: true }).click();
  ok(await p.getByLabel('Bill discount', { exact: true }).inputValue() === '5', 'touch pad: bill discount 5%');
  await p.getByLabel('Cash tendered').click();
  const quick = p.locator('[role=dialog] .numpad-quick button');
  ok(await quick.count() > 0, 'touch pad for cash shows quick note buttons');
  await p.screenshot({ path: `${work}/numpad.png` });
  await quick.last().click(); await p.waitForTimeout(150);
  ok(Number(await p.getByLabel('Cash tendered').inputValue()) > 0 && /Charge/.test(await p.evaluate(() => document.activeElement?.textContent ?? '')), 'tapping a note fills the cash and moves to Charge');
  await p.getByRole('button', { name: /^Charge/ }).click();
  await p.locator('[role=dialog] h3', { hasText: 'Sale complete' }).waitFor({ timeout: 10000 });
  await p.keyboard.press('Enter');
  // frequently sold first
  await p.reload(); await p.waitForSelector('.pos-tile');
  const first = await p.locator('.pos-tile .n').evaluateAll((els) => els.slice(0, 3).map((e) => e.textContent));
  ok(first.includes(cable.name) && first.includes(ink.name), 'items sold at this counter now come first on the tiles', first.join(', '));
  ok(await p.locator('.pos-cats button', { hasText: 'Frequent' }).count() === 1, 'a ★ Frequent chip appears');
  await s.b.close();

  /* 4. Phone-sized screen */
  s = await open(null, { width: 390, height: 844 });
  await s.p.goto(B + '/app/pos'); await s.p.waitForSelector('.pos-tile');
  ok(await s.p.evaluate(() => document.documentElement.scrollWidth) <= 392, 'phone screen: camera, voice, categories fit with no sideways scroll');
  ok(await s.p.getByRole('button', { name: /^Camera$/ }).isVisible() && await s.p.getByRole('button', { name: /Voice/ }).isVisible(), 'camera and voice buttons on the phone screen');
  await s.p.screenshot({ path: `${work}/phone.png`, fullPage: true });
  await s.b.close();
} catch (e) {
  ok(false, 'script crashed', e.stack);
} finally {
  ok(errs.length === 0, 'no page errors or server 500s', errs.slice(0, 5).join(' | '));
  for (const b of browsers) await b.close().catch(() => {});
}
