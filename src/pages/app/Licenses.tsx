import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { FileBadge2, Plus, ShieldCheck } from 'lucide-react';
import { api } from '@/api/client';
import { useBranches, useCustomers, useItems, useMut } from '@/api/hooks';
import { useShopUser } from '@/context/AuthContext';
import { EmptyState, Field, Modal, PageHeader, Toggle } from '@/components/ui';
import { fmtDate } from '@/lib/format';
import { LICENSE_STATUSES, LICENSE_TYPES, REGULATORY_KINDS, STATUS_LABEL, kindLabel, typeLabel, type LicenseStatus } from '../../../shared/licenses';

export interface License {
  id: string; branchId: string; branchName: string; customerId: string | null; customerName: string | null;
  licenseType: 'regulatory' | 'saas_seat' | 'storage_capacity'; regulatoryKind: string | null; licenseNumber: string; issuingAuthority: string;
  issueDate: string; expiryDate: string; graceDays: number; extraGraceDays: number; maxCapacity: number | null; capacityUnit: string; documentUrl: string;
  status: LicenseStatus; daysToExpiry: number; graceEnds: string; suspended: boolean; suspendedReason: string;
  enforceScope: 'all' | 'service_items' | 'none'; printOnInvoice: boolean; termStart: string; renewalItemId: string | null; renewalPrice: number;
  termMonths: number; autoRenewalInvoice: boolean; renewalLeadDays: number; usageItemId: string | null; overageRate: number; creditBalance: number;
}

export const STATUS_TONE: Record<LicenseStatus, string> = { active: 'badge-green', expiring_soon: 'badge-amber', grace: 'badge-red', expired: 'badge-red', suspended: 'badge-gray' };
export const StatusBadge = ({ s }: { s: LicenseStatus }) => <span className={`badge ${STATUS_TONE[s]}`}>{STATUS_LABEL[s]}</span>;
export const licenseName = (l: Pick<License, 'licenseType' | 'regulatoryKind'>) => (l.licenseType === 'regulatory' ? kindLabel(l.regulatoryKind) : typeLabel(l.licenseType));

export function whenText(l: License) {
  if (l.status === 'suspended') return 'Suspended';
  if (l.daysToExpiry > 0) return `${l.daysToExpiry} day${l.daysToExpiry === 1 ? '' : 's'} left`;
  if (l.daysToExpiry === 0) return 'Expires today';
  return l.status === 'grace' ? `Grace until ${fmtDate(l.graceEnds)}` : `Expired ${-l.daysToExpiry} days ago`;
}

/** Warehouse licences: every permit and capacity / seat licence, with what needs attention first. */
export default function Licenses() {
  const me = useShopUser();
  const [params, setParams] = useSearchParams();
  const status = params.get('status') ?? '';
  const [adding, setAdding] = useState(false);
  const list = useQuery({ queryKey: ['licenses'], queryFn: () => api.get<{ licenses: License[]; counts: Record<LicenseStatus, number> }>('/shop/licenses') });
  const rows = (list.data?.licenses ?? []).filter((l) => !status || l.status === status);
  const counts = list.data?.counts;
  const navigate = useNavigate();

  return (
    <div className="page">
      <PageHeader title="Warehouse licences" icon={ShieldCheck}
        subtitle="Permits (FSSAI, fire NOC, bonded warehouse …) and the capacity or seat licences you sell. Invoices from a warehouse are checked against them."
        actions={me.can('licenses.write') ? <button className="btn btn-primary" onClick={() => setAdding(true)}><Plus size={15} /> Add licence</button> : undefined} />
      <div className="tabs">
        <button className={!status ? 'active' : ''} onClick={() => setParams({})}>All <span className="count">{list.data?.licenses.length ?? 0}</span></button>
        {LICENSE_STATUSES.map((s) => (
          <button key={s} className={status === s ? 'active' : ''} onClick={() => setParams({ status: s })}>{STATUS_LABEL[s]} <span className="count">{counts?.[s] ?? 0}</span></button>
        ))}
      </div>
      <div className="card table-wrap">
        <table className="table">
          <thead><tr><th>Licence</th><th>Number</th><th>Warehouse</th><th>Client</th><th>Capacity</th><th>Expiry</th><th>Status</th></tr></thead>
          <tbody>
            {rows.map((l) => (
              <tr key={l.id} className="clickable" onClick={() => navigate(`/app/licenses/${l.id}`)}>
                <td className="strong"><Link to={`/app/licenses/${l.id}`} onClick={(e) => e.stopPropagation()}>{licenseName(l)}</Link><div className="small muted">{typeLabel(l.licenseType)}</div></td>
                <td>{l.licenseNumber}<div className="small muted">{l.issuingAuthority}</div></td>
                <td>{l.branchName}</td>
                <td>{l.customerName ?? <span className="muted">Whole warehouse</span>}</td>
                <td>{l.maxCapacity ? `${l.maxCapacity} ${l.capacityUnit}` : '—'}</td>
                <td style={{ whiteSpace: 'nowrap' }}>{fmtDate(l.expiryDate)}<div className="small muted">{whenText(l)}</div></td>
                <td><StatusBadge s={l.status} /></td>
              </tr>
            ))}
          </tbody>
        </table>
        {list.data && rows.length === 0 && <EmptyState icon={FileBadge2} title={status ? `No ${STATUS_LABEL[status as LicenseStatus].toLowerCase()} licences` : 'No licences yet'}
          text="Add your warehouse permits and client licences to get expiry reminders and keep billing within them." />}
      </div>
      {adding && <LicenseForm onClose={() => setAdding(false)} onSaved={(l) => navigate(`/app/licenses/${l.id}`)} />}
    </div>
  );
}

type Form = Omit<License, 'id' | 'branchName' | 'customerName' | 'status' | 'daysToExpiry' | 'graceEnds' | 'suspended' | 'suspendedReason' | 'extraGraceDays' | 'termStart' | 'creditBalance'>;
const blank = (): Form => ({
  branchId: '', customerId: null, licenseType: 'regulatory', regulatoryKind: 'fssai', licenseNumber: '', issuingAuthority: '', issueDate: new Date().toISOString().slice(0, 10),
  expiryDate: '', graceDays: 0, maxCapacity: null, capacityUnit: '', documentUrl: '', enforceScope: 'service_items', printOnInvoice: true, renewalItemId: null, renewalPrice: 0,
  termMonths: 12, autoRenewalInvoice: false, renewalLeadDays: 30, usageItemId: null, overageRate: 0,
});

/** Add or edit a licence. Dates move only through Renew once a licence exists (that keeps the history). */
export function LicenseForm({ existing, onClose, onSaved }: { existing?: License; onClose: () => void; onSaved?: (l: License) => void }) {
  const branches = useBranches().data ?? [];
  const customers = useCustomers().data ?? [];
  const services = (useItems().data ?? []).filter((i) => i.type === 'Services');
  const [f, setF] = useState<Form>(() => (existing ? { ...existing } : { ...blank(), branchId: branches[0]?.id ?? '' }));
  const set = (p: Partial<Form>) => setF((x) => ({ ...x, ...p }));
  const save = useMut((b: Form) => (existing ? api.patch<License>(`/shop/licenses/${existing.id}`, b) : api.post<License>('/shop/licenses', b)), [['licenses'], ['license'], ['notifications']],
    { success: existing ? 'Licence saved' : 'Licence added' });
  const err = (save.error?.details ?? {}) as Record<string, string>;
  const reg = f.licenseType === 'regulatory';
  const body = { ...f, branchId: f.branchId || branches[0]?.id || '', regulatoryKind: reg ? f.regulatoryKind : null };

  return (
    <Modal open size="lg" title={existing ? `Edit ${licenseName(existing)} ${existing.licenseNumber}` : 'Add a licence'} onClose={onClose}
      footer={<><button className="btn btn-secondary" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={save.isPending} onClick={() => save.mutate(body, { onSuccess: (l) => { onSaved?.(l); onClose(); } })}>Save</button></>}>
      <div className="form-grid">
        <Field label="Type" required>
          <select className="select" value={f.licenseType} disabled={!!existing} onChange={(e) => set({ licenseType: e.target.value as Form['licenseType'] })}>
            {LICENSE_TYPES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
          </select>
        </Field>
        {reg ? (
          <Field label="Permit" required error={err.regulatoryKind}>
            <select className="select" value={f.regulatoryKind ?? ''} onChange={(e) => set({ regulatoryKind: e.target.value })}>
              {REGULATORY_KINDS.map((k) => <option key={k.key} value={k.key}>{k.label}</option>)}
            </select>
          </Field>
        ) : (
          <Field label="Client" hint="The storage client this licence is sold to" error={err.customerId}>
            <select className="select" value={f.customerId ?? ''} onChange={(e) => set({ customerId: e.target.value || null })}>
              <option value="">Whole warehouse</option>
              {customers.map((c) => <option key={c.id} value={c.id}>{c.companyName || c.name}</option>)}
            </select>
          </Field>
        )}
        <Field label="Warehouse" required error={err.branchId}>
          <select className="select" value={body.branchId} onChange={(e) => set({ branchId: e.target.value })}>
            {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </Field>
        <Field label="Licence number" required error={err.licenseNumber}><input className="input" value={f.licenseNumber} maxLength={60} onChange={(e) => set({ licenseNumber: e.target.value })} /></Field>
        <Field label="Issuing authority"><input className="input" value={f.issuingAuthority} maxLength={120} onChange={(e) => set({ issuingAuthority: e.target.value })} placeholder="e.g. FSSAI, Tamil Nadu" /></Field>
        <Field label="Document link" error={err.documentUrl} hint="Link to the scanned licence (https://…)"><input className="input" value={f.documentUrl} onChange={(e) => set({ documentUrl: e.target.value })} /></Field>
        <Field label="Issue date" required error={err.issueDate}><input className="input" type="date" value={f.issueDate} disabled={!!existing} onChange={(e) => set({ issueDate: e.target.value })} /></Field>
        <Field label="Expiry date" required error={err.expiryDate} hint={existing ? 'Use Renew to extend it' : undefined}><input className="input" type="date" value={f.expiryDate} disabled={!!existing} onChange={(e) => set({ expiryDate: e.target.value })} /></Field>
        <Field label="Grace period (days)" hint="Billing continues this long after expiry, with a warning"><input className="input" type="number" min={0} max={365} value={f.graceDays} onChange={(e) => set({ graceDays: Number(e.target.value) })} /></Field>
        {!reg && (
          <>
            <Field label={f.licenseType === 'saas_seat' ? 'Seats' : 'Licensed capacity'} required error={err.maxCapacity}>
              <input className="input" type="number" min={0} value={f.maxCapacity ?? ''} onChange={(e) => set({ maxCapacity: e.target.value ? Number(e.target.value) : null })} />
            </Field>
            <Field label="Unit"><input className="input" value={f.capacityUnit} maxLength={30} onChange={(e) => set({ capacityUnit: e.target.value })} placeholder={f.licenseType === 'saas_seat' ? 'seats' : 'pallets / sq ft'} /></Field>
            <Field label="Usage billed with" error={err.usageItemId} hint="Invoices with this item are measured against the capacity">
              <select className="select" value={f.usageItemId ?? ''} onChange={(e) => set({ usageItemId: e.target.value || null })}>
                <option value="">Not measured</option>{services.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
              </select>
            </Field>
            <Field label="Overage rate (₹ per unit)" hint="Charged for usage above the licence"><input className="input" type="number" min={0} value={f.overageRate} onChange={(e) => set({ overageRate: Number(e.target.value) })} /></Field>
            <Field label="Renewal billed with" error={err.renewalItemId}>
              <select className="select" value={f.renewalItemId ?? ''} onChange={(e) => set({ renewalItemId: e.target.value || null })}>
                <option value="">—</option>{services.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
              </select>
            </Field>
            <Field label="Price per term (₹, before GST)" error={err.renewalPrice}><input className="input" type="number" min={0} value={f.renewalPrice} onChange={(e) => set({ renewalPrice: Number(e.target.value) })} /></Field>
            <Field label="Term (months)"><input className="input" type="number" min={1} max={60} value={f.termMonths} onChange={(e) => set({ termMonths: Number(e.target.value) })} /></Field>
            <Field label="Renewal invoice (days before expiry)"><input className="input" type="number" min={1} max={120} value={f.renewalLeadDays} onChange={(e) => set({ renewalLeadDays: Number(e.target.value) })} /></Field>
          </>
        )}
        <Field label="Checks invoices" className="span-all">
          <select className="select" value={f.enforceScope} onChange={(e) => set({ enforceScope: e.target.value as Form['enforceScope'] })}>
            <option value="service_items">Storage, handling and subscription invoices (with service lines) from this warehouse</option>
            <option value="all">Every invoice from this warehouse</option>
            <option value="none">Don’t check invoices (keep for records and reminders)</option>
          </select>
        </Field>
      </div>
      <div className="row" style={{ gap: 18, marginTop: 12, flexWrap: "wrap" }}>
        {reg && <Toggle checked={f.printOnInvoice} onChange={(v) => set({ printOnInvoice: v })} label="Print the number on tax invoices" />}
        {!reg && <Toggle checked={f.autoRenewalInvoice} onChange={(v) => set({ autoRenewalInvoice: v })} label="Make a renewal invoice before expiry" />}
      </div>
    </Modal>
  );
}
