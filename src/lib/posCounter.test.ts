import { describe, expect, it } from 'vitest';
import { cashSuggestions, parseScan } from './posCounter';

describe('what the cashier types in the scan box', () => {
  it('a plain barcode is one of it', () => expect(parseScan(' 8901234567890 ')).toEqual({ kind: 'code', code: '8901234567890', qty: 1 }));
  it('a quantity before it: 5*, 5x, 5 X, decimals for loose items', () => {
    expect(parseScan('5*8901234567890')).toEqual({ kind: 'code', code: '8901234567890', qty: 5 });
    expect(parseScan('12x8901234567890')).toEqual({ kind: 'code', code: '8901234567890', qty: 12 });
    expect(parseScan('3 X rice')).toEqual({ kind: 'code', code: 'rice', qty: 3 });
    expect(parseScan('2.5*TOMATO')).toEqual({ kind: 'code', code: 'TOMATO', qty: 2.5 });
  });
  it('*5 changes the last item', () => { expect(parseScan('*5')).toEqual({ kind: 'setQty', qty: 5 }); expect(parseScan('x2')).toEqual({ kind: 'setQty', qty: 2 }); });
  it('codes that only look like numbers stay codes', () => {
    expect(parseScan('0*')).toEqual({ kind: 'code', code: '0*', qty: 1 });
    expect(parseScan('ABC-123')).toEqual({ kind: 'code', code: 'ABC-123', qty: 1 });
    expect(parseScan('')).toEqual({ kind: 'empty' });
  });
  it('cash buttons: exact and the next round notes', () => {
    expect(cashSuggestions(877)).toEqual([877, 880, 900, 1000, 2000]);
    expect(cashSuggestions(2830)).toEqual([2830, 2850, 2900, 3000, 4000]);
    expect(cashSuggestions(0)).toEqual([]);
  });
});
