import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Plus, Truck, Loader2, PackageCheck, Ban, FileText, Send, MapPin } from 'lucide-react';
import { api, fieldErrors } from '@/api/client';
import { useChallans, useCustomers, useItems, useMut, useSalesOrders } from '@/api/hooks';
import type { DeliveryChallan } from '@/api/types';
import { useShopUser } from '@/context/AuthContext';
import { ConfirmModal, EmptyState, Field, Modal, PageHeader, SearchInput, StatCard } from '@/components/ui';
import { StatusBadge } from '@/components/StatusBadge';
import { StockLines, emptyStockLine, type StockLine } from '@/components/StockLines';
import { ExportMenu } from '@/components/ExportMenu';
import { PdfButton } from '@/components/PdfButton';
import { AttachButton } from '@/components/AttachButton';
import { Hint } from '@/components/kit';
import { challanTable } from '@/lib/docPdf';
import { fmtDate, money, todayISO, uid } from '@/lib/format';

const KEYS = [['challans'], ['salesOrders'], ['invoices']];
const PURPOSES: DeliveryChallan['purpose'][] = ['Supply', 'Job work', 'On approval', 'Sales return', 'Other'];
const STEPS: DeliveryChallan['status'][] = ['Packed', 'Dispatched', 'Delivered', 'Invoiced'];
type Form = { customerId: string; date: string; purpose: DeliveryChallan['purpose']; salesOrderId: string | null; transporter: string; vehicleNo: string; lrNo: string; notes: string; lines: StockLine[] };

/** Delivery challans: send goods, track them to the customer's door, then bill them in one click. */
export default function DeliveryChallans() {
  const me = useShopUser();
  const canWrite = me.can('sales.write');
  const navigate = useNavigate();
  const { data = [], isLoading, isError, refetch } = useChallans();
  const customers = useCustomers().data ?? [];
  const items = useItems().data ?? [];
  const orders = useSalesOrders('order').data ?? [];
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState('');
  const [tab, setTab] = useState<'all' | DeliveryChallan['status']>('all');
  const [form, setForm] = useState<Form | null>(null);
  const [err, setErr] = useState<Record<string, string>>({});
  const [deliver, setDeliver] = useState<{ c: DeliveryChallan; receivedBy: string } | null>(null);
  const [cancel, setCancel] = useState<DeliveryChallan | null>(null);

  const create = useMut((b: Record<string, unknown>) => api.post<DeliveryChallan>('/shop/delivery-challans', b), KEYS, { success: (d) => `${d.number} packed`, silentError: true });
  const status = useMut((v: { id: string; status: string; receivedBy?: string }) => api.patch<DeliveryChallan>(`/shop/delivery-challans/${v.id}/status`, v), KEYS, { success: (d) => `${d.number} ${d.status.toLowerCase()}` });
  const bill = useMut((id: string) => api.post<{ invoiceId: string }>(`/shop/delivery-challans/${id}/invoice`, {}), KEYS, { success: 'Draft invoice created' });

  const start = (soId?: string | null) => {
    setErr({});
    const so = soId ? orders.find((o) => o.id === soId) : undefined;
    setForm({
      customerId: so?.customerId ?? '', date: todayISO(), purpose: 'Supply', salesOrderId: so?.id ?? null, transporter: '', vehicleNo: '', lrNo: '', notes: so ? `Against sales order ${so.number}` : '',
      lines: so ? so.lines.map((l) => ({ key: uid('sl_'), itemId: l.itemId, qty: String(l.qty), serials: '' })) : [emptyStockLine()],
    });
  };
  useEffect(() => {
    if (!canWrite) return;
    const so = params.get('fromSO');
    if (params.get('new') || (so && orders.length)) { start(so); setParams({}, { replace: true }); }
  }, [params, orders.length]);

  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    return data.filter((d) => tab === 'all' || d.status === tab)
      .filter((d) => !s || [d.number, d.customer.companyName, d.customer.name, d.vehicleNo, d.salesOrderNumber ?? '', ...d.lines.map((l) => l.name)].some((v) => v.toLowerCase().includes(s)));
  }, [data, q, tab]);
  const onRoad = data.filter((d) => d.status === 'Dispatched');
  const toBill = data.filter((d) => d.status === 'Delivered');

  const submit = () => {
    if (!form) return;
    const e: Record<string, string> = {};
    if (!form.customerId) e.customerId = 'Select a customer';
    const lines = form.lines.filter((l) => l.itemId && Number(l.qty) > 0).map((l) => {
      const so = form.salesOrderId ? orders.find((o) => o.id === form.salesOrderId)?.lines.find((x) => x.itemId === l.itemId) : undefined;
      return { itemId: l.itemId, qty: Number(l.qty), ...(so ? { rate: so.rate } : {}) };
    });
    if (!lines.length) e.lines = 'Add at least one item with a quantity';
    setErr(e);
    if (Object.keys(e).length) return;
    create.mutate({ ...form, lines }, { onSuccess: () => setForm(null), onError: (x) => setErr({ ...fieldErrors(x), lines: x.message }) });
  };

  return (
    <div className="page">
      <PageHeader title="Delivery Challans" crumbs={<>Sales <span>/</span> Delivery Challans</>}
        subtitle="Send goods with a challan, track each one from packing to delivery, then turn it into an invoice in one click."
        actions={<><ExportMenu disabled={!rows.length} table={() => ({
          title: 'Delivery challans', subtitle: `${rows.length} challans`, filename: 'delivery-challans',
          columns: [{ label: 'Date' }, { label: 'Number' }, { label: 'Customer' }, { label: 'Vehicle' }, { label: 'Items' }, { label: 'Value', money: true }, { label: 'Status' }],
          rows: rows.map((d) => ({ cells: [fmtDate(d.date), d.number, d.customer.companyName || d.customer.name, d.vehicleNo, d.lines.map((l) => `${l.name} × ${l.qty}`).join(', '), d.value, d.status] })),
        })} />{canWrite && <button className="btn btn-primary" onClick={() => start()}><Plus size={16} /> New challan</button>}</>} />
      <Hint id="challans" title="How challans work" icon={Truck}>
        <p>Pack the goods and create a challan (stock moves when you invoice). Mark it <strong>Dispatched</strong> when it leaves, <strong>Delivered</strong> with the receiver’s name, then <strong>Create invoice</strong>. From a sales order, use its <strong>Delivery challan</strong> button to copy the items.</p>
      </Hint>
      <div className="stat-grid">
        <StatCard label="Packed" value={data.filter((d) => d.status === 'Packed').length} icon={PackageCheck} tone="blue" foot="Waiting to leave" />
        <StatCard label="On the road" value={onRoad.length} icon={Truck} tone="amber" foot={onRoad.length ? money(onRoad.reduce((s, d) => s + d.value, 0)) : 'Nothing in transit'} />
        <StatCard label="Delivered, not billed" value={toBill.length} icon={FileText} tone="red" foot={toBill.length ? `${money(toBill.reduce((s, d) => s + d.value, 0))} to invoice` : 'All billed'} />
      </div>
      <div className="card mt-16">
        <div className="toolbar">
          <div className="toolbar-left">
            <SearchInput value={q} onChange={setQ} placeholder="Search challan, customer, vehicle, item…" />
            <div className="filter-chips" style={{ padding: 0 }}>
              {(['all', ...STEPS, 'Cancelled'] as const).map((f) => <button key={f} className={`filter-chip ${tab === f ? 'active' : ''}`} onClick={() => setTab(f)}>{f === 'all' ? 'All' : f} <span className="n">{f === 'all' ? data.length : data.filter((d) => d.status === f).length}</span></button>)}
            </div>
          </div>
        </div>
        <div className="table-wrap">
          {isLoading ? <div style={{ padding: 16 }}><div className="skeleton" style={{ height: 200 }} /></div> : isError ? (
            <div style={{ padding: 16 }}><div className="error-state">Couldn’t load challans. <button className="btn btn-ghost btn-sm" onClick={() => refetch()}>Try again</button></div></div>
          ) : rows.length === 0 ? (
            <EmptyState icon={Truck} title={data.length ? 'No challans match' : 'No delivery challans yet'} text="Create one when goods leave your shop or godown." action={canWrite && <button className="btn btn-primary" onClick={() => start()}><Plus size={15} /> New challan</button>} />
          ) : (
            <table className="table">
              <thead><tr><th>Date</th><th>Challan</th><th>Customer</th><th>Progress</th><th className="num">Value</th><th /></tr></thead>
              <tbody>{rows.map((d) => (
                <tr key={d.id}>
                  <td>{fmtDate(d.date)}</td>
                  <td className="strong">{d.number}<div className="muted">{d.purpose}{d.salesOrderNumber ? ` · ${d.salesOrderNumber}` : ''}</div></td>
                  <td>{d.customer.companyName || d.customer.name}<div className="muted">{d.lines.map((l) => `${l.name} × ${l.qty}`).slice(0, 2).join(', ')}{d.lines.length > 2 ? ` +${d.lines.length - 2}` : ''}</div></td>
                  <td>
                    {d.status === 'Cancelled' ? <StatusBadge status="Cancelled" /> : (
                      <div className="track" aria-label={`Status: ${d.status}`}>
                        {STEPS.map((st, i) => <span key={st} className={`track-step ${STEPS.indexOf(d.status) >= i ? 'done' : ''}`} title={st}><i />{st}</span>)}
                      </div>
                    )}
                    <div className="muted small">{[d.vehicleNo && <><MapPin size={11} /> {d.vehicleNo}</>, d.receivedBy && `Received by ${d.receivedBy}`, d.invoiceNumber && `Invoice ${d.invoiceNumber}`].filter(Boolean).map((x, i) => <span key={i} style={{ marginRight: 8 }}>{x}</span>)}</div>
                  </td>
                  <td className="num strong">{money(d.value)}</td>
                  <td className="num" style={{ whiteSpace: 'nowrap' }}>
                    <PdfButton iconOnly table={() => challanTable(d)} />
                    <AttachButton entity="delivery_challan" entityId={d.id} title={d.number} canWrite={canWrite} />
                    {canWrite && d.status === 'Packed' && <button className="btn btn-secondary btn-sm" disabled={status.isPending} onClick={() => status.mutate({ id: d.id, status: 'Dispatched' })}><Send size={14} /> Dispatch</button>}
                    {canWrite && d.status === 'Dispatched' && <button className="btn btn-secondary btn-sm" onClick={() => setDeliver({ c: d, receivedBy: '' })}><PackageCheck size={14} /> Delivered</button>}
                    {canWrite && (d.status === 'Delivered' || d.status === 'Dispatched' || d.status === 'Packed') && <button className="btn btn-primary btn-sm" disabled={bill.isPending} onClick={() => bill.mutate(d.id, { onSuccess: (r) => navigate(`/app/sales/invoices/${r.invoiceId}/edit`) })}><FileText size={14} /> Create invoice</button>}
                    {d.invoiceId && <button className="btn btn-ghost btn-sm" onClick={() => navigate(`/app/sales/invoices/${d.invoiceId}`)}>Open invoice</button>}
                    {canWrite && ['Packed', 'Dispatched', 'Delivered'].includes(d.status) && <button className="icon-btn danger" title="Cancel challan" onClick={() => setCancel(d)}><Ban size={15} /></button>}
                  </td>
                </tr>
              ))}</tbody>
            </table>
          )}
        </div>
      </div>

      <Modal open={!!form} onClose={() => setForm(null)} size="xl" title="New delivery challan" subtitle="Stock leaves your books when the challan is invoiced."
        footer={<><button className="btn btn-secondary" onClick={() => setForm(null)}>Cancel</button><button className="btn btn-primary" disabled={create.isPending} onClick={submit}>{create.isPending && <Loader2 size={15} className="spin" />} Save challan</button></>}>
        {form && (
          <div className="stack" style={{ gap: 16 }}>
            <div className="form-grid cols-3">
              <Field label="Customer" required error={err.customerId}>
                <select className={`select ${err.customerId ? 'invalid' : ''}`} value={form.customerId} onChange={(e) => setForm({ ...form, customerId: e.target.value })} aria-label="Customer">
                  <option value="">Select customer…</option>{customers.map((c) => <option key={c.id} value={c.id}>{c.companyName || c.name} · {c.customId}</option>)}
                </select>
              </Field>
              <Field label="Date"><input className="input" type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></Field>
              <Field label="Purpose"><select className="select" value={form.purpose} onChange={(e) => setForm({ ...form, purpose: e.target.value as Form['purpose'] })}>{PURPOSES.map((p) => <option key={p}>{p}</option>)}</select></Field>
            </div>
            <StockLines lines={form.lines} onChange={(lines) => setForm({ ...form, lines })} items={items} branchId={me.user.branchId ?? ''} mode="move" error={err.lines} />
            <div className="form-grid cols-3">
              <Field label="Transporter"><input className="input" value={form.transporter} maxLength={120} onChange={(e) => setForm({ ...form, transporter: e.target.value })} placeholder="e.g. VRL Logistics" /></Field>
              <Field label="Vehicle number"><input className="input mono" value={form.vehicleNo} maxLength={20} onChange={(e) => setForm({ ...form, vehicleNo: e.target.value.toUpperCase() })} placeholder="TN 09 AB 1234" /></Field>
              <Field label="LR / docket no."><input className="input" value={form.lrNo} maxLength={40} onChange={(e) => setForm({ ...form, lrNo: e.target.value })} /></Field>
            </div>
            <Field label="Notes"><textarea className="textarea" rows={2} maxLength={1000} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field>
          </div>
        )}
      </Modal>
      <Modal open={!!deliver} onClose={() => setDeliver(null)} title={`Mark ${deliver?.c.number} delivered`} subtitle="Who signed for the goods?"
        footer={<><button className="btn btn-secondary" onClick={() => setDeliver(null)}>Cancel</button><button className="btn btn-primary" disabled={!deliver?.receivedBy.trim() || status.isPending} onClick={() => status.mutate({ id: deliver!.c.id, status: 'Delivered', receivedBy: deliver!.receivedBy.trim() }, { onSuccess: () => setDeliver(null) })}><PackageCheck size={15} /> Mark delivered</button></>}>
        {deliver && <Field label="Received by" required><input className="input" autoFocus value={deliver.receivedBy} maxLength={120} onChange={(e) => setDeliver({ ...deliver, receivedBy: e.target.value })} placeholder="Name of the person who received it" /></Field>}
      </Modal>
      <ConfirmModal open={!!cancel} onClose={() => setCancel(null)} title="Cancel challan?" confirmLabel="Cancel challan" text={`${cancel?.number} will be marked cancelled. No stock changes.`} onConfirm={() => status.mutate({ id: cancel!.id, status: 'Cancelled' })} />
    </div>
  );
}
