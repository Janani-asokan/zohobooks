import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Pencil, Plus, Tag, Trash2 } from 'lucide-react';
import { api } from '@/api/client';
import { useBranches, useItems, useMut } from '@/api/hooks';
import { EmptyState, Field, Modal, PageHeader, Toggle } from '@/components/ui';
import { fmtDate, todayISO } from '@/lib/format';
import { destinationPrice, type PricingRule } from '../../../shared/transfers';

type Form = Omit<PricingRule, 'id'> & { id?: string };
const blank = (): Form => ({ name: '', kind: 'location', branchId: null, itemId: null, category: null, adjustType: 'percent', adjustValue: 0, startsOn: null, endsOn: null, priority: 100, roundTo: 0, active: true });

/** Location and seasonal price modifiers: what each branch sells at after a transfer. The purchase cost never changes. */
export default function BranchPricing() {
  const branches = useBranches().data ?? [];
  const items = (useItems().data ?? []).filter((i) => i.type === 'Goods' && !i.isGroup);
  const categories = [...new Set(items.map((i) => i.category).filter(Boolean))].sort();
  const rules = useQuery({ queryKey: ['pricingRules'], queryFn: () => api.get<PricingRule[]>('/shop/pricing-rules') });
  const [form, setForm] = useState<Form | null>(null);
  const save = useMut((f: Form) => (f.id ? api.patch(`/shop/pricing-rules/${f.id}`, f) : api.post('/shop/pricing-rules', f)), [['pricingRules']], { success: 'Pricing rule saved' });
  const del = useMut((id: string) => api.del(`/shop/pricing-rules/${id}`), [['pricingRules']], { success: 'Pricing rule deleted' });
  const err = (save.error?.details ?? {}) as Record<string, string>;
  const today = todayISO();
  const scope = (r: PricingRule) => r.itemId ? items.find((i) => i.id === r.itemId)?.name ?? 'One item' : r.category ? `Category: ${r.category}` : 'All items';
  const sample = form && (form.itemId ? items.find((i) => i.id === form.itemId) : items.find((i) => !form.category || i.category === form.category));

  return (
    <div className="page">
      <PageHeader title="Branch pricing" crumbs={<><Link to="/app/inventory/transfers">Transfers</Link> <span>/</span> Branch pricing</>}
        subtitle="Location rules always apply at a branch; seasonal rules apply between their dates. When stock is transferred, the destination's price is the standard price with these rules, applied location first, then seasonal, in priority order."
        actions={<button className="btn btn-primary" onClick={() => setForm(blank())}><Plus size={16} /> New rule</button>} />
      <div className="card table-wrap">
        <table className="table">
          <thead><tr><th>Rule</th><th>Branch</th><th>Applies to</th><th>Change</th><th>When</th><th className="num">Priority</th><th /></tr></thead>
          <tbody>
            {(rules.data ?? []).map((r) => {
              const live = r.active && (r.kind === 'location' || (r.startsOn! <= today && today <= r.endsOn!));
              return (
                <tr key={r.id}>
                  <td className="strong">{r.name}<div className="small muted">{r.kind === 'location' ? 'Location' : 'Seasonal'}{r.roundTo ? ` · rounds to ₹${r.roundTo}` : ''}</div></td>
                  <td>{branches.find((b) => b.id === r.branchId)?.name ?? 'Every branch'}</td>
                  <td>{scope(r)}</td>
                  <td className="strong" style={{ color: r.adjustValue >= 0 ? 'var(--green-700)' : 'var(--red-600)' }}>{r.adjustValue >= 0 ? '+' : '−'}{r.adjustType === 'amount' ? '₹' : ''}{Math.abs(r.adjustValue)}{r.adjustType === 'percent' ? '%' : ''}</td>
                  <td>{r.kind === 'location' ? 'Always' : `${fmtDate(r.startsOn!)} – ${fmtDate(r.endsOn!)}`}<div><span className={`badge ${live ? 'badge-green' : 'badge-gray'}`}>{live ? 'Running' : r.active ? 'Not in season' : 'Off'}</span></div></td>
                  <td className="num">{r.priority}</td>
                  <td className="num" style={{ whiteSpace: 'nowrap' }}>
                    <button className="icon-btn" aria-label={`Edit ${r.name}`} onClick={() => setForm({ ...r })}><Pencil size={15} /></button>
                    <button className="icon-btn danger" aria-label={`Delete ${r.name}`} onClick={() => window.confirm(`Delete “${r.name}”? Transfers already made keep their prices.`) && del.mutate(r.id)}><Trash2 size={15} /></button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {rules.data?.length === 0 && <EmptyState icon={Tag} title="No pricing rules" text="Without rules, stock keeps its standard price at every branch. Add a location rule (e.g. +8% at the hill-station branch) or a seasonal one (e.g. −10% on apples in winter)." />}
      </div>

      {form && (
        <Modal open size="lg" title={form.id ? `Edit ${form.name}` : 'New pricing rule'} onClose={() => setForm(null)}
          footer={<><button className="btn btn-secondary" onClick={() => setForm(null)}>Cancel</button><button className="btn btn-primary" disabled={save.isPending} onClick={() => save.mutate(form, { onSuccess: () => setForm(null) })}>Save</button></>}>
          <div className="form-grid">
            <Field label="Name" required error={err.name}><input className="input" value={form.name} maxLength={80} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Ooty branch transport" /></Field>
            <Field label="Kind">
              <select className="select" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as Form['kind'] })}>
                <option value="location">Location (always at this branch)</option><option value="seasonal">Seasonal (between two dates)</option>
              </select>
            </Field>
            <Field label="Branch"><select className="select" value={form.branchId ?? ''} onChange={(e) => setForm({ ...form, branchId: e.target.value || null })}><option value="">Every branch</option>{branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></Field>
            <Field label="Item" hint="Or leave empty and pick a category">
              <select className="select" value={form.itemId ?? ''} onChange={(e) => setForm({ ...form, itemId: e.target.value || null })}><option value="">Any item</option>{items.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}</select>
            </Field>
            {!form.itemId && <Field label="Category"><select className="select" value={form.category ?? ''} onChange={(e) => setForm({ ...form, category: e.target.value || null })}><option value="">All categories</option>{categories.map((c) => <option key={c}>{c}</option>)}</select></Field>}
            <Field label="Change" error={err.adjustValue} hint="Negative lowers the price">
              <div className="row" style={{ gap: 6 }}>
                <input className="input num" type="number" step="any" value={form.adjustValue} onChange={(e) => setForm({ ...form, adjustValue: Number(e.target.value) })} />
                <select className="select" style={{ width: 90 }} value={form.adjustType} onChange={(e) => setForm({ ...form, adjustType: e.target.value as Form['adjustType'] })}><option value="percent">%</option><option value="amount">₹</option></select>
              </div>
            </Field>
            {form.kind === 'seasonal' && <>
              <Field label="Starts" required><input className="input" type="date" value={form.startsOn ?? ''} onChange={(e) => setForm({ ...form, startsOn: e.target.value || null })} /></Field>
              <Field label="Ends" required error={err.endsOn}><input className="input" type="date" value={form.endsOn ?? ''} onChange={(e) => setForm({ ...form, endsOn: e.target.value || null })} /></Field>
            </>}
            <Field label="Priority" hint="Lower runs first within its kind"><input className="input num" type="number" min={0} max={10000} value={form.priority} onChange={(e) => setForm({ ...form, priority: Number(e.target.value) })} /></Field>
            <Field label="Round the price to" hint="0 = to the paisa"><select className="select" value={form.roundTo} onChange={(e) => setForm({ ...form, roundTo: Number(e.target.value) })}>{[0, 1, 5, 10].map((v) => <option key={v} value={v}>{v ? `₹${v}` : 'Paisa'}</option>)}</select></Field>
          </div>
          <div className="row between" style={{ marginTop: 12, flexWrap: 'wrap', gap: 10 }}>
            <Toggle checked={form.active} onChange={(v) => setForm({ ...form, active: v })} label="Rule is on" />
            {sample && <span className="small muted">Example: {sample.name} at ₹{sample.sp1} → ₹{destinationPrice(sample.sp1, [{ ...form, id: 'x', branchId: null }], { branchId: '', itemId: sample.id, category: sample.category, date: form.startsOn ?? today }).price} with this rule alone</span>}
          </div>
        </Modal>
      )}
    </div>
  );
}
