import { describe, expect, it } from 'vitest';
import { escposRaster, printerDots, toMono } from './btPrinter';
import { pageSizeMm } from './native';

describe('Bluetooth receipt raster', () => {
  it('turns dark pixels into set bits, left to right, transparent as white', () => {
    // 10 px wide, 1 row: black, white, black, transparent, then 6 black.
    const px = [[0, 0, 0, 255], [255, 255, 255, 255], [0, 0, 0, 255], [0, 0, 0, 0], ...Array(6).fill([10, 10, 10, 255])];
    const mono = toMono(Uint8ClampedArray.from(px.flat()), 10, 1);
    expect([...mono]).toEqual([0b10101111, 0b11000000]);
  });
  it('wraps the picture in ESC/POS: initialise, GS v 0 bands, feed and cut; blank rows trimmed', () => {
    const w = 16, h = 300;
    const rgba = new Uint8ClampedArray(w * h * 4).fill(255);
    for (let y = 100; y < 200; y++) for (let x = 0; x < 8; x++) rgba.set([0, 0, 0, 255], (y * w + x) * 4);
    const bytes = escposRaster(toMono(rgba, w, h), w, h);
    expect([...bytes.slice(0, 2)]).toEqual([0x1b, 0x40]);
    expect([...bytes.slice(2, 10)]).toEqual([0x1d, 0x76, 0x30, 0, 2, 0, 116, 0]); // 100 inked rows + 8 kept each side
    expect([...bytes.slice(-7)]).toEqual([0x1b, 0x64, 0x04, 0x1d, 0x56, 0x42, 0x00]);
    expect(bytes.length).toBe(2 + 8 + 116 * 2 + 7);
  });
  it('uses the printable dots of each roll', () => {
    expect(printerDots(58)).toBe(384);
    expect(printerDots(80)).toBe(576);
  });
});

describe('print page size for the phone print screen', () => {
  const doc = (css: string[]) => ({ querySelectorAll: () => css.map((textContent) => ({ textContent })) }) as unknown as Document;
  it('reads mm sizes and named sheets, the last rule winning', () => {
    expect(pageSizeMm(doc(['@media print { @page { size: 58mm 134mm; margin: 0; } }']))).toEqual({ widthMm: 58, heightMm: 134 });
    expect(pageSizeMm(doc(['@page { size: A4 portrait; margin: 10mm }']))).toEqual({ widthMm: 210, heightMm: 297 });
    expect(pageSizeMm(doc(['@page { size: A4 landscape; }']))).toEqual({ widthMm: 297, heightMm: 210 });
    expect(pageSizeMm(doc(['@page { size: A5; }', '@page { size: 80mm 200mm; }']))).toEqual({ widthMm: 80, heightMm: 200 });
    expect(pageSizeMm(doc(['body { color: red }']))).toBeNull();
  });
});
