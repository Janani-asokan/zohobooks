/** GST state codes (first two digits of a GSTIN; also the "place of supply" code). */
export const STATE_CODES: Record<string, string> = {
  'Jammu and Kashmir': '01', 'Himachal Pradesh': '02', Punjab: '03', Chandigarh: '04', Uttarakhand: '05', Haryana: '06', Delhi: '07',
  Rajasthan: '08', 'Uttar Pradesh': '09', Bihar: '10', Sikkim: '11', 'Arunachal Pradesh': '12', Nagaland: '13', Manipur: '14',
  Mizoram: '15', Tripura: '16', Meghalaya: '17', Assam: '18', 'West Bengal': '19', Jharkhand: '20', Odisha: '21', Chhattisgarh: '22',
  'Madhya Pradesh': '23', Gujarat: '24', 'Dadra and Nagar Haveli and Daman and Diu': '26', Maharashtra: '27', Karnataka: '29', Goa: '30',
  Lakshadweep: '31', Kerala: '32', 'Tamil Nadu': '33', Puducherry: '34', 'Andaman and Nicobar Islands': '35', Telangana: '36',
  'Andhra Pradesh': '37', Ladakh: '38',
};
export const INDIAN_STATES = Object.keys(STATE_CODES).sort();
export const stateCode = (state: string) => STATE_CODES[state] ?? '';
export const stateFromCode = (code: string) => Object.entries(STATE_CODES).find(([, c]) => c === code)?.[0] ?? '';

export const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
/** Same rule as shared/contact.ts: a real name@domain.tld (no random text, no double dots, 2–24 letter ending). */
export const EMAIL_RE = /^[A-Za-z0-9%+_-]+(?:\.[A-Za-z0-9%+_-]+)*@(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,24}$/;

/** A GSTIN's first two digits must match the state it's registered in. */
export const gstinMatchesState = (gstin: string, state: string) => !gstin || gstin.slice(0, 2) === stateCode(state);

export const isInterState = (supplierState: string, placeOfSupply: string) => !!supplierState && !!placeOfSupply && supplierState !== placeOfSupply;

/** B2C invoices above this value to another state are reported individually (GSTR-1 B2CL). */
export const B2CL_THRESHOLD = 100000;

/* ---------- GSTIN check (offline) ---------- */

const GST_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
/** The 15th character of a GSTIN: a checksum of the first 14 (the GSTN's mod-36 rule). */
export function gstinCheckDigit(g: string) {
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const p = GST_CHARS.indexOf(g[i]!) * (i % 2 ? 2 : 1);
    sum += Math.floor(p / 36) + (p % 36);
  }
  return GST_CHARS[(36 - (sum % 36)) % 36]!;
}

/** Who holds the PAN inside a GSTIN (its 4th letter). */
const PAN_HOLDER: Record<string, string> = {
  C: 'Company', P: 'Proprietor (individual)', H: 'Hindu Undivided Family', F: 'Partnership firm / LLP', A: 'Association of persons',
  T: 'Trust', B: 'Body of individuals', L: 'Local authority', J: 'Artificial juridical person', G: 'Government',
};

export interface GstinCheck {
  /** 'ok': the format, state and check digit are right. 'typo': the check digit doesn't match. 'bad': not a GSTIN. */
  status: 'ok' | 'typo' | 'bad';
  message: string;
  state: string; pan: string; holder: string;
  /** Business (company, firm…) or Individual (proprietor) — for the customer type. */
  partyType: 'Business' | 'Individual';
}

/** Everything a GSTIN tells without going online: its state, the PAN, who holds it, and whether it has a typo. */
export function checkGstin(raw: string): GstinCheck {
  const g = raw.trim().toUpperCase();
  const empty = { state: '', pan: '', holder: '', partyType: 'Business' as const };
  if (g.length !== 15) return { status: 'bad', message: `A GSTIN has 15 characters; this has ${g.length}.`, ...empty };
  if (!/^[0-9]{2}/.test(g)) return { status: 'bad', message: 'A GSTIN starts with the 2-digit state code.', ...empty };
  const state = stateFromCode(g.slice(0, 2));
  if (!state) return { status: 'bad', message: `${g.slice(0, 2)} is not an Indian state code.`, ...empty };
  if (!GSTIN_RE.test(g)) return { status: 'bad', message: 'Characters 3–12 must be the PAN (5 letters, 4 digits, 1 letter), then a digit or letter, then Z.', ...empty, state };
  const pan = g.slice(2, 12);
  const holder = PAN_HOLDER[pan[3]!] ?? 'Other';
  const partyType = pan[3] === 'P' ? 'Individual' : 'Business';
  const want = gstinCheckDigit(g);
  if (want !== g[14]) return { status: 'typo', message: `The last character should be ${want} for this number, so one of the characters is probably mistyped. Please check it against the bill or certificate.`, state, pan, holder, partyType };
  return { status: 'ok', message: `Valid format · ${state} · ${holder}`, state, pan, holder, partyType };
}

/**
 * A gentle check of an HSN / SAC code (not a block): services use SAC codes that start with 99, goods use HSN codes
 * that don't, and invoices use 4, 6 or 8 digits (4 for turnover up to ₹5 crore, 6 above).
 */
export function hsnNote(code: string, type: 'Goods' | 'Services'): string | null {
  const c = code.trim();
  if (!c) return null;
  if (![4, 6, 8].includes(c.length)) return `HSN / SAC codes have 4, 6 or 8 digits; this has ${c.length}.`;
  if (type === 'Services' && !c.startsWith('99')) return 'Service (SAC) codes start with 99. Is this item really a service?';
  if (type === 'Goods' && c.startsWith('99')) return 'Codes starting with 99 are for services (SAC). Goods use an HSN code from the purchase bill.';
  return null;
}
