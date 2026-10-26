import { Router } from 'express';
import { z } from 'zod';
import { perm, todayISO, userCtx } from '../../auth';
import { audit } from '../../audit';
import { config } from '../../config';
import { many, one, withTenant, type Db } from '../../db';
import { badRequest, conflict, h, HttpError, notFound, parse } from '../../http';
import { sendMail } from '../../mailer';
import { invoicePrintBundle } from '../../services/printBundle';
import { invoicePdf, type PdfPaper } from '../../services/pdf';
import { getOrg, nextSeq, peekSeq, platformConfig, requireRow } from '../../services/common';
import {
  buildLines, cancelInvoice, createCreditNote, createInvoice, creditNoteInput, deletePayment, getInvoice, invoiceInput, lineInput,
  lockInvoice, paymentInput, recordPayment, serializeCreditNote, serializeInvoice, taxTreatment, updateInvoice,
} from '../../services/documents';
import { buildEInvoice, buildEwayBill } from '../../integrations/gstn';
import { computeTotals } from '../../../../shared/calc';
import { formatInvoiceNumber, fyLabel, invoiceCounterKey } from '../../../../shared/fy';
import { EMAIL_RE, GSTIN_RE, gstinMatchesState, isInterState } from '../../../../shared/gst';
import { parseCsv, toCsv } from '../../../../shared/csv';
import { T } from './ctx';

export const salesRouter = Router();

/* ======================= Customers ======================= */
const customerBody = z
  .object({
    type: z.enum(['Individual', 'Business']),
    name: z.string().trim().min(1, 'Name is required').max(150),
    companyName: z.string().trim().max(150).default(''),
    gstin: z.string().trim().toUpperCase().default(''),
    email: z.string().trim().default(''),
    phone: z.string().trim().refine((v) => v.replace(/\D/g, '').length >= 10, 'Enter a valid phone number'),
    state: z.string().trim().max(60).default(''),
    address: z.string().max(500).default(''),
    tier: z.enum(['SP1', 'SP2', 'SP3']).default('SP1'),
    /** 0 = no limit. Omit to keep the saved limit. */
    creditLimit: z.number().min(0).max(1e10).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.email && !EMAIL_RE.test(v.email)) ctx.addIssue({ code: 'custom', path: ['email'], message: 'Enter a valid email' });
    if (v.type === 'Business') {
      if (!v.companyName) ctx.addIssue({ code: 'custom', path: ['companyName'], message: 'Company name is required' });
      if (!v.gstin) ctx.addIssue({ code: 'custom', path: ['gstin'], message: 'GST number is required for business customers' });
      else if (!GSTIN_RE.test(v.gstin)) ctx.addIssue({ code: 'custom', path: ['gstin'], message: 'Invalid GSTIN (e.g. 33AABCA1234F1Z5)' });
      else if (v.state && !gstinMatchesState(v.gstin, v.state)) ctx.addIssue({ code: 'custom', path: ['gstin'], message: 'GSTIN state code doesn’t match the selected state' });
    }
  });

async function listCustomers(db: Db, shopId: string, id?: string) {
  const rows = await many(
    db,
    `SELECT c.*,
       coalesce((SELECT sum(total) FROM invoices i WHERE i.customer_id = c.id AND i.status = 'Issued'), 0) AS billed,
       coalesce((SELECT sum(GREATEST(total - amount_paid - amount_credited, 0)) FROM invoices i WHERE i.customer_id = c.id AND i.status = 'Issued'), 0) AS due,
       (SELECT count(*) FROM invoices i WHERE i.customer_id = c.id) AS invoice_count
     FROM customers c WHERE c.shop_id = $1 ${id ? 'AND c.id = $2' : ''} ORDER BY c.created_at DESC`,
    id ? [shopId, id] : [shopId],
  );
  return rows.map((c) => ({
    id: c.id, customId: c.custom_id, type: c.type, name: c.name, companyName: c.company_name, gstin: c.gstin, email: c.email, phone: c.phone,
    state: c.state, address: c.address, tier: c.tier, createdAt: c.created_at, billed: Number(c.billed), due: Math.max(0, Number(c.due)), invoiceCount: Number(c.invoice_count),
    creditLimit: Number(c.credit_limit ?? 0),
  }));
}

salesRouter.get('/customers', T(async (db, _req, c) => listCustomers(db, c.shopId)));
salesRouter.get(
  '/customers/next-id',
  T(async (db, _req, c) => {
    const cfg = await platformConfig(db);
    return { customId: `${cfg.prefix}-${await peekSeq(db, c.shopId, 'customer', 1000)}` };
  }),
);

export async function insertCustomer(db: Db, shopId: string, b: z.infer<typeof customerBody>, orgState: string) {
  const cfg = await platformConfig(db);
  const n = await nextSeq(db, shopId, 'customer', 1000);
  return one(
    db,
    `INSERT INTO customers (shop_id, custom_id, type, name, company_name, gstin, email, phone, state, address, tier, credit_limit)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id, custom_id`,
    [shopId, `${cfg.prefix}-${n}`, b.type, b.name, b.type === 'Business' ? b.companyName : '', b.type === 'Business' ? b.gstin : '', b.email, b.phone, b.state || orgState, b.address, b.tier, b.creditLimit ?? 0],
  );
}

salesRouter.post(
  '/customers',
  perm('customers.write'),
  T(async (db, req, c) => {
    const b = parse(customerBody, req.body);
    const org = await getOrg(db, c.shopId);
    const row = await insertCustomer(db, c.shopId, b, org.state);
    await audit(db, req, c.shopId, 'create', 'customer', row!.id, { customId: row!.custom_id });
    return (await listCustomers(db, c.shopId, row!.id))[0];
  }),
);

salesRouter.put(
  '/customers/:id',
  perm('customers.write'),
  T(async (db, req, c) => {
    const cur = await requireRow(db, 'customers', c.shopId, req.params.id!, 'Customer');
    const b = parse(customerBody, req.body);
    await db.query('UPDATE customers SET type=$3, name=$4, company_name=$5, gstin=$6, email=$7, phone=$8, state=$9, address=$10, tier=$11, credit_limit=coalesce($12, credit_limit) WHERE shop_id=$1 AND id=$2', [
      c.shopId, cur.id, b.type, b.name, b.type === 'Business' ? b.companyName : '', b.type === 'Business' ? b.gstin : '', b.email, b.phone, b.state, b.address, b.tier, b.creditLimit ?? null,
    ]);
    await audit(db, req, c.shopId, 'update', 'customer', cur.id);
    return (await listCustomers(db, c.shopId, cur.id))[0];
  }),
);

/* ---------- Statement of account & contact history ---------- */
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

salesRouter.get(
  '/customers/:id/statement',
  T(async (db, req, c) => {
    const cust = await requireRow(db, 'customers', c.shopId, req.params.id!, 'Customer');
    const to = isoDate.safeParse(req.query.to).success ? String(req.query.to) : todayISO();
    const from = isoDate.safeParse(req.query.from).success ? String(req.query.from) : `${to.slice(0, 4)}-${to.slice(5, 7) < '04' ? Number(to.slice(0, 4)) - 1 : to.slice(0, 4)}-04-01`;
    return customerStatement(db, c.shopId, cust, from, to);
  }),
);

export async function customerStatement(db: Db, shopId: string, cust: any, from: string, to: string) {
  const args = [shopId, cust.id];
  const opening = await one(
    db,
    `SELECT
       coalesce((SELECT sum(total) FROM invoices WHERE shop_id = $1 AND customer_id = $2 AND status = 'Issued' AND date < $3), 0)
     - coalesce((SELECT sum(p.amount + p.tds_amount) FROM payments p JOIN invoices i ON i.id = p.invoice_id WHERE p.shop_id = $1 AND i.customer_id = $2 AND p.date < $3), 0)
     - coalesce((SELECT sum(cn.total) FROM credit_notes cn JOIN invoices i ON i.id = cn.invoice_id WHERE cn.shop_id = $1 AND i.customer_id = $2 AND cn.date < $3), 0) AS bal`,
    [...args, from],
  );
  const rows = await many(
    db,
    `SELECT * FROM (
       SELECT date, created_at AS at, 'invoice' AS type, id AS ref_id, number AS ref, 'Invoice' AS label, total AS debit, 0 AS credit
         FROM invoices WHERE shop_id = $1 AND customer_id = $2 AND status = 'Issued' AND date BETWEEN $3 AND $4
       UNION ALL
       SELECT p.date, p.created_at, 'payment', p.invoice_id, i.number, 'Payment · ' || p.mode || CASE WHEN p.tds_amount > 0 THEN ' (incl. TDS)' ELSE '' END, 0, p.amount + p.tds_amount
         FROM payments p JOIN invoices i ON i.id = p.invoice_id WHERE p.shop_id = $1 AND i.customer_id = $2 AND p.date BETWEEN $3 AND $4
       UNION ALL
       SELECT cn.date, cn.created_at, 'credit_note', cn.invoice_id, cn.number, 'Credit note · ' || i.number, 0, cn.total
         FROM credit_notes cn JOIN invoices i ON i.id = cn.invoice_id WHERE cn.shop_id = $1 AND i.customer_id = $2 AND cn.date BETWEEN $3 AND $4
     ) t ORDER BY date, at`,
    [...args, from, to],
  );
  let bal = Number(opening.bal);
  const openingBalance = r2(bal);
  const entries = rows.map((r) => {
    bal = r2(bal + Number(r.debit) - Number(r.credit));
    return { date: r.date, type: r.type, refId: r.ref_id, ref: r.ref, label: r.label, debit: Number(r.debit), credit: Number(r.credit), balance: bal };
  });
  // Ageing of what is still open today, by days past due.
  const open = await many(db, `SELECT number, date, due_date, total - amount_paid - amount_credited AS bal FROM invoices WHERE shop_id = $1 AND customer_id = $2 AND status = 'Issued' AND total - amount_paid - amount_credited > 0.005`, args);
  const ageing = { current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90_plus: 0 };
  const now = Date.parse(todayISO());
  for (const i of open) {
    const days = Math.floor((now - Date.parse(i.due_date)) / 86_400_000);
    const k = days <= 0 ? 'current' : days <= 30 ? 'd1_30' : days <= 60 ? 'd31_60' : days <= 90 ? 'd61_90' : 'd90_plus';
    ageing[k] = r2(ageing[k] + Number(i.bal));
  }
  return {
    customer: { id: cust.id, name: cust.name, companyName: cust.company_name, gstin: cust.gstin, address: cust.address, state: cust.state, phone: cust.phone, email: cust.email, creditLimit: Number(cust.credit_limit ?? 0) },
    from, to, openingBalance, entries,
    totals: { debit: r2(entries.reduce((s, e) => s + e.debit, 0)), credit: r2(entries.reduce((s, e) => s + e.credit, 0)) },
    closingBalance: r2(bal), ageing,
  };
}
const r2 = (n: number) => Math.round(n * 100) / 100;

const activityKinds = ['note', 'call', 'email', 'meeting', 'whatsapp'] as const;
salesRouter.get(
  '/customers/:id/activity',
  T(async (db, req, c) => {
    const cust = await requireRow(db, 'customers', c.shopId, req.params.id!, 'Customer');
    const notes = await many(db, 'SELECT * FROM customer_activity WHERE shop_id = $1 AND customer_id = $2 ORDER BY created_at DESC LIMIT 200', [c.shopId, cust.id]);
    const events = await many(
      db,
      `SELECT * FROM (
         SELECT issued_at AS at, 'invoice' AS kind, id AS ref_id, 'Invoice ' || number || ' issued for ₹' || to_char(total, 'FM99999999990.00') AS body FROM invoices WHERE shop_id = $1 AND customer_id = $2 AND issued_at IS NOT NULL
         UNION ALL
         SELECT p.created_at, 'payment', p.invoice_id, 'Payment of ₹' || to_char(p.amount, 'FM99999999990.00') || ' received by ' || p.mode || ' against ' || i.number FROM payments p JOIN invoices i ON i.id = p.invoice_id WHERE p.shop_id = $1 AND i.customer_id = $2
         UNION ALL
         SELECT r.at, 'reminder', r.invoice_id, initcap(r.channel) || ' · ' || r.detail || ' (' || i.number || ')' FROM reminder_log r JOIN invoices i ON i.id = r.invoice_id WHERE r.shop_id = $1 AND i.customer_id = $2
       ) t ORDER BY at DESC LIMIT 200`,
      [c.shopId, cust.id],
    );
    return [
      ...notes.map((n) => ({ id: n.id, at: n.created_at, kind: n.kind, body: n.body, by: n.created_by_name, refId: null, manual: true })),
      ...events.map((e, i) => ({ id: `e${i}`, at: e.at, kind: e.kind, body: e.body, by: '', refId: e.ref_id, manual: false })),
    ].sort((a, b) => +new Date(b.at) - +new Date(a.at));
  }),
);
salesRouter.post(
  '/customers/:id/activity',
  perm('customers.write'),
  T(async (db, req, c) => {
    const cust = await requireRow(db, 'customers', c.shopId, req.params.id!, 'Customer');
    const b = parse(z.object({ kind: z.enum(activityKinds), body: z.string().trim().min(1, 'Write a note').max(2000) }), req.body);
    const row = await one(db, 'INSERT INTO customer_activity (shop_id, customer_id, kind, body, created_by, created_by_name) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *', [c.shopId, cust.id, b.kind, b.body, c.id, c.name]);
    return { id: row.id, at: row.created_at, kind: row.kind, body: row.body, by: row.created_by_name, refId: null, manual: true };
  }),
);
salesRouter.delete(
  '/customers/:id/activity/:noteId',
  perm('customers.write'),
  T(async (db, req, c) => {
    const r = await db.query('DELETE FROM customer_activity WHERE shop_id = $1 AND customer_id = $2 AND id = $3', [c.shopId, req.params.id, req.params.noteId]);
    if (!r.rowCount) throw notFound('Note');
  }),
);

salesRouter.delete(
  '/customers/:id',
  perm('customers.write'),
  T(async (db, req, c) => {
    const cur = await requireRow(db, 'customers', c.shopId, req.params.id!, 'Customer');
    const used = await one(db, 'SELECT 1 FROM invoices WHERE shop_id = $1 AND customer_id = $2 UNION SELECT 1 FROM sales_orders WHERE shop_id = $1 AND customer_id = $2 LIMIT 1', [c.shopId, cur.id]);
    if (used) throw conflict('This customer has invoices or orders and can’t be deleted');
    await db.query('DELETE FROM customers WHERE shop_id = $1 AND id = $2', [c.shopId, cur.id]);
    await audit(db, req, c.shopId, 'delete', 'customer', cur.id, { customId: cur.custom_id });
  }),
);

const CUSTOMER_COLS = [
  { key: 'customId', label: 'Customer ID' }, { key: 'type', label: 'Type' }, { key: 'name', label: 'Name' }, { key: 'companyName', label: 'Company' },
  { key: 'gstin', label: 'GSTIN' }, { key: 'phone', label: 'Phone' }, { key: 'email', label: 'Email' }, { key: 'state', label: 'State' },
  { key: 'address', label: 'Address' }, { key: 'tier', label: 'Tier' }, { key: 'due', label: 'Receivable' },
];
salesRouter.get(
  '/customers/export.csv',
  T(async (db, _req, c, res) => {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="customers.csv"');
    res.send('﻿' + toCsv((await listCustomers(db, c.shopId)) as any, CUSTOMER_COLS));
  }),
);
salesRouter.post(
  '/customers/import',
  perm('customers.write'),
  T(async (db, req, c) => {
    const { csv } = parse(z.object({ csv: z.string().min(1).max(2_000_000) }), req.body);
    const rows = parseCsv(csv);
    if (!rows.length) throw badRequest('The file has no data rows');
    if (rows.length > 5000) throw badRequest('Import up to 5,000 rows at a time');
    const org = await getOrg(db, c.shopId);
    const errors: Array<{ row: number; error: string }> = [];
    let created = 0;
    for (const [i, r] of rows.entries()) {
      const gstin = (r.gstin ?? '').toUpperCase();
      const p = customerBody.safeParse({
        type: gstin || /bus/i.test(r.type ?? '') ? 'Business' : 'Individual',
        name: r.name || r.contact || r.company, companyName: r.company ?? r.company_name ?? '', gstin, email: r.email ?? '', phone: r.phone ?? r.mobile ?? '',
        state: r.state || org.state, address: r.address ?? '', tier: /^SP[123]$/.test(r.tier ?? '') ? r.tier : 'SP1',
      });
      if (!p.success) { errors.push({ row: i + 2, error: p.error.issues[0]!.message }); continue; }
      await insertCustomer(db, c.shopId, p.data, org.state);
      created++;
    }
    await audit(db, req, c.shopId, 'import', 'customer', '', { created, errors: errors.length });
    return { created, updated: 0, errors };
  }),
);

/* ======================= Sales orders ======================= */
const soBody = z.object({
  customerId: z.string().uuid('Select a customer'),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  expiryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  lines: z.array(lineInput).min(1, 'Add at least one item'),
  withGst: z.boolean(),
  status: z.enum(['Draft', 'Sent', 'Accepted', 'Declined']),
  notes: z.string().max(2000).default(''),
  kind: z.enum(['quote', 'order']).default('order'),
});

/** Quotes and sales orders share a table: a quote converts to an order, and either converts to an invoice. */
const serializeSO = (r: any) => ({
  id: r.id, kind: r.kind ?? 'order', number: r.number, customerId: r.customer_id, date: r.date, expiryDate: r.expiry_date, lines: r.lines, withGst: r.with_gst,
  status: r.status, notes: r.notes, total: Number(r.total), invoiceId: r.invoice_id ?? null, orderId: r.order_id ?? null, sourceId: r.source_id ?? null,
  sourceNumber: r.source_number ?? null, createdAt: r.created_at,
});
const SO_SELECT = `SELECT so.*,
  (SELECT id FROM invoices i WHERE i.sales_order_id = so.id AND i.status <> 'Cancelled' LIMIT 1) AS invoice_id,
  (SELECT o.id FROM sales_orders o WHERE o.source_id = so.id LIMIT 1) AS order_id,
  (SELECT q.number FROM sales_orders q WHERE q.id = so.source_id) AS source_number
  FROM sales_orders so WHERE so.shop_id = $1`;
const soNumber = async (db: Db, shopId: string, kind: 'quote' | 'order') =>
  `${kind === 'quote' ? 'QT' : 'SO'}-${String(await nextSeq(db, shopId, kind === 'quote' ? 'qt' : 'so')).padStart(4, '0')}`;

async function soTotals(db: Db, shopId: string, b: z.infer<typeof soBody>) {
  const org = await getOrg(db, shopId);
  const cust = await requireRow(db, 'customers', shopId, b.customerId, 'Customer');
  const lines = await buildLines(db, shopId, b.lines);
  const { withGst } = b.withGst ? taxTreatment(org, lines, true) : { withGst: false };
  return { lines, withGst, total: computeTotals(lines, withGst, isInterState(org.state, cust.state || org.state)).total };
}

salesRouter.get(
  '/sales-orders',
  T(async (db, _req, c) =>
    (await many(db, `${SO_SELECT} AND so.kind = $2 ORDER BY so.created_at DESC`, [c.shopId, _req.query.kind === 'quote' ? 'quote' : 'order'])).map(serializeSO),
  ),
);
salesRouter.post(
  '/sales-orders',
  perm('sales.write'),
  T(async (db, req, c) => {
    const b = parse(soBody, req.body);
    const t = await soTotals(db, c.shopId, b);
    const row = await one(
      db,
      'INSERT INTO sales_orders (shop_id, kind, number, customer_id, date, expiry_date, lines, with_gst, status, notes, total, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *',
      [c.shopId, b.kind, await soNumber(db, c.shopId, b.kind), b.customerId, b.date, b.expiryDate, JSON.stringify(t.lines), t.withGst, b.status, b.notes, t.total, c.id],
    );
    await audit(db, req, c.shopId, 'create', b.kind === 'quote' ? 'quote' : 'sales_order', row.id, { number: row.number });
    return serializeSO(row);
  }),
);
salesRouter.put(
  '/sales-orders/:id',
  perm('sales.write'),
  T(async (db, req, c) => {
    const cur = await requireRow(db, 'sales_orders', c.shopId, req.params.id!, 'Sales order');
    const b = parse(soBody, req.body);
    const t = await soTotals(db, c.shopId, b);
    const row = await one(db, 'UPDATE sales_orders SET customer_id=$3, date=$4, expiry_date=$5, lines=$6, with_gst=$7, status=$8, notes=$9, total=$10 WHERE shop_id=$1 AND id=$2 RETURNING *', [
      c.shopId, cur.id, b.customerId, b.date, b.expiryDate, JSON.stringify(t.lines), t.withGst, b.status, b.notes, t.total,
    ]);
    await audit(db, req, c.shopId, 'update', 'sales_order', cur.id, { status: b.status });
    return serializeSO(row);
  }),
);
salesRouter.patch(
  '/sales-orders/:id/status',
  perm('sales.write'),
  T(async (db, req, c) => {
    const { status } = parse(z.object({ status: z.enum(['Draft', 'Sent', 'Accepted', 'Declined']) }), req.body);
    const row = await one(db, 'UPDATE sales_orders SET status = $3 WHERE shop_id = $1 AND id = $2 RETURNING *', [c.shopId, req.params.id, status]);
    if (!row) throw notFound('Sales order');
    await audit(db, req, c.shopId, 'status', 'sales_order', row.id, { status });
    return serializeSO(row);
  }),
);
/** Quote → sales order. The quote is marked Accepted and the order keeps a link back to it. */
salesRouter.post(
  '/sales-orders/:id/convert',
  perm('sales.write'),
  T(async (db, req, c) => {
    const q = await one(db, 'SELECT * FROM sales_orders WHERE shop_id = $1 AND id = $2 FOR UPDATE', [c.shopId, req.params.id]);
    if (!q || q.kind !== 'quote') throw notFound('Quote');
    if (q.status === 'Declined') throw conflict('This quote was declined');
    if (await one(db, 'SELECT 1 FROM sales_orders WHERE shop_id = $1 AND source_id = $2', [c.shopId, q.id])) throw conflict('This quote already has a sales order');
    const row = await one(
      db,
      `INSERT INTO sales_orders (shop_id, kind, number, customer_id, date, expiry_date, lines, with_gst, status, notes, total, source_id, created_by)
       VALUES ($1,'order',$2,$3,$4,$5,$6,$7,'Accepted',$8,$9,$10,$11) RETURNING *`,
      [c.shopId, await soNumber(db, c.shopId, 'order'), q.customer_id, todayISO(), q.expiry_date > todayISO() ? q.expiry_date : todayISO(), JSON.stringify(q.lines), q.with_gst, q.notes, q.total, q.id, c.id],
    );
    await db.query("UPDATE sales_orders SET status = 'Accepted' WHERE shop_id = $1 AND id = $2", [c.shopId, q.id]);
    await audit(db, req, c.shopId, 'convert', 'quote', q.id, { order: row.number });
    return serializeSO({ ...row, source_number: q.number });
  }),
);
salesRouter.delete(
  '/sales-orders/:id',
  perm('sales.write'),
  T(async (db, req, c) => {
    const cur = await requireRow(db, 'sales_orders', c.shopId, req.params.id!, 'Sales order');
    const inv = await one(db, 'SELECT 1 FROM invoices WHERE shop_id = $1 AND sales_order_id = $2', [c.shopId, cur.id]);
    if (inv) throw conflict('This order has been invoiced and can’t be deleted');
    if (await one(db, 'SELECT 1 FROM sales_orders WHERE shop_id = $1 AND source_id = $2', [c.shopId, cur.id])) throw conflict('This quote has a sales order and can’t be deleted');
    await db.query('DELETE FROM sales_orders WHERE shop_id = $1 AND id = $2', [c.shopId, cur.id]);
    await audit(db, req, c.shopId, 'delete', 'sales_order', cur.id, { number: cur.number });
  }),
);

/* ======================= Invoices ======================= */
salesRouter.get('/invoices', T(async (db, _req, c) => (await many(db, 'SELECT * FROM invoices WHERE shop_id = $1 ORDER BY date DESC, created_at DESC', [c.shopId])).map(serializeInvoice)));

salesRouter.get(
  '/invoices/next-number',
  T(async (db, req, c) => {
    const date = typeof req.query.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.query.date) ? req.query.date : todayISO();
    const cfg = await platformConfig(db);
    const fy = fyLabel(date, cfg.fyStartMonth);
    return { number: formatInvoiceNumber(await peekSeq(db, c.shopId, invoiceCounterKey('inv', fy, cfg.autoReset)), fy, cfg.autoReset), fy };
  }),
);

salesRouter.get(
  '/invoices/:id',
  T(async (db, req, c) => {
    const inv = await getInvoice(db, c.shopId, req.params.id!);
    const payments = await many(db, 'SELECT p.*, a.name AS account_name FROM payments p LEFT JOIN bank_accounts a ON a.id = p.account_id WHERE p.shop_id = $1 AND p.invoice_id = $2 ORDER BY p.date, p.created_at', [c.shopId, inv.id]);
    const credits = await many(db, 'SELECT * FROM credit_notes WHERE shop_id = $1 AND invoice_id = $2 ORDER BY date', [c.shopId, inv.id]);
    const reminders = await many(db, 'SELECT * FROM reminder_log WHERE shop_id = $1 AND invoice_id = $2 ORDER BY at DESC LIMIT 20', [c.shopId, inv.id]);
    return {
      ...inv,
      payments: payments.map((p) => ({ id: p.id, date: p.date, amount: Number(p.amount), tdsAmount: Number(p.tds_amount), mode: p.mode, reference: p.reference, account: p.account_name, notes: p.notes })),
      creditNotes: credits.map((r) => serializeCreditNote(r, { number: inv.number, date: inv.date, customer: inv.customer })),
      reminders: reminders.map((r) => ({ channel: r.channel, status: r.status, detail: r.detail, at: r.at })),
    };
  }),
);

salesRouter.post(
  '/invoices',
  perm('sales.write'),
  T(async (db, req, c) => {
    const b = parse(invoiceInput.extend({ issue: z.boolean().default(true) }), req.body);
    if (b.salesOrderId) await requireRow(db, 'sales_orders', c.shopId, b.salesOrderId, 'Sales order');
    return createInvoice(db, req, c.shopId, b, { issue: b.issue });
  }),
);
salesRouter.put(
  '/invoices/:id',
  perm('sales.write'),
  T(async (db, req, c) => {
    const b = parse(invoiceInput.extend({ issue: z.boolean().default(false) }), req.body);
    return updateInvoice(db, req, c.shopId, req.params.id!, b, b.issue);
  }),
);
salesRouter.post(
  '/invoices/:id/cancel',
  perm('sales.write'),
  T(async (db, req, c) => cancelInvoice(db, req, c.shopId, req.params.id!, parse(z.object({ reason: z.string().trim().min(3, 'Give a reason').max(300) }), req.body).reason)),
);
/** Only drafts can be deleted — issued invoices are part of the GST record and must be cancelled. */
salesRouter.delete(
  '/invoices/:id',
  perm('sales.write'),
  T(async (db, req, c) => {
    const inv = await lockInvoice(db, c.shopId, req.params.id!);
    if (inv.status !== 'Draft') throw conflict('Issued invoices can’t be deleted. Cancel it or raise a credit note instead.');
    await db.query('DELETE FROM invoices WHERE shop_id = $1 AND id = $2', [c.shopId, inv.id]);
    await audit(db, req, c.shopId, 'delete_draft', 'invoice', inv.id);
  }),
);

/* ---------- Payments ---------- */
salesRouter.post(
  '/invoices/:id/payments',
  perm('payments.write'),
  T(async (db, req, c) => {
    await recordPayment(db, req, c.shopId, req.params.id!, parse(paymentInput, req.body));
    return getInvoice(db, c.shopId, req.params.id!);
  }),
);
salesRouter.delete(
  '/payments/:id',
  perm('payments.write'),
  T(async (db, req, c) => {
    await deletePayment(db, req, c.shopId, req.params.id!);
  }),
);
salesRouter.get(
  '/payments',
  T(async (db, _req, c) => {
    const rows = await many(
      db,
      `SELECT p.*, i.number AS invoice_number, i.customer, a.name AS account_name FROM payments p JOIN invoices i ON i.id = p.invoice_id
         LEFT JOIN bank_accounts a ON a.id = p.account_id WHERE p.shop_id = $1 ORDER BY p.date DESC, p.created_at DESC LIMIT 500`,
      [c.shopId],
    );
    return rows.map((p) => ({ id: p.id, invoiceId: p.invoice_id, invoiceNumber: p.invoice_number, customer: p.customer?.companyName || p.customer?.name, date: p.date, amount: Number(p.amount), tdsAmount: Number(p.tds_amount), mode: p.mode, reference: p.reference, account: p.account_name }));
  }),
);

/* ---------- Credit notes ---------- */
salesRouter.get(
  '/credit-notes',
  T(async (db, _req, c) =>
    (await many(db, 'SELECT cn.*, i.number AS invoice_number, i.date AS invoice_date, i.customer FROM credit_notes cn JOIN invoices i ON i.id = cn.invoice_id WHERE cn.shop_id = $1 ORDER BY cn.date DESC, cn.created_at DESC', [c.shopId])).map((r) => serializeCreditNote(r)),
  ),
);
salesRouter.post('/credit-notes', perm('sales.write'), T(async (db, req, c) => createCreditNote(db, req, c.shopId, parse(creditNoteInput, req.body))));

/* ---------- Government JSON (e-invoice / e-way bill) ---------- */
salesRouter.get(
  '/invoices/:id/einvoice.json',
  T(async (db, req, c, res) => {
    const inv = await lockInvoice(db, c.shopId, req.params.id!);
    if (inv.status !== 'Issued') throw conflict('Issue the invoice first');
    const org = await getOrg(db, c.shopId);
    let payload;
    try { payload = buildEInvoice(org, inv); } catch (e) { throw badRequest((e as Error).message); }
    await audit(db, req, c.shopId, 'export_einvoice', 'invoice', inv.id);
    res.setHeader('Content-Disposition', `attachment; filename="einvoice-${inv.number}.json"`);
    res.json({ ...payload, _note: config.einvoice ? undefined : 'Upload on einvoice1.gst.gov.in (bulk upload) — direct IRP filing is not configured.' });
  }),
);
salesRouter.post(
  '/invoices/:id/ewaybill.json',
  T(async (db, req, c, res) => {
    const t = parse(
      z.object({ distanceKm: z.number().int().min(0).max(4000), vehicleNo: z.string().trim().regex(/^[A-Za-z]{2}\s?\d{1,2}\s?[A-Za-z]{0,3}\s?\d{4}$/, 'Enter a valid vehicle number (e.g. TN01AB1234)'), transporterId: z.string().max(15).optional(), transporterName: z.string().max(100).optional(), mode: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]).default(1) }),
      req.body,
    );
    const inv = await lockInvoice(db, c.shopId, req.params.id!);
    if (inv.status !== 'Issued') throw conflict('Issue the invoice first');
    const org = await getOrg(db, c.shopId);
    let payload;
    try { payload = buildEwayBill(org, inv, t); } catch (e) { throw badRequest((e as Error).message); }
    await audit(db, req, c.shopId, 'export_ewaybill', 'invoice', inv.id, { vehicle: t.vehicleNo });
    res.setHeader('Content-Disposition', `attachment; filename="ewaybill-${inv.number}.json"`);
    res.json(payload);
  }),
);

/* ---------- Printing, PDF and email ---------- */
const paperOf = (v: unknown): PdfPaper => (v === 'a5' || v === 'thermal' ? v : 'a4');
export const pdfName = (inv: { number: string | null; status: string }) => `${(inv.number ?? 'draft-invoice').replace(/[^\w.-]+/g, '-')}.pdf`;

salesRouter.get('/invoices/:id/print-data', T(async (db, req, c) => invoicePrintBundle(db, c.shopId, req.params.id!)));

salesRouter.get(
  '/invoices/:id/pdf',
  h(async (req, res) => {
    const c = userCtx(req);
    const inv = await withTenant(c.shopId, (db) => getInvoice(db, c.shopId, req.params.id!));
    const pdf = await renderPdfOr503(c.shopId, inv.id, paperOf(req.query.paper));
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `${req.query.inline ? 'inline' : 'attachment'}; filename="${pdfName(inv)}"`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(pdf);
  }),
);

export async function renderPdfOr503(shopId: string, invoiceId: string, paper: PdfPaper) {
  try {
    return await invoicePdf(shopId, invoiceId, paper);
  } catch (e) {
    console.error('[pdf]', (e as Error).message);
    throw new HttpError(503, 'Could not create the PDF right now. Use Print → Save as PDF instead.', 'pdf_unavailable');
  }
}

salesRouter.post(
  '/invoices/:id/email',
  perm('sales.write'),
  h(async (req, res) => {
    const c = userCtx(req);
    const b = parse(z.object({ to: z.string().trim().regex(EMAIL_RE, 'Enter a valid email'), cc: z.string().trim().default(''), message: z.string().max(2000).default('') }), req.body);
    const { inv, org } = await withTenant(c.shopId, async (db) => ({ inv: await getInvoice(db, c.shopId, req.params.id!), org: await getOrg(db, c.shopId) }));
    if (inv.status !== 'Issued') throw conflict('Issue the invoice before emailing it');
    const pdf = await renderPdfOr503(c.shopId, inv.id, 'a4');
    const who = inv.customer.companyName || inv.customer.name;
    const link = inv.publicToken ? `${config.appUrl}/share/${inv.publicToken}` : '';
    const text = [
      b.message || `Dear ${who},\n\nPlease find attached invoice ${inv.number} dated ${inv.date} for ₹${inv.total.toFixed(2)}.`,
      inv.balance > 0 ? `Amount due: ₹${inv.balance.toFixed(2)} by ${inv.dueDate}.` : '',
      link ? `View online: ${link}` : '',
      `Regards,\n${org.company_name}`,
    ].filter(Boolean).join('\n\n');
    const sent = await sendMail({
      to: b.to, cc: b.cc || undefined, subject: `Invoice ${inv.number} from ${org.company_name}`, text,
      attachments: [{ filename: pdfName(inv), content: pdf, contentType: 'application/pdf' }],
    });
    const detail = sent ? `Emailed ${b.to} with PDF` : 'Email not configured on server (logged only)';
    await withTenant(c.shopId, async (db) => {
      await db.query('INSERT INTO reminder_log (shop_id, invoice_id, channel, status, detail) VALUES ($1,$2,$3,$4,$5)', [c.shopId, inv.id, 'email', sent ? 'sent' : 'skipped', detail]);
      await audit(db, req, c.shopId, 'email_invoice', 'invoice', inv.id, { to: b.to, sent });
    });
    res.json({ status: sent ? 'sent' : 'skipped', detail });
  }),
);

/** Record the IRN / acknowledgement from the IRP and the e-way bill number so they print on the invoice. */
salesRouter.put(
  '/invoices/:id/gst-refs',
  perm('sales.write'),
  T(async (db, req, c) => {
    const b = parse(
      z.object({
        irn: z.string().trim().regex(/^([0-9a-f]{64})?$/i, 'The IRN is a 64-character code').default(''),
        ackNo: z.string().trim().max(20).default(''),
        ackDate: z.string().trim().max(25).default(''),
        signedQr: z.string().trim().max(4000).default(''),
        ewayBillNo: z.string().trim().regex(/^(\d{12})?$/, 'E-way bill numbers have 12 digits').default(''),
        ewayDate: z.string().trim().max(25).default(''),
        vehicleNo: z.string().trim().max(15).default(''),
      }),
      req.body,
    );
    const inv = await lockInvoice(db, c.shopId, req.params.id!);
    if (inv.status !== 'Issued') throw conflict('Issue the invoice first');
    const einvoice = b.irn ? { irn: b.irn.toLowerCase(), ackNo: b.ackNo, ackDate: b.ackDate, signedQr: b.signedQr } : null;
    const eway = b.ewayBillNo ? { number: b.ewayBillNo, date: b.ewayDate, vehicleNo: b.vehicleNo.toUpperCase() } : null;
    await db.query('UPDATE invoices SET einvoice = $3, eway = $4 WHERE shop_id = $1 AND id = $2', [c.shopId, inv.id, einvoice && JSON.stringify(einvoice), eway && JSON.stringify(eway)]);
    await audit(db, req, c.shopId, 'update_gst_refs', 'invoice', inv.id, { irn: !!einvoice, eway: eway?.number });
    return getInvoice(db, c.shopId, inv.id);
  }),
);

/* ---------- Reminders ---------- */
export async function emailReminder(db: Db, shopId: string, inv: any, org: any) {
  const email = inv.customer?.email;
  const balance = Number(inv.total) - Number(inv.amount_paid) - Number(inv.amount_credited);
  if (!email) return { status: 'skipped', detail: 'Customer has no email address' };
  const link = `${config.appUrl}/share/${inv.public_token}`;
  const sent = await sendMail({
    to: email,
    subject: `Payment reminder: ${inv.number} from ${org.company_name}`,
    text: `Dear ${inv.customer.companyName || inv.customer.name},\n\nThis is a friendly reminder that invoice ${inv.number} dated ${inv.date} has a balance of ₹${balance.toFixed(2)}, due on ${inv.due_date}.\n\nView & pay: ${link}\n\nThank you,\n${org.company_name}`,
  });
  return { status: sent ? 'sent' : 'skipped', detail: sent ? `Emailed ${email}` : 'Email not configured on server (logged only)' };
}

salesRouter.post(
  '/invoices/:id/reminders',
  perm('sales.write'),
  T(async (db, req, c) => {
    const { channel } = parse(z.object({ channel: z.enum(['email', 'whatsapp']) }), req.body);
    const inv = await lockInvoice(db, c.shopId, req.params.id!);
    if (inv.status !== 'Issued') throw conflict('Reminders apply to issued invoices');
    // WhatsApp reminders are sent from the user's own WhatsApp via a wa.me link; we just log them.
    const result = channel === 'email' ? await emailReminder(db, c.shopId, inv, await getOrg(db, c.shopId)) : { status: 'sent', detail: 'Shared via WhatsApp' };
    await db.query('INSERT INTO reminder_log (shop_id, invoice_id, channel, status, detail) VALUES ($1,$2,$3,$4,$5)', [c.shopId, inv.id, channel, result.status, result.detail]);
    await db.query('UPDATE invoices SET last_reminder_at = now() WHERE shop_id = $1 AND id = $2', [c.shopId, inv.id]);
    return result;
  }),
);

/* ======================= POS ======================= */
/** One-shot counter sale: issued invoice + full payment in a single transaction. */
salesRouter.post(
  '/pos/sale',
  perm('sales.write'),
  T(async (db, req, c) => {
    const b = parse(
      z.object({
        customerId: z.string().uuid().nullable(),
        branchId: z.string().uuid().nullable().optional(),
        lines: z.array(lineInput).min(1, 'Cart is empty'),
        withGst: z.boolean(),
        mode: z.enum(['Cash', 'UPI', 'Card']),
        tendered: z.number().min(0).optional(),
        reference: z.string().max(100).default(''),
        /** Split payment: e.g. part cash, part UPI. The amounts must add up to the bill total. */
        split: z.array(z.object({ mode: z.enum(['Cash', 'UPI', 'Card']), amount: z.number().positive(), reference: z.string().max(100).default('') })).min(2).max(3).optional(),
        pricesIncludeTax: z.boolean().optional(),
        billDiscount: z.object({ kind: z.enum(['percent', 'amount']), value: z.number().min(0).max(1e9) }).nullable().optional(),
      }),
      req.body,
    );
    const today = todayISO();
    const inv = await createInvoice(
      db, req, c.shopId,
      { customerId: b.customerId, date: today, dueDate: today, branchId: b.branchId ?? c.branchId, lines: b.lines, withGst: b.withGst, reverseCharge: false, tcsRate: 0, notes: '',
        pricesIncludeTax: b.pricesIncludeTax, billDiscount: b.billDiscount },
      { issue: true, source: 'pos' },
    );
    if (b.split) {
      const paid = Math.round(b.split.reduce((s2, p) => s2 + p.amount, 0) * 100) / 100;
      if (Math.abs(paid - inv.total) > 0.5) throw badRequest(`The split payments add up to ₹${paid}, but the bill is ₹${inv.total}`);
      // The last part absorbs any paise left over from rounding, so the bill is exactly settled.
      let left = inv.total;
      for (const [i, p] of b.split.entries()) {
        const amount = i === b.split.length - 1 ? Math.round(left * 100) / 100 : Math.min(p.amount, left);
        left -= amount;
        if (amount > 0) await recordPayment(db, req, c.shopId, inv.id, { date: today, amount, tdsAmount: 0, mode: p.mode, reference: p.reference, notes: 'POS · split' });
      }
      return { invoice: await getInvoice(db, c.shopId, inv.id), change: 0 };
    }
    if (b.mode === 'Cash' && b.tendered !== undefined && b.tendered < inv.total) throw badRequest('Cash tendered is less than the bill total');
    await recordPayment(db, req, c.shopId, inv.id, { date: today, amount: inv.total, tdsAmount: 0, mode: b.mode, reference: b.reference, notes: 'POS' });
    return { invoice: await getInvoice(db, c.shopId, inv.id), change: b.mode === 'Cash' && b.tendered ? Math.max(0, b.tendered - inv.total) : 0 };
  }),
);

/* ======================= Recurring profiles ======================= */
const recurringBody = z.object({
  name: z.string().trim().min(1, 'Give this profile a name').max(100),
  customerId: z.string().uuid('Select a customer'),
  frequency: z.enum(['weekly', 'monthly', 'quarterly', 'yearly']),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().default(null),
  lines: z.array(lineInput).min(1),
  withGst: z.boolean(),
  termsDays: z.number().int().min(0).max(120).default(15),
  branchId: z.string().uuid().nullable().optional(),
  notes: z.string().max(1000).default(''),
  autoIssue: z.boolean().default(true),
  active: z.boolean().default(true),
});
const serializeRec = (r: any) => ({
  id: r.id, name: r.name, customerId: r.customer_id, frequency: r.frequency, startDate: r.start_date, endDate: r.end_date, nextDate: r.next_date,
  lines: r.lines, withGst: r.with_gst, termsDays: r.terms_days, branchId: r.branch_id, notes: r.notes, autoIssue: r.auto_issue, active: r.active,
  lastRunAt: r.last_run_at, generated: Number(r.generated ?? 0),
});

salesRouter.get('/recurring', T(async (db, _req, c) => (await many(db, 'SELECT r.*, (SELECT count(*) FROM invoices i WHERE i.recurring_id = r.id) AS generated FROM recurring_profiles r WHERE r.shop_id = $1 ORDER BY r.created_at DESC', [c.shopId])).map(serializeRec)));

salesRouter.post(
  '/recurring',
  perm('admin'),
  T(async (db, req, c) => {
    const b = parse(recurringBody, req.body);
    await requireRow(db, 'customers', c.shopId, b.customerId, 'Customer');
    await buildLines(db, c.shopId, b.lines); // validates items
    const row = await one(
      db,
      `INSERT INTO recurring_profiles (shop_id, name, customer_id, frequency, start_date, end_date, next_date, lines, with_gst, terms_days, branch_id, notes, auto_issue, active)
       VALUES ($1,$2,$3,$4,$5,$6,$5,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
      [c.shopId, b.name, b.customerId, b.frequency, b.startDate, b.endDate, JSON.stringify(b.lines), b.withGst, b.termsDays, b.branchId ?? null, b.notes, b.autoIssue, b.active],
    );
    await audit(db, req, c.shopId, 'create', 'recurring', row.id, { name: b.name });
    return serializeRec(row);
  }),
);
salesRouter.put(
  '/recurring/:id',
  perm('admin'),
  T(async (db, req, c) => {
    const cur = await requireRow(db, 'recurring_profiles', c.shopId, req.params.id!, 'Recurring profile');
    const b = parse(recurringBody, req.body);
    await buildLines(db, c.shopId, b.lines);
    const nextDate = b.startDate > cur.next_date ? b.startDate : cur.next_date;
    const row = await one(
      db,
      `UPDATE recurring_profiles SET name=$3, customer_id=$4, frequency=$5, start_date=$6, end_date=$7, next_date=$8, lines=$9, with_gst=$10, terms_days=$11,
         branch_id=$12, notes=$13, auto_issue=$14, active=$15 WHERE shop_id=$1 AND id=$2 RETURNING *`,
      [c.shopId, cur.id, b.name, b.customerId, b.frequency, b.startDate, b.endDate, nextDate, JSON.stringify(b.lines), b.withGst, b.termsDays, b.branchId ?? null, b.notes, b.autoIssue, b.active],
    );
    await audit(db, req, c.shopId, 'update', 'recurring', cur.id);
    return serializeRec(row);
  }),
);
salesRouter.delete(
  '/recurring/:id',
  perm('admin'),
  T(async (db, req, c) => {
    const cur = await requireRow(db, 'recurring_profiles', c.shopId, req.params.id!, 'Recurring profile');
    await db.query('UPDATE invoices SET recurring_id = NULL WHERE shop_id = $1 AND recurring_id = $2', [c.shopId, cur.id]);
    await db.query('DELETE FROM recurring_profiles WHERE shop_id = $1 AND id = $2', [c.shopId, cur.id]);
    await audit(db, req, c.shopId, 'delete', 'recurring', cur.id);
  }),
);

