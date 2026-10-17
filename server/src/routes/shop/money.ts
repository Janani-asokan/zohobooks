import { Router } from 'express';
import { z } from 'zod';
import { perm } from '../../auth';
import { audit } from '../../audit';
import { many, one } from '../../db';
import { badRequest, conflict, notFound, parse } from '../../http';
import { nextSeq, primaryBranchId, requireRow } from '../../services/common';
import { moveStock } from '../../services/stock';
import { buildPurchaseLines, purchaseLineInput, purchaseTotals } from './purchasing';
import { GSTIN_RE } from '../../../../shared/gst';
import { T } from './ctx';

export const moneyRouter = Router();
const iso = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/* ---------- Vendors ---------- */
const vendorBody = z.object({
  name: z.string().trim().min(1, 'Vendor name is required').max(150),
  gstin: z.string().trim().toUpperCase().refine((v) => !v || GSTIN_RE.test(v), 'Invalid GSTIN').default(''),
  phone: z.string().trim().max(30).default(''),
  email: z.string().trim().max(120).default(''),
  state: z.string().trim().max(60).default(''),
});
const serializeVendor = (v: any) => ({ id: v.id, name: v.name, gstin: v.gstin, phone: v.phone, email: v.email, state: v.state, payable: Number(v.payable ?? 0) });

moneyRouter.get(
  '/vendors',
  perm('purchases.read'),
  T(async (db, _req, c) =>
    (await many(db, "SELECT v.*, coalesce((SELECT sum(amount) FROM bills b WHERE b.vendor_id = v.id AND b.status = 'Open'),0) AS payable FROM vendors v WHERE v.shop_id = $1 ORDER BY v.name", [c.shopId])).map(serializeVendor),
  ),
);
moneyRouter.post(
  '/vendors',
  perm('purchases.write'),
  T(async (db, req, c) => {
    const b = parse(vendorBody, req.body);
    const v = await one(db, 'INSERT INTO vendors (shop_id, name, gstin, phone, email, state) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *', [c.shopId, b.name, b.gstin, b.phone, b.email, b.state]);
    await audit(db, req, c.shopId, 'create', 'vendor', v.id, { name: b.name });
    return serializeVendor(v);
  }),
);

/* ---------- Bills (purchases, for payables + input tax credit) ---------- */
const serializeBill = (b: any) => ({
  id: b.id, number: b.number, vendorId: b.vendor_id, vendorName: b.vendor_name, vendorBillNo: b.vendor_bill_no, date: b.date, dueDate: b.due_date,
  taxableAmount: Number(b.taxable_amount), taxAmount: Number(b.tax_amount), amount: Number(b.amount), status: b.status, description: b.description,
  lines: b.lines ?? [], purchaseOrderId: b.purchase_order_id ?? null, stockAdded: !!b.stock_added,
});
moneyRouter.get(
  '/bills',
  perm('purchases.read'),
  T(async (db, _req, c) => (await many(db, 'SELECT b.*, v.name AS vendor_name FROM bills b JOIN vendors v ON v.id = b.vendor_id WHERE b.shop_id = $1 ORDER BY b.date DESC, b.created_at DESC', [c.shopId])).map(serializeBill)),
);
moneyRouter.post(
  '/bills',
  perm('purchases.write'),
  T(async (db, req, c) => {
    const b = parse(
      z.object({
        vendorId: z.string().uuid('Select a vendor'), vendorBillNo: z.string().max(60).default(''), date: iso, dueDate: iso,
        // Either itemised lines (adds stock) or a lump-sum amount (services, utilities…)
        lines: z.array(purchaseLineInput).default([]),
        addStock: z.boolean().default(true),
        branchId: z.string().uuid().nullable().optional(),
        taxableAmount: z.number().min(0).default(0), taxAmount: z.number().min(0).default(0), description: z.string().max(500).default(''),
      }),
      req.body,
    );
    await requireRow(db, 'vendors', c.shopId, b.vendorId, 'Vendor');
    if (b.dueDate < b.date) throw badRequest('Due date can’t be before bill date', { dueDate: 'Due date can’t be before bill date' });
    const lines = b.lines.length ? await buildPurchaseLines(db, c.shopId, b.lines) : [];
    const t = lines.length ? purchaseTotals(lines) : { sub: b.taxableAmount, tax: b.taxAmount, total: b.taxableAmount + b.taxAmount };
    if (!(t.sub > 0)) throw badRequest('Enter the bill amount or add items', { taxableAmount: 'Enter the bill amount' });
    const branchId = await primaryBranchId(db, c.shopId, b.branchId);
    const n = await nextSeq(db, c.shopId, 'bill');
    const number = `BILL-${String(n).padStart(4, '0')}`;
    const stock = lines.length > 0 && b.addStock;
    const row = await one(
      db,
      `INSERT INTO bills (shop_id, number, vendor_id, vendor_bill_no, date, due_date, taxable_amount, tax_amount, amount, status, description, lines, branch_id, stock_added)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'Open',$10,$11,$12,$13) RETURNING *`,
      [c.shopId, number, b.vendorId, b.vendorBillNo, b.date, b.dueDate, t.sub, t.tax, t.total, b.description || (lines.length ? lines.map((l) => l.name).slice(0, 3).join(', ') : ''), JSON.stringify(lines.map((l) => ({ ...l, received: stock ? l.qty : 0 }))), branchId, stock],
    );
    if (stock)
      for (const l of lines) {
        if (l.type === 'Goods') await moveStock(db, { shopId: c.shopId, itemId: l.itemId, branchId, qty: l.qty, reason: 'purchase', refType: 'bill', refId: row.id, userId: c.id, note: number });
        await db.query('UPDATE items SET cost = $3 WHERE shop_id = $1 AND id = $2', [c.shopId, l.itemId, l.rate]);
      }
    await audit(db, req, c.shopId, 'create', 'bill', row.id, { number, amount: Number(row.amount), stock });
    const v = await one(db, 'SELECT name FROM vendors WHERE id = $1', [b.vendorId]);
    return serializeBill({ ...row, vendor_name: v.name });
  }),
);
/** Paying a bill posts a withdrawal to the chosen account. */
moneyRouter.post(
  '/bills/:id/pay',
  perm('purchases.write'),
  T(async (db, req, c) => {
    const b = parse(z.object({ accountId: z.string().uuid('Choose the paying account'), date: iso }), req.body);
    const bill = await one(db, 'SELECT b.*, v.name AS vendor_name FROM bills b JOIN vendors v ON v.id = b.vendor_id WHERE b.shop_id = $1 AND b.id = $2 FOR UPDATE', [c.shopId, req.params.id]);
    if (!bill) throw notFound('Bill');
    if (bill.status === 'Paid') throw conflict('This bill is already paid');
    await requireRow(db, 'bank_accounts', c.shopId, b.accountId, 'Account');
    await db.query("UPDATE bills SET status = 'Paid' WHERE shop_id = $1 AND id = $2", [c.shopId, bill.id]);
    await db.query("INSERT INTO bank_transactions (shop_id, account_id, date, description, amount, category, ref_type, ref_id) VALUES ($1,$2,$3,$4,$5,'Vendor Payment','bill',$6)", [
      c.shopId, b.accountId, b.date, `${bill.number} · ${bill.vendor_name}`, -Number(bill.amount), bill.id,
    ]);
    await audit(db, req, c.shopId, 'pay', 'bill', bill.id, { amount: Number(bill.amount) });
    return serializeBill({ ...bill, status: 'Paid' });
  }),
);

/* ---------- Banking ---------- */
const serializeAccount = (a: any) => ({ id: a.id, name: a.name, bank: a.bank, accountNo: a.account_no, type: a.type, openingBalance: Number(a.opening_balance), balance: Number(a.balance ?? a.opening_balance) });

moneyRouter.get(
  '/bank-accounts',
  T(async (db, _req, c) =>
    (await many(db, 'SELECT a.*, a.opening_balance + coalesce((SELECT sum(amount) FROM bank_transactions t WHERE t.account_id = a.id),0) AS balance FROM bank_accounts a WHERE a.shop_id = $1 ORDER BY a.created_at', [c.shopId])).map(serializeAccount),
  ),
);
moneyRouter.post(
  '/bank-accounts',
  perm('banking.write'),
  T(async (db, req, c) => {
    const b = parse(z.object({ name: z.string().trim().min(1, 'Account name is required').max(100), bank: z.string().max(100).default(''), accountNo: z.string().max(40).default(''), type: z.enum(['Bank', 'Cash', 'Card']), openingBalance: z.number().default(0) }), req.body);
    const a = await one(db, 'INSERT INTO bank_accounts (shop_id, name, bank, account_no, type, opening_balance) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *', [c.shopId, b.name, b.bank, b.accountNo, b.type, b.openingBalance]);
    await audit(db, req, c.shopId, 'create', 'bank_account', a.id, { name: b.name });
    return serializeAccount(a);
  }),
);
moneyRouter.get(
  '/bank-transactions',
  perm('banking.read'),
  T(async (db, _req, c) =>
    (await many(db, 'SELECT * FROM bank_transactions WHERE shop_id = $1 ORDER BY date DESC, created_at DESC LIMIT 1000', [c.shopId])).map((t) => ({
      id: t.id, accountId: t.account_id, date: t.date, description: t.description, amount: Number(t.amount), category: t.category, refType: t.ref_type, refId: t.ref_id,
    })),
  ),
);
moneyRouter.post(
  '/bank-transactions',
  perm('banking.write'),
  T(async (db, req, c) => {
    const b = parse(z.object({ accountId: z.string().uuid('Select an account'), date: iso, description: z.string().trim().min(1, 'Description is required').max(200), amount: z.number().refine((v) => v !== 0, 'Enter an amount'), category: z.string().max(60).default('Other') }), req.body);
    await requireRow(db, 'bank_accounts', c.shopId, b.accountId, 'Account');
    const t = await one(db, 'INSERT INTO bank_transactions (shop_id, account_id, date, description, amount, category) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *', [c.shopId, b.accountId, b.date, b.description, b.amount, b.category]);
    await audit(db, req, c.shopId, 'create', 'bank_transaction', t.id, { amount: b.amount });
    return { id: t.id, accountId: t.account_id, date: t.date, description: t.description, amount: Number(t.amount), category: t.category, refType: '', refId: null };
  }),
);
