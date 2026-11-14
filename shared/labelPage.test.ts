import { describe, expect, it } from 'vitest';
import { STOCK_PRESETS, driverPaperMm, labelPageCss, rowWidthMm } from './labelEngine';

const stock = (id: string) => STOCK_PRESETS.find((x) => x.id === id)!.stock;

describe('browser page size for label printing', () => {
  it('a 38 × 25 2-up roll prints on an 80 × 25 mm page, never A4', () => {
    const s = stock('3in-38x25x2');
    expect(rowWidthMm(s)).toBe(80);
    expect(labelPageCss(s)).toBe('size: 80mm 25mm; margin: 0;');
  });
  it('the total row width counts margins, labels and the gaps between them', () => {
    expect(rowWidthMm(stock('3in-38x25x2-nogap'))).toBe(78);
    expect(rowWidthMm(stock('4in-33x25x3'))).toBe(104);
  });
  it('a turned printer gets the page turned', () => {
    expect(labelPageCss(stock('3in-38x25x2'), 90)).toBe('size: 25mm 80mm; margin: 0;');
  });
  it('"use the driver’s paper" leaves wide rows unsized and keeps tall labels sized', () => {
    expect(labelPageCss(stock('3in-38x25x2'), 0, 'driver')).toBe('margin: 0;');
    expect(labelPageCss(stock('4in-100x150'), 0, 'driver')).toBe('size: 104mm 150mm; margin: 0;');
  });
  it('sheets go by name', () => {
    expect(labelPageCss(stock('a4-65'))).toBe('size: A4 portrait; margin: 0;');
  });
  it('tells the driver the stock size and the gap (none on a continuous roll)', () => {
    expect(driverPaperMm(stock('3in-38x25x2'))).toEqual({ w: 80, h: 25, gap: 3 });
    expect(driverPaperMm({ ...stock('3in-38x25x2'), rowGap: 0, media: 'continuous' })).toEqual({ w: 80, h: 25, gap: 0 });
  });
});
