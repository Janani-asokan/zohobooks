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

/** The item a scanned code belongs to: its barcode, then an earlier barcode it had (an alias), then its SKU. */
export function findByCode<T extends { barcode?: string | null; sku?: string | null; aliases?: string[] | null }>(items: T[], code: string): T | undefined {
  return items.find((i) => sameBarcode(i.barcode, code))
    ?? items.find((i) => (i.aliases ?? []).some((a) => sameBarcode(a, code)))
    ?? items.find((i) => !!i.sku && barcodeKey(i.sku) === barcodeKey(code));
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

/* ---------- Barcode generator (Barcode & Labels module, BL-03 / BL-04) ---------- */
export type GeneratorMode = 'shop-ean' | 'sku' | 'series' | 'gs1';
export interface GeneratorSettings { mode: GeneratorMode; prefix: string; next: number; digits: number; gs1Prefix: string }
export const DEFAULT_GENERATOR: GeneratorSettings = { mode: 'shop-ean', prefix: 'C', next: 1, digits: 6, gs1Prefix: '' };
/** A GS1 company prefix is 6–11 digits (issued by GS1 India); EAN-13 numbers are only made under one (BL-04). */
export const isGs1Prefix = (p: string) => /^\d{6,11}$/.test(p);
/** The SKU as a Code 128 value: printable ASCII only, upper case, no spaces. Empty when nothing usable is left. */
export const skuBarcode = (sku: string) => String(sku ?? '').toUpperCase().replace(/\s+/g, '-').replace(/[^\x21-\x7e]/g, '').slice(0, 30);
/**
 * Makes the next code for an item. `taken` keeps it unique in the shop; `state.next` moves on as numbers are used.
 * shop-ean: EAN-13 starting with 2 (the range kept for in-store use). sku: the SKU as Code 128 (falls back to the
 * series when the SKU is empty or taken). series: prefix + zero-padded number, Code 128. gs1: EAN-13 under the shop's
 * GS1 company prefix.
 */
export function nextCode(s: GeneratorSettings, item: { sku: string }, taken: Set<string>, state: { next: number }, random: () => number = Math.random): string {
  const series = () => {
    for (let i = 0; i < 100000; i++) {
      const code = `${s.prefix}${String(state.next++).padStart(s.digits, '0')}`;
      if (!taken.has(barcodeKey(code))) { taken.add(barcodeKey(code)); return code; }
    }
    throw new Error('No free number left in the series');
  };
  if (s.mode === 'sku') {
    const c = skuBarcode(item.sku);
    if (c && !taken.has(barcodeKey(c))) { taken.add(barcodeKey(c)); return c; }
    return series();
  }
  if (s.mode === 'series') return series();
  if (s.mode === 'gs1') {
    if (!isGs1Prefix(s.gs1Prefix)) throw new Error('Enter your GS1 company prefix first');
    const room = 12 - s.gs1Prefix.length;
    for (let i = 0; i < 10 ** room; i++) {
      const ref = String(state.next++).padStart(room, '0');
      if (ref.length > room) break;
      const body = s.gs1Prefix + ref; const code = body + ean13CheckDigit(body);
      if (!taken.has(barcodeKey(code))) { taken.add(barcodeKey(code)); return code; }
    }
    throw new Error('All numbers under this GS1 prefix are used');
  }
  return newShopBarcode(taken, random);
}
