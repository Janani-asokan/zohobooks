import { Router } from 'express';
import { z } from 'zod';
import { rateLimit, todayISO, userCtx, type UserCtx } from '../../auth';
import { audit } from '../../audit';
import { many, one, withTenant, type Db } from '../../db';
import { badRequest, conflict, forbidden, h, HttpError, notFound, parse } from '../../http';
import { getOrg } from '../../services/common';
import { aiError, fieldSummary } from '../../services/assistant';
import { T, allowed } from './ctx';

/* Field staff (salesman) tracking. Staff start and end their own day; location is recorded only in between.
   Managers with field.view see every person's visits and route. */
export const fieldRouter = Router();

const geo = { lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180), accuracy: z.number().min(0).max(100000).optional() };
const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** Great-circle distance in km. */
export const km = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => {
  const R = 6371; const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad; const dLng = (b.lng - a.lng) * rad;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
};

const visitOut = (v: any) => ({
  id: v.id, userId: v.user_id, userName: v.user_name, customerId: v.customer_id, customerName: v.customer_name, purpose: v.purpose,
  lat: v.lat, lng: v.lng, accuracy: v.accuracy, checkedInAt: v.checked_in_at, checkedOutAt: v.checked_out_at, outcome: v.outcome,
  orderValue: Number(v.order_value), collected: Number(v.collected), notes: v.notes, nextVisit: v.next_visit,
  minutes: v.checked_out_at ? Math.round((new Date(v.checked_out_at).getTime() - new Date(v.checked_in_at).getTime()) / 60000) : null,
});
const dayOut = (d: any) => d && ({ id: d.id, userId: d.user_id, userName: d.user_name, date: d.date, startedAt: d.started_at, endedAt: d.ended_at, start: d.start_lat !== null ? { lat: d.start_lat, lng: d.start_lng } : null, end: d.end_lat !== null ? { lat: d.end_lat, lng: d.end_lng } : null });

const today = (db: Db, c: UserCtx) => one(db, 'SELECT * FROM field_days WHERE shop_id = $1 AND user_id = $2 AND date = $3', [c.shopId, c.id, todayISO()]);

fieldRouter.get('/field/me', T(async (db, _req, c) => {
  const d = await today(db, c);
  const visits = await many(db, 'SELECT * FROM field_visits WHERE shop_id = $1 AND user_id = $2 AND checked_in_at::date = $3 ORDER BY checked_in_at', [c.shopId, c.id, todayISO()]);
  return { day: dayOut(d), visits: visits.map(visitOut), open: visits.map(visitOut).find((v) => !v.checkedOutAt) ?? null };
}));

fieldRouter.post('/field/day/start', T(async (db, req, c) => {
  const b = parse(z.object(geo), req.body);
  const d = await one(db, `INSERT INTO field_days (shop_id, user_id, user_name, date, start_lat, start_lng) VALUES ($1,$2,$3,$4,$5,$6)
    ON CONFLICT (shop_id, user_id, date) DO UPDATE SET ended_at = NULL RETURNING *`, [c.shopId, c.id, c.name, todayISO(), b.lat, b.lng]);
  await db.query('INSERT INTO field_pings (shop_id, day_id, lat, lng, accuracy) VALUES ($1,$2,$3,$4,$5)', [c.shopId, d.id, b.lat, b.lng, b.accuracy ?? null]);
  await audit(db, req, c.shopId, 'start_day', 'field_day', d.id, {});
  return dayOut(d);
}));

fieldRouter.post('/field/day/end', T(async (db, req, c) => {
  const b = parse(z.object({ lat: geo.lat.optional(), lng: geo.lng.optional() }), req.body);
  const d = await today(db, c);
  if (!d || d.ended_at) throw conflict('Your day isn’t started');
  await db.query("UPDATE field_visits SET checked_out_at = now() WHERE shop_id = $1 AND day_id = $2 AND checked_out_at IS NULL", [c.shopId, d.id]);
  const r = await one(db, 'UPDATE field_days SET ended_at = now(), end_lat = $3, end_lng = $4 WHERE shop_id = $1 AND id = $2 RETURNING *', [c.shopId, d.id, b.lat ?? null, b.lng ?? null]);
  await audit(db, req, c.shopId, 'end_day', 'field_day', d.id, {});
  return dayOut(r);
}));

/** Location while on duty. At most one point every 45 seconds is kept. */
fieldRouter.post('/field/ping', rateLimit('field-ping', 30, 60_000), T(async (db, req, c) => {
  const b = parse(z.object(geo), req.body);
  const d = await today(db, c);
  if (!d || d.ended_at) return { kept: false, onDuty: false };
  const last = await one(db, 'SELECT at FROM field_pings WHERE day_id = $1 ORDER BY at DESC LIMIT 1', [d.id]);
  if (last && Date.now() - new Date(last.at).getTime() < 45_000) return { kept: false, onDuty: true };
  if (b.accuracy !== undefined && b.accuracy > 500) return { kept: false, onDuty: true }; // too vague to draw a route with
  await db.query('INSERT INTO field_pings (shop_id, day_id, lat, lng, accuracy) VALUES ($1,$2,$3,$4,$5)', [c.shopId, d.id, b.lat, b.lng, b.accuracy ?? null]);
  return { kept: true, onDuty: true };
}));

fieldRouter.post('/field/visits', T(async (db, req, c) => {
  const b = parse(z.object({ ...geo, customerId: z.string().uuid().nullable().optional(), customerName: z.string().trim().max(150).optional(), purpose: z.enum(['Sales visit', 'Order', 'Payment collection', 'Delivery', 'Service', 'Other']).default('Sales visit') }), req.body);
  let d = await today(db, c);
  if (!d || d.ended_at) d = await one(db, `INSERT INTO field_days (shop_id, user_id, user_name, date, start_lat, start_lng) VALUES ($1,$2,$3,$4,$5,$6)
    ON CONFLICT (shop_id, user_id, date) DO UPDATE SET ended_at = NULL RETURNING *`, [c.shopId, c.id, c.name, todayISO(), b.lat, b.lng]);
  const cust = b.customerId ? await one(db, "SELECT id, coalesce(nullif(company_name, ''), name) AS name FROM customers WHERE shop_id = $1 AND id = $2", [c.shopId, b.customerId]) : null;
  if (b.customerId && !cust) throw notFound('Customer');
  const name = cust?.name ?? b.customerName?.trim();
  if (!name) throw badRequest('Pick a customer or type the shop name', { customerId: 'Who are you visiting?' });
  // One visit at a time: checking in somewhere closes the previous visit.
  await db.query('UPDATE field_visits SET checked_out_at = now() WHERE shop_id = $1 AND user_id = $2 AND checked_out_at IS NULL', [c.shopId, c.id]);
  const v = await one(db, `INSERT INTO field_visits (shop_id, day_id, user_id, user_name, customer_id, customer_name, purpose, lat, lng, accuracy)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`, [c.shopId, d.id, c.id, c.name, cust?.id ?? null, name, b.purpose, b.lat, b.lng, b.accuracy ?? null]);
  await db.query('INSERT INTO field_pings (shop_id, day_id, lat, lng, accuracy) VALUES ($1,$2,$3,$4,$5)', [c.shopId, d.id, b.lat, b.lng, b.accuracy ?? null]);
  await audit(db, req, c.shopId, 'check_in', 'field_visit', v.id, { customer: name });
  return visitOut(v);
}));

fieldRouter.post('/field/visits/:id/checkout', T(async (db, req, c) => {
  const b = parse(z.object({
    outcome: z.enum(['Order taken', 'Payment collected', 'Follow up', 'Not interested', 'Shop closed', 'Delivered', 'Other']),
    orderValue: z.number().min(0).max(1e9).default(0), collected: z.number().min(0).max(1e9).default(0), notes: z.string().max(1000).default(''),
    nextVisit: z.string().regex(ISO).nullable().optional(),
  }), req.body);
  if (!/^[0-9a-f-]{36}$/i.test(req.params.id!)) throw notFound('Visit');
  const v = await one(db, 'SELECT * FROM field_visits WHERE shop_id = $1 AND id = $2', [c.shopId, req.params.id]);
  if (!v) throw notFound('Visit');
  if (v.user_id !== c.id && !allowed(c, 'field.view')) throw forbidden('This is someone else’s visit');
  const r = await one(db, `UPDATE field_visits SET checked_out_at = coalesce(checked_out_at, now()), outcome = $3, order_value = $4, collected = $5, notes = $6, next_visit = $7
    WHERE shop_id = $1 AND id = $2 RETURNING *`, [c.shopId, v.id, b.outcome, b.orderValue, b.collected, b.notes, b.nextVisit ?? null]);
  await audit(db, req, c.shopId, 'check_out', 'field_visit', v.id, { outcome: b.outcome, orderValue: b.orderValue, collected: b.collected });
  return visitOut(r);
}));

/** Everyone's day on one date: route, visits, distance and results. */
export async function teamDay(db: Db, shopId: string, date: string) {
  const days = await many(db, 'SELECT * FROM field_days WHERE shop_id = $1 AND date = $2 ORDER BY user_name', [shopId, date]);
  const visits = await many(db, 'SELECT * FROM field_visits WHERE shop_id = $1 AND checked_in_at::date = $2 ORDER BY checked_in_at', [shopId, date]);
  const pings = days.length ? await many(db, 'SELECT day_id, lat, lng, at FROM field_pings WHERE shop_id = $1 AND day_id = ANY($2::uuid[]) ORDER BY at', [shopId, days.map((d) => d.id)]) : [];
  return days.map((d) => {
    const route = pings.filter((p) => p.day_id === d.id).map((p) => ({ lat: p.lat, lng: p.lng, at: p.at }));
    let distance = 0;
    for (let i = 1; i < route.length; i++) { const step = km(route[i - 1]!, route[i]!); if (step < 50) distance += step; } // drop GPS jumps
    const vs = visits.filter((v) => v.user_id === d.user_id).map(visitOut);
    const end = d.ended_at ? new Date(d.ended_at) : new Date();
    const last = route.at(-1);
    return {
      ...dayOut(d), route, visits: vs, distanceKm: Math.round(distance * 10) / 10,
      onDutyMinutes: Math.max(0, Math.round((end.getTime() - new Date(d.started_at).getTime()) / 60000)),
      lastSeen: last ? { lat: last.lat, lng: last.lng, at: last.at } : null, onDuty: !d.ended_at,
      totals: { visits: vs.length, orders: vs.filter((v) => v.outcome === 'Order taken').length, orderValue: vs.reduce((s, v) => s + v.orderValue, 0), collected: vs.reduce((s, v) => s + v.collected, 0) },
    };
  });
}

fieldRouter.get('/field/team', T(async (db, req, c) => {
  if (!allowed(c, 'field.view')) throw forbidden('Your role can’t see field staff');
  const date = ISO.test(String(req.query.date)) ? String(req.query.date) : todayISO();
  return { date, people: await teamDay(db, c.shopId, date) };
}));

fieldRouter.get('/field/visits', T(async (db, req, c) => {
  const from = ISO.test(String(req.query.from)) ? String(req.query.from) : todayISO();
  const to = ISO.test(String(req.query.to)) ? String(req.query.to) : todayISO();
  const all = allowed(c, 'field.view');
  const rows = await many(db, `SELECT * FROM field_visits WHERE shop_id = $1 AND checked_in_at::date BETWEEN $2 AND $3 ${all ? '' : 'AND user_id = $4'} ORDER BY checked_in_at DESC LIMIT 2000`,
    all ? [c.shopId, from, to] : [c.shopId, from, to, c.id]);
  return rows.map(visitOut);
}));

fieldRouter.post('/ai/field-summary', rateLimit('ai-field', 10, 60_000), h(async (req, res) => {
  const c = userCtx(req);
  if (!allowed(c, 'field.view')) throw forbidden();
  const b = parse(z.object({ date: z.string().regex(ISO).optional() }), req.body ?? {});
  const date = b.date ?? todayISO();
  const { people, org } = await withTenant(c.shopId, async (db) => ({ people: await teamDay(db, c.shopId, date), org: await getOrg(db, c.shopId) }));
  if (!people.length) throw new HttpError(404, 'Nobody started their day on this date.', 'no_data');
  // Clock times are formatted here, in IST, so the model never converts timezones itself.
  const clock = (t: string | Date | null) => (t ? new Date(t).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: 'numeric', minute: '2-digit' }) : null);
  res.json(await fieldSummary(date, people.map((p) => ({
    name: p.userName, onDuty: p.onDuty, started: clock(p.startedAt), ended: clock(p.endedAt), distanceKm: p.distanceKm, onDutyMinutes: p.onDutyMinutes,
    visits: p.visits.map((v: ReturnType<typeof visitOut>) => ({ customer: v.customerName, purpose: v.purpose, checkIn: clock(v.checkedInAt), checkOut: clock(v.checkedOutAt), minutes: v.minutes, outcome: v.outcome, orderValue: v.orderValue, collected: v.collected, notes: v.notes, nextVisit: v.nextVisit })),
  })), org.company_name).catch(aiError));
}));
