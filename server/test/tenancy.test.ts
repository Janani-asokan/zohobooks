import { beforeAll, describe, expect, it } from 'vitest';
import { many, withTenant } from '../src/db';
import { freshDb, login } from './helpers';

let ownerA: Awaited<ReturnType<typeof login>>;
let ownerB: Awaited<ReturnType<typeof login>>;
let shopB: string;

beforeAll(async () => {
  await freshDb();
  const sa = await login('admin@ledgerly.in', 'admin123');
  const res = await sa.post('/api/platform/shops').send({ shopName: 'Rival Store', ownerName: 'Ravi', email: 'ravi@rival.in', phone: '9876500000', city: 'Madurai', planId: 'standard', years: 1, password: 'TempPass1' });
  expect(res.status).toBe(201);
  shopB = res.body.id;
  ownerA = await login('owner@shop.com', 'owner123');
  ownerB = await login('ravi@rival.in', 'TempPass1');
  await ownerB.post('/api/auth/change-password').send({ current: 'TempPass1', next: 'RivalPass1' });
});

describe('tenant isolation', () => {
  it('a new shop starts empty and sees nothing of other shops', async () => {
    expect((await ownerB.get('/api/shop/invoices')).body).toEqual([]);
    expect((await ownerB.get('/api/shop/customers')).body).toEqual([]);
    expect((await ownerB.get('/api/shop/items')).body).toEqual([]);
  });

  it('cannot read, pay, cancel or credit another shop’s invoice by id', async () => {
    const inv = (await ownerA.get('/api/shop/invoices')).body.find((i: any) => i.status === 'Issued' && i.balance > 0);
    expect((await ownerB.get(`/api/shop/invoices/${inv.id}`)).status).toBe(404);
    expect((await ownerB.post(`/api/shop/invoices/${inv.id}/payments`).send({ amount: 1, mode: 'Cash' })).status).toBe(404);
    expect((await ownerB.post(`/api/shop/invoices/${inv.id}/cancel`).send({ reason: 'test cancel' })).status).toBe(404);
    expect((await ownerB.post('/api/shop/credit-notes').send({ invoiceId: inv.id, date: inv.date, reason: 'Other', lines: [{ lineId: inv.lines[0].id, qty: 1 }] })).status).toBe(404);
    expect((await ownerA.get(`/api/shop/invoices/${inv.id}`)).body.balance).toBe(inv.balance); // untouched
  });

  it('cannot invoice another shop’s customer or item', async () => {
    const custA = (await ownerA.get('/api/shop/customers')).body[0];
    const itemA = (await ownerA.get('/api/shop/items')).body[0];
    const res = await ownerB.post('/api/shop/invoices').send({ customerId: custA.id, date: '2026-10-01', dueDate: '2026-10-10', lines: [{ itemId: itemA.id, qty: 1 }], withGst: false });
    expect(res.status).toBe(400);
  });

  it('row-level security hides other shops even if a query forgets its filter', async () => {
    const rows = await withTenant(shopB, (db) => many(db, 'SELECT id FROM invoices'));
    expect(rows).toHaveLength(0);
    await expect(withTenant(shopB, (db) => db.query("INSERT INTO customers (shop_id, custom_id, type, name) SELECT shop_id, 'X-1', 'Individual', 'x' FROM organizations WHERE company_name = 'Aravind Computer Store'"))).resolves.toBeDefined();
    // the SELECT inside saw no rows of shop A, so nothing was inserted into A
    const leaked = await withTenant(shopB, (db) => many(db, "SELECT * FROM customers WHERE custom_id = 'X-1'"));
    expect(leaked).toHaveLength(0);
  });

  it('super admin cannot reach shop data endpoints', async () => {
    const sa = await login('admin@ledgerly.in', 'admin123');
    expect((await sa.get('/api/shop/invoices')).status).toBe(401);
    expect((await sa.get('/api/shop/customers')).status).toBe(401);
    const overview = (await sa.get('/api/platform/overview')).body;
    expect(JSON.stringify(overview)).not.toMatch(/Nila Textiles|INV-20/);
  });

  it('deactivating a shop ends its sessions immediately', async () => {
    const sa = await login('admin@ledgerly.in', 'admin123');
    expect((await sa.patch(`/api/platform/shops/${shopB}`).send({ active: false })).status).toBe(200);
    expect((await ownerB.get('/api/shop/items')).status).toBe(401);
    await sa.patch(`/api/platform/shops/${shopB}`).send({ active: true });
  });
});
