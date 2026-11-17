/**
 * Warehouse licences: the rules, with no database or clock of their own, so the server, the daily job and the screen
 * all agree. Dates are ISO calendar dates (YYYY-MM-DD) in the shop's time zone.
 *
 * Status is derived, never stored as the truth:
 *
 *            suspend()                        reinstate()
 *   ┌──────────────────────────────► SUSPENDED ─────────────► (recomputed from dates)
 *   │
 *  ACTIVE ──(≤30 days left)──► EXPIRING_SOON ──(past expiry)──► GRACE ──(past grace end)──► EXPIRED
 *    ▲                              │                             │                          │
 *    └──────────── renew() (new expiry date) ◄────────────────────┴──────────────────────────┘
 *                         grace extension (Compliance Manager) pushes the grace end out: EXPIRED → GRACE
 */

export const LICENSE_TYPES = [
  { key: 'regulatory', label: 'Regulatory permit' },
  { key: 'storage_capacity', label: 'Storage capacity' },
  { key: 'saas_seat', label: 'Software seats' },
] as const;
export type LicenseType = (typeof LICENSE_TYPES)[number]['key'];

export const REGULATORY_KINDS = [
  { key: 'fssai', label: 'FSSAI licence' },
  { key: 'fire_noc', label: 'Fire NOC' },
  { key: 'bonded_warehouse', label: 'Bonded warehouse licence' },
  { key: 'trade', label: 'Trade licence' },
  { key: 'drug', label: 'Drug licence' },
  { key: 'pollution', label: 'Pollution control consent' },
  { key: 'other', label: 'Other permit' },
] as const;
export type RegulatoryKind = (typeof REGULATORY_KINDS)[number]['key'];

export const LICENSE_STATUSES = ['active', 'expiring_soon', 'grace', 'expired', 'suspended'] as const;
export type LicenseStatus = (typeof LICENSE_STATUSES)[number];
export const STATUS_LABEL: Record<LicenseStatus, string> = {
  active: 'Active', expiring_soon: 'Expiring soon', grace: 'Grace period', expired: 'Expired', suspended: 'Suspended',
};
export type EnforceScope = 'all' | 'service_items' | 'none';

/** Days before expiry when a licence counts as "expiring soon". */
export const EXPIRING_SOON_DAYS = 30;
/** Reminders, in days before expiry (0 = on the day it expires). */
export const ALERT_THRESHOLDS = [90, 60, 30, 7, 0] as const;

export const typeLabel = (t: string) => LICENSE_TYPES.find((x) => x.key === t)?.label ?? t;
export const kindLabel = (k: string | null | undefined) => REGULATORY_KINDS.find((x) => x.key === k)?.label ?? 'Licence';

const DAY = 86_400_000;
const utc = (iso: string) => { const [y, m, d] = iso.split('-').map(Number); return Date.UTC(y!, m! - 1, d!); };
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
/** Whole days from a to b (b - a). */
export const daysBetween = (a: string, b: string) => Math.round((utc(b) - utc(a)) / DAY);
export const addDays = (d: string, n: number) => iso(utc(d) + n * DAY);
/** Adds calendar months, clamping to the month's last day (31 Jan + 1 month = 28/29 Feb). */
export function addMonths(d: string, n: number) {
  const [y, m, day] = d.split('-').map(Number);
  const first = new Date(Date.UTC(y!, m! - 1 + n, 1));
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  return iso(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), Math.min(day!, last)));
}

export interface LicenseDates { expiryDate: string; graceDays: number; suspended: boolean }

export interface StatusResult {
  status: LicenseStatus;
  /** Days until the expiry date (negative once past it). */
  daysToExpiry: number;
  /** Last day billing is still allowed: expiry + grace days + extensions granted for this expiry. */
  graceEnds: string;
}

/** The state machine: a licence's status on a day, from its dates, grace extensions and the suspend flag. */
export function licenseStatus(l: LicenseDates, today: string, extraGraceDays = 0): StatusResult {
  const daysToExpiry = daysBetween(today, l.expiryDate);
  const graceEnds = addDays(l.expiryDate, l.graceDays + extraGraceDays);
  let status: LicenseStatus;
  if (l.suspended) status = 'suspended';
  else if (daysToExpiry > EXPIRING_SOON_DAYS) status = 'active';
  else if (daysToExpiry >= 0) status = 'expiring_soon';
  else if (today <= graceEnds) status = 'grace';
  else status = 'expired';
  return { status, daysToExpiry, graceEnds };
}

/** Invoices can't be issued against these without a documented override. Grace still allows billing (with a warning). */
export const blocksBilling = (s: LicenseStatus) => s === 'expired' || s === 'suspended';

/**
 * The reminder due today, if any: the nearest threshold at or above the days left. A job that was down for a week
 * sends one reminder (the current one), not every one it missed.
 */
export function dueAlert(daysToExpiry: number, alreadySent: ReadonlySet<number>): number | null {
  if (daysToExpiry < 0) return alreadySent.has(0) ? null : 0;
  const t = [...ALERT_THRESHOLDS].reverse().find((x) => x >= daysToExpiry);
  if (t === undefined || alreadySent.has(t)) return null;
  return t;
}

/** Whether a licence gates an invoice: same warehouse, the licence's client (or a warehouse-wide licence), and scope. */
export function gatesInvoice(l: { branchId: string; customerId: string | null; enforceScope: EnforceScope },
  inv: { branchId: string; customerId: string | null; hasServiceLines: boolean }) {
  if (l.enforceScope === 'none' || l.branchId !== inv.branchId) return false;
  if (l.customerId && l.customerId !== inv.customerId) return false;
  return l.enforceScope === 'all' || inv.hasServiceLines;
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const r3 = (n: number) => Math.round(n * 1000) / 1000;

/* ---------- Capacity & overage ---------- */

export interface CapacityLicense { id: string; usageItemId: string | null; maxCapacity: number | null; overageRate: number; capacityUnit: string; licenseNumber: string }
export interface UsageLine { itemId: string; qty: number; rate?: number; note?: string; [k: string]: unknown }
export interface CapacityCheck { licenseId: string; licensed: number; billed: number; excess: number; overageRate: number; overageAmount: number; unit: string; suggestedCapacity: number }

/** Units billed on the licence's usage item against what the licence allows. */
export function capacityCheck(lines: UsageLine[], l: CapacityLicense): CapacityCheck | null {
  if (!l.usageItemId || !l.maxCapacity) return null;
  const billed = r3(lines.filter((x) => x.itemId === l.usageItemId).reduce((s, x) => s + x.qty, 0));
  const excess = r3(Math.max(0, billed - l.maxCapacity));
  return {
    licenseId: l.id, licensed: l.maxCapacity, billed, excess, overageRate: l.overageRate, overageAmount: r2(excess * l.overageRate), unit: l.capacityUnit,
    // An upgrade that covers this usage, rounded up to a tidy step (10 % of the current size, at least 1).
    suggestedCapacity: excess > 0 ? Math.ceil(billed / Math.max(1, Math.round(l.maxCapacity / 10))) * Math.max(1, Math.round(l.maxCapacity / 10)) : l.maxCapacity,
  };
}

/**
 * Bills usage above the licence at the overage rate: the usage lines are cut back to the licensed quantity and one
 * overage line is added for the rest. Lines after the limit is reached are reduced first (last in, first charged).
 */
export function splitOverage<L extends UsageLine>(lines: L[], l: CapacityLicense): L[] {
  const chk = capacityCheck(lines, l);
  if (!chk || chk.excess <= 0) return lines;
  let left = chk.licensed;
  const out: L[] = [];
  let template: L | null = null;
  for (const line of lines) {
    if (line.itemId !== l.usageItemId) { out.push(line); continue; }
    template ??= line;
    const keep = r3(Math.min(line.qty, Math.max(0, left)));
    left = r3(left - keep);
    if (keep > 0) out.push({ ...line, qty: keep });
  }
  const unit = l.capacityUnit ? ` ${l.capacityUnit}` : '';
  out.push({ ...template!, qty: chk.excess, rate: l.overageRate, discount: 0,
    note: `Overage above licensed ${chk.licensed}${unit} (licence ${l.licenseNumber})`.slice(0, 300) });
  return out;
}

/* ---------- Proration ---------- */

/** Days in a term, counting both ends. */
export const termDays = (start: string, end: string) => daysBetween(start, end) + 1;

/**
 * The part of a full-term price that falls between `from` and the term end (both days counted). Used for mid-term
 * upgrades (charge the difference for the days left) and downgrades (credit it on the next renewal).
 */
export function prorate(fullTermPrice: number, termStart: string, termEnd: string, from: string) {
  if (from > termEnd) return { days: 0, totalDays: termDays(termStart, termEnd), amount: 0 };
  const start = from < termStart ? termStart : from;
  const days = termDays(start, termEnd);
  const totalDays = termDays(termStart, termEnd);
  return { days, totalDays, amount: r2((fullTermPrice * days) / totalDays) };
}

/** Price of the new size when only the size changes: the same price per unit as today. */
export const scaledPrice = (price: number, oldCapacity: number, newCapacity: number) => r2((price / oldCapacity) * newCapacity);

/** The next term after a renewal. */
export const nextTerm = (expiry: string, months: number) => ({ start: addDays(expiry, 1), end: addDays(addMonths(addDays(expiry, 1), months), -1) });
