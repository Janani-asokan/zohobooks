import { useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Save, TrendingUp } from 'lucide-react';
import { api } from '@/api/client';
import { useItems, useMut } from '@/api/hooks';
import { EmptyState, PageHeader, SearchInput, Toggle } from '@/components/ui';
import { money } from '@/lib/format';

type Rates = Record<string, { sp1: string; sp2: string; sp3: string }>;

/**
 * Today's rates: vegetables, gold and steel change price every day. Type the new prices down the list (Enter moves
 * to the next row) and save them together. Bills from now on use the new prices; past bills keep theirs.
 */
export default function TodayRates() {
  const items = (useItems().data ?? []).filter((i) => !i.isGroup);
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('');
  const [same, setSame] = useState(true);
  const [rates, setRates] = useState<Rates>({});
  const table = useRef<HTMLTableElement>(null);
  const save = useMut((updates: Array<{ id: string; sp1: number; sp2?: number; sp3?: number }>) => api.post<{ changed: number }>('/shop/items/rates', { updates }), [['items']],
    { success: (r) => (r.changed ? `${r.changed} price${r.changed === 1 ? '' : 's'} updated. New bills use them from now.` : 'No prices changed') });

  const cats = useMemo(() => [...new Set(items.map((i) => i.category).filter(Boolean))].sort(), [items]);
  const s = q.trim().toLowerCase();
  const rows = items.filter((i) => (!cat || i.category === cat) && (!s || [i.name, String(i.extra?.localName ?? ''), i.sku].some((v) => v.toLowerCase().includes(s))));
  const num = (v: string | undefined) => (v && Number(v) > 0 ? Math.round(Number(v) * 100) / 100 : null);
  const updates = items.flatMap((i) => {
    const r = rates[i.id];
    if (!r) return [];
    const sp1 = num(r.sp1);
    if (sp1 == null) return [];
    if (same) return sp1 !== i.sp1 || i.sp2 !== sp1 || i.sp3 !== sp1 ? [{ id: i.id, sp1 }] : [];
    const sp2 = num(r.sp2) ?? i.sp2;
    const sp3 = num(r.sp3) ?? i.sp3;
    return sp1 !== i.sp1 || sp2 !== i.sp2 || sp3 !== i.sp3 ? [{ id: i.id, sp1, sp2, sp3 }] : [];
  });
  const set = (id: string, k: 'sp1' | 'sp2' | 'sp3', v: string) => setRates((r) => ({ ...r, [id]: { ...(r[id] ?? { sp1: '', sp2: '', sp3: '' }), [k]: v.replace(/[^\d.]/g, '') } }));
  /** Enter jumps to the same price box on the next row, so a morning's rates go in without the mouse. */
  const next = (ev: React.KeyboardEvent<HTMLInputElement>) => {
    if (ev.key !== 'Enter') return;
    ev.preventDefault();
    const inputs = [...(table.current?.querySelectorAll<HTMLInputElement>(`input[data-col="${ev.currentTarget.dataset.col}"]`) ?? [])];
    inputs[inputs.indexOf(ev.currentTarget) + 1]?.focus();
  };

  return (
    <div className="page" style={{ maxWidth: 980 }}>
      <PageHeader title="Today’s rates" icon={TrendingUp} crumbs={<><Link to="/app/items">Items</Link> <span>/</span> Today’s rates</>}
        subtitle="Change today’s selling prices in one go. New bills use them straight away; past bills keep their prices."
        actions={<button className="btn btn-primary" disabled={!updates.length || save.isPending} onClick={() => save.mutate(updates, { onSuccess: () => setRates({}) })}><Save size={15} /> Save {updates.length || ''} price{updates.length === 1 ? '' : 's'}</button>} />
      <div className="card">
        <div className="toolbar">
          <div className="toolbar-left" style={{ flexWrap: 'wrap' }}>
            <SearchInput value={q} onChange={setQ} placeholder="Find an item…" />
            {cats.length > 1 && <div className="segmented">
              <button className={!cat ? 'active' : ''} onClick={() => setCat('')}>All</button>
              {cats.map((c) => <button key={c} className={cat === c ? 'active' : ''} onClick={() => setCat(c)}>{c}</button>)}
            </div>}
          </div>
          <div className="toolbar-right"><Toggle checked={same} onChange={setSame} label="Same price for every customer level" /></div>
        </div>
        {!rows.length ? <EmptyState icon={TrendingUp} title={items.length ? 'No items match' : 'No items yet'} text="Add your items first, then set their prices here every day." action={<Link className="btn btn-primary" to="/app/items/new">Add an item</Link>} /> : (
          <div className="table-wrap"><table className="table rates-table" ref={table}>
            <thead><tr><th>Item</th><th className="num">Now</th><th>{same ? 'Today’s price' : 'SP1 · Standard'}</th>{!same && <><th>SP2 · Loyal</th><th>SP3 · New</th></>}</tr></thead>
            <tbody>{rows.map((i) => {
              const r = rates[i.id];
              const changed = updates.some((u) => u.id === i.id);
              return (
                <tr key={i.id} className={changed ? 'row-selected' : ''}>
                  <td><div className="strong">{i.name}</div><div className="muted small">{[i.extra?.localName ? String(i.extra.localName) : '', `per ${i.unit}`].filter(Boolean).join(' · ')}</div></td>
                  <td className="num">{money(i.sp1)}{!same && <div className="muted small">{money(i.sp2)} · {money(i.sp3)}</div>}</td>
                  {(same ? (['sp1'] as const) : (['sp1', 'sp2', 'sp3'] as const)).map((k) => (
                    <td key={k}><div className="input-addon"><span>₹</span><input className="input" inputMode="decimal" data-col={k} aria-label={`${i.name} ${k === 'sp1' && same ? 'today’s price' : k}`} placeholder={String(i[k])}
                      value={r?.[k] ?? ''} onChange={(e) => set(i.id, k, e.target.value)} onKeyDown={next} /></div></td>
                  ))}
                </tr>
              );
            })}</tbody>
          </table></div>
        )}
      </div>
    </div>
  );
}
