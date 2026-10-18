import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Plus, ClipboardList, LayoutGrid, List, ArrowRight, FileText, Pencil, Trash2, Send, CheckCircle2, FilePen, FileSignature, XCircle } from 'lucide-react';
import { api } from '@/api/client';
import { useCustomers, useMut, useOrg, useSalesOrders } from '@/api/hooks';
import type { SalesOrder } from '@/api/types';
import { useShopUser } from '@/context/AuthContext';
import { Badge, ConfirmModal, EmptyState, Field, Modal, PageHeader, SearchInput, Segmented } from '@/components/ui';
import { LineItemsEditor, TaxModeToggle, TotalsPanel, emptyLine, toDraft, toInput, useCalcLines, type DraftLine } from '@/components/LineItems';
import { addDays, fmtDate, money, todayISO } from '@/lib/format';
import { isInterState } from '../../../shared/gst';
import { Hint } from '@/components/kit';

type SalesOrderStatus = SalesOrder['status'];

const STAGES: Array<{ status: SalesOrderStatus; icon: typeof FilePen; tone: string; hint: string }> = [
  { status: 'Draft', icon: FilePen, tone: 'gray', hint: 'Being prepared' },
  { status: 'Sent', icon: Send, tone: 'blue', hint: 'Shared with customer' },
  { status: 'Accepted', icon: CheckCircle2, tone: 'green', hint: 'Ready to invoice' },
];

const COPY = {
  quote: {
    title: 'Quotes', one: 'quote', number: 'Quote #', newLabel: 'New Quote', date: 'Quote date', search: 'Search quote # or customer…',
    subtitle: 'Price a job for a customer. Accepted quotes become sales orders or invoices in one click.',
    empty: 'No quotes yet', emptyText: 'Send your customer a price before you bill them.', modalSub: 'An estimate for your customer. Nothing is reserved or billed.',
  },
  order: {
    title: 'Sales Orders', one: 'sales order', number: 'Order #', newLabel: 'New Sales Order', date: 'Order date', search: 'Search order # or customer…',
    subtitle: 'Confirmed orders waiting to be delivered and invoiced.',
    empty: 'No sales orders yet', emptyText: 'Record a confirmed order, or convert an accepted quote.', modalSub: 'A confirmed order. Stock moves when it is invoiced.',
  },
};

export default function SalesOrders({ kind = 'order' }: { kind?: 'quote' | 'order' }) {
  const me = useShopUser();
  const canWrite = me.can('sales.write');
  const L = COPY[kind];
  const { data: orders = [], isLoading } = useSalesOrders(kind);
  const { data: customerList = [] } = useCustomers();
  const org = useOrg().data;
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
  const [lines, setLines] = useState<DraftLine[]>([emptyLine('SP1')]);
  const [notes, setNotes] = useState('');
  const [touched, setTouched] = useState(false);
  const customer = customerList.find((c) => c.id === customerId);
  const calc = useCalcLines(lines);
  const keys = [['salesOrders']];
  const createSO = useMut((b: Record<string, unknown>) => api.post<SalesOrder>('/shop/sales-orders', { ...b, kind }), keys, { success: (r) => (r.status === 'Sent' ? `${r.number} saved as sent` : `${r.number} saved as draft`) });
  const updateSO = useMut((v: { id: string; b: Record<string, unknown> }) => api.put<SalesOrder>(`/shop/sales-orders/${v.id}`, { ...v.b, kind }), keys, { success: (r) => `${r.number} updated` });
  const convertQuote = useMut((id: string) => api.post<SalesOrder>(`/shop/sales-orders/${id}/convert`, {}), keys, { success: (r) => `Sales order ${r.number} created` });
  const moveSO = useMut((v: { id: string; status: SalesOrderStatus }) => api.patch<SalesOrder>(`/shop/sales-orders/${v.id}/status`, { status: v.status }), keys, { success: (r) => `${r.number} moved to ${r.status}` });
  const removeSO = useMut((id: string) => api.del(`/shop/sales-orders/${id}`), keys, { success: `${kind === 'quote' ? 'Quote' : 'Sales order'} deleted` });

  const open = (so?: SalesOrder) => {
    setCustomerId(so?.customerId ?? '');
    setDate(so?.date ?? todayISO());
    setExpiry(so?.expiryDate ?? addDays(todayISO(), 30));
    setWithGst(so?.withGst ?? true);
    setLines(so ? so.lines.map(toDraft) : [emptyLine('SP1')]);
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
    const b = { customerId, date, expiryDate: expiry, withGst, lines: toInput(lines), notes, status };
    if (modal?.id) updateSO.mutate({ id: modal.id, b }, { onSuccess: () => setModal(null) });
    else createSO.mutate(b, { onSuccess: () => setModal(null) });
  };

  const move = (so: SalesOrder, status: SalesOrderStatus) => moveSO.mutate({ id: so.id, status });

  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    return orders
      .map((so) => ({ so, c: customerList.find((c) => c.id === so.customerId), total: so.total, invoiced: !!so.invoiceId || !!so.orderId }))
      .filter((r) => !s || [r.so.number, r.c?.name ?? '', r.c?.companyName ?? ''].some((v) => v.toLowerCase().includes(s)));
  }, [orders, customerList, q]);

  const card = (r: (typeof rows)[number]) => {
    const idx = STAGES.findIndex((s) => s.status === r.so.status);
    return (
      <div key={r.so.id} className="card" style={{ padding: 14, boxShadow: 'var(--shadow-xs)' }}>
        <div className="row between">
          <span className="strong" style={{ color: 'var(--brand-600)', fontWeight: 600 }}>{r.so.number}</span>
          <span className="small muted">{fmtDate(r.so.date)}</span>
        </div>
        <div style={{ fontWeight: 600, color: 'var(--ink-900)', marginTop: 6 }}>{r.c?.companyName || r.c?.name}</div>
        <div className="small muted">{r.so.lines.length} item{r.so.lines.length > 1 ? 's' : ''} · {kind === 'quote' ? 'valid till' : 'deliver by'} {fmtDate(r.so.expiryDate)}{r.so.sourceNumber ? ` · from ${r.so.sourceNumber}` : ''}</div>
        <div className="row between" style={{ marginTop: 10 }}>
          <span style={{ fontWeight: 600, fontSize: 16, color: 'var(--ink-900)' }}>{money(r.total)}</span>
          {r.so.withGst ? <Badge tone="green" plain>GST</Badge> : <Badge tone="amber" plain>Net</Badge>}
        </div>
        <div className="row" style={{ marginTop: 12, gap: 6, borderTop: '1px solid var(--ink-150)', paddingTop: 10 }}>
          {canWrite && !r.invoiced && <button className="icon-btn sm" title="Edit" onClick={() => open(r.so)}><Pencil size={14} /></button>}
          {canWrite && !r.invoiced && <button className="icon-btn sm danger" title="Delete" onClick={() => setDel(r.so)}><Trash2 size={14} /></button>}
          <span style={{ marginLeft: 'auto' }} />
          {!canWrite ? null : idx < STAGES.length - 1 ? (
            <button className="btn btn-secondary btn-sm" onClick={() => move(r.so, STAGES[idx + 1]!.status)}>
              Mark {STAGES[idx + 1]!.status} <ArrowRight size={13} />
            </button>
          ) : r.so.invoiceId ? (
            <Link to={`/app/sales/invoices/${r.so.invoiceId}`}><Badge tone="green" plain>Invoiced →</Badge></Link>
          ) : r.so.orderId ? (
            <Link to="/app/sales/orders"><Badge tone="green" plain>Ordered →</Badge></Link>
          ) : (
            <div className="row" style={{ gap: 6 }}>
              {kind === 'quote' && <button className="btn btn-secondary btn-sm" disabled={convertQuote.isPending} onClick={() => convertQuote.mutate(r.so.id)}><FileSignature size={13} /> To order</button>}
              <button className="btn btn-primary btn-sm" onClick={() => navigate(`/app/sales/invoices/new?fromSO=${r.so.id}`)}>
                <FileText size={13} /> {kind === 'quote' ? 'To invoice' : 'Convert to invoice'}
              </button>
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="page">
      <PageHeader
        title={L.title}
        crumbs={<>Sales <span>/</span> {L.title}</>}
        subtitle={L.subtitle}
        actions={canWrite && <button className="btn btn-primary" onClick={() => open()}><Plus size={16} /> {L.newLabel}</button>}
      />
      {kind === 'quote' && (
        <Hint id="quotes" title="Quote, order, invoice">
          <p>When the customer accepts, turn the quote into a <strong>sales order</strong> to track delivery, or straight into an <strong>invoice</strong>. Lines, prices and notes carry over; nothing is typed twice. Neither quotes nor orders move stock.</p>
        </Hint>
      )}

      <div className="row between" style={{ marginBottom: 16, flexWrap: 'wrap', gap: 12 }}>
        <SearchInput value={q} onChange={setQ} placeholder={L.search} />
        <Segmented value={view} onChange={setView} options={[{ value: 'board', label: 'Pipeline', icon: LayoutGrid }, { value: 'list', label: 'List', icon: List }]} />
      </div>

      {isLoading ? <div className="skeleton" style={{ height: 240 }} /> : orders.length === 0 ? (
        <div className="card">
          <EmptyState icon={ClipboardList} title={L.empty} text={L.emptyText} action={canWrite && <button className="btn btn-primary" onClick={() => open()}><Plus size={15} /> {L.newLabel}</button>} />
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
                      <div style={{ fontWeight: 600, color: 'var(--ink-900)' }}>{st.status} <span className="chip" style={{ marginLeft: 4 }}>{list.length}</span></div>
                      <div className="small muted">{st.hint}</div>
                    </div>
                  </div>
                  <span className="small strong">{money(list.reduce((s, r) => s + r.total, 0))}</span>
                </div>
                <div className="stack" style={{ gap: 10 }}>
                  {list.map(card)}
                  {list.length === 0 && <div className="small muted" style={{ textAlign: 'center', padding: 24, border: '1.5px dashed var(--ink-300)', borderRadius: 8 }}>Nothing here</div>}
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
                  <th>Date</th><th>{L.number}</th><th>Customer</th><th>Status</th><th>{kind === 'quote' ? 'Valid till' : 'Deliver by'}</th><th className="num">Amount</th><th />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.so.id}>
                    <td>{fmtDate(r.so.date)}</td>
                    <td className="strong" style={{ color: 'var(--brand-600)' }}>{r.so.number}</td>
                    <td>{r.c?.companyName || r.c?.name}</td>
                    <td>
                      <select className="select" style={{ height: 32, width: 130 }} value={r.so.status} disabled={!canWrite || r.invoiced} onChange={(e) => move(r.so, e.target.value as SalesOrderStatus)}>
                        {STAGES.map((s) => <option key={s.status}>{s.status}</option>)}
                        {kind === 'quote' && <option>Declined</option>}
                      </select>
                    </td>
                    <td className="muted">{fmtDate(r.so.expiryDate)}</td>
                    <td className="num strong">{money(r.total)}</td>
                    <td className="num" style={{ whiteSpace: 'nowrap' }}>
                      {canWrite && !r.invoiced && <button className="icon-btn" title="Edit" onClick={() => open(r.so)}><Pencil size={15} /></button>}
                      {canWrite && kind === 'quote' && r.so.status === 'Accepted' && !r.invoiced && <button className="icon-btn" title="Convert to sales order" onClick={() => convertQuote.mutate(r.so.id)}><FileSignature size={15} /></button>}
                      {canWrite && r.so.status === 'Accepted' && !r.invoiced && <button className="icon-btn" title="Convert to invoice" onClick={() => navigate(`/app/sales/invoices/new?fromSO=${r.so.id}`)}><FileText size={15} /></button>}
                      {canWrite && kind === 'quote' && r.so.status === 'Sent' && <button className="icon-btn" title="Mark declined" onClick={() => move(r.so, 'Declined')}><XCircle size={15} /></button>}
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
        title={modal?.id ? `Edit ${L.one}` : `New ${L.one}`}
        subtitle={L.modalSub}
        footer={
          <>
            <button className="btn btn-secondary" onClick={() => setModal(null)}>Cancel</button>
            <button className="btn btn-secondary" disabled={createSO.isPending || updateSO.isPending} onClick={() => save('Draft')}>Save as Draft</button>
            <button className="btn btn-primary" disabled={createSO.isPending || updateSO.isPending} onClick={() => save('Sent')}><Send size={15} /> Save &amp; mark Sent</button>
          </>
        }
      >
        <div className="form-grid cols-3">
          <Field label="Customer" required error={touched ? errs.customer : ''}>
            <select className={`select ${touched && errs.customer ? 'invalid' : ''}`} value={customerId} onChange={(e) => { setCustomerId(e.target.value); const c = customerList.find((x) => x.id === e.target.value); if (c?.type === 'Business' && org?.gstin && !org.compositionScheme) setWithGst(true); }}>
              <option value="">Select customer…</option>
              {customerList.map((c) => <option key={c.id} value={c.id}>{c.companyName || c.name} · {c.customId}</option>)}
            </select>
          </Field>
          <Field label={L.date}><input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
          <Field label={kind === 'quote' ? 'Valid till' : 'Deliver by'}><input className="input" type="date" value={expiry} onChange={(e) => setExpiry(e.target.value)} /></Field>
        </div>
        <div style={{ margin: '18px 0 14px' }}>
          <TaxModeToggle withGst={withGst} onChange={setWithGst} disabled={org?.compositionScheme ? 'Composition scheme' : org && !org.gstin ? 'Add GSTIN in Organization profile' : undefined} />
        </div>
        <LineItemsEditor lines={lines} onChange={setLines} defaultTier={customer?.tier ?? 'SP1'} withGst={withGst} />
        {touched && errs.lines && <div className="field-error" style={{ marginTop: 8 }}>{errs.lines}</div>}
        <div className="grid-2 mt-16" style={{ alignItems: 'start' }}>
          <Field label="Notes"><textarea className="textarea" value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
          <TotalsPanel lines={calc} withGst={withGst} interState={!!org && !!customer && isInterState(org.state, customer.state || org.state)} />
        </div>
      </Modal>

      <ConfirmModal
        open={!!del}
        onClose={() => setDel(null)}
        title={`Delete ${L.one}?`}
        text={`${del?.number} will be permanently removed.`}
        onConfirm={() => removeSO.mutate(del!.id)}
      />
    </div>
  );
}
