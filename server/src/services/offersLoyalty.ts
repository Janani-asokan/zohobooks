import type { Request } from 'express';
import { many, one, type Db } from '../db';
import { conflict } from '../http';
import { withLoyaltyDefaults, pointsEarned, type LoyaltySettings, type Offer } from '../../../shared/offers';
import { hasFeature } from '../../../shared/features';
import { loadEntitlements } from './features';

export const FEATURE = 'offers_loyalty';

export async function shopHasOffers(db: Db, shopId: string) {
  return hasFeature(await loadEntitlements(shopId, db), FEATURE);
}

export const serializeOffer = (r: any): Offer & { archived: boolean; createdAt: string } => ({
  id: r.id, name: r.name, kind: r.kind, discountKind: r.discount_kind, value: Number(r.value), scope: r.scope,
  categories: r.categories ?? [], itemIds: r.item_ids ?? [], minBill: Number(r.min_bill), startsOn: r.starts_on, endsOn: r.ends_on,
  message: r.message, active: r.active, archived: r.archived, createdAt: r.created_at,
});

/** Offers that could apply on a date: not archived, not paused, and running that day. */
export async function offersOn(db: Db, shopId: string, date: string): Promise<Offer[]> {
  const rows = await many(db, 'SELECT * FROM offers WHERE shop_id = $1 AND NOT archived AND active AND starts_on <= $2 AND ends_on >= $2 ORDER BY created_at', [shopId, date]);
  return rows.map(serializeOffer);
}

export async function loyaltySettings(db: Db, shopId: string): Promise<LoyaltySettings> {
  const o = await one(db, 'SELECT loyalty FROM organizations WHERE shop_id = $1', [shopId]);
  return withLoyaltyDefaults(o?.loyalty);
}

/** A customer's points. Pass an invoice id to leave out what that invoice did (when it is being edited). */
export async function pointsBalance(db: Db, shopId: string, customerId: string, exceptInvoiceId?: string): Promise<number> {
  const r = await one(db,
    `SELECT coalesce(sum(points), 0) AS n FROM loyalty_ledger WHERE shop_id = $1 AND customer_id = $2 AND ($3::uuid IS NULL OR invoice_id IS DISTINCT FROM $3::uuid)`,
    [shopId, customerId, exceptInvoiceId ?? null]);
  return Number(r.n);
}

const by = (req: Request | null) => (req?.ctx?.kind === 'user' ? req.ctx.id : null);

/** Undo everything an invoice did to points (edit or cancel): one row per customer that takes its net back out. */
export async function reverseInvoicePoints(db: Db, req: Request | null, shopId: string, invoiceId: string, note: string) {
  const rows = await many(db, 'SELECT customer_id, sum(points) AS n FROM loyalty_ledger WHERE shop_id = $1 AND invoice_id = $2 GROUP BY customer_id', [shopId, invoiceId]);
  for (const r of rows) {
    const n = Number(r.n);
    if (n !== 0) await db.query("INSERT INTO loyalty_ledger (shop_id, customer_id, invoice_id, points, kind, note, created_by) VALUES ($1,$2,$3,$4,'reverse',$5,$6)", [shopId, r.customer_id, invoiceId, -n, note, by(req)]);
  }
}

/**
 * When an invoice is issued (or an issued one is saved again): take the points it uses and add the points it earns.
 * The customer row is locked so two counters cannot spend the same points at once.
 */
export async function settleInvoicePoints(db: Db, req: Request | null, shopId: string, invoiceId: string) {
  const inv = await one(db, 'SELECT id, number, customer_id, total, loyalty_points_used FROM invoices WHERE shop_id = $1 AND id = $2', [shopId, invoiceId]);
  if (!inv?.customer_id) return;
  const used = Number(inv.loyalty_points_used);
  const s = await loyaltySettings(db, shopId);
  const on = await shopHasOffers(db, shopId);
  if (!on && used === 0) return;
  await db.query('SELECT id FROM customers WHERE shop_id = $1 AND id = $2 FOR NO KEY UPDATE', [shopId, inv.customer_id]);
  if (used > 0) {
    const balance = await pointsBalance(db, shopId, inv.customer_id, invoiceId);
    if (balance + 1e-9 < used) throw conflict(`The customer has ${balance} points now, fewer than the ${used} used on this bill. Change the points used and save again.`);
    await db.query("INSERT INTO loyalty_ledger (shop_id, customer_id, invoice_id, points, kind, note, created_by) VALUES ($1,$2,$3,$4,'redeem',$5,$6)",
      [shopId, inv.customer_id, invoiceId, -used, `Used on ${inv.number}`, by(req)]);
  }
  const earned = on ? pointsEarned(s, Number(inv.total)) : 0;
  if (earned > 0) {
    await db.query("INSERT INTO loyalty_ledger (shop_id, customer_id, invoice_id, points, kind, note, created_by) VALUES ($1,$2,$3,$4,'earn',$5,$6)",
      [shopId, inv.customer_id, invoiceId, earned, `Earned on ${inv.number}`, by(req)]);
  }
  const after = await pointsBalance(db, shopId, inv.customer_id);
  await db.query('UPDATE invoices SET loyalty_points_earned = $3, loyalty_balance_after = $4 WHERE shop_id = $1 AND id = $2', [shopId, invoiceId, earned, after]);
}

/** A return (credit note) takes back the points earned on the part returned. Points used are not given back. */
export async function reversePointsForReturn(db: Db, req: Request | null, shopId: string, invoiceId: string, creditNoteId: string, creditTotal: number, number: string) {
  const inv = await one(db, 'SELECT customer_id, total, loyalty_points_earned FROM invoices WHERE shop_id = $1 AND id = $2', [shopId, invoiceId]);
  const earned = Number(inv?.loyalty_points_earned ?? 0);
  if (!inv?.customer_id || earned <= 0 || Number(inv.total) <= 0) return;
  const back = Math.min(earned, Math.ceil((earned * creditTotal) / Number(inv.total)));
  if (back > 0) await db.query("INSERT INTO loyalty_ledger (shop_id, customer_id, invoice_id, credit_note_id, points, kind, note, created_by) VALUES ($1,$2,$3,$4,$5,'reverse',$6,$7)",
    [shopId, inv.customer_id, invoiceId, creditNoteId, -back, `Return ${number}`, by(req)]);
}
