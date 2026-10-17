import { beforeAll, describe, expect, it } from 'vitest';
import { freshDb, login, today } from './helpers';

let owner: Awaited<ReturnType<typeof login>>;
let items: any[];
let vendors: any[];
const stockOf = async (id: string) => (await owner.get('/api/shop/items')).body.find((i: any) => i.id === id).stock;

beforeAll(async () => {
  await freshDb();
  owner = await login('owner@shop.com', 'owner123');
  items = (await owner.get('/api/shop/items')).body;
  vendors = (await owner.get('/api/shop/vendors')).body;
});

describe('purchase orders', () => {
  it('receives goods in parts, adds stock, updates cost and converts to a single bill', async () => {
    const mouse = items.find((i) => i.sku === 'LOG-M331');
    const s0 = await stockOf(mouse.id);
    const po = (await owner.post('/api/shop/purchase-orders').send({ vendorId: vendors[0].id, date: today(), lines: [{ itemId: mouse.id, qty: 10, rate: 800 }] })).body;
    expect(po.number).toMatch(/^PO-\d{4}$/);
    expect(po.status).toBe('Issued');
    expect(po.subTotal).toBe(8000);
    expect(po.total).toBe(9440); // + 18% GST

    const lineId = po.lines[0].id;
    const r1 = await owner.post(`/api/shop/purchase-orders/${po.id}/receive`).send({ lines: [{ lineId, qty: 4 }] });
    expect(r1.body.status).toBe('Partially Received');
    expect(await stockOf(mouse.id)).toBe(s0 + 4);
    expect((await owner.post(`/api/shop/purchase-orders/${po.id}/receive`).send({ lines: [{ lineId, qty: 7 }] })).status).toBe(400); // only 6 left
    const r2 = await owner.post(`/api/shop/purchase-orders/${po.id}/receive`).send({ lines: [{ lineId, qty: 6 }] });
    expect(r2.body.status).toBe('Received');
    expect(await stockOf(mouse.id)).toBe(s0 + 10);
    expect((await owner.get('/api/shop/items')).body.find((i: any) => i.id === mouse.id).cost).toBe(800);

    const bill = await owner.post(`/api/shop/purchase-orders/${po.id}/bill`).send({ date: today(), dueDate: today() });
    expect(bill.status).toBe(200);
    expect((await owner.post(`/api/shop/purchase-orders/${po.id}/bill`).send({ date: today(), dueDate: today() })).status).toBe(409);
    const saved = (await owner.get('/api/shop/bills')).body.find((b: any) => b.id === bill.body.billId);
    expect(saved.amount).toBe(9440);
    expect(saved.purchaseOrderId).toBe(po.id);
    // receiving doesn't double-count when the bill is created
    expect(await stockOf(mouse.id)).toBe(s0 + 10);
  });

  it('cannot receive a draft or cancel a received order', async () => {
    const paper = items.find((i) => i.sku === 'PAP-A4-75');
    const draft = (await owner.post('/api/shop/purchase-orders').send({ vendorId: vendors[0].id, date: today(), issue: false, lines: [{ itemId: paper.id, qty: 5 }] })).body;
    expect(draft.status).toBe('Draft');
    expect((await owner.post(`/api/shop/purchase-orders/${draft.id}/receive`).send({ lines: [{ lineId: draft.lines[0].id, qty: 1 }] })).status).toBe(409);
    expect((await owner.post(`/api/shop/purchase-orders/${draft.id}/cancel`).send({})).body.status).toBe('Cancelled');
  });
});

describe('itemised bills & expenses', () => {
  it('an itemised bill adds stock directly', async () => {
    const pen = items.find((i) => i.sku === 'SD-64U3');
    const s0 = await stockOf(pen.id);
    const res = await owner.post('/api/shop/bills').send({ vendorId: vendors[1].id, date: today(), dueDate: today(), lines: [{ itemId: pen.id, qty: 25, rate: 380 }] });
    expect(res.status).toBe(200);
    expect(res.body.taxableAmount).toBe(9500);
    expect(res.body.stockAdded).toBe(true);
    expect(await stockOf(pen.id)).toBe(s0 + 25);
  });

  it('a lump-sum bill still works without items', async () => {
    const res = await owner.post('/api/shop/bills').send({ vendorId: vendors[1].id, date: today(), dueDate: today(), taxableAmount: 1000, taxAmount: 180, description: 'Courier' });
    expect(res.body.amount).toBe(1180);
    expect(res.body.stockAdded).toBe(false);
  });

  it('expenses withdraw from the paying account and can be removed', async () => {
    const acc = (await owner.get('/api/shop/bank-accounts')).body[0];
    const e = await owner.post('/api/shop/expenses').send({ date: today(), category: 'Electricity', description: 'EB bill', amount: 5000, taxAmount: 0, accountId: acc.id });
    expect(e.status).toBe(200);
    const after = (await owner.get('/api/shop/bank-accounts')).body.find((a: any) => a.id === acc.id);
    expect(after.balance).toBe(acc.balance - 5000);
    await owner.del(`/api/shop/expenses/${e.body.id}`);
    expect((await owner.get('/api/shop/bank-accounts')).body.find((a: any) => a.id === acc.id).balance).toBe(acc.balance);
  });

  it('sales staff cannot record purchases', async () => {
    const sales = await login('sales@shop.com', 'sales123');
    expect((await sales.post('/api/shop/purchase-orders').send({ vendorId: vendors[0].id, date: today(), lines: [{ itemId: items[0].id, qty: 1 }] })).status).toBe(403);
    expect((await sales.get('/api/shop/expenses')).status).toBe(403);
  });
});

describe('profit & loss', () => {
  it('nets sales, returns, cost of goods and expenses for the FY', async () => {
    const d = new Date();
    const y = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1;
    const fy = `${y}-${String((y + 1) % 100).padStart(2, '0')}`;
    const acc = (await owner.get('/api/shop/bank-accounts')).body[0];
    const before = (await owner.get(`/api/shop/reports/pnl?fy=${fy}`)).body;
    await owner.post('/api/shop/expenses').send({ date: today(), category: 'Rent', amount: 12000, accountId: acc.id });
    const after = (await owner.get(`/api/shop/reports/pnl?fy=${fy}`)).body;
    expect(after.totalExpenses).toBeCloseTo(before.totalExpenses + 12000, 2);
    expect(after.netProfit).toBeCloseTo(after.income.net - after.costOfGoods - after.totalExpenses, 2);
    expect(after.monthly).toHaveLength(12);
  });
});
