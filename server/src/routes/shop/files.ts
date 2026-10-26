import { Router } from 'express';
import { z } from 'zod';
import { rateLimit } from '../../auth';
import { config } from '../../config';
import { audit } from '../../audit';
import { many, one } from '../../db';
import { forbidden, HttpError, notFound, parse } from '../../http';
import { getOrg } from '../../services/common';
import { aiEnabled, decodeDataUrl, extractDocument } from '../../services/extract';
import { aiError, askAssistant, draftReminder, parseBill, stockAdvice, suggestItem } from '../../services/assistant';
import { stockInsights } from '../../services/stockInsights';
import { withTenant } from '../../db';
import { h } from '../../http';
import { userCtx } from '../../auth';
import type { Permission } from '../../../../shared/permissions';
import { T, allowed } from './ctx';

export const filesRouter = Router();

/* ---------- Read an uploaded PDF or photo into form fields ---------- */
const KINDS = ['item', 'items', 'bill', 'expense', 'customer', 'vendor', 'invoice', 'order'] as const;

filesRouter.get('/extract/status', T(async () => ({ ai: aiEnabled() })));
filesRouter.post(
  '/extract',
  rateLimit('extract', 30, 60_000),
  T(async (db, req, c) => {
    const b = parse(z.object({ kind: z.enum(KINDS), file: z.string().min(20), filename: z.string().max(200).default('') }), req.body);
    const org = await getOrg(db, c.shopId);
    const result = await extractDocument(b.file, b.kind, { name: org.company_name, gstin: org.gstin ?? '' });
    await audit(db, req, c.shopId, 'extract', b.kind, c.shopId, { file: b.filename, method: result.method, lines: result.data.lines.length });
    return result;
  }),
);

/* ---------- AI: business assistant and item suggestions ---------- */
filesRouter.get('/ai/status', T(async () => ({ enabled: aiEnabled() })));
// The assistant runs several tool calls over tens of seconds, so it must not hold one DB transaction open:
// each tool opens its own tenant-scoped transaction.
filesRouter.post(
  '/ai/ask',
  rateLimit('ai-ask', 20, 60_000),
  h(async (req, res) => {
    const c = userCtx(req);
    const b = parse(z.object({ messages: z.array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().min(1).max(4000) })).min(1).max(20) }), req.body);
    if (b.messages[b.messages.length - 1]!.role !== 'user') throw new HttpError(400, 'The last message must be a question', 'bad_chat');
    const org = await withTenant(c.shopId, (db) => getOrg(db, c.shopId));
    const answer = await askAssistant(c, { name: org.company_name, state: org.state ?? '' }, b.messages).catch(aiError);
    res.json({ answer });
  }),
);
filesRouter.post(
  '/ai/item-suggest',
  rateLimit('ai-item', 30, 60_000),
  h(async (req, res) => {
    userCtx(req);
    const b = parse(z.object({ name: z.string().trim().min(2).max(200), hint: z.string().max(500).default('') }), req.body);
    res.json(await suggestItem(b.name, b.hint).catch(aiError));
  }),
);

filesRouter.post(
  '/ai/stock-advice',
  rateLimit('ai-stock', 10, 60_000),
  h(async (req, res) => {
    const c = userCtx(req);
    if (!['items.write', 'purchases.read', 'reports.read'].some((p) => allowed(c, p as Permission))) throw forbidden();
    const b = parse(z.object({ leadDays: z.number().int().min(1).max(60).optional(), coverDays: z.number().int().min(7).max(120).optional() }), req.body ?? {});
    const { ins, org } = await withTenant(c.shopId, async (db) => ({ ins: await stockInsights(db, c.shopId, b), org: await getOrg(db, c.shopId) }));
    res.json(await stockAdvice(ins, { name: org.company_name, state: org.state ?? '' }, allowed(c, 'items.cost')).catch(aiError));
  }),
);

filesRouter.post(
  '/ai/parse-bill',
  rateLimit('ai-bill', 30, 60_000),
  h(async (req, res) => {
    const c = userCtx(req);
    if (!allowed(c, 'sales.write')) throw forbidden();
    const b = parse(z.object({ text: z.string().trim().min(2, 'Type the items first').max(1500), context: z.enum(['invoice', 'pos']).default('invoice') }), req.body);
    res.json(await parseBill(c, b.text, b.context).catch(aiError));
  }),
);
filesRouter.post(
  '/ai/reminder',
  rateLimit('ai-reminder', 30, 60_000),
  h(async (req, res) => {
    const c = userCtx(req);
    if (!allowed(c, 'sales.write') && !allowed(c, 'payments.write')) throw forbidden();
    const b = parse(z.object({ invoiceId: z.string().uuid(), tone: z.enum(['friendly', 'polite', 'firm']).default('polite'), language: z.enum(['English', 'Hindi', 'Tamil', 'Telugu', 'Kannada', 'Malayalam', 'Marathi', 'Gujarati', 'Bengali', 'Hinglish']).default('English') }), req.body);
    const { inv, org } = await withTenant(c.shopId, async (db) => ({
      inv: await one(db, "SELECT *, current_date - due_date AS late FROM invoices WHERE shop_id = $1 AND id = $2 AND status = 'Issued'", [c.shopId, b.invoiceId]),
      org: await getOrg(db, c.shopId),
    }));
    if (!inv) throw new HttpError(404, 'Invoice not found', 'not_found');
    const balance = Math.round((Number(inv.total) - Number(inv.amount_paid) - Number(inv.amount_credited)) * 100) / 100;
    if (balance <= 0) throw new HttpError(409, 'This invoice is fully paid', 'paid');
    const message = await draftReminder({
      number: inv.number, date: inv.date, dueDate: inv.due_date, total: Number(inv.total), balance, customer: inv.customer.companyName || inv.customer.name,
      daysOverdue: Math.max(0, Number(inv.late)), payLink: inv.public_token ? `${config.appUrl}/share/${inv.public_token}` : null, upiId: org.upi_id || null,
    }, org.company_name, b.tone, b.language).catch(aiError);
    res.json({ message, phone: inv.customer.phone ?? '' });
  }),
);

/* ---------- Attachments on records ---------- */
const ENTITIES = {
  invoice: { table: 'invoices', read: null, write: 'sales.write' },
  credit_note: { table: 'credit_notes', read: null, write: 'sales.write' },
  sales_order: { table: 'sales_orders', read: null, write: 'sales.write' },
  customer: { table: 'customers', read: null, write: 'customers.write' },
  item: { table: 'items', read: null, write: 'items.write' },
  bill: { table: 'bills', read: 'purchases.read', write: 'purchases.write' },
  vendor: { table: 'vendors', read: 'purchases.read', write: 'purchases.write' },
  expense: { table: 'expenses', read: 'purchases.read', write: 'purchases.write' },
  purchase_order: { table: 'purchase_orders', read: 'purchases.read', write: 'purchases.write' },
  stock_adjustment: { table: 'stock_adjustments', read: null, write: 'items.write' },
  stock_transfer: { table: 'stock_transfers', read: null, write: 'items.write' },
  journal: { table: 'journals', read: 'accounting.read', write: 'accounting.write' },
  payment: { table: 'payments', read: null, write: 'payments.write' },
  bill_payment: { table: 'bill_payments', read: 'purchases.read', write: 'purchases.write' },
  delivery_challan: { table: 'delivery_challans', read: null, write: 'sales.write' },
  bank_transaction: { table: 'bank_transactions', read: 'banking.read', write: 'banking.write' },
} as const satisfies Record<string, { table: string; read: Permission | null; write: Permission }>;
type Entity = keyof typeof ENTITIES;
const entityEnum = z.enum(Object.keys(ENTITIES) as [Entity, ...Entity[]]);
const SHOP_QUOTA_BYTES = 500 * 1024 * 1024;

const serialize = (a: any) => ({ id: a.id, entity: a.entity, entityId: a.entity_id, filename: a.filename, mime: a.mime, size: a.size, uploadedBy: a.uploaded_by_name, createdAt: a.created_at });

filesRouter.get(
  '/attachments',
  T(async (db, req, c) => {
    const q = parse(z.object({ entity: entityEnum, entityId: z.string().uuid() }), req.query);
    const rule = ENTITIES[q.entity];
    if (rule.read && !allowed(c, rule.read)) throw forbidden();
    return (await many(db, 'SELECT id, entity, entity_id, filename, mime, size, uploaded_by_name, created_at FROM attachments WHERE shop_id = $1 AND entity = $2 AND entity_id = $3 ORDER BY created_at DESC', [c.shopId, q.entity, q.entityId])).map(serialize);
  }),
);

filesRouter.post(
  '/attachments',
  rateLimit('upload', 60, 60_000),
  T(async (db, req, c) => {
    const b = parse(z.object({ entity: entityEnum, entityId: z.string().uuid(), filename: z.string().trim().min(1).max(200), file: z.string().min(20) }), req.body);
    const rule = ENTITIES[b.entity];
    if (!c.permissions.includes(rule.write)) throw forbidden();
    if (!(await one(db, `SELECT 1 FROM ${rule.table} WHERE shop_id = $1 AND id = $2`, [c.shopId, b.entityId]))) throw notFound('Record');
    const { mime, bytes } = decodeDataUrl(b.file);
    const used = await one(db, 'SELECT coalesce(sum(size), 0)::bigint AS n FROM attachments WHERE shop_id = $1', [c.shopId]);
    if (Number(used.n) + bytes.length > SHOP_QUOTA_BYTES) throw new HttpError(413, 'Your file storage is full (500 MB). Remove old attachments to add more.', 'quota');
    const filename = b.filename.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_');
    const row = await one(
      db,
      'INSERT INTO attachments (shop_id, entity, entity_id, filename, mime, size, data, uploaded_by, uploaded_by_name) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id, entity, entity_id, filename, mime, size, uploaded_by_name, created_at',
      [c.shopId, b.entity, b.entityId, filename, mime, bytes.length, bytes, c.id, c.name],
    );
    await audit(db, req, c.shopId, 'attach', b.entity, b.entityId, { file: filename, size: bytes.length });
    return serialize(row);
  }),
);

filesRouter.get(
  '/attachments/:id',
  T(async (db, req, c, res) => {
    const a = await one(db, 'SELECT * FROM attachments WHERE shop_id = $1 AND id = $2', [c.shopId, req.params.id]);
    if (!a) throw notFound('File');
    const rule = ENTITIES[a.entity as Entity];
    if (rule.read && !allowed(c, rule.read)) throw forbidden();
    res.setHeader('Content-Type', a.mime);
    res.setHeader('Content-Length', String(a.size));
    res.setHeader('Content-Disposition', `${req.query.download ? 'attachment' : 'inline'}; filename="${encodeURIComponent(a.filename)}"`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox");
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.end(a.data);
  }),
);

filesRouter.delete(
  '/attachments/:id',
  T(async (db, req, c) => {
    const a = await one(db, 'SELECT id, entity, entity_id, filename FROM attachments WHERE shop_id = $1 AND id = $2', [c.shopId, req.params.id]);
    if (!a) throw notFound('File');
    if (!c.permissions.includes(ENTITIES[a.entity as Entity].write)) throw forbidden();
    await db.query('DELETE FROM attachments WHERE shop_id = $1 AND id = $2', [c.shopId, a.id]);
    await audit(db, req, c.shopId, 'detach', a.entity, a.entity_id, { file: a.filename });
  }),
);
