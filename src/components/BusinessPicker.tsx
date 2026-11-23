import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useBranches, useOrgs } from '@/api/hooks';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { Field } from '@/components/ui';

/**
 * Where a page lands after switching business: the same screen in the other business. A screen that shows one
 * record (an invoice, a bill) goes back to its list, since that record belongs to the old business.
 */
export function pathAfterSwitch(pathname: string) {
  const parts = pathname.split('/').filter(Boolean);
  const idAt = parts.findIndex((p) => /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(p));
  return '/' + (idAt >= 0 ? parts.slice(0, idAt) : parts).join('/');
}

/** Switches to another business and stays on the same kind of screen (the page reloads its data for that business). */
export function useSwitchBusiness() {
  const { switchOrg } = useAuth();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const toast = useToast();
  return async (id: string, name: string) => {
    try {
      await switchOrg(id);
      navigate(pathAfterSwitch(pathname), { replace: true });
      toast('success', `Now working in ${name}`, 'Items, customers, stock and payments are this business’s own.');
    } catch (e) { toast('error', (e as Error).message); }
  };
}

/**
 * "Billing from" (or "Stock goes into"): one box that lists this business's stores and warehouses and, for an owner
 * with more than one business (a retail shop and a vegetable shop, say), the other businesses too. Picking a branch
 * sets where stock comes from; picking another business switches to it and keeps this screen open there.
 */
export function BusinessPicker({ label, hint, branchId, onBranch, dirty, bare }: {
  label: string; hint?: string; branchId: string; onBranch: (id: string) => void; dirty?: boolean;
  /** Just the box, without the label (for tight toolbars like the POS). */
  bare?: boolean;
}) {
  const branches = useBranches().data ?? [];
  const orgs = (useOrgs().data ?? []).filter((o) => o.active);
  const { me } = useAuth();
  const switchTo = useSwitchBusiness();
  const [busy, setBusy] = useState(false);
  const here = me?.kind === 'user' ? me.shop.name : '';
  const stores = branches.filter((b) => (b.kind ?? 'store') === 'store');
  const warehouses = branches.filter((b) => b.kind === 'warehouse');
  const others = orgs.filter((o) => !o.current);
  const pick = async (v: string) => {
    if (!v.startsWith('org:')) return onBranch(v);
    const o = others.find((x) => x.id === v.slice(4));
    if (!o) return;
    if (dirty && !window.confirm(`Switch to ${o.name}? This bill isn’t saved: its items belong to ${here}, so you start a fresh one in ${o.name}.`)) return;
    setBusy(true);
    await switchTo(o.id, o.name);
    setBusy(false);
  };
  const single = !others.length && branches.length <= 1;
  if (single) return null;
  const box = (
    <select className="select" value={branchId} disabled={busy} onChange={(e) => void pick(e.target.value)} aria-label={label}>
      <optgroup label={others.length ? `${here}: stores` : 'Stores'}>
        {stores.map((b) => <option key={b.id} value={b.id}>{b.name}{b.isPrimary ? ' (main)' : ''}</option>)}
      </optgroup>
      {warehouses.length > 0 && (
        <optgroup label={others.length ? `${here}: warehouses` : 'Warehouses'}>
          {warehouses.map((b) => <option key={b.id} value={b.id}>{b.name} · warehouse</option>)}
        </optgroup>
      )}
      {others.length > 0 && (
        <optgroup label="Your other businesses">
          {others.map((o) => <option key={o.id} value={`org:${o.id}`} disabled={o.licenseExpired}>{o.name}{o.licenseExpired ? ' (license expired)' : ''} →</option>)}
        </optgroup>
      )}
    </select>
  );
  return bare ? box : <Field label={label} hint={hint}>{box}</Field>;
}
