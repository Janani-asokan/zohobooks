// A receipt always prints on ONE slip, also on a counter PC where it prints a little taller than it measures on
// screen. Real Chrome sizes the page from the screen layout (beforeprint fires before the switch to print layout);
// Windows fonts then print slightly wider (a long line wraps once more) and some printers keep a few mm at the top and
// bottom. That pushed the footer onto a second slip. This test sizes the page from the screen layout, as real
// printing does, then prints with those Windows-like differences, for a POS sale (two items and a long footer) printed
// from POS and from the invoice, on 58 mm and 80 mm rolls.
// Usage: BASE=http://localhost:4000 node e2e/tools/receipt-one-page.mjs <outDir>
import { chromium } from 'playwright';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
const B = process.env.BASE ?? 'http://localhost:4000';
const out = process.argv[2] ?? '.'; fs.mkdirSync(out, { recursive: true });
const ok = (c, m, why = '') => { console.log(`${c ? 'PASS' : 'FAIL'} ${m}${!c && why ? ` (${why})` : ''}`); if (!c) process.exitCode = 1; };
const mm = (pt) => Math.round((pt / 72) * 25.4 * 10) / 10;
const info = (f) => { const t = execFileSync('pdfinfo', [f]).toString(); const [, w, h] = t.match(/Page size:\s+([\d.]+) x ([\d.]+)/); return { w: mm(+w), h: mm(+h), pages: +t.match(/Pages:\s+(\d+)/)[1], text: execFileSync('pdftotext', ['-layout', f, '-']).toString() }; };
// How a Windows counter PC prints compared with the screen: ~5% wider text, ~3.5% taller lines, 3 mm kept by the printer.
const WINDOWS = '@media print { .receipt { letter-spacing: .25px; line-height: 1.5 !important; } body { padding: 3mm 0 !important; } }';
const FOOTER = 'Thank you My Dear customer visit again';
const errs = [];
const b = await chromium.launch();
let restore = null; let call = null;
try {
  const p = await (await b.newContext({ viewport: { width: 1366, height: 800 } })).newPage();
  p.on('pageerror', (e) => errs.push(e.message));
  // In-app printing: keep the @page rule the app set at the click (measured on screen), as the printer gets it.
  await p.addInitScript(() => { window.print = () => { document.querySelectorAll('style').forEach((s) => { if (s.textContent.includes('@page')) { const c = s.cloneNode(true); c.dataset.keep = '1'; document.head.appendChild(c); } }); window.__pc = document.body.className; window.__printed = 1; }; });
  const pdf = async (name) => {
    await p.addStyleTag({ content: WINDOWS });
    await p.emulateMedia({ media: 'print' }); const f = `${out}/${name}.pdf`; fs.writeFileSync(f, await p.pdf({ preferCSSPageSize: true, printBackground: true })); await p.emulateMedia({ media: 'screen' });
    return info(f);
  };
  await p.goto(B + '/login'); await p.fill('input[type=email]', 'owner@shop.com'); await p.fill('input[type=password]', 'owner123'); await p.keyboard.press('Enter'); await p.waitForURL(/\/app/);
  call = (m, u, d) => p.evaluate(async ([m, u, d]) => { const r = await fetch('/api' + u, { method: m, headers: { 'x-requested-with': 'ledgerly', 'content-type': 'application/json' }, body: d ? JSON.stringify(d) : undefined }); return r.json(); }, [m, u, d]);
  restore = await call('GET', '/shop/print-settings');
  for (const roll of ['2in', '3in']) {
    const full = roll === '2in' ? 58 : 80;
    await call('PUT', '/shop/print-settings', { ...restore, thermal: { ...restore.thermal, paper: roll, footer: FOOTER, theme: 'compact' } });
    // A two-item POS sale, printed from POS
    const items = (await call('GET', '/shop/items')).filter((i) => i.type === 'Goods' && !i.trackSerials && i.stock > 2).slice(0, 2);
    await p.goto(B + '/app/pos'); await p.waitForSelector('.pos-tile');
    for (const it of items) await p.locator('.pos-tile', { has: p.locator('.n', { hasText: it.name }) }).first().click();
    await p.getByRole('button', { name: /^Charge/ }).first().click(); await p.waitForSelector('text=Sale complete');
    await p.waitForTimeout(400);
    await p.getByRole('button', { name: /Print receipt/ }).click();
    await p.waitForFunction(() => window.__printed); await p.evaluate(() => { document.body.className = window.__pc; });
    let r = await pdf(`pos-${roll}`);
    ok(Math.abs(r.w - full) < 1 && r.pages === 1 && /visit\s+again/.test(r.text), `POS receipt, ${full} mm: ${r.w} × ${r.h} mm, ${r.pages} page, footer on it`);
    await p.evaluate(() => { document.querySelectorAll('style[data-keep]').forEach((s) => s.remove()); document.getElementById('print-root')?.remove(); document.body.classList.remove('printing', 'print-receipt'); window.__printed = 0; });
    await p.evaluate(() => Object.keys(localStorage).filter((x) => x.startsWith('c360.pos.')).forEach((x) => localStorage.removeItem(x)));
    // The same bill from the invoice (print view)
    const inv = await call('GET', '/shop/invoices'); const one = (Array.isArray(inv) ? inv : inv.rows ?? inv.items)[0];
    await p.goto(`${B}/invoices/${one.id}/print?paper=thermal&roll=${roll}`); await p.waitForSelector('.receipt'); await p.waitForTimeout(300);
    await p.evaluate(() => window.dispatchEvent(new Event('beforeprint'))); // sized from the screen layout, as real printing does
    await p.evaluate(() => { const st = document.querySelector('style[data-print=page]'); const c = document.createElement('style'); c.textContent = st.textContent; document.head.appendChild(c); st.media = 'not all'; });
    r = await pdf(`invoice-${roll}`);
    ok(Math.abs(r.w - full) < 1 && r.pages === 1 && /visit\s+again/.test(r.text), `invoice receipt, ${full} mm: ${r.w} × ${r.h} mm, ${r.pages} page, footer on it`);
    if (roll === '2in') execFileSync('pdftoppm', ['-png', '-r', '150', `${out}/invoice-${roll}.pdf`, `${out}/invoice-${roll}`]);
  }
} catch (e) { ok(false, 'script crashed', e.stack); }
finally {
  if (restore && call) await call('PUT', '/shop/print-settings', restore).catch(() => {});
  ok(errs.length === 0, 'no page errors', errs.slice(0, 3).join(' | '));
  await b.close();
}
