import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ArrowLeftRight, ArrowRight, Ban, FileText, KeyRound, Loader2, Mail, PackageCheck, Plus, RotateCw, Save, Send, ShieldCheck, Trash2 } from 'lucide-react';
import { api, ApiError, fieldErrors } from '@/api/client';
import { useBranches, useItems, useMut, useStockTransfers } from '@/api/hooks';
import type { StockTransfer, TransferDetail } from '@/api/types';
import { useShopUser } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { ExportMenu } from '@/components/ExportMenu';
import { AttachButton } from '@/components/AttachButton';
import { ItemPicker } from '@/components/ItemPicker';
import { ConfirmModal, EmptyState, Field, Modal, PageHeader, SearchInput, StatCard } from '@/components/ui';
import { splitSerials, stockable } from '@/components/StockLines';
import { fmtDate, money, todayISO, uid } from '@/lib/format';
import { EWAY_BILL_THRESHOLD, OTP } from '../../../shared/transfers';
import { blankRowClass, enterToNextLine, withTrailingBlank } from '@/lib/lines';

const KEYS = [['stockTransfers'], ['transfer'], ['items'], ['stockAlerts'], ['movements'], ['stockSummary'], ['serials'], ['batches'], ['branchPrices'], ['notifications']];
const STATUS_LABEL: Record<StockTransfer['status'], string> = { Draft: 'Draft', 'In transit': 'In transit · awaiting code', Received: 'Received', Cancelled: 'Cancelled' };
const STATUS_TONE: Record<StockTransfer['status'], string> = { Draft: 'badge-gray', 'In transit': 'badge-amber', Received: 'badge-green', Cancelled: 'badge-gray' };
const Status = ({ s }: { s: StockTransfer['status'] }) => <span className={`badge ${STATUS_TONE[s]}`}>{STATUS_LABEL[s]}</span>;

/** Transfers between branches: stock leaves on "Initiate" and is added at the destination only when its manager enters the emailed code. */
export default function Transfers() {
  const me = useShopUser();
  const canWrite = me.can('items.write');
  const { data = [], isLoading, isError, refetch } = useStockTransfers();
  const branches = useBranches().data ?? [];
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState('');
  const [tab, setTab] = useState<'all' | 'receive' | StockTransfer['status']>(params.get('tab') === 'receive' ? 'receive' : 'all');
  const [form, setForm] = useState<{ draft?: StockTransfer } | null>(null);
  const [receiving, setReceiving] = useState<string | null>(params.get('open'));
  const [cancel, setCancel] = useState<StockTransfer | null>(null);
  const cancelMut = useMut((id: string) => api.post<StockTransfer>(`/shop/stock/transfers/${id}/cancel`, {}), KEYS, { success: (t) => (t.status === 'Cancelled' ? `${t.number} cancelled` : 'Done') });

  useEffect(() => { if (params.get('new') && canWrite && branches.length) { setForm({}); setParams({}, { replace: true }); } }, [params, branches.length]);
  const toReceive = data.filter((t) => t.status === 'In transit' && t.canReceive);
  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    return data.filter((t) => tab === 'all' || (tab === 'receive' ? t.status === 'In transit' && t.canReceive : t.status === tab))
      .filter((t) => !s || [t.number, t.fromName, t.toName, ...t.lines.map((l) => `${l.name} ${l.batchNo}`)].some((v) => v.toLowerCase().includes(s)));
  }, [data, q, tab]);

  if (branches.length < 2 && !isLoading)
    return (
      <div className="page">
        <PageHeader title="Transfers" crumbs={<>Inventory <span>/</span> Transfers</>} subtitle="Move stock between branches." />
        <div className="card"><EmptyState icon={ArrowLeftRight} title="You have one branch" text="Add a second branch or warehouse to move stock between them." action={<a className="btn btn-primary" href="/app/inventory/warehouses?new=1">Add a branch</a>} /></div>
      </div>
    );

  const tabs: Array<[typeof tab, string, number]> = [
    ['all', 'All', data.length], ['receive', 'To receive', toReceive.length], ['Draft', 'Drafts', data.filter((t) => t.status === 'Draft').length],
    ['In transit', 'In transit', data.filter((t) => t.status === 'In transit').length], ['Received', 'Received', data.filter((t) => t.status === 'Received').length],
    ['Cancelled', 'Cancelled', data.filter((t) => t.status === 'Cancelled').length],
  ];

  return (
    <div className="page">
      <PageHeader title="Transfers" crumbs={<>Inventory <span>/</span> Transfers</>}
        subtitle="Stock leaves the source batch when you initiate a transfer. It is added at the destination only after its manager enters the code emailed to them."
        actions={<>
          <Link className="btn btn-secondary" to="/app/inventory/pricing">Branch pricing</Link>
          <ExportMenu disabled={!rows.length} table={() => ({
            title: 'Stock transfers', subtitle: `${rows.length} transfers`, filename: 'stock-transfers',
            columns: [{ label: 'Date' }, { label: 'Number' }, { label: 'From' }, { label: 'To' }, { label: 'Items' }, { label: 'Value at cost', money: true }, { label: 'Status' }],
            rows: rows.map((t) => ({ cells: [fmtDate(t.date), t.number, t.fromName, t.toName, t.lines.map((l) => `${l.name}${l.batchNo ? ` [${l.batchNo}]` : ''} × ${l.qty}`).join(', '), t.value, t.status] })),
          })} />
          {canWrite && <button className="btn btn-primary" onClick={() => setForm({})}><Plus size={16} /> New transfer</button>}
        </>} />
      <div className="stat-grid">
        <StatCard label="To receive here" value={toReceive.length} icon={KeyRound} tone="blue" foot="Enter the emailed code to add the stock" />
        <StatCard label="In transit" value={data.filter((t) => t.status === 'In transit').length} icon={ArrowLeftRight} tone="amber"
          foot={money(data.filter((t) => t.status === 'In transit').reduce((s, t) => s + t.value, 0)) + ' at cost on the way'} />
        <StatCard label="Received this month" value={data.filter((t) => t.status === 'Received' && (t.receivedAt ?? '') >= todayISO().slice(0, 8) + '01').length} icon={PackageCheck} tone="green" foot="Verified by code" />
      </div>
      <div className="card mt-16">
        <div className="toolbar">
          <div className="toolbar-left">
            <SearchInput value={q} onChange={setQ} placeholder="Search number, branch, item, batch…" />
            <div className="filter-chips" style={{ padding: 0 }}>
              {tabs.map(([k, l, n]) => <button key={k} className={`filter-chip ${tab === k ? 'active' : ''}`} onClick={() => setTab(k)}>{l} <span className="n">{n}</span></button>)}
            </div>
          </div>
        </div>
        <div className="table-wrap">
          {isLoading ? <div style={{ padding: 16 }}><div className="skeleton" style={{ height: 200 }} /></div> : isError ? (
            <div style={{ padding: 16 }}><div className="error-state">Couldn’t load transfers. <button className="btn btn-ghost btn-sm" onClick={() => refetch()}>Try again</button></div></div>
          ) : rows.length === 0 ? (
            <EmptyState icon={ArrowLeftRight} title={data.length ? 'No transfers here' : 'No transfers yet'} text="Send stock from one branch to another. It stays in transit until the destination confirms with the emailed code."
              action={canWrite && <button className="btn btn-primary" onClick={() => setForm({})}><Plus size={15} /> New transfer</button>} />
          ) : (
            <table className="table">
              <thead><tr><th>Date</th><th>Number</th><th>Route</th><th>Items</th><th className="num">Value at cost</th><th>Status</th><th /></tr></thead>
              <tbody>{rows.map((t) => (
                <tr key={t.id}>
                  <td>{fmtDate(t.date)}</td>
                  <td className="strong">{t.number}{t.createdBy && <div className="muted small">by {t.createdBy}</div>}</td>
                  <td><span className="row" style={{ gap: 6 }}>{t.fromName} <ArrowRight size={13} className="muted" /> {t.toName}</span></td>
                  <td className="muted">{t.lines.map((l) => `${l.name}${l.batchNo ? ` · ${l.batchNo}` : ''} × ${l.qty}`).slice(0, 2).join(', ')}{t.lines.length > 2 ? ` +${t.lines.length - 2}` : ''}</td>
                  <td className="num">{t.status === 'Draft' ? '—' : money(t.value)}</td>
                  <td><Status s={t.status} />{t.receivedAt && <div className="muted small">{fmtDate(t.receivedAt.slice(0, 10))}{t.lossValue > 0 ? ` · loss ${money(t.lossValue)}` : ''}</div>}</td>
                  <td className="num" style={{ whiteSpace: 'nowrap' }}>
                    {t.status !== 'Draft' && <Link className="icon-btn" title="Stock transfer note" to={`/app/inventory/transfers/${t.id}/note`}><FileText size={15} /></Link>}
                    <AttachButton entity="stock_transfer" entityId={t.id} title={t.number} canWrite={canWrite} />
                    {canWrite && t.status === 'Draft' && <button className="btn btn-secondary btn-sm" onClick={() => setForm({ draft: t })}>Continue</button>}
                    {t.status === 'In transit' && <button className={`btn btn-sm ${t.canReceive ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setReceiving(t.id)}>{t.canReceive ? <><KeyRound size={14} /> Receive</> : 'Details'}</button>}
                    {canWrite && (t.status === 'In transit' || t.status === 'Draft') && <button className="icon-btn danger" title={t.status === 'Draft' ? 'Discard draft' : 'Cancel transfer'} onClick={() => setCancel(t)}><Ban size={15} /></button>}
                  </td>
                </tr>
              ))}</tbody>
            </table>
          )}
        </div>
      </div>

      {form && <TransferForm draft={form.draft} onClose={() => setForm(null)} />}
      {receiving && <ReceiveModal id={receiving} onClose={() => { setReceiving(null); if (params.get('open')) setParams({}, { replace: true }); }} />}
      <ConfirmModal open={!!cancel} onClose={() => setCancel(null)} title={cancel?.status === 'Draft' ? 'Discard draft?' : 'Cancel transfer?'} confirmLabel={cancel?.status === 'Draft' ? 'Discard' : 'Cancel transfer'}
        text={cancel?.status === 'Draft' ? `${cancel?.number} has not moved any stock.` : `${cancel?.number}: the stock goes back into its batch at ${cancel?.fromName}, and the receipt code stops working.`}
        onConfirm={() => cancelMut.mutate(cancel!.id)} />
    </div>
  );
}

/* ======================= Transfer creation form ======================= */

interface FLine { key: string; itemId: string; batchNo: string; qty: string; serials: string; destPrice: string }
interface Batch { batchNo: string; qty: number; expiryDate: string | null; unitCost: number | null; season: string; sellingPrice: number }
interface Preview {
  ok: boolean; error?: string; code?: string; recipient: { name: string; email: string } | null;
  lines: Array<{ itemId: string; batchNo: string; unitCost: number; sourcePrice: number; destPrice: number; base: number; applied: Array<{ name: string; change: string; kind: string }>; belowCost: boolean; hsn: string; taxRate: number }>;
}
const emptyLine = (): FLine => ({ key: uid('tl_'), itemId: '', batchNo: '', qty: '', serials: '', destPrice: '' });

/**
 * Step 1: route (from, to, date, vehicle). Step 2: items, each with its batch, quantity (checked against the batch) and
 * the destination price worked out from the branch's rules (editable). Step 3: review (value, e-way bill, who gets the
 * code), then Save draft or Initiate stock transfer.
 */
function TransferForm({ draft, onClose }: { draft?: StockTransfer; onClose: () => void }) {
  const me = useShopUser();
  const branches = useBranches().data ?? [];
  const goods = stockable(useItems().data ?? []);
  const toast = useToast();
  const myBranch = me.user.role !== 'Owner' && me.user.branchId ? me.user.branchId : null;
  const [f, setF] = useState(() => ({
    fromBranchId: draft?.fromBranchId ?? myBranch ?? branches.find((b) => b.isPrimary)?.id ?? branches[0]?.id ?? '',
    toBranchId: draft?.toBranchId ?? '',
    date: todayISO(), vehicleNo: draft?.vehicleNo ?? '', ewayBillNo: draft?.ewayBillNo ?? '', notes: draft?.notes ?? '',
    lines: draft?.lines.length ? draft.lines.map((l) => ({ key: uid('tl_'), itemId: l.itemId, batchNo: l.batchNo, qty: String(l.qty), serials: l.serials.join(', '), destPrice: l.manualPrice && l.destPrice != null ? String(l.destPrice) : '' })) : [emptyLine()],
  }));
  const [err, setErr] = useState<Record<string, string>>({});
  const [done, setDone] = useState<(StockTransfer & { otp?: { sentTo: string; delivered: boolean; error: string | null; expiresAt: string } }) | null>(null);
  const qc = useQueryClient();
  const upd = (key: string, p: Partial<FLine>) => setF((x) => ({ ...x, lines: x.lines.map((l) => (l.key === key ? { ...l, ...p } : l)) }));

  // Batches at the source for the items picked.
  const itemIds = [...new Set(f.lines.map((l) => l.itemId).filter(Boolean))];
  const batches = useQuery({
    queryKey: ['batches', f.fromBranchId, itemIds.join(',')],
    queryFn: async () => Object.fromEntries(await Promise.all(itemIds.map(async (id) => [id, await api.get<Batch[]>(`/shop/stock/batches?itemId=${id}&branchId=${f.fromBranchId}`)] as const))),
    enabled: !!f.fromBranchId && itemIds.length > 0,
  });
  const lineBody = f.lines.filter((l) => l.itemId).map((l) => ({ itemId: l.itemId, batchNo: l.batchNo || null, qty: Number(l.qty) || 1, serials: l.serials.trim() ? splitSerials(l.serials) : undefined,
    destPrice: l.destPrice.trim() === '' ? null : Number(l.destPrice) }));
  const previewKey = JSON.stringify([f.fromBranchId, f.toBranchId, f.date, lineBody]);
  const [debounced, setDebounced] = useState(previewKey);
  useEffect(() => { const t = setTimeout(() => setDebounced(previewKey), 350); return () => clearTimeout(t); }, [previewKey]);
  const preview = useQuery({
    queryKey: ['transferPreview', debounced],
    queryFn: () => api.post<Preview>('/shop/transfers/price-preview', { fromBranchId: f.fromBranchId, toBranchId: f.toBranchId, date: f.date, lines: lineBody }),
    enabled: !!f.toBranchId && f.toBranchId !== f.fromBranchId && lineBody.length > 0 && lineBody.every((l) => !!goods.find((g) => g.id === l.itemId)),
  });
  const pv = preview.data;
  const priceOf = (l: FLine) => pv?.lines.find((p) => p.itemId === l.itemId && (p.batchNo || '') === (l.batchNo || ''));
  const value = f.lines.reduce((s, l) => s + (Number(l.qty) || 0) * (priceOf(l)?.unitCost ?? 0), 0);

  const lineErrors = (l: FLine) => {
    const it = goods.find((g) => g.id === l.itemId);
    if (!it) return null;
    const n = Number(l.qty);
    if (it.trackBatches && !l.batchNo) return 'Pick a batch';
    const b = batches.data?.[it.id]?.find((x) => x.batchNo === l.batchNo);
    const sameBatch = f.lines.filter((x) => x.itemId === l.itemId && x.batchNo === l.batchNo).reduce((s, x) => s + (Number(x.qty) || 0), 0);
    if (b && sameBatch > b.qty) return `Batch has ${b.qty} ${it.unit}`;
    if (!it.trackBatches && n > (it.stockByBranch[f.fromBranchId] ?? 0)) return `Only ${it.stockByBranch[f.fromBranchId] ?? 0} ${it.unit} here`;
    return null;
  };

  const submit = async (initiate: boolean) => {
    if (!f.toBranchId || f.toBranchId === f.fromBranchId) return setErr({ toBranchId: 'Choose a different branch' });
    const ready = f.lines.filter((l) => l.itemId && Number(l.qty) > 0);
    if (!ready.length) return setErr({ lines: 'Add at least one item with a quantity' });
    if (ready.some((l) => lineErrors(l))) return setErr({ lines: 'Fix the highlighted lines' });
    setErr({});
    const body = { fromBranchId: f.fromBranchId, toBranchId: f.toBranchId, date: f.date, notes: f.notes, vehicleNo: f.vehicleNo, ewayBillNo: f.ewayBillNo,
      lines: ready.map((l) => ({ itemId: l.itemId, batchNo: l.batchNo || null, qty: Number(l.qty), serials: l.serials.trim() ? splitSerials(l.serials) : undefined, destPrice: l.destPrice.trim() === '' ? null : Number(l.destPrice) })) };
    try {
      let out: StockTransfer & { otp?: never };
      if (draft && initiate) out = await api.post('/shop/transfers/initiate', { transferId: (await api.put<StockTransfer>(`/shop/stock/transfers/${draft.id}`, body)).id });
      else if (draft) out = await api.put(`/shop/stock/transfers/${draft.id}`, body);
      else out = await api.post('/shop/stock/transfers', { ...body, initiate });
      for (const k of KEYS) qc.invalidateQueries({ queryKey: k });
      if (!initiate) { toast('success', `${out.number} saved as a draft`); return onClose(); }
      setDone(out);
    } catch (e) {
      const ae = e as ApiError;
      setErr({ ...fieldErrors(ae), lines: ae.message });
    }
  };

  if (done)
    return (
      <Modal open onClose={onClose} title={`${done.number} is in transit`} footer={<><Link className="btn btn-secondary" to={`/app/inventory/transfers/${done.id}/note`}>Stock transfer note</Link><button className="btn btn-primary" onClick={onClose}>Done</button></>}>
        <div className="stack" style={{ gap: 12 }}>
          <p style={{ margin: 0 }}>{done.lines.reduce((s, l) => s + l.qty, 0)} units left {done.fromName}. They are added to {done.toName}’s stock only when its manager enters the receipt code.</p>
          {done.otp?.delivered ? (
            <div className="toggle-row"><Mail size={18} /><div><div className="strong">Code emailed to {done.otp.sentTo}</div><div className="small muted">Valid for {OTP.ttlMinutes} minutes. They can resend it from the transfer.</div></div></div>
          ) : (
            <div className="support-alert"><AlertTriangle size={15} /> The code email didn’t go out{done.otp?.error ? ` (${done.otp.error})` : ''}. Staff at {done.toName} can resend it from the transfer, or the owner can receive it with a reason.</div>
          )}
        </div>
      </Modal>
    );

  const step = (n: number, title: string) => <h4 className="tf-step"><span>{n}</span>{title}</h4>;
  return (
    <Modal open onClose={onClose} size="xl" title={draft ? `Continue ${draft.number}` : 'New stock transfer'} subtitle="Batch quantities are checked against the source branch now."
      footer={<>
        <button className="btn btn-secondary" onClick={onClose}>Close</button>
        <button className="btn btn-secondary" onClick={() => submit(false)}><Save size={15} /> Save draft</button>
        <button className="btn btn-primary" onClick={() => submit(true)}><Send size={15} /> Initiate stock transfer</button>
      </>}>
      <div className="stack" style={{ gap: 18 }}>
        <section>
          {step(1, 'Route')}
          <div className="form-grid cols-3">
            <Field label="From (source branch)">
              <select className="select" value={f.fromBranchId} disabled={!!myBranch} onChange={(e) => setF({ ...f, fromBranchId: e.target.value, lines: f.lines.map((l) => ({ ...l, batchNo: '' })) })}>
                {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </Field>
            <Field label="To (destination branch)" required error={err.toBranchId}>
              <select className={`select ${err.toBranchId ? 'invalid' : ''}`} value={f.toBranchId} onChange={(e) => setF({ ...f, toBranchId: e.target.value })}>
                <option value="">Choose…</option>{branches.filter((b) => b.id !== f.fromBranchId).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </Field>
            <Field label="Date"><input className="input" type="date" value={f.date} max={todayISO()} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
            <Field label="Vehicle no."><input className="input" value={f.vehicleNo} maxLength={20} onChange={(e) => setF({ ...f, vehicleNo: e.target.value.toUpperCase() })} placeholder="TN 09 AB 1234" /></Field>
            <Field label="E-way bill no." hint={value > EWAY_BILL_THRESHOLD ? `Needed: goods worth over ₹${EWAY_BILL_THRESHOLD.toLocaleString('en-IN')}` : 'If you generated one'}>
              <input className={`input ${value > EWAY_BILL_THRESHOLD && !f.ewayBillNo ? 'invalid' : ''}`} value={f.ewayBillNo} maxLength={20} onChange={(e) => setF({ ...f, ewayBillNo: e.target.value })} />
            </Field>
          </div>
        </section>

        <section>
          {step(2, 'Items, batches and destination price')}
          <div className="table-wrap">
            <table className="table tf-lines">
              <thead><tr><th style={{ minWidth: 220 }}>Item</th><th style={{ minWidth: 220 }}>Batch</th><th className="num" style={{ width: 120 }}>Qty</th>
                <th className="num" style={{ width: 120 }}>Cost / unit</th><th style={{ minWidth: 210 }}>Price at destination</th><th style={{ width: 40 }} /></tr></thead>
              <tbody>
                {f.lines.map((l) => {
                  const it = goods.find((g) => g.id === l.itemId);
                  const bs = it ? batches.data?.[it.id] ?? [] : [];
                  const p = priceOf(l);
                  const e = lineErrors(l);
                  return (
                    <tr key={l.key} data-line={l.key} className={blankRowClass(!l.itemId)}>
                      <td>
                        <ItemPicker items={goods} value={l.itemId} tier="SP1" branchId={f.fromBranchId}
                          onPick={(id) => setF((x) => ({ ...x, lines: withTrailingBlank(x.lines.map((y) => (y.key === l.key ? { ...y, itemId: id, batchNo: '', destPrice: '' } : y)), (y) => !y.itemId, emptyLine) }))} />
                        {it?.trackSerials && <input className="input" style={{ marginTop: 6 }} value={l.serials} onChange={(ev) => upd(l.key, { serials: ev.target.value })} placeholder="Serial numbers" aria-label="Serial numbers" />}
                      </td>
                      <td>
                        {!it ? <span className="muted small">Pick an item</span> : !it.trackBatches ? <span className="muted small">Not batch-tracked · {it.stockByBranch[f.fromBranchId] ?? 0} {it.unit} here</span> : (
                          <select className={`select ${!l.batchNo && e ? 'invalid' : ''}`} value={l.batchNo} onChange={(ev) => upd(l.key, { batchNo: ev.target.value })} aria-label="Batch">
                            <option value="">{batches.isLoading ? 'Loading…' : bs.length ? 'Choose batch…' : 'No stock in any batch here'}</option>
                            {bs.map((b) => <option key={b.batchNo} value={b.batchNo}>{b.batchNo} · {b.qty} {it.unit}{b.expiryDate ? ` · exp ${fmtDate(b.expiryDate)}` : ''}{b.season ? ` · ${b.season}` : ''}</option>)}
                          </select>
                        )}
                      </td>
                      <td className="num">
                        <input className={`input num ${e && l.qty ? 'invalid' : ''}`} style={{ width: 96 }} type="number" min={0} step="any" value={l.qty} onChange={(ev) => upd(l.key, { qty: ev.target.value })} onKeyDown={enterToNextLine} aria-label="Quantity" />
                        {e && <div className="small" style={{ color: 'var(--red-600)' }}>{e}</div>}
                      </td>
                      <td className="num">{p ? money(p.unitCost) : '—'}<div className="small muted">kept on the batch</div></td>
                      <td>
                        <div className="row" style={{ gap: 6 }}>
                          <input className="input num" style={{ width: 100 }} type="number" min={0} step="0.01" value={l.destPrice} placeholder={p ? String(p.destPrice) : ''} onChange={(ev) => upd(l.key, { destPrice: ev.target.value })} aria-label="Destination price" />
                          {p && <span className="small muted">from {money(p.sourcePrice)}</span>}
                        </div>
                        {p && <div className="small muted" title={p.applied.map((a) => `${a.name} ${a.change}`).join('\n')}>
                          {p.applied.length ? p.applied.map((a) => `${a.name} ${a.change}`).join(' · ') : 'No rules for this branch: standard price'}
                        </div>}
                        {p?.belowCost && <div className="small" style={{ color: 'var(--red-600)' }}>Below the batch cost</div>}
                      </td>
                      <td><button className="icon-btn danger" aria-label="Remove line" onClick={() => setF({ ...f, lines: f.lines.length > 1 ? f.lines.filter((x) => x.key !== l.key) : [emptyLine()] })}><Trash2 size={15} /></button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="row between" style={{ marginTop: 8 }}>
            <button className="btn btn-ghost btn-sm no-print" onClick={() => setF({ ...f, lines: [...f.lines, emptyLine()] })}><Plus size={14} /> Add item</button>
            {pv && !pv.ok && pv.error && <span className="small" style={{ color: 'var(--red-600)' }}>{pv.error}</span>}
          </div>
          {err.lines && <div className="support-alert" style={{ marginTop: 8 }}><AlertTriangle size={15} /> {err.lines}</div>}
        </section>

        <section>
          {step(3, 'Review and send')}
          <div className="tf-review">
            <div><span className="muted small">Value at cost</span><strong>{money(value)}</strong></div>
            <div><span className="muted small">Receipt code goes to</span><strong>{pv?.recipient ? `${pv.recipient.name} · ${pv.recipient.email}` : f.toBranchId ? '—' : 'Choose a destination'}</strong></div>
            <div><span className="muted small">Code valid for</span><strong>{OTP.ttlMinutes} minutes · {OTP.maxAttempts} tries</strong></div>
          </div>
          <Field label="Notes"><textarea className="textarea" rows={2} maxLength={500} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} placeholder="Driver, handling instructions…" /></Field>
        </section>
      </div>
    </Modal>
  );
}

/* ======================= Destination OTP confirmation ======================= */

/** At the destination: check what arrived, report damage or shortage, enter the emailed code. */
function ReceiveModal({ id, onClose }: { id: string; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const d = useQuery({ queryKey: ['transfer', id], queryFn: () => api.get<TransferDetail>(`/shop/stock/transfers/${id}`) });
  const [code, setCode] = useState('');
  const [issues, setIssues] = useState(false);
  const [rec, setRec] = useState<Record<string, { damaged: string; missing: string }>>({});
  const [note, setNote] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [override, setOverride] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  const t = d.data;
  if (!t) return <Modal open onClose={onClose} title="Transfer"><div className="skeleton" style={{ height: 160 }} /></Modal>;

  const o = t.otp;
  const left = o?.expiresAt ? Math.max(0, Math.floor((new Date(o.expiresAt).getTime() - now) / 1000)) : 0;
  const resendIn = o ? Math.max(0, Math.ceil((new Date(o.resendAvailableAt).getTime() - now) / 1000)) : 0;
  const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  const lines = t.lines.map((l) => {
    const r = rec[l.id] ?? { damaged: '', missing: '' };
    const damaged = Number(r.damaged) || 0, missing = Number(r.missing) || 0;
    return { l, damaged, missing, received: Math.max(0, Math.round((l.qty - damaged - missing) * 1000) / 1000), bad: damaged + missing > l.qty };
  });
  const short = lines.some((x) => x.damaged + x.missing > 0);
  const payload = { transferId: t.id, note, lines: lines.map((x) => ({ lineId: x.l.id, received: x.received, damaged: x.damaged, missing: x.missing })) };
  const refresh = () => { for (const k of KEYS) qc.invalidateQueries({ queryKey: k }); };

  const verify = async () => {
    setErr('');
    if (lines.some((x) => x.bad)) return setErr('Damaged plus missing can’t be more than was sent');
    if (short && note.trim().length < 5) return setErr('Say what happened to the damaged or missing units');
    setBusy(true);
    try {
      const out = override !== null
        ? await api.post<TransferDetail>('/shop/transfers/owner-receive', { ...payload, reason: override })
        : await api.post<TransferDetail>('/shop/transfers/verify-receipt', { ...payload, otp: code });
      toast('success', `${out.number} received at ${out.toName}`, short ? `Loss at cost ${money(out.lossValue)}` : undefined);
      refresh();
      onClose();
    } catch (e) {
      const ae = e as ApiError;
      setErr(ae.message);
      if (['otp_wrong', 'otp_locked', 'otp_expired', 'otp_none'].includes(ae.code)) { setCode(''); input.current?.focus(); qc.invalidateQueries({ queryKey: ['transfer', id] }); }
    } finally { setBusy(false); }
  };
  const resend = async () => {
    setErr('');
    try {
      const r = await api.post<{ otp: { sentTo: string; delivered: boolean; error: string | null } }>('/shop/transfers/resend-otp', { transferId: t.id });
      toast(r.otp.delivered ? 'success' : 'error', r.otp.delivered ? `New code emailed to ${r.otp.sentTo}` : 'The email didn’t go out', r.otp.delivered ? 'The earlier code no longer works.' : r.otp.error ?? undefined);
      qc.invalidateQueries({ queryKey: ['transfer', id] });
    } catch (e) { setErr((e as ApiError).message); }
  };

  const received = t.status === 'Received';
  return (
    <Modal open onClose={onClose} size="lg" title={`${t.number} · ${t.fromName} → ${t.toName}`} subtitle={`Sent ${fmtDate(t.date)} by ${t.createdBy}${t.vehicleNo ? ` · ${t.vehicleNo}` : ''}`}
      footer={<>
        <Link className="btn btn-secondary" to={`/app/inventory/transfers/${t.id}/note`}>Transfer note</Link>
        <button className="btn btn-secondary" onClick={onClose}>Close</button>
        {t.status === 'In transit' && (t.can.receive || (override !== null && t.can.ownerReceive)) && (
          <button className="btn btn-primary" disabled={busy || (override === null ? code.length !== OTP.digits || o?.state !== 'open' : override.trim().length < 10)} onClick={verify}>
            {busy ? <Loader2 size={15} className="spin" /> : <ShieldCheck size={15} />} {override !== null ? 'Receive without code' : 'Verify & receive'}
          </button>
        )}
      </>}>
      <div className="stack" style={{ gap: 14 }}>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}><Status s={t.status} />{received && <span className="small muted">by {t.receivedBy} · {t.verifiedVia === 'otp' ? 'verified with the emailed code' : t.verifiedVia === 'owner_override' ? `owner override: “${t.overrideReason}”` : 'before codes were used'}</span>}</div>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Item</th><th>Batch</th><th className="num">Sent</th>{(issues || received) && <><th className="num">Damaged</th><th className="num">Missing</th><th className="num">Received</th></>}<th className="num">Price here</th></tr></thead>
            <tbody>{lines.map(({ l, received: r, bad }) => (
              <tr key={l.id}>
                <td className="strong">{l.name}</td><td>{l.batchNo || '—'}{l.expiryDate && <div className="small muted">exp {fmtDate(l.expiryDate)}</div>}</td><td className="num">{l.qty} {l.unit}</td>
                {received ? <><td className="num">{l.qtyDamaged || '—'}</td><td className="num">{l.qtyMissing || '—'}</td><td className="num strong">{l.qtyReceived}</td></> : issues && <>
                  <td className="num"><input className={`input num ${bad ? 'invalid' : ''}`} style={{ width: 80 }} type="number" min={0} value={rec[l.id]?.damaged ?? ''} onChange={(e) => setRec({ ...rec, [l.id]: { damaged: e.target.value, missing: rec[l.id]?.missing ?? '' } })} aria-label={`Damaged ${l.name}`} /></td>
                  <td className="num"><input className={`input num ${bad ? 'invalid' : ''}`} style={{ width: 80 }} type="number" min={0} value={rec[l.id]?.missing ?? ''} onChange={(e) => setRec({ ...rec, [l.id]: { missing: e.target.value, damaged: rec[l.id]?.damaged ?? '' } })} aria-label={`Missing ${l.name}`} /></td>
                  <td className="num strong">{r}</td>
                </>}
                <td className="num">{money(l.destPriceApplied ?? l.destPrice ?? 0)}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
        {received && t.discrepancyNote && <div className="support-alert"><AlertTriangle size={15} /> {t.discrepancyNote} · loss at cost {money(t.lossValue)}</div>}

        {t.status === 'In transit' && (
          <>
            {t.can.receive && !issues && <button className="btn btn-ghost btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => setIssues(true)}><AlertTriangle size={14} /> Report damaged or missing items</button>}
            {issues && <Field label="What happened (required when something is damaged or missing)"><textarea className="textarea" rows={2} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. 2 kg bruised in the van, 1 kg short on arrival" /></Field>}

            {override === null ? (
              <div className="otp-box">
                <div>
                  <div className="strong"><KeyRound size={15} style={{ verticalAlign: -2 }} /> Receipt code</div>
                  <div className="small muted">
                    {o?.state === 'open' ? <>Sent to {o.sentTo}{o.delivered ? '' : ' (email not delivered)'} · expires in {mmss(left)} · {o.attemptsLeft} {o.attemptsLeft === 1 ? 'try' : 'tries'} left</>
                      : o?.state === 'locked' ? 'Too many wrong tries. Send a new code.' : o?.state === 'expired' ? 'The code has expired. Send a new one.' : 'No code yet. Send one to the branch manager.'}
                  </div>
                </div>
                {t.can.receive ? (
                  <input ref={input} className="input otp-input" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, OTP.digits))} inputMode="numeric" autoComplete="one-time-code"
                    placeholder="••••••" maxLength={OTP.digits} aria-label="6-digit receipt code" disabled={o?.state !== 'open'} onKeyDown={(e) => e.key === 'Enter' && code.length === OTP.digits && verify()} />
                ) : (
                  <span className="small muted">{t.can.senderIsMe ? 'You sent this transfer: someone at the destination must enter the code.' : `Only staff at ${t.toName} can confirm.`}</span>
                )}
                {t.can.resend && <button className="btn btn-secondary btn-sm" disabled={resendIn > 0 || (o?.sendsLeftToday ?? 1) <= 0} onClick={resend}><RotateCw size={14} /> {resendIn > 0 ? `Resend in ${resendIn}s` : 'Resend code'}</button>}
              </div>
            ) : (
              <Field label="Why receive without the code? (owner only, kept in the audit trail)">
                <textarea className="textarea" rows={2} maxLength={500} value={override} onChange={(e) => setOverride(e.target.value)} placeholder="e.g. Email is down; I checked the goods with the branch on a video call" />
              </Field>
            )}
            {t.can.ownerReceive && <button className="btn btn-ghost btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => setOverride(override === null ? '' : null)}>{override === null ? 'Receive without the code (owner)' : 'Use the code instead'}</button>}
            {err && <div className="support-alert" role="alert"><AlertTriangle size={15} /> {err}</div>}
          </>
        )}

        {t.otpLog.length > 0 && (
          <details>
            <summary className="small muted">Code history ({t.otpLog.length})</summary>
            <ul className="support-list">{t.otpLog.map((x, i) => <li key={i} className="small">{EVENT[x.event] ?? x.event} · {x.by} · {new Date(x.at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</li>)}</ul>
          </details>
        )}
      </div>
    </Modal>
  );
}
const EVENT: Record<string, string> = {
  sent: 'Code emailed', resent: 'New code emailed', send_failed: 'Code made, email not sent', verify_failed: 'Wrong code entered', locked: 'Code locked after 3 wrong tries',
  expired: 'Expired code entered', verified: 'Code verified, stock received', owner_override: 'Received by the owner without a code', cancelled: 'Transfer cancelled',
};
