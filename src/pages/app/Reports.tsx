import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { TrendingUp, BarChart3, Percent, Users, Package, Clock4, Printer, Download, FileJson, Info, Landmark } from 'lucide-react';
import { api, download } from '@/api/client';
import { useInvoices } from '@/api/hooks';
import { useShopUser } from '@/context/AuthContext';
import { usePrefs } from '@/context/PrefsContext';
import { useToast } from '@/context/ToastContext';
import { PageHeader } from '@/components/ui';
import { AreaChart, BarChart } from '@/components/charts';
import { money, moneyShort } from '@/lib/format';
import { fyLabel } from '@/lib/fy';
import { Hint } from '@/components/kit';

type Tab = 'pnl' | 'sales' | 'gst' | 'customers' | 'items' | 'aging';

interface SalesReport {
  monthly: Array<{ month: string; count: number; net: number; tax: number; total: number }>;
  byCustomer: Array<{ id: string; name: string; customId: string; type: string; count: number; total: number }>;
  byItem: Array<{ itemId: string; name: string; qty: number; amount: number; cost: number | null }>;
  aging: Array<{ label: string; amount: number; count: number }>;
}
interface Gstr1Summary {
  period: string; gstin: string;
  b2b: { invoices: number; taxable: number; tax: number }; b2cl: { invoices: number; taxable: number }; b2cs: { taxable: number; tax: number }; cdnr: { notes: number };
  nil: Array<{ sply_ty: string; expt_amt: number; nil_amt: number }>;
  docs: { invoices: { from: string; to: string; totnum: number; cancel: number } | null; creditNotes: { from: string; to: string; totnum: number } | null };
}
interface Gstr3b {
  sup_details: { osup_det: { txval: number; iamt: number; camt: number; samt: number }; osup_nil_exmp: { txval: number } };
  inter_sup: { unreg_details: Array<{ pos: string; txval: number; iamt: number }> };
  itc_elg: { itc_avl: { iamt: number; camt: number; samt: number } };
  payable: { iamt: number; camt: number; samt: number };
  note: string;
}
interface Pnl {
  income: { sales: number; returns: number; net: number }; costOfGoods: number | null; grossProfit: number | null;
  expenses: Array<{ category: string; amount: number }>; totalExpenses: number; netProfit: number | null;
  monthly: Array<{ month: string; income: number; expenses: number; profit: number | null }>;
}
interface HsnRow { hsn: string; description: string; unit: string; rate: number; qty: number; taxable: number; igst: number; cgst: number; sgst: number }

const monthName = (ym: string) => new Date(ym + '-01').toLocaleString('en-IN', { month: 'long', year: 'numeric' });
const sum = <T,>(rows: T[], f: (r: T) => number) => rows.reduce((s, r) => s + f(r), 0);

export default function Reports() {
  const me = useShopUser();
  const { t } = usePrefs();
  const toast = useToast();
  const [tab, setTab] = useState<Tab>('pnl');
  const invoices = useInvoices().data ?? [];
  const currentFy = fyLabel(new Date(), me.platform.fyStartMonth);
  const fys = [...new Set([currentFy, ...invoices.map((i) => i.fy)])].sort().reverse();
  const [fy, setFy] = useState(currentFy);
  const now = new Date();
  const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const [period, setPeriod] = useState(`${lastMonth.getFullYear()}-${String(lastMonth.getMonth() + 1).padStart(2, '0')}`);

  const sales = useQuery({ queryKey: ['report', 'sales', fy], queryFn: () => api.get<SalesReport>(`/shop/reports/sales?fy=${fy}`) });
  const pnl = useQuery({ queryKey: ['report', 'pnl', fy], queryFn: () => api.get<Pnl>(`/shop/reports/pnl?fy=${fy}`), enabled: tab === 'pnl' });
  const g1 = useQuery({ queryKey: ['report', 'gstr1', period], queryFn: () => api.get<Gstr1Summary>(`/shop/gst/gstr1?period=${period}`), enabled: tab === 'gst' });
  const g3 = useQuery({ queryKey: ['report', 'gstr3b', period], queryFn: () => api.get<Gstr3b>(`/shop/gst/gstr3b?period=${period}`), enabled: tab === 'gst' });
  const [y, m] = period.split('-').map(Number) as [number, number];
  const hsn = useQuery({ queryKey: ['report', 'hsn', period], queryFn: () => api.get<HsnRow[]>(`/shop/gst/hsn?from=${period}-01&to=${period}-${new Date(y, m, 0).getDate()}`), enabled: tab === 'gst' });

  const months = useMemo(() => {
    const start = Number(fy.slice(0, 4));
    return Array.from({ length: 12 }, (_, i) => {
      const d = new Date(start, me.platform.fyStartMonth - 1 + i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const r = sales.data?.monthly.find((x) => x.month === key);
      return { key, label: d.toLocaleString('en-IN', { month: 'short' }), count: r?.count ?? 0, net: r?.net ?? 0, tax: r?.tax ?? 0, total: r?.total ?? 0 };
    });
  }, [fy, sales.data, me.platform.fyStartMonth]);
  const periods = useMemo(() => Array.from({ length: 15 }, (_, i) => { const d = new Date(now.getFullYear(), now.getMonth() - i, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; }), []);

  const TABS: Array<{ id: Tab; label: string; icon: typeof BarChart3 }> = [
    { id: 'pnl', label: 'Profit & loss', icon: TrendingUp },
    { id: 'sales', label: 'Sales summary', icon: BarChart3 },
    { id: 'gst', label: 'GST returns', icon: Percent },
    { id: 'customers', label: 'Sales by customer', icon: Users },
    { id: 'items', label: 'Sales by item', icon: Package },
    { id: 'aging', label: 'Receivables aging', icon: Clock4 },
  ];

  const dl = (url: string, name: string, what: string) => download(url, name).then(() => toast('success', `${what} downloaded`, 'Upload it on the GST portal’s offline tool / returns page.')).catch((e) => toast('error', e.message));

  return (
    <div className="page">
      <PageHeader
        title={t('nav.reports')}
        subtitle={tab === 'gst' ? `GST returns for ${monthName(period)} · GSTIN ${g1.data?.gstin || '—'}` : `Financial year ${fy} · 1 April ${fy.slice(0, 4)} – 31 March ${Number(fy.slice(0, 4)) + 1}`}
        actions={
          <>
            {tab === 'gst' ? (
              <select className="select" value={period} onChange={(e) => setPeriod(e.target.value)} style={{ width: 170 }} aria-label="Return period">{periods.map((p) => <option key={p} value={p}>{new Date(p + '-01').toLocaleString('en-IN', { month: 'long', year: 'numeric' })}</option>)}</select>
            ) : (
              <select className="select" value={fy} onChange={(e) => setFy(e.target.value)} style={{ width: 160 }} aria-label="Financial year">{fys.map((f) => <option key={f} value={f}>FY {f}</option>)}</select>
            )}
            <button className="btn btn-secondary" onClick={() => window.print()}><Printer size={15} /> {t('common.print')}</button>
          </>
        }
      />
      <Hint id="reports" title="Reports & GST returns">
        <p>Pick a date range and a report. <strong>GSTR-1</strong> and <strong>GSTR-3B</strong> are prepared from your invoices, credit notes, bills and expenses — download the JSON for the GST portal or Excel/CSV for your accountant.</p>
      </Hint>
      <div className="tabs no-print">{TABS.map((x) => <button key={x.id} className={tab === x.id ? 'active' : ''} onClick={() => setTab(x.id)}><x.icon size={15} /> {x.label}</button>)}</div>

      <div className="print-area">
        {tab === 'pnl' && (
          pnl.isLoading || !pnl.data ? <div className="skeleton" style={{ height: 320 }} /> : (
            <div className="stack">
              <div className="stat-grid">
                <div className="stat-card"><div className="stat-label">Net income</div><div className="stat-value">{moneyShort(pnl.data.income.net)}</div><div className="stat-foot">Sales {money(pnl.data.income.sales)} − returns {money(pnl.data.income.returns)}</div></div>
                <div className="stat-card"><div className="stat-label">Cost of goods sold</div><div className="stat-value">{pnl.data.costOfGoods === null ? '—' : moneyShort(pnl.data.costOfGoods)}</div><div className="stat-foot">At current item cost</div></div>
                <div className="stat-card"><div className="stat-label">Expenses</div><div className="stat-value">{moneyShort(pnl.data.totalExpenses)}</div><div className="stat-foot">{pnl.data.expenses.length} categories</div></div>
                <div className="stat-card" style={{ background: pnl.data.netProfit !== null && pnl.data.netProfit < 0 ? 'var(--red-50)' : 'var(--green-50)' }}><div className="stat-label">Net profit</div><div className="stat-value" style={{ color: pnl.data.netProfit !== null && pnl.data.netProfit < 0 ? 'var(--red-600)' : 'var(--green-700)' }}>{pnl.data.netProfit === null ? '—' : moneyShort(pnl.data.netProfit)}</div><div className="stat-foot">{pnl.data.netProfit !== null && pnl.data.income.net > 0 ? `${Math.round((pnl.data.netProfit / pnl.data.income.net) * 100)}% net margin` : 'Income − costs − expenses'}</div></div>
              </div>
              <div className="grid-2" style={{ alignItems: 'start' }}>
                <div className="card">
                  <div className="card-header"><div><h3>Profit &amp; loss statement</h3><p>FY {fy} · amounts exclude GST · running costs come from Expenses</p></div></div>
                  <table className="table pnl-table">
                    <tbody>
                      <tr className="grp"><td>Income</td><td /></tr>
                      <tr><td>Sales</td><td className="num">{money(pnl.data.income.sales)}</td></tr>
                      <tr><td>Less: sales returns (credit notes)</td><td className="num">− {money(pnl.data.income.returns)}</td></tr>
                      <tr className="sub"><td>Net income</td><td className="num">{money(pnl.data.income.net)}</td></tr>
                      {pnl.data.costOfGoods !== null && (<>
                        <tr><td>Less: cost of goods sold</td><td className="num">− {money(pnl.data.costOfGoods)}</td></tr>
                        <tr className="sub"><td>Gross profit</td><td className="num">{money(pnl.data.grossProfit ?? 0)}</td></tr>
                      </>)}
                      <tr className="grp"><td>Operating expenses</td><td /></tr>
                      {pnl.data.expenses.length === 0 && <tr><td className="muted">No expenses recorded</td><td className="num">—</td></tr>}
                      {pnl.data.expenses.map((e) => <tr key={e.category}><td>{e.category}</td><td className="num">{money(e.amount)}</td></tr>)}
                      <tr className="sub"><td>Total expenses</td><td className="num">{money(pnl.data.totalExpenses)}</td></tr>
                      {pnl.data.netProfit !== null && <tr className="total"><td>{pnl.data.netProfit < 0 ? 'Net loss' : 'Net profit'}</td><td className="num">{money(pnl.data.netProfit)}</td></tr>}
                    </tbody>
                  </table>
                </div>
                <div className="card">
                  <div className="card-header"><div><h3>Income vs. costs</h3><p>Month by month</p></div></div>
                  <div className="card-body"><BarChart labels={pnl.data.monthly.map((m) => new Date(m.month + '-01').toLocaleString('en-IN', { month: 'short' }))} series={[{ name: 'Income', values: pnl.data.monthly.map((m) => m.income) }, { name: 'Costs & expenses', values: pnl.data.monthly.map((m) => m.expenses) }]} format={moneyShort} /></div>
                </div>
              </div>
            </div>
          )
        )}

        {tab === 'sales' && (
          <div className="stack">
            <div className="card">
              <div className="card-header"><div><h3>Monthly sales (incl. tax)</h3><p>{sum(months, (x) => x.count)} invoices · {money(sum(months, (x) => x.total))}</p></div></div>
              <div className="card-body"><AreaChart name="Monthly sales" labels={months.map((x) => x.label)} values={months.map((x) => x.total)} format={moneyShort} /></div>
            </div>
            <div className="card table-wrap">
              <table className="table">
                <thead><tr><th>Month</th><th className="num">Invoices</th><th className="num">Net sales</th><th className="num">GST</th><th className="num">Total</th></tr></thead>
                <tbody>
                  {months.map((x) => <tr key={x.key}><td className="strong">{x.label}</td><td className="num">{x.count}</td><td className="num">{money(x.net)}</td><td className="num">{money(x.tax)}</td><td className="num strong">{money(x.total)}</td></tr>)}
                  <tr style={{ background: 'var(--ink-50)' }}><td className="strong">Total</td><td className="num strong">{sum(months, (x) => x.count)}</td><td className="num strong">{money(sum(months, (x) => x.net))}</td><td className="num strong">{money(sum(months, (x) => x.tax))}</td><td className="num strong">{money(sum(months, (x) => x.total))}</td></tr>
                </tbody>
              </table>
            </div>
          </div>
        )}

        {tab === 'gst' && (
          <div className="stack">
            {!g1.data?.gstin && g1.data && <div className="row small" style={{ gap: 8, padding: '10px 14px', borderRadius: 8, background: 'var(--amber-50)', color: 'var(--amber-700)' }}><Info size={15} /> Add your GSTIN in Organization profile — returns need it.</div>}
            <div className="grid-2" style={{ alignItems: 'start' }}>
              <div className="card">
                <div className="card-header">
                  <div><h3>GSTR-1 · outward supplies</h3><p>Invoice-level details of sales</p></div>
                  <button className="btn btn-primary btn-sm" onClick={() => dl(`/shop/gst/gstr1?period=${period}&download=1`, `GSTR1_${period}.json`, 'GSTR-1 JSON')}><FileJson size={14} /> Download JSON</button>
                </div>
                <div className="table-wrap">
                  {g1.data ? (
                    <table className="table">
                      <tbody>
                        <tr><td className="strong">B2B invoices (4A)</td><td className="num">{g1.data.b2b.invoices}</td><td className="num">{money(g1.data.b2b.taxable)}</td><td className="num muted">GST {money(g1.data.b2b.tax)}</td></tr>
                        <tr><td className="strong">B2C large, inter-state (5)</td><td className="num">{g1.data.b2cl.invoices}</td><td className="num">{money(g1.data.b2cl.taxable)}</td><td /></tr>
                        <tr><td className="strong">B2C others (7)</td><td /><td className="num">{money(g1.data.b2cs.taxable)}</td><td className="num muted">GST {money(g1.data.b2cs.tax)}</td></tr>
                        <tr><td className="strong">Credit notes, registered (9B)</td><td className="num">{g1.data.cdnr.notes}</td><td /><td /></tr>
                        <tr><td className="strong">Nil-rated / non-GST (8)</td><td /><td className="num">{money(sum(g1.data.nil, (n) => n.expt_amt + n.nil_amt))}</td><td /></tr>
                        <tr><td className="strong">Documents issued (13)</td><td colSpan={3} className="muted small">{g1.data.docs.invoices ? `${g1.data.docs.invoices.from} → ${g1.data.docs.invoices.to} · ${g1.data.docs.invoices.totnum} issued, ${g1.data.docs.invoices.cancel} cancelled` : 'None'}{g1.data.docs.creditNotes ? ` · ${g1.data.docs.creditNotes.totnum} credit notes` : ''}</td></tr>
                      </tbody>
                    </table>
                  ) : <div className="skeleton" style={{ height: 200, margin: 16 }} />}
                </div>
              </div>
              <div className="card">
                <div className="card-header">
                  <div><h3>GSTR-3B · summary return</h3><p>Liability, input credit &amp; tax payable</p></div>
                  <button className="btn btn-secondary btn-sm" onClick={() => dl(`/shop/gst/gstr3b?period=${period}&download=1`, `GSTR3B_${period}.json`, 'GSTR-3B summary')}><Download size={14} /> JSON</button>
                </div>
                <div className="table-wrap">
                  {g3.data ? (
                    <table className="table">
                      <thead><tr><th>Section</th><th className="num">Taxable</th><th className="num">IGST</th><th className="num">CGST</th><th className="num">SGST</th></tr></thead>
                      <tbody>
                        <tr><td className="strong">3.1(a) Outward taxable</td><td className="num">{money(g3.data.sup_details.osup_det.txval)}</td><td className="num">{money(g3.data.sup_details.osup_det.iamt)}</td><td className="num">{money(g3.data.sup_details.osup_det.camt)}</td><td className="num">{money(g3.data.sup_details.osup_det.samt)}</td></tr>
                        <tr><td className="strong">3.1(c) Nil / exempt</td><td className="num">{money(g3.data.sup_details.osup_nil_exmp.txval)}</td><td /><td /><td /></tr>
                        <tr><td className="strong">4(A)(5) Input tax credit</td><td /><td className="num" style={{ color: 'var(--green-700)' }}>{money(g3.data.itc_elg.itc_avl.iamt)}</td><td className="num" style={{ color: 'var(--green-700)' }}>{money(g3.data.itc_elg.itc_avl.camt)}</td><td className="num" style={{ color: 'var(--green-700)' }}>{money(g3.data.itc_elg.itc_avl.samt)}</td></tr>
                        <tr style={{ background: 'var(--brand-50)' }}><td className="strong">Tax payable (cash)</td><td /><td className="num strong">{money(g3.data.payable.iamt)}</td><td className="num strong">{money(g3.data.payable.camt)}</td><td className="num strong">{money(g3.data.payable.samt)}</td></tr>
                      </tbody>
                    </table>
                  ) : <div className="skeleton" style={{ height: 200, margin: 16 }} />}
                  {g3.data && <p className="small muted" style={{ padding: '10px 16px' }}><Landmark size={12} style={{ verticalAlign: -2 }} /> {g3.data.note}</p>}
                </div>
              </div>
            </div>
            <div className="card table-wrap">
              <div className="card-header"><div><h3>HSN / SAC summary (GSTR-1 table 12)</h3><p>{monthName(period)}</p></div></div>
              <table className="table">
                <thead><tr><th>HSN/SAC</th><th>Description</th><th className="num">Rate</th><th className="num">Qty</th><th className="num">Taxable</th><th className="num">IGST</th><th className="num">CGST</th><th className="num">SGST</th></tr></thead>
                <tbody>
                  {(hsn.data ?? []).map((h) => <tr key={h.hsn + h.rate}><td className="strong">{h.hsn}</td><td className="muted">{h.description}</td><td className="num">{h.rate}%</td><td className="num">{h.qty} {h.unit}</td><td className="num">{money(h.taxable)}</td><td className="num">{money(h.igst)}</td><td className="num">{money(h.cgst)}</td><td className="num">{money(h.sgst)}</td></tr>)}
                  {hsn.data?.length === 0 && <tr><td colSpan={8} className="muted" style={{ textAlign: 'center', padding: 24 }}>No sales in this month.</td></tr>}
                </tbody>
              </table>
            </div>
            <p className="small muted">These files follow the GSTN offline-tool JSON layout. Always review the preview on the GST portal before filing; reconcile purchases with GSTR-2B for input credit.</p>
          </div>
        )}

        {tab === 'customers' && (
          <div className="card table-wrap">
            <table className="table">
              <thead><tr><th>Customer</th><th>ID</th><th>Type</th><th className="num">Invoices</th><th className="num">Sales</th></tr></thead>
              <tbody>
                {(sales.data?.byCustomer ?? []).map((r) => <tr key={r.id}><td className="strong">{r.name}</td><td><span className="chip mono">{r.customId || 'Walk-in'}</span></td><td className="muted">{r.type}</td><td className="num">{r.count}</td><td className="num strong">{money(r.total)}</td></tr>)}
                {sales.data?.byCustomer.length === 0 && <tr><td colSpan={5} className="muted" style={{ textAlign: 'center', padding: 32 }}>No sales in FY {fy}</td></tr>}
              </tbody>
            </table>
          </div>
        )}

        {tab === 'items' && (
          <div className="card table-wrap">
            <table className="table">
              <thead><tr><th>Item</th><th className="num">Qty sold</th><th className="num">Sales (net)</th>{me.can('items.cost') && <><th className="num">Cost</th><th className="num">Gross profit</th><th className="num">Margin</th></>}</tr></thead>
              <tbody>
                {(sales.data?.byItem ?? []).map((r) => (
                  <tr key={r.itemId}>
                    <td className="strong">{r.name}</td><td className="num">{r.qty}</td><td className="num">{money(r.amount)}</td>
                    {r.cost !== null && <><td className="num muted">{money(r.cost)}</td><td className="num strong" style={{ color: r.amount - r.cost >= 0 ? 'var(--green-700)' : 'var(--red-600)' }}>{money(r.amount - r.cost)}</td><td className="num">{r.amount ? Math.round(((r.amount - r.cost) / r.amount) * 100) : 0}%</td></>}
                  </tr>
                ))}
                {sales.data?.byItem.length === 0 && <tr><td colSpan={6} className="muted" style={{ textAlign: 'center', padding: 32 }}>No sales in FY {fy}</td></tr>}
              </tbody>
            </table>
          </div>
        )}

        {tab === 'aging' && (
          <div className="grid-2" style={{ alignItems: 'start' }}>
            <div className="card">
              <div className="card-header"><div><h3>Outstanding by age</h3><p>All open invoices, by days past due</p></div></div>
              <div className="card-body">{sales.data && <BarChart labels={sales.data.aging.map((a) => a.label)} series={[{ name: 'Outstanding', values: sales.data.aging.map((a) => a.amount) }]} format={moneyShort} />}</div>
            </div>
            <div className="card table-wrap">
              <table className="table">
                <thead><tr><th>Bucket</th><th className="num">Invoices</th><th className="num">Amount</th></tr></thead>
                <tbody>{(sales.data?.aging ?? []).map((a) => <tr key={a.label}><td className="strong">{a.label}</td><td className="num">{a.count}</td><td className="num strong">{money(a.amount)}</td></tr>)}</tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
