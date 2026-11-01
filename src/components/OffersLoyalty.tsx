import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Gift, Star, UserPlus, X, RotateCcw, Loader2 } from 'lucide-react';
import { api } from '@/api/client';
import { useMut } from '@/api/hooks';
import type { Customer } from '@/api/types';
import { useShopUser } from '@/context/AuthContext';
import { Field, Modal, Toggle } from '@/components/ui';
import { money, todayISO } from '@/lib/format';
import { redeemablePoints, runningOn, withLoyaltyDefaults, type AppliedOffer, type LoyaltySettings, type Offer } from '../../shared/offers';

/** Offers running on the bill date, the loyalty rules and the customer's points, for shops with the add-on. */
export function usePromo(customerId: string, date = todayISO()) {
  const me = useShopUser();
  const on = me.has('offers_loyalty');
  const offersQ = useQuery({ queryKey: ['offers-running', date], queryFn: () => api.get<Offer[]>(`/shop/offers/running?date=${date}`), enabled: on, staleTime: 60_000 });
  const settingsQ = useQuery({ queryKey: ['loyalty-settings'], queryFn: () => api.get<LoyaltySettings>('/shop/loyalty/settings'), enabled: on, staleTime: 60_000 });
  const pointsQ = useQuery({ queryKey: ['loyalty', customerId], queryFn: () => api.get<{ balance: number }>(`/shop/loyalty/customers/${customerId}`), enabled: on && !!customerId });
  const settings = withLoyaltyDefaults(settingsQ.data);
  return {
    on,
    offers: on ? runningOn(offersQ.data ?? [], date) : [],
    settings,
    loyaltyOn: on && settings.enabled,
    balance: customerId ? pointsQ.data?.balance ?? 0 : 0,
  };
}

/** The offers on this bill, each with what it saves and a way to take it off (or put it back). */
export function OffersSummary({ applied, offers, skipped, onSkip, onUndo }: { applied: AppliedOffer[]; offers: Offer[]; skipped: string[]; onSkip: (id: string) => void; onUndo: (id: string) => void }) {
  const off = offers.filter((o) => skipped.includes(o.id));
  if (!applied.length && !off.length) return null;
  return (
    <div className="promo-box" aria-label="Offers on this bill">
      {applied.map((a) => (
        <div key={a.id} className="row between small promo-row">
          <span className="row" style={{ gap: 6 }}><Gift size={13} /> {a.name}</span>
          <span className="row" style={{ gap: 6 }}><strong className="ok">−{money(a.amount)}</strong><button type="button" className="icon-btn sm" title="Take this offer off the bill" aria-label={`Remove ${a.name}`} onClick={() => onSkip(a.id)}><X size={12} /></button></span>
        </div>
      ))}
      {off.map((o) => (
        <div key={o.id} className="row between small promo-row muted">
          <span style={{ textDecoration: 'line-through' }}>{o.name}</span>
          <button type="button" className="link-btn" onClick={() => onUndo(o.id)}><RotateCcw size={11} /> Put back</button>
        </div>
      ))}
    </div>
  );
}

/** The customer's points, and using some on this bill. */
export function PointsBox({ settings, balance, payable, use, points, onChange, earn }: {
  settings: LoyaltySettings; balance: number; payable: number; use: boolean; points: number; onChange: (use: boolean, points: number) => void; earn: number;
}) {
  const max = redeemablePoints(settings, balance, payable);
  return (
    <div className="promo-box points-box">
      <div className="row between small">
        <span className="row" style={{ gap: 6 }}><Star size={13} /> <strong>{balance}</strong> points{balance > 0 ? ` (${money(balance * settings.pointValue)})` : ''}</span>
        {earn > 0 && <span className="muted">This bill earns {earn}</span>}
      </div>
      {max > 0 ? (
        <div className="row between small" style={{ marginTop: 6, gap: 8 }}>
          <Toggle size="sm" checked={use} onChange={(v) => onChange(v, v ? max : 0)} label={<span className="small">Use points</span>} />
          {use && (
            <span className="row" style={{ gap: 6 }}>
              <input className="input" type="number" min={0} max={max} step={1} style={{ width: 80, height: 28 }} aria-label="Points to use" value={points || ''}
                onChange={(e) => onChange(true, Math.max(0, Math.min(max, Math.floor(Number(e.target.value) || 0))))} />
              <span className="muted">of {max} = <strong className="ok">−{money(points * settings.pointValue)}</strong></span>
            </span>
          )}
        </div>
      ) : balance > 0 && balance < settings.minRedeem ? (
        <div className="small muted" style={{ marginTop: 4 }}>Points can be used from {settings.minRedeem}.</div>
      ) : null}
    </div>
  );
}

const digits = (s: string) => s.replace(/\D/g, '').slice(-10);

/**
 * Find a customer by mobile number at the counter, or add them in two fields, so points can be earned on a
 * walk-in sale without leaving the bill.
 */
export function CustomerByPhone({ customers, onPick }: { customers: Customer[]; onPick: (id: string) => void }) {
  const me = useShopUser();
  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');
  const [adding, setAdding] = useState(false);
  const d = digits(phone);
  const match = d.length === 10 ? customers.find((c) => digits(c.phone) === d) : undefined;
  const add = useMut((b: Record<string, unknown>) => api.post<Customer>('/shop/customers', b), [['customers']], { success: 'Customer added' });
  const look = (v: string) => {
    setPhone(v);
    const dd = digits(v);
    const m = dd.length === 10 ? customers.find((c) => digits(c.phone) === dd) : undefined;
    if (m) { onPick(m.id); setPhone(''); }
  };
  return (
    <>
      <div className="row" style={{ gap: 6 }}>
        <input className="input" style={{ height: 34 }} inputMode="tel" placeholder="Customer mobile no." aria-label="Customer mobile number" value={phone} onChange={(e) => look(e.target.value)} />
        {d.length === 10 && !match && me.can('customers.write') && <button type="button" className="btn btn-soft btn-sm" onClick={() => setAdding(true)}><UserPlus size={14} /> Add</button>}
      </div>
      <Modal open={adding} onClose={() => setAdding(false)} title="New customer" subtitle={`Mobile ${d}`}
        footer={<><button className="btn btn-secondary" onClick={() => setAdding(false)}>Cancel</button><button className="btn btn-primary" disabled={!name.trim() || add.isPending}
          onClick={() => add.mutate({ type: 'Individual', name: name.trim(), phone: d }, { onSuccess: (c) => { onPick(c.id); setAdding(false); setPhone(''); setName(''); } })}>{add.isPending && <Loader2 size={14} className="spin" />} Add customer</button></>}>
        <Field label="Name" required><input id="quick-customer-name" className="input" value={name} onChange={(e) => setName(e.target.value)} autoFocus placeholder="e.g. Priya" /></Field>
      </Modal>
    </>
  );
}
