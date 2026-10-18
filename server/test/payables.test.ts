import { beforeAll, describe, expect, it } from 'vitest';
import { freshDb, login, today } from './helpers';

let owner: Awaited<ReturnType<typeof login>>;
let vendorId: string;
let accountId: string;

beforeAll(async () => {
  await freshDb();
  owner = await login('owner@shop.com', 'owner123');
  vendorId = (await owner.get('/api/shop/vendors')).body[0].id;
  accountId = (await owner.get('/api/shop/bank-accounts')).body.find((a: any) => a.type === 'Bank').id;
});

const newBill = (amount: number) => owner.post('/api/shop/bills').send({ vendorId, date: today(), dueDate: today(), taxableAmount: amount, taxAmount: 0, description: 'Test bill' });

describe('payments made', () => {
  it('pays a bill in parts and marks it paid at the end', async () => {
    const bill = (await newBill(1000)).body;
    expect(bill.status).toBe('Open');
    const before = (await owner.get('/api/shop/bank-accounts')).body.find((a: any) => a.id === accountId).balance;

    const p1 = await owner.post(`/api/shop/bills/${bill.id}/pay`).send({ accountId, date: today(), amount: 400, mode: 'UPI' });
    expect(p1.status).toBe(200);
    expect(p1.body).toMatchObject({ status: 'Partially Paid', amountPaid: 400, balance: 600 });
    expect((await owner.post(`/api/shop/bills/${bill.id}/pay`).send({ accountId, date: today(), amount: 700 })).status).toBe(400);

    // TDS counts towards settling the bill but does not leave the bank.
    const p2 = await owner.post(`/api/shop/bills/${bill.id}/pay`).send({ accountId, date: today(), amount: 590, tdsAmount: 10 });
    expect(p2.body).toMatchObject({ status: 'Paid', balance: 0 });
    expect((await owner.post(`/api/shop/bills/${bill.id}/pay`).send({ accountId, date: today() })).status).toBe(409);

    const after = (await owner.get('/api/shop/bank-accounts')).body.find((a: any) => a.id === accountId).balance;
    expect(Math.round((before - after) * 100) / 100).toBe(990);

    const list = (await owner.get('/api/shop/bill-payments')).body.filter((p: any) => p.billId === bill.id);
    expect(list).toHaveLength(2);
    expect(list.every((p: any) => /^PM-\d{4}$/.test(p.number))).toBe(true);

    // Undoing a payment reopens the bill and restores the bank balance.
    const last = list.find((p: any) => p.amount === 590);
    expect((await owner.del(`/api/shop/bill-payments/${last.id}`)).status).toBe(200);
    const bills = (await owner.get('/api/shop/bills')).body;
    expect(bills.find((b: any) => b.id === bill.id)).toMatchObject({ status: 'Partially Paid', balance: 600 });
    const restored = (await owner.get('/api/shop/bank-accounts')).body.find((a: any) => a.id === accountId).balance;
    expect(Math.round((restored - after) * 100) / 100).toBe(590);
  });

  it('pays the whole balance when no amount is given', async () => {
    const bill = (await newBill(250)).body;
    const r = await owner.post(`/api/shop/bills/${bill.id}/pay`).send({ accountId, date: today() });
    expect(r.body).toMatchObject({ status: 'Paid', amountPaid: 250 });
  });
});

describe('vendor statement and payables ageing', () => {
  it('reconciles the statement with what is owed', async () => {
    const s = (await owner.get(`/api/shop/vendors/${vendorId}/statement?from=2000-01-01&to=${today()}`)).body;
    expect(s.openingBalance).toBe(0);
    expect(Math.round((s.totals.credit - s.totals.debit) * 100) / 100).toBe(s.closingBalance);
    const v = (await owner.get('/api/shop/vendors')).body.find((x: any) => x.id === vendorId);
    expect(s.closingBalance).toBeCloseTo(v.payable, 2);
    const ageing = (await owner.get('/api/shop/payables-ageing')).body;
    const row = ageing.vendors.find((x: any) => x.vendorId === vendorId);
    expect(row.total).toBeCloseTo(v.payable, 2);
    const all = (await owner.get('/api/shop/vendors')).body.reduce((a: number, x: any) => a + x.payable, 0);
    expect(ageing.totals.total).toBeCloseTo(all, 2);
  });

  it('is hidden from sales staff', async () => {
    const sales = await login('sales@shop.com', 'sales123');
    expect((await sales.get('/api/shop/bill-payments')).status).toBe(403);
    expect((await sales.get('/api/shop/payables-ageing')).status).toBe(403);
  });
});
