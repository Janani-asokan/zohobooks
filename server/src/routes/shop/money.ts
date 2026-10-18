import { Router } from 'express';
import { z } from 'zod';
import type { Request } from 'express';
import { perm, todayISO } from '../../auth';
import { audit } from '../../audit';
import { many, one, type Db } from '../../db';
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
    (await many(db, 'SELECT v.*, coalesce((SELECT sum(amount - amount_paid) FROM bills b WHERE b.vendor_id = v.id),0) AS payable FROM vendors v WHERE v.shop_id = $1 ORDER BY v.name', [c.shopId])).map(serializeVendor),
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
  taxableAmount: Number(b.taxable_amount), taxAmount: Number(b.tax_amount), amount: Number(b.amount), amountPaid: Number(b.amount_paid ?? 0),
  balance: Math.max(0, Math.round((Number(b.amount) - Number(b.amount_paid ?? 0)) * 100) / 100),
  status: b.status === 'Paid' ? 'Paid' : Number(b.amount_paid ?? 0) > 0 ? 'Partially Paid' : b.due_date < todayISO() ? 'Overdue' : 'Open', description: b.description,
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
/* ---------- Payments made (against bills, in part or in full) ---------- */
export const billPaymentInput = z.object({
  accountId: z.string().uuid('Choose the paying account'),
  date: iso,
  /** Omit to pay the whole balance. */
  amount: z.number().positive('Enter the amount paid').optional(),
  tdsAmount: z.number().min(0).default(0),
  mode: z.enum(['Bank Transfer', 'UPI', 'Cash', 'Cheque', 'Card']).default('Bank Transfer'),
  reference: z.string().trim().max(100).default(''),
  notes: z.string().max(500).default(''),
});

/** Records a payment, withdraws it from the account and marks the bill Paid once nothing is left. */
export async function payBill(db: Db, req: Request | null, shopId: string, billId: string, b: z.infer<typeof billPaymentInput>, userId: string | null) {
  const bill = await one(db, 'SELECT b.*, v.name AS vendor_name FROM bills b JOIN vendors v ON v.id = b.vendor_id WHERE b.shop_id = $1 AND b.id = $2 FOR UPDATE OF b', [shopId, billId]);
  if (!bill) throw notFound('Bill');
  const balance = r2(Number(bill.amount) - Number(bill.amount_paid));
  if (balance <= 0) throw conflict('This bill is already paid');
  const amount = r2(b.amount ?? balance - b.tdsAmount);
  const settles = r2(amount + b.tdsAmount);
  if (settles > balance + 0.005) throw badRequest(`That is more than the ₹${balance.toFixed(2)} still due`, { amount: 'More than the balance due' });
  await requireRow(db, 'bank_accounts', shopId, b.accountId, 'Account');
  const number = `PM-${String(await nextSeq(db, shopId, 'pm')).padStart(4, '0')}`;
  const p = await one(
    db,
    `INSERT INTO bill_payments (shop_id, number, bill_id, vendor_id, date, amount, tds_amount, mode, reference, account_id, notes, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
    [shopId, number, bill.id, bill.vendor_id, b.date, amount, b.tdsAmount, b.mode, b.reference, b.accountId, b.notes, userId],
  );
  const paid = r2(Number(bill.amount_paid) + settles);
  await db.query('UPDATE bills SET amount_paid = $3, status = $4 WHERE shop_id = $1 AND id = $2', [shopId, bill.id, paid, paid >= Number(bill.amount) - 0.005 ? 'Paid' : 'Open']);
  await db.query("INSERT INTO bank_transactions (shop_id, account_id, date, description, amount, category, ref_type, ref_id) VALUES ($1,$2,$3,$4,$5,'Vendor Payment','bill_payment',$6)", [
    shopId, b.accountId, b.date, `${number} · ${bill.number} · ${bill.vendor_name}`, -amount, p.id,
  ]);
  await audit(db, req, shopId, 'pay', 'bill', bill.id, { payment: number, amount, tds: b.tdsAmount });
  return p;
}
const r2 = (n: number) => Math.round(n * 100) / 100;

moneyRouter.post(
  '/bills/:id/pay',
  perm('purchases.write'),
  T(async (db, req, c) => {
    await payBill(db, req, c.shopId, req.params.id!, parse(billPaymentInput, req.body), c.id);
    return serializeBill(await one(db, 'SELECT b.*, v.name AS vendor_name FROM bills b JOIN vendors v ON v.id = b.vendor_id WHERE b.shop_id = $1 AND b.id = $2', [c.shopId, req.params.id]));
  }),
);

const serializeBillPayment = (p: any) => ({
  id: p.id, number: p.number, billId: p.bill_id, billNumber: p.bill_number, vendorBillNo: p.vendor_bill_no ?? '', vendorId: p.vendor_id, vendorName: p.vendor_name,
  date: p.date, amount: Number(p.amount), tdsAmount: Number(p.tds_amount), mode: p.mode, reference: p.reference, accountId: p.account_id, accountName: p.account_name ?? null, notes: p.notes,
});
moneyRouter.get(
  '/bill-payments',
  perm('purchases.read'),
  T(async (db, _req, c) =>
    (await many(
      db,
      `SELECT p.*, b.number AS bill_number, b.vendor_bill_no, v.name AS vendor_name, a.name AS account_name
       FROM bill_payments p JOIN bills b ON b.id = p.bill_id JOIN vendors v ON v.id = p.vendor_id LEFT JOIN bank_accounts a ON a.id = p.account_id
       WHERE p.shop_id = $1 ORDER BY p.date DESC, p.created_at DESC`,
      [c.shopId],
    )).map(serializeBillPayment),
  ),
);
/** Undo a payment: the bill reopens and the bank withdrawal is removed. */
moneyRouter.delete(
  '/bill-payments/:id',
  perm('purchases.write'),
  T(async (db, req, c) => {
    const p = await one(db, 'SELECT * FROM bill_payments WHERE shop_id = $1 AND id = $2 FOR UPDATE', [c.shopId, req.params.id]);
    if (!p) throw notFound('Payment');
    await db.query("DELETE FROM bank_transactions WHERE shop_id = $1 AND ref_type = 'bill_payment' AND ref_id = $2", [c.shopId, p.id]);
    await db.query('DELETE FROM bill_payments WHERE shop_id = $1 AND id = $2', [c.shopId, p.id]);
    await db.query("UPDATE bills SET amount_paid = GREATEST(amount_paid - $3, 0), status = 'Open' WHERE shop_id = $1 AND id = $2", [c.shopId, p.bill_id, r2(Number(p.amount) + Number(p.tds_amount))]);
    await audit(db, req, c.shopId, 'delete_payment', 'bill', p.bill_id, { payment: p.number, amount: Number(p.amount) });
  }),
);

/* ---------- Vendor statement and payables ageing ---------- */
moneyRouter.get(
  '/vendors/:id/statement',
  perm('purchases.read'),
  T(async (db, req, c) => {
    const v = await requireRow(db, 'vendors', c.shopId, req.params.id!, 'Vendor');
    const to = iso.safeParse(req.query.to).success ? String(req.query.to) : todayISO();
    const from = iso.safeParse(req.query.from).success ? String(req.query.from) : fyStartOf(to);
    const args = [c.shopId, v.id];
    const opening = await one(
      db,
      `SELECT coalesce((SELECT sum(amount) FROM bills WHERE shop_id = $1 AND vendor_id = $2 AND date < $3), 0)
            - coalesce((SELECT sum(amount + tds_amount) FROM bill_payments WHERE shop_id = $1 AND vendor_id = $2 AND date < $3), 0) AS bal`,
      [...args, from],
    );
    const rows = await many(
      db,
      `SELECT * FROM (
         SELECT date, created_at AS at, 'bill' AS type, id AS ref_id, number || CASE WHEN vendor_bill_no <> '' THEN ' (' || vendor_bill_no || ')' ELSE '' END AS ref, 'Bill' AS label, amount AS credit, 0 AS debit
           FROM bills WHERE shop_id = $1 AND vendor_id = $2 AND date BETWEEN $3 AND $4
         UNION ALL
         SELECT p.date, p.created_at, 'payment', p.bill_id, p.number, 'Payment · ' || p.mode || ' · ' || b.number || CASE WHEN p.tds_amount > 0 THEN ' (incl. TDS)' ELSE '' END, 0, p.amount + p.tds_amount
           FROM bill_payments p JOIN bills b ON b.id = p.bill_id WHERE p.shop_id = $1 AND p.vendor_id = $2 AND p.date BETWEEN $3 AND $4
       ) t ORDER BY date, at`,
      [...args, from, to],
    );
    let bal = Number(opening.bal);
    const openingBalance = r2(bal);
    const entries = rows.map((r) => {
      bal = r2(bal + Number(r.credit) - Number(r.debit));
      return { date: r.date, type: r.type, refId: r.ref_id, ref: r.ref, label: r.label, debit: Number(r.debit), credit: Number(r.credit), balance: bal };
    });
    const open = await many(db, 'SELECT due_date, amount - amount_paid AS bal FROM bills WHERE shop_id = $1 AND vendor_id = $2 AND amount - amount_paid > 0.005', args);
    return {
      vendor: { id: v.id, name: v.name, gstin: v.gstin, state: v.state, phone: v.phone, email: v.email },
      from, to, openingBalance, entries, closingBalance: r2(bal),
      totals: { debit: r2(entries.reduce((s, e) => s + e.debit, 0)), credit: r2(entries.reduce((s, e) => s + e.credit, 0)) },
      ageing: ageingOf(open),
    };
  }),
);

/** Buckets of what is still owed, by days past the due date. */
export function ageingOf(rows: Array<{ due_date: string; bal: unknown }>, today = todayISO()) {
  const out = { current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90_plus: 0 };
  const now = Date.parse(today);
  for (const r of rows) {
    const days = Math.floor((now - Date.parse(r.due_date)) / 86_400_000);
    const k = days <= 0 ? 'current' : days <= 30 ? 'd1_30' : days <= 60 ? 'd31_60' : days <= 90 ? 'd61_90' : 'd90_plus';
    out[k] = r2(out[k] + Number(r.bal));
  }
  return out;
}
const fyStartOf = (d: string) => `${Number(d.slice(0, 4)) - (d.slice(5, 7) < '04' ? 1 : 0)}-04-01`;

moneyRouter.get(
  '/payables-ageing',
  perm('purchases.read'),
  T(async (db, _req, c) => {
    const rows = await many(
      db,
      `SELECT v.id AS vendor_id, v.name, b.due_date, b.amount - b.amount_paid AS bal
       FROM bills b JOIN vendors v ON v.id = b.vendor_id WHERE b.shop_id = $1 AND b.amount - b.amount_paid > 0.005 ORDER BY v.name`,
      [c.shopId],
    );
    const byVendor = new Map<string, { vendorId: string; name: string; rows: typeof rows }>();
    for (const r of rows) {
      const e = byVendor.get(r.vendor_id) ?? { vendorId: r.vendor_id, name: r.name, rows: [] as typeof rows };
      e.rows.push(r);
      byVendor.set(r.vendor_id, e);
    }
    const vendors = [...byVendor.values()].map((v) => { const a = ageingOf(v.rows); return { vendorId: v.vendorId, name: v.name, ...a, total: r2(Object.values(a).reduce((s, n) => s + n, 0)) }; });
    const total = ageingOf(rows);
    return { asOf: todayISO(), vendors, totals: { ...total, total: r2(Object.values(total).reduce((s, n) => s + n, 0)) } };
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
