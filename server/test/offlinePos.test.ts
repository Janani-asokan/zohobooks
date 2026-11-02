import { beforeAll, describe, expect, it } from 'vitest';
import { freshDb, login, today } from './helpers';

/* Offline counter billing: bills made without internet reach the server later, maybe more than once. */

let owner: Awaited<ReturnType<typeof login>>;
let item: any;
const sale = (extra: Record<string, unknown> = {}, qty = 2) =>
  owner.post('/api/shop/pos/sale').send({ customerId: null, withGst: false, mode: 'Cash', lines: [{ itemId: item.id, qty, tier: 'SP1' }], ...extra });
const ref = (n: string) => `pos-test-${n}-${Math.random().toString(36).slice(2, 10)}`;
const stockOf = async () => (await owner.get('/api/shop/items')).body.find((i: any) => i.id === item.id).stock as number;
const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();

beforeAll(async () => {
  await freshDb();
  owner = await login('owner@shop.com', 'owner123');
  const slab = (await owner.get('/api/shop/tax-slabs')).body.find((s: any) => s.rate === 5).id;
  item = (await owner.post('/api/shop/items').send({ type: 'Goods', name: 'Offline Test Toy', cost: 60, sp1: 100, sp2: 100, sp3: 100, taxSlabId: slab, openingStock: 50 })).body;
});

describe('offline counter bills', () => {
  it('a bill sent twice (reply lost, page refreshed) is saved once: same invoice, stock and cash moved once', async () => {
    const clientRef = ref('twice');
    const before = await stockOf();
    const invCount = (await owner.get('/api/shop/invoices')).body.length;
    const a = await sale({ clientRef, madeAt: hoursAgo(1) });
    expect(a.status).toBe(200);
    expect(a.body.invoice.number).toMatch(/^INV-/);
    const b = await sale({ clientRef, madeAt: hoursAgo(1) });
    expect(b.status).toBe(200);
    expect(b.body.duplicate).toBe(true);
    expect(b.body.invoice.id).toBe(a.body.invoice.id);
    expect((await owner.get('/api/shop/invoices')).body.length).toBe(invCount + 1);
    expect(await stockOf()).toBe(before - 2);
    expect(a.body.invoice).toMatchObject({ status: 'Issued', paymentStatus: 'Paid', source: 'pos' });
    expect(a.body.invoice.madeOfflineAt).toBeTruthy();
  });

  it('two sends at the same moment (two tabs) still make one invoice', async () => {
    const clientRef = ref('race');
    const before = (await owner.get('/api/shop/invoices')).body.length;
    const [x, y] = await Promise.all([sale({ clientRef, madeAt: hoursAgo(0.1) }), sale({ clientRef, madeAt: hoursAgo(0.1) })]);
    expect([x.status, y.status]).toEqual([200, 200]);
    expect(x.body.invoice.id).toBe(y.body.invoice.id);
    expect((await owner.get('/api/shop/invoices')).body.length).toBe(before + 1);
  });

  it('is dated the day it was made at the counter (India time), not the day it arrived', async () => {
    const y = new Date(Date.now() - 86_400_000);
    const madeAt = new Date(`${new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(y)}T06:30:00.000Z`).toISOString(); // 12:00 IST yesterday
    const r = await sale({ clientRef: ref('yday'), madeAt });
    expect(r.status).toBe(200);
    expect(r.body.invoice.date).toBe(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(y));
    const pay = (await owner.get('/api/shop/payments')).body.find((p: any) => p.invoiceId === r.body.invoice.id);
    expect(pay.date).toBe(r.body.invoice.date);
  });

  it('settles as collected at the counter even if cash tendered looks short or split parts are off by a little', async () => {
    const r = await sale({ clientRef: ref('cash'), madeAt: hoursAgo(2), tendered: 100 }); // bill is 200
    expect(r.status).toBe(200);
    expect(r.body.invoice.balance).toBe(0);
    const s = await sale({ clientRef: ref('split'), madeAt: hoursAgo(2), split: [{ mode: 'Cash', amount: 100 }, { mode: 'UPI', amount: 90 }] });
    expect(s.status).toBe(200);
    expect(s.body.invoice.balance).toBe(0);
    // Online bills keep the strict checks.
    expect((await sale({ tendered: 100 })).status).toBe(400);
    expect((await sale({ split: [{ mode: 'Cash', amount: 100 }, { mode: 'UPI', amount: 90 }] })).status).toBe(400);
  });

  it('refuses what can’t be trusted from an offline device, with a clear reason', async () => {
    const future = await sale({ clientRef: ref('future'), madeAt: new Date(Date.now() + 3 * 86_400_000).toISOString() });
    expect(future.status).toBe(400);
    expect(future.body.error).toMatch(/future/);
    const old = await sale({ clientRef: ref('old'), madeAt: new Date(Date.now() - 40 * 86_400_000).toISOString() });
    expect(old.status).toBe(400);
    expect(old.body.error).toMatch(/30 days/);
    expect((await sale({ clientRef: 'bad ref!', madeAt: hoursAgo(1) })).status).toBe(400);
    // Nothing half-saved from a refused bill: sending it again (fixed) works and is one invoice.
    const clientRef = ref('fixme');
    expect((await sale({ clientRef, madeAt: new Date(Date.now() + 3 * 86_400_000).toISOString() })).status).toBe(400);
    const ok = await sale({ clientRef, madeAt: hoursAgo(1) });
    expect(ok.status).toBe(200);
    expect(ok.body.duplicate).toBeUndefined();
  });

  it('bills sell stock even if the counter ran past what the system showed (goods already handed over)', async () => {
    const before = await stockOf();
    const r = await sale({ clientRef: ref('big'), madeAt: hoursAgo(1) }, before + 5);
    expect(r.status).toBe(200);
    expect(await stockOf()).toBe(-5);
  });

  it('an online bill can carry an ID too, and is dated today', async () => {
    const clientRef = ref('online');
    const r = await sale({ clientRef });
    expect(r.status).toBe(200);
    expect(r.body.invoice.madeOfflineAt).toBeNull();
    expect(r.body.invoice.date).toBe(today());
  });
});
