import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, Loader2, Mail, Phone, PhoneCall, Sparkles } from 'lucide-react';
import { api, type ApiError } from '@/api/client';
import { waLink, whatsappSalesText, type LeadSource } from '../../shared/support';

interface PublicContact { phone: string; email: string; whatsapp: string; sales: { phone: string; email: string; whatsapp: string } }
export const usePublicContact = () =>
  useQuery({ queryKey: ['public', 'contact'], queryFn: () => api.get<PublicContact>('/public/contact'), staleTime: 300_000, retry: false });

/** WhatsApp's speech-bubble mark (lucide has no brand icons). */
export function WhatsAppMark({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">
      <path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2Zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.2-.4.2-.4.7-1.2.1-.2 0-.3 0-.5l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.8 11.9 11.9 0 0 0 4.6 4c1.7.7 2.4.8 3.2.7.5-.1 1.5-.6 1.8-1.2.2-.6.2-1.1.1-1.2l-.4-.2Z" />
    </svg>
  );
}

/**
 * Talk to sales: WhatsApp, call or email the sales team, or leave a number for them to call back. Shown to visitors
 * (Help on the public pages) and to shops on the trial or whose license ran out (Help inside the app).
 * In the app, `shop` fills in who is asking, so the form only needs a phone number.
 */
export function SalesPanel({ source, shop, compact }: {
  source: LeadSource;
  shop?: { name: string; userName: string; phone: string; renew: boolean };
  compact?: boolean;
}) {
  const contact = usePublicContact().data?.sales;
  const [f, setF] = useState({ name: '', phone: shop?.phone ?? '', email: '', business: '', city: '', message: '', website: '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [done, setDone] = useState(false);
  const tel = contact?.phone.replace(/[^\d+]/g, '') ?? '';
  const digits = f.phone.replace(/\D/g, '');
  const ok = (shop || f.name.trim().length >= 2) && (digits.length >= 10 || (!shop && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email)));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ok || busy) return;
    setBusy(true); setErr('');
    try {
      const page = typeof window !== 'undefined' ? window.location.pathname : '';
      if (shop) await api.post('/billing/sales-lead', { phone: f.phone, message: f.message, page });
      else await api.post('/public/sales-leads', { ...f, source, page });
      setDone(true);
    } catch (x) {
      setErr((x as ApiError).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="sales-panel">
      <div className="sales-head">
        <span className="sales-ic"><Sparkles size={18} /></span>
        <div>
          <strong>{shop?.renew ? 'Choose a plan with our sales team' : 'Talk to our sales team'}</strong>
          <div className="small muted">{shop?.renew
            ? 'Questions about plans, prices or add-ons? We’ll help you pick what fits your shop.'
            : 'A free demo, prices, GST setup, moving from another software: ask us anything.'}</div>
        </div>
      </div>
      {contact && (contact.whatsapp || tel || contact.email) && (
        <div className="sales-actions">
          {contact.whatsapp && <a className="btn btn-whatsapp btn-sm" target="_blank" rel="noreferrer"
            href={waLink(contact.whatsapp, whatsappSalesText({ shopName: shop?.name, name: shop?.userName, renew: shop?.renew }))}><WhatsAppMark /> WhatsApp sales</a>}
          {tel && <a className="btn btn-secondary btn-sm" href={`tel:${tel}`}><Phone size={14} /> {contact.phone}</a>}
          {contact.email && <a className="btn btn-secondary btn-sm" href={`mailto:${contact.email}?subject=${encodeURIComponent(shop ? `Plans for ${shop.name}` : 'Corpus360 Lite enquiry')}`}><Mail size={14} /> {compact ? 'Email' : contact.email}</a>}
        </div>
      )}
      {done ? (
        <div className="sales-done" role="status"><CheckCircle2 size={18} /> <span>Thank you! Our sales team will call you within one working day.</span></div>
      ) : (
        <form className="sales-form" onSubmit={submit}>
          <div className="small strong"><PhoneCall size={14} style={{ verticalAlign: -2 }} /> Or we’ll call you</div>
          {!shop && <>
            <input className="input" placeholder="Your name" aria-label="Your name" value={f.name} maxLength={120} onChange={(e) => setF({ ...f, name: e.target.value })} />
            <input className="input" placeholder="Shop or business name" aria-label="Shop or business name" value={f.business} maxLength={160} onChange={(e) => setF({ ...f, business: e.target.value })} />
          </>}
          <input className="input" type="tel" inputMode="tel" placeholder="Phone number" aria-label="Phone number" value={f.phone} maxLength={30} onChange={(e) => setF({ ...f, phone: e.target.value })} />
          {!shop && <input className="input" type="email" placeholder="Email (if no phone)" aria-label="Email" value={f.email} maxLength={160} onChange={(e) => setF({ ...f, email: e.target.value })} />}
          <textarea className="textarea" rows={2} placeholder="What would you like to know? (optional)" aria-label="Message" value={f.message} maxLength={1000} onChange={(e) => setF({ ...f, message: e.target.value })} />
          {/* Never shown to people; bots that fill every field give themselves away. */}
          <input className="sales-hp" tabIndex={-1} autoComplete="off" aria-hidden="true" value={f.website} onChange={(e) => setF({ ...f, website: e.target.value })} name="c360_hp_trap" />
          {err && <div className="small" style={{ color: 'var(--danger)' }} role="alert">{err}</div>}
          <button className="btn btn-primary btn-sm" disabled={!ok || busy}>{busy ? <Loader2 size={14} className="spin" /> : <PhoneCall size={14} />} Call me back</button>
        </form>
      )}
      {!shop && (
        <div className="sales-foot small muted">
          Already a customer? <Link to="/login">Sign in</Link> and tap <strong>Help</strong> for customer care.
          {source !== 'signup' && <> New here? <Link to="/signup">Start the free trial</Link>.</>}
        </div>
      )}
    </div>
  );
}
