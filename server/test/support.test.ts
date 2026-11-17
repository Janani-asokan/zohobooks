import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { app, freshDb, login } from './helpers';

let owner: Awaited<ReturnType<typeof login>>;
let admin: Awaited<ReturnType<typeof login>>;
let sales: Awaited<ReturnType<typeof login>>;
let other: ReturnType<typeof request.agent>;
const csrf = { 'X-Requested-With': 'ledgerly' };

beforeAll(async () => {
  await freshDb();
  owner = await login('owner@shop.com', 'owner123');
  admin = await login('admin@ledgerly.in', 'admin123');
  sales = await login('sales@shop.com', 'sales123');
  // A second shop, made through the public sign-up.
  other = request.agent(app);
  const r = await other.post('/api/auth/signup').set(csrf).send({ shopName: 'Second Shop', ownerName: 'Lakshmi R', email: 'second@example.com', phone: '9000012345', password: 'Second#2026' });
  expect(r.status).toBe(201);
});

describe('customer support call-backs', () => {
  let slots: Array<{ start: string; left: number }>;
  let id: string;

  it('offers slots in support hours and lets the owner book one', async () => {
    const r = await owner.get('/api/shop/support/slots');
    expect(r.status).toBe(200);
    slots = r.body.days.flatMap((d: any) => d.slots);
    expect(slots.length).toBeGreaterThan(10);
    expect(slots[0]!.left).toBe(2);
    const b = await owner.post('/api/shop/support/callbacks').send({ slotStart: slots[0]!.start, topic: 'printing', contactName: 'Aravind', phone: '98400 12345', message: 'Labels print sideways' });
    expect(b.status, JSON.stringify(b.body)).toBe(201);
    expect(b.body.status).toBe('scheduled');
    id = b.body.id;
    // The slot now has one place left, for every shop.
    const again = await other.get('/api/shop/support/slots').set(csrf);
    expect(again.body.days.flatMap((d: any) => d.slots).find((s: any) => s.start === slots[0]!.start)?.left).toBe(1);
  });

  it('allows one upcoming call-back per shop, refuses times that are not slots, and keeps staff out', async () => {
    expect((await owner.post('/api/shop/support/callbacks').send({ slotStart: slots[1]!.start, topic: 'gst', contactName: 'Aravind', phone: '9840012345' })).status).toBe(409);
    expect((await other.post('/api/shop/support/callbacks').set(csrf).send({ slotStart: '2026-01-04T03:47:00Z', topic: 'gst', contactName: 'Lakshmi', phone: '9000012345' })).status).toBe(400);
    expect((await sales.get('/api/shop/support/slots')).status).toBe(403);
  });

  it('never overbooks a slot', async () => {
    const s = (await admin.get('/api/platform/support/settings')).body;
    expect((await admin.put('/api/platform/support/settings').send({ ...s, capacity: 1 })).status).toBe(200);
    const r = await other.post('/api/shop/support/callbacks').set(csrf).send({ slotStart: slots[0]!.start, topic: 'gst', contactName: 'Lakshmi', phone: '9000012345' });
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('slot_full');
    expect((await admin.put('/api/platform/support/settings').send({ ...s, capacity: 2 })).status).toBe(200);
  });

  it('keeps each shop to its own requests', async () => {
    expect((await other.get('/api/shop/support/callbacks').set(csrf)).body).toEqual([]);
    expect((await owner.get('/api/shop/support/callbacks')).body.map((c: any) => c.id)).toEqual([id]);
    expect((await other.post(`/api/shop/support/callbacks/${id}/cancel`).set(csrf)).status).toBe(404);
  });

  it('shows staff every request with the shop, its account summary, and records the outcome', async () => {
    const list = await admin.get('/api/platform/support/callbacks?view=upcoming');
    expect(list.status).toBe(200);
    const cb = list.body.callbacks.find((c: any) => c.id === id);
    expect(cb.shop.name).toBeTruthy();
    expect(list.body.counts.upcoming).toBeGreaterThanOrEqual(1);
    const sum = await admin.get(`/api/platform/support/shops/${cb.shopId}`);
    expect(sum.status).toBe(200);
    expect(sum.body.usage.items).toBeGreaterThan(0);
    expect(sum.body.users.some((u: any) => u.role === 'Owner')).toBe(true);
    const done = await admin.patch(`/api/platform/support/callbacks/${id}`).send({ status: 'completed', staffNotes: 'Set paper to 80 x 25 in the driver' });
    expect(done.status).toBe(200);
    expect(done.body.status).toBe('completed');
    expect(done.body.assignedTo).toBe('Platform Admin');
    const mine = (await owner.get('/api/shop/support/callbacks')).body[0];
    expect(mine.status).toBe('completed');
    expect(mine.staffNotes).toBe('Set paper to 80 x 25 in the driver');
    // Shops can't reach the console.
    expect([401, 403]).toContain((await owner.get('/api/platform/support/callbacks')).status);
  });

  it('lets the owner book again after the call, and cancel', async () => {
    const b = await owner.post('/api/shop/support/callbacks').send({ slotStart: slots[2]!.start, topic: 'billing', contactName: 'Aravind', phone: '9840012345' });
    expect(b.status).toBe(201);
    const c = await owner.post(`/api/shop/support/callbacks/${b.body.id}/cancel`);
    expect(c.body.status).toBe('cancelled');
  });
});
