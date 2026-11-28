import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Save } from 'lucide-react';
import { api } from '@/api/client';
import { Badge, Field, Toggle } from '@/components/ui';
import { useToast } from '@/context/ToastContext';
import { GoogleMark } from '@/components/GoogleButton';

/** Super admin → Configuration → Google sign-in: the OAuth client ID and the switch for "Continue with Google". */
export function GoogleSignInCard() {
  const q = useQuery({ queryKey: ['platform', 'google-auth'], queryFn: () => api.get<{ clientId: string; enabled: boolean }>('/platform/google-auth') });
  const qc = useQueryClient();
  const toast = useToast();
  const [f, setF] = useState({ clientId: '', enabled: false });
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (q.data) setF(q.data); }, [q.data]);
  const origin = typeof window !== 'undefined' ? window.location.origin : 'https://corpus360lite.com';
  const save = async () => {
    setBusy(true);
    try { await api.put('/platform/google-auth', f); await qc.invalidateQueries({ queryKey: ['platform', 'google-auth'] }); await qc.invalidateQueries({ queryKey: ['authGoogle'] }); toast('success', 'Google sign-in saved', f.enabled ? '“Continue with Google” is on the sign-in and sign-up pages.' : 'Switched off.'); }
    catch (e) { toast('error', (e as Error).message); } finally { setBusy(false); }
  };
  return (
    <section className="card" id="google-sign-in">
      <div className="card-header">
        <div className="row" style={{ gap: 14 }}>
          <span className="stat-icon tone-sage" style={{ background: '#fff' }}><GoogleMark size={19} /></span>
          <div><h3>Google sign-in</h3><p>“Continue with Google” on the sign-in and sign-up pages of the website. Free.</p></div>
        </div>
        {q.data && <Badge tone={q.data.enabled ? 'green' : q.data.clientId ? 'amber' : 'gray'}>{q.data.enabled ? 'On' : q.data.clientId ? 'Set up, switched off' : 'Not set up'}</Badge>}
      </div>
      <div className="card-body stack" style={{ gap: 12 }}>
        <ol className="small muted" style={{ margin: 0, paddingLeft: 18, lineHeight: 1.7 }}>
          <li>In <a href="https://console.cloud.google.com/apis/credentials/consent" target="_blank" rel="noreferrer">Google Cloud → OAuth consent screen</a>: user type <b>External</b>, app name <b>Corpus360Lite</b>, your support email, then <b>Publish app</b>.</li>
          <li>In <a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noreferrer">Credentials</a> → <b>Create credentials → OAuth client ID</b> → <b>Web application</b>. Under <b>Authorised JavaScript origins</b> add <code>{origin}</code>. No redirect URI is needed.</li>
          <li>Copy the <b>Client ID</b> (ends in .apps.googleusercontent.com), paste it here, switch it on and Save. No client secret is needed.</li>
        </ol>
        <Field label="OAuth Client ID"><input className="input mono" style={{ width: 520, maxWidth: '100%' }} value={f.clientId} onChange={(e) => setF({ ...f, clientId: e.target.value.trim() })} placeholder="1234567890-abc123.apps.googleusercontent.com" /></Field>
        <Toggle checked={f.enabled} onChange={(v) => setF({ ...f, enabled: v })} label="Show “Continue with Google” on the website" />
        <div className="small muted">Shop owners and staff whose login email is a Google account can then sign in with one tap; new shops can sign up with Google (no email code needed). Super admins keep their password. The phone and Windows apps don’t show it (Google doesn’t allow its sign-in inside apps like these); they use email, password or mobile OTP.</div>
        <div><button className="btn btn-primary" disabled={busy} onClick={() => void save()}>{busy ? <Loader2 size={15} className="spin" /> : <Save size={15} />} Save</button></div>
      </div>
    </section>
  );
}
