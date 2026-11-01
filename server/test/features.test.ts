import fs from 'node:fs';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { query } from '../src/db';
import { FEATURES, featureForApi } from '../../shared/features';
import { freshDb, login } from './helpers';

type Client = Awaited<ReturnType<typeof login>>;
let sa: Client;
let basic: Client; // a shop with no add-on features
let basicId: string;

async function newShop(email: string, features?: string[]) {
  const res = await sa.post('/api/platform/shops').send({ shopName: `Shop ${email}`, ownerName: 'Murugan', email, phone: '9876501234', city: 'Salem', planId: 'standard', years: 1, password: 'TempPass1', ...(features ? { features } : {}) });
  expect(res.status).toBe(201);
  const owner = await login(email, 'TempPass1');
  await owner.post('/api/auth/change-password').send({ current: 'TempPass1', next: 'ShopPass12' });
  return { id: res.body.id as string, owner: await login(email, 'ShopPass12') };
}

beforeAll(async () => {
  await freshDb();
  sa = await login('admin@ledgerly.in', 'admin123');
  ({ id: basicId, owner: basic } = await newShop('basic@veg.in', []));
});

describe('catalogue', () => {
  it('has unique keys, levels and a default price for every level', () => {
    expect(new Set(FEATURES.map((f) => f.key)).size).toBe(FEATURES.length);
    for (const f of FEATURES) {
      expect(f.levels.length).toBeGreaterThan(0);
      for (const l of f.levels) expect(typeof f.defaultMonthly[l.key]).toBe('number');
      if (f.available) expect(f.api.length + f.pages.length).toBeGreaterThan(0);
    }
  });

  it('never gates core billing', () => {
    for (const p of ['/invoices', '/invoices/x', '/customers', '/items', '/payments', '/credit-notes', '/dashboard', '/organization', '/reports/sales', '/reports/profit-loss', '/gst/gstr1', '/bank-accounts', '/stock/alerts', '/ai/status', '/ai/briefing', '/insights/health', '/extract', '/attachments', '/features'])
      expect(featureForApi(p)?.key, p).toBeUndefined();
  });

  it('every gated page matches a real route in the app', () => {
    const app = fs.readFileSync(path.resolve(__dirname, '../../src/App.tsx'), 'utf8');
    const nav = fs.readFileSync(path.resolve(__dirname, '../../src/layouts/nav.ts'), 'utf8');
    // Routes from App.tsx (parameters filled in) plus every concrete link the sidebar and palette offer.
    const routes = [...[...app.matchAll(/path="([^"]+)"/g)].map((m) => `/app/${m[1]}`.replace(/:[a-z]+/gi, 'x')), ...[...nav.matchAll(/'(\/app\/[^'?]+)/g)].map((m) => m[1]!)];
    for (const f of FEATURES) for (const re of f.pages) expect(routes.some((r) => re.test(r)), `${f.key} ${re}`).toBe(true);
  });

  it('existing shops were given every feature by the migration, and the demo shop has them all', async () => {
    const owner = await login('owner@shop.com', 'owner123');
    expect(Object.keys(owner.me.shop.features).sort()).toEqual(FEATURES.filter((f) => f.available).map((f) => f.key).sort());
  });
});

describe('a shop without add-ons', () => {
  it('keeps core billing and is told clearly when a feature is off', async () => {
    expect(basic.me.shop.features).toEqual({});
    expect((await basic.get('/api/shop/invoices')).status).toBe(200);
    expect((await basic.get('/api/shop/customers')).status).toBe(200);
    expect((await basic.get('/api/shop/items')).status).toBe(200);
    const so = await basic.get('/api/shop/sales-orders?kind=quote');
    expect(so.status).toBe(403);
    expect(so.body.code).toBe('feature_off');
    expect(so.body.details.feature).toBe('quotes_orders');
    expect(so.body.error).toMatch(/Settings → Features/);
    for (const url of ['/api/shop/vendors', '/api/shop/stock/adjustments', '/api/shop/accounting/accounts', '/api/shop/field/me', '/api/shop/lending/settings', '/api/shop/recurring'])
      expect((await basic.get(url)).status, url).toBe(403);
    expect((await basic.post('/api/shop/pos/sale').send({})).status).toBe(403);
  });

  it('does not use AI: the status says off and uploads use the offline reader', async () => {
    expect((await basic.get('/api/shop/ai/status')).body.enabled).toBe(false);
    expect((await basic.get('/api/shop/extract/status')).body.ai).toBe(false);
    expect((await basic.post('/api/shop/ai/ask').send({ messages: [{ role: 'user', content: 'hi' }] })).status).toBe(403);
  });
});

describe('asking for a feature and turning it on', () => {
  it('owner asks, the platform sees the request, approves it, and the feature works', async () => {
    const list = (await basic.get('/api/shop/features')).body;
    const quotes = list.features.find((f: { key: string }) => f.key === 'quotes_orders');
    expect(quotes.on).toBe(false);
    expect(quotes.levels[0].monthly).toBeGreaterThan(0);
    expect(list.features.some((f: { key: string }) => f.key === 'attendance')).toBe(false); // not offered yet

    expect((await basic.post('/api/shop/features/quotes_orders/request').send({ level: 'standard' })).status).toBe(200);
    const again = await basic.post('/api/shop/features/quotes_orders/request').send({ level: 'standard' });
    expect(again.status).toBe(400);
    expect(again.body.error).toMatch(/already asked/);

    const reqs = (await sa.get('/api/platform/features')).body.requests;
    expect(reqs.some((r: { shopId: string; feature: string }) => r.shopId === basicId && r.feature === 'quotes_orders')).toBe(true);

    const on = await sa.post(`/api/platform/shops/${basicId}/features/quotes_orders`).send({ level: 'standard', source: 'paid', endsOn: null });
    expect(on.status).toBe(200);
    expect((await sa.get('/api/platform/features')).body.requests.some((r: { shopId: string }) => r.shopId === basicId)).toBe(false);
    expect((await basic.get('/api/shop/sales-orders?kind=quote')).status).toBe(200);
    const me = (await basic.get('/api/auth/me')).body;
    expect(me.shop.features).toEqual({ quotes_orders: 'standard' });
  });

  it('turning a feature off hides it but keeps its data, and turning it on shows it again', async () => {
    const owner = await login('owner@shop.com', 'owner123');
    const before = (await owner.get('/api/shop/sales-orders?kind=quote')).body.length;
    expect(before).toBeGreaterThan(0);
    const shopId = owner.me.shop.id;
    expect((await sa.del(`/api/platform/shops/${shopId}/features/quotes_orders`).send({ note: 'test' })).status).toBe(200);
    expect((await owner.get('/api/shop/sales-orders?kind=quote')).status).toBe(403);
    const rows = await query('SELECT count(*)::int AS n FROM shop_features WHERE shop_id = $1 AND feature_key = $2', [shopId, 'quotes_orders']);
    expect(rows[0].n).toBeGreaterThanOrEqual(1); // history kept
    await sa.post(`/api/platform/shops/${shopId}/features/quotes_orders`).send({ level: 'standard', source: 'complimentary', endsOn: null });
    expect((await owner.get('/api/shop/sales-orders?kind=quote')).body.length).toBe(before);
  });

  it('a period that has ended stops the feature without anyone touching it', async () => {
    await sa.post(`/api/platform/shops/${basicId}/features/recurring`).send({ level: 'standard', source: 'paid', endsOn: null });
    expect((await basic.get('/api/shop/recurring')).status).toBe(200);
    await query("UPDATE shop_features SET starts_on = current_date - 30, ends_on = current_date - 1 WHERE shop_id = $1 AND feature_key = 'recurring' AND status = 'active'", [basicId]);
    expect((await basic.get('/api/shop/recurring')).status).toBe(403);
  });

  it('only the owner manages features, and only the platform turns them on', async () => {
    const staff = await login('sales@shop.com', 'sales123');
    expect((await staff.get('/api/shop/features')).status).toBe(403);
    expect([401, 403]).toContain((await basic.post(`/api/platform/shops/${basicId}/features/pos`).send({ level: 'standard', source: 'paid', endsOn: null })).status);
  });

  it('a level that does not exist and a feature that is not offered are refused', async () => {
    expect((await basic.post('/api/shop/features/pos/request').send({ level: 'gold' })).status).toBe(400);
    expect((await basic.post('/api/shop/features/attendance/request').send({ level: 'manual' })).status).toBe(400);
  });
});

describe('declining a request', () => {
  it('closes only the request: a feature the shop already has stays on', async () => {
    const owner = await login('owner@shop.com', 'owner123');
    const shopId = owner.me.shop.id;
    await query("INSERT INTO shop_features (shop_id, feature_key, level, status, source, requested_by) VALUES ($1, 'pos', 'standard', 'requested', 'request', 'test')", [shopId]);
    expect((await sa.post(`/api/platform/shops/${shopId}/features/pos/decline`).send({})).status).toBe(200);
    expect((await owner.get('/api/shop/pos/sale')).status).not.toBe(403);
    expect((await login('owner@shop.com', 'owner123')).me.shop.features.pos).toBe('standard');
    expect((await sa.post(`/api/platform/shops/${shopId}/features/pos/decline`).send({})).status).toBe(404);
  });
});

describe('recurring invoices follow the feature', () => {
  it('a shop without the feature gets no recurring invoices, and turning it on later does not bill the months it was off', async () => {
    const { runRecurring } = await import('../src/jobs');
    const { withTenant } = await import('../src/db');
    const owner = await login('owner@shop.com', 'owner123');
    const shopId = owner.me.shop.id;
    const count = async () => (await owner.get('/api/shop/invoices')).body.filter((i: { source: string }) => i.source === 'recurring').length;
    await withTenant(shopId, (db) => db.query("UPDATE recurring_profiles SET next_date = current_date - 90, frequency = 'monthly', active = true"));
    await sa.del(`/api/platform/shops/${shopId}/features/recurring`);
    const before = await count();
    await runRecurring();
    expect(await count()).toBe(before); // off: nothing raised, profiles untouched
    await sa.post(`/api/platform/shops/${shopId}/features/recurring`).send({ level: 'standard', source: 'paid', endsOn: null });
    await runRecurring();
    const profiles = (await withTenant(shopId, (db) => db.query('SELECT count(*)::int AS n FROM recurring_profiles WHERE active'))).rows[0].n;
    expect(await count()).toBeLessThanOrEqual(before + profiles); // at most today's invoice per profile, not three months of them
  });
});

describe('prices', () => {
  it('the platform sets a price, shops see it, and a request keeps the price it was made at', async () => {
    const put = await sa.put('/api/platform/features/prices').send({ prices: [{ feature: 'pos', level: 'standard', monthly: 250 }] });
    expect(put.status).toBe(200);
    expect(put.body.find((p: { feature: string }) => p.feature === 'pos')).toMatchObject({ monthly: 250, yearly: 2500, custom: true });
    const pos = (await basic.get('/api/shop/features')).body.features.find((f: { key: string }) => f.key === 'pos');
    expect(pos.levels[0].monthly).toBe(250);
    await basic.post('/api/shop/features/pos/request').send({ level: 'standard' });
    await sa.put('/api/platform/features/prices').send({ prices: [{ feature: 'pos', level: 'standard', monthly: 300 }] });
    const r = (await sa.get('/api/platform/features')).body.requests.find((x: { shopId: string; feature: string }) => x.shopId === basicId && x.feature === 'pos');
    expect(r.monthlyPrice).toBe(250);
  });
});

describe('new shops', () => {
  it('get a 14-day trial of every feature when none are chosen', async () => {
    const { owner } = await newShop('trial@shop.in');
    expect(Object.keys(owner.me.shop.features).length).toBe(FEATURES.filter((f) => f.available).length);
    const ends = await query("SELECT DISTINCT ends_on - starts_on AS d FROM shop_features WHERE shop_id = $1", [owner.me.shop.id]);
    expect(ends).toEqual([{ d: 14 }]);
  });

  it('get the chosen features until the licence ends', async () => {
    const { id, owner } = await newShop('chosen@shop.in', ['pos', 'purchases']);
    expect(owner.me.shop.features).toEqual({ pos: 'standard', purchases: 'standard' });
    const [row] = await query("SELECT max(f.ends_on) = s.license_end AS same FROM shop_features f JOIN shops s ON s.id = f.shop_id WHERE f.shop_id = $1 GROUP BY s.license_end", [id]);
    expect(row.same).toBe(true);
  });
});
