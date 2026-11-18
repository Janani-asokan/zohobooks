import { describe, expect, it } from 'vitest';
import { blendCost, destinationPrice, maskEmail, OTP, otpState, receiptError, ruleMatches, withManualPrice, type PricingRule } from './transfers';

const rule = (p: Partial<PricingRule>): PricingRule => ({
  id: 'r', name: 'Rule', kind: 'location', branchId: 'B', itemId: null, category: null, adjustType: 'percent', adjustValue: 0,
  startsOn: null, endsOn: null, priority: 100, roundTo: 0, active: true, ...p,
});
const at = { branchId: 'B', itemId: 'apple', category: 'Fruit', date: '2026-11-18' };

describe('destination pricing', () => {
  it('applies location rules, then seasonal rules running that day, in priority order', () => {
    const rules = [
      rule({ id: 's', name: 'Winter', kind: 'seasonal', adjustType: 'percent', adjustValue: -10, startsOn: '2026-11-01', endsOn: '2027-01-31' }),
      rule({ id: 'l2', name: 'Hill transport', adjustType: 'amount', adjustValue: 5, priority: 200 }),
      rule({ id: 'l1', name: 'Ooty branch', adjustType: 'percent', adjustValue: 20, priority: 10 }),
    ];
    const r = destinationPrice(100, rules, at);
    // 100 × 1.2 = 120, + 5 = 125, then winter −10 % = 112.5
    expect(r.price).toBe(112.5);
    expect(r.applied.map((a) => [a.name, a.after])).toEqual([['Ooty branch', 120], ['Hill transport', 125], ['Winter', 112.5]]);
  });
  it('skips rules for other branches, items, categories, seasons and switched-off rules', () => {
    expect(ruleMatches(rule({ branchId: 'A' }), at)).toBe(false);
    expect(ruleMatches(rule({ branchId: null }), at)).toBe(true);
    expect(ruleMatches(rule({ itemId: 'mango' }), at)).toBe(false);
    expect(ruleMatches(rule({ category: 'fruit' }), at)).toBe(true);
    expect(ruleMatches(rule({ category: 'Dairy' }), at)).toBe(false);
    expect(ruleMatches(rule({ kind: 'seasonal', startsOn: '2026-06-01', endsOn: '2026-08-31' }), at)).toBe(false);
    expect(ruleMatches(rule({ active: false }), at)).toBe(false);
  });
  it('rounds to the largest step used, never goes below zero, and records a hand-set price', () => {
    expect(destinationPrice(99.4, [rule({ adjustValue: 7, roundTo: 5 })], at).price).toBe(105);
    expect(destinationPrice(10, [rule({ adjustType: 'amount', adjustValue: -50 })], at).price).toBe(0);
    const m = withManualPrice(destinationPrice(100, [], at), 118);
    expect(m.price).toBe(118);
    expect(m.applied.at(-1)).toMatchObject({ kind: 'manual', before: 100, after: 118 });
  });
});

describe('receipt and cost', () => {
  it('accounts for every unit sent', () => {
    expect(receiptError({ qtySent: 25, received: 25, damaged: 0, missing: 0 })).toBeNull();
    expect(receiptError({ qtySent: 25, received: 22, damaged: 2, missing: 1 })).toBeNull();
    expect(receiptError({ qtySent: 25, received: 22, damaged: 2, missing: 0 })).toMatch(/add up/);
    expect(receiptError({ qtySent: 25, received: 26, damaged: -1, missing: 0 })).toMatch(/negative/);
  });
  it('averages the cost when the batch already has stock at the destination', () => {
    expect(blendCost(0, null, 25, 40)).toBe(40);
    expect(blendCost(10, 30, 30, 40)).toBe(37.5);
  });
});

describe('OTP rules', () => {
  const now = new Date('2026-11-18T10:00:00Z');
  const code = (p: Partial<{ expiresAt: Date; attempts: number; usedAt: Date | null }>) => ({ expiresAt: new Date('2026-11-18T10:10:00Z'), attempts: 0, usedAt: null, ...p });
  it('opens, expires after 15 minutes, locks after 3 wrong tries, and is single-use', () => {
    expect(OTP).toMatchObject({ digits: 6, ttlMinutes: 15, maxAttempts: 3 });
    expect(otpState(code({}), now)).toBe('open');
    expect(otpState(code({ expiresAt: new Date('2026-11-18T09:59:59Z') }), now)).toBe('expired');
    expect(otpState(code({ attempts: 3 }), now)).toBe('locked');
    expect(otpState(code({ usedAt: now }), now)).toBe('none');
    expect(otpState(null, now)).toBe('none');
  });
  it('masks the email it was sent to', () => {
    expect(maskEmail('manager.ooty@shop.com')).toBe('ma••••••••••@shop.com');
    expect(maskEmail('ab@x.in')).toBe('ab•••@x.in');
  });
});
