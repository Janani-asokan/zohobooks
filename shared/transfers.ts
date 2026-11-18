/**
 * Inter-branch stock transfers: destination pricing and the OTP rules, with no database or clock of their own, so the
 * server, the screens and the tests agree. See docs/stock-transfers.md.
 *
 *   Draft ──initiate──► In transit (pending OTP) ──verify OTP──► Received (verified & completed)
 *     │                    │    ▲   │
 *     │                    │    └───┘ resend OTP (new code, old one void)
 *     └──delete            └──cancel──► Cancelled (stock back at the source batch)
 */

/* ---------- Destination pricing ---------- */

export interface PricingRule {
  id: string;
  name: string;
  kind: 'location' | 'seasonal';
  /** null = every branch */
  branchId: string | null;
  /** null = every item (narrowed by category if set) */
  itemId: string | null;
  category: string | null;
  adjustType: 'percent' | 'amount';
  /** +10 = 10 % / ₹10 more; −5 = 5 % / ₹5 less */
  adjustValue: number;
  startsOn: string | null;
  endsOn: string | null;
  priority: number;
  /** Round the final price to this step (0 = paise, 1 = rupee, 5, 10 …) */
  roundTo: number;
  active: boolean;
}

export interface AppliedRule { ruleId: string; name: string; kind: 'location' | 'seasonal' | 'manual'; change: string; before: number; after: number }
export interface PriceResult { base: number; price: number; applied: AppliedRule[] }

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Whether a rule applies to this item at this branch on this date. */
export function ruleMatches(r: PricingRule, t: { branchId: string; itemId: string; category: string; date: string }) {
  if (!r.active) return false;
  if (r.branchId && r.branchId !== t.branchId) return false;
  if (r.itemId && r.itemId !== t.itemId) return false;
  if (!r.itemId && r.category && r.category.toLowerCase() !== t.category.toLowerCase()) return false;
  if (r.kind === 'seasonal' && (!r.startsOn || !r.endsOn || t.date < r.startsOn || t.date > r.endsOn)) return false;
  return true;
}

/**
 * The selling price at the destination: the item's standard price, then the branch's location rules, then the
 * seasonal rules running on that date, each in priority order (a percent multiplies, an amount adds). Starting from
 * the standard price, not the source branch's price, keeps a chain of transfers from compounding modifiers. Never
 * below zero; rounded to the largest rounding step among the rules used. The batch's purchase cost is not touched.
 */
export function destinationPrice(base: number, rules: PricingRule[], t: { branchId: string; itemId: string; category: string; date: string }): PriceResult {
  const use = rules.filter((r) => ruleMatches(r, t))
    .sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'location' ? -1 : 1) || a.priority - b.priority || a.name.localeCompare(b.name));
  let p = base;
  const applied: AppliedRule[] = [];
  for (const r of use) {
    const before = p;
    p = r.adjustType === 'percent' ? p * (1 + r.adjustValue / 100) : p + r.adjustValue;
    p = Math.max(0, r2(p));
    const sign = r.adjustValue >= 0 ? '+' : '−';
    applied.push({ ruleId: r.id, name: r.name, kind: r.kind, change: r.adjustType === 'percent' ? `${sign}${Math.abs(r.adjustValue)}%` : `${sign}₹${Math.abs(r.adjustValue)}`, before, after: p });
  }
  const step = Math.max(0, ...use.map((r) => r.roundTo));
  if (step > 0) {
    const rounded = Math.max(0, Math.round(p / step) * step);
    if (rounded !== p) applied.push({ ruleId: '', name: `Rounded to ₹${step}`, kind: 'location', change: `→ ₹${rounded}`, before: p, after: r2(rounded) });
    p = r2(rounded);
  }
  return { base, price: p, applied };
}

/** A price typed by the sender replaces the calculated one, and says so. */
export function withManualPrice(calc: PriceResult, manual: number | null | undefined): PriceResult {
  if (manual === null || manual === undefined || manual === calc.price) return calc;
  return { ...calc, price: r2(manual), applied: [...calc.applied, { ruleId: '', name: 'Set by hand on the transfer', kind: 'manual', change: `→ ₹${r2(manual)}`, before: calc.price, after: r2(manual) }] };
}

/* ---------- Receipt ---------- */

export interface ReceiptLine { qtySent: number; received: number; damaged: number; missing: number }

/** Every unit sent is accounted for: received + damaged + missing = sent, none negative. */
export function receiptError(l: ReceiptLine): string | null {
  const q = (n: number) => Math.round(n * 1000) / 1000;
  if ([l.received, l.damaged, l.missing].some((n) => n < 0 || !Number.isFinite(n))) return 'Quantities can’t be negative';
  if (q(l.received + l.damaged + l.missing) !== q(l.qtySent)) return `Received, damaged and missing must add up to the ${l.qtySent} sent`;
  return null;
}

/** Weighted average cost when units of a batch arrive where the same batch already has stock. */
export function blendCost(haveQty: number, haveCost: number | null, addQty: number, addCost: number) {
  if (haveQty <= 0 || haveCost === null) return addCost;
  return Math.round(((haveQty * haveCost + addQty * addCost) / (haveQty + addQty)) * 10000) / 10000;
}

/* ---------- OTP ---------- */

export const OTP = {
  digits: 6,
  /** A code is valid this long after it is sent. */
  ttlMinutes: 15,
  /** Wrong tries before a code is locked (a new one must be sent). */
  maxAttempts: 3,
  /** Wait between sends. */
  resendSeconds: 60,
  /** Codes per transfer in any 24 hours. */
  maxSendsPerDay: 6,
} as const;

export type OtpCheck = 'ok' | 'none' | 'expired' | 'locked' | 'wrong';

/** What happens to an entered code, given the latest code's state (the hash comparison is done by the caller). */
export function otpState(otp: { expiresAt: Date; attempts: number; usedAt: Date | null } | null, now: Date): Exclude<OtpCheck, 'ok' | 'wrong'> | 'open' {
  if (!otp || otp.usedAt) return 'none';
  if (otp.attempts >= OTP.maxAttempts) return 'locked';
  if (now.getTime() > otp.expiresAt.getTime()) return 'expired';
  return 'open';
}

/** "ma•••@shop.com": enough to recognise the address, not enough to harvest it. */
export function maskEmail(email: string) {
  const [u, d] = email.split('@');
  if (!u || !d) return '•••';
  return `${u.slice(0, Math.min(2, u.length))}${'•'.repeat(Math.max(3, u.length - 2))}@${d}`;
}

/** Above this value of goods, an e-way bill is needed for the movement (Rule 138, CGST Rules). */
export const EWAY_BILL_THRESHOLD = 50_000;
