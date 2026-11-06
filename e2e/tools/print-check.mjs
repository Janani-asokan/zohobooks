// The one-time "How did it come out?" printer check, as a shop owner meets it. Nobody sets a turn or a width by hand:
// - Labels: first print of a size on this computer → the question → "Sideways" turns them for this printer and
//   offers a test row (sent turned, 50 × 104 mm) → "Right way up" → never asked again, and the turn is remembered
//   after a reload. "Upside down" turns a label 180°.
// - Receipts: first receipt → the question → "Small or squeezed" switches this printer to the 48 / 72 mm print width
//   and prints again (the page really is narrower) → "Looks right" → never asked again. Still small after that → the
//   Windows paper-size steps. The shop's settings are not changed (it is this computer's printer).
// Usage: BASE=http://localhost:4000 node e2e/tools/print-check.mjs <outDir>
import { chromium } from 'playwright';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
const B = process.env.BASE ?? 'http://localhost:4000';
const out = process.argv[2] ?? '.'; fs.mkdirSync(out, { recursive: true });
const ok = (c, m, why = '') => { console.log(`${c ? 'PASS' : 'FAIL'} ${m}${!c && why ? ` (${why})` : ''}`); if (!c) process.exitCode = 1; };
const mm = (pt) => Math.round((pt / 72) * 25.4 * 10) / 10; const near = (a, b) => Math.abs(a - b) < 0.6;
const info = (f) => { const t = execFileSync('pdfinfo', [f]).toString(); const [, w, h] = t.match(/Page size:\s+([\d.]+) x ([\d.]+)/); return { w: mm(+w), h: mm(+h) }; };
const errs = [];
const b = await chromium.launch();
try {
  const p = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  p.on('pageerror', (e) => errs.push(e.message));
  await p.addInitScript(() => { window.print = () => { document.querySelectorAll('style').forEach((s) => { if (s.textContent.includes('@page')) { const c = s.cloneNode(true); c.dataset.keep = '1'; document.head.appendChild(c); } }); window.__pc = document.body.className; window.__printed = (window.__printed ?? 0) + 1; }; });
  const asPrinted = async (name) => {
    await p.waitForFunction(() => window.__printed > 0);
    await p.evaluate(() => { document.body.className = window.__pc; });
    await p.emulateMedia({ media: 'print' }); const f = `${out}/${name}.pdf`; fs.writeFileSync(f, await p.pdf({ preferCSSPageSize: true, printBackground: true })); await p.emulateMedia({ media: 'screen' });
    await p.evaluate(() => { document.querySelectorAll('style[data-keep]').forEach((s) => s.remove()); document.getElementById('print-root')?.remove(); document.body.classList.remove('printing', 'print-labels', 'print-receipt'); window.__printed = 0; });
    return info(f);
  };
  const card = (name) => p.getByRole('region', { name });
  await p.goto(B + '/login'); await p.fill('input[type=email]', 'owner@shop.com'); await p.fill('input[type=password]', 'owner123'); await p.keyboard.press('Enter'); await p.waitForURL(/\/app/);
  const call = (m, u, d) => p.evaluate(async ([m, u, d]) => { const r = await fetch('/api' + u, { method: m, headers: { 'x-requested-with': 'ledgerly', 'content-type': 'application/json' }, body: d ? JSON.stringify(d) : undefined }); return r.json(); }, [m, u, d]);
  const before = await call('GET', '/shop/print-settings');
  const item = (await call('GET', '/shop/items')).find((i) => i.barcode && i.type === 'Goods');

  /* Labels */
  await p.goto(`${B}/app/items/labels?ids=${item.id}`); await p.waitForSelector('.blabel');
  await p.locator('#ls-preset').selectOption({ label: '100x50 · 1 across · 4 inch roll' });
  await p.getByRole('button', { name: 'Print labels' }).click();
  let r = await asPrinted('l1');
  ok(near(r.w, 104) && near(r.h, 50), `first print as designed: ${r.w} × ${r.h} mm`);
  const ask = card('Quick check, only once for this label size');
  await ask.waitFor({ timeout: 5000 });
  ok(await ask.getByText('How did the labels come out of the printer?').isVisible(), 'after the first print: “How did the labels come out?”');
  await p.screenshot({ path: `${out}/label-ask.png` });
  await ask.getByRole('button', { name: /Sideways/ }).click();
  await ask.getByRole('button', { name: 'Test print one row' }).click();
  r = await asPrinted('l2');
  ok(near(r.w, 50) && near(r.h, 104), `“Sideways” → turned for this printer, test row sent as ${r.w} × ${r.h} mm`);
  await ask.waitFor({ timeout: 5000 });
  await ask.getByRole('button', { name: /Right way up/ }).click();
  ok(await card('Label printer is set up').isVisible(), '“Right way up” → set up, won’t ask again');
  await p.reload(); await p.waitForSelector('.blabel');
  await p.locator('#ls-preset').selectOption({ label: '100x50 · 1 across · 4 inch roll' });
  ok(await p.getByRole('radio', { name: 'Turn 90°' }).getAttribute('aria-checked') === 'true' && /Checked on this computer/.test(await p.locator('.ls-panel').last().innerText()), 'after a reload this computer still turns 100 × 50 labels 90°');
  await p.getByRole('button', { name: 'Print labels' }).click();
  r = await asPrinted('l3'); await p.waitForTimeout(1800);
  ok(near(r.w, 50) && await p.getByRole('region', { name: /Quick check/ }).count() === 0, 'next print: turned, and no question');
  // Another size: upside down → 180°
  await p.locator('#ls-preset').selectOption({ label: '50x25 · 2 across · 4 inch roll' });
  await p.getByRole('button', { name: 'Print labels' }).click(); await asPrinted('l4');
  await ask.waitFor({ timeout: 5000 });
  await ask.getByRole('button', { name: /Upside down/ }).click();
  ok(await p.getByRole('radio', { name: 'Turn 180°' }).getAttribute('aria-checked') === 'true', '“Upside down” on 50 × 25 → turned 180° (100 × 50 keeps its own 90°)');
  await ask.getByRole('button', { name: 'Test print one row' }).click(); r = await asPrinted('l5');
  ok(near(r.w, 102) || near(r.w, 104), `180° keeps the page size: ${r.w} × ${r.h} mm`);
  await ask.waitFor({ timeout: 5000 }); await ask.getByRole('button', { name: /Too small/ }).click();
  ok(/Paper size/.test(await ask.innerText()) && /\d+ × 25 mm/.test(await ask.innerText()), '“Too small” → the Windows paper-size steps, with the exact label size');
  await ask.getByRole('button', { name: 'Close' }).click();

  /* Receipts */
  await p.goto(B + '/app/print-settings?tab=thermal'); await p.waitForTimeout(800);
  const paper = before.thermal.paper; const full = paper === '2in' ? 58 : 80, narrow = paper === '2in' ? 48 : 72;
  await p.getByRole('button', { name: 'Print a test receipt' }).click();
  r = await asPrinted('r1');
  ok(near(r.w, full), `first receipt on the full ${full} mm roll: ${r.w} mm`);
  const rc = card('Quick check, only this once');
  await rc.waitFor({ timeout: 5000 });
  ok(await rc.getByText(`How did the ${full} mm receipt come out of the printer?`).isVisible(), 'after the first receipt: “How did it come out?”');
  await p.screenshot({ path: `${out}/receipt-ask.png` });
  await rc.getByRole('button', { name: /Small or squeezed/ }).click();
  ok(/Fixed for this printer/.test(await rc.innerText()), '“Small or squeezed” → fixed for this printer');
  await rc.getByRole('button', { name: 'Print again' }).click();
  r = await asPrinted('r2');
  ok(near(r.w, narrow), `printed again at the ${narrow} mm print width: ${r.w} mm`);
  await rc.waitFor({ timeout: 5000 });
  await rc.getByRole('button', { name: /Small or squeezed/ }).click();
  ok(/Printing preferences/.test(await rc.innerText()) && /Paper size/.test(await rc.innerText()), 'still small → the Windows paper-size steps (the one thing a web page can’t change)');
  await rc.getByRole('button', { name: 'Done, print again' }).click();
  r = await asPrinted('r3');
  ok(near(r.w, full), `after fixing Windows: back to the full ${full} mm roll (${r.w} mm)`);
  await rc.waitFor({ timeout: 5000 });
  await rc.getByRole('button', { name: /Looks right/ }).click();
  await p.waitForTimeout(2200);
  await p.getByRole('button', { name: 'Print a test receipt' }).click(); await asPrinted('r4'); await p.waitForTimeout(2000);
  ok(await p.getByRole('region', { name: /Quick check/ }).count() === 0, '“Looks right” → this computer is never asked again');
  ok(JSON.stringify(await call('GET', '/shop/print-settings')) === JSON.stringify(before), 'shop print settings untouched (the answers belong to this computer’s printer)');
  // A different computer (fresh browser) is asked again
  const p2 = await (await b.newContext()).newPage();
  await p2.goto(B + '/login'); await p2.fill('input[type=email]', 'owner@shop.com'); await p2.fill('input[type=password]', 'owner123'); await p2.keyboard.press('Enter'); await p2.waitForURL(/\/app/);
  await p2.addInitScript(() => { window.print = () => {}; });
  await p2.goto(B + '/app/print-settings?tab=thermal'); await p2.waitForTimeout(800);
  await p2.getByRole('button', { name: 'Print a test receipt' }).click();
  ok(await p2.getByRole('region', { name: 'Quick check, only this once' }).waitFor({ timeout: 5000 }).then(() => true, () => false), 'another counter computer gets its own one-time question');
} catch (e) { ok(false, 'script crashed', e.stack); }
finally { ok(errs.length === 0, 'no page errors', errs.slice(0, 4).join(' | ')); await b.close(); }
