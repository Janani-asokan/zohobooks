import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { AlertCircle, CheckCircle2, Loader2 } from 'lucide-react';
import { api, ApiError } from '@/api/client';
import { useToast } from '@/context/ToastContext';
import { Field } from '@/components/ui';
import { PasswordInput } from '@/components/PasswordInput';
import { isStrongPassword, PASSWORD_RULE } from '../../shared/permissions';
import { AuthShell } from './AuthShell';

export default function ResetPassword() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const navigate = useNavigate();
  const toast = useToast();
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const pwErr = !isStrongPassword(pw) ? PASSWORD_RULE : '';
  const matchErr = pw2 !== pw ? 'Passwords don’t match' : '';

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    setError('');
    if (pwErr || matchErr) return;
    setBusy(true);
    try {
      await api.post('/auth/reset', { token, password: pw });
      toast('success', 'Password updated', 'Sign in with your new password.');
      navigate('/login', { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not reset the password');
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell>
      <h1>Choose a new password</h1>
      <p className="lead">For your security, all your other sessions will be signed out.</p>
      {!token ? (
        <div className="login-alert"><AlertCircle size={17} /> This link is incomplete. Request a new one from the sign-in page.</div>
      ) : (
        <form className="login-form" onSubmit={submit} noValidate>
          <Field label="New password" required error={touched ? pwErr : ''} hint={PASSWORD_RULE}>
            <PasswordInput value={pw} onChange={setPw} invalid={touched && !!pwErr} autoComplete="new-password" placeholder="New password" meter autoFocus />
          </Field>
          <Field label="Confirm password" required error={touched ? matchErr : ''}>
            <PasswordInput value={pw2} onChange={setPw2} invalid={touched && !!matchErr} autoComplete="new-password" placeholder="Repeat new password" />
          </Field>
          {error && <div className="login-alert" role="alert"><AlertCircle size={17} /> <span>{error}</span></div>}
          <button className="btn btn-primary btn-block login-btn" type="submit" disabled={busy}>
            {busy ? <Loader2 size={18} className="spin" /> : <CheckCircle2 size={18} />} Update password
          </button>
        </form>
      )}
      <p className="small" style={{ marginTop: 20 }}><Link to="/login">← Back to sign in</Link></p>
    </AuthShell>
  );
}
