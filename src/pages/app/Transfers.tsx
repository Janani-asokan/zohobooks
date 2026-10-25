import { useEffect, useMemo, useState } from 'react';
import { transferTable } from '@/lib/docPdf';
import { AttachButton } from '@/components/AttachButton';
import { ExportMenu } from '@/components/ExportMenu';
import { PdfButton } from '@/components/PdfButton';
import { useSearchParams } from 'react-router-dom';
import { Plus, ArrowLeftRight, Loader2, PackageCheck, Ban, ArrowRight } from 'lucide-react';
import { api, fieldErrors } from '@/api/client';
import { useBranches, useItems, useMut, useStockTransfers } from '@/api/hooks';
import type { StockTransfer } from '@/api/types';
import { useShopUser } from '@/context/AuthContext';
import { ConfirmModal, EmptyState, Field, Modal, PageHeader, SearchInput, StatCard, Toggle } from '@/components/ui';
import { StatusBadge } from '@/components/StatusBadge';
import { StockLines, emptyStockLine, splitSerials, type StockLine } from '@/components/StockLines';
import { fmtDate, todayISO } from '@/lib/format';

const KEYS = [['stockTransfers'], ['items'], ['stockAlerts'], ['movements'], ['stockSummary'], ['serials']];

/** Transfers between warehouses: stock leaves on dispatch and arrives when the other side receives it. */
export default function Transfers() {
  const me = useShopUser();
  const canWrite = me.can('items.write');
  const { data = [], isLoading, isError, refetch } = useStockTransfers();
  const branches = useBranches().data ?? [];
  const items = useItems().data ?? [];
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState('');
  const [tab, setTab] = useState<'all' | StockTransfer['status']>('all');
  const [form, setForm] = useState<{ fromBranchId: string; toBranchId: string; date: string; notes: string; receiveNow: boolean; lines: StockLine[] } | null>(null);
  const [err, setErr] = useState<Record<string, string>>({});
  const [cancel, setCancel] = useState<StockTransfer | null>(null);
  const create = useMut((b: Record<string, unknown>) => api.post<StockTransfer>('/shop/stock/transfers', b), KEYS, { success: (t) => (t.status === 'Received' ? `${t.number} moved to ${t.toName}` : `${t.number} dispatched to ${t.toName}`), silentError: true });
  const receive = useMut((id: string) => api.post<StockTransfer>(`/shop/stock/transfers/${id}/receive`, {}), KEYS, { success: (t) => `${t.number} received at ${t.toName}` });
  const cancelMut = useMut((id: string) => api.post<StockTransfer>(`/shop/stock/transfers/${id}/cancel`, {}), KEYS, { success: (t) => `${t.number} cancelled · stock back at ${t.fromName}` });

  const start = () => {
    setErr({});
    const from = branches.find((b) => b.isPrimary)?.id ?? branches[0]?.id ?? '';
    setForm({ fromBranchId: from, toBranchId: branches.find((b) => b.id !== from)?.id ?? '', date: todayISO(), notes: '', receiveNow: false, lines: [emptyStockLine()] });
  };
  useEffect(() => { if (params.get('new') && canWrite && branches.length) { start(); setParams({}, { replace: true }); } }, [params, branches.length]);

  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    return data.filter((t) => tab === 'all' || t.status === tab).filter((t) => !s || [t.number, t.fromName, t.toName, ...t.lines.map((l) => l.name)].some((v) => v.toLowerCase().includes(s)));
  }, [data, q, tab]);
  const inTransit = data.filter((t) => t.status === 'In transit');

  const submit = () => {
    if (!form) return;
    if (!form.toBranchId || form.toBranchId === form.fromBranchId) return setErr({ toBranchId: 'Choose a different warehouse' });
    const lines = form.lines.filter((l) => l.itemId && Number(l.qty) > 0).map((l) => ({ itemId: l.itemId, qty: Number(l.qty), serials: l.serials.trim() ? splitSerials(l.serials) : undefined }));
    if (!lines.length) return setErr({ lines: 'Add at least one item with a quantity' });
    setErr({});
    create.mutate({ fromBranchId: form.fromBranchId, toBranchId: form.toBranchId, date: form.date, notes: form.notes, receiveNow: form.receiveNow, lines }, { onSuccess: () => setForm(null), onError: (e) => setErr({ ...fieldErrors(e), lines: e.message }) });
  };

  if (branches.length < 2 && !isLoading)
    return (
      <div className="page">
        <PageHeader title="Transfers" crumbs={<>Inventory <span>/</span> Transfers</>} subtitle="Move stock between warehouses." />
        <div className="card"><EmptyState icon={ArrowLeftRight} title="You have one warehouse" text="Add a second warehouse or branch to move stock between them." action={<a className="btn btn-primary" href="/app/inventory/warehouses?new=1">Add a warehouse</a>} /></div>
      </div>
    );

  return (
    <div className="page">
      <PageHeader title="Transfers" crumbs={<>Inventory <span>/</span> Transfers</>} subtitle="Move stock between warehouses. Stock leaves when you dispatch and arrives when the other side receives it."
        actions={<><ExportMenu disabled={!rows.length} table={() => ({
          title: 'Stock transfers', subtitle: `${rows.length} transfers`, filename: 'stock-transfers',
          columns: [{ label: 'Date' }, { label: 'Number' }, { label: 'From' }, { label: 'To' }, { label: 'Items' }, { label: 'Status' }],
          rows: rows.map((t) => ({ cells: [fmtDate(t.date), t.number, t.fromName, t.toName, t.lines.map((l) => `${l.name} × ${l.qty}`).join(', '), t.status] })),
        })} />{canWrite && <button className="btn btn-primary" onClick={start}><Plus size={16} /> New transfer</button>}</>} />
      <div className="stat-grid">
        <StatCard label="In transit" value={inTransit.length} icon={ArrowLeftRight} tone="amber" foot={`${inTransit.reduce((s, t) => s + t.lines.length, 0)} item lines on the way`} />
        <StatCard label="Received this month" value={data.filter((t) => t.status === 'Received' && (t.receivedAt ?? '') >= todayISO().slice(0, 8) + '01').length} icon={PackageCheck} tone="green" foot="Transfers completed" />
      </div>
      <div className="card mt-16">
        <div className="toolbar">
          <div className="toolbar-left">
            <SearchInput value={q} onChange={setQ} placeholder="Search number, warehouse, item…" />
            <div className="filter-chips" style={{ padding: 0 }}>
              {(['all', 'In transit', 'Received', 'Cancelled'] as const).map((f) => <button key={f} className={`filter-chip ${tab === f ? 'active' : ''}`} onClick={() => setTab(f)}>{f === 'all' ? 'All' : f} <span className="n">{f === 'all' ? data.length : data.filter((t) => t.status === f).length}</span></button>)}
            </div>
          </div>
        </div>
        <div className="table-wrap">
          {isLoading ? <div style={{ padding: 16 }}><div className="skeleton" style={{ height: 200 }} /></div> : isError ? (
            <div style={{ padding: 16 }}><div className="error-state">Couldn’t load transfers. <button className="btn btn-ghost btn-sm" onClick={() => refetch()}>Try again</button></div></div>
          ) : rows.length === 0 ? (
            <EmptyState icon={ArrowLeftRight} title={data.length ? 'No transfers match' : 'No transfers yet'} text="Send stock from one warehouse to another; it shows as in transit until received." action={canWrite && <button className="btn btn-primary" onClick={start}><Plus size={15} /> New transfer</button>} />
          ) : (
            <table className="table">
              <thead><tr><th>Date</th><th>Number</th><th>Route</th><th>Items</th><th>Status</th><th /></tr></thead>
              <tbody>{rows.map((t) => (
                <tr key={t.id}>
                  <td>{fmtDate(t.date)}</td>
                  <td className="strong">{t.number}{t.createdBy && <div className="muted">by {t.createdBy}</div>}</td>
                  <td><span className="row" style={{ gap: 6 }}>{t.fromName} <ArrowRight size={13} className="muted" /> {t.toName}</span></td>
                  <td className="muted">{t.lines.map((l) => `${l.name} × ${l.qty}`).slice(0, 2).join(', ')}{t.lines.length > 2 ? ` +${t.lines.length - 2}` : ''}</td>
                  <td><StatusBadge status={t.status} />{t.receivedAt && <div className="muted small">{fmtDate(t.receivedAt.slice(0, 10))}</div>}</td>
                  <td className="num" style={{ whiteSpace: 'nowrap' }}>
                    <PdfButton iconOnly table={() => transferTable(t)} />
                    <AttachButton entity="stock_transfer" entityId={t.id} title={t.number} canWrite={canWrite} />
                    {canWrite && t.status === 'In transit' && <>
                      <button className="btn btn-primary btn-sm" disabled={receive.isPending} onClick={() => receive.mutate(t.id)}><PackageCheck size={14} /> Receive</button>
                      <button className="icon-btn danger" title="Cancel transfer" onClick={() => setCancel(t)}><Ban size={15} /></button>
                    </>}
                  </td>
                </tr>
              ))}</tbody>
            </table>
          )}
        </div>
      </div>

      <Modal open={!!form} onClose={() => setForm(null)} size="xl" title="New transfer" subtitle="Quantities are checked against what the source warehouse has now."
        footer={<><button className="btn btn-secondary" onClick={() => setForm(null)}>Cancel</button><button className="btn btn-primary" disabled={create.isPending} onClick={submit}>{create.isPending && <Loader2 size={15} className="spin" />} {form?.receiveNow ? 'Move stock' : 'Dispatch'}</button></>}>
        {form && (
          <div className="stack" style={{ gap: 16 }}>
            <div className="form-grid cols-3">
              <Field label="From"><select className="select" value={form.fromBranchId} onChange={(e) => setForm({ ...form, fromBranchId: e.target.value, lines: form.lines.map((l) => ({ ...l })) })}>{branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></Field>
              <Field label="To" required error={err.toBranchId}><select className={`select ${err.toBranchId ? 'invalid' : ''}`} value={form.toBranchId} onChange={(e) => setForm({ ...form, toBranchId: e.target.value })}><option value="">Choose…</option>{branches.filter((b) => b.id !== form.fromBranchId).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></Field>
              <Field label="Date"><input className="input" type="date" value={form.date} max={todayISO()} onChange={(e) => setForm({ ...form, date: e.target.value })} /></Field>
            </div>
            <StockLines lines={form.lines} onChange={(lines) => setForm({ ...form, lines })} items={items} branchId={form.fromBranchId} mode="move" error={err.lines} />
            <div className="toggle-row"><div><div className="strong">Received straight away</div><div className="small muted">For moves within the same premises. Otherwise the stock waits in transit until someone receives it.</div></div><Toggle checked={form.receiveNow} onChange={(v) => setForm({ ...form, receiveNow: v })} /></div>
            <Field label="Notes"><textarea className="textarea" rows={2} maxLength={500} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Vehicle, driver, delivery challan number…" /></Field>
          </div>
        )}
      </Modal>
      <ConfirmModal open={!!cancel} onClose={() => setCancel(null)} title="Cancel transfer?" confirmLabel="Cancel transfer" text={`${cancel?.number}: the stock goes back to ${cancel?.fromName}.`} onConfirm={() => cancelMut.mutate(cancel!.id)} />
    </div>
  );
}
