import crypto from 'node:crypto';
import { takePrintSnapshot } from './printSnapshot';
import { cleanExtra } from '../../../shared/templates';
import type { Request } from 'express';
import { z } from 'zod';
import type { Db } from '../db';
import { many, one } from '../db';
import { badRequest, conflict, HttpError } from '../http';
import { applyBillAdjustments, computeTotals, lineAmount, r2 } from '../../../shared/calc';
import { fyLabel, formatInvoiceNumber, invoiceCounterKey } from '../../../shared/fy';
import { isInterState } from '../../../shared/gst';
import { balanceDue, invoiceStatus } from '../../../shared/status';
import { getOrg, nextSeq, planLimits, platformConfig, primaryBranchId } from './common';
import { moveStock, releaseSerials, sellSerials } from './stock';
import { audit } from '../audit';
import { todayISO, type UserCtx } from '../auth';
import { payable, priceBill, redeemablePoints, runningOn, type AppliedOffer } from '../../../shared/offers';
import { loyaltySettings, offersOn, pointsBalance, reversePointsForReturn, reverseInvoicePoints, settleInvoicePoints, shopHasOffers } from './offersLoyalty';

export const lineInput = z.object({
  itemId: z.string().uuid('Select an item'),
  qty: z.number().positive('Quantity must be greater than 0'),
  tier: z.enum(['SP1', 'SP2', 'SP3']).default('SP1'),
  rate: z.number().min(0).optional(), // omitted → price for tier
  discount: z.number().min(0).max(100).default(0),
  batchNo: z.string().max(60).optional(),
  /** Serial numbers sold on this line (serial-tracked items need one per unit). */
  serials: z.array(z.string().trim().min(1).max(60)).max(1000).optional(),
});
export type LineInput = z.infer<typeof lineInput>;

export interface StoredLine {
  id: string;
  itemId: string;
  name: string;
  type: 'Goods' | 'Services';
  hsn: string;
  unit: string;
  qty: number;
  rate: number;
  tier: 'SP1' | 'SP2' | 'SP3';
  taxRate: number;
  discount: number;
  amount: number;
  batchNo?: string;
  serials?: string[];
  batches?: Array<{ batchNo: string; qty: number; expiryDate: string | null }>;
  /** Item cost when the line was saved, for bill-wise profit. */
  cost?: number;
  /** What the user typed, when the bill discount or MRP billing changed the effective rate/discount. */
  enteredRate?: number;
  enteredDiscount?: number;
  /** The item's trade field values (purity, schedule, warranty …) and MRP when the line was saved, for printing. */
  extra?: Record<string, string | number>;
  mrp?: number;
}

/** Resolves item details, tier prices and the authoritative tax rate on the server. */
export async function buildLines(db: Db, shopId: string, input: LineInput[]): Promise<StoredLine[]> {
  if (!input.length) throw badRequest('Add at least one item');
  const ids = [...new Set(input.map((l) => l.itemId))];
  const items = await many(db, 'SELECT i.*, t.rate AS tax_rate FROM items i JOIN tax_slabs t ON t.id = i.tax_slab_id WHERE i.shop_id = $1 AND i.id = ANY($2::uuid[])', [shopId, ids]);
  const byId = new Map(items.map((i) => [i.id, i]));
  return input.map((l) => {
    const it = byId.get(l.itemId);
    if (!it) throw badRequest('One of the selected items no longer exists');
    if (it.is_group) throw badRequest(`${it.name} has variants. Pick a size or colour instead.`);
    const tierPrice = l.tier === 'SP1' ? it.sp1 : l.tier === 'SP2' ? it.sp2 : it.sp3;
    const line: StoredLine = {
      id: crypto.randomUUID(),
      itemId: it.id,
      name: it.name,
      type: it.type,
      hsn: it.hsn,
      unit: it.unit,
      qty: l.qty,
      rate: r2(l.rate ?? tierPrice),
      tier: l.tier,
      taxRate: Number(it.tax_rate),
      discount: l.discount,
      amount: 0,
      cost: Number(it.cost ?? 0),
      ...(l.batchNo ? { batchNo: l.batchNo } : {}),
      ...(it.track_serials && l.serials?.length ? { serials: [...new Set(l.serials.map((x) => x.trim()))] } : {}),
      ...(it.extra && Object.keys(it.extra).length ? { extra: it.extra } : {}),
      ...(it.mrp != null && Number(it.mrp) > 0 ? { mrp: Number(it.mrp) } : {}),
    };
    line.amount = lineAmount(line);
    return line;
  });
}

export async function customerSnapshot(db: Db, shopId: string, customerId: string | null, orgState: string) {
  if (!customerId) return { snap: { customId: '', type: 'Individual', name: 'Walk-in Customer', companyName: '', gstin: '', email: '', phone: '', state: orgState, address: '' }, id: null };
  const c = await one(db, 'SELECT * FROM customers WHERE shop_id = $1 AND id = $2', [shopId, customerId]);
  if (!c) throw badRequest('Customer not found');
  return {
    id: c.id as string,
    snap: { customId: c.custom_id, type: c.type, name: c.name, companyName: c.company_name, gstin: c.gstin, email: c.email, phone: c.phone, state: c.state || orgState, address: c.address },
  };
}

/** Decides tax treatment & document title from the shop's GST status and the chosen mode. */
export function taxTreatment(org: any, lines: StoredLine[], wantGst: boolean) {
  if (org.composition_scheme) return { withGst: false, docType: 'BILL OF SUPPLY' as const };
  if (!wantGst) return { withGst: false, docType: 'INVOICE' as const };
  if (!org.gstin) throw badRequest('Add your GSTIN in Organization profile before charging GST');
  if (lines.every((l) => l.taxRate === 0)) return { withGst: true, docType: 'BILL OF SUPPLY' as const };
  return { withGst: true, docType: 'TAX INVOICE' as const };
}

export const invoiceInput = z.object({
  customerId: z.string().uuid().nullable(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  branchId: z.string().uuid().nullable().optional(),
  lines: z.array(lineInput).min(1, 'Add at least one item'),
  withGst: z.boolean(),
  reverseCharge: z.boolean().default(false),
  tcsRate: z.number().min(0).max(5).default(0),
  notes: z.string().max(2000).default(''),
  salesOrderId: z.string().uuid().nullable().optional(),
  /** Omit to keep what is saved; null clears it (ships to the billing address). */
  shipTo: z.object({ name: z.string().trim().max(120), address: z.string().trim().max(500), state: z.string().max(60).default(''), gstin: z.string().trim().max(15).default('') }).nullable().optional(),
  terms: z.string().max(1500).optional(),
  /** Issue even though it takes the customer past their credit limit (the user confirmed). */
  overrideCreditLimit: z.boolean().optional(),
  /** MRP billing: the rates typed include GST. */
  pricesIncludeTax: z.boolean().optional(),
  billDiscount: z.object({ kind: z.enum(['percent', 'amount']), value: z.number().min(0).max(1e9) }).nullable().optional(),
  /** Invoice-level trade details (patient and doctor, vehicle number …), checked against the shop's invoice fields. */
  extra: z.record(z.union([z.string().max(120), z.number()])).optional(),
  /** Running offers the cashier took off this bill (offers apply by themselves otherwise). */
  skipOffers: z.array(z.string().uuid()).max(50).optional(),
  /** Loyalty points the customer uses on this bill (whole points). */
  redeemPoints: z.number().int().min(0).max(1e8).optional(),
});
export type InvoiceInput = z.infer<typeof invoiceInput>;

/** Applies MRP billing and the bill discount, keeping what the user typed so the form can be reopened. */
export function adjustLines(built: StoredLine[], input: { pricesIncludeTax?: boolean; billDiscount?: InvoiceInput['billDiscount'] }, withGst: boolean): StoredLine[] {
  if (!(input.pricesIncludeTax && withGst) && !(input.billDiscount && input.billDiscount.value > 0)) return built;
  const adj = applyBillAdjustments(built, { pricesIncludeTax: input.pricesIncludeTax, billDiscount: input.billDiscount, withGst });
  return adj.map((l, i) => {
    const typed = built[i]!;
    const out = { ...l, enteredRate: typed.rate, enteredDiscount: typed.discount };
    out.amount = lineAmount(out);
    return out;
  });
}

async function computeInvoiceFields(db: Db, shopId: string, input: InvoiceInput, source: string, invoiceId?: string) {
  if (input.dueDate < input.date) throw badRequest('Due date can’t be before invoice date', { dueDate: 'Due date can’t be before invoice date' });
  if (!input.customerId && source !== 'pos') throw badRequest('Select a customer', { customerId: 'Select a customer' });
  const org = await getOrg(db, shopId);
  const built = await buildLines(db, shopId, input.lines);
  const { snap, id: customerId } = await customerSnapshot(db, shopId, input.customerId, org.state);
  const { withGst, docType } = taxTreatment(org, built, input.withGst);
  const promo = await applyOffersAndPoints(db, shopId, input, source, built, withGst, customerId, invoiceId);
  const lines = promo?.lines ?? adjustLines(built, input, withGst);
  const pos = snap.state || org.state;
  const inter = isInterState(org.state, pos);
  const t = computeTotals(lines, withGst, inter, input.tcsRate);
  const branchId = await primaryBranchId(db, shopId, input.branchId);
  return { org, lines, snap, customerId, withGst, docType, pos, inter, t, branchId, promo };
}

/**
 * Festival offers and loyalty points (shared/offers.ts), for shops with the add-on. Recurring invoices are left as
 * they were set up. Returns null when nothing changes the bill, so it is saved exactly as before.
 */
async function applyOffersAndPoints(db: Db, shopId: string, input: InvoiceInput, source: string, built: StoredLine[], withGst: boolean, customerId: string | null, invoiceId?: string) {
  const wantsPoints = (input.redeemPoints ?? 0) > 0;
  if (source === 'recurring') return null;
  if (!(await shopHasOffers(db, shopId))) {
    if (wantsPoints) throw badRequest('Loyalty points are not switched on for this shop');
    return null;
  }
  const offers = runningOn(await offersOn(db, shopId, input.date), input.date);
  const cats = new Map((await many(db, 'SELECT id, category FROM items WHERE shop_id = $1 AND id = ANY($2::uuid[])', [shopId, built.map((l) => l.itemId)])).map((r) => [r.id, r.category ?? '']));
  const withCat = built.map((l) => ({ ...l, category: cats.get(l.itemId) }));
  const base = { lines: withCat, withGst, pricesIncludeTax: input.pricesIncludeTax, billDiscount: input.billDiscount, offers, skip: input.skipOffers ?? [] };
  let points = 0;
  let pointValue = 0;
  if (wantsPoints) {
    if (!customerId) throw badRequest('Points can only be used on a bill for a saved customer', { redeemPoints: 'Pick the customer first' });
    const s = await loyaltySettings(db, shopId);
    if (!s.enabled) throw badRequest('Loyalty points are switched off in Offers & loyalty', { redeemPoints: 'Loyalty is off' });
    const balance = await pointsBalance(db, shopId, customerId, invoiceId);
    const due = payable(priceBill(base).lines, withGst);
    const max = redeemablePoints(s, balance, due);
    if (input.redeemPoints! > max) {
      const why = balance < s.minRedeem ? `Points can be used from ${s.minRedeem} points; this customer has ${balance}` : `This customer can use up to ${max} points on this bill`;
      throw badRequest(why, { redeemPoints: why });
    }
    points = input.redeemPoints!;
    pointValue = s.pointValue;
  }
  const priced = priceBill({ ...base, redeem: points ? { points, pointValue } : null });
  if (!priced.changed) return null;
  const lines: StoredLine[] = priced.lines.map((l, i) => {
    const { category: _c, ...rest } = l;
    const typed = built[i]!;
    const out: StoredLine = { ...rest, enteredRate: typed.rate, enteredDiscount: typed.discount };
    out.amount = lineAmount(out);
    return out;
  });
  return { lines, applied: priced.applied as AppliedOffer[], points, redeemValue: priced.redeemValue };
}

async function savePromo(db: Db, shopId: string, id: string, input: InvoiceInput, promo: Awaited<ReturnType<typeof applyOffersAndPoints>>) {
  await db.query('UPDATE invoices SET offers_applied = $3, offers_skipped = $4, loyalty_points_used = $5, loyalty_discount = $6 WHERE shop_id = $1 AND id = $2',
    [shopId, id, JSON.stringify(promo?.applied ?? []), JSON.stringify(input.skipOffers ?? []), promo?.points ?? 0, promo?.redeemValue ?? 0]);
}

/** Assigns the next number in the (FY-scoped) series and moves stock out. */
/** A bill made on a registered phone (CorpusLite): numbered in that phone's own series, CODE/FY/0001. */
export interface DeviceNumber { deviceId: string; code: string; seq: number }
export const deviceInvoiceNumber = (code: string, fy: string, seq: number) => `${code}/${fy}/${String(seq).padStart(4, '0')}`;

async function issue(db: Db, req: Request | null, shopId: string, inv: any, device?: DeviceNumber) {
  const limits = await planLimits(db, shopId);
  if (limits.max_invoices_per_month) {
    const c = await one(db, "SELECT count(*)::int AS n FROM invoices WHERE shop_id = $1 AND status <> 'Draft' AND issued_at >= date_trunc('month', now())", [shopId]);
    if (c.n >= limits.max_invoices_per_month) throw new HttpError(402, `Your ${limits.name} plan allows ${limits.max_invoices_per_month} invoices per month. Upgrade to continue.`, 'plan_limit');
  }
  const cfg = await platformConfig(db);
  const fy = fyLabel(inv.date, cfg.fyStartMonth);
  const number = device ? deviceInvoiceNumber(device.code, fy, device.seq) : formatInvoiceNumber(await nextSeq(db, shopId, invoiceCounterKey('inv', fy, cfg.autoReset)), fy, cfg.autoReset);
  if (device) {
    // Each number is used once: a clash means two bills claim the same place in this phone's series.
    const taken = await one(db, 'SELECT id FROM invoices WHERE shop_id = $1 AND number = $2', [shopId, number]);
    if (taken) throw new HttpError(409, `Invoice number ${number} is already used. Open the app's sync screen to fix the series.`, 'device_number_taken');
    await db.query('UPDATE invoices SET device_id = $3 WHERE shop_id = $1 AND id = $2', [shopId, inv.id, device.deviceId]);
  }
  const lines: StoredLine[] = inv.lines;
  for (const l of lines) {
    if (l.type !== 'Goods') continue;
    const used = await moveStock(db, { shopId, itemId: l.itemId, branchId: inv.branch_id, qty: -l.qty, reason: 'sale', refType: 'invoice', refId: inv.id, userId: req?.ctx?.id, batchNo: l.batchNo, note: number });
    if (used.length) l.batches = used;
    await sellSerials(db, shopId, l, inv.branch_id, inv.id);
  }
  await db.query("UPDATE invoices SET status = 'Issued', number = $3, fy = $4, lines = $5, issued_at = now() WHERE shop_id = $1 AND id = $2", [shopId, inv.id, number, fy, JSON.stringify(lines)]);
  // Freeze what it prints with, so a reprint matches the original even after the profile or layout changes.
  await db.query('UPDATE invoices SET print_snapshot = $3 WHERE shop_id = $1 AND id = $2', [shopId, inv.id, JSON.stringify(await takePrintSnapshot(db, shopId, inv))]);
  await db.query('INSERT INTO public_links (token, shop_id, invoice_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [inv.public_token, shopId, inv.id]);
  await settleInvoicePoints(db, req, shopId, inv.id);
  return number;
}

async function restock(db: Db, req: Request | null, shopId: string, inv: any, reason: 'sale_cancel' | 'adjustment', note: string) {
  await releaseSerials(db, shopId, inv.id);
  for (const l of inv.lines as StoredLine[]) {
    if (l.type !== 'Goods') continue;
    if (l.batches?.length) {
      for (const b of l.batches) await moveStock(db, { shopId, itemId: l.itemId, branchId: inv.branch_id, qty: b.qty, reason, refType: 'invoice', refId: inv.id, userId: req?.ctx?.id, batchNo: b.batchNo, expiryDate: b.expiryDate, note });
    } else await moveStock(db, { shopId, itemId: l.itemId, branchId: inv.branch_id, qty: l.qty, reason, refType: 'invoice', refId: inv.id, userId: req?.ctx?.id, note });
  }
}

export async function createInvoice(db: Db, req: Request | null, shopId: string, input: InvoiceInput, opts: { issue: boolean; source?: 'app' | 'pos' | 'recurring'; recurringId?: string; device?: DeviceNumber }) {
  const source = opts.source ?? 'app';
  const f = await computeInvoiceFields(db, shopId, input, source);
  const cfg = await platformConfig(db);
  const row = await one(
    db,
    `INSERT INTO invoices (shop_id, fy, customer_id, customer, date, due_date, branch_id, lines, with_gst, doc_type, place_of_supply, inter_state,
       reverse_charge, tcs_rate, status, sub_total, discount, tax_total, cgst, sgst, igst, tcs, round_off, total, notes, source, sales_order_id,
       recurring_id, public_token, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'Draft',$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29) RETURNING *`,
    [
      shopId, fyLabel(input.date, cfg.fyStartMonth), f.customerId, JSON.stringify(f.snap), input.date, input.dueDate, f.branchId, JSON.stringify(f.lines),
      f.withGst, f.docType, f.pos, f.inter, input.reverseCharge, input.tcsRate, f.t.subTotal, f.t.discount, f.t.taxTotal, f.t.cgst, f.t.sgst, f.t.igst,
      f.t.tcs, f.t.roundOff, f.t.total, input.notes, source, input.salesOrderId ?? null, opts.recurringId ?? null, crypto.randomBytes(18).toString('hex'),
      req?.ctx?.kind === 'user' ? req.ctx.id : null,
    ],
  );
  await saveDeliveryFields(db, shopId, row.id, input);
  await savePromo(db, shopId, row.id, input, f.promo);
  if (opts.issue && source === 'app') await checkCreditLimit(db, req, shopId, f.customerId, f.t.total, row.id, input.overrideCreditLimit);
  let number: string | null = null;
  if (opts.issue) number = await issue(db, req, shopId, row, opts.device);
  await audit(db, req, shopId, opts.issue ? 'issue' : 'create_draft', 'invoice', row.id, { number, total: f.t.total, source });
  return getInvoice(db, shopId, row.id);
}

/**
 * Blocks issuing when the customer's open balance plus this invoice would pass their credit limit (0 = no limit).
 * The client shows the numbers and can retry with overrideCreditLimit, which is audited.
 */
async function checkCreditLimit(db: Db, req: Request | null, shopId: string, customerId: string | null, total: number, invoiceId: string, override?: boolean) {
  if (!customerId) return;
  const c = await one(
    db,
    `SELECT credit_limit, coalesce((SELECT sum(GREATEST(total - amount_paid - amount_credited, 0)) FROM invoices i
       WHERE i.shop_id = $1 AND i.customer_id = $2 AND i.status = 'Issued' AND i.id <> $3), 0) AS open
     FROM customers WHERE shop_id = $1 AND id = $2`,
    [shopId, customerId, invoiceId],
  );
  const limit = Number(c?.credit_limit ?? 0);
  if (!limit) return;
  const open = Number(c.open);
  if (open + total <= limit + 0.005) return;
  if (override) {
    await audit(db, req, shopId, 'override_credit_limit', 'invoice', invoiceId, { limit, open, total });
    return;
  }
  throw new HttpError(409, `This takes the customer to ₹${(open + total).toFixed(2)}, over their credit limit of ₹${limit.toFixed(2)}.`, 'credit_limit', { limit, open, total });
}

async function saveDeliveryFields(db: Db, shopId: string, id: string, input: InvoiceInput) {
  if (input.extra !== undefined) {
    const org = await one(db, 'SELECT invoice_fields FROM organizations WHERE shop_id = $1', [shopId]);
    const { value, errors } = cleanExtra(Array.isArray(org?.invoice_fields) ? org.invoice_fields : [], input.extra);
    if (Object.keys(errors).length) throw badRequest(Object.values(errors)[0]!, Object.fromEntries(Object.entries(errors).map(([k, v]) => [`extra.${k}`, v])));
    await db.query('UPDATE invoices SET extra = $3 WHERE shop_id = $1 AND id = $2', [shopId, id, JSON.stringify(value)]);
  }
  if (input.shipTo !== undefined) await db.query('UPDATE invoices SET ship_to = $3 WHERE shop_id = $1 AND id = $2', [shopId, id, input.shipTo && (input.shipTo.name || input.shipTo.address) ? JSON.stringify(input.shipTo) : null]);
  if (input.terms !== undefined) await db.query('UPDATE invoices SET terms = $3 WHERE shop_id = $1 AND id = $2', [shopId, id, input.terms]);
  await db.query('UPDATE invoices SET bill_discount = $3, prices_include_tax = $4 WHERE shop_id = $1 AND id = $2',
    [shopId, id, input.billDiscount && input.billDiscount.value > 0 ? JSON.stringify(input.billDiscount) : null, !!input.pricesIncludeTax]);
}

export async function updateInvoice(db: Db, req: Request, shopId: string, id: string, input: InvoiceInput, issueNow: boolean) {
  const inv = await lockInvoice(db, shopId, id);
  if (inv.status === 'Cancelled') throw conflict('Cancelled invoices can’t be edited');
  if (inv.status === 'Issued' && (Number(inv.amount_paid) > 0 || Number(inv.amount_credited) > 0))
    throw conflict('This invoice has payments or credit notes. Issue a credit note instead of editing it.');
  const f = await computeInvoiceFields(db, shopId, input, inv.source, id);
  if (inv.status === 'Issued') {
    await reverseInvoicePoints(db, req, shopId, id, `Edit ${inv.number}`);
    // Issued invoice keeps its number and date-FY; stock is re-applied for the new lines.
    const cfg = await platformConfig(db);
    if (fyLabel(input.date, cfg.fyStartMonth) !== inv.fy) throw badRequest('An issued invoice can’t be moved to a different financial year');
    await restock(db, req, shopId, inv, 'adjustment', `Edit ${inv.number}`);
    for (const l of f.lines)
      if (l.type === 'Goods') {
        const used = await moveStock(db, { shopId, itemId: l.itemId, branchId: f.branchId, qty: -l.qty, reason: 'sale', refType: 'invoice', refId: id, userId: req.ctx?.id, batchNo: l.batchNo, note: inv.number });
        if (used.length) l.batches = used;
        await sellSerials(db, shopId, l, f.branchId, id);
      }
  }
  await db.query(
    `UPDATE invoices SET customer_id=$3, customer=$4, date=$5, due_date=$6, branch_id=$7, lines=$8, with_gst=$9, doc_type=$10, place_of_supply=$11,
       inter_state=$12, reverse_charge=$13, tcs_rate=$14, sub_total=$15, discount=$16, tax_total=$17, cgst=$18, sgst=$19, igst=$20, tcs=$21,
       round_off=$22, total=$23, notes=$24 WHERE shop_id=$1 AND id=$2`,
    [
      shopId, id, f.customerId, JSON.stringify(f.snap), input.date, input.dueDate, f.branchId, JSON.stringify(f.lines), f.withGst, f.docType, f.pos,
      f.inter, input.reverseCharge, input.tcsRate, f.t.subTotal, f.t.discount, f.t.taxTotal, f.t.cgst, f.t.sgst, f.t.igst, f.t.tcs, f.t.roundOff, f.t.total, input.notes,
    ],
  );
  await saveDeliveryFields(db, shopId, id, input);
  await savePromo(db, shopId, id, input, f.promo);
  if (inv.status === 'Issued') await settleInvoicePoints(db, req, shopId, id);
  if ((inv.status === 'Draft' && issueNow) || inv.status === 'Issued') await checkCreditLimit(db, req, shopId, f.customerId, f.t.total, id, input.overrideCreditLimit);
  if (inv.status === 'Draft' && issueNow) {
    const fresh = await one(db, 'SELECT * FROM invoices WHERE shop_id = $1 AND id = $2', [shopId, id]);
    await issue(db, req, shopId, fresh);
  }
  await audit(db, req, shopId, inv.status === 'Draft' && issueNow ? 'issue' : 'update', 'invoice', id, { total: f.t.total });
  return getInvoice(db, shopId, id);
}

export async function cancelInvoice(db: Db, req: Request, shopId: string, id: string, reason: string) {
  const inv = await lockInvoice(db, shopId, id);
  if (inv.status !== 'Issued') throw conflict('Only issued invoices can be cancelled');
  if (Number(inv.amount_paid) > 0) throw conflict('Remove the recorded payments before cancelling this invoice');
  if (Number(inv.amount_credited) > 0) throw conflict('This invoice has credit notes and can’t be cancelled');
  await restock(db, req, shopId, inv, 'sale_cancel', `Cancel ${inv.number}`);
  await reverseInvoicePoints(db, req, shopId, id, `Cancelled ${inv.number}`);
  await db.query("UPDATE invoices SET status = 'Cancelled', cancelled_at = now(), cancel_reason = $3 WHERE shop_id = $1 AND id = $2", [shopId, id, reason]);
  await audit(db, req, shopId, 'cancel', 'invoice', id, { number: inv.number, reason });
  return getInvoice(db, shopId, id);
}

export async function lockInvoice(db: Db, shopId: string, id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new HttpError(404, 'Invoice not found', 'not_found');
  const inv = await one(db, 'SELECT * FROM invoices WHERE shop_id = $1 AND id = $2 FOR UPDATE', [shopId, id]);
  if (!inv) throw new HttpError(404, 'Invoice not found', 'not_found');
  return inv;
}

export function serializeInvoice(r: any) {
  const base = {
    status: r.status,
    total: Number(r.total),
    amountPaid: Number(r.amount_paid),
    amountCredited: Number(r.amount_credited),
    dueDate: r.due_date,
  };
  return {
    id: r.id,
    number: r.number,
    fy: r.fy,
    customerId: r.customer_id,
    customer: r.customer,
    date: r.date,
    dueDate: r.due_date,
    branchId: r.branch_id,
    // Cost prices stay on the server: profit is served separately to roles that may see it.
    lines: (r.lines as StoredLine[]).map(({ cost: _cost, ...l }) => l),
    withGst: r.with_gst,
    docType: r.doc_type,
    placeOfSupply: r.place_of_supply,
    interState: r.inter_state,
    reverseCharge: r.reverse_charge,
    tcsRate: Number(r.tcs_rate),
    status: r.status,
    paymentStatus: invoiceStatus(base),
    subTotal: Number(r.sub_total),
    discount: Number(r.discount),
    taxTotal: Number(r.tax_total),
    cgst: Number(r.cgst),
    sgst: Number(r.sgst),
    igst: Number(r.igst),
    tcs: Number(r.tcs),
    roundOff: Number(r.round_off),
    total: Number(r.total),
    amountPaid: Number(r.amount_paid),
    amountCredited: Number(r.amount_credited),
    balance: balanceDue(base),
    notes: r.notes,
    source: r.source, madeOfflineAt: r.made_offline_at ?? null,
    salesOrderId: r.sales_order_id,
    recurringId: r.recurring_id,
    publicToken: r.status === 'Issued' ? r.public_token : null,
    einvoice: r.einvoice,
    shipTo: r.ship_to ?? null,
    extra: r.extra ?? {},
    offersApplied: r.offers_applied ?? [],
    offersSkipped: r.offers_skipped ?? [],
    loyalty: {
      pointsUsed: Number(r.loyalty_points_used ?? 0), discount: Number(r.loyalty_discount ?? 0),
      pointsEarned: Number(r.loyalty_points_earned ?? 0), balanceAfter: r.loyalty_balance_after == null ? null : Number(r.loyalty_balance_after),
    },
    terms: r.terms ?? '',
    eway: r.eway ?? null,
    billDiscount: r.bill_discount ?? null,
    pricesIncludeTax: !!r.prices_include_tax,
    lastReminderAt: r.last_reminder_at,
    cancelReason: r.cancel_reason,
    cancelledAt: r.cancelled_at,
    issuedAt: r.issued_at,
    createdAt: r.created_at,
  };
}

export async function getInvoice(db: Db, shopId: string, id: string) {
  const r = await one(db, 'SELECT * FROM invoices WHERE shop_id = $1 AND id = $2', [shopId, id]);
  if (!r) throw new HttpError(404, 'Invoice not found', 'not_found');
  return serializeInvoice(r);
}

/* ---------------- Payments ---------------- */
export const paymentInput = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).default(todayISO),
  amount: z.number().positive('Enter the amount received'),
  tdsAmount: z.number().min(0).default(0),
  mode: z.enum(['Cash', 'UPI', 'Card', 'Bank Transfer', 'Cheque']),
  reference: z.string().max(100).default(''),
  accountId: z.string().uuid().nullable().optional(),
  notes: z.string().max(500).default(''),
});

export async function recordPayment(db: Db, req: Request | null, shopId: string, invoiceId: string, input: z.infer<typeof paymentInput>) {
  const inv = await lockInvoice(db, shopId, invoiceId);
  if (inv.status !== 'Issued') throw conflict('Payments can only be recorded on issued invoices');
  const balance = r2(Number(inv.total) - Number(inv.amount_paid) - Number(inv.amount_credited));
  const settle = r2(input.amount + input.tdsAmount);
  if (settle > balance + 0.009) throw badRequest(`Amount exceeds the balance due of ₹${balance.toFixed(2)}`, { amount: 'More than balance due' });
  let accountId = input.accountId ?? null;
  if (accountId) {
    const a = await one(db, 'SELECT id FROM bank_accounts WHERE shop_id = $1 AND id = $2', [shopId, accountId]);
    if (!a) throw badRequest('Unknown deposit account');
  } else {
    // Default: cash → first Cash account, otherwise first Bank account.
    const a = await one(db, `SELECT id FROM bank_accounts WHERE shop_id = $1 ORDER BY (type = $2) DESC, created_at LIMIT 1`, [shopId, input.mode === 'Cash' ? 'Cash' : 'Bank']);
    accountId = a?.id ?? null;
  }
  const p = await one(
    db,
    'INSERT INTO payments (shop_id, invoice_id, date, amount, tds_amount, mode, reference, account_id, notes, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *',
    [shopId, invoiceId, input.date, input.amount, input.tdsAmount, input.mode, input.reference, accountId, input.notes, req?.ctx?.id ?? null],
  );
  await db.query('UPDATE invoices SET amount_paid = amount_paid + $3 WHERE shop_id = $1 AND id = $2', [shopId, invoiceId, settle]);
  if (accountId)
    await db.query("INSERT INTO bank_transactions (shop_id, account_id, date, description, amount, category, ref_type, ref_id) VALUES ($1,$2,$3,$4,$5,'Customer Receipt','payment',$6)", [
      shopId, accountId, input.date, `${inv.number} · ${inv.customer?.companyName || inv.customer?.name} (${input.mode})`, input.amount, p.id,
    ]);
  await audit(db, req, shopId, 'record_payment', 'invoice', invoiceId, { amount: input.amount, tds: input.tdsAmount, mode: input.mode });
  return p;
}

export async function deletePayment(db: Db, req: Request, shopId: string, paymentId: string) {
  const p = await one(db, 'SELECT * FROM payments WHERE shop_id = $1 AND id = $2', [shopId, paymentId]);
  if (!p) throw new HttpError(404, 'Payment not found', 'not_found');
  await lockInvoice(db, shopId, p.invoice_id);
  await db.query('UPDATE invoices SET amount_paid = amount_paid - $3 WHERE shop_id = $1 AND id = $2', [shopId, p.invoice_id, r2(Number(p.amount) + Number(p.tds_amount))]);
  await db.query("DELETE FROM bank_transactions WHERE shop_id = $1 AND ref_type = 'payment' AND ref_id = $2", [shopId, paymentId]);
  await db.query('DELETE FROM payments WHERE shop_id = $1 AND id = $2', [shopId, paymentId]);
  await audit(db, req, shopId, 'delete_payment', 'invoice', p.invoice_id, { amount: Number(p.amount) });
}

/* ---------------- Credit notes ---------------- */
export const creditNoteInput = z.object({
  invoiceId: z.string().uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  reason: z.enum(['Sales return', 'Post-sale discount', 'Deficiency in service', 'Correction in invoice', 'Other']),
  lines: z.array(z.object({ lineId: z.string(), qty: z.number().positive(), rate: z.number().min(0).optional() })).min(1, 'Select at least one line'),
  restock: z.boolean().default(true),
});

export async function createCreditNote(db: Db, req: Request, shopId: string, input: z.infer<typeof creditNoteInput>) {
  const inv = await lockInvoice(db, shopId, input.invoiceId);
  if (inv.status !== 'Issued') throw conflict('Credit notes can only be raised against issued invoices');
  if (input.date < inv.date) throw badRequest('Credit note date can’t be before the invoice date');
  const prev = await many(db, 'SELECT lines FROM credit_notes WHERE shop_id = $1 AND invoice_id = $2', [shopId, inv.id]);
  const creditedQty = new Map<string, number>();
  for (const cn of prev) for (const l of cn.lines) creditedQty.set(l.lineId, (creditedQty.get(l.lineId) ?? 0) + l.qty);
  const invLines = new Map((inv.lines as StoredLine[]).map((l) => [l.id, l]));
  const lines = input.lines.map((l) => {
    const src = invLines.get(l.lineId);
    if (!src) throw badRequest('Line not found on invoice');
    const left = src.qty - (creditedQty.get(src.id) ?? 0);
    if (l.qty > left + 1e-9) throw badRequest(`Only ${left} of “${src.name}” can still be credited`);
    const rate = r2(l.rate ?? src.rate);
    if (rate > src.rate) throw badRequest('Credit rate can’t exceed the invoiced rate');
    return { lineId: src.id, itemId: src.itemId, name: src.name, type: src.type, hsn: src.hsn, unit: src.unit, qty: l.qty, rate, taxRate: src.taxRate, discount: src.discount, amount: lineAmount({ ...src, qty: l.qty, rate }) };
  });
  const t = computeTotals(lines, inv.with_gst, inv.inter_state);
  const alreadyCredited = Number(inv.amount_credited);
  if (t.total + alreadyCredited > Number(inv.total) + 0.009) throw badRequest('Credit notes can’t exceed the invoice total');
  const cfg = await platformConfig(db);
  const fy = fyLabel(input.date, cfg.fyStartMonth);
  const n = await nextSeq(db, shopId, invoiceCounterKey('cn', fy, cfg.autoReset));
  const number = formatInvoiceNumber(n, fy, cfg.autoReset, 'CN');
  const cn = await one(
    db,
    `INSERT INTO credit_notes (shop_id, number, fy, invoice_id, date, reason, lines, with_gst, inter_state, sub_total, tax_total, cgst, sgst, igst, total, restock, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING *`,
    [shopId, number, fy, inv.id, input.date, input.reason, JSON.stringify(lines), inv.with_gst, inv.inter_state, t.subTotal, t.taxTotal, t.cgst, t.sgst, t.igst, t.total, input.restock, req.ctx?.id ?? null],
  );
  await db.query('UPDATE invoices SET amount_credited = amount_credited + $3 WHERE shop_id = $1 AND id = $2', [shopId, inv.id, t.total]);
  await reversePointsForReturn(db, req, shopId, inv.id, cn.id, t.total, number);
  if (input.restock)
    for (const l of lines)
      if (l.type === 'Goods') await moveStock(db, { shopId, itemId: l.itemId, branchId: inv.branch_id, qty: l.qty, reason: 'credit_note', refType: 'credit_note', refId: cn.id, userId: req.ctx?.id, note: number });
  await audit(db, req, shopId, 'create', 'credit_note', cn.id, { number, invoice: inv.number, total: t.total });
  return serializeCreditNote(cn, inv);
}

export function serializeCreditNote(r: any, inv?: any) {
  return {
    id: r.id,
    number: r.number,
    fy: r.fy,
    invoiceId: r.invoice_id,
    invoiceNumber: inv?.number ?? r.invoice_number,
    invoiceDate: inv?.date ?? r.invoice_date,
    customer: inv?.customer ?? r.customer,
    date: r.date,
    reason: r.reason,
    lines: r.lines,
    withGst: r.with_gst,
    interState: r.inter_state,
    subTotal: Number(r.sub_total),
    taxTotal: Number(r.tax_total),
    cgst: Number(r.cgst),
    sgst: Number(r.sgst),
    igst: Number(r.igst),
    total: Number(r.total),
    restock: r.restock,
    createdAt: r.created_at,
  };
}

export const userId = (req: Request) => (req.ctx as UserCtx).id;
