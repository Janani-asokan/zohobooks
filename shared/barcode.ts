/**
 * Barcode matching. Scanners differ in how they send the same printed code: a UPC-A box can arrive as 12 digits or
 * as 13 with a leading 0 (EAN-13), and some scanners add spaces or a carriage return. Numeric codes are compared
 * without leading zeros; other codes are compared trimmed and case-insensitive.
 */
export function barcodeKey(code: string | null | undefined): string {
  const c = String(code ?? '').replace(/[\s\r\n\t]+/g, '');
  if (!c) return '';
  if (/^\d+$/.test(c)) return c.replace(/^0+(?=\d)/, '');
  return c.toUpperCase();
}

export const sameBarcode = (a: string | null | undefined, b: string | null | undefined) => {
  const ka = barcodeKey(a);
  return ka !== '' && ka === barcodeKey(b);
};

/** The item a scanned code belongs to: its barcode first, then its SKU. */
export function findByCode<T extends { barcode?: string | null; sku?: string | null }>(items: T[], code: string): T | undefined {
  return items.find((i) => sameBarcode(i.barcode, code)) ?? items.find((i) => !!i.sku && barcodeKey(i.sku) === barcodeKey(code));
}
