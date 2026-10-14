import { useState, type FormEvent } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { AlertCircle, ArrowRight, Loader2, Mail, KeyRound, Languages } from 'lucide-react';
import { homeFor, useAuth } from '@/context/AuthContext';
import { usePrefs } from '@/context/PrefsContext';
import { useToast } from '@/context/ToastContext';
import { api, ApiError } from '@/api/client';
import { EMAIL_RE } from '@/lib/format';
import { Field, Modal } from '@/components/ui';
import { PasswordInput } from '@/components/PasswordInput';
import { FullPageSpinner } from '@/components/ProtectedRoute';
import { LANGS } from '@/i18n';
import { AuthShell } from './AuthShell';

const DEMO: Array<[string, string, string]> = [
  ['Shop owner', 'owner@shop.com', 'owner123'],
  ['Super admin', 'admin@ledgerly.in', 'admin123'],
  ['Sales staff', 'sales@shop.com', 'sales123'],
];

export default function Login() {
  const { me, loading: authLoading, login } = useAuth();
  const { t, lang, setLang } = usePrefs();
  const toast = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from;

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(true);
  const [touched, setTouched] = useState({ email: false, password: false });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [forgotOpen, setForgotOpen] = useState(false);
  const [forgotEmail, setForgotEmail] = useState('');
  const [forgotTouched, setForgotTouched] = useState(false);
  const [forgotBusy, setForgotBusy] = useState(false);
  const [devLink, setDevLink] = useState('');

  if (authLoading) return <FullPageSpinner />;
  if (me) return <Navigate to={from && from.startsWith(homeFor(me)) ? from : homeFor(me)} replace />;

  const emailErr = !email ? 'Email is required' : !EMAIL_RE.test(email) ? 'Enter a valid email address' : '';
  const passErr = !password ? 'Password is required' : '';

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setTouched({ email: true, password: true });
    setError('');
    if (emailErr || passErr) return;
    setLoading(true);
    try {
      // The server decides whether this is a Super Admin or a shop account.
      const m = await login(email, password, remember);
      toast('success', 'Welcome back!', m.kind === 'super' ? 'Signed in to the platform console.' : `Signed in to ${m.shop.name}.`);
      navigate(from && from.startsWith(homeFor(m)) ? from : homeFor(m), { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Sign-in failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const forgotErr = !forgotEmail ? 'Email is required' : !EMAIL_RE.test(forgotEmail) ? 'Enter a valid email address' : '';
  const sendReset = async () => {
    setForgotTouched(true);
    if (forgotErr) return;
    setForgotBusy(true);
    try {
      const r = await api.post<{ ok: boolean; devResetUrl?: string }>('/auth/forgot', { email: forgotEmail });
      if (r.devResetUrl) setDevLink(r.devResetUrl);
      else {
        setForgotOpen(false);
        toast('success', 'Check your email', `If an account exists for ${forgotEmail}, a reset link is on its way.`);
      }
    } catch (err) {
      toast('error', err instanceof ApiError ? err.message : 'Could not send the link');
    } finally {
      setForgotBusy(false);
    }
  };

  return (
    <AuthShell>
      <div className="row between" style={{ marginBottom: 18 }}>
        <span />
        <label className="row small muted" style={{ gap: 6 }}>
          <Languages size={14} />
          <select className="select" style={{ height: 30, width: 'auto', fontSize: 12.5 }} value={lang} onChange={(e) => setLang(e.target.value as typeof lang)} aria-label="Language">
            {LANGS.map((l) => <option key={l.id} value={l.id}>{l.native}</option>)}
          </select>
        </label>
      </div>
      <h1>{t('login.title')}</h1>
      <p className="lead">{t('login.lead')}</p>

      <form className="login-form" onSubmit={submit} noValidate>
        <Field label={t('login.email')} required error={touched.email ? emailErr : ''}>
          <div className="input-group">
            <span className="lead"><Mail size={16} /></span>
            <input className={`input ${touched.email && emailErr ? 'invalid' : ''}`} type="email" autoComplete="email" placeholder="you@company.com" value={email} onChange={(e) => setEmail(e.target.value)} onBlur={() => setTouched((x) => ({ ...x, email: true }))} style={{ height: 44 }} autoFocus />
          </div>
        </Field>
        <Field label={t('login.password')} required error={touched.password ? passErr : ''}>
          <PasswordInput value={password} onChange={setPassword} invalid={touched.password && !!passErr} />
        </Field>
        <div className="row between small">
          <label className="row" style={{ gap: 8, cursor: 'pointer', color: 'var(--ink-600)' }}>
            <input type="checkbox" className="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} /> {t('login.remember')}
          </label>
          <a href="#" onClick={(e) => { e.preventDefault(); setForgotEmail(email); setForgotTouched(false); setDevLink(''); setForgotOpen(true); }} style={{ fontWeight: 600 }}>
            {t('login.forgot')}
          </a>
        </div>
        {error && (
          <div className="login-alert" role="alert">
            <AlertCircle size={17} style={{ flexShrink: 0, marginTop: 1 }} />
            <span>{error}</span>
          </div>
        )}
        <button className="btn btn-primary btn-block login-btn" type="submit" disabled={loading}>
          {loading ? <><Loader2 size={18} className="spin" /> {t('login.signingIn')}</> : <>{t('login.submit')} <ArrowRight size={18} /></>}
        </button>
      </form>

      <div className="demo-creds">
        <div style={{ fontWeight: 700, color: 'var(--ink-800)', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
          <KeyRound size={14} /> Demo accounts
        </div>
        {DEMO.map(([who, e, p]) => (
          <div key={e} className="row between" style={{ marginTop: 3 }}>
            <span>{who} · {e} / {p}</span>
            <button type="button" onClick={() => { setEmail(e); setPassword(p); setError(''); }}>Use</button>
          </div>
        ))}
        <div className="small" style={{ marginTop: 8, color: 'var(--ink-500)' }}>Your role is detected from your account — no need to pick one.</div>
      </div>

      <Modal
        open={forgotOpen}
        onClose={() => setForgotOpen(false)}
        title="Reset your password"
        subtitle="We’ll email you a secure link that’s valid for 30 minutes."
        footer={
          devLink ? (
            <button className="btn btn-primary" onClick={() => setForgotOpen(false)}>Done</button>
          ) : (
            <>
              <button className="btn btn-secondary" onClick={() => setForgotOpen(false)}>{t('common.cancel')}</button>
              <button className="btn btn-primary" disabled={forgotBusy} onClick={sendReset}>{forgotBusy && <Loader2 size={15} className="spin" />} Send reset link</button>
            </>
          )
        }
      >
        {devLink ? (
          <div className="stack" style={{ gap: 10 }}>
            <p className="small muted">Email isn’t configured on this server (development mode), so here’s the link that would have been emailed:</p>
            <Link to={devLink.replace(/^https?:\/\/[^/]+/, '')} className="btn btn-secondary" onClick={() => setForgotOpen(false)}>Open reset link</Link>
          </div>
        ) : (
          <Field label={t('login.email')} required error={forgotTouched ? forgotErr : ''}>
            <input className={`input ${forgotTouched && forgotErr ? 'invalid' : ''}`} value={forgotEmail} onChange={(e) => setForgotEmail(e.target.value)} placeholder="you@company.com" autoFocus onKeyDown={(e) => e.key === 'Enter' && sendReset()} />
          </Field>
        )}
      </Modal>
    </AuthShell>
  );
}
