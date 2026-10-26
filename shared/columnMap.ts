/* Column mapping for imports from other software (Tally, Vyapar, Busy, Zoho, Marg, Excel sheets).
   The offline matcher handles common header names; AI handles the rest. Shared by the API and the UI. */

export type ImportKind = 'customers' | 'vendors' | 'items';
export interface FieldDef { key: string; label: string; required?: boolean; synonyms: string[] }

export const IMPORT_FIELDS: Record<ImportKind, FieldDef[]> = {
  customers: [
    { key: 'name', label: 'Name', required: true, synonyms: ['name', 'customer name', 'party name', 'party', 'ledger name', 'ledger', 'contact name', 'customer', 'display name', 'buyer'] },
    { key: 'company', label: 'Company', synonyms: ['company', 'company name', 'business name', 'firm', 'firm name', 'trade name', 'organisation', 'organization'] },
    { key: 'gstin', label: 'GSTIN', synonyms: ['gstin', 'gst no', 'gst number', 'gstin/uin', 'gst in', 'gst', 'tax id', 'gst registration'] },
    { key: 'phone', label: 'Phone', synonyms: ['phone', 'mobile', 'mobile no', 'phone no', 'contact no', 'contact number', 'whatsapp', 'cell', 'telephone'] },
    { key: 'email', label: 'Email', synonyms: ['email', 'e-mail', 'email id', 'mail'] },
    { key: 'state', label: 'State', synonyms: ['state', 'state name', 'place of supply', 'region'] },
    { key: 'address', label: 'Address', synonyms: ['address', 'billing address', 'address line 1', 'street', 'city', 'location'] },
  ],
  vendors: [
    { key: 'name', label: 'Name', required: true, synonyms: ['name', 'vendor name', 'supplier name', 'supplier', 'vendor', 'party name', 'party', 'ledger name', 'company name', 'firm name'] },
    { key: 'gstin', label: 'GSTIN', synonyms: ['gstin', 'gst no', 'gst number', 'gstin/uin', 'gst', 'tax id'] },
    { key: 'phone', label: 'Phone', synonyms: ['phone', 'mobile', 'mobile no', 'contact no', 'contact number', 'telephone'] },
    { key: 'email', label: 'Email', synonyms: ['email', 'e-mail', 'email id'] },
    { key: 'state', label: 'State', synonyms: ['state', 'state name', 'region'] },
  ],
  items: [
    { key: 'name', label: 'Item name', required: true, synonyms: ['name', 'item name', 'item', 'product name', 'product', 'stock item', 'description', 'particulars', 'item description'] },
    { key: 'sku', label: 'SKU / code', synonyms: ['sku', 'item code', 'code', 'product code', 'part no', 'model no', 'alias'] },
    { key: 'barcode', label: 'Barcode', synonyms: ['barcode', 'ean', 'upc', 'bar code'] },
    { key: 'unit', label: 'Unit', synonyms: ['unit', 'uom', 'units', 'base unit', 'unit of measure'] },
    { key: 'hsn', label: 'HSN/SAC', synonyms: ['hsn', 'hsn code', 'hsn/sac', 'sac', 'hsn sac'] },
    { key: 'cost', label: 'Cost price', synonyms: ['cost', 'cost price', 'purchase price', 'purchase rate', 'buying price', 'landing cost', 'standard cost'] },
    { key: 'sp1', label: 'Selling price', required: true, synonyms: ['price', 'selling price', 'sale price', 'sales price', 'rate', 'sp', 'mrp', 'standard price', 'retail price'] },
    { key: 'tax_rate', label: 'GST %', synonyms: ['gst', 'gst %', 'gst rate', 'tax', 'tax %', 'tax rate', 'igst', 'igst %', 'gst percent'] },
    { key: 'stock', label: 'Opening stock', synonyms: ['stock', 'opening stock', 'quantity', 'qty', 'opening qty', 'closing stock', 'current stock', 'balance qty', 'in stock'] },
    { key: 'reorder_level', label: 'Reorder level', synonyms: ['reorder level', 'min stock', 'minimum stock', 'reorder', 'min qty'] },
  ],
};

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9%/]+/g, ' ').trim();

/** Best guess of which file column holds each field, from header names alone. */
export function guessMapping(kind: ImportKind, headers: string[]): Record<string, string | null> {
  const used = new Set<string>();
  const out: Record<string, string | null> = Object.fromEntries(IMPORT_FIELDS[kind].map((f) => [f.key, null]));
  // Exact header names first for every field, so "HSN Code" goes to HSN before "code" can claim it for SKU.
  for (const f of IMPORT_FIELDS[kind]) {
    const hit = headers.find((h) => !used.has(h) && f.synonyms.includes(norm(h)));
    if (hit) { out[f.key] = hit; used.add(hit); }
  }
  for (const f of IMPORT_FIELDS[kind]) {
    if (out[f.key]) continue;
    const hit = headers.find((h) => !used.has(h) && f.synonyms.some((s) => s.length > 3 && s.includes(' ') && norm(h).includes(s)))
      ?? headers.find((h) => !used.has(h) && f.synonyms.some((s) => s.length > 3 && norm(h).split(' ').includes(s)));
    if (hit) { out[f.key] = hit; used.add(hit); }
  }
  return out;
}

/** Which kind of list a file most likely is, from its headers. */
export function guessKind(headers: string[]): ImportKind {
  const h = headers.map(norm).join(' ');
  if (/hsn|sku|item|product|stock|uom|unit|price|rate/.test(h) && !/supplier|vendor/.test(h)) return 'items';
  if (/supplier|vendor|creditor/.test(h)) return 'vendors';
  return 'customers';
}

/** Applies a mapping: rows keyed by the file's headers → rows keyed by our field keys. */
export function applyMapping(rows: Array<Record<string, string>>, mapping: Record<string, string | null>): Array<Record<string, string>> {
  return rows.map((r) => Object.fromEntries(Object.entries(mapping).filter(([, h]) => h).map(([k, h]) => [k, (r[h!] ?? '').trim()])));
}

/** "₹1,250.00", "1250/-", "18%" → number. */
export const cleanNumber = (v: string | undefined) => {
  const m = (v ?? '').replace(/,/g, '').match(/-?\d+(?:\.\d+)?/);
  return m ? Number(m[0]) : NaN;
};
