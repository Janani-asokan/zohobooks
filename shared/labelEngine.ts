/**
 * Barcode & Labels layout engine (spec: Corpus360 Lite Barcode & Thermal Label Printing Module).
 *
 * One engine for every output: the on-screen preview, the exact-size browser page, the pre-print checks and the raw
 * printer commands (TSPL, ZPL, ESC/POS). Layout is in millimetres; output is in whole printer dots. Nothing here is
 * ever scaled by a fraction (TP-09, ML-11): a barcode either fits at a whole-dot module or it is refused.
 */

/* ============================== Stock (spec 4) ============================== */
export type Media = 'die-cut' | 'black-mark' | 'continuous';
export type Sheet = 'roll' | 'a4' | 'letter';
export interface StockGeometry {
  /** Label width × height as the label is read, mm (0.1 mm steps). */
  w: number; h: number;
  /** Labels across (1–4 on a roll; columns on a sheet). */
  across: number;
  /** Gap between labels across. */
  gutter: number;
  marginL: number; marginR: number;
  /** Gap between rows (die-cut gap on a roll; row gap on a sheet). */
  rowGap: number;
  media: Media;
  sheet: Sheet;
  /** Sheets only: rows per sheet and the sheet's top margin. */
  rows: number; marginTop: number;
  /** Elements must stay this far inside each label edge (default 1 mm). */
  safeInset: number;
}
export const SHEET_MM: Record<Exclude<Sheet, 'roll'>, { w: number; h: number; label: string }> = { a4: { w: 210, h: 297, label: 'A4' }, letter: { w: 215.9, h: 279.4, label: 'Letter' } };

const roll = (w: number, h: number, across: number, margin: number, gutter: number, media: Media = 'die-cut', rowGap = 3): StockGeometry =>
  ({ w, h, across, gutter, marginL: margin, marginR: margin, rowGap: media === 'continuous' ? 0 : rowGap, media, sheet: 'roll', rows: 0, marginTop: 0, safeInset: 1 });
const sheet = (s: Exclude<Sheet, 'roll'>, w: number, h: number, across: number, rows: number, marginL: number, marginTop: number, gutter: number, rowGap: number): StockGeometry =>
  ({ w, h, across, gutter, marginL, marginR: marginL, rowGap, media: 'die-cut', sheet: s, rows, marginTop, safeInset: 1 });

/** Standard presets (spec 4.1, plus common Indian and A4 / Letter sheet stock). Users clone or add their own. */
export const STOCK_PRESETS: Array<{ id: string; name: string; fits: string; stock: StockGeometry }> = [
  { id: '4in-100x50', name: '4-inch, single · 100 × 50', fits: '4-inch', stock: roll(100, 50, 1, 2, 0) },
  { id: '4in-100x75', name: '4-inch, single · 100 × 75', fits: '4-inch', stock: roll(100, 75, 1, 2, 0) },
  { id: '4in-100x100', name: '4-inch, square · 100 × 100', fits: '4-inch', stock: roll(100, 100, 1, 2, 0) },
  { id: '4in-100x150', name: '4-inch, shipping (4 × 6 in) · 100 × 150', fits: '4-inch', stock: roll(100, 150, 1, 2, 0) },
  { id: '4in-50x25x2', name: '2-up standard · 50 × 25', fits: '4-inch', stock: roll(50, 25, 2, 1, 2) },
  { id: '4in-33x25x3', name: '3-up · 33 × 25', fits: '4-inch', stock: roll(33, 25, 3, 0.5, 2) },
  { id: '4in-25x25x4', name: '4-up · 25 × 25', fits: '4-inch', stock: roll(25, 25, 4, 0.5, 1) },
  { id: '3in-38x25x2', name: '3-inch, 2-up · 38 × 25', fits: '3-inch, 4-inch', stock: roll(38, 25, 2, 1, 2) },
  { id: '50x25x1', name: '1-up standard · 50 × 25', fits: '3-inch, 4-inch', stock: roll(50, 25, 1, 1, 0) },
  { id: '3in-75x25', name: '3-inch, single · 75 × 25', fits: '3-inch, 4-inch', stock: roll(75, 25, 1, 1.5, 0) },
  { id: '3in-75x38', name: '3-inch, single · 75 × 38', fits: '3-inch, 4-inch', stock: roll(75, 38, 1, 1.5, 0) },
  { id: '3in-75x50', name: '3-inch, single · 75 × 50', fits: '3-inch, 4-inch', stock: roll(75, 50, 1, 1.5, 0) },
  { id: '3in-cont', name: '3-inch continuous · 72 wide', fits: '3-inch, 4-inch', stock: roll(72, 40, 1, 0, 0, 'continuous') },
  { id: '2in-cont', name: '2-inch continuous (POS-58) · 48 wide', fits: '2-inch, 3-inch, 4-inch', stock: roll(48, 30, 1, 0, 0, 'continuous') },
  { id: 'a4-65', name: 'A4 · 65 per sheet (38.1 × 21.2)', fits: 'A4 printer', stock: sheet('a4', 38.1, 21.2, 5, 13, 4.7, 10.7, 2.5, 0) },
  { id: 'a4-40', name: 'A4 · 40 per sheet (48.5 × 25.4)', fits: 'A4 printer', stock: sheet('a4', 48.5, 25.4, 4, 10, 7.5, 21.5, 0, 0) },
  { id: 'a4-24', name: 'A4 · 24 per sheet (63.5 × 33.9)', fits: 'A4 printer', stock: sheet('a4', 63.5, 33.9, 3, 8, 7.2, 12.9, 2.5, 0) },
  { id: 'a4-12', name: 'A4 · 12 per sheet (99.1 × 46.6)', fits: 'A4 printer', stock: sheet('a4', 99.1, 46.6, 2, 6, 4.6, 8.6, 2.5, 0) },
  { id: 'letter-30', name: 'Letter · 30 per sheet (66.7 × 25.4)', fits: 'Letter printer', stock: sheet('letter', 66.7, 25.4, 3, 10, 4.7, 12.7, 3.1, 0) },
];

const r1 = (n: number) => Math.round(n * 10) / 10;
/** Width of one printed row: RowWidth = mL + mR + n·w + (n−1)·g (spec 4.2). */
export const rowWidthMm = (s: StockGeometry) => r1(s.marginL + s.marginR + s.across * s.w + (s.across - 1) * s.gutter);
/** Row pitch along the feed: label height plus row gap (ML-06). */
export const rowPitchMm = (s: StockGeometry) => r1(s.h + s.rowGap);

/* ============================== Printers (spec 6.4) ============================== */
export type PrinterLanguage = 'browser' | 'tspl' | 'zpl' | 'escpos';
export interface PrinterSettings {
  language: PrinterLanguage;
  dpi: 203 | 300 | 600;
  /** Printable width of the head, mm (48 / 72 / 104 mm on 2 / 3 / 4-inch printers; 210 on A4). */
  headMm: number;
  media: Media;
  /** Calibrated shift of everything, mm, in 0.1 mm steps (TP-12). */
  offsetX: number; offsetY: number;
  darkness: number; speed: number;  // darkness 0–15, speed in inches per second
}
export const PRINTER_PRESETS: Array<{ id: string; name: string; settings: PrinterSettings }> = [
  // The shop's own printer first. Its head prints 104 mm (4.25 in), so it takes 3-inch and 4-inch rolls.
  { id: 'tvs-lp46-lite', name: 'TVS LP 46 Lite · 3-inch and 4-inch rolls (TSPL)', settings: { language: 'tspl', dpi: 203, headMm: 104, media: 'die-cut', offsetX: 0, offsetY: 0, darkness: 8, speed: 4 } },
  { id: 'label-4in-tspl', name: '4-inch label printer (TSC, Xprinter, TVS, Honeywell…) · TSPL', settings: { language: 'tspl', dpi: 203, headMm: 104, media: 'die-cut', offsetX: 0, offsetY: 0, darkness: 8, speed: 4 } },
  { id: 'label-4in-zpl', name: '4-inch label printer (Zebra) · ZPL', settings: { language: 'zpl', dpi: 203, headMm: 104, media: 'die-cut', offsetX: 0, offsetY: 0, darkness: 15, speed: 4 } },
  { id: 'label-4in-300', name: '4-inch label printer, 300 dpi', settings: { language: 'tspl', dpi: 300, headMm: 104, media: 'die-cut', offsetX: 0, offsetY: 0, darkness: 8, speed: 3 } },
  { id: 'receipt-3in', name: '3-inch receipt printer (80 mm) · ESC/POS', settings: { language: 'escpos', dpi: 203, headMm: 72, media: 'continuous', offsetX: 0, offsetY: 0, darkness: 8, speed: 6 } },
  { id: 'receipt-2in', name: '2-inch receipt printer (POS-58) · ESC/POS', settings: { language: 'escpos', dpi: 203, headMm: 48, media: 'continuous', offsetX: 0, offsetY: 0, darkness: 8, speed: 4 } },
  { id: 'office-a4', name: 'Office A4 / Letter printer (laser or inkjet)', settings: { language: 'browser', dpi: 600, headMm: 216, media: 'die-cut', offsetX: 0, offsetY: 0, darkness: 8, speed: 4 } },
];
/** Printer dots per mm: 203 dpi heads are 8 dots/mm and 300 dpi heads 12 dots/mm (how label printers are built). */
export const dotsPerMm = (dpi: number) => (dpi === 203 ? 8 : dpi === 300 ? 12 : dpi / 25.4);
/** Millimetres to whole printer dots. */
export const toDots = (mm: number, dpi: number) => Math.round(mm * dotsPerMm(dpi));

/* ============================== Symbologies (spec 5.3) ============================== */
export type Symbology = 'CODE128' | 'EAN13' | 'EAN8' | 'UPC' | 'QR';
const gs1Ok = (d: string) => { let t = 0; for (let i = 0; i < d.length - 1; i++) t += Number(d[d.length - 2 - i]) * (i % 2 === 0 ? 3 : 1); return (10 - (t % 10)) % 10 === Number(d[d.length - 1]); };
/** What a value prints as by default: a valid retail code as itself (check digit verified), otherwise Code 128. */
export function detectSymbology(value: string): Exclude<Symbology, 'QR'> {
  if (/^\d{13}$/.test(value) && gs1Ok(value)) return 'EAN13';
  if (/^\d{12}$/.test(value) && gs1Ok(value)) return 'UPC';
  if (/^\d{8}$/.test(value) && gs1Ok(value)) return 'EAN8';
  return 'CODE128';
}
/** Characters a barcode can hold. Code 128: printable ASCII. QR: anything (UTF-8). */
export function badChar(value: string, sym: Symbology): string | null {
  if (sym === 'QR') return null;
  return [...value].find((ch) => ch.charCodeAt(0) < 32 || ch.charCodeAt(0) > 126) ?? null;
}
/** Width of a Code 128 symbol in modules, switching to code C for runs of 4+ digits (as encoders do). */
export function code128Modules(value: string): number {
  let symbols = 1; // start
  let i = 0; let inC = false;
  while (i < value.length) {
    const run = /^\d+/.exec(value.slice(i))?.[0].length ?? 0;
    if (run >= 4 || (inC && run >= 2)) {
      if (!inC) { if (i > 0) symbols++; inC = true; }
      const pairs = Math.floor(run / 2); symbols += pairs; i += pairs * 2;
    } else {
      if (inC) { symbols++; inC = false; }
      symbols++; i++;
    }
  }
  symbols++; // check symbol
  return symbols * 11 + 13; // stop is 13 modules
}
/** Quiet zone each side, modules. */
export const QUIET: Record<Exclude<Symbology, 'QR'>, [number, number]> = { CODE128: [10, 10], EAN13: [11, 7], UPC: [9, 9], EAN8: [7, 7] };
export function barcodeModules(value: string, sym: Exclude<Symbology, 'QR'>): number {
  const body = sym === 'CODE128' ? code128Modules(value) : sym === 'EAN8' ? 67 : 95;
  return body + QUIET[sym][0] + QUIET[sym][1];
}
/** Smallest allowed narrow bar in whole dots: EAN/UPC never below the 0.264 mm GS1 minimum (ML-08). */
export function minModuleDots(sym: Symbology, dpi: number): number {
  if (sym === 'EAN13' || sym === 'UPC' || sym === 'EAN8') return Math.ceil(0.264 * dotsPerMm(dpi));
  if (sym === 'QR') return Math.max(3, Math.ceil(0.375 * dotsPerMm(dpi)) - (dpi > 250 ? 1 : 0));
  return Math.max(2, Math.ceil(0.19 * dotsPerMm(dpi)));
}
/** QR modules per side (with the 4-module quiet zone each side) for byte data at error correction M. */
export function qrModules(value: string): number {
  const bytes = new TextEncoder().encode(value).length;
  const cap = [14, 26, 42, 62, 84, 106, 122, 152, 180, 213];
  const v = cap.findIndex((c) => bytes <= c) + 1 || 11;
  return 17 + 4 * v + 8;
}
export interface BarcodeFit { ok: boolean; moduleDots: number; moduleMm: number; widthMm: number; modules: number; reason?: string; /** Retail code printed below the 0.264 mm GS1 minimum (down to 0.25 mm): shop scanners read it. */ small?: boolean }
/**
 * The largest whole-dot narrow bar at which the code fits the given width (never smaller than the minimum, never
 * stretched). Not ok when even the minimum is too wide: the label is refused, not shrunk (ML-11, QA-B05).
 */
export function fitBarcode(value: string, sym: Symbology, widthMm: number, dpi: number, maxModuleDots?: number): BarcodeFit {
  const modules = sym === 'QR' ? qrModules(value) : barcodeModules(value, sym);
  const dot = 1 / dotsPerMm(dpi);
  const min = minModuleDots(sym, dpi);
  // Never wider than 0.5 mm a bar (4 dots at 203 dpi, 6 at 300, 11 at 600): bigger buys nothing and wastes label.
  const cap = Math.max(min, maxModuleDots ?? Math.floor(0.5 * dotsPerMm(dpi) + 1e-9));
  const fits = Math.floor(widthMm / (modules * dot) + 1e-9);
  const moduleDots = Math.min(cap, fits);
  // EAN / UPC on a 38 mm label at 203 dpi: 3 dots (0.375 mm) is too wide and 2 dots (0.25 mm) is just under the GS1
  // 0.264 mm minimum. Every Indian 38 × 25 roll is printed that way and shop scanners read it: allowed, with a note.
  const compact = (sym === 'EAN13' || sym === 'UPC' || sym === 'EAN8') ? Math.max(2, Math.ceil(0.25 * dotsPerMm(dpi) - 1e-9)) : min;
  if (moduleDots < min && moduleDots >= compact) return { ok: true, small: true, moduleDots, moduleMm: moduleDots * dot, widthMm: modules * moduleDots * dot, modules };
  if (moduleDots < min) {
    return { ok: false, moduleDots: min, moduleMm: min * dot, widthMm: modules * min * dot, modules, reason: `needs ${r1(modules * min * dot)} mm at the smallest scannable size; the space is ${r1(widthMm)} mm` };
  }
  return { ok: true, moduleDots, moduleMm: moduleDots * dot, widthMm: modules * moduleDots * dot, modules };
}

/* ============================== Templates (spec 2.3) ============================== */
export const LABEL_FIELDS = ['name', 'sku', 'barcode', 'price', 'mrp', 'batch', 'expiry', 'unit', 'brand', 'category', 'location', 'company'] as const;
export type LabelField = (typeof LABEL_FIELDS)[number];
export const FIELD_LABEL: Record<LabelField, string> = {
  name: 'Item name', sku: 'SKU', barcode: 'Barcode value', price: 'Selling price', mrp: 'MRP', batch: 'Batch', expiry: 'Expiry',
  unit: 'Unit', brand: 'Brand', category: 'Category', location: 'Location', company: 'Business name',
};
export type ElementType = 'barcode' | 'qr' | 'field' | 'text' | 'line' | 'box';
export interface LabelElement {
  id: string; type: ElementType;
  /** Position and size on the label, mm, from its top-left corner. */
  x: number; y: number; w: number; h: number;
  field?: LabelField;      // field / barcode / qr: what it shows (barcode & qr default to the barcode value)
  text?: string;           // static text, or a prefix before a field ("MRP ")
  size?: number;           // text height, mm
  bold?: boolean;
  align?: 'left' | 'center' | 'right';
  maxLines?: number;
  overflow?: 'shrink' | 'truncate';
  minSize?: number;        // shrink stops here
  symbology?: 'auto' | Symbology;
  showValue?: boolean;     // barcode: print the value under the bars
  stroke?: number;         // line / box thickness, mm
}
export interface LabelTemplateBody { w: number; h: number; elements: LabelElement[] }
export interface LabelData {
  name: string; sku: string; barcode: string; price: number | null; mrp: number | null; batch: string; expiry: string;
  unit: string; brand: string; category: string; location: string; company: string;
}
const money = (n: number | null) => (n == null ? '' : `₹${Number.isInteger(n) ? n : n.toFixed(2)}`);
export function fieldText(f: LabelField, d: LabelData): string {
  switch (f) {
    case 'price': return money(d.price);
    case 'mrp': return money(d.mrp);
    case 'expiry': return d.expiry ? d.expiry.split('-').reverse().join('/') : '';
    default: return String(d[f] ?? '');
  }
}
export const elementText = (el: LabelElement, d: LabelData) =>
  el.type === 'text' ? el.text ?? '' : el.type === 'field' && el.field ? (fieldText(el.field, d) ? `${el.text ?? ''}${fieldText(el.field, d)}` : '') : '';
export const elementCode = (el: LabelElement, d: LabelData) => (el.field && el.field !== 'barcode' ? fieldText(el.field, d) : d.barcode || d.sku);
export function elementSymbology(el: LabelElement, code: string): Symbology {
  if (el.type === 'qr') return 'QR';
  return !el.symbology || el.symbology === 'auto' ? detectSymbology(code) : el.symbology;
}

/** Average character width / text height for a proportional sans font; used to predict wrapping and overflow. */
const CHAR_W = 0.56;
/**
 * How a text box will print: the size it ends up at and the lines it needs. Shrink: smaller until it fits (down to
 * minSize). Truncate: cut with an ellipsis. `overflow` is true when the text still does not fit (BL-11, QA-L10).
 */
export function fitText(text: string, el: Pick<LabelElement, 'w' | 'h' | 'size' | 'maxLines' | 'overflow' | 'minSize'>): { size: number; lines: number; overflow: boolean; text: string } {
  const start = el.size ?? 2.6; const min = Math.min(start, el.minSize ?? 1.6);
  const allowed = (s: number) => Math.max(1, Math.min(el.maxLines ?? 1, Math.floor(el.h / (s * 1.15)) || 1));
  const need = (s: number) => Math.ceil((text.length * s * CHAR_W) / Math.max(1, el.w));
  if (!text) return { size: start, lines: 0, overflow: false, text };
  if (el.overflow === 'truncate') {
    const cap = Math.max(1, Math.floor(el.w / (start * CHAR_W))) * allowed(start);
    return text.length <= cap ? { size: start, lines: need(start), overflow: false, text } : { size: start, lines: allowed(start), overflow: true, text: text.slice(0, Math.max(1, cap - 1)) + '…' };
  }
  let size = start;
  while (need(size) > allowed(size) && size - 0.1 >= min - 1e-9) size = Math.round((size - 0.1) * 10) / 10;
  return { size, lines: Math.min(need(size), allowed(size)), overflow: need(size) > allowed(size), text };
}

let seq = 0;
const eid = () => `e${Date.now().toString(36)}${(seq++).toString(36)}`;
/**
 * A starting layout for any label size, built from the label fields chosen in Print settings: business name, the
 * barcode, its value, the name, then prices. Used when a shop has no template yet, and as "Auto layout" in the designer.
 */
export function autoTemplate(w: number, h: number, show: Partial<Record<'company' | 'sku' | 'name' | 'mrp' | 'price' | 'category' | 'brand' | 'unit', { size: number; bold: boolean }>> = { company: { size: 22, bold: true }, name: { size: 22, bold: false }, mrp: { size: 22, bold: false }, price: { size: 22, bold: false } }, barcodeShare = 40): LabelTemplateBody {
  const inset = 1; const iw = w - inset * 2;
  // Settings size → mm (22 ≈ 2.9 mm on a 50 × 25 label). Bigger labels get bigger text, so a design fills a 100 × 100
  // label instead of printing as a small label in the middle of it.
  const grow = Math.max(1, Math.min(w / 50, h / 25, 3));
  const tmm = (s: number) => Math.round(s * 0.13 * grow * 100) / 100;
  const els: LabelElement[] = [];
  let y = inset;
  const line = (field: LabelField, o: { size: number; bold: boolean }, prefix = '') => {
    const size = Math.round(Math.min(tmm(o.size), h / 6) * 10) / 10; els.push({ id: eid(), type: 'field', field, text: prefix, x: inset, y: Math.round(y * 10) / 10, w: iw, h: Math.round(size * 12) / 10, size, bold: o.bold, align: 'center', maxLines: 1, overflow: 'shrink', minSize: 1.4 }); y += size * 1.2;
  };
  if (show.company) line('company', show.company);
  const bh = Math.round(Math.max(4, (h * barcodeShare) / 100) * 10) / 10;
  const narrow = w < 30; // 4-up and narrower: QR (spec 5)
  if (narrow) { const q = Math.min(iw, h - y - inset - 3); els.push({ id: eid(), type: 'qr', field: 'barcode', x: (w - q) / 2, y, w: q, h: q }); y += q + 0.3; }
  else { els.push({ id: eid(), type: 'barcode', field: 'barcode', x: inset, y: Math.round(y * 10) / 10, w: iw, h: bh, symbology: 'auto', showValue: !!show.sku }); y += bh + (show.sku ? 3 : 0.4); }
  if (show.name) line('name', show.name);
  for (const k of ['category', 'brand', 'unit'] as const) if (show[k]) line(k, show[k]!);
  if (show.mrp || show.price) {
    const size = Math.round(Math.min(tmm((show.mrp ?? show.price)!.size), h / 6) * 10) / 10; y = Math.round(y * 10) / 10;
    const half = iw / (show.mrp && show.price ? 2 : 1);
    if (show.mrp) els.push({ id: eid(), type: 'field', field: 'mrp', text: 'MRP ', x: inset, y, w: half, h: Math.round(size * 12) / 10, size, bold: show.mrp.bold, align: show.price ? 'left' : 'center', maxLines: 1, overflow: 'shrink', minSize: 1.4 });
    if (show.price) els.push({ id: eid(), type: 'field', field: 'price', text: show.mrp ? '' : 'Price ', x: inset + (show.mrp ? half : 0), y, w: half, h: Math.round(size * 12) / 10, size, bold: true, align: show.mrp ? 'right' : 'center', maxLines: 1, overflow: 'shrink', minSize: 1.4 });
  }
  const fitted = fitInside({ w, h, elements: els }, inset);
  // Big labels: put the design in the middle instead of leaving the bottom empty.
  const spare = h - inset - Math.max(...fitted.elements.map((e) => e.y + e.h));
  if (spare < 1.5) return fitted;
  const dy = Math.round((spare / 2) * 10) / 10;
  return { ...fitted, elements: fitted.elements.map((e) => ({ ...e, y: Math.round((e.y + dy) * 10) / 10 })) };
}

/**
 * MRP and price share a line. When one of them is blank for an item (no MRP), the other takes the whole line,
 * centred, instead of sitting at one edge next to an empty box.
 */
export function withLonePrices(t: LabelTemplateBody, d: LabelData): LabelElement[] {
  const blank = (e: LabelElement) => e.type === 'field' && (e.field === 'mrp' || e.field === 'price') && !fieldText(e.field, d);
  const pair = t.elements.filter((e) => e.type === 'field' && (e.field === 'mrp' || e.field === 'price'));
  if (pair.length !== 2 || Math.abs(pair[0]!.y - pair[1]!.y) > 0.3) return t.elements;
  const gone = pair.find(blank); const keep = pair.find((e) => !blank(e));
  if (!gone || !keep) return t.elements;
  const x = Math.min(pair[0]!.x, pair[1]!.x), w = Math.max(pair[0]!.x + pair[0]!.w, pair[1]!.x + pair[1]!.w) - x;
  return t.elements.filter((e) => e !== gone).map((e) => (e === keep ? { ...e, x, w, align: 'center' as const } : e));
}

/**
 * Keeps a stacked layout inside the safe area: if it runs past the bottom, the barcode gets shorter first (down to
 * 4 mm), then every text line shrinks together. Elements keep their order and stay a whole layout.
 */
function fitInside(t: LabelTemplateBody, inset: number): LabelTemplateBody {
  const bottom = () => Math.max(...t.elements.map((e) => e.y + e.h));
  let over = bottom() - (t.h - inset);
  if (over <= 0.01) return t;
  const els = t.elements.map((e) => ({ ...e }));
  const bar = els.find((e) => e.type === 'barcode' || e.type === 'qr');
  if (bar) {
    // A QR code stays square and at least 11 mm (version 1 at 3 dots per module, spec ML-10).
    const cut = Math.min(over, Math.max(0, bar.h - (bar.type === 'qr' ? 11 : 4)));
    bar.h = Math.round((bar.h - cut) * 10) / 10;
    if (bar.type === 'qr') { bar.w = bar.h; bar.x = Math.round(((t.w - bar.w) / 2) * 10) / 10; }
    for (const e of els) if (e.y > bar.y) e.y = Math.round((e.y - cut) * 10) / 10;
    over -= cut;
  }
  if (over > 0.01) {
    const texts = els.filter((e) => e.type === 'field' || e.type === 'text');
    const total = texts.reduce((a, e) => a + e.h, 0);
    const k = Math.max(0.5, (total - over) / total);
    let shift = 0; let lastY = -1;
    for (const e of [...els].sort((a, b) => a.y - b.y)) {
      if (e.y !== lastY) lastY = e.y;
      e.y = Math.round((e.y - shift) * 10) / 10;
      if (e.type === 'field' || e.type === 'text') { const nh = e.h * k; const d = e.h - nh; e.h = Math.round(nh * 10) / 10; e.size = Math.round((e.size ?? 2.6) * k * 10) / 10; if (!els.some((o) => o !== e && o.y === e.y && o.id < e.id)) shift += d; }
    }
  }
  return { ...t, elements: els };
}

/* ============================== Jobs and imposition (spec 3, 5) ============================== */
export interface JobLine { key: string; itemId: string | null; batch: string; qty: number; data: LabelData; location?: string; expiry?: string }
export interface ImposeOptions {
  fill: 'row' | 'column';                    // ML-02
  lastRow: 'blank' | 'repeat' | 'next';      // ML-03 (next: carry on with the next item, the default flow)
  keepTogether: boolean;                     // ML-04: each item starts a fresh row
  order: 'item' | 'source' | 'location';     // BP-06
  start: { row: number; col: number };       // ML-05: sheets, 1-based
  packFactor: number;                        // BP-02: labels per unit
  from: number;                              // BP-10: resume from this label number (1-based)
}
export const DEFAULT_IMPOSE: ImposeOptions = { fill: 'row', lastRow: 'next', keepTogether: false, order: 'item', start: { row: 1, col: 1 }, packFactor: 1, from: 1 };
export type Slot = { line: number; n: number } | null; // which job line, and which copy (1-based) it is
export interface Imposed { rows: Slot[][]; total: number; blanks: number; pages: Slot[][][] }

/** Labels per line: quantity × pack factor; zero and negative quantities print nothing (BP-03). */
export const labelsFor = (l: JobLine, o: Pick<ImposeOptions, 'packFactor'>) => Math.max(0, Math.floor(l.qty)) * Math.max(1, Math.floor(o.packFactor || 1));
export function orderLines(lines: JobLine[], order: ImposeOptions['order']): number[] {
  const idx = lines.map((_, i) => i);
  if (order === 'source') return idx;
  if (order === 'location') return idx.sort((a, b) => (lines[a]!.location ?? '').localeCompare(lines[b]!.location ?? '') || a - b);
  // Group by item: lines of the same item together, items in the order they first appear.
  const first = new Map<string, number>();
  lines.forEach((l, i) => { const k = l.itemId ?? l.key; if (!first.has(k)) first.set(k, i); });
  return idx.sort((a, b) => first.get(lines[a]!.itemId ?? lines[a]!.key)! - first.get(lines[b]!.itemId ?? lines[b]!.key)! || a - b);
}
/** Lays the job's labels out into rows of `across` (and sheets of rows), following the options. */
export function impose(lines: JobLine[], stock: StockGeometry, opts: Partial<ImposeOptions> = {}): Imposed {
  const o = { ...DEFAULT_IMPOSE, ...opts };
  const n = Math.max(1, stock.across);
  let slots: Slot[] = [];
  let blanks = 0;
  for (const li of orderLines(lines, o.order)) {
    const count = labelsFor(lines[li]!, o);
    if (!count) continue;
    if (o.keepTogether && slots.length % n) { const pad = n - (slots.length % n); blanks += pad; slots.push(...Array(pad).fill(null)); }
    for (let k = 1; k <= count; k++) slots.push({ line: li, n: k });
  }
  const total = slots.filter(Boolean).length;
  // Resume after a jam: drop the labels already printed.
  if (o.from > 1) { let seen = 0; slots = slots.filter((s) => { if (!s) return seen >= o.from - 1; seen++; return seen >= o.from; }); }
  // Sheets: skip the used positions on the first sheet (ML-05).
  if (stock.sheet !== 'roll') { const skip = Math.max(0, (o.start.row - 1) * n + (o.start.col - 1)); slots = [...Array(Math.min(skip, n * Math.max(1, stock.rows) - 1)).fill(null), ...slots]; }
  // Incomplete last row (ML-03).
  const rem = slots.length % n;
  if (rem) {
    const last = [...slots].reverse().find(Boolean) ?? null;
    const pad = n - rem;
    if (o.lastRow === 'repeat' && last) slots.push(...Array(pad).fill(null).map(() => ({ ...last })));
    else { blanks += pad; slots.push(...Array(pad).fill(null)); }
  }
  let rows: Slot[][] = [];
  if (o.fill === 'column') {
    // Column-first: fill down each column of a block (a sheet; on a roll, the whole job), then the next column.
    const per = stock.sheet !== 'roll' ? Math.max(1, stock.rows) : Math.ceil(slots.length / n);
    for (let b = 0; b < slots.length; b += per * n) {
      const block = slots.slice(b, b + per * n);
      const r = Math.ceil(block.length / n);
      for (let i = 0; i < r; i++) rows.push(Array.from({ length: n }, (_, c) => block[c * r + i] ?? null));
    }
  } else for (let i = 0; i < slots.length; i += n) rows.push(slots.slice(i, i + n));
  rows = rows.filter((r) => r.some(Boolean) || stock.sheet !== 'roll');
  const per = stock.sheet === 'roll' ? 1 : Math.max(1, stock.rows);
  const pages: Slot[][][] = [];
  for (let i = 0; i < rows.length; i += per) pages.push(rows.slice(i, i + per));
  return { rows, total, blanks, pages };
}
/** Footer figures (BP-04): labels, rows, roll length and print time. */
export function jobMetrics(imp: Imposed, stock: StockGeometry, printer?: Pick<PrinterSettings, 'speed'>) {
  const rows = imp.rows.length;
  const rollMm = stock.sheet === 'roll' ? Math.round(rows * rowPitchMm(stock)) : 0;
  const ips = Math.max(1, printer?.speed ?? 4);
  const seconds = stock.sheet === 'roll' ? Math.ceil(rollMm / (ips * 25.4)) + Math.ceil(rows * 0.05) : Math.ceil(imp.pages.length * 6);
  return { labels: imp.total, rows, sheets: stock.sheet === 'roll' ? 0 : imp.pages.length, rollMm, seconds, blanks: imp.blanks };
}
export const JOB_CONFIRM_ABOVE = 1000; // BP-05
export const JOB_MAX = 10000;

/* ============================== Pre-print checks (spec 3.3) ============================== */
export type Severity = 'blocker' | 'warning';
export interface Issue { severity: Severity; scope: 'line' | 'job'; line?: number; code: string; message: string }
export function validateJob(lines: JobLine[], tpl: LabelTemplateBody, stock: StockGeometry, printer: PrinterSettings, today = new Date().toISOString().slice(0, 10)): Issue[] {
  const out: Issue[] = [];
  const job = (code: string, message: string, severity: Severity = 'blocker') => out.push({ severity, scope: 'job', code, message });
  // Template size differs from stock size (RS-05: any stock with the same label size works).
  if (Math.abs(tpl.w - stock.w) > 0.25 || Math.abs(tpl.h - stock.h) > 0.25) job('size', `The template is ${tpl.w} × ${tpl.h} mm but the label stock is ${stock.w} × ${stock.h} mm. Pick a matching template or stock.`);
  // Printed area wider than the printer head (spec 4.2, 4.4).
  if (stock.sheet === 'roll') {
    const row = rowWidthMm(stock);
    // What actually prints: from the first label's safe area to the last one's (side margins are blank).
    const printed = row - stock.marginL - stock.marginR - 2 * stock.safeInset;
    if (printed > printer.headMm + 0.05) job('head', `These labels are ${r1(row)} mm across, but this printer prints only ${printer.headMm} mm wide. Choose the printer that takes this roll.`);
    else if (row > printer.headMm + 0.05) job('head-inset', `The row is ${row} mm on a ${printer.headMm} mm head: it prints only if every element stays ${stock.safeInset} mm inside the label edges.`, 'warning');
  } else {
    const sh = SHEET_MM[stock.sheet];
    if (rowWidthMm(stock) > sh.w + 0.05) job('sheet-w', `The labels need ${rowWidthMm(stock)} mm across, wider than ${sh.label} (${sh.w} mm).`);
    if (stock.marginTop + stock.rows * stock.h + (stock.rows - 1) * stock.rowGap > sh.h + 0.05) job('sheet-h', `The rows are taller than a ${sh.label} sheet (${sh.h} mm).`);
  }
  // Text over a barcode makes it unscannable (QA-L10).
  const codes = tpl.elements.filter((e) => e.type === 'barcode' || e.type === 'qr');
  const hit = (a: LabelElement, b: LabelElement) => a.x < b.x + b.w - 0.05 && b.x < a.x + a.w - 0.05 && a.y < b.y + b.h - 0.05 && b.y < a.y + a.h - 0.05;
  if (tpl.elements.some((e) => (e.type === 'field' || e.type === 'text') && codes.some((c) => hit(e, c))) || codes.some((c, i) => codes.some((d, j) => i < j && hit(c, d)))) job('overlap', 'Text or another code overlaps a barcode, so it may not scan. Move them apart.', 'warning');
  // Elements outside the safe area.
  for (const el of tpl.elements) if (el.x < stock.safeInset - 0.05 || el.y < stock.safeInset - 0.05 || el.x + el.w > tpl.w - stock.safeInset + 0.05 || el.y + el.h > tpl.h - stock.safeInset + 0.05) { job('safe', 'Some elements are outside the safe area, so they may be cut off at the label edge.', 'warning'); break; }
  const total = lines.reduce((s, l) => s + Math.max(0, Math.floor(l.qty)), 0);
  if (total > JOB_MAX) job('too-big', `${total.toLocaleString('en-IN')} labels is more than ${JOB_MAX.toLocaleString('en-IN')} in one job. Split it.`);
  lines.forEach((l, i) => {
    if (l.qty <= 0) return;
    const add = (severity: Severity, code: string, message: string) => out.push({ severity, scope: 'line', line: i, code, message });
    for (const el of tpl.elements) {
      if (el.type === 'barcode' || el.type === 'qr') {
        const code = elementCode(el, l.data);
        if (!code) { add('blocker', 'no-barcode', `${l.data.name}: no barcode or SKU to print.`); continue; }
        const sym = elementSymbology(el, code);
        const bad = badChar(code, sym);
        if (bad) { add('blocker', 'bad-char', `${l.data.name}: “${bad}” can’t go in a barcode. Use QR, or English letters and digits in the barcode or SKU.`); continue; }
        const fit = fitBarcode(code, sym, sym === 'QR' ? Math.min(el.w, el.h) : el.w, printer.dpi);
        if (!fit.ok) add('blocker', 'no-fit', `${l.data.name}: the barcode ${code} is too long for this label (it needs ${r1(fit.widthMm)} mm, the label has ${r1(sym === 'QR' ? Math.min(el.w, el.h) : el.w)} mm).`);
        else if (fit.small) add('warning', 'small-bars', `${l.data.name}: thin barcode bars to fit the label (scanners read them; check one).`);
        else if (sym === 'EAN13' || sym === 'UPC') {
          // Standard EAN-13 height is 69.24 modules (22.85 mm at 0.33 mm); a label too short for it truncates the bars (ML-09).
          const full = fit.moduleMm * 69.24;
          if (el.h < full * 0.5) add('warning', 'ean-short', `${l.data.name}: the EAN bars are cut to ${r1(el.h)} mm (standard ${r1(full)} mm). Fine for your own scanner; for supermarket tills use taller labels.`);
        }
      } else if (el.type === 'field' && el.field) {
        const v = fieldText(el.field, l.data);
        if (!v) { if (['price', 'mrp', 'batch', 'expiry'].includes(el.field)) add('warning', 'missing-field', `${l.data.name}: no ${FIELD_LABEL[el.field].toLowerCase()}; it prints blank.`); continue; }
        if (fitText(elementText(el, l.data), el).overflow) add('warning', 'overflow', `${l.data.name}: the ${FIELD_LABEL[el.field].toLowerCase()} is too long for its box and is cut short.`);
      }
    }
    const exp = l.expiry || l.data.expiry;
    if (exp) {
      if (exp < today) add('warning', 'expired', `${l.data.name}: batch ${l.batch || ''} expired on ${exp}.`);
      else if (Date.parse(exp) - Date.parse(today) < 30 * 864e5) add('warning', 'near-expiry', `${l.data.name}: batch ${l.batch || ''} expires on ${exp}.`);
    }
  });
  // One problem per line is enough to show.
  const seen = new Set<string>();
  return out.filter((x) => { const k = `${x.scope}:${x.line ?? ''}:${x.code}`; if (seen.has(k)) return false; seen.add(k); return true; });
}
export const blockedLines = (issues: Issue[]) => new Set(issues.filter((x) => x.severity === 'blocker' && x.scope === 'line').map((x) => x.line!));
export const jobBlocked = (issues: Issue[]) => issues.some((x) => x.severity === 'blocker' && x.scope === 'job');

/* ============================== Raw printer commands (spec 6.3) ============================== */
/** Where every element of a row lands, in printer dots (shared by all command generators). */
export function rowPlacements(row: Slot[], stock: StockGeometry, printer: PrinterSettings) {
  return row.map((slot, i) => {
    const xMm = stock.marginL + i * (stock.w + stock.gutter) + printer.offsetX;
    return { slot, x: toDots(xMm, printer.dpi), y: toDots(printer.offsetY, printer.dpi) };
  });
}
const nonLatin = (s: string) => /[^\x20-\x7e]/.test(s);
const tsplStr = (s: string) => s.replace(/"/g, '\\["]');
/**
 * Commands for one job, in the printer's own language. Native barcode and QR commands, so the printer draws them at
 * dot accuracy. Text in other scripts (Tamil, Hindi…) and the ₹ sign need a bitmap the printer can't make itself:
 * those elements are listed in `needsBitmap` (the print agent renders them; the browser and PDF paths print them as is).
 */
export function printerCommands(lang: Exclude<PrinterLanguage, 'browser'>, rows: Slot[][], lines: JobLine[], tpl: LabelTemplateBody, stock: StockGeometry, printer: PrinterSettings): { text: string; needsBitmap: string[] } {
  const d = (mm: number) => toDots(mm, printer.dpi);
  const needsBitmap: string[] = [];
  const out: string[] = [];
  const rowW = rowWidthMm(stock);
  if (lang === 'tspl') {
    out.push(`SIZE ${rowW} mm, ${stock.h} mm`, stock.media === 'continuous' ? 'GAP 0 mm, 0 mm' : stock.media === 'black-mark' ? `BLINE ${stock.rowGap} mm, 0 mm` : `GAP ${stock.rowGap} mm, 0 mm`,
      `DIRECTION 1`, `REFERENCE 0,0`, `DENSITY ${printer.darkness}`, `SPEED ${printer.speed}`);
  }
  for (const row of rows) {
    const place = rowPlacements(row, stock, printer);
    if (lang === 'tspl') out.push('CLS');
    if (lang === 'zpl') out.push('^XA', `^PW${d(rowW)}`, `^LL${d(stock.h)}`, `^LH0,0`, `~SD${String(Math.min(30, printer.darkness * 2)).padStart(2, '0')}`, `^PR${printer.speed}`);
    if (lang === 'escpos') out.push('\x1b@', `\x1dL${String.fromCharCode(d(stock.marginL) & 255, d(stock.marginL) >> 8)}`);
    for (const p of place) {
      if (!p.slot) continue;
      const data = lines[p.slot.line]!.data;
      for (const el of tpl.elements) {
        const x = p.x + d(el.x); const y = p.y + d(el.y);
        if (el.type === 'barcode' || el.type === 'qr') {
          const code = elementCode(el, data); const sym = elementSymbology(el, code);
          const fit = fitBarcode(code, sym, sym === 'QR' ? Math.min(el.w, el.h) : el.w, printer.dpi);
          if (!fit.ok) continue;
          const quietDots = sym === 'QR' ? 4 * fit.moduleDots : QUIET[sym as Exclude<Symbology, 'QR'>][0] * fit.moduleDots;
          const bx = x + Math.max(0, Math.round((d(el.w) - Math.round(fit.widthMm * dotsPerMm(printer.dpi))) / 2)) + quietDots;
          if (lang === 'tspl') out.push(sym === 'QR' ? `QRCODE ${bx},${y},M,${fit.moduleDots},A,0,"${tsplStr(code)}"` : `BARCODE ${bx},${y},"${sym === 'CODE128' ? '128M' : sym === 'EAN13' ? 'EAN13' : sym === 'EAN8' ? 'EAN8' : 'UPCA'}",${d(el.h) - (el.showValue ? d(2.4) : 0)},${el.showValue ? 2 : 0},0,${fit.moduleDots},${fit.moduleDots},"${tsplStr(code)}"`);
          if (lang === 'zpl') out.push(`^FO${bx},${y}`, sym === 'QR' ? `^BQN,2,${fit.moduleDots}^FDMA,${code}^FS` : `^BY${fit.moduleDots}${sym === 'CODE128' ? `^BCN,${d(el.h)},${el.showValue ? 'Y' : 'N'},N,N^FD${code}^FS` : sym === 'EAN13' ? `^BEN,${d(el.h)},${el.showValue ? 'Y' : 'N'},N^FD${code.slice(0, 12)}^FS` : sym === 'EAN8' ? `^B8N,${d(el.h)},${el.showValue ? 'Y' : 'N'},N^FD${code.slice(0, 7)}^FS` : `^BUN,${d(el.h)},${el.showValue ? 'Y' : 'N'},N,Y^FD${code.slice(0, 11)}^FS`}`);
          if (lang === 'escpos') {
            if (sym === 'QR') { const b = new TextEncoder().encode(code); const n = b.length + 3; out.push(`\x1d(k\x04\x00\x31\x41\x32\x00`, `\x1d(k\x03\x00\x31\x43${String.fromCharCode(fit.moduleDots)}`, `\x1d(k\x03\x00\x31\x45\x31`, `\x1d(k${String.fromCharCode(n & 255, n >> 8)}\x31\x50\x30${code}`, `\x1d(k\x03\x00\x31\x51\x30`); }
            else { const m = sym === 'CODE128' ? 73 : sym === 'EAN13' ? 67 : sym === 'EAN8' ? 68 : 65; const v = sym === 'CODE128' ? `{B${code}` : code; out.push(`\x1dw${String.fromCharCode(fit.moduleDots)}`, `\x1dh${String.fromCharCode(Math.min(255, d(el.h)))}`, `\x1dH${String.fromCharCode(el.showValue ? 2 : 0)}`, `\x1dk${String.fromCharCode(m, v.length)}${v}`); }
          }
        } else if (el.type === 'field' || el.type === 'text') {
          const t = el.type === 'text' ? el.text ?? '' : elementText(el, data);
          if (!t) continue;
          if (nonLatin(t)) { needsBitmap.push(t); continue; }
          const f = fitText(t, el); const hDots = d(f.size);
          if (lang === 'tspl') out.push(`TEXT ${x},${y},"0",0,${Math.max(1, Math.round(hDots / 12))},${Math.max(1, Math.round(hDots / 12))},"${tsplStr(f.text)}"`);
          if (lang === 'zpl') out.push(`^FO${x},${y}^A0N,${hDots},${hDots}^FB${d(el.w)},${el.maxLines ?? 1},0,${el.align === 'center' ? 'C' : el.align === 'right' ? 'R' : 'L'}^FD${f.text}^FS`);
          if (lang === 'escpos') out.push(`\x1ba${String.fromCharCode(el.align === 'center' ? 1 : el.align === 'right' ? 2 : 0)}`, `\x1bE${String.fromCharCode(el.bold ? 1 : 0)}`, `${f.text}\n`);
        } else if (el.type === 'line' || el.type === 'box') {
          const t = Math.max(1, d(el.stroke ?? 0.3));
          if (lang === 'tspl') out.push(el.type === 'box' ? `BOX ${x},${y},${x + d(el.w)},${y + d(el.h)},${t}` : `BAR ${x},${y},${d(el.w) || t},${d(el.h) || t}`);
          if (lang === 'zpl') out.push(`^FO${x},${y}^GB${d(el.w) || t},${d(el.h) || t},${t}^FS`);
        }
      }
    }
    if (lang === 'tspl') out.push('PRINT 1,1');
    if (lang === 'zpl') out.push('^PQ1', '^XZ');
    if (lang === 'escpos') out.push('\n\n\n', '\x1dV\x42\x00');
  }
  return { text: out.join(lang === 'escpos' ? '' : '\n') + (lang === 'escpos' ? '' : '\n'), needsBitmap: [...new Set(needsBitmap)] };
}

/* ============================== Calibration (TP-11) ============================== */
/** What a calibration print measures: a 100 mm ruler across and along the feed (or as long as the label allows). */
export const calibrationRuler = (stock: StockGeometry) => ({ across: Math.min(100, Math.floor(rowWidthMm(stock) - 2)), along: Math.min(100, Math.floor(stock.sheet === 'roll' ? stock.h - 2 : SHEET_MM[stock.sheet].h - 20)) });
