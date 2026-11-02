import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { api, fieldErrors } from '@/api/client';
import { useMut } from '@/api/hooks';
import type { Customer } from '@/api/types';
import { Field, Modal, Segmented } from '@/components/ui';
import { GSTIN_RE, INDIAN_STATES, gstinMatchesState, stateFromCode } from '../../shared/gst';
import { MOBILE_RULE, isValidMobileOrEmpty, normalizeMobile } from '../../shared/phone';

/** Mobile number input: digits, spaces and +91 only; tidied to "+91 98765 43210" when the cashier moves on. */
export function MobileInput({ id, value, onChange, invalid, autoFocus }: { id?: string; value: string; onChange: (v: string) => void; invalid?: boolean; autoFocus?: boolean }) {
  return (
    <input id={id} className={`input ${invalid ? 'invalid' : ''}`} inputMode="tel" autoComplete="tel" maxLength={18} value={value} placeholder="98765 43210" autoFocus={autoFocus}
      onChange={(e) => onChange(e.target.value.replace(/[^\d+ ()-]/g, ''))} onBlur={() => { const m = normalizeMobile(value); if (m) onChange(m); }} />
  );
}

/**
 * A new customer without leaving the bill: the invoice (or order) stays as it is, and the new customer is picked on it.
 * Individuals need only a name; the mobile number is optional but must be a real 10-digit one when given.
 */
export function QuickCustomerModal({ open, onClose, onCreated, defaultState }: { open: boolean; onClose: () => void; onCreated: (c: Customer) => void; defaultState: string }) {
  const blank = { type: 'Individual' as 'Individual' | 'Business', name: '', companyName: '', gstin: '', phone: '', state: defaultState, email: '' };
  const [f, setF] = useState(blank);
  const [touched, setTouched] = useState(false);
  const [server, setServer] = useState<Record<string, string>>({});
  const create = useMut((b: Record<string, unknown>) => api.post<Customer>('/shop/customers', b), [['customers']], { success: (c) => `${c.companyName || c.name} added` });
  const biz = f.type === 'Business';
  const errs = {
    name: !f.name.trim() ? (biz ? 'Contact person is required' : 'Name is required') : '',
    companyName: biz && !f.companyName.trim() ? 'Company name is required' : '',
    gstin: biz ? (!f.gstin ? 'GST number is required for business customers' : !GSTIN_RE.test(f.gstin) ? 'Invalid GSTIN (e.g. 33AABCA1234F1Z5)' : !gstinMatchesState(f.gstin, f.state) ? 'GSTIN state code doesn’t match the state' : '') : '',
    phone: isValidMobileOrEmpty(f.phone) ? '' : MOBILE_RULE,
  };
  const e = (k: keyof typeof errs) => (touched ? errs[k] : '') || server[k] || '';
  const close = () => { setF(blank); setTouched(false); setServer({}); onClose(); };
  const save = () => {
    setTouched(true); setServer({});
    if (Object.values(errs).some(Boolean)) return;
    create.mutate({ ...f, phone: normalizeMobile(f.phone) ?? '', name: f.name.trim(), companyName: biz ? f.companyName.trim() : '' }, {
      onSuccess: (c) => { onCreated(c); setF(blank); setTouched(false); onClose(); },
      onError: (err) => setServer(fieldErrors(err)),
    });
  };
  return (
    <Modal open={open} onClose={close} title="New customer" subtitle="Saved and picked on this bill. You stay where you are."
      footer={<><button className="btn btn-secondary" onClick={close}>Cancel</button><button className="btn btn-primary" disabled={create.isPending} onClick={save}>{create.isPending && <Loader2 size={15} className="spin" />} Save customer</button></>}>
      <div className="form-grid cols-2">
        <Field label="Type" className="span-all">
          <Segmented value={f.type} onChange={(t) => setF({ ...f, type: t })} options={[{ value: 'Individual', label: 'Individual' }, { value: 'Business', label: 'Business (GST)' }]} />
        </Field>
        {biz && (
          <>
            <Field label="Company name" required error={e('companyName')}><input id="qc-company" className={`input ${e('companyName') ? 'invalid' : ''}`} value={f.companyName} onChange={(ev) => setF({ ...f, companyName: ev.target.value })} autoFocus /></Field>
            <Field label="GST number (GSTIN)" required error={e('gstin')}>
              <input id="qc-gstin" className={`input ${e('gstin') ? 'invalid' : ''}`} maxLength={15} value={f.gstin}
                onChange={(ev) => { const g = ev.target.value.toUpperCase().replace(/[^0-9A-Z]/g, ''); const st = g.length >= 2 ? stateFromCode(g.slice(0, 2)) : ''; setF({ ...f, gstin: g, state: st || f.state }); }} />
            </Field>
          </>
        )}
        <Field label={biz ? 'Contact person' : 'Name'} required error={e('name')}><input id="qc-name" className={`input ${e('name') ? 'invalid' : ''}`} value={f.name} onChange={(ev) => setF({ ...f, name: ev.target.value })} autoFocus={!biz} /></Field>
        <Field label="Mobile number" error={e('phone')} hint="Optional · 10 digits"><MobileInput id="qc-phone" value={f.phone} invalid={!!e('phone')} onChange={(v) => setF({ ...f, phone: v })} /></Field>
        <Field label="State" hint="Decides CGST + SGST or IGST"><select id="qc-state" className="select" value={f.state} onChange={(ev) => setF({ ...f, state: ev.target.value })}>{INDIAN_STATES.map((s) => <option key={s}>{s}</option>)}</select></Field>
      </div>
    </Modal>
  );
}

export interface VendorLite { id: string; name: string; gstin: string; phone: string; state: string }

/** A new vendor without leaving the bill or purchase order: saved and picked on it. Only the name is required. */
export function QuickVendorModal({ open, onClose, onCreated, defaultState }: { open: boolean; onClose: () => void; onCreated: (v: VendorLite) => void; defaultState: string }) {
  const blank = { name: '', gstin: '', phone: '', state: defaultState, email: '' };
  const [f, setF] = useState(blank);
  const [touched, setTouched] = useState(false);
  const [server, setServer] = useState<Record<string, string>>({});
  const create = useMut((b: Record<string, unknown>) => api.post<VendorLite>('/shop/vendors', b), [['vendors']], { success: (v) => `${v.name} added` });
  const errs = {
    name: !f.name.trim() ? 'Vendor name is required' : '',
    gstin: f.gstin && !GSTIN_RE.test(f.gstin) ? 'Invalid GSTIN (e.g. 33AABCA1234F1Z5)' : '',
    phone: f.phone && f.phone.replace(/\D/g, '').length < 6 ? 'Enter a phone number, or leave it empty' : '',
  };
  const e = (k: keyof typeof errs) => (touched ? errs[k] : '') || server[k] || '';
  const close = () => { setF(blank); setTouched(false); setServer({}); onClose(); };
  const save = () => {
    setTouched(true); setServer({});
    if (Object.values(errs).some(Boolean)) return;
    create.mutate({ ...f, name: f.name.trim() }, {
      onSuccess: (v) => { onCreated(v); setF(blank); setTouched(false); onClose(); },
      onError: (err) => setServer(fieldErrors(err)),
    });
  };
  return (
    <Modal open={open} onClose={close} title="New vendor" subtitle="Saved and picked on this bill. You stay where you are."
      footer={<><button className="btn btn-secondary" onClick={close}>Cancel</button><button className="btn btn-primary" disabled={create.isPending} onClick={save}>{create.isPending && <Loader2 size={15} className="spin" />} Save vendor</button></>}>
      <div className="form-grid cols-2">
        <Field label="Vendor name" required error={e('name')} className="span-all"><input id="qv-name" className={`input ${e('name') ? 'invalid' : ''}`} value={f.name} onChange={(ev) => setF({ ...f, name: ev.target.value })} autoFocus /></Field>
        <Field label="GSTIN" error={e('gstin')} hint="Optional · for input tax credit">
          <input id="qv-gstin" className={`input ${e('gstin') ? 'invalid' : ''}`} maxLength={15} value={f.gstin}
            onChange={(ev) => { const g = ev.target.value.toUpperCase().replace(/[^0-9A-Z]/g, ''); const st = g.length >= 2 ? stateFromCode(g.slice(0, 2)) : ''; setF({ ...f, gstin: g, state: st || f.state }); }} />
        </Field>
        <Field label="Phone" error={e('phone')} hint="Optional"><input id="qv-phone" className={`input ${e('phone') ? 'invalid' : ''}`} inputMode="tel" maxLength={20} value={f.phone} onChange={(ev) => setF({ ...f, phone: ev.target.value.replace(/[^\d+ ()-]/g, '') })} /></Field>
        <Field label="State" className="span-all"><select id="qv-state" className="select" value={f.state} onChange={(ev) => setF({ ...f, state: ev.target.value })}>{INDIAN_STATES.map((s) => <option key={s}>{s}</option>)}</select></Field>
      </div>
    </Modal>
  );
}
