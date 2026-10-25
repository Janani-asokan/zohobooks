import { beforeAll, describe, expect, it } from 'vitest';
import { freshDb, login, today } from './helpers';

let owner: Awaited<ReturnType<typeof login>>;
let head: string;
let second: string;
let slab: string;
const stockOf = async (id: string) => (await owner.get('/api/shop/items')).body.find((i: any) => i.id === id);
const newGoods = async (name: string, extra: Record<string, unknown> = {}) =>
  (await owner.post('/api/shop/items').send({ type: 'Goods', name, cost: 100, sp1: 150, sp2: 140, sp3: 145, taxSlabId: slab, openingStock: 10, branchId: head, ...extra })).body;

beforeAll(async () => {
  await freshDb();
  owner = await login('owner@shop.com', 'owner123');
  const branches = (await owner.get('/api/shop/branches')).body;
  head = branches.find((b: any) => b.isPrimary).id;
  second = branches.find((b: any) => !b.isPrimary)?.id ?? (await owner.post('/api/shop/branches').send({ name: 'Godown', address: 'Ambattur', phone: '' })).body.id;
  slab = (await owner.get('/api/shop/tax-slabs')).body.find((s: any) => s.rate === 18).id;
});

describe('stock adjustments', () => {
  it('adds, removes and counts stock as one numbered document', async () => {
    const a = await newGoods('Adjust Test Cable');
    const r = await owner.post('/api/shop/stock/adjustments').send({ branchId: head, reason: 'Damaged', lines: [{ itemId: a.id, qty: -3 }] });
    expect(r.status).toBe(200);
    expect(r.body.number).toMatch(/^ADJ-\d{4}$/);
    expect(r.body.lines[0]).toMatchObject({ before: 10, change: -3, after: 7, value: -300 });
    const count = await owner.post('/api/shop/stock/adjustments').send({ branchId: head, reason: 'Stock count', mode: 'count', lines: [{ itemId: a.id, qty: 9 }] });
    expect(count.body.lines[0]).toMatchObject({ before: 7, change: 2, after: 9 });
    expect((await stockOf(a.id)).stock).toBe(9);
    expect((await owner.post('/api/shop/stock/adjustments').send({ branchId: head, reason: 'Stock count', mode: 'count', lines: [{ itemId: a.id, qty: 9 }] })).status).toBe(400);
    expect((await owner.post('/api/shop/stock/adjustments').send({ branchId: head, reason: 'Lost or stolen', lines: [{ itemId: a.id, qty: -50 }] })).status).toBe(400);
    const moves = (await owner.get(`/api/shop/items/${a.id}/movements`)).body.movements;
    expect(moves.filter((m: any) => m.refType === 'stock_adjustment')).toHaveLength(2);
  });
});

describe('transfers', () => {
  it('moves stock out on dispatch and in on receipt', async () => {
    const a = await newGoods('Transfer Test Router');
    const t = (await owner.post('/api/shop/stock/transfers').send({ fromBranchId: head, toBranchId: second, lines: [{ itemId: a.id, qty: 4 }] })).body;
    expect(t).toMatchObject({ status: 'In transit' });
    expect(t.number).toMatch(/^TR-\d{4}$/);
    let it = await stockOf(a.id);
    expect(it.stockByBranch[head]).toBe(6);
    expect(it.stockByBranch[second] ?? 0).toBe(0);
    expect((await owner.post(`/api/shop/stock/transfers/${t.id}/receive`).send({})).body.status).toBe('Received');
    it = await stockOf(a.id);
    expect(it.stockByBranch[second]).toBe(4);
    expect((await owner.post(`/api/shop/stock/transfers/${t.id}/receive`).send({})).status).toBe(409);

    const t2 = (await owner.post('/api/shop/stock/transfers').send({ fromBranchId: head, toBranchId: second, lines: [{ itemId: a.id, qty: 2 }] })).body;
    expect((await owner.post(`/api/shop/stock/transfers/${t2.id}/cancel`).send({})).body.status).toBe('Cancelled');
    expect((await stockOf(a.id)).stockByBranch[head]).toBe(6);
    expect((await owner.post('/api/shop/stock/transfers').send({ fromBranchId: head, toBranchId: second, lines: [{ itemId: a.id, qty: 99 }] })).status).toBe(400);
    expect((await owner.post('/api/shop/stock/transfers').send({ fromBranchId: head, toBranchId: head, lines: [{ itemId: a.id, qty: 1 }] })).status).toBe(400);
  });
});

describe('serial numbers', () => {
  it('registers serials, requires them on invoices, and returns them on cancel', async () => {
    const a = await newGoods('Serial Test Laptop', { trackSerials: true, openingStock: 3 });
    expect(a.trackSerials).toBe(true);
    const reg = await owner.post(`/api/shop/items/${a.id}/serials`).send({ branchId: head, serials: ['SN-001', 'SN-002', 'SN-003'] });
    expect(reg.status).toBe(200);
    expect(reg.body).toHaveLength(3);
    expect((await owner.post(`/api/shop/items/${a.id}/serials`).send({ branchId: head, serials: ['SN-004'] })).status).toBe(400); // more serials than stock
    expect((await owner.post(`/api/shop/items/${a.id}/serials`).send({ branchId: head, serials: ['SN-001'] })).status).toBe(400); // duplicate

    const customerId = (await owner.get('/api/shop/customers')).body[0].id;
    const base = { customerId, date: today(), dueDate: today(), withGst: true, branchId: head, issue: true };
    const missing = await owner.post('/api/shop/invoices').send({ ...base, lines: [{ itemId: a.id, qty: 2, tier: 'SP1' }] });
    expect(missing.status).toBe(400);
    expect(missing.body.code).toBe('serials_required');
    const bad = await owner.post('/api/shop/invoices').send({ ...base, lines: [{ itemId: a.id, qty: 1, tier: 'SP1', serials: ['NOPE'] }] });
    expect(bad.body.code).toBe('serials_unavailable');
    const inv = (await owner.post('/api/shop/invoices').send({ ...base, lines: [{ itemId: a.id, qty: 2, tier: 'SP1', serials: ['SN-001', 'SN-002'] }] })).body;
    expect(inv.lines[0].serials).toEqual(['SN-001', 'SN-002']);
    let list = (await owner.get(`/api/shop/items/${a.id}/serials`)).body;
    expect(list.filter((s: any) => s.status === 'Sold').map((s: any) => s.invoiceNumber)).toEqual([inv.number, inv.number]);
    const found = (await owner.get('/api/shop/serials/lookup?q=SN-002')).body;
    expect(found[0]).toMatchObject({ serial: 'SN-002', status: 'Sold', itemName: 'Serial Test Laptop' });

    await owner.post(`/api/shop/invoices/${inv.id}/cancel`).send({ reason: 'Customer returned' });
    list = (await owner.get(`/api/shop/items/${a.id}/serials`)).body;
    expect(list.every((s: any) => s.status === 'In stock')).toBe(true);
  });
});

describe('variants', () => {
  it('turns an item into a group with one sellable item per combination', async () => {
    const g = (await owner.post('/api/shop/items').send({ type: 'Goods', name: 'Polo T-Shirt', cost: 200, sp1: 499, sp2: 479, sp3: 489, taxSlabId: slab, openingStock: 0 })).body;
    const r = await owner.post(`/api/shop/items/${g.id}/variants`).send({
      attributes: [{ name: 'Size', values: ['M', 'L'] }, { name: 'Colour', values: ['Navy'] }],
      variants: [{ attrs: { Size: 'M', Colour: 'Navy' }, sku: 'POLO-M-NV' }, { attrs: { Size: 'L', Colour: 'Navy' }, sku: 'POLO-L-NV', sp1: 549 }],
    });
    expect(r.body.created).toBe(2);
    const items = (await owner.get('/api/shop/items')).body;
    const group = items.find((i: any) => i.id === g.id);
    expect(group).toMatchObject({ isGroup: true });
    const kids = items.filter((i: any) => i.parentId === g.id);
    expect(kids.map((k: any) => k.name).sort()).toEqual(['Polo T-Shirt - L / Navy', 'Polo T-Shirt - M / Navy']);
    expect(kids.find((k: any) => k.sku === 'POLO-L-NV')).toMatchObject({ sp1: 549, variantAttrs: { Size: 'L', Colour: 'Navy' } });
    // Running it again adds nothing new; the group itself can't be sold.
    expect((await owner.post(`/api/shop/items/${g.id}/variants`).send({ attributes: [{ name: 'Size', values: ['M'] }, { name: 'Colour', values: ['Navy'] }], variants: [{ attrs: { Size: 'M', Colour: 'Navy' } }] })).body.created).toBe(0);
    const customerId = (await owner.get('/api/shop/customers')).body[0].id;
    expect((await owner.post('/api/shop/invoices').send({ customerId, date: today(), dueDate: today(), withGst: true, issue: false, lines: [{ itemId: g.id, qty: 1, tier: 'SP1' }] })).status).toBe(400);
  });
});

describe('stock summary', () => {
  it('reconciles opening + in − out with closing and the live stock', async () => {
    const s = (await owner.get(`/api/shop/stock/summary?from=2000-01-01&to=${today()}`)).body;
    const items = (await owner.get('/api/shop/items')).body;
    for (const row of s.items) {
      expect(Math.round((row.opening + row.in - row.out) * 1000) / 1000).toBe(row.closing);
      const live = items.find((i: any) => i.id === row.itemId);
      expect(row.closing).toBeCloseTo(live.stock, 3);
    }
    const total = s.items.reduce((a: number, r: any) => a + r.value, 0);
    expect(s.totals.value).toBeCloseTo(total, 2);
    expect(s.byBranch.reduce((a: number, b: any) => a + b.value, 0)).toBeCloseTo(s.totals.value, 2);
  });
});
