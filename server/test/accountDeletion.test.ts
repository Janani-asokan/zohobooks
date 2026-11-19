import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { app, freshDb, login } from './helpers';
import { query } from '../src/db';
import { runAccountDeletions } from '../src/services/accountDeletion';
import { confirmsShopName, recordsUntil } from '../../shared/accountDeletion';

beforeAll(async () => { await freshDb(); });

const signin = (email: string, password: string) => request(app).post('/api/auth/login').set('X-Requested-With', 'ledgerly').send({ email, password });

describe('account deletion rules', () => {
  it('keeps GST records 72 months from the annual return due date', () => {
    expect(recordsUntil('2026-11-19')).toBe('2033-12-31'); // FY 2026-27 → GSTR-9 due 31 Dec 2027
    expect(recordsUntil('2027-02-10')).toBe('2033-12-31');
    expect(recordsUntil('2027-04-01')).toBe('2034-12-31');
    expect(confirmsShopName('  sri murugan ', 'Sri Murugan')).toBe(true);
    expect(confirmsShopName('', '')).toBe(false);
  });
});

describe('staff delete their own login', () => {
  it('needs the right password, then wipes the login and ends every session', async () => {
    const v = await login('accounts@shop.com', 'accounts123');
    const other = await login('accounts@shop.com', 'accounts123');
    expect((await v.post('/api/auth/delete-account').send({ scope: 'me', password: 'nope' })).status).toBe(400);
    const r = await v.post('/api/auth/delete-account').send({ scope: 'me', password: 'accounts123', reason: 'Left the job' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    // Signed out on every phone, cannot sign in again, and the email is free for a new account.
    expect((await other.get('/api/auth/me')).status).toBe(401);
    expect((await signin('accounts@shop.com', 'accounts123')).status).toBe(401);
    const [u] = await query("SELECT name, email, active, deleted_at FROM users WHERE email LIKE 'deleted-%'");
    expect(u).toMatchObject({ name: 'Deleted user', active: false });
    expect(u.email).toMatch(/@deleted\.invalid$/);
  });

  it('an owner closes the shop instead of deleting only their login; staff cannot close the shop', async () => {
    const o = await login('owner@shop.com', 'owner123');
    expect((await o.post('/api/auth/delete-account').send({ scope: 'me', password: 'owner123' })).body.code).toBe('owner_must_close');
    const s = await login('sales@shop.com', 'sales123');
    expect((await s.post('/api/auth/delete-account').send({ scope: 'shop', password: 'sales123', confirm: 'x' })).status).toBe(403);
  });
});

describe('owner closes the shop', () => {
  it('signs everyone out, keeps records, and wipes personal details after 30 days', async () => {
    const agent = request.agent(app);
    const su = await agent.post('/api/auth/signup').set('X-Requested-With', 'ledgerly').send({
      shopName: 'Closing Stores', ownerName: 'Kumar', email: 'kumar@example.com', phone: '98400 99999', city: 'Madurai', businessType: 'kirana', password: 'Sunrise#2026' });
    expect(su.status, JSON.stringify(su.body)).toBe(201);
    const post = (b: object) => agent.post('/api/auth/delete-account').set('X-Requested-With', 'ledgerly').send(b);
    expect((await post({ scope: 'shop', password: 'Sunrise#2026', confirm: 'Wrong name' })).status).toBe(400);
    const r = await post({ scope: 'shop', password: 'Sunrise#2026', confirm: 'closing stores', reason: 'Shop shut' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.restoreDays).toBe(30);
    expect((await signin('kumar@example.com', 'Sunrise#2026')).body.code).toBe('workspace_inactive');

    // Nothing is wiped inside the restore window…
    expect(await runAccountDeletions()).toBe(0);
    // …but once it has passed, the logins and owner details go; the shop row (and its books) stay.
    await query("UPDATE shops SET deletion_requested_at = now() - interval '31 days' WHERE name = 'Closing Stores'");
    expect(await runAccountDeletions()).toBe(1);
    const [s] = await query("SELECT owner_name, email, phone, personal_data_erased_at, records_until FROM shops WHERE name = 'Closing Stores'");
    expect(s).toMatchObject({ owner_name: 'Deleted', email: '', phone: '' });
    expect(s.personal_data_erased_at).not.toBeNull();
    expect(s.records_until).not.toBeNull();
    expect(await query("SELECT 1 FROM users WHERE email = 'kumar@example.com'")).toHaveLength(0);
    expect(await runAccountDeletions()).toBe(0);
  });
});
