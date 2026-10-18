import { beforeAll, describe, expect, it } from 'vitest';
import { freshDb, login, today } from './helpers';

let owner: Awaited<ReturnType<typeof login>>;
let itemId: string;
let customer: any;

beforeAll(async () => {
  await freshDb();
  owner = await login('owner@shop.com', 'owner123');
  itemId = (await owner.get('/api/shop/items')).body.find((i: any) => i.sku === 'SD-64U3').id;
  customer = (await owner.get('/api/shop/customers')).body.find((c: any) => c.companyName === 'Nila Textiles');
});

const line = () => [{ itemId, qty: 1, tier: 'SP1' }];

describe('quote → sales order → invoice', () => {
  it('numbers quotes separately and converts once', async () => {
    const q = await owner.post('/api/shop/sales-orders').send({ customerId: customer.id, kind: 'quote', date: today(), expiryDate: today(), lines: line(), withGst: true, status: 'Sent' });
    expect(q.status).toBe(200);
    expect(q.body.number).toMatch(/^QT-\d{4}$/);
    expect(q.body.kind).toBe('quote');

    const so = await owner.post(`/api/shop/sales-orders/${q.body.id}/convert`).send({});
    expect(so.status).toBe(200);
    expect(so.body.number).toMatch(/^SO-\d{4}$/);
    expect(so.body.sourceId).toBe(q.body.id);
    expect(so.body.sourceNumber).toBe(q.body.number);
    expect((await owner.post(`/api/shop/sales-orders/${q.body.id}/convert`).send({})).status).toBe(409);

    const quotes = (await owner.get('/api/shop/sales-orders?kind=quote')).body;
    const orders = (await owner.get('/api/shop/sales-orders')).body;
    expect(quotes.find((x: any) => x.id === q.body.id)).toMatchObject({ status: 'Accepted', orderId: so.body.id });
    expect(orders.some((x: any) => x.id === q.body.id)).toBe(false);
    expect((await owner.del(`/api/shop/sales-orders/${q.body.id}`)).status).toBe(409);

    const inv = await owner.post('/api/shop/invoices').send({ customerId: customer.id, date: today(), dueDate: today(), lines: line(), withGst: true, salesOrderId: so.body.id, issue: true });
    expect(inv.status).toBe(200);
    expect((await owner.get('/api/shop/sales-orders')).body.find((x: any) => x.id === so.body.id).invoiceId).toBe(inv.body.id);
  });

  it('reports invoice statuses as Draft, Sent, Partially Paid, Paid and Void', async () => {
    const draft = (await owner.post('/api/shop/invoices').send({ customerId: customer.id, date: today(), dueDate: today(), lines: line(), withGst: true, issue: false })).body;
    expect(draft.paymentStatus).toBe('Draft');
    const sent = (await owner.post('/api/shop/invoices').send({ customerId: customer.id, date: today(), dueDate: today(), lines: line(), withGst: true, issue: true })).body;
    expect(sent.paymentStatus).toBe('Sent');
    await owner.post(`/api/shop/invoices/${sent.id}/payments`).send({ amount: 10, mode: 'UPI' });
    expect((await owner.get(`/api/shop/invoices/${sent.id}`)).body.paymentStatus).toBe('Partially Paid');
    const v = (await owner.post('/api/shop/invoices').send({ customerId: customer.id, date: today(), dueDate: today(), lines: line(), withGst: true, issue: true })).body;
    await owner.post(`/api/shop/invoices/${v.id}/cancel`).send({ reason: 'Wrong customer' });
    expect((await owner.get(`/api/shop/invoices/${v.id}`)).body.paymentStatus).toBe('Void');
  });
});

describe('customer credit limit', () => {
  it('blocks issuing past the limit unless confirmed', async () => {
    const c = (await owner.get('/api/shop/customers')).body.find((x: any) => x.id === customer.id);
    const put = await owner.put(`/api/shop/customers/${c.id}`).send({ ...c, creditLimit: c.due + 100 });
    expect(put.body.creditLimit).toBe(c.due + 100);
    // An edit without the field keeps the limit.
    const { creditLimit: _drop, ...rest } = put.body;
    expect((await owner.put(`/api/shop/customers/${c.id}`).send(rest)).body.creditLimit).toBe(c.due + 100);

    const body = { customerId: c.id, date: today(), dueDate: today(), lines: [{ itemId, qty: 5, tier: 'SP1' }], withGst: true, issue: true };
    const blocked = await owner.post('/api/shop/invoices').send(body);
    expect(blocked.status).toBe(409);
    expect(blocked.body.code).toBe('credit_limit');
    const ok = await owner.post('/api/shop/invoices').send({ ...body, overrideCreditLimit: true });
    expect(ok.status).toBe(200);
    // Drafts are never blocked.
    expect((await owner.post('/api/shop/invoices').send({ ...body, issue: false })).status).toBe(200);
    await owner.put(`/api/shop/customers/${c.id}`).send({ ...rest, creditLimit: 0 });
  });
});

describe('statement of account and history', () => {
  it('runs from the opening balance to the closing balance', async () => {
    const s = (await owner.get(`/api/shop/customers/${customer.id}/statement?from=2000-01-01&to=${today()}`)).body;
    expect(s.openingBalance).toBe(0);
    const last = s.entries.at(-1);
    expect(last.balance).toBe(s.closingBalance);
    expect(Math.round((s.totals.debit - s.totals.credit) * 100) / 100).toBe(s.closingBalance);
    const c = (await owner.get('/api/shop/customers')).body.find((x: any) => x.id === customer.id);
    expect(s.closingBalance).toBeCloseTo(c.due, 2);
    const sum = Object.values(s.ageing as Record<string, number>).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(c.due, 2);

    const later = (await owner.get(`/api/shop/customers/${customer.id}/statement?from=${today()}&to=${today()}`)).body;
    expect(later.openingBalance + later.totals.debit - later.totals.credit).toBeCloseTo(later.closingBalance, 2);
  });

  it('keeps contact notes alongside invoices and payments', async () => {
    const n = await owner.post(`/api/shop/customers/${customer.id}/activity`).send({ kind: 'call', body: 'Promised payment Friday' });
    expect(n.status).toBe(200);
    expect((await owner.post(`/api/shop/customers/${customer.id}/activity`).send({ kind: 'call', body: ' ' })).status).toBe(400);
    const list = (await owner.get(`/api/shop/customers/${customer.id}/activity`)).body;
    expect(list[0]).toMatchObject({ kind: 'call', body: 'Promised payment Friday', manual: true });
    expect(list.some((a: any) => a.kind === 'invoice')).toBe(true);
    expect(list.some((a: any) => a.kind === 'payment')).toBe(true);
    expect((await owner.del(`/api/shop/customers/${customer.id}/activity/${n.body.id}`)).status).toBe(200);
  });
});
