import { Plus, Trash2 } from 'lucide-react';
import type { Item } from '@/api/types';
import { ItemPicker } from '@/components/ItemPicker';
import { uid } from '@/lib/format';

export interface StockLine { key: string; itemId: string; qty: string; serials: string }
export const emptyStockLine = (): StockLine => ({ key: uid('sl_'), itemId: '', qty: '', serials: '' });
export const splitSerials = (s: string) => [...new Set(s.split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean))];

/** Stockable items only: goods that are not variant groups. */
export const stockable = (items: Item[]) => items.filter((i) => i.type === 'Goods' && !i.isGroup);

/**
 * Item + quantity rows for stock documents. `mode` decides the quantity column:
 * change (+/−), count (what is on the shelf) or move (units to send).
 */
export function StockLines({ lines, onChange, items, branchId, mode, error }: {
  lines: StockLine[]; onChange: (l: StockLine[]) => void; items: Item[]; branchId: string; mode: 'change' | 'count' | 'move'; error?: string;
}) {
  const goods = stockable(items);
  const upd = (key: string, p: Partial<StockLine>) => onChange(lines.map((l) => (l.key === key ? { ...l, ...p } : l)));
  const qtyLabel = mode === 'count' ? 'Counted' : mode === 'move' ? 'Qty to send' : 'Change (+ / −)';
  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className="table-wrap">
        <table className="table">
          <thead><tr><th style={{ minWidth: 260 }}>Item</th><th className="num" style={{ width: 110 }}>On hand</th><th className="num" style={{ width: 140 }}>{qtyLabel}</th>{mode !== 'move' && <th className="num" style={{ width: 110 }}>After</th>}<th style={{ width: 44 }} /></tr></thead>
          <tbody>
            {lines.map((l) => {
              const it = goods.find((i) => i.id === l.itemId);
              const onHand = it ? it.stockByBranch[branchId] ?? 0 : null;
              const n = Number(l.qty);
              const after = onHand === null || l.qty.trim() === '' ? null : mode === 'count' ? n : onHand + n;
              const short = onHand !== null && ((mode === 'move' && n > onHand) || (after !== null && after < 0));
              const serialList = splitSerials(l.serials);
              return (
                <tr key={l.key}>
                  <td>
                    <ItemPicker items={goods} value={l.itemId} tier="SP1" branchId={branchId} onPick={(id) => upd(l.key, { itemId: id })} />
                    {it?.trackSerials && mode === 'move' && (
                      <div style={{ marginTop: 6 }}>
                        <input className={`input ${serialList.length && serialList.length !== n ? 'invalid' : ''}`} value={l.serials} onChange={(e) => upd(l.key, { serials: e.target.value })} placeholder="Serial numbers, separated by commas or spaces" aria-label="Serial numbers" />
                        <div className="small muted">{serialList.length} of {n || 0} serial numbers</div>
                      </div>
                    )}
                  </td>
                  <td className="num muted">{onHand === null ? '—' : `${onHand} ${it!.unit}`}</td>
                  <td><input className={`input ${short ? 'invalid' : ''}`} style={{ textAlign: 'right' }} type="number" step="any" min={mode === 'change' ? undefined : 0} value={l.qty} onChange={(e) => upd(l.key, { qty: e.target.value })} aria-label={qtyLabel} /></td>
                  {mode !== 'move' && <td className="num" style={after !== null && after < 0 ? { color: 'var(--red-600)' } : undefined}>{after === null ? '—' : after}</td>}
                  <td><button type="button" className="icon-btn danger" aria-label="Remove line" onClick={() => onChange(lines.length > 1 ? lines.filter((x) => x.key !== l.key) : [emptyStockLine()])}><Trash2 size={15} /></button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {error && <div className="field-error">{error}</div>}
      <div><button type="button" className="btn btn-soft btn-sm" onClick={() => onChange([...lines, emptyStockLine()])}><Plus size={14} /> Add line</button></div>
    </div>
  );
}
