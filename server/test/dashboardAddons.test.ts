import { beforeAll, describe, expect, it } from 'vitest';
import { FEATURES } from '../../shared/features';
import { freshDb, login } from './helpers';

/* A business that buys two (or more) add-ons sees every one of them on its dashboard, with the same login. */

type Client = Awaited<ReturnType<typeof login>>;
let sa: Client;

async function newShop(email: string, features: string[]) {
  const res = await sa.post('/api/platform/shops').send({ shopName: `Shop ${email}`, ownerName: 'Lakshmi', email, phone: '9876501234', city: 'Madurai', planId: 'standard', years: 1, password: 'TempPass1', features });
  expect(res.status).toBe(201);
  const first = await login(email, 'TempPass1');
  await first.post('/api/auth/change-password').send({ current: 'TempPass1', next: 'ShopPass12' });
  return login(email, 'ShopPass12');
}
const keys = async (c: Client) => ((await c.get('/api/shop/dashboard/addons')).body as Array<{ key: string }>).map((t) => t.key).sort();

beforeAll(async () => {
  await freshDb();
  sa = await login('admin@ledgerly.in', 'admin123');
});

describe('dashboard tiles for the add-ons a business has bought', () => {
  it('a shop with no add-ons gets none', async () => {
    const o = await newShop('none@addons.in', []);
    expect(await keys(o)).toEqual([]);
  });

  it('POS + microfinance: both appear; once microfinance is switched on its own section takes over', async () => {
    const o = await newShop('two@addons.in', ['pos', 'microfinance']);
    expect(Object.keys(o.me.shop.features).sort()).toEqual(['microfinance', 'pos']);
    const tiles = (await o.get('/api/shop/dashboard/addons')).body;
    expect(tiles.map((t: any) => t.key).sort()).toEqual(['microfinance', 'pos']);
    expect(tiles.find((t: any) => t.key === 'microfinance').note).toMatch(/not switched on yet/);
    // Switched on: the microfinance summary (its own dashboard section) has the figures; POS keeps its tile.
    expect((await o.put('/api/shop/lending/enabled').send({ enabled: true })).status).toBe(200);
    expect(await keys(o)).toEqual(['pos']);
    expect((await o.get('/api/shop/lending/dashboard')).status).toBe(200);
    expect((await o.get('/api/shop/organization')).body.lendingEnabled).toBe(true);
  });

  it('counter sales today are counted on the POS tile', async () => {
    const o = await newShop('pos@addons.in', ['pos', 'offers_loyalty']);
    expect(await keys(o)).toEqual(['offers_loyalty', 'pos']);
    const slab = (await o.get('/api/shop/tax-slabs')).body.find((s: any) => s.rate === 5).id;
    const item = (await o.post('/api/shop/items').send({ type: 'Goods', name: 'Tile Test Ball', cost: 40, sp1: 100, sp2: 100, sp3: 100, taxSlabId: slab, openingStock: 10 })).body;
    const sale = await o.post('/api/shop/pos/sale').send({ customerId: null, withGst: false, mode: 'Cash', lines: [{ itemId: item.id, qty: 2, tier: 'SP1' }] });
    expect(sale.status, JSON.stringify(sale.body)).toBe(200);
    const pos = (await o.get('/api/shop/dashboard/addons')).body.find((t: any) => t.key === 'pos');
    expect(pos.figures).toEqual([{ label: 'Counter sales today', value: sale.body.invoice.total, kind: 'money' }, { label: 'Bills today', value: 1, kind: 'count' }]);
  });

  it('a shop with every add-on gets a working tile for each one (no query fails)', async () => {
    const owner = await login('owner@shop.com', 'owner123');
    const r = await owner.get('/api/shop/dashboard/addons');
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const have = Object.keys(owner.me.shop.features);
    // The demo shop has microfinance switched on, so that one is its own dashboard section instead of a tile.
    expect(r.body.map((t: any) => t.key).sort()).toEqual(have.filter((k) => k !== 'microfinance').sort());
    for (const t of r.body) {
      expect(FEATURES.find((f) => f.key === t.key)?.name).toBe(t.name);
      expect(t.link).toMatch(/^\/app\//);
      for (const f of t.figures) expect(Number.isFinite(f.value), `${t.key} ${f.label}`).toBe(true);
    }
  });

  it('staff only see the add-ons their job covers', async () => {
    const sales = await login('sales@shop.com', 'sales123');
    const k = await keys(sales);
    expect(k).not.toContain('accounting');
    expect(k).not.toContain('purchases');
    const collector = await login('collector@shop.com', 'collector123');
    expect(await keys(collector)).toEqual([]);
  });
});
