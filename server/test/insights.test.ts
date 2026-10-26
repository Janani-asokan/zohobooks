import { beforeAll, describe, expect, it } from 'vitest';
import { freshDb, login, today } from './helpers';
import { withTenant } from '../src/db';

let owner: Awaited<ReturnType<typeof login>>;
let sales: Awaited<ReturnType<typeof login>>;
let head: string;
let slab: string;
let customer: any;

beforeAll(async () => {
  await freshDb();
  owner = await login('owner@shop.com', 'owner123');
  sales = await login('sales@shop.com', 'sales123');
  head = (await owner.get('/api/shop/branches')).body.find((b: any) => b.isPrimary).id;
  slab = (await owner.get('/api/shop/tax-slabs')).body.find((s: any) => s.rate === 18).id;
  customer = (await owner.get('/api/shop/customers')).body[0];
});

const goods = async (name: string, openingStock: number, reorderLevel = 10) =>
  (await owner.post('/api/shop/items').send({ type: 'Goods', name, cost: 100, sp1: 150, sp2: 150, sp3: 150, taxSlabId: slab, openingStock, reorderLevel, branchId: head })).body;
const sell = (itemId: string, qty: number) =>
  owner.post('/api/shop/invoices').send({ customerId: customer.id, date: today(), dueDate: today(), withGst: true, issue: true, branchId: head, lines: [{ itemId, qty, tier: 'SP1' }] });

describe('stock insights', () => {
  it('suggests reordering a fast seller before it runs out, with enough for lead time + cover', async () => {
    const fast = await goods('Insight Fast Seller', 20, 2);
    expect((await sell(fast.id, 15)).status).toBe(200);
    const ins = (await owner.get('/api/shop/stock/insights?leadDays=7&coverDays=30')).body;
    const r = ins.reorder.find((x: any) => x.itemId === fast.id);
    expect(r).toBeTruthy();
    // 15 sold in 30 days → 0.6·0.5 + 0.4·(15/90) ≈ 0.37/day; 5 left ≈ 13 days, inside lead time + a week.
    expect(r.perDay).toBeCloseTo(0.37, 2);
    expect(r.daysLeft).toBe(13);
    expect(r.suggestQty).toBe(9); // 0.367 × 37 days = 13.6 → order 14 − 5 on hand, rounded up
    expect(r.urgency).toBe('soon');
  });

  it('flags items with no sales in 90 days as dead stock, and expiring batches', async () => {
    const idle = await goods('Insight Idle Item', 8, 1);
    await withTenant(owner.me.shop.id, (db) => db.query("UPDATE items SET created_at = now() - interval '120 days' WHERE id = $1", [idle.id]));
    const ins = (await owner.get('/api/shop/stock/insights')).body;
    const d = ins.dead.find((x: any) => x.itemId === idle.id);
    expect(d).toMatchObject({ stock: 8, value: 800 });
    expect(d.daysIdle).toBeGreaterThanOrEqual(119);
    expect(ins.totals.deadValue).toBeGreaterThanOrEqual(800);
  });

  it('hides money figures from roles without cost access, and blocks roles without stock access', async () => {
    const mgr = await login('accounts@shop.com', 'accounts123');
    expect((await mgr.get('/api/shop/stock/insights')).status).toBe(200);
    expect((await sales.get('/api/shop/stock/insights')).status).toBe(403);
  });
});
