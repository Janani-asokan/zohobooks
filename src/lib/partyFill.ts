import type { FillRow } from '@/components/SmartUpload';
import type { ExtractedParty } from '../../shared/extract';
import { GSTIN_RE, INDIAN_STATES } from '../../shared/gst';

export interface PartyDraft { name: string; companyName?: string; gstin: string; phone: string; email: string; state: string; address?: string }

/** Review rows for a customer or vendor read from a GST certificate, visiting card or letterhead. */
export function partyRows(p: ExtractedParty, cur: PartyDraft, withCompany: boolean): FillRow[] {
  const gstin = (p.gstin ?? '').toUpperCase();
  return [
    ...(withCompany ? [{ key: 'company', label: 'Company / trade name', value: p.companyName, current: cur.companyName }] : []),
    { key: 'name', label: withCompany ? 'Contact person' : 'Name', value: withCompany ? p.name : p.companyName || p.name, current: cur.name },
    { key: 'gstin', label: 'GSTIN', value: GSTIN_RE.test(gstin) ? gstin : null, current: cur.gstin },
    { key: 'phone', label: 'Phone', value: p.phone, current: cur.phone },
    { key: 'email', label: 'Email', value: p.email, current: cur.email },
    { key: 'state', label: 'State', value: INDIAN_STATES.includes(p.state ?? '') ? p.state : null, current: cur.state },
    ...(cur.address !== undefined ? [{ key: 'address', label: 'Address', value: p.address, current: cur.address }] : []),
  ];
}

export function applyParty<T extends PartyDraft>(d: T, keys: Set<string>, p: ExtractedParty, withCompany: boolean): T {
  const n = { ...d };
  const gstin = (p.gstin ?? '').toUpperCase();
  if (withCompany && keys.has('company') && p.companyName) n.companyName = p.companyName.slice(0, 150);
  const nm = withCompany ? p.name : p.companyName || p.name;
  if (keys.has('name') && nm) n.name = nm.slice(0, 150);
  if (keys.has('gstin') && GSTIN_RE.test(gstin)) n.gstin = gstin;
  if (keys.has('phone') && p.phone) n.phone = p.phone;
  if (keys.has('email') && p.email) n.email = p.email;
  if (keys.has('state') && p.state && INDIAN_STATES.includes(p.state)) n.state = p.state;
  if (n.address !== undefined && keys.has('address') && p.address) n.address = p.address.slice(0, 500);
  return n;
}
