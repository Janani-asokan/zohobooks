import { Router } from 'express';
import { z } from 'zod';
import { perm } from '../../auth';
import { audit } from '../../audit';
import { many, one, type Db } from '../../db';
import { badRequest, parse } from '../../http';
import { primaryBranchId, requireRow } from '../../services/common';
import { moveStock } from '../../services/stock';
import { parseCsv, toCsv } from '../../../../shared/csv';
import { allowed, T } from './ctx';

export const catalogRouter = Router();

const money = z.number().min(0);
const itemBody = z.object({
  type: z.enum(['Goods', 'Services']),
  name: z.string().trim().min(1, 'Item name is required').max(200),
  sku: z.string().trim().max(60).default(''),
  barcode: z.string().trim().max(60).default(''),
  unit: z.string().trim().max(20).default('pcs'),
  hsn: z.string().trim().regex(/^\d{0,8}$/, 'HSN/SAC must be digits').default(''),
  cost: money,
  sp1: z.number().positive('SP1 is required'),
  sp2: z.number().positive('SP2 is required'),
  sp3: z.number().positive('SP3 is required'),
  taxSlabId: z.string().min(1, 'Select a tax slab'),
  reorderLevel: money.default(10),
  trackBatches: z.boolean().default(false),
  description: z.string().max(1000).default(''),
  category: z.string().trim().max(60).default(''),
  brand: z.string().trim().max(60).default(''),
  // small data-URL thumbnail (client downscales to ~400px)
  image: z.string().max(250_000).refine((v) => !v || v.startsWith('data:image/'), 'Image must be a picture').default(''),
  mrp: z.number().min(0).nullable().default(null),
});

export async function listItems(db: Db, shopId: string, showCost: boolean, ids?: string[]) {
  const rows = await many(
    db,
    `SELECT i.*, t.rate AS tax_rate,
            coalesce((SELECT jsonb_object_agg(s.branch_id, s.qty) FROM item_stock s WHERE s.item_id = i.id), '{}'::jsonb) AS stock_by_branch,
            coalesce((SELECT sum(s.qty) FROM item_stock s WHERE s.item_id = i.id), 0) AS stock
       FROM items i JOIN tax_slabs t ON t.id = i.tax_slab_id
      WHERE i.shop_id = $1 AND NOT i.archived ${ids ? 'AND i.id = ANY($2::uuid[])' : ''}
      ORDER BY i.created_at DESC`,
    ids ? [shopId, ids] : [shopId],
  );
  return rows.map((r) => ({
    id: r.id,
    type: r.type,
    name: r.name,
    sku: r.sku,
    barcode: r.barcode,
    unit: r.unit,
    hsn: r.hsn,
    cost: showCost ? Number(r.cost) : null,
    sp1: Number(r.sp1),
    sp2: Number(r.sp2),
    sp3: Number(r.sp3),
    taxSlabId: r.tax_slab_id,
    taxRate: Number(r.tax_rate),
    reorderLevel: Number(r.reorder_level),
    trackBatches: r.track_batches,
    description: r.description,
    category: r.category,
    brand: r.brand,
    image: r.image,
    mrp: r.mrp === null ? null : Number(r.mrp),
    stock: Number(r.stock),
    stockByBranch: Object.fromEntries(Object.entries(r.stock_by_branch as Record<string, unknown>).map(([k, v]) => [k, Number(v)])),
    createdAt: r.created_at,
  }));
}

async function assertSlab(db: Db, id: string) {
  const s = await one(db, 'SELECT active FROM tax_slabs WHERE id = $1', [id]);
  if (!s) throw badRequest('Unknown tax slab', { taxSlabId: 'Unknown tax slab' });
  return s;
}

catalogRouter.get('/items', T(async (db, _req, c) => listItems(db, c.shopId, allowed(c, 'items.cost'))));

catalogRouter.post(
  '/items',
  perm('items.write'),
  T(async (db, req, c) => {
    const b = parse(
      itemBody.extend({ openingStock: money.default(0), branchId: z.string().uuid().nullable().optional(), batchNo: z.string().max(60).optional(), expiryDate: z.string().optional() }),
      req.body,
    );
    const slab = await assertSlab(db, b.taxSlabId);
    if (!slab.active) throw badRequest('This tax slab is disabled', { taxSlabId: 'Disabled slab' });
    const it = await one(
      db,
      `INSERT INTO items (shop_id, type, name, sku, barcode, unit, hsn, cost, sp1, sp2, sp3, tax_slab_id, reorder_level, track_batches, description, category, brand, image, mrp)
       VALUES ($1,$2,$3,upper($4),$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19) RETURNING id`,
      [c.shopId, b.type, b.name, b.sku, b.barcode, b.unit, b.hsn, b.cost, b.sp1, b.sp2, b.sp3, b.taxSlabId, b.reorderLevel, b.type === 'Goods' && b.trackBatches, b.description, b.category, b.brand, b.image, b.mrp],
    );
    if (b.type === 'Goods' && b.openingStock > 0) {
      const branchId = await primaryBranchId(db, c.shopId, b.branchId);
      await moveStock(db, { shopId: c.shopId, itemId: it.id, branchId, qty: b.openingStock, reason: 'opening', userId: c.id, batchNo: b.batchNo, expiryDate: b.expiryDate || null });
    }
    await audit(db, req, c.shopId, 'create', 'item', it.id, { name: b.name });
    return (await listItems(db, c.shopId, true, [it.id]))[0];
  }),
);

catalogRouter.patch(
  '/items/:id',
  perm('items.write'),
  T(async (db, req, c) => {
    const cur = await requireRow(db, 'items', c.shopId, req.params.id!, 'Item');
    const b = parse(itemBody.partial(), req.body);
    if (b.taxSlabId) await assertSlab(db, b.taxSlabId);
    const merged = { ...cur, ...Object.fromEntries(Object.entries(b).filter(([, v]) => v !== undefined)) } as any;
    await db.query(
      `UPDATE items SET type=$3, name=$4, sku=upper($5), barcode=$6, unit=$7, hsn=$8, cost=$9, sp1=$10, sp2=$11, sp3=$12, tax_slab_id=$13,
              reorder_level=$14, track_batches=$15, description=$16, category=$17, brand=$18, image=$19, mrp=$20 WHERE shop_id=$1 AND id=$2`,
      [
        c.shopId, cur.id, merged.type, merged.name, merged.sku, merged.barcode, merged.unit, merged.hsn, merged.cost, merged.sp1, merged.sp2, merged.sp3,
        b.taxSlabId ?? cur.tax_slab_id, b.reorderLevel ?? cur.reorder_level, b.trackBatches ?? cur.track_batches, merged.description,
        merged.category, merged.brand, merged.image, b.mrp !== undefined ? b.mrp : cur.mrp,
      ],
    );
    await audit(db, req, c.shopId, 'update', 'item', cur.id, b);
    return (await listItems(db, c.shopId, allowed(c, 'items.cost'), [cur.id]))[0];
  }),
);

/** Distinct categories & brands, for the item form's suggestions and the list filters. */
catalogRouter.get(
  '/items/facets',
  T(async (db, _req, c) => {
    const cats = await many(db, "SELECT category AS v, count(*)::int AS n FROM items WHERE shop_id = $1 AND NOT archived AND category <> '' GROUP BY 1 ORDER BY 1", [c.shopId]);
    const brands = await many(db, "SELECT brand AS v, count(*)::int AS n FROM items WHERE shop_id = $1 AND NOT archived AND brand <> '' GROUP BY 1 ORDER BY 1", [c.shopId]);
    const units = await many(db, 'SELECT DISTINCT unit AS v FROM items WHERE shop_id = $1 ORDER BY 1', [c.shopId]);
    return { categories: cats.map((r) => ({ name: r.v, count: r.n })), brands: brands.map((r) => ({ name: r.v, count: r.n })), units: units.map((r) => r.v) };
  }),
);

/** Items are archived, not deleted — past invoices keep referring to them. */
catalogRouter.delete(
  '/items/:id',
  perm('items.write'),
  T(async (db, req, c) => {
    const cur = await requireRow(db, 'items', c.shopId, req.params.id!, 'Item');
    await db.query('UPDATE items SET archived = true WHERE shop_id = $1 AND id = $2', [c.shopId, cur.id]);
    await audit(db, req, c.shopId, 'archive', 'item', cur.id, { name: cur.name });
  }),
);

catalogRouter.post(
  '/items/bulk',
  perm('items.write'),
  T(async (db, req, c) => {
    const b = parse(z.object({ ids: z.array(z.string().uuid()).min(1).max(500), action: z.enum(['archive', 'setTax']), taxSlabId: z.string().optional() }), req.body);
    if (b.action === 'archive') await db.query('UPDATE items SET archived = true WHERE shop_id = $1 AND id = ANY($2::uuid[])', [c.shopId, b.ids]);
    else {
      if (!b.taxSlabId) throw badRequest('Select a tax slab');
      await assertSlab(db, b.taxSlabId);
      await db.query('UPDATE items SET tax_slab_id = $3 WHERE shop_id = $1 AND id = ANY($2::uuid[])', [c.shopId, b.ids, b.taxSlabId]);
    }
    await audit(db, req, c.shopId, `bulk_${b.action}`, 'item', '', { count: b.ids.length, taxSlabId: b.taxSlabId });
    return { updated: b.ids.length };
  }),
);

/* ---------------- Stock ---------------- */
catalogRouter.post(
  '/items/:id/adjust',
  perm('items.write'),
  T(async (db, req, c) => {
    const it = await requireRow(db, 'items', c.shopId, req.params.id!, 'Item');
    if (it.type !== 'Goods') throw badRequest('Services don’t carry stock');
    const b = parse(
      z.object({ branchId: z.string().uuid(), qty: z.number().refine((v) => v !== 0, 'Enter a quantity'), note: z.string().trim().min(1, 'Add a reason').max(200), batchNo: z.string().max(60).optional(), expiryDate: z.string().optional() }),
      req.body,
    );
    const branchId = await primaryBranchId(db, c.shopId, b.branchId);
    await moveStock(db, { shopId: c.shopId, itemId: it.id, branchId, qty: b.qty, reason: 'adjustment', note: b.note, userId: c.id, batchNo: b.batchNo, expiryDate: b.expiryDate || null });
    await audit(db, req, c.shopId, 'stock_adjust', 'item', it.id, { qty: b.qty, branchId, note: b.note });
    return (await listItems(db, c.shopId, allowed(c, 'items.cost'), [it.id]))[0];
  }),
);

catalogRouter.post(
  '/stock/transfer',
  perm('items.write'),
  T(async (db, req, c) => {
    const b = parse(z.object({ itemId: z.string().uuid(), fromBranchId: z.string().uuid(), toBranchId: z.string().uuid(), qty: z.number().positive(), note: z.string().max(200).default('') }), req.body);
    if (b.fromBranchId === b.toBranchId) throw badRequest('Choose two different branches');
    const it = await requireRow(db, 'items', c.shopId, b.itemId, 'Item');
    const from = await primaryBranchId(db, c.shopId, b.fromBranchId);
    const to = await primaryBranchId(db, c.shopId, b.toBranchId);
    const have = await one(db, 'SELECT qty FROM item_stock WHERE item_id = $1 AND branch_id = $2 FOR UPDATE', [it.id, from]);
    if (Number(have?.qty ?? 0) < b.qty) throw badRequest(`Only ${Number(have?.qty ?? 0)} ${it.unit} available at the source branch`);
    const used = await moveStock(db, { shopId: c.shopId, itemId: it.id, branchId: from, qty: -b.qty, reason: 'transfer_out', note: b.note, userId: c.id });
    if (used.length) for (const u of used) await moveStock(db, { shopId: c.shopId, itemId: it.id, branchId: to, qty: u.qty, reason: 'transfer_in', note: b.note, userId: c.id, batchNo: u.batchNo, expiryDate: u.expiryDate });
    else await moveStock(db, { shopId: c.shopId, itemId: it.id, branchId: to, qty: b.qty, reason: 'transfer_in', note: b.note, userId: c.id });
    await audit(db, req, c.shopId, 'stock_transfer', 'item', it.id, { qty: b.qty, from, to });
    return (await listItems(db, c.shopId, allowed(c, 'items.cost'), [it.id]))[0];
  }),
);

catalogRouter.get(
  '/items/:id/movements',
  T(async (db, req, c) => {
    const it = await requireRow(db, 'items', c.shopId, req.params.id!, 'Item');
    const rows = await many(
      db,
      `SELECT m.*, b.name AS branch_name, u.name AS user_name FROM stock_movements m
         JOIN branches b ON b.id = m.branch_id LEFT JOIN users u ON u.id = m.user_id
        WHERE m.shop_id = $1 AND m.item_id = $2 ORDER BY m.at DESC LIMIT 200`,
      [c.shopId, it.id],
    );
    const batches = await many(db, 'SELECT b.*, br.name AS branch_name FROM item_batches b JOIN branches br ON br.id = b.branch_id WHERE b.shop_id = $1 AND b.item_id = $2 AND b.qty <> 0 ORDER BY b.expiry_date NULLS LAST', [c.shopId, it.id]);
    return {
      movements: rows.map((r) => ({ id: r.id, at: r.at, branch: r.branch_name, qty: Number(r.qty_change), reason: r.reason, batchNo: r.batch_no, note: r.note, user: r.user_name ?? 'System', refType: r.ref_type, refId: r.ref_id })),
      batches: batches.map((b) => ({ id: b.id, branch: b.branch_name, batchNo: b.batch_no, expiryDate: b.expiry_date, qty: Number(b.qty) })),
    };
  }),
);

/** Low-stock (≤ reorder level, any branch total) and batches expiring within N days. */
catalogRouter.get(
  '/stock/alerts',
  T(async (db, req, c) => {
    const days = Math.min(365, Math.max(1, Number(req.query.days ?? 30)));
    const low = await many(
      db,
      `SELECT i.id, i.name, i.unit, i.reorder_level, coalesce(sum(s.qty),0) AS stock FROM items i LEFT JOIN item_stock s ON s.item_id = i.id
        WHERE i.shop_id = $1 AND i.type = 'Goods' AND NOT i.archived GROUP BY i.id HAVING coalesce(sum(s.qty),0) <= i.reorder_level ORDER BY stock`,
      [c.shopId],
    );
    const expiring = await many(
      db,
      `SELECT b.batch_no, b.expiry_date, b.qty, i.name, i.id AS item_id, br.name AS branch FROM item_batches b JOIN items i ON i.id = b.item_id JOIN branches br ON br.id = b.branch_id
        WHERE b.shop_id = $1 AND b.qty > 0 AND b.expiry_date IS NOT NULL AND b.expiry_date <= current_date + $2::int ORDER BY b.expiry_date`,
      [c.shopId, days],
    );
    return {
      lowStock: low.map((r) => ({ itemId: r.id, name: r.name, unit: r.unit, stock: Number(r.stock), reorderLevel: Number(r.reorder_level) })),
      expiring: expiring.map((r) => ({ itemId: r.item_id, name: r.name, batchNo: r.batch_no, expiryDate: r.expiry_date, qty: Number(r.qty), branch: r.branch })),
    };
  }),
);

/* ---------------- CSV import / export ---------------- */
const ITEM_COLS = [
  { key: 'type', label: 'Type' }, { key: 'name', label: 'Name' }, { key: 'sku', label: 'SKU' }, { key: 'barcode', label: 'Barcode' },
  { key: 'unit', label: 'Unit' }, { key: 'hsn', label: 'HSN' }, { key: 'cost', label: 'Cost' }, { key: 'sp1', label: 'SP1' },
  { key: 'sp2', label: 'SP2' }, { key: 'sp3', label: 'SP3' }, { key: 'taxRate', label: 'Tax Rate' }, { key: 'stock', label: 'Stock' },
  { key: 'reorderLevel', label: 'Reorder Level' },
];

catalogRouter.get(
  '/items/export.csv',
  T(async (db, _req, c, res) => {
    const items = await listItems(db, c.shopId, allowed(c, 'items.cost'));
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="items.csv"');
    res.send('﻿' + toCsv(items as any, ITEM_COLS));
  }),
);

/** Imports items from CSV text. Upserts by SKU (or barcode) — returns per-row errors without aborting good rows. */
catalogRouter.post(
  '/items/import',
  perm('items.write'),
  T(async (db, req, c) => {
    const { csv } = parse(z.object({ csv: z.string().min(1).max(2_000_000) }), req.body);
    const rows = parseCsv(csv);
    if (!rows.length) throw badRequest('The file has no data rows');
    if (rows.length > 5000) throw badRequest('Import up to 5,000 rows at a time');
    const slabs = await many(db, 'SELECT id, rate FROM tax_slabs WHERE active');
    const branchId = await primaryBranchId(db, c.shopId);
    const errors: Array<{ row: number; error: string }> = [];
    let created = 0;
    let updated = 0;
    for (const [i, r] of rows.entries()) {
      const rowNo = i + 2;
      const slab = slabs.find((s) => Number(s.rate) === Number(r.tax_rate ?? r.tax ?? 18));
      const parsed = itemBody.safeParse({
        type: /serv/i.test(r.type ?? '') ? 'Services' : 'Goods',
        name: r.name, sku: r.sku ?? '', barcode: r.barcode ?? '', unit: r.unit || 'pcs', hsn: r.hsn ?? '',
        cost: Number(r.cost || 0), sp1: Number(r.sp1), sp2: Number(r.sp2 || r.sp1), sp3: Number(r.sp3 || r.sp1),
        taxSlabId: slab?.id ?? '', reorderLevel: Number(r.reorder_level || 10),
      });
      if (!parsed.success) { errors.push({ row: rowNo, error: parsed.error.issues[0]!.message }); continue; }
      if (!slab) { errors.push({ row: rowNo, error: `No active tax slab for rate ${r.tax_rate}` }); continue; }
      const b = parsed.data;
      await db.query('SAVEPOINT row');
      try {
        const existing = b.sku
          ? await one(db, 'SELECT id FROM items WHERE shop_id = $1 AND lower(sku) = lower($2) AND NOT archived', [c.shopId, b.sku])
          : b.barcode ? await one(db, 'SELECT id FROM items WHERE shop_id = $1 AND barcode = $2 AND NOT archived', [c.shopId, b.barcode]) : null;
        if (existing) {
          await db.query('UPDATE items SET type=$3,name=$4,barcode=$5,unit=$6,hsn=$7,cost=$8,sp1=$9,sp2=$10,sp3=$11,tax_slab_id=$12,reorder_level=$13 WHERE shop_id=$1 AND id=$2', [
            c.shopId, existing.id, b.type, b.name, b.barcode, b.unit, b.hsn, b.cost, b.sp1, b.sp2, b.sp3, b.taxSlabId, b.reorderLevel,
          ]);
          updated++;
        } else {
          const it = await one(db, 'INSERT INTO items (shop_id,type,name,sku,barcode,unit,hsn,cost,sp1,sp2,sp3,tax_slab_id,reorder_level) VALUES ($1,$2,$3,upper($4),$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id', [
            c.shopId, b.type, b.name, b.sku, b.barcode, b.unit, b.hsn, b.cost, b.sp1, b.sp2, b.sp3, b.taxSlabId, b.reorderLevel,
          ]);
          const stock = Number(r.stock || r.opening_stock || 0);
          if (b.type === 'Goods' && stock > 0) await moveStock(db, { shopId: c.shopId, itemId: it.id, branchId, qty: stock, reason: 'opening', userId: c.id, note: 'CSV import' });
          created++;
        }
        await db.query('RELEASE SAVEPOINT row');
      } catch (e) {
        await db.query('ROLLBACK TO SAVEPOINT row');
        errors.push({ row: rowNo, error: (e as { code?: string }).code === '23505' ? 'Duplicate barcode or SKU' : 'Could not save row' });
      }
    }
    await audit(db, req, c.shopId, 'import', 'item', '', { created, updated, errors: errors.length });
    return { created, updated, errors };
  }),
);

