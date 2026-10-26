import { useMemo, useState } from 'react';
import { Store, UserPlus, IndianRupee, AlarmClock, Plus, Mail, Phone, MapPin, RefreshCw, ArrowUpRight, Wand2, KeyRound, Loader2 } from 'lucide-react';
import { api, fieldErrors } from '@/api/client';
import { useMut, usePlans, usePlatformOverview } from '@/api/hooks';
import type { Shop } from '@/api/types';
import { useToast } from '@/context/ToastContext';
import { Badge, EmptyState, Field, Modal, PageHeader, Pagination, SearchInput, StatCard, Toggle, usePagination } from '@/components/ui';
import { BarChart, MeterList } from '@/components/charts';
import { addDays, EMAIL_RE, fmtDate, initials, money, moneyShort, todayISO } from '@/lib/format';
import { daysUntil } from '@/lib/fy';
import { isStrongPassword, PASSWORD_RULE } from '../../../shared/permissions';

function licenseStatus(s: Shop): 'Active' | 'Expiring' | 'Expired' | 'Trial' {
  const d = daysUntil(s.licenseEnd);
  if (d < 0) return 'Expired';
  if (s.planId === 'trial') return 'Trial';
  if (d <= 30) return 'Expiring';
  return 'Active';
}

const genPassword = () => {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  const arr = crypto.getRandomValues(new Uint32Array(10));
  return Array.from(arr, (n) => chars[n % chars.length]).join('') + (arr[0]! % 10);
};

const emptyForm = () => ({ shopName: '', ownerName: '', email: '', phone: '', city: '', planId: 'standard', years: 1, password: genPassword(), paymentReference: '' });

export default function SuperDashboard() {
  const overview = usePlatformOverview();
  const plans = usePlans();
  const toast = useToast();
  const shops = overview.data?.shops ?? [];
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<'all' | 'Active' | 'Expiring' | 'Expired' | 'Trial' | 'Inactive'>('all');
  const [createOpen, setCreateOpen] = useState(false);
  const [renew, setRenew] = useState<Shop | null>(null);
  const [renewPlan, setRenewPlan] = useState('standard');
  const [renewYears, setRenewYears] = useState(1);
  const [renewRef, setRenewRef] = useState('');
  const [form, setForm] = useState(emptyForm);
  const [touched, setTouched] = useState(false);
  const [serverErr, setServerErr] = useState<Record<string, string>>({});
  const [created, setCreated] = useState<{ email: string; password: string } | null>(null);

  const keys = [['platform']];
  const createShop = useMut((b: typeof form) => api.post<Shop>('/platform/shops', b), keys, { silentError: true });
  const toggle = useMut((v: { id: string; active: boolean }) => api.patch<Shop>(`/platform/shops/${v.id}`, { active: v.active }), keys, { success: (s) => (s.active ? `${s.shopName} activated` : `${s.shopName} deactivated — sessions ended`) });
  const renewMut = useMut((v: { id: string; planId: string; years: number; reference: string }) => api.post<Shop>(`/platform/shops/${v.id}/renew`, v), keys, { success: (s) => `License renewed till ${fmtDate(s.licenseEnd)}` });
  const [resetLink, setResetLink] = useState<{ to: string; url: string; error?: string } | null>(null);
  const resetOwner = useMut((id: string) => api.post<{ sentTo: string; emailed: boolean; emailError?: string; devResetUrl?: string }>(`/platform/shops/${id}/reset-owner-password`), []);
  const sendReset = (id: string) => resetOwner.mutate(id, {
    onSuccess: (r) => {
      if (r.emailed) toast('success', `Reset link emailed to ${r.sentTo}`);
      else if (r.devResetUrl) setResetLink({ to: r.sentTo, url: r.devResetUrl, error: r.emailError });
    },
  });

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const activeShops = shops.filter((s) => s.active && daysUntil(s.licenseEnd) >= 0);
  const newThisMonth = shops.filter((s) => new Date(s.createdAt) >= monthStart);
  const expiring = shops.filter((s) => { const d = daysUntil(s.licenseEnd); return d >= 0 && d <= 30; });
  const planMix = (plans.data ?? []).map((p) => ({ label: p.name, value: shops.filter((s) => s.planId === p.id).length }));

  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    return shops.filter((sh) => {
      if (s && ![sh.shopName, sh.ownerName, sh.email, sh.city, sh.phone].some((v) => v.toLowerCase().includes(s))) return false;
      if (filter === 'all') return true;
      if (filter === 'Inactive') return !sh.active;
      return licenseStatus(sh) === filter;
    });
  }, [shops, q, filter]);
  const pg = usePagination(rows, 7);

  const plan = plans.data?.find((p) => p.id === form.planId);
  const errors = {
    shopName: !form.shopName.trim() ? 'Shop name is required' : '',
    ownerName: !form.ownerName.trim() ? 'Owner name is required' : '',
    email: !EMAIL_RE.test(form.email) ? 'Enter a valid email' : '',
    phone: form.phone.replace(/\D/g, '').length < 10 ? 'Enter a valid phone number' : '',
    password: !isStrongPassword(form.password) ? PASSWORD_RULE : '',
  };
  const err = (k: keyof typeof errors) => (touched ? errors[k] : '') || serverErr[k] || '';

  const create = () => {
    setTouched(true);
    setServerErr({});
    if (Object.values(errors).some(Boolean)) return;
    createShop.mutate(form, {
      onSuccess: (s) => {
        setCreateOpen(false);
        setCreated({ email: s.email, password: form.password });
        setForm(emptyForm());
        setTouched(false);
      },
      onError: (e) => {
        const f = fieldErrors(e);
        setServerErr(Object.keys(f).length ? f : e.code === 'conflict' ? { email: e.message } : {});
        if (!Object.keys(f).length && e.code !== 'conflict') toast('error', e.message);
      },
    });
  };

  const filters: Array<[typeof filter, string]> = [['all', 'All'], ['Active', 'Active'], ['Expiring', 'Expiring'], ['Expired', 'Expired'], ['Trial', 'Trial'], ['Inactive', 'Deactivated']];
  const months = overview.data?.monthly ?? [];

  return (
    <div className="page">
      <PageHeader
        title="Platform overview"
        subtitle={`Here’s how the platform is doing · ${now.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}`}
        actions={<button className="btn btn-primary" onClick={() => { setServerErr({}); setTouched(false); setCreateOpen(true); }}><Plus size={16} /> New Shop Owner</button>}
      />

      <div className="stat-grid">
        <StatCard label="Total Active Shops" value={overview.isLoading ? '—' : activeShops.length} icon={Store} tone="blue" foot={<>of {shops.length} registered workspaces</>} />
        <StatCard label="New Customers This Month" value={overview.isLoading ? '—' : newThisMonth.length} icon={UserPlus} tone="green" foot={<span className="trend-up"><ArrowUpRight size={14} /> onboarded since {monthStart.toLocaleString('en-IN', { day: 'numeric', month: 'short' })}</span>} />
        <StatCard label="Total Revenue (Subscriptions)" value={moneyShort(overview.data?.totalRevenue ?? 0)} icon={IndianRupee} tone="violet" foot={<>Lifetime license billing · {money(overview.data?.totalRevenue ?? 0)}</>} />
        <StatCard label="Expiring Licenses" value={overview.isLoading ? '—' : expiring.length} icon={AlarmClock} tone="amber" foot={<>Within the next 30 days</>} />
      </div>

      <div className="grid-3-1 mt-16">
        <div className="card">
          <div className="card-header"><div><h3>Subscription revenue</h3><p>Licenses billed (new &amp; renewals), last 6 months</p></div></div>
          <div className="card-body">
            <BarChart labels={months.map((m) => new Date(m.month + '-01').toLocaleString('en-IN', { month: 'short' }))} series={[{ name: 'Subscription revenue', values: months.map((m) => m.revenue) }]} format={moneyShort} />
          </div>
        </div>
        <div className="card">
          <div className="card-header"><div><h3>License mix</h3><p>Shops by plan</p></div></div>
          <div className="card-body">
            <MeterList rows={planMix} format={(n) => `${n} shop${n === 1 ? '' : 's'}`} />
            <div className="divider" />
            <div className="small muted">Renewals due</div>
            <div className="stack" style={{ gap: 8, marginTop: 10 }}>
              {expiring.slice(0, 4).map((s) => (
                <div key={s.id} className="row between small">
                  <span style={{ fontWeight: 600, color: 'var(--ink-800)' }}>{s.shopName}</span>
                  <Badge tone="amber">{daysUntil(s.licenseEnd)}d left</Badge>
                </div>
              ))}
              {expiring.length === 0 && <span className="small muted">No renewals due this month.</span>}
            </div>
          </div>
        </div>
      </div>

      <div className="card mt-16">
        <div className="card-header"><div><h3>Registered shop owners</h3><p>Workspaces, licenses and access</p></div></div>
        <div className="toolbar">
          <div className="toolbar-left"><SearchInput value={q} onChange={(v) => { setQ(v); pg.setPage(1); }} placeholder="Search shop, owner, email, city…" /></div>
          <div className="toolbar-right">
            <div className="segmented">
              {filters.map(([v, l]) => <button key={v} className={filter === v ? 'active' : ''} onClick={() => { setFilter(v); pg.setPage(1); }}>{l}</button>)}
            </div>
          </div>
        </div>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Shop</th><th>Contact</th><th>Plan</th><th>License status</th><th>Valid till</th><th>Workspace</th><th /></tr></thead>
            <tbody>
              {overview.isLoading && [0, 1, 2].map((i) => <tr key={i}><td colSpan={7}><div className="skeleton" style={{ height: 34 }} /></td></tr>)}
              {pg.slice.map((s) => {
                const st = licenseStatus(s);
                const d = daysUntil(s.licenseEnd);
                return (
                  <tr key={s.id} style={!s.active ? { opacity: 0.6 } : undefined}>
                    <td><div className="name-cell"><span className="avatar">{initials(s.shopName)}</span><div><div className="title">{s.shopName}</div><div className="sub">{s.ownerName} · {s.users} user{s.users === 1 ? '' : 's'}</div></div></div></td>
                    <td>
                      <div className="small row" style={{ gap: 6 }}><Mail size={13} className="muted" /> {s.email}</div>
                      <div className="small row muted" style={{ gap: 6, marginTop: 2 }}><Phone size={13} /> {s.phone} {s.city && <><MapPin size={13} style={{ marginLeft: 6 }} /> {s.city}</>}</div>
                    </td>
                    <td><span className="chip">{s.planName}</span></td>
                    <td><Badge>{st}</Badge></td>
                    <td><div className="strong small">{fmtDate(s.licenseEnd)}</div><div className="muted">{d >= 0 ? `${d} days left` : `Expired ${-d} days ago`}</div></td>
                    <td><Toggle checked={s.active} onChange={(v) => toggle.mutate({ id: s.id, active: v })} size="sm" tone="success" label={<span className="small">{s.active ? 'Active' : 'Inactive'}</span>} /></td>
                    <td className="num" style={{ whiteSpace: 'nowrap' }}>
                      <button className="icon-btn" title="Email owner a password-reset link" onClick={() => sendReset(s.id)}><KeyRound size={15} /></button>
                      <button className="btn btn-secondary btn-sm" onClick={() => { setRenew(s); setRenewPlan(s.planId === 'trial' ? 'standard' : s.planId); setRenewYears(1); setRenewRef(''); }}><RefreshCw size={14} /> Renew</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!overview.isLoading && rows.length === 0 && <EmptyState icon={Store} title="No shops found" text="Try a different search or filter." />}
        </div>
        <Pagination {...pg} />
      </div>

      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="Create shop owner" subtitle="Sets up a new, isolated workspace and the owner’s login." size="lg"
        footer={<><button className="btn btn-secondary" onClick={() => setCreateOpen(false)}>Cancel</button><button className="btn btn-primary" onClick={create} disabled={createShop.isPending}>{createShop.isPending && <Loader2 size={15} className="spin" />} Create workspace</button></>}>
        <div className="section-title">Business</div>
        <div className="form-grid">
          <Field label="Shop / business name" required error={err('shopName')}><input className={`input ${err('shopName') ? 'invalid' : ''}`} value={form.shopName} onChange={(e) => setForm({ ...form, shopName: e.target.value })} placeholder="e.g. Aravind Computer Store" autoFocus /></Field>
          <Field label="City"><input className="input" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} placeholder="e.g. Chennai" /></Field>
        </div>
        <div className="section-title mt-24">Owner account</div>
        <div className="form-grid">
          <Field label="Owner name" required error={err('ownerName')}><input className={`input ${err('ownerName') ? 'invalid' : ''}`} value={form.ownerName} onChange={(e) => setForm({ ...form, ownerName: e.target.value })} /></Field>
          <Field label="Phone" required error={err('phone')}><input className={`input ${err('phone') ? 'invalid' : ''}`} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="+91 98xxx xxxxx" /></Field>
          <Field label="Login email" required error={err('email')}><input className={`input ${err('email') ? 'invalid' : ''}`} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="owner@business.com" /></Field>
          <Field label="Temporary password" required error={err('password')} hint="The owner must change it on first sign-in">
            <div className="input-group trail-pad">
              <input className={`input ${err('password') ? 'invalid' : ''}`} style={{ paddingLeft: 12, fontFamily: 'ui-monospace, Menlo, monospace' }} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
              <span className="trail"><button type="button" className="icon-btn" title="Generate a strong password" onClick={() => setForm({ ...form, password: genPassword() })}><Wand2 size={15} /></button></span>
            </div>
          </Field>
        </div>
        <div className="section-title mt-24">Software license</div>
        <div className="radio-cards" style={{ gridTemplateColumns: `repeat(${plans.data?.length ?? 3}, minmax(0,1fr))` }}>
          {(plans.data ?? []).map((p) => (
            <div key={p.id} className={`radio-card ${form.planId === p.id ? 'active' : ''}`} onClick={() => setForm({ ...form, planId: p.id })}>
              <span className="dot" />
              <div>
                <strong>{p.name}</strong>
                <span>{p.trialDays ? `${p.trialDays} days free` : `${money(p.pricePerYear)}/yr`} · {p.maxUsers} users · {p.maxBranches} branch{p.maxBranches > 1 ? 'es' : ''}</span>
              </div>
            </div>
          ))}
        </div>
        {plan && !plan.trialDays && (
          <div className="form-grid mt-16">
            <Field label="Term">
              <select className="select" value={form.years} onChange={(e) => setForm({ ...form, years: Number(e.target.value) })}>{[1, 2, 3].map((y) => <option key={y} value={y}>{y} year{y > 1 ? 's' : ''} · {money(plan.pricePerYear * y)}</option>)}</select>
            </Field>
            <Field label="Payment reference" hint="Cheque / UTR number for the license fee"><input className="input" value={form.paymentReference} onChange={(e) => setForm({ ...form, paymentReference: e.target.value })} /></Field>
          </div>
        )}
        <p className="small muted" style={{ marginTop: 12 }}>License valid from today until <strong>{fmtDate(addDays(todayISO(), plan?.trialDays ?? 365 * form.years))}</strong>.</p>
      </Modal>

      <Modal open={!!created} onClose={() => setCreated(null)} title="Workspace created" subtitle="Share these sign-in details with the owner over a secure channel."
        footer={<button className="btn btn-primary" onClick={() => { navigator.clipboard?.writeText(`Email: ${created?.email}\nTemporary password: ${created?.password}`); toast('success', 'Copied to clipboard'); }}>Copy details</button>}>
        <div className="card" style={{ padding: 16, boxShadow: 'none', background: 'var(--ink-50)' }}>
          <div className="small muted">Email</div><div className="strong">{created?.email}</div>
          <div className="small muted" style={{ marginTop: 10 }}>Temporary password</div><div className="strong" style={{ fontFamily: 'ui-monospace, Menlo, monospace' }}>{created?.password}</div>
        </div>
        <p className="small muted" style={{ marginTop: 12 }}>This password is shown only once. The owner will be asked to choose their own on first sign-in.</p>
      </Modal>

      <Modal open={!!resetLink} onClose={() => setResetLink(null)} title="Email not sent" subtitle={resetLink ? `Share this reset link with ${resetLink.to} on WhatsApp or by phone. It works for 24 hours.` : ''}
        footer={<button className="btn btn-primary" onClick={() => { navigator.clipboard?.writeText(resetLink?.url ?? '').then(() => toast('success', 'Link copied'), () => {}); }}>Copy link</button>}>
        <div className="card" style={{ padding: 12, boxShadow: 'none', background: 'var(--ink-50)', wordBreak: 'break-all', fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 12.5 }}>{resetLink?.url}</div>
        <p className="small muted" style={{ marginTop: 12 }}>{resetLink?.error ? `The email provider said: ${resetLink.error}` : 'No email provider is set up on the server.'} Check Configuration → Email.</p>
      </Modal>

      <Modal open={!!renew} onClose={() => setRenew(null)} title="Renew license" subtitle={renew ? `${renew.shopName} · currently valid till ${fmtDate(renew.licenseEnd)}` : ''}
        footer={<><button className="btn btn-secondary" onClick={() => setRenew(null)}>Cancel</button><button className="btn btn-primary" disabled={renewMut.isPending} onClick={() => renew && renewMut.mutate({ id: renew.id, planId: renewPlan, years: renewYears, reference: renewRef }, { onSuccess: () => setRenew(null) })}>Record payment &amp; renew</button></>}>
        <div className="radio-cards">
          {(plans.data ?? []).filter((p) => !p.trialDays).map((p) => (
            <div key={p.id} className={`radio-card ${renewPlan === p.id ? 'active' : ''}`} onClick={() => setRenewPlan(p.id)}>
              <span className="dot" /><div><strong>{p.name}</strong><span>{money(p.pricePerYear)}/yr · {p.maxUsers} users</span></div>
            </div>
          ))}
        </div>
        <div className="form-grid mt-16">
          <Field label="Term"><select className="select" value={renewYears} onChange={(e) => setRenewYears(Number(e.target.value))}>{[1, 2, 3].map((y) => <option key={y} value={y}>{y} year{y > 1 ? 's' : ''}</option>)}</select></Field>
          <Field label="Payment reference"><input className="input" value={renewRef} onChange={(e) => setRenewRef(e.target.value)} placeholder="UTR / cheque no." /></Field>
        </div>
        {renew && (
          <p className="small muted" style={{ marginTop: 14 }}>
            Amount: <strong>{money((plans.data?.find((p) => p.id === renewPlan)?.pricePerYear ?? 0) * renewYears)}</strong> · New expiry: <strong>{fmtDate(addDays(daysUntil(renew.licenseEnd) > 0 ? renew.licenseEnd : todayISO(), 365 * renewYears))}</strong>
          </p>
        )}
      </Modal>
    </div>
  );
}
