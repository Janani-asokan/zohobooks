import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, MessageSquareText, Save, Send } from 'lucide-react';
import { api } from '@/api/client';
import { Badge, Field, Toggle } from '@/components/ui';
import { useToast } from '@/context/ToastContext';

type Vars = { name: string; shop: string; bill: string; amount: string; code: string };
interface SmsView { configured: boolean; keyEnd: string; templateId: string; enabled: boolean; dailyPerShop: number; vars: Vars }
const VAR_LABELS: Array<[keyof Vars, string, string]> = [
  ['name', 'Customer name', 'Ravi Kumar'], ['shop', 'Shop name', 'Aravind Computer Store'], ['bill', 'Bill number', 'INV-2026-27-0019'],
  ['amount', 'Amount', '707.00'], ['code', 'Link code (after /share/)', '24 letters and numbers'],
];

/**
 * Super admin → Configuration → SMS: bills by SMS through MSG91 with the DLT-approved template. Shops then get
 * "Send SMS" on invoices and at the counter. The MSG91 template's variables are matched to the five values here.
 */
export function SmsCard() {
  const q = useQuery({ queryKey: ['platform', 'sms'], queryFn: () => api.get<SmsView>('/platform/sms') });
  const qc = useQueryClient();
  const toast = useToast();
  const [f, setF] = useState({ authKey: '', templateId: '', enabled: false, dailyPerShop: 200, vars: { name: 'var1', shop: 'var2', bill: 'var3', amount: 'var4', code: 'var5' } as Vars });
  const [busy, setBusy] = useState('');
  const [phone, setPhone] = useState('');
  const [test, setTest] = useState<{ ok: boolean; error?: string; to?: string } | null>(null);
  const s = q.data;
  useEffect(() => { if (s) setF((x) => ({ ...x, templateId: s.templateId, enabled: s.enabled, dailyPerShop: s.dailyPerShop, vars: s.vars })); }, [s]);
  const save = async () => {
    setBusy('save');
    try { await api.put('/platform/sms', f); await qc.invalidateQueries({ queryKey: ['platform', 'sms'] }); setF((x) => ({ ...x, authKey: '' })); toast('success', 'SMS settings saved', f.enabled ? 'Shops can now send bills by SMS.' : 'Switched off for shops until you turn it on.'); }
    catch (e) { toast('error', (e as Error).message); } finally { setBusy(''); }
  };
  const runTest = async () => {
    setBusy('test'); setTest(null);
    try { setTest(await api.post('/platform/sms/test', { phone })); } catch (e) { setTest({ ok: false, error: (e as Error).message }); } finally { setBusy(''); }
  };
  return (
    <section className="card">
      <div className="card-header">
        <div className="row" style={{ gap: 14 }}>
          <span className="stat-icon tone-sage"><MessageSquareText size={19} /></span>
          <div><h3>SMS (MSG91)</h3><p>Shops send bills by SMS: the customer gets the amount and a link to view and download the bill.</p></div>
        </div>
        {s && <Badge tone={s.enabled ? 'green' : s.configured ? 'amber' : 'gray'}>{s.enabled ? 'On for shops' : s.configured ? 'Set up, switched off' : 'Not set up'}</Badge>}
      </div>
      <div className="card-body stack" style={{ gap: 12 }}>
        <div className="small muted">1. Get the DLT template approved. 2. In MSG91 → SMS → Templates, add the same text with its DLT template ID; MSG91 names the variables (##var1## …). 3. Paste MSG91’s auth key (MSG91 → Authkey) and the MSG91 template ID here, match the variables, test, then switch it on.</div>
        <div className="row" style={{ gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <Field label="MSG91 auth key"><input className="input mono" type="password" autoComplete="off" style={{ width: 300, maxWidth: '100%' }} value={f.authKey} onChange={(e) => setF({ ...f, authKey: e.target.value.trim() })} placeholder={s?.keyEnd ? `Saved (…${s.keyEnd}), leave empty to keep` : 'Auth key'} /></Field>
          <Field label="MSG91 template ID"><input className="input mono" style={{ width: 260, maxWidth: '100%' }} value={f.templateId} onChange={(e) => setF({ ...f, templateId: e.target.value.trim() })} placeholder="e.g. 6745ab…" /></Field>
          <Field label="SMS per shop per day"><input className="input" type="number" min={1} max={10000} style={{ width: 120 }} value={f.dailyPerShop} onChange={(e) => setF({ ...f, dailyPerShop: Math.max(1, Number(e.target.value) || 1) })} /></Field>
        </div>
        <div className="small strong">Which MSG91 variable holds which value (in the order of the DLT template)</div>
        <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
          {VAR_LABELS.map(([k, label, eg]) => (
            <Field key={k} label={label} hint={`e.g. ${eg}`}><input className="input mono" style={{ width: 150 }} value={f.vars[k]} onChange={(e) => setF({ ...f, vars: { ...f.vars, [k]: e.target.value.trim() } })} /></Field>
          ))}
        </div>
        <Toggle checked={f.enabled} onChange={(v) => setF({ ...f, enabled: v })} label="Shops can send bills by SMS" />
        <div><button className="btn btn-primary" disabled={!!busy || !f.templateId || (!f.authKey && !s?.keyEnd)} onClick={() => void save()}>{busy === 'save' ? <Loader2 size={15} className="spin" /> : <Save size={15} />} Save</button></div>
        {s?.configured && (
          <div className="row" style={{ gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <Field label="Send a test SMS to"><input className="input" inputMode="tel" style={{ width: 200 }} value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="98765 43210" /></Field>
            <button className="btn btn-secondary" disabled={!phone || !!busy} onClick={() => void runTest()}>{busy === 'test' ? <Loader2 size={15} className="spin" /> : <Send size={15} />} Send test</button>
          </div>
        )}
        {test && (test.ok ? <div className="small" style={{ color: 'var(--green-700, #2f6b45)' }}>MSG91 accepted it for +{test.to}. It should arrive in a minute (the link in a test SMS doesn’t open a real bill). If it doesn’t, MSG91 → Reports shows why: usually the template isn’t DLT-approved yet, the text or variables don’t match, or the sender ID isn’t linked.</div>
          : <div className="small" style={{ color: 'var(--red-600, #b3261e)' }}>{test.error}</div>)}
      </div>
    </section>
  );
}
