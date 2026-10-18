import { daysUntil } from './fy';

/** Draft → Sent (issued, nothing paid) → Partially Paid → Paid; Overdue once past due with a balance; Void when cancelled. */
export type InvoiceStatus = 'Draft' | 'Sent' | 'Partially Paid' | 'Paid' | 'Overdue' | 'Void';

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
  if (i.status === 'Cancelled') return 'Void';
  const bal = balanceDue(i);
  if (bal <= 0) return 'Paid';
  if (daysUntil(i.dueDate, today) < 0) return 'Overdue';
  if (i.amountPaid > 0) return 'Partially Paid';
  return 'Sent';
}
