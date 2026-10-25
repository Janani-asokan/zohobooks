import { beforeAll, describe, expect, it } from 'vitest';
import { freshDb, login, today } from './helpers';

let owner: Awaited<ReturnType<typeof login>>;
let sales: Awaited<ReturnType<typeof login>>;
let item: any;
let customer: any;

beforeAll(async () => {
  await freshDb();
  owner = await login('owner@shop.com', 'owner123');
  sales = await login('sales@shop.com', 'sales123');
  item = (await owner.get('/api/shop/items')).body.find((i: any) => i.sku === 'SD-64U3');
  customer = (await owner.get('/api/shop/customers')).body.find((c: any) => c.companyName === 'Nila Textiles');
});

describe('bill discount and MRP billing', () => {
  it('a 10% bill discount lowers the taxable value and is kept for editing', async () => {
    const plain = await owner.post('/api/shop/invoices').send({ customerId: customer.id, date: today(), dueDate: today(), withGst: true, lines: [{ itemId: item.id, qty: 2, tier: 'SP1', rate: 500 }] });
    const disc = await owner.post('/api/shop/invoices').send({ customerId: customer.id, date: today(), dueDate: today(), withGst: true, billDiscount: { kind: 'percent', value: 10 }, lines: [{ itemId: item.id, qty: 2, tier: 'SP1', rate: 500 }] });
    expect(disc.status).toBe(200);
    expect(disc.body.subTotal).toBe(900);
    expect(disc.body.taxTotal).toBeCloseTo(plain.body.taxTotal * 0.9, 1);
    expect(disc.body.billDiscount).toEqual({ kind: 'percent', value: 10 });
    expect(disc.body.lines[0]).toMatchObject({ enteredRate: 500, enteredDiscount: 0, discount: 10 });
  });

  it('MRP billing: the customer pays the price typed', async () => {
    const r = await owner.post('/api/shop/invoices').send({ customerId: customer.id, date: today(), dueDate: today(), withGst: true, pricesIncludeTax: true, lines: [{ itemId: item.id, qty: 5, tier: 'SP1', rate: 200 }] });
    expect(r.status).toBe(200);
    expect(r.body.total).toBe(1000);
    expect(r.body.pricesIncludeTax).toBe(true);
  });

  it('never sends item cost to the browser, but serves bill profit to roles that may see cost', async () => {
    const inv = await owner.post('/api/shop/invoices').send({ customerId: customer.id, date: today(), dueDate: today(), withGst: true, issue: true, lines: [{ itemId: item.id, qty: 1, tier: 'SP1' }] });
    expect(inv.body.lines[0].cost).toBeUndefined();
    const p = await owner.get(`/api/shop/invoices/${inv.body.id}/profit`);
    expect(p.status).toBe(200);
    expect(p.body.profit.cost).toBeCloseTo(item.cost, 2);
    expect(p.body.profit.profit).toBeCloseTo(inv.body.subTotal - item.cost, 1);
    expect((await sales.get(`/api/shop/invoices/${inv.body.id}/profit`)).status).toBe(403);
    const rep = await owner.get(`/api/shop/reports/bill-profit?from=${today()}&to=${today()}`);
    expect(rep.status).toBe(200);
    expect(rep.body.rows.some((r: any) => r.id === inv.body.id)).toBe(true);
  });
});

describe('POS split payment', () => {
  it('records each part and settles the bill exactly', async () => {
    const quote = await owner.post('/api/shop/pos/sale').send({ customerId: null, withGst: true, mode: 'Cash', lines: [{ itemId: item.id, qty: 1, tier: 'SP1' }] });
    const total = quote.body.invoice.total;
    const r = await owner.post('/api/shop/pos/sale').send({ customerId: null, withGst: true, mode: 'Cash', split: [{ mode: 'Cash', amount: 100 }, { mode: 'UPI', amount: total - 100 }], lines: [{ itemId: item.id, qty: 1, tier: 'SP1' }] });
    expect(r.status).toBe(200);
    expect(r.body.invoice.amountPaid).toBe(total);
    expect(r.body.invoice.paymentStatus).toBe('Paid');
    const bad = await owner.post('/api/shop/pos/sale').send({ customerId: null, withGst: true, mode: 'Cash', split: [{ mode: 'Cash', amount: 1 }, { mode: 'UPI', amount: 1 }], lines: [{ itemId: item.id, qty: 1, tier: 'SP1' }] });
    expect(bad.status).toBe(400);
  });
});

describe('delivery challans', () => {
  it('packed → dispatched → delivered → invoiced', async () => {
    const d = await owner.post('/api/shop/delivery-challans').send({ customerId: customer.id, date: today(), lines: [{ itemId: item.id, qty: 3 }], vehicleNo: 'tn 09 ab 1234' });
    expect(d.status).toBe(200);
    expect(d.body.number).toMatch(/^DC-\d{4}$/);
    expect(d.body).toMatchObject({ status: 'Packed', vehicleNo: 'TN 09 AB 1234', value: 3 * item.sp1 });
    expect((await owner.patch(`/api/shop/delivery-challans/${d.body.id}/status`).send({ status: 'Delivered' })).status).toBe(400); // who received it?
    expect((await owner.patch(`/api/shop/delivery-challans/${d.body.id}/status`).send({ status: 'Dispatched' })).body.status).toBe('Dispatched');
    const del = await owner.patch(`/api/shop/delivery-challans/${d.body.id}/status`).send({ status: 'Delivered', receivedBy: 'Priya' });
    expect(del.body).toMatchObject({ status: 'Delivered', receivedBy: 'Priya' });
    const inv = await owner.post(`/api/shop/delivery-challans/${d.body.id}/invoice`).send({});
    expect(inv.status).toBe(200);
    expect(inv.body.challan).toMatchObject({ status: 'Invoiced', invoiceId: inv.body.invoiceId });
    const draft = (await owner.get(`/api/shop/invoices/${inv.body.invoiceId}`)).body;
    expect(draft.lines[0]).toMatchObject({ itemId: item.id, qty: 3 });
    expect((await owner.post(`/api/shop/delivery-challans/${d.body.id}/invoice`).send({})).status).toBe(409);
    expect((await owner.del(`/api/shop/delivery-challans/${d.body.id}`)).status).toBe(409);
  });
});
