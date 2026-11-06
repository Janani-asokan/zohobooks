import { describe, expect, it } from 'vitest';
import {
  PRINTER_PRESETS, STOCK_PRESETS, autoTemplate, barcodeModules, blockedLines, code128Modules, detectSymbology, fitBarcode, fitText, impose,
  jobBlocked, jobMetrics, printerCommands, qrModules, rowWidthMm, validateJob, type JobLine, type LabelData,
} from './labelEngine';

const stock = (id: string) => STOCK_PRESETS.find((s) => s.id === id)!.stock;
const printer = (id: string) => PRINTER_PRESETS.find((p) => p.id === id)!.settings;
const data = (o: Partial<LabelData> = {}): LabelData => ({ name: 'Item', sku: 'SKU-1', barcode: '8901057510011', price: 99, mrp: 120, batch: '', expiry: '', unit: 'pcs', brand: '', category: '', location: '', company: 'Shop', ...o });
const line = (qty: number, o: Partial<JobLine> = {}, d: Partial<LabelData> = {}): JobLine => ({ key: Math.random().toString(36), itemId: o.itemId ?? Math.random().toString(36), batch: '', qty, data: data(d), ...o });

describe('stock presets (spec 4.1)', () => {
  it('row widths match the spec table', () => {
    expect(rowWidthMm(stock('4in-100x50'))).toBe(104);
    expect(rowWidthMm(stock('4in-50x25x2'))).toBe(104);
    expect(rowWidthMm(stock('4in-33x25x3'))).toBe(104);
    expect(rowWidthMm(stock('4in-25x25x4'))).toBe(104);
    expect(rowWidthMm(stock('50x25x1'))).toBe(52);
    expect(rowWidthMm(stock('3in-cont'))).toBe(72);
    expect(rowWidthMm(stock('2in-cont'))).toBe(48);
  });
  it('every roll preset fits a 4-inch head, and every sheet fits its sheet', () => {
    for (const p of STOCK_PRESETS) {
      const pr = p.stock.sheet === 'roll' ? printer('label-4in-tspl') : printer('office-a4');
      const tpl = autoTemplate(p.stock.w, p.stock.h);
      expect(jobBlocked(validateJob([line(1)], tpl, p.stock, pr)), p.name).toBe(false);
    }
  });
});

describe('barcode fit (spec 5.3, ML-08..11)', () => {
  it('Code 128 capacity by label width at 203 dpi, 2-dot module, 1 mm inset', () => {
    const cap = (w: number) => { let n = 0; while (fitBarcode('A'.repeat(n + 1), 'CODE128', w - 2, 203, 2).ok) n++; return n; };
    expect(cap(25)).toBe(3);
    expect(cap(50)).toBe(12);
    expect(cap(100)).toBe(30);
  });
  it('digits pack in pairs (code C)', () => {
    expect(code128Modules('123456')).toBe(code128Modules('ABC'));
  });
  it('EAN-13 never below the 0.264 mm minimum: 3 dots (0.375 mm) at 203 dpi, ~42.4 mm with quiet zones', () => {
    const f = fitBarcode('8901057510011', 'EAN13', 48, 203, 3);
    expect(f.ok).toBe(true); expect(f.moduleDots).toBe(3); expect(f.widthMm).toBeCloseTo(42.4, 1);
    expect(fitBarcode('8901057510011', 'EAN13', 40, 203).ok).toBe(false); // too narrow: refused, never shrunk
  });
  it('QR at 3 dots per module: ~11 mm for version 1, ~12.4 mm for version 2', () => {
    expect(qrModules('SKU-12') * 0.375).toBeCloseTo(10.9, 1);
    expect(qrModules('A'.repeat(20)) * 0.375).toBeCloseTo(12.4, 1);
  });
  it('higher resolution printers get finer whole-dot bars, never below the minimum', () => {
    const f300 = fitBarcode('8901057510011', 'EAN13', 36, 300); const f600 = fitBarcode('8901057510011', 'EAN13', 36, 600);
    expect(f300.ok).toBe(false); // 4 dots at 12/mm = 0.333 mm → 37.7 mm, more than 36 mm
    expect(f600.ok).toBe(true); expect(f600.moduleMm).toBeGreaterThanOrEqual(0.264); expect(f600.widthMm).toBeLessThanOrEqual(36);
    expect(fitBarcode('SKU-1', 'CODE128', 100, 600).moduleMm).toBeLessThanOrEqual(0.5);
  });
  it('bars are whole dots and never stretched', () => {
    const f = fitBarcode('SKU-1', 'CODE128', 46, 203);
    expect(f.moduleDots).toBe(Math.round(f.moduleDots)); expect(f.widthMm).toBeLessThanOrEqual(46);
    expect(f.widthMm).toBeCloseTo(barcodeModules('SKU-1', 'CODE128') * f.moduleMm, 6);
  });
  it('retail codes keep their own symbology, check digit verified', () => {
    expect(detectSymbology('8901057510011')).toBe('EAN13');
    expect(detectSymbology('8901057510012')).toBe('CODE128');
    expect(detectSymbology('036000291452')).toBe('UPC');
  });
});

describe('imposition (spec 5)', () => {
  it('500 labels at 2-up on 50 × 25 → 250 rows and ~7.0 m of roll with a 3 mm gap (spec 5.2)', () => {
    const imp = impose([line(500)], stock('4in-50x25x2'));
    const m = jobMetrics(imp, stock('4in-50x25x2'));
    expect(m.labels).toBe(500); expect(m.rows).toBe(250); expect(m.rollMm).toBe(7000);
  });
  it('incomplete last row: blank, or repeat the last label (ML-03)', () => {
    expect(impose([line(5)], stock('4in-33x25x3')).rows.at(-1)).toEqual([{ line: 0, n: 4 }, { line: 0, n: 5 }, null]);
    expect(impose([line(5)], stock('4in-33x25x3'), { lastRow: 'repeat' }).rows.at(-1)).toEqual([{ line: 0, n: 4 }, { line: 0, n: 5 }, { line: 0, n: 5 }]);
  });
  it('keep item together starts each item on a fresh row and counts the blanks (ML-04)', () => {
    const imp = impose([line(1), line(1)], stock('4in-33x25x3'), { keepTogether: true });
    expect(imp.rows).toEqual([[{ line: 0, n: 1 }, null, null], [{ line: 1, n: 1 }, null, null]]);
    expect(imp.blanks).toBe(4);
  });
  it('without keep together the next item fills the row', () => {
    expect(impose([line(1), line(2)], stock('4in-33x25x3')).rows).toEqual([[{ line: 0, n: 1 }, { line: 1, n: 1 }, { line: 1, n: 2 }]]);
  });
  it('resume after a jam from a chosen label number (BP-10)', () => {
    const imp = impose([line(10)], stock('4in-50x25x2'), { from: 7 });
    expect(imp.rows[0]).toEqual([{ line: 0, n: 7 }, { line: 0, n: 8 }]);
    expect(imp.rows.length).toBe(2);
  });
  it('column-first fill on a sheet, and a start position on a partly used sheet (ML-02, ML-05)', () => {
    const s = { ...stock('a4-24'), rows: 2 }; // 3 across × 2 rows for the test
    expect(impose([line(4)], s, { fill: 'column' }).rows).toEqual([[{ line: 0, n: 1 }, { line: 0, n: 3 }, null], [{ line: 0, n: 2 }, { line: 0, n: 4 }, null]]);
    expect(impose([line(2)], s, { start: { row: 1, col: 3 } }).rows[0]).toEqual([null, null, { line: 0, n: 1 }]);
  });
  it('zero quantities are skipped, pack factor multiplies (BP-02, BP-03)', () => {
    expect(impose([line(0), line(2)], stock('50x25x1'), { packFactor: 3 }).total).toBe(6);
  });
  it('grouping by item keeps an item’s lines together (BP-06)', () => {
    const a = line(1, { itemId: 'A' }), b = line(1, { itemId: 'B' }), a2 = line(1, { itemId: 'A' });
    expect(impose([a, b, a2], stock('50x25x1')).rows.map((r) => r[0]!.line)).toEqual([0, 2, 1]);
    expect(impose([a, b, a2], stock('50x25x1'), { order: 'source' }).rows.map((r) => r[0]!.line)).toEqual([0, 1, 2]);
  });
});

describe('pre-print checks (spec 3.3)', () => {
  const s = stock('4in-50x25x2'); const tpl = autoTemplate(50, 25); const pr = printer('label-4in-tspl');
  it('a line with no barcode is blocked; the rest still print', () => {
    const issues = validateJob([line(2), line(2, {}, { barcode: '', sku: '' })], tpl, s, pr);
    expect([...blockedLines(issues)]).toEqual([1]); expect(jobBlocked(issues)).toBe(false);
  });
  it('a barcode that cannot fit at a scannable size is blocked, not shrunk', () => {
    expect(validateJob([line(1, {}, { barcode: 'ABCDEFGHIJKLMNOPQRSTU' })], tpl, s, pr).some((x) => x.code === 'no-fit')).toBe(true);
  });
  it('Tamil in the barcode is blocked with the character named; Tamil in the name is fine', () => {
    const issues = validateJob([line(1, {}, { barcode: 'அரிசி', name: 'பொன்னி அரிசி' })], tpl, s, pr);
    expect(issues.find((x) => x.code === 'bad-char')?.message).toMatch(/“அ”/);
  });
  it('template size must match the stock; any across count is fine (RS-05)', () => {
    expect(validateJob([line(1)], autoTemplate(100, 50), s, pr).some((x) => x.code === 'size' && x.severity === 'blocker')).toBe(true);
    expect(jobBlocked(validateJob([line(1)], tpl, stock('50x25x1'), pr))).toBe(false);
  });
  it('row wider than the head is blocked; 50 × 25 1-up on a 48 mm head only warns (spec 4.4)', () => {
    expect(jobBlocked(validateJob([line(1)], tpl, s, printer('receipt-2in')))).toBe(true);
    const one = validateJob([line(1)], tpl, stock('50x25x1'), printer('receipt-2in'));
    expect(one.some((x) => x.code === 'head-inset' && x.severity === 'warning')).toBe(true);
  });
  it('missing price warns; expired batch warns; jobs over 10,000 are blocked (BP-05)', () => {
    expect(validateJob([line(1, {}, { price: null })], autoTemplate(50, 25, { name: { size: 22, bold: false } }), s, pr).some((x) => x.code === 'missing-field')).toBe(false); // no price on this template
    const withPrice = autoTemplate(50, 25, { price: { size: 22, bold: true } });
    expect(validateJob([line(1, {}, { price: null })], withPrice, s, pr).some((x) => x.code === 'missing-field')).toBe(true);
    expect(validateJob([line(1, { expiry: '2020-01-01' })], tpl, s, pr, '2026-11-06').some((x) => x.code === 'expired')).toBe(true);
    expect(jobBlocked(validateJob([line(10001)], tpl, s, pr))).toBe(true);
  });
});

describe('overlap (QA-L10)', () => {
  it('warns when text sits on the barcode; the auto layout never does', () => {
    const s = stock('4in-50x25x2'); const pr = printer('label-4in-tspl');
    const t = autoTemplate(50, 25);
    expect(validateJob([line(1)], t, s, pr).some((x) => x.code === 'overlap')).toBe(false);
    const bad = { ...t, elements: [...t.elements, { id: 'z', type: 'text' as const, text: 'Hi', x: 10, y: 8, w: 20, h: 3 }] };
    expect(validateJob([line(1)], bad, s, pr).some((x) => x.code === 'overlap')).toBe(true);
  });
});

describe('text overflow (BL-11)', () => {
  it('shrinks to fit, down to the minimum, then reports overflow', () => {
    expect(fitText('Short', { w: 40, h: 4, size: 3, maxLines: 1, overflow: 'shrink', minSize: 1.6 }).overflow).toBe(false);
    const long = fitText('A very long item name that cannot fit anywhere at all', { w: 20, h: 3, size: 3, maxLines: 1, overflow: 'shrink', minSize: 1.6 });
    expect(long.size).toBe(1.6); expect(long.overflow).toBe(true);
  });
  it('truncates with an ellipsis', () => {
    const t = fitText('A very long item name that cannot fit', { w: 20, h: 3, size: 3, maxLines: 1, overflow: 'truncate' });
    expect(t.text.endsWith('…')).toBe(true); expect(t.overflow).toBe(true);
  });
});

describe('printer commands (spec 6.3)', () => {
  const s = stock('4in-50x25x2'); const tpl = autoTemplate(50, 25, { company: { size: 22, bold: true }, name: { size: 22, bold: false } });
  const lines = [line(2, {}, { name: 'Soap' })];
  const rows = impose(lines, s).rows;
  it('TSPL: label size, gap, native barcode, print', () => {
    const t = printerCommands('tspl', rows, lines, tpl, s, printer('label-4in-tspl')).text;
    expect(t).toMatch(/^SIZE 104 mm, 25 mm\nGAP 3 mm, 0 mm/);
    expect(t).toMatch(/BARCODE \d+,\d+,"EAN13",\d+,0,0,3,3,"8901057510011"/);
    expect(t.match(/PRINT 1,1/g)!.length).toBe(1);
  });
  it('ZPL: width, length, EAN, end of label', () => {
    const t = printerCommands('zpl', rows, lines, tpl, s, printer('label-4in-zpl')).text;
    expect(t).toMatch(/\^PW832/); expect(t).toMatch(/\^LL200/); expect(t).toMatch(/\^BY3\^BEN,\d+,N,N\^FD890105751001\^FS/); expect(t).toMatch(/\^XZ/);
  });
  it('ESC/POS: initialise, barcode, cut', () => {
    const t = printerCommands('escpos', impose(lines, stock('2in-cont')).rows, lines, autoTemplate(48, 30), stock('2in-cont'), printer('receipt-2in')).text;
    expect(t.startsWith('\x1b@')).toBe(true); expect(t).toContain('\x1dk'); expect(t).toContain('\x1dV');
  });
  it('Tamil text is listed for bitmap rendering instead of being sent as broken text', () => {
    const tl = [line(1, {}, { name: 'பொன்னி அரிசி' })];
    expect(printerCommands('tspl', impose(tl, s).rows, tl, tpl, s, printer('label-4in-tspl')).needsBitmap).toEqual(['பொன்னி அரிசி']);
  });
  it('printer offsets shift everything by whole dots', () => {
    const a = printerCommands('tspl', rows, lines, tpl, s, printer('label-4in-tspl')).text.match(/BARCODE (\d+),(\d+)/)!;
    const b = printerCommands('tspl', rows, lines, tpl, s, { ...printer('label-4in-tspl'), offsetX: 1, offsetY: 0.5 }).text.match(/BARCODE (\d+),(\d+)/)!;
    expect(Number(b[1]) - Number(a[1])).toBe(8); expect(Number(b[2]) - Number(a[2])).toBe(4);
  });
});

describe('auto layout', () => {
  it('stays inside the 1 mm safe area on every preset size', () => {
    for (const p of STOCK_PRESETS) {
      const t = autoTemplate(p.stock.w, p.stock.h, { company: { size: 22, bold: true }, sku: { size: 18, bold: false }, name: { size: 22, bold: false }, mrp: { size: 22, bold: false }, price: { size: 22, bold: false } });
      const bottom = Math.max(...t.elements.map((e) => e.y + e.h));
      expect(bottom, p.name).toBeLessThanOrEqual(p.stock.h - 1 + 0.05);
    }
  });
});
