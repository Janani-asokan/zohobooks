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
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** A GSTIN's first two digits must match the state it's registered in. */
export const gstinMatchesState = (gstin: string, state: string) => !gstin || gstin.slice(0, 2) === stateCode(state);

export const isInterState = (supplierState: string, placeOfSupply: string) => !!supplierState && !!placeOfSupply && supplierState !== placeOfSupply;

/** B2C invoices above this value to another state are reported individually (GSTR-1 B2CL). */
export const B2CL_THRESHOLD = 100000;
