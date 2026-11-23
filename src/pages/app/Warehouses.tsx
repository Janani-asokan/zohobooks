import { useEffect, useState } from 'react';
import { GstinField, fillEmpty } from '@/components/GstinField';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Plus, Warehouse, Pencil, Loader2, Star, ArrowLeftRight, SlidersHorizontal } from 'lucide-react';
import { api, fieldErrors } from '@/api/client';
import { useBranches, useMut, useStaff } from '@/api/hooks';
import type { Branch, StockSummary } from '@/api/types';
import { useShopUser } from '@/context/AuthContext';
import { Badge, EmptyState, Field, Modal, PageHeader, Toggle } from '@/components/ui';
import { money } from '@/lib/format';
import { VENDOR_PHONE_RULE, isValidVendorPhoneOrEmpty } from '../../../shared/contact';
import { INDIAN_STATES, stateFromCode } from '../../../shared/gst';
import { VendorPhoneInput } from '@/components/QuickAdd';

const blank = { kind: 'store' as 'store' | 'warehouse', name: '', address: '', phone: '', isPrimary: false, gstin: '', state: '', managerUserId: null as string | null };

/** Warehouses (branches): where stock is kept, what each holds and what it is worth. */
export default function Warehouses() {
  const me = useShopUser();
  const canEdit = me.can('admin');
  const { data: branches = [], isLoading } = useBranches();
  const staff = (useStaff(canEdit).data ?? []).filter((u) => u.active && !('linked' in u && u.linked));
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
                  <div className="row" style={{ gap: 8 }}><Warehouse size={18} className="muted" /><strong>{b.name}</strong><Badge tone="gray" plain>{b.kind === 'warehouse' ? 'Warehouse' : 'Store'}</Badge>{b.isPrimary && <Badge tone="blue" plain><Star size={11} /> Main</Badge>}</div>
                  {canEdit && <button className="icon-btn" aria-label={`Edit ${b.name}`} onClick={() => { setErr({}); setForm({ id: b.id, kind: b.kind ?? 'store', name: b.name, address: b.address, phone: b.phone, isPrimary: b.isPrimary, gstin: b.gstin, state: b.state, managerUserId: b.managerUserId }); }}><Pencil size={15} /></button>}
                </div>
                <div className="small muted" style={{ whiteSpace: 'pre-line', minHeight: 36 }}>{[b.address, b.phone].filter(Boolean).join('\n') || 'No address added'}</div>
                <div className="small muted">{b.gstin ? `GSTIN ${b.gstin}` : 'Uses the business GSTIN'}{' · '}Transfer codes to {staff.find((u) => u.id === b.managerUserId)?.name ?? (b.managerUserId ? 'manager' : 'branch manager / owner')}</div>
                {!!s?.incoming && <Link className="small" to="/app/inventory/transfers?tab=receive">{s.incoming} transfer{s.incoming > 1 ? 's' : ''} on the way here (not counted yet)</Link>}
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
          if (!isValidVendorPhoneOrEmpty(form.phone)) return setErr({ phone: VENDOR_PHONE_RULE });
          save.mutate(form, { onSuccess: () => setForm(null), onError: (e) => setErr({ ...fieldErrors(e), name: fieldErrors(e).name ?? (fieldErrors(e).phone ? '' : e.message) }) });
        }}>{save.isPending && <Loader2 size={15} className="spin" />} Save</button></>}>
        {form && (
          <div className="form-grid">
            <Field label="Type" className="span-all" hint={form.kind === 'warehouse' ? 'Holds stock only; send it to stores with a transfer. Comes with the “More warehouses” add-on.' : 'Bills customers and keeps its own stock. Your plan includes some stores; add more with “More stores”.'}>
              <div className="segmented">
                <button type="button" className={form.kind === 'store' ? 'active' : ''} onClick={() => setForm({ ...form, kind: 'store' })}>Store</button>
                <button type="button" className={form.kind === 'warehouse' ? 'active' : ''} disabled={form.isPrimary} onClick={() => setForm({ ...form, kind: 'warehouse' })}>Warehouse</button>
              </div>
            </Field>
            <Field label="Name" required error={err.name} className="span-all"><input className={`input ${err.name ? 'invalid' : ''}`} value={form.name} maxLength={100} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Ambattur godown" autoFocus /></Field>
            <Field label="Address" className="span-all"><textarea className="textarea" rows={2} value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} /></Field>
            <Field label="Phone" error={err.phone} hint="Optional · mobile or landline with STD code"><VendorPhoneInput value={form.phone} invalid={!!err.phone} onChange={(v) => { setForm({ ...form, phone: v }); setErr((x) => ({ ...x, phone: '' })); }} /></Field>
            <Field label="Receives transfer codes" hint="Stock sent here is added only after this person enters the emailed code" error={err.managerUserId}>
              <select className="select" value={form.managerUserId ?? ''} onChange={(e) => setForm({ ...form, managerUserId: e.target.value || null })}>
                <option value="">A manager at this branch, else the owner</option>
                {staff.map((u) => <option key={u.id} value={u.id}>{u.name} · {u.role}</option>)}
              </select>
            </Field>
            <Field label="State"><select className="select" value={form.state} onChange={(e) => setForm({ ...form, state: e.target.value })}><option value="">Same as the business</option>{INDIAN_STATES.map((st) => <option key={st}>{st}</option>)}</select></Field>
            <div className="span-all">
              <GstinField value={form.gstin} error={err.gstin} label="GSTIN of this branch (only if registered separately, e.g. in another state)" optionalHint="Leave empty to use the business GSTIN"
                onChange={(g) => setForm((f) => (f ? { ...f, gstin: g, state: (g.length >= 2 && stateFromCode(g.slice(0, 2))) || f.state } : f))}
                onFill={(d) => setForm((f) => (f ? { ...f, state: d.state || f.state, address: fillEmpty(f.address, d.address) } : f))} />
            </div>
            <div className="toggle-row span-all"><div><div className="strong">Main warehouse</div><div className="small muted">Used by default on new invoices, bills and opening stock.</div></div><Toggle checked={form.isPrimary} onChange={(v) => setForm({ ...form, isPrimary: v })} /></div>
          </div>
        )}
      </Modal>
    </div>
  );
}
