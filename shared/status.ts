import { daysUntil } from './fy';

export type InvoiceStatus = 'Draft' | 'Cancelled' | 'Paid' | 'Partially Paid' | 'Overdue' | 'Unpaid';

export interface StatusInput {
  status: 'Draft' | 'Issued' | 'Cancelled';
  total: number;
  amountPaid: number;
  amountCredited: number;
  dueDate: string;
}

export const balanceDue = (i: Pick<StatusInput, 'total' | 'amountPaid' | 'amountCredited'>) =>
  Math.round((i.total - i.amountPaid - i.amountCredited) * 100) / 100;

/** Customer-facing payment status derived from issue state, payments and credit notes. */
export function invoiceStatus(i: StatusInput, today = new Date()): InvoiceStatus {
  if (i.status === 'Draft') return 'Draft';
  if (i.status === 'Cancelled') return 'Cancelled';
  const bal = balanceDue(i);
  if (bal <= 0) return 'Paid';
  if (daysUntil(i.dueDate, today) < 0) return 'Overdue';
  if (i.amountPaid > 0) return 'Partially Paid';
  return 'Unpaid';
}
