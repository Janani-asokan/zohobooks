/**
 * Customer support call-backs, shop side. The owner (or anyone with the admin permission) books a call-back in a slot
 * the system offers, sees their requests, and can cancel an upcoming one. Platform staff handle them in the Customer
 * care console (routes/platformSupport.ts).
 */
import { Router } from 'express';
import { z } from 'zod';
import { perm } from '../../auth';
import { audit } from '../../audit';
import { many, one, type Db } from '../../db';
import { HttpError, badRequest, notFound, parse } from '../../http';
import { SUPPORT_TOPICS, isSlot, supportSlots, MIN_NOTICE_MIN, type SupportSettings } from '../../../../shared/support';
import { T } from './ctx';

export const supportRouter = Router();

/** Support hours and slot rules, from the platform settings. */
export async function supportSettings(db: Db): Promise<SupportSettings> {
  const c = await one(db, 'SELECT support_days, support_start, support_end, support_slot_minutes, support_slot_capacity, support_booking_days FROM platform_config WHERE id = 1');
  return { days: c.support_days, start: c.support_start, end: c.support_end, slotMinutes: c.support_slot_minutes, capacity: c.support_slot_capacity, bookingDays: c.support_booking_days };
}

/**
 * Scheduled call-backs per slot across ALL shops (a slot's places are shared). Row-level security shows a shop only
 * its own rows, so this one read switches on the platform policy and switches it off again straight after. The flag
 * is set by this server code only, never from a request, and only counts leave this function.
 */
export async function bookedPerSlot(db: Db): Promise<Map<string, number>> {
  await db.query("SELECT set_config('app.platform', 'on', true)");
  try {
    const rows = await many(db, "SELECT slot_start, count(*)::int AS n FROM support_callbacks WHERE status = 'scheduled' AND slot_start > now() GROUP BY slot_start");
    return new Map(rows.map((r) => [new Date(r.slot_start).toISOString(), r.n]));
  } finally {
    await db.query("SELECT set_config('app.platform', 'off', true)");
  }
}

export const serializeCallback = (r: any) => ({
  id: r.id, contactName: r.contact_name, phone: r.phone, topic: r.topic, message: r.message, slotStart: new Date(r.slot_start).toISOString(),
  status: r.status, staffNotes: r.staff_notes, completedAt: r.completed_at, createdAt: r.created_at,
  ...(r.assigned_name !== undefined ? { assignedTo: r.assigned_name ?? null } : {}),
});

supportRouter.get('/support/slots', perm('admin'), T(async (db) => {
  const s = await supportSettings(db);
  return { settings: s, days: supportSlots(s, await bookedPerSlot(db)) };
}));

supportRouter.get('/support/callbacks', perm('admin'), T(async (db, _req, c) =>
  (await many(db, `SELECT cb.*, sa.name AS assigned_name FROM support_callbacks cb LEFT JOIN super_admins sa ON sa.id = cb.assigned_to
                    WHERE cb.shop_id = $1 ORDER BY cb.slot_start DESC LIMIT 50`, [c.shopId])).map(serializeCallback)));

supportRouter.post('/support/callbacks', perm('admin'), T(async (db, req, c, res) => {
  const b = parse(z.object({
    slotStart: z.string().datetime({ offset: true }),
    topic: z.enum(SUPPORT_TOPICS.map((t) => t.key) as [string, ...string[]]),
    message: z.string().trim().max(1000).default(''),
    contactName: z.string().trim().min(2, 'Enter who we should ask for').max(120),
    phone: z.string().trim().refine((v) => v.replace(/\D/g, '').length >= 10, 'Enter a valid 10-digit phone number').pipe(z.string().max(30)),
  }), req.body);
  const slot = new Date(b.slotStart);
  const s = await supportSettings(db);
  if (!isSlot(s, slot)) throw badRequest('That time is not one of the call-back slots. Pick a slot from the list.');
  if (slot.getTime() < Date.now() + MIN_NOTICE_MIN * 60_000) throw badRequest('That slot is too soon. Pick one at least an hour from now.');
  if (slot.getTime() > Date.now() + (s.bookingDays + 1) * 86_400_000) throw badRequest(`Slots can be booked up to ${s.bookingDays} days ahead.`);
  // One booking at a time per slot: two shops can't both take its last place.
  await db.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`support-slot:${slot.toISOString()}`]);
  const open = await one(db, "SELECT slot_start FROM support_callbacks WHERE shop_id = $1 AND status = 'scheduled' AND slot_start > now()", [c.shopId]);
  if (open) throw new HttpError(409, 'You already have a call-back booked. Cancel it first to choose another time.', 'callback_exists');
  const taken = (await bookedPerSlot(db)).get(slot.toISOString()) ?? 0;
  if (taken >= s.capacity) throw new HttpError(409, 'That slot was just taken. Please pick another time.', 'slot_full');
  const r = await one(db, `INSERT INTO support_callbacks (shop_id, requested_by, contact_name, phone, topic, message, slot_start)
                           VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`, [c.shopId, c.id, b.contactName, b.phone, b.topic, b.message, slot]);
  await audit(db, req, c.shopId, 'create', 'support_callback', r.id, { slot: slot.toISOString(), topic: b.topic });
  res.status(201);
  return serializeCallback(r);
}));

supportRouter.post('/support/callbacks/:id/cancel', perm('admin'), T(async (db, req, c) => {
  const r = await one(db, `UPDATE support_callbacks SET status = 'cancelled', updated_at = now()
                           WHERE id = $1 AND shop_id = $2 AND status = 'scheduled' RETURNING *`, [req.params.id, c.shopId]);
  if (!r) throw notFound('Upcoming call-back');
  await audit(db, req, c.shopId, 'cancel', 'support_callback', r.id);
  return serializeCallback(r);
}));
