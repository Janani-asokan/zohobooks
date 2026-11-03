import { beforeAll, describe, expect, it } from 'vitest';
import { freshDb, login } from './helpers';

/* Vendors: only a real phone and email are saved. */
let owner: Awaited<ReturnType<typeof login>>;
const add = (b: Record<string, unknown>) => owner.post('/api/shop/vendors').send({ state: 'Tamil Nadu', ...b });

beforeAll(async () => {
  await freshDb();
  owner = await login('owner@shop.com', 'owner123');
});

describe('vendor phone and email', () => {
  it('refuses random text, short numbers and broken emails, and names the field', async () => {
    const before = (await owner.get('/api/shop/vendors')).body.length;
    for (const phone of ['abc123xyz', '12345', '98765abcde', '+1 415 555 0100', '1234567890']) {
      const r = await add({ name: `Bad phone ${phone}`, phone });
      expect(r.status, phone).toBe(400);
      expect(JSON.stringify(r.body), phone).toMatch(/mobile or a landline/);
    }
    for (const email of ['randomtext', 'abc@', 'a@b', 'x@y.c', 'a..b@x.com', 'qwe rty@x.com']) {
      const r = await add({ name: `Bad email ${email}`, email });
      expect(r.status, email).toBe(400);
      expect(JSON.stringify(r.body), email).toMatch(/valid email/);
    }
    expect((await owner.get('/api/shop/vendors')).body.length).toBe(before);
  });

  it('saves real ones tidied: mobile, landline with STD code, email lower-cased; both optional', async () => {
    const a = await add({ name: 'Good Vendor Mobile', phone: '098765-43210', email: ' Accounts@Supplier.IN ' });
    expect(a.status).toBe(200);
    expect(a.body).toMatchObject({ phone: '+91 98765 43210', email: 'accounts@supplier.in' });
    const b = await add({ name: 'Good Vendor Landline', phone: '0422 2345678' });
    expect(b.body.phone).toBe('04222345678');
    const c = await add({ name: 'Good Vendor Nothing' });
    expect(c.status).toBe(200);
    expect(c.body).toMatchObject({ phone: '', email: '' });
  });

  it('imports keep the vendor and drop a bad phone or email with a warning', async () => {
    const r = await owner.post('/api/shop/data-import').send({ kind: 'vendors', rows: [
      { name: 'Import Vendor Bad', phone: 'call me', email: 'not-an-email' },
      { name: 'Import Vendor Good', phone: '044-23456789', email: 'sales@abc.co.in' },
    ] });
    expect(r.status).toBe(200);
    expect(r.body.created).toBe(2);
    const w = r.body.warnings.join(' ');
    expect(w).toMatch(/call me/);
    expect(w).toMatch(/not-an-email/);
    const list = (await owner.get('/api/shop/vendors')).body;
    expect(list.find((v: any) => v.name === 'Import Vendor Bad')).toMatchObject({ phone: '', email: '' });
    expect(list.find((v: any) => v.name === 'Import Vendor Good')).toMatchObject({ phone: '04423456789', email: 'sales@abc.co.in' });
  });

  it('customers get the stricter email check too', async () => {
    const r = await owner.post('/api/shop/customers').send({ type: 'Individual', name: 'Email Check', email: 'x@y.c' });
    expect(r.status).toBe(400);
    expect((await owner.post('/api/shop/customers').send({ type: 'Individual', name: 'Email Ok', email: 'priya@gmail.com' })).status).toBe(200);
  });
});
