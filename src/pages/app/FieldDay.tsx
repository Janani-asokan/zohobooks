import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle2, Clock3, IndianRupee, Loader2, LogIn, LogOut, MapPin, MapPinned, Navigation, Play, ShieldCheck, Square, Store } from 'lucide-react';
import { api } from '@/api/client';
import { useCustomers, useMut } from '@/api/hooks';
import { useToast } from '@/context/ToastContext';
import { Field, Modal, PageHeader } from '@/components/ui';
import { getPosition, useFieldMe, type FieldVisit } from '@/lib/geo';
import { money } from '@/lib/format';

const PURPOSES = ['Sales visit', 'Order', 'Payment collection', 'Delivery', 'Service', 'Other'] as const;
const OUTCOMES = ['Order taken', 'Payment collected', 'Follow up', 'Not interested', 'Shop closed', 'Delivered', 'Other'] as const;
const KEYS = [['fieldMe'], ['fieldTeam']];
const time = (s: string) => new Date(s).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' });

/** A salesperson's day: start, check in at each customer, record the result, end the day. */
export default function FieldDay() {
  const toast = useToast();
  const me = useFieldMe();
  const customers = useCustomers().data ?? [];
  const [busy, setBusy] = useState<string | null>(null);
  const [checkIn, setCheckIn] = useState<{ customerId: string; customerName: string; purpose: (typeof PURPOSES)[number] } | null>(null);
  const [checkout, setCheckout] = useState<{ v: FieldVisit; outcome: (typeof OUTCOMES)[number]; orderValue: string; collected: string; notes: string; nextVisit: string } | null>(null);
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(t); }, []);

  const day = me.data?.day;
  const onDuty = !!day && !day.endedAt;
  const open = me.data?.open ?? null;
  const visits = me.data?.visits ?? [];
  const refresh = useMut(async () => undefined, KEYS);

  const withFix = async (key: string, fn: (f: { lat: number; lng: number; accuracy: number }) => Promise<unknown>, done: string) => {
    setBusy(key);
    try { const f = await getPosition(); await fn(f); refresh.mutate(undefined); toast('success', done); return true; }
    catch (e) { toast('error', (e as Error).message); return false; }
    finally { setBusy(null); }
  };
  const start = () => withFix('start', (f) => api.post('/shop/field/day/start', f), 'Day started · location sharing is on');
  const end = () => withFix('end', (f) => api.post('/shop/field/day/end', f), 'Day ended · location sharing is off');
  const doCheckIn = async () => {
    if (!checkIn) return;
    if (!checkIn.customerId && !checkIn.customerName.trim()) return toast('error', 'Pick a customer or type the shop name');
    const ok = await withFix('checkin', (f) => api.post('/shop/field/visits', { ...f, customerId: checkIn.customerId || null, customerName: checkIn.customerName, purpose: checkIn.purpose }), 'Checked in');
    if (ok) setCheckIn(null);
  };
  const doCheckout = async () => {
    if (!checkout) return;
    setBusy('checkout');
    try {
      await api.post(`/shop/field/visits/${checkout.v.id}/checkout`, { outcome: checkout.outcome, orderValue: Number(checkout.orderValue) || 0, collected: Number(checkout.collected) || 0, notes: checkout.notes, nextVisit: checkout.nextVisit || null });
      refresh.mutate(undefined);
      toast('success', 'Visit saved', checkout.v.customerName);
      setCheckout(null);
    } catch (e) { toast('error', (e as Error).message); } finally { setBusy(null); }
  };

  const totals = { visits: visits.length, orders: visits.reduce((s, v) => s + v.orderValue, 0), collected: visits.reduce((s, v) => s + v.collected, 0) };

  return (
    <div className="page" style={{ maxWidth: 820 }}>
      <PageHeader title="My Day" crumbs={<>Sales <span>/</span> Field visits</>} subtitle="Start your day, check in at each customer, and note what happened. Your manager sees your visits and route." />

      <section className={`card field-hero ${onDuty ? 'on' : ''}`}>
        <div className="fh-status">
          <span className="fh-dot" />
          <div>
            <strong>{onDuty ? 'On duty' : day?.endedAt ? 'Day ended' : 'Not started'}</strong>
            <div className="small">{onDuty ? `Since ${time(day!.startedAt)} · location shared while the app is open` : day?.endedAt ? `${time(day.startedAt)} – ${time(day.endedAt)}` : 'Tap Start day when you leave for your first visit'}</div>
          </div>
        </div>
        {onDuty
          ? <button className="btn btn-secondary btn-lg" disabled={!!busy || !!open} title={open ? 'Check out of the current visit first' : undefined} onClick={end}>{busy === 'end' ? <Loader2 size={18} className="spin" /> : <Square size={16} />} End day</button>
          : <button className="btn btn-primary btn-lg" disabled={!!busy} onClick={start}>{busy === 'start' ? <Loader2 size={18} className="spin" /> : <Play size={16} />} Start day</button>}
      </section>
      <div className="small muted field-privacy"><ShieldCheck size={13} /> Location is recorded only between Start day and End day, and at each check-in.</div>

      <div className="stat-grid mt-16 field-stats">
        <div className="card fs"><MapPinned size={18} /><div><strong>{totals.visits}</strong><span>visits</span></div></div>
        <div className="card fs"><Store size={18} /><div><strong>{money(totals.orders)}</strong><span>orders</span></div></div>
        <div className="card fs"><IndianRupee size={18} /><div><strong>{money(totals.collected)}</strong><span>collected</span></div></div>
      </div>

      {open ? (
        <section className="card field-open mt-16">
          <div className="row between" style={{ gap: 12, flexWrap: 'wrap' }}>
            <div className="row" style={{ gap: 12 }}>
              <span className="fo-icon"><MapPin size={20} /></span>
              <div><div className="small muted">At customer since {time(open.checkedInAt)} · {Math.max(0, Math.round((now - new Date(open.checkedInAt).getTime()) / 60000))} min</div><strong style={{ fontSize: 18 }}>{open.customerName}</strong><div className="small muted">{open.purpose}</div></div>
            </div>
            <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              {open.customerId && <Link className="btn btn-secondary" to={`/app/sales/orders?new=1&customer=${open.customerId}`}>Take order</Link>}
              <button className="btn btn-primary" onClick={() => setCheckout({ v: open, outcome: 'Order taken', orderValue: '', collected: '', notes: '', nextVisit: '' })}><LogOut size={15} /> Check out</button>
            </div>
          </div>
        </section>
      ) : (
        <button className="field-checkin mt-16" onClick={() => setCheckIn({ customerId: '', customerName: '', purpose: 'Sales visit' })} disabled={!!busy}>
          {busy === 'checkin' ? <Loader2 size={22} className="spin" /> : <LogIn size={22} />}<strong>Check in at a customer</strong><span className="small">Records where and when you arrived</span>
        </button>
      )}

      <section className="card mt-16">
        <div className="card-header"><h3>Today’s visits</h3></div>
        {visits.length === 0 ? <div className="card-body small muted">No visits yet today.</div> : (
          <ul className="field-list">
            {[...visits].reverse().map((v) => (
              <li key={v.id}>
                <span className="fl-time">{time(v.checkedInAt)}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <strong>{v.customerName}</strong>
                  <div className="small muted">{v.purpose}{v.minutes !== null ? ` · ${v.minutes} min` : ' · in progress'}{v.outcome ? ` · ${v.outcome}` : ''}{v.notes ? ` · ${v.notes}` : ''}</div>
                </div>
                <div className="num small">{v.orderValue > 0 && <div className="strong">{money(v.orderValue)}</div>}{v.collected > 0 && <div className="text-green">+{money(v.collected)}</div>}</div>
                {v.lat !== null && <a className="icon-btn" title="Open in maps" target="_blank" rel="noreferrer" href={`https://www.google.com/maps?q=${v.lat},${v.lng}`}><Navigation size={15} /></a>}
              </li>
            ))}
          </ul>
        )}
      </section>

      <Modal open={!!checkIn} onClose={() => setCheckIn(null)} title="Check in" subtitle="Your location is saved with this visit."
        footer={<><button className="btn btn-secondary" onClick={() => setCheckIn(null)}>Cancel</button><button className="btn btn-primary" disabled={busy === 'checkin'} onClick={doCheckIn}>{busy === 'checkin' ? <Loader2 size={15} className="spin" /> : <MapPin size={15} />} Check in here</button></>}>
        {checkIn && (
          <div className="stack" style={{ gap: 14 }}>
            <Field label="Customer">
              <select className="select" value={checkIn.customerId} onChange={(e) => setCheckIn({ ...checkIn, customerId: e.target.value })} aria-label="Customer">
                <option value="">New shop / not in the list</option>{customers.map((c) => <option key={c.id} value={c.id}>{c.companyName || c.name}{c.phone ? ` · ${c.phone}` : ''}</option>)}
              </select>
            </Field>
            {!checkIn.customerId && <Field label="Shop or person"><input className="input" autoFocus value={checkIn.customerName} maxLength={150} onChange={(e) => setCheckIn({ ...checkIn, customerName: e.target.value })} placeholder="e.g. Sri Murugan Stores, Adyar" /></Field>}
            <Field label="Purpose"><div className="chip-row">{PURPOSES.map((p) => <button key={p} type="button" className={`chip-btn ${checkIn.purpose === p ? 'on' : ''}`} onClick={() => setCheckIn({ ...checkIn, purpose: p })}>{p}</button>)}</div></Field>
          </div>
        )}
      </Modal>

      <Modal open={!!checkout} onClose={() => setCheckout(null)} title={`Check out · ${checkout?.v.customerName ?? ''}`} subtitle="What happened at this visit?"
        footer={<><button className="btn btn-secondary" onClick={() => setCheckout(null)}>Cancel</button><button className="btn btn-primary" disabled={busy === 'checkout'} onClick={doCheckout}>{busy === 'checkout' ? <Loader2 size={15} className="spin" /> : <CheckCircle2 size={15} />} Save visit</button></>}>
        {checkout && (
          <div className="stack" style={{ gap: 14 }}>
            <Field label="Result"><div className="chip-row">{OUTCOMES.map((o) => <button key={o} type="button" className={`chip-btn ${checkout.outcome === o ? 'on' : ''}`} onClick={() => setCheckout({ ...checkout, outcome: o })}>{o}</button>)}</div></Field>
            <div className="form-grid">
              <Field label="Order value (₹)"><input className="input" type="number" min={0} inputMode="decimal" value={checkout.orderValue} onChange={(e) => setCheckout({ ...checkout, orderValue: e.target.value })} placeholder="0" /></Field>
              <Field label="Payment collected (₹)"><input className="input" type="number" min={0} inputMode="decimal" value={checkout.collected} onChange={(e) => setCheckout({ ...checkout, collected: e.target.value })} placeholder="0" /></Field>
            </div>
            <Field label="Notes"><textarea className="textarea" rows={2} maxLength={1000} value={checkout.notes} onChange={(e) => setCheckout({ ...checkout, notes: e.target.value })} placeholder="What they need, competitor prices, complaints…" /></Field>
            <Field label="Next visit" hint="Optional"><input className="input" type="date" value={checkout.nextVisit} onChange={(e) => setCheckout({ ...checkout, nextVisit: e.target.value })} /></Field>
            {checkout.collected && Number(checkout.collected) > 0 && checkout.v.customerId && <div className="small muted"><Clock3 size={12} /> Record the payment against their invoice in Payments Received too, so the books match.</div>}
          </div>
        )}
      </Modal>
    </div>
  );
}
