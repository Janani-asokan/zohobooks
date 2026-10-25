import { useEffect, useState } from 'react';
import { Check, Lock, Loader2, RotateCcw } from 'lucide-react';
import { api } from '@/api/client';
import { useMut, useRoles } from '@/api/hooks';
import type { UserRole } from '../../shared/permissions';
import { PERMISSIONS, PERMISSION_GROUPS, type Permission } from '../../shared/permissions';

const ROLE_HINT: Record<string, string> = {
  Manager: 'Runs the shop day to day',
  Accountant: 'Books, banking, GST and reports',
  'Sales Staff': 'Billing counter and customers',
  Warehouse: 'Items, stock and goods received',
  Viewer: 'Read-only access to numbers',
};

/**
 * Permissions per role, editable by the owner. Changes apply on the users' next request:
 * the server checks the matrix on every call, so a hidden button is never the only guard.
 */
export function RolesMatrix() {
  const roles = useRoles();
  const [draft, setDraft] = useState<Record<string, Permission[]>>({});
  useEffect(() => { if (roles.data) setDraft(Object.fromEntries(roles.data.map((r) => [r.role, r.permissions]))); }, [roles.data]);
  const keys = [['roles'], ['me'], ['audit']];
  const save = useMut((v: { role: UserRole; permissions: Permission[] }) => api.put(`/shop/roles/${encodeURIComponent(v.role)}`, { permissions: v.permissions }), keys, { success: 'Permissions saved' });
  const reset = useMut((role: UserRole) => api.del(`/shop/roles/${encodeURIComponent(role)}`), keys, { success: 'Back to the default permissions' });

  if (roles.isLoading) return <div className="card"><div className="skeleton" style={{ height: 360, margin: 16 }} /></div>;
  if (roles.isError || !roles.data) return <div className="card"><div className="error-state" style={{ margin: 16 }}>Couldn’t load roles. <button className="btn btn-ghost btn-sm" onClick={() => roles.refetch()}>Try again</button></div></div>;

  const toggle = (role: string, p: Permission) => setDraft((d) => {
    const cur = d[role] ?? [];
    return { ...d, [role]: cur.includes(p) ? cur.filter((x) => x !== p) : [...cur, p] };
  });
  const dirty = (role: string) => {
    const a = [...(draft[role] ?? [])].sort().join(), b = [...(roles.data!.find((r) => r.role === role)?.permissions ?? [])].sort().join();
    return a !== b;
  };

  return (
    <div className="card table-wrap roles-matrix">
      <table className="table">
        <thead>
          <tr>
            <th style={{ minWidth: 240 }}>Permission</th>
            <th className="center">Owner</th>
            {roles.data.map((r) => (
              <th key={r.role} className="center">
                <div>{r.role}</div>
                <div className="small muted" style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 400 }}>{r.members} user{r.members === 1 ? '' : 's'}</div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {PERMISSION_GROUPS.map((g) => (
            <GroupRows key={g.module} module={g.module} perms={g.permissions} roles={roles.data!.map((r) => r.role)} draft={draft} toggle={toggle} />
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td className="small muted">Changes apply on each user’s next action.</td>
            <td />
            {roles.data.map((r) => (
              <td key={r.role} className="center" style={{ whiteSpace: 'nowrap' }}>
                {dirty(r.role) ? (
                  <button className="btn btn-primary btn-sm" disabled={save.isPending} onClick={() => save.mutate({ role: r.role, permissions: draft[r.role] ?? [] })}>{save.isPending && save.variables?.role === r.role && <Loader2 size={13} className="spin" />} Save</button>
                ) : r.customized ? (
                  <button className="btn btn-ghost btn-sm" title="Use the default permissions for this role" onClick={() => reset.mutate(r.role)}><RotateCcw size={13} /> Default</button>
                ) : <span className="small muted">Default</span>}
              </td>
            ))}
          </tr>
        </tfoot>
      </table>
      <div className="card-body small muted" style={{ borderTop: '1px solid var(--border)' }}>
        {Object.entries(ROLE_HINT).map(([r, h]) => <span key={r} style={{ marginRight: 16 }}><strong>{r}</strong>: {h}</span>)}
        <div style={{ marginTop: 6 }}>Settings, users and this matrix stay with the owner. Every change here is recorded in the audit log.</div>
      </div>
    </div>
  );
}

function GroupRows({ module, perms, roles, draft, toggle }: { module: string; perms: Permission[]; roles: UserRole[]; draft: Record<string, Permission[]>; toggle: (r: string, p: Permission) => void }) {
  return (
    <>
      <tr className="group-row"><td colSpan={roles.length + 2}>{module}</td></tr>
      {perms.map((p) => (
        <tr key={p}>
          <td>{PERMISSIONS[p]}</td>
          <td className="center"><Check size={16} style={{ color: 'var(--green-600)' }} aria-label="Allowed" /></td>
          {roles.map((r) => (
            <td key={r} className="center">
              {p === 'admin' ? <Lock size={14} className="muted" aria-label="Owner only" /> : (
                <input type="checkbox" className="checkbox" checked={(draft[r] ?? []).includes(p)} onChange={() => toggle(r, p)} aria-label={`${r}: ${PERMISSIONS[p]}`} />
              )}
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}
