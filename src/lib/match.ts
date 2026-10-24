import type { Item } from '@/api/types';
import type { ExtractedLine, ExtractedParty } from '../../shared/extract';

const norm = (s: string) => s.toLowerCase().replace(/&/g, ' and ').replace(/\b(pvt|private|ltd|limited|llp|co|company|india|the|m\/s)\b/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();
const tokens = (s: string) => new Set(norm(s).split(' ').filter((w) => w.length > 1));
/** Share of the shorter name's words found in the other (0–1). */
export function nameScore(a: string, b: string) {
  const A = tokens(a), B = tokens(b);
  if (!A.size || !B.size) return 0;
  let common = 0;
  for (const w of A) if (B.has(w)) common++;
  return common / Math.min(A.size, B.size);
}

/** Customer or vendor for an extracted party: same GSTIN, else a close name match. */
export function matchParty<T extends { id: string; name: string; gstin: string; companyName?: string }>(list: T[], p: ExtractedParty): T | null {
  if (p.gstin) { const g = list.find((x) => x.gstin && x.gstin.toUpperCase() === p.gstin!.toUpperCase()); if (g) return g; }
  const want = p.companyName || p.name;
  if (!want) return null;
  let best: T | null = null, score = 0;
  for (const x of list) {
    const s = Math.max(nameScore(want, x.companyName || x.name), nameScore(want, x.name));
    if (s > score) { best = x; score = s; }
  }
  return score >= 0.67 ? best : null;
}

/** Catalogue item for an extracted line: SKU or barcode, else name (helped by a matching HSN). */
export function matchItem(items: Item[], l: ExtractedLine): Item | null {
  const code = (v: string | null) => (v ?? '').trim().toLowerCase();
  if (l.sku) { const m = items.find((i) => i.sku && code(i.sku) === code(l.sku)); if (m) return m; }
  if (l.barcode) { const m = items.find((i) => i.barcode && i.barcode === l.barcode); if (m) return m; }
  let best: Item | null = null, score = 0;
  // Model numbers (tokens with digits) must agree: "HP 682 Ink" is not "HP 680 Ink".
  const models = (s: string) => [...tokens(s)].filter((w) => /\d/.test(w));
  const want = models(l.name);
  for (const i of items) {
    const have = models(i.name);
    if (want.length && have.length && !want.some((w) => have.includes(w))) continue;
    let s = nameScore(l.name, i.name);
    if (l.hsn && i.hsn && l.hsn.slice(0, 4) === i.hsn.slice(0, 4)) s += 0.15;
    if (s > score) { best = i; score = s; }
  }
  return score >= 0.6 ? best : null;
}
