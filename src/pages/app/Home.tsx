import { Link, useNavigate } from 'react-router-dom';
import { useMemo, useState } from 'react';
import { Check, X, IndianRupee, Clock4, FileText, PackageX, UserPlus, PackagePlus, ScanLine, ArrowRight, Wallet, AlertTriangle, Users, BarChart3, CalendarDays, Receipt, Landmark } from 'lucide-react';
import { useCustomers, useDashboard, useInvoices, useItems, useOrg, useStaff, useVendors } from '@/api/hooks';
import { useLocalFlag } from '@/components/kit';
import { useShopUser } from '@/context/AuthContext';
import { usePrefs } from '@/context/PrefsContext';
import { EmptyState, PageHeader, StatCard } from '@/components/ui';
import { StatusBadge } from '@/components/StatusBadge';
import { AreaChart, Donut, MeterList } from '@/components/charts';
import { fmtDate, money, moneyShort } from '@/lib/format';

const pctChange = (cur: number, prev: number) => (prev > 0 ? Math.round(((cur - prev) / prev) * 100) : cur > 0 ? 100 : null);
const STATUS_COLORS = { Paid: '#7d8c77', 'Partially Paid': '#c98a3c', Sent: '#e398a4', Overdue: '#b53a3a' } as const;

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

  const actions = [
    canSell && { label: 'New Invoice', sub: 'GST bill in seconds', icon: FileText, to: '/app/sales/invoices/new', tone: 'rose' },
    canSell && { label: 'POS Billing', sub: 'Scan & sell at counter', icon: ScanLine, to: '/app/pos', tone: 'plum' },
    me.can('items.write') && { label: 'Add Product', sub: 'With photo & price', icon: PackagePlus, to: '/app/items/new', tone: 'sage' },
    me.can('customers.write') && { label: 'Add Customer', sub: 'Name & phone', icon: UserPlus, to: '/app/sales/customers?new=1', tone: 'blush' },
    me.can('purchases.write') && { label: 'Purchase Bill', sub: 'Upload a photo of it', icon: Receipt, to: '/app/purchases/bills?new=1', tone: 'gold' },
    me.can('reports.read') && { label: 'Reports', sub: 'Profit, GST, stock', icon: BarChart3, to: '/app/reports', tone: 'cocoa' },
  ].filter(Boolean) as Array<{ label: string; sub: string; icon: typeof FileText; to: string; tone: string }>;

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

      {actions.length > 0 && (
        <nav className="big-actions" aria-label="Quick actions">
          {actions.map((a) => (
            <Link key={a.label} to={a.to} className={`big-action ba-${a.tone}`}>
              <span className="ba-icon"><a.icon size={22} /></span>
              <strong>{a.label}</strong>
              <span className="ba-sub">{a.sub}</span>
            </Link>
          ))}
        </nav>
      )}

      <GettingStarted />

      <div className="stat-grid">
        <StatCard label="Receivables" value={d ? money(d.receivable) : '—'} icon={Wallet} tone="amber" foot={d && (d.overdueCount ? <Link to="/app/reports/receivables" style={{ color: 'var(--red-600)', fontWeight: 600 }}>{money(d.overdue)} overdue · {d.overdueCount} invoice{d.overdueCount === 1 ? '' : 's'}</Link> : `${d.openCount} open invoice${d.openCount === 1 ? '' : 's'}`)} />
        {d?.payable != null ? (
          <StatCard label="Payables" value={money(d.payable)} icon={Receipt} tone="red" foot={d.payableOverdueCount ? <Link to="/app/reports/payables" style={{ color: 'var(--red-600)', fontWeight: 600 }}>{money(d.payableOverdue ?? 0)} overdue</Link> : 'Nothing overdue'} />
        ) : <StatCard label="Total Revenue" value={d ? money(d.fySales) : '—'} icon={IndianRupee} tone="green" foot={d && <>FY {d.fy}</>} />}
        {d?.cash ? (
          <StatCard label="Cash in bank" value={money(d.cash.reduce((s2, a2) => s2 + a2.balance, 0))} icon={Landmark} tone="blue" foot={<Link to="/app/banking">{d.cash.length} account{d.cash.length === 1 ? '' : 's'}</Link>} />
        ) : <StatCard label="Total Customers" value={customers.data ? custList.length : '—'} icon={Users} tone="violet" trend={{ pct: pctChange(custCur, custPrev), label: 'new vs last month' }} foot={`${custCur} new this month`} />}
        <StatCard label="Sales this month" value={d ? money(d.thisMonthSales) : '—'} icon={IndianRupee} tone="green" trend={d ? { pct: pctChange(d.thisMonthSales, d.lastMonthToDate), label: 'vs same days last month' } : undefined} foot={d && `Last month ${money(d.lastMonthSales)}`} />
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

      <div className="grid-3 mt-16">
        <div className="card">
          <div className="card-header"><div><h3>Overdue invoices</h3><p>Oldest first</p></div><Link to="/app/reports/receivables" className="btn btn-ghost btn-sm">Ageing <ArrowRight size={14} /></Link></div>
          {!d ? <div className="skeleton" style={{ height: 150, margin: 16 }} /> : d.overdueList.length === 0 ? <div className="card-body muted small"><Check size={14} style={{ verticalAlign: -2, color: 'var(--green-600)' }} /> Nothing overdue. Every invoice is within its due date.</div> : (
            <ul className="dash-list">{d.overdueList.map((o) => (
              <li key={o.id}><Link to={`/app/sales/invoices/${o.id}`}><span><strong>{o.customer}</strong><span className="muted small">{o.number} · {o.days} day{o.days === 1 ? '' : 's'} overdue</span></span><span className="num strong" style={{ color: 'var(--red-600)' }}>{money(o.balance)}</span></Link></li>
            ))}</ul>
          )}
        </div>
        <div className="card">
          <div className="card-header"><div><h3>Low stock</h3><p>At or below the reorder level</p></div><Link to="/app/items?tab=stock" className="btn btn-ghost btn-sm">All alerts <ArrowRight size={14} /></Link></div>
          {!d ? <div className="skeleton" style={{ height: 150, margin: 16 }} /> : d.lowStockList.length === 0 ? <div className="card-body muted small"><Check size={14} style={{ verticalAlign: -2, color: 'var(--green-600)' }} /> Every item is above its reorder level.</div> : (
            <ul className="dash-list">{d.lowStockList.map((x) => (
              <li key={x.id}><Link to={`/app/items?open=${x.id}`}><span><strong>{x.name}</strong><span className="muted small">Reorder at {x.reorderLevel} {x.unit}</span></span><span className="num strong" style={{ color: x.stock <= 0 ? 'var(--red-600)' : 'var(--amber-700)' }}>{x.stock} {x.unit}</span></Link></li>
            ))}</ul>
          )}
        </div>
        <div className="card">
          {d?.cash ? (<>
            <div className="card-header"><div><h3>Cash &amp; bank</h3><p>Current balances</p></div><Link to="/app/reports/cash-flow" className="btn btn-ghost btn-sm">Cash flow <ArrowRight size={14} /></Link></div>
            <ul className="dash-list">{d.cash.map((a) => (
              <li key={a.id}><Link to="/app/banking"><span><strong>{a.name}</strong><span className="muted small">{a.type}</span></span><span className="num strong" style={a.balance < 0 ? { color: 'var(--red-600)' } : undefined}>{money(a.balance)}</span></Link></li>
            ))}</ul>
          </>) : (<>
            <div className="card-header"><div><h3>This FY</h3><p>FY {d?.fy}</p></div></div>
            <div className="card-body stack" style={{ gap: 12 }}>
              <div className="glance"><span className="stat-icon tone-green"><IndianRupee size={16} /></span><div><span>Sales</span><strong>{d ? money(d.fySales) : '—'}</strong></div></div>
              <div className="glance"><span className="stat-icon tone-blue"><FileText size={16} /></span><div><span>Invoices issued</span><strong>{invoices.data ? issued.length : '—'}</strong></div></div>
            </div>
          </>)}
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
