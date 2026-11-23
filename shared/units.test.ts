import { describe, expect, it } from 'vitest';
import { formatQty, parseQty, parseScaleLabel, qtyForAmount, qtyFromGrams, quickQtys, unitKind, wholeOnly, itemForPlu } from './units';
import { ean13CheckDigit } from './barcode';

const q = (s: string, u: string) => { const r = parseQty(s, u); return 'qty' in r ? r.qty : r.error; };

describe('quantities the way a shop sells', () => {
  it('pieces are whole; loose goods take decimals', () => {
    expect(wholeOnly('pcs')).toBe(true);
    expect(unitKind('kg')).toBe('weight');
    expect(unitKind('ltr')).toBe('volume');
    expect(q('1', 'pcs')).toBe(1);
    expect(q('1.5', 'pcs')).toMatch(/sold whole: enter 1 or 2/);
    expect(q('2 dozen', 'pcs')).toBe(24);
  });
  it('reads grams, halves, fractions and words for a per-kg item', () => {
    expect(q('200g', 'kg')).toBe(0.2);
    expect(q('200 gm', 'kg')).toBe(0.2);
    expect(q('1.25', 'kg')).toBe(1.25);
    expect(q('half kg', 'kg')).toBe(0.5);
    expect(q('half', 'kg')).toBe(0.5);
    expect(q('1/2', 'kg')).toBe(0.5);
    expect(q('½', 'kg')).toBe(0.5);
    expect(q('1½', 'kg')).toBe(1.5);
    expect(q('pav', 'kg')).toBe(0.25);
    expect(q('750 ml', 'ltr')).toBe(0.75);
    expect(q('1.5 kg', 'g')).toBe(1500);
    expect(q('2 ltr', 'kg')).toMatch(/Can’t turn ltr into kg/);
    expect(q('0', 'kg')).toMatch(/more than 0/);
    expect(q('abc', 'kg')).toMatch(/Type a number/);
  });
  it('writes quantities the way people say them', () => {
    expect(formatQty(0.2, 'kg')).toBe('200 g');
    expect(formatQty(1.25, 'kg')).toBe('1.25 kg');
    expect(formatQty(0.75, 'ltr')).toBe('750 ml');
    expect(formatQty(3, 'pcs')).toBe('3 pcs');
    expect(quickQtys('kg').map((x) => x.label)).toContain('250 g');
    expect(quickQtys('pcs')).toEqual([]);
  });
  it('₹50 of carrots at ₹40/kg is 1.25 kg; never more than the amount', () => {
    expect(qtyForAmount(50, 40)).toBe(1.25);
    expect(qtyForAmount(100, 30)).toBe(3.333);
    expect(qtyForAmount(118, 100, 18, false)).toBe(1);
  });
  it('reads weighing-scale labels', () => {
    const body = '270012301250'; // flag 27, PLU 00123, 1250 g
    const code = body + ean13CheckDigit(body);
    expect(parseScaleLabel(code)).toEqual({ plu: '00123', grams: 1250 });
    expect(qtyFromGrams(1250, 'kg')).toBe(1.25);
    expect(parseScaleLabel(body + ((ean13CheckDigit(body) + 1) % 10))).toBeNull();
    expect(itemForPlu([{ sku: 'CARROT', barcode: '' }, { sku: '123', barcode: '' }], '00123')?.sku).toBe('123');
  });
});
