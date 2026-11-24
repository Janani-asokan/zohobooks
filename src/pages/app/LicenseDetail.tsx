import { askText } from '@/components/AskDialog';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { CalendarPlus, ExternalLink, Pencil, PauseCircle, PlayCircle, Scaling, ShieldAlert, ShieldCheck, Trash2 } from 'lucide-react';
import { api } from '@/api/client';
import { useMut } from '@/api/hooks';
import { useShopUser } from '@/context/AuthContext';
import { Field, Modal, PageHeader } from '@/components/ui';
import { fmtDate, money } from '@/lib/format';
import { STATUS_LABEL, prorate, scaledPrice, typeLabel, type LicenseStatus } from '../../../shared/licenses';
import { LicenseForm, StatusBadge, licenseName, whenText, type License } from './Licenses';

interface Detail {
  license: License;
  overrides: Array<{ id: string; kind: 'grace_extension' | 'invoice_override'; extraDays: number | null; forExpiry: string; invoiceId: string | null; invoiceNumber: string | null; reason: string; grantedBy: string; createdAt: string; revokedAt: string | null; revokedBy: string | null }>;
  alerts: Array<{ threshold: number; forExpiry: string; sentAt: string; delivered: boolean }>;
  invoices: Array<{ id: string; number: string | null; date: string; total: number; status: string; statusAtIssue: LicenseStatus; overridden: boolean }>;
}
type Action = 'renew' | 'grace' | 'suspend' | 'reinstate' | 'capacity' | 'edit' | null;
const when = (iso: string) => new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

export default function LicenseDetail() {
  const { id } = useParams();
  const me = useShopUser();
  const navigate = useNavigate();
  const q = useQuery({ queryKey: ['license', id], queryFn: () => api.get<Detail>(`/shop/licenses/${id}`) });
  const [action, setAction] = useState<Action>(null);
  const remove = useMut(() => api.del(`/shop/licenses/${id}`), [['licenses']], { success: 'Licence deleted' });
  const revoke = useMut(async (oid: string) => api.post(`/shop/licenses/${id}/overrides/${oid}/revoke`, { reason: (await askText('Why is this grace period withdrawn? (at least 10 characters)')) ?? '' }), [['license', id], ['licenses']], { success: 'Grace period withdrawn' });
  if (!q.data) return <div className="page"><div className="skeleton" style={{ height: 300 }} /></div>;
  const { license: l, overrides, alerts, invoices } = q.data;
  const w = me.can('licenses.write');
  const o = me.can('licenses.override');
  const blocked = l.status === 'expired' || l.status === 'suspended';

  return (
    <div className="page">
      <PageHeader crumbs={<><Link to="/app/licenses">Warehouse licences</Link> / {l.licenseNumber}</>} title={`${licenseName(l)} ${l.licenseNumber}`} icon={blocked ? ShieldAlert : ShieldCheck}
        subtitle={<><StatusBadge s={l.status} /> <span style={{ marginLeft: 8 }}>{whenText(l)} · {l.branchName}{l.customerName ? ` · ${l.customerName}` : ''}</span></>}
        actions={
          <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
            {w && <button className="btn btn-primary" onClick={() => setAction('renew')}><CalendarPlus size={15} /> Renew</button>}
            {o && !l.suspended && (l.status === 'expired' || l.status === 'grace' || l.status === 'expiring_soon') && <button className="btn btn-secondary" onClick={() => setAction('grace')}>Grant grace period</button>}
            {w && l.licenseType !== 'regulatory' && !blocked && <button className="btn btn-secondary" onClick={() => setAction('capacity')}><Scaling size={15} /> Change size</button>}
            {w && (l.suspended
              ? <button className="btn btn-secondary" onClick={() => setAction('reinstate')}><PlayCircle size={15} /> Reinstate</button>
              : <button className="btn btn-secondary" onClick={() => setAction('suspend')}><PauseCircle size={15} /> Suspend</button>)}
            {w && <button className="btn btn-ghost" onClick={() => setAction('edit')}><Pencil size={15} /> Edit</button>}
          </div>
        } />

      {blocked && l.enforceScope !== 'none' && (
        <div className="support-alert" style={{ background: 'var(--red-50)', color: 'var(--red-700)' }}>
          <ShieldAlert size={15} /> {l.suspended ? `Suspended: ${l.suspendedReason}. ` : ''}Invoices from {l.branchName}{l.customerName ? ` to ${l.customerName}` : ''} are blocked until this licence is {l.suspended ? 'reinstated' : 'renewed'}{o ? ' (or overridden with a reason on the invoice)' : ''}.
        </div>
      )}

      <div className="support-grid">
        <section className="card card-body">
          <h3 style={{ marginTop: 0 }}>Details</h3>
          <dl className="support-dl">
            <dt>Type</dt><dd>{typeLabel(l.licenseType)}</dd>
            <dt>Issuing authority</dt><dd>{l.issuingAuthority || '—'}</dd>
            <dt>Issued</dt><dd>{fmtDate(l.issueDate)}</dd>
            <dt>Expires</dt><dd>{fmtDate(l.expiryDate)}</dd>
            <dt>Grace period</dt><dd>{l.graceDays} days{l.extraGraceDays ? ` + ${l.extraGraceDays} granted` : ''} · billing allowed until {fmtDate(l.graceEnds)}</dd>
            {l.maxCapacity && <><dt>Licensed</dt><dd>{l.maxCapacity} {l.capacityUnit}{l.overageRate ? ` · overage ${money(l.overageRate)} per unit` : ''}</dd></>}
            {l.licenseType !== 'regulatory' && <><dt>Price per term</dt><dd>{money(l.renewalPrice)} · {l.termMonths} months from {fmtDate(l.termStart)}</dd></>}
            {l.creditBalance > 0 && <><dt>Credit</dt><dd>{money(l.creditBalance)} off the next renewal</dd></>}
            {l.licenseType !== 'regulatory' && <><dt>Renewal invoice</dt><dd>{l.autoRenewalInvoice ? `Made ${l.renewalLeadDays} days before expiry` : 'Off'}</dd></>}
            <dt>Checks</dt><dd>{l.enforceScope === 'all' ? 'Every invoice from the warehouse' : l.enforceScope === 'service_items' ? 'Invoices with service lines' : 'No invoices'}</dd>
            {l.licenseType === 'regulatory' && <><dt>On invoices</dt><dd>{l.printOnInvoice ? 'Number printed under the GSTIN' : 'Not printed'}</dd></>}
            <dt>Document</dt><dd>{l.documentUrl ? <a href={l.documentUrl} target="_blank" rel="noopener noreferrer">Open <ExternalLink size={12} /></a> : '—'}</dd>
          </dl>
          {w && invoices.length === 0 && overrides.length === 0 && alerts.length === 0 && <button className="btn btn-ghost btn-sm" style={{ color: 'var(--red-600)' }} onClick={() => window.confirm('Delete this licence?') && remove.mutate(undefined, { onSuccess: () => navigate('/app/licenses') })}><Trash2 size={14} /> Delete licence</button>}
        </section>

        <aside className="card card-body">
          <h3 style={{ marginTop: 0 }}>Grace periods & overrides</h3>
          {overrides.length === 0 ? <p className="small muted">None.</p> : (
            <ul className="support-list">
              {overrides.map((x) => (
                <li key={x.id} className="small">
                  <strong>{x.kind === 'grace_extension' ? `+${x.extraDays} days grace` : <>Invoice override {x.invoiceId ? <Link to={`/app/sales/invoices/${x.invoiceId}`}>{x.invoiceNumber ?? 'draft'}</Link> : ''}</>}</strong>
                  {x.revokedAt && <span className="badge badge-gray" style={{ marginLeft: 6 }}>Withdrawn</span>}
                  {x.kind === 'grace_extension' && x.forExpiry.slice(0, 10) !== l.expiryDate && !x.revokedAt && <span className="badge badge-gray" style={{ marginLeft: 6 }}>Earlier term</span>}
                  <div>“{x.reason}”</div>
                  <div className="muted">{x.grantedBy} · {when(x.createdAt)}{x.revokedAt ? ` · withdrawn by ${x.revokedBy} ${when(x.revokedAt)}` : ''}</div>
                  {o && x.kind === 'grace_extension' && !x.revokedAt && x.forExpiry.slice(0, 10) === l.expiryDate && <button className="btn btn-ghost btn-sm" onClick={() => revoke.mutate(x.id)}>Withdraw</button>}
                </li>
              ))}
            </ul>
          )}
          <h3 style={{ marginTop: 18 }}>Reminders sent</h3>
          {alerts.length === 0 ? <p className="small muted">None yet. Reminders go out 90, 60, 30 and 7 days before expiry, and on the day.</p> : (
            <ul className="support-list">{alerts.map((a) => <li key={`${a.forExpiry}-${a.threshold}`} className="small">{a.threshold ? `${a.threshold} days before` : 'On expiry'} · {when(a.sentAt)}{a.delivered ? '' : ' · email not delivered'}</li>)}</ul>
          )}
        </aside>
      </div>

      <div className="card table-wrap" style={{ marginTop: 16 }}>
        <div className="card-body" style={{ paddingBottom: 0 }}><h3 style={{ margin: 0 }}>Invoices checked against this licence</h3></div>
        <table className="table">
          <thead><tr><th>Invoice</th><th>Date</th><th>Licence then</th><th className="num">Total</th></tr></thead>
          <tbody>
            {invoices.map((i) => (
              <tr key={i.id}><td><Link to={`/app/sales/invoices/${i.id}`}>{i.number ?? 'Draft'}</Link>{i.overridden && <span className="badge badge-amber" style={{ marginLeft: 6 }}>Overridden</span>}</td>
                <td>{fmtDate(i.date)}</td><td>{STATUS_LABEL[i.statusAtIssue]}</td><td className="num">{money(i.total)}</td></tr>
            ))}
            {invoices.length === 0 && <tr><td colSpan={4} className="muted small">No invoices yet.</td></tr>}
          </tbody>
        </table>
      </div>

      {action === 'edit' && <LicenseForm existing={l} onClose={() => setAction(null)} />}
      {action && action !== 'edit' && <ActionModal l={l} action={action} onClose={() => setAction(null)} />}
    </div>
  );
}

function ActionModal({ l, action, onClose }: { l: License; action: Exclude<Action, 'edit' | null>; onClose: () => void }) {
  const [f, setF] = useState({ expiryDate: '', licenseNumber: l.licenseNumber, documentUrl: l.documentUrl, days: 15, reason: '', newCapacity: l.maxCapacity ?? 0, effectiveDate: new Date().toISOString().slice(0, 10) });
  const keys = [['license', l.id], ['licenses'], ['notifications'], ['invoices']];
  const go = useMut((b: object) => api.post<unknown>(`/shop/licenses/${l.id}/${action === 'capacity' ? 'change-capacity' : action}`, b), keys,
    { success: action === 'capacity' ? 'Licence size changed' : action === 'renew' ? 'Licence renewed' : action === 'grace' ? 'Grace period granted' : action === 'suspend' ? 'Licence suspended' : 'Licence reinstated' });
  const err = (go.error?.details ?? {}) as Record<string, string>;
  const titles = { renew: 'Renew licence', grace: 'Grant a grace period', suspend: 'Suspend licence', reinstate: 'Reinstate licence', capacity: 'Change licensed size' };
  const body = action === 'renew' ? { expiryDate: f.expiryDate, licenseNumber: f.licenseNumber, documentUrl: f.documentUrl }
    : action === 'grace' ? { days: f.days, reason: f.reason }
    : action === 'capacity' ? { newCapacity: f.newCapacity, effectiveDate: f.effectiveDate, reason: f.reason }
    : { reason: f.reason };
  const preview = action === 'capacity' && l.maxCapacity && f.newCapacity > 0 && f.newCapacity !== l.maxCapacity && f.effectiveDate >= l.termStart && f.effectiveDate <= l.expiryDate
    ? (() => { const np = scaledPrice(l.renewalPrice, l.maxCapacity!, f.newCapacity); return { np, ...prorate(Math.abs(np - l.renewalPrice), l.termStart, l.expiryDate, f.effectiveDate), up: np > l.renewalPrice }; })() : null;

  return (
    <Modal open title={titles[action]} onClose={onClose}
      footer={<><button className="btn btn-secondary" onClick={onClose}>Cancel</button><button className={`btn ${action === 'suspend' ? 'btn-danger' : 'btn-primary'}`} disabled={go.isPending} onClick={() => go.mutate(body, { onSuccess: onClose })}>{titles[action].split(' ')[0]}</button></>}>
      {action === 'renew' && (
        <div className="form-grid">
          <Field label="New expiry date" required error={err.expiryDate}><input className="input" type="date" value={f.expiryDate} min={l.expiryDate} onChange={(e) => setF({ ...f, expiryDate: e.target.value })} /></Field>
          <Field label="Licence number" hint="Change it if the renewed licence has a new number"><input className="input" value={f.licenseNumber} onChange={(e) => setF({ ...f, licenseNumber: e.target.value })} /></Field>
          <Field label="Document link" className="span-all" error={err.documentUrl}><input className="input" value={f.documentUrl} onChange={(e) => setF({ ...f, documentUrl: e.target.value })} placeholder="https://…" /></Field>
          <p className="small muted span-all" style={{ margin: 0 }}>The new term starts the day after {fmtDate(l.expiryDate)}. Grace periods granted for the old expiry end, and reminders start again for the new date.</p>
        </div>
      )}
      {action === 'grace' && (
        <Field label="Extra days" hint={`Billing will be allowed until ${fmtDate(new Date(Date.parse(l.graceEnds) + f.days * 864e5).toISOString().slice(0, 10))}`}>
          <input className="input" type="number" min={1} max={90} value={f.days} onChange={(e) => setF({ ...f, days: Number(e.target.value) })} />
        </Field>
      )}
      {action === 'capacity' && (
        <div className="form-grid">
          <Field label={`New size (${l.capacityUnit || 'units'})`} required><input className="input" type="number" min={1} value={f.newCapacity} onChange={(e) => setF({ ...f, newCapacity: Number(e.target.value) })} /></Field>
          <Field label="From" error={err.effectiveDate}><input className="input" type="date" min={l.termStart} max={l.expiryDate} value={f.effectiveDate} onChange={(e) => setF({ ...f, effectiveDate: e.target.value })} /></Field>
          {preview && (
            <p className="small span-all" style={{ margin: 0 }}>
              New price {money(preview.np)} per term. {preview.days} of {preview.totalDays} days are left, so{' '}
              <strong>{money(preview.amount)}</strong> {preview.up ? 'is billed now on a draft invoice (plus GST)' : 'is credited on the next renewal invoice'}.
            </p>
          )}
        </div>
      )}
      {action !== 'renew' && (
        <Field label="Reason (kept in the audit trail)" required error={err.reason} className="span-all">
          <textarea className="textarea" rows={3} maxLength={500} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })}
            placeholder={action === 'grace' ? 'e.g. Renewal applied for on 10 Nov, application no. 4471' : action === 'suspend' ? 'e.g. Fire inspection failed on 15 Nov' : ''} />
        </Field>
      )}
    </Modal>
  );
}
