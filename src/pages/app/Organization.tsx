import { useRef, useState } from 'react';
import { Upload, Trash2, Save, ImageIcon } from 'lucide-react';
import { useTenant } from '@/context/TenantContext';
import { useToast } from '@/context/ToastContext';
import { Field, PageHeader } from '@/components/ui';
import { EMAIL_RE, GSTIN_RE, initials } from '@/lib/format';
import { INDIAN_STATES } from '@/lib/invoice';
import type { Organization as Org } from '@/lib/types';

/** Downscale uploaded logos so they stay small in storage and crisp on A4. */
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
  const { tenant, mutate } = useTenant();
  const toast = useToast();
  const [org, setOrg] = useState<Org>(tenant.org);
  const [touched, setTouched] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const errs = {
    companyName: !org.companyName.trim() ? 'Company name is required' : '',
    gstin: org.gstin && !GSTIN_RE.test(org.gstin) ? 'Invalid GSTIN' : '',
    email: org.email && !EMAIL_RE.test(org.email) ? 'Invalid email' : '',
  };
  const e = (k: keyof typeof errs) => (touched ? errs[k] : '');
  const dirty = JSON.stringify(org) !== JSON.stringify(tenant.org);

  const onFile = async (f?: File) => {
    if (!f) return;
    if (!f.type.startsWith('image/')) return toast('error', 'Please choose an image file');
    if (f.size > 4 * 1024 * 1024) return toast('error', 'Logo must be under 4 MB');
    try {
      setOrg({ ...org, logo: await readLogo(f) });
    } catch {
      toast('error', 'Could not read that image');
    }
  };

  return (
    <div className="page" style={{ maxWidth: 1100 }}>
      <PageHeader title="Organization profile" subtitle="Your company details and logo appear on every invoice you print." />
      <div className="grid-3-1" style={{ alignItems: 'start' }}>
        <div className="card">
          <div className="card-body">
            <div className="section-title">Logo</div>
            <div className="row" style={{ gap: 18 }}>
              <div
                style={{ width: 120, height: 120, borderRadius: 16, border: '2px dashed var(--border-strong)', display: 'grid', placeItems: 'center', background: 'var(--ink-50)', overflow: 'hidden', cursor: 'pointer' }}
                onClick={() => fileRef.current?.click()}
                onDragOver={(ev) => ev.preventDefault()}
                onDrop={(ev) => { ev.preventDefault(); onFile(ev.dataTransfer.files[0]); }}
              >
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
              <Field label="GSTIN" error={e('gstin')}><input className={`input ${e('gstin') ? 'invalid' : ''}`} maxLength={15} value={org.gstin} onChange={(ev) => setOrg({ ...org, gstin: ev.target.value.toUpperCase().replace(/[^0-9A-Z]/g, '') })} style={{ fontFamily: 'ui-monospace, Menlo, monospace' }} /></Field>
              <Field label="State" hint="Determines CGST+SGST vs IGST"><select className="select" value={org.state} onChange={(ev) => setOrg({ ...org, state: ev.target.value })}>{INDIAN_STATES.map((s) => <option key={s}>{s}</option>)}</select></Field>
              <Field label="Email" error={e('email')}><input className={`input ${e('email') ? 'invalid' : ''}`} value={org.email} onChange={(ev) => setOrg({ ...org, email: ev.target.value })} /></Field>
              <Field label="Phone"><input className="input" value={org.phone} onChange={(ev) => setOrg({ ...org, phone: ev.target.value })} /></Field>
              <Field label="Address" className="span-all"><textarea className="textarea" value={org.address} onChange={(ev) => setOrg({ ...org, address: ev.target.value })} /></Field>
              <Field label="Invoice footer message" className="span-all"><input className="input" value={org.invoiceFooter} onChange={(ev) => setOrg({ ...org, invoiceFooter: ev.target.value })} /></Field>
            </div>
          </div>
          <div className="card-footer">
            <button className="btn btn-ghost" disabled={!dirty} onClick={() => setOrg(tenant.org)}>Discard</button>
            <button className="btn btn-primary" disabled={!dirty} onClick={() => {
              setTouched(true);
              if (Object.values(errs).some(Boolean)) return;
              mutate((t) => void (t.org = { ...org, companyName: org.companyName.trim() }));
              toast('success', 'Organization profile saved');
            }}><Save size={15} /> Save Changes</button>
          </div>
        </div>

        <div className="card" style={{ position: 'sticky', top: 84 }}>
          <div className="card-header"><div><h3>Invoice header preview</h3><p>How customers see you</p></div></div>
          <div className="card-body">
            <div style={{ borderBottom: '3px solid var(--brand-600)', paddingBottom: 14, display: 'flex', gap: 12 }}>
              <div style={{ width: 54, height: 54, borderRadius: 10, background: 'var(--brand-50)', display: 'grid', placeItems: 'center', fontWeight: 800, color: 'var(--brand-700)', overflow: 'hidden', flexShrink: 0 }}>
                {org.logo ? <img src={org.logo} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain' }} /> : initials(org.companyName || '?')}
              </div>
              <div className="small" style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 800, fontSize: 15, color: 'var(--ink-900)' }}>{org.companyName || 'Company name'}</div>
                <div className="muted" style={{ whiteSpace: 'pre-line' }}>{org.address}</div>
                {org.gstin && <div style={{ fontWeight: 700 }}>GSTIN: {org.gstin}</div>}
              </div>
            </div>
            <div style={{ textAlign: 'right', marginTop: 10, fontWeight: 800, letterSpacing: '.08em', color: 'var(--brand-700)' }}>TAX INVOICE</div>
          </div>
        </div>
      </div>
    </div>
  );
}
