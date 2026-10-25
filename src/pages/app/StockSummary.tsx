import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Boxes, AlertTriangle } from 'lucide-react';
import { ExportMenu } from '@/components/ExportMenu';
import { api } from '@/api/client';
import { useBranches } from '@/api/hooks';
import type { StockSummary as Summary } from '@/api/types';
import { EmptyState, PageHeader, SearchInput, StatCard } from '@/components/ui';
import { money, todayISO } from '@/lib/format';

const fyStart = () => { const t = todayISO(); return `${Number(t.slice(0, 4)) - (t.slice(5, 7) < '04' ? 1 : 0)}-04-01`; };
const n3 = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(3).replace(/0+$/, ''));

/** Stock summary (opening, in, out, closing) and inventory valuation at cost, for any period and warehouse. */
export default function StockSummary() {
  const [params, setParams] = useSearchParams();
  const branches = useBranches().data ?? [];
  const [from, setFrom] = useState(fyStart());
  const [to, setTo] = useState(todayISO());
  const [q, setQ] = useState('');
  const [view, setView] = useState<'items' | 'category'>(params.get('view') === 'category' ? 'category' : 'items');
  const branch = params.get('branch') ?? '';
  const s = useQuery({ queryKey: ['stockSummary', from, to, branch], queryFn: () => api.get<Summary>(`/shop/stock/summary?from=${from}&to=${to}${branch ? `&branchId=${branch}` : ''}`) });
  const data = s.data;
  const rows = useMemo(() => {
    const t = q.trim().toLowerCase();
    return (data?.items ?? []).filter((i) => !t || [i.name, i.sku, i.category].some((v) => v.toLowerCase().includes(t)));
  }, [data, q]);

  const table = () => data && (view === 'category' ? {
    title: 'Inventory valuation', subtitle: `${from} to ${to}`, filename: `inventory-valuation-${to}`,
    columns: [{ label: 'Category' }, { label: 'Items', align: 'right' as const }, { label: 'Units', align: 'right' as const }, { label: 'Value', money: true }],
    rows: [...data.byCategory.map((c) => ({ cells: [c.category, String(c.items), n3(c.qty), c.value] })), { cells: ['Total', String(data.totals.items), n3(data.totals.qty), data.totals.value], kind: 'total' as const }],
  } : {
    title: 'Stock summary', subtitle: `${from} to ${to}`, filename: `stock-summary-${from}-${to}`, landscape: true,
    columns: [{ label: 'Item' }, { label: 'SKU' }, { label: 'Category' }, { label: 'Opening', align: 'right' as const }, { label: 'In', align: 'right' as const }, { label: 'Out', align: 'right' as const }, { label: 'Closing', align: 'right' as const }, { label: 'Unit cost', money: true }, { label: 'Value', money: true }],
    rows: [...rows.map((r) => ({ cells: [r.name, r.sku, r.category, n3(r.opening), n3(r.in), n3(r.out), `${n3(r.closing)} ${r.unit}`, r.cost, r.value] })), { cells: ['Total', '', '', '', '', '', n3(rows.reduce((a, r) => a + r.closing, 0)), null, rows.reduce((a, r) => a + (r.value ?? 0), 0)], kind: 'total' as const }],
  });

  return (
    <div className="page">
      <PageHeader title="Stock Summary" crumbs={<>Inventory <span>/</span> Stock Summary</>} subtitle="Opening, received, issued and closing stock for the period, valued at current cost."
        actions={<ExportMenu disabled={!data} table={() => table() ?? null} />} />
      <div className="report-filters no-print">
        <input className="input" type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} aria-label="From" />
        <span className="muted">to</span>
        <input className="input" type="date" value={to} min={from} max={todayISO()} onChange={(e) => setTo(e.target.value)} aria-label="To" />
        <select className="select" value={branch} onChange={(e) => { if (e.target.value) params.set('branch', e.target.value); else params.delete('branch'); setParams(params, { replace: true }); }} aria-label="Warehouse">
          <option value="">All warehouses</option>{branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
      </div>
      {data && (
        <div className="stat-grid">
          <StatCard label="Stock value" value={data.totals.value === null ? '—' : money(data.totals.value)} icon={Boxes} tone="blue" foot="At current cost price" />
          <StatCard label="Items" value={data.totals.items} icon={Boxes} tone="violet" foot={`${n3(data.totals.qty)} units on hand`} />
          <StatCard label="At or below reorder level" value={data.totals.lowStock} icon={AlertTriangle} tone="red" foot={<Link to="/app/items?tab=stock">See alerts</Link>} />
          <StatCard label="Transfers in transit" value={data.inTransit} icon={Boxes} tone="amber" foot={<Link to="/app/inventory/transfers">Not in any warehouse yet</Link>} />
        </div>
      )}
      <div className="card mt-16 print-area">
        <div className="toolbar no-print">
          <div className="toolbar-left"><SearchInput value={q} onChange={setQ} placeholder="Search item, SKU, category…" /></div>
          <div className="toolbar-right"><div className="segmented"><button className={view === 'items' ? 'active' : ''} onClick={() => setView('items')}>By item</button><button className={view === 'category' ? 'active' : ''} onClick={() => setView('category')}>Valuation by category</button></div></div>
        </div>
        <div className="table-wrap">
          {s.isLoading ? <div style={{ padding: 16 }}><div className="skeleton" style={{ height: 260 }} /></div> : s.isError || !data ? (
            <div style={{ padding: 16 }}><div className="error-state">Couldn’t load the stock summary. <button className="btn btn-ghost btn-sm" onClick={() => s.refetch()}>Try again</button></div></div>
          ) : view === 'category' ? (
            <table className="table">
              <thead><tr><th>Category</th><th className="num">Items</th><th className="num">Units</th><th className="num">Value</th><th className="num">Share</th></tr></thead>
              <tbody>{data.byCategory.map((c) => <tr key={c.category}><td className="strong">{c.category}</td><td className="num">{c.items}</td><td className="num">{n3(c.qty)}</td><td className="num">{money(c.value)}</td><td className="num muted">{data.totals.value ? `${Math.round((c.value / data.totals.value) * 100)}%` : '—'}</td></tr>)}</tbody>
              <tfoot><tr><td className="strong">Total</td><td className="num">{data.totals.items}</td><td className="num">{n3(data.totals.qty)}</td><td className="num strong">{data.totals.value === null ? '—' : money(data.totals.value)}</td><td /></tr></tfoot>
            </table>
          ) : rows.length === 0 ? <EmptyState icon={Boxes} title="No stock items" text="Goods you add appear here with their movements." /> : (
            <table className="table">
              <thead><tr><th>Item</th><th className="num">Opening</th><th className="num">In</th><th className="num">Out</th><th className="num">Closing</th><th className="num">Unit cost</th><th className="num">Value</th></tr></thead>
              <tbody>{rows.map((r) => (
                <tr key={r.itemId}>
                  <td><span className="strong">{r.name}</span><div className="muted">{[r.sku, r.category].filter(Boolean).join(' · ')}</div></td>
                  <td className="num">{n3(r.opening)}</td>
                  <td className="num" style={{ color: r.in ? 'var(--green-700)' : undefined }}>{r.in ? `+${n3(r.in)}` : '—'}</td>
                  <td className="num" style={{ color: r.out ? 'var(--red-600)' : undefined }}>{r.out ? `−${n3(r.out)}` : '—'}</td>
                  <td className="num strong" style={r.closing <= r.reorderLevel ? { color: 'var(--amber-700)' } : undefined}>{n3(r.closing)} <span className="muted">{r.unit}</span></td>
                  <td className="num muted">{r.cost === null ? '—' : money(r.cost)}</td>
                  <td className="num">{r.value === null ? '—' : money(r.value)}</td>
                </tr>
              ))}</tbody>
              <tfoot><tr><td className="strong">Total ({rows.length} items)</td><td colSpan={3} /><td className="num strong">{n3(rows.reduce((a, r) => a + r.closing, 0))}</td><td /><td className="num strong">{data.totals.value === null ? '—' : money(rows.reduce((a, r) => a + (r.value ?? 0), 0))}</td></tr></tfoot>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
