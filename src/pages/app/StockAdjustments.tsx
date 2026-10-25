import { useEffect, useMemo, useState } from 'react';
import { adjustmentTable } from '@/lib/docPdf';
import { Attachments } from '@/components/Attachments';
import { ExportMenu } from '@/components/ExportMenu';
import { PdfButton } from '@/components/PdfButton';
import { useSearchParams } from 'react-router-dom';
import { Plus, SlidersHorizontal, Loader2, X } from 'lucide-react';
import { api, fieldErrors } from '@/api/client';
import { useBranches, useItems, useMut, useStockAdjustments } from '@/api/hooks';
import type { StockAdjustment } from '@/api/types';
import { useShopUser } from '@/context/AuthContext';
import { EmptyState, Field, Modal, PageHeader, SearchInput, Segmented } from '@/components/ui';
import { StockLines, emptyStockLine, type StockLine } from '@/components/StockLines';
import { fmtDate, money, todayISO } from '@/lib/format';

const REASONS = ['Stock count', 'Damaged', 'Expired', 'Lost or stolen', 'Found', 'Internal use', 'Sample or gift', 'Other'] as const;
const KEYS = [['stockAdjustments'], ['items'], ['stockAlerts'], ['movements'], ['stockSummary'], ['dashboard']];

/** Stock adjustments: corrections after a count, damage, expiry or loss, recorded as numbered documents. */
export default function StockAdjustments() {
  const me = useShopUser();
  const canWrite = me.can('items.write');
  const { data = [], isLoading, isError, refetch } = useStockAdjustments();
  const branches = useBranches().data ?? [];
  const items = useItems().data ?? [];
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState('');
  const [view, setView] = useState<StockAdjustment | null>(null);
  const [form, setForm] = useState<{ branchId: string; date: string; reason: (typeof REASONS)[number]; mode: 'change' | 'count'; notes: string; lines: StockLine[] } | null>(null);
  const [err, setErr] = useState<Record<string, string>>({});
  const save = useMut((b: Record<string, unknown>) => api.post<StockAdjustment>('/shop/stock/adjustments', b), KEYS, { success: (a) => `${a.number} saved · ${a.lines.length} item${a.lines.length === 1 ? '' : 's'} adjusted`, silentError: true });

  const start = (mode: 'change' | 'count' = 'change') => {
    setErr({});
    setForm({ branchId: branches.find((b) => b.isPrimary)?.id ?? branches[0]?.id ?? '', date: todayISO(), reason: mode === 'count' ? 'Stock count' : 'Damaged', mode, notes: '', lines: [emptyStockLine()] });
  };
  useEffect(() => { if (params.get('new') && canWrite && branches.length) { start(params.get('mode') === 'count' ? 'count' : 'change'); setParams({}, { replace: true }); } }, [params, branches.length]);

  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    return data.filter((a) => !s || [a.number, a.reason, a.branchName, ...a.lines.map((l) => l.name)].some((v) => v.toLowerCase().includes(s)));
  }, [data, q]);

  const submit = () => {
    if (!form) return;
    const lines = form.lines.filter((l) => l.itemId && l.qty.trim() !== '').map((l) => ({ itemId: l.itemId, qty: Number(l.qty) }));
    if (!form.branchId) return setErr({ branchId: 'Choose a warehouse' });
    if (!lines.length) return setErr({ lines: form.mode === 'count' ? 'Enter the counted quantity for at least one item' : 'Add at least one item with a quantity' });
    setErr({});
    save.mutate({ branchId: form.branchId, date: form.date, reason: form.reason, mode: form.mode, notes: form.notes, lines }, { onSuccess: (a) => { setForm(null); setView(a); }, onError: (e) => setErr({ ...fieldErrors(e), lines: e.message }) });
  };

  return (
    <div className="page">
      <PageHeader title="Stock Adjustments" crumbs={<>Inventory <span>/</span> Stock Adjustments</>} subtitle="Correct stock after a count, or record damaged, expired and lost goods. Each adjustment keeps who, when and why."
        actions={<><ExportMenu disabled={!rows.length} table={() => ({
          title: 'Stock adjustments', subtitle: `${rows.length} adjustments`, filename: 'stock-adjustments',
          columns: [{ label: 'Date' }, { label: 'Number' }, { label: 'Warehouse' }, { label: 'Reason' }, { label: 'Items' }, { label: 'Value', money: true }, { label: 'By' }],
          rows: rows.map((a) => ({ cells: [fmtDate(a.date), a.number, a.branchName, a.reason, a.lines.map((l) => `${l.name} ${l.change > 0 ? '+' : ''}${l.change}`).join(', '), a.value, a.createdBy] })),
        })} />{canWrite && <><button className="btn btn-secondary" onClick={() => start('count')}>Record a stock count</button><button className="btn btn-primary" onClick={() => start()}><Plus size={16} /> New adjustment</button></>}</>} />
      <div className="card">
        <div className="toolbar"><div className="toolbar-left"><SearchInput value={q} onChange={setQ} placeholder="Search number, reason, item…" /></div></div>
        <div className="table-wrap">
          {isLoading ? <div style={{ padding: 16 }}><div className="skeleton" style={{ height: 200 }} /></div> : isError ? (
            <div style={{ padding: 16 }}><div className="error-state">Couldn’t load adjustments. <button className="btn btn-ghost btn-sm" onClick={() => refetch()}>Try again</button></div></div>
          ) : rows.length === 0 ? (
            <EmptyState icon={SlidersHorizontal} title={data.length ? 'No adjustments match' : 'No adjustments yet'} text="After a physical count, enter what is on the shelf and the difference is posted for you." action={canWrite && <button className="btn btn-primary" onClick={() => start('count')}>Record a stock count</button>} />
          ) : (
            <table className="table">
              <thead><tr><th>Date</th><th>Number</th><th>Warehouse</th><th>Reason</th><th>Items</th><th className="num">Value</th><th>By</th></tr></thead>
              <tbody>{rows.map((a) => (
                <tr key={a.id} className="clickable" onClick={() => setView(a)}>
                  <td>{fmtDate(a.date)}</td>
                  <td className="strong">{a.number}</td>
                  <td>{a.branchName}</td>
                  <td>{a.reason}{a.mode === 'count' && <div className="muted">Stock count</div>}</td>
                  <td className="muted">{a.lines.slice(0, 2).map((l) => l.name).join(', ')}{a.lines.length > 2 ? ` +${a.lines.length - 2}` : ''}</td>
                  <td className="num" style={{ color: a.value < 0 ? 'var(--red-600)' : undefined }}>{money(a.value)}</td>
                  <td className="muted">{a.createdBy || '—'}</td>
                </tr>
              ))}</tbody>
            </table>
          )}
        </div>
      </div>

      <Modal open={!!form} onClose={() => setForm(null)} size="xl" title={form?.mode === 'count' ? 'Record a stock count' : 'New stock adjustment'}
        subtitle={form?.mode === 'count' ? 'Enter what you counted on the shelf. The difference from the stock on record is posted.' : 'Enter + to add stock or − to remove it.'}
        footer={<><button className="btn btn-secondary" onClick={() => setForm(null)}>Cancel</button><button className="btn btn-primary" disabled={save.isPending} onClick={submit}>{save.isPending && <Loader2 size={15} className="spin" />} Save adjustment</button></>}>
        {form && (
          <div className="stack" style={{ gap: 16 }}>
            <div className="form-grid cols-3">
              <Field label="Warehouse" required error={err.branchId}><select className="select" value={form.branchId} onChange={(e) => setForm({ ...form, branchId: e.target.value })}>{branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></Field>
              <Field label="Date"><input className="input" type="date" value={form.date} max={todayISO()} onChange={(e) => setForm({ ...form, date: e.target.value })} /></Field>
              <Field label="Reason"><select className="select" value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value as (typeof REASONS)[number] })}>{REASONS.map((r) => <option key={r}>{r}</option>)}</select></Field>
            </div>
            <Segmented value={form.mode} onChange={(v) => setForm({ ...form, mode: v, lines: form.lines.map((l) => ({ ...l, qty: '' })) })} options={[{ value: 'change', label: 'Add or remove units' }, { value: 'count', label: 'Enter counted quantity' }]} />
            <StockLines lines={form.lines} onChange={(lines) => setForm({ ...form, lines })} items={items} branchId={form.branchId} mode={form.mode} error={err.lines} />
            <Field label="Notes"><textarea className="textarea" rows={2} maxLength={500} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="e.g. Water damage in the back store" /></Field>
          </div>
        )}
      </Modal>

      <Modal open={!!view} onClose={() => setView(null)} size="lg" title={view?.number ?? ''} subtitle={view ? `${view.branchName} · ${fmtDate(view.date)} · ${view.reason}${view.createdBy ? ` · by ${view.createdBy}` : ''}` : ''}
        footer={<>{view && <PdfButton className="btn btn-secondary" table={() => adjustmentTable(view)} label="Download PDF" />}<button className="btn btn-secondary" onClick={() => setView(null)}><X size={15} /> Close</button></>}>
        {view && (
          <>
            <table className="table">
              <thead><tr><th>Item</th><th className="num">Before</th><th className="num">Change</th><th className="num">After</th><th className="num">Value</th></tr></thead>
              <tbody>{view.lines.map((l) => <tr key={l.itemId}><td>{l.name}</td><td className="num">{l.before}</td><td className="num strong" style={{ color: l.change < 0 ? 'var(--red-600)' : 'var(--green-700)' }}>{l.change > 0 ? '+' : ''}{l.change} {l.unit}</td><td className="num">{l.after}</td><td className="num">{money(l.value)}</td></tr>)}</tbody>
              <tfoot><tr><td colSpan={4} className="strong">Total value</td><td className="num strong">{money(view.value)}</td></tr></tfoot>
            </table>
            {view.notes && <p className="small muted" style={{ marginTop: 12, whiteSpace: 'pre-line' }}>{view.notes}</p>}
            <div style={{ marginTop: 16 }}><Attachments entity="stock_adjustment" entityId={view.id} canWrite={canWrite} title="Files (count sheets, photos of damaged goods)" /></div>
          </>
        )}
      </Modal>
    </div>
  );
}
