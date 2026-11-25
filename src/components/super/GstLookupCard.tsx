import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { BadgeCheck, Loader2, Plus, Save, Search, Trash2 } from 'lucide-react';
import { api } from '@/api/client';
import { Badge, Field } from '@/components/ui';
import { useToast } from '@/context/ToastContext';

interface Saved { source: 'settings' | 'env' | null; kind: 'custom' | 'sandbox'; url: string; method: 'GET' | 'POST'; headerNames: string[]; body: string; sandbox: { env: 'live' | 'test'; keyEnd: string; hasSecret: boolean } | null }
interface TestResult { ok: boolean; status?: number; error?: string; reply?: string; taxpayer?: { legalName: string; tradeName: string; status: string; address: string } | null }

/**
 * Super admin → Configuration → GST number lookup. Validate next to a GSTIN fills the company name and address from
 * the GST register through a lookup provider (they sell lookups; most give free trial credits). Any provider works:
 * its address (with {gstin} where the number goes), GET or POST, its key header(s) and, for POST, the body.
 */
export function GstLookupCard() {
  const q = useQuery({ queryKey: ['platform', 'gst-lookup'], queryFn: () => api.get<Saved>('/platform/gst-lookup') });
  const qc = useQueryClient();
  const toast = useToast();
  const [f, setF] = useState({ url: '', method: 'GET' as 'GET' | 'POST', body: '', headers: [{ name: 'x-api-key', value: '' }] });
  const [kind, setKind] = useState<'sandbox' | 'custom'>('sandbox');
  const [sb, setSb] = useState({ apiKey: '', apiSecret: '', env: 'live' as 'live' | 'test' });
  const [busy, setBusy] = useState('');
  const [gstin, setGstin] = useState('');
  const [test, setTest] = useState<TestResult | null>(null);
  const s = q.data;
  useEffect(() => {
    if (s?.source === 'settings') setKind(s.kind);
    if (s?.sandbox) setSb((x) => ({ ...x, env: s.sandbox!.env }));
    if (s?.source === 'settings' && s.kind === 'custom') setF({ url: s.url, method: s.method, body: s.body, headers: s.headerNames.length ? s.headerNames.map((name) => ({ name, value: '' })) : [{ name: 'x-api-key', value: '' }] });
  }, [s]);
  const save = async (clear = false) => {
    setBusy(clear ? 'clear' : 'save');
    try {
      await api.put('/platform/gst-lookup', clear ? { clear: true } : kind === 'sandbox' ? { kind, sandbox: sb } : { kind, ...f, headers: f.headers.filter((h) => h.name.trim()) });
      setSb((x) => ({ ...x, apiKey: '', apiSecret: '' }));
      await qc.invalidateQueries({ queryKey: ['platform', 'gst-lookup'] });
      toast('success', clear ? 'GST lookup turned off' : 'GST lookup saved', clear ? undefined : 'Press Test with a real GSTIN to check it.');
    } catch (e) { toast('error', (e as Error).message); } finally { setBusy(''); }
  };
  const runTest = async () => {
    setBusy('test'); setTest(null);
    try { setTest(await api.post<TestResult>('/platform/gst-lookup/test', { gstin })); }
    catch (e) { setTest({ ok: false, error: (e as Error).message }); } finally { setBusy(''); }
  };
  const setHeader = (i: number, k: 'name' | 'value', v: string) => setF({ ...f, headers: f.headers.map((h, j) => (j === i ? { ...h, [k]: v } : h)) });
  return (
    <section className="card">
      <div className="card-header">
        <div className="row" style={{ gap: 14 }}>
          <span className="stat-icon tone-gold"><Search size={19} /></span>
          <div>
            <h3>GST number lookup</h3>
            <p>Validate next to a GST number fills the company name, address and status from the GST register.</p>
          </div>
        </div>
        {s && <Badge tone={s.source ? 'green' : 'amber'}>{s.source === 'settings' ? 'On' : s.source === 'env' ? 'On (server setting)' : 'Off: number check only'}</Badge>}
      </div>
      <div className="card-body stack" style={{ gap: 12 }}>
        {!s?.source && (
          <div className="small" style={{ background: 'var(--ink-50)', borderRadius: 10, padding: 12 }}>
            <strong>Without a provider, Validate checks the number (state, PAN, typo) but can’t fill the name and address.</strong> Shop users get a
            “Find on GST portal” button instead. The GST portal has no free API, so sign up with a GSTIN verification provider (most give free trial
            credits, then about ₹0.5–₹2 a lookup; each number is looked up once and kept for 30 days), then copy its API address and key here.
          </div>
        )}
        <div className="segmented" style={{ alignSelf: 'flex-start' }}>
          <button type="button" className={kind === 'sandbox' ? 'active' : ''} onClick={() => setKind('sandbox')}>Sandbox (sandbox.co.in)</button>
          <button type="button" className={kind === 'custom' ? 'active' : ''} onClick={() => setKind('custom')}>Another provider</button>
        </div>
        {kind === 'sandbox' ? (
          <div className="stack" style={{ gap: 10 }}>
            <div className="small muted">From the Sandbox dashboard → API keys. The key and secret are kept on the server and never shown again; the sign-in token is renewed automatically.</div>
            <div className="row" style={{ gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <Field label="API key"><input className="input mono" style={{ width: 300, maxWidth: '100%' }} autoComplete="off" value={sb.apiKey} onChange={(e) => setSb({ ...sb, apiKey: e.target.value.trim() })} placeholder={s?.sandbox ? `Saved (…${s.sandbox.keyEnd}), leave empty to keep` : 'key_live_…'} /></Field>
              <Field label="API secret"><input className="input mono" type="password" style={{ width: 300, maxWidth: '100%' }} autoComplete="off" value={sb.apiSecret} onChange={(e) => setSb({ ...sb, apiSecret: e.target.value.trim() })} placeholder={s?.sandbox?.hasSecret ? 'Saved, leave empty to keep' : 'secret_live_…'} /></Field>
              <Field label="Account"><select className="select" value={sb.env} onChange={(e) => setSb({ ...sb, env: e.target.value as 'live' | 'test' })}><option value="live">Live</option><option value="test">Test</option></select></Field>
            </div>
          </div>
        ) : (<>
        <div className="row" style={{ gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <Field label="Method"><select className="select" value={f.method} onChange={(e) => setF({ ...f, method: e.target.value as 'GET' | 'POST' })}><option>GET</option><option>POST</option></select></Field>
          <Field label="Provider address" hint="Write {gstin} where the GST number goes, e.g. https://api.provider.in/gstin/{gstin}">
            <input className="input" style={{ width: 460, maxWidth: '100%' }} value={f.url} onChange={(e) => setF({ ...f, url: e.target.value })} placeholder="https://api.provider.in/gstin/{gstin}" spellCheck={false} />
          </Field>
        </div>
        {f.method === 'POST' && (
          <Field label="Body (JSON)" hint='For example {"gstin": "{gstin}"}'>
            <input className="input mono" value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} placeholder='{"gstin": "{gstin}"}' spellCheck={false} />
          </Field>
        )}
        <div className="stack" style={{ gap: 6 }}>
          <div className="small strong">Key headers</div>
          {f.headers.map((h, i) => (
            <div key={i} className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              <input className="input" style={{ width: 180 }} value={h.name} onChange={(e) => setHeader(i, 'name', e.target.value)} placeholder="x-api-key" aria-label="Header name" spellCheck={false} />
              <input className="input" style={{ width: 300, maxWidth: '100%' }} type="password" autoComplete="off" value={h.value} onChange={(e) => setHeader(i, 'value', e.target.value)}
                placeholder={s?.headerNames.includes(h.name) ? 'Saved (leave empty to keep)' : 'Key or secret'} aria-label="Header value" />
              <button type="button" className="icon-btn" aria-label="Remove header" onClick={() => setF({ ...f, headers: f.headers.filter((_, j) => j !== i) })}><Trash2 size={14} /></button>
            </div>
          ))}
          {f.headers.length < 6 && <button type="button" className="btn btn-ghost btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => setF({ ...f, headers: [...f.headers, { name: '', value: '' }] })}><Plus size={14} /> Add a header</button>}
        </div>
        </>)}
        <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
          <button className="btn btn-primary" disabled={!!busy || (kind === 'custom' ? !f.url : !((sb.apiKey && sb.apiSecret) || s?.sandbox))} onClick={() => void save()}>{busy === 'save' ? <Loader2 size={15} className="spin" /> : <Save size={15} />} Save</button>
          {s?.source === 'settings' && <button className="btn btn-ghost" disabled={!!busy} onClick={() => window.confirm('Turn off the GST lookup?') && void save(true)}><Trash2 size={15} /> Turn off</button>}
        </div>
        {s?.source && (
          <div className="row" style={{ gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <Field label="Test with a real GSTIN">
              <input className="input mono" style={{ width: 220 }} maxLength={15} value={gstin} onChange={(e) => setGstin(e.target.value.toUpperCase().replace(/[^0-9A-Z]/g, ''))} placeholder="33AABCA1234F1Z5" />
            </Field>
            <button className="btn btn-secondary" disabled={gstin.length !== 15 || !!busy} onClick={() => void runTest()}>{busy === 'test' ? <Loader2 size={15} className="spin" /> : <BadgeCheck size={15} />} Test</button>
          </div>
        )}
        {test && (test.ok && test.taxpayer ? (
          <div className="small" style={{ color: 'var(--green-700, #2f6b45)' }}>Works: <strong>{test.taxpayer.legalName || test.taxpayer.tradeName}</strong>{test.taxpayer.status ? ` · ${test.taxpayer.status}` : ''}{test.taxpayer.address ? ` · ${test.taxpayer.address}` : ''}</div>
        ) : (
          <div className="small" style={{ color: 'var(--red-600, #b3261e)' }}>
            {test.error ?? (test.status && test.status >= 400 ? `The provider answered HTTP ${test.status}.` : 'The provider answered, but no company name was found in its reply.')}
            {test.reply && <pre className="small mono" style={{ whiteSpace: 'pre-wrap', maxHeight: 160, overflow: 'auto', background: 'var(--ink-50)', padding: 8, borderRadius: 8, color: 'var(--ink-700)' }}>{test.reply}</pre>}
          </div>
        ))}
      </div>
    </section>
  );
}
