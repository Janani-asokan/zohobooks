import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app, freshDb, login } from './helpers';
import { query } from '../src/db';
import { FEATURES, capacityOf, offeredTo } from '../../shared/features';

let shopId = '';
const grant = (key: string, level: string) => query(`INSERT INTO shop_features (shop_id, feature_key, level, status, source, starts_on, monthly_price, decided_by)
  VALUES ($1, $2, $3, 'active', 'paid', current_date, 0, 'test')`, [shopId, key, level]);

beforeAll(async () => {
  await freshDb();
  shopId = (await query("SELECT shop_id FROM users WHERE email = 'owner@shop.com'"))[0].shop_id;
});

describe('catalogue rules', () => {
  it('capacity packs read as numbers; retired features are only shown to shops that already have them', () => {
    expect(capacityOf({ extra_stores: 'plus3' }, 'extra_stores')).toBe(3);
    expect(capacityOf({}, 'extra_stores')).toBe(0);
    const keys = (ent: Record<string, string>) => offeredTo(ent).map((f) => f.key);
    expect(keys({ microfinance: 'standard' })).not.toContain('microfinance'); // removed from the product
    expect(keys({})).toEqual(expect.arrayContaining(['extra_stores', 'extra_warehouses', 'extra_business']));
    expect(FEATURES.filter((f) => f.capacity).every((f) => f.api.length === 0 && f.pages.length === 0)).toBe(true);
  });
});

describe('microfinance is removed', () => {
  it('no shop sees it, even one that had it; its screens and API are gone; a new shop’s trial doesn’t include it', async () => {
    await grant('microfinance', 'standard'); // an old purchase row
    const owner = await login('owner@shop.com', 'owner123');
    expect(owner.me.shop.features.microfinance).toBeUndefined();
    const list = (await owner.get('/api/shop/features')).body.features.map((f: { key: string }) => f.key);
    expect(list).not.toContain('microfinance');
    expect((await owner.get('/api/shop/lending/settings')).status).toBe(404);
    const su = await request(app).post('/api/auth/signup').set('X-Requested-With', 'ledgerly').send({ shopName: 'New Trial Shop', ownerName: 'Trial Owner', email: 'trial@example.com', phone: '9840011111', city: 'Chennai', password: 'Sunrise#2026' });
    expect(su.status, JSON.stringify(su.body)).toBe(201);
    const trial = (await query("SELECT feature_key FROM shop_features f JOIN shops s ON s.id = f.shop_id WHERE s.name = 'New Trial Shop'")).map((x) => x.feature_key);
    expect(trial).not.toContain('microfinance');
    expect(trial).not.toContain('extra_stores');
    expect(trial).toContain('pos');
  });
});

describe('more stores and warehouses', () => {
  it('stores count against the plan plus “More stores”; warehouses need “More warehouses”', async () => {
    await query("UPDATE plans SET max_branches = 2 WHERE id = (SELECT plan_id FROM shops WHERE id = $1)", [shopId]);
    const owner = await login('owner@shop.com', 'owner123');
    const stores = (await query("SELECT count(*)::int AS n FROM branches WHERE shop_id = $1 AND kind = 'store'", [shopId]))[0].n;
    expect(stores).toBe(2); // the demo shop: Head Office and Velachery
    const third = await owner.post('/api/shop/branches').send({ name: 'Tambaram', kind: 'store' });
    expect(third.status).toBe(402);
    expect(third.body.error).toMatch(/More stores/);
    await grant('extra_stores', 'plus1');
    expect((await owner.post('/api/shop/branches').send({ name: 'Tambaram', kind: 'store' })).status).toBe(200);
    expect((await owner.post('/api/shop/branches').send({ name: 'Porur', kind: 'store' })).status).toBe(402);

    const wh = await owner.post('/api/shop/branches').send({ name: 'Ambattur godown', kind: 'warehouse' });
    expect(wh.status).toBe(402);
    expect(wh.body.error).toMatch(/More warehouses/);
    await grant('extra_warehouses', 'plus1');
    const ok = await owner.post('/api/shop/branches').send({ name: 'Ambattur godown', kind: 'warehouse' });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body.kind).toBe('warehouse');
    // Turning a store into a warehouse needs room for one more warehouse.
    const tam = (await query("SELECT id FROM branches WHERE shop_id = $1 AND name = 'Tambaram'", [shopId]))[0].id;
    expect((await owner.put(`/api/shop/branches/${tam}`).send({ name: 'Tambaram', kind: 'warehouse' })).status).toBe(402);
    // The main branch stays a store.
    const main = (await query('SELECT id FROM branches WHERE shop_id = $1 AND is_primary', [shopId]))[0].id;
    expect((await owner.put(`/api/shop/branches/${main}`).send({ name: 'Head Office', kind: 'warehouse' })).status).toBe(400);
  });
});
