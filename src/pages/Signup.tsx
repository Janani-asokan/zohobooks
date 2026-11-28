import { track } from '@/lib/analytics';
import { EmailFix } from '@/components/EmailFix';
import { useEffect, useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { AlertCircle, ArrowLeft, ArrowRight, Loader2, Mail, MailCheck, MessageSquareText, Phone, Store, UserRound, MapPin } from 'lucide-react';
import { GoogleButton, GoogleMark, useGoogleSignIn } from '@/components/GoogleButton';
import { homeFor, useAuth } from '@/context/AuthContext';
import type { Me } from '@/api/types';
import { useToast } from '@/context/ToastContext';
import { api, ApiError } from '@/api/client';
import { LOGIN_EMAIL_RE as EMAIL_RE } from '@/lib/format';
import { Field } from '@/components/ui';
import { PasswordInput } from '@/components/PasswordInput';
import { FullPageSpinner } from '@/components/ProtectedRoute';
import { isStrongPassword, PASSWORD_RULE } from '../../shared/permissions';
import { isSignupCode, SIGNUP_CODE } from '../../shared/signupVerify';
import { AuthShell } from './AuthShell';
import { IS_APP, cacheClear, setAppToken } from '@/lib/platform';

interface SignupInfo { enabled: boolean; verifyEmail?: boolean; verifyPhone?: boolean; businessTypes: Array<{ key: string; name: string }> }
interface Pending { verify: true; signupId: string; email: string; channel?: 'sms' | 'email'; phone?: string; expiresInMinutes: number; resendInSeconds: number }
type GoogleSignup = { credential: string; email: string; name: string };
/** Google's ID token lasts an hour; past ~50 minutes ask again rather than fail at the end of the form. */
const GOOGLE_FRESH_MS = 50 * 60_000;
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
  const location = useLocation();
  const googleOn = useGoogleSignIn();
  // From "Continue with Google" on the sign-in page (no login yet), or the button here: Google's email and name.
  const [google, setGoogle] = useState<(GoogleSignup & { at: number }) | null>(() => {
    const g = (location.state as { google?: GoogleSignup } | null)?.google;
    return g ? { ...g, at: Date.now() } : null;
  });
  const [f, setF] = useState(() => (google ? { ...blank, email: google.email, ownerName: google.name } : blank));
  const [touched, setTouched] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  // With the email check on, the shop is created only after the emailed code is entered.
  const [pending, setPending] = useState<Pending | null>(null);
  const [code, setCode] = useState('');
  const [wait, setWait] = useState(0);
  useEffect(() => {
    if (wait <= 0) return;
    const t = window.setTimeout(() => setWait((w) => w - 1), 1000);
    return () => window.clearTimeout(t);
  }, [wait]);

  if (authLoading) return <FullPageSpinner />;
  if (me) return <Navigate to={homeFor(me)} replace />;

  const set = (k: keyof typeof blank) => (v: string) => setF((x) => ({ ...x, [k]: v }));
  const errs = {
    shopName: f.shopName.trim().length < 2 ? 'Enter your business name' : '',
    ownerName: f.ownerName.trim().length < 2 ? 'Enter your name' : '',
    email: !google && !EMAIL_RE.test(f.email.trim()) ? 'Enter a valid email address' : '',
    phone: f.phone.replace(/\D/g, '').length < 10 ? 'Enter a valid 10-digit mobile number' : '',
    password: !google && !isStrongPassword(f.password) ? PASSWORD_RULE : '',
  };
  const e = (k: keyof typeof errs) => (touched ? errs[k] : '');
  const needsCode = !!info.data?.verifyPhone || (!!info.data?.verifyEmail && !google);

  const submit = async (ev: FormEvent) => {
    ev.preventDefault();
    setTouched(true); setError('');
    if (Object.values(errs).some(Boolean)) return;
    if (google && Date.now() - google.at > GOOGLE_FRESH_MS) { setGoogle(null); setError('The Google sign-in has expired. Tap “Sign up with Google” again.'); return; }
    setBusy(true);
    try {
      const body = google
        ? { ...f, password: undefined, email: google.email, googleCredential: google.credential, shopName: f.shopName.trim(), ownerName: f.ownerName.trim() }
        : { ...f, shopName: f.shopName.trim(), ownerName: f.ownerName.trim(), email: f.email.trim() };
      const r = await api.post<(Me & { token?: string }) | Pending>('/auth/signup', body);
      if ('verify' in r && r.verify) { setPending(r); setCode(''); setWait(r.resendInSeconds); }
      else await finish(r as Me & { token?: string });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not create the account. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const finish = async ({ token, ...m }: Me & { token?: string }) => {
    track('sign_up', { method: google ? 'google' : 'email' });
    // Phone app: the session is a bearer token kept on the phone (no cookies); on the web the cookie is already set.
    if (IS_APP) { setAppToken(token ?? null); await cacheClear(); }
    await refresh(); // load who we are
    toast('success', 'Your shop is ready', 'Free trial of every feature. Add your first item or invoice.');
    navigate(homeFor(m as Me), { replace: true });
  };

  const verify = async (value = code) => {
    if (!pending || !isSignupCode(value) || busy) return;
    setBusy(true); setError('');
    try {
      await finish(await api.post<Me & { token?: string }>('/auth/signup/verify', { signupId: pending.signupId, code: value.trim() }));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not check the code. Please try again.');
      if (err instanceof ApiError && err.code === 'signup_expired') setPending(null);
      setCode('');
    } finally {
      setBusy(false);
    }
  };

  const resend = async () => {
    if (!pending || wait > 0) return;
    setError('');
    try {
      const r = await api.post<Pending>('/auth/signup/resend', { signupId: pending.signupId });
      setPending(r); setWait(r.resendInSeconds || SIGNUP_CODE.resendSeconds); setCode('');
      toast('success', 'New code sent', r.channel === 'sms' ? `Check the SMS on ${r.phone}` : `Check ${r.email}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not send a new code. Please try again.');
      if (err instanceof ApiError && err.code === 'signup_expired') setPending(null);
    }
  };

  if (pending) {
    return (
      <AuthShell>
        {pending.channel === 'sms' ? <MessageSquareText size={34} style={{ color: 'var(--accent)' }} /> : <MailCheck size={34} style={{ color: 'var(--accent)' }} />}
        <h1>{pending.channel === 'sms' ? 'Check your phone' : 'Check your email'}</h1>
        <p className="lead">We sent a {SIGNUP_CODE.digits}-digit code {pending.channel === 'sms' ? <>by SMS to <strong>{pending.phone}</strong></> : <>to <strong>{pending.email}</strong></>}. Enter it to finish creating your shop. It works for {pending.expiresInMinutes} minutes.</p>
        <form className="login-form" onSubmit={(ev) => { ev.preventDefault(); void verify(); }} noValidate>
          <Field label={pending.channel === 'sms' ? 'Code from the SMS' : 'Code from the email'} required>
            <input className="input otp-input" value={code} autoFocus inputMode="numeric" autoComplete="one-time-code" maxLength={SIGNUP_CODE.digits}
              placeholder={'•'.repeat(SIGNUP_CODE.digits)} aria-label={pending.channel === 'sms' ? 'Code from the SMS' : 'Code from the email'}
              onChange={(x) => { const v = x.target.value.replace(/\D/g, '').slice(0, SIGNUP_CODE.digits); setCode(v); if (v.length === SIGNUP_CODE.digits) void verify(v); }}
              style={{ height: 52, width: '100%', fontSize: 24, letterSpacing: '0.4em', textAlign: 'center' }} />
          </Field>
          {error && <div className="login-alert" role="alert"><AlertCircle size={17} style={{ flexShrink: 0, marginTop: 1 }} /><span>{error}</span></div>}
          <button className="btn btn-primary btn-block login-btn" type="submit" disabled={busy || !isSignupCode(code)}>
            {busy ? <><Loader2 size={18} className="spin" /> Creating your shop…</> : <>Confirm and create my shop <ArrowRight size={18} /></>}
          </button>
          <div className="row between" style={{ flexWrap: 'wrap', gap: 8 }}>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setPending(null); setError(''); }}><ArrowLeft size={15} /> {pending.channel === 'sms' ? 'Change number' : 'Change email'}</button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={resend} disabled={wait > 0}>{wait > 0 ? `Send a new code in ${wait}s` : 'Send a new code'}</button>
          </div>
          <p className="small muted" style={{ margin: 0 }}>{pending.channel === 'sms' ? 'No SMS? Check the number, wait a minute, then tap “Send a new code”.' : 'No email? Check spam or promotions, and make sure the address is right.'}</p>
        </form>
      </AuthShell>
    );
  }

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
      {googleOn.on && !google && (
        <div className="stack" style={{ gap: 10, marginBottom: 14 }}>
          <GoogleButton clientId={googleOn.clientId} text="signup_with" onCredential={(c) => {
            // Read the email and name from Google's token to fill the form; the server checks the token itself.
            try {
              const p = JSON.parse(atob(c.split('.')[1]!.replace(/-/g, '+').replace(/_/g, '/'))) as { email?: string; name?: string };
              setGoogle({ credential: c, email: p.email ?? '', name: p.name ?? '', at: Date.now() });
              setF((x) => ({ ...x, email: p.email ?? '', ownerName: x.ownerName || p.name || '' }));
              setError('');
            } catch { setError('Google sign-up didn’t work. Fill in the form instead.'); }
          }} />
          <div className="or-line">or fill in the form</div>
        </div>
      )}
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
          <Field label="Email" required error={e('email')} hint={google ? <>From Google · <a href="#" onClick={(x) => { x.preventDefault(); setGoogle(null); setF((v) => ({ ...v, email: '' })); }}>use another email</a></> : undefined}>
            <div className="input-group"><span className="lead">{google ? <GoogleMark size={16} /> : <Mail size={16} />}</span>
              <input className={`input ${e('email') ? 'invalid' : ''}`} type="email" value={f.email} readOnly={!!google} onChange={(x) => set('email')(x.target.value)} placeholder="you@company.com" autoComplete="email" style={{ height: 40 }} /></div>
            {!google && <EmailFix value={f.email} onChange={(v) => set('email')(v)} />}
          </Field>
          <Field label="Mobile number" required error={e('phone')} hint={info.data?.verifyPhone ? 'We’ll send a code by SMS' : undefined}>
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
        {!google && (
        <Field label="Password" required error={e('password')} hint={!e('password') ? PASSWORD_RULE : undefined}>
          <PasswordInput value={f.password} onChange={set('password')} invalid={!!e('password')} autoComplete="new-password" meter />
        </Field>
        )}
        {google && <p className="small muted" style={{ margin: 0 }}>You’ll sign in with Google. To also sign in with a password later, use “Forgot password” on the sign-in page.</p>}
        {/* Hidden from people; bots fill it in and are turned away. */}
        <input type="text" name="website" tabIndex={-1} autoComplete="off" value={f.website} onChange={(x) => set('website')(x.target.value)} aria-hidden="true" style={{ position: 'absolute', left: '-9999px', width: 1, height: 1, opacity: 0 }} />
        {error && <div className="login-alert" role="alert"><AlertCircle size={17} style={{ flexShrink: 0, marginTop: 1 }} /><span>{error}</span></div>}
        <button className="btn btn-primary btn-block login-btn" type="submit" disabled={busy}>
          {busy ? <><Loader2 size={18} className="spin" /> {needsCode ? 'Sending code…' : 'Creating your shop…'}</> : <>{needsCode ? 'Continue' : 'Create my shop'} <ArrowRight size={18} /></>}
        </button>
        {info.data?.verifyPhone ? <p className="small muted" style={{ textAlign: 'center', margin: 0 }}>We’ll send a code by SMS to confirm your mobile number.</p>
          : needsCode && <p className="small muted" style={{ textAlign: 'center', margin: 0 }}>We’ll email you a code to confirm your address.</p>}
        <p className="small muted" style={{ textAlign: 'center', margin: 0 }}>By creating a shop you agree to the <Link to="/terms">terms of use</Link> and <Link to="/privacy">privacy policy</Link>.</p>
        <p className="small muted" style={{ textAlign: 'center', margin: 0 }}>Already have an account? <Link to="/login" style={{ fontWeight: 600 }}>Sign in</Link></p>
      </form>
    </AuthShell>
  );
}
