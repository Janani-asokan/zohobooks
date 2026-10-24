import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useItems, useTaxSlabs } from '@/api/hooks';
import type { Item } from '@/api/types';
import { money } from '@/lib/format';
import { matchItem } from '@/lib/match';
import { createItemFrom } from '@/lib/autoCreate';
import type { ExtractResult } from '../../shared/extract';

export interface ResolvedLine { item: Item; qty: number; rate: number | null; discount: number; taxRate: number | null }

/**
 * Matches the lines of an uploaded document to catalogue items for the review dialog and, on apply,
 * returns them ready for a form, creating the missing items when the user asked for it.
 */
export function useDocLines(purchase: boolean) {
  const items = useItems().data ?? [];
  const slabs = useTaxSlabs().data ?? [];
  const qc = useQueryClient();
  const [createMissing, setCreateMissing] = useState(true);
  const rowsOf = (r: ExtractResult) => r.data.lines.filter((l) => l.name).map((l) => ({ l, item: matchItem(items, l) }));

  const extra = (r: ExtractResult) => {
    const rows = rowsOf(r);
    if (!rows.length) return null;
    const missing = rows.filter((x) => !x.item).length;
    return (
      <div className="stack" style={{ gap: 8 }}>
        <div className="strong">Items in the document</div>
        <table className="table">
          <thead><tr><th>In the document</th><th className="num">Qty</th><th className="num">Rate</th><th>In your catalogue</th></tr></thead>
          <tbody>{rows.map(({ l, item }, i) => (
            <tr key={i}>
              <td>{l.name}{(l.sku || l.hsn) && <div className="muted">{[l.sku, l.hsn && `HSN ${l.hsn}`].filter(Boolean).join(' · ')}</div>}</td>
              <td className="num">{l.qty ?? 1}</td>
              <td className="num">{l.rate != null ? money(l.rate) : '—'}</td>
              <td>{item ? item.name : <span className="muted">Not found</span>}</td>
            </tr>
          ))}</tbody>
        </table>
        {missing > 0 && (
          <label className="row" style={{ gap: 8 }}>
            <input type="checkbox" className="checkbox" checked={createMissing} onChange={(e) => setCreateMissing(e.target.checked)} />
            Add the {missing} new item{missing > 1 ? 's' : ''} to the catalogue{purchase ? ' (cost from the document, selling price +20% to start)' : ' at the document’s price'}
          </label>
        )}
      </div>
    );
  };

  const resolve = async (r: ExtractResult): Promise<{ lines: ResolvedLine[]; skipped: number }> => {
    const out: ResolvedLine[] = [];
    let skipped = 0, created = 0;
    for (const { l, item } of rowsOf(r)) {
      let it = item;
      if (!it && createMissing) { try { it = await createItemFrom(l, slabs, purchase); created++; } catch { /* reported as skipped */ } }
      if (!it) { skipped++; continue; }
      const rate = l.rate ?? (l.amount != null && l.qty ? Math.round((l.amount / l.qty) * 100) / 100 : null);
      out.push({ item: it, qty: l.qty && l.qty > 0 ? l.qty : 1, rate, discount: Math.min(100, Math.max(0, l.discountPercent ?? 0)), taxRate: l.taxRate });
    }
    if (created) await qc.invalidateQueries({ queryKey: ['items'] });
    return { lines: out, skipped };
  };

  return { extra, resolve, count: (r: ExtractResult) => rowsOf(r).length };
}
