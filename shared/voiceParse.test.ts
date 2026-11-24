import { describe, expect, it } from 'vitest';
import { parseVoice } from './voiceParse';

const items = [
  { id: 'c', name: 'Carrot (Ooty)', unit: 'kg' },
  { id: 'o', name: 'Onion Big', unit: 'kg' },
  { id: 'm', name: 'Logitech M331 Silent Mouse', unit: 'pcs', brand: 'Logitech' },
  { id: 'p', name: 'SanDisk 64GB Pen Drive', unit: 'pcs', sku: 'SD-64U3' },
  { id: 'u', name: 'USB-C Charging Cable 1m', unit: 'pcs' },
  { id: 'r', name: 'Sona Masoori Rice 5kg bag', unit: 'bag', extra: { localName: 'chawal' } },
  { id: 'milk', name: 'Aavin Milk', unit: 'ltr' },
];
const adds = (t: string) => parseVoice(t, items).map((a) => (a.kind === 'add' ? [a.itemId, a.qty] : [a.kind]));

describe('voice billing phrases', () => {
  it('several items in one breath, with numbers as words or digits', () => {
    expect(adds('two kg carrot and three logitech mouse')).toEqual([['c', 2], ['m', 3]]);
    expect(adds('5 pen drive, one usb cable')).toEqual([['p', 5], ['u', 1]]);
  });
  it('weights the way people say them', () => {
    expect(adds('half kg onion')).toEqual([['o', 0.5]]);
    expect(adds('200 gram carrot')).toEqual([['c', 0.2]]);
    expect(adds('carrot two kg')).toEqual([['c', 2]]);
    expect(adds('one litre milk')).toEqual([['milk', 1]]);
  });
  it('Hinglish and local names', () => {
    expect(adds('ek chawal aur do mouse')).toEqual([['r', 1], ['m', 2]]);
  });
  it('a slightly wrong word still finds the item; no number means one', () => {
    expect(adds('logitec mouse')).toEqual([['m', 1]]);
    expect(adds('sandisk')).toEqual([['p', 1]]);
  });
  it('said without "and", or "and" heard as "an"', () => {
    expect(adds('carrot an three last mouse')).toEqual([['c', 1], ['m', 3]]);
    expect(adds('two kg carrot three mouse')).toEqual([['c', 2], ['m', 3]]);
    expect(adds('half kg onion two pen drive')).toEqual([['o', 0.5], ['p', 2]]);
  });
  it('undo, and phrases that name nothing known', () => {
    expect(adds('remove last')).toEqual([['undo']]);
    const u = parseVoice('three samsung television', items)[0]!;
    expect(u.kind).toBe('unmatched');
  });
});
