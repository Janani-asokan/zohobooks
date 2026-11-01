import { describe, expect, it } from 'vitest';
import { barcodeKey, findByCode, sameBarcode } from '../../shared/barcode';

describe('barcode matching', () => {
  it('treats 12-digit UPC and 13-digit EAN with a leading 0 as the same code', () => {
    expect(sameBarcode('012345678905', '0012345678905')).toBe(true);
    expect(sameBarcode('8901234567890', '8901234567890\r')).toBe(true);
    expect(sameBarcode('8901234567890', '8901234567891')).toBe(false);
  });
  it('ignores case and spaces for text codes, and never matches empty codes', () => {
    expect(barcodeKey(' toy-001 ')).toBe('TOY-001');
    expect(sameBarcode('', '')).toBe(false);
    expect(sameBarcode('0', '000')).toBe(true);
  });
  it('finds by barcode first, then SKU', () => {
    const items = [{ id: 'a', barcode: '', sku: 'TB-30' }, { id: 'b', barcode: '0890123456789', sku: '' }];
    expect(findByCode(items, '890123456789')?.id).toBe('b');
    expect(findByCode(items, 'tb-30')?.id).toBe('a');
    expect(findByCode(items, 'nope')).toBeUndefined();
  });
});
