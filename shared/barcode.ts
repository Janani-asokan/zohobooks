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

/** EAN-13 check digit for the first 12 digits. */
export function ean13CheckDigit(body12: string): number {
  const sum = [...body12].reduce((s, d, i) => s + Number(d) * (i % 2 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10;
}

/** True for 13 digits with a correct check digit. */
export const isValidEan13 = (c: string) => /^\d{13}$/.test(c) && ean13CheckDigit(c.slice(0, 12)) === Number(c[12]);

/**
 * A shop's own barcode for an item that has none (loose toys, unbranded goods): EAN-13 starting with 2, the range
 * kept for in-store use, so it never clashes with a maker's barcode. `taken` keeps it unique in the shop.
 */
export function newShopBarcode(taken: Set<string>, random: () => number = Math.random): string {
  for (let i = 0; i < 1000; i++) {
    const body = '2' + Array.from({ length: 11 }, () => Math.floor(random() * 10)).join('');
    const code = body + ean13CheckDigit(body);
    if (!taken.has(barcodeKey(code))) { taken.add(barcodeKey(code)); return code; }
  }
  throw new Error('Could not find a free barcode');
}
