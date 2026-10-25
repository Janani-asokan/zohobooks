import { useState } from 'react';
import { Plus, Trash2, ScanBarcode, Percent, ReceiptIndianRupee, AlertTriangle, Tag, BadgeIndianRupee } from 'lucide-react';
import { useItems } from '@/api/hooks';
import { useToast } from '@/context/ToastContext';
import { applyBillAdjustments, computeTotals, lineAmount, type BillDiscount } from '@/lib/calc';
import { money, uid } from '@/lib/format';
import { TIER_LABEL, type Item, type LineInput, type PriceTier } from '@/api/types';
import { ItemPicker } from './ItemPicker';
import { SerialField } from './SerialField';

/** Editable line held in form state (key is client-only). */
export interface DraftLine extends LineInput {
  key: string;
}

const tierPrice = (it: Item, tier: PriceTier) => (tier === 'SP1' ? it.sp1 : tier === 'SP2' ? it.sp2 : it.sp3);
/** The price to put on a line. With MRP billing it's the GST-inclusive price: the MRP for the standard tier, else price + GST. */
export const priceFor = (it: Item, tier: PriceTier, inclusive = false) =>
  !inclusive ? tierPrice(it, tier) : tier === 'SP1' && it.mrp ? it.mrp : Math.round(tierPrice(it, tier) * (1 + it.taxRate / 100) * 100) / 100;
/** Switching MRP billing on or off converts the rates already on the bill so the amounts keep their meaning. */
export const convertRates = (lines: DraftLine[], items: Item[], toInclusive: boolean): DraftLine[] => lines.map((l) => {
  const it = items.find((i) => i.id === l.itemId);
  if (!it || l.rate == null) return l;
  const exact = priceFor(it, l.tier, !toInclusive);
  if (Math.abs(exact - l.rate) < 0.01) return { ...l, rate: priceFor(it, l.tier, toInclusive) };
  const f = 1 + it.taxRate / 100;
  return { ...l, rate: Math.round((toInclusive ? l.rate * f : l.rate / f) * 100) / 100 };
});
export const emptyLine = (tier: PriceTier): DraftLine => ({ key: uid('ln_'), itemId: '', qty: 1, rate: 0, tier, discount: 0 });
export const toDraft = (l: { itemId: string; qty: number; tier: PriceTier; rate?: number; discount: number; serials?: string[]; enteredRate?: number; enteredDiscount?: number }): DraftLine =>
  ({ key: uid('ln_'), itemId: l.itemId, qty: l.qty, tier: l.tier, rate: l.enteredRate ?? l.rate, discount: l.enteredDiscount ?? l.discount, serials: l.serials });
export const toInput = (lines: DraftLine[]): LineInput[] => lines.filter((l) => l.itemId).map(({ itemId, qty, tier, rate, discount, serials }) => ({ itemId, qty, tier, rate, discount, ...(serials?.length ? { serials } : {}) }));

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

export function LineItemsEditor({ lines, onChange, defaultTier, withGst, invalidKeys, branchId, inclusive = false }: {
  lines: DraftLine[]; onChange: (l: DraftLine[]) => void; defaultTier: PriceTier; withGst: boolean; invalidKeys?: Set<string>; branchId?: string | null; inclusive?: boolean;
}) {
  const items = (useItems().data ?? []).filter((i) => !i.isGroup);
  const toast = useToast();
  const [scan, setScan] = useState('');

  const set = (key: string, patch: Partial<DraftLine>) => onChange(lines.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  const pickItem = (key: string, itemId: string) => {
    const it = items.find((i) => i.id === itemId);
    const line = lines.find((l) => l.key === key)!;
    set(key, { itemId, rate: it ? priceFor(it, line.tier, inclusive) : 0 });
    // Next stop is quantity, so a line is: type, Enter, quantity, Tab.
    requestAnimationFrame(() => document.querySelector<HTMLInputElement>(`[data-line="${key}"] input[aria-label="Quantity"]`)?.select());
  };

  const addByBarcode = (code: string) => {
    const it = items.find((i) => i.barcode === code || (i.sku && i.sku.toLowerCase() === code.toLowerCase()));
    setScan('');
    if (!it) return toast('error', 'No item with that barcode', code);
    const existing = lines.find((l) => l.itemId === it.id);
    if (existing) return set(existing.key, { qty: existing.qty + 1 });
    const fresh: DraftLine = { ...emptyLine(defaultTier), itemId: it.id, rate: priceFor(it, defaultTier, inclusive) };
    const blankIdx = lines.findIndex((l) => !l.itemId);
    onChange(blankIdx >= 0 ? lines.map((l, i) => (i === blankIdx ? { ...fresh, key: l.key } : l)) : [...lines, fresh]);
  };


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
              <th style={{ width: 130 }} className="num">{inclusive ? "Rate incl. GST" : "Rate (₹)"}</th>
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
                <tr key={l.key} data-line={l.key}>
                  <td>
                    <ItemPicker items={items} value={l.itemId} tier={l.tier} onPick={(id) => pickItem(l.key, id)} invalid={bad} branchId={branchId} />
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
                    {it?.trackSerials && <SerialField itemId={it.id} branchId={branchId} qty={l.qty} value={l.serials ?? []} onChange={(serials) => set(l.key, { serials })} />}
                  </td>
                  <td><input className="input" style={{ textAlign: 'right' }} type="number" min={1} value={l.qty} onChange={(e) => set(l.key, { qty: Math.max(0, Number(e.target.value)) })} aria-label="Quantity" /></td>
                  <td>
                    <select className="select" value={l.tier} onChange={(e) => { const tier = e.target.value as PriceTier; set(l.key, { tier, rate: it ? priceFor(it, tier, inclusive) : l.rate }); }} aria-label="Price tier">
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

export interface BillOptions { pricesIncludeTax: boolean; billDiscount: BillDiscount | null }

/** MRP billing and a discount on the whole bill. */
export function BillOptionsCard({ value, onChange, withGst }: { value: BillOptions; onChange: (v: BillOptions) => void; withGst: boolean }) {
  const d = value.billDiscount ?? { kind: 'percent' as const, value: 0 };
  return (
    <div className="card bill-options" style={{ padding: 14, boxShadow: 'none' }}>
      {withGst && (
        <>
          <label className="row between" style={{ cursor: 'pointer', gap: 12 }}>
            <span className="row" style={{ gap: 10 }}>
              <span className="bo-icon"><BadgeIndianRupee size={16} /></span>
              <span><span className="strong" style={{ color: 'var(--ink-900)', display: 'block' }}>Prices include GST (MRP billing)</span><span className="small muted">Type the price the customer pays; GST is worked out inside it</span></span>
            </span>
            <input type="checkbox" className="checkbox" checked={value.pricesIncludeTax} onChange={(e) => onChange({ ...value, pricesIncludeTax: e.target.checked })} aria-label="Prices include GST" />
          </label>
          <div className="divider" style={{ margin: '12px 0' }} />
        </>
      )}
      <div className="row between" style={{ gap: 12, flexWrap: 'wrap' }}>
        <span className="row" style={{ gap: 10 }}>
          <span className="bo-icon"><Tag size={16} /></span>
          <span><span className="strong" style={{ color: 'var(--ink-900)', display: 'block' }}>Discount on the whole bill</span><span className="small muted">On top of any item discounts, before GST</span></span>
        </span>
        <span className="row" style={{ gap: 6 }}>
          <input className="input" type="number" min={0} step="any" style={{ width: 96 }} aria-label="Bill discount" value={d.value || ''} placeholder="0"
            onChange={(e) => { const v = Math.max(0, Number(e.target.value) || 0); onChange({ ...value, billDiscount: v ? { kind: d.kind, value: d.kind === 'percent' ? Math.min(100, v) : v } : null }); }} />
          <select className="select" style={{ width: 70 }} aria-label="Bill discount type" value={d.kind} onChange={(e) => onChange({ ...value, billDiscount: d.value ? { kind: e.target.value as BillDiscount['kind'], value: d.value } : null })}>
            <option value="percent">%</option><option value="amount">₹</option>
          </select>
        </span>
      </div>
    </div>
  );
}

export function TotalsPanel({ lines, withGst, interState, tcsRate = 0, options }: { lines: Array<{ qty: number; rate: number; taxRate: number; discount?: number }>; withGst: boolean; interState: boolean; tcsRate?: number; options?: BillOptions }) {
  const adjusted = options ? applyBillAdjustments(lines, { ...options, withGst }) : lines;
  const t = computeTotals(adjusted, withGst, interState, tcsRate);
  const billOff = options?.billDiscount?.value ? computeTotals(options.pricesIncludeTax ? applyBillAdjustments(lines, { pricesIncludeTax: true, withGst }) : lines, withGst, interState).subTotal - t.subTotal : 0;
  const Row = ({ l, v, strong }: { l: string; v: string; strong?: boolean }) => (
    <div className="row between" style={{ padding: '7px 0', fontWeight: strong ? 700 : 500, color: strong ? 'var(--ink-900)' : 'var(--ink-600)' }}>
      <span>{l}</span>
      <span style={{ fontVariantNumeric: 'tabular-nums' }}>{v}</span>
    </div>
  );
  return (
    <div className="card" style={{ padding: 18, background: 'var(--ink-50)', boxShadow: 'none' }}>
      <Row l="Sub total" v={money(t.subTotal)} strong />
      {billOff > 0.004 && <Row l={`Bill discount${options?.billDiscount?.kind === 'percent' ? ` ${options.billDiscount.value}%` : ''} (incl. above)`} v={`− ${money(billOff)}`} />}
      {t.discount - billOff > 0.004 && <Row l="Item discounts (incl. above)" v={`− ${money(t.discount - billOff)}`} />}
      {options?.pricesIncludeTax && withGst && <div className="small muted" style={{ padding: '2px 0 6px' }}>Prices include GST · taxable value shown</div>}
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
        <span style={{ fontWeight: 600, color: 'var(--ink-900)', fontSize: 14 }}>Total (₹)</span>
        <span style={{ fontWeight: 600, color: 'var(--brand-700)', fontSize: 20 }}>{money(t.total)}</span>
      </div>
    </div>
  );
}
