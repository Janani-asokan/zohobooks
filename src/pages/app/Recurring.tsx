import { useState } from 'react';
import { Repeat, Plus, Pencil, Trash2, Pause, Play, Loader2 } from 'lucide-react';
import { api } from '@/api/client';
import { useBranches, useCustomers, useMut, useOrg, useRecurring } from '@/api/hooks';
import type { Recurring as Rec } from '@/api/types';
import { usePrefs } from '@/context/PrefsContext';
import { useToast } from '@/context/ToastContext';
import { Badge, ConfirmModal, EmptyState, Field, Modal, PageHeader, Toggle } from '@/components/ui';
import { LineItemsEditor, TaxModeToggle, TotalsPanel, emptyLine, toDraft, toInput, useCalcLines, type DraftLine } from '@/components/LineItems';
import { fmtDate, todayISO } from '@/lib/format';
import { isInterState } from '../../../shared/gst';
import { Hint } from '@/components/kit';

const FREQ: Record<Rec['frequency'], string> = { weekly: 'Every week', monthly: 'Every month', quarterly: 'Every quarter', yearly: 'Every year' };

export default function Recurring() {
  const { t } = usePrefs();
  const toast = useToast();
  const { data = [], isLoading } = useRecurring();
  const { data: customers = [] } = useCustomers();
  const branches = useBranches().data ?? [];
  const org = useOrg().data;
  const [modal, setModal] = useState<{ id?: string } | null>(null);
  const [del, setDel] = useState<Rec | null>(null);
  const [f, setF] = useState({ name: '', customerId: '', frequency: 'monthly' as Rec['frequency'], startDate: todayISO(), endDate: '', termsDays: 15, branchId: '', notes: '', autoIssue: true, active: true, withGst: true });
  const [lines, setLines] = useState<DraftLine[]>([emptyLine('SP1')]);
  const [touched, setTouched] = useState(false);
  const calc = useCalcLines(lines);
  const customer = customers.find((c) => c.id === f.customerId);

  const keys = [['recurring']];
  const create = useMut((b: Record<string, unknown>) => api.post('/shop/recurring', b), keys, { success: 'Recurring profile created' });
  const update = useMut((v: { id: string; b: Record<string, unknown> }) => api.put(`/shop/recurring/${v.id}`, v.b), keys, { success: 'Profile updated' });
  const remove = useMut((id: string) => api.del(`/shop/recurring/${id}`), keys, { success: 'Profile deleted' });

  const open = (r?: Rec) => {
    setF(r ? { name: r.name, customerId: r.customerId, frequency: r.frequency, startDate: r.startDate, endDate: r.endDate ?? '', termsDays: r.termsDays, branchId: r.branchId ?? '', notes: r.notes, autoIssue: r.autoIssue, active: r.active, withGst: r.withGst } : { name: '', customerId: '', frequency: 'monthly', startDate: todayISO(), endDate: '', termsDays: 15, branchId: '', notes: '', autoIssue: true, active: true, withGst: !org?.compositionScheme });
    setLines(r ? r.lines.map(toDraft) : [emptyLine('SP1')]);
    setTouched(false);
    setModal({ id: r?.id });
  };
  const body = () => ({ ...f, endDate: f.endDate || null, branchId: f.branchId || null, lines: toInput(lines) });
  const save = () => {
    setTouched(true);
    if (!f.name.trim() || !f.customerId || !toInput(lines).length) return toast('error', 'Name, customer and at least one item are required');
    if (modal?.id) update.mutate({ id: modal.id, b: body() }, { onSuccess: () => setModal(null) });
    else create.mutate(body(), { onSuccess: () => setModal(null) });
  };
  const toggleActive = (r: Rec) => update.mutate({ id: r.id, b: { name: r.name, customerId: r.customerId, frequency: r.frequency, startDate: r.startDate, endDate: r.endDate, lines: r.lines, withGst: r.withGst, termsDays: r.termsDays, branchId: r.branchId, notes: r.notes, autoIssue: r.autoIssue, active: !r.active } });

  return (
    <div className="page">
      <PageHeader title={t('nav.recurring')} crumbs={<>{t('nav.sales')} <span>/</span> {t('nav.recurring')}</>} subtitle="Bill retainers, AMCs and rentals automatically. Invoices are generated every hour for profiles that are due."
        actions={<button className="btn btn-primary" onClick={() => open()}><Plus size={16} /> New profile</button>} />
      <Hint id="recurring" title="Bill automatically">
        <p>Set up a profile once — rent, AMC, subscriptions — and Corpus360 creates the invoice on schedule. Turn on <strong>Auto-issue</strong> to number and send it without lifting a finger.</p>
      </Hint>
      <div className="card table-wrap">
        {isLoading ? <div style={{ padding: 16 }}><div className="skeleton" style={{ height: 160 }} /></div> : data.length === 0 ? <EmptyState icon={Repeat} title="No recurring invoices" text="Set up a profile once and invoices are created on schedule." action={<button className="btn btn-primary" onClick={() => open()}><Plus size={15} /> New profile</button>} /> : (
          <table className="table">
            <thead><tr><th>Profile</th><th>{t('common.customer')}</th><th>Frequency</th><th>Next invoice</th><th>Generated</th><th>{t('common.status')}</th><th /></tr></thead>
            <tbody>
              {data.map((r) => {
                const c = customers.find((x) => x.id === r.customerId);
                return (
                  <tr key={r.id} style={!r.active ? { opacity: 0.6 } : undefined}>
                    <td className="strong">{r.name}<div className="muted">{r.autoIssue ? 'Issued automatically' : 'Created as draft'}</div></td>
                    <td>{c?.companyName || c?.name}</td>
                    <td>{FREQ[r.frequency]}</td>
                    <td>{r.active ? fmtDate(r.nextDate) : '—'}{r.endDate && <div className="muted">ends {fmtDate(r.endDate)}</div>}</td>
                    <td>{r.generated}</td>
                    <td>{r.active ? <Badge tone="green">Active</Badge> : <Badge tone="gray">Paused</Badge>}</td>
                    <td className="num" style={{ whiteSpace: 'nowrap' }}>
                      <button className="icon-btn" title={r.active ? 'Pause' : 'Resume'} onClick={() => toggleActive(r)}>{r.active ? <Pause size={15} /> : <Play size={15} />}</button>
                      <button className="icon-btn" title="Edit" onClick={() => open(r)}><Pencil size={15} /></button>
                      <button className="icon-btn danger" title="Delete" onClick={() => setDel(r)}><Trash2 size={15} /></button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <Modal open={!!modal} onClose={() => setModal(null)} size="xl" title={modal?.id ? 'Edit recurring profile' : 'New recurring profile'}
        footer={<><button className="btn btn-secondary" onClick={() => setModal(null)}>Cancel</button><button className="btn btn-primary" disabled={create.isPending || update.isPending} onClick={save}>{(create.isPending || update.isPending) && <Loader2 size={15} className="spin" />} Save profile</button></>}>
        <div className="form-grid cols-3">
          <Field label="Profile name" required error={touched && !f.name.trim() ? 'Required' : ''}><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="e.g. Monthly AMC — BrightPath" autoFocus /></Field>
          <Field label="Customer" required error={touched && !f.customerId ? 'Select a customer' : ''}>
            <select className="select" value={f.customerId} onChange={(e) => setF({ ...f, customerId: e.target.value })}><option value="">Select…</option>{customers.map((c) => <option key={c.id} value={c.id}>{c.companyName || c.name} · {c.customId}</option>)}</select>
          </Field>
          <Field label="Repeat"><select className="select" value={f.frequency} onChange={(e) => setF({ ...f, frequency: e.target.value as Rec['frequency'] })}>{Object.entries(FREQ).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
          <Field label="Start on"><input className="input" type="date" value={f.startDate} onChange={(e) => setF({ ...f, startDate: e.target.value })} /></Field>
          <Field label="End on" hint="Leave empty to repeat indefinitely"><input className="input" type="date" value={f.endDate} onChange={(e) => setF({ ...f, endDate: e.target.value })} /></Field>
          <Field label="Payment terms (days)"><input className="input" type="number" min={0} max={120} value={f.termsDays} onChange={(e) => setF({ ...f, termsDays: Number(e.target.value) })} /></Field>
          <Field label="Branch"><select className="select" value={f.branchId} onChange={(e) => setF({ ...f, branchId: e.target.value })}><option value="">Primary branch</option>{branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></Field>
          <Field label="When generated"><label className="row" style={{ gap: 10, height: 40 }}><Toggle checked={f.autoIssue} onChange={(v) => setF({ ...f, autoIssue: v })} label={<span className="small">{f.autoIssue ? 'Issue automatically' : 'Save as draft for review'}</span>} /></label></Field>
        </div>
        <div style={{ margin: '18px 0 14px' }}><TaxModeToggle withGst={f.withGst} onChange={(v) => setF({ ...f, withGst: v })} disabled={org?.compositionScheme ? 'Composition scheme' : org && !org.gstin ? 'Add GSTIN first' : undefined} /></div>
        <LineItemsEditor lines={lines} onChange={setLines} defaultTier={customer?.tier ?? 'SP1'} withGst={f.withGst} />
        <div className="grid-2 mt-16" style={{ alignItems: 'start' }}>
          <Field label="Notes on each invoice"><textarea className="textarea" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
          <TotalsPanel lines={calc} withGst={f.withGst} interState={!!org && !!customer && isInterState(org.state, customer.state || org.state)} />
        </div>
      </Modal>
      <ConfirmModal open={!!del} onClose={() => setDel(null)} title="Delete profile?" text={`“${del?.name}” will stop generating invoices. Invoices already created stay.`} onConfirm={() => remove.mutate(del!.id)} />
    </div>
  );
}
