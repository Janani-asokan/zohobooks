import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, BrainCircuit, CalendarClock, ClipboardList, Flame, Loader2, PackageX, RefreshCw, ShoppingCart, Sparkles, Snowflake, TrendingDown, TrendingUp } from 'lucide-react';
import { api } from '@/api/client';
import { useMut, useVendors } from '@/api/hooks';
import { useShopUser } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { EmptyState, PageHeader, StatCard } from '@/components/ui';
import { ExportMenu } from '@/components/ExportMenu';
import { useAiEnabled } from '@/components/Assistant';
import { fmtDate, money, moneyShort, todayISO } from '@/lib/format';

interface ReorderRow {
  itemId: string; name: string; sku: string; unit: string; category: string; stock: number; reorderLevel: number; sold30: number; sold90: number; perDay: number;
  daysLeft: number | null; trend: number | null; suggestQty: number; cost: number; vendorId: string | null; vendorName: string | null; lastPurchaseRate: number | null; urgency: 'out' | 'critical' | 'soon' | 'ok';
}
interface Insights {
  leadDays: number; coverDays: number; reorder: ReorderRow[];
  dead: Array<{ itemId: string; name: string; unit: string; stock: number; value: number; lastSold: string | null; daysIdle: number | null }>;
  slow: Array<{ itemId: string; name: string; unit: string; stock: number; perDay: number; daysLeft: number; value: number }>;
  expiring: Array<{ itemId: string; name: string; batchNo: string; expiryDate: string; qty: number; days: number; value: number }>;
  topMovers: Array<{ itemId: string; name: string; sold30: number; trend: number | null }>;
  totals: { items: number; stockValue: number; toReorder: number; outOfStock: number; critical: number; deadValue: number; expiringValue: number };
}
interface Advice { headline: string; actions: Array<{ priority: 'high' | 'medium' | 'low'; title: string; detail: string; kind: string }>; seasonal: string | null }

const URGENCY: Record<ReorderRow['urgency'], { label: string; tone: string }> = {
  out: { label: 'Out of stock', tone: 'red' }, critical: { label: 'Runs out before delivery', tone: 'red' }, soon: { label: 'Order soon', tone: 'amber' }, ok: { label: 'OK', tone: 'green' },
};
type Tab = 'reorder' | 'dead' | 'slow' | 'expiring' | 'movers';

/** Smart reorder: what to buy, how much and from whom, plus stock that isn't moving or is about to expire. */
export default function StockInsights() {
  const me = useShopUser();
  const toast = useToast();
  const aiOn = useAiEnabled();
  const canBuy = me.can('purchases.write');
  const canCost = me.can('items.cost');
  const [lead, setLead] = useState(7);
  const [cover, setCover] = useState(30);
  const [tab, setTab] = useState<Tab>('reorder');
  const q = useQuery({ queryKey: ['stockInsights', lead, cover], queryFn: () => api.get<Insights>(`/shop/stock/insights?leadDays=${lead}&coverDays=${cover}`) });
  const vendors = useVendors(me.can('purchases.read')).data ?? [];
  const d = q.data;

  // Editable plan: quantity and vendor per item, ticked rows become purchase orders.
  const [plan, setPlan] = useState<Record<string, { pick: boolean; qty: number; vendorId: string }>>({});
  useEffect(() => {
    if (!d) return;
    setPlan(Object.fromEntries(d.reorder.map((r) => [r.itemId, { pick: r.urgency !== 'ok', qty: r.suggestQty, vendorId: r.vendorId ?? '' }])));
  }, [d]);
  const picked = d ? d.reorder.filter((r) => plan[r.itemId]?.pick && plan[r.itemId]!.qty > 0) : [];
  const noVendor = picked.filter((r) => !plan[r.itemId]?.vendorId);
  const byVendor = useMemo(() => {
    const m = new Map<string, ReorderRow[]>();
    for (const r of picked) { const v = plan[r.itemId]!.vendorId; if (v) m.set(v, [...(m.get(v) ?? []), r]); }
    return m;
  }, [picked, plan]);
  const createPOs = useMut(async () => {
    const made: string[] = [];
    for (const [vendorId, rows] of byVendor) {
      const po = await api.post<{ number: string }>('/shop/purchase-orders', {
        vendorId, date: todayISO(), issue: false, notes: 'Made from Smart Reorder',
        lines: rows.map((r) => ({ itemId: r.itemId, qty: plan[r.itemId]!.qty, ...(r.lastPurchaseRate ? { rate: r.lastPurchaseRate } : {}) })),
      });
      made.push(po.number);
    }
    return made;
  }, [['purchaseOrders'], ['stockInsights']], { success: (m) => `${m.length} draft purchase order${m.length === 1 ? '' : 's'} created`, });

  const [advice, setAdvice] = useState<Advice | null>(null);
  const askAi = useMut(() => api.post<Advice>('/shop/ai/stock-advice', { leadDays: lead, coverDays: cover }), [], { silentError: true });
  const getAdvice = () => askAi.mutate(undefined, { onSuccess: setAdvice, onError: (e) => toast('error', e.message) });

  const tabs: Array<{ id: Tab; label: string; n: number; icon: typeof Flame }> = d ? [
    { id: 'reorder', label: 'Reorder', n: d.reorder.length, icon: ShoppingCart },
    { id: 'expiring', label: 'Expiring soon', n: d.expiring.length, icon: CalendarClock },
    { id: 'dead', label: 'Dead stock', n: d.dead.length, icon: PackageX },
    { id: 'slow', label: 'Slow movers', n: d.slow.length, icon: Snowflake },
    { id: 'movers', label: 'Top sellers', n: d.topMovers.length, icon: Flame },
  ] : [];

  return (
    <div className="page">
      <PageHeader title="Smart Reorder" crumbs={<>Inventory <span>/</span> Smart Reorder</>}
        subtitle="What to buy, how much and from whom, worked out from how fast each item sells. Plus stock that isn’t moving or is about to expire."
        actions={<>
          {d && <ExportMenu table={() => ({
            title: 'Reorder plan', subtitle: `Lead time ${lead} days · covers ${cover} days of sales`, filename: 'reorder-plan',
            columns: [{ label: 'Item' }, { label: 'In stock', align: 'right' }, { label: 'Sold / day', align: 'right' }, { label: 'Days left', align: 'right' }, { label: 'Order qty', align: 'right' }, { label: 'Vendor' }, { label: 'Status' }],
            rows: d.reorder.map((r) => ({ cells: [r.name, `${r.stock} ${r.unit}`, String(r.perDay), r.daysLeft ?? '—', plan[r.itemId]?.qty ?? r.suggestQty, vendors.find((v) => v.id === plan[r.itemId]?.vendorId)?.name ?? r.vendorName ?? '—', URGENCY[r.urgency].label] })),
          })} />}
          <button className="btn btn-secondary" onClick={() => q.refetch()} disabled={q.isFetching}><RefreshCw size={15} className={q.isFetching ? 'spin' : ''} /> Refresh</button>
        </>} />

      <div className="card insight-controls">
        <label>Supplier delivers in <input className="input" type="number" min={1} max={60} value={lead} onChange={(e) => setLead(Math.min(60, Math.max(1, Number(e.target.value) || 1)))} aria-label="Lead time in days" /> days</label>
        <label>Each order should last <input className="input" type="number" min={7} max={120} value={cover} onChange={(e) => setCover(Math.min(120, Math.max(7, Number(e.target.value) || 7)))} aria-label="Days of sales to cover" /> days</label>
        <span className="small muted">Sales speed = 60% last 30 days + 40% last 90 days, so one busy week doesn’t over-order.</span>
      </div>

      {d && (
        <div className="stat-grid mt-16">
          <StatCard label="Out of stock" value={d.totals.outOfStock} icon={PackageX} tone="red" foot={`${d.totals.critical} more run out before a delivery`} />
          <StatCard label="To reorder" value={d.totals.toReorder} icon={ShoppingCart} tone="amber" foot={`of ${d.totals.items} stocked items`} />
          <StatCard label="Dead stock" value={canCost ? moneyShort(d.totals.deadValue) : d.dead.length} icon={Snowflake} tone="blue" foot={`${d.dead.length} items, no sale in 90 days`} />
          <StatCard label="Expiring in 60 days" value={canCost ? moneyShort(d.totals.expiringValue) : d.expiring.length} icon={CalendarClock} tone="violet" foot={`${d.expiring.length} batches`} />
        </div>
      )}

      {aiOn && (
        <div className="card ai-advice mt-16">
          <div className="ai-advice-head">
            <span className="ai-badge"><BrainCircuit size={18} /></span>
            <div style={{ flex: 1 }}><h3>AI stock advice</h3><p className="small muted">A prioritised to-do list from these numbers, with festival and season tips for your shop.</p></div>
            <button className="btn btn-primary" onClick={getAdvice} disabled={askAi.isPending || !d}>{askAi.isPending ? <Loader2 size={15} className="spin" /> : <Sparkles size={15} />} {advice ? 'Ask again' : 'Get advice'}</button>
          </div>
          {advice && (
            <div className="ai-advice-body">
              <p className="ai-headline">{advice.headline}</p>
              <ol className="ai-actions">
                {advice.actions.map((a, i) => <li key={i} className={`pri-${a.priority}`}><span className="pri">{a.priority}</span><div><strong>{a.title}</strong><div className="small muted">{a.detail}</div></div></li>)}
              </ol>
              {advice.seasonal && <div className="ai-season"><Sparkles size={14} /> {advice.seasonal}</div>}
            </div>
          )}
        </div>
      )}

      <div className="card mt-16">
        <div className="toolbar">
          <div className="filter-chips" style={{ padding: 0 }}>
            {tabs.map((t) => <button key={t.id} className={`filter-chip ${tab === t.id ? 'active' : ''}`} onClick={() => setTab(t.id)}><t.icon size={13} /> {t.label} <span className="n">{t.n}</span></button>)}
          </div>
          {tab === 'reorder' && canBuy && d && d.reorder.length > 0 && (
            <div className="row" style={{ gap: 8 }}>
              {noVendor.length > 0 && <span className="small text-red"><AlertTriangle size={13} /> Pick a vendor for {noVendor.length} item{noVendor.length === 1 ? '' : 's'}</span>}
              <button className="btn btn-primary" disabled={!byVendor.size || createPOs.isPending} onClick={() => createPOs.mutate(undefined)}>
                {createPOs.isPending ? <Loader2 size={15} className="spin" /> : <ClipboardList size={15} />} Create {byVendor.size || ''} purchase order{byVendor.size === 1 ? '' : 's'}
              </button>
            </div>
          )}
        </div>
        <div className="table-wrap">
          {q.isLoading ? <div style={{ padding: 16 }}><div className="skeleton" style={{ height: 220 }} /></div> : q.isError ? (
            <div style={{ padding: 16 }}><div className="error-state">{(q.error as Error).message} <button className="btn btn-ghost btn-sm" onClick={() => q.refetch()}>Try again</button></div></div>
          ) : !d ? null : tab === 'reorder' ? (
            d.reorder.length === 0 ? <EmptyState icon={ShoppingCart} title="Nothing to reorder" text="Every item has enough stock for the delivery time you set. Check back after a busy week." /> : (
              <table className="table">
                <thead><tr>{canBuy && <th style={{ width: 36 }} />}<th>Item</th><th className="num">In stock</th><th className="num">Sold / day</th><th style={{ width: 170 }}>Days left</th><th className="num" style={{ width: 110 }}>Order</th><th style={{ width: 200 }}>Vendor</th></tr></thead>
                <tbody>{d.reorder.map((r) => {
                  const p = plan[r.itemId] ?? { pick: false, qty: r.suggestQty, vendorId: '' };
                  const set = (x: Partial<typeof p>) => setPlan({ ...plan, [r.itemId]: { ...p, ...x } });
                  const days = r.daysLeft ?? 0;
                  return (
                    <tr key={r.itemId}>
                      {canBuy && <td><input type="checkbox" className="checkbox" checked={p.pick} onChange={(e) => set({ pick: e.target.checked })} aria-label={`Order ${r.name}`} /></td>}
                      <td><Link to={`/app/items?open=${r.itemId}`} className="strong">{r.name}</Link><div className="muted small"><span className={`badge badge-${URGENCY[r.urgency].tone}`}>{URGENCY[r.urgency].label}</span>{r.trend !== null && <span style={{ marginLeft: 8 }}>{r.trend >= 0 ? <TrendingUp size={12} /> : <TrendingDown size={12} />} {r.trend > 0 ? '+' : ''}{r.trend}% vs last month</span>}</div></td>
                      <td className="num">{r.stock} {r.unit}<div className="muted small">min {r.reorderLevel}</div></td>
                      <td className="num">{r.perDay}<div className="muted small">{r.sold30} in 30 days</div></td>
                      <td>
                        <div className="days-bar" title={r.daysLeft === null ? 'No recent sales' : `${r.daysLeft} days`}><span className={r.urgency} style={{ width: `${Math.min(100, (days / (lead + cover)) * 100)}%` }} /></div>
                        <div className="small muted">{r.daysLeft === null ? 'No recent sales' : r.daysLeft === 0 ? 'Out now' : `${r.daysLeft} days · delivery takes ${lead}`}</div>
                      </td>
                      <td className="num">{canBuy ? <input className="input" type="number" min={0} style={{ width: 90, textAlign: 'right' }} value={p.qty} onChange={(e) => set({ qty: Math.max(0, Number(e.target.value) || 0) })} aria-label={`Quantity of ${r.name}`} /> : r.suggestQty}<div className="muted small">{canCost && r.lastPurchaseRate ? `@ ${money(r.lastPurchaseRate)}` : r.unit}</div></td>
                      <td>{canBuy ? (
                        <select className={`select ${p.pick && !p.vendorId ? 'invalid' : ''}`} value={p.vendorId} onChange={(e) => set({ vendorId: e.target.value })} aria-label={`Vendor for ${r.name}`}>
                          <option value="">Choose vendor…</option>{vendors.map((v) => <option key={v.id} value={v.id}>{v.name}{v.id === r.vendorId ? ' · usual' : ''}</option>)}
                        </select>) : r.vendorName ?? '—'}</td>
                    </tr>
                  );
                })}</tbody>
              </table>
            )
          ) : tab === 'expiring' ? (
            d.expiring.length === 0 ? <EmptyState icon={CalendarClock} title="No batches expiring in 60 days" text="Batch-tracked items with an expiry date show here two months ahead." /> : (
              <table className="table"><thead><tr><th>Item</th><th>Batch</th><th>Expires</th><th className="num">Qty</th>{canCost && <th className="num">Value</th>}<th>Suggestion</th></tr></thead>
                <tbody>{d.expiring.map((e) => <tr key={e.itemId + e.batchNo}><td className="strong">{e.name}</td><td className="mono">{e.batchNo}</td><td>{fmtDate(e.expiryDate)}<div className={`small ${e.days <= 15 ? 'text-red' : 'muted'}`}>{e.days < 0 ? `${-e.days} days ago` : `in ${e.days} days`}</div></td><td className="num">{e.qty}</td>{canCost && <td className="num">{money(e.value)}</td>}<td className="small">{e.days < 0 ? 'Remove from sale; return to supplier or write off' : e.days <= 15 ? 'Sell first at a discount, or return to supplier' : 'Put in front; sell this batch first'}</td></tr>)}</tbody></table>
            )
          ) : tab === 'dead' ? (
            d.dead.length === 0 ? <EmptyState icon={PackageX} title="No dead stock" text="Items with stock but no sale in 90 days show here." /> : (
              <table className="table"><thead><tr><th>Item</th><th className="num">In stock</th>{canCost && <th className="num">Money stuck</th>}<th>Last sold</th><th>Suggestion</th></tr></thead>
                <tbody>{d.dead.map((x) => <tr key={x.itemId}><td><Link to={`/app/items?open=${x.itemId}`} className="strong">{x.name}</Link></td><td className="num">{x.stock} {x.unit}</td>{canCost && <td className="num">{money(x.value)}</td>}<td>{x.lastSold ? fmtDate(x.lastSold) : 'Never'}<div className="muted small">{x.daysIdle ?? '—'} days idle</div></td><td className="small">Bundle it with a best seller, offer a clearance price, or ask the supplier to take it back</td></tr>)}</tbody></table>
            )
          ) : tab === 'slow' ? (
            d.slow.length === 0 ? <EmptyState icon={Snowflake} title="No slow movers" text="Items with more than six months of stock at today’s sales speed show here." /> : (
              <table className="table"><thead><tr><th>Item</th><th className="num">In stock</th><th className="num">Sold / day</th><th className="num">Months of stock</th>{canCost && <th className="num">Value</th>}</tr></thead>
                <tbody>{d.slow.map((x) => <tr key={x.itemId}><td><Link to={`/app/items?open=${x.itemId}`} className="strong">{x.name}</Link></td><td className="num">{x.stock} {x.unit}</td><td className="num">{x.perDay}</td><td className="num">{Math.round(x.daysLeft / 30)}</td>{canCost && <td className="num">{money(x.value)}</td>}</tr>)}</tbody></table>
            )
          ) : (
            d.topMovers.length === 0 ? <EmptyState icon={Flame} title="No sales in the last 30 days" text="Your best sellers show here." /> : (
              <table className="table"><thead><tr><th>Item</th><th className="num">Sold in 30 days</th><th className="num">vs previous 30 days</th></tr></thead>
                <tbody>{d.topMovers.map((x) => <tr key={x.itemId}><td><Link to={`/app/items?open=${x.itemId}`} className="strong">{x.name}</Link></td><td className="num">{x.sold30}</td><td className={`num ${x.trend !== null && x.trend < 0 ? 'text-red' : 'text-green'}`}>{x.trend === null ? 'New' : `${x.trend > 0 ? '+' : ''}${x.trend}%`}</td></tr>)}</tbody></table>
            )
          )}
        </div>
      </div>
    </div>
  );
}
