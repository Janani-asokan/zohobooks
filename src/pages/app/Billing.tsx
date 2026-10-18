import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CreditCard, ShieldCheck, Users, GitBranch, FileText, Loader2, AlertTriangle, CheckCircle2, Phone } from 'lucide-react';
import { api, ApiError } from '@/api/client';
import { useAuth, useShopUser } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { Badge, PageHeader } from '@/components/ui';
import { fmtDate, money } from '@/lib/format';
import { daysUntil } from '@/lib/fy';

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
        prefill: { name: me.user.name, email: me.user.email }, theme: { color: '#1f7a4d' },
        handler: async (r: { razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string }) => {
          try {
            await api.post('/billing/razorpay/verify', { orderId: r.razorpay_order_id, paymentId: r.razorpay_payment_id, signature: r.razorpay_signature });
            toast('success', 'Payment successful', 'Your license has been extended.');
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

  if (!me.can('admin')) return <div className="page"><PageHeader title="Subscription" subtitle="Only the shop owner can manage the subscription." /></div>;

  return (
    <div className="page" style={{ maxWidth: 1080 }}>
      <PageHeader title="Subscription & billing" subtitle="Your Ledgerly Books software license." />
      {me.shop.licenseExpired && (
        <div className="row" style={{ gap: 10, padding: '14px 16px', borderRadius: 12, background: 'var(--red-50)', color: 'var(--red-600)', marginBottom: 16, fontWeight: 600 }}>
          <AlertTriangle size={18} /> Your license expired on {fmtDate(me.shop.licenseEnd)}. Renew to unlock your workspace — your data is safe.
        </div>
      )}
      <div className="grid-3-1" style={{ alignItems: 'start' }}>
        <div className="stack">
          <div className="card">
            <div className="card-header"><div><h3>Choose a plan</h3><p>Renewal extends from your current expiry date</p></div></div>
            <div className="card-body">
              <div className="radio-cards" style={{ gridTemplateColumns: `repeat(${data?.plans.length ?? 2}, minmax(0,1fr))` }}>
                {(data?.plans ?? []).map((p) => (
                  <div key={p.id} className={`radio-card ${chosen?.id === p.id ? 'active' : ''}`} onClick={() => setPlanId(p.id)} role="radio" aria-checked={chosen?.id === p.id} tabIndex={0}>
                    <span className="dot" />
                    <div>
                      <strong>{p.name} · {money(p.pricePerYear)}/yr</strong>
                      <span className="row" style={{ gap: 10, marginTop: 4 }}><Users size={12} /> {p.maxUsers} users <GitBranch size={12} /> {p.maxBranches} branches <FileText size={12} /> {p.maxInvoicesPerMonth ?? 'Unlimited'} invoices</span>
                    </div>
                  </div>
                ))}
              </div>
              <div className="row" style={{ gap: 10, marginTop: 16 }}>
                <span className="small muted">Term</span>
                <div className="segmented">{[1, 2, 3].map((y) => <button key={y} className={years === y ? 'active' : ''} onClick={() => setYears(y)}>{y} year{y > 1 ? 's' : ''}</button>)}</div>
                <strong style={{ marginLeft: 'auto', fontSize: 18 }}>{chosen ? money(chosen.pricePerYear * years) : '—'}</strong>
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
        <div className="card" style={{ padding: 20 }}>
          <div className="small muted">Current plan</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--ink-900)', marginTop: 2 }}>{me.shop.planName}</div>
          <div className="divider" />
          <div className="row between small"><span className="muted">Valid from</span><strong>{fmtDate(me.shop.licenseStart)}</strong></div>
          <div className="row between small" style={{ marginTop: 6 }}><span className="muted">Valid till</span><strong>{fmtDate(me.shop.licenseEnd)}</strong></div>
          <div style={{ marginTop: 14 }}>{days < 0 ? <Badge tone="red">Expired</Badge> : days <= 30 ? <Badge tone="amber">{days} days left</Badge> : <Badge tone="green"><CheckCircle2 size={12} /> {days} days left</Badge>}</div>
        </div>
      </div>
    </div>
  );
}
