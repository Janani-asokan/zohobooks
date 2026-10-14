import { useMemo, useState } from 'react';
import { BarChart3, Percent, Users, Package, Clock4, Printer } from 'lucide-react';
import { useTenant } from '@/context/TenantContext';
import { PageHeader } from '@/components/ui';
import { AreaChart, BarChart } from '@/components/charts';
import { docTotals, effectiveStatus, isInterState } from '@/lib/invoice';
import { lineAmount } from '@/lib/calc';
import { money, moneyShort } from '@/lib/format';
import { daysUntil, fyLabel } from '@/lib/fy';

type Tab = 'sales' | 'gst' | 'customers' | 'items' | 'aging';
const TABS: Array<{ id: Tab; label: string; icon: typeof BarChart3 }> = [
  { id: 'sales', label: 'Sales summary', icon: BarChart3 },
  { id: 'gst', label: 'GST summary', icon: Percent },
  { id: 'customers', label: 'Sales by customer', icon: Users },
  { id: 'items', label: 'Sales by item', icon: Package },
  { id: 'aging', label: 'Receivables aging', icon: Clock4 },
];

export default function Reports() {
  const { tenant } = useTenant();
  const [tab, setTab] = useState<Tab>('sales');
  const fys = [...new Set([fyLabel(), ...tenant.invoices.map((i) => i.fy)])].sort().reverse();
  const [fy, setFy] = useState(fys[0]!);

  const invs = useMemo(() => tenant.invoices.filter((i) => i.fy === fy && i.status !== 'Draft'), [tenant.invoices, fy]);

  const monthly = useMemo(() => {
    const y = Number(fy.slice(0, 4));
    return Array.from({ length: 12 }, (_, m) => {
      const d = new Date(y, 3 + m, 1);
      const e = new Date(y, 4 + m, 1);
      const list = invs.filter((i) => {
        const dt = new Date(i.date);
        return dt >= d && dt < e;
      });
      const totals = list.map((i) => docTotals(tenant, i));
      return { label: d.toLocaleString('en-IN', { month: 'short' }), count: list.length, net: totals.reduce((s, t) => s + t.subTotal, 0), tax: totals.reduce((s, t) => s + t.taxTotal, 0), total: totals.reduce((s, t) => s + t.total, 0) };
    });
  }, [invs, fy, tenant]);

  const gst = useMemo(() => {
    const m = new Map<number, { taxable: number; cgst: number; sgst: number; igst: number }>();
    let netOnly = 0;
    for (const inv of invs) {
      const t = docTotals(tenant, inv);
      if (!inv.withGst) { netOnly += t.subTotal; continue; }
      const inter = isInterState(tenant, inv.customerId);
      for (const b of t.breakup) {
        const r = m.get(b.rate) ?? { taxable: 0, cgst: 0, sgst: 0, igst: 0 };
        r.taxable += b.taxable;
        if (inter) r.igst += b.tax; else { r.cgst += b.tax / 2; r.sgst += b.tax / 2; }
        m.set(b.rate, r);
      }
    }
    return { rows: [...m.entries()].sort((a, b) => a[0] - b[0]), netOnly };
  }, [invs, tenant]);

  const byCustomer = useMemo(() => {
    const m = new Map<string, { count: number; total: number }>();
    for (const inv of invs) {
      const r = m.get(inv.customerId) ?? { count: 0, total: 0 };
      r.count++; r.total += docTotals(tenant, inv).total;
      m.set(inv.customerId, r);
    }
    return [...m.entries()].map(([id, v]) => ({ c: tenant.customers.find((c) => c.id === id), ...v })).sort((a, b) => b.total - a.total);
  }, [invs, tenant]);

  const byItem = useMemo(() => {
    const m = new Map<string, { qty: number; amount: number; cost: number }>();
    for (const inv of invs) for (const l of inv.lines) {
      const r = m.get(l.name) ?? { qty: 0, amount: 0, cost: 0 };
      const it = tenant.items.find((i) => i.id === l.itemId);
      r.qty += l.qty; r.amount += lineAmount(l); r.cost += (it?.cost ?? 0) * l.qty;
      m.set(l.name, r);
    }
    return [...m.entries()].map(([name, v]) => ({ name, ...v })).sort((a, b) => b.amount - a.amount);
  }, [invs, tenant]);

  const aging = useMemo(() => {
    const buckets = [
      { label: 'Current', test: (d: number) => d >= 0 },
      { label: '1–15 days', test: (d: number) => d < 0 && d >= -15 },
      { label: '16–30 days', test: (d: number) => d < -15 && d >= -30 },
      { label: '31–45 days', test: (d: number) => d < -30 && d >= -45 },
      { label: '> 45 days', test: (d: number) => d < -45 },
    ];
    const open = tenant.invoices.filter((i) => ['Unpaid', 'Overdue'].includes(effectiveStatus(i)));
    return buckets.map((b) => {
      const list = open.filter((i) => b.test(daysUntil(i.dueDate)));
      return { label: b.label, count: list.length, amount: list.reduce((s, i) => s + docTotals(tenant, i).total, 0) };
    });
  }, [tenant]);

  const sum = <T,>(rows: T[], f: (r: T) => number) => rows.reduce((s, r) => s + f(r), 0);

  return (
    <div className="page">
      <PageHeader
        title="Reports"
        subtitle={`Financial year ${fy} · 1 April ${fy.slice(0, 4)} – 31 March ${Number(fy.slice(0, 4)) + 1}`}
        actions={
          <>
            <select className="select" value={fy} onChange={(e) => setFy(e.target.value)} style={{ width: 160 }}>
              {fys.map((f) => <option key={f} value={f}>FY {f}</option>)}
            </select>
            <button className="btn btn-secondary" onClick={() => window.print()}><Printer size={15} /> Print</button>
          </>
        }
      />
      <div className="tabs no-print">
        {TABS.map((t) => (
          <button key={t.id} className={tab === t.id ? 'active' : ''} onClick={() => setTab(t.id)}><t.icon size={15} /> {t.label}</button>
        ))}
      </div>

      <div className="print-area">
        {tab === 'sales' && (
          <div className="stack">
            <div className="card">
              <div className="card-header"><div><h3>Monthly sales (incl. tax)</h3><p>{invs.length} invoices · {money(sum(monthly, (m) => m.total))}</p></div></div>
              <div className="card-body"><AreaChart name="Monthly sales" labels={monthly.map((m) => m.label)} values={monthly.map((m) => m.total)} format={moneyShort} /></div>
            </div>
            <div className="card table-wrap">
              <table className="table">
                <thead><tr><th>Month</th><th className="num">Invoices</th><th className="num">Net sales</th><th className="num">Tax</th><th className="num">Total</th></tr></thead>
                <tbody>
                  {monthly.map((m) => <tr key={m.label}><td className="strong">{m.label}</td><td className="num">{m.count}</td><td className="num">{money(m.net)}</td><td className="num">{money(m.tax)}</td><td className="num strong">{money(m.total)}</td></tr>)}
                  <tr style={{ background: 'var(--ink-50)' }}><td className="strong">Total</td><td className="num strong">{sum(monthly, (m) => m.count)}</td><td className="num strong">{money(sum(monthly, (m) => m.net))}</td><td className="num strong">{money(sum(monthly, (m) => m.tax))}</td><td className="num strong">{money(sum(monthly, (m) => m.total))}</td></tr>
                </tbody>
              </table>
            </div>
          </div>
        )}

        {tab === 'gst' && (
          <div className="card table-wrap">
            <div className="card-header"><div><h3>GST summary (outward supplies)</h3><p>Use this to prepare GSTR-1 / GSTR-3B</p></div></div>
            <table className="table">
              <thead><tr><th>GST rate</th><th className="num">Taxable value</th><th className="num">CGST</th><th className="num">SGST</th><th className="num">IGST</th><th className="num">Total tax</th></tr></thead>
              <tbody>
                {gst.rows.map(([rate, r]) => <tr key={rate}><td className="strong">{rate}%</td><td className="num">{money(r.taxable)}</td><td className="num">{money(r.cgst)}</td><td className="num">{money(r.sgst)}</td><td className="num">{money(r.igst)}</td><td className="num strong">{money(r.cgst + r.sgst + r.igst)}</td></tr>)}
                <tr style={{ background: 'var(--ink-50)' }}>
                  <td className="strong">Total</td>
                  <td className="num strong">{money(sum(gst.rows, ([, r]) => r.taxable))}</td>
                  <td className="num strong">{money(sum(gst.rows, ([, r]) => r.cgst))}</td>
                  <td className="num strong">{money(sum(gst.rows, ([, r]) => r.sgst))}</td>
                  <td className="num strong">{money(sum(gst.rows, ([, r]) => r.igst))}</td>
                  <td className="num strong">{money(sum(gst.rows, ([, r]) => r.cgst + r.sgst + r.igst))}</td>
                </tr>
              </tbody>
            </table>
            <div className="card-body small muted" style={{ borderTop: '1px solid var(--border)' }}>Net-price (no tax) invoices this year: <strong>{money(gst.netOnly)}</strong> — excluded from GST totals.</div>
          </div>
        )}

        {tab === 'customers' && (
          <div className="card table-wrap">
            <table className="table">
              <thead><tr><th>Customer</th><th>ID</th><th>Type</th><th className="num">Invoices</th><th className="num">Sales</th></tr></thead>
              <tbody>
                {byCustomer.map((r) => <tr key={r.c?.id ?? Math.random()}><td className="strong">{r.c?.companyName || r.c?.name || '—'}</td><td><span className="chip mono">{r.c?.customId}</span></td><td className="muted">{r.c?.type}</td><td className="num">{r.count}</td><td className="num strong">{money(r.total)}</td></tr>)}
                {byCustomer.length === 0 && <tr><td colSpan={5} className="muted" style={{ textAlign: 'center', padding: 32 }}>No sales in FY {fy}</td></tr>}
              </tbody>
            </table>
          </div>
        )}

        {tab === 'items' && (
          <div className="card table-wrap">
            <table className="table">
              <thead><tr><th>Item</th><th className="num">Qty sold</th><th className="num">Sales (net)</th><th className="num">Cost</th><th className="num">Gross profit</th><th className="num">Margin</th></tr></thead>
              <tbody>
                {byItem.map((r) => <tr key={r.name}><td className="strong">{r.name}</td><td className="num">{r.qty}</td><td className="num">{money(r.amount)}</td><td className="num muted">{money(r.cost)}</td><td className="num strong" style={{ color: r.amount - r.cost >= 0 ? 'var(--green-700)' : 'var(--red-600)' }}>{money(r.amount - r.cost)}</td><td className="num">{r.amount ? Math.round(((r.amount - r.cost) / r.amount) * 100) : 0}%</td></tr>)}
                {byItem.length === 0 && <tr><td colSpan={6} className="muted" style={{ textAlign: 'center', padding: 32 }}>No sales in FY {fy}</td></tr>}
              </tbody>
            </table>
          </div>
        )}

        {tab === 'aging' && (
          <div className="grid-2" style={{ alignItems: 'start' }}>
            <div className="card">
              <div className="card-header"><div><h3>Outstanding by age</h3><p>All open invoices, by days past due</p></div></div>
              <div className="card-body"><BarChart labels={aging.map((a) => a.label)} series={[{ name: 'Outstanding', values: aging.map((a) => a.amount) }]} format={moneyShort} /></div>
            </div>
            <div className="card table-wrap">
              <table className="table">
                <thead><tr><th>Bucket</th><th className="num">Invoices</th><th className="num">Amount</th></tr></thead>
                <tbody>
                  {aging.map((a) => <tr key={a.label}><td className="strong">{a.label}</td><td className="num">{a.count}</td><td className="num strong">{money(a.amount)}</td></tr>)}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
