/**
 * Indian mobile numbers for customers. Optional (a quick counter bill needs none), but when given it must be a real
 * 10-digit mobile: starting 6–9, written with or without +91 / 91 / 0 in front and with any spaces or dashes. More or
 * fewer digits are refused, so a typo never saves. Saved the same way every time: "+91 98765 43210".
 */
export const MOBILE_RULE = 'Enter a 10-digit mobile number (e.g. 98765 43210), or leave it empty';

/** The 10 digits of a mobile number, or null when it is not one. An empty value is '' (no number). */
export function mobileDigits(input: string | null | undefined): string | null {
  const raw = String(input ?? '').trim();
  if (!raw) return '';
  if (/[^\d\s+()-]/.test(raw)) return null; // letters or other symbols
  let d = raw.replace(/\D/g, '');
  if (raw.startsWith('+')) {
    if (!d.startsWith('91')) return null; // only Indian numbers
    d = d.slice(2);
  } else if (d.length === 12 && d.startsWith('91')) d = d.slice(2);
  else if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
  return /^[6-9]\d{9}$/.test(d) ? d : null;
}

/** "+91 98765 43210" for a valid mobile, '' for empty, null when invalid. */
export function normalizeMobile(input: string | null | undefined): string | null {
  const d = mobileDigits(input);
  if (d === null) return null;
  return d ? `+91 ${d.slice(0, 5)} ${d.slice(5)}` : '';
}

export const isValidMobileOrEmpty = (input: string | null | undefined) => mobileDigits(input) !== null;
