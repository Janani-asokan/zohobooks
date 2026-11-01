/*
 * Festival offers and loyalty points. Pure functions shared by the server (which decides what is charged) and the
 * screens (which show the same numbers before the bill is saved).
 *
 * - An item offer takes a percentage off matching lines (every item, some categories, or chosen items). A line
 *   gets the larger of the discount typed on it and the best offer for it; offers never stack on one line.
 * - A bill offer takes a percentage or an amount off the bill when it reaches a minimum value. Only the best one
 *   applies.
 * - Loyalty: points are earned on what the customer pays and can pay for part of a later bill.
 * Discounts are spread into the invoice lines, so GST is charged on the reduced value and credit notes stay exact.
 */
import { applyBillAdjustments, lineAmount, r2, type BillDiscount, type CalcLine } from './calc';

export type OfferKind = 'item' | 'bill';
export type OfferScope = 'all' | 'category' | 'items';

export interface Offer {
  id: string;
  name: string;
  kind: OfferKind;
  /** Item offers are always a percentage; bill offers may be a percentage or a rupee amount. */
  discountKind: 'percent' | 'amount';
  value: number;
  scope: OfferScope;
  categories: string[];
  itemIds: string[];
  /** Bill offers: the bill (what the customer pays after item offers and the typed discount, with GST) must reach this. */
  minBill: number;
  startsOn: string;
  endsOn: string;
  /** Printed on bills that use the offer, e.g. "Happy Diwali! 10% off all toys". */
  message: string;
  active: boolean;
}

export interface OfferLine extends CalcLine { itemId: string; category?: string }

export interface AppliedOffer { id: string; name: string; kind: OfferKind; message: string; amount: number }

/** Offers running on a date (inclusive), not paused. */
export const runningOn = (offers: Offer[], date: string) => offers.filter((o) => o.active && o.startsOn <= date && date <= o.endsOn);

export function offerStatus(o: Offer, today: string): 'Running' | 'Upcoming' | 'Ended' | 'Paused' {
  if (!o.active) return 'Paused';
  if (today < o.startsOn) return 'Upcoming';
  if (today > o.endsOn) return 'Ended';
  return 'Running';
}

const matches = (o: Offer, l: OfferLine) =>
  o.scope === 'all' || (o.scope === 'items' && o.itemIds.includes(l.itemId)) ||
  (o.scope === 'category' && !!l.category && o.categories.some((c) => c.trim().toLowerCase() === l.category!.trim().toLowerCase()));

/**
 * Picks the item offer for each line. Returns the lines with their new discount and, per line, the offer used
 * (null when the typed discount was already as good).
 */
export function applyItemOffers<L extends OfferLine>(lines: L[], offers: Offer[], skip: string[] = []): { lines: L[]; used: (Offer | null)[] } {
  const itemOffers = offers.filter((o) => o.kind === 'item' && o.discountKind === 'percent' && o.value > 0 && !skip.includes(o.id));
  const used: (Offer | null)[] = [];
  const out = lines.map((l) => {
    const best = itemOffers.filter((o) => matches(o, l)).sort((a, b) => b.value - a.value)[0];
    if (best && Math.min(100, best.value) > (l.discount || 0)) {
      used.push(best);
      return { ...l, discount: Math.min(100, best.value) };
    }
    used.push(null);
    return l;
  });
  return { lines: out, used };
}

/** The best bill offer for a bill of this value (what the customer would pay before the offer, with GST), or null. */
export function bestBillOffer(offers: Offer[], billValue: number, skip: string[] = []): Offer | null {
  const worth = (o: Offer) => (o.discountKind === 'percent' ? (billValue * Math.min(100, o.value)) / 100 : Math.min(o.value, billValue));
  const ok = offers.filter((o) => o.kind === 'bill' && o.value > 0 && !skip.includes(o.id) && billValue >= o.minBill);
  return ok.sort((a, b) => worth(b) - worth(a))[0] ?? null;
}

/** What the customer pays for these lines, with GST when it applies (before round-off). */
export const payable = (lines: CalcLine[], withGst: boolean) => r2(lines.reduce((s, l) => s + lineAmount(l) * (withGst ? 1 + l.taxRate / 100 : 1), 0));

export const offerAsDiscount = (o: Offer): BillDiscount => ({ kind: o.discountKind, value: o.value });

/** Rupees an item offer saved the customer: the extra discount it gave over what was typed, with GST when charged. */
export function itemOfferSavings(before: CalcLine[], after: CalcLine[], used: (Offer | null)[], gstOnTop = false): AppliedOffer[] {
  const byId = new Map<string, AppliedOffer>();
  used.forEach((o, i) => {
    if (!o) return;
    const saved = (lineAmount(before[i]!) - lineAmount(after[i]!)) * (gstOnTop ? 1 + before[i]!.taxRate / 100 : 1);
    const a = byId.get(o.id) ?? { id: o.id, name: o.name, kind: o.kind, message: o.message, amount: 0 };
    a.amount = r2(a.amount + saved);
    byId.set(o.id, a);
  });
  return [...byId.values()];
}

/* ---------------- Loyalty ---------------- */

export interface LoyaltySettings {
  enabled: boolean;
  /** Points earned for every ₹100 the customer pays. */
  earnPer100: number;
  /** Rupees one point is worth when used. */
  pointValue: number;
  /** Points needed before they can be used. */
  minRedeem: number;
  /** At most this share of a bill can be paid with points. */
  maxRedeemPct: number;
}

export const LOYALTY_DEFAULTS: LoyaltySettings = { enabled: false, earnPer100: 1, pointValue: 1, minRedeem: 50, maxRedeemPct: 50 };

export function withLoyaltyDefaults(s: Partial<LoyaltySettings> | null | undefined): LoyaltySettings {
  return { ...LOYALTY_DEFAULTS, ...(s ?? {}) };
}

/** Whole points earned on an amount paid (rounded down, so a customer never gets more than the rule gives). */
export const pointsEarned = (s: LoyaltySettings, paid: number) => (s.enabled && paid > 0 ? Math.floor((paid * s.earnPer100) / 100) : 0);

/**
 * How many points a customer may use on a bill: no more than they have, no more than the bill's limit, and none
 * until they reach the minimum. Returns whole points.
 */
export function redeemablePoints(s: LoyaltySettings, balance: number, billTotal: number): number {
  if (!s.enabled || s.pointValue <= 0 || balance < s.minRedeem || billTotal <= 0) return 0;
  const byBill = Math.floor((billTotal * (s.maxRedeemPct / 100)) / s.pointValue);
  return Math.max(0, Math.min(Math.floor(balance), byBill));
}

export const pointsValue = (s: LoyaltySettings, points: number) => r2(points * s.pointValue);

/* ---------------- One bill, start to finish ---------------- */

export interface PriceBillInput<L extends OfferLine> {
  lines: L[];
  withGst: boolean;
  pricesIncludeTax?: boolean;
  billDiscount?: BillDiscount | null;
  /** Offers running on the bill date. Empty when the shop does not have offers. */
  offers: Offer[];
  /** Offers the cashier took off this bill. */
  skip?: string[];
  /** Loyalty points used on this bill, already checked against the customer's balance and the shop's limits. */
  redeem?: { points: number; pointValue: number } | null;
}

export interface PricedBill<L> {
  lines: L[];
  /** Offers that changed the bill, with what each saved the customer. */
  applied: AppliedOffer[];
  /** Rupees the points took off (0 when none were used). */
  redeemValue: number;
  /** True when offers or points changed anything, so the typed rate and discount must be kept on each line. */
  changed: boolean;
  /** The item offer each line got, by line (null when none). */
  lineOffers: (Offer | null)[];
}

/**
 * Item offers, then MRP billing and the typed bill discount, then the best bill offer, then loyalty points. The
 * server runs this to decide what is charged; the screens run it to show the same numbers first.
 */
export function priceBill<L extends OfferLine>(input: PriceBillInput<L>): PricedBill<L> {
  const { withGst, pricesIncludeTax, billDiscount, offers, skip = [] } = input;
  const item = applyItemOffers(input.lines, offers, skip);
  // Savings on lines are in what the customer pays: MRP rates already include GST, other GST rates do not.
  const applied = itemOfferSavings(input.lines, item.lines, item.used, withGst && !pricesIncludeTax);
  let lines = applyBillAdjustments(item.lines, { pricesIncludeTax, billDiscount, withGst });
  const bill = bestBillOffer(offers, payable(lines, withGst), skip);
  if (bill) {
    const before = payable(lines, withGst);
    lines = applyBillAdjustments(lines, { withGst, extra: [offerAsDiscount(bill)] });
    applied.push({ id: bill.id, name: bill.name, kind: 'bill', message: bill.message, amount: r2(before - payable(lines, withGst)) });
  }
  let redeemValue = 0;
  const r = input.redeem;
  if (r && r.points > 0 && r.pointValue > 0) {
    const due = payable(lines, withGst);
    redeemValue = r2(Math.min(r.points * r.pointValue, due));
    if (redeemValue > 0) lines = applyBillAdjustments(lines, { withGst, extra: [{ kind: 'amount', value: redeemValue }] });
  }
  const changed = item.used.some(Boolean) || !!bill || redeemValue > 0;
  return { lines, applied: applied.filter((a) => a.amount > 0), redeemValue, changed, lineOffers: item.used };
}
