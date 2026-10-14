import { useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { IndianRupee, Clock4, FileText, PackageX, Plus, UserPlus, PackagePlus, ClipboardList, ArrowRight, Wallet } from 'lucide-react';
import { useTenant } from '@/context/TenantContext';
import { useAuth } from '@/context/AuthContext';
import { Badge, PageHeader, StatCard, EmptyState } from '@/components/ui';
import { BarChart, MeterList } from '@/components/charts';
import { docTotals, effectiveStatus } from '@/lib/invoice';
import { fmtDate, money, moneyShort } from '@/lib/format';
import { fyLabel, fyRange } from '@/lib/fy';

export default function Home() {
  const { tenant } = useTenant();
  const { session } = useAuth();
  const navigate = useNavigate();
  const fy = fyLabel();
  const { start: fyStart } = fyRange();

  const data = useMemo(() => {
    const withTotals = tenant.invoices.map((inv) => ({ inv, total: docTotals(tenant, inv).total, status: effectiveStatus(inv) }));
    const receivable = withTotals.filter((x) => x.status === 'Unpaid' || x.status === 'Overdue').reduce((s, x) => s + x.total, 0);
    const overdue = withTotals.filter((x) => x.status === 'Overdue');
    const fySales = withTotals.filter((x) => new Date(x.inv.date) >= fyStart && x.status !== 'Draft').reduce((s, x) => s + x.total, 0);
    const lowStock = tenant.items.filter((i) => i.type === 'Goods' && i.stock <= 10);

    const now = new Date();
    const months = Array.from({ length: 6 }, (_, i) => {
      const d = new Date(now.getFullYear(), now.getMonth() - 5 + i, 1);
      const e = new Date(d.getFullYear(), d.getMonth() + 1, 1);
      const inM = withTotals.filter((x) => {
        const dt = new Date(x.inv.date);
        return dt >= d && dt < e && x.status !== 'Draft';
      });
      return {
        label: d.toLocaleString('en-IN', { month: 'short' }),
        sales: inM.reduce((s, x) => s + x.total, 0),
        collected: inM.filter((x) => x.status === 'Paid').reduce((s, x) => s + x.total, 0),
      };
    });

    const byItem = new Map<string, number>();
    for (const inv of tenant.invoices) for (const l of inv.lines) byItem.set(l.name, (byItem.get(l.name) ?? 0) + l.qty * l.rate);
    const topItems = [...byItem.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([label, value]) => ({ label, value }));

    const recent = [...withTotals].sort((a, b) => b.inv.date.localeCompare(a.inv.date)).slice(0, 6);
    return { receivable, overdue, fySales, lowStock, months, topItems, recent };
  }, [tenant, fyStart]);

  const cust = (id: string) => tenant.customers.find((c) => c.id === id);
  const hour = new Date().getHours();
  const greet = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  const quick = [
    { label: 'New Invoice', icon: FileText, to: '/app/sales/invoices/new', tone: 'blue' },
    { label: 'Add Customer', icon: UserPlus, to: '/app/sales/customers?new=1', tone: 'green' },
    { label: 'Add Item', icon: PackagePlus, to: '/app/items?new=1', tone: 'violet' },
    { label: 'Sales Order', icon: ClipboardList, to: '/app/sales/orders?new=1', tone: 'amber' },
  ];

  return (
    <div className="page">
      <PageHeader
        title={`${greet}, ${session!.name.split(' ')[0]}`}
        subtitle={`${tenant.org.companyName} · Financial year ${fy} (1 Apr – 31 Mar)`}
        actions={
          <button className="btn btn-primary" onClick={() => navigate('/app/sales/invoices/new')}>
            <Plus size={16} /> New Invoice
          </button>
        }
      />

      <div className="stat-grid">
        <StatCard label="Total Receivables" value={money(data.receivable)} icon={Wallet} tone="blue" foot={<>{tenant.invoices.filter((i) => effectiveStatus(i) !== 'Paid' && i.status !== 'Draft').length} invoices awaiting payment</>} />
        <StatCard label="Overdue" value={money(data.overdue.reduce((s, x) => s + x.total, 0))} icon={Clock4} tone="red" foot={<>{data.overdue.length} invoices past due date</>} />
        <StatCard label={`Sales · FY ${fy}`} value={moneyShort(data.fySales)} icon={IndianRupee} tone="green" foot={<>Since {fmtDate(fyStart.toISOString())}</>} />
        <StatCard label="Low Stock Items" value={data.lowStock.length} icon={PackageX} tone="amber" foot={<>Goods with ≤ 10 units on hand</>} />
      </div>

      <div className="card mt-16">
        <div className="card-body" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, padding: 14 }}>
          {quick.map((q) => (
            <Link key={q.label} to={q.to} className="row" style={{ padding: '10px 12px', borderRadius: 10, border: '1px solid var(--border)', color: 'var(--ink-800)', fontWeight: 600 }}>
              <span className={`stat-icon tone-${q.tone}`} style={{ width: 34, height: 34 }}>
                <q.icon size={17} />
              </span>
              {q.label}
              <ArrowRight size={15} className="muted" style={{ marginLeft: 'auto' }} />
            </Link>
          ))}
        </div>
      </div>

      <div className="grid-3-1 mt-16">
        <div className="card">
          <div className="card-header">
            <div>
              <h3>Sales &amp; collections</h3>
              <p>Invoiced vs. received, last 6 months</p>
            </div>
          </div>
          <div className="card-body">
            <BarChart
              labels={data.months.map((m) => m.label)}
              series={[
                { name: 'Invoiced', values: data.months.map((m) => m.sales) },
                { name: 'Collected', values: data.months.map((m) => m.collected) },
              ]}
              format={moneyShort}
            />
          </div>
        </div>
        <div className="card">
          <div className="card-header">
            <div>
              <h3>Top selling items</h3>
              <p>By invoiced value</p>
            </div>
          </div>
          <div className="card-body">
            {data.topItems.length ? <MeterList rows={data.topItems} format={moneyShort} /> : <p className="muted small">No sales yet.</p>}
          </div>
        </div>
      </div>

      <div className="card mt-16">
        <div className="card-header">
          <div>
            <h3>Recent invoices</h3>
            <p>Latest billing activity across branches</p>
          </div>
          <Link to="/app/sales/invoices" className="btn btn-ghost btn-sm">
            View all <ArrowRight size={14} />
          </Link>
        </div>
        <div className="table-wrap">
          {data.recent.length === 0 ? (
            <EmptyState icon={FileText} title="No invoices yet" text="Create your first GST invoice in under a minute." action={<Link to="/app/sales/invoices/new" className="btn btn-primary">Create invoice</Link>} />
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Invoice #</th>
                  <th>Customer</th>
                  <th>Status</th>
                  <th className="num">Amount</th>
                </tr>
              </thead>
              <tbody>
                {data.recent.map(({ inv, total, status }) => (
                  <tr key={inv.id} className="clickable" onClick={() => navigate(`/app/sales/invoices/${inv.id}`)}>
                    <td>{fmtDate(inv.date)}</td>
                    <td className="strong" style={{ color: 'var(--brand-600)' }}>{inv.number}</td>
                    <td>{cust(inv.customerId)?.companyName || cust(inv.customerId)?.name}</td>
                    <td><Badge>{status}</Badge></td>
                    <td className="num strong">{money(total)}</td>
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
