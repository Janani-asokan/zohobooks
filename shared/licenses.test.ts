import { describe, expect, it } from 'vitest';
import { addMonths, blocksBilling, capacityCheck, dueAlert, gatesInvoice, licenseStatus, nextTerm, prorate, scaledPrice, splitOverage } from './licenses';

const lic = (expiryDate: string, graceDays = 0, suspended = false) => ({ expiryDate, graceDays, suspended });

describe('licence status state machine', () => {
  it('moves active → expiring soon → grace → expired by date', () => {
    expect(licenseStatus(lic('2026-12-31', 15), '2026-11-01').status).toBe('active');
    expect(licenseStatus(lic('2026-12-31', 15), '2026-12-01').status).toBe('expiring_soon'); // 30 days left
    expect(licenseStatus(lic('2026-12-31', 15), '2026-12-31').status).toBe('expiring_soon'); // last valid day
    expect(licenseStatus(lic('2026-12-31', 15), '2027-01-01').status).toBe('grace');
    expect(licenseStatus(lic('2026-12-31', 15), '2027-01-15').status).toBe('grace');          // last grace day
    expect(licenseStatus(lic('2026-12-31', 15), '2027-01-16').status).toBe('expired');
    expect(licenseStatus(lic('2026-12-31', 0), '2027-01-01').status).toBe('expired');        // no grace
  });
  it('lets a grace extension bring an expired licence back into grace', () => {
    expect(licenseStatus(lic('2026-12-31', 15), '2027-01-20', 10)).toMatchObject({ status: 'grace', graceEnds: '2027-01-25' });
  });
  it('suspension wins over every date state, and only expired/suspended block billing', () => {
    expect(licenseStatus(lic('2030-01-01', 0, true), '2026-11-17').status).toBe('suspended');
    expect(['active', 'expiring_soon', 'grace', 'expired', 'suspended'].filter((s) => blocksBilling(s as never))).toEqual(['expired', 'suspended']);
  });
});

describe('expiry reminders', () => {
  it('sends each threshold once and only the current one after a gap', () => {
    expect(dueAlert(120, new Set())).toBeNull();
    expect(dueAlert(90, new Set())).toBe(90);
    expect(dueAlert(75, new Set([90]))).toBeNull();
    expect(dueAlert(5, new Set([90]))).toBe(7);  // 60 and 30 were missed: only 7 goes out
    expect(dueAlert(0, new Set([90, 60, 30, 7]))).toBe(0);
    expect(dueAlert(-3, new Set([0]))).toBeNull();
  });
});

describe('which invoices a licence gates', () => {
  const base = { branchId: 'w1', customerId: null, enforceScope: 'service_items' as const };
  it('checks warehouse, client and scope', () => {
    expect(gatesInvoice(base, { branchId: 'w1', customerId: 'c1', hasServiceLines: true })).toBe(true);
    expect(gatesInvoice(base, { branchId: 'w1', customerId: 'c1', hasServiceLines: false })).toBe(false);
    expect(gatesInvoice(base, { branchId: 'w2', customerId: 'c1', hasServiceLines: true })).toBe(false);
    expect(gatesInvoice({ ...base, customerId: 'c2' }, { branchId: 'w1', customerId: 'c1', hasServiceLines: true })).toBe(false);
    expect(gatesInvoice({ ...base, enforceScope: 'all' }, { branchId: 'w1', customerId: null, hasServiceLines: false })).toBe(true);
    expect(gatesInvoice({ ...base, enforceScope: 'none' }, { branchId: 'w1', customerId: null, hasServiceLines: true })).toBe(false);
  });
});

describe('capacity and overage', () => {
  const L = { id: 'l1', usageItemId: 'pallet', maxCapacity: 100, overageRate: 75, capacityUnit: 'pallets', licenseNumber: 'SC-1' };
  it('measures usage on the licence item only', () => {
    const c = capacityCheck([{ itemId: 'pallet', qty: 80 }, { itemId: 'pallet', qty: 45 }, { itemId: 'other', qty: 999 }], L)!;
    expect(c).toMatchObject({ billed: 125, excess: 25, overageAmount: 1875, suggestedCapacity: 130 });
    expect(capacityCheck([{ itemId: 'pallet', qty: 100 }], L)!.excess).toBe(0);
  });
  it('splits the excess onto an overage line at the overage rate', () => {
    const out = splitOverage([{ itemId: 'pallet', qty: 80, rate: 50 }, { itemId: 'x', qty: 1, rate: 10 }, { itemId: 'pallet', qty: 45, rate: 50 }], L);
    expect(out.map((l) => [l.itemId, l.qty, l.rate])).toEqual([['pallet', 80, 50], ['x', 1, 10], ['pallet', 20, 50], ['pallet', 25, 75]]);
    expect((out.at(-1) as { note?: string }).note).toContain('Overage above licensed 100 pallets');
  });
});

describe('proration', () => {
  it('charges the days left in the term, both ends counted', () => {
    // 365-day term; upgrade from 1 Jul leaves 184 days (1 Jul to 31 Dec).
    expect(prorate(36500, '2026-01-01', '2026-12-31', '2026-07-01')).toEqual({ days: 184, totalDays: 365, amount: 18400 });
    expect(prorate(36500, '2026-01-01', '2026-12-31', '2025-12-01').amount).toBe(36500);
    expect(prorate(36500, '2026-01-01', '2026-12-31', '2027-01-01').amount).toBe(0);
  });
  it('handles leap years and month ends', () => {
    expect(prorate(366, '2028-01-01', '2028-12-31', '2028-02-29')).toMatchObject({ days: 307, totalDays: 366, amount: 307 });
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(nextTerm('2026-12-31', 12)).toEqual({ start: '2027-01-01', end: '2027-12-31' });
    expect(nextTerm('2027-01-30', 1)).toEqual({ start: '2027-01-31', end: '2027-02-27' });
    expect(scaledPrice(12000, 100, 150)).toBe(18000);
  });
});
