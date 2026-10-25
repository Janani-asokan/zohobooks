import { useState } from 'react';
import { Plus, Users, Building2, Star, Pencil, History, KeyRound, Wand2, Loader2 } from 'lucide-react';
import { api, fieldErrors } from '@/api/client';
import { useBranches, useMut, useStaff } from '@/api/hooks';
import { Link } from 'react-router-dom';
import { RolesMatrix } from '@/components/RolesMatrix';
import type { Branch, StaffUser } from '@/api/types';
import { useShopUser } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { Badge, Field, Modal, PageHeader, Toggle } from '@/components/ui';
import { EMAIL_RE, initials } from '@/lib/format';
import { PERMISSIONS, ROLE_PERMISSIONS, STAFF_ROLES, isStrongPassword, PASSWORD_RULE, type StaffRole } from '../../../shared/permissions';

const genPassword = () => {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  const arr = crypto.getRandomValues(new Uint32Array(9));
  return Array.from(arr, (n) => chars[n % chars.length]).join('') + (arr[0]! % 10);
};

export default function Team() {
  const me = useShopUser();
  const toast = useToast();
  const [tab, setTab] = useState<'staff' | 'roles' | 'branches'>('staff');
  const staff = useStaff().data ?? [];
  const branches = useBranches().data ?? [];
  const [staffModal, setStaffModal] = useState<{ id?: string } | null>(null);
  const [form, setForm] = useState({ name: '', email: '', role: 'Sales Staff' as StaffRole, branchId: '', password: '' });
  const [branchModal, setBranchModal] = useState<{ id?: string } | null>(null);
  const [branch, setBranch] = useState({ name: '', address: '', phone: '' });
  const [touched, setTouched] = useState(false);
  const [serverErr, setServerErr] = useState<Record<string, string>>({});
  const [credentials, setCredentials] = useState<{ email: string; password: string } | null>(null);

  const sKeys = [['staff'], ['audit']];
  const createStaff = useMut((b: Record<string, unknown>) => api.post<StaffUser>('/shop/staff', b), sKeys, { silentError: true });
  const patchStaff = useMut((v: { id: string; b: Record<string, unknown> }) => api.patch<StaffUser>(`/shop/staff/${v.id}`, v.b), sKeys, {});
  const bKeys = [['branches'], ['audit']];
  const createBranch = useMut((b: Record<string, unknown>) => api.post<Branch>('/shop/branches', b), bKeys, { success: (b) => `Branch “${b.name}” added` });
  const updateBranch = useMut((v: { id: string; b: Record<string, unknown> }) => api.put<Branch>(`/shop/branches/${v.id}`, v.b), bKeys, { success: 'Branch updated' });

  const bName = (id: string | null) => branches.find((b) => b.id === id)?.name ?? '—';
  const staffErr = {
    name: !form.name.trim() ? 'Name is required' : '',
    email: !staffModal?.id && !EMAIL_RE.test(form.email) ? 'Valid email required' : '',
    password: !staffModal?.id && !isStrongPassword(form.password) ? PASSWORD_RULE : '',
  };
  const err = (k: keyof typeof staffErr) => (touched ? staffErr[k] : '') || serverErr[k] || '';
  const activeUsers = staff.filter((s) => s.active).length;

  const saveStaff = () => {
    setTouched(true);
    setServerErr({});
    if (Object.values(staffErr).some(Boolean)) return;
    if (staffModal?.id) {
      patchStaff.mutate({ id: staffModal.id, b: { name: form.name, role: form.role, branchId: form.branchId || null } }, { onSuccess: () => { toast('success', 'Staff updated'); setStaffModal(null); } });
    } else {
      createStaff.mutate({ ...form, branchId: form.branchId || null }, {
        onSuccess: (u) => { setStaffModal(null); setCredentials({ email: u.email, password: form.password }); },
        onError: (e) => { setServerErr(fieldErrors(e)); toast('error', e.message); },
      });
    }
  };

  const resetPassword = (u: StaffUser) => {
    const password = genPassword();
    patchStaff.mutate({ id: u.id, b: { password } }, { onSuccess: () => setCredentials({ email: u.email, password }) });
  };

  return (
    <div className="page">
      <PageHeader title="Staff, roles & branches" subtitle={`Each staff member signs in with their own account. ${activeUsers} active users · ${branches.length} ${branches.length === 1 ? 'branch' : 'branches'}.`}
        actions={tab === 'branches' ? (
          <button className="btn btn-primary" disabled={branches.length >= me.shop.limits.branches} title={branches.length >= me.shop.limits.branches ? 'Limit reached for this account' : undefined} onClick={() => { setBranch({ name: '', address: '', phone: '' }); setTouched(false); setBranchModal({}); }}><Plus size={16} /> New Branch</button>
        ) : tab === 'staff' ? (
          <button className="btn btn-primary" disabled={activeUsers >= me.shop.limits.users} title={activeUsers >= me.shop.limits.users ? 'Limit reached for this account' : undefined} onClick={() => { setForm({ name: '', email: '', role: 'Sales Staff', branchId: branches[0]?.id ?? '', password: genPassword() }); setTouched(false); setServerErr({}); setStaffModal({}); }}><Plus size={16} /> Add Staff</button>
        ) : null} />
      <div className="tabs">
        <button className={tab === 'staff' ? 'active' : ''} onClick={() => setTab('staff')}><Users size={15} /> Staff <span className="count">{staff.length}</span></button>
        <button className={tab === 'roles' ? 'active' : ''} onClick={() => setTab('roles')}>Roles &amp; permissions</button>
        <button className={tab === 'branches' ? 'active' : ''} onClick={() => setTab('branches')}><Building2 size={15} /> Branches <span className="count">{branches.length}</span></button>
        <Link className="tab-link" to="/app/audit"><History size={15} /> Audit log</Link>
      </div>

      {tab === 'staff' && (
        <div className="card table-wrap">
          <table className="table">
            <thead><tr><th>Member</th><th>Role</th><th>Branch</th><th>Last sign-in</th><th>Access</th><th /></tr></thead>
            <tbody>
              {staff.map((s) => (
                <tr key={s.id}>
                  <td><div className="name-cell"><span className="avatar">{initials(s.name)}</span><div><div className="title">{s.name}{s.id === me.user.id && <span className="muted"> (you)</span>}</div><div className="sub">{s.email}</div></div></div></td>
                  <td>{s.role === 'Owner' ? <Badge tone="violet" plain>Owner</Badge> : (
                    <select className="select" style={{ height: 32, width: 150 }} value={s.role} onChange={(e) => patchStaff.mutate({ id: s.id, b: { role: e.target.value } }, { onSuccess: () => toast('success', 'Role updated', `${s.name} → ${e.target.value}. They’ll be asked to sign in again.`) })} aria-label={`Role for ${s.name}`}>
                      {STAFF_ROLES.map((r) => <option key={r}>{r}</option>)}
                    </select>
                  )}</td>
                  <td className="muted">{bName(s.branchId)}</td>
                  <td className="muted">{s.lastLoginAt ? new Date(s.lastLoginAt).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'Never'}{s.mustChangePassword && <div><Badge tone="amber" plain>Temp password</Badge></div>}</td>
                  <td>{s.role === 'Owner' ? <span className="small muted">Full access</span> : <Toggle size="sm" tone="success" checked={s.active} onChange={(v) => patchStaff.mutate({ id: s.id, b: { active: v } }, { onSuccess: () => toast(v ? 'success' : 'info', v ? 'Access restored' : 'Access suspended — signed out', s.name) })} label={<span className="small">{s.active ? 'Active' : 'Suspended'}</span>} />}</td>
                  <td className="num" style={{ whiteSpace: 'nowrap' }}>
                    {s.role !== 'Owner' && (
                      <>
                        <button className="icon-btn" title="Reset password" onClick={() => resetPassword(s)}><KeyRound size={15} /></button>
                        <button className="icon-btn" title="Edit" onClick={() => { setForm({ name: s.name, email: s.email, role: s.role as StaffRole, branchId: s.branchId ?? '', password: '' }); setTouched(false); setServerErr({}); setStaffModal({ id: s.id }); }}><Pencil size={15} /></button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'roles' && <RolesMatrix />}

      {tab === 'branches' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 16 }}>
          {branches.map((b) => (
            <div key={b.id} className="card" style={{ padding: 18 }}>
              <div className="row between">
                <span className="stat-icon tone-blue"><Building2 size={18} /></span>
                {b.isPrimary ? <Badge tone="blue"><Star size={11} /> Primary</Badge> : <button className="btn btn-ghost btn-sm" onClick={() => updateBranch.mutate({ id: b.id, b: { name: b.name, address: b.address, phone: b.phone, isPrimary: true } })}>Make primary</button>}
              </div>
              <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--ink-900)', marginTop: 12 }}>{b.name}</div>
              <div className="small muted" style={{ marginTop: 2 }}>{b.address || 'No address'}</div>
              <div className="small muted">{b.phone}</div>
              <div className="row between" style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--ink-150)' }}>
                <span className="small muted">{staff.filter((s) => s.branchId === b.id).length} staff</span>
                <button className="icon-btn sm" title="Edit" onClick={() => { setBranch({ name: b.name, address: b.address, phone: b.phone }); setTouched(false); setBranchModal({ id: b.id }); }}><Pencil size={14} /></button>
              </div>
            </div>
          ))}
        </div>
      )}


      <Modal open={!!staffModal} onClose={() => setStaffModal(null)} title={staffModal?.id ? 'Edit staff member' : 'Add staff member'} subtitle={staffModal?.id ? undefined : 'They’ll sign in with this email and must choose a new password the first time.'}
        footer={<><button className="btn btn-secondary" onClick={() => setStaffModal(null)}>Cancel</button><button className="btn btn-primary" disabled={createStaff.isPending || patchStaff.isPending} onClick={saveStaff}>{createStaff.isPending && <Loader2 size={15} className="spin" />} {staffModal?.id ? 'Save' : 'Create login'}</button></>}>
        <div className="form-grid">
          <Field label="Full name" required error={err('name')}><input className={`input ${err('name') ? 'invalid' : ''}`} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoFocus /></Field>
          <Field label="Email" required error={err('email')}><input className={`input ${err('email') ? 'invalid' : ''}`} value={form.email} disabled={!!staffModal?.id} onChange={(e) => setForm({ ...form, email: e.target.value.trim() })} /></Field>
          <Field label="Role" hint={`${ROLE_PERMISSIONS[form.role].length} of ${Object.keys(PERMISSIONS).length} permissions — see the Roles tab`}><select className="select" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as StaffRole })}>{STAFF_ROLES.map((r) => <option key={r}>{r}</option>)}</select></Field>
          <Field label="Branch"><select className="select" value={form.branchId} onChange={(e) => setForm({ ...form, branchId: e.target.value })}>{branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></Field>
          {!staffModal?.id && (
            <Field label="Temporary password" required error={err('password')} className="span-all">
              <div className="input-group trail-pad">
                <input className={`input ${err('password') ? 'invalid' : ''}`} style={{ paddingLeft: 12, fontFamily: 'ui-monospace, Menlo, monospace' }} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
                <span className="trail"><button type="button" className="icon-btn" title="Generate" onClick={() => setForm({ ...form, password: genPassword() })}><Wand2 size={15} /></button></span>
              </div>
            </Field>
          )}
        </div>
      </Modal>

      <Modal open={!!credentials} onClose={() => setCredentials(null)} title="Sign-in details" subtitle="Share these privately. The password is shown only once and must be changed at first sign-in."
        footer={<button className="btn btn-primary" onClick={() => { navigator.clipboard?.writeText(`Login: ${window.location.origin}/login\nEmail: ${credentials?.email}\nTemporary password: ${credentials?.password}`); toast('success', 'Copied to clipboard'); }}>Copy details</button>}>
        <div className="card" style={{ padding: 16, boxShadow: 'none', background: 'var(--ink-50)' }}>
          <div className="small muted">Email</div><div className="strong">{credentials?.email}</div>
          <div className="small muted" style={{ marginTop: 10 }}>Temporary password</div><div className="strong" style={{ fontFamily: 'ui-monospace, Menlo, monospace' }}>{credentials?.password}</div>
        </div>
      </Modal>

      <Modal open={!!branchModal} onClose={() => setBranchModal(null)} title={branchModal?.id ? 'Edit branch' : 'New branch'}
        footer={<><button className="btn btn-secondary" onClick={() => setBranchModal(null)}>Cancel</button><button className="btn btn-primary" onClick={() => {
          setTouched(true);
          if (!branch.name.trim()) return;
          if (branchModal?.id) updateBranch.mutate({ id: branchModal.id, b: branch }, { onSuccess: () => setBranchModal(null) });
          else createBranch.mutate(branch, { onSuccess: () => setBranchModal(null) });
        }}>Save branch</button></>}>
        <div className="form-grid">
          <Field label="Branch name" required error={touched && !branch.name.trim() ? 'Required' : ''}><input className={`input ${touched && !branch.name.trim() ? 'invalid' : ''}`} value={branch.name} onChange={(e) => setBranch({ ...branch, name: e.target.value })} autoFocus /></Field>
          <Field label="Phone"><input className="input" value={branch.phone} onChange={(e) => setBranch({ ...branch, phone: e.target.value })} /></Field>
          <Field label="Address" className="span-all"><textarea className="textarea" value={branch.address} onChange={(e) => setBranch({ ...branch, address: e.target.value })} /></Field>
        </div>
      </Modal>
    </div>
  );
}
