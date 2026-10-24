import { api } from '@/api/client';
import type { Item, TaxSlab, Vendor } from '@/api/types';
import type { ExtractedLine, ExtractedParty } from '../../shared/extract';
import { GSTIN_RE, INDIAN_STATES } from '../../shared/gst';

const clean = (s: string | null | undefined, max: number) => (s ?? '').trim().slice(0, max);

/** Adds a vendor read from a document. Invalid GSTINs are dropped rather than blocking the save. */
export function createVendorFrom(p: ExtractedParty) {
  const gstin = clean(p.gstin, 15).toUpperCase();
  return api.post<Vendor>('/shop/vendors', {
    name: clean(p.companyName || p.name, 150), gstin: GSTIN_RE.test(gstin) ? gstin : '', phone: clean(p.phone, 30), email: clean(p.email, 120),
    state: INDIAN_STATES.includes(p.state ?? '') ? p.state : '',
  });
}

/** Adds a catalogue item for a line that wasn't found. Prices start at the line rate; the user edits them later. */
export function createItemFrom(l: ExtractedLine, slabs: TaxSlab[], purchase: boolean) {
  const active = slabs.filter((s) => s.active);
  const slab = active.find((s) => s.rate === l.taxRate) ?? active.find((s) => s.rate === 18) ?? active[0];
  const unitPrice = l.rate ?? (l.amount && l.qty ? l.amount / l.qty : null) ?? l.sellingPrice ?? 0;
  const sell = l.sellingPrice ?? (purchase ? Math.ceil(unitPrice * 1.2) : unitPrice);
  const hsn = (l.hsn ?? '').replace(/\D/g, '').slice(0, 8);
  return api.post<Item>('/shop/items', {
    type: hsn.startsWith('99') ? 'Services' : 'Goods', name: clean(l.name, 150) || 'New item', sku: clean(l.sku, 40), barcode: clean(l.barcode, 14), unit: clean(l.unit, 12).toLowerCase() || (hsn.startsWith('99') ? 'job' : 'pcs'),
    hsn, cost: purchase ? unitPrice : l.costPrice ?? 0, sp1: sell || 1, sp2: sell || 1, sp3: sell || 1, mrp: l.mrp ?? null, taxSlabId: slab?.id, reorderLevel: 0, trackBatches: false,
    description: clean(l.description, 500), category: clean(l.category, 60), brand: clean(l.brand, 60), image: '', openingStock: 0,
  });
}
