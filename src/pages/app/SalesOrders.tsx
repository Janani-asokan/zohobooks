import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Plus, ClipboardList, LayoutGrid, List, ArrowRight, FileText, Pencil, Trash2, Send, CheckCircle2, FilePen } from 'lucide-react';
import { useTenant } from '@/context/TenantContext';
import { useToast } from '@/context/ToastContext';
import { Badge, ConfirmModal, EmptyState, Field, Modal, PageHeader, SearchInput, Segmented } from '@/components/ui';
import { LineItemsEditor, TaxModeToggle, TotalsPanel, emptyLine } from '@/components/LineItems';
import { addDays, fmtDate, money, todayISO, uid } from '@/lib/format';
import { docTotals, isInterState } from '@/lib/invoice';
import type { LineItem, SalesOrder, SalesOrderStatus } from '@/lib/types';

const STAGES: Array<{ status: SalesOrderStatus; icon: typeof FilePen; tone: string; hint: string }> = [
  { status: 'Draft', icon: FilePen, tone: 'gray', hint: 'Being prepared' },
  { status: 'Sent', icon: Send, tone: 'blue', hint: 'Shared with customer' },
  { status: 'Accepted', icon: CheckCircle2, tone: 'green', hint: 'Ready to invoice' },
];

export default function SalesOrders() {
  const { tenant, mutate } = useTenant();
  const toast = useToast();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [view, setView] = useState<'board' | 'list'>('board');
  const [q, setQ] = useState('');
  const [modal, setModal] = useState<{ id?: string } | null>(null);
  const [del, setDel] = useState<SalesOrder | null>(null);

  // form state
  const [customerId, setCustomerId] = useState('');
  const [date, setDate] = useState(todayISO());
  const [expiry, setExpiry] = useState(addDays(todayISO(), 30));
  const [withGst, setWithGst] = useState(true);
  const [lines, setLines] = useState<LineItem[]>([emptyLine('SP1')]);
  const [notes, setNotes] = useState('');
  const [touched, setTouched] = useState(false);
  const customer = tenant.customers.find((c) => c.id === customerId);

  const open = (so?: SalesOrder) => {
    setCustomerId(so?.customerId ?? '');
    setDate(so?.date ?? todayISO());
    setExpiry(so?.expiryDate ?? addDays(todayISO(), 30));
    setWithGst(so?.withGst ?? true);
    setLines(so ? so.lines.map((l) => ({ ...l })) : [emptyLine('SP1')]);
    setNotes(so?.notes ?? '');
    setTouched(false);
    setModal({ id: so?.id });
  };
  useEffect(() => {
    if (params.get('new')) {
      open();
      params.delete('new');
      setParams(params, { replace: true });
    }
  }, []);

  const filled = lines.filter((l) => l.itemId);
  const errs = { customer: !customerId ? 'Select a customer' : '', lines: filled.length === 0 ? 'Add at least one item' : '' };

  const save = (status: SalesOrderStatus) => {
    setTouched(true);
    if (errs.customer || errs.lines) return;
    if (modal?.id) {
      mutate((t) => void Object.assign(t.salesOrders.find((s) => s.id === modal.id)!, { customerId, date, expiryDate: expiry, withGst, lines: filled, notes, status }));
      toast('success', 'Sales order updated');
    } else {
      let number = '';
      mutate((t) => {
        t.counters.salesOrder += 1;
        number = `SO-${String(t.counters.salesOrder).padStart(4, '0')}`;
        t.salesOrders.unshift({ id: uid('so_'), number, customerId, date, expiryDate: expiry, withGst, lines: filled, notes, status });
      });
      toast('success', status === 'Sent' ? 'Quote sent' : 'Draft saved', `SO-${String(tenant.counters.salesOrder + 1).padStart(4, '0')}`);
    }
    setModal(null);
  };

  const move = (so: SalesOrder, status: SalesOrderStatus) => {
    mutate((t) => void (t.salesOrders.find((s) => s.id === so.id)!.status = status));
    toast('success', `Moved to ${status}`, so.number);
  };

  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    return tenant.salesOrders
      .map((so) => ({ so, c: tenant.customers.find((c) => c.id === so.customerId), total: docTotals(tenant, so).total, invoiced: tenant.invoices.some((i) => i.salesOrderId === so.id) }))
      .filter((r) => !s || [r.so.number, r.c?.name ?? '', r.c?.companyName ?? ''].some((v) => v.toLowerCase().includes(s)));
  }, [tenant, q]);

  const card = (r: (typeof rows)[number]) => {
    const idx = STAGES.findIndex((s) => s.status === r.so.status);
    return (
      <div key={r.so.id} className="card" style={{ padding: 14, boxShadow: 'var(--shadow-xs)' }}>
        <div className="row between">
          <span className="strong" style={{ color: 'var(--brand-600)', fontWeight: 700 }}>{r.so.number}</span>
          <span className="small muted">{fmtDate(r.so.date)}</span>
        </div>
        <div style={{ fontWeight: 600, color: 'var(--ink-900)', marginTop: 6 }}>{r.c?.companyName || r.c?.name}</div>
        <div className="small muted">{r.so.lines.length} item{r.so.lines.length > 1 ? 's' : ''} · valid till {fmtDate(r.so.expiryDate)}</div>
        <div className="row between" style={{ marginTop: 10 }}>
          <span style={{ fontWeight: 800, fontSize: 16, color: 'var(--ink-900)' }}>{money(r.total)}</span>
          {r.so.withGst ? <Badge tone="green" plain>GST</Badge> : <Badge tone="amber" plain>Net</Badge>}
        </div>
        <div className="row" style={{ marginTop: 12, gap: 6, borderTop: '1px solid var(--ink-150)', paddingTop: 10 }}>
          <button className="icon-btn sm" title="Edit" onClick={() => open(r.so)}><Pencil size={14} /></button>
          <button className="icon-btn sm danger" title="Delete" onClick={() => setDel(r.so)}><Trash2 size={14} /></button>
          <span style={{ marginLeft: 'auto' }} />
          {idx < STAGES.length - 1 ? (
            <button className="btn btn-secondary btn-sm" onClick={() => move(r.so, STAGES[idx + 1]!.status)}>
              Mark {STAGES[idx + 1]!.status} <ArrowRight size={13} />
            </button>
          ) : r.invoiced ? (
            <Badge tone="green" plain>Invoiced</Badge>
          ) : (
            <button className="btn btn-primary btn-sm" onClick={() => navigate(`/app/sales/invoices/new?fromSO=${r.so.id}`)}>
              <FileText size={13} /> Convert to invoice
            </button>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="page">
      <PageHeader
        title="Sales Orders"
        crumbs={<>Sales <span>/</span> Sales Orders</>}
        subtitle="Draft quotes, share them with customers and convert accepted ones into invoices."
        actions={<button className="btn btn-primary" onClick={() => open()}><Plus size={16} /> New Sales Order</button>}
      />

      <div className="row between" style={{ marginBottom: 16, flexWrap: 'wrap', gap: 12 }}>
        <SearchInput value={q} onChange={setQ} placeholder="Search order # or customer…" />
        <Segmented value={view} onChange={setView} options={[{ value: 'board', label: 'Pipeline', icon: LayoutGrid }, { value: 'list', label: 'List', icon: List }]} />
      </div>

      {tenant.salesOrders.length === 0 ? (
        <div className="card">
          <EmptyState icon={ClipboardList} title="No sales orders yet" text="Create a quote to send to your customer." action={<button className="btn btn-primary" onClick={() => open()}><Plus size={15} /> New Sales Order</button>} />
        </div>
      ) : view === 'board' ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16 }}>
          {STAGES.map((st) => {
            const list = rows.filter((r) => r.so.status === st.status);
            return (
              <div key={st.status} style={{ background: 'var(--ink-100)', borderRadius: 'var(--radius)', padding: 12, minHeight: 200 }}>
                <div className="row between" style={{ padding: '2px 4px 12px' }}>
                  <div className="row" style={{ gap: 8 }}>
                    <span className={`stat-icon tone-${st.tone === 'gray' ? 'blue' : st.tone}`} style={{ width: 28, height: 28, borderRadius: 8 }}><st.icon size={14} /></span>
                    <div>
                      <div style={{ fontWeight: 700, color: 'var(--ink-900)' }}>{st.status} <span className="chip" style={{ marginLeft: 4 }}>{list.length}</span></div>
                      <div className="small muted">{st.hint}</div>
                    </div>
                  </div>
                  <span className="small strong">{money(list.reduce((s, r) => s + r.total, 0))}</span>
                </div>
                <div className="stack" style={{ gap: 10 }}>
                  {list.map(card)}
                  {list.length === 0 && <div className="small muted" style={{ textAlign: 'center', padding: 24, border: '1.5px dashed var(--ink-300)', borderRadius: 10 }}>Nothing here</div>}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="card">
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Date</th><th>Order #</th><th>Customer</th><th>Status</th><th>Valid till</th><th className="num">Amount</th><th />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.so.id}>
                    <td>{fmtDate(r.so.date)}</td>
                    <td className="strong" style={{ color: 'var(--brand-600)' }}>{r.so.number}</td>
                    <td>{r.c?.companyName || r.c?.name}</td>
                    <td>
                      <select className="select" style={{ height: 32, width: 130 }} value={r.so.status} onChange={(e) => move(r.so, e.target.value as SalesOrderStatus)}>
                        {STAGES.map((s) => <option key={s.status}>{s.status}</option>)}
                      </select>
                    </td>
                    <td className="muted">{fmtDate(r.so.expiryDate)}</td>
                    <td className="num strong">{money(r.total)}</td>
                    <td className="num" style={{ whiteSpace: 'nowrap' }}>
                      <button className="icon-btn" title="Edit" onClick={() => open(r.so)}><Pencil size={15} /></button>
                      {r.so.status === 'Accepted' && !r.invoiced && <button className="icon-btn" title="Convert to invoice" onClick={() => navigate(`/app/sales/invoices/new?fromSO=${r.so.id}`)}><FileText size={15} /></button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <Modal
        open={!!modal}
        onClose={() => setModal(null)}
        size="xl"
        title={modal?.id ? 'Edit sales order' : 'New sales order'}
        subtitle="A quote for your customer — no stock is reserved until it’s invoiced."
        footer={
          <>
            <button className="btn btn-secondary" onClick={() => setModal(null)}>Cancel</button>
            <button className="btn btn-secondary" onClick={() => save('Draft')}>Save as Draft</button>
            <button className="btn btn-primary" onClick={() => save('Sent')}><Send size={15} /> Save &amp; mark Sent</button>
          </>
        }
      >
        <div className="form-grid cols-3">
          <Field label="Customer" required error={touched ? errs.customer : ''}>
            <select className={`select ${touched && errs.customer ? 'invalid' : ''}`} value={customerId} onChange={(e) => { setCustomerId(e.target.value); const c = tenant.customers.find((x) => x.id === e.target.value); if (c?.type === 'Business') setWithGst(true); }}>
              <option value="">Select customer…</option>
              {tenant.customers.map((c) => <option key={c.id} value={c.id}>{c.companyName || c.name} · {c.customId}</option>)}
            </select>
          </Field>
          <Field label="Order date"><input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
          <Field label="Valid till"><input className="input" type="date" value={expiry} onChange={(e) => setExpiry(e.target.value)} /></Field>
        </div>
        <div style={{ margin: '18px 0 14px' }}>
          <TaxModeToggle withGst={withGst} onChange={setWithGst} />
        </div>
        <LineItemsEditor lines={lines} onChange={setLines} defaultTier={customer?.tier ?? 'SP1'} withGst={withGst} />
        {touched && errs.lines && <div className="field-error" style={{ marginTop: 8 }}>{errs.lines}</div>}
        <div className="grid-2 mt-16" style={{ alignItems: 'start' }}>
          <Field label="Notes"><textarea className="textarea" value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
          <TotalsPanel lines={filled} withGst={withGst} interState={customerId ? isInterState(tenant, customerId) : false} />
        </div>
      </Modal>

      <ConfirmModal
        open={!!del}
        onClose={() => setDel(null)}
        title="Delete sales order?"
        text={`${del?.number} will be permanently removed.`}
        onConfirm={() => {
          mutate((t) => void (t.salesOrders = t.salesOrders.filter((s) => s.id !== del!.id)));
          toast('success', 'Sales order deleted');
        }}
      />
    </div>
  );
}
