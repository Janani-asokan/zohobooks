import { describe, expect, it } from 'vitest';
import { computeTotals } from './calc';
import { bestBillOffer, offerStatus, pointsEarned, priceBill, redeemablePoints, runningOn, withLoyaltyDefaults, type Offer } from './offers';

const base: Offer = { id: 'o1', name: 'Diwali', kind: 'item', discountKind: 'percent', value: 10, scope: 'all', categories: [], itemIds: [], minBill: 0, startsOn: '2026-10-20', endsOn: '2026-11-05', message: 'Happy Diwali!', active: true };
const line = (itemId: string, rate: number, taxRate = 5, category = 'Toys', discount = 0) => ({ itemId, qty: 1, rate, taxRate, discount, category });

describe('festival offers', () => {
  it('run only between their dates and when not paused', () => {
    expect(runningOn([base], '2026-11-01')).toHaveLength(1);
    expect(runningOn([base], '2026-11-06')).toHaveLength(0);
    expect(runningOn([{ ...base, active: false }], '2026-11-01')).toHaveLength(0);
    expect(offerStatus(base, '2026-10-01')).toBe('Upcoming');
    expect(offerStatus(base, '2026-12-01')).toBe('Ended');
  });

  it('an item offer takes 10% off and the bill and GST follow', () => {
    const p = priceBill({ lines: [line('a', 1000)], withGst: true, offers: [base] });
    const t = computeTotals(p.lines, true);
    expect(t.subTotal).toBe(900);
    expect(t.taxTotal).toBe(45);
    expect(p.applied).toEqual([{ id: 'o1', name: 'Diwali', kind: 'item', message: 'Happy Diwali!', amount: 105 }]);
  });

  it('offers do not stack on a line: the bigger of the typed discount and the offer wins', () => {
    const p = priceBill({ lines: [line('a', 1000, 5, 'Toys', 15)], withGst: true, offers: [base, { ...base, id: 'o2', value: 12 }] });
    expect(p.lines[0]!.discount).toBe(15);
    expect(p.applied).toEqual([]);
  });

  it('category and chosen-item offers only touch matching lines', () => {
    const cat = { ...base, scope: 'category' as const, categories: ['soft toys'] };
    const p = priceBill({ lines: [line('a', 500, 5, 'Soft Toys'), line('b', 500, 18, 'Electronic toys')], withGst: true, offers: [cat] });
    expect(p.lines.map((l) => l.discount)).toEqual([10, 0]);
    const pick = { ...base, scope: 'items' as const, itemIds: ['b'] };
    expect(priceBill({ lines: [line('a', 500), line('b', 500)], withGst: false, offers: [pick] }).lines.map((l) => l.discount)).toEqual([0, 10]);
  });

  it('a bill offer needs the minimum bill and only the best one applies', () => {
    const flat = { ...base, id: 'b1', kind: 'bill' as const, discountKind: 'amount' as const, value: 200, minBill: 2000 };
    const pct = { ...base, id: 'b2', kind: 'bill' as const, value: 5, minBill: 1000 };
    expect(bestBillOffer([flat, pct], 1500)?.id).toBe('b2');
    expect(bestBillOffer([flat, pct], 3000)?.id).toBe('b1');
    expect(bestBillOffer([flat], 1999)).toBeNull();
    const p = priceBill({ lines: [line('a', 2000, 0)], withGst: true, offers: [flat] });
    expect(computeTotals(p.lines, true).total).toBe(1800);
  });

  it('a skipped offer is left off', () => {
    expect(priceBill({ lines: [line('a', 1000)], withGst: true, offers: [base], skip: ['o1'] }).changed).toBe(false);
  });
});

describe('loyalty points', () => {
  const s = withLoyaltyDefaults({ enabled: true, earnPer100: 2, pointValue: 1, minRedeem: 50, maxRedeemPct: 50 });
  it('earn whole points on what is paid', () => {
    expect(pointsEarned(s, 1249)).toBe(24);
    expect(pointsEarned({ ...s, enabled: false }, 1249)).toBe(0);
  });
  it('can be used only above the minimum, up to the balance and the bill limit', () => {
    expect(redeemablePoints(s, 40, 1000)).toBe(0);
    expect(redeemablePoints(s, 300, 1000)).toBe(300);
    expect(redeemablePoints(s, 900, 1000)).toBe(500);
  });
  it('points take rupees off what the customer pays, GST included', () => {
    const p = priceBill({ lines: [line('a', 1000, 18)], withGst: true, offers: [], redeem: { points: 100, pointValue: 1 } });
    expect(p.redeemValue).toBe(100);
    expect(computeTotals(p.lines, true).total).toBe(1080);
  });
});
