import { useEffect, useState } from 'react';
import { Hash, CalendarRange, Percent, Plus, Trash2, Save, Info, RotateCcw, Lock, Mail, Send, Loader2 } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/api/client';
import { useMut, usePlatformConfig } from '@/api/hooks';
import type { PlatformConfig, TaxSlab } from '@/api/types';
import { Field, PageHeader, Toggle, Badge } from '@/components/ui';
import { useToast } from '@/context/ToastContext';
import { FullPageSpinner } from '@/components/ProtectedRoute';
import { fyLabel, fyRange } from '@/lib/fy';
import { fmtDate } from '@/lib/format';

const PREFIX_RE = /^[A-Z]{2,5}$/;

export default function Configuration() {
  const { data } = usePlatformConfig();
  if (!data) return <FullPageSpinner />;
  return <ConfigForm config={data} />;
}

type Slab = TaxSlab & { isNew?: boolean };

function ConfigForm({ config }: { config: PlatformConfig }) {
  const keys = [['platform']];
  const saveConfig = useMut((b: Partial<PlatformConfig>) => api.put('/platform/config', b), keys);
  const saveSlabs = useMut((slabs: Slab[]) => api.put<TaxSlab[]>('/platform/tax-slabs', { slabs: slabs.map(({ isNew, id, ...s }) => (isNew ? s : { id, ...s })) }), keys, { success: 'Tax slabs updated for all shops' });

  const toast = useToast();
  const toastSaved = (m: string) => toast('success', 'Changes saved', m);

  // Section 1 — ID generation
  const [prefix, setPrefix] = useState(config.customerIdPrefix);
  const prefixErr = !PREFIX_RE.test(prefix) ? 'Use 2–5 uppercase letters (A–Z)' : '';
  const prefixDirty = prefix !== config.customerIdPrefix;

  // Section 2 — Financial year
  const [autoReset, setAutoReset] = useState(config.autoResetInvoiceNumbering);
  const fyDirty = autoReset !== config.autoResetInvoiceNumbering;
  const { start, end } = fyRange(new Date(), config.fyStartMonth);
  const fy = fyLabel(new Date(), config.fyStartMonth);
  const nextFy = fyLabel(new Date(end.getTime() + 86400000), config.fyStartMonth);

  // Section 3 — Tax Lab
  const [slabs, setSlabs] = useState<Slab[]>(config.taxSlabs);
  useEffect(() => setSlabs(config.taxSlabs), [config.taxSlabs]);
  const [newName, setNewName] = useState('');
  const [newRate, setNewRate] = useState('');
  const [taxTouched, setTaxTouched] = useState(false);
  const rateNum = Number(newRate);
  const rateErr = newRate === '' ? 'Rate is required' : !Number.isFinite(rateNum) || rateNum < 0 || rateNum > 100 ? 'Enter 0–100' : slabs.some((s) => s.rate === rateNum) ? 'Slab already exists' : '';
  const taxDirty = JSON.stringify(slabs) !== JSON.stringify(config.taxSlabs);

  const addSlab = () => {
    setTaxTouched(true);
    if (rateErr) return;
    setSlabs((s) => [...s, { id: `new_${rateNum}`, isNew: true, name: newName.trim() || `GST ${rateNum}%`, rate: rateNum, active: true }].sort((a, b) => a.rate - b.rate));
    setNewName('');
    setNewRate('');
    setTaxTouched(false);
  };

  return (
    <div className="page" style={{ maxWidth: 1080 }}>
      <PageHeader title="Configuration" subtitle="Global platform rules that apply to every shop workspace. Changes affect new records only." />

      <div className="stack">
        <EmailCheck />

        {/* ---------------- ID Generation ---------------- */}
        <section className="card">
          <div className="card-header">
            <div className="row" style={{ gap: 14 }}>
              <span className="stat-icon tone-blue"><Hash size={19} /></span>
              <div>
                <h3>Customer ID generation</h3>
                <p>Alphabetic prefix used when shops create new customers.</p>
              </div>
            </div>
          </div>
          <div className="card-body">
            <div className="form-grid">
              <Field label="Customer ID prefix" required error={prefixErr} hint="Existing customer IDs keep their original prefix.">
                <input className={`input ${prefixErr ? 'invalid' : ''}`} value={prefix} maxLength={5} onChange={(e) => setPrefix(e.target.value.toUpperCase().replace(/[^A-Z]/g, ''))} style={{ fontWeight: 600, letterSpacing: '.08em' }} />
              </Field>
              <Field label="Preview">
                <div className="row" style={{ height: 40, gap: 8 }}>
                  {[1582, 1583, 1584].map((n) => (
                    <span key={n} className="chip mono" style={{ fontSize: 13, padding: '6px 10px' }}>{(prefix || '???') + '-' + n}</span>
                  ))}
                </div>
              </Field>
            </div>
            <div className="row small muted" style={{ marginTop: 14, gap: 8 }}>
              <Lock size={14} /> The numeric part is a per-shop running sequence and is generated automatically — it can never be edited by shops.
            </div>
          </div>
          <div className="card-footer">
            <button className="btn btn-ghost" disabled={!prefixDirty} onClick={() => setPrefix(config.customerIdPrefix)}>Discard</button>
            <button
              className="btn btn-primary"
              disabled={!prefixDirty || !!prefixErr}
              onClick={() => saveConfig.mutate({ customerIdPrefix: prefix }, { onSuccess: () => toastSaved(`New customers will be numbered ${prefix}-XXXX.`) })}
            >
              <Save size={15} /> Save Changes
            </button>
          </div>
        </section>

        {/* ---------------- Financial Year ---------------- */}
        <section className="card">
          <div className="card-header">
            <div className="row" style={{ gap: 14 }}>
              <span className="stat-icon tone-violet"><CalendarRange size={19} /></span>
              <div>
                <h3>Financial year settings</h3>
                <p>Platform-wide accounting period, as per Indian statutory norms.</p>
              </div>
            </div>
            <Badge tone="blue">FY {fy}</Badge>
          </div>
          <div className="card-body">
            <div className="grid-2">
              <div className="card" style={{ boxShadow: 'none', padding: 16, background: 'var(--ink-50)' }}>
                <div className="small muted">Financial year starts</div>
                <div style={{ fontWeight: 600, fontSize: 16, color: 'var(--ink-900)', marginTop: 2 }}>1 April</div>
                <div className="small muted">Current: {fmtDate(start.toISOString())}</div>
              </div>
              <div className="card" style={{ boxShadow: 'none', padding: 16, background: 'var(--ink-50)' }}>
                <div className="small muted">Financial year ends</div>
                <div style={{ fontWeight: 600, fontSize: 16, color: 'var(--ink-900)', marginTop: 2 }}>31 March</div>
                <div className="small muted">Current: {fmtDate(end.toISOString())}</div>
              </div>
            </div>

            <div className="divider" />

            <div className="row between" style={{ alignItems: 'flex-start', gap: 24 }}>
              <div>
                <div className="row" style={{ gap: 8 }}>
                  <RotateCcw size={16} className="muted" />
                  <strong style={{ color: 'var(--ink-900)' }}>Auto-Reset Invoice Numbering</strong>
                </div>
                <p className="small muted" style={{ marginTop: 4, maxWidth: 620 }}>
                  When enabled, sequential invoice numbers for <strong>all shops</strong> reset to zero automatically at the start of each new financial year (1 April). Invoice numbers include the FY to stay unique.
                </p>
              </div>
              <Toggle checked={autoReset} onChange={setAutoReset} />
            </div>

            <div className="row" style={{ marginTop: 16, padding: 14, borderRadius: 8, background: autoReset ? 'var(--brand-50)' : 'var(--ink-50)', gap: 12, flexWrap: 'wrap' }}>
              <Info size={16} style={{ color: 'var(--brand-600)' }} />
              <span className="small">Example sequence:</span>
              {autoReset ? (
                <>
                  <span className="chip mono">INV-{fy}-0347</span>
                  <span className="small muted">→ 31 Mar → 1 Apr →</span>
                  <span className="chip mono" style={{ background: '#fff', color: 'var(--brand-700)' }}>INV-{nextFy}-0001</span>
                </>
              ) : (
                <>
                  <span className="chip mono">INV-0347</span>
                  <span className="small muted">→ 31 Mar → 1 Apr →</span>
                  <span className="chip mono">INV-0348</span>
                  <span className="small muted">(continuous)</span>
                </>
              )}
            </div>
          </div>
          <div className="card-footer">
            <button className="btn btn-ghost" disabled={!fyDirty} onClick={() => setAutoReset(config.autoResetInvoiceNumbering)}>Discard</button>
            <button
              className="btn btn-primary"
              disabled={!fyDirty}
              onClick={() => saveConfig.mutate({ autoResetInvoiceNumbering: autoReset }, { onSuccess: () => toastSaved(autoReset ? 'Invoice numbering will reset every 1 April.' : 'Invoice numbering will continue across years.') })}
            >
              <Save size={15} /> Save Changes
            </button>
          </div>
        </section>

        {/* ---------------- Tax Lab ---------------- */}
        <section className="card">
          <div className="card-header">
            <div className="row" style={{ gap: 14 }}>
              <span className="stat-icon tone-green"><Percent size={19} /></span>
              <div>
                <h3>Tax Lab</h3>
                <p>GST slabs available to shops when creating items and invoices.</p>
              </div>
            </div>
            <Badge tone="green">{slabs.filter((s) => s.active).length} active slabs</Badge>
          </div>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Slab name</th>
                  <th className="num">Rate</th>
                  <th>Split (intra-state)</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {slabs.map((s) => (
                  <tr key={s.id}>
                    <td>
                      <input className="cell-input" style={{ borderColor: 'transparent', boxShadow: 'none', background: 'transparent', fontWeight: 600 }} value={s.name} onChange={(e) => setSlabs((all) => all.map((x) => (x.id === s.id ? { ...x, name: e.target.value } : x)))} />
                    </td>
                    <td className="num strong">{s.rate}%</td>
                    <td className="muted">{s.rate ? `CGST ${s.rate / 2}% + SGST ${s.rate / 2}%  ·  IGST ${s.rate}%` : 'Nil rated / exempt'}</td>
                    <td>
                      <Toggle size="sm" checked={s.active} onChange={(v) => setSlabs((all) => all.map((x) => (x.id === s.id ? { ...x, active: v } : x)))} label={<span className="small">{s.active ? 'Enabled' : 'Disabled'}</span>} />
                    </td>
                    <td className="num">
                      <button className="icon-btn danger" title="Remove slab" onClick={() => setSlabs((all) => all.filter((x) => x.id !== s.id))} disabled={s.rate === 0}>
                        <Trash2 size={15} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="card-body" style={{ borderTop: '1px solid var(--border)' }}>
            <div className="row" style={{ alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
              <Field label="New slab name" className="" hint="Optional — defaults to “GST n%”">
                <input className="input" style={{ width: 240 }} value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="e.g. GST 3% (Gold)" />
              </Field>
              <Field label="Rate (%)" required error={taxTouched ? rateErr : ''}>
                <input className={`input ${taxTouched && rateErr ? 'invalid' : ''}`} style={{ width: 120 }} type="number" min={0} max={100} step="0.25" value={newRate} onChange={(e) => setNewRate(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addSlab()} placeholder="3" />
              </Field>
              <button className="btn btn-secondary" style={{ marginTop: 24 }} onClick={addSlab}>
                <Plus size={15} /> Add slab
              </button>
            </div>
            <p className="small muted" style={{ marginTop: 10 }}>Removing a slab doesn’t change existing invoices — their tax is stored on each line. Slabs still used by items are disabled instead of deleted.</p>
          </div>
          <div className="card-footer">
            <button className="btn btn-ghost" disabled={!taxDirty} onClick={() => setSlabs(config.taxSlabs)}>Discard</button>
            <button
              className="btn btn-primary"
              disabled={!taxDirty || saveSlabs.isPending}
              onClick={() => saveSlabs.mutate(slabs)}
            >
              <Save size={15} /> Save Changes
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}

interface MailStatus { configured: boolean; provider: 'brevo' | 'resend' | 'smtp' | null; from: string }
const PROVIDER = { brevo: 'Brevo', resend: 'Resend', smtp: 'SMTP' } as const;

/** Shows which email provider the server uses and sends a test, so a missing or wrong setting shows up before a customer needs a reset link. */
function EmailCheck() {
  const status = useQuery({ queryKey: ['platform', 'mail'], queryFn: () => api.get<MailStatus>('/platform/mail') });
  const [to, setTo] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ sent: boolean; error?: string } | null>(null);
  const s = status.data;
  const test = async () => {
    setBusy(true); setResult(null);
    try { setResult(await api.post<{ sent: boolean; error?: string }>('/platform/mail/test', { to })); }
    catch (e) { setResult({ sent: false, error: (e as Error).message }); }
    finally { setBusy(false); }
  };
  return (
    <section className="card">
      <div className="card-header">
        <div className="row" style={{ gap: 14 }}>
          <span className="stat-icon tone-rose"><Mail size={19} /></span>
          <div>
            <h3>Email</h3>
            <p>Password-reset links, welcome emails, invoices and payment reminders.</p>
          </div>
        </div>
        {s && <Badge tone={s.configured ? 'green' : 'red'}>{s.configured ? `On · ${PROVIDER[s.provider!]}` : 'Not set up'}</Badge>}
      </div>
      <div className="card-body stack" style={{ gap: 12 }}>
        {s && !s.configured && (
          <div className="small" style={{ background: 'var(--ink-50)', borderRadius: 10, padding: 12 }}>
            <strong>No email is being sent.</strong> In the hosting dashboard (Render → Environment), add <code>BREVO_API_KEY</code> (free at brevo.com) or <code>RESEND_API_KEY</code>, and <code>MAIL_FROM</code> set to a sender address verified with that provider, then redeploy. SMTP (<code>SMTP_HOST</code>, <code>SMTP_PORT</code>, <code>SMTP_USER</code>, <code>SMTP_PASS</code>) also works on hosts that allow it; Render's free plan blocks SMTP ports.
          </div>
        )}
        {s?.configured && <div className="small muted">Sending from <strong>{s.from}</strong>.</div>}
        <div className="row" style={{ gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <Field label="Send a test email to">
            <input id="mail-test-to" className="input" style={{ width: 280, maxWidth: '100%' }} type="email" value={to} onChange={(e) => setTo(e.target.value)} placeholder="you@example.com" onKeyDown={(e) => e.key === 'Enter' && to && test()} />
          </Field>
          <button className="btn btn-secondary" disabled={!to || busy} onClick={test}>{busy ? <Loader2 size={15} className="spin" /> : <Send size={15} />} Send test</button>
        </div>
        {result && (result.sent
          ? <div className="small" style={{ color: 'var(--green-700, #2f6b45)' }}>Sent. Check the inbox (and spam folder) of {to}.</div>
          : <div className="small" style={{ color: 'var(--red-600, #b3261e)' }}>Not sent: {result.error}</div>)}
      </div>
    </section>
  );
}
