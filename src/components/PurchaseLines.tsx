import { Plus, Trash2 } from 'lucide-react';
import type { Item } from '@/api/types';
import { money, uid } from '@/lib/format';
import { Thumb } from './kit';

/* Line editor for purchase orders and itemised bills — priced at cost, not selling price. */

export interface PLine { key: string; itemId: string; qty: string; rate: string; taxRate: number }
export const emptyPLine = (): PLine => ({ key: uid('pl_'), itemId: '', qty: '1', rate: '', taxRate: 0 });
export const pLineFor = (it: Item, qty = 1): PLine => ({ key: uid('pl_'), itemId: it.id, qty: String(qty), rate: String(it.cost ?? 0), taxRate: it.taxRate });
export const pTotals = (lines: PLine[]) => {
  const valid = lines.filter((l) => l.itemId && Number(l.qty) > 0);
  const sub = valid.reduce((s, l) => s + Number(l.qty) * Number(l.rate || 0), 0);
  const tax = valid.reduce((s, l) => s + (Number(l.qty) * Number(l.rate || 0) * l.taxRate) / 100, 0);
  return { sub: Math.round(sub * 100) / 100, tax: Math.round(tax * 100) / 100, total: Math.round((sub + tax) * 100) / 100, count: valid.length };
};
export const toPurchaseInput = (lines: PLine[]) => lines.filter((l) => l.itemId && Number(l.qty) > 0).map((l) => ({ itemId: l.itemId, qty: Number(l.qty), rate: Number(l.rate || 0), taxRate: l.taxRate }));

export function PurchaseLinesEditor({ lines, onChange, items, error }: { lines: PLine[]; onChange: (l: PLine[]) => void; items: Item[]; error?: string }) {
  const upd = (key: string, patch: Partial<PLine>) => onChange(lines.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const t = pTotals(lines);
  return (
    <div>
      <div className="table-wrap pl-table">
        <table className="table">
          <thead>
            <tr><th style={{ minWidth: 240 }}>Item</th><th className="num" style={{ width: 90 }}>Qty</th><th className="num" style={{ width: 130 }}>Rate (cost)</th><th className="num" style={{ width: 70 }}>GST</th><th className="num" style={{ width: 120 }}>Amount</th><th style={{ width: 40 }} /></tr>
          </thead>
          <tbody>
            {lines.map((l) => {
              const it = items.find((i) => i.id === l.itemId);
              return (
                <tr key={l.key}>
                  <td>
                    <div className="row" style={{ gap: 8 }}>
                      {it && <Thumb name={it.name} image={it.image} size={32} />}
                      <select className="select" value={l.itemId} aria-label="Item"
                        onChange={(e) => { const n = items.find((i) => i.id === e.target.value); upd(l.key, n ? { itemId: n.id, rate: String(n.cost ?? 0), taxRate: n.taxRate } : { itemId: '' }); }}>
                        <option value="">Select an item…</option>
                        {items.map((i) => <option key={i.id} value={i.id}>{i.name}{i.sku ? ` · ${i.sku}` : ''}{i.type === 'Goods' ? ` (${i.stock} in stock)` : ''}</option>)}
                      </select>
                    </div>
                  </td>
                  <td className="num"><input className="input num" type="number" min={0} value={l.qty} onChange={(e) => upd(l.key, { qty: e.target.value })} aria-label="Quantity" /></td>
                  <td className="num"><input className="input num" type="number" min={0} value={l.rate} onChange={(e) => upd(l.key, { rate: e.target.value })} aria-label="Rate" /></td>
                  <td className="num muted">{l.itemId ? `${l.taxRate}%` : '—'}</td>
                  <td className="num strong">{money(Number(l.qty || 0) * Number(l.rate || 0))}</td>
                  <td><button className="icon-btn danger" aria-label="Remove line" onClick={() => onChange(lines.length > 1 ? lines.filter((x) => x.key !== l.key) : [emptyPLine()])}><Trash2 size={15} /></button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {error && <div className="field-error" style={{ marginTop: 6 }}>{error}</div>}
      <div className="row between" style={{ marginTop: 10, alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
        <button type="button" className="btn btn-soft btn-sm" onClick={() => onChange([...lines, emptyPLine()])}><Plus size={14} /> Add line</button>
        <div className="totals-mini">
          <div><span>Sub total</span><strong>{money(t.sub)}</strong></div>
          <div><span>GST (input credit)</span><strong>{money(t.tax)}</strong></div>
          <div className="grand"><span>Total</span><strong>{money(t.total)}</strong></div>
        </div>
      </div>
    </div>
  );
}
