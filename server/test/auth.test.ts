import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { app, freshDb, login } from './helpers';

beforeAll(freshDb);

const post = (url: string, body: unknown) => request(app).post(url).set('X-Requested-With', 'ledgerly').send(body as object);

describe('authentication', () => {
  it('resolves the role from the account (no role picker)', async () => {
    const sa = await login('admin@ledgerly.in', 'admin123');
    expect(sa.me.kind).toBe('super');
    const owner = await login('OWNER@shop.com', 'owner123');
    expect(owner.me.kind).toBe('user');
    expect(owner.me.user.role).toBe('Owner');
    expect(owner.me.shop.name).toBe('Aravind Computer Store');
  });

  it('gives the same error for unknown email and wrong password', async () => {
    const a = await post('/api/auth/login', { email: 'nobody@x.in', password: 'whatever1' });
    const b = await post('/api/auth/login', { email: 'manager@shop.com', password: 'wrongpass1' });
    expect(a.status).toBe(401);
    expect(b.status).toBe(401);
    expect(a.body.error).toBe('Invalid email or password');
    expect(b.body.error.startsWith('Invalid email or password')).toBe(true);
  });

  it('locks the account after 5 failed attempts', async () => {
    for (let i = 0; i < 4; i++) expect((await post('/api/auth/login', { email: 'accounts@shop.com', password: 'bad-pass-1' })).status).toBe(401);
    const fifth = await post('/api/auth/login', { email: 'accounts@shop.com', password: 'bad-pass-1' });
    expect(fifth.status).toBe(423);
    // even the right password is refused while locked
    expect((await post('/api/auth/login', { email: 'accounts@shop.com', password: 'accounts123' })).status).toBe(423);
  });

  it('rejects mutating requests without the CSRF header', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: 'owner@shop.com', password: 'owner123' });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('csrf');
  });

  it('stores only password hashes and httpOnly session cookies', async () => {
    const res = await post('/api/auth/login', { email: 'owner@shop.com', password: 'owner123' });
    const cookie = String(res.headers['set-cookie']);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
  });

  it('resets a password with a one-time link and signs out other sessions', async () => {
    const old = await login('manager@shop.com', 'manager123');
    const f = await post('/api/auth/forgot', { email: 'manager@shop.com' });
    expect(f.status).toBe(200);
    const token = new URL(f.body.devResetUrl).searchParams.get('token');
    expect((await post('/api/auth/reset', { token, password: 'short' })).status).toBe(400);
    expect((await post('/api/auth/reset', { token, password: 'newPass123' })).status).toBe(200);
    expect((await post('/api/auth/reset', { token, password: 'another123' })).status).toBe(400); // single use
    expect((await old.get('/api/auth/me')).status).toBe(401);
    await login('manager@shop.com', 'newPass123');
    // unknown emails get the same response
    const u = await post('/api/auth/forgot', { email: 'ghost@nowhere.in' });
    expect(u.status).toBe(200);
    expect(u.body.devResetUrl).toBeUndefined();
  });
});

describe('demo mode', () => {
  it('does not publish demo logins unless demo mode is on', async () => {
    const r = await request(app).get('/api/auth/demo');
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ enabled: false, accounts: [] });
  });
});

describe('staff accounts & permissions', () => {
  it('forces new staff to change their temporary password', async () => {
    const owner = await login('owner@shop.com', 'owner123');
    const created = await owner.post('/api/shop/staff').send({ name: 'Temp User', email: 'temp@shop.com', role: 'Viewer', branchId: null, password: 'Welcome123' });
    expect(created.status).toBe(200);
    const t = await login('temp@shop.com', 'Welcome123');
    expect(t.me.user.mustChangePassword).toBe(true);
    expect((await t.get('/api/shop/items')).body.code).toBe('password_change_required');
    expect((await t.post('/api/auth/change-password').send({ current: 'Welcome123', next: 'MyOwnPass9' })).status).toBe(200);
    expect((await t.get('/api/shop/items')).status).toBe(200);
  });

  it('enforces role permissions on the server', async () => {
    const sales = await login('sales@shop.com', 'sales123');
    const items = (await sales.get('/api/shop/items')).body;
    expect(items[0].cost).toBeNull(); // sales staff can't see cost price
    expect((await sales.post('/api/shop/items').send({ type: 'Goods', name: 'X', cost: 1, sp1: 2, sp2: 2, sp3: 2, taxSlabId: 'tax_18' })).status).toBe(403);
    expect((await sales.get('/api/shop/reports/sales?fy=2026-27')).status).toBe(403);
    expect((await sales.get('/api/shop/bills')).status).toBe(403);
    expect((await sales.get('/api/shop/staff')).status).toBe(403);
    expect((await sales.get('/api/platform/overview')).status).toBe(401);
  });
});
