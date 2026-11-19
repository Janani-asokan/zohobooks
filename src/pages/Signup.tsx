import { useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { AlertCircle, ArrowRight, Loader2, Mail, Phone, Store, UserRound, MapPin } from 'lucide-react';
import { homeFor, useAuth } from '@/context/AuthContext';
import type { Me } from '@/api/types';
import { useToast } from '@/context/ToastContext';
import { api, ApiError } from '@/api/client';
import { LOGIN_EMAIL_RE as EMAIL_RE } from '@/lib/format';
import { Field } from '@/components/ui';
import { PasswordInput } from '@/components/PasswordInput';
import { FullPageSpinner } from '@/components/ProtectedRoute';
import { isStrongPassword, PASSWORD_RULE } from '../../shared/permissions';
import { AuthShell } from './AuthShell';
import { IS_APP, cacheClear, setAppToken } from '@/lib/platform';

interface SignupInfo { enabled: boolean; businessTypes: Array<{ key: string; name: string }> }
const blank = { shopName: '', ownerName: '', email: '', phone: '', city: '', businessType: 'general', password: '', website: '' };

/**
 * Self-service signup from the landing page: a new shop on the free trial plan, signed in straight away.
 * The server can switch it off (PUBLIC_SIGNUP=0); the page then says so and points to the login.
 */
export default function Signup() {
  const { me, loading: authLoading, refresh } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const info = useQuery({ queryKey: ['signupInfo'], queryFn: () => api.get<SignupInfo>('/auth/signup'), staleTime: Infinity, retry: false });
  const [f, setF] = useState(blank);
  const [touched, setTouched] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  if (authLoading) return <FullPageSpinner />;
  if (me) return <Navigate to={homeFor(me)} replace />;

  const set = (k: keyof typeof blank) => (v: string) => setF((x) => ({ ...x, [k]: v }));
  const errs = {
    shopName: f.shopName.trim().length < 2 ? 'Enter your business name' : '',
    ownerName: f.ownerName.trim().length < 2 ? 'Enter your name' : '',
    email: !EMAIL_RE.test(f.email.trim()) ? 'Enter a valid email address' : '',
    phone: f.phone.replace(/\D/g, '').length < 10 ? 'Enter a valid 10-digit mobile number' : '',
    password: !isStrongPassword(f.password) ? PASSWORD_RULE : '',
  };
  const e = (k: keyof typeof errs) => (touched ? errs[k] : '');

  const submit = async (ev: FormEvent) => {
    ev.preventDefault();
    setTouched(true); setError('');
    if (Object.values(errs).some(Boolean)) return;
    setBusy(true);
    try {
      const { token, ...m } = await api.post<Me & { token?: string }>('/auth/signup', { ...f, shopName: f.shopName.trim(), ownerName: f.ownerName.trim(), email: f.email.trim() });
      // Phone app: the session is a bearer token kept on the phone (no cookies); on the web the cookie is already set.
      if (IS_APP) { setAppToken(token ?? null); await cacheClear(); }
      await refresh(); // load who we are
      toast('success', 'Your shop is ready', 'Free trial of every feature. Add your first item or invoice.');
      navigate(homeFor(m as Me), { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not create the account. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  if (info.data && !info.data.enabled) {
    return (
      <AuthShell>
        <h1>Sign-up is closed</h1>
        <p className="lead">New accounts are created by our team. Contact us to get started, or sign in if you already have an account.</p>
        <Link to="/login" className="btn btn-primary btn-block">Sign in <ArrowRight size={18} /></Link>
      </AuthShell>
    );
  }

  return (
    <AuthShell>
      <h1>Create your shop</h1>
      <p className="lead">Free trial of every feature. No card needed.</p>
      <form className="login-form" onSubmit={submit} noValidate>
        <Field label="Business name" required error={e('shopName')}>
          <div className="input-group"><span className="lead"><Store size={16} /></span>
            <input className={`input ${e('shopName') ? 'invalid' : ''}`} value={f.shopName} onChange={(x) => set('shopName')(x.target.value)} placeholder="e.g. Aravind Computer Store" autoComplete="organization" autoFocus style={{ height: 40 }} /></div>
        </Field>
        <Field label="Your name" required error={e('ownerName')}>
          <div className="input-group"><span className="lead"><UserRound size={16} /></span>
            <input className={`input ${e('ownerName') ? 'invalid' : ''}`} value={f.ownerName} onChange={(x) => set('ownerName')(x.target.value)} placeholder="Full name" autoComplete="name" style={{ height: 40 }} /></div>
        </Field>
        <div className="form-grid">
          <Field label="Email" required error={e('email')}>
            <div className="input-group"><span className="lead"><Mail size={16} /></span>
              <input className={`input ${e('email') ? 'invalid' : ''}`} type="email" value={f.email} onChange={(x) => set('email')(x.target.value)} placeholder="you@company.com" autoComplete="email" style={{ height: 40 }} /></div>
          </Field>
          <Field label="Mobile number" required error={e('phone')}>
            <div className="input-group"><span className="lead"><Phone size={16} /></span>
              <input className={`input ${e('phone') ? 'invalid' : ''}`} type="tel" inputMode="tel" value={f.phone} onChange={(x) => set('phone')(x.target.value)} placeholder="98765 43210" autoComplete="tel" style={{ height: 40 }} /></div>
          </Field>
          <Field label="City">
            <div className="input-group"><span className="lead"><MapPin size={16} /></span>
              <input className="input" value={f.city} onChange={(x) => set('city')(x.target.value)} placeholder="e.g. Chennai" autoComplete="address-level2" style={{ height: 40 }} /></div>
          </Field>
          <Field label="Type of business" hint="Sets up the right item fields for your trade">
            <select className="select" value={f.businessType} onChange={(x) => set('businessType')(x.target.value)} style={{ height: 40 }}>
              {(info.data?.businessTypes ?? [{ key: 'general', name: 'General business' }]).map((t) => <option key={t.key} value={t.key}>{t.name}</option>)}
            </select>
          </Field>
        </div>
        <Field label="Password" required error={e('password')} hint={!e('password') ? PASSWORD_RULE : undefined}>
          <PasswordInput value={f.password} onChange={set('password')} invalid={!!e('password')} autoComplete="new-password" meter />
        </Field>
        {/* Hidden from people; bots fill it in and are turned away. */}
        <input type="text" name="website" tabIndex={-1} autoComplete="off" value={f.website} onChange={(x) => set('website')(x.target.value)} aria-hidden="true" style={{ position: 'absolute', left: '-9999px', width: 1, height: 1, opacity: 0 }} />
        {error && <div className="login-alert" role="alert"><AlertCircle size={17} style={{ flexShrink: 0, marginTop: 1 }} /><span>{error}</span></div>}
        <button className="btn btn-primary btn-block login-btn" type="submit" disabled={busy}>
          {busy ? <><Loader2 size={18} className="spin" /> Creating your shop…</> : <>Create my shop <ArrowRight size={18} /></>}
        </button>
        <p className="small muted" style={{ textAlign: 'center', margin: 0 }}>By creating a shop you agree to the <Link to="/terms">terms of use</Link> and <Link to="/privacy">privacy policy</Link>.</p>
        <p className="small muted" style={{ textAlign: 'center', margin: 0 }}>Already have an account? <Link to="/login" style={{ fontWeight: 600 }}>Sign in</Link></p>
      </form>
    </AuthShell>
  );
}
