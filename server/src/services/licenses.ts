/**
 * Warehouse licences, server side: the check that runs inside invoice issuing (documents.ts), the licence numbers on
 * printed invoices, and the hourly job (statuses, expiry reminders, renewal invoices). The rules themselves live in
 * shared/licenses.ts; see docs/warehouse-licenses.md for the design.
 */
import type { Request } from 'express';
import { audit } from '../audit';
import { todayISO } from '../auth';
import { config } from '../config';
import { many, one, query, withTenant, type Db } from '../db';
import { HttpError } from '../http';
import { sendMail } from '../mailer';
import {
  blocksBilling, capacityCheck, dueAlert, gatesInvoice, kindLabel, licenseStatus, nextTerm, splitOverage, STATUS_LABEL,
  type CapacityCheck, type EnforceScope, type LicenseStatus,
} from '../../../shared/licenses';
import type { LineInput } from './documents';

/** Grace days added by live extensions granted for the licence's current expiry date. */
const EXTRA_SQL = `coalesce((SELECT sum(o.extra_days) FROM license_overrides o WHERE o.license_id = l.id AND o.kind = 'grace_extension'
                     AND o.revoked_at IS NULL AND o.for_expiry = l.expiry_date), 0)::int AS extra_grace`;
export const LICENSE_SELECT = `SELECT l.*, ${EXTRA_SQL}, b.name AS branch_name, c.name AS customer_name
  FROM warehouse_licenses l JOIN branches b ON b.id = l.branch_id LEFT JOIN customers c ON c.id = l.customer_id`;

const d = (v: unknown) => (v instanceof Date ? new Date(v.getTime() - v.getTimezoneOffset() * 60000).toISOString().slice(0, 10) : (v as string | null));
const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));

export function statusOf(r: any, today = todayISO()) {
  return licenseStatus({ expiryDate: d(r.expiry_date)!, graceDays: r.grace_days, suspended: r.suspended }, today, Number(r.extra_grace ?? 0));
}

export function serializeLicense(r: any, today = todayISO()) {
  const s = statusOf(r, today);
  return {
    id: r.id, branchId: r.branch_id, branchName: r.branch_name, customerId: r.customer_id, customerName: r.customer_name ?? null,
    licenseType: r.license_type, regulatoryKind: r.regulatory_kind, licenseNumber: r.license_number, issuingAuthority: r.issuing_authority,
    issueDate: d(r.issue_date), expiryDate: d(r.expiry_date), graceDays: r.grace_days, extraGraceDays: Number(r.extra_grace ?? 0),
    maxCapacity: num(r.max_capacity), capacityUnit: r.capacity_unit, documentUrl: r.document_url,
    status: s.status, daysToExpiry: s.daysToExpiry, graceEnds: s.graceEnds, suspended: r.suspended, suspendedReason: r.suspended_reason,
    enforceScope: r.enforce_scope as EnforceScope, printOnInvoice: r.print_on_invoice,
    termStart: d(r.term_start), renewalItemId: r.renewal_item_id, renewalPrice: Number(r.renewal_price), termMonths: r.term_months,
    autoRenewalInvoice: r.auto_renewal_invoice, renewalLeadDays: r.renewal_lead_days, renewalInvoicedFor: d(r.renewal_invoiced_for),
    usageItemId: r.usage_item_id, overageRate: Number(r.overage_rate), creditBalance: Number(r.credit_balance),
    createdAt: r.created_at, updatedAt: r.updated_at,
  };
}
export type LicenseView = ReturnType<typeof serializeLicense>;

/* ======================= The invoice gate ======================= */

export interface LicenseGateInput {
  branchId: string;
  customerId: string | null;
  date: string;
  lines: LineInput[];
  /** What the user chose when the licence check stopped the invoice. */
  override?: { reason: string } | null;
  overage?: 'bill' | 'allow' | null;
}

export interface LicenseFinding {
  licenseId: string; licenseNumber: string; label: string; status: LicenseStatus; statusLabel: string; graceEnds: string; daysToExpiry: number;
}

export interface LicenseGate {
  /** The lines to save: unchanged, or with usage above the licence moved to an overage line. */
  lines: LineInput[];
  checked: Array<{ licenseId: string; status: LicenseStatus }>;
  warnings: LicenseFinding[];
  /** Set when the user overrode a block; recorded against the invoice once it exists. */
  override: { reason: string; licenseIds: string[] } | null;
  capacity: CapacityCheck[];
}

const finding = (r: any, today: string): LicenseFinding => {
  const s = statusOf(r, today);
  return {
    licenseId: r.id, licenseNumber: r.license_number, label: r.license_type === 'regulatory' ? kindLabel(r.regulatory_kind) : r.license_type === 'saas_seat' ? 'Seat licence' : 'Storage licence',
    status: s.status, statusLabel: STATUS_LABEL[s.status], graceEnds: s.graceEnds, daysToExpiry: s.daysToExpiry,
  };
};

/**
 * Runs before an invoice is issued, from every path that issues one (invoice form, POS, challans, recurring, edits).
 * It is a service-level hook rather than Express middleware so background jobs and other services can't skip it.
 *
 * - A gating licence that is EXPIRED or SUSPENDED (on the invoice date or today, so back-dating can't dodge it) stops the
 *   invoice with 409 `license_blocked`, unless the caller holds `licenses.override` and gives a reason.
 * - Usage billed above a capacity / seat licence stops it with 409 `license_capacity` and the overage worked out, unless
 *   the caller asks to bill the overage (`overage: 'bill'`) or overrides it (`'allow'`, needs `licenses.override`).
 * - GRACE and EXPIRING_SOON pass, with warnings returned to show the user.
 */
export async function licenseGate(db: Db, req: Request | null, shopId: string, input: LicenseGateInput, opts: { recordOnly?: boolean } = {}): Promise<LicenseGate> {
  const today = todayISO();
  const rows = await many(db, `${LICENSE_SELECT} WHERE l.shop_id = $1 AND l.branch_id = $2 AND l.enforce_scope <> 'none'`, [shopId, input.branchId]);
  const empty: LicenseGate = { lines: input.lines, checked: [], warnings: [], override: null, capacity: [] };
  if (!rows.length) return empty;
  const types = new Map((await many(db, 'SELECT id, type FROM items WHERE shop_id = $1 AND id = ANY($2::uuid[])', [shopId, input.lines.map((l) => l.itemId)])).map((r) => [r.id, r.type]));
  const hasServiceLines = input.lines.some((l) => types.get(l.itemId) === 'Services');
  const gating = rows.filter((r) => gatesInvoice({ branchId: r.branch_id, customerId: r.customer_id, enforceScope: r.enforce_scope }, { branchId: input.branchId, customerId: input.customerId, hasServiceLines }));
  if (!gating.length) return empty;

  const canOverride = req?.ctx?.kind === 'user' && req.ctx.permissions.includes('licenses.override');
  const reason = input.override?.reason?.trim() ?? '';
  const blocked = gating.filter((r) => blocksBilling(statusOf(r, today).status) || blocksBilling(statusOf(r, input.date).status));
  const overrideIds: string[] = [];
  if (blocked.length && !opts.recordOnly) {
    const details = { licenses: blocked.map((r) => finding(r, today)), canOverride };
    if (!input.override) {
      const first = details.licenses[0]!;
      throw new HttpError(409, `${first.label} ${first.licenseNumber} is ${first.statusLabel.toLowerCase()}. Renew it before billing from this warehouse${canOverride ? ', or override with a reason' : ''}.`, 'license_blocked', details);
    }
    if (!canOverride) throw new HttpError(403, 'Only a Compliance Manager, Manager or the owner can bill past a blocked licence.', 'license_override_forbidden', details);
    if (reason.length < 10) throw new HttpError(400, 'Write why this invoice may go out (at least 10 characters). It is kept in the audit trail.', 'license_override_reason', details);
    overrideIds.push(...blocked.map((r) => r.id));
  }

  let lines = input.lines;
  const capacity: CapacityCheck[] = [];
  for (const r of gating) {
    const lic = { id: r.id, usageItemId: r.usage_item_id, maxCapacity: num(r.max_capacity), overageRate: Number(r.overage_rate), capacityUnit: r.capacity_unit, licenseNumber: r.license_number };
    const chk = capacityCheck(lines, lic);
    if (!chk || chk.excess <= 0) continue;
    capacity.push(chk);
    if (opts.recordOnly) continue;
    if (input.overage === 'bill' && chk.overageRate > 0) lines = splitOverage(lines, lic);
    else if (input.overage === 'allow') {
      if (!canOverride) throw new HttpError(403, 'Only a Compliance Manager, Manager or the owner can bill above the licensed capacity without the overage charge.', 'license_override_forbidden', { capacity });
      if (reason.length < 10) throw new HttpError(400, 'Write why the extra usage isn’t charged (at least 10 characters).', 'license_override_reason', { capacity });
      overrideIds.push(r.id);
    } else {
      throw new HttpError(409, `This bills ${chk.billed} ${chk.unit || 'units'} on licence ${r.license_number}, which allows ${chk.licensed}. `
        + (chk.overageRate > 0 ? `Bill the extra ${chk.excess} at the overage rate (₹${chk.overageAmount.toFixed(2)} before tax), or upgrade the licence.` : 'Upgrade the licence to cover it.'),
        'license_capacity', { capacity, canOverride, canBillOverage: chk.overageRate > 0 });
    }
  }

  return {
    lines,
    checked: gating.map((r) => ({ licenseId: r.id, status: statusOf(r, today).status })),
    warnings: gating.filter((r) => ['grace', 'expiring_soon'].includes(statusOf(r, today).status) || (opts.recordOnly && blocked.includes(r))).map((r) => finding(r, today)),
    override: overrideIds.length ? { reason, licenseIds: [...new Set(overrideIds)] } : null,
    capacity,
  };
}

/** Writes what the gate found against the issued invoice: the licences checked, their status, and any override. */
export async function recordLicenseGate(db: Db, req: Request | null, shopId: string, invoiceId: string, gate: LicenseGate, opts: { recordOnly?: boolean } = {}) {
  if (!gate.checked.length) return;
  const byLicense = new Map<string, string>();
  if (gate.override) {
    // The user is only linked when they belong to this shop (an owner who switched in from another keeps just the name).
    const who = req?.ctx?.kind === 'user' ? { id: req.ctx.homeShopId === shopId ? req.ctx.id : null, name: req.ctx.name } : { id: null, name: 'System' };
    for (const licenseId of gate.override.licenseIds) {
      const o = await one(db, `INSERT INTO license_overrides (shop_id, license_id, kind, for_expiry, invoice_id, reason, granted_by, granted_by_name)
        SELECT $1, $2, 'invoice_override', expiry_date, $3, $4, $5, $6 FROM warehouse_licenses WHERE shop_id = $1 AND id = $2 RETURNING id`,
      [shopId, licenseId, invoiceId, gate.override.reason, who.id, who.name]);
      byLicense.set(licenseId, o.id);
      await audit(db, req, shopId, 'license_override', 'invoice', invoiceId, { licenseId, reason: gate.override.reason });
    }
  }
  for (const c of gate.checked) {
    await db.query(`INSERT INTO invoice_licenses (shop_id, invoice_id, license_id, status_at_issue, override_id) VALUES ($1,$2,$3,$4,$5)
                    ON CONFLICT (invoice_id, license_id) DO UPDATE SET status_at_issue = EXCLUDED.status_at_issue, override_id = coalesce(EXCLUDED.override_id, invoice_licenses.override_id)`,
    [shopId, invoiceId, c.licenseId, c.status, byLicense.get(c.licenseId) ?? null]);
  }
  // A bill made offline at the counter was already handed over: it is kept, and the breach is put on record.
  if (opts.recordOnly) {
    const bad = gate.checked.filter((c) => blocksBilling(c.status));
    if (bad.length || gate.capacity.length) await audit(db, req, shopId, 'license_breach_offline', 'invoice', invoiceId, { licenses: bad.map((b) => b.licenseId), capacity: gate.capacity });
  }
}

/* ======================= On the printed invoice ======================= */

/** Regulatory licence numbers for the warehouse an invoice ships from, as printed under the GSTIN. */
export async function printableLicenses(db: Db, shopId: string, branchId: string | null) {
  if (!branchId) return [];
  const rows = await many(db, `${LICENSE_SELECT} WHERE l.shop_id = $1 AND l.branch_id = $2 AND l.license_type = 'regulatory' AND l.print_on_invoice
                               ORDER BY l.regulatory_kind, l.license_number`, [shopId, branchId]);
  // Only valid licences are printed: an expired number on a tax invoice would misstate the registration.
  return rows.filter((r) => !blocksBilling(statusOf(r).status)).map((r) => ({ label: r.regulatory_kind === 'fssai' ? 'FSSAI Lic. No.' : kindLabel(r.regulatory_kind), value: r.license_number as string }));
}

/* ======================= The scheduled job ======================= */

const THRESHOLD_TEXT = (t: number) => (t === 0 ? 'has expired today' : `expires in ${t} days`);

/**
 * Hourly, idempotent (safe to run any number of times a day, and on two servers):
 *  1. saves each licence's status when the date moves it on (and audits the change);
 *  2. sends the 90 / 60 / 30 / 7 / 0-day reminder once per expiry date (license_alerts primary key);
 *  3. makes a draft renewal invoice `renewal_lead_days` before expiry for licences sold to a client, once per expiry
 *     date, using any downgrade credit as a discount.
 */
export async function runLicenseJob(today = todayISO()) {
  const shops = await query("SELECT s.id, s.name FROM shops s WHERE s.active AND s.license_end >= $1 AND EXISTS (SELECT 1 FROM warehouse_licenses w WHERE w.shop_id = s.id)", [today]);
  const out = { statusChanges: 0, alerts: 0, renewals: 0 };
  for (const shop of shops) {
    await withTenant(shop.id, async (db) => {
      const rows = await many(db, `${LICENSE_SELECT} WHERE l.shop_id = $1 FOR UPDATE OF l SKIP LOCKED`, [shop.id]);
      for (const r of rows) {
        const s = statusOf(r, today);
        if (s.status !== r.status) {
          await db.query('UPDATE warehouse_licenses SET status = $2, updated_at = now() WHERE id = $1', [r.id, s.status]);
          await audit(db, null, shop.id, 'status_change', 'warehouse_license', r.id, { from: r.status, to: s.status, licenseNumber: r.license_number });
          out.statusChanges++;
        }
        if (!r.suspended) {
          const sent = new Set((await many(db, 'SELECT threshold FROM license_alerts WHERE license_id = $1 AND for_expiry = $2', [r.id, r.expiry_date])).map((a) => a.threshold as number));
          const t = dueAlert(s.daysToExpiry, sent);
          if (t !== null) {
            const ins = await one(db, `INSERT INTO license_alerts (shop_id, license_id, threshold, for_expiry) VALUES ($1,$2,$3,$4)
                                        ON CONFLICT DO NOTHING RETURNING license_id`, [shop.id, r.id, t, r.expiry_date]);
            if (ins) {
              const ok = await sendAlert(db, shop, r, t, s.graceEnds);
              if (ok) await db.query('UPDATE license_alerts SET delivered = true WHERE license_id = $1 AND for_expiry = $2 AND threshold = $3', [r.id, r.expiry_date, t]);
              out.alerts++;
            }
          }
        }
        if (await makeRenewalInvoice(db, shop.id, r, s.daysToExpiry, today)) out.renewals++;
      }
    });
  }
  return out;
}

async function sendAlert(db: Db, shop: { id: string; name: string }, r: any, threshold: number, graceEnds: string) {
  const to = (await many(db, "SELECT email, name FROM users WHERE shop_id = $1 AND active AND role IN ('Owner', 'Compliance Manager', 'Manager') AND email <> ''", [shop.id]));
  if (!to.length) return false;
  const what = `${r.license_type === 'regulatory' ? kindLabel(r.regulatory_kind) : 'Licence'} ${r.license_number} (${r.branch_name})`;
  const blocks = r.enforce_scope !== 'none';
  try {
    for (const u of to) {
      await sendMail({
        to: u.email,
        subject: `${what} ${THRESHOLD_TEXT(threshold)}`,
        text: `Hi ${u.name},\n\n${what} for ${shop.name} ${THRESHOLD_TEXT(threshold)} (expiry date ${d(r.expiry_date)}).`
          + (blocks ? `\nInvoices from this warehouse ${threshold === 0 ? `can still be issued during the grace period, until ${graceEnds}. After that they are blocked` : 'will be blocked once it expires and any grace period ends'}.` : '')
          + `\n\nRenew it and update the licence at ${config.appUrl}/app/licenses/${r.id}`,
      });
    }
    return true;
  } catch (e) {
    console.error('[licenses] alert mail failed:', (e as Error).message);
    return false;
  }
}

async function makeRenewalInvoice(db: Db, shopId: string, r: any, daysToExpiry: number, today: string) {
  if (!r.auto_renewal_invoice || r.suspended || r.license_type === 'regulatory' || !r.customer_id || !r.renewal_item_id || Number(r.renewal_price) <= 0) return false;
  if (daysToExpiry > r.renewal_lead_days || d(r.renewal_invoiced_for) === d(r.expiry_date)) return false;
  const { createInvoice } = await import('./documents'); // documents.ts imports this file
  const term = nextTerm(d(r.expiry_date)!, r.term_months);
  const credit = Math.min(Number(r.credit_balance), Number(r.renewal_price));
  await db.query('SAVEPOINT renewal');
  try {
    const inv = await createInvoice(db, null, shopId, {
      customerId: r.customer_id, date: today, dueDate: d(r.expiry_date)! < today ? today : d(r.expiry_date)!, branchId: r.branch_id,
      lines: [{ itemId: r.renewal_item_id, qty: 1, rate: Number(r.renewal_price), discount: 0, tier: 'SP1', note: `Renewal of licence ${r.license_number}: ${term.start} to ${term.end}${r.max_capacity ? ` · ${Number(r.max_capacity)} ${r.capacity_unit}` : ''}`.slice(0, 300) }],
      withGst: !!(await one(db, 'SELECT gstin FROM organizations WHERE shop_id = $1', [shopId]))?.gstin, reverseCharge: false, tcsRate: 0,
      notes: credit > 0 ? `Includes a credit of ₹${credit.toFixed(2)} from an earlier mid-term reduction.` : '',
      billDiscount: credit > 0 ? { kind: 'amount', value: credit } : null,
    }, { issue: false, source: 'recurring' });
    await db.query('UPDATE warehouse_licenses SET renewal_invoiced_for = expiry_date, credit_balance = credit_balance - $2, updated_at = now() WHERE id = $1', [r.id, credit]);
    await audit(db, null, shopId, 'renewal_invoice', 'warehouse_license', r.id, { invoiceId: inv.id, term, credit });
    await db.query('RELEASE SAVEPOINT renewal');
    return true;
  } catch (e) {
    // Nothing is marked as invoiced, so the next hourly run tries again (for example once a missing item is fixed).
    await db.query('ROLLBACK TO SAVEPOINT renewal');
    console.error(`[licenses] renewal invoice for ${r.id} failed:`, (e as Error).message);
    return false;
  }
}

/** For the bell: licences needing attention. */
export async function licenseAttention(db: Db, shopId: string) {
  const rows = await many(db, `${LICENSE_SELECT} WHERE l.shop_id = $1`, [shopId]);
  const counts = { expiring_soon: 0, grace: 0, expired: 0, suspended: 0 } as Record<string, number>;
  for (const r of rows) { const s = statusOf(r).status; if (s in counts) counts[s]!++; }
  return counts;
}
