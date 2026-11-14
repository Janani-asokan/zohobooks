// TVS LP 46 Lite (TSPL, 203 dpi, 108 mm print width, 20–112 mm media): are labels printed correctly, horizontal and
// vertical? A small TSPL simulator draws each label from the exact bytes the app sends (SIZE, GAP, DIRECTION, BITMAP),
// for wide (horizontal) and tall (vertical) labels, at every turn (As shown, 90°, 180°, 270°), and checks:
//  - the printer is told a size it takes (20–112 mm wide, within the 108 mm head) and the picture fits the label;
//  - as shown: upright (business name above the barcode), centred across each label, inside the edges; it scans;
//  - turned: exactly the as-shown label turned by that angle, with the size swapped for 90° / 270°;
//  - the print window (Windows driver) gives the same label: page size, and the page drawn at 203 dpi matches.
// Usage: BASE=http://localhost:4000 node e2e/tools/tvs-lp46-orientation.mjs <outDir>   (needs Go for the helper)
import { chromium } from 'playwright';
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import zx from '@zxing/library';
console.warn = () => {};
const { MultiFormatReader, BinaryBitmap, HybridBinarizer, RGBLuminanceSource, DecodeHintType } = zx;
const B = process.env.BASE ?? 'http://localhost:4000';
const out = process.argv[2] ?? '.'; fs.mkdirSync(out, { recursive: true });
let fails = 0; const ok = (c, m, why = '') => { console.log(`${c ? 'PASS' : 'FAIL'} ${m}${!c && why ? ` (${why})` : ''}`); if (!c) { fails++; process.exitCode = 1; } };
const DPM = 8;
// [preset, label w, h, across, side margin, gap between labels, kind]
const STOCKS = [
  ['3in-38x25x2', 38, 25, 2, 1, 2, 'horizontal'], ['50x25x1', 50, 25, 1, 1, 0, 'horizontal'], ['3in-75x25', 75, 25, 1, 1.5, 0, 'horizontal'],
  ['3in-75x50', 75, 50, 1, 1.5, 0, 'horizontal'], ['4in-50x25x2', 50, 25, 2, 1, 2, 'horizontal'], ['4in-100x50', 100, 50, 1, 2, 0, 'horizontal'],
  ['3in-50x75', 50, 75, 1, 1, 0, 'vertical'], ['4in-100x150', 100, 150, 1, 2, 0, 'vertical'],
];
const TURNS = [0, 90, 180, 270];

/* ---------- TSPL simulator (TVS LP 46 Lite) ---------- */
function simulate(buf) {
  const s = buf.toString('latin1');
  const size = s.match(/SIZE ([\d.]+) mm,([\d.]+) mm/); const dir = Number((s.match(/DIRECTION (\d)/) ?? [0, 1])[1]);
  const W = Math.round(Number(size[1]) * DPM), H = Math.round(Number(size[2]) * DPM);
  const labels = []; let at = 0;
  while ((at = buf.indexOf('BITMAP ', at)) >= 0) {
    const m = buf.subarray(at, at + 60).toString('latin1').match(/^BITMAP (\d+),(\d+),(\d+),(\d+),(\d+),/);
    const [x, y, bpr, h] = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])]; const start = at + m[0].length;
    const img = new Uint8Array(W * H).fill(255); let clipped = false;
    for (let r = 0; r < h; r++) for (let c = 0; c < bpr * 8; c++) {
      const black = !(buf[start + r * bpr + (c >> 3)] & (0x80 >> (c & 7)));  // TSPL: 0 bit = dot
      if (!black) continue;
      const px = x + c, py = y + r;
      if (px >= W || py >= H) { clipped = true; continue; }
      img[py * W + px] = 0;
    }
    // DIRECTION 0 prints the picture turned 180° relative to DIRECTION 1 (how the label leaves the printer).
    labels.push({ img: dir === 0 ? rot(img, W, H, 180).img : img, W: dir === 0 ? W : W, H, clipped, bmpW: bpr * 8, bmpH: h });
    at = start + bpr * h;
  }
  return { mmW: Number(size[1]), mmH: Number(size[2]), dir, labels };
}
function rot(img, W, H, deg) {
  if (deg === 0) return { img, W, H };
  if (deg === 180) { const o = new Uint8Array(W * H); for (let i = 0; i < W * H; i++) o[W * H - 1 - i] = img[i]; return { img: o, W, H }; }
  const nW = H, nH = W, o = new Uint8Array(nW * nH);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const nx = deg === 90 ? H - 1 - y : y, ny = deg === 90 ? x : W - 1 - x; o[ny * nW + nx] = img[y * W + x]; }
  return { img: o, W: nW, H: nH };
}
// Same label, allowing 2 printer dots for text drawn by a different renderer: ink in one has ink within 2 dots in the other.
const near = (a, b) => {
  if (a.W !== b.W || a.H !== b.H) return 0;
  const has = (img, x, y) => { for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) { const X = x + dx, Y = y + dy; if (X >= 0 && Y >= 0 && X < a.W && Y < a.H && img[Y * a.W + X] < 128) return true; } return false; };
  let na = 0, ha = 0, nb = 0, hb = 0;
  for (let y = 0; y < a.H; y++) for (let x = 0; x < a.W; x++) {
    if (a.img[y * a.W + x] < 128) { na++; if (has(b.img, x, y)) ha++; }
    if (b.img[y * a.W + x] < 128) { nb++; if (has(a.img, x, y)) hb++; }
  }
  return Math.min(na ? ha / na : 1, nb ? hb / nb : 1);
};
const same = (a, b) => { if (a.W !== b.W || a.H !== b.H) return 0; let inter = 0, uni = 0; for (let i = 0; i < a.img.length; i++) { const p = a.img[i] < 128, q = b.img[i] < 128; if (p && q) inter++; if (p || q) uni++; } return uni ? inter / uni : 1; };
const png = (file, { img, W, H }) => {
  const raw = Buffer.alloc((W + 1) * H); for (let y = 0; y < H; y++) { raw[y * (W + 1)] = 0; for (let x = 0; x < W; x++) raw[y * (W + 1) + 1 + x] = img[y * W + x]; }
  const crc = (b) => { let c = ~0; for (const v of b) { c ^= v; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); } return ~c >>> 0; };
  const ch = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const h = Buffer.alloc(13); h.writeUInt32BE(W, 0); h.writeUInt32BE(H, 4); h[8] = 8; h[9] = 0;
  fs.writeFileSync(file, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), ch('IHDR', h), ch('IDAT', zlib.deflateSync(raw)), ch('IEND', Buffer.alloc(0))]));
};
const scan = (img, W, x0, x1, H) => {
  const w = x1 - x0, lum = new Uint8ClampedArray(w * H); for (let y = 0; y < H; y++) for (let x = 0; x < w; x++) lum[y * w + x] = img[y * W + x0 + x];
  try { const r = new MultiFormatReader(); r.setHints(new Map([[DecodeHintType.TRY_HARDER, true]])); return r.decode(new BinaryBitmap(new HybridBinarizer(new RGBLuminanceSource(lum, w, H)))).getText(); } catch { return null; }
};
// Ink box and the top of the barcode (rows with many black/white changes) inside one label slot.
function layout(img, W, H, x0, x1) {
  let top = H, bot = -1, left = W, right = -1, barTop = -1;
  for (let y = 0; y < H; y++) {
    let ink = false, tr = 0, prev = 255;
    for (let x = x0; x < x1; x++) { const v = img[y * W + x]; if (v < 128) { ink = true; if (x < left) left = x; if (x > right) right = x; } if ((v < 128) !== (prev < 128)) tr++; prev = v; }
    if (ink) { if (y < top) top = y; bot = y; }
    if (barTop < 0 && tr > 40) barTop = y;
  }
  return { top, bot, left, right, barTop };
}
const pgm = (file) => { const b = fs.readFileSync(file); let i = 0; const tok = () => { while (/\s/.test(String.fromCharCode(b[i]))) i++; let s = ''; while (!/\s/.test(String.fromCharCode(b[i]))) s += String.fromCharCode(b[i++]); return s; }; tok(); const w = Number(tok()), h = Number(tok()); tok(); i++; return { W: w, H: h, img: new Uint8Array(b.subarray(i, i + w * h)) }; };

/* ---------- the app, with the print helper as the PC's TVS LP 46 Lite ---------- */
const spool = fs.mkdtempSync(path.join(os.tmpdir(), 'tvs-spool-'));
const bin = path.join(os.tmpdir(), 'c360-helper-tvs');
execFileSync('go', ['build', '-o', bin, '.'], { cwd: 'tools/print-helper' });
const helper = spawn(bin, ['--quiet'], { env: { ...process.env, C360_FAKE_PRINTERS: 'TVS LP 46 Lite', C360_SPOOL_DIR: spool }, stdio: 'ignore' });
for (let i = 0; i < 50; i++) { try { if ((await fetch('http://127.0.0.1:17361/status')).ok) break; } catch { /* starting */ } await new Promise((r) => setTimeout(r, 100)); }
const jobs = () => fs.readdirSync(spool).filter((f) => f.endsWith('.bin')).sort();
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1366, height: 900 } });
await ctx.addInitScript(() => { window.print = () => { document.querySelectorAll('style').forEach((s) => { if (s.textContent.includes('@page')) { const c = s.cloneNode(true); c.dataset.keep = '1'; document.head.appendChild(c); } }); window.__pc = document.body.className; window.__printed = (window.__printed ?? 0) + 1; }; });
const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
try {
  await p.goto(B + '/login'); await p.fill('input[type=email]', 'owner@shop.com'); await p.fill('input[type=password]', 'owner123'); await p.keyboard.press('Enter'); await p.waitForURL(/\/app/);
  const it = await p.evaluate(async () => {
    const good = (d) => { let t = 0; for (let i = 0; i < 12; i++) t += Number(d[11 - i]) * (i % 2 === 0 ? 3 : 1); return (10 - (t % 10)) % 10 === Number(d[12]); };
    return (await (await fetch('/api/shop/items')).json()).find((i) => i.type === 'Goods' && /^\d{13}$/.test(i.barcode ?? '') && good(i.barcode) && i.sp1);
  });
  console.log(`# item: ${it.name} · ${it.barcode} · printer profile: TVS LP 46 Lite`);
  const open = async (stockId, direct, turn) => {
    await p.evaluate(([sid, d, t, w, h]) => {
      localStorage.setItem('c360.labels.device', JSON.stringify({ stockId: `preset:${sid}`, printerId: 'preset:tvs-lp46-lite' }));
      if (d) localStorage.setItem('c360.labels.direct', JSON.stringify({ kind: 'pc', printer: 'TVS LP 46 Lite' })); else localStorage.removeItem('c360.labels.direct');
      // This computer's turn for the label size (as the Turn buttons save it).
      const k = 'c360.printer'; const m = JSON.parse(localStorage.getItem(k) ?? '{}'); m.labels = { ...m.labels, [`${w}x${h}`]: { turn: t, ok: true } }; localStorage.setItem(k, JSON.stringify(m));
    }, [stockId[0], direct, turn, stockId[1], stockId[2]]);
    await p.goto(B + `/app/items/labels?ids=${it.id}&qty=${stockId[3]}&stock=${stockId[0]}`); await p.waitForSelector('.lb-lines li'); await p.waitForTimeout(500);
  };
  for (const st of STOCKS) {
    const [id, w, h, across, mL, gut, kind] = st;
    const rowW = Math.round((2 * mL + across * w + (across - 1) * gut) * 10) / 10;
    let base = null;
    for (const turn of TURNS) {
      const tag = `${id} (${kind}) · ${turn === 0 ? 'as shown' : `turn ${turn}°`}`;
      /* Straight to the printer */
      await open(st, true, turn);
      const shownTurn = await p.evaluate(() => [...document.querySelectorAll('[aria-label="Turn the label"] [role=radio]')].find((b) => b.getAttribute('aria-checked') === 'true')?.textContent);
      if (await p.getByRole('button', { name: /^Test print/ }).isDisabled()) {
        const why = await p.getByTestId('why-no-print').innerText().catch(() => '');
        ok((turn === 90 || turn === 270) && h > 108 && /wider than it prints/.test(why) && /As shown/.test(why), `${tag}: not printed — the screen says ${h} mm would be wider than the printer’s head, with a one-tap “As shown”`, `turn shown ${shownTurn}; ${why}`);
        continue;
      }
      const before = jobs().length;
      await p.getByRole('button', { name: /^Test print/ }).click();
      await p.waitForTimeout(300);
      for (let i = 0; i < 80 && jobs().length === before; i++) await p.waitForTimeout(100);
      if (jobs().length === before) {
        const msg = await p.locator('body').innerText();
        const tooWide = /wider than it prints/.test(msg);
        ok(tooWide && (turn === 90 || turn === 270) && h > 108, `${tag}: refused with a clear message (${h} mm across is wider than the 108 mm head)`, `turn shown ${shownTurn}; ${msg.match(/Turned[^\n]*/)?.[0] ?? 'no job, no message'}`);
        continue;
      }
      const sim = simulate(fs.readFileSync(path.join(spool, jobs().at(-1))));
      const L = sim.labels[0];
      const wantW = turn % 180 ? h : rowW, wantH = turn % 180 ? rowW : h;
      ok(Math.abs(sim.mmW - wantW) < 0.11 && Math.abs(sim.mmH - wantH) < 0.11 && sim.mmW >= 20 && sim.mmW <= 108 && !L.clipped && L.bmpW / DPM <= sim.mmW + 1 && L.bmpH === Math.round(wantH * DPM),
        `${tag}: printer told SIZE ${sim.mmW} × ${sim.mmH} mm (fits the 108 mm head), picture ${L.bmpW / DPM} × ${L.bmpH / DPM} mm, nothing cut off`, `want ${wantW} × ${wantH}; clipped ${L.clipped}; turn button "${shownTurn}"`);
      const img = { img: L.img, W: Math.round(sim.mmW * DPM), H: Math.round(sim.mmH * DPM) };
      png(`${out}/${id}-direct-${turn}.png`, img);
      if (turn === 0) {
        base = img;
        const slots = Array.from({ length: across }, (_, i) => [Math.round((mL + i * (w + gut)) * DPM), Math.round((mL + i * (w + gut) + w) * DPM)]);
        for (const [i, [a, z]] of slots.entries()) {
          const l = layout(img.img, img.W, img.H, a, z);
          const centreOff = ((l.left + l.right) / 2 - (a + z) / 2) / DPM;
          const code = scan(img.img, img.W, a, z, img.H);
          ok(code === it.barcode && l.top < l.barTop && Math.abs(centreOff) <= 1 && l.left - a >= 0.5 * DPM && z - 1 - l.right >= 0.5 * DPM && l.top >= 0.5 * DPM && img.H - 1 - l.bot >= 0.5 * DPM,
            `${tag}, label ${i + 1}: upright (name above barcode), centred across (${centreOff.toFixed(1)} mm off), inside the edges, scans`, `code ${code}; top ${l.top} barTop ${l.barTop}; left ${(l.left - a) / DPM} right ${(z - 1 - l.right) / DPM} top ${l.top / DPM} bottom ${(img.H - 1 - l.bot) / DPM} mm`);
        }
      } else if (base) {
        const iou = same(rot(base.img, base.W, base.H, turn), img);
        ok(iou > 0.99, `${tag}: exactly the as-shown label turned ${turn}° (match ${(iou * 100).toFixed(1)}%)`);
      }
      /* Print window (the Windows driver's page) */
      await open(st, false, turn);
      await p.evaluate(() => { window.__printed = 0; });
      await p.getByRole('button', { name: /^Test print/ }).click();
      await p.waitForFunction(() => window.__printed > 0);
      const css = await p.evaluate(() => [...document.querySelectorAll('style[data-keep]')].map((x) => x.textContent).join(''));
      const sized = css.match(/size:\s*([\d.]+)mm ([\d.]+)mm/);
      const pageW = turn % 180 ? h : rowW, pageH = turn % 180 ? rowW : h;
      const wide = pageW > pageH;
      ok(wide ? !sized : sized && Math.abs(Number(sized[1]) - pageW) < 0.11 && Math.abs(Number(sized[2]) - pageH) < 0.11,
        `${tag}: print window page ${pageW} × ${pageH} mm${wide ? ' (wide: no page size, so Chrome never prints it landscape; the driver’s label stock sets it)' : ' (sent as the page size)'}`, sized?.[0] ?? 'no size');
      await p.evaluate(() => { document.body.className = window.__pc; });
      await p.emulateMedia({ media: 'print' });
      await p.evaluate(([pw, ph]) => { const kept = [...document.querySelectorAll('style[data-keep]')].map((x) => x.textContent).join(''); if (/size\s*:/.test(kept)) return; const st = document.createElement('style'); st.dataset.keep = '1'; st.textContent = `@page { size: ${pw}mm ${ph}mm; }`; document.head.appendChild(st); }, [pageW, pageH]);
      const pdf = `${out}/${id}-window-${turn}.pdf`;
      fs.writeFileSync(pdf, await p.pdf({ preferCSSPageSize: true, printBackground: true }));
      await p.emulateMedia({ media: 'screen' });
      await p.evaluate(() => { document.querySelectorAll('style[data-keep]').forEach((s) => s.remove()); document.getElementById('print-root')?.remove(); document.body.classList.remove('printing', 'print-labels'); });
      execFileSync('pdftoppm', ['-gray', '-r', '203.2', '-f', '1', '-l', '1', '-singlefile', pdf, pdf.replace(/\.pdf$/, '')]);
      const pg = pgm(pdf.replace(/\.pdf$/, '.pgm'));
      const ref = rot(base.img, base.W, base.H, turn);
      // Compare at the same size (the PDF raster can be a dot larger).
      const crop = { W: ref.W, H: ref.H, img: new Uint8Array(ref.W * ref.H).fill(255) };
      for (let y = 0; y < Math.min(ref.H, pg.H); y++) for (let x = 0; x < Math.min(ref.W, pg.W); x++) crop.img[y * ref.W + x] = pg.img[y * pg.W + x];
      // Compare as the label is read (turn undone): the barcode must be the same bar for bar; each line of text must sit
      // on the same rows and be centred the same (letter widths can differ a little between the two renderers).
      const upA = rot(ref.img, ref.W, ref.H, (360 - turn) % 360), upB = rot(crop.img, crop.W, crop.H, (360 - turn) % 360);
      const bands = (u) => { const out = []; let cur = null; for (let y = 0; y < u.H; y++) { let ink = false, tr = 0, prev = false, l = u.W, r = -1; for (let x = 0; x < u.W; x++) { const k = u.img[y * u.W + x] < 128; if (k) { ink = true; l = Math.min(l, x); r = Math.max(r, x); } if (k !== prev) tr++; prev = k; } if (ink) { if (!cur) cur = { y0: y, y1: y, l, r, bars: tr > 40 }; else { cur.y1 = y; cur.l = Math.min(cur.l, l); cur.r = Math.max(cur.r, r); cur.bars ||= tr > 40; } } else if (cur) { out.push(cur); cur = null; } } if (cur) out.push(cur); return out.filter((b) => b.y1 - b.y0 >= 3); };
      const barA = bands(upA).find((x) => x.bars);
      // Barcode: every bar within 1 dot of a bar in the other (anti-aliased edges in the PDF can move an edge by a dot).
      let barsSame = 0;
      if (barA) {
        // The row with the most black/white changes runs through the bars.
        // A row through the bars: many black/white changes, and the same pattern 6 rows further down (text changes).
        const rowKey = (yy) => { let k = '', tr = 0, prev = false; for (let x = 0; x < upA.W; x++) { const v = upA.img[yy * upA.W + x] < 128; k += v ? '1' : '0'; if (v !== prev) tr++; prev = v; } return { k, tr }; };
        let y = barA.y0;
        for (let yy = 0; yy + 6 < upA.H; yy++) { const a = rowKey(yy), b = rowKey(yy + 6); if (a.tr > 40 && a.k === b.k) { y = yy + 3; break; } }
        let n = 0, m = 0;
        const ink = (u, x) => u.img[y * u.W + x] < 128;
        for (let x = 1; x < upA.W - 1; x++) { const a = ink(upA, x), c = ink(upB, x); if (a || c) { n++; if ((a && (ink(upB, x - 1) || c || ink(upB, x + 1))) || (c && (ink(upA, x - 1) || a || ink(upA, x + 1)))) m++; } }
        barsSame = n ? m / n : 0;
      }
      const box = (u) => { let t = u.H, bt = -1, l = u.W, r = -1; for (let y = 0; y < u.H; y++) for (let x = 0; x < u.W; x++) if (u.img[y * u.W + x] < 128) { t = Math.min(t, y); bt = Math.max(bt, y); l = Math.min(l, x); r = Math.max(r, x); } return { t, bt, c: (l + r) / 2 }; };
      const xa = box(upA), xb = box(upB);
      const placed = Math.abs(xa.t - xb.t) <= 4 && Math.abs(xa.bt - xb.bt) <= 4 && Math.abs(xa.c - xb.c) <= DPM;
      ok(barsSame > 0.98 && placed, `${tag}: the print window gives the same label (barcode ${(barsSame * 100).toFixed(1)}% same bars; same top, bottom and centre)`, `direct ${JSON.stringify(xa)} window ${JSON.stringify(xb)}`);
    }
  }
} catch (e) { ok(false, 'script crashed', e.stack); }
finally { helper.kill(); ok(errs.length === 0, 'no page errors', errs.slice(0, 2).join(' | ')); console.log(fails ? `${fails} failed` : 'all correct'); await b.close(); }
