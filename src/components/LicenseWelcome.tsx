import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Printer, Sparkles } from 'lucide-react';
import { Modal } from '@/components/ui';
import { fmtDate } from '@/lib/format';
import { LicenseCard, ownedAddOns, type LicenseInfo } from './LicenseCard';
import { useShopUser } from '@/context/AuthContext';
import '@/styles/license.css';

/** Everything every licence includes, whatever add-ons come with it. */
export const CORE_INCLUDES = ['GST invoices, bill of supply and credit notes', 'Customers, payments received and dues', 'Items, stock and low-stock alerts', 'Sales, profit and GST reports (GSTR-1, GSTR-3B)', 'Banking and cash', 'WhatsApp sharing, UPI QR and printing', 'Staff logins with roles'];

export const licenseOf = (me: ReturnType<typeof useShopUser>): LicenseInfo => ({
  shopId: me.shop.id, shopName: me.shop.name, planId: me.shop.planId, planName: me.shop.planName, licenseStart: me.shop.licenseStart, licenseEnd: me.shop.licenseEnd,
  expired: me.shop.licenseExpired, users: me.shop.limits.users, branches: me.shop.limits.branches, features: me.shop.features,
});

/** What the licence includes: the core, then each add-on it owns. */
export function LicenseIncludes({ l }: { l: LicenseInfo }) {
  const addOns = ownedAddOns(l.features);
  return (
    <div className="lic-includes">
      <h4>Your {l.planName} licence includes</h4>
      <ul>
        <li><CheckCircle2 size={14} color="var(--green-600)" /> {l.users} staff logins and {l.branches} {l.branches === 1 ? 'branch' : 'branches'}</li>
        {CORE_INCLUDES.map((c) => <li key={c}><CheckCircle2 size={14} color="var(--green-600)" /> {c}</li>)}
        {addOns.map((a) => <li key={a.key}><Sparkles size={14} color="var(--brand-600)" /> <span><strong>{a.name}</strong>{a.level ? ` · ${a.level}` : ''} (add-on)</span></li>)}
      </ul>
    </div>
  );
}

const COLORS = ['#0f5a5e', '#1f8a86', '#f2b84b', '#e2725b', '#7c9a6d', '#c9a24b'];

/**
 * The moment a licence starts or is renewed (paid online, or recorded by the sales team): the card rises in with a
 * little confetti, like receiving a membership card. Shown once per licence period to the owner, on any screen.
 */
export function LicenseWelcome() {
  const me = useShopUser();
  const l = licenseOf(me);
  const key = `c360.license.seen.${me.shop.id}`;
  const stamp = `${l.planId}|${l.licenseEnd}`;
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!me.can('admin') || l.planId === 'trial' || l.expired) return;
    let seen: string | null = null;
    try { seen = localStorage.getItem(key); } catch { return; }
    if (seen !== stamp) setOpen(true);
  }, [stamp]); // eslint-disable-line react-hooks/exhaustive-deps
  const close = () => { try { localStorage.setItem(key, stamp); } catch { /* */ } setOpen(false); };
  const bits = useMemo(() => Array.from({ length: 36 }, (_, i) => ({ left: `${(i * 97) % 100}%`, delay: `${(i % 9) * 0.12}s`, bg: COLORS[i % COLORS.length] })), []);
  if (!open) return null;
  return (
    <Modal open onClose={close} title="Your licence is active" subtitle="Here is your Corpus360 licence card." size="lg"
      footer={<><button className="btn btn-secondary" onClick={() => window.print()}><Printer size={15} /> Print licence</button><button className="btn btn-primary" onClick={close}>Start using it</button></>}>
      <div className="lic-welcome">
        <div className="lic-confetti" aria-hidden="true">{bits.map((b, i) => <i key={i} style={{ left: b.left, animationDelay: b.delay, background: b.bg }} />)}</div>
        <LicenseCard l={l} />
        <h2>Welcome to Corpus360 {l.planName}</h2>
        <div className="muted">{l.shopName} is licensed till <strong>{fmtDate(l.licenseEnd)}</strong>. Thank you for choosing us.</div>
        <div style={{ textAlign: 'left', width: '100%', maxWidth: 520 }}><LicenseIncludes l={l} /></div>
      </div>
    </Modal>
  );
}
