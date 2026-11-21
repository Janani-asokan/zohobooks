import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, Download, Mail, PlugZap, Search, Waypoints, X } from 'lucide-react';
import { api, download } from '@/api/client';
import { Badge, EmptyState, Modal, PageHeader } from '@/components/ui';

/**
 * Super admin → Logs: every email the platform sent (to whom, what, the provider's answer) and every call to an
 * outside service (which feature, how long, whether it worked), plus the map of which feature uses which service.
 * For escalations: "did the customer get the code?", "why did payments fail on Tuesday?".
 */

const when = (iso: string) => new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });
const qs = (o: Record<string, string | number | undefined>) => new URLSearchParams(Object.entries(o).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => [k, String(v)])).toString();

interface EmailRow { id: number; sentAt: string; status: 'sent' | 'failed' | 'not_sent'; kind: string; purpose: string; recipient: string; cc: string; subject: string; shop: string; provider: string; messageId: string; error: string; attachments: string; ms: number | null }
interface EmailPage { rows: EmailRow[]; total: number; page: number; pageSize: number; kinds: Array<{ key: string; label: string; n: number }>; keepDays: number }
interface CallRow { id: number; at: string; service: string; feature: string; featureLabel: string; method: string; endpoint: string; statusCode: number | null; ok: boolean; ms: number; shop: string; error: string; ref: string }
interface CallPage { rows: CallRow[]; total: number; page: number; pageSize: number; keepDays: number }
interface Service {
  key: string; name: string; what: string; side: 'server' | 'browser'; host: string; docs?: string; note?: string;
  configured: boolean | null; inUse?: boolean; settingsStatus: Array<{ name: string; set: boolean }>;
  last7Days: { calls: number; failed: number; avgMs?: number; lastAt?: string; lastOkAt?: string }; lastError: { error: string; at: string } | null;
  features: Array<{ key: string; label: string; calls30d: number; failed30d: number }>;
}
interface IntegrationsData { mail: { configured: boolean; provider: string | null; from: string; last7Days: Record<string, number> }; keepDays: { email: number; api: number }; services: Service[] }

const STATUS: Record<EmailRow['status'], { tone: string; label: string }> = {
  sent: { tone: 'green', label: 'Sent' }, failed: { tone: 'red', label: 'Failed' }, not_sent: { tone: 'amber', label: 'Not sent' },
};

export default function Logs() {
  const [tab, setTab] = useState<'emails' | 'calls' | 'map'>('emails');
  return (
    <div className="page">
      <PageHeader title="Logs" subtitle="Every email sent and every call to an outside service, kept for escalations. Email text is never stored, only who, what and the provider’s answer." />
      <div className="tabs">
        <button className={tab === 'emails' ? 'active' : ''} onClick={() => setTab('emails')}><Mail size={15} /> Emails</button>
        <button className={tab === 'calls' ? 'active' : ''} onClick={() => setTab('calls')}><Waypoints size={15} /> API calls</button>
        <button className={tab === 'map' ? 'active' : ''} onClick={() => setTab('map')}><PlugZap size={15} /> Integrations</button>
      </div>
      {tab === 'emails' && <Emails />}
      {tab === 'calls' && <Calls />}
      {tab === 'map' && <Integrations />}
    </div>
  );
}

function DateRange({ from, to, set }: { from: string; to: string; set: (f: string, t: string) => void }) {
  return (
    <>
      <input className="input" type="date" value={from} onChange={(e) => set(e.target.value, to)} aria-label="From date" style={{ width: 150 }} />
      <input className="input" type="date" value={to} onChange={(e) => set(from, e.target.value)} aria-label="To date" style={{ width: 150 }} />
    </>
  );
}

function Pager({ page, total, size, setPage }: { page: number; total: number; size: number; setPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / size));
  return (
    <div className="row between" style={{ padding: '10px 14px', flexWrap: 'wrap', gap: 8 }}>
      <span className="small muted">{total.toLocaleString('en-IN')} record{total === 1 ? '' : 's'}</span>
      <div className="row" style={{ gap: 6 }}>
        <button className="btn btn-secondary btn-sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button>
        <span className="small muted">Page {page} of {pages}</span>
        <button className="btn btn-secondary btn-sm" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</button>
      </div>
    </div>
  );
}

function Emails() {
  const [f, setF] = useState({ q: '', status: '', kind: '', from: '', to: '' });
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<EmailRow | null>(null);
  const params = qs({ ...f, page });
  const data = useQuery({ queryKey: ['platform', 'logs', 'emails', params], queryFn: () => api.get<EmailPage>(`/platform/logs/emails?${params}`), placeholderData: (p) => p });
  const set = (patch: Partial<typeof f>) => { setF((x) => ({ ...x, ...patch })); setPage(1); };
  const d = data.data;
  return (
    <>
      <div className="card" style={{ padding: 12, marginBottom: 12 }}>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <div className="input-group" style={{ flex: '1 1 240px' }}><span className="lead"><Search size={15} /></span>
            <input className="input" value={f.q} onChange={(e) => set({ q: e.target.value })} placeholder="Email address, subject, shop or message id" /></div>
          <select className="select" value={f.status} onChange={(e) => set({ status: e.target.value })} aria-label="Status" style={{ width: 150 }}>
            <option value="">All results</option><option value="problems">Problems only</option><option value="sent">Sent</option><option value="failed">Failed</option><option value="not_sent">Not sent</option>
          </select>
          <select className="select" value={f.kind} onChange={(e) => set({ kind: e.target.value })} aria-label="Purpose" style={{ width: 220 }}>
            <option value="">All purposes</option>{d?.kinds.map((k) => <option key={k.key} value={k.key}>{k.label} ({k.n})</option>)}
          </select>
          <DateRange from={f.from} to={f.to} set={(from, to) => set({ from, to })} />
          <button className="btn btn-secondary" onClick={() => download(`/platform/logs/emails?${qs({ ...f, format: 'csv' })}`, 'email-log.csv')}><Download size={15} /> Export CSV</button>
        </div>
        {d && <p className="small muted" style={{ margin: '8px 0 0' }}>Kept for {Math.round(d.keepDays / 365 * 10) / 10} years. Times are in your local time; the CSV uses UTC.</p>}
      </div>
      <div className="card table-wrap">
        <table className="table">
          <thead><tr><th>When</th><th>Result</th><th>To</th><th>Purpose</th><th>Subject</th><th>Shop</th><th>Provider</th></tr></thead>
          <tbody>
            {d?.rows.map((r) => (
              <tr key={r.id} className="clickable" onClick={() => setOpen(r)}>
                <td className="muted" style={{ whiteSpace: 'nowrap' }}>{when(r.sentAt)}</td>
                <td><Badge tone={STATUS[r.status].tone}>{STATUS[r.status].label}</Badge></td>
                <td className="strong">{r.recipient}{r.cc && <div className="small muted">cc {r.cc}</div>}</td>
                <td>{r.purpose}</td>
                <td className="small" style={{ maxWidth: 280 }}>{r.subject}{r.error && <div className="small" style={{ color: 'var(--red-600)' }}>{r.error}</div>}</td>
                <td className="muted">{r.shop || '—'}</td>
                <td className="muted small">{r.provider === 'none' ? 'None set up' : r.provider}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {d && !d.rows.length && <EmptyState icon={Mail} title="No emails match" text="Emails sent by the platform appear here as they go out." />}
        {d && d.total > 0 && <Pager page={page} total={d.total} size={d.pageSize} setPage={setPage} />}
      </div>
      {open && (
        <Modal open onClose={() => setOpen(null)} title={open.subject} subtitle={`${open.purpose} · ${when(open.sentAt)}`}
          footer={<button className="btn" onClick={() => setOpen(null)}>Close</button>}>
          <dl className="kv">
            <dt>Result</dt><dd><Badge tone={STATUS[open.status].tone}>{STATUS[open.status].label}</Badge></dd>
            <dt>To</dt><dd>{open.recipient}</dd>
            {open.cc && <><dt>Cc</dt><dd>{open.cc}</dd></>}
            <dt>Shop</dt><dd>{open.shop || '— (not about a shop)'}</dd>
            <dt>Provider</dt><dd>{open.provider === 'none' ? 'None set up' : open.provider}{open.ms !== null && <span className="muted"> · {open.ms} ms</span>}</dd>
            {open.messageId && <><dt>Message id</dt><dd style={{ overflowWrap: 'anywhere' }}><code>{open.messageId}</code></dd></>}
            {open.attachments && <><dt>Attachments</dt><dd>{open.attachments}</dd></>}
            {open.error && <><dt>Error</dt><dd style={{ color: 'var(--red-600)', overflowWrap: 'anywhere' }}>{open.error}</dd></>}
          </dl>
          <p className="small muted" style={{ marginBottom: 0 }}>
            {open.provider === 'brevo' && open.messageId ? 'To see whether it was delivered, opened or bounced, search this message id in Brevo → Transactional → Logs.' : ''}
            {' '}The email text isn’t stored, because it can hold sign-in codes and password links.
          </p>
        </Modal>
      )}
    </>
  );
}

function Calls() {
  const [f, setF] = useState({ q: '', service: '', ok: '', from: '', to: '' });
  const [page, setPage] = useState(1);
  const params = qs({ ...f, page });
  const data = useQuery({ queryKey: ['platform', 'logs', 'calls', params], queryFn: () => api.get<CallPage>(`/platform/logs/api-calls?${params}`), placeholderData: (p) => p });
  const set = (patch: Partial<typeof f>) => { setF((x) => ({ ...x, ...patch })); setPage(1); };
  const d = data.data;
  return (
    <>
      <div className="card" style={{ padding: 12, marginBottom: 12 }}>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <div className="input-group" style={{ flex: '1 1 220px' }}><span className="lead"><Search size={15} /></span>
            <input className="input" value={f.q} onChange={(e) => set({ q: e.target.value })} placeholder="Error, endpoint, shop or reference" /></div>
          <select className="select" value={f.service} onChange={(e) => set({ service: e.target.value })} aria-label="Service" style={{ width: 170 }}>
            <option value="">All services</option><option value="brevo">Brevo (email)</option><option value="resend">Resend (email)</option><option value="smtp">SMTP (email)</option>
            <option value="anthropic">Anthropic (AI)</option><option value="razorpay">Razorpay (payments)</option>
          </select>
          <select className="select" value={f.ok} onChange={(e) => set({ ok: e.target.value })} aria-label="Result" style={{ width: 140 }}>
            <option value="">All results</option><option value="false">Failures only</option><option value="true">Worked</option>
          </select>
          <DateRange from={f.from} to={f.to} set={(from, to) => set({ from, to })} />
          <button className="btn btn-secondary" onClick={() => download(`/platform/logs/api-calls?${qs({ ...f, format: 'csv' })}`, 'api-calls.csv')}><Download size={15} /> Export CSV</button>
        </div>
        {d && <p className="small muted" style={{ margin: '8px 0 0' }}>Kept for {d.keepDays} days. Keys, headers and message contents are never recorded.</p>}
      </div>
      <div className="card table-wrap">
        <table className="table">
          <thead><tr><th>When</th><th>Result</th><th>Service</th><th>Feature</th><th className="num">Took</th><th>Shop</th><th>Details</th></tr></thead>
          <tbody>
            {d?.rows.map((r) => (
              <tr key={r.id}>
                <td className="muted" style={{ whiteSpace: 'nowrap' }}>{when(r.at)}</td>
                <td>{r.ok ? <Badge tone="green">OK{r.statusCode ? ` · ${r.statusCode}` : ''}</Badge> : <Badge tone="red">Failed{r.statusCode ? ` · ${r.statusCode}` : ''}</Badge>}</td>
                <td className="strong">{r.service}</td>
                <td>{r.featureLabel}</td>
                <td className="num">{r.ms.toLocaleString('en-IN')} ms</td>
                <td className="muted">{r.shop || '—'}</td>
                <td className="small" style={{ maxWidth: 320 }}>
                  <span className="muted">{r.method} {r.endpoint}</span>
                  {r.ref && <div className="muted">ref {r.ref}</div>}
                  {r.error && <div style={{ color: 'var(--red-600)', overflowWrap: 'anywhere' }}>{r.error}</div>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {d && !d.rows.length && <EmptyState icon={Waypoints} title="No calls match" text="Calls to email, AI and payment services appear here as they happen." />}
        {d && d.total > 0 && <Pager page={page} total={d.total} size={d.pageSize} setPage={setPage} />}
      </div>
    </>
  );
}

function Integrations() {
  const data = useQuery({ queryKey: ['platform', 'logs', 'integrations'], queryFn: () => api.get<IntegrationsData>('/platform/logs/integrations') });
  const d = data.data;
  if (!d) return <div className="card" style={{ padding: 20 }}>Loading…</div>;
  const m7 = d.mail.last7Days;
  return (
    <>
      <div className="card" style={{ padding: 16, marginBottom: 12 }}>
        <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
          {d.mail.configured ? <CheckCircle2 size={18} style={{ color: 'var(--green-600)' }} /> : <AlertTriangle size={18} style={{ color: 'var(--amber-600)' }} />}
          <strong>Email: {d.mail.configured ? `sending through ${d.mail.provider} as ${d.mail.from}` : 'no provider set up, so emails are not sent'}</strong>
          <span className="muted small">Last 7 days: {m7.sent ?? 0} sent · {m7.failed ?? 0} failed · {m7.not_sent ?? 0} not sent</span>
        </div>
      </div>
      <div className="stack" style={{ gap: 12 }}>
        {d.services.map((s) => (
          <div key={s.key} className="card" style={{ padding: 16 }}>
            <div className="row between" style={{ gap: 10, flexWrap: 'wrap', alignItems: 'flex-start' }}>
              <div style={{ minWidth: 0 }}>
                <h3 style={{ margin: 0 }}>{s.name} <span className="small muted" style={{ fontWeight: 400 }}>· {s.host}</span></h3>
                <div className="muted small">{s.what}{s.side === 'browser' ? ' · runs in the user’s browser or phone, so the server does not log it' : ''}</div>
              </div>
              <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                {s.inUse && <Badge tone="green">In use</Badge>}
                {s.configured === true && !s.inUse && <Badge tone="green">Set up</Badge>}
                {s.configured === false && <Badge tone="amber">Not set up</Badge>}
                {s.configured === null && <Badge tone="gray">No key needed</Badge>}
                {s.last7Days.failed > 0 && <Badge tone="red">{s.last7Days.failed} failed in 7 days</Badge>}
              </div>
            </div>
            {s.side === 'server' && (
              <div className="small" style={{ marginTop: 8 }}>
                Last 7 days: <strong>{s.last7Days.calls}</strong> calls{s.last7Days.avgMs ? `, ${s.last7Days.avgMs} ms on average` : ''}
                {s.last7Days.lastAt && <> · last call {when(s.last7Days.lastAt)}</>}
                {s.lastError && <div style={{ color: 'var(--red-600)', overflowWrap: 'anywhere' }}>Last error ({when(s.lastError.at)}): {s.lastError.error}</div>}
              </div>
            )}
            {s.settingsStatus.length > 0 && (
              <div className="row small" style={{ gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
                <span className="muted">Server settings:</span>
                {s.settingsStatus.map((x) => <span key={x.name} className="chip">{x.set ? <CheckCircle2 size={12} /> : <X size={12} />} {x.name}</span>)}
              </div>
            )}
            {s.features.length > 0 && (
              <details style={{ marginTop: 10 }}>
                <summary className="small" style={{ cursor: 'pointer', fontWeight: 600 }}>Used by {s.features.length} feature{s.features.length === 1 ? '' : 's'}</summary>
                <ul className="small" style={{ margin: '8px 0 0', paddingLeft: 18 }}>
                  {s.features.map((f) => <li key={f.key}>{f.label}{s.side === 'server' && <span className="muted"> · {f.calls30d} calls in 30 days{f.failed30d ? `, ${f.failed30d} failed` : ''}</span>}</li>)}
                </ul>
              </details>
            )}
            {(s.note || s.docs) && <p className="small muted" style={{ margin: '8px 0 0' }}>{s.note} {s.docs && <a href={s.docs} target="_blank" rel="noreferrer">API docs</a>}</p>}
          </div>
        ))}
      </div>
      {!d.services.length && <EmptyState icon={PlugZap} title="No services" text="" />}
    </>
  );
}
