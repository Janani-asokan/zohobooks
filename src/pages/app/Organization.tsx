import { useEffect, useRef, useState } from 'react';
import { Upload, Trash2, Save, ImageIcon, Loader2, Smartphone, LayoutTemplate, BellRing, Scale } from 'lucide-react';
import { api, fieldErrors } from '@/api/client';
import { useMut, useOrg } from '@/api/hooks';
import type { Organization as Org } from '@/api/types';
import { useToast } from '@/context/ToastContext';
import { Field, PageHeader, Toggle } from '@/components/ui';
import { FullPageSpinner } from '@/components/ProtectedRoute';
import { useQr, upiLink } from '@/components/InvoiceDocument';
import { EMAIL_RE, initials } from '@/lib/format';
import { GSTIN_RE, INDIAN_STATES, gstinMatchesState } from '../../../shared/gst';

/** Downscale uploaded logos so they stay small in the database and crisp on A4. */
function readLogo(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = () => {
      const img = new Image();
      img.onerror = reject;
      img.onload = () => {
        const max = 320;
        const scale = Math.min(1, max / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * scale);
        c.height = Math.round(img.height * scale);
        c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
        resolve(c.toDataURL('image/png'));
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  });
}

export default function Organization() {
  const { data } = useOrg();
  if (!data) return <FullPageSpinner />;
  return <OrgForm initial={data} />;
}

function OrgForm({ initial }: { initial: Org }) {
  const toast = useToast();
  const [org, setOrg] = useState<Org>(initial);
  useEffect(() => setOrg(initial), [initial]);
  const [touched, setTouched] = useState(false);
  const [serverErr, setServerErr] = useState<Record<string, string>>({});
  const fileRef = useRef<HTMLInputElement>(null);
  const save = useMut((b: Org) => api.put<Org>('/shop/organization', b), [['org'], ['invoice']], { silentError: true });
  const qr = useQr(org.upiId && /^[\w.-]{2,}@[a-zA-Z]{2,}$/.test(org.upiId) ? upiLink(org, 1, 'Test') : null);

  const errs = {
    companyName: !org.companyName.trim() ? 'Company name is required' : '',
    gstin: org.gstin && !GSTIN_RE.test(org.gstin) ? 'Invalid GSTIN' : org.gstin && !gstinMatchesState(org.gstin, org.state) ? 'GSTIN state code doesn’t match your state' : '',
    email: org.email && !EMAIL_RE.test(org.email) ? 'Invalid email' : '',
    upiId: org.upiId && !/^[\w.-]{2,}@[a-zA-Z]{2,}$/.test(org.upiId) ? 'Enter a valid UPI ID (e.g. shop@okhdfcbank)' : '',
  };
  const e = (k: keyof typeof errs) => (touched ? errs[k] : '') || serverErr[k] || '';
  const dirty = JSON.stringify(org) !== JSON.stringify(initial);

  const onFile = async (f?: File) => {
    if (!f) return;
    if (!f.type.startsWith('image/')) return toast('error', 'Please choose an image file');
    if (f.size > 5 * 1024 * 1024) return toast('error', 'Logo must be under 5 MB');
    try { setOrg({ ...org, logo: await readLogo(f) }); } catch { toast('error', 'Could not read that image'); }
  };

  const submit = () => {
    setTouched(true);
    setServerErr({});
    if (Object.values(errs).some(Boolean)) return;
    save.mutate({ ...org, companyName: org.companyName.trim() }, {
      onSuccess: () => toast('success', 'Organization profile saved'),
      onError: (err) => { setServerErr(fieldErrors(err)); toast('error', err.message); },
    });
  };

  const TPLS: Array<[Org['invoiceTemplate'], string, string]> = [['classic', 'Classic', '#1f7a4d'], ['modern', 'Modern', '#18181b'], ['compact', 'Compact', '#71717a']];

  return (
    <div className="page" style={{ maxWidth: 1100 }}>
      <PageHeader title="Organization profile" subtitle="Your company details, logo and payment details appear on every invoice." />
      <div className="grid-3-1" style={{ alignItems: 'start' }}>
        <div className="stack">
          <div className="card">
            <div className="card-body">
              <div className="section-title">Logo</div>
              <div className="row" style={{ gap: 18 }}>
                <div role="button" tabIndex={0} aria-label="Upload logo" style={{ width: 120, height: 120, borderRadius: 8, border: '2px dashed var(--border-strong)', display: 'grid', placeItems: 'center', background: 'var(--ink-50)', overflow: 'hidden', cursor: 'pointer' }}
                  onClick={() => fileRef.current?.click()} onKeyDown={(ev) => ev.key === 'Enter' && fileRef.current?.click()} onDragOver={(ev) => ev.preventDefault()} onDrop={(ev) => { ev.preventDefault(); onFile(ev.dataTransfer.files[0]); }}>
                  {org.logo ? <img src={org.logo} alt="Logo" style={{ width: '100%', height: '100%', objectFit: 'contain' }} /> : <ImageIcon size={30} className="muted" />}
                </div>
                <div>
                  <div className="row">
                    <button className="btn btn-secondary btn-sm" onClick={() => fileRef.current?.click()}><Upload size={14} /> Upload logo</button>
                    {org.logo && <button className="btn btn-ghost btn-sm" onClick={() => setOrg({ ...org, logo: '' })}><Trash2 size={14} /> Remove</button>}
                  </div>
                  <p className="small muted" style={{ marginTop: 8 }}>PNG, JPG or SVG · drag &amp; drop supported · square logos work best.</p>
                </div>
                <input ref={fileRef} type="file" accept="image/*" hidden onChange={(ev) => onFile(ev.target.files?.[0])} />
              </div>

              <div className="section-title mt-24">Business details</div>
              <div className="form-grid">
                <Field label="Company name" required error={e('companyName')}><input className={`input ${e('companyName') ? 'invalid' : ''}`} value={org.companyName} onChange={(ev) => setOrg({ ...org, companyName: ev.target.value })} /></Field>
                <Field label="Legal name"><input className="input" value={org.legalName} onChange={(ev) => setOrg({ ...org, legalName: ev.target.value })} /></Field>
                <Field label="GSTIN" error={e('gstin')} hint="Required to charge GST and file returns"><input className={`input ${e('gstin') ? 'invalid' : ''}`} maxLength={15} value={org.gstin} onChange={(ev) => setOrg({ ...org, gstin: ev.target.value.toUpperCase().replace(/[^0-9A-Z]/g, '') })} style={{ fontFamily: 'ui-monospace, Menlo, monospace' }} /></Field>
                <Field label="State" hint="Determines CGST+SGST vs IGST"><select className="select" value={org.state} onChange={(ev) => setOrg({ ...org, state: ev.target.value })}>{INDIAN_STATES.map((s) => <option key={s}>{s}</option>)}</select></Field>
                <Field label="Email" error={e('email')}><input className={`input ${e('email') ? 'invalid' : ''}`} value={org.email} onChange={(ev) => setOrg({ ...org, email: ev.target.value })} /></Field>
                <Field label="Phone"><input className="input" value={org.phone} onChange={(ev) => setOrg({ ...org, phone: ev.target.value })} /></Field>
                <Field label="Address (include PIN code)" className="span-all" hint="The 6-digit PIN is used in e-invoice and e-way bill files"><textarea className="textarea" value={org.address} onChange={(ev) => setOrg({ ...org, address: ev.target.value })} /></Field>
              </div>

              <div className="section-title mt-24"><Scale size={13} /> GST registration type</div>
              <div className="row between">
                <div><div className="strong" style={{ color: 'var(--ink-900)' }}>Composition scheme</div><div className="small muted">You pay tax on turnover and can’t collect GST — documents are issued as “Bill of Supply”.</div></div>
                <Toggle checked={org.compositionScheme} onChange={(v) => setOrg({ ...org, compositionScheme: v })} />
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card-body">
              <div className="section-title"><Smartphone size={13} /> Getting paid</div>
              <div className="form-grid">
                <Field label="UPI ID" error={e('upiId')} hint="A scan-to-pay QR with the exact amount is printed on unpaid invoices"><input className={`input ${e('upiId') ? 'invalid' : ''}`} value={org.upiId} onChange={(ev) => setOrg({ ...org, upiId: ev.target.value.trim() })} placeholder="yourshop@okhdfcbank" /></Field>
                <div className="row" style={{ gap: 12 }}>
                  {qr ? <img src={qr} alt="UPI QR preview" style={{ width: 84, height: 84, borderRadius: 8, background: '#fff', padding: 4, border: '1px solid var(--border)' }} /> : <div className="small muted">QR preview appears here.</div>}
                </div>
                <Field label="Bank details" className="span-all" hint="Printed in the “Pay to” box"><textarea className="textarea" value={org.bankDetails} onChange={(ev) => setOrg({ ...org, bankDetails: ev.target.value })} placeholder={'HDFC Bank · A/c 50200012345678\nIFSC HDFC0001234'} /></Field>
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card-body">
              <div className="section-title"><LayoutTemplate size={13} /> Invoice design</div>
              <div className="tpl-pick">
                {TPLS.map(([id, label, color]) => (
                  <button key={id} type="button" className={org.invoiceTemplate === id ? 'active' : ''} onClick={() => setOrg({ ...org, invoiceTemplate: id })} aria-pressed={org.invoiceTemplate === id}>
                    <div className="tpl-thumb">
                      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: id === 'modern' ? 22 : 4, background: color }} />
                      <i style={{ top: 30 }} /><i style={{ top: 40, right: 40 }} /><i style={{ top: 54 }} />
                    </div>
                    {label}
                  </button>
                ))}
              </div>
              <Field label="Invoice footer message" className="mt-16"><input className="input" value={org.invoiceFooter} onChange={(ev) => setOrg({ ...org, invoiceFooter: ev.target.value })} /></Field>
            </div>
          </div>

          <div className="card">
            <div className="card-body">
              <div className="section-title"><BellRing size={13} /> Payment reminders</div>
              <div className="row between">
                <div><div className="strong" style={{ color: 'var(--ink-900)' }}>Automatic email reminders</div><div className="small muted">Overdue customers with an email address get a reminder with the invoice link. Requires email to be configured on the server.</div></div>
                <Toggle checked={org.autoReminders} onChange={(v) => setOrg({ ...org, autoReminders: v })} />
              </div>
              {org.autoReminders && (
                <Field label="Remind every" className="mt-16"><select className="select" style={{ width: 200 }} value={org.reminderDays} onChange={(ev) => setOrg({ ...org, reminderDays: Number(ev.target.value) })}>{[2, 3, 5, 7, 14].map((d) => <option key={d} value={d}>{d} days</option>)}</select></Field>
              )}
            </div>
            <div className="card-footer">
              <button className="btn btn-ghost" disabled={!dirty} onClick={() => setOrg(initial)}>Discard</button>
              <button className="btn btn-primary" disabled={!dirty || save.isPending} onClick={submit}>{save.isPending ? <Loader2 size={15} className="spin" /> : <Save size={15} />} Save Changes</button>
            </div>
          </div>
        </div>

        <div className="card" style={{ position: 'sticky', top: 84 }}>
          <div className="card-header"><div><h3>Invoice header preview</h3><p>How customers see you</p></div></div>
          <div className="card-body light-scope" style={{ background: '#fff', borderRadius: '0 0 12px 12px' }}>
            <div style={{ borderBottom: '3px solid var(--brand-600)', paddingBottom: 14, display: 'flex', gap: 12 }}>
              <div style={{ width: 54, height: 54, borderRadius: 8, background: 'var(--brand-50)', display: 'grid', placeItems: 'center', fontWeight: 600, color: 'var(--brand-700)', overflow: 'hidden', flexShrink: 0 }}>
                {org.logo ? <img src={org.logo} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain' }} /> : initials(org.companyName || '?')}
              </div>
              <div className="small" style={{ minWidth: 0, color: 'var(--ink-700)' }}>
                <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--ink-900)' }}>{org.companyName || 'Company name'}</div>
                <div style={{ whiteSpace: 'pre-line' }}>{org.address}</div>
                {org.gstin && <div style={{ fontWeight: 600 }}>GSTIN: {org.gstin}</div>}
              </div>
            </div>
            <div style={{ textAlign: 'right', marginTop: 10, fontWeight: 600, letterSpacing: '.08em', color: 'var(--brand-700)' }}>{org.compositionScheme ? 'BILL OF SUPPLY' : org.gstin ? 'TAX INVOICE' : 'INVOICE'}</div>
          </div>
        </div>
      </div>
    </div>
  );
}
