import { beforeAll, describe, expect, it } from 'vitest';
import { freshDb, login } from './helpers';

let owner: Awaited<ReturnType<typeof login>>;
const items: Record<string, string> = {};
let customerId = '';
beforeAll(async () => {
  await freshDb();
  owner = await login('owner@shop.com', 'owner123');
  const slabs = (await owner.get('/api/shop/tax-slabs')).body as Array<{ id: string; rate: number }>;
  const mk = async (k: string, unit: string, price: number, rate: number) => {
    const r = await owner.post('/api/shop/items').send({ type: 'Goods', name: `Loose test ${k}`, unit, cost: price / 2, sp1: price, sp2: price, sp3: price, taxSlabId: slabs.find((s) => s.rate === rate)!.id });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    items[k] = r.body.id;
  };
  await mk('phone', 'pcs', 70000, 18);
  await mk('carrot', 'kg', 40, 0);
  await mk('oil', 'ltr', 180, 5);
  customerId = (await owner.get('/api/shop/customers')).body[0].id;
});

const bill = (lines: Array<[string, number]>) => owner.post('/api/shop/invoices').send({
  customerId, date: new Date().toISOString().slice(0, 10), dueDate: new Date().toISOString().slice(0, 10), withGst: true, issue: false,
  lines: lines.map(([k, qty]) => ({ itemId: items[k], qty, discount: 0 })),
});

describe('billing pieces and loose goods', () => {
  it('a phone is sold whole; carrots and oil by weight and volume', async () => {
    const half = await bill([['phone', 1.5]]);
    expect(half.status).toBe(400);
    expect(half.body.error).toMatch(/sold in whole pcs/);
    const r = await bill([['carrot', 0.25], ['oil', 0.5], ['phone', 1]]);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const byName = Object.fromEntries(r.body.lines.map((l: any) => [l.name, l]));
    expect(byName['Loose test carrot']).toMatchObject({ qty: 0.25, amount: 10 }); // 250 g at ₹40/kg
    expect(byName['Loose test oil']).toMatchObject({ qty: 0.5, amount: 90 });
  });
  it('quantities finer than 1 g are refused', async () => {
    expect((await bill([['carrot', 0.2505]])).body.error).toMatch(/at most 3 decimals/);
  });
});
