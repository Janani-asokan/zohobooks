const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 });

export const money = (n: number) => inr.format(Number.isFinite(n) ? n : 0);
/** Compact Indian notation: ₹1.2Cr, ₹4.8L, ₹25K. */
export const moneyShort = (n: number) => {
  const v = Number.isFinite(n) ? n : 0;
  const a = Math.abs(v);
  const f = (x: number, u: string) => `₹${(v < 0 ? '-' : '')}${+(a / x).toFixed(1)}${u}`;
  if (a >= 1e7) return f(1e7, 'Cr');
  if (a >= 1e5) return f(1e5, 'L');
  if (a >= 1e3) return f(1e3, 'K');
  return `₹${Math.round(v)}`;
};

export const fmtDate = (iso: string) =>
  iso ? new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

export const todayISO = () => toISO(new Date());
export const toISO = (d: Date) => {
  const z = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return z.toISOString().slice(0, 10);
};
export const addDays = (iso: string, days: number) => {
  const d = new Date(iso);
  d.setDate(d.getDate() + days);
  return toISO(d);
};

export const uid = (p = '') => p + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);

export const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');

export const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Rupees in words (Indian numbering) for the printed invoice. */
export function amountInWords(amount: number): string {
  const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
  const two = (n: number) => (n < 20 ? ones[n] : `${tens[Math.floor(n / 10)]}${n % 10 ? ' ' + ones[n % 10] : ''}`);
  const three = (n: number) => {
    const h = Math.floor(n / 100);
    const r = n % 100;
    return [h ? `${ones[h]} Hundred` : '', r ? two(r) : ''].filter(Boolean).join(' ');
  };
  const words = (n: number): string => {
    if (n === 0) return 'Zero';
    const parts: string[] = [];
    const crore = Math.floor(n / 1e7);
    const lakh = Math.floor((n % 1e7) / 1e5);
    const thousand = Math.floor((n % 1e5) / 1e3);
    const rest = n % 1e3;
    if (crore) parts.push(`${words(crore)} Crore`);
    if (lakh) parts.push(`${two(lakh)} Lakh`);
    if (thousand) parts.push(`${two(thousand)} Thousand`);
    if (rest) parts.push(three(rest));
    return parts.join(' ');
  };
  const rupees = Math.floor(amount);
  const paise = Math.round((amount - rupees) * 100);
  return `Rupees ${words(rupees)}${paise ? ` and ${two(paise)} Paise` : ''} Only`;
}
