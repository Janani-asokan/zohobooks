import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Plus, FileText, CheckCircle2, Printer } from 'lucide-react';
import { useTenant } from '@/context/TenantContext';
import { useToast } from '@/context/ToastContext';
import { Badge, EmptyState, PageHeader, Pagination, SearchInput, usePagination } from '@/components/ui';
import { docTotals, effectiveStatus } from '@/lib/invoice';
import { fmtDate, money } from '@/lib/format';
import { daysUntil, fyLabel } from '@/lib/fy';
import type { InvoiceStatus } from '@/lib/types';

export default function Invoices() {
  const { tenant, mutate } = useTenant();
  const toast = useToast();
  const navigate = useNavigate();
  const [tab, setTab] = useState<'All' | InvoiceStatus>('All');
  const [q, setQ] = useState('');
  const [fy, setFy] = useState('all');

  const all = useMemo(
    () =>
      tenant.invoices.map((inv) => ({
        inv,
        status: effectiveStatus(inv),
        total: docTotals(tenant, inv).total,
        customer: tenant.customers.find((c) => c.id === inv.customerId),
        branch: tenant.branches.find((b) => b.id === inv.branchId)?.name ?? '—',
      })),
    [tenant],
  );
  const fys = [...new Set(tenant.invoices.map((i) => i.fy))].sort().reverse();

  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    return all
      .filter((r) => tab === 'All' || r.status === tab)
      .filter((r) => fy === 'all' || r.inv.fy === fy)
      .filter((r) => !s || [r.inv.number, r.customer?.name ?? '', r.customer?.companyName ?? '', r.customer?.customId ?? ''].some((v) => v.toLowerCase().includes(s)))
      .sort((a, b) => b.inv.date.localeCompare(a.inv.date) || b.inv.number.localeCompare(a.inv.number));
  }, [all, tab, q, fy]);
  const pg = usePagination(rows, 10);

  const sum = (st: InvoiceStatus[]) => all.filter((r) => st.includes(r.status)).reduce((s, r) => s + r.total, 0);
  const count = (st: 'All' | InvoiceStatus) => (st === 'All' ? all.length : all.filter((r) => r.status === st).length);

  return (
    <div className="page">
      <PageHeader
        title="Invoices"
        crumbs={<>Sales <span>/</span> Invoices</>}
        subtitle={`Numbering for FY ${fyLabel()} restarts from 0001 every 1 April.`}
        actions={<Link to="/app/sales/invoices/new" className="btn btn-primary"><Plus size={16} /> New Invoice</Link>}
      />

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-body" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 0, padding: 0 }}>
          {[
            ['Outstanding receivables', sum(['Unpaid', 'Overdue']), 'var(--ink-900)'],
            ['Overdue', sum(['Overdue']), 'var(--red-600)'],
            ['Collected', sum(['Paid']), 'var(--green-700)'],
            ['Drafts', sum(['Draft']), 'var(--ink-500)'],
          ].map(([l, v, c], i) => (
            <div key={l as string} style={{ padding: '16px 20px', borderLeft: i ? '1px solid var(--border)' : undefined }}>
              <div className="small muted" style={{ fontWeight: 600 }}>{l}</div>
              <div style={{ fontSize: 20, fontWeight: 800, color: c as string, marginTop: 4 }}>{money(v as number)}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="card">
        <div style={{ padding: '0 16px' }}>
          <div className="tabs" style={{ marginBottom: 0, borderBottom: 'none' }}>
            {(['All', 'Draft', 'Unpaid', 'Overdue', 'Paid'] as const).map((t) => (
              <button key={t} className={tab === t ? 'active' : ''} onClick={() => { setTab(t); pg.setPage(1); }}>
                {t} <span className="count">{count(t)}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="toolbar" style={{ borderTop: '1px solid var(--border)' }}>
          <div className="toolbar-left">
            <SearchInput value={q} onChange={(v) => { setQ(v); pg.setPage(1); }} placeholder="Search invoice #, customer, ID…" />
            <select className="select" value={fy} onChange={(e) => setFy(e.target.value)}>
              <option value="all">All financial years</option>
              {fys.map((f) => <option key={f} value={f}>FY {f}</option>)}
            </select>
          </div>
        </div>
        <div className="table-wrap">
          {rows.length === 0 ? (
            <EmptyState icon={FileText} title="No invoices here" text="Invoices you create will show up in this list." action={<Link to="/app/sales/invoices/new" className="btn btn-primary"><Plus size={15} /> New Invoice</Link>} />
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Invoice #</th>
                  <th>Customer</th>
                  <th>Branch</th>
                  <th>Tax mode</th>
                  <th>Status</th>
                  <th>Due</th>
                  <th className="num">Amount</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {pg.slice.map(({ inv, status, total, customer, branch }) => {
                  const d = daysUntil(inv.dueDate);
                  return (
                    <tr key={inv.id} className="clickable" onClick={() => navigate(`/app/sales/invoices/${inv.id}`)}>
                      <td>{fmtDate(inv.date)}</td>
                      <td className="strong" style={{ color: 'var(--brand-600)' }}>{inv.number}</td>
                      <td>
                        <div className="strong">{customer?.companyName || customer?.name || 'Deleted customer'}</div>
                        <div className="muted">{customer?.customId}</div>
                      </td>
                      <td className="muted">{branch}</td>
                      <td>{inv.withGst ? <Badge tone="green" plain>GST</Badge> : <Badge tone="amber" plain>Net</Badge>}</td>
                      <td><Badge>{status}</Badge></td>
                      <td className="muted">{status === 'Paid' ? '—' : d < 0 ? <span style={{ color: 'var(--red-600)' }}>{-d}d overdue</span> : d === 0 ? 'Today' : `in ${d}d`}</td>
                      <td className="num strong">{money(total)}</td>
                      <td className="num" style={{ whiteSpace: 'nowrap' }} onClick={(e) => e.stopPropagation()}>
                        {(status === 'Unpaid' || status === 'Overdue') && (
                          <button className="icon-btn" title="Record payment (mark paid)" onClick={() => { mutate((t) => void (t.invoices.find((x) => x.id === inv.id)!.status = 'Paid')); toast('success', 'Payment recorded', inv.number); }}>
                            <CheckCircle2 size={16} />
                          </button>
                        )}
                        <button className="icon-btn" title="Print" onClick={() => navigate(`/app/sales/invoices/${inv.id}?print=1`)}><Printer size={15} /></button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
        <Pagination {...pg} />
      </div>
    </div>
  );
}
