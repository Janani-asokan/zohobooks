// Does every barcode print correctly? For each roll size × kind of code, both ways a label reaches the printer:
//  - PRINT WINDOW: the print page as a PDF at the label size, rasterised at 203 dpi (what the driver does);
//  - DIRECT: the exact dots the PC print helper / phone app send (“As the printer sees it”).
// Each label on the row is cut out and scanned; it must read back as the item's code.
// Usage: BASE=http://localhost:4000 node e2e/tools/barcode-scan-matrix.mjs <outDir>
import { chromium } from 'playwright';
console.warn = () => {}; // zxing logs every miss
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import zx from '@zxing/library';
const { MultiFormatReader, BinaryBitmap, HybridBinarizer, RGBLuminanceSource, DecodeHintType } = zx;
const B = process.env.BASE ?? 'http://localhost:4000';
const out = process.argv[2] ?? '.'; fs.mkdirSync(out, { recursive: true });
let fails = 0; const ok = (c, m, why = '') => { console.log(`${c ? 'PASS' : 'FAIL'} ${m}${!c && why ? ` (${why})` : ''}`); if (!c) { fails++; process.exitCode = 1; } };
// Roll presets: label w, h, across, side margin, gap between labels (as shared/labelEngine.ts).
const STOCKS = [
  ['3in-38x25x2', 38, 25, 2, 1, 2], ['50x25x1', 50, 25, 1, 1, 0], ['3in-75x25', 75, 25, 1, 1.5, 0], ['3in-75x38', 75, 38, 1, 1.5, 0],
  ['3in-75x50', 75, 50, 1, 1.5, 0], ['4in-50x25x2', 50, 25, 2, 1, 2], ['4in-33x25x3', 33, 25, 3, 0.5, 2], ['4in-25x25x4', 25, 25, 4, 0.5, 1],
  ['4in-100x50', 100, 50, 1, 2, 0], ['4in-100x100', 100, 100, 1, 2, 0],
];
const DPM = 8; // 203 dpi
const scan = (lum, w, h) => {
  for (const pure of [false, true]) {
    try { const r = new MultiFormatReader(); const hints = new Map([[DecodeHintType.TRY_HARDER, true]]); if (pure) hints.set(DecodeHintType.PURE_BARCODE, true); r.setHints(hints); return r.decode(new BinaryBitmap(new HybridBinarizer(new RGBLuminanceSource(lum, w, h)))).getText(); } catch { /* next */ }
  }
  return null;
};
const crop = (img, W, x0, x1, H) => { const w = x1 - x0; const o = new Uint8ClampedArray(w * H); for (let y = 0; y < H; y++) for (let x = 0; x < w; x++) o[y * w + x] = img[y * W + x0 + x]; return { lum: o, w }; };
const pgm = (file) => { const b = fs.readFileSync(file); let i = 0; const tok = () => { while (/\s/.test(String.fromCharCode(b[i]))) i++; let s = ''; while (!/\s/.test(String.fromCharCode(b[i]))) s += String.fromCharCode(b[i++]); return s; }; tok(); const w = Number(tok()), h = Number(tok()); tok(); i++; return { w, h, data: new Uint8ClampedArray(b.subarray(i, i + w * h)) }; };

const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1366, height: 900 } });
await ctx.addInitScript(() => { window.print = () => { document.querySelectorAll('style').forEach((s) => { if (s.textContent.includes('@page')) { const c = s.cloneNode(true); c.dataset.keep = '1'; document.head.appendChild(c); } }); window.__pc = document.body.className; window.__printed = (window.__printed ?? 0) + 1; }; });
const p = await ctx.newPage();
const errs = []; p.on('pageerror', (e) => errs.push(e.message));
try {
  await p.goto(B + '/login'); await p.fill('input[type=email]', 'owner@shop.com'); await p.fill('input[type=password]', 'owner123'); await p.keyboard.press('Enter'); await p.waitForURL(/\/app/);
  const items = await p.evaluate(async () => {
    const good = (d) => { let t = 0; for (let i = 0; i < 12; i++) t += Number(d[11 - i]) * (i % 2 === 0 ? 3 : 1); return (10 - (t % 10)) % 10 === Number(d[12]); };
    const all = (await (await fetch('/api/shop/items')).json()).filter((i) => i.type === 'Goods');
    const code = (i) => i.barcode || i.sku;
    return {
      'EAN-13': all.find((i) => /^\d{13}$/.test(i.barcode ?? '') && good(i.barcode)),
      'shop code': all.find((i) => /^[A-Z]\d{6}-\d{4}$/.test(code(i) ?? '')),
      'long code': all.filter((i) => code(i) && !/^\d{13}$/.test(code(i)) && !/^[A-Z]\d{6}-\d{4}$/.test(code(i))).sort((a, b) => code(b).length - code(a).length)[0],
    };
  });
  for (const [kind, it] of Object.entries(items)) console.log(`# ${kind}: ${it?.name} = ${it?.barcode || it?.sku}`);
  for (const [id, w, h, across, mL, gut] of STOCKS) {
    for (const [kind, it] of Object.entries(items)) {
      if (!it) continue;
      const cur = await p.evaluate(async (iid) => (await (await fetch('/api/shop/items')).json()).find((i) => i.id === iid), it.id);
      const want = cur.barcode || cur.sku;
      await p.evaluate((sid) => { localStorage.setItem('c360.labels.device', JSON.stringify({ stockId: `preset:${sid}` })); localStorage.removeItem('c360.labels.direct'); }, id);
      await p.goto(B + `/app/items/labels?ids=${it.id}&qty=${across}`); await p.waitForSelector('.lb-lines li', { timeout: 15000 }).catch(async (e) => { await p.screenshot({ path: `${out}/stuck-${id}.png`, fullPage: true }); throw e; }); await p.waitForTimeout(400);
      let want2 = want;
      if (await p.getByRole('button', { name: /^Print labels/ }).isDisabled()) {
        const why = await p.getByTestId('why-no-print').innerText().catch(() => '');
        const fix = p.getByTestId('why-no-print').getByRole('button', { name: /short barcode that fits/ });
        if (!(await fix.count())) { ok(false, `${id} · ${kind}: can't print and no fix offered`, why); continue; }
        // The one-tap fix: a short barcode; the old code stays as an alias.
        p.once('dialog', (d) => void d.accept());
        await fix.click();
        await p.waitForFunction(() => !document.querySelector('[data-testid=why-no-print]'), null, { timeout: 15000 });
        const now = await p.evaluate(async (iid) => (await (await fetch('/api/shop/items')).json()).find((i) => i.id === iid), it.id);
        want2 = now.barcode;
        ok(/too long/.test(why) && /^2\d{12}$/.test(want2) && (now.aliases ?? []).includes(want), `${id} · ${kind}: “${want}” is too long for ${w} mm; one tap gives it the short code ${want2}, and “${want}” still scans at the counter`, `${why} → ${want2}, aliases ${JSON.stringify(now.aliases)}`);
        await p.waitForTimeout(400);
      }
      const slots = Array.from({ length: across }, (_, i) => [Math.round((mL + i * (w + gut)) * DPM), Math.round((mL + i * (w + gut) + w) * DPM)]);
      // DIRECT: the printer's own dots.
      await p.getByLabel(/As the printer sees it/).check();
      await p.waitForSelector('.lb-mono-img', { timeout: 15000 });
      const dots = await p.evaluate(async () => { const im = new Image(); im.src = document.querySelector('.lb-mono-img').src; await im.decode(); const c = document.createElement('canvas'); c.width = im.width; c.height = im.height; c.getContext('2d').drawImage(im, 0, 0); return { w: im.width, h: im.height, d: Array.from(c.getContext('2d').getImageData(0, 0, im.width, im.height).data.filter((_, i) => i % 4 === 0)) }; });
      const dimg = Uint8ClampedArray.from(dots.d);
      const direct = slots.map(([a, z]) => { const c = crop(dimg, dots.w, a, z, dots.h); return scan(c.lum, c.w, dots.h); });
      await p.getByLabel(/As the printer sees it/).uncheck();
      // PRINT WINDOW: PDF at the label row size (the driver's label stock), rasterised at 203 dpi.
      await p.evaluate(() => { window.__printed = 0; });
      await p.getByRole('button', { name: /^Test print/ }).click();
      await p.waitForFunction(() => window.__printed > 0);
      await p.evaluate(() => { document.body.className = window.__pc; });
      await p.emulateMedia({ media: 'print' });
      await p.evaluate(() => {
        const kept = [...document.querySelectorAll('style[data-keep]')].map((x) => x.textContent).join('');
        const r = document.querySelector('#print-root .label-row')?.getBoundingClientRect();
        if (/size\s*:/.test(kept) || !r) return;
        const st = document.createElement('style'); st.dataset.keep = '1'; st.textContent = `@page { size: ${(r.width * 25.4 / 96).toFixed(2)}mm ${(r.height * 25.4 / 96).toFixed(2)}mm; }`; document.head.appendChild(st);
      });
      const pdf = `${out}/${id}-${kind.replace(/\W+/g, '')}.pdf`;
      fs.writeFileSync(pdf, await p.pdf({ preferCSSPageSize: true, printBackground: true }));
      await p.emulateMedia({ media: 'screen' });
      await p.evaluate(() => { document.querySelectorAll('style[data-keep]').forEach((s) => s.remove()); document.getElementById('print-root')?.remove(); document.body.classList.remove('printing', 'print-labels'); });
      execFileSync('pdftoppm', ['-gray', '-r', '203', '-f', '1', '-l', '1', '-singlefile', pdf, pdf.replace(/\.pdf$/, '')]);
      const pg = pgm(pdf.replace(/\.pdf$/, '.pgm'));
      const pslots = slots.map(([a, z]) => [Math.round(a * pg.w / dots.w), Math.round(z * pg.w / dots.w)]);
      const viaPdf = pslots.map(([a, z]) => { const c = crop(pg.data, pg.w, a, Math.min(z, pg.w), pg.h); return scan(c.lum, c.w, pg.h); });
      const dOk = direct.every((c) => c === want2), pOk = viaPdf.every((c) => c === want2);
      ok(dOk && pOk, `${id} · ${kind}: direct ${direct.filter((c) => c === want2).length}/${across}, print window ${viaPdf.filter((c) => c === want2).length}/${across} scan as ${want2}`, `direct ${JSON.stringify(direct)} pdf ${JSON.stringify(viaPdf)}`);
    }
  }
} catch (e) { ok(false, 'script crashed', e.stack); }
finally { ok(errs.length === 0, 'no page errors', errs.slice(0, 2).join(' | ')); console.log(fails ? `${fails} failed` : 'all scanned'); await b.close(); await p.evaluate?.(() => {}).catch(() => {}); }
