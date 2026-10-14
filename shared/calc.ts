/** Minimal line shape needed for tax math (shared by invoices, orders, credit notes, POS). */
export interface CalcLine {
  qty: number;
  rate: number;
  taxRate: number;
  discount?: number; // percent
}

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
  tcs: number;
  breakup: TaxBreakup[];
  roundOff: number;
  total: number;
}

export const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export const lineAmount = (l: CalcLine) => r2(l.qty * l.rate * (1 - (l.discount || 0) / 100));

/**
 * Compute document totals.
 * withGst=false → "Net price" mode (or Bill of Supply): tax is ignored entirely.
 * interState=true → IGST, otherwise split equally into CGST + SGST.
 * tcsRate → Tax Collected at Source, applied on (taxable + GST).
 */
export function computeTotals(lines: CalcLine[], withGst: boolean, interState = false, tcsRate = 0): Totals {
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
  const breakup = [...byRate.values()].sort((a, b) => a.rate - b.rate).map((b) => ({ rate: b.rate, taxable: r2(b.taxable), tax: r2(b.tax) }));
  const taxTotal = r2(breakup.reduce((s, b) => s + b.tax, 0));
  const half = r2(taxTotal / 2);
  const tcs = tcsRate > 0 ? r2(((subTotal + taxTotal) * tcsRate) / 100) : 0;
  const raw = r2(subTotal + taxTotal + tcs);
  const total = Math.round(raw);
  return {
    subTotal: r2(subTotal),
    discount: r2(discount),
    taxTotal,
    cgst: interState ? 0 : half,
    sgst: interState ? 0 : r2(taxTotal - half),
    igst: interState ? taxTotal : 0,
    tcs,
    breakup,
    roundOff: r2(total - raw),
    total,
  };
}
