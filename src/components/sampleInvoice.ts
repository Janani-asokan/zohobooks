import type { Invoice } from '@/api/types';

/** A realistic two-rate invoice for layout previews (Print settings). */
export const SAMPLE_INVOICE: Invoice = {
  id: 'sample', number: 'INV-2026-27-0042', fy: '2026-27', customerId: null, branchId: null, date: '2026-10-18', dueDate: '2026-11-02',
  customer: { customId: 'C-0007', type: 'Business', name: 'Priya Raman', companyName: 'Raman Traders', gstin: '33AAKFR2211M1Z4', email: 'accounts@ramantraders.in', phone: '+91 98410 22334', state: 'Tamil Nadu', address: '18 Bazaar Street\nMylapore, Chennai 600004' },
  shipTo: { name: 'Raman Traders — Godown', address: '7 SIDCO Industrial Estate\nAmbattur, Chennai 600098', state: 'Tamil Nadu', gstin: '' },
  lines: [
    { id: 'l1', itemId: 'i1', name: 'Wireless Keyboard and Mouse Combo', type: 'Goods', hsn: '8471', unit: 'pcs', qty: 10, rate: 1450, tier: 'SP1', taxRate: 18, discount: 5, amount: 13775 },
    { id: 'l2', itemId: 'i2', name: 'A4 Copier Paper (500 sheets)', type: 'Goods', hsn: '4802', unit: 'ream', qty: 25, rate: 300, tier: 'SP1', taxRate: 12, discount: 0, amount: 7500 },
    { id: 'l3', itemId: 'i3', name: 'On-site installation', type: 'Services', hsn: '9987', unit: 'job', qty: 1, rate: 1500, tier: 'SP1', taxRate: 18, discount: 0, amount: 1500 },
  ],
  withGst: true, docType: 'TAX INVOICE', placeOfSupply: 'Tamil Nadu', interState: false, reverseCharge: false, tcsRate: 0,
  status: 'Issued', paymentStatus: 'Sent', subTotal: 22775, discount: 725, taxTotal: 3649.5, cgst: 1824.75, sgst: 1824.75, igst: 0, tcs: 0,
  roundOff: -0.5, total: 26424, amountPaid: 0, amountCredited: 0, balance: 26424, notes: 'Delivery within 3 working days.', source: 'app',
  salesOrderId: null, recurringId: null, publicToken: null, lastReminderAt: null, cancelReason: '', cancelledAt: null, issuedAt: null, createdAt: '2026-10-18T10:00:00Z',
  terms: '', einvoice: null, eway: null,
};
