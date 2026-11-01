import { beforeAll, describe, expect, it } from 'vitest';
import { query, withTenant } from '../src/db';
import { FEATURES } from '../../shared/features';
import { BUSINESS_TEMPLATES, cleanExtra } from '../../shared/templates';
import { freshDb, login } from './helpers';

type Client = Awaited<ReturnType<typeof login>>;
let sa: Client;
let veg: Client;
let vegId: string;

async function newShop(email: string, businessType?: string) {
  const res = await sa.post('/api/platform/shops').send({ shopName: `Shop ${email}`, ownerName: 'Kumar', email, phone: '9876502345', city: 'Salem', planId: 'standard', years: 1, password: 'TempPass1', ...(businessType ? { businessType } : {}) });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  const o = await login(email, 'TempPass1');
  await o.post('/api/auth/change-password').send({ current: 'TempPass1', next: 'ShopPass12' });
  return { id: res.body.id as string, owner: await login(email, 'ShopPass12') };
}
const itemsOf = (shopId: string) => withTenant(shopId, async (db) => (await db.query('SELECT name, unit, hsn, tax_slab_id, sp1, sp2, sp3, extra, track_batches, track_serials FROM items WHERE shop_id = $1', [shopId])).rows);

beforeAll(async () => {
  await freshDb();
  sa = await login('admin@ledgerly.in', 'admin123');
  ({ id: vegId, owner: veg } = await newShop('veg@kumar.in', 'vegetables'));
});

describe('template catalogue', () => {
  it('is consistent: known features, units, fields, options and GST slabs', async () => {
    const slabs = (await query('SELECT id FROM tax_slabs WHERE active')).map((r) => r.id);
    expect(new Set(BUSINESS_TEMPLATES.map((t) => t.key)).size).toBe(BUSINESS_TEMPLATES.length);
    for (const t of BUSINESS_TEMPLATES) {
      for (const f of t.features) expect(FEATURES.find((x) => x.key === f)?.available, `${t.key}: ${f}`).toBe(true);
      expect(t.units.length === 0 || t.units.includes(t.defaultUnit), `${t.key} default unit`).toBe(true);
      if (t.defaultGst !== undefined) expect(slabs, `${t.key} default GST`).toContain(`tax_${t.defaultGst}`);
      expect(new Set(t.itemFields.map((f) => f.key)).size).toBe(t.itemFields.length);
      for (const s of t.samples) {
        expect(t.units.length === 0 || t.units.includes(s.unit), `${t.key}: ${s.name} unit ${s.unit}`).toBe(true);
        expect(slabs, `${t.key}: ${s.name}`).toContain(`tax_${s.gst}`);
        expect(s.price).toBeGreaterThan(0);
        expect(s.hsn).toMatch(/^\d{4,8}$/);
        const { value, errors } = cleanExtra(t.itemFields, s.extra);
        expect(errors, `${t.key}: ${s.name}`).toEqual({});
        expect(Object.keys(value).length).toBe(Object.keys(s.extra ?? {}).length); // no sample value is silently dropped
      }
    }
  });
});

describe('a new vegetable shop', () => {
  it('tries only the add-ons its trade needs', async () => {
    expect(Object.keys(veg.me.shop.features).sort()).toEqual(['pos', 'purchases']);
  });

  it('gets its fields, units, receipt size and common items with local names and 0% GST', async () => {
    const org = (await veg.get('/api/shop/organization')).body;
    expect(org.businessType).toBe('vegetables');
    expect(org.itemFields.map((f: { key: string }) => f.key)).toEqual(['localName']);
    expect(org.units).toEqual(expect.arrayContaining(['kg', 'bunch', 'dozen']));
    expect((await veg.get('/api/shop/print-settings')).body.thermal.paper).toBe('2in');
    const items = await itemsOf(vegId);
    const tomato = items.find((i) => i.name === 'Tomato');
    expect(tomato).toMatchObject({ unit: 'kg', hsn: '0702', tax_slab_id: 'tax_0', extra: { localName: 'தக்காளி' } });
    expect(Number(tomato!.sp1)).toBe(Number(tomato!.sp3));
    expect(items.length).toBe(BUSINESS_TEMPLATES.find((t) => t.key === 'vegetables')!.samples.length);
    expect((await veg.get('/api/shop/items')).body.find((i: { name: string }) => i.name === 'Coriander leaves').extra).toEqual({ localName: 'கொத்தமல்லி' });
  });

  it('applying the same type again adds nothing and changes nothing', async () => {
    const before = await itemsOf(vegId);
    const r = await veg.post('/api/shop/organization/business-type').send({ key: 'vegetables', samples: true, printLayout: true });
    expect(r.status).toBe(200);
    expect(r.body.result).toMatchObject({ fieldsAdded: [], unitsAdded: [], itemsAdded: 0, printUpdated: false });
    expect(await itemsOf(vegId)).toEqual(before);
  });

  it('updates today’s rates for many items at once, all price levels together', async () => {
    const list = (await veg.get('/api/shop/items')).body as Array<{ id: string; name: string; sp1: number; sp2: number; sp3: number }>;
    const tomato = list.find((i) => i.name === 'Tomato')!;
    const onion = list.find((i) => i.name === 'Onion')!;
    const r = await veg.post('/api/shop/items/rates').send({ updates: [{ id: tomato.id, sp1: 45 }, { id: onion.id, sp1: onion.sp1 }] });
    expect(r.body.changed).toBe(1); // onion's price did not change
    const t = (await veg.get('/api/shop/items')).body.find((i: { id: string }) => i.id === tomato.id);
    expect([t.sp1, t.sp2, t.sp3]).toEqual([45, 45, 45]);
    expect((await veg.post('/api/shop/items/rates').send({ updates: [{ id: tomato.id, sp1: 0 }] })).status).toBe(400);
  });
});

describe('an existing shop choosing a business type', () => {
  it('gets the new fields and units, and keeps every item and every feature it had', async () => {
    const owner = await login('owner@shop.com', 'owner123');
    const shopId = owner.me.shop.id;
    const featuresBefore = owner.me.shop.features;
    const [{ n: itemsBefore }] = await withTenant(shopId, async (db) => (await db.query('SELECT count(*)::int AS n FROM items WHERE shop_id = $1', [shopId])).rows);
    const r = await owner.post('/api/shop/organization/business-type').send({ key: 'pharmacy', samples: true, printLayout: false });
    expect(r.status).toBe(200);
    expect(r.body.result.fieldsAdded).toEqual(['Manufacturer', 'Composition / salt', 'Schedule', 'Pack']);
    expect(r.body.organization.units).toEqual(expect.arrayContaining(['strip', 'bottle']));
    const [{ n: itemsAfter }] = await withTenant(shopId, async (db) => (await db.query('SELECT count(*)::int AS n FROM items WHERE shop_id = $1', [shopId])).rows);
    expect(itemsAfter).toBe(itemsBefore);
    expect((await login('owner@shop.com', 'owner123')).me.shop.features).toEqual(featuresBefore);
  });

  it('item trade fields are checked: a wrong choice is refused on its field, unknown keys are dropped', async () => {
    const owner = await login('owner@shop.com', 'owner123');
    const base = { type: 'Goods', name: 'Dolo 650', unit: 'strip', hsn: '3004', cost: 20, sp1: 30, sp2: 30, sp3: 30, taxSlabId: 'tax_5', trackBatches: true };
    const bad = await owner.post('/api/shop/items').send({ ...base, extra: { schedule: 'Q' } });
    expect(bad.status).toBe(400);
    expect(bad.body.details['extra.schedule']).toMatch(/Choose a schedule/);
    const ok = await owner.post('/api/shop/items').send({ ...base, extra: { schedule: 'H', manufacturer: 'Micro Labs', composition: 'Paracetamol 650 mg', junk: 'x' } });
    expect(ok.status).toBe(200);
    expect(ok.body.extra).toEqual({ schedule: 'H', manufacturer: 'Micro Labs', composition: 'Paracetamol 650 mg' });
    const edit = await owner.patch(`/api/shop/items/${ok.body.id}`).send({ extra: { schedule: 'H1' } });
    expect(edit.body.extra).toEqual({ schedule: 'H1' });
    // items without extra keep working as before
    expect((await owner.patch(`/api/shop/items/${ok.body.id}`).send({ sp1: 32 })).body.extra).toEqual({ schedule: 'H1' });
  });

  it('trade details (drug licence) are saved on the business profile', async () => {
    const owner = await login('owner@shop.com', 'owner123');
    const org = (await owner.get('/api/shop/organization')).body;
    const r = await owner.put('/api/shop/organization').send({ ...org, tradeDetails: { drugLicence: 'TN-CH-20-12345' } });
    expect(r.status).toBe(200);
    expect(r.body.tradeDetails).toEqual({ drugLicence: 'TN-CH-20-12345' });
    // a later save without tradeDetails keeps them
    const { tradeDetails: _omit, ...rest } = org;
    expect((await owner.put('/api/shop/organization').send(rest)).body.tradeDetails).toEqual({ drugLicence: 'TN-CH-20-12345' });
  });

  it('refuses an unknown type, and staff cannot change the business type', async () => {
    const owner = await login('owner@shop.com', 'owner123');
    expect((await owner.post('/api/shop/organization/business-type').send({ key: 'spaceship' })).status).toBe(400);
    const staff = await login('sales@shop.com', 'sales123');
    expect((await staff.post('/api/shop/organization/business-type').send({ key: 'general' })).status).toBe(403);
  });
});

describe('every template', () => {
  it('sets up a new shop without errors, with that trade’s trial and items', async () => {
    for (const t of BUSINESS_TEMPLATES) {
      const { id, owner } = await newShop(`t-${t.key}@shop.in`, t.key);
      expect(Object.keys(owner.me.shop.features).sort(), t.key).toEqual([...t.features].sort());
      expect((await itemsOf(id)).length, t.key).toBe(t.samples.length);
    }
  }, 120_000);
});
