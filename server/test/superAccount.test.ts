import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app, freshDb, login } from './helpers';

beforeAll(async () => { await freshDb(); });

describe('super admin: own email and password', () => {
  it('changes the sign-in email with the current password; the old email stops working', async () => {
    const sa = await login('admin@ledgerly.in', 'admin123');
    expect((await sa.post('/api/auth/change-email').send({ email: 'owner-test@example.com', password: 'wrong' })).status).toBe(400);
    expect((await sa.post('/api/auth/change-email').send({ email: 'owner@shop.com', password: 'admin123' })).status).toBe(409); // a shop login
    expect((await sa.post('/api/auth/change-email').send({ email: 'not-an-email', password: 'admin123' })).status).toBe(400);
    const ok = await sa.post('/api/auth/change-email').send({ email: 'Platform-Test@Example.com', password: 'admin123' });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body.user.email).toBe('platform-test@example.com');
    expect((await request(app).post('/api/auth/login').set('X-Requested-With', 'ledgerly').send({ email: 'admin@ledgerly.in', password: 'admin123' })).status).toBe(401);
    const again = await login('platform-test@example.com', 'admin123');
    expect((await again.post('/api/auth/change-password').send({ current: 'admin123', next: 'NewStrongPass9' })).status).toBe(200);
    await login('platform-test@example.com', 'NewStrongPass9');
  });

  it('shop logins can’t use it', async () => {
    const owner = await login('owner@shop.com', 'owner123');
    expect((await owner.post('/api/auth/change-email').send({ email: 'x@example.com', password: 'owner123' })).status).toBe(403);
  });
});
