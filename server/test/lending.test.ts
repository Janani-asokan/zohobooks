import { beforeAll, describe, expect, it } from 'vitest';
import { freshDb, login, today } from './helpers';
import { quoteLoan } from '../../shared/lending';

let owner: Awaited<ReturnType<typeof login>>;
let manager: Awaited<ReturnType<typeof login>>;
let collector: Awaited<ReturnType<typeof login>>;
let sales: Awaited<ReturnType<typeof login>>;

beforeAll(async () => {
  await freshDb();
  owner = await login('owner@shop.com', 'owner123');
  manager = await login('manager@shop.com', 'manager123');
  collector = await login('collector@shop.com', 'collector123');
  sales = await login('sales@shop.com', 'sales123');
});

const newBorrower = async (mobile: string, extra: Record<string, unknown> = {}) => {
  const r = await owner.post('/api/shop/lending/borrowers').send({ name: 'Test Borrower', fatherName: 'Father', mobile, address: '1, Main Road, Salem', areaCode: 'SLM', guarantor: 'Neighbour', ...extra });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return r.body;
};
const approve = (id: string) => owner.post(`/api/shop/lending/borrowers/${id}/status`).send({ status: 'Verified' });
const giveLoan = (borrowerId: string, extra: Record<string, unknown> = {}) =>
  owner.post('/api/shop/lending/loans').send({ borrowerId, loanType: 'Daily 100-Day', principal: 50000, monthlyRate: 2.14, periods: 100, ackReference: 'Slip 101', ...extra });
const trialBalanced = async () => {
  const tb = (await owner.get('/api/shop/accounting/trial-balance')).body;
  const d = tb.rows.reduce((s: number, r: any) => s + r.debit, 0), c = tb.rows.reduce((s: number, r: any) => s + r.credit, 0);
  return Math.abs(d - c) < 0.01;
};

describe('money lending', () => {
  it('registers a borrower, keeps Aadhaar encrypted and masked, and catches duplicates', async () => {
    const b = await newBorrower('9876501234', { aadhaar: '2345 6789 0123', aadhaarConsent: true });
    expect(b.code).toMatch(/^SLM\d{3}$/);
    expect(b.aadhaarMasked).toBe('XXXX XXXX 0123');
    expect(JSON.stringify(b)).not.toContain('234567890123');
    expect(b.status).toBe('Pending Verification');
    const dupMobile = await owner.post('/api/shop/lending/borrowers').send({ name: 'Someone Else', mobile: '98765 01234', address: '2, Mill Road, Erode', areaCode: 'ERD' });
    expect(dupMobile.status).toBe(409);
    const dupAadhaar = await owner.post('/api/shop/lending/borrowers').send({ name: 'Someone Else', mobile: '9876509999', address: '2, Mill Road, Erode', areaCode: 'ERD', aadhaar: '234567890123', aadhaarConsent: true });
    expect(dupAadhaar.status).toBe(409);
    expect(dupAadhaar.body.error).toMatch(/Aadhaar/);
    // Full Aadhaar only for the owner, with a reason, and audited.
    expect((await manager.post(`/api/shop/lending/borrowers/${b.id}/aadhaar`).send({ reason: 'Checking the card' })).status).toBe(403);
    const shown = await owner.post(`/api/shop/lending/borrowers/${b.id}/aadhaar`).send({ reason: 'Checking the card' });
    expect(shown.body.aadhaar).toBe('2345 6789 0123');
    const log = await owner.get('/api/shop/audit?q=aadhaar_view');
    expect(JSON.stringify(log.body)).toContain('aadhaar_view');
  });

  it('lends only to verified borrowers, books exactly the quoted terms, and enforces the date rules', async () => {
    const b = await newBorrower('9876501111');
    expect((await giveLoan(b.id)).status).toBe(409);
    await approve(b.id);
    expect((await giveLoan(b.id, { ackReference: '' })).status).toBe(400);
    const tooOld = new Date(Date.now() - 10 * 86_400_000).toISOString().slice(0, 10);
    expect((await giveLoan(b.id, { borrowDate: tooOld })).status).toBe(400);
    const r = await giveLoan(b.id, { cashHandover: 46430 });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const q = quoteLoan({ principal: 50000, monthlyRate: 2.14, loanType: 'Daily 100-Day', periods: 100, borrowDate: today(), cashHandover: 46430 });
    expect(r.body).toMatchObject({ principal: 50000, netDisbursed: 46430, upfrontInterest: q.upfrontInterest, instalment: 500, maturity: q.maturity });
    expect(r.body.schedule).toHaveLength(100);
    expect(r.body.state).toMatchObject({ balance: 50000, remaining: 100, status: 'Active' });
    // Out of rounding range
    expect((await giveLoan(b.id, { cashHandover: 46000 })).status).toBe(400);
    expect(await trialBalanced()).toBe(true);
  });

  it('collects, refuses overpayment, ignores retries, closes at zero and reopens on reversal', async () => {
    const b = await newBorrower('9876502222'); await approve(b.id);
    const loan = (await giveLoan(b.id, { principal: 1000, periods: 10 })).body;
    const pay = (body: Record<string, unknown>, who = owner) => who.post(`/api/shop/lending/loans/${loan.id}/payments`).send({ mode: 'Cash', ...body });
    expect((await pay({ amount: 1001 })).status).toBe(400);
    expect((await pay({ amount: 100, mode: 'UPI' })).status).toBe(400); // UPI needs a reference
    const first = await pay({ amount: 300, requestId: 'req-000000001' });
    expect(first.status).toBe(200);
    expect(first.body.payment).toMatchObject({ amount: 300, principalPart: 300, balanceBefore: 1000, balanceAfter: 700 });
    expect(first.body.payment.receiptNo).toMatch(/^RCP-\d{8}-\d{4}$/);
    const again = await pay({ amount: 300, requestId: 'req-000000001' });
    expect(again.body.duplicate).toBe(true);
    expect(again.body.loan.state.balance).toBe(700);
    expect(again.body.loan.state.instalmentsPaid).toBe(3);
    expect((await pay({ amount: 700, kind: 'Prepayment' })).status).toBe(400); // prepayment must be below the balance
    const last = await pay({ amount: 700 });
    expect(last.body.loan.state).toMatchObject({ balance: 0, status: 'Closed', remaining: 0 });
    expect((await pay({ amount: 1 })).status).toBe(409);
    const reopened = await owner.post(`/api/shop/lending/payments/${last.body.payment.id}/reverse`).send({ reason: 'Entered twice by mistake' });
    expect(reopened.body.state).toMatchObject({ balance: 700, status: 'Active' });
    expect((await manager.post(`/api/shop/lending/payments/${first.body.payment.id}/reverse`).send({ reason: 'Not allowed for managers' })).status).toBe(403);
    expect(await trialBalanced()).toBe(true);
  });

  it('never overpays when two collectors pay the full balance at once', async () => {
    const b = await newBorrower('9876503333'); await approve(b.id);
    const loan = (await giveLoan(b.id, { principal: 500, periods: 5 })).body;
    const both = await Promise.all([1, 2].map(() => owner.post(`/api/shop/lending/loans/${loan.id}/payments`).send({ amount: 500, mode: 'Cash' })));
    expect(both.map((r) => r.status).sort()).toEqual([200, 409]);
  });

  it('closes a loan in full with typed confirmation', async () => {
    const b = await newBorrower('9876504444'); await approve(b.id);
    const loan = (await giveLoan(b.id, { principal: 2000, periods: 10 })).body;
    expect((await owner.post(`/api/shop/lending/loans/${loan.id}/close`).send({ mode: 'Cash', reason: 'Settled early', confirm: 'wrong' })).status).toBe(400);
    const r = await owner.post(`/api/shop/lending/loans/${loan.id}/close`).send({ mode: 'Cash', reason: 'Settled early', confirm: loan.number });
    expect(r.body.payment).toMatchObject({ amount: 2000, kind: 'Closure' });
    expect(r.body.loan.state.status).toBe('Closed');
    expect(r.body.loan.closureReason).toBe('Settled early');
  });

  it('applies late charges only to defaulters, once per instalment, and collects them first', async () => {
    const loans = (await owner.get('/api/shop/lending/loans')).body;
    const def = loans.find((l: any) => l.state.isDefaulter && l.lateFee > 0);
    const fine = loans.find((l: any) => !l.state.isDefaulter && l.state.status === 'Active' && l.lateFee > 0);
    expect(def).toBeTruthy();
    if (fine) expect((await owner.post(`/api/shop/lending/loans/${fine.id}/late-charge`).send({ instalment: 1 })).status).toBe(409);
    const detail = (await owner.get(`/api/shop/lending/loans/${def.id}`)).body;
    const n = detail.lateCharge.nextInstalment;
    expect(n).toBeTruthy();
    const after = await owner.post(`/api/shop/lending/loans/${def.id}/late-charge`).send({ instalment: n });
    expect(after.body.state.penaltyBalance).toBeGreaterThan(def.state.penaltyBalance);
    expect((await owner.post(`/api/shop/lending/loans/${def.id}/late-charge`).send({ instalment: n })).status).toBe(409);
    const pay = await owner.post(`/api/shop/lending/loans/${def.id}/payments`).send({ amount: after.body.state.penaltyBalance + 10, mode: 'Cash' });
    expect(pay.body.payment.penaltyPart).toBe(after.body.state.penaltyBalance);
    expect(pay.body.payment.principalPart).toBe(10);
    expect(await trialBalanced()).toBe(true);
  });

  it('brings in an existing loan with what was already repaid, outside today’s collections', async () => {
    const b = await newBorrower('9876505555'); await approve(b.id);
    const old = new Date(Date.now() - 200 * 86_400_000).toISOString().slice(0, 10);
    const r = await giveLoan(b.id, { loanType: 'Monthly EMI', principal: 24000, periods: 12, borrowDate: old, existingLoan: true, alreadyRepaid: 12000, ackReference: '' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.state).toMatchObject({ balance: 12000, instalmentsPaid: 6 });
    const day = (await owner.get('/api/shop/lending/payments')).body;
    expect(day.payments.some((p: any) => p.kind === 'Opening balance')).toBe(false);
    expect(await trialBalanced()).toBe(true);
  });

  it('limits collectors to their own loans and keeps other roles out', async () => {
    const mine = (await collector.get('/api/shop/lending/loans')).body;
    const all = (await owner.get('/api/shop/lending/loans')).body;
    expect(mine.length).toBeGreaterThan(0);
    expect(mine.length).toBeLessThan(all.length);
    expect(mine.every((l: any) => l.collectorName === 'Arun Selvam')).toBe(true);
    const other = all.find((l: any) => l.collectorName !== 'Arun Selvam' && l.state.status === 'Active');
    expect((await collector.get(`/api/shop/lending/loans/${other.id}`)).status).toBe(404);
    expect((await collector.post(`/api/shop/lending/loans/${other.id}/payments`).send({ amount: 10, mode: 'Cash' })).status).toBe(404);
    const own = mine.find((l: any) => l.state.status === 'Active');
    expect((await collector.post(`/api/shop/lending/loans/${own.id}/payments`).send({ amount: 10, mode: 'Cash' })).status).toBe(200);
    expect((await collector.get('/api/shop/lending/borrowers')).status).toBe(403);
    expect((await collector.post('/api/shop/lending/loans').send({})).status).toBe(403);
    expect((await sales.get('/api/shop/lending/dashboard')).status).toBe(403);
  });

  it('is invisible when switched off', async () => {
    expect((await manager.put('/api/shop/lending/enabled').send({ enabled: false })).status).toBe(403);
    await owner.put('/api/shop/lending/enabled').send({ enabled: false });
    const r = await owner.get('/api/shop/lending/dashboard');
    expect(r.status).toBe(404);
    expect(r.body.code).toBe('lending_off');
    await owner.put('/api/shop/lending/enabled').send({ enabled: true });
    expect((await owner.get('/api/shop/lending/dashboard')).status).toBe(200);
  });
});
