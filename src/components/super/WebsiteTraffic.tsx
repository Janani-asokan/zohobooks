import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Globe2, KeyRound, Loader2, RefreshCw, Save, Trash2, Upload } from 'lucide-react';
import { api } from '@/api/client';
import { AreaChart } from '@/components/charts';
import { Badge, Field } from '@/components/ui';
import { useToast } from '@/context/ToastContext';

interface Traffic {
  configured: boolean; error?: string; liveNow?: number; at?: string;
  totals?: Record<'today' | 'week' | 'month', { users: number; newUsers: number; sessions: number; views: number }>;
  daily?: Array<{ date: string; users: number }>;
  pages?: Array<{ path: string; views: number; users: number }>;
  sources?: Array<{ source: string; sessions: number }>;
  events?: { signUps: number; leads: number; logins: number };
}

const n = (v: number) => v.toLocaleString('en-IN');
/** /app/sales/invoices/:id → "App › Sales › Invoices", / → "Home page". */
const PAGE_NAMES: Record<string, string> = { '/': 'Home page', '/login': 'Sign in', '/signup': 'Sign up', '/privacy': 'Privacy policy', '/terms': 'Terms', '/app': 'Shop dashboard', '/super-admin': 'Super admin' };
const pageName = (p: string) => PAGE_NAMES[p] ?? p.replace(/^\//, '').split('/').filter((s) => s !== ':id').map((s) => s.replace(/-/g, ' ')).map((s) => s[0]?.toUpperCase() + s.slice(1)).join(' › ');

/** Super admin dashboard: website visitors from Google Analytics. Set up in Configuration → Website traffic. */
export function WebsiteTrafficCard() {
  const qc = useQueryClient();
  const [fresh, setFresh] = useState(false);
  const q = useQuery({ queryKey: ['platform', 'ga-traffic'], queryFn: () => api.get<Traffic>(`/platform/ga/traffic${fresh ? '?fresh=1' : ''}`), refetchInterval: 5 * 60_000, staleTime: 60_000 });
  const t = q.data;
  const refresh = async () => { setFresh(true); await qc.invalidateQueries({ queryKey: ['platform', 'ga-traffic'] }); setFresh(false); };

  const header = (
    <div className="card-header">
      <div className="row" style={{ gap: 14 }}>
        <span className="stat-icon tone-sage"><Globe2 size={19} /></span>
        <div><h3>Website traffic</h3><p>Visitors to corpus360lite.com, from Google Analytics</p></div>
      </div>
      {t?.configured && !t.error && (
        <div className="row" style={{ gap: 8 }}>
          <Badge tone={(t.liveNow ?? 0) > 0 ? 'green' : 'gray'}>{n(t.liveNow ?? 0)} on the site now</Badge>
          <button className="btn btn-ghost btn-sm" title="Refresh" aria-label="Refresh" disabled={q.isFetching} onClick={() => void refresh()}>{q.isFetching ? <Loader2 size={15} className="spin" /> : <RefreshCw size={15} />}</button>
        </div>
      )}
    </div>
  );

  if (q.isLoading) return <div className="card mt-16">{header}<div className="card-body"><div className="skeleton" style={{ height: 120 }} /></div></div>;
  if (!t?.configured) {
    return (
      <div className="card mt-16">{header}
        <div className="card-body small muted">See visitors, top pages, where they come from and website sign-ups here. Set it up once in <Link to="/super-admin/configuration#website-traffic">Configuration → Website traffic</Link>.</div>
      </div>
    );
  }
  if (t.error) {
    return (
      <div className="card mt-16">{header}
        <div className="card-body small"><span style={{ color: 'var(--red-600, #b3261e)' }}>{t.error}</span> <Link to="/super-admin/configuration#website-traffic">Check the settings</Link></div>
      </div>
    );
  }
  const tot = t.totals!;
  const daily = t.daily ?? [];
  const maxSrc = Math.max(1, ...(t.sources ?? []).map((s) => s.sessions));
  const stats: Array<[string, string, string]> = [
    ['Visitors today', n(tot.today.users), `${n(tot.today.views)} page views`],
    ['Last 7 days', n(tot.week.users), `${n(tot.week.newUsers)} new`],
    ['Last 28 days', n(tot.month.users), `${n(tot.month.sessions)} visits`],
    ['Sign-ups (28 days)', n(t.events?.signUps ?? 0), `${n(t.events?.leads ?? 0)} call-back requests`],
  ];
  return (
    <div className="card mt-16">
      {header}
      <div className="card-body stack" style={{ gap: 18 }}>
        <div className="traffic-stats">
          {stats.map(([l, v, f]) => <div key={l} className="traffic-stat"><div className="small muted">{l}</div><div className="traffic-num">{v}</div><div className="small muted">{f}</div></div>)}
        </div>
        {daily.length > 1 && <AreaChart name="Visitors per day" labels={daily.map((d) => new Date(d.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }))} tickEvery={7} values={daily.map((d) => d.users)} format={(v) => n(Math.round(v))} height={180} />}
        <div className="grid-2">
          <div>
            <div className="small strong" style={{ marginBottom: 8 }}>Top pages · last 7 days</div>
            {(t.pages ?? []).length === 0 && <div className="small muted">No page views yet.</div>}
            <div className="stack" style={{ gap: 6 }}>
              {(t.pages ?? []).map((p) => (
                <div key={p.path} className="row between small" title={p.path}>
                  <span className="truncate" style={{ maxWidth: '75%' }}>{pageName(p.path)}</span><span className="muted">{n(p.views)} views</span>
                </div>
              ))}
            </div>
          </div>
          <div>
            <div className="small strong" style={{ marginBottom: 8 }}>Where visitors come from · 28 days</div>
            {(t.sources ?? []).length === 0 && <div className="small muted">No visits yet.</div>}
            <div className="stack" style={{ gap: 8 }}>
              {(t.sources ?? []).map((s) => (
                <div key={s.source} className="small">
                  <div className="row between"><span>{s.source === 'Unassigned' ? 'Other' : s.source}</span><span className="muted">{n(s.sessions)}</span></div>
                  <div className="traffic-bar"><span style={{ width: `${(s.sessions / maxSrc) * 100}%` }} /></div>
                </div>
              ))}
            </div>
          </div>
        </div>
        {t.at && <div className="small muted">Updated {new Date(t.at).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}. Google Analytics can take a few hours to count new visits (except “on the site now”).</div>}
      </div>
    </div>
  );
}

interface GaView { configured: boolean; propertyId: string; clientEmail: string }

/** Super admin → Configuration → Website traffic: GA4 property ID and the service account's JSON key. */
export function GaSettingsCard() {
  const q = useQuery({ queryKey: ['platform', 'ga'], queryFn: () => api.get<GaView>('/platform/ga') });
  const qc = useQueryClient();
  const toast = useToast();
  const [propertyId, setPropertyId] = useState('');
  const [keyJson, setKeyJson] = useState('');
  const [keyName, setKeyName] = useState('');
  const [busy, setBusy] = useState('');
  const [check, setCheck] = useState<{ ok: boolean; text: string } | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const s = q.data;
  useEffect(() => { if (s) setPropertyId(s.propertyId); }, [s]);
  useEffect(() => { if (location.hash === '#website-traffic') document.getElementById('website-traffic')?.scrollIntoView({ behavior: 'smooth' }); }, []);

  const pick = async (f: File | undefined) => {
    if (!f) return;
    if (f.size > 20_000) { toast('error', 'That file is too big to be a key file'); return; }
    setKeyJson(await f.text()); setKeyName(f.name);
  };
  const runCheck = async () => {
    const r = await api.get<Traffic>('/platform/ga/traffic?fresh=1');
    setCheck(r.error ? { ok: false, text: r.error } : { ok: true, text: `Connected. ${n(r.totals?.month.users ?? 0)} visitors in the last 28 days, ${n(r.liveNow ?? 0)} on the site now.` });
    await qc.invalidateQueries({ queryKey: ['platform', 'ga-traffic'] });
  };
  const save = async () => {
    setBusy('save'); setCheck(null);
    try {
      await api.put('/platform/ga', { propertyId, ...(keyJson ? { keyJson } : {}) });
      setKeyJson(''); setKeyName('');
      await qc.invalidateQueries({ queryKey: ['platform', 'ga'] });
      toast('success', 'Website traffic settings saved');
      await runCheck();
    } catch (e) { toast('error', (e as Error).message); } finally { setBusy(''); }
  };
  const test = async () => { setBusy('test'); setCheck(null); try { await runCheck(); } catch (e) { setCheck({ ok: false, text: (e as Error).message }); } finally { setBusy(''); } };
  const remove = async () => {
    setBusy('remove');
    try { await api.del('/platform/ga'); setPropertyId(''); setCheck(null); await qc.invalidateQueries({ queryKey: ['platform'] }); toast('success', 'Website traffic disconnected'); }
    catch (e) { toast('error', (e as Error).message); } finally { setBusy(''); }
  };

  return (
    <section className="card" id="website-traffic">
      <div className="card-header">
        <div className="row" style={{ gap: 14 }}>
          <span className="stat-icon tone-sage"><Globe2 size={19} /></span>
          <div><h3>Website traffic (Google Analytics)</h3><p>Shows visitors, top pages and sources on the dashboard. Free.</p></div>
        </div>
        {s && <Badge tone={s.configured ? 'green' : 'gray'}>{s.configured ? 'Connected' : 'Not set up'}</Badge>}
      </div>
      <div className="card-body stack" style={{ gap: 12 }}>
        <ol className="small muted" style={{ margin: 0, paddingLeft: 18, lineHeight: 1.7 }}>
          <li>In <a href="https://console.cloud.google.com/" target="_blank" rel="noreferrer">Google Cloud Console</a>, create a project (or pick one), open <b>APIs &amp; Services → Library</b> and enable <b>Google Analytics Data API</b>.</li>
          <li>Open <b>IAM &amp; Admin → Service accounts → Create service account</b> (any name, no roles needed). Then <b>Keys → Add key → Create new key → JSON</b>; a .json file downloads.</li>
          <li>In <b>Google Analytics → Admin → Property access management</b>, add the service account’s email (…iam.gserviceaccount.com) as a <b>Viewer</b>.</li>
          <li>Copy the <b>Property ID</b> from Analytics → Admin → Property details (a number, not G-…), choose the .json file below and Save.</li>
        </ol>
        <div className="row" style={{ gap: 10, flexWrap: 'wrap', alignItems: 'flex-start' }}>
          <Field label="GA4 property ID"><input className="input mono" inputMode="numeric" style={{ width: 200 }} value={propertyId} onChange={(e) => setPropertyId(e.target.value.replace(/\D/g, ''))} placeholder="e.g. 512345678" /></Field>
          <Field label="Service account JSON key" hint={s?.clientEmail ? `Saved: ${s.clientEmail}. Choose a file only to replace it.` : 'The .json file from step 2. It stays on the server.'}>
            <div className="row" style={{ gap: 8 }}>
              <button type="button" className="btn btn-secondary" onClick={() => file.current?.click()}>{keyName ? <KeyRound size={15} /> : <Upload size={15} />} {keyName || 'Choose .json file'}</button>
              <input ref={file} type="file" accept="application/json,.json" hidden onChange={(e) => { void pick(e.target.files?.[0]); e.target.value = ''; }} />
            </div>
          </Field>
        </div>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <button className="btn btn-primary" disabled={!!busy || !propertyId || (!keyJson && !s?.configured)} onClick={() => void save()}>{busy === 'save' ? <Loader2 size={15} className="spin" /> : <Save size={15} />} Save and check</button>
          {s?.configured && <button className="btn btn-secondary" disabled={!!busy} onClick={() => void test()}>{busy === 'test' ? <Loader2 size={15} className="spin" /> : <RefreshCw size={15} />} Check connection</button>}
          {s?.configured && <button className="btn btn-ghost" disabled={!!busy} onClick={() => void remove()}><Trash2 size={15} /> Disconnect</button>}
        </div>
        {check && <div className="small" style={{ color: check.ok ? 'var(--green-700, #2f6b45)' : 'var(--red-600, #b3261e)' }}>{check.text}</div>}
      </div>
    </section>
  );
}
