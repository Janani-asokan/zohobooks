import { describe, expect, it } from 'vitest';
import { STOCK_PRESETS, autoTemplate } from './labelEngine';

describe('auto layout always fits the label', () => {
  it('stays inside every stock at any barcode height and text size, and the barcode stays scannable', () => {
    for (const p of STOCK_PRESETS) for (const share of [20, 40, 60, 80]) for (const size of [12, 22, 30, 40]) {
      const { w, h } = p.stock; const o = { size, bold: true };
      const t = autoTemplate(w, h, { company: o, sku: o, name: o, mrp: o, price: o, brand: o, category: o, unit: o }, share);
      const tag = `${p.id} ${share}% ${size}`;
      for (const e of t.elements) {
        expect(e.y, tag).toBeGreaterThanOrEqual(0.99);
        expect(e.y + e.h, tag).toBeLessThanOrEqual(h - 0.99);
        expect(e.x + e.w, tag).toBeLessThanOrEqual(w - 0.99);
      }
      const bar = t.elements.find((e) => e.type === 'barcode' || e.type === 'qr')!;
      expect(bar.h, tag).toBeGreaterThanOrEqual(4);
      expect(t.elements.some((e) => e.field === 'name'), tag).toBe(true);
      expect(t.elements.some((e) => e.field === 'price'), tag).toBe(true);
    }
  });
  it('gives the barcode the height asked for when there is room, and takes it back when text needs it', () => {
    const small = { size: 14, bold: false };
    expect(autoTemplate(100, 75, { name: small, price: small }, 60).elements.find((e) => e.type === 'barcode')!.h).toBe(45);
    const big = { size: 40, bold: false };
    const t = autoTemplate(38, 25, { company: big, name: big, mrp: big, price: big }, 80);
    expect(t.elements.find((e) => e.type === 'barcode')!.h).toBeLessThan(20);
  });
});
