import { describe, expect, it } from 'vitest';
import { LAYOUT_PRESETS, labelPageCss, layoutProblems, moduleMm, resolveLayout, rowWidth, symbologyFor } from './labelLayout';

const preset = (s: string) => LAYOUT_PRESETS.find((p) => p.label.startsWith(s))!.layout;

describe('label layout', () => {
  it('a roll row is the labels side by side with the gaps and margins', () => {
    const l = preset('50x25 · 2 across');
    expect(rowWidth(l)).toBe(104);
    expect(labelPageCss(l)).toBe('size: 104mm 25mm; margin: 0;');
    expect(layoutProblems(l)).toEqual([]);
  });
  it('rotated: the page is sent turned 90° (for printers that feed the label the other way)', () => {
    const l = { ...preset('100x50'), rotate: 90 as const };
    expect(labelPageCss(l)).toBe('size: 50mm 104mm; margin: 0;');
  });
  it('labels that do not fit the roll or the sheet are caught', () => {
    expect(layoutProblems({ ...preset('50x25 · 2 across'), across: 3 })[0]).toMatch(/wider than the 104 mm roll/);
    expect(layoutProblems({ ...preset('A4 · 65'), rows: 20 })[0]).toMatch(/taller than an A4 sheet/);
    expect(layoutProblems({ ...preset('50x25 · 1'), across: 0 })[0]).toMatch(/1 to 8/);
  });
  it('every preset fits its stock', () => { for (const p of LAYOUT_PRESETS) expect(layoutProblems(p.layout), p.label).toEqual([]); });
  it('upside down: turned 180°, same page size', () => {
    expect(labelPageCss({ ...preset('100x50'), rotate: 180 })).toBe('size: 104mm 50mm; margin: 0;');
    expect(layoutProblems({ ...preset('100x50'), rotate: 180 })).toEqual([]);
  });
  it('a layout saved by an older build with rotate: true is turned 90°', () => {
    expect(resolveLayout({ printer: 'label', labelSize: '100x50-1', layout: { ...preset('100x50'), rotate: true as never } }).rotate).toBe(90);
  });
  it('older saved settings keep their label size', () => {
    expect(resolveLayout({ printer: 'label', labelSize: '50x25-2' })).toMatchObject({ stock: 'roll', w: 50, h: 25, across: 2, rollMm: 104 });
    expect(resolveLayout({ printer: 'label', labelSize: '100x50-1' })).toMatchObject({ w: 100, h: 50, across: 1, rollMm: 104 });
    expect(resolveLayout({ printer: 'a4', labelSize: 'a4-65' })).toMatchObject({ stock: 'a4', across: 5, rows: 13 });
  });
});

describe('which barcode is printed', () => {
  it('retail codes as their own barcode, check digit verified', () => {
    expect(symbologyFor('8901234567891')).toEqual({ format: 'CODE128', code: '8901234567891' }); // wrong check digit
    expect(symbologyFor('8901057510011')).toEqual({ format: 'EAN13', code: '8901057510011' });
    expect(symbologyFor('96385074')).toEqual({ format: 'EAN8', code: '96385074' });
    expect(symbologyFor('036000291452')).toEqual({ format: 'UPC', code: '036000291452' });
    expect(symbologyFor('TED-30')).toEqual({ format: 'CODE128', code: 'TED-30' });
  });
  it('characters no barcode can hold are refused with the character named', () => {
    expect(symbologyFor('அரிசி-1')).toMatchObject({ error: expect.stringMatching(/“அ” can’t go in a barcode/) });
    expect(symbologyFor('₹100')).toMatchObject({ error: expect.stringMatching(/“₹”/) });
    expect(symbologyFor('')).toMatchObject({ error: 'No barcode or SKU' });
  });
  it('bars land on whole printer dots', () => {
    expect(moduleMm(115, 47)).toBe(0.375);  // EAN-13 with quiet zones on a 50 mm label
    expect(moduleMm(115, 30)).toBe(0.25);
    expect(moduleMm(300, 20)).toBe(0.125);  // never thinner than one dot
  });
});
