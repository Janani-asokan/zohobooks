import { describe, expect, it } from 'vitest';
import { parseAmount, parseDate, parseDocumentText } from './extract';

describe('amounts and dates', () => {
  it('reads Indian amount styles', () => {
    expect(parseAmount('30k')).toBe(30000);
    expect(parseAmount('₹30,000')).toBe(30000);
    expect(parseAmount('Rs. 1,25,000.50/-')).toBe(125000.5);
    expect(parseAmount('1.5 lakh')).toBe(150000);
    expect(parseAmount('2 cr')).toBe(20000000);
    expect(parseAmount('INR 999')).toBe(999);
    expect(parseAmount('no price')).toBeNull();
  });
  it('reads day-first dates', () => {
    expect(parseDate('18/10/2026')).toBe('2026-10-18');
    expect(parseDate('05-04-26')).toBe('2026-04-05');
    expect(parseDate('18 Oct 2026')).toBe('2026-10-18');
    expect(parseDate('3rd Sept, 2026')).toBe('2026-09-03');
    expect(parseDate('2026-10-18')).toBe('2026-10-18');
    expect(parseDate('31/13/2026')).toBeNull();
  });
});

describe('product sheet', () => {
  it('fills an item from a spec sheet', () => {
    const { data } = parseDocumentText(
      `Dell 24 inch FHD Monitor\nProduct Name: Dell P2422H Monitor\nBrand: Dell\nCategory: Monitors\nSKU: DEL-P2422H\nHSN Code: 8528\nMRP: ₹38,999\nSelling Price: 30k\nPurchase price: 24,500\nGST 18%\nUnit: pcs`,
      'item',
    );
    const l = data.lines[0]!;
    expect(l).toMatchObject({ name: 'Dell P2422H Monitor', brand: 'Dell', category: 'Monitors', sku: 'DEL-P2422H', hsn: '8528', mrp: 38999, sellingPrice: 30000, costPrice: 24500, taxRate: 18, unit: 'pcs' });
  });
});

describe('vendor bill', () => {
  it('finds the vendor, number, dates, totals and rows', () => {
    const text = [
      'TAX INVOICE',
      'Redington India Ltd.',
      'GSTIN: 33AABCR1234D1Z8',
      'Invoice No: RIL/2026/0457   Invoice Date: 12/10/2026',
      'Due Date: 11-11-2026',
      'Bill To: Aravind Computer Store  GSTIN 33AABCA1234F1Z5',
      '1 Logitech M331 Silent Mouse 8471 10 pcs 850.00 18% 8,500.00',
      '2 USB-C Charging Cable 8544 20 pcs 90.00 5% 1,800.00',
      'Taxable Value 10,300.00',
      'CGST 9% 765.00',
      'SGST 9% 765.00',
      'Grand Total ₹11,830.00',
      'accounts@redington.in  +91 98400 11223',
    ].join('\n');
    const { data, confidence } = parseDocumentText(text, 'bill', '33AABCA1234F1Z5');
    expect(data.documentType).toBe('bill');
    expect(data.party.gstin).toBe('33AABCR1234D1Z8');
    expect(data.party.state).toBe('Tamil Nadu');
    expect(data.party.email).toBe('accounts@redington.in');
    expect(data.documentNumber).toBe('RIL/2026/0457');
    expect(data.date).toBe('2026-10-12');
    expect(data.dueDate).toBe('2026-11-11');
    expect(data.total).toBe(11830);
    expect(data.subtotal).toBe(10300);
    expect(data.taxTotal).toBe(1530);
    expect(data.lines).toHaveLength(2);
    expect(data.lines[0]).toMatchObject({ name: 'Logitech M331 Silent Mouse', hsn: '8471', qty: 10, unit: 'pcs', rate: 850, amount: 8500, taxRate: 18 });
    expect(confidence).toBeGreaterThan(0.5);
  });
});

describe('GST certificate', () => {
  it('reads the business name and state', () => {
    const { data } = parseDocumentText('Form GST REG-06\nRegistration Number: 32AAKFM4321P1Z9\nLegal Name: Menon Associates\nAddress: MG Road, Kochi 682016, Kerala', 'customer');
    expect(data.documentType).toBe('gst_certificate');
    expect(data.party).toMatchObject({ gstin: '32AAKFM4321P1Z9', companyName: 'Menon Associates', state: 'Kerala' });
    expect(data.party.address).toContain('MG Road');
  });
});

describe('price list', () => {
  it('reads one product per row', () => {
    const { data } = parseDocumentText('Price List October 2026\nProduct HSN GST Price\n1 Logitech M331 Mouse 8471 18% 1,199\n2 SanDisk 64GB Pen Drive 8523 18% ₹599\nA4 Paper Ream 4802 12% 320.00\nCable Tie Pack 99/-', 'items');
    expect(data.lines.map((l) => [l.name, l.hsn, l.taxRate, l.sellingPrice])).toEqual([
      ['Logitech M331 Mouse', '8471', 18, 1199], ['SanDisk 64GB Pen Drive', '8523', 18, 599], ['A4 Paper Ream', '4802', 12, 320], ['Cable Tie Pack', null, null, 99],
    ]);
  });
});

describe('business name on receipts', () => {
  it('uses the heading without document words, never a labelled line', () => {
    const r = parseDocumentText('Tata Power Receipt\nReceipt No: TP-99812\nDate: 21/10/2026\nTotal Amount 2,450.00', 'expense');
    expect(r.data.party.companyName).toBe('Tata Power');
    expect(r.data.total).toBe(2450);
    expect(r.data.documentNumber).toBe('TP-99812');
  });
  it('skips a date-only first line', () => {
    const r = parseDocumentText('Date: 05/10/2026\nSri Murugan Electricals\nAmount 1,200', 'expense');
    expect(r.data.party.companyName).toBe('Sri Murugan Electricals');
  });
});

describe('orders read without colons (tables and OCR)', () => {
  const text = 'Unico Plastics Inc\nSALES ORDER\nSAL-ORD-2026-00003\nCustomer Name Mia Jones Date 19-06-2026\nDelivery Date 21-06-2026\n' +
    'Sr Item Code Description Quantity Rate Amount\n1 Leather Wallet Tan 12 Nos ₹ 250.00 ₹ 3,000.00\nGrand Total ₹ 3,000.00';
  it('finds the customer, reference, date, total and the item row', () => {
    const { data } = parseDocumentText(text, 'order');
    expect(data.party.companyName).toBe('Mia Jones');
    expect(data.documentNumber).toBe('SAL-ORD-2026-00003');
    expect(data.date).toBe('2026-06-19');
    expect(data.total).toBe(3000);
    expect(data.lines.map((l) => [l.name, l.qty, l.unit, l.rate, l.amount])).toEqual([['Leather Wallet Tan', 12, 'nos', 250, 3000]]);
  });
  it('ignores number rows where qty × rate doesn’t match the amount', () => {
    const { data } = parseDocumentText('Customer Name Mia Jones\n1 Phone 2026 10 3,000.00', 'order');
    expect(data.lines).toEqual([]);
  });
});
