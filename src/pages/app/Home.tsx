import { Link, useNavigate } from 'react-router-dom';
import { useMemo, useState } from 'react';
import { Check, X, IndianRupee, Clock4, FileText, PackageX, UserPlus, PackagePlus, ScanLine, ArrowRight, Wallet, AlertTriangle, Users, BarChart3, CalendarDays } from 'lucide-react';
import { useCustomers, useDashboard, useInvoices, useItems, useOrg, useStaff, useVendors } from '@/api/hooks';
import { useLocalFlag } from '@/components/kit';
import { useShopUser } from '@/context/AuthContext';
import { usePrefs } from '@/context/PrefsContext';
import { EmptyState, PageHeader, StatCard } from '@/components/ui';
import { StatusBadge } from '@/components/StatusBadge';
import { AreaChart, Donut, MeterList } from '@/components/charts';
import { fmtDate, money, moneyShort } from '@/lib/format';

const pctChange = (cur: number, prev: number) => (prev > 0 ? Math.round(((cur - prev) / prev) * 100) : cur > 0 ? 100 : null);
const STATUS_COLORS = { Paid: '#1f7a4d', 'Partially Paid': '#b7791f', Sent: '#3b6ea8', Overdue: '#c22f2f' } as const;

export default function Home() {
  const me = useShopUser();
  const { t } = usePrefs();
  const navigate = useNavigate();
  const dash = useDashboard();
  const invoices = useInvoices();
  const customers = useCustomers();
  const [range, setRange] = useState<'month' | 'six'>('six');
  const d = dash.data;
  const hour = new Date().getHours();
  const greet = t(hour < 12 ? 'home.goodMorning' : hour < 17 ? 'home.goodAfternoon' : 'home.goodEvening');
  const issued = (invoices.data ?? []).filter((i) => i.status === 'Issued');
  const recent = issued.slice(0, 5);
  const canSell = me.can('sales.write');

  const now = new Date();
  const ym = (dt: Date) => `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`;
  const thisM = ym(now);
  const prevM = ym(new Date(now.getFullYear(), now.getMonth() - 1, 1));
  const inM = (iso: string, m: string) => iso.slice(0, 7) === m;
  const monthly = d?.monthly ?? [];
  const revCur = monthly.find((m) => m.month === thisM)?.invoiced ?? 0;
  const revPrev = monthly.find((m) => m.month === prevM)?.invoiced ?? 0;
  const invCur = issued.filter((i) => inM(i.date, thisM)).length;
  const invPrev = issued.filter((i) => inM(i.date, prevM)).length;
  const custList = customers.data ?? [];
  const custCur = custList.filter((c) => inM(c.createdAt, thisM)).length;
  const custPrev = custList.filter((c) => inM(c.createdAt, prevM)).length;

  // Revenue overview: daily for this month, or monthly for the last six.
  const chart = useMemo(() => {
    if (range === 'six') return { labels: monthly.map((m) => new Date(m.month + '-01').toLocaleString('en-IN', { month: 'short' })), values: monthly.map((m) => m.invoiced) };
    const days = now.getDate();
    const vals = Array.from({ length: days }, (_, i) => issued.filter((inv) => inv.date === `${thisM}-${String(i + 1).padStart(2, '0')}`).reduce((s, inv) => s + inv.total, 0));
    return { labels: vals.map((_, i) => String(i + 1)), values: vals };
  }, [range, monthly, issued.length]);

  const statusRows = (['Paid', 'Partially Paid', 'Sent', 'Overdue'] as const).map((st) => ({
    label: st,
    value: issued.filter((i) => i.paymentStatus === st).reduce((s, i) => s + (st === 'Paid' ? i.total : i.balance), 0),
    color: STATUS_COLORS[st],
  }));

  const quick = [
    ...(canSell ? [{ label: 'Create Invoice', sub: 'Generate a new invoice', icon: FileText, to: '/app/sales/invoices/new', tone: 'blue' }] : []),
    ...(me.can('items.write') ? [{ label: 'Add Product', sub: 'Add a new product', icon: PackagePlus, to: '/app/items/new', tone: 'green' }] : []),
    ...(me.can('customers.write') ? [{ label: 'Add Customer', sub: 'Add a new customer', icon: UserPlus, to: '/app/sales/customers?new=1', tone: 'amber' }] : []),
    ...(me.can('reports.read') ? [{ label: 'View Reports', sub: 'Analyse your business', icon: BarChart3, to: '/app/reports', tone: 'violet' }] : canSell ? [{ label: 'POS Billing', sub: 'Bill at the counter', icon: ScanLine, to: '/app/pos', tone: 'violet' }] : []),
  ];

  if (dash.isError) {
    return (
      <div className="page">
        <div className="card"><EmptyState icon={AlertTriangle} title="Couldn’t load your dashboard" text={dash.error.message} action={<button className="btn btn-primary" onClick={() => dash.refetch()}>{t('common.retry')}</button>} /></div>
      </div>
    );
  }

  const fyStart = d ? `1 Apr ${d.fy.slice(0, 4)}` : '';
  return (
    <div className="page">
      <PageHeader
        title={<>{greet}, {me.user.name.split(' ')[0]}</>}
        subtitle="Here’s what’s happening with your business today."
        actions={<span className="date-pill"><CalendarDays size={15} /> {fyStart} – {now.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</span>}
      />

      <GettingStarted />

      <div className="stat-grid">
        <StatCard label="Total Revenue" value={d ? money(d.fySales) : '—'} icon={IndianRupee} tone="green" trend={{ pct: pctChange(revCur, revPrev) }} foot={d && <>FY {d.fy}</>} />
        <StatCard label="Total Invoices" value={invoices.data ? issued.length : '—'} icon={FileText} tone="blue" trend={{ pct: pctChange(invCur, invPrev) }} foot="Issued this FY" />
        <StatCard label="Pending Payments" value={d ? money(d.receivable) : '—'} icon={Wallet} tone="amber" foot={d && (d.overdueCount ? <Link to="/app/sales/invoices?status=Overdue" style={{ color: 'var(--red-600)', fontWeight: 600 }}>{d.overdueCount} overdue · {money(d.overdue)} →</Link> : <>{d.openCount} invoices awaiting payment</>)} />
        <StatCard label="Total Customers" value={customers.data ? custList.length : '—'} icon={Users} tone="violet" trend={{ pct: pctChange(custCur, custPrev), label: 'new vs last month' }} foot={`${custCur} new this month`} />
      </div>

      <div className="dash-row mt-16">
        <div className="card">
          <div className="card-header">
            <div><h3>Revenue Overview</h3><p>{range === 'six' ? 'Invoiced value, last 6 months' : `Daily invoiced value, ${now.toLocaleString('en-IN', { month: 'long' })}`}</p></div>
            <div className="seg-sm" role="tablist">
              <button className={range === 'month' ? 'active' : ''} onClick={() => setRange('month')}>This Month</button>
              <button className={range === 'six' ? 'active' : ''} onClick={() => setRange('six')}>Last 6 Months</button>
            </div>
          </div>
          <div className="card-body">{d && invoices.data ? <AreaChart name="Revenue" labels={chart.labels} values={chart.values} format={moneyShort} height={290} /> : <div className="skeleton" style={{ height: 230 }} />}</div>
        </div>
        <div className="card">
          <div className="card-header">
            <div><h3>Recent Invoices</h3><p>Latest billing activity</p></div>
            <Link to="/app/sales/invoices" className="btn btn-ghost btn-sm">{t('home.viewAll')} <ArrowRight size={14} /></Link>
          </div>
          <div className="table-wrap">
            {invoices.isLoading ? <div style={{ padding: 16 }}><div className="skeleton" style={{ height: 200 }} /></div> : recent.length === 0 ? (
              <EmptyState icon={FileText} title="No invoices yet" text="Create your first GST invoice in under a minute." action={canSell && <Link to="/app/sales/invoices/new" className="btn btn-primary">Create invoice</Link>} />
            ) : (
              <table className="table mini-table">
                <thead><tr><th>Invoice No.</th><th>Customer</th><th className="num">Amount</th><th>Status</th></tr></thead>
                <tbody>
                  {recent.map((inv) => (
                    <tr key={inv.id} className="clickable" onClick={() => navigate(`/app/sales/invoices/${inv.id}`)}>
                      <td style={{ whiteSpace: 'nowrap' }}><span className="strong" style={{ color: 'var(--brand-600)' }}>{inv.number}</span><div className="muted small">{fmtDate(inv.date)}</div></td>
                      <td>{inv.customer.companyName || inv.customer.name}</td>
                      <td className="num strong">{money(inv.total)}</td>
                      <td><StatusBadge status={inv.paymentStatus} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>

      {quick.length > 0 && (
        <>
          <h3 className="mt-24" style={{ fontSize: 14, fontWeight: 600, marginBottom: 10 }}>Quick actions</h3>
          <div className="qa-grid">
            {quick.map((q) => (
              <Link key={q.label} to={q.to} className="qa-card">
                <span className={`stat-icon tone-${q.tone}`}><q.icon size={18} /></span>
                <div><strong>{q.label}</strong><span className="qa-sub">{q.sub}</span></div>
              </Link>
            ))}
          </div>
        </>
      )}

      <div className="grid-3 mt-16">
        <div className="card">
          <div className="card-header"><div><h3>Payment Status</h3><p>Issued invoices this FY</p></div></div>
          <div className="card-body">{invoices.data ? <Donut label="Payment status" rows={statusRows} format={moneyShort} /> : <div className="skeleton" style={{ height: 150 }} />}</div>
        </div>
        <div className="card">
          <div className="card-header"><div><h3>{t('home.topItems')}</h3><p>By invoiced value this FY</p></div></div>
          <div className="card-body">
            {d?.topItems.length ? <MeterList rows={d.topItems.map((x) => ({ label: x.name, value: x.amount }))} format={moneyShort} /> : d ? <p className="muted small">No sales yet.</p> : <div className="skeleton" style={{ height: 150 }} />}
          </div>
        </div>
        <div className="card">
          <div className="card-header"><div><h3>Today at a glance</h3><p>{now.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })}</p></div></div>
          <div className="card-body stack" style={{ gap: 12 }}>
            <div className="glance"><span className="stat-icon tone-green"><IndianRupee size={16} /></span><div><span>Sales today</span><strong>{d ? money(d.todaySales) : '—'}</strong></div></div>
            <Link to="/app/sales/invoices?status=Overdue" className="glance"><span className="stat-icon tone-red"><Clock4 size={16} /></span><div><span>Overdue invoices</span><strong>{d ? d.overdueCount : '—'}</strong></div><ArrowRight size={14} className="muted" /></Link>
            <Link to="/app/items?tab=stock" className="glance"><span className="stat-icon tone-amber"><PackageX size={16} /></span><div><span>Low-stock items</span><strong>{d ? d.lowStock : '—'}</strong></div><ArrowRight size={14} className="muted" /></Link>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Onboarding checklist — computed from real data, so steps tick themselves off. */
function GettingStarted() {
  const me = useShopUser();
  const admin = me.can('admin');
  const org = useOrg().data;
  const items = useItems().data;
  const customers = useCustomers().data;
  const invoices = useInvoices().data;
  const vendors = useVendors(me.can('purchases.read')).data;
  const staff = useStaff(admin).data;
  const [hidden, setHidden] = useLocalFlag(`ledgerly.gs.${me.shop.id}`);
  if (!admin || hidden || !org || !items || !customers || !invoices) return null;
  const steps = [
    { label: 'Add your shop logo', sub: 'Shown on every invoice', done: !!org.logo, to: '/app/organization' },
    { label: 'Add your GSTIN', sub: 'Needed for tax invoices', done: !!org.gstin, to: '/app/organization' },
    { label: 'Set up UPI payments', sub: 'QR code on invoices', done: !!org.upiId, to: '/app/organization' },
    { label: 'Add your first item', sub: 'Products or services', done: items.length > 0, to: '/app/items/new' },
    { label: 'Add a customer', sub: 'With an auto customer ID', done: customers.length > 0, to: '/app/sales/customers?new=1' },
    { label: 'Create an invoice', sub: 'GST-ready, printable A4', done: invoices.some((i) => i.status !== 'Draft'), to: '/app/sales/invoices/new' },
    ...(vendors ? [{ label: 'Add a vendor', sub: 'For purchases & bills', done: vendors.length > 0, to: '/app/purchases/vendors?new=1' }] : []),
    ...(staff ? [{ label: 'Invite your team', sub: 'Role-based staff logins', done: staff.length > 1, to: '/app/team' }] : []),
  ];
  const done = steps.filter((s) => s.done).length;
  if (done === steps.length) return null;
  const pct = Math.round((done / steps.length) * 100);
  return (
    <div className="card gs-card" style={{ marginBottom: 18 }}>
      <div className="gs-head">
        <div style={{ flex: 1 }}>
          <h3>Finish setting up your business</h3>
          <p>{done} of {steps.length} steps complete</p>
        </div>
        <div className="progress gs-progress" aria-label={`${pct}% complete`}><span style={{ width: `${pct}%` }} /></div>
        <span className="small muted" style={{ width: 36, textAlign: 'right' }}>{pct}%</span>
        <button className="icon-btn" style={{ color: '#fff' }} aria-label="Hide checklist" title="Hide checklist" onClick={() => setHidden(true)}><X size={18} /></button>
      </div>
      <div className="gs-steps">
        {steps.map((s) => (
          <Link key={s.label} to={s.to} className={`gs-step ${s.done ? 'done' : ''}`}>
            <span className="gs-check"><Check size={14} strokeWidth={3} /></span>
            <span>{s.label}<span className="gs-sub">{s.done ? 'Done' : s.sub}</span></span>
            {!s.done && <ArrowRight size={14} className="muted" style={{ marginLeft: 'auto' }} />}
          </Link>
        ))}
      </div>
    </div>
  );
}
