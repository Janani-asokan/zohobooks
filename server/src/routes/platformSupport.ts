/**
 * Customer care console (platform staff = super admins): every shop's call-back requests, a summary of the shop's
 * account to check before calling, the outcome of each call, and the support hours / slot rules.
 * Mounted under /api/platform/support, behind requireSuper.
 */
import { Router, type Request } from 'express';
import { z } from 'zod';
import { audit } from '../audit';
import { many, one, query, tx, withTenant, type Db } from '../db';
import { HttpError, badRequest, h, notFound, parse } from '../http';
import { bookedPerSlot, serializeCallback, supportSettings } from './shop/support';
import { isSlot, supportSlots } from '../../../shared/support';

export const platformSupportRouter = Router();

/** A transaction where the platform policy on support_callbacks applies (every shop's rows). */
const platformTx = <T>(fn: (db: Db) => Promise<T>) => tx(async (db) => { await db.query("SELECT set_config('app.platform', 'on', true)"); return fn(db); });
const staffId = (req: Request) => (req.ctx?.kind === 'super' ? req.ctx.id : null);

const LIST_SQL = `SELECT cb.*, sa.name AS assigned_name, s.name AS shop_name, s.owner_name, s.email AS shop_email, s.phone AS shop_phone,
                         s.city, s.plan_id, s.license_end, s.active AS shop_active
                    FROM support_callbacks cb JOIN shops s ON s.id = cb.shop_id LEFT JOIN super_admins sa ON sa.id = cb.assigned_to`;
const withShop = (r: any) => ({
  ...serializeCallback(r), shopId: r.shop_id,
  shop: { name: r.shop_name, ownerName: r.owner_name, email: r.shop_email, phone: r.shop_phone, city: r.city, planId: r.plan_id, licenseEnd: r.license_end, active: r.shop_active },
});

platformSupportRouter.get('/callbacks', h(async (req, res) => {
  const view = String(req.query.view ?? 'upcoming');
  const where = view === 'today' ? "cb.slot_start::date = (now() AT TIME ZONE 'Asia/Kolkata')::date"
    : view === 'upcoming' ? "cb.status = 'scheduled'"
    : view === 'done' ? "cb.status IN ('completed', 'missed', 'cancelled')"
    : 'true';
  const order = view === 'done' || view === 'all' ? 'cb.slot_start DESC' : 'cb.slot_start ASC';
  const rows = await platformTx((db) => many(db, `${LIST_SQL} WHERE ${where} ORDER BY ${order} LIMIT 300`));
  const counts = await platformTx((db) => one(db, `SELECT count(*) FILTER (WHERE status = 'scheduled')::int AS upcoming,
      count(*) FILTER (WHERE status = 'scheduled' AND slot_start < now())::int AS overdue,
      count(*) FILTER (WHERE slot_start::date = (now() AT TIME ZONE 'Asia/Kolkata')::date)::int AS today FROM support_callbacks`));
  res.json({ callbacks: rows.map(withShop), counts });
}));

/** What staff check before calling: the shop's account, plan, usage and earlier call-backs. */
platformSupportRouter.get('/shops/:shopId', h(async (req, res) => {
  const shopId = req.params.shopId!;
  const [s] = await query('SELECT s.*, p.name AS plan_name FROM shops s JOIN plans p ON p.id = s.plan_id WHERE s.id = $1', [shopId]);
  if (!s) throw notFound('Shop');
  const users = await query("SELECT name, email, role, active, last_login_at FROM users WHERE shop_id = $1 ORDER BY role = 'Owner' DESC, last_login_at DESC NULLS LAST", [shopId]);
  const features = await query("SELECT feature_key, level, source, ends_on FROM shop_features WHERE shop_id = $1 AND status = 'active' ORDER BY feature_key", [shopId]);
  const usage = await withTenant(shopId, (db) => one(db, `SELECT
      (SELECT count(*)::int FROM invoices WHERE status = 'Issued') AS invoices,
      (SELECT count(*)::int FROM invoices WHERE status = 'Issued' AND date >= date_trunc('month', current_date)) AS invoices_month,
      (SELECT coalesce(sum(total), 0)::float FROM invoices WHERE status = 'Issued' AND date >= date_trunc('month', current_date)) AS sales_month,
      (SELECT max(date) FROM invoices WHERE status = 'Issued') AS last_invoice,
      (SELECT count(*)::int FROM items WHERE NOT archived) AS items,
      (SELECT count(*)::int FROM customers) AS customers`));
  const history = await platformTx((db) => many(db, `${LIST_SQL} WHERE cb.shop_id = $1 ORDER BY cb.slot_start DESC LIMIT 10`, [shopId]));
  res.json({
    shop: { id: s.id, name: s.name, ownerName: s.owner_name, email: s.email, phone: s.phone, city: s.city, plan: s.plan_name, planId: s.plan_id,
      licenseStart: s.license_start, licenseEnd: s.license_end, active: s.active, createdAt: s.created_at },
    users: users.map((u) => ({ name: u.name, email: u.email, role: u.role, active: u.active, lastLoginAt: u.last_login_at })),
    features: features.map((f) => ({ key: f.feature_key, level: f.level, source: f.source, endsOn: f.ends_on })),
    usage: { invoices: usage.invoices, invoicesThisMonth: usage.invoices_month, salesThisMonth: usage.sales_month, lastInvoice: usage.last_invoice, items: usage.items, customers: usage.customers },
    history: history.map(withShop),
  });
}));

/** Take a call, record the outcome, add notes, or move it to another slot. */
platformSupportRouter.patch('/callbacks/:id', h(async (req, res) => {
  const b = parse(z.object({
    status: z.enum(['scheduled', 'completed', 'missed', 'cancelled']).optional(),
    staffNotes: z.string().max(4000).optional(),
    assignToMe: z.boolean().optional(),
    slotStart: z.string().datetime({ offset: true }).optional(),
  }), req.body);
  const row = await platformTx(async (db) => {
    const cur = await one(db, 'SELECT * FROM support_callbacks WHERE id = $1 FOR UPDATE', [req.params.id]);
    if (!cur) throw notFound('Call-back');
    let slot: Date | null = null;
    if (b.slotStart) {
      slot = new Date(b.slotStart);
      const s = await supportSettings(db);
      if (!isSlot(s, slot)) throw badRequest('That time is not one of the call-back slots.');
      await db.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`support-slot:${slot.toISOString()}`]);
      const taken = (await bookedPerSlot(db)).get(slot.toISOString()) ?? 0;
      await db.query("SELECT set_config('app.platform', 'on', true)"); // bookedPerSlot switched it off again
      if (taken >= s.capacity && new Date(cur.slot_start).getTime() !== slot.getTime()) throw new HttpError(409, 'That slot is full.', 'slot_full');
    }
    const status = slot ? 'scheduled' : b.status;
    const r = await one(db, `UPDATE support_callbacks SET
        status = coalesce($2, status), staff_notes = coalesce($3, staff_notes), slot_start = coalesce($4, slot_start),
        assigned_to = CASE WHEN $5::boolean THEN $6::uuid ELSE assigned_to END,
        completed_at = CASE WHEN coalesce($2, status) IN ('completed', 'missed') THEN coalesce(completed_at, now()) ELSE NULL END,
        updated_at = now()
      WHERE id = $1 RETURNING *`, [cur.id, status ?? null, b.staffNotes ?? null, slot, !!b.assignToMe || (!!b.status && b.status !== 'scheduled' && !cur.assigned_to), staffId(req)]);
    await audit(db, req, cur.shop_id, 'update', 'support_callback', cur.id, { status: status ?? cur.status, ...(slot ? { slot: slot.toISOString() } : {}) });
    return one(db, `${LIST_SQL} WHERE cb.id = $1`, [r.id]);
  });
  res.json(withShop(row));
}));

/** Open slots for rescheduling (same rules shops see). */
platformSupportRouter.get('/slots', h(async (_req, res) => {
  res.json(await tx(async (db) => { const s = await supportSettings(db); return { settings: s, days: supportSlots(s, await bookedPerSlot(db)) }; }));
}));

platformSupportRouter.get('/settings', h(async (_req, res) => { res.json(await tx((db) => supportSettings(db))); }));
platformSupportRouter.put('/settings', h(async (req, res) => {
  const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM, e.g. 10:00');
  const b = parse(z.object({
    days: z.array(z.number().int().min(1).max(7)).min(1, 'Pick at least one day').max(7),
    start: hhmm, end: hhmm,
    slotMinutes: z.union([z.literal(15), z.literal(20), z.literal(30), z.literal(45), z.literal(60)]),
    capacity: z.number().int().min(1).max(50),
    bookingDays: z.number().int().min(1).max(60),
  }), req.body);
  if (b.start >= b.end) throw badRequest('Support must end after it starts');
  await tx(async (db) => {
    await db.query(`UPDATE platform_config SET support_days = $1, support_start = $2, support_end = $3, support_slot_minutes = $4,
                    support_slot_capacity = $5, support_booking_days = $6, updated_at = now() WHERE id = 1`,
    [[...new Set(b.days)].sort(), b.start, b.end, b.slotMinutes, b.capacity, b.bookingDays]);
    await audit(db, req, null, 'update', 'support_settings', undefined, b);
  });
  res.json(await tx((db) => supportSettings(db)));
}));
