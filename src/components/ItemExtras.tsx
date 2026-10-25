import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, X, Layers, Loader2, Hash } from 'lucide-react';
import { api } from '@/api/client';
import { useBranches, useItemSerials, useMut } from '@/api/hooks';
import type { Item } from '@/api/types';
import { Field } from '@/components/ui';
import { StatusBadge } from '@/components/StatusBadge';
import { splitSerials } from '@/components/StockLines';
import { money } from '@/lib/format';

interface Attr { name: string; values: string }
interface Combo { key: string; attrs: Record<string, string>; on: boolean; sku: string; sp1: string }

const PRESETS: Attr[][] = [[{ name: 'Size', values: 'S, M, L, XL' }], [{ name: 'Colour', values: 'Black, White' }], [{ name: 'Size', values: 'S, M, L' }, { name: 'Colour', values: 'Black, Navy' }]];
const vals = (s: string) => [...new Set(s.split(',').map((v) => v.trim()).filter(Boolean))];

/** Every combination of attribute values, e.g. Size × Colour. */
function combos(attrs: Array<{ name: string; values: string[] }>): Array<Record<string, string>> {
  return attrs.reduce<Array<Record<string, string>>>((acc, a) => acc.flatMap((c) => a.values.map((v) => ({ ...c, [a.name]: v }))), [{}]);
}

const skuPart = (v: string) => v.replace(/[^a-z0-9]/gi, '').slice(0, 4).toUpperCase();

/**
 * Variants for an item: list existing ones, or turn the item into a group with
 * one sellable item per Size × Colour combination.
 */
export function VariantsSection({ item, items }: { item: Item; items: Item[] }) {
  const rank = (c: Item) => item.attributes.reduce((n, a) => n * 100 + Math.max(0, a.values.indexOf(c.variantAttrs[a.name] ?? '')), 0);
  const children = items.filter((i) => i.parentId === item.id).sort((a, b) => rank(a) - rank(b));
  const [attrs, setAttrs] = useState<Attr[]>(item.attributes.length ? item.attributes.map((a) => ({ name: a.name, values: a.values.join(', ') })) : [{ name: 'Size', values: '' }]);
  const [open, setOpen] = useState(false);
  const [edits, setEdits] = useState<Record<string, Partial<Combo>>>({});
  const [err, setErr] = useState('');
  const save = useMut((b: Record<string, unknown>) => api.post<{ created: number }>(`/shop/items/${item.id}/variants`, b), [['items'], ['itemFacets']], { success: (r) => `${r.created} variant${r.created === 1 ? '' : 's'} added`, silentError: true });

  const clean = attrs.map((a) => ({ name: a.name.trim(), values: vals(a.values) })).filter((a) => a.name && a.values.length);
  const existingKeys = new Set(children.map((c) => clean.map((a) => c.variantAttrs[a.name] ?? '').join('|')));
  const rows: Combo[] = useMemo(() => combos(clean).map((attrs) => {
    const key = clean.map((a) => attrs[a.name]).join('|');
    const base: Combo = { key, attrs, on: true, sku: [item.sku || skuPart(item.name), ...clean.map((a) => skuPart(attrs[a.name]!))].filter(Boolean).join('-'), sp1: '' };
    return { ...base, ...edits[key] };
  }), [JSON.stringify(clean), edits, item.sku, item.name]);
  const fresh = rows.filter((r) => !existingKeys.has(r.key));
  const picked = fresh.filter((r) => r.on);

  const submit = () => {
    if (!clean.length) return setErr('Add an attribute with at least one value');
    if (new Set(clean.map((a) => a.name.toLowerCase())).size !== clean.length) return setErr('Attribute names must be different');
    if (!picked.length) return setErr('Pick at least one new combination');
    setErr('');
    save.mutate({ attributes: clean, variants: picked.map((r) => ({ attrs: r.attrs, sku: r.sku.trim(), ...(Number(r.sp1) > 0 ? { sp1: Number(r.sp1) } : {}) })) }, { onSuccess: () => { setOpen(false); setEdits({}); }, onError: (e) => setErr(e.message) });
  };

  if (item.type !== 'Goods' || item.parentId) return null;
  const hasStock = item.stock !== 0;

  return (
    <div className="stack" style={{ gap: 12 }}>
      {children.length > 0 && (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Variant</th><th>SKU</th><th className="num">SP1</th><th className="num">Stock</th></tr></thead>
            <tbody>{children.map((c) => (
              <tr key={c.id}>
                <td><Link to={`/app/items/${c.id}/edit`} className="strong">{Object.values(c.variantAttrs).join(' / ') || c.name}</Link></td>
                <td className="muted">{c.sku || '—'}</td>
                <td className="num">{money(c.sp1)}</td>
                <td className="num">{c.stock} {c.unit}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
      {!open ? (
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <button type="button" className="btn btn-soft btn-sm" disabled={hasStock} onClick={() => setOpen(true)}><Layers size={14} /> {children.length ? 'Add more variants' : 'Create variants'}</button>
          {hasStock && <span className="small muted">This item has stock. Variants can only be added to an item with zero stock; move it with a stock adjustment first.</span>}
          {!hasStock && !children.length && <span className="small muted">Sell sizes or colours as separate items with their own stock, SKU and price.</span>}
        </div>
      ) : (
        <div className="variant-builder">
          {!item.attributes.length && (
            <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
              <span className="small muted">Start from:</span>
              {PRESETS.map((p) => <button key={p.map((a) => a.name).join('×')} type="button" className="filter-chip" onClick={() => { setAttrs(p); setEdits({}); }}>{p.map((a) => a.name).join(' × ')}</button>)}
            </div>
          )}
          {attrs.map((a, i) => (
            <div key={i} className="variant-attr">
              <Field label={i === 0 ? 'Attribute' : ''}><input className="input" value={a.name} disabled={!!item.attributes.length} onChange={(e) => setAttrs(attrs.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} placeholder="Size" /></Field>
              <Field label={i === 0 ? 'Values, separated by commas' : ''}><input className="input" value={a.values} onChange={(e) => setAttrs(attrs.map((x, j) => (j === i ? { ...x, values: e.target.value } : x)))} placeholder="S, M, L, XL" /></Field>
              {!item.attributes.length && attrs.length > 1 && <button type="button" className="icon-btn danger" aria-label="Remove attribute" onClick={() => setAttrs(attrs.filter((_, j) => j !== i))}><X size={15} /></button>}
            </div>
          ))}
          {!item.attributes.length && attrs.length < 3 && <div><button type="button" className="btn btn-ghost btn-sm" onClick={() => setAttrs([...attrs, { name: attrs.length === 1 ? 'Colour' : 'Material', values: '' }])}><Plus size={14} /> Add attribute</button></div>}
          {fresh.length > 0 && (
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th style={{ width: 36 }} /><th>Combination</th><th>SKU</th><th className="num" style={{ width: 140 }}>SP1 (blank = {money(item.sp1)})</th></tr></thead>
                <tbody>{fresh.map((r) => (
                  <tr key={r.key}>
                    <td><input type="checkbox" checked={r.on} onChange={(e) => setEdits({ ...edits, [r.key]: { ...edits[r.key], on: e.target.checked } })} aria-label={`Include ${r.key}`} /></td>
                    <td className="strong">{Object.values(r.attrs).join(' / ')}</td>
                    <td><input className="input" value={r.sku} onChange={(e) => setEdits({ ...edits, [r.key]: { ...edits[r.key], sku: e.target.value } })} aria-label="SKU" /></td>
                    <td><input className="input" style={{ textAlign: 'right' }} type="number" min={0} value={r.sp1} onChange={(e) => setEdits({ ...edits, [r.key]: { ...edits[r.key], sp1: e.target.value } })} aria-label="Price" /></td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
          {clean.length > 0 && !fresh.length && <p className="small muted">All these combinations already exist. Add another value to create more.</p>}
          {err && <div className="field-error">{err}</div>}
          <div className="row" style={{ gap: 8 }}>
            <button type="button" className="btn btn-primary btn-sm" disabled={save.isPending} onClick={submit}>{save.isPending && <Loader2 size={14} className="spin" />} Create {picked.length} variant{picked.length === 1 ? '' : 's'}</button>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => { setOpen(false); setErr(''); }}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Serial numbers of one item: register serials for stock on hand and see where each unit went. */
export function SerialsCard({ item, canWrite }: { item: Item; canWrite: boolean }) {
  const branches = useBranches().data ?? [];
  const list = useItemSerials(item.id).data ?? [];
  const [branchId, setBranchId] = useState(branches.find((b) => b.isPrimary)?.id ?? '');
  const [text, setText] = useState('');
  const [err, setErr] = useState('');
  const add = useMut((b: Record<string, unknown>) => api.post<unknown>(`/shop/items/${item.id}/serials`, b), [['serials', item.id]], { success: () => 'Serial numbers saved', silentError: true });
  const entered = splitSerials(text);
  const branch = branchId || branches.find((b) => b.isPrimary)?.id || branches[0]?.id || '';
  const inStock = list.filter((s) => s.status === 'In stock');
  const untagged = (item.stockByBranch[branch] ?? 0) - inStock.filter((s) => s.branchId === branch).length;

  return (
    <div className="stack" style={{ gap: 10 }}>
      <div className="row between"><strong style={{ color: 'var(--ink-900)', fontSize: 14 }}><Hash size={14} style={{ verticalAlign: -2 }} /> Serial numbers</strong><span className="small muted">{inStock.length} in stock · {list.length - inStock.length} other</span></div>
      {canWrite && (
        <>
          <select className="select" value={branch} onChange={(e) => setBranchId(e.target.value)} aria-label="Warehouse">{branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select>
          <textarea className="textarea" rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder="Scan or type serial numbers, one per line" aria-label="Serial numbers" />
          <div className="small muted">{entered.length} entered · {Math.max(0, untagged)} unit{untagged === 1 ? '' : 's'} here without a serial number</div>
          {err && <div className="field-error">{err}</div>}
          <div><button type="button" className="btn btn-soft btn-sm" disabled={!entered.length || add.isPending} onClick={() => add.mutate({ branchId: branch, serials: entered }, { onSuccess: () => { setText(''); setErr(''); }, onError: (e) => setErr(e.message) })}>{add.isPending && <Loader2 size={14} className="spin" />} Add serial numbers</button></div>
        </>
      )}
      {list.length > 0 && (
        <ul className="serial-list">
          {list.slice(0, 50).map((s) => (
            <li key={s.id}>
              <span className="mono">{s.serial}</span>
              <span className="small muted">{s.invoiceNumber ? <Link to={`/app/sales/invoices/${s.invoiceId}`}>{s.invoiceNumber}</Link> : s.branchName}</span>
              <StatusBadge status={s.status} />
            </li>
          ))}
          {list.length > 50 && <li className="small muted">and {list.length - 50} more</li>}
        </ul>
      )}
    </div>
  );
}
