// Prints the real thing to PDF the way Chrome prints it (print media + the page's own @page size) and checks the paper
// size and that the content is on it: POS receipt, the Print settings test receipt, an invoice's receipt print view,
// and barcode labels. Usage: BASE=http://localhost:4000 node e2e/tools/print-sizes.mjs <outDir>
import { chromium } from 'playwright';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
const B = process.env.BASE ?? 'http://localhost:4000';
const out = process.argv[2] ?? '.'; fs.mkdirSync(out, { recursive: true });
const ok = (c, m) => { console.log(`${c ? 'PASS' : 'FAIL'} ${m}`); if (!c) process.exitCode = 1; };
const near = (a, b) => Math.abs(a - b) < 1;
const mm = (pt) => Math.round((pt / 72) * 25.4 * 10) / 10;
function pdfInfo(file) {
  const info = execFileSync('pdfinfo', [file]).toString();
  const [, w, h] = info.match(/Page size:\s+([\d.]+) x ([\d.]+)/);
  const pages = Number(info.match(/Pages:\s+(\d+)/)[1]);
  const text = execFileSync('pdftotext', ['-layout', file, '-']).toString();
  return { w: mm(Number(w)), h: mm(Number(h)), pages, text };
}
const b = await chromium.launch();
const p = await (await b.newContext({ viewport: { width: 1366, height: 800 } })).newPage();
// Keep the print styles that the app adds just before window.print(), so the PDF is what the printer would get.
await p.addInitScript(() => { window.print = () => { document.querySelectorAll('style').forEach((s) => { if (s.textContent.includes('@page')) { const c = s.cloneNode(true); c.dataset.keep = '1'; document.head.appendChild(c); } }); window.__printClass = document.body.className; }; });
const asPrinted = async (name) => {
  await p.evaluate(() => { if (window.__printClass) document.body.className = window.__printClass; });
  await p.emulateMedia({ media: 'print' });
  const file = `${out}/${name}.pdf`;
  fs.writeFileSync(file, await p.pdf({ preferCSSPageSize: true, printBackground: true }));
  await p.emulateMedia({ media: 'screen' });
  await p.evaluate(() => { document.querySelectorAll('style[data-keep]').forEach((s) => s.remove()); window.__printClass = ''; });
  return pdfInfo(file);
};
await p.goto(B + '/login'); await p.fill('input[type=email]', 'owner@shop.com'); await p.fill('input[type=password]', 'owner123'); await p.keyboard.press('Enter'); await p.waitForURL(/app/);

// 1. POS receipt, 80 mm and 58 mm
await p.goto(B + '/app/pos'); await p.waitForSelector('.pos-tile');
// Tap two plain items (not phones that need an IMEI, which open the IMEI box).
const plain = (await (await p.request.get(B + '/api/shop/items', { headers: { 'x-requested-with': 'ledgerly' } })).json()).filter((i) => i.type === 'Goods' && !i.trackSerials && i.stock > 2).slice(0, 2);
for (const it of plain) await p.locator('.pos-tile', { has: p.locator('.n', { hasText: it.name }) }).first().click();
await p.getByRole('button', { name: /^Charge/ }).first().click(); await p.waitForSelector('text=Sale complete');
await p.getByRole('button', { name: /Print receipt/ }).click(); await p.waitForTimeout(200);
let r = await asPrinted('pos-80mm');
ok(near(r.w, 80) && r.pages === 1 && r.h > 60 && r.h < 400, `POS receipt prints on 80 mm paper, ${r.h} mm long, ${r.pages} page`);
ok(/TOTAL/.test(r.text), `POS receipt has the bill on it (${r.text.replace(/\s+/g, ' ').slice(0, 60)}…)`);
await p.locator('[role=dialog]').getByText('58mm', { exact: true }).click(); await p.waitForTimeout(200);
await p.getByRole('button', { name: /Print receipt/ }).click(); await p.waitForTimeout(200);
r = await asPrinted('pos-58mm');
ok(near(r.w, 58) && r.pages === 1 && /TOTAL/.test(r.text), `58 mm roll: ${r.w} × ${r.h} mm, ${r.pages} page`);

// 2. Print settings → Thermal receipt → Print a test receipt
await p.goto(B + '/app/print-settings'); await p.getByRole('button', { name: 'Thermal receipt' }).click(); await p.waitForTimeout(300);
await p.getByRole('button', { name: /Print a test receipt/ }).click(); await p.waitForTimeout(200);
r = await asPrinted('test-receipt');
ok(r.pages === 1 && /TOTAL/.test(r.text) && (near(r.w, 80) || near(r.w, 58)), `test receipt is not blank: ${r.w} × ${r.h} mm, ${r.pages} page, text present`);

// 3. An invoice printed as a receipt (Invoice → Print → receipt 80mm)
const invs = await (await p.request.get(B + '/api/shop/invoices', { headers: { 'x-requested-with': 'ledgerly' } })).json();
const inv = (Array.isArray(invs) ? invs : invs.rows ?? invs.items).find((i) => i.status !== 'Draft');
await p.goto(`${B}/invoices/${inv.id}/print?paper=thermal&roll=3in`); await p.waitForSelector('.receipt'); await p.waitForTimeout(400);
await p.evaluate(() => window.dispatchEvent(new Event('beforeprint')));
r = await asPrinted('invoice-receipt');
ok(near(r.w, 80) && r.pages === 1 && /TOTAL/.test(r.text), `invoice receipt view: ${r.w} × ${r.h} mm, ${r.pages} page`);

// 4. Barcode labels on a 50 × 25 mm, 2-up roll
const items = await (await p.request.get(B + '/api/shop/items', { headers: { 'x-requested-with': 'ledgerly' } })).json();
const coded = items.filter((i) => i.barcode).slice(0, 2);
await p.goto(`${B}/app/items/labels?ids=${coded.map((i) => i.id).join(',')}`); await p.waitForSelector('.ls-sheets .lv');
await p.getByRole('button', { name: /^Print labels/ }).click(); await p.waitForTimeout(200);
r = await asPrinted('labels');
ok(Math.abs(r.w - 102) < 1 && Math.abs(r.h - 25) < 1, `labels: ${r.w} × ${r.h} mm pages (two 50 mm labels + 2 mm gap), ${r.pages} rows`);
for (const f of ['pos-80mm', 'test-receipt', 'labels']) execFileSync('pdftoppm', ['-png', '-r', '110', '-f', '1', '-l', '1', `${out}/${f}.pdf`, `${out}/${f}`]);
await b.close();
