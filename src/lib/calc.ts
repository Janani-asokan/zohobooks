import type { LineItem } from './types';

export interface TaxBreakup {
  rate: number;
  taxable: number;
  tax: number;
}

export interface Totals {
  subTotal: number; // after line discounts, before tax
  discount: number;
  taxTotal: number;
  cgst: number;
  sgst: number;
  igst: number;
  breakup: TaxBreakup[];
  roundOff: number;
  total: number;
}

export const lineAmount = (l: LineItem) => l.qty * l.rate * (1 - (l.discount || 0) / 100);

/**
 * Compute invoice totals.
 * withGst=false → "Net price" mode: tax is ignored entirely.
 * interState=true → IGST, otherwise split equally into CGST + SGST.
 */
export function computeTotals(lines: LineItem[], withGst: boolean, interState = false): Totals {
  let subTotal = 0;
  let discount = 0;
  const byRate = new Map<number, TaxBreakup>();
  for (const l of lines) {
    const gross = l.qty * l.rate;
    const amt = lineAmount(l);
    subTotal += amt;
    discount += gross - amt;
    if (withGst && l.taxRate > 0) {
      const b = byRate.get(l.taxRate) ?? { rate: l.taxRate, taxable: 0, tax: 0 };
      b.taxable += amt;
      b.tax += (amt * l.taxRate) / 100;
      byRate.set(l.taxRate, b);
    }
  }
  const breakup = [...byRate.values()].sort((a, b) => a.rate - b.rate);
  const taxTotal = breakup.reduce((s, b) => s + b.tax, 0);
  const raw = subTotal + taxTotal;
  const total = Math.round(raw);
  return {
    subTotal,
    discount,
    taxTotal,
    cgst: interState ? 0 : taxTotal / 2,
    sgst: interState ? 0 : taxTotal / 2,
    igst: interState ? taxTotal : 0,
    breakup,
    roundOff: total - raw,
    total,
  };
}
