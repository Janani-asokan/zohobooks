import { useState } from 'react';
import { Plus, Trash2, ScanBarcode, Percent, ReceiptIndianRupee } from 'lucide-react';
import { useTenant } from '@/context/TenantContext';
import { useToast } from '@/context/ToastContext';
import { computeTotals, lineAmount } from '@/lib/calc';
import { money, uid } from '@/lib/format';
import { TIER_LABEL, type Item, type LineItem, type PriceTier } from '@/lib/types';

export const priceFor = (it: Item, tier: PriceTier) => (tier === 'SP1' ? it.sp1 : tier === 'SP2' ? it.sp2 : it.sp3);

export const emptyLine = (tier: PriceTier): LineItem => ({ id: uid('ln_'), itemId: '', name: '', qty: 1, rate: 0, tier, taxRate: 0, discount: 0 });

export function LineItemsEditor({ lines, onChange, defaultTier, withGst, invalidIds }: { lines: LineItem[]; onChange: (l: LineItem[]) => void; defaultTier: PriceTier; withGst: boolean; invalidIds?: Set<string> }) {
  const { tenant, taxRateOf } = useTenant();
  const toast = useToast();
  const [scan, setScan] = useState('');

  const set = (id: string, patch: Partial<LineItem>) => onChange(lines.map((l) => (l.id === id ? { ...l, ...patch } : l)));

  const pickItem = (lineId: string, itemId: string) => {
    const it = tenant.items.find((i) => i.id === itemId);
    const line = lines.find((l) => l.id === lineId)!;
    if (!it) return set(lineId, { itemId: '', name: '', rate: 0, taxRate: 0 });
    set(lineId, { itemId: it.id, name: it.name, rate: priceFor(it, line.tier), taxRate: taxRateOf(it.taxSlabId) });
  };

  const addByBarcode = (code: string) => {
    const it = tenant.items.find((i) => i.barcode === code || i.sku.toLowerCase() === code.toLowerCase());
    setScan('');
    if (!it) return toast('error', 'No item with that barcode', code);
    const existing = lines.find((l) => l.itemId === it.id);
    if (existing) return set(existing.id, { qty: existing.qty + 1 });
    const fresh: LineItem = { ...emptyLine(defaultTier), itemId: it.id, name: it.name, rate: priceFor(it, defaultTier), taxRate: taxRateOf(it.taxSlabId) };
    const blankIdx = lines.findIndex((l) => !l.itemId);
    onChange(blankIdx >= 0 ? lines.map((l, i) => (i === blankIdx ? { ...fresh, id: l.id } : l)) : [...lines, fresh]);
  };

  const goods = tenant.items.filter((i) => i.type === 'Goods');
  const services = tenant.items.filter((i) => i.type === 'Services');

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
              const it = tenant.items.find((i) => i.id === l.itemId);
              const bad = invalidIds?.has(l.id);
              return (
                <tr key={l.id}>
                  <td>
                    <select className={`select ${bad ? 'invalid' : ''}`} value={l.itemId} onChange={(e) => pickItem(l.id, e.target.value)}>
                      <option value="">{l.itemId || !l.name ? 'Select an item…' : l.name}</option>
                      {goods.length > 0 && (
                        <optgroup label="Goods">
                          {goods.map((i) => <option key={i.id} value={i.id}>{i.name}{i.sku ? ` · ${i.sku}` : ''}</option>)}
                        </optgroup>
                      )}
                      {services.length > 0 && (
                        <optgroup label="Services">
                          {services.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
                        </optgroup>
                      )}
                    </select>
                    {it && (
                      <div className="small muted" style={{ marginTop: 4 }}>
                        {it.type === 'Goods' ? `In stock: ${it.stock} ${it.unit}` : `Service · per ${it.unit}`} {it.hsn && `· ${it.type === 'Goods' ? 'HSN' : 'SAC'} ${it.hsn}`}
                      </div>
                    )}
                  </td>
                  <td><input className="input num" style={{ textAlign: 'right' }} type="number" min={1} value={l.qty} onChange={(e) => set(l.id, { qty: Math.max(0, Number(e.target.value)) })} /></td>
                  <td>
                    <select className="select" value={l.tier} onChange={(e) => { const tier = e.target.value as PriceTier; set(l.id, { tier, rate: it ? priceFor(it, tier) : l.rate }); }}>
                      {(Object.keys(TIER_LABEL) as PriceTier[]).map((t) => <option key={t} value={t}>{t} · {TIER_LABEL[t]}</option>)}
                    </select>
                  </td>
                  <td><input className="input" style={{ textAlign: 'right' }} type="number" min={0} value={l.rate} onChange={(e) => set(l.id, { rate: Math.max(0, Number(e.target.value)) })} /></td>
                  <td><input className="input" style={{ textAlign: 'right' }} type="number" min={0} max={100} value={l.discount} onChange={(e) => set(l.id, { discount: Math.min(100, Math.max(0, Number(e.target.value))) })} /></td>
                  <td className="num">{withGst ? <span className="chip">{l.taxRate}%</span> : <span className="muted small">—</span>}</td>
                  <td className="num strong">{money(lineAmount(l))}</td>
                  <td>
                    <button type="button" className="icon-btn danger" disabled={lines.length === 1} onClick={() => onChange(lines.filter((x) => x.id !== l.id))} aria-label="Remove line">
                      <Trash2 size={15} />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div style={{ padding: 12, borderTop: '1px solid var(--border)' }}>
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => onChange([...lines, emptyLine(defaultTier)])}>
          <Plus size={14} /> Add new row
        </button>
      </div>
    </div>
  );
}

/** The global Net vs GST switch shown on invoice & sales-order forms. */
export function TaxModeToggle({ withGst, onChange }: { withGst: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="segmented" role="radiogroup" aria-label="Tax calculation mode" style={{ padding: 4 }}>
      <button type="button" className={!withGst ? 'active' : ''} onClick={() => onChange(false)} style={{ padding: '9px 14px' }}>
        <ReceiptIndianRupee size={15} /> Calculate Net Price (No Tax)
      </button>
      <button type="button" className={withGst ? 'active' : ''} onClick={() => onChange(true)} style={{ padding: '9px 14px' }}>
        <Percent size={15} /> Calculate with GST
      </button>
    </div>
  );
}

export function TotalsPanel({ lines, withGst, interState }: { lines: LineItem[]; withGst: boolean; interState: boolean }) {
  const t = computeTotals(lines, withGst, interState);
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
          interState ? (
            <Row key={b.rate} l={`IGST ${b.rate}% on ${money(b.taxable)}`} v={money(b.tax)} />
          ) : (
            <div key={b.rate}>
              <Row l={`CGST ${b.rate / 2}%`} v={money(b.tax / 2)} />
              <Row l={`SGST ${b.rate / 2}%`} v={money(b.tax / 2)} />
            </div>
          ),
        )
      ) : (
        <div className="small" style={{ padding: '8px 10px', margin: '6px 0', borderRadius: 8, background: 'var(--amber-50)', color: 'var(--amber-700)' }}>Net price mode — no tax is applied to this document.</div>
      )}
      {Math.abs(t.roundOff) > 0.001 && <Row l="Round off" v={money(t.roundOff)} />}
      <div className="divider" style={{ margin: '10px 0' }} />
      <div className="row between">
        <span style={{ fontWeight: 700, color: 'var(--ink-900)', fontSize: 15 }}>Total (₹)</span>
        <span style={{ fontWeight: 800, color: 'var(--brand-700)', fontSize: 22 }}>{money(t.total)}</span>
      </div>
    </div>
  );
}
