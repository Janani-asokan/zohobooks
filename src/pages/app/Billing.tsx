import { SalesPanel } from '@/components/SalesPanel';
import { isPaidShop } from '../../../shared/support';
import '@/styles/sales.css';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CreditCard, ShieldCheck, Loader2, AlertTriangle, CheckCircle2, Phone } from 'lucide-react';
import { api, ApiError } from '@/api/client';
import { useAuth, useShopUser } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { Badge, PageHeader } from '@/components/ui';
import { fmtDate, money } from '@/lib/format';
import { daysUntil } from '@/lib/fy';
import { LicenseCard, PlanLicenseCard } from '@/components/LicenseCard';
import { LicenseIncludes, licenseOf } from '@/components/LicenseWelcome';
import '@/styles/license.css';

interface BillingInfo {
  planId: string; planName: string; licenseStart: string; licenseEnd: string; onlinePayments: boolean;
  plans: Array<{ id: string; name: string; pricePerYear: number; maxUsers: number; maxBranches: number; maxInvoicesPerMonth: number | null }>;
  payments: Array<{ id: string; amount: number; years: number; planId: string; method: string; status: string; paidAt: string | null; createdAt: string }>;
}

declare global {
  interface Window { Razorpay?: new (opts: Record<string, unknown>) => { open: () => void } }
}

const loadRazorpay = () =>
  new Promise<void>((resolve, reject) => {
    if (window.Razorpay) return resolve();
    const s = document.createElement('script');
    s.src = 'https://checkout.razorpay.com/v1/checkout.js';
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Could not load the payment window'));
    document.body.appendChild(s);
  });

export default function Billing() {
  const me = useShopUser();
  const { refresh } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ['billing'], queryFn: () => api.get<BillingInfo>('/billing'), enabled: me.can('admin') });
  const [planId, setPlanId] = useState('');
  const [years, setYears] = useState(1);
  const [busy, setBusy] = useState(false);
  const days = daysUntil(me.shop.licenseEnd);
  const chosen = data?.plans.find((p) => p.id === (planId || (data.planId === 'trial' ? 'standard' : data.planId)));

  const pay = async () => {
    if (!chosen) return;
    setBusy(true);
    try {
      const order = await api.post<{ orderId: string; amount: number; keyId: string; name: string; description: string }>('/billing/razorpay/order', { planId: chosen.id, years });
      await loadRazorpay();
      new window.Razorpay!({
        key: order.keyId, order_id: order.orderId, amount: order.amount, currency: 'INR', name: order.name, description: order.description,
        prefill: { name: me.user.name, email: me.user.email }, theme: { color: '#0f5a5e' },
        handler: async (r: { razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string }) => {
          try {
            await api.post('/billing/razorpay/verify', { orderId: r.razorpay_order_id, paymentId: r.razorpay_payment_id, signature: r.razorpay_signature });
            toast('success', 'Payment successful', 'Your licence card is ready.');
            await refresh();
            qc.invalidateQueries({ queryKey: ['billing'] });
          } catch (e) {
            toast('error', e instanceof ApiError ? e.message : 'Payment verification failed');
          }
        },
        modal: { ondismiss: () => setBusy(false) },
      }).open();
    } catch (e) {
      toast('error', e instanceof ApiError ? e.message : (e as Error).message);
      setBusy(false);
    }
  };

  // On the trial or after the license ends, the sales team helps choose a plan (customer care is for paid plans).
  const sales = !isPaidShop(me.shop) && (
    <section className="card card-body" style={{ marginBottom: 16 }}>
      <SalesPanel source="app" shop={{ name: me.shop.name, userName: me.user.name, phone: '', renew: true }} />
    </section>
  );
  if (!me.can('admin')) return <div className="page"><PageHeader title="Subscription" subtitle="Only the shop owner can manage the subscription." />{sales}</div>;

  return (
    <div className="page" style={{ maxWidth: 1080 }}>
      <PageHeader title="Subscription & billing" subtitle="Your Corpus360 software license." />
      {me.shop.licenseExpired && (
        <div className="row" style={{ gap: 10, padding: '14px 16px', borderRadius: 8, background: 'var(--red-50)', color: 'var(--red-600)', marginBottom: 16, fontWeight: 600 }}>
          <AlertTriangle size={18} /> Your license expired on {fmtDate(me.shop.licenseEnd)}. Renew to unlock your workspace — your data is safe.
        </div>
      )}
      {/* The licence, as a card the business owns: plan edition, licensed-to name, number, dates and add-ons. */}
      <section className="card card-body" style={{ marginBottom: 16 }}>
        <div className="lic-panel">
          <LicenseCard l={licenseOf(me)} />
          <div className="stack" style={{ gap: 10 }}>
            <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              {days < 0 ? <Badge tone="red">Expired on {fmtDate(me.shop.licenseEnd)}</Badge> : days <= 30 ? <Badge tone="amber">{days} days left</Badge> : <Badge tone="green"><CheckCircle2 size={12} /> Active · {days} days left</Badge>}
            </div>
            <div className="lic-facts">
              <div><small>Edition</small><strong>Corpus360 {me.shop.planName}</strong></div>
              <div><small>Licensed to</small><strong>{me.shop.name}</strong></div>
              <div><small>Valid</small><strong>{fmtDate(me.shop.licenseStart)} – {fmtDate(me.shop.licenseEnd)}</strong></div>
              <div><small>Seats</small><strong>{me.shop.limits.users} staff logins · {me.shop.limits.branches} {me.shop.limits.branches === 1 ? 'branch' : 'branches'}</strong></div>
              <div><small>Add-ons</small><strong>{Object.keys(me.shop.features).length || 'None yet'}</strong></div>
            </div>
          </div>
        </div>
        <div className="divider" />
        <LicenseIncludes l={licenseOf(me)} />
      </section>
      {sales}
      <div>
        <div className="stack">
          <div className="card">
            <div className="card-header"><div><h3>Choose a plan</h3><p>Renewal extends from your current expiry date</p></div></div>
            <div className="card-body">
              <div className="lic-picks" role="radiogroup" aria-label="Plans">
                {(data?.plans ?? []).map((p) => (
                  <PlanLicenseCard key={p.id} plan={p} shopId={me.shop.id} shopName={me.shop.name} selected={chosen?.id === p.id} current={data?.planId === p.id && !me.shop.licenseExpired} onSelect={() => setPlanId(p.id)} />
                ))}
              </div>
              <div className="row" style={{ gap: 10, marginTop: 22 }}>
                <span className="small muted">Term</span>
                <div className="segmented">{[1, 2, 3].map((y) => <button key={y} className={years === y ? 'active' : ''} onClick={() => setYears(y)}>{y} year{y > 1 ? 's' : ''}</button>)}</div>
                <strong style={{ marginLeft: 'auto', fontSize: 16 }}>{chosen ? money(chosen.pricePerYear * years) : '—'}</strong>
              </div>
            </div>
            <div className="card-footer" style={{ justifyContent: 'space-between' }}>
              {data?.onlinePayments ? (
                <><span className="small muted row" style={{ gap: 6 }}><ShieldCheck size={14} /> UPI, cards &amp; netbanking via Razorpay</span><button className="btn btn-primary" disabled={!chosen || busy} onClick={pay}>{busy ? <Loader2 size={15} className="spin" /> : <CreditCard size={15} />} Pay &amp; renew</button></>
              ) : (
                <span className="small muted row" style={{ gap: 6 }}><Phone size={14} /> Online payment isn’t enabled yet — contact your service provider to renew. They’ll record the payment and your license updates instantly.</span>
              )}
            </div>
          </div>
          <div className="card table-wrap">
            <div className="card-header"><h3>Payment history</h3></div>
            <table className="table">
              <thead><tr><th>Date</th><th>Plan</th><th>Method</th><th>Status</th><th className="num">Amount</th></tr></thead>
              <tbody>
                {(data?.payments ?? []).map((p) => <tr key={p.id}><td>{fmtDate(p.paidAt ?? p.createdAt)}</td><td>{data?.plans.find((x) => x.id === p.planId)?.name ?? p.planId} · {p.years}y</td><td>{p.method === 'razorpay' ? 'Online' : 'Recorded by provider'}</td><td><Badge tone={p.status === 'paid' ? 'green' : 'amber'}>{p.status}</Badge></td><td className="num strong">{money(p.amount)}</td></tr>)}
                {data?.payments.length === 0 && <tr><td colSpan={5} className="muted" style={{ textAlign: 'center', padding: 20 }}>No payments yet.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
