import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Plus, FileText, Printer, Download, Send, X, MessageCircle } from 'lucide-react';
import { api } from '@/api/client';
import { useBranches, useInvoices, useOrg } from '@/api/hooks';
import type { Invoice, InvoiceStatus } from '@/api/types';
import { useShopUser } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { usePrefs } from '@/context/PrefsContext';
import { Badge, EmptyState, PageHeader, Pagination, SearchInput, usePagination } from '@/components/ui';
import { StatusBadge } from '@/components/StatusBadge';
import { SavedViewsMenu, useSavedViews } from '@/components/SavedViews';
import { fmtDate, money } from '@/lib/format';
import { daysUntil, fyLabel } from '@/lib/fy';
import { toCsv } from '../../../shared/csv';
import { waLink } from './InvoiceView';
import { Hint } from '@/components/kit';

const TABS: Array<'All' | InvoiceStatus> = ['All', 'Draft', 'Unpaid', 'Partially Paid', 'Overdue', 'Paid', 'Cancelled'];

function exportCsv(rows: Invoice[]) {
  const csv = toCsv(
    rows.map((i) => ({ number: i.number ?? 'Draft', date: i.date, due: i.dueDate, customer: i.customer.companyName || i.customer.name, gstin: i.customer.gstin, status: i.paymentStatus, taxable: i.subTotal, tax: i.taxTotal, total: i.total, paid: i.amountPaid, balance: i.balance })),
    [
      { key: 'number', label: 'Invoice #' }, { key: 'date', label: 'Date' }, { key: 'due', label: 'Due date' }, { key: 'customer', label: 'Customer' }, { key: 'gstin', label: 'GSTIN' },
      { key: 'status', label: 'Status' }, { key: 'taxable', label: 'Taxable value' }, { key: 'tax', label: 'GST' }, { key: 'total', label: 'Total' }, { key: 'paid', label: 'Paid' }, { key: 'balance', label: 'Balance' },
    ],
  );
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv' }));
  a.download = `invoices-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
}

export default function Invoices() {
  const me = useShopUser();
  const { t } = usePrefs();
  const toast = useToast();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const { data: invoices = [], isLoading } = useInvoices();
  const branches = useBranches().data ?? [];
  const org = useOrg().data;
  const sv = useSavedViews('invoices', { tab: 'All' as (typeof TABS)[number], q: '', fy: 'all', branch: 'all', mode: 'all' });
  const { tab, q, fy, branch, mode } = sv.filters;
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sending, setSending] = useState(false);

  useEffect(() => {
    const s = params.get('status');
    if (s && TABS.includes(s as InvoiceStatus)) { sv.setFilters({ tab: s as InvoiceStatus }); params.delete('status'); setParams(params, { replace: true }); }
  }, []);

  const fys = [...new Set(invoices.map((i) => i.fy))].sort().reverse();
  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    return invoices
      .filter((r) => tab === 'All' || r.paymentStatus === tab)
      .filter((r) => fy === 'all' || r.fy === fy)
      .filter((r) => branch === 'all' || r.branchId === branch)
      .filter((r) => mode === 'all' || (mode === 'gst' ? r.withGst : !r.withGst))
      .filter((r) => !s || [r.number ?? 'draft', r.customer.name, r.customer.companyName, r.customer.customId, r.customer.gstin].some((v) => v.toLowerCase().includes(s)));
  }, [invoices, tab, q, fy, branch, mode]);
  const pg = usePagination(rows, 12);

  const sum = (st: InvoiceStatus[]) => invoices.filter((r) => st.includes(r.paymentStatus)).reduce((s, r) => s + Math.max(0, st.includes('Paid') ? r.amountPaid : r.balance), 0);
  const count = (st: (typeof TABS)[number]) => (st === 'All' ? invoices.length : invoices.filter((r) => r.paymentStatus === st).length);
  const sel = rows.filter((r) => selected.has(r.id));
  const allOnPage = pg.slice.length > 0 && pg.slice.every((i) => selected.has(i.id));

  const emailReminders = async () => {
    const due = sel.filter((i) => i.status === 'Issued' && i.balance > 0);
    if (!due.length) return toast('info', 'No unpaid invoices selected');
    setSending(true);
    let sent = 0;
    for (const i of due) {
      try {
        const r = await api.post<{ status: string }>(`/shop/invoices/${i.id}/reminders`, { channel: 'email' });
        if (r.status === 'sent') sent++;
      } catch { /* continue with the rest */ }
    }
    setSending(false);
    toast(sent ? 'success' : 'info', `${sent} of ${due.length} reminders emailed`, sent < due.length ? 'Customers without email (or no SMTP on the server) were skipped.' : undefined);
  };

  return (
    <div className="page">
      <PageHeader
        title={t('nav.invoices')}
        crumbs={<>{t('nav.sales')} <span>/</span> {t('nav.invoices')}</>}
        subtitle={me.platform.autoResetInvoiceNumbering ? `Numbering for FY ${fyLabel(new Date(), me.platform.fyStartMonth)} restarts from 0001 every 1 April.` : 'Invoice numbering continues across financial years.'}
        actions={me.can('sales.write') && <Link to="/app/sales/invoices/new" className="btn btn-primary" title="Alt N"><Plus size={16} /> {t('shell.newInvoice')}</Link>}
      />
      <Hint id="invoices" title="Invoicing in three steps">
        <ol><li>Click <strong>New Invoice</strong>, choose the customer and scan or pick items.</li><li>Toggle <strong>GST / Net</strong> — inter-state sales switch to IGST automatically.</li><li>Issue it, then share by WhatsApp, print an A4 copy or send a payment link with UPI QR.</li></ol>
      </Hint>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-body" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 0, padding: 0 }}>
          {([
            ['Outstanding receivables', sum(['Unpaid', 'Partially Paid', 'Overdue']), 'var(--ink-900)', 'Unpaid'],
            ['Overdue', sum(['Overdue']), 'var(--red-600)', 'Overdue'],
            ['Collected (fully paid)', sum(['Paid']), 'var(--green-700)', 'Paid'],
            ['Drafts', invoices.filter((i) => i.status === 'Draft').reduce((s, i) => s + i.total, 0), 'var(--ink-500)', 'Draft'],
          ] as const).map(([l, v, c, tabKey], i) => (
            <button key={l} onClick={() => sv.setFilters({ tab: tabKey })} style={{ padding: '16px 20px', textAlign: 'left', background: 'none', border: 'none', borderLeft: i ? '1px solid var(--border)' : 'none', cursor: 'pointer', fontFamily: 'inherit' }}>
              <div className="small muted" style={{ fontWeight: 600 }}>{l}</div>
              <div style={{ fontSize: 20, fontWeight: 600, color: c, marginTop: 4 }}>{money(v)}</div>
            </button>
          ))}
        </div>
      </div>

      <div className="card">
        <div style={{ padding: '0 16px', overflowX: 'auto' }}>
          <div className="tabs" style={{ marginBottom: 0, borderBottom: 'none' }}>
            {TABS.map((tb) => <button key={tb} className={tab === tb ? 'active' : ''} onClick={() => { sv.setFilters({ tab: tb }); pg.setPage(1); }}>{tb === 'All' ? t('common.all') : t(`status.${tb}`, tb)} <span className="count">{count(tb)}</span></button>)}
          </div>
        </div>
        <div className="toolbar" style={{ borderTop: '1px solid var(--border)' }}>
          <div className="toolbar-left">
            <SearchInput value={q} onChange={(v) => { sv.setFilters({ q: v }); pg.setPage(1); }} placeholder="Search invoice #, customer, GSTIN…" />
            <select className="select" value={fy} onChange={(e) => sv.setFilters({ fy: e.target.value })} aria-label="Financial year"><option value="all">All financial years</option>{fys.map((f) => <option key={f} value={f}>FY {f}</option>)}</select>
            {branches.length > 1 && <select className="select" value={branch} onChange={(e) => sv.setFilters({ branch: e.target.value })} aria-label="Branch"><option value="all">All branches</option>{branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select>}
            <select className="select" value={mode} onChange={(e) => sv.setFilters({ mode: e.target.value })} aria-label="Tax mode"><option value="all">GST &amp; net</option><option value="gst">With GST</option><option value="net">Net (no tax)</option></select>
          </div>
          <div className="toolbar-right">
            <SavedViewsMenu sv={sv} isActive={(f) => JSON.stringify(f) === JSON.stringify(sv.filters)} />
            <button className="btn btn-secondary btn-sm" onClick={() => exportCsv(rows)} disabled={!rows.length}><Download size={14} /> Export</button>
          </div>
        </div>
        {selected.size > 0 && (
          <div className="bulk-bar">
            {selected.size} selected · {money(sel.reduce((s, i) => s + i.total, 0))}
            <button className="btn btn-secondary btn-sm" onClick={() => exportCsv(sel)}><Download size={14} /> Export selected</button>
            {me.can('sales.write') && <button className="btn btn-secondary btn-sm" disabled={sending} onClick={emailReminders}><Send size={14} /> Email reminders</button>}
            <button className="btn btn-ghost btn-sm" onClick={() => setSelected(new Set())}><X size={14} /> Clear</button>
          </div>
        )}
        <div className="table-wrap">
          {isLoading ? <div style={{ padding: 16 }}><div className="skeleton" style={{ height: 280 }} /></div> : rows.length === 0 ? (
            <EmptyState icon={FileText} title="No invoices here" text="Invoices you create will show up in this list." action={me.can('sales.write') && <Link to="/app/sales/invoices/new" className="btn btn-primary"><Plus size={15} /> {t('shell.newInvoice')}</Link>} />
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th style={{ width: 36 }}><input type="checkbox" className="checkbox" checked={allOnPage} onChange={() => setSelected((s) => { const n = new Set(s); pg.slice.forEach((i) => (allOnPage ? n.delete(i.id) : n.add(i.id))); return n; })} aria-label="Select all on page" /></th>
                  <th>{t('common.date')}</th><th>Invoice #</th><th>{t('common.customer')}</th><th>Type</th><th>{t('common.status')}</th><th>Due</th><th className="num">{t('common.amount')}</th><th className="num">Balance</th><th />
                </tr>
              </thead>
              <tbody>
                {pg.slice.map((inv) => {
                  const d = daysUntil(inv.dueDate);
                  return (
                    <tr key={inv.id} className="clickable" onClick={() => navigate(`/app/sales/invoices/${inv.id}`)}>
                      <td onClick={(e) => e.stopPropagation()}><input type="checkbox" className="checkbox" checked={selected.has(inv.id)} onChange={() => setSelected((s) => { const n = new Set(s); n.has(inv.id) ? n.delete(inv.id) : n.add(inv.id); return n; })} aria-label={`Select ${inv.number ?? 'draft'}`} /></td>
                      <td>{fmtDate(inv.date)}</td>
                      <td className="strong" style={{ color: inv.number ? 'var(--brand-600)' : 'var(--ink-500)' }}>{inv.number ?? 'Draft'}{inv.source === 'pos' && <span className="chip" style={{ marginLeft: 6 }}>POS</span>}</td>
                      <td><div className="strong">{inv.customer.companyName || inv.customer.name}</div><div className="muted">{inv.customer.customId || 'Walk-in'}</div></td>
                      <td>{inv.docType === 'TAX INVOICE' ? <Badge tone="green" plain>GST</Badge> : inv.docType === 'BILL OF SUPPLY' ? <Badge tone="violet" plain>BoS</Badge> : <Badge tone="amber" plain>Net</Badge>}</td>
                      <td><StatusBadge status={inv.paymentStatus} /></td>
                      <td className="muted">{inv.status !== 'Issued' || inv.balance <= 0 ? '—' : d < 0 ? <span style={{ color: 'var(--red-600)' }}>{-d}d overdue</span> : d === 0 ? 'Today' : `in ${d}d`}</td>
                      <td className="num strong">{money(inv.total)}</td>
                      <td className="num">{inv.status === 'Issued' ? money(Math.max(0, inv.balance)) : '—'}</td>
                      <td className="num" style={{ whiteSpace: 'nowrap' }} onClick={(e) => e.stopPropagation()}>
                        {inv.status === 'Issued' && inv.balance > 0 && org && inv.customer.phone && (
                          <a className="icon-btn" title="WhatsApp reminder" target="_blank" rel="noreferrer" href={waLink(inv.customer.phone, `Dear ${inv.customer.companyName || inv.customer.name}, a gentle reminder that invoice ${inv.number} has ${money(inv.balance)} due. ${inv.publicToken ? `${window.location.origin}/share/${inv.publicToken}` : ''} — ${org.companyName}`)}><MessageCircle size={15} /></a>
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
