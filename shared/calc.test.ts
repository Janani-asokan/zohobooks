import { describe, expect, it } from 'vitest';
import { computeTotals } from './calc';
import { formatInvoiceNumber, fyLabel, fyRange, invoiceCounterKey } from './fy';
import { invoiceStatus } from './status';
import { gstinMatchesState, isInterState } from './gst';
import { parseCsv, toCsv } from './csv';

describe('computeTotals', () => {
  const lines = [
    { qty: 2, rate: 100, taxRate: 18, discount: 0 },
    { qty: 1, rate: 50, taxRate: 5, discount: 10 },
  ];
  it('splits CGST/SGST for intra-state', () => {
    const t = computeTotals(lines, true, false);
    expect(t.subTotal).toBe(245);
    expect(t.taxTotal).toBe(38.25);
    expect(t.cgst + t.sgst).toBe(38.25);
    expect(t.igst).toBe(0);
    expect(t.total).toBe(283);
    expect(t.roundOff).toBe(-0.25);
  });
  it('uses IGST for inter-state', () => {
    const t = computeTotals(lines, true, true);
    expect(t.igst).toBe(38.25);
    expect(t.cgst).toBe(0);
  });
  it('ignores tax in net mode', () => {
    const t = computeTotals(lines, false);
    expect(t.taxTotal).toBe(0);
    expect(t.total).toBe(245);
  });
  it('adds TCS on taxable + GST', () => {
    const t = computeTotals([{ qty: 1, rate: 100000, taxRate: 18 }], true, false, 0.1);
    expect(t.tcs).toBe(118);
    expect(t.total).toBe(118118);
  });
});

describe('financial year', () => {
  it('runs April to March', () => {
    expect(fyLabel('2026-03-31')).toBe('2025-26');
    expect(fyLabel('2026-04-01')).toBe('2026-27');
    const r = fyRange('2026-10-14');
    expect(r.start.getMonth()).toBe(3);
    expect(r.end.getMonth()).toBe(2);
    expect(r.end.getDate()).toBe(31);
  });
  it('embeds FY in numbers only when auto-reset is on', () => {
    expect(formatInvoiceNumber(7, '2026-27', true)).toBe('INV-2026-27-0007');
    expect(formatInvoiceNumber(7, '2026-27', false)).toBe('INV-0007');
    expect(invoiceCounterKey('inv', '2026-27', true)).toBe('inv:2026-27');
    expect(invoiceCounterKey('inv', '2026-27', false)).toBe('inv:all');
  });
});

describe('invoice status', () => {
  const base = { status: 'Issued' as const, total: 1000, amountPaid: 0, amountCredited: 0, dueDate: '2099-01-01' };
  it('derives payment state', () => {
    expect(invoiceStatus(base)).toBe('Unpaid');
    expect(invoiceStatus({ ...base, amountPaid: 400 })).toBe('Partially Paid');
    expect(invoiceStatus({ ...base, amountPaid: 600, amountCredited: 400 })).toBe('Paid');
    expect(invoiceStatus({ ...base, dueDate: '2000-01-01' })).toBe('Overdue');
    expect(invoiceStatus({ ...base, status: 'Cancelled' })).toBe('Cancelled');
  });
});

describe('gst helpers', () => {
  it('matches GSTIN state codes', () => {
    expect(gstinMatchesState('33AABCA1234F1Z5', 'Tamil Nadu')).toBe(true);
    expect(gstinMatchesState('29AABCA1234F1Z5', 'Tamil Nadu')).toBe(false);
    expect(isInterState('Tamil Nadu', 'Kerala')).toBe(true);
  });
});

describe('csv', () => {
  it('round-trips quotes, commas and newlines', () => {
    const csv = toCsv([{ a: 'x, "y"', b: 'line1\nline2' }], [{ key: 'a', label: 'Name' }, { key: 'b', label: 'Notes' }]);
    expect(parseCsv(csv)).toEqual([{ name: 'x, "y"', notes: 'line1\nline2' }]);
  });
});
