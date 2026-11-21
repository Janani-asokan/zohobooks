/**
 * Inter-branch stock transfers: batch-checked dispatch into "in transit", destination pricing, and receipt confirmed
 * by a 6-digit code emailed to the destination branch's manager. Rules: shared/transfers.ts. Design:
 * docs/stock-transfers.md.
 */
import crypto from 'node:crypto';
import type { Request, Response } from 'express';
import { audit } from '../audit';
import { todayISO, type UserCtx } from '../auth';
import { config } from '../config';
import { many, one, type Db } from '../db';
import { HttpError, badRequest, conflict, notFound } from '../http';
import { sendMail } from '../mailer';
import { nextSeq } from './common';
import { moveStock } from './stock';
import {
  blendCost, destinationPrice, maskEmail, OTP, otpState, receiptError, withManualPrice, type PricingRule, type PriceResult,
} from '../../../shared/transfers';

const r3 = (n: number) => Math.round(n * 1000) / 1000;
const d10 = (v: unknown) => (v instanceof Date ? new Date(v.getTime() - v.getTimezoneOffset() * 60000).toISOString().slice(0, 10) : (v as string | null));
/** Staff tied to a branch act only for it; the owner and unassigned staff act for every branch. */
export const scoped = (c: UserCtx) => c.role !== 'Owner' && !!c.branchId;
const mine = (c: UserCtx, shopId: string) => (c.homeShopId === shopId ? c.id : null); // users from another shop keep a name, not a link

export interface TransferLineInput { itemId: string; batchNo?: string | null; qty: number; serials?: string[]; destPrice?: number | null }
export interface TransferInput {
  fromBranchId: string; toBranchId: string; date: string; notes: string; ewayBillNo: string; vehicleNo: string; lines: TransferLineInput[];
}

/* ======================= Reading ======================= */

const TR_SQL = `SELECT t.*, f.name AS from_name, f.gstin AS from_gstin, f.state AS from_state, f.address AS from_address,
                       d.name AS to_name, d.gstin AS to_gstin, d.state AS to_state, d.address AS to_address
                  FROM stock_transfers t JOIN branches f ON f.id = t.from_branch_id JOIN branches d ON d.id = t.to_branch_id WHERE t.shop_id = $1`;

export async function loadTransfer(db: Db, shopId: string, id: string, lock = false) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound('Transfer');
  const t = await one(db, `${TR_SQL} AND t.id = $2`, [shopId, id]);
  if (!t) throw notFound('Transfer');
  if (lock) await db.query('SELECT 1 FROM stock_transfers WHERE id = $1 FOR UPDATE', [id]);
  return t;
}
export const transferItems = (db: Db, id: string) => many(db, 'SELECT * FROM stock_transfer_items WHERE transfer_id = $1 ORDER BY line_no', [id]);

const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
export function serializeTransfer(t: any, items: any[]) {
  const lines = items.map((i) => ({
    id: i.id, lineNo: i.line_no, itemId: i.item_id, name: i.name, unit: i.unit, hsn: i.hsn, taxRate: Number(i.tax_rate), batchNo: i.batch_no, expiryDate: d10(i.expiry_date),
    season: i.season, serials: i.serials ?? [], qty: Number(i.qty_sent), qtyReceived: num(i.qty_received), qtyDamaged: num(i.qty_damaged), qtyMissing: num(i.qty_missing),
    unitCost: Number(i.unit_cost), sourcePrice: num(i.source_price), destPrice: num(i.dest_price), destPriceApplied: num(i.dest_price_applied), manualPrice: i.manual_price, priceRules: i.price_rules,
  }));
  return {
    id: t.id, number: t.number, status: t.status as 'Draft' | 'In transit' | 'Received' | 'Cancelled', date: d10(t.date),
    fromBranchId: t.from_branch_id, fromName: t.from_name, fromGstin: t.from_gstin ?? '', fromState: t.from_state ?? '', fromAddress: t.from_address ?? '',
    toBranchId: t.to_branch_id, toName: t.to_name, toGstin: t.to_gstin ?? '', toState: t.to_state ?? '', toAddress: t.to_address ?? '',
    notes: t.notes, ewayBillNo: t.eway_bill_no ?? '', vehicleNo: t.vehicle_no ?? '', createdBy: t.created_by_name, createdById: t.created_by, createdAt: t.created_at,
    dispatchedAt: t.dispatched_at, receivedAt: t.received_at, receivedBy: t.received_by_name || null, verifiedVia: t.verified_via, overrideReason: t.override_reason ?? '',
    discrepancyNote: t.discrepancy_note ?? '', lossValue: Number(t.loss_value ?? 0), cancelledAt: t.cancelled_at,
    value: Math.round(lines.reduce((s, l) => s + l.qty * l.unitCost, 0) * 100) / 100,
    lines,
  };
}
export type TransferView = ReturnType<typeof serializeTransfer>;

export async function getTransfer(db: Db, shopId: string, id: string) {
  const t = await loadTransfer(db, shopId, id);
  return serializeTransfer(t, await transferItems(db, t.id));
}

/* ======================= Pricing ======================= */

const ruleRow = (r: any): PricingRule => ({
  id: r.id, name: r.name, kind: r.kind, branchId: r.branch_id, itemId: r.item_id, category: r.category, adjustType: r.adjust_type, adjustValue: Number(r.adjust_value),
  startsOn: d10(r.starts_on), endsOn: d10(r.ends_on), priority: r.priority, roundTo: Number(r.round_to), active: r.active,
});
export const pricingRules = async (db: Db, shopId: string) => (await many(db, 'SELECT * FROM branch_pricing_rules WHERE shop_id = $1', [shopId])).map(ruleRow);
export { ruleRow };

/** The destination's selling price for an item: its standard price with the branch's location and seasonal rules. */
export function priceAt(item: { id: string; sp1: unknown; category: string | null }, branchId: string, date: string, rules: PricingRule[], manual?: number | null): PriceResult {
  return withManualPrice(destinationPrice(Number(item.sp1), rules, { branchId, itemId: item.id, category: item.category ?? '', date }), manual);
}

/** The price an item sells at in a branch now: the batch's, else the branch's, else the standard price. */
export async function branchSellingPrice(db: Db, itemId: string, branchId: string, batchNo?: string | null) {
  if (batchNo) {
    const b = await one(db, 'SELECT selling_price FROM item_batches WHERE item_id = $1 AND branch_id = $2 AND batch_no = $3', [itemId, branchId, batchNo]);
    if (b?.selling_price != null) return Number(b.selling_price);
  }
  const s = await one(db, 'SELECT selling_price FROM item_stock WHERE item_id = $1 AND branch_id = $2', [itemId, branchId]);
  return s?.selling_price != null ? Number(s.selling_price) : null;
}

/* ======================= Initiate (dispatch) ======================= */

async function items(db: Db, shopId: string, ids: string[]) {
  const rows = await many(db, `SELECT i.id, i.name, i.unit, i.hsn, i.type, i.cost, i.sp1, i.category, i.is_group, i.track_batches, i.track_serials, t.rate AS tax_rate
                               FROM items i JOIN tax_slabs t ON t.id = i.tax_slab_id WHERE i.shop_id = $1 AND i.id = ANY($2::uuid[]) AND NOT i.archived`, [shopId, ids]);
  const byId = new Map(rows.map((r) => [r.id, r]));
  for (const id of ids) {
    const it = byId.get(id);
    if (!it) throw badRequest('One of the items no longer exists');
    if (it.type !== 'Goods') throw badRequest(`${it.name} is a service and has no stock`);
    if (it.is_group) throw badRequest(`${it.name} has variants. Choose a size or colour instead.`);
  }
  return byId;
}

export async function checkRoute(db: Db, c: UserCtx, shopId: string, fromBranchId: string, toBranchId: string) {
  if (fromBranchId === toBranchId) throw badRequest('Choose two different branches', { toBranchId: 'Same as the source' });
  const br = await many(db, 'SELECT id FROM branches WHERE shop_id = $1 AND id = ANY($2::uuid[])', [shopId, [fromBranchId, toBranchId]]);
  if (br.length !== 2) throw badRequest('Unknown branch');
  // Staff tied to one branch send only from their own branch (the owner acts for every branch).
  if (scoped(c) && c.branchId !== fromBranchId) throw new HttpError(403, 'You can send stock only from your own branch', 'branch_scope');
}

/** Checks lines and works out batch, cost and destination price, without moving anything (also the price preview). */
export async function planLines(db: Db, shopId: string, input: Pick<TransferInput, 'fromBranchId' | 'toBranchId' | 'date' | 'lines'>, lock: boolean) {
  const byId = await items(db, shopId, [...new Set(input.lines.map((l) => l.itemId))]);
  const rules = await pricingRules(db, shopId);
  // The same item and batch on two lines draws on the same stock.
  const want = new Map<string, number>();
  for (const l of input.lines) { const k = `${l.itemId}|${(l.batchNo ?? '').trim()}`; want.set(k, r3((want.get(k) ?? 0) + l.qty)); }
  const plan = [];
  for (const l of input.lines) {
    const it = byId.get(l.itemId)!;
    const batchNo = (l.batchNo ?? '').trim();
    let unitCost = Number(it.cost);
    let expiry: string | null = null;
    let season = '';
    if (it.track_batches) {
      if (!batchNo) throw badRequest(`Pick the batch of ${it.name} to send`, { batchNo: 'Pick a batch' });
      const b = await one(db, `SELECT * FROM item_batches WHERE item_id = $1 AND branch_id = $2 AND batch_no = $3${lock ? ' FOR UPDATE' : ''}`, [it.id, input.fromBranchId, batchNo]);
      if (!b) throw badRequest(`Batch ${batchNo} of ${it.name} isn’t at the source branch`, { batchNo: 'Not at this branch' });
      const need = want.get(`${it.id}|${batchNo}`)!;
      if (Number(b.qty) < need - 0.0005)
        throw new HttpError(400, `Batch ${batchNo} of ${it.name} has only ${Number(b.qty)} ${it.unit} at the source branch; ${need} asked for.`, 'insufficient_batch_stock',
          { itemId: it.id, batchNo, available: Number(b.qty), requested: need });
      if (b.unit_cost != null) unitCost = Number(b.unit_cost);
      expiry = d10(b.expiry_date);
      season = b.season ?? '';
    } else if (batchNo) throw badRequest(`${it.name} isn’t tracked by batch; leave the batch empty`);
    const have = Number((await one(db, `SELECT qty FROM item_stock WHERE item_id = $1 AND branch_id = $2${lock ? ' FOR UPDATE' : ''}`, [it.id, input.fromBranchId]))?.qty ?? 0);
    const needAll = r3([...want.entries()].filter(([k]) => k.startsWith(`${it.id}|`)).reduce((s, [, q]) => s + q, 0));
    if (have < needAll - 0.0005) throw new HttpError(400, `Only ${have} ${it.unit} of ${it.name} at the source branch; ${needAll} asked for.`, 'insufficient_stock', { itemId: it.id, available: have, requested: needAll });
    if (it.track_serials && (!l.serials || new Set(l.serials.map((s) => s.trim())).size !== l.qty))
      throw badRequest(`${it.name} needs ${l.qty} serial number${l.qty === 1 ? '' : 's'}`);
    const sourcePrice = (await branchSellingPrice(db, it.id, input.fromBranchId, batchNo || null)) ?? Number(it.sp1);
    const price = priceAt(it, input.toBranchId, input.date, rules, l.destPrice);
    plan.push({ it, line: l, batchNo, unitCost, expiry, season, sourcePrice, price });
  }
  return plan;
}

/** Who gets the receipt code: the branch's named manager, else a manager working at that branch, else the owner. */
export async function otpRecipient(db: Db, shopId: string, branchId: string) {
  const named = await one(db, `SELECT u.id, u.name, u.email FROM branches b JOIN users u ON u.id = b.manager_user_id
                               WHERE b.shop_id = $1 AND b.id = $2 AND u.active AND u.email <> ''`, [shopId, branchId]);
  if (named) return named;
  const mgr = await one(db, "SELECT id, name, email FROM users WHERE shop_id = $1 AND branch_id = $2 AND role = 'Manager' AND active AND email <> '' ORDER BY created_at LIMIT 1", [shopId, branchId]);
  if (mgr) return mgr;
  return one(db, "SELECT id, name, email FROM users WHERE shop_id = $1 AND role = 'Owner' AND active ORDER BY created_at LIMIT 1", [shopId]);
}

export async function saveDraft(db: Db, req: Request, c: UserCtx, input: TransferInput, existingId?: string) {
  await checkRoute(db, c, c.shopId, input.fromBranchId, input.toBranchId);
  await items(db, c.shopId, [...new Set(input.lines.map((l) => l.itemId))]);
  let id = existingId;
  if (id) {
    const t = await loadTransfer(db, c.shopId, id, true);
    if (t.status !== 'Draft') throw conflict(`This transfer is ${t.status.toLowerCase()}; only drafts can be edited`);
    await db.query(`UPDATE stock_transfers SET from_branch_id = $3, to_branch_id = $4, date = $5, notes = $6, eway_bill_no = $7, vehicle_no = $8, lines = $9
                    WHERE shop_id = $1 AND id = $2`, [c.shopId, id, input.fromBranchId, input.toBranchId, input.date, input.notes, input.ewayBillNo, input.vehicleNo, JSON.stringify(input.lines)]);
  } else {
    const number = `TR-${String(await nextSeq(db, c.shopId, 'tr')).padStart(4, '0')}`;
    id = (await one(db, `INSERT INTO stock_transfers (shop_id, number, from_branch_id, to_branch_id, date, status, lines, notes, eway_bill_no, vehicle_no, created_by, created_by_name)
                         VALUES ($1,$2,$3,$4,$5,'Draft',$6,$7,$8,$9,$10,$11) RETURNING id`,
    [c.shopId, number, input.fromBranchId, input.toBranchId, input.date, JSON.stringify(input.lines), input.notes, input.ewayBillNo, input.vehicleNo, c.id, c.name])).id;
  }
  await audit(db, req, c.shopId, existingId ? 'update_draft' : 'create_draft', 'stock_transfer', id);
  req.audited = true;
  return getTransfer(db, c.shopId, id!);
}

/**
 * Initiate: checks the batch stock, takes the units out of the source batch, puts the transfer in transit, prices the
 * lines for the destination, and emails the receipt code. The destination's stock is untouched until the code is
 * entered there. A draft keeps its number; otherwise a new transfer is made.
 */
export async function initiate(db: Db, req: Request, c: UserCtx, input: TransferInput, draftId?: string) {
  await checkRoute(db, c, c.shopId, input.fromBranchId, input.toBranchId);
  if (input.date > todayISO()) throw badRequest('A transfer can’t be dated in the future', { date: 'Today or earlier' });
  const recipient = await otpRecipient(db, c.shopId, input.toBranchId);
  if (!recipient?.email) throw badRequest('The destination branch has no manager with an email to send the receipt code to. Set one on the Warehouses page.');
  const plan = await planLines(db, c.shopId, input, true);

  let t: any;
  if (draftId) {
    t = await loadTransfer(db, c.shopId, draftId, true);
    if (t.status !== 'Draft') throw conflict(`This transfer is already ${t.status.toLowerCase()}`);
    await db.query(`UPDATE stock_transfers SET status = 'In transit', from_branch_id = $3, to_branch_id = $4, date = $5, notes = $6, eway_bill_no = $7, vehicle_no = $8,
                      lines = '[]', dispatched_at = now() WHERE shop_id = $1 AND id = $2`,
    [c.shopId, draftId, input.fromBranchId, input.toBranchId, input.date, input.notes, input.ewayBillNo, input.vehicleNo]);
    t = await loadTransfer(db, c.shopId, draftId);
  } else {
    const number = `TR-${String(await nextSeq(db, c.shopId, 'tr')).padStart(4, '0')}`;
    const id = (await one(db, `INSERT INTO stock_transfers (shop_id, number, from_branch_id, to_branch_id, date, status, lines, notes, eway_bill_no, vehicle_no, created_by, created_by_name, dispatched_at)
                               VALUES ($1,$2,$3,$4,$5,'In transit','[]',$6,$7,$8,$9,$10, now()) RETURNING id`,
    [c.shopId, number, input.fromBranchId, input.toBranchId, input.date, input.notes, input.ewayBillNo, input.vehicleNo, c.id, c.name])).id;
    t = await loadTransfer(db, c.shopId, id);
  }

  let lineNo = 0;
  for (const p of plan) {
    const serials = p.it.track_serials ? [...new Set((p.line.serials ?? []).map((s) => s.trim()))] : [];
    if (serials.length) {
      const ok = await many(db, "SELECT id FROM item_serials WHERE shop_id = $1 AND item_id = $2 AND branch_id = $3 AND status = 'In stock' AND serial = ANY($4::text[]) FOR UPDATE", [c.shopId, p.it.id, input.fromBranchId, serials]);
      if (ok.length !== serials.length) throw badRequest(`Some serial numbers of ${p.it.name} aren’t in stock at the source branch`);
      await db.query("UPDATE item_serials SET status = 'In transit', updated_at = now() WHERE id = ANY($1::uuid[])", [ok.map((x) => x.id)]);
    }
    // planLines checked the batch has enough, under lock, so this takes exactly this batch's units.
    await moveStock(db, { shopId: c.shopId, itemId: p.it.id, branchId: input.fromBranchId, qty: -p.line.qty, reason: 'transfer_out', refType: 'stock_transfer', refId: t.id,
      note: t.number, userId: c.id, batchNo: p.batchNo || undefined });
    await db.query(`INSERT INTO stock_transfer_items (shop_id, transfer_id, line_no, item_id, name, unit, hsn, tax_rate, batch_no, expiry_date, season, serials, qty_sent,
                      unit_cost, source_price, dest_price, manual_price, price_rules)
                    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
    [c.shopId, t.id, ++lineNo, p.it.id, p.it.name, p.it.unit, p.it.hsn, p.it.tax_rate, p.batchNo, p.expiry, p.season, serials, p.line.qty, p.unitCost, p.sourcePrice,
      p.price.price, p.price.applied.some((a) => a.kind === 'manual'), JSON.stringify(p.price.applied)]);
  }
  await audit(db, req, c.shopId, 'dispatch', 'stock_transfer', t.id, { number: t.number, lines: plan.length, to: t.to_name });
  req.audited = true;
  const otp = await issueOtp(db, req, c, t, recipient, 'sent');
  return { transfer: await getTransfer(db, c.shopId, t.id), otp };
}

/* ======================= OTP ======================= */

const hash = (salt: string, otpId: string, code: string) =>
  crypto.createHash('sha256').update(`${salt}:${otpId}:${code}:${process.env.OTP_PEPPER ?? ''}`).digest('hex');

async function otpLog(db: Db, req: Request | null, shopId: string, transferId: string, otpId: string | null, event: string, detail: object = {}) {
  const c = req?.ctx?.kind === 'user' ? req.ctx : null;
  await db.query(`INSERT INTO transfer_otp_logs (shop_id, transfer_id, otp_id, event, user_id, user_name, ip, detail) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [shopId, transferId, otpId, event, c ? mine(c, shopId) : null, c?.name ?? 'System', (req?.ip ?? '').slice(0, 60), JSON.stringify(detail)]);
}

/** Makes a fresh code (the earlier one stops working), stores only its salted hash, and emails it. */
async function issueOtp(db: Db, req: Request, c: UserCtx, t: any, recipient: { id: string; name: string; email: string }, event: 'sent' | 'resent') {
  const code = String(crypto.randomInt(0, 10 ** OTP.digits)).padStart(OTP.digits, '0');
  const salt = crypto.randomBytes(12).toString('hex');
  await db.query('UPDATE transfer_otps SET superseded_at = now() WHERE transfer_id = $1 AND used_at IS NULL AND superseded_at IS NULL', [t.id]);
  const id = crypto.randomUUID();
  const expires = new Date(Date.now() + OTP.ttlMinutes * 60_000);
  await db.query(`INSERT INTO transfer_otps (id, shop_id, transfer_id, code_hash, sent_to_user_id, sent_to_email, expires_at) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [id, c.shopId, t.id, `${salt}:${hash(salt, id, code)}`, recipient.id, recipient.email, expires]);
  let delivered = false;
  let error = '';
  try {
    const lines = await transferItems(db, t.id);
    delivered = await sendMail({
      kind: 'transfer_code', shopId: c.shopId,
      to: recipient.email,
      // The code is only in the body: subjects show on lock screens and are written to server logs.
      subject: `Receipt code for stock transfer ${t.number} to ${t.to_name}`,
      text: `Hi ${recipient.name},\n\nStock transfer ${t.number} is on its way from ${t.from_name} to ${t.to_name}:\n`
        + lines.map((l) => `  • ${l.name}${l.batch_no ? ` (batch ${l.batch_no})` : ''}: ${Number(l.qty_sent)} ${l.unit}`).join('\n')
        + `\n\nWhen the goods arrive and you have checked them, open the transfer and enter this code to add them to ${t.to_name}'s stock:\n\n    ${code}\n\n`
        + `The code works for ${OTP.ttlMinutes} minutes and ${OTP.maxAttempts} tries. If it runs out, use “Resend code” on the transfer.\n`
        + `Don't share this code with the person who sent the goods.\n\n${config.appUrl}/app/inventory/transfers?open=${t.id}`,
    });
  } catch (e) {
    error = (e as Error).message;
  }
  await db.query('UPDATE transfer_otps SET delivered = $2 WHERE id = $1', [id, delivered]);
  await otpLog(db, req, c.shopId, t.id, id, delivered ? event : 'send_failed', { to: maskEmail(recipient.email), ...(error ? { error: error.slice(0, 200) } : {}) });
  return { sentTo: maskEmail(recipient.email), recipientName: recipient.name, delivered, expiresAt: expires.toISOString(), error: delivered ? null : error || 'No email service is set up on the server' };
}

/** The current code's state, for the screen (never the code itself). */
export async function otpStatus(db: Db, transferId: string) {
  const o = await one(db, 'SELECT * FROM transfer_otps WHERE transfer_id = $1 AND superseded_at IS NULL ORDER BY created_at DESC LIMIT 1', [transferId]);
  const sends = await one(db, "SELECT count(*)::int AS n, max(created_at) AS last FROM transfer_otps WHERE transfer_id = $1 AND created_at > now() - interval '24 hours'", [transferId]);
  const now = new Date();
  const resendAt = sends.last ? new Date(new Date(sends.last).getTime() + OTP.resendSeconds * 1000) : now;
  return {
    sentTo: o ? maskEmail(o.sent_to_email) : null, delivered: o?.delivered ?? false, expiresAt: o?.expires_at ?? null,
    state: otpState(o ? { expiresAt: new Date(o.expires_at), attempts: o.attempts, usedAt: o.used_at } : null, now),
    attemptsLeft: o ? Math.max(0, OTP.maxAttempts - o.attempts) : 0,
    resendAvailableAt: resendAt.toISOString(), sendsLeftToday: Math.max(0, OTP.maxSendsPerDay - sends.n),
  };
}

/** Who may receive into a branch: stock permission, working at that branch (or all branches), and not the sender. */
async function assertReceiver(db: Db, c: UserCtx, t: any) {
  if (scoped(c) && c.branchId !== t.to_branch_id) throw new HttpError(403, `Only staff at ${t.to_name} can confirm this receipt`, 'branch_scope');
  if (t.created_by === c.id) {
    // A one-person shop has nobody else to receive; everywhere else the sender can't confirm their own transfer.
    const others = await one(db, "SELECT count(*)::int AS n FROM users WHERE shop_id = $1 AND active AND id <> $2", [c.shopId, c.id]);
    if (others.n > 0) throw new HttpError(403, 'The person who sent the stock can’t confirm its receipt. Someone at the destination branch must enter the code.', 'sender_cannot_receive');
  }
}

export async function resendOtp(db: Db, req: Request, c: UserCtx, transferId: string) {
  const t = await loadTransfer(db, c.shopId, transferId, true);
  if (t.status !== 'In transit') throw conflict(`This transfer is ${t.status.toLowerCase()}`);
  if (scoped(c) && c.branchId !== t.to_branch_id && c.branchId !== t.from_branch_id) throw new HttpError(403, 'Only staff at either branch can resend the code', 'branch_scope');
  const s = await otpStatus(db, t.id);
  const wait = Math.ceil((new Date(s.resendAvailableAt).getTime() - Date.now()) / 1000);
  if (wait > 0) throw new HttpError(429, `Please wait ${wait} seconds before sending another code`, 'otp_cooldown', { retryInSeconds: wait });
  if (s.sendsLeftToday <= 0) throw new HttpError(429, `${OTP.maxSendsPerDay} codes were sent for this transfer in the last 24 hours. Try again later or ask the owner to receive it.`, 'otp_send_limit');
  const recipient = await otpRecipient(db, c.shopId, t.to_branch_id);
  if (!recipient?.email) throw badRequest('The destination branch has no manager with an email');
  return issueOtp(db, req, c, t, recipient, 'resent');
}

export interface ReceiptInput {
  otp?: string; reason?: string; note: string;
  lines?: Array<{ lineId: string; received: number; damaged: number; missing: number }>;
}

/**
 * Verifies the code and completes the receipt. A wrong code is answered with 400 but the failed try is SAVED (the
 * request returns normally so the transaction commits), so retries can't be had by making requests fail.
 */
export async function verifyReceipt(db: Db, req: Request, c: UserCtx, res: Response, transferId: string, input: ReceiptInput) {
  const t = await loadTransfer(db, c.shopId, transferId, true);
  if (t.status !== 'In transit') throw conflict(`This transfer is already ${t.status.toLowerCase()}`);
  await assertReceiver(db, c, t);
  const code = (input.otp ?? '').replace(/\s/g, '');
  if (!new RegExp(`^\\d{${OTP.digits}}$`).test(code)) throw badRequest(`Enter the ${OTP.digits}-digit code from the email`, { otp: `${OTP.digits} digits` });
  const o = await one(db, 'SELECT * FROM transfer_otps WHERE transfer_id = $1 AND superseded_at IS NULL ORDER BY created_at DESC LIMIT 1 FOR UPDATE', [t.id]);
  const state = otpState(o ? { expiresAt: new Date(o.expires_at), attempts: o.attempts, usedAt: o.used_at } : null, new Date());
  const fail = (status: number, message: string, errCode: string, details: object = {}) => { res.status(status); return { error: message, code: errCode, details }; };
  if (state === 'none') return fail(409, 'There is no active code for this transfer. Send a new one.', 'otp_none');
  if (state === 'locked') return fail(423, 'Too many wrong tries. Send a new code.', 'otp_locked');
  if (state === 'expired') { await otpLog(db, req, c.shopId, t.id, o.id, 'expired'); return fail(410, 'This code has expired. Send a new one.', 'otp_expired'); }
  const [salt, stored] = String(o.code_hash).split(':');
  const ok = crypto.timingSafeEqual(Buffer.from(stored!, 'hex'), Buffer.from(hash(salt!, o.id, code), 'hex'));
  if (!ok) {
    const attempts = o.attempts + 1;
    await db.query('UPDATE transfer_otps SET attempts = $2 WHERE id = $1', [o.id, attempts]);
    const left = OTP.maxAttempts - attempts;
    await otpLog(db, req, c.shopId, t.id, o.id, left <= 0 ? 'locked' : 'verify_failed', { attemptsLeft: left });
    return left <= 0 ? fail(423, 'Wrong code. That was the last try: send a new code.', 'otp_locked', { attemptsLeft: 0 })
      : fail(400, `Wrong code. ${left} ${left === 1 ? 'try' : 'tries'} left.`, 'otp_wrong', { attemptsLeft: left });
  }
  await db.query('UPDATE transfer_otps SET used_at = now() WHERE id = $1', [o.id]);
  await completeReceipt(db, req, c, t, input, 'otp');
  await otpLog(db, req, c.shopId, t.id, o.id, 'verified');
  return getTransfer(db, c.shopId, t.id);
}

/** Owner only: receive without a code (email down, manager away), with a reason. Recorded as an override. */
export async function ownerReceive(db: Db, req: Request, c: UserCtx, transferId: string, input: ReceiptInput) {
  if (c.role !== 'Owner') throw new HttpError(403, 'Only the owner can receive a transfer without the code', 'owner_only');
  const reason = (input.reason ?? '').trim();
  if (reason.length < 10) throw badRequest('Write why the code isn’t being used (at least 10 characters)', { reason: 'At least 10 characters' });
  const t = await loadTransfer(db, c.shopId, transferId, true);
  if (t.status !== 'In transit') throw conflict(`This transfer is already ${t.status.toLowerCase()}`);
  await db.query('UPDATE transfer_otps SET superseded_at = now() WHERE transfer_id = $1 AND used_at IS NULL AND superseded_at IS NULL', [t.id]);
  await completeReceipt(db, req, c, t, input, 'owner_override', reason);
  await otpLog(db, req, c.shopId, t.id, null, 'owner_override', { reason });
  return getTransfer(db, c.shopId, t.id);
}

/**
 * Puts what arrived into the destination's stock under the same batch, carrying the batch's purchase cost and setting
 * the destination's selling price (its rules on the day of receipt, unless the sender set a price by hand). Damaged
 * and missing units are not added; their cost is the transit loss.
 */
async function completeReceipt(db: Db, req: Request, c: UserCtx, t: any, input: ReceiptInput, via: 'otp' | 'owner_override', reason = '') {
  const rows = await transferItems(db, t.id);
  const given = new Map((input.lines ?? []).map((l) => [l.lineId, l]));
  const rules = await pricingRules(db, c.shopId);
  const today = todayISO();
  let loss = 0;
  let short = false;
  for (const r of rows) {
    const g = given.get(r.id);
    const sent = Number(r.qty_sent);
    const rec = { qtySent: sent, received: g ? g.received : sent, damaged: g?.damaged ?? 0, missing: g?.missing ?? 0 };
    const err = receiptError(rec);
    if (err) throw badRequest(`${r.name}${r.batch_no ? ` (batch ${r.batch_no})` : ''}: ${err}`, { [`lines.${r.id}`]: err });
    if (rec.received < sent) short = true;
    if (r.serials?.length && rec.received < sent) throw badRequest(`${r.name} has serial numbers: receive it in full, then write off the damaged units by serial number`);
    const item = await one(db, 'SELECT id, sp1, category, track_batches FROM items WHERE id = $1', [r.item_id]);
    const price = r.manual_price ? { price: Number(r.dest_price), applied: r.price_rules } : priceAt(item, t.to_branch_id, today, rules);
    if (rec.received > 0) {
      const before = r.batch_no ? await one(db, 'SELECT qty, unit_cost FROM item_batches WHERE item_id = $1 AND branch_id = $2 AND batch_no = $3 FOR UPDATE', [r.item_id, t.to_branch_id, r.batch_no]) : null;
      await moveStock(db, { shopId: c.shopId, itemId: r.item_id, branchId: t.to_branch_id, qty: rec.received, reason: 'transfer_in', refType: 'stock_transfer', refId: t.id,
        note: t.number, userId: c.id, batchNo: r.batch_no || undefined, expiryDate: d10(r.expiry_date) });
      if (r.batch_no && item.track_batches) {
        const cost = blendCost(Number(before?.qty ?? 0), before?.unit_cost == null ? null : Number(before.unit_cost), rec.received, Number(r.unit_cost));
        await db.query(`UPDATE item_batches SET unit_cost = $4, selling_price = $5, season = CASE WHEN season = '' THEN $6 ELSE season END,
                          origin_branch_id = coalesce(origin_branch_id, $7), received_on = coalesce(received_on, $8)
                        WHERE item_id = $1 AND branch_id = $2 AND batch_no = $3`,
        [r.item_id, t.to_branch_id, r.batch_no, cost, price.price, r.season, t.from_branch_id, today]);
      }
      // The branch's selling price for the item (bills that don't name a batch, and the billing screens, use it).
      await db.query('UPDATE item_stock SET selling_price = $3 WHERE item_id = $1 AND branch_id = $2', [r.item_id, t.to_branch_id, price.price]);
      if (r.serials?.length) await db.query("UPDATE item_serials SET status = 'In stock', branch_id = $4, updated_at = now() WHERE shop_id = $1 AND item_id = $2 AND serial = ANY($3::text[]) AND status = 'In transit'", [c.shopId, r.item_id, r.serials, t.to_branch_id]);
    }
    loss += (rec.damaged + rec.missing) * Number(r.unit_cost);
    await db.query(`UPDATE stock_transfer_items SET qty_received = $2, qty_damaged = $3, qty_missing = $4, dest_price_applied = $5, price_rules = $6 WHERE id = $1`,
      [r.id, rec.received, rec.damaged, rec.missing, rec.received > 0 ? price.price : null, JSON.stringify(price.applied)]);
  }
  const note = input.note.trim();
  if (short && note.length < 5) throw badRequest('Say what happened to the damaged or missing units', { note: 'Describe the damage or shortage' });
  await db.query(`UPDATE stock_transfers SET status = 'Received', received_at = now(), received_by = $3, received_by_name = $4, verified_via = $5, override_reason = $6,
                    discrepancy_note = $7, loss_value = $8 WHERE shop_id = $1 AND id = $2`,
  [c.shopId, t.id, mine(c, c.shopId), c.name, via, reason, note, Math.round(loss * 100) / 100]);
  await audit(db, req, c.shopId, via === 'otp' ? 'receive_verified' : 'receive_override', 'stock_transfer', t.id,
    { number: t.number, via, ...(reason ? { reason } : {}), ...(short ? { lossValue: Math.round(loss * 100) / 100, note } : {}) });
  req.audited = true;
}

/** Cancel while in transit (stock goes back into the source batch) or drop a draft. */
export async function cancelTransfer(db: Db, req: Request, c: UserCtx, transferId: string, reason: string) {
  const t = await loadTransfer(db, c.shopId, transferId, true);
  if (t.status === 'Draft') {
    await db.query("UPDATE stock_transfers SET status = 'Cancelled', cancelled_at = now() WHERE id = $1", [t.id]);
  } else {
    if (t.status !== 'In transit') throw conflict('Only transfers still in transit can be cancelled');
    if (scoped(c) && c.branchId !== t.from_branch_id) throw new HttpError(403, 'Only the sending branch can cancel a transfer', 'branch_scope');
    for (const r of await transferItems(db, t.id)) {
      await moveStock(db, { shopId: c.shopId, itemId: r.item_id, branchId: t.from_branch_id, qty: Number(r.qty_sent), reason: 'transfer_cancel', refType: 'stock_transfer', refId: t.id,
        note: `Cancel ${t.number}`, userId: c.id, batchNo: r.batch_no || undefined, expiryDate: d10(r.expiry_date) });
      if (r.serials?.length) await db.query("UPDATE item_serials SET status = 'In stock', updated_at = now() WHERE shop_id = $1 AND item_id = $2 AND serial = ANY($3::text[]) AND status = 'In transit'", [c.shopId, r.item_id, r.serials]);
    }
    await db.query('UPDATE transfer_otps SET superseded_at = now() WHERE transfer_id = $1 AND used_at IS NULL AND superseded_at IS NULL', [t.id]);
    await db.query("UPDATE stock_transfers SET status = 'Cancelled', cancelled_at = now() WHERE id = $1", [t.id]);
    await otpLog(db, req, c.shopId, t.id, null, 'cancelled', { reason });
  }
  await audit(db, req, c.shopId, 'cancel', 'stock_transfer', t.id, { number: t.number, reason });
  req.audited = true;
  return getTransfer(db, c.shopId, t.id);
}
