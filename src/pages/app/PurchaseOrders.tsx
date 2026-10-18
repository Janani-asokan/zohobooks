import { useEffect, useMemo, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { Plus, ClipboardList, PackageCheck, FileText, Ban, X, Loader2, Truck, Send, Pencil, CalendarClock } from 'lucide-react';
import { api, fieldErrors } from '@/api/client';
import { useBranches, useItems, useMut, usePurchaseOrders, useVendors } from '@/api/hooks';
import type { PurchaseOrder } from '@/api/types';
import { useShopUser } from '@/context/AuthContext';
import { Badge, EmptyState, Field, Modal, PageHeader, SearchInput, StatCard } from '@/components/ui';
import { Hint, Thumb } from '@/components/kit';
import { PurchaseLinesEditor, emptyPLine, pLineFor, pTotals, toPurchaseInput, type PLine } from '@/components/PurchaseLines';
import { addDays, fmtDate, money, todayISO, uid } from '@/lib/format';

const STATUS = ['All', 'Draft', 'Issued', 'Partially Received', 'Received', 'Cancelled'] as const;
const KEYS = [['purchaseOrders'], ['items'], ['bills'], ['vendors'], ['stockAlerts'], ['movements'], ['notifications'], ['dashboard']];
const tone = (s: PurchaseOrder['status']) => ({ Draft: 'gray', Issued: 'blue', 'Partially Received': 'amber', Received: 'green', Cancelled: 'gray' })[s];

export default function PurchaseOrders() {
  const me = useShopUser();
  const canWrite = me.can('purchases.write');
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const { data: orders = [], isLoading } = usePurchaseOrders();
  const vendors = useVendors().data ?? [];
  const items = useItems().data ?? [];
  const branches = useBranches().data ?? [];
  const [status, setStatus] = useState<(typeof STATUS)[number]>('All');
  const [q, setQ] = useState('');
  const [form, setForm] = useState<{ id?: string; vendorId: string; branchId: string; date: string; expectedDate: string; notes: string; lines: PLine[] } | null>(null);
  const [touched, setTouched] = useState(false);
  const [serverErr, setServerErr] = useState<Record<string, string>>({});
  const [openId, setOpenId] = useState<string | null>(null);

  const save = useMut((v: { id?: string; body: Record<string, unknown> }) => (v.id ? api.put<PurchaseOrder>(`/shop/purchase-orders/${v.id}`, v.body) : api.post<PurchaseOrder>('/shop/purchase-orders', v.body)), KEYS, {
    success: (po) => (po.status === 'Draft' ? `${po.number} saved as draft` : `${po.number} issued to ${po.vendorName}`), silentError: true,
  });

  const newForm = (itemId?: string) => {
    const it = itemId ? items.find((i) => i.id === itemId) : undefined;
    setForm({ vendorId: '', branchId: branches.find((b) => b.isPrimary)?.id ?? '', date: todayISO(), expectedDate: addDays(todayISO(), 7), notes: '', lines: it ? [pLineFor(it, Math.max(1, it.reorderLevel * 2 - it.stock))] : [emptyPLine()] });
    setTouched(false);
    setServerErr({});
  };
  useEffect(() => {
    if (params.get('new') && items.length && canWrite) {
      newForm(params.get('item') ?? undefined);
      setParams({}, { replace: true });
    }
  }, [params, items.length]);

  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    return orders.filter((o) => status === 'All' || o.status === status).filter((o) => !s || o.number.toLowerCase().includes(s) || o.vendorName.toLowerCase().includes(s) || o.lines.some((l) => l.name.toLowerCase().includes(s)));
  }, [orders, status, q]);

  const open = orders.filter((o) => o.status === 'Issued' || o.status === 'Partially Received');
  const pendingValue = open.reduce((s, o) => s + o.lines.reduce((a, l) => a + (l.qty - l.received) * l.rate * (1 + l.taxRate / 100), 0), 0);
  const late = open.filter((o) => o.expectedDate && o.expectedDate < todayISO());
  const monthStart = todayISO().slice(0, 8) + '01';

  const errs = form ? { vendorId: !form.vendorId ? 'Select a vendor' : '', lines: pTotals(form.lines).count === 0 ? 'Add at least one item' : '' } : { vendorId: '', lines: '' };
  const err = (k: keyof typeof errs) => (touched ? errs[k] : '') || serverErr[k] || '';
  const submit = (issue: boolean) => {
    if (!form) return;
    setTouched(true);
    setServerErr({});
    if (Object.values(errs).some(Boolean)) return;
    save.mutate(
      { id: form.id, body: { vendorId: form.vendorId, branchId: form.branchId || null, date: form.date, expectedDate: form.expectedDate || null, notes: form.notes, lines: toPurchaseInput(form.lines), issue } },
      { onSuccess: (po) => { setForm(null); setOpenId(po.id); }, onError: (e) => setServerErr(fieldErrors(e)) },
    );
  };

  const current = orders.find((o) => o.id === openId);

  return (
    <div className="page">
      <PageHeader title="Purchase Orders" subtitle="Order stock from vendors, receive it into inventory, then convert to a bill."
        actions={canWrite && <button className="btn btn-primary" onClick={() => newForm()}><Plus size={16} /> New Purchase Order</button>} />

      <Hint id="po" title="How purchase orders work">
        <ol>
          <li><strong>Create</strong> an order for a vendor — items are priced at your cost.</li>
          <li><strong>Receive</strong> goods when they arrive (all at once or in parts). Stock goes up automatically and the item’s cost is updated.</li>
          <li><strong>Convert to bill</strong> to record what you owe the vendor and claim GST input credit.</li>
        </ol>
      </Hint>

      <div className="stat-grid">
        <StatCard label="Open orders" value={open.length} icon={ClipboardList} tone="blue" foot="Issued, awaiting goods" />
        <StatCard label="Yet to receive" value={money(pendingValue)} icon={Truck} tone="violet" foot="Value of pending quantities" />
        <StatCard label="Past expected date" value={late.length} icon={CalendarClock} tone={late.length ? 'red' : 'green'} foot={late.length ? 'Follow up with vendors' : 'All on schedule'} />
        <StatCard label="Ordered this month" value={money(orders.filter((o) => o.date >= monthStart && o.status !== 'Cancelled').reduce((s, o) => s + o.total, 0))} icon={PackageCheck} tone="green" foot="Excluding cancelled" />
      </div>

      <div className="card mt-16">
        <div className="toolbar">
          <div className="toolbar-left" style={{ flexWrap: 'wrap' }}>
            <SearchInput value={q} onChange={setQ} placeholder="Search PO #, vendor or item…" />
            <div className="filter-chips" style={{ padding: 0 }}>
              {STATUS.map((s) => <button key={s} className={`filter-chip ${status === s ? 'active' : ''}`} onClick={() => setStatus(s)}>{s} <span className="n">{s === 'All' ? orders.length : orders.filter((o) => o.status === s).length}</span></button>)}
            </div>
          </div>
        </div>
        <div className="table-wrap">
          {isLoading ? <div className="skeleton" style={{ height: 200, margin: 16 }} /> : rows.length === 0 ? (
            <EmptyState icon={ClipboardList} title={orders.length ? 'No orders match' : 'No purchase orders yet'} text="Create a purchase order when you need to restock from a vendor."
              action={canWrite && <button className="btn btn-primary" onClick={() => newForm()}><Plus size={15} /> New Purchase Order</button>} />
          ) : (
            <table className="table">
              <thead><tr><th>Date</th><th>PO #</th><th>Vendor</th><th>Items</th><th>Expected</th><th>Status</th><th>Received</th><th className="num">Total</th></tr></thead>
              <tbody>
                {rows.map((o) => {
                  const ordered = o.lines.reduce((s, l) => s + l.qty, 0);
                  const got = o.lines.reduce((s, l) => s + l.received, 0);
                  const pct = ordered ? Math.round((got / ordered) * 100) : 0;
                  return (
                    <tr key={o.id} className="clickable" onClick={() => setOpenId(o.id)}>
                      <td>{fmtDate(o.date)}</td>
                      <td className="strong" style={{ color: 'var(--brand-700)' }}>{o.number}{o.billId && <div className="muted">Billed</div>}</td>
                      <td>{o.vendorName}</td>
                      <td className="muted">{o.lines.slice(0, 2).map((l) => l.name).join(', ')}{o.lines.length > 2 ? ` +${o.lines.length - 2}` : ''}</td>
                      <td className={o.expectedDate && o.expectedDate < todayISO() && (o.status === 'Issued' || o.status === 'Partially Received') ? 'strong' : 'muted'} style={o.expectedDate && o.expectedDate < todayISO() && (o.status === 'Issued' || o.status === 'Partially Received') ? { color: 'var(--red-600)' } : undefined}>{o.expectedDate ? fmtDate(o.expectedDate) : '—'}</td>
                      <td><Badge tone={tone(o.status)}>{o.status}</Badge></td>
                      <td style={{ minWidth: 120 }}><div className="progress" style={{ height: 6 }}><span style={{ width: `${pct}%`, background: pct === 100 ? 'var(--green-600)' : undefined }} /></div><div className="small muted" style={{ marginTop: 4 }}>{got} / {ordered}</div></td>
                      <td className="num strong">{money(o.total)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <Modal open={!!form} onClose={() => setForm(null)} size="xl" title={form?.id ? 'Edit purchase order' : 'New purchase order'} subtitle="Rates default to each item’s cost price — change them to match the vendor’s quote."
        footer={<>
          <button className="btn btn-secondary" onClick={() => setForm(null)}>Cancel</button>
          <button className="btn btn-secondary" disabled={save.isPending} onClick={() => submit(false)}>Save as draft</button>
          <button className="btn btn-primary" disabled={save.isPending} onClick={() => submit(true)}>{save.isPending ? <Loader2 size={15} className="spin" /> : <Send size={15} />} Save &amp; issue</button>
        </>}>
        {form && (
          <>
            <div className="form-grid cols-3">
              <Field label="Vendor" required error={err('vendorId')}>
                <select className={`select ${err('vendorId') ? 'invalid' : ''}`} value={form.vendorId} onChange={(e) => setForm({ ...form, vendorId: e.target.value })}>
                  <option value="">Select vendor…</option>{vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
                </select>
                {vendors.length === 0 && <span className="field-hint"><button className="link-btn" onClick={() => navigate('/app/purchases/vendors?new=1')}>Add your first vendor</button></span>}
              </Field>
              <Field label="Order date"><input className="input" type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></Field>
              <Field label="Expected delivery"><input className="input" type="date" value={form.expectedDate} onChange={(e) => setForm({ ...form, expectedDate: e.target.value })} /></Field>
              {branches.length > 1 && <Field label="Deliver to"><select className="select" value={form.branchId} onChange={(e) => setForm({ ...form, branchId: e.target.value })}>{branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></Field>}
            </div>
            <div className="section-title mt-24">Items</div>
            <PurchaseLinesEditor lines={form.lines} onChange={(lines) => setForm({ ...form, lines })} items={items} error={err('lines')} />
            <Field label="Notes to vendor" className="mt-16"><textarea className="textarea" rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Delivery instructions, payment terms…" /></Field>
          </>
        )}
      </Modal>

      {current && <PODrawer po={current} canWrite={canWrite} onClose={() => setOpenId(null)} onEdit={() => {
        setForm({ id: current.id, vendorId: current.vendorId, branchId: current.branchId ?? '', date: current.date, expectedDate: current.expectedDate ?? '', notes: current.notes, lines: current.lines.map((l) => ({ key: uid('pl_'), itemId: l.itemId, qty: String(l.qty), rate: String(l.rate), taxRate: l.taxRate })) });
        setTouched(false); setServerErr({}); setOpenId(null);
      }} />}
    </div>
  );
}

function PODrawer({ po, canWrite, onClose, onEdit }: { po: PurchaseOrder; canWrite: boolean; onClose: () => void; onEdit: () => void }) {
  const items = useItems().data ?? [];
  const navigate = useNavigate();
  const [receiving, setReceiving] = useState<Record<string, { qty: string; batchNo: string; expiryDate: string }> | null>(null);
  const [billing, setBilling] = useState<{ vendorBillNo: string; date: string; dueDate: string } | null>(null);
  const receive = useMut((b: Record<string, unknown>) => api.post<PurchaseOrder>(`/shop/purchase-orders/${po.id}/receive`, b), KEYS, { success: (r) => (r.status === 'Received' ? 'All goods received — stock updated' : 'Goods received — stock updated') });
  const toBill = useMut((b: Record<string, unknown>) => api.post<{ billId: string; number: string }>(`/shop/purchase-orders/${po.id}/bill`, b), KEYS, { success: (r) => `${r.number} created` });
  const cancel = useMut(() => api.post(`/shop/purchase-orders/${po.id}/cancel`, {}), KEYS, { success: 'Purchase order cancelled' });
  const issue = useMut(() => api.put(`/shop/purchase-orders/${po.id}`, { vendorId: po.vendorId, branchId: po.branchId, date: po.date, expectedDate: po.expectedDate, notes: po.notes, issue: true, lines: po.lines.map((l) => ({ itemId: l.itemId, qty: l.qty, rate: l.rate, taxRate: l.taxRate })) }), KEYS, { success: 'Purchase order issued' });

  const canReceive = po.status === 'Issued' || po.status === 'Partially Received';
  const anyReceived = po.lines.some((l) => l.received > 0);
  const startReceive = () => setReceiving(Object.fromEntries(po.lines.map((l) => [l.id, { qty: String(Math.max(0, l.qty - l.received)), batchNo: '', expiryDate: '' }])));

  return (
    <>
      <div className="overlay" style={{ padding: 0 }} onMouseDown={onClose} />
      <aside className="drawer" role="dialog" aria-label={po.number} style={{ width: 'min(640px, 100vw)' }}>
        <div className="drawer-head">
          <div>
            <div className="row" style={{ gap: 8 }}><h3 style={{ fontSize: 16 }}>{po.number}</h3><Badge tone={tone(po.status)}>{po.status}</Badge></div>
            <p className="small muted">{po.vendorName} · ordered {fmtDate(po.date)}{po.expectedDate ? ` · expected ${fmtDate(po.expectedDate)}` : ''}</p>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>
        <div className="drawer-body">
          {canWrite && (
            <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
              {po.status === 'Draft' && <button className="btn btn-primary btn-sm" disabled={issue.isPending} onClick={() => issue.mutate(undefined)}><Send size={14} /> Issue order</button>}
              {canReceive && <button className="btn btn-primary btn-sm" onClick={startReceive}><PackageCheck size={14} /> Receive goods</button>}
              {(po.status === 'Received' || po.status === 'Partially Received' || po.status === 'Issued') && !po.billId && <button className="btn btn-secondary btn-sm" onClick={() => setBilling({ vendorBillNo: '', date: todayISO(), dueDate: addDays(todayISO(), 30) })}><FileText size={14} /> Convert to bill</button>}
              {po.billId && <button className="btn btn-soft btn-sm" onClick={() => navigate('/app/purchases/bills')}><FileText size={14} /> View bill</button>}
              {(po.status === 'Draft' || po.status === 'Issued') && !anyReceived && <button className="btn btn-secondary btn-sm" onClick={onEdit}><Pencil size={14} /> Edit</button>}
              {po.status !== 'Cancelled' && po.status !== 'Received' && !anyReceived && <button className="btn btn-ghost btn-sm" style={{ color: 'var(--red-600)' }} disabled={cancel.isPending} onClick={() => cancel.mutate(undefined)}><Ban size={14} /> Cancel</button>}
            </div>
          )}

          {receiving ? (
            <div className="card" style={{ padding: 16, boxShadow: 'none', background: 'var(--ink-50)' }}>
              <strong style={{ color: 'var(--ink-900)' }}>Receive goods</strong>
              <p className="small muted" style={{ margin: '2px 0 12px' }}>Enter what actually arrived. You can receive the rest later.</p>
              {po.lines.map((l) => {
                const left = l.qty - l.received;
                const it = items.find((i) => i.id === l.itemId);
                const r = receiving[l.id]!;
                if (left <= 0) return null;
                return (
                  <div key={l.id} className="receive-row">
                    <div className="row" style={{ gap: 10, flex: 1, minWidth: 0 }}>
                      <Thumb name={l.name} image={it?.image} size={34} />
                      <div style={{ minWidth: 0 }}><div className="strong">{l.name}</div><div className="small muted">{left} of {l.qty} {l.unit} pending</div></div>
                    </div>
                    <input className="input num" style={{ width: 90 }} type="number" min={0} max={left} value={r.qty} aria-label={`Quantity for ${l.name}`} onChange={(e) => setReceiving({ ...receiving, [l.id]: { ...r, qty: e.target.value } })} />
                    {it?.trackBatches && (
                      <>
                        <input className="input" style={{ width: 110 }} placeholder="Batch #" value={r.batchNo} onChange={(e) => setReceiving({ ...receiving, [l.id]: { ...r, batchNo: e.target.value } })} />
                        <input className="input" style={{ width: 150 }} type="date" value={r.expiryDate} aria-label="Expiry" onChange={(e) => setReceiving({ ...receiving, [l.id]: { ...r, expiryDate: e.target.value } })} />
                      </>
                    )}
                  </div>
                );
              })}
              <div className="row" style={{ justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
                <button className="btn btn-ghost btn-sm" onClick={() => setReceiving(null)}>Cancel</button>
                <button className="btn btn-primary btn-sm" disabled={receive.isPending} onClick={() => receive.mutate(
                  { lines: Object.entries(receiving).map(([lineId, r]) => ({ lineId, qty: Number(r.qty || 0), batchNo: r.batchNo || undefined, expiryDate: r.expiryDate || undefined })).filter((x) => x.qty > 0) },
                  { onSuccess: () => setReceiving(null) },
                )}>{receive.isPending && <Loader2 size={14} className="spin" />} Add to stock</button>
              </div>
            </div>
          ) : billing ? (
            <div className="card" style={{ padding: 16, boxShadow: 'none', background: 'var(--ink-50)' }}>
              <strong style={{ color: 'var(--ink-900)' }}>Convert to bill</strong>
              <p className="small muted" style={{ margin: '2px 0 12px' }}>Records {money(po.total)} payable to {po.vendorName}. Stock isn’t added again.</p>
              <div className="form-grid cols-3">
                <Field label="Vendor bill #"><input className="input" value={billing.vendorBillNo} onChange={(e) => setBilling({ ...billing, vendorBillNo: e.target.value })} /></Field>
                <Field label="Bill date"><input className="input" type="date" value={billing.date} onChange={(e) => setBilling({ ...billing, date: e.target.value })} /></Field>
                <Field label="Due date"><input className="input" type="date" value={billing.dueDate} onChange={(e) => setBilling({ ...billing, dueDate: e.target.value })} /></Field>
              </div>
              <div className="row" style={{ justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
                <button className="btn btn-ghost btn-sm" onClick={() => setBilling(null)}>Cancel</button>
                <button className="btn btn-primary btn-sm" disabled={toBill.isPending} onClick={() => toBill.mutate(billing, { onSuccess: () => setBilling(null) })}>Create bill</button>
              </div>
            </div>
          ) : null}

          <div className="section-title mt-24">Items</div>
          <table className="table">
            <thead><tr><th>Item</th><th className="num">Ordered</th><th className="num">Received</th><th className="num">Rate</th><th className="num">Amount</th></tr></thead>
            <tbody>
              {po.lines.map((l) => (
                <tr key={l.id}>
                  <td className="strong">{l.name}<div className="muted">GST {l.taxRate}%</div></td>
                  <td className="num">{l.qty} {l.unit}</td>
                  <td className="num" style={{ color: l.received >= l.qty ? 'var(--green-700)' : l.received > 0 ? 'var(--amber-700)' : undefined, fontWeight: 600 }}>{l.received}</td>
                  <td className="num">{money(l.rate)}</td>
                  <td className="num strong">{money(l.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="totals-mini" style={{ marginLeft: 'auto', marginTop: 12 }}>
            <div><span>Sub total</span><strong>{money(po.subTotal)}</strong></div>
            <div><span>GST</span><strong>{money(po.taxTotal)}</strong></div>
            <div className="grand"><span>Total</span><strong>{money(po.total)}</strong></div>
          </div>
          {po.notes && <><div className="section-title mt-24">Notes</div><p className="small">{po.notes}</p></>}
        </div>
      </aside>
    </>
  );
}
