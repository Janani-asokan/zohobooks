import crypto from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { perm } from '../../auth';
import { audit } from '../../audit';
import { many, one, type Db } from '../../db';
import { badRequest, conflict, notFound, parse } from '../../http';
import { nextSeq, primaryBranchId, requireRow } from '../../services/common';
import { moveStock } from '../../services/stock';
import { lineAmount, r2 } from '../../../../shared/calc';
import { T } from './ctx';

export const purchasingRouter = Router();
const iso = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const purchaseLineInput = z.object({
  itemId: z.string().uuid('Select an item'),
  qty: z.number().positive('Quantity must be greater than 0'),
  rate: z.number().min(0).optional(), // omitted → item cost
  taxRate: z.number().min(0).max(100).optional(), // omitted → item's slab
});

export interface PurchaseLine {
  id: string; itemId: string; name: string; type: 'Goods' | 'Services'; unit: string; hsn: string;
  qty: number; rate: number; taxRate: number; amount: number; received: number;
}

/** Resolves item names/units/tax and the default purchase rate (item cost) on the server. */
export async function buildPurchaseLines(db: Db, shopId: string, input: z.infer<typeof purchaseLineInput>[]): Promise<PurchaseLine[]> {
  if (!input.length) throw badRequest('Add at least one item');
  const items = await many(db, 'SELECT i.*, t.rate AS tax_rate FROM items i JOIN tax_slabs t ON t.id = i.tax_slab_id WHERE i.shop_id = $1 AND i.id = ANY($2::uuid[])', [shopId, [...new Set(input.map((l) => l.itemId))]]);
  const byId = new Map(items.map((i) => [i.id, i]));
  return input.map((l) => {
    const it = byId.get(l.itemId);
    if (!it) throw badRequest('One of the selected items no longer exists');
    const rate = r2(l.rate ?? Number(it.cost));
    return { id: crypto.randomUUID(), itemId: it.id, name: it.name, type: it.type, unit: it.unit, hsn: it.hsn, qty: l.qty, rate, taxRate: l.taxRate ?? Number(it.tax_rate), amount: lineAmount({ qty: l.qty, rate, taxRate: 0 }), received: 0 };
  });
}

export const purchaseTotals = (lines: PurchaseLine[]) => {
  const sub = r2(lines.reduce((s, l) => s + l.amount, 0));
  const tax = r2(lines.reduce((s, l) => s + (l.amount * l.taxRate) / 100, 0));
  return { sub, tax, total: r2(sub + tax) };
};

const serializePO = (r: any) => ({
  id: r.id, number: r.number, vendorId: r.vendor_id, vendorName: r.vendor_name, branchId: r.branch_id, date: r.date, expectedDate: r.expected_date,
  lines: r.lines, status: r.status, subTotal: Number(r.sub_total), taxTotal: Number(r.tax_total), total: Number(r.total), notes: r.notes,
  billId: r.bill_id ?? null, createdAt: r.created_at,
});

const PO_SQL = `SELECT po.*, v.name AS vendor_name, (SELECT b.id FROM bills b WHERE b.purchase_order_id = po.id LIMIT 1) AS bill_id
                  FROM purchase_orders po JOIN vendors v ON v.id = po.vendor_id`;

const poBody = z.object({
  vendorId: z.string().uuid('Select a vendor'),
  branchId: z.string().uuid().nullable().optional(),
  date: iso,
  expectedDate: iso.nullable().optional(),
  lines: z.array(purchaseLineInput).min(1, 'Add at least one item'),
  notes: z.string().max(1000).default(''),
  issue: z.boolean().default(true),
});

purchasingRouter.get('/purchase-orders', perm('purchases.read'), T(async (db, _req, c) => (await many(db, `${PO_SQL} WHERE po.shop_id = $1 ORDER BY po.created_at DESC`, [c.shopId])).map(serializePO)));

purchasingRouter.post(
  '/purchase-orders',
  perm('purchases.write'),
  T(async (db, req, c) => {
    const b = parse(poBody, req.body);
    await requireRow(db, 'vendors', c.shopId, b.vendorId, 'Vendor');
    const lines = await buildPurchaseLines(db, c.shopId, b.lines);
    const t = purchaseTotals(lines);
    const branchId = await primaryBranchId(db, c.shopId, b.branchId);
    const n = await nextSeq(db, c.shopId, 'po');
    const row = await one(
      db,
      `INSERT INTO purchase_orders (shop_id, number, vendor_id, branch_id, date, expected_date, lines, status, sub_total, tax_total, total, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id`,
      [c.shopId, `PO-${String(n).padStart(4, '0')}`, b.vendorId, branchId, b.date, b.expectedDate ?? null, JSON.stringify(lines), b.issue ? 'Issued' : 'Draft', t.sub, t.tax, t.total, b.notes, c.id],
    );
    await audit(db, req, c.shopId, 'create', 'purchase_order', row.id, { total: t.total });
    return serializePO(await one(db, `${PO_SQL} WHERE po.shop_id = $1 AND po.id = $2`, [c.shopId, row.id]));
  }),
);

purchasingRouter.put(
  '/purchase-orders/:id',
  perm('purchases.write'),
  T(async (db, req, c) => {
    const cur = await requireRow(db, 'purchase_orders', c.shopId, req.params.id!, 'Purchase order');
    if (!['Draft', 'Issued'].includes(cur.status) || (cur.lines as PurchaseLine[]).some((l) => l.received > 0)) throw conflict('Received purchase orders can’t be edited');
    const b = parse(poBody, req.body);
    const lines = await buildPurchaseLines(db, c.shopId, b.lines);
    const t = purchaseTotals(lines);
    await db.query(
      'UPDATE purchase_orders SET vendor_id=$3, branch_id=$4, date=$5, expected_date=$6, lines=$7, status=$8, sub_total=$9, tax_total=$10, total=$11, notes=$12 WHERE shop_id=$1 AND id=$2',
      [c.shopId, cur.id, b.vendorId, await primaryBranchId(db, c.shopId, b.branchId), b.date, b.expectedDate ?? null, JSON.stringify(lines), b.issue ? 'Issued' : 'Draft', t.sub, t.tax, t.total, b.notes],
    );
    await audit(db, req, c.shopId, 'update', 'purchase_order', cur.id);
    return serializePO(await one(db, `${PO_SQL} WHERE po.shop_id = $1 AND po.id = $2`, [c.shopId, cur.id]));
  }),
);

/** Receive goods (fully or partly) — adds stock at the PO's branch. */
purchasingRouter.post(
  '/purchase-orders/:id/receive',
  perm('purchases.write'),
  T(async (db, req, c) => {
    const b = parse(z.object({ lines: z.array(z.object({ lineId: z.string(), qty: z.number().min(0), batchNo: z.string().max(60).optional(), expiryDate: iso.optional() })).min(1), updateCost: z.boolean().default(true) }), req.body);
    const po = await one(db, 'SELECT * FROM purchase_orders WHERE shop_id = $1 AND id = $2 FOR UPDATE', [c.shopId, req.params.id]);
    if (!po) throw notFound('Purchase order');
    if (po.status === 'Cancelled' || po.status === 'Draft') throw conflict(po.status === 'Draft' ? 'Issue the purchase order before receiving goods' : 'This purchase order is cancelled');
    const lines = po.lines as PurchaseLine[];
    let any = false;
    for (const r of b.lines) {
      if (!r.qty) continue;
      const l = lines.find((x) => x.id === r.lineId);
      if (!l) throw badRequest('Line not found');
      const left = r2(l.qty - l.received);
      if (r.qty > left + 1e-9) throw badRequest(`Only ${left} ${l.unit} of “${l.name}” are still to be received`);
      if (l.type === 'Goods') await moveStock(db, { shopId: c.shopId, itemId: l.itemId, branchId: po.branch_id, qty: r.qty, reason: 'purchase', refType: 'purchase_order', refId: po.id, userId: c.id, batchNo: r.batchNo, expiryDate: r.expiryDate ?? null, note: po.number });
      if (b.updateCost) await db.query('UPDATE items SET cost = $3 WHERE shop_id = $1 AND id = $2', [c.shopId, l.itemId, l.rate]);
      l.received = r2(l.received + r.qty);
      any = true;
    }
    if (!any) throw badRequest('Enter a quantity to receive');
    const status = lines.every((l) => l.received >= l.qty) ? 'Received' : 'Partially Received';
    await db.query('UPDATE purchase_orders SET lines = $3, status = $4 WHERE shop_id = $1 AND id = $2', [c.shopId, po.id, JSON.stringify(lines), status]);
    await audit(db, req, c.shopId, 'receive', 'purchase_order', po.id, { status });
    return serializePO(await one(db, `${PO_SQL} WHERE po.shop_id = $1 AND po.id = $2`, [c.shopId, po.id]));
  }),
);

/** Convert to a vendor bill (payable + input tax credit). Stock was already added by receiving. */
purchasingRouter.post(
  '/purchase-orders/:id/bill',
  perm('purchases.write'),
  T(async (db, req, c) => {
    const b = parse(z.object({ vendorBillNo: z.string().max(60).default(''), date: iso, dueDate: iso }), req.body);
    const po = await one(db, 'SELECT * FROM purchase_orders WHERE shop_id = $1 AND id = $2 FOR UPDATE', [c.shopId, req.params.id]);
    if (!po) throw notFound('Purchase order');
    if (po.status === 'Draft' || po.status === 'Cancelled') throw conflict('Issue the purchase order first');
    if (await one(db, 'SELECT 1 FROM bills WHERE shop_id = $1 AND purchase_order_id = $2', [c.shopId, po.id])) throw conflict('A bill already exists for this purchase order');
    const n = await nextSeq(db, c.shopId, 'bill');
    const bill = await one(
      db,
      `INSERT INTO bills (shop_id, number, vendor_id, vendor_bill_no, date, due_date, taxable_amount, tax_amount, amount, status, description, lines, branch_id, purchase_order_id, stock_added)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'Open',$10,$11,$12,$13,true) RETURNING id, number`,
      [c.shopId, `BILL-${String(n).padStart(4, '0')}`, po.vendor_id, b.vendorBillNo, b.date, b.dueDate, po.sub_total, po.tax_total, po.total, `From ${po.number}`, JSON.stringify(po.lines), po.branch_id, po.id],
    );
    await audit(db, req, c.shopId, 'convert_to_bill', 'purchase_order', po.id, { bill: bill.number });
    return { billId: bill.id, number: bill.number };
  }),
);

purchasingRouter.post(
  '/purchase-orders/:id/cancel',
  perm('purchases.write'),
  T(async (db, req, c) => {
    const po = await requireRow(db, 'purchase_orders', c.shopId, req.params.id!, 'Purchase order');
    if ((po.lines as PurchaseLine[]).some((l) => l.received > 0)) throw conflict('Goods were already received on this order');
    await db.query("UPDATE purchase_orders SET status = 'Cancelled' WHERE shop_id = $1 AND id = $2", [c.shopId, po.id]);
    await audit(db, req, c.shopId, 'cancel', 'purchase_order', po.id);
    return serializePO(await one(db, `${PO_SQL} WHERE po.shop_id = $1 AND po.id = $2`, [c.shopId, po.id]));
  }),
);

/* ---------- Expenses ---------- */
export const EXPENSE_CATEGORIES = ['Rent', 'Salaries & Wages', 'Electricity', 'Internet & Phone', 'Fuel & Travel', 'Repairs & Maintenance', 'Office Supplies', 'Marketing', 'Bank Charges', 'Professional Fees', 'Food & Refreshments', 'Other'];
const serializeExpense = (e: any) => ({
  id: e.id, date: e.date, category: e.category, description: e.description, vendorId: e.vendor_id, vendorName: e.vendor_name ?? null,
  amount: Number(e.amount), taxAmount: Number(e.tax_amount), total: r2(Number(e.amount) + Number(e.tax_amount)), accountId: e.account_id, accountName: e.account_name ?? null, reference: e.reference,
});

purchasingRouter.get(
  '/expenses',
  perm('purchases.read'),
  T(async (db, _req, c) =>
    (await many(db, 'SELECT e.*, v.name AS vendor_name, a.name AS account_name FROM expenses e LEFT JOIN vendors v ON v.id = e.vendor_id LEFT JOIN bank_accounts a ON a.id = e.account_id WHERE e.shop_id = $1 ORDER BY e.date DESC, e.created_at DESC LIMIT 1000', [c.shopId])).map(serializeExpense),
  ),
);

purchasingRouter.post(
  '/expenses',
  perm('purchases.write'),
  T(async (db, req, c) => {
    const b = parse(
      z.object({ date: iso, category: z.string().trim().min(1, 'Pick a category').max(60), description: z.string().max(300).default(''), vendorId: z.string().uuid().nullable().optional(), amount: z.number().positive('Enter the amount'), taxAmount: z.number().min(0).default(0), accountId: z.string().uuid('Choose the account you paid from'), reference: z.string().max(80).default('') }),
      req.body,
    );
    await requireRow(db, 'bank_accounts', c.shopId, b.accountId, 'Account');
    if (b.vendorId) await requireRow(db, 'vendors', c.shopId, b.vendorId, 'Vendor');
    const e = await one(db, 'INSERT INTO expenses (shop_id, date, category, description, vendor_id, amount, tax_amount, account_id, reference, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *', [
      c.shopId, b.date, b.category, b.description, b.vendorId ?? null, b.amount, b.taxAmount, b.accountId, b.reference, c.id,
    ]);
    await db.query("INSERT INTO bank_transactions (shop_id, account_id, date, description, amount, category, ref_type, ref_id) VALUES ($1,$2,$3,$4,$5,$6,'expense',$7)", [
      c.shopId, b.accountId, b.date, b.description || b.category, -r2(b.amount + b.taxAmount), b.category, e.id,
    ]);
    await audit(db, req, c.shopId, 'create', 'expense', e.id, { amount: b.amount, category: b.category });
    return serializeExpense(e);
  }),
);

purchasingRouter.delete(
  '/expenses/:id',
  perm('purchases.write'),
  T(async (db, req, c) => {
    const e = await requireRow(db, 'expenses', c.shopId, req.params.id!, 'Expense');
    await db.query("DELETE FROM bank_transactions WHERE shop_id = $1 AND ref_type = 'expense' AND ref_id = $2", [c.shopId, e.id]);
    await db.query('DELETE FROM expenses WHERE shop_id = $1 AND id = $2', [c.shopId, e.id]);
    await audit(db, req, c.shopId, 'delete', 'expense', e.id);
  }),
);
