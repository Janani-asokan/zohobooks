/** Indian financial year: 1 April → 31 March (start month configurable). */
const toDate = (d: Date | string) => (typeof d === 'string' ? new Date(d.length === 10 ? d + 'T00:00:00' : d) : d);

export function fyStartYear(date: Date | string = new Date(), startMonth = 4): number {
  const d = toDate(date);
  return d.getMonth() + 1 >= startMonth ? d.getFullYear() : d.getFullYear() - 1;
}

export function fyLabel(date: Date | string = new Date(), startMonth = 4): string {
  const y = fyStartYear(date, startMonth);
  return `${y}-${String((y + 1) % 100).padStart(2, '0')}`;
}

export function fyRange(date: Date | string = new Date(), startMonth = 4) {
  const y = fyStartYear(date, startMonth);
  return { start: new Date(y, startMonth - 1, 1), end: new Date(y + 1, startMonth - 1, 0) };
}

/** Whole days from today until the given ISO date (negative = past). */
export function daysUntil(iso: string, today: Date = new Date()): number {
  const ms = toDate(iso).setHours(0, 0, 0, 0) - new Date(today).setHours(0, 0, 0, 0);
  return Math.round(ms / 86400000);
}

/** Invoice number for a sequence value. With auto-reset the FY is embedded so numbers stay unique. */
export function formatInvoiceNumber(n: number, fy: string, autoReset: boolean, prefix = 'INV') {
  return `${prefix}-${autoReset ? fy + '-' : ''}${String(n).padStart(4, '0')}`;
}

export const invoiceCounterKey = (kind: string, fy: string, autoReset: boolean) => `${kind}:${autoReset ? fy : 'all'}`;
