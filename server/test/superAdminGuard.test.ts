import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { query } from '../src/db';
import { app, freshDb, login } from './helpers';

/* The super admin can reset owners' passwords and download backups, so it must never stay on a public demo password. */
describe('super admin on the public demo password', () => {
  beforeAll(async () => { await freshDb(); });

  it('is not offered on the login page', async () => {
    const r = await request(app).get('/api/auth/demo');
    expect(r.body.accounts.some((a: { email: string }) => a.email === 'admin@ledgerly.in')).toBe(false);
  });

  it('must set a new password before the console opens, and the new one works', async () => {
    await query("UPDATE super_admins SET must_change_password = true WHERE email = 'admin@ledgerly.in'");
    const a = await login('admin@ledgerly.in', 'admin123');
    expect(a.me.user.mustChangePassword).toBe(true);
    expect((await a.get('/api/platform/overview')).status).toBe(403);
    expect((await a.post('/api/platform/shops/x/reset-owner-password').send({})).status).toBe(403);
    const r = await a.post('/api/auth/change-password').send({ current: 'admin123', next: 'Platform@2026x' });
    expect(r.status).toBe(200);
    expect(r.body.user.mustChangePassword).toBe(false);
    expect((await a.get('/api/platform/overview')).status).toBe(200);
    const b = await login('admin@ledgerly.in', 'Platform@2026x');
    expect((await b.get('/api/platform/overview')).status).toBe(200);
  });
});
