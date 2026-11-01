import { Router } from 'express';
import { z } from 'zod';
import { perm, todayISO } from '../../auth';
import { audit } from '../../audit';
import { many, one } from '../../db';
import { badRequest, notFound, parse } from '../../http';
import { loyaltySettings, offersOn, pointsBalance, serializeOffer } from '../../services/offersLoyalty';
import { LOYALTY_DEFAULTS } from '../../../../shared/offers';
import { T } from './ctx';

/* Festival offers and loyalty points (shared/offers.ts). Covered by the offers_loyalty add-on (featureGate). */
export const offersRouter = Router();

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const offerBody = z.object({
  name: z.string().trim().min(1, 'Give the offer a name').max(80),
  kind: z.enum(['item', 'bill']),
  discountKind: z.enum(['percent', 'amount']).default('percent'),
  value: z.number().positive('Enter the discount'),
  scope: z.enum(['all', 'category', 'items']).default('all'),
  categories: z.array(z.string().trim().min(1).max(60)).max(50).default([]),
  itemIds: z.array(z.string().uuid()).max(500).default([]),
  minBill: z.number().min(0).max(1e9).default(0),
  startsOn: z.string().regex(ISO, 'Pick the start date'),
  endsOn: z.string().regex(ISO, 'Pick the end date'),
  message: z.string().trim().max(140).default(''),
  active: z.boolean().default(true),
});

function check(b: z.infer<typeof offerBody>) {
  if (b.endsOn < b.startsOn) throw badRequest('The offer ends before it starts', { endsOn: 'Must be on or after the start date' });
  if (b.kind === 'item' && b.discountKind !== 'percent') throw badRequest('Item offers are a percentage off', { discountKind: 'Use a percentage' });
  if (b.discountKind === 'percent' && b.value > 100) throw badRequest('A percentage can be at most 100', { value: 'At most 100%' });
  if (b.kind === 'item' && b.scope === 'category' && !b.categories.length) throw badRequest('Pick at least one category', { categories: 'Pick at least one category' });
  if (b.kind === 'item' && b.scope === 'items' && !b.itemIds.length) throw badRequest('Pick at least one item', { itemIds: 'Pick at least one item' });
  // Bill offers apply to the whole bill.
  return b.kind === 'bill' ? { ...b, scope: 'all' as const, categories: [], itemIds: [] } : { ...b, minBill: 0 };
}

const loadOffer = async (db: any, shopId: string, id: string) => {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound('Offer');
  const r = await one(db, 'SELECT * FROM offers WHERE shop_id = $1 AND id = $2 FOR UPDATE', [shopId, id]);
  if (!r) throw notFound('Offer');
  return r;
};

offersRouter.get('/offers', T(async (db, _req, c) => (await many(db, 'SELECT * FROM offers WHERE shop_id = $1 AND NOT archived ORDER BY starts_on DESC, created_at DESC', [c.shopId])).map(serializeOffer)));

/** Offers running on a date (default today), for the counter and the invoice form to show before saving. */
offersRouter.get('/offers/running', T(async (db, req, c) => {
  const d = typeof req.query.date === 'string' && ISO.test(req.query.date) ? req.query.date : todayISO();
  return offersOn(db, c.shopId, d);
}));

offersRouter.post('/offers', perm('items.write'), T(async (db, req, c) => {
  const b = check(parse(offerBody, req.body));
  const r = await one(db,
    `INSERT INTO offers (shop_id, name, kind, discount_kind, value, scope, categories, item_ids, min_bill, starts_on, ends_on, message, active, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
    [c.shopId, b.name, b.kind, b.discountKind, b.value, b.scope, b.categories, b.itemIds, b.minBill, b.startsOn, b.endsOn, b.message, b.active, c.id]);
  await audit(db, req, c.shopId, 'create', 'offer', r.id, { name: b.name });
  return serializeOffer(r);
}));

offersRouter.put('/offers/:id', perm('items.write'), T(async (db, req, c) => {
  await loadOffer(db, c.shopId, req.params.id!);
  const b = check(parse(offerBody, req.body));
  const r = await one(db,
    `UPDATE offers SET name=$3, kind=$4, discount_kind=$5, value=$6, scope=$7, categories=$8, item_ids=$9, min_bill=$10, starts_on=$11, ends_on=$12,
       message=$13, active=$14, updated_at=now() WHERE shop_id=$1 AND id=$2 RETURNING *`,
    [c.shopId, req.params.id, b.name, b.kind, b.discountKind, b.value, b.scope, b.categories, b.itemIds, b.minBill, b.startsOn, b.endsOn, b.message, b.active]);
  await audit(db, req, c.shopId, 'update', 'offer', r.id, { name: b.name });
  return serializeOffer(r);
}));

/** Archiving hides an offer from the list. It is never deleted: bills that used it keep its name. */
offersRouter.post('/offers/:id/archive', perm('items.write'), T(async (db, req, c) => {
  await loadOffer(db, c.shopId, req.params.id!);
  await db.query('UPDATE offers SET archived = true, active = false, updated_at = now() WHERE shop_id = $1 AND id = $2', [c.shopId, req.params.id]);
  await audit(db, req, c.shopId, 'archive', 'offer', req.params.id!);
  return { ok: true };
}));

/* ---------------- Loyalty ---------------- */

const loyaltyBody = z.object({
  enabled: z.boolean(),
  earnPer100: z.number().min(0).max(100),
  pointValue: z.number().positive('A point must be worth something').max(1000),
  minRedeem: z.number().int().min(0).max(1e6),
  maxRedeemPct: z.number().min(1).max(100),
});

offersRouter.get('/loyalty/settings', T(async (db, _req, c) => loyaltySettings(db, c.shopId)));

offersRouter.put('/loyalty/settings', perm('admin'), T(async (db, req, c) => {
  const b = parse(loyaltyBody, { ...LOYALTY_DEFAULTS, ...req.body });
  await db.query('UPDATE organizations SET loyalty = $2 WHERE shop_id = $1', [c.shopId, JSON.stringify(b)]);
  await audit(db, req, c.shopId, 'update', 'loyalty_settings', c.shopId, b);
  return b;
}));

/** Customers with points, most first. */
offersRouter.get('/loyalty/customers', T(async (db, _req, c) => {
  const rows = await many(db,
    `SELECT c.id, c.name, c.company_name, c.phone, sum(l.points) AS points, max(l.created_at) AS last_at
       FROM loyalty_ledger l JOIN customers c ON c.id = l.customer_id
      WHERE l.shop_id = $1 GROUP BY c.id HAVING sum(l.points) <> 0 ORDER BY sum(l.points) DESC LIMIT 500`, [c.shopId]);
  return rows.map((r) => ({ id: r.id, name: r.company_name || r.name, phone: r.phone, points: Number(r.points), lastAt: r.last_at }));
}));

offersRouter.get('/loyalty/customers/:id', T(async (db, req, c) => {
  if (!/^[0-9a-f-]{36}$/i.test(req.params.id!)) throw notFound('Customer');
  const cust = await one(db, 'SELECT id FROM customers WHERE shop_id = $1 AND id = $2', [c.shopId, req.params.id]);
  if (!cust) throw notFound('Customer');
  const history = await many(db,
    `SELECT l.id, l.points, l.kind, l.note, l.created_at, i.number AS invoice_number, l.invoice_id
       FROM loyalty_ledger l LEFT JOIN invoices i ON i.id = l.invoice_id WHERE l.shop_id = $1 AND l.customer_id = $2 ORDER BY l.created_at DESC LIMIT 200`,
    [c.shopId, req.params.id]);
  return {
    balance: await pointsBalance(db, c.shopId, req.params.id!),
    history: history.map((h) => ({ id: h.id, points: Number(h.points), kind: h.kind, note: h.note, at: h.created_at, invoiceId: h.invoice_id, invoiceNumber: h.invoice_number })),
  };
}));

/** The owner corrects a balance (a gift, a mistake). Recorded as its own row with a reason. */
offersRouter.post('/loyalty/customers/:id/adjust', perm('admin'), T(async (db, req, c) => {
  const b = parse(z.object({ points: z.number().int().refine((n) => n !== 0, 'Enter points to add or take away').refine((n) => Math.abs(n) <= 1e6, 'Too many points'), note: z.string().trim().min(1, 'Say why').max(200) }), req.body);
  if (!/^[0-9a-f-]{36}$/i.test(req.params.id!)) throw notFound('Customer');
  const cust = await one(db, 'SELECT id FROM customers WHERE shop_id = $1 AND id = $2 FOR NO KEY UPDATE', [c.shopId, req.params.id]);
  if (!cust) throw notFound('Customer');
  const balance = await pointsBalance(db, c.shopId, req.params.id!);
  if (balance + b.points < 0) throw badRequest(`The customer has ${balance} points; you can take away at most that`, { points: `At most −${balance}` });
  await db.query("INSERT INTO loyalty_ledger (shop_id, customer_id, points, kind, note, created_by) VALUES ($1,$2,$3,'adjust',$4,$5)", [c.shopId, req.params.id, b.points, b.note, c.id]);
  await audit(db, req, c.shopId, 'adjust', 'loyalty', req.params.id!, b);
  return { balance: balance + b.points };
}));
