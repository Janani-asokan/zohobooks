import { Fragment, useState } from 'react';
import { Plus, ScanBarcode, Trash2 } from 'lucide-react';
import { findByCode } from '../../shared/barcode';
import type { Item } from '@/api/types';
import { money, uid } from '@/lib/format';
import { Thumb } from './kit';

/* Line editor for purchase orders and itemised bills — priced at cost, not selling price. */

export interface PLine { key: string; itemId: string; qty: string; rate: string; taxRate: number; /** IMEI / serial numbers, one per line of text */ serials?: string }

/** The IMEI / serial numbers typed or scanned into a line: one per line (or comma separated), spaces dropped. */
export const serialList = (text?: string) => (text ?? '').split(/[\n,;\t]+/).map((s) => s.replace(/\s+/g, '')).filter(Boolean);

/** What is wrong with a line's IMEI / serial numbers, or '' when they match its quantity. */
export function serialProblem(l: PLine, all: PLine[] = []): string {
  const list = serialList(l.serials);
  const qty = Number(l.qty || 0);
  const seen = new Set<string>();
  const dup = list.find((x) => (seen.has(x) ? true : (seen.add(x), false)));
  if (dup) return `${dup} is entered twice`;
  const other = all.filter((o) => o.key !== l.key).flatMap((o) => serialList(o.serials));
  const both = list.find((x) => other.includes(x));
  if (both) return `${both} is also on another line`;
  const long = list.find((x) => x.length > 60);
  if (long) return `${long.slice(0, 20)}… is too long`;
  if (!Number.isInteger(qty)) return 'Quantity must be a whole number for items with IMEI / serial numbers';
  if (list.length !== qty) return `${list.length} of ${qty} entered: one IMEI / serial number per unit`;
  return '';
}
export const emptyPLine = (): PLine => ({ key: uid('pl_'), itemId: '', qty: '1', rate: '', taxRate: 0 });
export const pLineFor = (it: Item, qty = 1): PLine => ({ key: uid('pl_'), itemId: it.id, qty: String(qty), rate: String(it.cost ?? 0), taxRate: it.taxRate });
export const pTotals = (lines: PLine[]) => {
  const valid = lines.filter((l) => l.itemId && Number(l.qty) > 0);
  const sub = valid.reduce((s, l) => s + Number(l.qty) * Number(l.rate || 0), 0);
  const tax = valid.reduce((s, l) => s + (Number(l.qty) * Number(l.rate || 0) * l.taxRate) / 100, 0);
  return { sub: Math.round(sub * 100) / 100, tax: Math.round(tax * 100) / 100, total: Math.round((sub + tax) * 100) / 100, count: valid.length };
};
export const toPurchaseInput = (lines: PLine[], opts: { serials?: boolean } = {}) => lines.filter((l) => l.itemId && Number(l.qty) > 0).map((l) => {
  const serials = opts.serials ? serialList(l.serials) : [];
  return { itemId: l.itemId, qty: Number(l.qty), rate: Number(l.rate || 0), taxRate: l.taxRate, ...(serials.length ? { serials } : {}) };
});

/**
 * withSerials: the bill adds stock now, so items that keep IMEI / serial numbers get a box under their line for one
 * number per unit (typed, pasted from a sheet, or scanned: a scanner's Enter starts the next one).
 */
export function PurchaseLinesEditor({ lines, onChange, items, error, withSerials, showSerialErrors }: { lines: PLine[]; onChange: (l: PLine[]) => void; items: Item[]; error?: string; withSerials?: boolean; showSerialErrors?: boolean }) {
  const upd = (key: string, patch: Partial<PLine>) => onChange(lines.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const t = pTotals(lines);
  // Receiving stock box by box: each scan adds the item, or one more of it if it is already on the bill.
  const [scan, setScan] = useState('');
  const [scanMsg, setScanMsg] = useState('');
  const [unknown, setUnknown] = useState('');
  const [lastKey, setLastKey] = useState('');
  const onScan = () => {
    const code = scan.trim();
    if (!code) return;
    const it = findByCode(items.filter((i) => !i.isGroup), code);
    setScan('');
    if (!it) {
      // Not an item barcode: right after scanning a phone's box, the next scan is its IMEI.
      const last = lines.find((l) => l.key === lastKey);
      const lastItem = last && items.find((i) => i.id === last.itemId);
      const imei = code.replace(/\s+/g, '');
      if (withSerials && last && lastItem?.trackSerials) {
        if (lines.some((l) => serialList(l.serials).includes(imei))) { setUnknown(''); setScanMsg(`${imei} is already on this bill`); return; }
        const list = [...serialList(last.serials), imei];
        const qty = Math.max(Number(last.qty || 0), list.length);
        onChange(lines.map((l) => (l.key === last.key ? { ...l, serials: list.join('\n'), qty: String(qty) } : l)));
        setUnknown(''); setScanMsg(`IMEI / serial ${imei} added to ${lastItem.name} (${list.length} of ${qty})`);
        return;
      }
      setUnknown(code); setScanMsg(`No item has barcode ${code}.`); return;
    }
    setUnknown('');
    setScanMsg(withSerials && it.trackSerials ? `Added ${it.name}. Now scan its IMEI / serial number.` : `Added ${it.name}`);
    const have = lines.find((l) => l.itemId === it.id);
    if (have) { setLastKey(have.key); onChange(lines.map((l) => (l.key === have.key ? { ...l, qty: String(Number(l.qty || 0) + 1) } : l))); }
    else { const n = pLineFor(it); setLastKey(n.key); onChange([...lines.filter((l) => l.itemId), n]); }
  };
  return (
    <div>
      <div className="row" style={{ gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
        <div className="input-group" style={{ flex: 1, minWidth: 240 }}>
          <span className="lead" style={{ color: 'var(--brand-600)' }}><ScanBarcode size={16} /></span>
          <input className="input" style={{ height: 38 }} placeholder="Scan each box as it arrives (or type a barcode / SKU and press Enter)" aria-label="Scan to add to the bill"
            value={scan} onChange={(e) => setScan(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onScan(); } }} />
        </div>
        {scanMsg && (
          <span className={`small ${unknown ? 'field-error' : 'muted'}`} role="status">
            {scanMsg}
            {/* A new tab keeps this bill as it is; scan the box again after saving the item. */}
            {unknown && <> <a className="link-btn" href={`/app/items/new?type=Goods&barcode=${encodeURIComponent(unknown)}`} target="_blank" rel="noopener">Add it as a new item</a> (opens a new tab), then scan it again.</>}
          </span>
        )}
      </div>
      <div className="table-wrap pl-table">
        <table className="table">
          <thead>
            <tr><th style={{ minWidth: 240 }}>Item</th><th className="num" style={{ width: 90 }}>Qty</th><th className="num" style={{ width: 130 }}>Rate (cost)</th><th className="num" style={{ width: 70 }}>GST</th><th className="num" style={{ width: 120 }}>Amount</th><th style={{ width: 40 }} /></tr>
          </thead>
          <tbody>
            {lines.map((l) => {
              const it = items.find((i) => i.id === l.itemId);
              return (
                <Fragment key={l.key}>
                <tr className={withSerials && it?.trackSerials ? 'has-serials' : ''}>
                  <td>
                    <div className="row" style={{ gap: 8 }}>
                      {it && <Thumb name={it.name} image={it.image} size={32} />}
                      <select className="select" value={l.itemId} aria-label="Item"
                        onChange={(e) => { const n = items.find((i) => i.id === e.target.value); upd(l.key, n ? { itemId: n.id, rate: String(n.cost ?? 0), taxRate: n.taxRate } : { itemId: '' }); }}>
                        <option value="">Select an item…</option>
                        {items.filter((i) => !i.isGroup).map((i) => <option key={i.id} value={i.id}>{i.name}{i.sku ? ` · ${i.sku}` : ''}{i.type === 'Goods' ? ` (${i.stock} in stock)` : ''}</option>)}
                      </select>
                    </div>
                  </td>
                  <td className="num"><input className="input num" type="number" min={0} value={l.qty} onChange={(e) => upd(l.key, { qty: e.target.value })} aria-label="Quantity" /></td>
                  <td className="num"><input className="input num" type="number" min={0} value={l.rate} onChange={(e) => upd(l.key, { rate: e.target.value })} aria-label="Rate" /></td>
                  <td className="num muted">{l.itemId ? `${l.taxRate}%` : '—'}</td>
                  <td className="num strong">{money(Number(l.qty || 0) * Number(l.rate || 0))}</td>
                  <td><button className="icon-btn danger" aria-label="Remove line" onClick={() => onChange(lines.length > 1 ? lines.filter((x) => x.key !== l.key) : [emptyPLine()])}><Trash2 size={15} /></button></td>
                </tr>
                {withSerials && it?.trackSerials && (() => {
                  const list = serialList(l.serials);
                  const problem = serialProblem(l, lines);
                  const shown = problem && (showSerialErrors || list.length > Number(l.qty || 0) || /twice|another line|too long/.test(problem));
                  return (
                    <tr className="serials-row">
                      <td colSpan={6}>
                        <div className="serials-box">
                          <label htmlFor={`sn-${l.key}`} className="small strong">IMEI / serial numbers <span className={`muted ${!problem ? 'ok' : ''}`}>{list.length} of {Number(l.qty || 0)}</span></label>
                          <textarea id={`sn-${l.key}`} className={`textarea mono ${shown ? 'invalid' : ''}`} rows={Math.min(6, Math.max(2, list.length + 1))} value={l.serials ?? ''}
                            placeholder={'One per unit: scan or type each, press Enter for the next\n356789104512345'} aria-label={`IMEI / serial numbers for ${it.name}`}
                            onChange={(e) => upd(l.key, { serials: e.target.value })} />
                          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                            {shown ? <span className="field-error">{problem}</span> : <span className="field-hint">Saved with this bill for stock and warranty. Each number is sold once.</span>}
                            {list.length > 0 && list.length !== Number(l.qty || 0) && Number.isInteger(Number(l.qty || 0)) && !/twice|another line|too long/.test(problem) && (
                              <button type="button" className="link-btn small" onClick={() => upd(l.key, { qty: String(list.length) })}>Make quantity {list.length}</button>
                            )}
                          </div>
                        </div>
                      </td>
                    </tr>
                  );
                })()}
                </Fragment>
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
