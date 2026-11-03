/**
 * Contact details on parties. One rule for the forms, the server and imports, so nothing invalid is saved.
 *
 * Email: name@domain.tld, letters, digits and . _ % + - in the name (no leading, trailing or double dots), a real
 * domain (labels of letters, digits and hyphens) and a 2–24 letter ending. "abc", "a@b", "x@y.c", "a..b@x.com" fail.
 *
 * Vendor phone: suppliers often give an office landline, so a vendor may have either
 *   - a 10-digit Indian mobile (6–9 first), with or without +91 / 0, saved as "+91 98765 43210", or
 *   - a landline with its STD code, e.g. 0422 2345678 / 044-23456789 / +91 422 2345678 (10 digits after the 0),
 *     saved as "0422 2345678"-style digits "04222345678", or
 *   - a toll-free 1800 number.
 * Letters, too few or too many digits, or another country's number are refused.
 */
import { normalizeMobile } from './phone';

export const EMAIL_RULE = 'Enter a valid email address (e.g. accounts@supplier.in), or leave it empty';
export const VENDOR_PHONE_RULE = 'Enter a 10-digit mobile or a landline with STD code (e.g. 0422 2345678), or leave it empty';

const EMAIL = /^[A-Za-z0-9%+_-]+(?:\.[A-Za-z0-9%+_-]+)*@(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,24}$/;
export const isValidEmail = (v: string | null | undefined) => EMAIL.test(String(v ?? '').trim());
export const isValidEmailOrEmpty = (v: string | null | undefined) => !String(v ?? '').trim() || isValidEmail(v);
/** Lower-cased, trimmed; '' for empty; null when invalid. */
export function normalizeEmail(v: string | null | undefined): string | null {
  const s = String(v ?? '').trim();
  if (!s) return '';
  return isValidEmail(s) && s.length <= 120 ? s.toLowerCase() : null;
}

/** A vendor's phone as saved, '' for empty, null when it isn't a real Indian mobile, landline or toll-free number. */
export function normalizeVendorPhone(input: string | null | undefined): string | null {
  const raw = String(input ?? '').trim();
  if (!raw) return '';
  const mobile = normalizeMobile(raw);
  if (mobile) return mobile;
  if (/[^\d\s+()-]/.test(raw)) return null;
  let d = raw.replace(/\D/g, '');
  if (/^1800\d{6,7}$/.test(d)) return d;
  if (raw.startsWith('+')) { if (!d.startsWith('91')) return null; d = d.slice(2); }
  else if (d.length === 12 && d.startsWith('91')) d = d.slice(2);
  if (d.length === 10 && /^[2-5]/.test(d)) d = `0${d}`; // landline written after +91, without the 0
  return /^0[2-5]\d{9}$/.test(d) ? d : null;
}
export const isValidVendorPhoneOrEmpty = (v: string | null | undefined) => normalizeVendorPhone(v) !== null;
