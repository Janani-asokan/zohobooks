/**
 * Barcode label layout, like BarTender / Zoho Inventory: the label stock (a thermal label roll or an A4 sheet), the
 * label size, how many labels sit side by side, the gaps and margins, and the orientation. Everything is in mm.
 *
 * Roll: each printed "page" is one row of labels across the roll. Page width = side margins + labels + gaps between
 * them; page height = one label. The printer's gap sensor finds the next row. Rotate when the printer driver feeds
 * the label the other way round (labels coming out sideways): the page is then sent turned by 90°.
 * A4: a sheet of label stickers in a grid, with the sheet's top / left margins and the gaps between stickers.
 */
import { LABEL_SIZES, labelSize } from './printSettings';

export type LabelStock = 'roll' | 'a4';
export interface LabelLayout {
  stock: LabelStock;
  /** Label width × height (as the label is read). */
  w: number; h: number;
  /** Labels side by side (roll) or columns (A4). */
  across: number;
  /** A4 only: rows of labels per sheet. */
  rows: number;
  /** Gap between labels across, and between rows (A4; on a roll the printer's gap sensor handles rows). */
  gapX: number; gapY: number;
  /** Space before the first label: left (roll and A4) and top (A4). */
  marginX: number; marginY: number;
  /** Roll width in mm (for checking the labels fit). */
  rollMm: number;
  /** Turn the printed page 90° or 270° (when labels come out sideways); 0 = as designed. */
  rotate: 0 | 90 | 270;
}

export const ROLLS = [
  { id: '2in', mm: 58, label: '2 inch roll (58 mm)' },
  { id: '3in', mm: 80, label: '3 inch roll (80 mm)' },
  { id: '4in', mm: 104, label: '4 inch roll (104 mm)' },
] as const;

/** Common stock, so most shops just pick theirs. */
export const LAYOUT_PRESETS: Array<{ id: string; label: string; layout: LabelLayout }> = [
  ['50x25 · 2 across · 4 inch roll', 'roll', 50, 25, 2, 0, 2, 0, 1, 0, 104],
  ['50x25 · 1 across · 2 inch roll', 'roll', 50, 25, 1, 0, 0, 0, 2, 0, 58],
  ['100x50 · 1 across · 4 inch roll', 'roll', 100, 50, 1, 0, 0, 0, 2, 0, 104],
  ['75x50 · 1 across · 3 inch roll', 'roll', 75, 50, 1, 0, 0, 0, 2, 0, 80],
  ['38x25 · 2 across · 3 inch roll', 'roll', 38, 25, 2, 0, 2, 0, 1, 0, 80],
  ['32x25 · 3 across · 4 inch roll', 'roll', 32, 25, 3, 0, 2, 0, 1, 0, 104],
  ['2 x 1 inch (51x25) · 2 across · 4 inch roll', 'roll', 51, 25, 2, 0, 1, 0, 0.5, 0, 104],
  ['100x150 shipping label · 4 inch roll', 'roll', 100, 150, 1, 0, 0, 0, 2, 0, 104],
  ['A4 · 65 per sheet (38x21)', 'a4', 38.1, 21.2, 5, 13, 2.5, 0, 4.7, 10.7, 210],
  ['A4 · 40 per sheet (48x25)', 'a4', 48.5, 25.4, 4, 10, 0, 0, 7.5, 21.5, 210],
  ['A4 · 24 per sheet (64x34)', 'a4', 63.5, 33.9, 3, 8, 2.5, 0, 7.2, 12.9, 210],
  ['A4 · 12 per sheet (99x46)', 'a4', 99.1, 46.6, 2, 6, 2.5, 0, 4.6, 8.6, 210],
].map(([label, stock, w, h, across, rows, gapX, gapY, marginX, marginY, rollMm]) => ({
  id: String(label).toLowerCase().replace(/[^a-z0-9]+/g, '-'),
  label: String(label),
  layout: { stock: stock as LabelStock, w: Number(w), h: Number(h), across: Number(across), rows: Number(rows), gapX: Number(gapX), gapY: Number(gapY), marginX: Number(marginX), marginY: Number(marginY), rollMm: Number(rollMm), rotate: 0 },
}));

/** The layout in use: the saved one, or (older settings) the one matching the chosen label size. */
export function resolveLayout(b: { printer: 'a4' | 'label'; labelSize: string; layout?: Partial<LabelLayout> | null }): LabelLayout {
  if (b.layout && b.layout.w && b.layout.h) {
    const l = { ...LAYOUT_PRESETS[0]!.layout, ...b.layout } as LabelLayout;
    return { ...l, rotate: (l.rotate as unknown) === true ? 90 : l.rotate === 90 || l.rotate === 270 ? l.rotate : 0 };
  }
  const old = labelSize(b.labelSize);
  if (old.printer === 'a4') return { stock: 'a4', w: old.w, h: old.h, across: old.perRow, rows: old.rowsPerPage ?? 10, gapX: 2, gapY: 0, marginX: 8, marginY: 10, rollMm: 210, rotate: 0 };
  return { stock: 'roll', w: old.w, h: old.h, across: old.perRow, rows: 0, gapX: old.perRow > 1 ? 2 : 0, gapY: 0, marginX: 0, marginY: 0, rollMm: old.perRow * old.w + 4 > 80 ? 104 : old.perRow * old.w > 58 ? 80 : 58, rotate: 0 };
}

const r1 = (n: number) => Math.round(n * 10) / 10;
/** One printed row (roll) or the label grid (A4) in mm. */
export const rowWidth = (l: LabelLayout) => r1(l.marginX * 2 + l.across * l.w + (l.across - 1) * l.gapX);

/** The @page rule for printing this layout. */
export function labelPageCss(l: LabelLayout): string {
  if (l.stock === 'a4') return 'size: A4 portrait; margin: 0;';
  const w = rowWidth(l), h = r1(l.h);
  return l.rotate ? `size: ${h}mm ${w}mm; margin: 0;` : `size: ${w}mm ${h}mm; margin: 0;`;
}

/** What is wrong with a layout, or [] (sizes in range, the labels fit the roll / sheet). */
export function layoutProblems(l: LabelLayout): string[] {
  const p: string[] = [];
  if (!(l.w >= 10 && l.w <= 200) || !(l.h >= 8 && l.h <= 300)) p.push('Label size must be 10–200 mm wide and 8–300 mm tall');
  if (!(Number.isInteger(l.across) && l.across >= 1 && l.across <= 8)) p.push('Labels across must be 1 to 8');
  if (l.gapX < 0 || l.gapX > 20 || l.gapY < 0 || l.gapY > 20 || l.marginX < 0 || l.marginX > 30 || l.marginY < 0 || l.marginY > 40) p.push('Gaps must be 0–20 mm and margins 0–30 mm');
  if (![0, 90, 270].includes(l.rotate)) p.push('Turn must be 0°, 90° or 270°');
  if (l.stock === 'roll' && rowWidth(l) > l.rollMm + 0.05) p.push(`${l.across} labels of ${l.w} mm with the gaps need ${rowWidth(l)} mm, wider than the ${l.rollMm} mm roll`);
  if (l.stock === 'a4') {
    if (!(Number.isInteger(l.rows) && l.rows >= 1 && l.rows <= 40)) p.push('Rows per sheet must be 1 to 40');
    if (rowWidth(l) > 210.05) p.push(`The labels need ${rowWidth(l)} mm across, wider than A4 (210 mm)`);
    if (r1(l.marginY + l.rows * l.h + (l.rows - 1) * l.gapY) > 297.05) p.push('The rows of labels are taller than an A4 sheet (297 mm)');
  }
  return p;
}

/* ---------- Which barcode a code is printed as ---------- */
const gs1Ok = (d: string) => { let t = 0; for (let i = 0; i < d.length - 1; i++) t += Number(d[d.length - 2 - i]) * (i % 2 === 0 ? 3 : 1); return (10 - (t % 10)) % 10 === Number(d[d.length - 1]); };
export type Symbology = 'EAN13' | 'EAN8' | 'UPC' | 'CODE128';
/**
 * Retail codes print as the retail barcode they are (EAN-13, EAN-8, UPC-A, check digit verified), so any shop's
 * scanner reads them; anything else as Code 128, which holds letters, digits and punctuation. A code with characters
 * no barcode can hold (Tamil, Hindi, ₹, emoji…) is refused with the character named, instead of printing a broken label.
 */
export function symbologyFor(raw: string): { format: Symbology; code: string } | { error: string } {
  const code = String(raw ?? '').trim();
  if (!code) return { error: 'No barcode or SKU' };
  const bad = [...code].find((ch) => ch.charCodeAt(0) < 32 || ch.charCodeAt(0) > 126);
  if (bad) return { error: `“${bad}” can’t go in a barcode: use English letters, digits and - . / in the barcode or SKU (the item name can be in any language)` };
  if (code.length > 48) return { error: 'Barcode is too long for a label (48 characters at most)' };
  if (/^\d{13}$/.test(code) && gs1Ok(code)) return { format: 'EAN13', code };
  if (/^\d{8}$/.test(code) && gs1Ok(code)) return { format: 'EAN8', code };
  if (/^\d{12}$/.test(code) && gs1Ok(code)) return { format: 'UPC', code };
  return { format: 'CODE128', code };
}

/**
 * Bar width so every bar lands on whole printer dots (203 dpi ≈ 8 dots per mm): uneven bars from stretching the
 * barcode to fit are the usual reason a printed label won't scan. modules: the barcode's width in narrow bars,
 * including the blank quiet zones a scanner needs on both sides.
 */
export function moduleMm(modules: number, availableMm: number): number {
  const dot = 0.125;
  const fit = Math.floor(availableMm / modules / dot) * dot;
  return Math.max(dot, Math.min(0.5, fit));
}

/** The nearest older label-size id, saved alongside a layout so older screens keep showing something sensible. */
export function legacySizeFor(l: LabelLayout): { printer: 'a4' | 'label'; labelSize: string } {
  const printer = l.stock === 'a4' ? 'a4' : 'label';
  const same = LABEL_SIZES.filter((x) => x.printer === printer);
  const best = same.reduce((a, x) => (Math.abs(x.w - l.w) + Math.abs(x.h - l.h) + Math.abs(x.perRow - l.across) * 20 < Math.abs(a.w - l.w) + Math.abs(a.h - l.h) + Math.abs(a.perRow - l.across) * 20 ? x : a), same[0]!);
  return { printer, labelSize: best.id };
}
