import { Link, useNavigate } from 'react-router-dom';
import { IndianRupee, Clock4, FileText, PackageX, Plus, UserPlus, PackagePlus, ScanLine, ArrowRight, Wallet, AlertTriangle } from 'lucide-react';
import { useDashboard, useInvoices } from '@/api/hooks';
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
    ...(me.can('items.write') ? [{ label: t('home.addItem'), icon: PackagePlus, to: '/app/items?new=1', tone: 'violet', key: 'Alt I' }] : []),
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
