import { describe, expect, it } from 'vitest';
import { rotateBitmap, tsplJob, zplJob, type RowBitmap } from './labelDirect';
import { STOCK_PRESETS, PRINTER_PRESETS } from '../../shared/labelEngine';

const stock = STOCK_PRESETS.find((p) => p.id === '4in-50x25x2')!.stock;      // 2-up 50 × 25 on a 4-inch roll
const printer = PRINTER_PRESETS.find((p) => p.id === 'label-4in-tspl')!.settings;
/** A row the size of the 2-up stock at 203 dpi (832 × 200 dots) with one black dot at the top left. */
const row = (): RowBitmap => { const width = 832, height = 200; const mono = new Uint8Array((width / 8) * height); mono[0] = 0x80; return { width, height, mono }; };
const text = (b: Uint8Array) => String.fromCharCode(...b);

describe('TSPL for a 4-inch label printer', () => {
  it('tells the printer the real label size and gap, so nothing is fitted onto 4 × 6 paper or turned', () => {
    const t = text(tsplJob([row()], stock, printer));
    expect(t.startsWith('SIZE 104 mm,25 mm\r\nGAP 3 mm,0 mm\r\nDIRECTION 1,0\r\n')).toBe(true);
    expect(t).toContain('CLS\r\nBITMAP 0,0,104,200,0,');
    expect(t.endsWith('\r\nPRINT 1,1\r\n')).toBe(true);
  });
  it('inverts bits (in TSPL a 0 prints a dot) and sends one bitmap per row', () => {
    const b = tsplJob([row(), row()], stock, printer);
    const t = text(b);
    expect(t.split('PRINT 1,1').length - 1).toBe(2);
    const at = t.indexOf('BITMAP 0,0,104,200,0,') + 'BITMAP 0,0,104,200,0,'.length;
    expect(b[at]).toBe(0x7f);          // the black dot is a 0 bit
    expect(b[at + 1]).toBe(0xff);      // white
  });
  it('flips the print direction for a printer that feeds the other way (turn 180)', () => {
    expect(text(tsplJob([row()], stock, printer, 180))).toContain('DIRECTION 0,0');
  });
  it('moves the picture by the calibrated offset', () => {
    const b = tsplJob([row()], stock, { ...printer, offsetX: 1 }, 0);    // 1 mm = 8 dots to the right
    const at = text(b).indexOf('BITMAP 0,0,104,200,0,') + 'BITMAP 0,0,104,200,0,'.length;
    expect(b[at]).toBe(0xff);
    expect(b[at + 1]).toBe(0x7f);
  });
});

describe('ZPL for Zebra', () => {
  it('sets the label width and length in dots and sends the row as a graphic', () => {
    const z = text(zplJob([row()], { ...printer, language: 'zpl' }));
    expect(z).toContain('^PW832^LL200');
    expect(z).toContain('^GFA,20800,20800,104,80');
    expect(z.trim().endsWith('^XZ')).toBe(true);
  });
});

describe('a design that reads along the roll (Turn 90° / 270°)', () => {
  const at = (b: RowBitmap, x: number, y: number) => !!(b.mono[y * Math.ceil(b.width / 8) + (x >> 3)]! & (0x80 >> (x & 7)));
  it('turns the row a quarter: the top-left dot goes to the top-right (90°) or bottom-left (270°)', () => {
    const r90 = rotateBitmap(row(), 90), r270 = rotateBitmap(row(), 270);
    expect([r90.width, r90.height]).toEqual([200, 832]);
    expect(at(r90, 199, 0)).toBe(true);
    expect(at(r270, 0, 831)).toBe(true);
    expect(rotateBitmap(rotateBitmap(row(), 90), 270).mono).toEqual(row().mono);
  });
  it('tells the printer the turned size: 25 mm across, 104 mm along', () => {
    const t = text(tsplJob([rotateBitmap(row(), 90)], stock, printer, 90));
    expect(t.startsWith('SIZE 25 mm,104 mm\r\n')).toBe(true);
    expect(t).toContain('BITMAP 0,0,25,832,0,');
  });
});
