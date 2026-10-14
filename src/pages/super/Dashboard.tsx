import { useMemo, useState } from 'react';
import { Store, UserPlus, IndianRupee, AlarmClock, Plus, Mail, Phone, MapPin, RefreshCw, ArrowUpRight, Copy } from 'lucide-react';
import { usePlatform } from '@/context/StoreContext';
import { useToast } from '@/context/ToastContext';
import { Badge, Field, Modal, PageHeader, Pagination, SearchInput, StatCard, Toggle, usePagination, EmptyState } from '@/components/ui';
import { BarChart, MeterList } from '@/components/charts';
import { addDays, EMAIL_RE, fmtDate, initials, money, moneyShort, todayISO, uid } from '@/lib/format';
import { daysUntil } from '@/lib/fy';
import { PLAN_DAYS } from '@/lib/seed';
import type { LicensePlan, Shop } from '@/lib/types';

const PLAN_FEE: Record<LicensePlan, number> = { Trial: 0, '1 Year': 11999, '2 Years': 21999, '3 Years': 29999 };

function licenseStatus(s: Shop): 'Active' | 'Expiring' | 'Expired' | 'Trial' {
  const d = daysUntil(s.licenseEnd);
  if (d < 0) return 'Expired';
  if (s.plan === 'Trial') return 'Trial';
  if (d <= 30) return 'Expiring';
  return 'Active';
}

const emptyForm = { shopName: '', ownerName: '', email: '', phone: '', city: '', plan: '1 Year' as LicensePlan, password: '' };

export default function SuperDashboard() {
  const { shops, provisionShop, updatePlatform } = usePlatform();
  const toast = useToast();
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<'all' | 'Active' | 'Expiring' | 'Expired' | 'Trial' | 'Inactive'>('all');
  const [createOpen, setCreateOpen] = useState(false);
  const [renew, setRenew] = useState<Shop | null>(null);
  const [renewPlan, setRenewPlan] = useState<LicensePlan>('1 Year');
  const [form, setForm] = useState(emptyForm);
  const [touched, setTouched] = useState(false);

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const activeShops = shops.filter((s) => s.active && daysUntil(s.licenseEnd) >= 0);
  const newThisMonth = shops.filter((s) => new Date(s.createdAt) >= monthStart);
  const revenue = shops.reduce((t, s) => t + s.subscriptionFee, 0);
  const expiring = shops.filter((s) => {
    const d = daysUntil(s.licenseEnd);
    return d >= 0 && d <= 30;
  });

  const months = useMemo(() => {
    return Array.from({ length: 6 }, (_, i) => {
      const d = new Date(now.getFullYear(), now.getMonth() - 5 + i, 1);
      const end = new Date(d.getFullYear(), d.getMonth() + 1, 1);
      const inMonth = shops.filter((s) => {
        const c = new Date(s.licenseStart);
        return c >= d && c < end;
      });
      return { label: d.toLocaleString('en-IN', { month: 'short' }), revenue: inMonth.reduce((t, s) => t + s.subscriptionFee, 0) };
    });
  }, [shops]);

  const planMix = (['1 Year', '2 Years', '3 Years', 'Trial'] as LicensePlan[]).map((p) => ({ label: p, value: shops.filter((s) => s.plan === p).length }));

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

  const errors = {
    shopName: !form.shopName.trim() ? 'Shop name is required' : '',
    ownerName: !form.ownerName.trim() ? 'Owner name is required' : '',
    email: !EMAIL_RE.test(form.email) ? 'Enter a valid email' : shops.some((s) => s.email.toLowerCase() === form.email.toLowerCase()) ? 'Email already registered' : '',
    phone: form.phone.replace(/\D/g, '').length < 10 ? 'Enter a valid phone number' : '',
    password: form.password.length < 6 ? 'Min. 6 characters' : '',
  };
  const hasErr = Object.values(errors).some(Boolean);

  const create = () => {
    setTouched(true);
    if (hasErr) return;
    const start = todayISO();
    provisionShop({
      id: uid('shop_'),
      shopName: form.shopName.trim(),
      ownerName: form.ownerName.trim(),
      email: form.email.trim().toLowerCase(),
      password: form.password,
      phone: form.phone,
      city: form.city.trim(),
      plan: form.plan,
      licenseStart: start,
      licenseEnd: addDays(start, PLAN_DAYS[form.plan]),
      subscriptionFee: PLAN_FEE[form.plan],
      active: true,
      createdAt: start,
    });
    toast('success', 'Shop owner created', `${form.shopName} can now sign in with ${form.email}.`);
    setCreateOpen(false);
    setForm(emptyForm);
    setTouched(false);
  };

  const doRenew = () => {
    if (!renew) return;
    updatePlatform((d) => {
      const s = d.shops.find((x) => x.id === renew.id)!;
      const base = daysUntil(s.licenseEnd) > 0 ? s.licenseEnd : todayISO();
      s.licenseEnd = addDays(base, PLAN_DAYS[renewPlan]);
      s.plan = renewPlan;
      s.subscriptionFee += PLAN_FEE[renewPlan];
    });
    toast('success', 'License renewed', `${renew.shopName} extended by ${renewPlan}.`);
    setRenew(null);
  };

  const setActive = (s: Shop, active: boolean) => {
    updatePlatform((d) => {
      d.shops.find((x) => x.id === s.id)!.active = active;
    });
    toast(active ? 'success' : 'info', active ? 'Workspace activated' : 'Workspace deactivated', s.shopName);
  };

  const filters: Array<[typeof filter, string]> = [
    ['all', 'All'],
    ['Active', 'Active'],
    ['Expiring', 'Expiring'],
    ['Expired', 'Expired'],
    ['Trial', 'Trial'],
    ['Inactive', 'Deactivated'],
  ];

  return (
    <div className="page">
      <PageHeader
        title="Good to see you 👋"
        subtitle={`Here’s how the platform is doing · ${now.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}`}
        actions={
          <button className="btn btn-primary" onClick={() => setCreateOpen(true)}>
            <Plus size={16} /> New Shop Owner
          </button>
        }
      />

      <div className="stat-grid">
        <StatCard label="Total Active Shops" value={activeShops.length} icon={Store} tone="blue" foot={<>of {shops.length} registered workspaces</>} />
        <StatCard
          label="New Customers This Month"
          value={newThisMonth.length}
          icon={UserPlus}
          tone="green"
          foot={
            <span className="trend-up">
              <ArrowUpRight size={14} /> onboarded since {monthStart.toLocaleString('en-IN', { day: 'numeric', month: 'short' })}
            </span>
          }
        />
        <StatCard label="Total Revenue (Subscriptions)" value={moneyShort(revenue)} icon={IndianRupee} tone="violet" foot={<>Lifetime license billing · {money(revenue)}</>} />
        <StatCard label="Expiring Licenses" value={expiring.length} icon={AlarmClock} tone="amber" foot={<>Within the next 30 days</>} />
      </div>

      <div className="grid-3-1 mt-16">
        <div className="card">
          <div className="card-header">
            <div>
              <h3>Subscription revenue</h3>
              <p>New &amp; renewed licenses billed, last 6 months</p>
            </div>
          </div>
          <div className="card-body">
            <BarChart labels={months.map((m) => m.label)} series={[{ name: 'Subscription revenue', values: months.map((m) => m.revenue) }]} format={moneyShort} />
          </div>
        </div>
        <div className="card">
          <div className="card-header">
            <div>
              <h3>License mix</h3>
              <p>Shops by plan</p>
            </div>
          </div>
          <div className="card-body">
            <MeterList rows={planMix} format={(n) => `${n} shop${n === 1 ? '' : 's'}`} />
            <div className="divider" />
            <div className="small muted">Renewals due</div>
            <div className="stack" style={{ gap: 8, marginTop: 10 }}>
              {expiring.slice(0, 3).map((s) => (
                <div key={s.id} className="row between small">
                  <span style={{ fontWeight: 600, color: 'var(--ink-800)' }}>{s.shopName}</span>
                  <Badge tone="amber">{daysUntil(s.licenseEnd)}d left</Badge>
                </div>
              ))}
              {expiring.length === 0 && <span className="small muted">No renewals due this month 🎉</span>}
            </div>
          </div>
        </div>
      </div>

      <div className="card mt-16">
        <div className="card-header">
          <div>
            <h3>Registered shop owners</h3>
            <p>Manage tenant workspaces and license status</p>
          </div>
        </div>
        <div className="toolbar">
          <div className="toolbar-left">
            <SearchInput value={q} onChange={(v) => { setQ(v); pg.setPage(1); }} placeholder="Search shop, owner, email, city…" />
          </div>
          <div className="toolbar-right">
            <div className="segmented">
              {filters.map(([v, l]) => (
                <button key={v} className={filter === v ? 'active' : ''} onClick={() => { setFilter(v); pg.setPage(1); }}>
                  {l}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Shop</th>
                <th>Contact</th>
                <th>Plan</th>
                <th>License status</th>
                <th>Valid till</th>
                <th>Workspace</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {pg.slice.map((s) => {
                const st = licenseStatus(s);
                const d = daysUntil(s.licenseEnd);
                return (
                  <tr key={s.id} style={!s.active ? { opacity: 0.6 } : undefined}>
                    <td>
                      <div className="name-cell">
                        <span className="avatar">{initials(s.shopName)}</span>
                        <div>
                          <div className="title">{s.shopName}</div>
                          <div className="sub">{s.ownerName}</div>
                        </div>
                      </div>
                    </td>
                    <td>
                      <div className="small row" style={{ gap: 6 }}><Mail size={13} className="muted" /> {s.email}</div>
                      <div className="small row muted" style={{ gap: 6, marginTop: 2 }}>
                        <Phone size={13} /> {s.phone} <MapPin size={13} style={{ marginLeft: 6 }} /> {s.city}
                      </div>
                    </td>
                    <td><span className="chip">{s.plan}</span></td>
                    <td><Badge>{st}</Badge></td>
                    <td>
                      <div className="strong small">{fmtDate(s.licenseEnd)}</div>
                      <div className="muted">{d >= 0 ? `${d} days left` : `Expired ${-d} days ago`}</div>
                    </td>
                    <td>
                      <Toggle checked={s.active} onChange={(v) => setActive(s, v)} size="sm" tone="success" label={<span className="small">{s.active ? 'Active' : 'Inactive'}</span>} />
                    </td>
                    <td className="num">
                      <button className="btn btn-secondary btn-sm" onClick={() => { setRenew(s); setRenewPlan('1 Year'); }}>
                        <RefreshCw size={14} /> Renew
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {rows.length === 0 && <EmptyState icon={Store} title="No shops found" text="Try a different search or filter." />}
        </div>
        <Pagination {...pg} />
      </div>

      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="Create shop owner"
        subtitle="Provisions a new, isolated workspace and the owner’s login."
        size="lg"
        footer={
          <>
            <button className="btn btn-secondary" onClick={() => setCreateOpen(false)}>Cancel</button>
            <button className="btn btn-primary" onClick={create}>Create &amp; send invite</button>
          </>
        }
      >
        <div className="section-title">Business</div>
        <div className="form-grid">
          <Field label="Shop / business name" required error={touched ? errors.shopName : ''}>
            <input className={`input ${touched && errors.shopName ? 'invalid' : ''}`} value={form.shopName} onChange={(e) => setForm({ ...form, shopName: e.target.value })} placeholder="e.g. Aravind Computer Store" autoFocus />
          </Field>
          <Field label="City">
            <input className="input" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} placeholder="e.g. Chennai" />
          </Field>
        </div>
        <div className="section-title mt-24">Owner account</div>
        <div className="form-grid">
          <Field label="Owner name" required error={touched ? errors.ownerName : ''}>
            <input className={`input ${touched && errors.ownerName ? 'invalid' : ''}`} value={form.ownerName} onChange={(e) => setForm({ ...form, ownerName: e.target.value })} />
          </Field>
          <Field label="Phone" required error={touched ? errors.phone : ''}>
            <input className={`input ${touched && errors.phone ? 'invalid' : ''}`} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="+91 98xxx xxxxx" />
          </Field>
          <Field label="Login email" required error={touched ? errors.email : ''}>
            <input className={`input ${touched && errors.email ? 'invalid' : ''}`} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="owner@business.com" />
          </Field>
          <Field label="Temporary password" required error={touched ? errors.password : ''}>
            <div className="input-group trail-pad">
              <input className={`input ${touched && errors.password ? 'invalid' : ''}`} style={{ paddingLeft: 12 }} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
              <span className="trail">
                <button type="button" className="icon-btn" title="Generate" onClick={() => setForm({ ...form, password: Math.random().toString(36).slice(2, 10) })}>
                  <Copy size={15} />
                </button>
              </span>
            </div>
          </Field>
        </div>
        <div className="section-title mt-24">Software license</div>
        <div className="radio-cards" style={{ gridTemplateColumns: 'repeat(4, minmax(0,1fr))' }}>
          {(Object.keys(PLAN_DAYS) as LicensePlan[]).map((p) => (
            <div key={p} className={`radio-card ${form.plan === p ? 'active' : ''}`} onClick={() => setForm({ ...form, plan: p })}>
              <span className="dot" />
              <div>
                <strong>{p}</strong>
                <span>{PLAN_FEE[p] ? money(PLAN_FEE[p]) : `${PLAN_DAYS[p]} days free`}</span>
              </div>
            </div>
          ))}
        </div>
        <p className="small muted" style={{ marginTop: 12 }}>
          License valid from today until <strong>{fmtDate(addDays(todayISO(), PLAN_DAYS[form.plan]))}</strong>.
        </p>
      </Modal>

      <Modal
        open={!!renew}
        onClose={() => setRenew(null)}
        title="Renew license"
        subtitle={renew ? `${renew.shopName} · currently valid till ${fmtDate(renew.licenseEnd)}` : ''}
        footer={
          <>
            <button className="btn btn-secondary" onClick={() => setRenew(null)}>Cancel</button>
            <button className="btn btn-primary" onClick={doRenew}>Renew license</button>
          </>
        }
      >
        <div className="radio-cards">
          {(['1 Year', '2 Years', '3 Years'] as LicensePlan[]).map((p) => (
            <div key={p} className={`radio-card ${renewPlan === p ? 'active' : ''}`} onClick={() => setRenewPlan(p)}>
              <span className="dot" />
              <div>
                <strong>{p}</strong>
                <span>{money(PLAN_FEE[p])}</span>
              </div>
            </div>
          ))}
        </div>
        {renew && (
          <p className="small muted" style={{ marginTop: 14 }}>
            New expiry:{' '}
            <strong>{fmtDate(addDays(daysUntil(renew.licenseEnd) > 0 ? renew.licenseEnd : todayISO(), PLAN_DAYS[renewPlan]))}</strong>
          </p>
        )}
      </Modal>
    </div>
  );
}
