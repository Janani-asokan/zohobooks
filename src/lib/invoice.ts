import type { Invoice, SalesOrder, Tenant } from './types';
import { computeTotals } from './calc';
import { daysUntil } from './fy';

export const isInterState = (t: Tenant, customerId: string) => {
  const c = t.customers.find((x) => x.id === customerId);
  return !!c && !!c.state && !!t.org.state && c.state !== t.org.state;
};

export const docTotals = (t: Tenant, doc: Pick<Invoice | SalesOrder, 'lines' | 'withGst' | 'customerId'>) =>
  computeTotals(doc.lines, doc.withGst, isInterState(t, doc.customerId));

/** Unpaid invoices past their due date read as Overdue. */
export const effectiveStatus = (inv: Invoice): Invoice['status'] =>
  inv.status === 'Unpaid' && daysUntil(inv.dueDate) < 0 ? 'Overdue' : inv.status;

export const INDIAN_STATES = [
  'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chhattisgarh', 'Delhi', 'Goa', 'Gujarat', 'Haryana', 'Himachal Pradesh',
  'Jammu and Kashmir', 'Jharkhand', 'Karnataka', 'Kerala', 'Madhya Pradesh', 'Maharashtra', 'Manipur', 'Meghalaya', 'Mizoram', 'Nagaland',
  'Odisha', 'Puducherry', 'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana', 'Tripura', 'Uttar Pradesh', 'Uttarakhand', 'West Bengal',
];
