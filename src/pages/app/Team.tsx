import { useState } from 'react';
import { Plus, Users, Building2, Star, Trash2, Check, Minus, Pencil } from 'lucide-react';
import { useTenant } from '@/context/TenantContext';
import { useToast } from '@/context/ToastContext';
import { Badge, ConfirmModal, EmptyState, Field, Modal, PageHeader, Toggle } from '@/components/ui';
import { EMAIL_RE, initials, uid } from '@/lib/format';
import type { Branch, StaffMember, StaffRole } from '@/lib/types';

const ROLES: StaffRole[] = ['Manager', 'Accountant', 'Sales Staff', 'Viewer'];
const PERMS: Array<[string, Record<StaffRole, boolean>]> = [
  ['Create & edit invoices', { Manager: true, Accountant: true, 'Sales Staff': true, Viewer: false }],
  ['Manage items & pricing', { Manager: true, Accountant: false, 'Sales Staff': false, Viewer: false }],
  ['Manage customers', { Manager: true, Accountant: true, 'Sales Staff': true, Viewer: false }],
  ['Record purchases & banking', { Manager: true, Accountant: true, 'Sales Staff': false, Viewer: false }],
  ['View reports', { Manager: true, Accountant: true, 'Sales Staff': false, Viewer: true }],
  ['Manage staff & branches', { Manager: false, Accountant: false, 'Sales Staff': false, Viewer: false }],
];

export default function Team() {
  const { tenant, mutate } = useTenant();
  const toast = useToast();
  const [tab, setTab] = useState<'staff' | 'roles' | 'branches'>('staff');
  const [staffModal, setStaffModal] = useState<{ id?: string } | null>(null);
  const [staff, setStaff] = useState<Omit<StaffMember, 'id'>>({ name: '', email: '', role: 'Sales Staff', branchId: '', active: true });
  const [branchModal, setBranchModal] = useState<{ id?: string } | null>(null);
  const [branch, setBranch] = useState<Omit<Branch, 'id' | 'isPrimary'>>({ name: '', address: '', phone: '' });
  const [touched, setTouched] = useState(false);
  const [delStaff, setDelStaff] = useState<StaffMember | null>(null);

  const bName = (id: string) => tenant.branches.find((b) => b.id === id)?.name ?? '—';
  const staffErr = { name: !staff.name.trim() ? 'Name is required' : '', email: !EMAIL_RE.test(staff.email) ? 'Valid email required' : tenant.staff.some((s) => s.email === staff.email && s.id !== staffModal?.id) ? 'Already invited' : '' };

  return (
    <div className="page">
      <PageHeader
        title="Staff, roles & branches"
        subtitle="Invite your team, control what each role can do and manage your shop locations."
        actions={
          tab === 'branches' ? (
            <button className="btn btn-primary" onClick={() => { setBranch({ name: '', address: '', phone: '' }); setTouched(false); setBranchModal({}); }}><Plus size={16} /> New Branch</button>
          ) : (
            <button className="btn btn-primary" onClick={() => { setStaff({ name: '', email: '', role: 'Sales Staff', branchId: tenant.branches[0]?.id ?? '', active: true }); setTouched(false); setStaffModal({}); }}><Plus size={16} /> Invite Staff</button>
          )
        }
      />
      <div className="tabs">
        <button className={tab === 'staff' ? 'active' : ''} onClick={() => setTab('staff')}><Users size={15} /> Staff <span className="count">{tenant.staff.length}</span></button>
        <button className={tab === 'roles' ? 'active' : ''} onClick={() => setTab('roles')}>Roles &amp; permissions</button>
        <button className={tab === 'branches' ? 'active' : ''} onClick={() => setTab('branches')}><Building2 size={15} /> Branches <span className="count">{tenant.branches.length}</span></button>
      </div>

      {tab === 'staff' && (
        <div className="card table-wrap">
          {tenant.staff.length === 0 ? <EmptyState icon={Users} title="No staff yet" text="Invite managers, accountants or sales staff." /> : (
            <table className="table">
              <thead><tr><th>Member</th><th>Role</th><th>Branch</th><th>Access</th><th /></tr></thead>
              <tbody>
                {tenant.staff.map((s) => (
                  <tr key={s.id}>
                    <td><div className="name-cell"><span className="avatar">{initials(s.name)}</span><div><div className="title">{s.name}</div><div className="sub">{s.email}</div></div></div></td>
                    <td>
                      <select className="select" style={{ height: 32, width: 150 }} value={s.role} onChange={(e) => { mutate((t) => void (t.staff.find((x) => x.id === s.id)!.role = e.target.value as StaffRole)); toast('success', 'Role updated', `${s.name} → ${e.target.value}`); }}>
                        {ROLES.map((r) => <option key={r}>{r}</option>)}
                      </select>
                    </td>
                    <td className="muted">{bName(s.branchId)}</td>
                    <td><Toggle size="sm" tone="success" checked={s.active} onChange={(v) => mutate((t) => void (t.staff.find((x) => x.id === s.id)!.active = v))} label={<span className="small">{s.active ? 'Active' : 'Suspended'}</span>} /></td>
                    <td className="num" style={{ whiteSpace: 'nowrap' }}>
                      <button className="icon-btn" title="Edit" onClick={() => { setStaff({ ...s }); setTouched(false); setStaffModal({ id: s.id }); }}><Pencil size={15} /></button>
                      <button className="icon-btn danger" title="Remove" onClick={() => setDelStaff(s)}><Trash2 size={15} /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {tab === 'roles' && (
        <div className="card table-wrap">
          <table className="table">
            <thead><tr><th>Permission</th><th style={{ textAlign: 'center' }}>Owner</th>{ROLES.map((r) => <th key={r} style={{ textAlign: 'center' }}>{r}</th>)}</tr></thead>
            <tbody>
              {PERMS.map(([p, m]) => (
                <tr key={p}>
                  <td className="strong">{p}</td>
                  <td style={{ textAlign: 'center' }}><Check size={16} style={{ color: 'var(--green-600)' }} /></td>
                  {ROLES.map((r) => <td key={r} style={{ textAlign: 'center' }}>{m[r] ? <Check size={16} style={{ color: 'var(--green-600)' }} /> : <Minus size={16} style={{ color: 'var(--ink-300)' }} />}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
          <div className="card-body small muted" style={{ borderTop: '1px solid var(--border)' }}>Platform-level settings (tax slabs, ID prefixes, financial year) are managed by your service provider and aren’t editable by any shop role.</div>
        </div>
      )}

      {tab === 'branches' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 16 }}>
          {tenant.branches.map((b) => (
            <div key={b.id} className="card" style={{ padding: 18 }}>
              <div className="row between">
                <span className="stat-icon tone-blue"><Building2 size={18} /></span>
                {b.isPrimary ? <Badge tone="blue"><Star size={11} /> Primary</Badge> : (
                  <button className="btn btn-ghost btn-sm" onClick={() => { mutate((t) => t.branches.forEach((x) => (x.isPrimary = x.id === b.id))); toast('success', 'Primary branch updated', b.name); }}>Make primary</button>
                )}
              </div>
              <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--ink-900)', marginTop: 12 }}>{b.name}</div>
              <div className="small muted" style={{ marginTop: 2 }}>{b.address || 'No address'}</div>
              <div className="small muted">{b.phone}</div>
              <div className="row between" style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--ink-150)' }}>
                <span className="small muted">{tenant.staff.filter((s) => s.branchId === b.id).length} staff · {tenant.invoices.filter((i) => i.branchId === b.id).length} invoices</span>
                <button className="icon-btn sm" title="Edit" onClick={() => { setBranch({ name: b.name, address: b.address, phone: b.phone }); setTouched(false); setBranchModal({ id: b.id }); }}><Pencil size={14} /></button>
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal open={!!staffModal} onClose={() => setStaffModal(null)} title={staffModal?.id ? 'Edit staff member' : 'Invite staff member'} footer={<><button className="btn btn-secondary" onClick={() => setStaffModal(null)}>Cancel</button><button className="btn btn-primary" onClick={() => {
        setTouched(true);
        if (staffErr.name || staffErr.email) return;
        if (staffModal?.id) mutate((t) => void Object.assign(t.staff.find((x) => x.id === staffModal.id)!, staff));
        else mutate((t) => void t.staff.push({ ...staff, id: uid('st_') }));
        toast('success', staffModal?.id ? 'Staff updated' : 'Invitation sent', staff.email);
        setStaffModal(null);
      }}>{staffModal?.id ? 'Save' : 'Send invite'}</button></>}>
        <div className="form-grid">
          <Field label="Full name" required error={touched ? staffErr.name : ''}><input className={`input ${touched && staffErr.name ? 'invalid' : ''}`} value={staff.name} onChange={(e) => setStaff({ ...staff, name: e.target.value })} /></Field>
          <Field label="Email" required error={touched ? staffErr.email : ''}><input className={`input ${touched && staffErr.email ? 'invalid' : ''}`} value={staff.email} onChange={(e) => setStaff({ ...staff, email: e.target.value.trim() })} /></Field>
          <Field label="Role"><select className="select" value={staff.role} onChange={(e) => setStaff({ ...staff, role: e.target.value as StaffRole })}>{ROLES.map((r) => <option key={r}>{r}</option>)}</select></Field>
          <Field label="Branch"><select className="select" value={staff.branchId} onChange={(e) => setStaff({ ...staff, branchId: e.target.value })}>{tenant.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></Field>
        </div>
      </Modal>

      <Modal open={!!branchModal} onClose={() => setBranchModal(null)} title={branchModal?.id ? 'Edit branch' : 'New branch'} footer={<><button className="btn btn-secondary" onClick={() => setBranchModal(null)}>Cancel</button><button className="btn btn-primary" onClick={() => {
        setTouched(true);
        if (!branch.name.trim()) return;
        if (branchModal?.id) mutate((t) => void Object.assign(t.branches.find((x) => x.id === branchModal.id)!, branch));
        else mutate((t) => void t.branches.push({ ...branch, id: uid('br_'), isPrimary: false }));
        toast('success', 'Branch saved', branch.name);
        setBranchModal(null);
      }}>Save branch</button></>}>
        <div className="form-grid">
          <Field label="Branch name" required error={touched && !branch.name.trim() ? 'Required' : ''}><input className={`input ${touched && !branch.name.trim() ? 'invalid' : ''}`} value={branch.name} onChange={(e) => setBranch({ ...branch, name: e.target.value })} /></Field>
          <Field label="Phone"><input className="input" value={branch.phone} onChange={(e) => setBranch({ ...branch, phone: e.target.value })} /></Field>
          <Field label="Address" className="span-all"><textarea className="textarea" value={branch.address} onChange={(e) => setBranch({ ...branch, address: e.target.value })} /></Field>
        </div>
      </Modal>

      <ConfirmModal open={!!delStaff} onClose={() => setDelStaff(null)} title="Remove staff member?" text={`${delStaff?.name} will lose access to this workspace.`} confirmLabel="Remove" onConfirm={() => { mutate((t) => void (t.staff = t.staff.filter((x) => x.id !== delStaff!.id))); toast('success', 'Staff removed'); }} />
    </div>
  );
}
