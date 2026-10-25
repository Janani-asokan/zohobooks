import { Router } from 'express';
import { z } from 'zod';
import { perm, todayISO } from '../../auth';
import { audit } from '../../audit';
import { many, one, type Db } from '../../db';
import { badRequest, conflict, notFound, parse } from '../../http';
import { getOrg, nextSeq } from '../../services/common';
import { createInvoice, customerSnapshot } from '../../services/documents';
import { r2 } from '../../../../shared/calc';
import { T } from './ctx';

/* Delivery challans: goods sent to a customer, tracked from packing to delivery, then billed. */
export const challansRouter = Router();

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const STATUSES = ['Packed', 'Dispatched', 'Delivered', 'Invoiced', 'Cancelled'] as const;
const body = z.object({
  customerId: z.string().uuid('Select a customer'),
  date: z.string().regex(ISO),
  purpose: z.enum(['Supply', 'Job work', 'On approval', 'Sales return', 'Other']).default('Supply'),
  salesOrderId: z.string().uuid().nullable().optional(),
  lines: z.array(z.object({ itemId: z.string().uuid('Select an item'), qty: z.number().positive('Quantity must be more than 0'), rate: z.number().min(0).optional() })).min(1, 'Add at least one item'),
  transporter: z.string().trim().max(120).default(''),
  vehicleNo: z.string().trim().toUpperCase().max(20).default(''),
  lrNo: z.string().trim().max(40).default(''),
  notes: z.string().max(1000).default(''),
});

const serialize = (r: any) => ({
  id: r.id, number: r.number, customerId: r.customer_id, customer: r.customer, date: r.date, purpose: r.purpose, salesOrderId: r.sales_order_id,
  salesOrderNumber: r.so_number ?? null, invoiceId: r.invoice_id, invoiceNumber: r.inv_number ?? null, lines: r.lines, value: Number(r.value), status: r.status,
  transporter: r.transporter, vehicleNo: r.vehicle_no, lrNo: r.lr_no, receivedBy: r.received_by, notes: r.notes,
  dispatchedAt: r.dispatched_at, deliveredAt: r.delivered_at, createdAt: r.created_at,
});

const SELECT = `SELECT d.*, so.number AS so_number, i.number AS inv_number FROM delivery_challans d
  LEFT JOIN sales_orders so ON so.id = d.sales_order_id LEFT JOIN invoices i ON i.id = d.invoice_id WHERE d.shop_id = $1`;

async function load(db: Db, shopId: string, id: string, lock = false) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound('Delivery challan');
  const r = await one(db, `SELECT * FROM delivery_challans WHERE shop_id = $1 AND id = $2${lock ? ' FOR UPDATE' : ''}`, [shopId, id]);
  if (!r) throw notFound('Delivery challan');
  return r;
}
const get = async (db: Db, shopId: string, id: string) => serialize(await one(db, `${SELECT} AND d.id = $2`, [shopId, id]));

challansRouter.get('/delivery-challans', T(async (db, _req, c) => (await many(db, `${SELECT} ORDER BY d.date DESC, d.created_at DESC`, [c.shopId])).map(serialize)));

challansRouter.post(
  '/delivery-challans',
  perm('sales.write'),
  T(async (db, req, c) => {
    const b = parse(body, req.body);
    const org = await getOrg(db, c.shopId);
    const { snap, id: customerId } = await customerSnapshot(db, c.shopId, b.customerId, org.state);
    const items = await many(db, 'SELECT id, name, hsn, unit, sp1, type, is_group FROM items WHERE shop_id = $1 AND id = ANY($2::uuid[])', [c.shopId, b.lines.map((l) => l.itemId)]);
    const byId = new Map(items.map((i) => [i.id, i]));
    const lines = b.lines.map((l) => {
      const it = byId.get(l.itemId);
      if (!it) throw badRequest('One of the selected items no longer exists');
      if (it.is_group) throw badRequest(`${it.name} has variants. Pick a size or colour instead.`);
      return { itemId: it.id, name: it.name, hsn: it.hsn, unit: it.unit, qty: l.qty, rate: r2(l.rate ?? Number(it.sp1)) };
    });
    const value = r2(lines.reduce((s, l) => s + l.qty * l.rate, 0));
    const number = `DC-${String(await nextSeq(db, c.shopId, 'dc')).padStart(4, '0')}`;
    const row = await one(db,
      `INSERT INTO delivery_challans (shop_id, number, customer_id, customer, date, purpose, sales_order_id, lines, value, transporter, vehicle_no, lr_no, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id`,
      [c.shopId, number, customerId, JSON.stringify(snap), b.date, b.purpose, b.salesOrderId ?? null, JSON.stringify(lines), value, b.transporter, b.vehicleNo, b.lrNo, b.notes, c.id]);
    await audit(db, req, c.shopId, 'create', 'delivery_challan', row.id, { number, value });
    return get(db, c.shopId, row.id);
  }),
);

/** Packed → Dispatched → Delivered (or Cancelled), recording who received the goods. */
challansRouter.patch(
  '/delivery-challans/:id/status',
  perm('sales.write'),
  T(async (db, req, c) => {
    const b = parse(z.object({ status: z.enum(['Dispatched', 'Delivered', 'Cancelled']), receivedBy: z.string().trim().max(120).default(''), vehicleNo: z.string().trim().toUpperCase().max(20).optional() }), req.body);
    const d = await load(db, c.shopId, req.params.id!, true);
    const order = { Packed: 0, Dispatched: 1, Delivered: 2, Invoiced: 3, Cancelled: 9 } as Record<string, number>;
    if (d.status === 'Cancelled' || d.status === 'Invoiced') throw conflict(`This challan is ${d.status.toLowerCase()} and can’t change`);
    if (b.status !== 'Cancelled' && order[b.status]! <= order[d.status]!) throw conflict(`This challan is already ${d.status.toLowerCase()}`);
    if (b.status === 'Delivered' && !b.receivedBy) throw badRequest('Enter who received the goods', { receivedBy: 'Who received the goods?' });
    await db.query(
      `UPDATE delivery_challans SET status = $3, received_by = CASE WHEN $3 = 'Delivered' THEN $4 ELSE received_by END, vehicle_no = coalesce($5, vehicle_no),
         dispatched_at = CASE WHEN $3 IN ('Dispatched', 'Delivered') THEN coalesce(dispatched_at, now()) ELSE dispatched_at END,
         delivered_at = CASE WHEN $3 = 'Delivered' THEN now() ELSE delivered_at END WHERE shop_id = $1 AND id = $2`,
      [c.shopId, d.id, b.status, b.receivedBy, b.vehicleNo ?? null]);
    await audit(db, req, c.shopId, 'status', 'delivery_challan', d.id, { from: d.status, to: b.status });
    return get(db, c.shopId, d.id);
  }),
);

/** Bill the goods on a challan: creates a draft invoice with the same items, quantities and rates. */
challansRouter.post(
  '/delivery-challans/:id/invoice',
  perm('sales.write'),
  T(async (db, req, c) => {
    const d = await load(db, c.shopId, req.params.id!, true);
    if (d.status === 'Cancelled') throw conflict('This challan was cancelled');
    if (d.invoice_id) throw conflict('This challan has already been invoiced');
    const org = await getOrg(db, c.shopId);
    const inv = await createInvoice(db, req, c.shopId, {
      customerId: d.customer_id, date: todayISO(), dueDate: (() => { const d = new Date(`${todayISO()}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 15); return d.toISOString().slice(0, 10); })(),
      branchId: c.branchId, withGst: !!org.gstin && !org.composition_scheme, reverseCharge: false, tcsRate: 0,
      notes: `Against delivery challan ${d.number}`, salesOrderId: d.sales_order_id ?? null,
      lines: (d.lines as Array<{ itemId: string; qty: number; rate: number }>).map((l) => ({ itemId: l.itemId, qty: l.qty, rate: l.rate, tier: 'SP1' as const, discount: 0 })),
    }, { issue: false });
    await db.query("UPDATE delivery_challans SET status = 'Invoiced', invoice_id = $3 WHERE shop_id = $1 AND id = $2", [c.shopId, d.id, inv.id]);
    await audit(db, req, c.shopId, 'invoice', 'delivery_challan', d.id, { invoice: inv.id });
    return { invoiceId: inv.id, challan: await get(db, c.shopId, d.id) };
  }),
);

challansRouter.delete(
  '/delivery-challans/:id',
  perm('sales.write'),
  T(async (db, req, c) => {
    const d = await load(db, c.shopId, req.params.id!, true);
    if (d.status !== 'Packed') throw conflict('Only challans that haven’t been dispatched can be deleted. Cancel it instead.');
    await db.query('DELETE FROM delivery_challans WHERE shop_id = $1 AND id = $2', [c.shopId, d.id]);
    await audit(db, req, c.shopId, 'delete', 'delivery_challan', d.id, { number: d.number });
    return { ok: true };
  }),
);

export const CHALLAN_STATUSES = STATUSES;
