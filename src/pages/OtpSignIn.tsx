import { useEffect, useState, type FormEvent } from 'react';
import { AlertCircle, ArrowRight, Loader2, MessageSquareText, Smartphone } from 'lucide-react';
import { api, ApiError } from '@/api/client';
import { Field } from '@/components/ui';
import type { Me } from '@/api/types';

const tenDigits = (v: string) => {
  const d = v.replace(/\D/g, '');
  const t = d.length === 12 && d.startsWith('91') ? d.slice(2) : d.length === 11 && d.startsWith('0') ? d.slice(1) : d;
  return /^[6-9]\d{9}$/.test(t) ? t : '';
};

/**
 * Sign in with a mobile OTP: the number on the login (shop owners start with their sign-up number; staff numbers are
 * set in Settings → Team), a 6-digit code by SMS (MSG91, DLT-approved template), valid 10 minutes.
 */
export function OtpSignIn({ remember, onSignedIn, onUseEmail }: { remember: boolean; onSignedIn: (phone: string, otp: string, remember: boolean) => Promise<Me>; onUseEmail: () => void }) {
  const [phone, setPhone] = useState('');
  const [sentTo, setSentTo] = useState('');
  const [otp, setOtp] = useState('');
  const [wait, setWait] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  useEffect(() => { if (wait <= 0) return; const t = setTimeout(() => setWait((w) => w - 1), 1000); return () => clearTimeout(t); }, [wait]);

  const send = async (e?: FormEvent) => {
    e?.preventDefault();
    setError('');
    const m = tenDigits(phone);
    if (!m) { setError('Enter your 10-digit mobile number.'); return; }
    setBusy(true);
    try {
      const r = await api.post<{ sent: boolean; message: string; wait: number }>('/auth/otp/send', { phone: m });
      setSentTo(m); setOtp(''); setWait(r.wait ?? 30); setNote(r.message);
    } catch (err) { setError(err instanceof ApiError ? err.message : 'Couldn’t send the OTP. Try again.'); }
    finally { setBusy(false); }
  };
  const verify = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    if (!/^\d{4,8}$/.test(otp)) { setError('Enter the 6-digit code from the SMS.'); return; }
    setBusy(true);
    try { await onSignedIn(sentTo, otp, remember); }
    catch (err) { setError(err instanceof ApiError ? err.message : 'Sign-in failed. Please try again.'); setBusy(false); }
  };

  const alert = error && <div className="login-alert" role="alert"><AlertCircle size={17} style={{ flexShrink: 0, marginTop: 1 }} /><span>{error}</span></div>;

  if (!sentTo) {
    return (
      <form className="login-form" onSubmit={send} noValidate>
        <Field label="Mobile number" required hint="The number on your Corpus360 login">
          <div className="input-group">
            <span className="lead"><Smartphone size={16} /></span>
            <input className="input" type="tel" inputMode="numeric" autoComplete="tel-national" placeholder="98765 43210" value={phone} onChange={(e) => setPhone(e.target.value)} style={{ height: 40 }} autoFocus />
          </div>
        </Field>
        {alert}
        <button className="btn btn-primary btn-block login-btn" type="submit" disabled={busy}>
          {busy ? <><Loader2 size={18} className="spin" /> Sending…</> : <>Send OTP <MessageSquareText size={18} /></>}
        </button>
        <p className="small muted" style={{ textAlign: 'center', margin: 0 }}><a href="#" onClick={(e) => { e.preventDefault(); onUseEmail(); }} style={{ fontWeight: 600 }}>Sign in with email and password instead</a></p>
      </form>
    );
  }
  return (
    <form className="login-form" onSubmit={verify} noValidate>
      <p className="small muted" style={{ margin: 0 }}>{note} Sent to <strong>+91 {sentTo.slice(0, 5)} {sentTo.slice(5)}</strong>. <a href="#" onClick={(e) => { e.preventDefault(); setSentTo(''); setError(''); }}>Change</a></p>
      <Field label="OTP" required>
        <input className="input" style={{ height: 44, fontSize: 20, letterSpacing: 6, textAlign: 'center' }} inputMode="numeric" autoComplete="one-time-code" maxLength={8} placeholder="••••••" value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))} autoFocus />
      </Field>
      {alert}
      <button className="btn btn-primary btn-block login-btn" type="submit" disabled={busy}>
        {busy ? <><Loader2 size={18} className="spin" /> Signing in…</> : <>Verify and sign in <ArrowRight size={18} /></>}
      </button>
      <div className="row between small">
        <button type="button" className="btn btn-ghost btn-sm" disabled={busy || wait > 0} onClick={() => void send()}>{wait > 0 ? `Resend in ${wait}s` : 'Resend OTP'}</button>
        <a href="#" onClick={(e) => { e.preventDefault(); onUseEmail(); }}>Use email instead</a>
      </div>
    </form>
  );
}
