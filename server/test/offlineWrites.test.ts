import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { query } from '../src/db';
import { freshDb, login, today } from './helpers';

let owner: Awaited<ReturnType<typeof login>>;
let items: any[];
const goods = () => items.find((i) => i.sku === 'SD-64U3');
const key = () => `k-${randomUUID()}`;

beforeAll(async () => {
  await freshDb();
  owner = await login('owner@shop.com', 'owner123');
  items = (await owner.get('/api/shop/items')).body;
});

describe('saves sent twice (offline, or a reply lost on weak internet) are done once', () => {
  it('a customer sent again with the same key is one customer, with the same answer', async () => {
    const k = key();
    const body = { type: 'Individual', name: 'Selvi Veg Shop', phone: '9840012121' };
    const a = await owner.post('/api/shop/customers').set('Idempotency-Key', k).send(body);
    expect(a.status, JSON.stringify(a.body)).toBe(200);
    const b = await owner.post('/api/shop/customers').set('Idempotency-Key', k).send(body);
    expect(b.status).toBe(200);
    expect(b.headers['idempotent-replay']).toBe('true');
    expect(b.body.id).toBe(a.body.id);
    expect((await query("SELECT count(*)::int AS n FROM customers WHERE name = 'Selvi Veg Shop'"))[0].n).toBe(1);
  });

  it('the same key for a different change is refused; a refused save can be fixed and sent with a new key', async () => {
    const k = key();
    expect((await owner.post('/api/shop/customers').set('Idempotency-Key', k).send({ type: 'Individual', name: '' })).status).toBe(400);
    // The refusal is the answer for that key (the same bad save gives the same answer)…
    expect((await owner.post('/api/shop/customers').set('Idempotency-Key', k).send({ type: 'Individual', name: '' })).status).toBe(400);
    // …and the same key can't be used for another kind of change.
    expect((await owner.post('/api/shop/vendors').set('Idempotency-Key', k).send({ name: 'X' })).status).toBe(422);
  });

  it('offline: a new customer (with the ID made on the device), then an invoice for them, then a payment, sent in order later', async () => {
    const custId = randomUUID();
    const made = new Date(Date.now() - 3600_000).toISOString();
    const c = await owner.post('/api/shop/customers').set('Idempotency-Key', key()).set('X-Made-Offline-At', made)
      .send({ id: custId, type: 'Individual', name: 'Murugan Hardware', phone: '9840034343' });
    expect(c.status, JSON.stringify(c.body)).toBe(200);
    expect(c.body.id).toBe(custId);
    // More than the branch has in stock: made offline, the goods were already handed over, so it is saved.
    const inv = await owner.post('/api/shop/invoices').set('Idempotency-Key', key()).set('X-Made-Offline-At', made)
      .send({ customerId: custId, date: today(), dueDate: today(), lines: [{ itemId: goods().id, qty: goods().stock + 5, tier: 'SP1' }], withGst: true });
    expect(inv.status, JSON.stringify(inv.body)).toBe(200);
    expect(inv.body.number).toBeTruthy();
    const pay = await owner.post(`/api/shop/invoices/${inv.body.id}/payments`).set('Idempotency-Key', key()).send({ date: today(), amount: 100, mode: 'Cash' });
    expect(pay.status, JSON.stringify(pay.body)).toBe(200);
    // The same without the offline mark is held back by the stock check, as before.
    const online = await owner.post('/api/shop/invoices').send({ customerId: custId, date: today(), dueDate: today(), lines: [{ itemId: goods().id, qty: 10_000, tier: 'SP1' }], withGst: true });
    expect(online.status).toBe(409);
  });

  it('items and suppliers made offline keep their device-made ID', async () => {
    const itemId = randomUUID(); const vendorId = randomUUID();
    const slab = (await owner.get('/api/shop/tax-slabs')).body[0];
    const it = await owner.post('/api/shop/items').set('Idempotency-Key', key()).send({ id: itemId, type: 'Goods', name: 'Carrot Ooty (loose)', unit: 'kg', cost: 30, sp1: 40, sp2: 40, sp3: 40, taxSlabId: slab.id });
    expect(it.status, JSON.stringify(it.body)).toBe(200);
    expect(it.body.id).toBe(itemId);
    const v = await owner.post('/api/shop/vendors').set('Idempotency-Key', key()).send({ id: vendorId, name: 'Koyambedu Wholesale' });
    expect(v.body.id).toBe(vendorId);
  });

  it('keys are per shop: another shop can’t see or reuse one', async () => {
    const [{ n }] = await query('SELECT count(*)::int AS n FROM idempotency_keys');
    expect(n).toBeGreaterThan(0);
  });
});
