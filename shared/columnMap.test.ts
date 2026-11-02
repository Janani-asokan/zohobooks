import { describe, expect, it } from 'vitest';
import { guessMapping } from './columnMap';

describe('finding the IMEI column in an item sheet', () => {
  it('recognises the usual IMEI / serial headers', () => {
    for (const h of ['IMEI', 'IMEI No.', 'IMEI Number', 'IMEI 1', 'IMEI/Serial No', 'Serial Number'])
      expect(guessMapping('items', ['Product Name', h, 'MRP']).serials, h).toBe(h);
    const m = guessMapping('items', ['Model', 'IMEI 1', 'IMEI 2', 'Price']);
    expect(m).toMatchObject({ serials: 'IMEI 1', imei2: 'IMEI 2' });
  });
  it('does not take a row-number column for IMEIs', () => {
    expect(guessMapping('items', ['S.No', 'Item Name', 'Qty']).serials).toBeNull();
    expect(guessMapping('items', ['Sl No', 'Item Name', 'Qty']).serials).toBeNull();
  });
});
