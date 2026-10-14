import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { AlertCircle, Loader2, ShieldCheck } from 'lucide-react';
import { api, ApiError, fieldErrors } from '@/api/client';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { Field } from '@/components/ui';
import { PasswordInput } from '@/components/PasswordInput';
import { isStrongPassword, PASSWORD_RULE } from '../../shared/permissions';
import type { Me } from '@/api/types';
import { AuthShell } from './AuthShell';

/** Shown on first sign-in with a temporary password (new shop owners and invited staff). */
export default function ForcePasswordChange() {
  const { me, logout } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [fields, setFields] = useState<Record<string, string>>({});

  const nextErr = !isStrongPassword(next) ? PASSWORD_RULE : '';

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    setError('');
    if (!current || nextErr) return;
    setBusy(true);
    try {
      const m = await api.post<Me>('/auth/change-password', { current, next });
      qc.setQueryData(['me'], m);
      toast('success', 'Password set', 'Welcome to your workspace!');
    } catch (err) {
      setFields(fieldErrors(err));
      setError(err instanceof ApiError ? err.message : 'Could not change the password');
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell>
      <span className="stat-icon tone-green" style={{ marginBottom: 16 }}><ShieldCheck size={20} /></span>
      <h1>Set your own password</h1>
      <p className="lead">Hi {me?.user.name.split(' ')[0]}, you signed in with a temporary password. Choose a new one to continue.</p>
      <form className="login-form" onSubmit={submit} noValidate>
        <Field label="Temporary password" required error={(touched && !current ? 'Required' : '') || fields.current}>
          <PasswordInput value={current} onChange={setCurrent} invalid={touched && !current} autoFocus />
        </Field>
        <Field label="New password" required error={(touched ? nextErr : '') || fields.next} hint={PASSWORD_RULE}>
          <PasswordInput value={next} onChange={setNext} invalid={touched && !!nextErr} autoComplete="new-password" placeholder="New password" meter />
        </Field>
        {error && <div className="login-alert" role="alert"><AlertCircle size={17} /> <span>{error}</span></div>}
        <button className="btn btn-primary btn-block login-btn" type="submit" disabled={busy}>{busy && <Loader2 size={18} className="spin" />} Save and continue</button>
      </form>
      <p className="small" style={{ marginTop: 20 }}>
        <a href="#" onClick={async (e) => { e.preventDefault(); await logout(); navigate('/login'); }}>Sign out</a>
      </p>
    </AuthShell>
  );
}
