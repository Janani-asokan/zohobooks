import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { app, freshDb } from './helpers';

beforeAll(async () => { await freshDb(); });

const good = { shopName: 'Sri Murugan Stores', ownerName: 'Murugan K', email: 'murugan@example.com', phone: '98400 11223', city: 'Chennai', businessType: 'kirana', password: 'Sunrise#2026' };

describe('self-service signup', () => {
  it('lists the business types and says signup is open', async () => {
    const r = await request(app).get('/api/auth/signup');
    expect(r.status).toBe(200);
    expect(r.body.enabled).toBe(true);
    expect(r.body.businessTypes.some((t: any) => t.key === 'kirana')).toBe(true);
  });

  it('creates a shop on the trial plan and signs the owner in', async () => {
    const agent = request.agent(app);
    const r = await agent.post('/api/auth/signup').set('X-Requested-With', 'ledgerly').send(good);
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.user?.role ?? r.body.role).toBeDefined();
    // The session cookie works straight away: the owner sees their own shop.
    const org = await agent.get('/api/shop/organization').set('X-Requested-With', 'ledgerly');
    expect(org.status).toBe(200);
    expect(org.body.companyName).toBe('Sri Murugan Stores');
    // And can sign in again with the password they chose (no forced change).
    const again = await request(app).post('/api/auth/login').set('X-Requested-With', 'ledgerly').send({ email: good.email, password: good.password });
    expect(again.status).toBe(200);
    expect(JSON.stringify(again.body)).not.toContain('"mustChangePassword":true');
  });

  it('refuses a second account with the same email, a weak password and bots', async () => {
    const send = (b: object) => request(app).post('/api/auth/signup').set('X-Requested-With', 'ledgerly').send(b);
    expect((await send({ ...good, shopName: 'Another' })).status).toBe(409);
    expect((await send({ ...good, email: 'weak@example.com', password: 'abc' })).status).toBe(400);
    expect((await send({ ...good, email: 'bot@example.com', website: 'http://spam' })).status).toBe(400);
  });

  it('works from the CorpusLite phone app (its own origin, no cookies) and returns a login token', async () => {
    const r = await request(app).post('/api/auth/signup').set('Origin', 'https://localhost').set('X-Client', 'corpuslite').set('X-Requested-With', 'ledgerly')
      .send({ ...good, email: 'phone@example.com', shopName: 'Phone Shop' });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(typeof r.body.token).toBe('string');
    const org = await request(app).get('/api/shop/organization').set('Origin', 'https://localhost').set('Authorization', `Bearer ${r.body.token}`).set('X-Requested-With', 'ledgerly');
    expect(org.body.companyName).toBe('Phone Shop');
  });
});
