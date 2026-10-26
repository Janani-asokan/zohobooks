import { Router } from 'express';
import { z } from 'zod';
import { perm, todayISO } from '../../auth';
import { audit } from '../../audit';
import { many, one, type Db } from '../../db';
import { badRequest, conflict, HttpError, notFound, parse } from '../../http';
import { stockInsights } from '../../services/stockInsights';
import { nextSeq, requireRow } from '../../services/common';
import { moveStock } from '../../services/stock';
import { T, allowed } from './ctx';

export const inventoryRouter = Router();
const iso = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const r2 = (n: number) => Math.round(n * 100) / 100;
const r3 = (n: number) => Math.round(n * 1000) / 1000;
const docNo = async (db: Db, shopId: string, key: string, prefix: string) => `${prefix}-${String(await nextSeq(db, shopId, key)).padStart(4, '0')}`;

async function goodsItems(db: Db, shopId: string, ids: string[]) {
  const rows = await many(db, 'SELECT id, name, unit, type, cost, is_group, track_batches, track_serials FROM items WHERE shop_id = $1 AND id = ANY($2::uuid[]) AND NOT archived', [shopId, ids]);
  const byId = new Map(rows.map((r) => [r.id, r]));
  for (const id of ids) {
    const it = byId.get(id);
    if (!it) throw badRequest('One of the items no longer exists');
    if (it.type !== 'Goods') throw badRequest(`${it.name} is a service and has no stock`);
    if (it.is_group) throw badRequest(`${it.name} has variants. Choose a size or colour instead.`);
  }
  return byId;
}
const qtyAt = async (db: Db, itemId: string, branchId: string) => Number((await one(db, 'SELECT qty FROM item_stock WHERE item_id = $1 AND branch_id = $2 FOR UPDATE', [itemId, branchId]))?.qty ?? 0);

/* ======================= Stock adjustments ======================= */
export const ADJUST_REASONS = ['Stock count', 'Damaged', 'Expired', 'Lost or stolen', 'Found', 'Internal use', 'Sample or gift', 'Other'] as const;

const serializeAdj = (a: any) => ({
  id: a.id, number: a.number, branchId: a.branch_id, branchName: a.branch_name, date: a.date, reason: a.reason, mode: a.mode, lines: a.lines,
  value: Number(a.value), notes: a.notes, createdBy: a.created_by_name, createdAt: a.created_at,
});

inventoryRouter.get('/stock/adjustments', T(async (db, _req, c) =>
  (await many(db, 'SELECT a.*, b.name AS branch_name FROM stock_adjustments a JOIN branches b ON b.id = a.branch_id WHERE a.shop_id = $1 ORDER BY a.date DESC, a.created_at DESC', [c.shopId])).map(serializeAdj)));

inventoryRouter.post(
  '/stock/adjustments',
  perm('items.write'),
  T(async (db, req, c) => {
    const b = parse(z.object({
      branchId: z.string().uuid('Choose a warehouse'), date: iso.default(todayISO), reason: z.enum(ADJUST_REASONS), notes: z.string().max(500).default(''),
      /** change: qty is +/− units; count: qty is what was counted on the shelf. */
      mode: z.enum(['change', 'count']).default('change'),
      lines: z.array(z.object({ itemId: z.string().uuid(), qty: z.number(), batchNo: z.string().max(60).optional(), expiryDate: iso.optional() })).min(1, 'Add at least one item').max(500),
    }), req.body);
    await requireRow(db, 'branches', c.shopId, b.branchId, 'Warehouse');
    const items = await goodsItems(db, c.shopId, [...new Set(b.lines.map((l) => l.itemId))]);
    const number = await docNo(db, c.shopId, 'adj', 'ADJ');
    const row = await one(db, `INSERT INTO stock_adjustments (shop_id, number, branch_id, date, reason, mode, lines, value, notes, created_by, created_by_name)
      VALUES ($1,$2,$3,$4,$5,$6,'[]',0,$7,$8,$9) RETURNING *`, [c.shopId, number, b.branchId, b.date, b.reason, b.mode, b.notes, c.id, c.name]);
    const lines = [];
    for (const l of b.lines) {
      const it = items.get(l.itemId)!;
      const before = await qtyAt(db, it.id, b.branchId);
      if (b.mode === 'count' && l.qty < 0) throw badRequest(`Counted quantity for ${it.name} can’t be negative`);
      const change = r3(b.mode === 'count' ? l.qty - before : l.qty);
      if (change === 0) continue;
      if (before + change < -0.0005) throw badRequest(`${it.name} has only ${before} ${it.unit} at this warehouse`);
      await moveStock(db, { shopId: c.shopId, itemId: it.id, branchId: b.branchId, qty: change, reason: 'adjustment', refType: 'stock_adjustment', refId: row.id, note: `${number} · ${b.reason}`, userId: c.id, batchNo: l.batchNo, expiryDate: l.expiryDate ?? null });
      const cost = Number(it.cost);
      lines.push({ itemId: it.id, name: it.name, unit: it.unit, before, change, after: r3(before + change), cost, value: r2(change * cost) });
    }
    if (!lines.length) throw badRequest(b.mode === 'count' ? 'Every count matches the stock on record. Nothing to adjust.' : 'Enter a quantity to add or remove');
    const value = r2(lines.reduce((s, l) => s + l.value, 0));
    await db.query('UPDATE stock_adjustments SET lines = $3, value = $4 WHERE shop_id = $1 AND id = $2', [c.shopId, row.id, JSON.stringify(lines), value]);
    await audit(db, req, c.shopId, 'create', 'stock_adjustment', row.id, { number, lines: lines.length, value });
    const br = await one(db, 'SELECT name FROM branches WHERE id = $1', [b.branchId]);
    return serializeAdj({ ...row, lines, value, branch_name: br.name });
  }),
);

/* ======================= Transfers (dispatch → receive) ======================= */
const serializeTr = (t: any) => ({
  id: t.id, number: t.number, fromBranchId: t.from_branch_id, fromName: t.from_name, toBranchId: t.to_branch_id, toName: t.to_name, date: t.date,
  status: t.status, lines: t.lines, notes: t.notes, receivedAt: t.received_at, createdBy: t.created_by_name, createdAt: t.created_at,
});
const TR_SQL = 'SELECT t.*, f.name AS from_name, d.name AS to_name FROM stock_transfers t JOIN branches f ON f.id = t.from_branch_id JOIN branches d ON d.id = t.to_branch_id WHERE t.shop_id = $1';

inventoryRouter.get('/stock/transfers', T(async (db, _req, c) => (await many(db, `${TR_SQL} ORDER BY t.date DESC, t.created_at DESC`, [c.shopId])).map(serializeTr)));

/** Dispatch: stock leaves the source now and is "in transit" until the destination receives it. */
inventoryRouter.post(
  '/stock/transfers',
  perm('items.write'),
  T(async (db, req, c) => {
    const b = parse(z.object({
      fromBranchId: z.string().uuid('Choose where the stock is'), toBranchId: z.string().uuid('Choose where it is going'), date: iso.default(todayISO), notes: z.string().max(500).default(''),
      receiveNow: z.boolean().default(false),
      lines: z.array(z.object({ itemId: z.string().uuid(), qty: z.number().positive('Enter a quantity'), serials: z.array(z.string().trim().min(1)).max(1000).optional() })).min(1, 'Add at least one item').max(500),
    }), req.body);
    if (b.fromBranchId === b.toBranchId) throw badRequest('Choose two different warehouses', { toBranchId: 'Same as the source' });
    await requireRow(db, 'branches', c.shopId, b.fromBranchId, 'Warehouse');
    await requireRow(db, 'branches', c.shopId, b.toBranchId, 'Warehouse');
    const items = await goodsItems(db, c.shopId, [...new Set(b.lines.map((l) => l.itemId))]);
    const number = await docNo(db, c.shopId, 'tr', 'TR');
    const row = await one(db, `INSERT INTO stock_transfers (shop_id, number, from_branch_id, to_branch_id, date, status, lines, notes, created_by, created_by_name)
      VALUES ($1,$2,$3,$4,$5,'In transit','[]',$6,$7,$8) RETURNING *`, [c.shopId, number, b.fromBranchId, b.toBranchId, b.date, b.notes, c.id, c.name]);
    const lines = [];
    for (const l of b.lines) {
      const it = items.get(l.itemId)!;
      const have = await qtyAt(db, it.id, b.fromBranchId);
      if (have < l.qty - 0.0005) throw badRequest(`Only ${have} ${it.unit} of ${it.name} at the source warehouse`);
      let serials: string[] = [];
      if (it.track_serials) {
        serials = [...new Set((l.serials ?? []).map((s) => s.trim()))];
        if (serials.length !== l.qty) throw badRequest(`${it.name} needs ${l.qty} serial number${l.qty === 1 ? '' : 's'}`);
        const ok = await many(db, "SELECT id FROM item_serials WHERE shop_id = $1 AND item_id = $2 AND branch_id = $3 AND status = 'In stock' AND serial = ANY($4::text[]) FOR UPDATE", [c.shopId, it.id, b.fromBranchId, serials]);
        if (ok.length !== serials.length) throw badRequest(`Some serial numbers of ${it.name} aren’t in stock at the source warehouse`);
        await db.query("UPDATE item_serials SET status = 'In transit', updated_at = now() WHERE id = ANY($1::uuid[])", [ok.map((x) => x.id)]);
      }
      const batches = await moveStock(db, { shopId: c.shopId, itemId: it.id, branchId: b.fromBranchId, qty: -l.qty, reason: 'transfer_out', refType: 'stock_transfer', refId: row.id, note: number, userId: c.id });
      lines.push({ itemId: it.id, name: it.name, unit: it.unit, qty: l.qty, batches, serials });
    }
    await db.query('UPDATE stock_transfers SET lines = $3 WHERE shop_id = $1 AND id = $2', [c.shopId, row.id, JSON.stringify(lines)]);
    await audit(db, req, c.shopId, 'dispatch', 'stock_transfer', row.id, { number, lines: lines.length });
    if (b.receiveNow) await receiveTransfer(db, c.shopId, row.id, c.id);
    return serializeTr((await many(db, `${TR_SQL} AND t.id = $2`, [c.shopId, row.id]))[0]);
  }),
);

async function receiveTransfer(db: Db, shopId: string, id: string, userId: string) {
  const t = await one(db, 'SELECT * FROM stock_transfers WHERE shop_id = $1 AND id = $2 FOR UPDATE', [shopId, id]);
  if (!t) throw notFound('Transfer');
  if (t.status !== 'In transit') throw conflict(`This transfer is already ${t.status.toLowerCase()}`);
  for (const l of t.lines) {
    if (l.batches?.length) for (const bt of l.batches) await moveStock(db, { shopId, itemId: l.itemId, branchId: t.to_branch_id, qty: bt.qty, reason: 'transfer_in', refType: 'stock_transfer', refId: t.id, note: t.number, userId, batchNo: bt.batchNo, expiryDate: bt.expiryDate });
    else await moveStock(db, { shopId, itemId: l.itemId, branchId: t.to_branch_id, qty: l.qty, reason: 'transfer_in', refType: 'stock_transfer', refId: t.id, note: t.number, userId });
    if (l.serials?.length) await db.query("UPDATE item_serials SET status = 'In stock', branch_id = $4, updated_at = now() WHERE shop_id = $1 AND item_id = $2 AND serial = ANY($3::text[]) AND status = 'In transit'", [shopId, l.itemId, l.serials, t.to_branch_id]);
  }
  await db.query("UPDATE stock_transfers SET status = 'Received', received_at = now() WHERE shop_id = $1 AND id = $2", [shopId, id]);
}

inventoryRouter.post(
  '/stock/transfers/:id/receive',
  perm('items.write'),
  T(async (db, req, c) => {
    await receiveTransfer(db, c.shopId, req.params.id!, c.id);
    await audit(db, req, c.shopId, 'receive', 'stock_transfer', req.params.id!);
    return serializeTr((await many(db, `${TR_SQL} AND t.id = $2`, [c.shopId, req.params.id]))[0]);
  }),
);

/** Cancel while in transit: the stock goes back to the source warehouse. */
inventoryRouter.post(
  '/stock/transfers/:id/cancel',
  perm('items.write'),
  T(async (db, req, c) => {
    const t = await one(db, 'SELECT * FROM stock_transfers WHERE shop_id = $1 AND id = $2 FOR UPDATE', [c.shopId, req.params.id]);
    if (!t) throw notFound('Transfer');
    if (t.status !== 'In transit') throw conflict('Only transfers still in transit can be cancelled');
    for (const l of t.lines) {
      if (l.batches?.length) for (const bt of l.batches) await moveStock(db, { shopId: c.shopId, itemId: l.itemId, branchId: t.from_branch_id, qty: bt.qty, reason: 'transfer_cancel', refType: 'stock_transfer', refId: t.id, note: `Cancel ${t.number}`, userId: c.id, batchNo: bt.batchNo, expiryDate: bt.expiryDate });
      else await moveStock(db, { shopId: c.shopId, itemId: l.itemId, branchId: t.from_branch_id, qty: l.qty, reason: 'transfer_cancel', refType: 'stock_transfer', refId: t.id, note: `Cancel ${t.number}`, userId: c.id });
      if (l.serials?.length) await db.query("UPDATE item_serials SET status = 'In stock', updated_at = now() WHERE shop_id = $1 AND item_id = $2 AND serial = ANY($3::text[]) AND status = 'In transit'", [c.shopId, l.itemId, l.serials]);
    }
    await db.query("UPDATE stock_transfers SET status = 'Cancelled' WHERE shop_id = $1 AND id = $2", [c.shopId, t.id]);
    await audit(db, req, c.shopId, 'cancel', 'stock_transfer', t.id, { number: t.number });
    return serializeTr((await many(db, `${TR_SQL} AND t.id = $2`, [c.shopId, t.id]))[0]);
  }),
);

/* ======================= Serial numbers ======================= */
const serializeSerial = (s: any) => ({ id: s.id, itemId: s.item_id, itemName: s.item_name, serial: s.serial, status: s.status, branchId: s.branch_id, branchName: s.branch_name, invoiceId: s.invoice_id, invoiceNumber: s.invoice_number, note: s.note, updatedAt: s.updated_at });
const SERIAL_SQL = `SELECT s.*, i.name AS item_name, b.name AS branch_name, inv.number AS invoice_number FROM item_serials s JOIN items i ON i.id = s.item_id
  LEFT JOIN branches b ON b.id = s.branch_id LEFT JOIN invoices inv ON inv.id = s.invoice_id WHERE s.shop_id = $1`;

inventoryRouter.get('/items/:id/serials', T(async (db, req, c) => (await many(db, `${SERIAL_SQL} AND s.item_id = $2 ORDER BY s.status, s.serial`, [c.shopId, req.params.id])).map(serializeSerial)));

/** Find a serial anywhere (warranty claims, returns): which item, where, and on which invoice. */
inventoryRouter.get('/serials/lookup', T(async (db, req, c) => {
  const q = String(req.query.q ?? '').trim();
  if (q.length < 3) return [];
  return (await many(db, `${SERIAL_SQL} AND s.serial ILIKE $2 ORDER BY s.updated_at DESC LIMIT 20`, [c.shopId, `%${q.replace(/[%_]/g, '\\$&')}%`])).map(serializeSerial);
}));

/** Register serial numbers for units already in stock (received on a bill or PO, or opening stock). */
inventoryRouter.post(
  '/items/:id/serials',
  perm('items.write'),
  T(async (db, req, c) => {
    const it = await requireRow(db, 'items', c.shopId, req.params.id!, 'Item');
    if (!it.track_serials) throw badRequest('Turn on serial numbers for this item first');
    const b = parse(z.object({ branchId: z.string().uuid('Choose a warehouse'), serials: z.array(z.string().trim().min(1).max(60)).min(1, 'Enter at least one serial number').max(1000), note: z.string().max(200).default('') }), req.body);
    await requireRow(db, 'branches', c.shopId, b.branchId, 'Warehouse');
    const serials = [...new Set(b.serials)];
    const taken = await many(db, 'SELECT serial FROM item_serials WHERE shop_id = $1 AND item_id = $2 AND serial = ANY($3::text[])', [c.shopId, it.id, serials]);
    if (taken.length) throw badRequest(`Already registered: ${taken.slice(0, 5).map((t) => t.serial).join(', ')}${taken.length > 5 ? '…' : ''}`);
    const inStock = Number((await one(db, "SELECT count(*)::int AS n FROM item_serials WHERE shop_id = $1 AND item_id = $2 AND branch_id = $3 AND status = 'In stock'", [c.shopId, it.id, b.branchId])).n);
    const qty = await qtyAt(db, it.id, b.branchId);
    if (inStock + serials.length > qty + 0.0005) throw badRequest(`Only ${qty} ${it.unit} in stock at this warehouse and ${inStock} already have serial numbers. Receive the stock first.`);
    await db.query(`INSERT INTO item_serials (shop_id, item_id, branch_id, serial, status, note) SELECT $1, $2, $3, unnest($4::text[]), 'In stock', $5`, [c.shopId, it.id, b.branchId, serials, b.note]);
    await audit(db, req, c.shopId, 'add_serials', 'item', it.id, { count: serials.length });
    return (await many(db, `${SERIAL_SQL} AND s.item_id = $2 ORDER BY s.status, s.serial`, [c.shopId, it.id])).map(serializeSerial);
  }),
);

/* ======================= Variants ======================= */
const attrSchema = z.array(z.object({ name: z.string().trim().min(1).max(30), values: z.array(z.string().trim().min(1).max(30)).min(1).max(30) })).min(1).max(3);

/**
 * Turns an item into a group with one sellable item per combination (Size × Colour …).
 * Variants copy the group's tax, unit, HSN and prices; each can have its own SKU, barcode and prices.
 */
inventoryRouter.post(
  '/items/:id/variants',
  perm('items.write'),
  T(async (db, req, c) => {
    const g = await requireRow(db, 'items', c.shopId, req.params.id!, 'Item');
    if (g.parent_id) throw badRequest('A variant can’t have variants of its own');
    const b = parse(z.object({
      attributes: attrSchema,
      variants: z.array(z.object({
        attrs: z.record(z.string(), z.string()), sku: z.string().trim().max(60).default(''), barcode: z.string().trim().max(60).default(''),
        sp1: z.number().positive().optional(), sp2: z.number().positive().optional(), sp3: z.number().positive().optional(), cost: z.number().min(0).optional(), mrp: z.number().min(0).nullable().optional(),
      })).min(1, 'Pick at least one combination').max(200),
    }), req.body);
    const stock = Number((await one(db, 'SELECT coalesce(sum(qty),0) AS q FROM item_stock WHERE item_id = $1', [g.id])).q);
    if (stock !== 0) throw badRequest('Move this item’s stock to its variants first: an item with variants can’t hold stock itself');
    const names = b.attributes.map((a) => a.name);
    const existing = await many(db, 'SELECT variant_attrs FROM items WHERE shop_id = $1 AND parent_id = $2 AND NOT archived', [c.shopId, g.id]);
    const key = (a: Record<string, string>) => names.map((n) => a[n] ?? '').join('\u0001');
    const seen = new Set(existing.map((e) => key(e.variant_attrs)));
    const created = [];
    for (const v of b.variants) {
      for (const a of b.attributes) if (!a.values.includes(v.attrs[a.name] ?? '')) throw badRequest(`Pick a ${a.name} for every variant`);
      if (seen.has(key(v.attrs))) continue;
      seen.add(key(v.attrs));
      const label = names.map((n) => v.attrs[n]).join(' / ');
      const row = await one(db, `INSERT INTO items (shop_id, type, name, sku, barcode, unit, hsn, cost, sp1, sp2, sp3, tax_slab_id, reorder_level, track_batches, track_serials, description, category, brand, image, mrp, parent_id, variant_attrs)
        VALUES ($1,'Goods',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21) RETURNING id`,
        [c.shopId, `${g.name} - ${label}`, v.sku, v.barcode, g.unit, g.hsn, v.cost ?? g.cost, v.sp1 ?? g.sp1, v.sp2 ?? g.sp2, v.sp3 ?? g.sp3, g.tax_slab_id, g.reorder_level, g.track_batches, g.track_serials, g.description, g.category, g.brand, g.image, v.mrp === undefined ? g.mrp : v.mrp, g.id, JSON.stringify(Object.fromEntries(names.map((n) => [n, v.attrs[n]])))]);
      created.push(row.id);
    }
    await db.query('UPDATE items SET is_group = true, attributes = $3 WHERE shop_id = $1 AND id = $2', [c.shopId, g.id, JSON.stringify(b.attributes)]);
    await audit(db, req, c.shopId, 'create_variants', 'item', g.id, { count: created.length });
    return { created: created.length };
  }),
);

/* ======================= Stock summary & valuation ======================= */
inventoryRouter.get(
  '/stock/summary',
  T(async (db, req, c) => {
    const to = iso.safeParse(req.query.to).success ? String(req.query.to) : todayISO();
    const from = iso.safeParse(req.query.from).success ? String(req.query.from) : `${Number(to.slice(0, 4)) - (to.slice(5, 7) < '04' ? 1 : 0)}-04-01`;
    const branchId = z.string().uuid().safeParse(req.query.branchId).success ? String(req.query.branchId) : null;
    const showCost = allowed(c, 'items.cost');
    const rows = await many(
      db,
      `SELECT i.id, i.name, i.sku, i.unit, i.category, i.cost, i.reorder_level, i.parent_id,
         coalesce(sum(m.qty_change) FILTER (WHERE m.at::date < $2), 0) AS opening,
         coalesce(sum(m.qty_change) FILTER (WHERE m.at::date BETWEEN $2 AND $3 AND m.qty_change > 0), 0) AS qty_in,
         coalesce(-sum(m.qty_change) FILTER (WHERE m.at::date BETWEEN $2 AND $3 AND m.qty_change < 0), 0) AS qty_out,
         coalesce(sum(m.qty_change) FILTER (WHERE m.at::date <= $3), 0) AS closing,
         coalesce(-sum(m.qty_change) FILTER (WHERE m.at::date BETWEEN $2 AND $3 AND m.reason = 'sale'), 0) - coalesce(sum(m.qty_change) FILTER (WHERE m.at::date BETWEEN $2 AND $3 AND m.reason IN ('sale_cancel', 'credit_note')), 0) AS sold
       FROM items i LEFT JOIN stock_movements m ON m.item_id = i.id AND ($4::uuid IS NULL OR m.branch_id = $4)
       WHERE i.shop_id = $1 AND i.type = 'Goods' AND NOT i.is_group AND NOT i.archived
       GROUP BY i.id ORDER BY i.category, i.name`,
      [c.shopId, from, to, branchId],
    );
    const items = rows.map((r) => {
      const closing = r3(Number(r.closing));
      const cost = Number(r.cost);
      return {
        itemId: r.id, name: r.name, sku: r.sku, unit: r.unit, category: r.category || 'Uncategorised', opening: r3(Number(r.opening)), in: r3(Number(r.qty_in)), out: r3(Number(r.qty_out)),
        closing, sold: r3(Number(r.sold)), reorderLevel: Number(r.reorder_level), cost: showCost ? cost : null, value: showCost ? r2(closing * cost) : null,
      };
    });
    const byCategory = Object.values(items.reduce<Record<string, { category: string; items: number; qty: number; value: number }>>((acc, i) => {
      const k = i.category;
      acc[k] ??= { category: k, items: 0, qty: 0, value: 0 };
      acc[k].items++; acc[k].qty = r3(acc[k].qty + i.closing); acc[k].value = r2(acc[k].value + (i.value ?? 0));
      return acc;
    }, {})).sort((a, b) => b.value - a.value);
    const byBranch = showCost
      ? (await many(db, `SELECT b.id, b.name, coalesce(sum(s.qty * i.cost), 0) AS value, coalesce(sum(s.qty), 0) AS qty, count(*) FILTER (WHERE s.qty > 0) AS items
          FROM branches b LEFT JOIN item_stock s ON s.branch_id = b.id LEFT JOIN items i ON i.id = s.item_id WHERE b.shop_id = $1 GROUP BY b.id ORDER BY b.is_primary DESC, b.name`, [c.shopId]))
          .map((b) => ({ branchId: b.id, name: b.name, value: r2(Number(b.value)), qty: r3(Number(b.qty)), items: Number(b.items) }))
      : [];
    const inTransit = Number((await one(db, "SELECT count(*)::int AS n FROM stock_transfers WHERE shop_id = $1 AND status = 'In transit'", [c.shopId])).n);
    return {
      from, to, branchId, items, byCategory, byBranch, inTransit,
      totals: { qty: r3(items.reduce((s, i) => s + i.closing, 0)), value: showCost ? r2(items.reduce((s, i) => s + (i.value ?? 0), 0)) : null, items: items.length, lowStock: items.filter((i) => i.closing <= i.reorderLevel).length },
    };
  }),
);

/* ---------- Stock insights: reorder suggestions, dead and slow stock, expiring batches ---------- */
inventoryRouter.get(
  '/stock/insights',
  T(async (db, req, c) => {
    if (!allowed(c, 'items.write') && !allowed(c, 'purchases.read') && !allowed(c, 'reports.read')) throw new HttpError(403, 'Your role can’t see stock planning', 'forbidden');
    const ins = await stockInsights(db, c.shopId, { leadDays: Number(req.query.leadDays) || undefined, coverDays: Number(req.query.coverDays) || undefined });
    if (allowed(c, 'items.cost')) return ins;
    // Without cost access, keep quantities and days but hide money figures based on cost.
    return {
      ...ins,
      reorder: ins.reorder.map((r) => ({ ...r, cost: 0, lastPurchaseRate: null })),
      dead: ins.dead.map((d) => ({ ...d, value: 0 })), slow: ins.slow.map((d) => ({ ...d, value: 0 })), expiring: ins.expiring.map((d) => ({ ...d, value: 0 })),
      totals: { ...ins.totals, stockValue: 0, deadValue: 0, expiringValue: 0 },
    };
  }),
);
