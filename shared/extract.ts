/* Document extraction: what we pull out of an uploaded PDF or photo, and the offline text parser
   used when no AI model is configured. Shared by the API (parsing) and the UI (types). */
import { GSTIN_RE, STATE_CODES, stateFromCode } from './gst';

export type ExtractKind = 'item' | 'bill' | 'expense' | 'customer' | 'vendor' | 'invoice' | 'order' | 'items';

export interface ExtractedParty {
  name: string | null; companyName: string | null; gstin: string | null; phone: string | null; email: string | null; address: string | null; state: string | null;
}
export interface ExtractedLine {
  name: string; description: string | null; sku: string | null; barcode: string | null; hsn: string | null; qty: number | null; unit: string | null;
  rate: number | null; mrp: number | null; sellingPrice: number | null; costPrice: number | null; discountPercent: number | null; taxRate: number | null;
  amount: number | null; brand: string | null; category: string | null;
}
export interface Extracted {
  documentType: 'invoice' | 'bill' | 'quotation' | 'purchase_order' | 'receipt' | 'product' | 'price_list' | 'gst_certificate' | 'business_card' | 'other';
  party: ExtractedParty;
  documentNumber: string | null; date: string | null; dueDate: string | null;
  subtotal: number | null; taxTotal: number | null; cgst: number | null; sgst: number | null; igst: number | null; total: number | null;
  lines: ExtractedLine[];
  notes: string | null;
}
export interface ExtractResult {
  data: Extracted;
  method: 'ai' | 'pdf-text' | 'ocr';
  /** Rough 0–1 score; offline parsing is a best effort and the UI asks the user to review. */
  confidence: number;
  warnings: string[];
  textPreview: string;
}

export const emptyParty = (): ExtractedParty => ({ name: null, companyName: null, gstin: null, phone: null, email: null, address: null, state: null });
export const emptyLine = (name = ''): ExtractedLine => ({
  name, description: null, sku: null, barcode: null, hsn: null, qty: null, unit: null, rate: null, mrp: null, sellingPrice: null, costPrice: null,
  discountPercent: null, taxRate: null, amount: null, brand: null, category: null,
});
export const emptyExtract = (): Extracted => ({
  documentType: 'other', party: emptyParty(), documentNumber: null, date: null, dueDate: null,
  subtotal: null, taxTotal: null, cgst: null, sgst: null, igst: null, total: null, lines: [], notes: null,
});

/**
 * Indian-style amounts: "₹30,000", "Rs. 1,25,000.50", "30k", "1.5 lakh", "2 cr", "INR 999/-".
 * Returns null when the text holds no amount.
 */
export function parseAmount(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const s = String(raw).toLowerCase().replace(/[₹]|rs\.?|inr|\/-/g, ' ').trim();
  const m = s.match(/(-?\d[\d,]*(?:\.\d+)?)\s*(k|thousand|l|lakh|lakhs|lac|lacs|cr|crore|crores)?\b/);
  if (!m) return null;
  let n = Number(m[1]!.replace(/,/g, ''));
  if (!Number.isFinite(n)) return null;
  const unit = m[2];
  if (unit === 'k' || unit === 'thousand') n *= 1_000;
  else if (unit && /^(l|lakh|lakhs|lac|lacs)$/.test(unit)) n *= 1_00_000;
  else if (unit && /^(cr|crore|crores)$/.test(unit)) n *= 1_00_00_000;
  return Math.round(n * 100) / 100;
}

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
const iso = (y: number, m: number, d: number) => (m >= 1 && m <= 12 && d >= 1 && d <= 31 ? `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}` : null);

/** Dates as Indian documents write them (day first): 18/10/2026, 18-10-26, 18.10.2026, 18 Oct 2026, 2026-10-18. */
export function parseDate(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = String(raw).trim();
  let m = s.match(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/);
  if (m) return iso(+m[1]!, +m[2]!, +m[3]!);
  m = s.match(/\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})\b/);
  if (m) { const y = +m[3]! < 100 ? 2000 + +m[3]! : +m[3]!; return iso(y, +m[2]!, +m[1]!); }
  m = s.match(/\b(\d{1,2})(?:st|nd|rd|th)?[\s-]+([a-z]{3,9})[\s,-]+(\d{2,4})\b/i);
  if (m && MONTHS[m[2]!.slice(0, m[2]!.toLowerCase().startsWith('sept') ? 4 : 3).toLowerCase()]) {
    const y = +m[3]! < 100 ? 2000 + +m[3]! : +m[3]!;
    return iso(y, MONTHS[m[2]!.slice(0, m[2]!.toLowerCase().startsWith('sept') ? 4 : 3).toLowerCase()]!, +m[1]!);
  }
  return null;
}

const AMT = String.raw`(?:₹|rs\.?|inr)?\s*(-?\d[\d,]*(?:\.\d+)?\s*(?:k|lakh|lakhs|lac|l|cr|crore)?)\b`;
/** The amount on the first line matching one of the labels, e.g. "Selling price: ₹30,000". */
function labelled(text: string, labels: string[]): number | null {
  for (const label of labels) {
    const re = new RegExp(String.raw`(?:^|\n|\s)${label}\s*(?:\(₹\)|\(rs\.?\)|\(inr\))?\s*[:=\-–]?\s*` + AMT, 'i');
    const m = text.match(re);
    if (m) { const n = parseAmount(m[1]); if (n !== null) return n; }
  }
  return null;
}
function labelledText(text: string, labels: string[], max = 120): string | null {
  for (const label of labels) {
    const m = text.match(new RegExp(String.raw`(?:^|\n)\s*${label}\s*[:\-–]\s*([^\n]{1,${max}})`, 'i'));
    if (m && m[1]!.trim()) return m[1]!.trim();
  }
  return null;
}
const lastAmountOnLine = (text: string, label: RegExp) => {
  for (const line of text.split('\n')) if (label.test(line)) {
    const nums = [...line.matchAll(/-?\d[\d,]*\.\d{2}\b|-?\d{1,3}(?:,\d{2,3})+\b|\b\d{3,}\b/g)].map((x) => parseAmount(x[0])).filter((n): n is number => n !== null);
    if (nums.length) return nums[nums.length - 1]!;
  }
  return null;
};

/**
 * Best-effort parse of text taken from a PDF or OCR. Finds GSTINs, numbers, dates, totals, prices and simple item rows.
 * `ownGstin` is the shop's own GSTIN, so a bill's vendor or an order's customer is the *other* party.
 */
export function parseDocumentText(text: string, kind: ExtractKind, ownGstin = ''): { data: Extracted; confidence: number } {
  const t = text.replace(/\r/g, '').replace(/[ \t]+/g, ' ');
  const out = emptyExtract();
  let hits = 0;

  // Document type
  out.documentType =
    /gst\s*reg(istration)?\s*certificate|form\s*gst\s*reg-06/i.test(t) ? 'gst_certificate'
    : /purchase\s*order|\bp\.?o\.?\s*(no|number)/i.test(t) ? 'purchase_order'
    : /quotation|estimate|proforma/i.test(t) ? 'quotation'
    : /price\s*list|rate\s*card|catalogue/i.test(t) ? 'price_list'
    : /tax\s*invoice|invoice|bill\s*of\s*supply/i.test(t) ? (kind === 'bill' || kind === 'expense' ? 'bill' : 'invoice')
    : /receipt|cash\s*memo/i.test(t) ? 'receipt'
    : kind === 'item' ? 'product' : 'other';

  // Party: first GSTIN that isn't ours
  const gstins = [...new Set((t.toUpperCase().match(/\b\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]\b/g) ?? []).filter((g) => GSTIN_RE.test(g)))];
  const gstin = gstins.find((g) => g !== ownGstin.toUpperCase()) ?? null;
  if (gstin) { out.party.gstin = gstin; out.party.state = stateFromCode(gstin.slice(0, 2)) || null; hits++; }
  const email = t.match(/[\w.+-]+@[\w-]+\.[\w.-]{2,}/);
  if (email) { out.party.email = email[0]; hits++; }
  const phone = t.match(/(?:\+91[\s-]?|0)?[6-9]\d{4}[\s-]?\d{5}\b/);
  if (phone) { out.party.phone = phone[0].replace(/\s+/g, ' ').trim(); hits++; }
  const legal = labelledText(t, ['legal name(?: of business)?', 'trade name', 'company name', 'business name', 'vendor name', 'supplier name', 'customer name', 'name']);
  const lines = t.split('\n').map((l) => l.trim()).filter(Boolean);
  // A name on the line after "Bill to" / "Sold by" / "From"
  const after = (re: RegExp) => { const i = lines.findIndex((l) => re.test(l)); return i >= 0 ? (lines[i]!.replace(re, '').replace(/^[:\s-]+/, '').trim() || lines[i + 1] || null) : null; };
  const partyName = legal ?? (kind === 'bill' || kind === 'expense' || kind === 'vendor' ? after(/^(sold by|from|supplier|vendor|seller)\b[:\s]*/i) : after(/^(bill(ed)? to|buyer|customer|consignee|ship(ped)? to)\b[:\s]*/i));
  const firstLine = lines.find((l) => /[a-z]{3}/i.test(l) && !/invoice|bill|receipt|quotation|order|gst|tax|page/i.test(l)) ?? null;
  const name = partyName ?? (kind === 'vendor' || kind === 'bill' || kind === 'expense' ? firstLine : null);
  if (name) { out.party.companyName = name.slice(0, 120); hits++; }
  const contact = labelledText(t, ['contact person', 'attn', 'proprietor', 'contact']);
  if (contact) out.party.name = contact.slice(0, 120);
  const addr = labelledText(t, ['principal place of business', 'address of principal place of business', 'address', 'billing address'], 240);
  if (addr) out.party.address = addr;
  if (!out.party.state) {
    const st = Object.keys(STATE_CODES).find((s) => new RegExp(`\\b${s.replace(/[&]/g, '.')}\\b`, 'i').test(t));
    if (st) out.party.state = st;
  }

  // Number and dates
  const num = t.match(/\b(?:invoice|inv|bill|quotation|quote|order|p\.?o\.?|receipt|voucher)\s*(?:no\.?|number|#)\s*[:.\-]?\s*([A-Z0-9][A-Z0-9/\-_.]{1,30})/i);
  if (num) { out.documentNumber = num[1]!.replace(/[.,]$/, ''); hits++; }
  const dateLine = t.match(/\b(?:invoice|bill|order|quotation|document|receipt)?\s*date\s*[:\-]?\s*([^\n]{6,20})/i);
  out.date = (dateLine && parseDate(dateLine[1])) ?? parseDate(t);
  if (out.date) hits++;
  const due = t.match(/\bdue\s*(?:date|on|by)?\s*[:\-]?\s*([^\n]{6,20})/i);
  out.dueDate = due ? parseDate(due[1]) : null;

  // Totals
  out.total = lastAmountOnLine(t, /\b(grand\s*total|total\s*amount|amount\s*payable|net\s*payable|invoice\s*total|total\s*\(₹\)|^total\b|\btotal\s*:)/i);
  out.subtotal = lastAmountOnLine(t, /\b(sub\s*-?\s*total|taxable\s*(value|amount)|total\s*before\s*tax)\b/i);
  out.cgst = lastAmountOnLine(t, /^\s*cgst\b|\bcgst\s*(@|amount|\d)/i);
  out.sgst = lastAmountOnLine(t, /^\s*(sgst|utgst)\b|\b(sgst|utgst)\s*(@|amount|\d)/i);
  out.igst = lastAmountOnLine(t, /^\s*igst\b|\bigst\s*(@|amount|\d)/i);
  const tax = [out.cgst, out.sgst, out.igst].filter((n): n is number => n !== null);
  out.taxTotal = tax.length ? Math.round(tax.reduce((a, b) => a + b, 0) * 100) / 100 : lastAmountOnLine(t, /\b(total\s*tax|gst\s*amount|tax\s*amount)\b/i);
  if (out.total !== null) hits++;
  if (out.subtotal === null && out.total !== null && out.taxTotal !== null) out.subtotal = Math.round((out.total - out.taxTotal) * 100) / 100;

  // Product fields (item uploads, or a single-product sheet)
  const productName = labelledText(t, ['product name', 'item name', 'product', 'item', 'model', 'description']);
  const rateMatch = t.match(/\b(?:gst|igst|tax)\s*(?:rate)?\s*[:@\-]?\s*(\d{1,2}(?:\.\d+)?)\s*%/i) ?? t.match(/\b(\d{1,2}(?:\.\d+)?)\s*%\s*(?:gst|igst)\b/i);
  const hsn = t.match(/\b(?:hsn|sac)(?:\s*\/\s*sac)?\s*(?:code)?\s*[:\-]?\s*(\d{4,8})\b/i);
  const product: ExtractedLine = {
    ...emptyLine(productName ?? (kind === 'item' ? firstLine ?? '' : '')),
    sku: labelledText(t, ['sku', 'item code', 'product code', 'part no\\.?', 'model no\\.?'], 40),
    barcode: (t.match(/\b(?:barcode|ean|upc|gtin)\s*[:\-]?\s*(\d{8,14})\b/i) ?? t.match(/\b(\d{13})\b/))?.[1] ?? null,
    hsn: hsn?.[1] ?? null,
    mrp: labelled(t, ['m\\.?r\\.?p\\.?', 'maximum retail price']),
    sellingPrice: labelled(t, ['selling price', 'sale price', 'offer price', 'special price', 'dealer price', 'price', 'rate', '\\bsp\\b']),
    costPrice: labelled(t, ['cost price', 'purchase price', 'landing cost', 'buying price', 'cost', '\\bcp\\b']),
    taxRate: rateMatch ? Number(rateMatch[1]) : null,
    unit: labelledText(t, ['unit', 'uom'], 12)?.split(/\s/)[0]?.toLowerCase() ?? null,
    brand: labelledText(t, ['brand', 'make', 'manufacturer'], 40),
    category: labelledText(t, ['category', 'product type', 'type'], 40),
    description: labelledText(t, ['description', 'specifications?', 'features?'], 300),
  };
  if (product.sellingPrice !== null || product.mrp !== null) hits++;

  // Table rows: "<name> <hsn> <qty> [unit] <rate> ... <amount>"
  const row = /^(?:\d{1,3}[.)]?\s+)?(.{3,80}?)\s+(\d{4,8})\s+(\d+(?:\.\d+)?)\s*([a-z]{2,6})?\s+([\d,]+(?:\.\d{1,2})?)\b.*?\s([\d,]+\.\d{2})\s*$/i;
  for (const l of lines) {
    const m = l.match(row);
    if (!m) continue;
    const rate = parseAmount(m[5]); const amount = parseAmount(m[6]);
    const pct = l.match(/\b(\d{1,2}(?:\.\d+)?)\s*%/);
    out.lines.push({ ...emptyLine(m[1]!.trim()), hsn: m[2]!, qty: Number(m[3]), unit: m[4]?.toLowerCase() ?? null, rate, sellingPrice: rate, amount, taxRate: pct ? Number(pct[1]) : null });
  }
  // Price lists: "<name> [HSN] [GST%] <price>" on each row.
  if (kind === 'items' && !out.lines.length) {
    for (const l of lines) {
      if (/^(s\.?\s?no|sl|item|product|description|particulars)\b/i.test(l) || /\b(total|page \d|price\s*list|catalogue|rate\s*card|quotation|valid (till|until|from)|w\.e\.f)/i.test(l)) continue;
      const m = l.match(/^(?:\d{1,3}[.)]?\s+)?([A-Za-z][^₹]{2,80}?)\s+((?:\d{4,8}\s+)?(?:\d{1,2}(?:\.\d+)?\s*%\s+)?)(?:₹|rs\.?|inr)?\s*([\d,]+(?:\.\d{1,2})?)\s*(?:\/-)?$/i);
      if (!m) continue;
      const price = parseAmount(m[3]);
      if (price === null || price <= 0) continue;
      const hsnM = m[2]!.match(/\b(\d{4,8})\b/); const pct = m[2]!.match(/(\d{1,2}(?:\.\d+)?)\s*%/);
      out.lines.push({ ...emptyLine(m[1]!.trim()), hsn: hsnM?.[1] ?? null, taxRate: pct ? Number(pct[1]) : null, sellingPrice: price, rate: price });
    }
  }
  if (out.lines.length) hits++;
  else if (product.name && (kind === 'item' || product.sellingPrice !== null || product.mrp !== null)) out.lines.push(product);
  else if (kind === 'item') out.lines.push(product);

  // Merge product-level details into a single line so item uploads get everything
  if (out.lines.length === 1) {
    const l = out.lines[0]!;
    for (const k of Object.keys(product) as Array<keyof ExtractedLine>) if (l[k] === null || l[k] === '') (l as unknown as Record<string, unknown>)[k] = product[k];
  }

  const notes = labelledText(t, ['terms(?: and conditions)?', 'notes?', 'remarks?'], 300);
  if (notes) out.notes = notes;
  // Confidence: the share of the fields this form needs that we found.
  const l0 = out.lines[0];
  const want: unknown[] = kind === 'item' ? [l0?.name, l0?.sellingPrice ?? l0?.rate, l0?.hsn, l0?.taxRate, l0?.mrp ?? l0?.costPrice]
    : kind === 'customer' || kind === 'vendor' ? [out.party.companyName ?? out.party.name, out.party.gstin, out.party.phone ?? out.party.email, out.party.address ?? out.party.state]
    : kind === 'items' ? [out.lines.length > 1 ? 1 : null, l0?.name, l0?.sellingPrice ?? l0?.rate]
    : [out.party.companyName ?? out.party.gstin, out.documentNumber, out.date, out.total, out.lines.length ? 1 : null];
  void hits;
  return { data: out, confidence: Math.min(0.85, Math.round((want.filter((v) => v !== null && v !== undefined && v !== '').length / want.length) * 0.85 * 100) / 100) };
}
