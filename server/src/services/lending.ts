import crypto from 'node:crypto';
import { config } from '../config';
import type { Db } from '../db';
import { many, one } from '../db';
import { HttpError } from '../http';
import { loanState, type ChargeFacts, type LoanFacts, type LoanState, type LoanType, type PaymentFacts, type ScheduleRow } from '../../../shared/lending';

/* ---------------- Aadhaar: AES-256-GCM at rest, keyed hash for duplicate checks ---------------- */

const KEY_VERSION = 'v1';
const key = () => crypto.createHash('sha256').update(`aadhaar-enc:${config.lending.aadhaarKey}`).digest();
const hashKey = () => crypto.createHash('sha256').update(`aadhaar-hash:${config.lending.aadhaarKey}`).digest();
export const aadhaarAvailable = () => !!config.lending.aadhaarKey;

export function cleanAadhaar(v: string) {
  const d = v.replace(/\D/g, '');
  if (d.length !== 12) throw new HttpError(400, 'Aadhaar must have exactly 12 digits', 'bad_request', { aadhaar: '12 digits' });
  return d;
}
export const aadhaarHash = (digits: string) => crypto.createHmac('sha256', hashKey()).update(digits).digest('hex');
export function encryptAadhaar(digits: string) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const data = Buffer.concat([c.update(digits, 'utf8'), c.final()]);
  return { v: KEY_VERSION, iv: iv.toString('base64'), tag: c.getAuthTag().toString('base64'), data: data.toString('base64') };
}
export function decryptAadhaar(enc: { iv: string; tag: string; data: string }) {
  const d = crypto.createDecipheriv('aes-256-gcm', key(), Buffer.from(enc.iv, 'base64'));
  d.setAuthTag(Buffer.from(enc.tag, 'base64'));
  return Buffer.concat([d.update(Buffer.from(enc.data, 'base64')), d.final()]).toString('utf8');
}

/* ---------------- loans with their live state ---------------- */

export interface LoanRow {
  id: string; number: string; borrowerId: string; borrowerCode: string; borrowerName: string; mobile: string; areaCode: string; areaName: string;
  loanType: LoanType; principal: number; monthlyRate: number; periods: number; collectorId: string | null; collectorName: string;
  borrowDate: string; firstDue: string; maturity: string; instalment: number; upfrontInterest: number; processingFee: number;
  netDisbursed: number; calculatedNet: number; cashRounding: number; apr: number; lateFee: number; disbursementMode: string; accountId: string | null;
  ackReference: string; existingLoan: boolean; alreadyRepaid: number; enteredOn: string; storedStatus: 'Active' | 'Closed' | 'Written Off';
  closedAt: string | null; closedBy: string; closureReason: string; notes: string; createdBy: string; createdAt: string;
  schedule: ScheduleRow[]; state: LoanState;
}

const num = (v: unknown) => Number(v ?? 0);
export const paymentFacts = (p: any): PaymentFacts => ({ date: p.date, amount: num(p.amount), principalPart: num(p.principal_part), penaltyPart: num(p.penalty_part), kind: p.kind, status: p.status });
export const chargeFacts = (c: any): ChargeFacts => ({ kind: c.kind, amount: num(c.amount), instalment: c.instalment });
export const loanFacts = (l: any): LoanFacts => ({
  loanType: l.loan_type, principal: num(l.principal), borrowDate: l.borrow_date, maturity: l.maturity, status: l.status,
  schedule: l.schedule, existingLoan: l.existing_loan, enteredOn: l.entered_on,
});

function serialize(l: any, state: LoanState): LoanRow {
  return {
    id: l.id, number: l.number, borrowerId: l.borrower_id, borrowerCode: l.borrower_code, borrowerName: l.borrower_name, mobile: l.mobile,
    areaCode: l.area_code, areaName: l.area_name ?? l.area_code, loanType: l.loan_type, principal: num(l.principal), monthlyRate: num(l.monthly_rate),
    periods: l.periods, collectorId: l.collector_id, collectorName: l.collector_name, borrowDate: l.borrow_date, firstDue: l.first_due, maturity: l.maturity,
    instalment: num(l.instalment), upfrontInterest: num(l.upfront_interest), processingFee: num(l.processing_fee), netDisbursed: num(l.net_disbursed),
    calculatedNet: num(l.calculated_net), cashRounding: num(l.cash_rounding), apr: num(l.apr), lateFee: num(l.late_fee), disbursementMode: l.disbursement_mode,
    accountId: l.account_id, ackReference: l.ack_reference, existingLoan: l.existing_loan, alreadyRepaid: num(l.already_repaid), enteredOn: l.entered_on,
    storedStatus: l.status, closedAt: l.closed_at, closedBy: l.closed_by, closureReason: l.closure_reason, notes: l.notes, createdBy: l.created_by,
    createdAt: l.created_at, schedule: l.schedule, state,
  };
}

const LOAN_SQL = `SELECT l.*, b.code AS borrower_code, b.name AS borrower_name, b.mobile, b.area_code, a.name AS area_name
  FROM lending_loans l JOIN borrowers b ON b.id = l.borrower_id LEFT JOIN lending_areas a ON a.shop_id = b.shop_id AND a.code = b.area_code`;

/** Loans with payments and charges loaded in two queries, whatever the number of loans. */
export async function loadLoans(db: Db, shopId: string, today: string, where = '', args: unknown[] = []): Promise<LoanRow[]> {
  const loans = await many(db, `${LOAN_SQL} WHERE l.shop_id = $1 ${where} ORDER BY l.borrow_date DESC, l.number DESC`, [shopId, ...args]);
  if (!loans.length) return [];
  const ids = loans.map((l) => l.id);
  const pays = await many(db, 'SELECT loan_id, date, amount, principal_part, penalty_part, kind, status FROM lending_payments WHERE loan_id = ANY($1::uuid[]) ORDER BY at', [ids]);
  const charges = await many(db, 'SELECT loan_id, kind, amount, instalment FROM lending_charges WHERE loan_id = ANY($1::uuid[])', [ids]);
  const byLoan = <T>(rows: any[], f: (r: any) => T) => { const m = new Map<string, T[]>(); for (const r of rows) (m.get(r.loan_id) ?? m.set(r.loan_id, []).get(r.loan_id)!).push(f(r)); return m; };
  const pm = byLoan(pays, paymentFacts), cm = byLoan(charges, chargeFacts);
  return loans.map((l) => serialize(l, loanState(loanFacts(l), pm.get(l.id) ?? [], cm.get(l.id) ?? [], today)));
}

export async function loadLoan(db: Db, shopId: string, id: string, today: string): Promise<LoanRow> {
  const [l] = await loadLoans(db, shopId, today, 'AND l.id = $2', [id]);
  if (!l) throw new HttpError(404, 'Loan not found', 'not_found');
  return l;
}

/** Collectors see and collect only the loans assigned to them; everyone with "see" access sees all. */
export function loanScope(c: { id: string; permissions: string[] }) {
  return c.permissions.includes('lending.read') ? null : c.id;
}

export async function lendingEnabled(db: Db, shopId: string) {
  return !!(await one(db, 'SELECT lending_enabled FROM organizations WHERE shop_id = $1', [shopId]))?.lending_enabled;
}

export function borrowerView(b: any) {
  return {
    id: b.id, code: b.code, name: b.name, fatherName: b.father_name, mobile: b.mobile, address: b.address, areaCode: b.area_code, areaName: b.area_name ?? b.area_code,
    guarantor: b.guarantor, hasAadhaar: !!b.aadhaar_enc, aadhaarMasked: b.aadhaar_last4 ? `XXXX XXXX ${b.aadhaar_last4}` : 'Not provided',
    status: b.status, statusNote: b.status_note, createdBy: b.created_by, createdAt: b.created_at,
  };
}
