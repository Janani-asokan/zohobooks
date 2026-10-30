import { Router } from 'express';
import { z } from 'zod';
import { todayISO } from '../../auth';
import { audit } from '../../audit';
import { many, one, type Db } from '../../db';
import { badRequest, conflict, forbidden, HttpError, notFound, parse } from '../../http';
import { nextSeq } from '../../services/common';
import {
  aadhaarAvailable, aadhaarHash, borrowerView, cleanAadhaar, decryptAadhaar, encryptAadhaar, lendingEnabled, loadLoan, loadLoans, loanScope, type LoanRow,
} from '../../services/lending';
import {
  APPROVED_STATUSES, BORROWER_STATUSES, LENDING_MODES, LENDING_RULES, LOAN_TYPES, LendingError, allocate, cycleStatus, daysBetween, frequencyOf, quoteLoan, riskBand, riskScore,
} from '../../../../shared/lending';
import { T, allowed } from './ctx';
import type { UserCtx } from '../../auth';

/* Microfinance management (optional module). Every route needs the module switched on for the business and one of the
   lending permissions. Collectors (collect, without "see") only reach the loans assigned to them. */
export const lendingRouter = Router();

const canSee = (c: UserCtx) => allowed(c, 'lending.read') || allowed(c, 'lending.collect');
async function gate(db: Db, c: UserCtx, need: 'read' | 'write' | 'collect' | 'any' = 'any') {
  if (!(await lendingEnabled(db, c.shopId))) throw new HttpError(404, 'Microfinance management is switched off for this business. The owner can switch it on in Microfinance settings.', 'lending_off');
  const ok = need === 'any' ? canSee(c) : need === 'collect' ? allowed(c, 'lending.collect') || allowed(c, 'lending.write') : allowed(c, `lending.${need}`);
  if (!ok) throw forbidden();
}
const r2 = (n: number) => Math.round(n * 100) / 100;
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const asDay = (v: unknown, fallback: string) => (typeof v === 'string' && ISO.test(v) ? v : fallback);

/** A loan the user may touch, or 404 (collectors don't learn other loans exist). */
async function scopedLoan(db: Db, c: UserCtx, id: string, today: string) {
  const l = await loadLoan(db, c.shopId, id, today);
  const scope = loanScope(c);
  if (scope && l.collectorId !== scope) throw notFound('Loan');
  return l;
}

/* ======================= settings ======================= */

lendingRouter.get('/lending/settings', T(async (db, _req, c) => {
  const enabled = await lendingEnabled(db, c.shopId);
  const areas = await many(db, 'SELECT code, name, active FROM lending_areas WHERE shop_id = $1 ORDER BY code', [c.shopId]);
  const collectors = await many(db, `SELECT id, name, role FROM users WHERE shop_id = $1 AND active AND role IN ('Owner', 'Manager', 'Collector', 'Sales Staff') ORDER BY role = 'Collector' DESC, name`, [c.shopId]);
  const accounts = await many(db, 'SELECT id, name, type FROM bank_accounts WHERE shop_id = $1 ORDER BY created_at', [c.shopId]);
  return { enabled, areas, collectors, accounts, rules: LENDING_RULES, aadhaarAvailable: aadhaarAvailable(), loanTypes: LOAN_TYPES, modes: LENDING_MODES };
}));

lendingRouter.put('/lending/enabled', T(async (db, req, c) => {
  if (!allowed(c, 'admin')) throw forbidden('Only the owner can switch microfinance management on or off');
  const { enabled } = parse(z.object({ enabled: z.boolean() }), req.body);
  await db.query('UPDATE organizations SET lending_enabled = $2 WHERE shop_id = $1', [c.shopId, enabled]);
  if (enabled && !(await one(db, 'SELECT 1 FROM lending_areas WHERE shop_id = $1 LIMIT 1', [c.shopId])))
    await db.query(`INSERT INTO lending_areas (shop_id, code, name) VALUES ($1, 'MAIN', 'Main area')`, [c.shopId]);
  await audit(db, req, c.shopId, enabled ? 'enable' : 'disable', 'lending', c.shopId, {});
  return { enabled };
}));

const areaBody = z.object({ code: z.string().trim().toUpperCase().regex(/^[A-Z]{2,4}$/, 'Use 2–4 letters, like KUN'), name: z.string().trim().min(2, 'Name the area').max(60) });
lendingRouter.post('/lending/areas', T(async (db, req, c) => {
  await gate(db, c, 'write');
  const b = parse(areaBody, req.body);
  if (await one(db, 'SELECT 1 FROM lending_areas WHERE shop_id = $1 AND code = $2', [c.shopId, b.code])) throw conflict(`Area ${b.code} already exists`);
  await db.query('INSERT INTO lending_areas (shop_id, code, name) VALUES ($1,$2,$3)', [c.shopId, b.code, b.name]);
  await audit(db, req, c.shopId, 'create', 'lending_area', b.code, b);
  return b;
}));
lendingRouter.patch('/lending/areas/:code', T(async (db, req, c) => {
  await gate(db, c, 'write');
  const b = parse(z.object({ name: z.string().trim().min(2).max(60).optional(), active: z.boolean().optional() }), req.body);
  const r = await one(db, 'UPDATE lending_areas SET name = coalesce($3, name), active = coalesce($4, active) WHERE shop_id = $1 AND code = $2 RETURNING code, name, active', [c.shopId, req.params.code, b.name ?? null, b.active ?? null]);
  if (!r) throw notFound('Area');
  await audit(db, req, c.shopId, 'update', 'lending_area', r.code, b);
  return r;
}));

/* ======================= borrowers ======================= */

const BORROWER_SQL = `SELECT b.*, a.name AS area_name FROM borrowers b LEFT JOIN lending_areas a ON a.shop_id = b.shop_id AND a.code = b.area_code`;

async function withRisk(db: Db, shopId: string, rows: any[], today: string) {
  const loans = await loadLoans(db, shopId, today);
  return rows.map((b) => {
    const mine = loans.filter((l) => l.borrowerId === b.id);
    const v = borrowerView(b);
    const history = { closed: mine.filter((l) => l.state.status === 'Closed').length, overdue: mine.filter((l) => l.state.status === 'Overdue').length, defaulter: mine.some((l) => l.state.isDefaulter) };
    const score = riskScore(v, history);
    return { ...v, riskScore: score, riskBand: riskBand(score), loanCount: mine.length, activeLoans: mine.filter((l) => l.state.status === 'Active' || l.state.status === 'Overdue').length, outstanding: r2(mine.reduce((s, l) => s + l.state.balance, 0)) };
  });
}

lendingRouter.get('/lending/borrowers', T(async (db, req, c) => {
  await gate(db, c, 'read');
  const today = todayISO();
  const q = String(req.query.q ?? '').trim().toLowerCase();
  const rows = await many(db, `${BORROWER_SQL} WHERE b.shop_id = $1 ORDER BY b.created_at DESC`, [c.shopId]);
  let out = await withRisk(db, c.shopId, rows, today);
  if (q) out = out.filter((b) => [b.code, b.name, b.mobile, b.fatherName, b.areaCode, b.areaName].join(' ').toLowerCase().includes(q));
  if (req.query.area) out = out.filter((b) => b.areaCode === req.query.area);
  if (req.query.status) out = out.filter((b) => b.status === req.query.status);
  return out;
}));

const mobile = z.string().transform((v) => v.replace(/\D/g, '').replace(/^91(?=\d{10}$)/, '')).refine((v) => /^[6-9]\d{9}$/.test(v), 'Enter a 10-digit Indian mobile number');
const borrowerBody = z.object({
  name: z.string().trim().min(2, 'Enter the borrower’s name').max(120),
  fatherName: z.string().trim().max(120).default(''),
  mobile,
  address: z.string().trim().min(5, 'Enter the address').max(500),
  areaCode: z.string().trim().toUpperCase(),
  guarantor: z.string().trim().max(120).default(''),
  aadhaar: z.string().trim().max(20).default(''),
  aadhaarConsent: z.boolean().default(false),
});

lendingRouter.post('/lending/borrowers', T(async (db, req, c) => {
  await gate(db, c, 'write');
  const b = parse(borrowerBody, req.body);
  const area = await one(db, 'SELECT code, active FROM lending_areas WHERE shop_id = $1 AND code = $2', [c.shopId, b.areaCode]);
  if (!area?.active) throw badRequest('Choose an active area', { areaCode: 'Choose an area' });
  let aadhaar: string | null = null;
  if (b.aadhaar) {
    if (!aadhaarAvailable()) throw badRequest('Aadhaar storage is not set up on this server (AADHAAR_KEY). Leave Aadhaar empty for now.');
    if (!b.aadhaarConsent) throw badRequest('Record the borrower’s consent before storing Aadhaar', { aadhaarConsent: 'Consent needed' });
    aadhaar = cleanAadhaar(b.aadhaar);
  }
  // Same person again? Match by Aadhaar first, then mobile.
  const dupe = aadhaar
    ? await one(db, `${BORROWER_SQL} WHERE b.shop_id = $1 AND b.aadhaar_hash = $2`, [c.shopId, aadhaarHash(aadhaar)])
    : null;
  const dupeMobile = dupe ?? await one(db, `${BORROWER_SQL} WHERE b.shop_id = $1 AND b.mobile = $2`, [c.shopId, b.mobile]);
  if (dupeMobile) throw new HttpError(409, `${dupeMobile.name} (${dupeMobile.code}) is already registered with this ${dupe ? 'Aadhaar' : 'mobile number'}`, 'duplicate', { borrower: borrowerView(dupeMobile) });
  const seq = await nextSeq(db, c.shopId, `borrower:${b.areaCode}`);
  const code = `${b.areaCode}${String(seq).padStart(3, '0')}`;
  const row = await one(db, `INSERT INTO borrowers (shop_id, code, name, father_name, mobile, address, area_code, guarantor, aadhaar_enc, aadhaar_hash, aadhaar_last4, created_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
    [c.shopId, code, b.name, b.fatherName, b.mobile, b.address, b.areaCode, b.guarantor, aadhaar ? JSON.stringify(encryptAadhaar(aadhaar)) : null, aadhaar ? aadhaarHash(aadhaar) : null, aadhaar ? aadhaar.slice(-4) : '', c.name]);
  await audit(db, req, c.shopId, 'create', 'borrower', row.id, { code, name: b.name, aadhaar: aadhaar ? `XXXX XXXX ${aadhaar.slice(-4)}` : 'not provided' });
  return (await withRisk(db, c.shopId, [{ ...row, area_name: null }], todayISO()))[0];
}));

lendingRouter.get('/lending/borrowers/:id', T(async (db, req, c) => {
  await gate(db, c, 'read');
  const today = todayISO();
  const b = await one(db, `${BORROWER_SQL} WHERE b.shop_id = $1 AND b.id = $2`, [c.shopId, req.params.id]);
  if (!b) throw notFound('Borrower');
  const [view] = await withRisk(db, c.shopId, [b], today);
  const loans = await loadLoans(db, c.shopId, today, 'AND l.borrower_id = $2', [b.id]);
  const payments = await many(db, `SELECT p.*, l.number AS loan_number FROM lending_payments p JOIN lending_loans l ON l.id = p.loan_id WHERE p.shop_id = $1 AND l.borrower_id = $2 ORDER BY p.at DESC LIMIT 200`, [c.shopId, b.id]);
  return { borrower: view, loans, payments: payments.map(paymentView) };
}));

lendingRouter.patch('/lending/borrowers/:id', T(async (db, req, c) => {
  await gate(db, c, 'write');
  const b = parse(borrowerBody.omit({ aadhaar: true, aadhaarConsent: true }), req.body);
  if (await one(db, 'SELECT 1 FROM borrowers WHERE shop_id = $1 AND mobile = $2 AND id <> $3', [c.shopId, b.mobile, req.params.id])) throw conflict('Another borrower already has this mobile number');
  const r = await one(db, `UPDATE borrowers SET name=$3, father_name=$4, mobile=$5, address=$6, area_code=$7, guarantor=$8, updated_at=now() WHERE shop_id=$1 AND id=$2 RETURNING id`,
    [c.shopId, req.params.id, b.name, b.fatherName, b.mobile, b.address, b.areaCode, b.guarantor]);
  if (!r) throw notFound('Borrower');
  await audit(db, req, c.shopId, 'update', 'borrower', r.id, { name: b.name, mobile: b.mobile, area: b.areaCode });
  return { ok: true };
}));

lendingRouter.post('/lending/borrowers/:id/status', T(async (db, req, c) => {
  await gate(db, c, 'write');
  const b = parse(z.object({ status: z.enum(BORROWER_STATUSES), note: z.string().trim().max(300).default('') }), req.body);
  if (b.status === 'Manual Verification Approved' && b.note.length < 3) throw badRequest('Say how you verified the borrower (for example, which documents you checked)', { note: 'Required' });
  const r = await one(db, 'UPDATE borrowers SET status=$3, status_note=$4, updated_at=now() WHERE shop_id=$1 AND id=$2 RETURNING id, status', [c.shopId, req.params.id, b.status, b.note]);
  if (!r) throw notFound('Borrower');
  await audit(db, req, c.shopId, 'verify', 'borrower', r.id, b);
  return r;
}));

/** Showing the full Aadhaar is owner-only and always written to the audit log. */
lendingRouter.post('/lending/borrowers/:id/aadhaar', T(async (db, req, c) => {
  await gate(db, c, 'write');
  if (!allowed(c, 'admin')) throw forbidden('Only the owner can view a full Aadhaar number');
  const { reason } = parse(z.object({ reason: z.string().trim().min(5, 'Give a reason (at least 5 characters)').max(200) }), req.body);
  const b = await one(db, 'SELECT id, aadhaar_enc FROM borrowers WHERE shop_id = $1 AND id = $2', [c.shopId, req.params.id]);
  if (!b?.aadhaar_enc) throw notFound('Aadhaar for this borrower');
  let digits: string;
  try { digits = decryptAadhaar(b.aadhaar_enc); }
  catch { throw conflict('This Aadhaar was saved with a different AADHAAR_KEY and cannot be read with the current one'); }
  await audit(db, req, c.shopId, 'aadhaar_view', 'borrower', b.id, { reason });
  return { aadhaar: digits.replace(/(\d{4})(?=\d)/g, '$1 ') };
}));

/* ======================= loans ======================= */

const loanBody = z.object({
  borrowerId: z.string().uuid('Choose a borrower'),
  loanType: z.enum(LOAN_TYPES),
  principal: z.coerce.number().positive('Enter the loan amount').max(100_000_000),
  monthlyRate: z.coerce.number().min(LENDING_RULES.minMonthlyRate).max(LENDING_RULES.maxMonthlyRate).default(LENDING_RULES.defaultMonthlyRate),
  periods: z.coerce.number().int().min(1).max(600),
  borrowDate: z.string().regex(ISO).optional(),
  processingFee: z.coerce.number().min(0).max(10_000_000).default(0),
  cashHandover: z.coerce.number().positive().nullable().optional(),
  lateFee: z.coerce.number().min(0).max(1_000_000).default(0),
  collectorId: z.string().uuid().nullable().optional(),
  disbursementMode: z.enum(LENDING_MODES).default('Cash'),
  accountId: z.string().uuid().nullable().optional(),
  ackReference: z.string().trim().max(120).default(''),
  existingLoan: z.boolean().default(false),
  alreadyRepaid: z.coerce.number().min(0).default(0),
  repaidUpTo: z.string().regex(ISO).nullable().optional(),
  notes: z.string().trim().max(500).default(''),
});
type LoanBody = z.infer<typeof loanBody>;

function terms(b: LoanBody, today: string) {
  const borrowDate = b.borrowDate ?? today;
  const age = daysBetween(borrowDate, today);
  if (age < 0) throw badRequest('The loan date cannot be in the future', { borrowDate: 'In the future' });
  if (b.existingLoan ? age > LENDING_RULES.existingLoanMaxAgeDays : age > LENDING_RULES.newLoanBackdateDays)
    throw badRequest(b.existingLoan ? 'Existing loans can go back up to 5 years' : `A new loan can be dated at most ${LENDING_RULES.newLoanBackdateDays} days back. For an older loan, tick “Existing loan”.`, { borrowDate: 'Too far back' });
  try {
    const quote = quoteLoan({ principal: b.principal, monthlyRate: b.monthlyRate, loanType: b.loanType, periods: b.periods, borrowDate, processingFee: b.processingFee, cashHandover: b.existingLoan ? null : b.cashHandover });
    if (b.existingLoan && b.alreadyRepaid > quote.totalRepayment) throw badRequest(`Already repaid cannot be more than ₹${quote.totalRepayment.toLocaleString('en-IN')}`, { alreadyRepaid: 'Too much' });
    return { borrowDate, quote };
  } catch (e) {
    if (e instanceof LendingError) throw badRequest(e.message);
    throw e;
  }
}

lendingRouter.post('/lending/quote', T(async (db, req, c) => {
  await gate(db, c, 'write');
  return terms(parse(loanBody.partial({ borrowerId: true }), req.body) as LoanBody, todayISO()).quote;
}));

lendingRouter.get('/lending/loans', T(async (db, req, c) => {
  await gate(db, c);
  const today = todayISO();
  const scope = loanScope(c);
  let rows = await loadLoans(db, c.shopId, today, scope ? 'AND l.collector_id = $2' : '', scope ? [scope] : []);
  const q = String(req.query.q ?? '').trim().toLowerCase();
  if (q) rows = rows.filter((l) => [l.number, l.borrowerCode, l.borrowerName, l.mobile, l.areaCode, l.areaName].join(' ').toLowerCase().includes(q));
  for (const [k, f] of [['status', (l: LoanRow) => l.state.status], ['type', (l: LoanRow) => l.loanType], ['area', (l: LoanRow) => l.areaCode], ['collector', (l: LoanRow) => l.collectorId]] as const)
    if (req.query[k]) rows = rows.filter((l) => f(l) === req.query[k]);
  if (ISO.test(String(req.query.month ?? '') + '-01')) rows = rows.filter((l) => l.borrowDate.startsWith(String(req.query.month)));
  return rows.map(({ schedule: _s, ...l }) => l);
}));

lendingRouter.post('/lending/loans', T(async (db, req, c) => {
  await gate(db, c, 'write');
  const b = parse(loanBody, req.body);
  const today = todayISO();
  const borrower = await one(db, 'SELECT id, code, name, status FROM borrowers WHERE shop_id = $1 AND id = $2', [c.shopId, b.borrowerId]);
  if (!borrower) throw notFound('Borrower');
  if (!APPROVED_STATUSES.includes(borrower.status)) throw conflict(`Verify ${borrower.name} first: their status is “${borrower.status}”`);
  const { borrowDate, quote } = terms(b, today);
  if (!b.existingLoan && b.ackReference.length < 3) throw badRequest('Enter the borrower’s acknowledgement (signed slip number, or how they confirmed the amount)', { ackReference: 'Required' });
  let collector: any = null;
  if (b.collectorId) {
    collector = await one(db, `SELECT id, name FROM users WHERE shop_id = $1 AND id = $2 AND active`, [c.shopId, b.collectorId]);
    if (!collector) throw badRequest('Choose an active collector', { collectorId: 'Not found' });
  }
  if (b.accountId && !(await one(db, 'SELECT 1 FROM bank_accounts WHERE shop_id = $1 AND id = $2', [c.shopId, b.accountId]))) throw badRequest('Choose a bank or cash account');
  const seq = await nextSeq(db, c.shopId, 'loan');
  const number = `LN-${String(seq).padStart(6, '0')}`;
  const loan = await one(db, `INSERT INTO lending_loans (shop_id, number, borrower_id, loan_type, principal, monthly_rate, periods, collector_id, collector_name, borrow_date, first_due, maturity,
      instalment, upfront_interest, processing_fee, net_disbursed, calculated_net, cash_rounding, apr, late_fee, disbursement_mode, account_id, ack_reference,
      existing_loan, already_repaid, entered_on, schedule, notes, created_by)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29) RETURNING id`,
    [c.shopId, number, borrower.id, b.loanType, quote.principal, b.monthlyRate, b.periods, collector?.id ?? null, collector?.name ?? '', borrowDate, quote.firstDue, quote.maturity,
      quote.instalment, quote.upfrontInterest, quote.processingFee, quote.netDisbursed, quote.calculatedNet, quote.cashRounding, quote.apr, b.lateFee, b.disbursementMode, b.accountId ?? null,
      b.existingLoan ? b.ackReference || `Existing loan entered ${today}` : b.ackReference, b.existingLoan, b.existingLoan ? b.alreadyRepaid : 0, today, JSON.stringify(quote.rows), b.notes, c.name]);
  if (b.existingLoan && b.alreadyRepaid > 0) {
    // Repayments made before this system: one opening record, outside today's collection totals.
    const repaidOn = b.repaidUpTo && b.repaidUpTo >= borrowDate && b.repaidUpTo <= today ? b.repaidUpTo : borrowDate;
    await db.query(`INSERT INTO lending_payments (shop_id, loan_id, receipt_no, date, amount, mode, reference, kind, principal_part, balance_before, balance_after, collector_name, created_by)
      VALUES ($1,$2,$3,$4,$5,'Opening balance','Repaid before this system','Opening balance',$5,$6,$7,$8,$8)`,
      [c.shopId, loan.id, `OPN-${number}`, repaidOn, b.alreadyRepaid, quote.principal, r2(quote.principal - b.alreadyRepaid), c.name]);
  }
  const row = await loadLoan(db, c.shopId, loan.id, today);
  if (row.state.balance <= 0 && row.storedStatus === 'Active') await closeIfPaid(db, c.shopId, loan.id, 'System');
  await audit(db, req, c.shopId, b.existingLoan ? 'existing_loan' : 'disburse', 'loan', loan.id, { number, borrower: borrower.code, principal: quote.principal, cash: quote.netDisbursed, plan: b.loanType });
  return loadLoan(db, c.shopId, loan.id, today);
}));

async function closeIfPaid(db: Db, shopId: string, loanId: string, by: string) {
  await db.query(`UPDATE lending_loans SET status = 'Closed', closed_at = now(), closed_by = $3, closure_reason = 'Balance reached zero - closed automatically'
    WHERE shop_id = $1 AND id = $2 AND status = 'Active'`, [shopId, loanId, by]);
}

lendingRouter.get('/lending/loans/:id', T(async (db, req, c) => {
  await gate(db, c);
  const today = todayISO();
  const loan = await scopedLoan(db, c, String(req.params.id), today);
  const payments = (await many(db, 'SELECT * FROM lending_payments WHERE shop_id = $1 AND loan_id = $2 ORDER BY at DESC', [c.shopId, loan.id])).map(paymentView);
  const charges = await many(db, 'SELECT id, kind, amount, instalment, reason, date, created_by FROM lending_charges WHERE shop_id = $1 AND loan_id = $2 ORDER BY created_at DESC', [c.shopId, loan.id]);
  // Mark each instalment paid / part paid / due / overdue (oldest first by principal paid).
  let left = Math.round(loan.state.principalPaid * 100);
  const schedule = loan.schedule.map((r) => {
    const due = Math.round(r.amount * 100); const covered = Math.min(left, due); left -= covered;
    const state = covered >= due ? 'Paid' : covered > 0 ? 'Part paid' : r.due < today ? 'Overdue' : r.due === today ? 'Due today' : 'Upcoming';
    return { ...r, paid: covered / 100, state };
  });
  const charged = new Set(charges.filter((x) => x.kind === 'Late charge').map((x) => x.instalment));
  const nextLate = loan.state.isDefaulter && loan.lateFee > 0 ? schedule.find((r) => r.state === 'Overdue' && !charged.has(r.n))?.n ?? null : null;
  return {
    loan, schedule, payments, charges,
    lateCharge: {
      isDefaulter: loan.state.isDefaulter, overdueDays: loan.state.overdueDays, thresholdDays: LENDING_RULES.defaulterDays, lateFee: loan.lateFee, nextInstalment: nextLate,
      message: !loan.state.isDefaulter ? `Late charges apply only when the oldest unpaid instalment is ${LENDING_RULES.defaulterDays}+ days overdue (now ${loan.state.overdueDays}).`
        : loan.lateFee <= 0 ? 'No late charge was agreed on this loan.' : nextLate == null ? 'Late charge is already applied to every overdue instalment.' : '',
    },
  };
}));

function paymentView(p: any) {
  return {
    id: p.id, loanId: p.loan_id, loanNumber: p.loan_number, receiptNo: p.receipt_no, date: p.date, at: p.at, amount: Number(p.amount), mode: p.mode, reference: p.reference, kind: p.kind,
    principalPart: Number(p.principal_part), penaltyPart: Number(p.penalty_part), balanceBefore: Number(p.balance_before), balanceAfter: Number(p.balance_after),
    collectorName: p.collector_name, status: p.status, reversedReason: p.reversed_reason, createdBy: p.created_by, borrowerName: p.borrower_name, borrowerCode: p.borrower_code,
  };
}

const payBody = z.object({
  amount: z.coerce.number().positive('Enter the amount').max(100_000_000),
  mode: z.enum(LENDING_MODES),
  reference: z.string().trim().max(120).default(''),
  kind: z.enum(['Collection', 'Prepayment']).default('Collection'),
  accountId: z.string().uuid().nullable().optional(),
  requestId: z.string().min(8).max(100).optional(),
});

/** Records a receipt with the loan row locked, so two collectors can't overpay the same loan at once. */
async function postReceipt(db: Db, c: UserCtx, loanId: string, b: { amount: number; mode: string; reference: string; kind: 'Collection' | 'Prepayment' | 'Closure'; accountId?: string | null; requestId?: string }) {
  if (b.mode === 'UPI' && b.reference.length < 3) throw badRequest('Enter the UPI transaction ID', { reference: 'Required for UPI' });
  if (b.requestId) {
    const dup = await one(db, 'SELECT * FROM lending_payments WHERE shop_id = $1 AND request_id = $2', [c.shopId, b.requestId]);
    if (dup) return { payment: paymentView(dup), duplicate: true };
  }
  await db.query('SELECT id FROM lending_loans WHERE shop_id = $1 AND id = $2 FOR UPDATE', [c.shopId, loanId]);
  const today = todayISO();
  const loan = await scopedLoan(db, c, loanId, today);
  if (loan.state.status === 'Closed' || loan.state.status === 'Written Off') throw conflict(`This loan is ${loan.state.status.toLowerCase()}`);
  const amount = r2(b.amount);
  if (amount > loan.state.balance + 0.0001) throw badRequest(`The balance is only ₹${loan.state.balance.toLocaleString('en-IN')}`, { amount: 'More than the balance' });
  if (b.kind === 'Prepayment' && amount >= loan.state.balance) throw badRequest('A prepayment must be less than the balance. Use Close loan to settle in full.');
  if (b.accountId && !(await one(db, 'SELECT 1 FROM bank_accounts WHERE shop_id = $1 AND id = $2', [c.shopId, b.accountId]))) throw badRequest('Choose a bank or cash account');
  const parts = allocate(amount, loan.state);
  const key = `receipt:${today.replace(/-/g, '')}`;
  const receiptNo = `RCP-${today.replace(/-/g, '')}-${String(await nextSeq(db, c.shopId, key)).padStart(4, '0')}`;
  const p = await one(db, `INSERT INTO lending_payments (shop_id, loan_id, receipt_no, date, amount, mode, reference, kind, principal_part, penalty_part, balance_before, balance_after,
      collector_id, collector_name, account_id, request_id, created_by)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING *`,
    [c.shopId, loan.id, receiptNo, today, amount, b.mode, b.reference, b.kind, parts.principalPart, parts.penaltyPart, loan.state.balance, r2(loan.state.balance - amount),
      c.id, c.name, b.accountId ?? null, b.requestId ?? null, c.name]);
  if (r2(loan.state.balance - amount) <= 0) await closeIfPaid(db, c.shopId, loan.id, c.name);
  return { payment: paymentView({ ...p, loan_number: loan.number, borrower_name: loan.borrowerName, borrower_code: loan.borrowerCode }), duplicate: false };
}

lendingRouter.post('/lending/loans/:id/payments', T(async (db, req, c) => {
  await gate(db, c, 'collect');
  const b = parse(payBody, req.body);
  const r = await postReceipt(db, c, String(req.params.id), b);
  if (!r.duplicate) await audit(db, req, c.shopId, 'collect', 'loan', String(req.params.id), { receipt: r.payment.receiptNo, amount: r.payment.amount, mode: b.mode, kind: b.kind });
  return { ...r, loan: await loadLoan(db, c.shopId, String(req.params.id), todayISO()) };
}));

lendingRouter.post('/lending/loans/:id/close', T(async (db, req, c) => {
  await gate(db, c, 'write');
  const b = parse(z.object({ mode: z.enum(LENDING_MODES), reference: z.string().trim().max(120).default(''), reason: z.string().trim().min(5, 'Give a reason (at least 5 characters)').max(300),
    confirm: z.string().trim(), accountId: z.string().uuid().nullable().optional(), requestId: z.string().min(8).max(100).optional() }), req.body);
  const loan = await scopedLoan(db, c, String(req.params.id), todayISO());
  if (b.confirm.toUpperCase() !== loan.number.toUpperCase()) throw badRequest(`Type the loan number ${loan.number} to confirm`, { confirm: 'Does not match' });
  if (b.mode !== 'Cash' && b.reference.length < 3) throw badRequest('Enter the UPI or bank reference', { reference: 'Required' });
  const r = loan.state.balance > 0 ? await postReceipt(db, c, loan.id, { amount: loan.state.balance, mode: b.mode, reference: b.reference, kind: 'Closure', accountId: b.accountId, requestId: b.requestId }) : null;
  await db.query(`UPDATE lending_loans SET status = 'Closed', closed_at = now(), closed_by = $3, closure_reason = $4 WHERE shop_id = $1 AND id = $2`, [c.shopId, loan.id, c.name, b.reason]);
  await audit(db, req, c.shopId, 'close', 'loan', loan.id, { number: loan.number, settled: loan.state.balance, reason: b.reason });
  return { payment: r?.payment ?? null, loan: await loadLoan(db, c.shopId, loan.id, todayISO()) };
}));

lendingRouter.post('/lending/loans/:id/late-charge', T(async (db, req, c) => {
  await gate(db, c, 'write');
  const { instalment } = parse(z.object({ instalment: z.coerce.number().int().min(1) }), req.body);
  const today = todayISO();
  const loan = await scopedLoan(db, c, String(req.params.id), today);
  if (!loan.state.isDefaulter) throw conflict(`Late charges apply only to defaulters (oldest unpaid instalment ${LENDING_RULES.defaulterDays}+ days overdue)`);
  if (loan.lateFee <= 0) throw conflict('No late charge was agreed on this loan');
  const row = loan.schedule.find((r) => r.n === instalment);
  if (!row || row.due >= today) throw badRequest('That instalment is not overdue');
  try {
    await db.query(`INSERT INTO lending_charges (shop_id, loan_id, kind, amount, instalment, reason, date, created_by) VALUES ($1,$2,'Late charge',$3,$4,$5,$6,$7)`,
      [c.shopId, loan.id, loan.lateFee, instalment, `Instalment ${instalment} overdue since ${row.due}`, today, c.name]);
  } catch (e: any) {
    if (e?.code === '23505') throw conflict(`A late charge is already applied to instalment ${instalment}`);
    throw e;
  }
  await audit(db, req, c.shopId, 'late_charge', 'loan', loan.id, { instalment, amount: loan.lateFee });
  return loadLoan(db, c.shopId, loan.id, today);
}));

lendingRouter.post('/lending/loans/:id/waive', T(async (db, req, c) => {
  await gate(db, c, 'write');
  if (!allowed(c, 'admin')) throw forbidden('Only the owner can waive late charges');
  const b = parse(z.object({ amount: z.coerce.number().positive(), reason: z.string().trim().min(5, 'Give a reason').max(300) }), req.body);
  const today = todayISO();
  const loan = await scopedLoan(db, c, String(req.params.id), today);
  if (b.amount > loan.state.penaltyBalance + 0.0001) throw badRequest(`Only ₹${loan.state.penaltyBalance} of late charges is outstanding`);
  await db.query(`INSERT INTO lending_charges (shop_id, loan_id, kind, amount, reason, date, created_by) VALUES ($1,$2,'Penalty waiver',$3,$4,$5,$6)`, [c.shopId, loan.id, r2(b.amount), b.reason, today, c.name]);
  await audit(db, req, c.shopId, 'waive', 'loan', loan.id, b);
  return loadLoan(db, c.shopId, loan.id, today);
}));

/** Undo a receipt entered by mistake. Owner only, with a reason; the receipt stays on record as Reversed. */
lendingRouter.post('/lending/payments/:id/reverse', T(async (db, req, c) => {
  await gate(db, c, 'write');
  if (!allowed(c, 'admin')) throw forbidden('Only the owner can reverse a receipt');
  const { reason } = parse(z.object({ reason: z.string().trim().min(5, 'Give a reason (at least 5 characters)').max(300) }), req.body);
  const p = await one(db, `UPDATE lending_payments SET status = 'Reversed', reversed_reason = $3, reversed_by = $4
    WHERE shop_id = $1 AND id = $2 AND status = 'Posted' AND kind <> 'Opening balance' RETURNING loan_id, receipt_no, amount`, [c.shopId, req.params.id, reason, c.name]);
  if (!p) throw notFound('Receipt');
  // A loan closed by this receipt reopens once money is owed again.
  const loan = await loadLoan(db, c.shopId, p.loan_id, todayISO());
  if (loan.storedStatus === 'Closed' && loan.state.balance > 0) await db.query(`UPDATE lending_loans SET status = 'Active', closed_at = NULL, closed_by = '', closure_reason = '' WHERE shop_id = $1 AND id = $2`, [c.shopId, p.loan_id]);
  await audit(db, req, c.shopId, 'reverse', 'loan_receipt', String(req.params.id), { receipt: p.receipt_no, amount: Number(p.amount), reason });
  return loadLoan(db, c.shopId, p.loan_id, todayISO());
}));

lendingRouter.get('/lending/payments', T(async (db, req, c) => {
  await gate(db, c);
  const date = asDay(req.query.date, todayISO());
  const scope = loanScope(c);
  const rows = await many(db, `SELECT p.*, l.number AS loan_number, b.name AS borrower_name, b.code AS borrower_code FROM lending_payments p
      JOIN lending_loans l ON l.id = p.loan_id JOIN borrowers b ON b.id = l.borrower_id
     WHERE p.shop_id = $1 AND p.date = $2 AND p.kind <> 'Opening balance' ${scope ? 'AND p.collector_id = $3' : ''} ORDER BY p.at DESC`, scope ? [c.shopId, date, scope] : [c.shopId, date]);
  const posted = rows.filter((r) => r.status === 'Posted');
  return { date, payments: rows.map(paymentView), total: r2(posted.reduce((s, r) => s + Number(r.amount), 0)), byMode: Object.fromEntries(LENDING_MODES.map((m) => [m, r2(posted.filter((r) => r.mode === m).reduce((s, r) => s + Number(r.amount), 0))])) };
}));

/* ======================= dashboard, dues and alerts ======================= */

lendingRouter.get('/lending/dashboard', T(async (db, req, c) => {
  await gate(db, c);
  const today = todayISO();
  const scope = loanScope(c);
  const loans = await loadLoans(db, c.shopId, today, scope ? 'AND l.collector_id = $2' : '', scope ? [scope] : []);
  const month = today.slice(0, 7);
  const pays = await many(db, `SELECT p.date, p.amount, p.collector_name, b.area_code, l.borrower_id FROM lending_payments p JOIN lending_loans l ON l.id = p.loan_id JOIN borrowers b ON b.id = l.borrower_id
     WHERE p.shop_id = $1 AND p.status = 'Posted' AND p.kind <> 'Opening balance' AND p.date >= $2 ${scope ? 'AND l.collector_id = $3' : ''}`, scope ? [c.shopId, `${month}-01`, scope] : [c.shopId, `${month}-01`]);
  const areas = await many(db, 'SELECT code, name FROM lending_areas WHERE shop_id = $1 ORDER BY code', [c.shopId]);
  const pending = scope ? 0 : Number((await one(db, `SELECT count(*) AS n FROM borrowers WHERE shop_id = $1 AND status = 'Pending Verification'`, [c.shopId]))?.n ?? 0);
  const open = loans.filter((l) => l.state.status === 'Active' || l.state.status === 'Overdue');
  const sum = (xs: any[], f: (x: any) => number) => r2(xs.reduce((s, x) => s + f(x), 0));
  const todayPays = pays.filter((p) => p.date === today);
  const monthInterest = sum(loans.filter((l) => !l.existingLoan && l.borrowDate.startsWith(month)), (l) => l.upfrontInterest + l.processingFee);
  return {
    totals: {
      activeLoans: open.length, overdueLoans: loans.filter((l) => l.state.status === 'Overdue').length, defaulters: open.filter((l) => l.state.isDefaulter).length,
      outstanding: sum(open, (l) => l.state.balance), overdueAmount: sum(open, (l) => l.state.overdueAmount), todayCollection: sum(todayPays, (p) => Number(p.amount)),
      monthCollection: sum(pays, (p) => Number(p.amount)), monthDisbursed: sum(loans.filter((l) => !l.existingLoan && l.borrowDate.startsWith(month)), (l) => l.netDisbursed),
      monthInterest, pendingVerification: pending, closedLoans: loans.filter((l) => l.state.status === 'Closed').length,
    },
    split: Object.fromEntries(LOAN_TYPES.map((t) => [t, open.filter((l) => l.loanType === t).length])),
    areas: areas.map((a) => {
      const al = open.filter((l) => l.areaCode === a.code);
      const paidToday = new Set(todayPays.filter((p) => p.area_code === a.code).map((p) => p.borrower_id));
      const withDues = new Set(al.map((l) => l.borrowerId));
      return { code: a.code, name: a.name, activeLoans: al.length, outstanding: sum(al, (l) => l.state.balance), today: sum(todayPays.filter((p) => p.area_code === a.code), (p) => Number(p.amount)),
        month: sum(pays.filter((p) => p.area_code === a.code), (p) => Number(p.amount)), paidToday: paidToday.size, yetToPay: [...withDues].filter((x) => !paidToday.has(x)).length };
    }),
    collectors: Object.values(pays.reduce((m: Record<string, { name: string; today: number; month: number; count: number }>, p) => {
      const k = p.collector_name || 'Office'; m[k] ??= { name: k, today: 0, month: 0, count: 0 };
      m[k].month = r2(m[k].month + Number(p.amount)); m[k].count++; if (p.date === today) m[k].today = r2(m[k].today + Number(p.amount)); return m;
    }, {})),
    alerts: open.filter((l) => l.state.alert || l.state.isDefaulter).sort((a, b) => b.state.overdueDays - a.state.overdueDays || b.state.daysElapsed - a.state.daysElapsed).slice(0, 30)
      .map((l) => ({ loanId: l.id, number: l.number, borrower: l.borrowerName, area: l.areaCode, alert: l.state.alert ?? `Defaulter · ${l.state.overdueDays} days`, balance: l.state.balance, overdueDays: l.state.overdueDays, daysElapsed: l.state.daysElapsed })),
    trend: await many(db, `SELECT to_char(date, 'YYYY-MM') AS month, sum(amount)::float AS total FROM lending_payments WHERE shop_id = $1 AND status = 'Posted' AND kind <> 'Opening balance' AND date >= (current_date - interval '11 months')
      ${scope ? 'AND collector_id = $2' : ''} GROUP BY 1 ORDER BY 1`, scope ? [c.shopId, scope] : [c.shopId]),
  };
}));

/** For one date: every open loan's cycle (day, week or month) due vs paid, and what is still pending. */
lendingRouter.get('/lending/dues', T(async (db, req, c) => {
  await gate(db, c);
  const today = todayISO();
  const on = asDay(req.query.date, today);
  const scope = loanScope(c);
  const loans = await loadLoans(db, c.shopId, today, `AND l.status <> 'Written Off' ${scope ? 'AND l.collector_id = $2' : ''}`, scope ? [scope] : []);
  const pays = await many(db, 'SELECT loan_id, date, amount, principal_part, penalty_part, kind, status FROM lending_payments WHERE shop_id = $1', [c.shopId]);
  const byLoan = new Map<string, any[]>();
  for (const p of pays) (byLoan.get(p.loan_id) ?? byLoan.set(p.loan_id, []).get(p.loan_id)!).push({ date: p.date, amount: Number(p.amount), principalPart: Number(p.principal_part), penaltyPart: Number(p.penalty_part), kind: p.kind, status: p.status });
  const rows = [];
  for (const l of loans) {
    const st = cycleStatus({ loanType: l.loanType, principal: l.principal, borrowDate: l.borrowDate, maturity: l.maturity, status: l.state.status === 'Closed' ? 'Closed' : 'Active', schedule: l.schedule, existingLoan: l.existingLoan, enteredOn: l.enteredOn }, byLoan.get(l.id) ?? [], on, today);
    if (!st || (st.status == null && st.pendingCount === 0)) continue;
    // Nothing due in this cycle but older instalments unpaid: arrears.
    rows.push({ loanId: l.id, number: l.number, borrowerId: l.borrowerId, borrower: l.borrowerName, mobile: l.mobile, area: l.areaCode, frequency: frequencyOf(l.loanType), instalment: l.instalment,
      collector: l.collectorName, balance: l.state.balance, ...st, status: st.status ?? 'Arrears' });
  }
  const order: Record<string, number> = { 'Not paid': 0, Arrears: 1, 'Less paid': 2, Upcoming: 3, Paid: 4 };
  rows.sort((a, b) => (order[a.status ?? ''] ?? 4) - (order[b.status ?? ''] ?? 4) || a.borrower.localeCompare(b.borrower));
  return { date: on, today, rows };
}));

/* ======================= reports ======================= */

lendingRouter.get('/lending/reports/:kind', T(async (db, req, c) => {
  await gate(db, c, 'read');
  const today = todayISO();
  const loans = await loadLoans(db, c.shopId, today);
  const posted = await many(db, `SELECT p.*, l.number AS loan_number, b.name AS borrower_name, b.code AS borrower_code, b.area_code FROM lending_payments p
      JOIN lending_loans l ON l.id = p.loan_id JOIN borrowers b ON b.id = l.borrower_id WHERE p.shop_id = $1 AND p.status = 'Posted' AND p.kind <> 'Opening balance' ORDER BY p.at`, [c.shopId]);
  const sum = (xs: any[], f: (x: any) => number) => r2(xs.reduce((s, x) => s + f(x), 0));
  const loanLine = (l: LoanRow) => ({ loan: l.number, borrower: `${l.borrowerName} (${l.borrowerCode})`, area: l.areaCode, plan: l.loanType, date: l.borrowDate, principal: l.principal, cashGiven: l.netDisbursed, interest: l.upfrontInterest, paid: l.state.paid, balance: l.state.balance, status: l.state.status, overdueDays: l.state.overdueDays });
  switch (req.params.kind) {
    case 'daily-collection': {
      const date = asDay(req.query.date, today);
      const rows = posted.filter((p) => p.date === date);
      return { title: `Daily collection · ${date}`, summary: { receipts: rows.length, total: sum(rows, (p) => Number(p.amount)), ...Object.fromEntries(LENDING_MODES.map((m) => [m, sum(rows.filter((p) => p.mode === m), (p) => Number(p.amount))])) },
        rows: rows.map((p) => ({ receipt: p.receipt_no, borrower: `${p.borrower_name} (${p.borrower_code})`, loan: p.loan_number, area: p.area_code, amount: Number(p.amount), mode: p.mode, reference: p.reference, collector: p.collector_name, type: p.kind })) };
    }
    case 'monthly-cashflow': {
      const month = /^\d{4}-\d{2}$/.test(String(req.query.month)) ? String(req.query.month) : today.slice(0, 7);
      const given = loans.filter((l) => !l.existingLoan && l.borrowDate.startsWith(month));
      const coll = posted.filter((p) => String(p.date).startsWith(month));
      return { title: `Monthly cash flow · ${month}`, summary: { cashOut: sum(given, (l) => l.netDisbursed), collected: sum(coll, (p) => Number(p.amount)), net: r2(sum(coll, (p) => Number(p.amount)) - sum(given, (l) => l.netDisbursed)), interestBooked: sum(given, (l) => l.upfrontInterest), feesBooked: sum(given, (l) => l.processingFee), newLoans: given.length },
        rows: given.map(loanLine) };
    }
    case 'loan-book':
      return { title: 'Loan book', summary: { loans: loans.length, principal: sum(loans, (l) => l.principal), paid: sum(loans, (l) => l.state.paid), outstanding: sum(loans, (l) => l.state.balance) }, rows: loans.map(loanLine) };
    case 'defaulters': {
      const d = loans.filter((l) => l.state.isDefaulter || l.state.status === 'Overdue').sort((a, b) => b.state.overdueDays - a.state.overdueDays);
      return { title: 'Defaulters and overdue loans', summary: { loans: d.length, outstanding: sum(d, (l) => l.state.balance), overdue: sum(d, (l) => l.state.overdueAmount) }, rows: d.map((l) => ({ ...loanLine(l), overdueAmount: l.state.overdueAmount, mobile: l.mobile, collector: l.collectorName })) };
    }
    case 'areas': {
      const areas = await many(db, 'SELECT code, name FROM lending_areas WHERE shop_id = $1 ORDER BY code', [c.shopId]);
      return { title: 'Area performance', rows: areas.map((a) => { const al = loans.filter((l) => l.areaCode === a.code); return { area: `${a.name} (${a.code})`, loans: al.length, active: al.filter((l) => l.state.status === 'Active' || l.state.status === 'Overdue').length, given: sum(al, (l) => l.principal), collected: sum(posted.filter((p) => p.area_code === a.code), (p) => Number(p.amount)), outstanding: sum(al, (l) => l.state.balance), overdue: al.filter((l) => l.state.status === 'Overdue').length }; }) };
    }
    case 'collectors': {
      const names = [...new Set(posted.map((p) => p.collector_name || 'Office'))];
      const month = today.slice(0, 7);
      return { title: 'Collector performance', rows: names.map((n) => { const ps = posted.filter((p) => (p.collector_name || 'Office') === n); return { collector: n, receipts: ps.length, today: sum(ps.filter((p) => p.date === today), (p) => Number(p.amount)), thisMonth: sum(ps.filter((p) => String(p.date).startsWith(month)), (p) => Number(p.amount)), total: sum(ps, (p) => Number(p.amount)) }; }) };
    }
    case 'profit': {
      const year = /^\d{4}$/.test(String(req.query.year)) ? String(req.query.year) : today.slice(0, 4);
      const yl = loans.filter((l) => !l.existingLoan && l.borrowDate.startsWith(year));
      const charges = await many(db, `SELECT kind, amount FROM lending_charges WHERE shop_id = $1 AND to_char(date, 'YYYY') = $2`, [c.shopId, year]);
      const late = sum(charges, (x) => (x.kind === 'Penalty waiver' ? -1 : 1) * Number(x.amount));
      const portfolio = sum(loans, (l) => l.state.paid + l.state.balance);
      return { title: `Interest and recovery · ${year}`, summary: { interest: sum(yl, (l) => l.upfrontInterest), fees: sum(yl, (l) => l.processingFee), lateCharges: late, income: r2(sum(yl, (l) => l.upfrontInterest + l.processingFee) + late),
        recoveryRate: portfolio ? r2((sum(loans, (l) => l.state.paid) / portfolio) * 100) : 0, atRisk: sum(loans.filter((l) => l.state.status === 'Overdue'), (l) => l.state.balance) },
        rows: yl.map(loanLine) };
    }
    default: throw notFound('Report');
  }
}));

/* ======================= search ======================= */

lendingRouter.get('/lending/search', T(async (db, req, c) => {
  await gate(db, c);
  const q = String(req.query.q ?? '').trim().toLowerCase();
  if (q.length < 2) return { borrowers: [], loans: [] };
  const scope = loanScope(c);
  const loans = (await loadLoans(db, c.shopId, todayISO(), scope ? 'AND l.collector_id = $2' : '', scope ? [scope] : []))
    .filter((l) => [l.number, l.borrowerCode, l.borrowerName, l.mobile].join(' ').toLowerCase().includes(q)).slice(0, 20).map(({ schedule: _s, ...l }) => l);
  const borrowers = scope ? [] : (await many(db, `${BORROWER_SQL} WHERE b.shop_id = $1 AND (lower(b.name) LIKE $2 OR b.mobile LIKE $2 OR lower(b.code) LIKE $2) LIMIT 20`, [c.shopId, `%${q}%`])).map(borrowerView);
  return { borrowers, loans };
}));
