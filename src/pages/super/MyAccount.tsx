import { useState } from 'react';
import { KeyRound, Loader2, Mail, Save } from 'lucide-react';
import { api, ApiError } from '@/api/client';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { Field, PageHeader } from '@/components/ui';
import { PasswordInput } from '@/components/PasswordInput';
import { PASSWORD_RULE, isStrongPassword } from '../../../shared/permissions';

/** Super admin → My account: the console sign-in email and password. Both need the current password. */
export default function MyAccount() {
  const { me, refresh } = useAuth();
  const toast = useToast();
  const [email, setEmail] = useState({ to: '', password: '', err: {} as Record<string, string>, busy: false });
  const [pw, setPw] = useState({ current: '', next: '', again: '', err: {} as Record<string, string>, busy: false });

  const saveEmail = async () => {
    setEmail((x) => ({ ...x, busy: true, err: {} }));
    try {
      await api.post('/auth/change-email', { email: email.to, password: email.password });
      await refresh();
      toast('success', 'Email changed', `Sign in with ${email.to.trim().toLowerCase()} from now on. Other devices were signed out.`);
      setEmail({ to: '', password: '', err: {}, busy: false });
    } catch (e) {
      setEmail((x) => ({ ...x, busy: false, err: (e instanceof ApiError && e.details) || { form: (e as Error).message } }));
    }
  };
  const savePw = async () => {
    if (pw.next !== pw.again) return setPw((x) => ({ ...x, err: { again: 'The two new passwords don’t match' } }));
    if (!isStrongPassword(pw.next)) return setPw((x) => ({ ...x, err: { next: PASSWORD_RULE } }));
    setPw((x) => ({ ...x, busy: true, err: {} }));
    try {
      await api.post('/auth/change-password', { current: pw.current, next: pw.next });
      toast('success', 'Password changed', 'Other devices were signed out.');
      setPw({ current: '', next: '', again: '', err: {}, busy: false });
    } catch (e) {
      setPw((x) => ({ ...x, busy: false, err: (e instanceof ApiError && e.details) || { current: (e as Error).message } }));
    }
  };

  return (
    <div className="page" style={{ maxWidth: 720 }}>
      <PageHeader title="My account" subtitle={`Signed in as ${me?.user.email ?? ''}`} />
      <section className="card" style={{ marginBottom: 16 }}>
        <div className="card-header"><div className="row" style={{ gap: 12 }}><span className="stat-icon tone-sage"><Mail size={18} /></span><div><h3>Sign-in email</h3><p>Password resets and console alerts go here.</p></div></div></div>
        <div className="card-body stack" style={{ gap: 12 }}>
          <Field label="New email" error={email.err.email}><input className="input" type="email" autoComplete="email" value={email.to} onChange={(e) => setEmail({ ...email, to: e.target.value })} placeholder="you@example.com" /></Field>
          <Field label="Current password" error={email.err.password}><PasswordInput value={email.password} onChange={(v) => setEmail({ ...email, password: v })} /></Field>
          {email.err.form && <div className="small" style={{ color: 'var(--danger)' }}>{email.err.form}</div>}
          <div><button className="btn btn-primary" disabled={!email.to || !email.password || email.busy} onClick={() => void saveEmail()}>{email.busy ? <Loader2 size={15} className="spin" /> : <Save size={15} />} Change email</button></div>
        </div>
      </section>
      <section className="card">
        <div className="card-header"><div className="row" style={{ gap: 12 }}><span className="stat-icon tone-rose"><KeyRound size={18} /></span><div><h3>Password</h3><p>{PASSWORD_RULE}</p></div></div></div>
        <div className="card-body stack" style={{ gap: 12 }}>
          <Field label="Current password" error={pw.err.current}><PasswordInput value={pw.current} onChange={(v) => setPw({ ...pw, current: v })} /></Field>
          <Field label="New password" error={pw.err.next}><PasswordInput value={pw.next} onChange={(v) => setPw({ ...pw, next: v })} autoComplete="new-password" meter /></Field>
          <Field label="New password again" error={pw.err.again}><PasswordInput value={pw.again} onChange={(v) => setPw({ ...pw, again: v })} autoComplete="new-password" /></Field>
          <div><button className="btn btn-primary" disabled={!pw.current || !pw.next || pw.busy} onClick={() => void savePw()}>{pw.busy ? <Loader2 size={15} className="spin" /> : <Save size={15} />} Change password</button></div>
        </div>
      </section>
    </div>
  );
}
