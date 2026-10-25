import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Plus, Warehouse, Pencil, Loader2, Star, ArrowLeftRight, SlidersHorizontal } from 'lucide-react';
import { api, fieldErrors } from '@/api/client';
import { useBranches, useMut } from '@/api/hooks';
import type { Branch, StockSummary } from '@/api/types';
import { useShopUser } from '@/context/AuthContext';
import { Badge, EmptyState, Field, Modal, PageHeader, Toggle } from '@/components/ui';
import { money } from '@/lib/format';

const blank = { name: '', address: '', phone: '', isPrimary: false };

/** Warehouses (branches): where stock is kept, what each holds and what it is worth. */
export default function Warehouses() {
  const me = useShopUser();
  const canEdit = me.can('admin');
  const { data: branches = [], isLoading } = useBranches();
  const summary = useQuery({ queryKey: ['stockSummary', 'warehouses'], queryFn: () => api.get<StockSummary>('/shop/stock/summary') });
  const [params, setParams] = useSearchParams();
  const [form, setForm] = useState<(typeof blank & { id?: string }) | null>(null);
  const [err, setErr] = useState<Record<string, string>>({});
  const save = useMut((b: typeof blank & { id?: string }) => (b.id ? api.put<Branch>(`/shop/branches/${b.id}`, b) : api.post<Branch>('/shop/branches', b)), [['branches'], ['stockSummary']], { success: (b) => `${b.name} saved`, silentError: true });
  useEffect(() => { if (params.get('new') && canEdit) { setForm({ ...blank }); setParams({}, { replace: true }); } }, [params]);
  const stats = (id: string) => summary.data?.byBranch.find((b) => b.branchId === id);

  return (
    <div className="page">
      <PageHeader title="Warehouses" crumbs={<>Inventory <span>/</span> Warehouses</>} subtitle="Every shop, godown or branch that holds stock. Invoices take stock from the branch they are raised at."
        actions={canEdit && <button className="btn btn-primary" onClick={() => { setErr({}); setForm({ ...blank }); }}><Plus size={16} /> New warehouse</button>} />
      {isLoading ? <div className="skeleton" style={{ height: 200 }} /> : branches.length === 0 ? (
        <div className="card"><EmptyState icon={Warehouse} title="No warehouses yet" text="Add the places you keep stock." /></div>
      ) : (
        <div className="wh-grid">
          {branches.map((b) => {
            const s = stats(b.id);
            return (
              <div key={b.id} className="card wh-card">
                <div className="row between">
                  <div className="row" style={{ gap: 8 }}><Warehouse size={18} className="muted" /><strong>{b.name}</strong>{b.isPrimary && <Badge tone="blue" plain><Star size={11} /> Main</Badge>}</div>
                  {canEdit && <button className="icon-btn" aria-label={`Edit ${b.name}`} onClick={() => { setErr({}); setForm({ id: b.id, name: b.name, address: b.address, phone: b.phone, isPrimary: b.isPrimary }); }}><Pencil size={15} /></button>}
                </div>
                <div className="small muted" style={{ whiteSpace: 'pre-line', minHeight: 36 }}>{[b.address, b.phone].filter(Boolean).join('\n') || 'No address added'}</div>
                <div className="kpi-row">
                  <div><div className="k">Stock value</div><div className="v">{s ? money(s.value) : '—'}</div></div>
                  <div><div className="k">Items in stock</div><div className="v">{s?.items ?? '—'}</div></div>
                </div>
                <div className="row" style={{ gap: 8 }}>
                  <Link className="btn btn-secondary btn-sm" to={`/app/inventory/stock-summary?branch=${b.id}`}>Stock</Link>
                  {me.can('items.write') && <Link className="btn btn-ghost btn-sm" to="/app/inventory/adjustments?new=1&mode=count"><SlidersHorizontal size={14} /> Count</Link>}
                  {me.can('items.write') && branches.length > 1 && <Link className="btn btn-ghost btn-sm" to="/app/inventory/transfers?new=1"><ArrowLeftRight size={14} /> Transfer</Link>}
                </div>
              </div>
            );
          })}
        </div>
      )}
      {summary.data && summary.data.inTransit > 0 && <p className="small muted mt-16">{summary.data.inTransit} transfer{summary.data.inTransit > 1 ? 's are' : ' is'} in transit and not counted in any warehouse. <Link to="/app/inventory/transfers">Receive them</Link>.</p>}

      <Modal open={!!form} onClose={() => setForm(null)} title={form?.id ? 'Edit warehouse' : 'New warehouse'}
        footer={<><button className="btn btn-secondary" onClick={() => setForm(null)}>Cancel</button><button className="btn btn-primary" disabled={save.isPending} onClick={() => {
          if (!form?.name.trim()) return setErr({ name: 'Give it a name' });
          save.mutate(form, { onSuccess: () => setForm(null), onError: (e) => setErr({ ...fieldErrors(e), name: fieldErrors(e).name ?? e.message }) });
        }}>{save.isPending && <Loader2 size={15} className="spin" />} Save</button></>}>
        {form && (
          <div className="form-grid">
            <Field label="Name" required error={err.name} className="span-all"><input className={`input ${err.name ? 'invalid' : ''}`} value={form.name} maxLength={100} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Ambattur godown" autoFocus /></Field>
            <Field label="Address" className="span-all"><textarea className="textarea" rows={2} value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} /></Field>
            <Field label="Phone"><input className="input" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></Field>
            <div className="toggle-row span-all"><div><div className="strong">Main warehouse</div><div className="small muted">Used by default on new invoices, bills and opening stock.</div></div><Toggle checked={form.isPrimary} onChange={(v) => setForm({ ...form, isPrimary: v })} /></div>
          </div>
        )}
      </Modal>
    </div>
  );
}
