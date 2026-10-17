import { Link, useNavigate } from 'react-router-dom';
import { Check, X, Rocket, IndianRupee, Clock4, FileText, PackageX, Plus, UserPlus, PackagePlus, ScanLine, ArrowRight, Wallet, AlertTriangle } from 'lucide-react';
import { useCustomers, useDashboard, useInvoices, useItems, useOrg, useStaff, useVendors } from '@/api/hooks';
import { useLocalFlag } from '@/components/kit';
import { useShopUser } from '@/context/AuthContext';
import { usePrefs } from '@/context/PrefsContext';
import { EmptyState, PageHeader, StatCard } from '@/components/ui';
import { StatusBadge } from '@/components/StatusBadge';
import { BarChart, MeterList } from '@/components/charts';
import { fmtDate, money, moneyShort } from '@/lib/format';

export default function Home() {
  const me = useShopUser();
  const { t } = usePrefs();
  const navigate = useNavigate();
  const dash = useDashboard();
  const invoices = useInvoices();
  const d = dash.data;
  const hour = new Date().getHours();
  const greet = t(hour < 12 ? 'home.goodMorning' : hour < 17 ? 'home.goodAfternoon' : 'home.goodEvening');
  const recent = (invoices.data ?? []).filter((i) => i.status !== 'Draft').slice(0, 6);
  const canSell = me.can('sales.write');

  const quick = [
    ...(canSell ? [{ label: t('shell.newInvoice'), icon: FileText, to: '/app/sales/invoices/new', tone: 'blue', key: 'Alt N' }, { label: t('nav.pos'), icon: ScanLine, to: '/app/pos', tone: 'teal', key: 'Alt P' }] : []),
    ...(me.can('customers.write') ? [{ label: t('home.addCustomer'), icon: UserPlus, to: '/app/sales/customers?new=1', tone: 'green', key: 'Alt C' }] : []),
    ...(me.can('items.write') ? [{ label: t('home.addItem'), icon: PackagePlus, to: '/app/items/new', tone: 'violet', key: 'Alt I' }] : []),
  ];

  if (dash.isError) {
    return (
      <div className="page">
        <div className="card"><EmptyState icon={AlertTriangle} title="Couldn’t load your dashboard" text={dash.error.message} action={<button className="btn btn-primary" onClick={() => dash.refetch()}>{t('common.retry')}</button>} /></div>
      </div>
    );
  }

  return (
    <div className="page">
      <PageHeader
        title={`${greet}, ${me.user.name.split(' ')[0]}`}
        subtitle={`${me.shop.name} · Financial year ${d?.fy ?? '…'} (1 Apr – 31 Mar)`}
        actions={canSell && <button className="btn btn-primary" onClick={() => navigate('/app/sales/invoices/new')}><Plus size={16} /> {t('shell.newInvoice')}</button>}
      />

      <GettingStarted />

      <div className="stat-grid">
        <StatCard label={t('home.receivables')} value={d ? money(d.receivable) : '—'} icon={Wallet} tone="blue" foot={d && <>{d.openCount} invoices awaiting payment</>} />
        <StatCard label={t('home.overdue')} value={d ? money(d.overdue) : '—'} icon={Clock4} tone="red" foot={d && <Link to="/app/sales/invoices?status=Overdue">{d.overdueCount} invoices past due →</Link>} />
        <StatCard label={`${t('home.sales')} · FY ${d?.fy ?? ''}`} value={d ? moneyShort(d.fySales) : '—'} icon={IndianRupee} tone="green" foot={d && <>{t('home.today')}: {money(d.todaySales)}</>} />
        <StatCard label={t('home.lowStock')} value={d ? d.lowStock : '—'} icon={PackageX} tone="amber" foot={<Link to="/app/items?tab=stock">At or below reorder level →</Link>} />
      </div>

      {quick.length > 0 && (
        <div className="card mt-16">
          <div className="card-body" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, padding: 14 }}>
            {quick.map((q) => (
              <Link key={q.label} to={q.to} className="row" style={{ padding: '10px 12px', borderRadius: 10, border: '1px solid var(--border)', color: 'var(--ink-800)', fontWeight: 600 }}>
                <span className={`stat-icon tone-${q.tone}`} style={{ width: 34, height: 34 }}><q.icon size={17} /></span>
                {q.label}
                <span className="kbd desktop-only" style={{ marginLeft: 'auto' }}>{q.key}</span>
                <ArrowRight size={15} className="muted mobile-only" style={{ marginLeft: 'auto' }} />
              </Link>
            ))}
          </div>
        </div>
      )}

      <div className="grid-3-1 mt-16">
        <div className="card">
          <div className="card-header"><div><h3>{t('home.salesCollections')}</h3><p>Invoiced vs. received, last 6 months</p></div></div>
          <div className="card-body">
            {d ? (
              <BarChart
                labels={d.monthly.map((m) => new Date(m.month + '-01').toLocaleString('en-IN', { month: 'short' }))}
                series={[{ name: t('home.invoiced'), values: d.monthly.map((m) => m.invoiced) }, { name: t('home.collected'), values: d.monthly.map((m) => m.collected) }]}
                format={moneyShort}
              />
            ) : <div className="skeleton" style={{ height: 240 }} />}
          </div>
        </div>
        <div className="card">
          <div className="card-header"><div><h3>{t('home.topItems')}</h3><p>By invoiced value this FY</p></div></div>
          <div className="card-body">
            {d?.topItems.length ? <MeterList rows={d.topItems.map((x) => ({ label: x.name, value: x.amount }))} format={moneyShort} /> : d ? <p className="muted small">No sales yet.</p> : <div className="skeleton" style={{ height: 200 }} />}
          </div>
        </div>
      </div>

      <div className="card mt-16">
        <div className="card-header">
          <div><h3>{t('home.recent')}</h3><p>Latest billing activity across branches</p></div>
          <Link to="/app/sales/invoices" className="btn btn-ghost btn-sm">{t('home.viewAll')} <ArrowRight size={14} /></Link>
        </div>
        <div className="table-wrap">
          {invoices.isLoading ? <div style={{ padding: 16 }}><div className="skeleton" style={{ height: 160 }} /></div> : recent.length === 0 ? (
            <EmptyState icon={FileText} title="No invoices yet" text="Create your first GST invoice in under a minute." action={canSell && <Link to="/app/sales/invoices/new" className="btn btn-primary">Create invoice</Link>} />
          ) : (
            <table className="table">
              <thead><tr><th>{t('common.date')}</th><th>Invoice #</th><th>{t('common.customer')}</th><th>{t('common.status')}</th><th className="num">{t('common.amount')}</th></tr></thead>
              <tbody>
                {recent.map((inv) => (
                  <tr key={inv.id} className="clickable" onClick={() => navigate(`/app/sales/invoices/${inv.id}`)}>
                    <td>{fmtDate(inv.date)}</td>
                    <td className="strong" style={{ color: 'var(--brand-600)' }}>{inv.number}</td>
                    <td>{inv.customer.companyName || inv.customer.name}</td>
                    <td><StatusBadge status={inv.paymentStatus} /></td>
                    <td className="num strong">{money(inv.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

function Ring({ pct }: { pct: number }) {
  const r = 24, c = 2 * Math.PI * r;
  return (
    <svg className="gs-ring" viewBox="0 0 58 58" aria-label={`${pct}% complete`}>
      <circle cx="29" cy="29" r={r} fill="none" stroke="rgba(255,255,255,.25)" strokeWidth="6" />
      <circle cx="29" cy="29" r={r} fill="none" stroke="#fff" strokeWidth="6" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - pct / 100)} transform="rotate(-90 29 29)" style={{ transition: 'stroke-dashoffset .6s ease' }} />
      <text x="29" y="33" textAnchor="middle" fontSize="13" fontWeight="800" fill="#fff">{pct}%</text>
    </svg>
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
        <Ring pct={pct} />
        <div style={{ flex: 1 }}>
          <h3><Rocket size={17} style={{ verticalAlign: -3, marginRight: 6 }} />Get your shop ready</h3>
          <p>{done} of {steps.length} done — finish setup to send professional GST invoices and get paid faster.</p>
        </div>
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
