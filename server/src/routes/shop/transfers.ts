/**
 * Inter-branch stock transfers API (mounted under /api/shop). Sending and receiving need items.write; branch-tied
 * staff act only for their own branch. Logic: services/transfers.ts.
 *
 *   GET  /stock/transfers                       list           GET /stock/transfers/:id      one, with OTP state and log
 *   POST /stock/transfers                       draft or initiate (initiate: true)
 *   PUT  /stock/transfers/:id                   edit a draft    POST /stock/transfers/:id/cancel
 *   POST /transfers/initiate                    send (from a draft with transferId, or a full transfer)
 *   POST /transfers/resend-otp                  new receipt code to the destination manager
 *   POST /transfers/verify-receipt              code + what arrived → stock added at the destination
 *   POST /transfers/owner-receive               owner only, no code, reason required
 *   POST /transfers/price-preview               destination prices for the form
 *   GET  /stock/batches?itemId&branchId         batches to pick from      PATCH /stock/batches/:id   season / price
 *   GET  /stock/branch-prices?branchId          selling prices set for a branch (billing pre-fills them)
 *   GET|POST|PATCH|DELETE /pricing-rules        location and seasonal price modifiers
 */
import { Router } from 'express';
import { z } from 'zod';
import { audit } from '../../audit';
import { perm, todayISO } from '../../auth';
import { many, one } from '../../db';
import { HttpError, badRequest, notFound, parse } from '../../http';
import {
  cancelTransfer, initiate, loadTransfer, otpRecipient, otpStatus, ownerReceive, planLines, resendOtp, ruleRow, saveDraft, scoped, serializeTransfer,
  transferItems, verifyReceipt, type TransferInput,
} from '../../services/transfers';
import { maskEmail } from '../../../../shared/transfers';
import { T } from './ctx';

export const transfersRouter = Router();

const iso = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date like 2026-11-18');
const lineSchema = z.object({
  itemId: z.string().uuid('Pick an item'),
  batchNo: z.string().trim().max(60).nullable().optional(),
  qty: z.number().positive('Enter a quantity').max(1e9),
  serials: z.array(z.string().trim().min(1).max(80)).max(1000).optional(),
  destPrice: z.number().min(0).max(1e9).nullable().optional(),
});
const transferSchema = z.object({
  fromBranchId: z.string().uuid('Choose the source branch'),
  toBranchId: z.string().uuid('Choose the destination branch'),
  date: iso.default(todayISO),
  notes: z.string().max(500).default(''),
  ewayBillNo: z.string().trim().max(20).default(''),
  vehicleNo: z.string().trim().max(20).default(''),
  lines: z.array(lineSchema).min(1, 'Add at least one item').max(200),
});
const receiptSchema = z.object({
  transferId: z.string().uuid(),
  otp: z.string().max(12).optional(),
  reason: z.string().max(500).optional(),
  note: z.string().trim().max(1000).default(''),
  lines: z.array(z.object({ lineId: z.string().uuid(), received: z.number().min(0), damaged: z.number().min(0).default(0), missing: z.number().min(0).default(0) })).max(400).optional(),
});

/* ---------- Transfers ---------- */

transfersRouter.get('/stock/transfers', T(async (db, req, c) => {
  const status = typeof req.query.status === 'string' ? req.query.status : null;
  const rows = await many(db, `SELECT t.*, f.name AS from_name, d.name AS to_name FROM stock_transfers t JOIN branches f ON f.id = t.from_branch_id JOIN branches d ON d.id = t.to_branch_id
                               WHERE t.shop_id = $1 ${status ? 'AND t.status = $2' : ''} ORDER BY t.date DESC, t.created_at DESC LIMIT 500`, status ? [c.shopId, status] : [c.shopId]);
  const items = rows.length ? await many(db, 'SELECT * FROM stock_transfer_items WHERE transfer_id = ANY($1::uuid[]) ORDER BY line_no', [rows.map((r) => r.id)]) : [];
  const by = new Map<string, any[]>();
  for (const i of items) by.set(i.transfer_id, [...(by.get(i.transfer_id) ?? []), i]);
  return rows.map((t) => {
    const v = serializeTransfer(t, by.get(t.id) ?? []);
    if (t.status === 'Draft') v.lines = draftLines(t);
    return { ...v, canReceive: t.status === 'In transit' && (!scoped(c) || c.branchId === t.to_branch_id) };
  });
}));

/** A draft keeps the lines as typed (nothing has moved yet). */
const draftLines = (t: any) => (Array.isArray(t.lines) ? t.lines : []).map((l: any, i: number) => ({
  id: `draft-${i}`, lineNo: i + 1, itemId: l.itemId, name: l.name ?? '', unit: l.unit ?? '', hsn: '', taxRate: 0, batchNo: l.batchNo ?? '', expiryDate: null, season: '',
  serials: l.serials ?? [], qty: l.qty, qtyReceived: null, qtyDamaged: null, qtyMissing: null, unitCost: 0, sourcePrice: null, destPrice: l.destPrice ?? null, destPriceApplied: null,
  manualPrice: l.destPrice != null, priceRules: [],
}));

transfersRouter.get('/stock/transfers/:id', T(async (db, req, c) => {
  const t = await loadTransfer(db, c.shopId, req.params.id!);
  const v = serializeTransfer(t, await transferItems(db, t.id));
  if (t.status === 'Draft') v.lines = draftLines(t);
  const log = await many(db, 'SELECT event, user_name, detail, at FROM transfer_otp_logs WHERE transfer_id = $1 ORDER BY at DESC LIMIT 50', [t.id]);
  const recipient = t.status === 'Draft' || t.status === 'In transit' ? await otpRecipient(db, c.shopId, t.to_branch_id) : null;
  const others = await one(db, 'SELECT count(*)::int AS n FROM users WHERE shop_id = $1 AND active AND id <> $2', [c.shopId, c.id]);
  return {
    ...v,
    otp: t.status === 'In transit' ? await otpStatus(db, t.id) : null,
    recipient: recipient ? { name: recipient.name, email: maskEmail(recipient.email) } : null,
    otpLog: log.map((l) => ({ event: l.event, by: l.user_name, detail: l.detail, at: l.at })),
    can: {
      receive: t.status === 'In transit' && (!scoped(c) || c.branchId === t.to_branch_id) && (t.created_by !== c.id || others.n === 0) && c.permissions.includes('items.write'),
      ownerReceive: t.status === 'In transit' && c.role === 'Owner',
      resend: t.status === 'In transit' && c.permissions.includes('items.write') && (!scoped(c) || [t.to_branch_id, t.from_branch_id].includes(c.branchId!)),
      cancel: ['Draft', 'In transit'].includes(t.status) && c.permissions.includes('items.write') && (!scoped(c) || c.branchId === t.from_branch_id),
      senderIsMe: t.created_by === c.id,
    },
  };
}));

/** Saves a draft, or (initiate: true, the default for older clients) sends it straight away. */
transfersRouter.post('/stock/transfers', perm('items.write'), T(async (db, req, c, res) => {
  const b = parse(transferSchema.extend({ initiate: z.boolean().default(true), receiveNow: z.boolean().optional() }), req.body);
  if (b.receiveNow) throw badRequest('Transfers are received at the destination with the emailed code. “Received straight away” is no longer available.');
  res.status(201);
  if (!b.initiate) return saveDraft(db, req, c, await withNames(db, c.shopId, b));
  const out = await initiate(db, req, c, b);
  return { ...out.transfer, otp: out.otp };
}));

/** Draft lines carry the item name so the list can show them before anything is priced. */
async function withNames(db: Parameters<typeof saveDraft>[0], shopId: string, b: TransferInput): Promise<TransferInput> {
  const rows = await many(db, 'SELECT id, name, unit FROM items WHERE shop_id = $1 AND id = ANY($2::uuid[])', [shopId, b.lines.map((l) => l.itemId)]);
  const by = new Map(rows.map((r) => [r.id, r]));
  return { ...b, lines: b.lines.map((l) => ({ ...l, name: by.get(l.itemId)?.name ?? '', unit: by.get(l.itemId)?.unit ?? '' }) as never) };
}

transfersRouter.put('/stock/transfers/:id', perm('items.write'), T(async (db, req, c) => {
  const b = parse(transferSchema, req.body);
  return saveDraft(db, req, c, await withNames(db, c.shopId, b), req.params.id!);
}));

transfersRouter.post('/transfers/initiate', perm('items.write'), T(async (db, req, c, res) => {
  const b = parse(transferSchema.partial().extend({ transferId: z.string().uuid().optional() }), req.body);
  let input: TransferInput;
  if (b.transferId) {
    const t = await loadTransfer(db, c.shopId, b.transferId);
    const fromDraft = { fromBranchId: t.from_branch_id, toBranchId: t.to_branch_id, date: todayISO(), notes: t.notes, ewayBillNo: t.eway_bill_no, vehicleNo: t.vehicle_no, lines: t.lines };
    input = parse(transferSchema, { ...fromDraft, ...Object.fromEntries(Object.entries(b).filter(([k, v]) => v !== undefined && k !== 'transferId')) });
  } else input = parse(transferSchema, b);
  const out = await initiate(db, req, c, input, b.transferId);
  res.status(201);
  return { ...out.transfer, otp: out.otp };
}));

transfersRouter.post('/transfers/resend-otp', perm('items.write'), T(async (db, req, c) => {
  const b = parse(z.object({ transferId: z.string().uuid() }), req.body);
  const otp = await resendOtp(db, req, c, b.transferId);
  return { otp, status: await otpStatus(db, b.transferId) };
}));

transfersRouter.post('/transfers/verify-receipt', perm('items.write'), T(async (db, req, c, res) => {
  const b = parse(receiptSchema, req.body);
  return verifyReceipt(db, req, c, res, b.transferId, b);
}));

transfersRouter.post('/transfers/owner-receive', perm('items.write'), T(async (db, req, c) => {
  const b = parse(receiptSchema, req.body);
  return ownerReceive(db, req, c, b.transferId, b);
}));

/** The old one-click receive: receipts now need the emailed code (or the owner's override). */
transfersRouter.post('/stock/transfers/:id/receive', perm('items.write'), T(async (db, req, c) => {
  await loadTransfer(db, c.shopId, req.params.id!);
  throw new HttpError(409, 'Enter the receipt code emailed to the destination branch manager to receive this transfer.', 'otp_required');
}));

transfersRouter.post('/stock/transfers/:id/cancel', perm('items.write'), T(async (db, req, c) => {
  const b = parse(z.object({ reason: z.string().trim().max(500).default('') }), req.body ?? {});
  return cancelTransfer(db, req, c, req.params.id!, b.reason);
}));

transfersRouter.post('/transfers/price-preview', perm('items.write'), T(async (db, req, c) => {
  const b = parse(transferSchema.extend({ lines: z.array(lineSchema.extend({ qty: z.number().positive().max(1e9).default(1) })).min(1).max(200) }), req.body);
  const r = await otpRecipient(db, c.shopId, b.toBranchId);
  const recipient = r?.email ? { name: r.name as string, email: maskEmail(r.email) } : null;
  const plan = await planLines(db, c.shopId, b, false).catch((e) => { if (e instanceof HttpError && e.status === 400) return { error: e.message, code: e.code, details: e.details }; throw e; });
  if (!Array.isArray(plan)) return { ok: false, ...plan, recipient, lines: [] };
  return {
    ok: true, recipient,
    lines: plan.map((p) => ({ itemId: p.it.id, batchNo: p.batchNo, unitCost: p.unitCost, sourcePrice: p.sourcePrice, destPrice: p.price.price, base: p.price.base, applied: p.price.applied,
      belowCost: p.price.price < p.unitCost, expiryDate: p.expiry, season: p.season, hsn: p.it.hsn, taxRate: Number(p.it.tax_rate) })),
  };
}));

/* ---------- Batches and branch prices ---------- */

transfersRouter.get('/stock/batches', T(async (db, req, c) => {
  const q = parse(z.object({ itemId: z.string().uuid().optional(), branchId: z.string().uuid().optional(), all: z.string().optional() }), req.query);
  const rows = await many(db, `SELECT b.*, i.name AS item_name, i.unit, i.sp1, br.name AS branch_name, o.name AS origin_name
                               FROM item_batches b JOIN items i ON i.id = b.item_id JOIN branches br ON br.id = b.branch_id LEFT JOIN branches o ON o.id = b.origin_branch_id
                               WHERE b.shop_id = $1 ${q.itemId ? 'AND b.item_id = $2' : ''} ${q.branchId ? `AND b.branch_id = $${q.itemId ? 3 : 2}` : ''} ${q.all ? '' : 'AND b.qty > 0'}
                               ORDER BY b.expiry_date NULLS LAST, b.created_at LIMIT 1000`, [c.shopId, ...(q.itemId ? [q.itemId] : []), ...(q.branchId ? [q.branchId] : [])]);
  const canCost = c.permissions.includes('items.cost');
  return rows.map((b) => ({
    id: b.id, itemId: b.item_id, itemName: b.item_name, unit: b.unit, branchId: b.branch_id, branchName: b.branch_name, batchNo: b.batch_no, qty: Number(b.qty),
    expiryDate: b.expiry_date, receivedOn: b.received_on, season: b.season, originBranch: b.origin_name ?? null,
    unitCost: canCost && b.unit_cost != null ? Number(b.unit_cost) : null, sellingPrice: b.selling_price != null ? Number(b.selling_price) : Number(b.sp1),
  }));
}));

transfersRouter.patch('/stock/batches/:id', perm('items.write'), T(async (db, req, c) => {
  const b = parse(z.object({ season: z.string().trim().max(60).optional(), sellingPrice: z.number().min(0).max(1e9).nullable().optional() }), req.body);
  const row = await one(db, 'SELECT * FROM item_batches WHERE shop_id = $1 AND id = $2', [c.shopId, req.params.id]);
  if (!row) throw notFound('Batch');
  await db.query('UPDATE item_batches SET season = coalesce($2, season), selling_price = CASE WHEN $4 THEN $3 ELSE selling_price END WHERE id = $1',
    [row.id, b.season ?? null, b.sellingPrice ?? null, b.sellingPrice !== undefined]);
  await audit(db, req, c.shopId, 'update', 'item_batch', row.id, { batchNo: row.batch_no, ...b });
  req.audited = true;
  return { ok: true };
}));

transfersRouter.get('/stock/branch-prices', T(async (db, req, c) => {
  const q = parse(z.object({ branchId: z.string().uuid() }), req.query);
  const stock = await many(db, 'SELECT item_id, selling_price FROM item_stock WHERE shop_id = $1 AND branch_id = $2 AND selling_price IS NOT NULL', [c.shopId, q.branchId]);
  const batches = await many(db, 'SELECT item_id, batch_no, selling_price FROM item_batches WHERE shop_id = $1 AND branch_id = $2 AND selling_price IS NOT NULL AND qty > 0', [c.shopId, q.branchId]);
  const out: Record<string, { price: number | null; batches: Record<string, number> }> = {};
  for (const s of stock) out[s.item_id] = { price: Number(s.selling_price), batches: {} };
  for (const b of batches) (out[b.item_id] ??= { price: null, batches: {} }).batches[b.batch_no] = Number(b.selling_price);
  return out;
}));

/* ---------- Pricing rules ---------- */

const ruleSchema = z.object({
  name: z.string().trim().min(1, 'Name the rule').max(80),
  kind: z.enum(['location', 'seasonal']),
  branchId: z.string().uuid().nullable().default(null),
  itemId: z.string().uuid().nullable().default(null),
  category: z.string().trim().max(60).nullable().default(null),
  adjustType: z.enum(['percent', 'amount']),
  adjustValue: z.number().min(-1e7).max(1e7),
  startsOn: iso.nullable().default(null),
  endsOn: iso.nullable().default(null),
  priority: z.number().int().min(0).max(10000).default(100),
  roundTo: z.number().min(0).max(1000).default(0),
  active: z.boolean().default(true),
}).superRefine((r, ctx) => {
  if (r.adjustType === 'percent' && (r.adjustValue < -95 || r.adjustValue > 500)) ctx.addIssue({ code: 'custom', path: ['adjustValue'], message: 'Between −95 % and +500 %' });
  if (r.kind === 'seasonal' && (!r.startsOn || !r.endsOn)) ctx.addIssue({ code: 'custom', path: ['endsOn'], message: 'A seasonal rule needs start and end dates' });
  if (r.startsOn && r.endsOn && r.endsOn < r.startsOn) ctx.addIssue({ code: 'custom', path: ['endsOn'], message: 'Ends before it starts' });
});
const ruleCols = (r: z.infer<typeof ruleSchema>) => [r.name, r.kind, r.branchId, r.itemId, r.itemId ? null : r.category || null, r.adjustType, r.adjustValue,
  r.kind === 'seasonal' ? r.startsOn : null, r.kind === 'seasonal' ? r.endsOn : null, r.priority, r.roundTo, r.active];

async function checkRuleLinks(db: Parameters<typeof saveDraft>[0], shopId: string, r: z.infer<typeof ruleSchema>) {
  if (r.branchId && !(await one(db, 'SELECT 1 FROM branches WHERE shop_id = $1 AND id = $2', [shopId, r.branchId]))) throw badRequest('Unknown branch', { branchId: 'Pick a branch' });
  if (r.itemId && !(await one(db, 'SELECT 1 FROM items WHERE shop_id = $1 AND id = $2', [shopId, r.itemId]))) throw badRequest('Unknown item', { itemId: 'Pick an item' });
}

transfersRouter.get('/pricing-rules', perm('items.write'), T(async (db, _req, c) =>
  (await many(db, 'SELECT * FROM branch_pricing_rules WHERE shop_id = $1 ORDER BY kind, priority, name', [c.shopId])).map(ruleRow)));

transfersRouter.post('/pricing-rules', perm('items.write'), T(async (db, req, c, res) => {
  const r = parse(ruleSchema, req.body);
  await checkRuleLinks(db, c.shopId, r);
  const row = await one(db, `INSERT INTO branch_pricing_rules (shop_id, name, kind, branch_id, item_id, category, adjust_type, adjust_value, starts_on, ends_on, priority, round_to, active, created_by)
                             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`, [c.shopId, ...ruleCols(r), c.homeShopId === c.shopId ? c.id : null]);
  await audit(db, req, c.shopId, 'create', 'pricing_rule', row.id, { name: r.name, kind: r.kind, change: `${r.adjustValue}${r.adjustType === 'percent' ? '%' : ''}` });
  req.audited = true;
  res.status(201);
  return ruleRow(row);
}));

transfersRouter.patch('/pricing-rules/:id', perm('items.write'), T(async (db, req, c) => {
  const cur = await one(db, 'SELECT * FROM branch_pricing_rules WHERE shop_id = $1 AND id = $2', [c.shopId, req.params.id]);
  if (!cur) throw notFound('Pricing rule');
  const r = parse(ruleSchema, { ...ruleRow(cur), ...req.body });
  await checkRuleLinks(db, c.shopId, r);
  const row = await one(db, `UPDATE branch_pricing_rules SET name=$3, kind=$4, branch_id=$5, item_id=$6, category=$7, adjust_type=$8, adjust_value=$9, starts_on=$10, ends_on=$11,
                               priority=$12, round_to=$13, active=$14, updated_at = now() WHERE shop_id = $1 AND id = $2 RETURNING *`, [c.shopId, cur.id, ...ruleCols(r)]);
  await audit(db, req, c.shopId, 'update', 'pricing_rule', cur.id, { from: ruleRow(cur), to: ruleRow(row) });
  req.audited = true;
  return ruleRow(row);
}));

/** Rules hold no history of their own (transfers keep a copy of the rules they used), so they can be deleted. */
transfersRouter.delete('/pricing-rules/:id', perm('items.write'), T(async (db, req, c) => {
  const cur = await one(db, 'DELETE FROM branch_pricing_rules WHERE shop_id = $1 AND id = $2 RETURNING *', [c.shopId, req.params.id]);
  if (!cur) throw notFound('Pricing rule');
  await audit(db, req, c.shopId, 'delete', 'pricing_rule', cur.id, { ...ruleRow(cur) });
  req.audited = true;
  return { ok: true };
}));

