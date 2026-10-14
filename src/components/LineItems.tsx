import { useState } from 'react';
import { Plus, Trash2, ScanBarcode, Percent, ReceiptIndianRupee, AlertTriangle } from 'lucide-react';
import { useItems } from '@/api/hooks';
import { useToast } from '@/context/ToastContext';
import { computeTotals, lineAmount } from '@/lib/calc';
import { money, uid } from '@/lib/format';
import { TIER_LABEL, type Item, type LineInput, type PriceTier } from '@/api/types';

/** Editable line held in form state (key is client-only). */
export interface DraftLine extends LineInput {
  key: string;
}

export const priceFor = (it: Item, tier: PriceTier) => (tier === 'SP1' ? it.sp1 : tier === 'SP2' ? it.sp2 : it.sp3);
export const emptyLine = (tier: PriceTier): DraftLine => ({ key: uid('ln_'), itemId: '', qty: 1, rate: 0, tier, discount: 0 });
export const toDraft = (l: { itemId: string; qty: number; tier: PriceTier; rate?: number; discount: number }): DraftLine => ({ key: uid('ln_'), itemId: l.itemId, qty: l.qty, tier: l.tier, rate: l.rate, discount: l.discount });
export const toInput = (lines: DraftLine[]): LineInput[] => lines.filter((l) => l.itemId).map(({ itemId, qty, tier, rate, discount }) => ({ itemId, qty, tier, rate, discount }));

/** Lines enriched with item tax rate for live totals (server recomputes authoritatively). */
export function useCalcLines(lines: DraftLine[]) {
  const { data: items = [] } = useItems();
  return lines
    .filter((l) => l.itemId)
    .map((l) => {
      const it = items.find((i) => i.id === l.itemId);
      return { qty: l.qty, rate: l.rate ?? (it ? priceFor(it, l.tier) : 0), discount: l.discount, taxRate: it?.taxRate ?? 0 };
    });
}

export function LineItemsEditor({ lines, onChange, defaultTier, withGst, invalidKeys, branchId }: {
  lines: DraftLine[]; onChange: (l: DraftLine[]) => void; defaultTier: PriceTier; withGst: boolean; invalidKeys?: Set<string>; branchId?: string | null;
}) {
  const { data: items = [] } = useItems();
  const toast = useToast();
  const [scan, setScan] = useState('');

  const set = (key: string, patch: Partial<DraftLine>) => onChange(lines.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  const pickItem = (key: string, itemId: string) => {
    const it = items.find((i) => i.id === itemId);
    const line = lines.find((l) => l.key === key)!;
    set(key, { itemId, rate: it ? priceFor(it, line.tier) : 0 });
  };

  const addByBarcode = (code: string) => {
    const it = items.find((i) => i.barcode === code || (i.sku && i.sku.toLowerCase() === code.toLowerCase()));
    setScan('');
    if (!it) return toast('error', 'No item with that barcode', code);
    const existing = lines.find((l) => l.itemId === it.id);
    if (existing) return set(existing.key, { qty: existing.qty + 1 });
    const fresh: DraftLine = { ...emptyLine(defaultTier), itemId: it.id, rate: priceFor(it, defaultTier) };
    const blankIdx = lines.findIndex((l) => !l.itemId);
    onChange(blankIdx >= 0 ? lines.map((l, i) => (i === blankIdx ? { ...fresh, key: l.key } : l)) : [...lines, fresh]);
  };

  const goods = items.filter((i) => i.type === 'Goods');
  const services = items.filter((i) => i.type === 'Services');

  return (
    <div className="card" style={{ boxShadow: 'none' }}>
      <div className="toolbar" style={{ background: 'var(--ink-50)', borderRadius: 'var(--radius) var(--radius) 0 0' }}>
        <strong style={{ color: 'var(--ink-900)' }}>Item table</strong>
        <div className="input-group" style={{ width: 300 }}>
          <span className="lead" style={{ color: 'var(--brand-600)' }}><ScanBarcode size={16} /></span>
          <input className="input" style={{ height: 36 }} placeholder="Scan barcode / SKU to add" value={scan} onChange={(e) => setScan(e.target.value.trim())} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); if (scan) addByBarcode(scan); } }} />
        </div>
      </div>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th style={{ minWidth: 260 }}>Item details</th>
              <th style={{ width: 90 }} className="num">Qty</th>
              <th style={{ width: 170 }}>Price tier</th>
              <th style={{ width: 130 }} className="num">Rate (₹)</th>
              <th style={{ width: 90 }} className="num">Disc %</th>
              <th style={{ width: 80 }} className="num">Tax</th>
              <th style={{ width: 130 }} className="num">Amount</th>
              <th style={{ width: 44 }} />
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => {
              const it = items.find((i) => i.id === l.itemId);
              const bad = invalidKeys?.has(l.key);
              const rate = l.rate ?? (it ? priceFor(it, l.tier) : 0);
              const branchStock = it && branchId ? it.stockByBranch[branchId] ?? 0 : it?.stock ?? 0;
              const short = it?.type === 'Goods' && l.qty > branchStock;
              return (
                <tr key={l.key}>
                  <td>
                    <select className={`select ${bad ? 'invalid' : ''}`} value={l.itemId} onChange={(e) => pickItem(l.key, e.target.value)} aria-label="Item">
                      <option value="">Select an item…</option>
                      {goods.length > 0 && <optgroup label="Goods">{goods.map((i) => <option key={i.id} value={i.id}>{i.name}{i.sku ? ` · ${i.sku}` : ''}</option>)}</optgroup>}
                      {services.length > 0 && <optgroup label="Services">{services.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}</optgroup>}
                    </select>
                    {it && (
                      <div className="small muted" style={{ marginTop: 4, display: 'flex', gap: 6, alignItems: 'center' }}>
                        {it.type === 'Goods' ? (
                          <span style={short ? { color: 'var(--amber-700)', fontWeight: 600 } : undefined}>
                            {short && <AlertTriangle size={12} style={{ verticalAlign: -2 }} />} {branchStock} {it.unit} in stock{branchId ? ' at this branch' : ''}
                          </span>
                        ) : `Service · per ${it.unit}`}
                        {it.hsn && <span>· {it.type === 'Goods' ? 'HSN' : 'SAC'} {it.hsn}</span>}
                        {it.trackBatches && <span>· batch-tracked (FEFO)</span>}
                      </div>
                    )}
                  </td>
                  <td><input className="input" style={{ textAlign: 'right' }} type="number" min={1} value={l.qty} onChange={(e) => set(l.key, { qty: Math.max(0, Number(e.target.value)) })} aria-label="Quantity" /></td>
                  <td>
                    <select className="select" value={l.tier} onChange={(e) => { const tier = e.target.value as PriceTier; set(l.key, { tier, rate: it ? priceFor(it, tier) : l.rate }); }} aria-label="Price tier">
                      {(Object.keys(TIER_LABEL) as PriceTier[]).map((t) => <option key={t} value={t}>{t} · {TIER_LABEL[t]}</option>)}
                    </select>
                  </td>
                  <td><input className="input" style={{ textAlign: 'right' }} type="number" min={0} value={rate} onChange={(e) => set(l.key, { rate: Math.max(0, Number(e.target.value)) })} aria-label="Rate" /></td>
                  <td><input className="input" style={{ textAlign: 'right' }} type="number" min={0} max={100} value={l.discount} onChange={(e) => set(l.key, { discount: Math.min(100, Math.max(0, Number(e.target.value))) })} aria-label="Discount" /></td>
                  <td className="num">{withGst && it ? <span className="chip">{it.taxRate}%</span> : <span className="muted small">—</span>}</td>
                  <td className="num strong">{money(lineAmount({ qty: l.qty, rate, discount: l.discount, taxRate: 0 }))}</td>
                  <td>
                    <button type="button" className="icon-btn danger" disabled={lines.length === 1} onClick={() => onChange(lines.filter((x) => x.key !== l.key))} aria-label="Remove line"><Trash2 size={15} /></button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div style={{ padding: 12, borderTop: '1px solid var(--border)' }}>
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => onChange([...lines, emptyLine(defaultTier)])}><Plus size={14} /> Add new row</button>
      </div>
    </div>
  );
}

/** The global Net vs GST switch shown on invoice & sales-order forms. */
export function TaxModeToggle({ withGst, onChange, disabled }: { withGst: boolean; onChange: (v: boolean) => void; disabled?: string }) {
  return (
    <div className="segmented" role="radiogroup" aria-label="Tax calculation mode" style={{ padding: 4 }} title={disabled}>
      <button type="button" className={!withGst ? 'active' : ''} onClick={() => onChange(false)} style={{ padding: '9px 14px' }}>
        <ReceiptIndianRupee size={15} /> Calculate Net Price (No Tax)
      </button>
      <button type="button" className={withGst ? 'active' : ''} onClick={() => !disabled && onChange(true)} style={{ padding: '9px 14px', opacity: disabled ? 0.5 : 1 }} disabled={!!disabled}>
        <Percent size={15} /> Calculate with GST
      </button>
    </div>
  );
}

export function TotalsPanel({ lines, withGst, interState, tcsRate = 0 }: { lines: Array<{ qty: number; rate: number; taxRate: number; discount?: number }>; withGst: boolean; interState: boolean; tcsRate?: number }) {
  const t = computeTotals(lines, withGst, interState, tcsRate);
  const Row = ({ l, v, strong }: { l: string; v: string; strong?: boolean }) => (
    <div className="row between" style={{ padding: '7px 0', fontWeight: strong ? 700 : 500, color: strong ? 'var(--ink-900)' : 'var(--ink-600)' }}>
      <span>{l}</span>
      <span style={{ fontVariantNumeric: 'tabular-nums' }}>{v}</span>
    </div>
  );
  return (
    <div className="card" style={{ padding: 18, background: 'var(--ink-50)', boxShadow: 'none' }}>
      <Row l="Sub total" v={money(t.subTotal)} strong />
      {t.discount > 0 && <Row l="Discount (incl. above)" v={`− ${money(t.discount)}`} />}
      {withGst ? (
        t.breakup.map((b) =>
          interState ? <Row key={b.rate} l={`IGST ${b.rate}% on ${money(b.taxable)}`} v={money(b.tax)} /> : (
            <div key={b.rate}>
              <Row l={`CGST ${b.rate / 2}%`} v={money(b.tax / 2)} />
              <Row l={`SGST ${b.rate / 2}%`} v={money(b.tax / 2)} />
            </div>
          ),
        )
      ) : (
        <div className="small" style={{ padding: '8px 10px', margin: '6px 0', borderRadius: 8, background: 'var(--amber-50)', color: 'var(--amber-700)' }}>No tax is applied to this document.</div>
      )}
      {t.tcs > 0 && <Row l={`TCS ${tcsRate}%`} v={money(t.tcs)} />}
      {Math.abs(t.roundOff) > 0.001 && <Row l="Round off" v={money(t.roundOff)} />}
      <div className="divider" style={{ margin: '10px 0' }} />
      <div className="row between">
        <span style={{ fontWeight: 700, color: 'var(--ink-900)', fontSize: 15 }}>Total (₹)</span>
        <span style={{ fontWeight: 800, color: 'var(--brand-700)', fontSize: 22 }}>{money(t.total)}</span>
      </div>
    </div>
  );
}
