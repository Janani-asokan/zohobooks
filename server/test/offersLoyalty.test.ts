import { beforeAll, describe, expect, it } from 'vitest';
import { query } from '../src/db';
import { freshDb, login, today } from './helpers';

/* Festival offers, the promo line and loyalty points, end to end through the API. */

type Client = Awaited<ReturnType<typeof login>>;
let owner: Client;
let customerId: string;
let item: { id: string; sp1: number; taxRate: number; category: string | null };
let other: { id: string; sp1: number; taxRate: number; category: string | null };

const addDays = (d: string, n: number) => new Date(new Date(d + 'T00:00:00Z').getTime() + n * 86400000).toISOString().slice(0, 10);

beforeAll(async () => {
  await freshDb();
  owner = await login('owner@shop.com', 'owner123');
  const items = (await owner.get('/api/shop/items')).body.filter((i: any) => i.type === 'Goods' && !i.isGroup && i.stock > 5 && !i.trackSerials && !i.trackBatches);
  item = items[0];
  other = items.find((i: any) => i.category !== item.category) ?? items[1];
  customerId = (await owner.get('/api/shop/customers')).body.find((c: any) => c.companyName === 'Nila Textiles').id;
});

const bill = (over: Record<string, unknown> = {}, lines = [{ itemId: item.id, qty: 1, tier: 'SP1', discount: 0 }]) =>
  owner.post('/api/shop/invoices').send({ customerId, date: today(), dueDate: today(), lines, withGst: true, issue: true, overrideCreditLimit: true, ...over });
const offer = (over: Record<string, unknown> = {}) =>
  owner.post('/api/shop/offers').send({ name: 'Diwali', kind: 'item', discountKind: 'percent', value: 10, scope: 'all', startsOn: today(), endsOn: addDays(today(), 5), message: 'Happy Diwali!', ...over });
const archiveAll = async () => { for (const o of (await owner.get('/api/shop/offers')).body) await owner.post(`/api/shop/offers/${o.id}/archive`).send({}); };

describe('festival offers', () => {
  it('a bill with no offers is saved exactly as before', async () => {
    const inv = (await bill()).body;
    expect(inv.offersApplied).toEqual([]);
    expect(inv.lines[0].discount).toBe(0);
    expect(inv.lines[0].enteredRate).toBeUndefined();
  });

  it('a running item offer takes its percentage off by itself, and prints its message', async () => {
    const o = (await offer()).body;
    expect(o.id).toBeTruthy();
    const inv = (await bill()).body;
    expect(inv.lines[0].discount).toBe(10);
    expect(inv.subTotal).toBeCloseTo(item.sp1 * 0.9, 2);
    expect(inv.offersApplied).toHaveLength(1);
    expect(inv.offersApplied[0]).toMatchObject({ id: o.id, name: 'Diwali', message: 'Happy Diwali!' });
    expect(inv.offersApplied[0].amount).toBeCloseTo(item.sp1 * 0.1 * (1 + item.taxRate / 100), 1);
  });

  it('the cashier can take an offer off one bill', async () => {
    const o = (await owner.get('/api/shop/offers')).body[0];
    const inv = (await bill({ skipOffers: [o.id] })).body;
    expect(inv.lines[0].discount).toBe(0);
    expect(inv.offersSkipped).toEqual([o.id]);
  });

  it('a future or paused offer does not apply', async () => {
    await archiveAll();
    await offer({ startsOn: addDays(today(), 2), endsOn: addDays(today(), 4) });
    await offer({ active: false });
    expect((await bill()).body.lines[0].discount).toBe(0);
    expect((await owner.get('/api/shop/offers/running')).body).toEqual([]);
  });

  it('a category offer only touches that category', async () => {
    await archiveAll();
    await offer({ scope: 'category', categories: [item.category], value: 20 });
    const inv = (await bill({}, [{ itemId: item.id, qty: 1, tier: 'SP1', discount: 0 }, { itemId: other.id, qty: 1, tier: 'SP1', discount: 0 }])).body;
    expect(inv.lines.map((l: any) => l.discount)).toEqual([20, 0]);
  });

  it('a bill offer needs its minimum, and takes rupees off what the customer pays', async () => {
    await archiveAll();
    const min = Math.round(item.sp1 * (1 + item.taxRate / 100)) + 1;
    await offer({ kind: 'bill', discountKind: 'amount', value: 100, minBill: min });
    const small = (await bill()).body;
    expect(small.offersApplied).toEqual([]);
    const plain = (await bill({}, [{ itemId: item.id, qty: 2, tier: 'SP1', discount: 0 }])).body;
    expect(plain.offersApplied[0].amount).toBeCloseTo(100, 0);
    await archiveAll();
    const without = (await bill({}, [{ itemId: item.id, qty: 2, tier: 'SP1', discount: 0 }])).body;
    expect(without.total - plain.total).toBeGreaterThanOrEqual(99);
    expect(without.total - plain.total).toBeLessThanOrEqual(101);
  });

  it('checks what is entered, and staff without pricing rights cannot create offers', async () => {
    expect((await offer({ endsOn: addDays(today(), -1) })).status).toBe(400);
    expect((await offer({ value: 150 })).status).toBe(400);
    expect((await offer({ kind: 'item', discountKind: 'amount' })).status).toBe(400);
    expect((await offer({ scope: 'items', itemIds: [] })).status).toBe(400);
    const sales = await login('sales@shop.com', 'sales123');
    expect((await sales.post('/api/shop/offers').send({ name: 'x', kind: 'item', value: 5, startsOn: today(), endsOn: today() })).status).toBe(403);
    expect((await sales.get('/api/shop/offers/running')).status).toBe(200);
  });
});

describe('promo line', () => {
  it('is saved on the invoice and receipt settings, and an older client that leaves it out keeps it', async () => {
    const ps = (await owner.get('/api/shop/print-settings')).body;
    const saved = (await owner.put('/api/shop/print-settings').send({ ...ps, invoice: { ...ps.invoice, promo: 'Diwali sale till 5 Nov' }, thermal: { ...ps.thermal, promo: 'Diwali sale!' } })).body;
    expect(saved.invoice.promo).toBe('Diwali sale till 5 Nov');
    const { promo: _a, ...thermalOld } = saved.thermal;
    const { promo: _b, ...invoiceOld } = saved.invoice;
    const again = (await owner.put('/api/shop/print-settings').send({ ...saved, thermal: thermalOld, invoice: invoiceOld })).body;
    expect(again.thermal.promo).toBe('Diwali sale!');
    expect(again.invoice.promo).toBe('Diwali sale till 5 Nov');
  });
});

describe('loyalty points', () => {
  const balance = async () => (await owner.get(`/api/shop/loyalty/customers/${customerId}`)).body.balance as number;

  it('are off until the owner switches them on', async () => {
    await archiveAll();
    expect((await bill()).body.loyalty.pointsEarned).toBe(0);
    expect((await bill({ redeemPoints: 10 })).status).toBe(400);
  });

  it('are earned on what the customer pays', async () => {
    const s = (await owner.put('/api/shop/loyalty/settings').send({ enabled: true, earnPer100: 2, pointValue: 1, minRedeem: 20, maxRedeemPct: 50 })).body;
    expect(s.enabled).toBe(true);
    const before = await balance();
    const inv = (await bill()).body;
    expect(inv.loyalty.pointsEarned).toBe(Math.floor((inv.total * 2) / 100));
    expect(await balance()).toBe(before + inv.loyalty.pointsEarned);
    expect(inv.loyalty.balanceAfter).toBe(before + inv.loyalty.pointsEarned);
  });

  it('can pay part of a bill, within the balance and the bill limit', async () => {
    await owner.post(`/api/shop/loyalty/customers/${customerId}/adjust`).send({ points: 500, note: 'Opening points' });
    const have = await balance();
    const tooMany = await bill({ redeemPoints: have + 1 });
    expect(tooMany.status).toBe(400);
    const plain = (await bill()).body;
    const used = (await bill({ redeemPoints: 50 })).body;
    expect(used.loyalty.pointsUsed).toBe(50);
    expect(used.loyalty.discount).toBe(50);
    expect(plain.total - used.total).toBeGreaterThanOrEqual(49);
    expect(plain.total - used.total).toBeLessThanOrEqual(51);
    const after = await balance();
    expect(after).toBe(have + plain.loyalty.pointsEarned - 50 + used.loyalty.pointsEarned);
  });

  it('a walk-in sale cannot use points, and a sale at the counter can', async () => {
    const walkIn = await owner.post('/api/shop/pos/sale').send({ customerId: null, lines: [{ itemId: item.id, qty: 1, tier: 'SP1', discount: 0 }], withGst: true, mode: 'Cash', redeemPoints: 20 });
    expect(walkIn.status).toBe(400);
    const pos = await owner.post('/api/shop/pos/sale').send({ customerId, lines: [{ itemId: item.id, qty: 1, tier: 'SP1', discount: 0 }], withGst: true, mode: 'Cash', redeemPoints: 20 });
    expect(pos.status).toBe(200);
    expect(pos.body.invoice.loyalty.pointsUsed).toBe(20);
    expect(pos.body.invoice.amountPaid).toBe(pos.body.invoice.total);
  });

  it('cancelling a bill gives back the points used and takes back the points earned', async () => {
    const before = await balance();
    const inv = (await bill({ redeemPoints: 30 })).body;
    expect(await balance()).toBe(before - 30 + inv.loyalty.pointsEarned);
    const c = await owner.post(`/api/shop/invoices/${inv.id}/cancel`).send({ reason: 'Wrong bill' });
    expect(c.status).toBe(200);
    expect(await balance()).toBe(before);
  });

  it('a return takes back the points earned on what was returned', async () => {
    const inv = (await bill({}, [{ itemId: item.id, qty: 4, tier: 'SP1', discount: 0 }])).body;
    const before = await balance();
    const cn = await owner.post('/api/shop/credit-notes').send({ invoiceId: inv.id, date: today(), reason: 'Sales return', restock: true, lines: [{ lineId: inv.lines[0].id, qty: 2 }] });
    expect(cn.status).toBe(200);
    const back = Math.min(inv.loyalty.pointsEarned, Math.ceil((inv.loyalty.pointsEarned * cn.body.total) / inv.total));
    expect(await balance()).toBe(before - back);
  });

  it('bills for the same customer at the same time neither deadlock nor overspend points', async () => {
    const start = await balance();
    const per = 10;
    const tries = 6;
    const res = await Promise.all(Array.from({ length: tries }, () => owner.post('/api/shop/pos/sale').send({ customerId, lines: [{ itemId: item.id, qty: 1, tier: 'SP1', discount: 0 }], withGst: true, mode: 'Cash', redeemPoints: per })));
    const okd = res.filter((r) => r.status === 200);
    expect(res.every((r) => r.status === 200 || r.status === 409 || r.status === 400)).toBe(true);
    expect(okd.length).toBeGreaterThan(0);
    const earned = okd.reduce((s2, r) => s2 + r.body.invoice.loyalty.pointsEarned, 0);
    expect(await balance()).toBe(start - per * okd.length + earned);
    expect(await balance()).toBeGreaterThanOrEqual(0);
  });

  it('every change is in the history, and only the owner can adjust', async () => {
    const h = (await owner.get(`/api/shop/loyalty/customers/${customerId}`)).body.history;
    expect(new Set(h.map((x: any) => x.kind))).toEqual(new Set(['earn', 'redeem', 'reverse', 'adjust']));
    const sales = await login('sales@shop.com', 'sales123');
    expect((await sales.post(`/api/shop/loyalty/customers/${customerId}/adjust`).send({ points: 10, note: 'x' })).status).toBe(403);
    expect((await owner.post(`/api/shop/loyalty/customers/${customerId}/adjust`).send({ points: -1e6, note: 'x' })).status).toBe(400);
  });

  it('a shop without the add-on bills as before and cannot use points', async () => {
    const shopId = owner.me.shop.id;
    await query("UPDATE shop_features SET status = 'ended' WHERE shop_id = $1 AND feature_key = 'offers_loyalty' AND status = 'active'", [shopId]);
    try {
      await offer();
      const inv = (await bill()).body;
      expect(inv.lines[0].discount).toBe(0);
      expect(inv.loyalty.pointsEarned).toBe(0);
      expect((await bill({ redeemPoints: 20 })).status).toBe(400);
      expect((await owner.get('/api/shop/offers')).status).toBe(403);
    } finally {
      await query("UPDATE shop_features SET status = 'active' WHERE id = (SELECT id FROM shop_features WHERE shop_id = $1 AND feature_key = 'offers_loyalty' ORDER BY created_at DESC LIMIT 1)", [shopId]);
    }
  });
});
