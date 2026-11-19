import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { FileText, KeyRound, ShieldCheck, Trash2, UserRound } from 'lucide-react';
import { api, ApiError, fieldErrors } from '@/api/client';
import { useAuth, useShopUser } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { Field, Modal, PageHeader } from '@/components/ui';
import { isStrongPassword, PASSWORD_RULE } from '../../../shared/permissions';
import { confirmsShopName, SHOP_RESTORE_DAYS } from '../../../shared/accountDeletion';

/** My account: who I am, the privacy links, and deleting my login or (for the owner) closing the shop. */
export default function Account() {
  const me = useShopUser();
  const isOwner = me.user.role === 'Owner';
  const [open, setOpen] = useState<null | 'me' | 'shop'>(null);
  const [pw, setPw] = useState(false);
  return (
    <div className="page" style={{ maxWidth: 720 }}>
      <PageHeader title="My account" icon={UserRound} />
      <div className="card" style={{ padding: 20 }}>
        <dl className="kv">
          <dt>Name</dt><dd>{me.user.name}</dd>
          <dt>Email</dt><dd>{me.user.email}</dd>
          <dt>Role</dt><dd>{me.user.role} · {me.shop.name}</dd>
        </dl>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginTop: 14 }}>
          <button className="btn btn-sm" onClick={() => setPw(true)}><KeyRound size={15} /> Change password</button>
          <Link className="btn btn-sm btn-ghost" to="/privacy"><ShieldCheck size={15} /> Privacy policy</Link>
          <Link className="btn btn-sm btn-ghost" to="/terms"><FileText size={15} /> Terms of use</Link>
        </div>
      </div>

      <div className="card" style={{ padding: 20, marginTop: 16, borderColor: 'var(--danger-200, #f3c1c1)' }}>
        <h3 style={{ margin: '0 0 6px' }}>{isOwner ? 'Close this shop' : 'Delete my login'}</h3>
        {isOwner ? (
          <p className="muted small" style={{ margin: 0 }}>
            Everyone in <strong>{me.shop.name}</strong> is signed out straight away. You have {SHOP_RESTORE_DAYS} days to change your mind through support; after that the
            names, emails and passwords of all its logins are erased. Bills and accounts are kept only as long as GST law requires. Download anything you need first.
          </p>
        ) : (
          <p className="muted small" style={{ margin: 0 }}>
            Your name, email and password are erased at once and you are signed out on every phone and computer. The bills you made stay with the shop.
          </p>
        )}
        <button className="btn btn-danger btn-sm" style={{ marginTop: 12 }} onClick={() => setOpen(isOwner ? 'shop' : 'me')}>
          <Trash2 size={15} /> {isOwner ? 'Close this shop…' : 'Delete my login…'}
        </button>
        <p className="small muted" style={{ marginTop: 10, marginBottom: 0 }}><Link to="/delete-account">What is deleted and what is kept</Link></p>
      </div>
      {pw && <PasswordModal onClose={() => setPw(false)} />}
      {open && <DeleteModal scope={open} shopName={me.shop.name} onClose={() => setOpen(null)} />}
    </div>
  );
}

function DeleteModal({ scope, shopName, onClose }: { scope: 'me' | 'shop'; shopName: string; onClose: () => void }) {
  const { logout } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const ready = password.length > 0 && (scope === 'me' || confirmsShopName(confirm, shopName));

  const submit = async () => {
    setBusy(true); setErrors({});
    try {
      await api.post('/auth/delete-account', { scope, password, confirm: scope === 'shop' ? confirm : undefined, reason: reason || undefined });
      await logout();
      toast('success', scope === 'shop' ? `${shopName} is closed` : 'Your login has been deleted', scope === 'shop' ? 'We’ve emailed you the details.' : undefined);
      navigate('/login', { replace: true });
    } catch (e) {
      const f = fieldErrors(e);
      setErrors(Object.keys(f).length ? f : { form: e instanceof ApiError ? e.message : 'Something went wrong. Try again.' });
    } finally { setBusy(false); }
  };

  return (
    <Modal open onClose={onClose} title={scope === 'shop' ? `Close ${shopName}?` : 'Delete your login?'}
      subtitle="This can’t be undone from the app."
      footer={<>
        <button className="btn" onClick={onClose} disabled={busy}>Keep it</button>
        <button className="btn btn-danger" onClick={submit} disabled={!ready || busy}>{busy ? 'Deleting…' : scope === 'shop' ? 'Close the shop' : 'Delete my login'}</button>
      </>}>
      <div className="stack" style={{ gap: 12 }}>
        {scope === 'shop' && (
          <Field label={<>Type the shop name <strong>{shopName}</strong> to confirm</>} error={errors.confirm}>
            <input className="input" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="off" autoCapitalize="off" />
          </Field>
        )}
        <Field label="Your password" error={errors.password}>
          <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password"
            onKeyDown={(e) => { if (e.key === 'Enter' && ready && !busy) void submit(); }} />
        </Field>
        <Field label="Why are you leaving? (optional)">
          <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} placeholder="Helps us improve" />
        </Field>
        {errors.form && <div className="login-alert" role="alert">{errors.form}</div>}
      </div>
    </Modal>
  );
}

function PasswordModal({ onClose }: { onClose: () => void }) {
  const { refresh } = useAuth();
  const toast = useToast();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const mismatch = again.length > 0 && again !== next;
  const ready = current.length > 0 && isStrongPassword(next) && next === again;
  const submit = async () => {
    setBusy(true); setErrors({});
    try {
      await api.post('/auth/change-password', { current, next });
      await refresh();
      toast('success', 'Password changed', 'You stay signed in here; other phones and computers are signed out.');
      onClose();
    } catch (e) {
      const f = fieldErrors(e);
      setErrors(Object.keys(f).length ? f : { form: e instanceof ApiError ? e.message : 'Something went wrong. Try again.' });
    } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} title="Change password"
      footer={<><button className="btn" onClick={onClose} disabled={busy}>Cancel</button>
        <button className="btn btn-primary" onClick={submit} disabled={!ready || busy}>{busy ? 'Saving…' : 'Change password'}</button></>}>
      <div className="stack" style={{ gap: 12 }}>
        <Field label="Current password" error={errors.current}>
          <input className="input" type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" />
        </Field>
        <Field label="New password" hint={PASSWORD_RULE} error={errors.next}>
          <input className="input" type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" />
        </Field>
        <Field label="New password again" error={mismatch ? 'Doesn’t match' : undefined}>
          <input className="input" type="password" value={again} onChange={(e) => setAgain(e.target.value)} autoComplete="new-password"
            onKeyDown={(e) => { if (e.key === 'Enter' && ready && !busy) void submit(); }} />
        </Field>
        {errors.form && <div className="login-alert" role="alert">{errors.form}</div>}
      </div>
    </Modal>
  );
}
