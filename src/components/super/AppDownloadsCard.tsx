import { useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Smartphone, Trash2, Upload, MonitorDown } from 'lucide-react';
import { api } from '@/api/client';
import { Badge, Field } from '@/components/ui';
import { useToast } from '@/context/ToastContext';
import type { AppsInfo } from '@/components/AppDownloads';
import { WINDOWS_DOWNLOAD } from '@/lib/platform';

const readBase64 = (f: File) => new Promise<string>((res, rej) => {
  const r = new FileReader();
  r.onload = () => res(String(r.result).replace(/^data:[^,]*,/, ''));
  r.onerror = () => rej(r.error); r.readAsDataURL(f);
});

/**
 * Super admin → Configuration → Apps on the website. The Windows installer is built with the server. The Android app:
 * upload each new .apk here (it is kept in the database, so server updates never lose it) and, once the app is live
 * on Google Play, paste its link: the website then sends Android phones to the Play Store.
 */
export function AppDownloadsCard() {
  const q = useQuery({ queryKey: ['platform', 'app-downloads'], queryFn: () => api.get<AppsInfo>('/platform/app-downloads') });
  const qc = useQueryClient();
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState('');
  const [play, setPlay] = useState<string | null>(null);
  const a = q.data?.android;
  const save = async (what: string, body: Record<string, unknown>, ok: string) => {
    setBusy(what);
    try {
      await api.put('/platform/app-downloads/android', body);
      await qc.invalidateQueries({ queryKey: ['platform', 'app-downloads'] });
      qc.invalidateQueries({ queryKey: ['public', 'apps'] });
      toast('success', ok);
    } catch (e) { toast('error', (e as Error).message); } finally { setBusy(''); }
  };
  const upload = async (f: File | undefined) => {
    if (!f) return;
    if (!/\.apk$/i.test(f.name)) return toast('error', 'Choose the .apk file', 'The .aab file is for the Play Console; phones install the .apk.');
    await save('upload', { fileBase64: await readBase64(f), fileName: f.name }, `${f.name} is now on the website`);
    if (fileRef.current) fileRef.current.value = '';
  };
  return (
    <section className="card">
      <div className="card-header">
        <div className="row" style={{ gap: 14 }}>
          <span className="stat-icon tone-sage"><Smartphone size={19} /></span>
          <div>
            <h3>Apps on the website</h3>
            <p>“Download for Windows” and “Get the Android app” on the home page and in every shop’s account menu.</p>
          </div>
        </div>
        {a && <Badge tone={a.playUrl || a.apk ? 'green' : 'amber'}>{a.playUrl ? 'Android: Play Store' : a.apk ? `Android ${a.apk.version || 'app'}` : 'Android: not added'}</Badge>}
      </div>
      <div className="card-body stack" style={{ gap: 14 }}>
        <div className="small"><MonitorDown size={14} style={{ verticalAlign: -2 }} /> <strong>Windows:</strong> built with every server update, nothing to do. <a href={WINDOWS_DOWNLOAD} download>Download to check</a></div>
        <div className="small">
          <Smartphone size={14} style={{ verticalAlign: -2 }} /> <strong>Android app file:</strong>{' '}
          {a?.apk ? <>CorpusLite {a.apk.version} · {(a.apk.bytes / 1_048_576).toFixed(1)} MB · <a href={a.apk.url} download>download to check</a></> : <span className="muted">none yet. Upload the signed .apk so visitors can install it.</span>}
        </div>
        <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
          <input ref={fileRef} type="file" accept=".apk,application/vnd.android.package-archive" hidden onChange={(e) => void upload(e.target.files?.[0])} />
          <button className="btn btn-secondary" disabled={!!busy} onClick={() => fileRef.current?.click()}>{busy === 'upload' ? <Loader2 size={15} className="spin" /> : <Upload size={15} />} {a?.apk ? 'Upload a new version (.apk)' : 'Upload the app (.apk)'}</button>
          {a?.apk && <button className="btn btn-ghost" disabled={!!busy} onClick={() => window.confirm('Take the Android app file off the website?') && void save('remove', { removeFile: true }, 'Android app file removed')}><Trash2 size={15} /> Remove file</button>}
        </div>
        <div className="row" style={{ gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <Field label="Google Play link (once the app is live there)" hint="Android phones then go to the Play Store, which keeps the app updated by itself.">
            <input className="input" style={{ width: 420, maxWidth: '100%' }} placeholder="https://play.google.com/store/apps/details?id=in.corpus360.lite" value={play ?? a?.playUrl ?? ''} onChange={(e) => setPlay(e.target.value)} />
          </Field>
          <button className="btn btn-secondary" disabled={!!busy || play === null || play === (a?.playUrl ?? '')} onClick={() => void save('play', { playUrl: (play ?? '').trim() }, (play ?? '').trim() ? 'Play Store link saved' : 'Play Store link removed').then(() => setPlay(null))}>
            {busy === 'play' && <Loader2 size={15} className="spin" />} Save link
          </button>
        </div>
      </div>
    </section>
  );
}
