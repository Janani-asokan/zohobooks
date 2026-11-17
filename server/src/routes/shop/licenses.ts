/**
 * Warehouse licences API (mounted under /api/shop). Read needs licenses.read; changes licenses.write; grace periods
 * and overrides licenses.override (Compliance Manager, Manager, Owner). Every change is audited with what it was.
 */
import { Router } from 'express';
import { z } from 'zod';
import { audit } from '../../audit';
import { perm, todayISO } from '../../auth';
import { many, one, type Db } from '../../db';
import { HttpError, badRequest, conflict, notFound, parse } from '../../http';
import { primaryBranchId } from '../../services/common';
import { createInvoice, lineInput } from '../../services/documents';
import { LICENSE_SELECT, licenseGate, serializeLicense, statusOf } from '../../services/licenses';
import { addDays, blocksBilling, LICENSE_STATUSES, prorate, REGULATORY_KINDS, scaledPrice } from '../../../../shared/licenses';
import { T } from './ctx';

export const licensesRouter = Router();

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date like 2027-03-31');
const reason = z.string().trim().min(10, 'Write a reason of at least 10 characters; it is kept in the audit trail').max(500);
// Only web links: a javascript: or data: URL here would run when someone opens the document.
const docUrl = z.string().trim().max(500).refine((v) => v === '' || /^https?:\/\/[^\s]+$/i.test(v), 'Use a link starting with https://');

const fields = z.object({
  branchId: z.string().uuid('Pick the warehouse'),
  customerId: z.string().uuid().nullable().default(null),
  licenseType: z.enum(['regulatory', 'saas_seat', 'storage_capacity']),
  regulatoryKind: z.enum(REGULATORY_KINDS.map((k) => k.key) as [string, ...string[]]).nullable().default(null),
  licenseNumber: z.string().trim().min(1, 'Enter the licence number').max(60),
  issuingAuthority: z.string().trim().max(120).default(''),
  issueDate: isoDate,
  expiryDate: isoDate,
  graceDays: z.number().int().min(0).max(365).default(0),
  maxCapacity: z.number().positive('Must be more than 0').max(1e9).nullable().default(null),
  capacityUnit: z.string().trim().max(30).default(''),
  documentUrl: docUrl.default(''),
  enforceScope: z.enum(['all', 'service_items', 'none']).default('service_items'),
  printOnInvoice: z.boolean().default(true),
  renewalItemId: z.string().uuid().nullable().default(null),
  renewalPrice: z.number().min(0).max(1e10).default(0),
  termMonths: z.number().int().min(1).max(60).default(12),
  autoRenewalInvoice: z.boolean().default(false),
  renewalLeadDays: z.number().int().min(1).max(120).default(30),
  usageItemId: z.string().uuid().nullable().default(null),
  overageRate: z.number().min(0).max(1e9).default(0),
});
type Fields = z.infer<typeof fields>;

function checkRules(b: Fields) {
  const e: Record<string, string> = {};
  if (b.expiryDate < b.issueDate) e.expiryDate = 'Expiry can’t be before the issue date';
  if (b.licenseType === 'regulatory' && !b.regulatoryKind) e.regulatoryKind = 'Pick the kind of permit';
  if (b.licenseType !== 'regulatory' && !b.maxCapacity) e.maxCapacity = 'Enter the licensed capacity or seats';
  if (b.autoRenewalInvoice && b.licenseType !== 'regulatory') {
    if (!b.customerId) e.customerId = 'Pick the client to bill renewals to';
    if (!b.renewalItemId) e.renewalItemId = 'Pick the item to bill renewals with';
    if (!(b.renewalPrice > 0)) e.renewalPrice = 'Enter the renewal price';
  }
  if (b.overageRate > 0 && !b.usageItemId) e.usageItemId = 'Pick the item usage is billed with';
  if (Object.keys(e).length) throw badRequest(Object.values(e)[0]!, e);
}

/** Linked rows must exist in this shop (the composite foreign keys also guarantee it; this gives a clear message). */
async function checkLinks(db: Db, shopId: string, b: Fields) {
  const exists = async (table: string, id: string | null) => !id || !!(await one(db, `SELECT 1 FROM ${table} WHERE shop_id = $1 AND id = $2`, [shopId, id]));
  if (!(await exists('branches', b.branchId))) throw badRequest('Unknown warehouse', { branchId: 'Pick a warehouse' });
  if (!(await exists('customers', b.customerId))) throw badRequest('Unknown client', { customerId: 'Pick a client' });
  for (const k of ['renewalItemId', 'usageItemId'] as const) {
    if (!b[k]) continue;
    const it = await one(db, 'SELECT type FROM items WHERE shop_id = $1 AND id = $2', [shopId, b[k]]);
    if (!it) throw badRequest('Unknown item', { [k]: 'Pick an item' });
    if (it.type !== 'Services') throw badRequest('Licence fees and storage are billed with a service item', { [k]: 'Pick a service item' });
  }
}

const COLS = ['branch_id', 'customer_id', 'license_type', 'regulatory_kind', 'license_number', 'issuing_authority', 'issue_date', 'expiry_date', 'grace_days',
  'max_capacity', 'capacity_unit', 'document_url', 'enforce_scope', 'print_on_invoice', 'renewal_item_id', 'renewal_price', 'term_months',
  'auto_renewal_invoice', 'renewal_lead_days', 'usage_item_id', 'overage_rate'] as const;
const values = (b: Fields) => [b.branchId, b.customerId, b.licenseType, b.licenseType === 'regulatory' ? b.regulatoryKind : null, b.licenseNumber, b.issuingAuthority,
  b.issueDate, b.expiryDate, b.graceDays, b.maxCapacity, b.capacityUnit, b.documentUrl, b.enforceScope, b.printOnInvoice, b.renewalItemId, b.renewalPrice,
  b.termMonths, b.autoRenewalInvoice, b.renewalLeadDays, b.usageItemId, b.overageRate];

async function load(db: Db, shopId: string, id: string, lock = false) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound('Licence');
  const r = await one(db, `${LICENSE_SELECT} WHERE l.shop_id = $1 AND l.id = $2${lock ? ' FOR UPDATE OF l' : ''}`, [shopId, id]);
  if (!r) throw notFound('Licence');
  return r;
}
/** Saves the status the dates now give (the daily job does the same for licences nobody touched). */
async function refresh(db: Db, shopId: string, id: string) {
  const r = await load(db, shopId, id);
  const s = statusOf(r).status;
  if (s !== r.status) await db.query('UPDATE warehouse_licenses SET status = $2 WHERE id = $1', [id, s]);
  return serializeLicense({ ...r, status: s });
}

/* ---------- Read ---------- */

licensesRouter.get('/licenses', perm('licenses.read'), T(async (db, req, c) => {
  const q = req.query as Record<string, string | undefined>;
  const rows = await many(db, `${LICENSE_SELECT} WHERE l.shop_id = $1 ${q.branchId ? 'AND l.branch_id = $2' : ''} ORDER BY l.expiry_date, l.license_number`,
    q.branchId ? [c.shopId, q.branchId] : [c.shopId]);
  const list = rows.map((r) => serializeLicense(r));
  const counts = Object.fromEntries(LICENSE_STATUSES.map((s) => [s, list.filter((l) => l.status === s).length]));
  return { licenses: list.filter((l) => (!q.status || l.status === q.status) && (!q.type || l.licenseType === q.type)), counts };
}));

licensesRouter.get('/licenses/:id', perm('licenses.read'), T(async (db, req, c) => {
  const r = await load(db, c.shopId, req.params.id!);
  const overrides = await many(db, `SELECT o.*, i.number AS invoice_number FROM license_overrides o LEFT JOIN invoices i ON i.id = o.invoice_id
                                    WHERE o.license_id = $1 ORDER BY o.created_at DESC LIMIT 100`, [r.id]);
  const alerts = await many(db, 'SELECT threshold, for_expiry, sent_at, delivered FROM license_alerts WHERE license_id = $1 ORDER BY sent_at DESC LIMIT 50', [r.id]);
  const invoices = await many(db, `SELECT i.id, i.number, i.date, i.total, i.status, il.status_at_issue, il.override_id IS NOT NULL AS overridden
                                   FROM invoice_licenses il JOIN invoices i ON i.id = il.invoice_id WHERE il.license_id = $1 ORDER BY i.date DESC, i.number DESC LIMIT 30`, [r.id]);
  return {
    license: serializeLicense(r),
    overrides: overrides.map((o) => ({ id: o.id, kind: o.kind, extraDays: o.extra_days, forExpiry: o.for_expiry, invoiceId: o.invoice_id, invoiceNumber: o.invoice_number,
      reason: o.reason, grantedBy: o.granted_by_name, createdAt: o.created_at, revokedAt: o.revoked_at, revokedBy: o.revoked_by_name })),
    alerts: alerts.map((a) => ({ threshold: a.threshold, forExpiry: a.for_expiry, sentAt: a.sent_at, delivered: a.delivered })),
    invoices: invoices.map((i) => ({ id: i.id, number: i.number, date: i.date, total: Number(i.total), status: i.status, statusAtIssue: i.status_at_issue, overridden: i.overridden })),
  };
}));

/**
 * The same check issuing runs, without saving anything: the invoice form calls it to warn early. Answers
 * { ok, code?, message?, details?, warnings, capacity }.
 */
licensesRouter.post('/licenses/check-invoice', perm('sales.write'), T(async (db, req, c) => {
  const b = parse(z.object({ branchId: z.string().uuid().nullable().optional(), customerId: z.string().uuid().nullable(), date: isoDate, lines: z.array(lineInput).max(500) }), req.body);
  const branchId = await primaryBranchId(db, c.shopId, b.branchId ?? c.branchId);
  try {
    const g = await licenseGate(db, req, c.shopId, { branchId, customerId: b.customerId, date: b.date, lines: b.lines });
    return { ok: true, warnings: g.warnings, capacity: g.capacity };
  } catch (e) {
    if (e instanceof HttpError && e.code.startsWith('license_')) return { ok: false, code: e.code, message: e.message, details: e.details, warnings: [], capacity: [] };
    throw e;
  }
}));

/* ---------- Write ---------- */

licensesRouter.post('/licenses', perm('licenses.write'), T(async (db, req, c, res) => {
  const b = parse(fields, req.body);
  checkRules(b);
  await checkLinks(db, c.shopId, b);
  const r = await one(db, `INSERT INTO warehouse_licenses (shop_id, ${COLS.join(', ')}, term_start, created_by)
                           VALUES ($1, ${COLS.map((_, i) => `$${i + 2}`).join(', ')}, $${COLS.length + 2}, $${COLS.length + 3}) RETURNING id`,
  [c.shopId, ...values(b), b.issueDate, c.homeShopId === c.shopId ? c.id : null]);
  await audit(db, req, c.shopId, 'create', 'warehouse_license', r.id, { number: b.licenseNumber, type: b.licenseType, expiry: b.expiryDate });
  req.audited = true;
  res.status(201);
  return refresh(db, c.shopId, r.id);
}));

/** Corrects a licence's details. Moving to a new expiry date is a renewal (below), which keeps the history. */
licensesRouter.patch('/licenses/:id', perm('licenses.write'), T(async (db, req, c) => {
  const cur = serializeLicense(await load(db, c.shopId, req.params.id!, true));
  const patch = parse(fields.partial().omit({ licenseType: true }), req.body);
  const b = parse(fields, { ...cur, ...Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) });
  checkRules(b);
  await checkLinks(db, c.shopId, b);
  if (b.expiryDate !== cur.expiryDate && b.expiryDate > cur.expiryDate!) throw badRequest('To move the expiry date later, renew the licence (that keeps the old term in the history).', { expiryDate: 'Use Renew' });
  await db.query(`UPDATE warehouse_licenses SET ${COLS.map((col, i) => `${col} = $${i + 3}`).join(', ')}, updated_at = now() WHERE shop_id = $1 AND id = $2`,
    [c.shopId, cur.id, ...values(b)]);
  const changed = Object.keys(patch).filter((k) => JSON.stringify((cur as Record<string, unknown>)[k]) !== JSON.stringify((b as Record<string, unknown>)[k]));
  await audit(db, req, c.shopId, 'update', 'warehouse_license', cur.id, Object.fromEntries(changed.map((k) => [k, { from: (cur as Record<string, unknown>)[k], to: (b as Record<string, unknown>)[k] }])));
  req.audited = true;
  return refresh(db, c.shopId, cur.id);
}));

licensesRouter.post('/licenses/:id/renew', perm('licenses.write'), T(async (db, req, c) => {
  const r = await load(db, c.shopId, req.params.id!, true);
  const old = serializeLicense(r);
  const b = parse(z.object({
    expiryDate: isoDate, issueDate: isoDate.optional(), licenseNumber: z.string().trim().min(1).max(60).optional(),
    issuingAuthority: z.string().trim().max(120).optional(), documentUrl: docUrl.optional(),
  }), req.body);
  if (b.expiryDate <= old.expiryDate!) throw badRequest('The new expiry date must be after the current one', { expiryDate: `After ${old.expiryDate}` });
  // The new term starts the day after the old one ends, unless the new permit says otherwise.
  const start = b.issueDate ?? addDays(old.expiryDate!, 1);
  if (start > b.expiryDate) throw badRequest('The new issue date must be on or before the new expiry date', { issueDate: 'Too late' });
  await db.query(`UPDATE warehouse_licenses SET expiry_date = $3, issue_date = $4, term_start = $4, license_number = coalesce($5, license_number),
                    issuing_authority = coalesce($6, issuing_authority), document_url = coalesce($7, document_url), updated_at = now() WHERE shop_id = $1 AND id = $2`,
  [c.shopId, r.id, b.expiryDate, start, b.licenseNumber ?? null, b.issuingAuthority ?? null, b.documentUrl ?? null]);
  await audit(db, req, c.shopId, 'renew', 'warehouse_license', r.id, { from: { number: old.licenseNumber, expiry: old.expiryDate }, to: { number: b.licenseNumber ?? old.licenseNumber, expiry: b.expiryDate } });
  req.audited = true;
  return refresh(db, c.shopId, r.id);
}));

licensesRouter.post('/licenses/:id/suspend', perm('licenses.write'), T(async (db, req, c) => {
  const b = parse(z.object({ reason }), req.body);
  const r = await load(db, c.shopId, req.params.id!, true);
  if (r.suspended) throw conflict('This licence is already suspended');
  await db.query('UPDATE warehouse_licenses SET suspended = true, suspended_reason = $3, updated_at = now() WHERE shop_id = $1 AND id = $2', [c.shopId, r.id, b.reason]);
  await audit(db, req, c.shopId, 'suspend', 'warehouse_license', r.id, { reason: b.reason, number: r.license_number });
  req.audited = true;
  return refresh(db, c.shopId, r.id);
}));

licensesRouter.post('/licenses/:id/reinstate', perm('licenses.write'), T(async (db, req, c) => {
  const b = parse(z.object({ reason }), req.body);
  const r = await load(db, c.shopId, req.params.id!, true);
  if (!r.suspended) throw conflict('This licence isn’t suspended');
  await db.query("UPDATE warehouse_licenses SET suspended = false, suspended_reason = '', updated_at = now() WHERE shop_id = $1 AND id = $2", [c.shopId, r.id]);
  await audit(db, req, c.shopId, 'reinstate', 'warehouse_license', r.id, { reason: b.reason, number: r.license_number });
  req.audited = true;
  return refresh(db, c.shopId, r.id);
}));

/** Compliance Manager: a temporary grace extension for the current expiry date, with a mandatory reason. */
licensesRouter.post('/licenses/:id/grace', perm('licenses.override'), T(async (db, req, c) => {
  const b = parse(z.object({ days: z.number().int().min(1, 'At least 1 day').max(90, 'At most 90 days at a time'), reason }), req.body);
  const r = await load(db, c.shopId, req.params.id!, true);
  if (r.suspended) throw conflict('A suspended licence can’t get a grace period. Reinstate it first.');
  if (Number(r.extra_grace) + b.days > 180) throw badRequest('Grace extensions for one expiry date can add up to 180 days. Renew the licence instead.');
  const o = await one(db, `INSERT INTO license_overrides (shop_id, license_id, kind, extra_days, for_expiry, reason, granted_by, granted_by_name)
                           VALUES ($1,$2,'grace_extension',$3,$4,$5,$6,$7) RETURNING id`,
  [c.shopId, r.id, b.days, r.expiry_date, b.reason, c.homeShopId === c.shopId ? c.id : null, c.name]);
  await audit(db, req, c.shopId, 'grant_grace', 'warehouse_license', r.id, { overrideId: o.id, days: b.days, reason: b.reason });
  req.audited = true;
  return refresh(db, c.shopId, r.id);
}));

licensesRouter.post('/licenses/:id/overrides/:oid/revoke', perm('licenses.override'), T(async (db, req, c) => {
  const b = parse(z.object({ reason }), req.body);
  const r = await load(db, c.shopId, req.params.id!, true);
  const o = await one(db, `UPDATE license_overrides SET revoked_at = now(), revoked_by_name = $4
                           WHERE shop_id = $1 AND license_id = $2 AND id = $3 AND kind = 'grace_extension' AND revoked_at IS NULL RETURNING id`,
  [c.shopId, r.id, req.params.oid, c.name]);
  if (!o) throw notFound('Active grace extension');
  await audit(db, req, c.shopId, 'revoke_grace', 'warehouse_license', r.id, { overrideId: o.id, reason: b.reason });
  req.audited = true;
  return refresh(db, c.shopId, r.id);
}));

/**
 * Mid-term upgrade or downgrade of a capacity / seat licence. The price difference is prorated by day over what is
 * left of the current term (both ends counted): an upgrade makes a draft invoice for it (taxed on the item's GST rate
 * as at today, the time of supply); a downgrade becomes a credit taken off the next renewal invoice.
 */
licensesRouter.post('/licenses/:id/change-capacity', perm('licenses.write'), T(async (db, req, c) => {
  const b = parse(z.object({
    newCapacity: z.number().positive().max(1e9), newPrice: z.number().min(0).max(1e10).optional(), effectiveDate: isoDate.optional(),
    reason, makeInvoice: z.boolean().default(true),
  }), req.body);
  const r = await load(db, c.shopId, req.params.id!, true);
  const l = serializeLicense(r);
  if (l.licenseType === 'regulatory' || !l.maxCapacity) throw badRequest('Only capacity and seat licences have a size to change');
  if (blocksBilling(l.status)) throw conflict(`This licence is ${l.status}. Renew or reinstate it before changing its size.`);
  if (b.newCapacity === l.maxCapacity) throw badRequest('That is the current size', { newCapacity: 'Enter a different size' });
  const effective = b.effectiveDate ?? todayISO();
  if (effective < l.termStart! || effective > l.expiryDate!) throw badRequest(`The change must take effect within the current term (${l.termStart} to ${l.expiryDate})`, { effectiveDate: 'Outside the term' });
  const newPrice = b.newPrice ?? scaledPrice(l.renewalPrice, l.maxCapacity, b.newCapacity);
  const p = prorate(Math.abs(newPrice - l.renewalPrice), l.termStart!, l.expiryDate!, effective);
  const up = newPrice > l.renewalPrice;
  let invoice: { id: string; number: string | null } | null = null;
  if (up && p.amount > 0 && b.makeInvoice) {
    if (!l.customerId || !l.renewalItemId) throw badRequest('Set the client and the renewal item on the licence to invoice the upgrade, or turn off “make invoice”.');
    const gst = !!(await one(db, 'SELECT gstin FROM organizations WHERE shop_id = $1', [c.shopId]))?.gstin;
    const inv = await createInvoice(db, req, c.shopId, {
      customerId: l.customerId, date: todayISO(), dueDate: todayISO(), branchId: l.branchId, withGst: gst, reverseCharge: false, tcsRate: 0,
      lines: [{ itemId: l.renewalItemId, qty: 1, rate: p.amount, discount: 0, tier: 'SP1',
        note: `Licence ${l.licenseNumber}: ${l.maxCapacity} → ${b.newCapacity} ${l.capacityUnit} from ${effective}, ${p.days} of ${p.totalDays} days of the term`.slice(0, 300) }],
      notes: `Prorated upgrade: (₹${newPrice.toFixed(2)} − ₹${l.renewalPrice.toFixed(2)}) × ${p.days}/${p.totalDays} days.`,
    }, { issue: false });
    invoice = { id: inv.id, number: inv.number };
  }
  await db.query(`UPDATE warehouse_licenses SET max_capacity = $3, renewal_price = $4, credit_balance = credit_balance + $5, updated_at = now() WHERE shop_id = $1 AND id = $2`,
    [c.shopId, r.id, b.newCapacity, newPrice, up ? 0 : p.amount]);
  await audit(db, req, c.shopId, up ? 'upgrade' : 'downgrade', 'warehouse_license', r.id,
    { from: { capacity: l.maxCapacity, price: l.renewalPrice }, to: { capacity: b.newCapacity, price: newPrice }, effective, days: p.days, totalDays: p.totalDays, amount: p.amount, invoiceId: invoice?.id, reason: b.reason });
  req.audited = true;
  return { license: await refresh(db, c.shopId, r.id), proration: { ...p, direction: up ? 'charge' : 'credit', newPrice }, invoice };
}));

licensesRouter.delete('/licenses/:id', perm('licenses.write'), T(async (db, req, c) => {
  const r = await load(db, c.shopId, req.params.id!, true);
  // Only a licence added by mistake can go: once invoices, overrides or reminders refer to it, it is history.
  const used = await one(db, `SELECT (SELECT count(*) FROM invoice_licenses WHERE license_id = $1)::int AS invoices,
                                     (SELECT count(*) FROM license_overrides WHERE license_id = $1)::int AS overrides,
                                     (SELECT count(*) FROM license_alerts WHERE license_id = $1)::int AS alerts`, [r.id]);
  if (used.invoices || used.overrides || used.alerts) throw conflict('This licence has history (invoices, grace periods or reminders), so it stays on record. Suspend it instead.');
  await db.query('DELETE FROM warehouse_licenses WHERE shop_id = $1 AND id = $2', [c.shopId, r.id]);
  await audit(db, req, c.shopId, 'delete', 'warehouse_license', r.id, { number: r.license_number });
  req.audited = true;
  return { ok: true };
}));
