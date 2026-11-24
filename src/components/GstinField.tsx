import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, BadgeCheck, ExternalLink, Loader2, ShieldCheck, XCircle } from 'lucide-react';
import { api } from '@/api/client';
import { Field } from '@/components/ui';
import { checkGstin, type GstinCheck } from '../../shared/gst';
import '@/styles/gstin.css';

export interface Taxpayer {
  legalName: string; tradeName: string; status: string; registeredOn: string; cancelledOn: string;
  constitution: string; taxpayerType: string; address: string; city: string; district: string; state: string; pincode: string;
}
export interface GstinResult {
  gstin: string; check: GstinCheck; lookup: 'found' | 'not_found' | 'off' | 'failed' | 'skipped'; taxpayer: Taxpayer | null;
  existing: { id: string; name: string } | null; isYours: boolean; error?: string;
}
/** What Validate can fill in: the form decides which of its fields these go to (only empty ones by default). */
export interface GstinFill { legalName: string; tradeName: string; address: string; state: string; partyType: 'Business' | 'Individual'; pincode: string }

const clean = (v: string) => v.toUpperCase().replace(/[^0-9A-Z]/g, '').slice(0, 15);
const inactive = (s: string) => !!s && !/^active$/i.test(s);

/**
 * GST number with a Validate button. The number is checked as it is typed (state, PAN, check digit); at 15
 * characters, or on Validate, it is looked up in the GST register (when the lookup service is set up) and the
 * legal name, address and state are filled into the form's empty fields.
 */
export function GstinField({ value, onChange, onFill, forWhat, label = 'GST number (GSTIN)', required, error, hint, optionalHint }: {
  value: string; onChange: (gstin: string) => void; onFill?: (f: GstinFill, r: GstinResult) => void;
  forWhat?: 'customer' | 'vendor'; label?: string; required?: boolean; error?: string; hint?: string; optionalHint?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<GstinResult | null>(null);
  const [netErr, setNetErr] = useState('');
  const last = useRef('');
  const g = clean(value);
  const local = g.length === 15 ? checkGstin(g) : null;

  const validate = async (num = g, auto = false) => {
    if (num.length !== 15) return;
    last.current = num;
    setBusy(true); setNetErr('');
    try {
      const r = await api.get<GstinResult>(`/shop/gstin/${num}${forWhat ? `?for=${forWhat}` : ''}`);
      if (last.current !== num) return; // typed on since
      setRes(r);
      if (r.check.status !== 'bad' && onFill) {
        const t = r.taxpayer;
        onFill({ legalName: t?.legalName ?? '', tradeName: t?.tradeName ?? '', address: t?.address ?? '', state: r.check.state, partyType: r.check.partyType, pincode: t?.pincode ?? '' }, r);
      }
    } catch (e) {
      if (!auto) setNetErr((e as Error).message);
    } finally { setBusy(false); }
  };
  // Validates by itself once all 15 characters are in (typed or pasted).
  useEffect(() => {
    if (g.length === 15 && g !== last.current) void validate(g, true);
    if (g.length < 15) { setRes(null); last.current = ''; }
  }, [g]); // eslint-disable-line react-hooks/exhaustive-deps

  const shown = res && res.gstin === g ? res : null;
  const t = shown?.taxpayer;
  return (
    <Field label={label} required={required} error={error}
      hint={!shown && !local ? (hint ?? (g ? `${15 - g.length} more character${15 - g.length === 1 ? '' : 's'}` : optionalHint ?? '15 characters, e.g. 33AABCA1234F1Z5')) : undefined}>
      <div className="gstin-wrap">
        <div className="gstin-row">
          <input className={`input gstin-input ${error || local?.status === 'bad' ? 'invalid' : ''}`} value={g} maxLength={15} spellCheck={false} autoCapitalize="characters" autoComplete="off"
            aria-label={label} onChange={(e) => onChange(clean(e.target.value))} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void validate(); } }} placeholder="33AABCA1234F1Z5" />
          <button type="button" className="btn btn-secondary gstin-btn" disabled={g.length !== 15 || busy} onClick={() => validate()}>
            {busy ? <Loader2 size={15} className="spin" /> : <ShieldCheck size={15} />} Validate
          </button>
        </div>
        {local && local.status !== 'ok' && (
          <div className={`gstin-note ${local.status === 'bad' ? 'bad' : 'warn'}`} role="alert">{local.status === 'bad' ? <XCircle size={15} /> : <AlertTriangle size={15} />} <span>{local.message}</span></div>
        )}
        {netErr && <div className="gstin-note warn"><AlertTriangle size={15} /> <span>Couldn’t check online ({netErr}). The number itself looks {local?.status === 'ok' ? 'right' : 'wrong'}.</span></div>}
        {shown && shown.check.status === 'ok' && (
          <div className={`gstin-card ${t && inactive(t.status) ? 'bad' : ''}`}>
            {t ? (
              <>
                <div className="gstin-card-head">
                  {inactive(t.status) ? <XCircle size={16} /> : <BadgeCheck size={16} />}
                  <strong>{t.legalName || t.tradeName}</strong>
                  <span className={`badge ${inactive(t.status) ? 'badge-red' : 'badge-green'}`}>{t.status || 'Registered'}</span>
                </div>
                {t.tradeName && t.tradeName !== t.legalName && <div className="small">Trade name: {t.tradeName}</div>}
                <div className="small muted">{[t.constitution || shown.check.holder, t.taxpayerType, t.registeredOn && `since ${t.registeredOn}`].filter(Boolean).join(' · ')}</div>
                {t.address && <div className="small">{t.address}</div>}
                {inactive(t.status) && <div className="small strong">This GST number is {t.status.toLowerCase()}{t.cancelledOn ? ` (from ${t.cancelledOn})` : ''}. Bill them as unregistered, and you can’t claim input credit on their bills.</div>}
                {onFill && !inactive(t.status) && <div className="small muted">Name, address and state filled in where empty.</div>}
              </>
            ) : (
              <>
                <div className="gstin-card-head"><BadgeCheck size={16} /><strong>{shown.lookup === 'not_found' ? 'Not in the GST register' : 'Format is correct'}</strong></div>
                <div className="small muted">{shown.check.state} · {shown.check.holder} · PAN {shown.check.pan}</div>
                {shown.lookup === 'not_found' && <div className="small strong">The GST register has no such number. Check it with the customer.</div>}
                {(shown.lookup === 'off' || shown.lookup === 'failed') && (
                  <>
                    <div className="small muted">{shown.lookup === 'off' ? 'State filled in. To get the registered name and address, look the number up on the GST portal (free), then type them below.' : 'The GST register couldn’t be reached just now. Try Validate again, or look it up on the GST portal.'}</div>
                    <button type="button" className="btn btn-soft btn-sm gstin-portal" onClick={() => { void navigator.clipboard?.writeText(shown.gstin).catch(() => undefined); window.open('https://services.gst.gov.in/services/searchtp', '_blank', 'noopener'); }}>
                      <ExternalLink size={14} /> Find on GST portal <span className="muted">(number copied: paste it there)</span>
                    </button>
                  </>
                )}
              </>
            )}
            {shown.existing && <div className="small gstin-dup"><AlertTriangle size={14} /> Already saved as {forWhat} “{shown.existing.name}”.</div>}
            {shown.isYours && <div className="small gstin-dup"><AlertTriangle size={14} /> This is your own business’s GSTIN.</div>}
          </div>
        )}
      </div>
    </Field>
  );
}

/** Fills a value only when the field is empty (never overwrites what someone typed). */
export const fillEmpty = (current: string, next: string) => (current.trim() ? current : next);
