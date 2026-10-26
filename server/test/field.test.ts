import { beforeAll, describe, expect, it } from 'vitest';
import { freshDb, login } from './helpers';
import { km } from '../src/routes/shop/field';

let owner: Awaited<ReturnType<typeof login>>;
let sales: Awaited<ReturnType<typeof login>>;
let customer: any;
// Chennai: T. Nagar → Anna Nagar is about 7.5 km in a straight line.
const tnagar = { lat: 13.0418, lng: 80.2341 };
const annanagar = { lat: 13.085, lng: 80.2101 };

beforeAll(async () => {
  await freshDb();
  owner = await login('owner@shop.com', 'owner123');
  sales = await login('sales@shop.com', 'sales123');
  customer = (await owner.get('/api/shop/customers')).body[0];
});

describe('field staff tracking', () => {
  it('measures straight-line distance', () => {
    expect(km(tnagar, annanagar)).toBeGreaterThan(5);
    expect(km(tnagar, annanagar)).toBeLessThan(6);
  });

  it('a salesperson starts the day, visits a customer, takes an order and ends the day', async () => {
    const start = await sales.post('/api/shop/field/day/start').send(tnagar);
    expect(start.status).toBe(200);
    const v = await sales.post('/api/shop/field/visits').send({ ...annanagar, customerId: customer.id, purpose: 'Sales visit' });
    expect(v.status).toBe(200);
    expect(v.body).toMatchObject({ customerId: customer.id, checkedOutAt: null });
    const me = (await sales.get('/api/shop/field/me')).body;
    expect(me.open.id).toBe(v.body.id);
    const out = await sales.post(`/api/shop/field/visits/${v.body.id}/checkout`).send({ outcome: 'Order taken', orderValue: 12500, collected: 2000, notes: 'Wants 10 more next week' });
    expect(out.body).toMatchObject({ outcome: 'Order taken', orderValue: 12500, collected: 2000 });
    expect(out.body.minutes).toBeGreaterThanOrEqual(0);
    expect((await sales.post('/api/shop/field/day/end').send(tnagar)).status).toBe(200);
    expect((await sales.post('/api/shop/field/ping').send(tnagar)).body).toMatchObject({ kept: false, onDuty: false }); // no tracking off duty
  });

  it('shows the team day to the owner only, with route distance and totals', async () => {
    expect((await sales.get('/api/shop/field/team')).status).toBe(403);
    const t = await owner.get('/api/shop/field/team');
    expect(t.status).toBe(200);
    const p = t.body.people.find((x: any) => x.userName && x.visits.length);
    expect(p.totals).toMatchObject({ visits: 1, orders: 1, orderValue: 12500, collected: 2000 });
    expect(p.distanceKm).toBeGreaterThan(5);
    expect(p.onDuty).toBe(false);
  });

  it('keeps each person to their own visits', async () => {
    const mine = (await sales.get('/api/shop/field/visits')).body;
    expect(mine.every((v: any) => v.userId === sales.me.user.id)).toBe(true);
    const v = await owner.post('/api/shop/field/visits').send({ ...tnagar, customerName: 'Walk-in prospect' });
    expect((await sales.post(`/api/shop/field/visits/${v.body.id}/checkout`).send({ outcome: 'Follow up' })).status).toBe(403);
  });
});
