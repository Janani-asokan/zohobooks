/* Microfinance management: loan pricing, repayment schedules and loan state. Shared by the API and the screens so a quote on
   screen is exactly what the server books. Amounts are worked in paise (integers) with half-up rounding, matching the
   original Sri Sakthi Thirumurugan Finance system.

   Pricing ("upfront monthly flat"): interest = principal × monthly rate × tenure in months, deducted from the cash
   handed over. The borrower repays the principal in equal instalments; the last instalment takes any rounding. */

export const LOAN_TYPES = ['Daily 100-Day', 'Weekly', 'Monthly EMI'] as const;
export type LoanType = (typeof LOAN_TYPES)[number];
export const LENDING_MODES = ['Cash', 'UPI', 'Bank Transfer'] as const;
export type LendingMode = (typeof LENDING_MODES)[number];
export const BORROWER_STATUSES = ['Pending Verification', 'Verified', 'Manual Verification Approved', 'Verification Failed'] as const;
export type BorrowerStatus = (typeof BORROWER_STATUSES)[number];
export const APPROVED_STATUSES: readonly BorrowerStatus[] = ['Verified', 'Manual Verification Approved'];

export const LENDING_RULES = {
  defaultMonthlyRate: 2.14,
  minMonthlyRate: 0.01,
  maxMonthlyRate: 10,
  /** Cash handed over may be rounded by hand by up to this many rupees; the difference adjusts the upfront interest. */
  maxCashRounding: 100,
  /** A new loan may be dated this many days back; older ones are entered as existing loans. */
  newLoanBackdateDays: 7,
  existingLoanMaxAgeDays: 1830,
  /** A loan is a defaulter (late charge allowed) when its oldest unpaid instalment is this many days past due. */
  defaulterDays: 30,
  defaultPeriods: { 'Daily 100-Day': 100, Weekly: 52, 'Monthly EMI': 12 } as Record<LoanType, number>,
} as const;

export const frequencyOf = (t: LoanType) => (t === 'Daily 100-Day' ? 'Daily' : t === 'Weekly' ? 'Weekly' : 'Monthly');
const periodsPerYear = (t: LoanType) => (t === 'Daily 100-Day' ? 365 : t === 'Weekly' ? 52 : 12);

/* ---------------- money ---------------- */

/** Rupees → paise, half-up. */
export const toPaise = (v: number) => Math.round(Math.abs(v) * 100 + 1e-7) * Math.sign(v || 0) || 0;
export const fromPaise = (p: number) => p / 100;
/** a / b rounded half-up, for non-negative BigInts. */
const divHalfUp = (a: bigint, b: bigint) => (a * 2n + b) / (b * 2n);

/* ---------------- dates (plain YYYY-MM-DD, business calendar) ---------------- */

const toUtc = (d: string) => { const [y, m, dd] = d.split('-').map(Number); return Date.UTC(y!, m! - 1, dd!); };
const fromUtc = (t: number) => new Date(t).toISOString().slice(0, 10);
export const addDays = (d: string, n: number) => fromUtc(toUtc(d) + n * 86_400_000);
export const daysBetween = (from: string, to: string) => Math.round((toUtc(to) - toUtc(from)) / 86_400_000);
export function addMonths(d: string, n: number) {
  const [y, m, dd] = d.split('-').map(Number);
  const idx = m! - 1 + n; const year = y! + Math.floor(idx / 12); const month = ((idx % 12) + 12) % 12;
  const last = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return fromUtc(Date.UTC(year, month, Math.min(dd!, last)));
}

/* ---------------- quote ---------------- */

export interface QuoteInput {
  principal: number; monthlyRate: number; loanType: LoanType; periods: number; borrowDate: string;
  processingFee?: number; firstDueDate?: string | null; cashHandover?: number | null;
}
export interface ScheduleRow { n: number; due: string; amount: number }
export interface Quote {
  rows: ScheduleRow[]; instalment: number; principal: number; upfrontInterest: number; processingFee: number;
  netDisbursed: number; calculatedNet: number; cashRounding: number; apr: number; firstDue: string; maturity: string;
  tenureMonths: number; totalRepayment: number;
}

export class LendingError extends Error {}

/** Annualised effective rate from the borrower's cash flows (cash received now, instalments later). */
function aprOf(net: number, rows: ScheduleRow[], type: LoanType) {
  const flows = [-net, ...rows.map((r) => r.amount)];
  if (net <= 0) return 0;
  let lo = -0.9999, hi = 10;
  for (let i = 0; i < 160; i++) {
    const r = (lo + hi) / 2;
    let npv = 0; for (let k = 0; k < flows.length; k++) npv += flows[k]! / (1 + r) ** k;
    if (npv > 0) lo = r; else hi = r;
  }
  const irr = (lo + hi) / 2;
  return Math.round(((1 + irr) ** periodsPerYear(type) - 1) * 100 * 10_000) / 10_000;
}

export function quoteLoan(q: QuoteInput): Quote {
  if (!LOAN_TYPES.includes(q.loanType)) throw new LendingError('Choose a loan plan');
  if (!(q.principal > 0)) throw new LendingError('Enter the loan amount');
  if (q.monthlyRate < LENDING_RULES.minMonthlyRate || q.monthlyRate > LENDING_RULES.maxMonthlyRate)
    throw new LendingError(`Monthly interest must be between ${LENDING_RULES.minMonthlyRate}% and ${LENDING_RULES.maxMonthlyRate}%`);
  const periods = Math.trunc(q.periods);
  if (periods < 1 || periods > 600) throw new LendingError('Number of instalments must be between 1 and 600');

  const P = BigInt(toPaise(q.principal));
  const rate = BigInt(Math.round(q.monthlyRate * 10_000)); // monthly % × 10⁴
  // Tenure in months as a fraction: daily = n/30, weekly = 7n/30, monthly = n.
  const [tn, td] = q.loanType === 'Daily 100-Day' ? [BigInt(periods), 30n] : q.loanType === 'Weekly' ? [BigInt(periods * 7), 30n] : [BigInt(periods), 1n];
  const interestP = divHalfUp(P * rate * tn, 100n * 10_000n * td);
  const feeP = BigInt(toPaise(q.processingFee ?? 0));
  let netP = P - interestP - feeP;
  if (netP <= 0n) throw new LendingError('Interest and fee cannot equal or exceed the loan amount');

  const firstDue = q.firstDueDate || (q.loanType === 'Daily 100-Day' ? addDays(q.borrowDate, 1) : q.loanType === 'Weekly' ? addDays(q.borrowDate, 7) : addMonths(q.borrowDate, 1));
  const dueFor = (n: number) => (q.loanType === 'Daily 100-Day' ? addDays(firstDue, n - 1) : q.loanType === 'Weekly' ? addDays(firstDue, 7 * (n - 1)) : addMonths(firstDue, n - 1));
  const baseP = divHalfUp(P, BigInt(periods));
  const rows: ScheduleRow[] = [];
  let left = P;
  for (let n = 1; n <= periods; n++) {
    const pay = n === periods ? left : baseP < left ? baseP : left;
    left -= pay;
    if (pay > 0n) rows.push({ n, due: dueFor(n), amount: Number(pay) / 100 });
  }

  const calculatedNet = Number(netP) / 100;
  let interest = Number(interestP) / 100;
  let rounding = 0;
  if (q.cashHandover != null && q.cashHandover > 0) {
    const cashP = BigInt(toPaise(q.cashHandover));
    const diff = Number(cashP - netP) / 100;
    if (Math.abs(diff) > LENDING_RULES.maxCashRounding)
      throw new LendingError(`Cash handed over can differ from the calculated ₹${calculatedNet.toLocaleString('en-IN', { minimumFractionDigits: 2 })} by at most ₹${LENDING_RULES.maxCashRounding}`);
    if (interestP - (cashP - netP) < 0n) throw new LendingError('Cash handed over cannot be more than the loan amount minus the fee');
    interest = Number(interestP - (cashP - netP)) / 100;
    rounding = diff;
    netP = cashP;
  }
  const net = Number(netP) / 100;
  return {
    rows, instalment: Number(baseP) / 100, principal: Number(P) / 100, upfrontInterest: interest, processingFee: Number(feeP) / 100,
    netDisbursed: net, calculatedNet, cashRounding: rounding, apr: aprOf(net, rows, q.loanType), firstDue, maturity: rows[rows.length - 1]!.due,
    tenureMonths: Math.round((Number(tn) / Number(td)) * 10_000) / 10_000, totalRepayment: Number(P) / 100,
  };
}

/* ---------------- loan state ---------------- */

export interface LoanFacts {
  loanType: LoanType; principal: number; borrowDate: string; maturity: string; status: 'Active' | 'Closed' | 'Written Off';
  schedule: ScheduleRow[]; existingLoan?: boolean; enteredOn?: string | null;
}
export interface PaymentFacts { date: string; amount: number; principalPart: number; penaltyPart: number; kind: string; status: string }
export interface ChargeFacts { kind: 'Late charge' | 'Penalty' | 'Penalty waiver'; amount: number; instalment: number | null }

export type LoanStatus = 'Active' | 'Overdue' | 'Closed' | 'Written Off';
export interface LoanState {
  paid: number; principalPaid: number; principalBalance: number; penaltyBalance: number; balance: number;
  instalmentsPaid: number; remaining: number; nextDue: string | null; daysElapsed: number; status: LoanStatus;
  overdueDays: number; overdueAmount: number; isDefaulter: boolean; alert: string | null;
}

const live = (p: PaymentFacts[]) => p.filter((x) => x.status !== 'Reversed');

export function loanState(loan: LoanFacts, payments: PaymentFacts[], charges: ChargeFacts[], today: string): LoanState {
  const pays = live(payments);
  const principalPaidP = pays.reduce((s, p) => s + toPaise(p.principalPart), 0);
  const penaltyPaidP = pays.reduce((s, p) => s + toPaise(p.penaltyPart), 0);
  const penaltyP = charges.reduce((s, c) => s + (c.kind === 'Penalty waiver' ? -1 : 1) * toPaise(c.amount), 0);
  const principalBalP = Math.max(toPaise(loan.principal) - principalPaidP, 0);
  const penaltyBalP = Math.max(penaltyP - penaltyPaidP, 0);
  const balanceP = principalBalP + penaltyBalP;

  // Instalments are cleared oldest first by principal paid.
  let left = principalPaidP, paidCount = 0, nextDue: string | null = null, overdueP = 0, oldestUnpaidDue: string | null = null;
  for (const r of loan.schedule) {
    const due = toPaise(r.amount);
    if (left >= due) { left -= due; paidCount++; continue; }
    nextDue ??= r.due;
    if (r.due < today) { oldestUnpaidDue ??= r.due; overdueP += due - left; }
    left = 0;
  }
  let remaining = loan.schedule.length - paidCount;
  if (balanceP <= 0) { remaining = 0; nextDue = null; overdueP = 0; oldestUnpaidDue = null; }
  else if (remaining === 0) { remaining = 1; nextDue = loan.schedule[loan.schedule.length - 1]?.due ?? today; }

  const daysElapsed = Math.max(daysBetween(loan.borrowDate, today), 0);
  let status: LoanStatus = loan.status === 'Written Off' ? 'Written Off' : balanceP <= 0 || loan.status === 'Closed' ? 'Closed' : 'Active';
  if (status === 'Active') {
    if (loan.loanType === 'Daily 100-Day' && daysElapsed > 130) status = 'Overdue';
    else if (loan.loanType === 'Weekly' && daysBetween(loan.maturity, today) > 2) status = 'Overdue';
    else if (loan.loanType === 'Monthly EMI' && daysBetween(loan.maturity, today) > 5) status = 'Overdue';
  }
  const overdueDays = oldestUnpaidDue ? Math.max(daysBetween(oldestUnpaidDue, today), 0) : 0;

  let alert: string | null = null;
  if (status === 'Active' || status === 'Overdue') {
    if (loan.loanType === 'Daily 100-Day') {
      alert = daysElapsed >= 130 ? 'Day 130+ overdue' : daysElapsed >= 100 ? 'Day 100 final alert' : daysElapsed >= 95 ? 'Day 95 warning' : daysElapsed >= 90 ? 'Day 90 watch' : null;
    } else if (daysBetween(loan.maturity, today) > 5) alert = 'EMI grace breached';
  }
  return {
    paid: fromPaise(pays.reduce((s, p) => s + toPaise(p.amount), 0)), principalPaid: fromPaise(principalPaidP),
    principalBalance: fromPaise(principalBalP), penaltyBalance: fromPaise(penaltyBalP), balance: fromPaise(balanceP),
    instalmentsPaid: paidCount, remaining, nextDue, daysElapsed, status, overdueDays, overdueAmount: fromPaise(overdueP),
    isDefaulter: status !== 'Closed' && status !== 'Written Off' && overdueDays >= LENDING_RULES.defaulterDays, alert,
  };
}

/** Split a receipt: late charges first, then principal (interest was taken upfront). */
export function allocate(amount: number, state: Pick<LoanState, 'penaltyBalance' | 'principalBalance'>) {
  const a = toPaise(amount);
  const pen = Math.min(a, toPaise(state.penaltyBalance));
  return { penaltyPart: fromPaise(pen), principalPart: fromPaise(a - pen) };
}

/* ---------------- collection status for a day ---------------- */

export type CycleStatus = 'Paid' | 'Less paid' | 'Not paid' | 'Upcoming';
/** The cycle a plan is judged on: the day, the Monday–Sunday week, or the calendar month. */
export function cycleOf(type: LoanType, day: string): [string, string] {
  if (type === 'Daily 100-Day') return [day, day];
  if (type === 'Weekly') { const dow = (new Date(toUtc(day)).getUTCDay() + 6) % 7; const s = addDays(day, -dow); return [s, addDays(s, 6)]; }
  const s = day.slice(0, 8) + '01';
  return [s, addDays(addMonths(s, 1), -1)];
}

/** Due vs paid in the cycle containing `on`, and what is still pending as of `on` (oldest first). */
export function cycleStatus(loan: LoanFacts, payments: PaymentFacts[], on: string, today: string) {
  const [start, end] = cycleOf(loan.loanType, on);
  const pays = live(payments).filter((p) => p.kind !== 'Opening balance');
  const opening = live(payments).filter((p) => p.kind === 'Opening balance').reduce((s, p) => s + toPaise(p.principalPart), 0);
  let schedule = loan.schedule;
  let carry = 0;
  if (loan.existingLoan && loan.enteredOn) {
    if (on < loan.enteredOn) return null;
    carry = Math.max(opening - schedule.filter((r) => r.due < loan.enteredOn!).reduce((s, r) => s + toPaise(r.amount), 0), 0);
    schedule = schedule.filter((r) => r.due >= loan.enteredOn!);
  }
  const inCycle = schedule.filter((r) => r.due >= start && r.due <= end);
  const due = inCycle.reduce((s, r) => s + toPaise(r.amount), 0);
  const paid = pays.filter((p) => p.date >= start && p.date <= end).reduce((s, p) => s + toPaise(p.principalPart), 0);
  const priorDue = schedule.filter((r) => r.due < start).reduce((s, r) => s + toPaise(r.amount), 0);
  const advance = Math.max(pays.filter((p) => p.date < start).reduce((s, p) => s + toPaise(p.principalPart), 0) + carry - priorDue, 0);
  const covered = Math.min(paid + advance, due);
  let status: CycleStatus | null;
  if (due <= 0 && paid <= 0) status = null;
  else if (covered >= due) status = 'Paid';
  else if (covered > 0) status = 'Less paid';
  else if (inCycle.some((r) => r.due <= (on < today ? on : today))) status = 'Not paid';
  else status = 'Upcoming';

  let left = pays.filter((p) => p.date <= on).reduce((s, p) => s + toPaise(p.principalPart), 0) + carry;
  let pendingCount = 0, pendingP = 0, pendingSince: string | null = null;
  for (const r of schedule) {
    if (r.due > on) break;
    const a = toPaise(r.amount);
    if (left >= a) { left -= a; continue; }
    pendingCount++; pendingP += a - left; pendingSince ??= r.due; left = 0;
  }
  if (loan.status !== 'Active') { pendingCount = 0; pendingP = 0; pendingSince = null; }
  return { start, end, status, scheduled: fromPaise(due), paid: fromPaise(paid), short: fromPaise(Math.max(due - covered, 0)), pendingCount, pendingAmount: fromPaise(pendingP), pendingSince };
}

/* ---------------- risk ---------------- */

/** A 20–98 score from what the lender knows: guarantor, Aadhaar, mobile, and how earlier loans went. Higher is safer. */
export function riskScore(b: { mobile: string; guarantor: string; hasAadhaar: boolean; status: string }, history: { closed: number; overdue: number; defaulter: boolean }) {
  let s = 66;
  s += /^[6-9]\d{9}$/.test(b.mobile) ? 4 : -8;
  s += b.guarantor.trim() ? 8 : -12;
  s += b.hasAadhaar ? 6 : 0;
  s += APPROVED_STATUSES.includes(b.status as BorrowerStatus) ? 4 : b.status === 'Verification Failed' ? -20 : 0;
  s += Math.min(history.closed * 4, 12);
  s -= history.overdue * 15 + (history.defaulter ? 10 : 0);
  return Math.max(20, Math.min(98, s));
}
export const riskBand = (score: number) => (score >= 75 ? 'Low risk' : score >= 55 ? 'Medium risk' : 'High risk');
