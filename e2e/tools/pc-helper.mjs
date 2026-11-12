// The Corpus360 Print Helper (website on a Windows PC → label printer, RAW, no Windows paper size).
// Runs the helper's own server code (non-Windows build: jobs are written to files) and checks, in the browser:
//  - without the helper: "Straight to the printer" shows the install card and the .exe downloads;
//  - with it: the label printer is found and picked, Test print sends TSPL with the exact label size (SIZE 80 mm,25 mm
//    for 2-up 38 × 25), the rows are upright bitmaps at 203 dpi and the barcode scans; no print window opens;
//  - another website can't print through it.
// Usage: BASE=http://localhost:4000 node e2e/tools/pc-helper.mjs <outDir>   (needs: npm run build:helper, Go)
import { chromium } from 'playwright';
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zx from '@zxing/library';
const { MultiFormatReader, BinaryBitmap, HybridBinarizer, RGBLuminanceSource, DecodeHintType } = zx;
const B = process.env.BASE ?? 'http://localhost:4000';
const out = process.argv[2] ?? '.'; fs.mkdirSync(out, { recursive: true });
const ok = (c, m, why = '') => { console.log(`${c ? 'PASS' : 'FAIL'} ${m}${!c && why ? ` (${why})` : ''}`); if (!c) process.exitCode = 1; };
const errs = [];
const spool = fs.mkdtempSync(path.join(os.tmpdir(), 'c360-spool-'));
const bin = path.join(os.tmpdir(), 'c360-helper-test');
execFileSync('go', ['build', '-o', bin, '.'], { cwd: 'tools/print-helper' });
let helper = null;
const startHelper = async () => {
  helper = spawn(bin, ['--quiet'], { env: { ...process.env, C360_FAKE_PRINTERS: 'Microsoft Print to PDF,Bar Code Printer TT065-50,HP LaserJet', C360_SPOOL_DIR: spool }, stdio: 'ignore' });
  for (let i = 0; i < 50; i++) { try { if ((await fetch('http://127.0.0.1:17361/status')).ok) return; } catch { /* starting */ } await new Promise((r) => setTimeout(r, 100)); }
  throw new Error('helper did not start');
};
const b = await chromium.launch();
try {
  const ctx = await b.newContext({ viewport: { width: 1366, height: 900 }, acceptDownloads: true });
  await ctx.addInitScript(() => { window.__printWindow = 0; window.print = () => { window.__printWindow++; }; });
  const p = await ctx.newPage(); p.on('pageerror', (e) => errs.push(e.message));
  p.on('console', (m) => { if (m.type() === 'error' && /Content Security Policy/.test(m.text())) errs.push(m.text()); });
  await p.goto(B + '/login'); await p.fill('input[type=email]', 'owner@shop.com'); await p.fill('input[type=password]', 'owner123'); await p.keyboard.press('Enter');
  await p.waitForURL(/\/app/);
  const ean = await p.evaluate(async () => {
    const good = (d) => { let t = 0; for (let i = 0; i < 12; i++) t += Number(d[11 - i]) * (i % 2 === 0 ? 3 : 1); return (10 - (t % 10)) % 10 === Number(d[12]); };
    return (await (await fetch('/api/shop/items')).json()).find((i) => i.type === 'Goods' && /^\d{13}$/.test(i.barcode ?? '') && good(i.barcode));
  });
  await p.evaluate(() => localStorage.setItem('c360.labels.device', JSON.stringify({ stockId: 'preset:3in-38x25x2' })));
  await p.goto(B + `/app/items/labels?ids=${ean.id}&qty=2`); await p.waitForSelector('#ls-preset', { state: 'attached' }); await p.waitForTimeout(1200);

  /* No helper yet */
  await p.getByRole('radio', { name: /Straight to the printer/ }).click();
  await p.getByTestId('helper-install').waitFor({ timeout: 8000 });
  ok(true, 'without the helper: “Straight to the printer” shows how to install it');
  const dl = p.waitForEvent('download');
  await p.getByRole('link', { name: /Download Corpus360PrintHelper\.exe/ }).click();
  const file = await (await dl).path();
  const head = fs.readFileSync(file).subarray(0, 2).toString('latin1');
  ok(head === 'MZ' && fs.statSync(file).size > 1e6, `the download is the Windows program (${(fs.statSync(file).size / 1e6).toFixed(1)} MB, starts “MZ”)`);
  await p.screenshot({ path: `${out}/helper-install.png`, fullPage: true });

  /* Helper running */
  await startHelper();
  await p.getByRole('button', { name: /Check again/ }).click();
  await p.getByTestId('helper-ready').waitFor({ timeout: 8000 });
  ok(await p.getByLabel('Label printer').inputValue() === 'Bar Code Printer TT065-50', 'the label printer is picked from the PC’s printers (not “Print to PDF” or the laser)', await p.getByLabel('Label printer').inputValue());
  await p.getByRole('button', { name: 'Use this printer' }).click();
  ok(await p.getByTestId('paper-hint').count() === 0, 'straight to the printer: no Windows paper size to set');
  await p.getByRole('button', { name: /^Test print/ }).click();
  for (let i = 0; i < 100 && !fs.existsSync(path.join(spool, 'job-001.bin')); i++) await new Promise((r) => setTimeout(r, 100));
  const job = fs.readFileSync(path.join(spool, 'job-001.bin'));
  ok(fs.readFileSync(path.join(spool, 'job-001.bin.txt'), 'utf8').startsWith('Bar Code Printer TT065-50'), 'the job went to Bar Code Printer TT065-50');
  const text = job.subarray(0, 160).toString('latin1');
  ok(text.startsWith('SIZE 80 mm,25 mm\r\nGAP 3 mm,0 mm\r\nDIRECTION 1,0'), 'the printer is told the exact label: SIZE 80 mm,25 mm, GAP 3 mm, upright', text.split('\r\n').slice(0, 3).join(' | '));
  ok(await p.evaluate(() => window.__printWindow) === 0, 'no print window (no A4, nothing to choose)');
  // Bitmap → luminance → scan the left label.
  const at = job.indexOf('BITMAP 0,0,'); const m = job.subarray(at, at + 40).toString('latin1').match(/BITMAP 0,0,(\d+),(\d+),0,/);
  const bpr = Number(m[1]), h = Number(m[2]), w = bpr * 8, start = at + m[0].length;
  ok(w === 640 && h === 200, `one row is ${w} × ${h} dots (80 × 25 mm at 203 dpi)`);
  const half = w / 2; const lum = new Uint8ClampedArray(half * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < half; x++) lum[y * half + x] = job[start + y * bpr + (x >> 3)] & (0x80 >> (x & 7)) ? 255 : 0; // TSPL: 1 = white
  let code = null;
  try { const r = new MultiFormatReader(); r.setHints(new Map([[DecodeHintType.TRY_HARDER, true]])); code = r.decode(new BinaryBitmap(new HybridBinarizer(new RGBLuminanceSource(lum, half, h)))).getText(); } catch { /* none */ }
  ok(code === ean.barcode, `the printed barcode scans: ${code}`);
  await p.screenshot({ path: `${out}/helper-ready.png`, fullPage: true });
  // Reload: the choice is remembered on this computer.
  await p.reload(); await p.waitForSelector('#ls-preset', { state: 'attached' }); await p.waitForTimeout(1500);
  ok(/Bar Code Printer TT065-50/.test(await p.getByTestId('label-direct').innerText()), 'after a reload this computer still prints straight to the label printer');

  /* Another website can't use it */
  const evil = await fetch('http://127.0.0.1:17361/print', { method: 'POST', headers: { Origin: 'https://evil.example', 'Content-Type': 'application/json' }, body: JSON.stringify({ printer: 'Bar Code Printer TT065-50', data: 'U0laRQ==' }) });
  ok(evil.status === 403 && !fs.existsSync(path.join(spool, 'job-002.bin')), 'another website is refused (403) and nothing prints');

  /* Helper stopped */
  helper.kill(); await new Promise((r) => setTimeout(r, 300));
  await p.getByRole('button', { name: /^Test print/ }).click();
  await p.waitForTimeout(1500);
  ok(/Print Helper is not running/.test(await p.locator('body').innerText()), 'helper stopped: a clear message says to start it');
  await p.evaluate(() => { localStorage.removeItem('c360.labels.direct'); localStorage.removeItem('c360.labels.device'); });
} catch (e) { ok(false, 'script crashed', e.stack); }
finally { helper?.kill(); ok(errs.length === 0, 'no page errors or blocked requests', errs.slice(0, 3).join(' | ')); await b.close(); }
